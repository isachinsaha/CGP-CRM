import fs from 'fs';
import path from 'path';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  getDoc,
  setDoc,
  deleteDoc,
  doc, 
  query, 
  orderBy, 
  limit, 
  writeBatch,
  setLogLevel
} from 'firebase/firestore';
import { Lead, LeadStage, StatSummary, Coordinator, Job, ImportantUpdate } from '../types.ts';

// Configure Firebase SDK to only log errors, suppressing gRPC connection warnings
setLogLevel('error');

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DATA_FILE = path.join(DATA_DIR, 'leads.json');
const COORDINATORS_FILE = path.join(DATA_DIR, 'coordinators.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const UPDATES_FILE = path.join(DATA_DIR, 'updates.json');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');

// Initialize client-side Firebase Firestore with standard Web SDK
// This bypasses GCP Service Account IAM permissions propagation issues on shared databases!
let db: any = null;
let currentDbId: string = '(default)';

// Helper to enforce timeouts on async Firestore promises so they never hang the server
function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number = 20000): Promise<T> {
  // Override low timeouts with a safe minimum of 5000ms to keep response times snappy while permitting some latency
  const actualTimeout = Math.max(timeoutMs, 5000);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Firestore operation timed out after ${actualTimeout}ms`));
    }, actualTimeout);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Circuit breaker state for Firestore
let cloudSyncEnabled = true;
let cloudErrorCount = 0;
let lastCloudErrorTime = 0;
const CLOUD_BREAKER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown

function checkCloudStatus(): boolean {
  if (!db) return false;
  if (!cloudSyncEnabled) {
    const now = Date.now();
    if (now - lastCloudErrorTime > CLOUD_BREAKER_COOLDOWN_MS) {
      console.log('[Firestore Client] Circuit breaker cooldown finished. Attempting to re-enable cloud sync.');
      cloudSyncEnabled = true;
      cloudErrorCount = 0;
    } else {
      return false;
    }
  }
  return true;
}

function handleCloudError(err: any) {
  const errMsg = err?.message || String(err);
  const isQuota = errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota') || errMsg.includes('quota') || errMsg.includes('limit exceeded');
  const isTimeout = errMsg.includes('timed out') || errMsg.includes('timeout');
  
  if (isQuota || isTimeout) {
    cloudErrorCount++;
    if (isQuota || cloudErrorCount >= 3) {
      console.error(`[Firestore Client] Circuit breaker tripped! Temporarily disabling cloud sync for 5 minutes due to consecutive errors: ${errMsg}`);
      cloudSyncEnabled = false;
      lastCloudErrorTime = Date.now();
    }
  }
}

function initFirestore() {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const firebaseConfig = {
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId
      };
      const app = initializeApp(firebaseConfig);
      db = getFirestore(app, config.firestoreDatabaseId || '(default)');
      currentDbId = config.firestoreDatabaseId || '(default)';
      console.log(`[Firestore Client] Initialized Firestore client for project "${config.projectId}" (Database ID: "${currentDbId}")`);
    } else {
      console.warn('[Firestore Client] firebase-applet-config.json not found. Operating in local JSON file mode.');
    }
  } catch (err) {
    console.error('[Firestore Client] Initialization failed:', err);
    db = null;
  }
}

// Perform initial initialization
initFirestore();

// In-Memory Cache for Firestore to dramatically reduce Firestore read operations (and avoid hitting Quota Limits)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 15000; // 15 seconds Cache TTL. Perfect to debounce multiple parallel queries or quick navigations!

const dbCache = {
  leads: null as CacheEntry<Lead[]> | null,
  coordinators: null as CacheEntry<Coordinator[]> | null,
  jobs: null as CacheEntry<Job[]> | null,
  updates: null as CacheEntry<ImportantUpdate[]> | null,
  metadata: null as CacheEntry<CgpMetadata> | null,
};

// Helper to recursively strip or replace undefined values with empty/null for Firestore compatibility
function cleanForFirestore(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    return obj.map(cleanForFirestore);
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val !== undefined) {
        cleaned[key] = cleanForFirestore(val);
      }
    }
    return cleaned;
  }
  return obj;
}

// Helper to ensure coordinators database exists with default seed accounts
export async function initializeCoordinatorsDatabase() {
  const defaultCoordinators: Coordinator[] = [
    {
      id: 'coord_admin',
      username: 'admin',
      displayName: 'Master Admin',
      password: 'admin123',
      role: 'admin',
      createdAt: new Date().toISOString()
    },
    ...['Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'].map((name) => ({
      id: `coord_${name.toLowerCase()}`,
      username: name.toLowerCase(),
      displayName: name,
      password: `${name.toLowerCase()}123`,
      role: 'agent' as const,
      createdAt: new Date().toISOString()
    }))
  ];

  // ALWAYS write to local file first so we have a local copy and stay fully functional!
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(COORDINATORS_FILE)) {
    fs.writeFileSync(COORDINATORS_FILE, JSON.stringify(defaultCoordinators, null, 2), 'utf-8');
  }

  if (checkCloudStatus()) {
    try {
      const q = query(collection(db, 'coordinators'), limit(1));
      const snapshot = await runWithTimeout(getDocs(q), 2000);
      if (snapshot.empty) {
        console.log('[Firestore Client] Seeding default coordinators to cloud...');
        const batch = writeBatch(db);
        defaultCoordinators.forEach(c => {
          const docRef = doc(db, 'coordinators', c.id);
          batch.set(docRef, cleanForFirestore(c));
        });
        await runWithTimeout(batch.commit(), 2000);
        console.log('[Firestore Client] Seeded coordinators successfully.');
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to check/seed coordinators, falling back to local file:', err);
      handleCloudError(err);
    }
  }
}

// Get all coordinators
export async function getCoordinators(): Promise<Coordinator[]> {
  await initializeCoordinatorsDatabase();

  // Check in-memory cache first
  if (dbCache.coordinators && (Date.now() - dbCache.coordinators.timestamp < CACHE_TTL_MS)) {
    return dbCache.coordinators.data;
  }

  if (checkCloudStatus()) {
    try {
      const snapshot = await runWithTimeout(getDocs(collection(db, 'coordinators')), 2000);
      const coords: Coordinator[] = [];
      snapshot.forEach(docSnap => {
        coords.push(docSnap.data() as Coordinator);
      });

      // Update in-memory cache
      dbCache.coordinators = { data: coords, timestamp: Date.now() };

      // Sync and warm the local cache file
      try {
        fs.writeFileSync(COORDINATORS_FILE, JSON.stringify(coords, null, 2), 'utf-8');
      } catch (err) {
        console.error('Failed to sync cloud coordinators to local cache:', err);
      }

      return coords;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch coordinators from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }
  try {
    const data = fs.readFileSync(COORDINATORS_FILE, 'utf-8');
    const coords = JSON.parse(data) as Coordinator[];

    // Cache the fallback local values too
    dbCache.coordinators = { data: coords, timestamp: Date.now() };

    return coords;
  } catch (err) {
    console.error('Failed to read coordinators file', err);
    return [];
  }
}

// Save all coordinators
export async function saveCoordinators(coordinators: Coordinator[]): Promise<void> {
  await initializeCoordinatorsDatabase();

  // Update in-memory cache immediately so changes are instantly reflected on reads
  dbCache.coordinators = { data: coordinators, timestamp: Date.now() };

  // Write to local JSON file first so we ALWAYS have a local copy and stay fully functional!
  try {
    fs.writeFileSync(COORDINATORS_FILE, JSON.stringify(coordinators, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write coordinators file', err);
  }

  if (checkCloudStatus()) {
    // Run asynchronously in background to avoid blocking the client request
    (async () => {
      try {
        const batch = writeBatch(db);
        coordinators.forEach(c => {
          const docRef = doc(db, 'coordinators', c.id);
          batch.set(docRef, cleanForFirestore(c));
        });
        await runWithTimeout(batch.commit(), 2000);

        // Delete any removed coordinators
        const snapshot = await runWithTimeout(getDocs(collection(db, 'coordinators')), 2000);
        const deleteBatch = writeBatch(db);
        let hasDeletes = false;
        snapshot.forEach(docSnap => {
          if (!coordinators.some(c => c.id === docSnap.id)) {
            deleteBatch.delete(docSnap.ref);
            hasDeletes = true;
          }
        });
        if (hasDeletes) {
          await runWithTimeout(deleteBatch.commit(), 2000);
        }
      } catch (err: any) {
        console.error('[Firestore Client] Failed to save coordinators to cloud in background:', err);
        handleCloudError(err);
      }
    })();
  }
}

// Helper to ensure data directory and file exist with Career Growth Placement (CGP) data
async function initializeDatabase() {
  const now = new Date();
  const initialLeads: Lead[] = [
    {
      id: 'cgp_lead_1',
      serialNo: '5652',
      entryDate: '22/Jun/2026',
      assignDate: '23/Jun/2026',
      name: 'DEWAS BHUJEL',
      gender: 'MALE',
      phone: '8967389503',
      age: '24',
      origin: 'DARJEELING',
      country: 'QATAR',
      position: 'WITHSTAND',
      experience: 'FRESHER',
      adminRemarks: 'Chat in History',
      assignedTo: 'Joyce',
      importance: 5,
      remarks1: 'NO INCOMING CALL - Left voice note on WhatsApp',
      remarks2: 'Called back - candidate interested in waiter/withstand role. Waiting for passport scan.',
      remarks3: '',
      stage: 'new',
      budget: 1500,
      budgetRaw: '₹1,20,000 package',
      summary: 'Enquired for hotel/waiter positions in Qatar. Candidate is a fresher from Darjeeling, fluent in Hindi and basic English.',
      requirements: ['Qatar Waiter', 'English Speaker', 'Passport Available'],
      fitScore: 'high',
      nextAction: 'Collect CV & Passport scan for placement file',
      notes: 'Very high intent, ready to relocate immediately. Has relatives in Doha.',
      createdAt: new Date(now.getTime() - 2 * 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 2 * 3600000).toISOString(),
      messages: [
        {
          id: 'm1',
          sender: 'lead',
          text: 'Hello, I saw your ad for Qatar vacancies. I am from Darjeeling and want to apply for a Withstand/Waiter job. What is the process?',
          timestamp: new Date(now.getTime() - 2.5 * 3600000).toISOString()
        },
        {
          id: 'm2',
          sender: 'user',
          text: 'Hi Dewas! We currently have excellent openings in major Qatar hotels. Do you have any prior experience in hospitality?',
          timestamp: new Date(now.getTime() - 2 * 3600000).toISOString()
        }
      ]
    },
    {
      id: 'cgp_lead_2',
      serialNo: '5662',
      entryDate: '22/Jun/2026',
      assignDate: '22/Jun/2026',
      name: 'SHRUTI RAI',
      gender: 'FEMALE',
      phone: '6295070585',
      age: '28',
      origin: 'SILIGURI',
      country: 'QATAR',
      position: 'Nurse',
      experience: '3 years in Siliguri local clinic',
      adminRemarks: 'ORGANIC',
      assignedTo: 'Sarina',
      importance: 3,
      remarks1: 'ASKED TO SHARE CV FOR BAKERY CHEF / NURSE POSITION',
      remarks2: 'Shared resume, checking credentials with Qatar Medical Council guidelines',
      remarks3: '',
      stage: 'negotiating',
      budget: 1800,
      budgetRaw: '₹1,50,000 package',
      summary: 'Qualified nursing staff looking for overseas clinic openings. Intrigued by Qatar salary structures.',
      requirements: ['Nurse Degree', 'Clinician Experience', 'Ready to join'],
      fitScore: 'high',
      nextAction: 'Verify medical diploma certifications and schedule screening',
      notes: 'Spoke politely. Has good theoretical knowledge.',
      createdAt: new Date(now.getTime() - 10 * 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 4 * 3600000).toISOString(),
      messages: [
        {
          id: 'm3',
          sender: 'lead',
          text: 'Good afternoon, I am Shruti of Siliguri. I have finished General Nursing and GNM course. Is there any vacancy in Doha clinics?',
          timestamp: new Date(now.getTime() - 10 * 3600000).toISOString()
        }
      ]
    },
    {
      id: 'cgp_lead_3',
      serialNo: '5659',
      entryDate: '22/Jun/2026',
      assignDate: '22/Jun/2026',
      name: 'Chetna Rai',
      gender: 'FEMALE',
      phone: '8101044171',
      age: '26',
      origin: 'DARJEELING',
      country: 'QATAR',
      position: 'WITHSTAND',
      experience: 'FRESHER',
      adminRemarks: 'Chat in History',
      assignedTo: 'Joyce',
      importance: 4,
      remarks1: 'ENQUIRED FOR KUWAIT N.A / QATAR, SEND VACANCY DEMAND',
      remarks2: 'Sent PDF package of Qatar food service requirements.',
      remarks3: '',
      stage: 'negotiating',
      budget: 1400,
      budgetRaw: '₹1,10,000 package',
      summary: 'Interested in Kuwait or Qatar entry jobs. Prefers front desk or welcoming roles.',
      requirements: ['Front Desk', 'Doha Hostess', 'Kuwait Option'],
      fitScore: 'medium',
      nextAction: 'Confirm passport validity dates',
      notes: 'Speaks exceptionally clear English. Great front desk candidate.',
      createdAt: new Date(now.getTime() - 18 * 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 12 * 3600000).toISOString(),
      messages: []
    },
    {
      id: 'cgp_lead_4',
      serialNo: '5658',
      entryDate: '22/Jun/2026',
      assignDate: '22/Jun/2026',
      name: 'GOURAV',
      gender: 'MALE',
      phone: '6290314631',
      age: '26',
      origin: 'DARJEELING',
      country: 'QATAR',
      position: 'COMMI I',
      experience: '2 years hospitality',
      adminRemarks: 'Chat in history',
      assignedTo: 'Joyce',
      importance: 4,
      remarks1: 'NEED TO CALL TOMORROW (MARYADA)',
      remarks2: 'Spoke. Candidate requires local accommodation support.',
      remarks3: '',
      stage: 'negotiating',
      budget: 1600,
      budgetRaw: '₹1,30,000 package',
      summary: 'Professional cook from Darjeeling inquiring about Arabic/Continental kitchen placement.',
      requirements: ['Kitchen assistant', 'Commis chef', 'Doha Hotel'],
      fitScore: 'high',
      nextAction: 'Get active food safety certification copy',
      notes: 'Good culinary track records.',
      createdAt: new Date(now.getTime() - 24 * 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 17 * 3600000).toISOString(),
      messages: []
    },
    {
      id: 'cgp_lead_5',
      serialNo: '5682',
      entryDate: '23/Jun/2026',
      assignDate: '23/Jun/2026',
      name: 'Ishika thapa',
      gender: 'FEMALE',
      phone: '8617050629',
      age: '24',
      origin: 'SILIGURI',
      country: 'GERMANY',
      position: 'Nurse',
      experience: '2 years nursing resident in Bahrain',
      adminRemarks: 'ORGANIC',
      assignedTo: 'Shreya',
      importance: 4,
      remarks1: '2 year now she is Bahrain, no response // texted in whats app',
      remarks2: 'Replied to text - highly interested in Germany nursing visa program.',
      remarks3: '',
      stage: 'proposal',
      budget: 2500,
      budgetRaw: '₹2,10,000 visa service',
      summary: 'Enquired about European job visa pathways. Located currently in Bahrain. Registered Nurse certification holder.',
      requirements: ['Bahrain Experience', 'B2 German course', 'Visa Sponsor'],
      fitScore: 'high',
      nextAction: 'Send details about Germany nursing pathways',
      notes: 'Valuable experience, knows Arabic & Bengali as well.',
      createdAt: new Date(now.getTime() - 6 * 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 2 * 3600005).toISOString(),
      messages: []
    },
    {
      id: 'cgp_lead_6',
      serialNo: '5690',
      entryDate: '23/Jun/2026',
      assignDate: '23/Jun/2026',
      name: 'Deepankar chhetri',
      gender: 'MALE',
      phone: '7797078039',
      age: '29',
      origin: 'DARJEELING',
      country: 'JAPAN',
      position: 'SALES ASSISTANT',
      experience: 'Experience in sales in India and out country Kuwait and Qatar',
      adminRemarks: 'ORGANIC',
      assignedTo: 'Shreya',
      importance: 5,
      remarks1: 'BUSY LINE // TEXTED ON WHATSAPP',
      remarks2: 'Got a callback. He is excited about the Japan retail vacancy program.',
      remarks3: '',
      stage: 'negotiating',
      budget: 2200,
      budgetRaw: '₹1,80,000 placement',
      summary: 'Experienced international sales assistant looking for retail stores placement in Tokyo/Japan.',
      requirements: ['International Sales', 'English fluent', 'Gulf returnee'],
      fitScore: 'high',
      nextAction: 'Ask for video introduction clip in formal clothing',
      notes: 'Highly groomed profile, worked 3 years in Doha Mall.',
      createdAt: new Date(now.getTime() - 14 * 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 8 * 3600000).toISOString(),
      messages: []
    },
    {
      id: 'cgp_lead_7',
      serialNo: '5688',
      entryDate: '23/Jun/2026',
      assignDate: '23/Jun/2026',
      name: 'GOA CONTRACTOR',
      gender: 'MALE',
      phone: '7276908924',
      age: '33',
      origin: 'GOA',
      country: 'DUBAI',
      position: 'ORGANIC',
      experience: '3 years in Dubai construction sites',
      adminRemarks: 'ORGANIC',
      assignedTo: 'Joyce',
      importance: 4,
      remarks1: 'OKING FOR JOB VACANCY IN DUBAI OR RUSSIA (WORKING EXPERIENCE IN MIDDLE EAST)',
      remarks2: 'Checked passport stamp - eligible for immediate Gulf entry visa.',
      remarks3: '',
      stage: 'won',
      budget: 1500,
      budgetRaw: '₹1,20,000 package',
      summary: 'Experienced construction technician looking to return to Dubai or Russia. Direct Gulf returning candidate.',
      requirements: ['Construction spec', 'Gulf Returnee', 'Available immediately'],
      fitScore: 'high',
      nextAction: 'Complete placement deposit & send visa processing details',
      notes: 'Contract signed.',
      createdAt: new Date(now.getTime() - 36 * 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 5 * 3600000).toISOString(),
      messages: []
    },
    {
      id: 'cgp_lead_8',
      serialNo: '5686',
      entryDate: '23/Jun/2026',
      assignDate: '23/Jun/2026',
      name: 'Pasang sherpa',
      gender: 'MALE',
      phone: '9641195676',
      age: '22',
      origin: 'DARJEELING',
      country: 'JAPAN',
      position: 'FRESHER',
      experience: 'FRESHER',
      adminRemarks: 'Chat in History',
      assignedTo: 'Joyce',
      importance: 3,
      remarks1: 'no response // texted in whats app',
      remarks2: 'Did not answer calls. Will retry tomorrow.',
      remarks3: '',
      stage: 'lost',
      budget: 0,
      budgetRaw: 'Low intent / unresponsive',
      summary: 'Applied for Japan entry level vacancies but unresponsive to calls.',
      requirements: ['Fresher', 'Unresponsive'],
      fitScore: 'low',
      nextAction: 'Archive after 1 more follow-up attempt',
      notes: 'Candidate has low response rate.',
      createdAt: new Date(now.getTime() - 48 * 3600000).toISOString(),
      updatedAt: new Date(now.getTime() - 12 * 3600000).toISOString(),
      messages: []
    }
  ];

  // ALWAYS write to local file first so we have a local copy and stay fully functional!
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialLeads, null, 2), 'utf-8');
  }

  if (checkCloudStatus()) {
    try {
      const q = query(collection(db, 'leads'), limit(1));
      const snapshot = await runWithTimeout(getDocs(q), 2000);
      if (snapshot.empty) {
        console.log('[Firestore Client] Seeding default leads to cloud...');
        const batch = writeBatch(db);
        initialLeads.forEach(l => {
          const docRef = doc(db, 'leads', l.id);
          batch.set(docRef, cleanForFirestore(l));
        });
        await runWithTimeout(batch.commit(), 2000);
        console.log('[Firestore Client] Seeded leads successfully.');
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to check/seed leads:', err);
      handleCloudError(err);
    }
  }
}

// Read database
export async function getLeads(): Promise<Lead[]> {
  await initializeDatabase();

  // Check in-memory cache first
  if (dbCache.leads && (Date.now() - dbCache.leads.timestamp < CACHE_TTL_MS)) {
    return dbCache.leads.data;
  }

  let leads: Lead[] = [];
  let fetchedFromCloud = false;
  if (checkCloudStatus()) {
    try {
      const q = query(collection(db, 'leads'), orderBy('createdAt', 'desc'));
      const snapshot = await runWithTimeout(getDocs(q), 2000);
      snapshot.forEach(docSnap => {
        leads.push(docSnap.data() as Lead);
      });
      fetchedFromCloud = true;

      // Update in-memory cache
      dbCache.leads = { data: leads, timestamp: Date.now() };

      // Warm and sync the local DATA_FILE cache with current cloud state
      try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf-8');
      } catch (err) {
        console.error('Failed to sync cloud leads to local cache:', err);
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to get leads from cloud, falling back:', err);
      handleCloudError(err);
    }
  }
  if (!fetchedFromCloud) {
    try {
      const data = fs.readFileSync(DATA_FILE, 'utf-8');
      leads = JSON.parse(data) as Lead[];

      // Cache the local file fallback too
      dbCache.leads = { data: leads, timestamp: Date.now() };
    } catch (err) {
      console.error('Failed to read database', err);
      leads = [];
    }
  }

  // Auto-migrate "CGP-" prefix to "INQ-" and "contacted" stage to "negotiating" for all present leads!
  let hasChanges = false;
  leads = leads.map(l => {
    let changed = false;
    let serialNo = l.serialNo;
    let stage = l.stage;

    if (l.serialNo && l.serialNo.startsWith('CGP-')) {
      changed = true;
      serialNo = l.serialNo.replace('CGP-', 'INQ-');
    }
    if ((l.stage as string) === 'contacted') {
      changed = true;
      stage = 'negotiating';
    }

    if (changed) {
      hasChanges = true;
      return {
        ...l,
        serialNo,
        stage
      };
    }
    return l;
  });

  if (hasChanges) {
    console.log('[Migration] Converting present leads CGP- serial numbers and stage contacted...');
    saveLeads(leads).catch(err => console.error('Failed to save migrated leads:', err));
  }

  // Store final migrated version in-memory cache
  dbCache.leads = { data: leads, timestamp: Date.now() };

  return leads;
}

// Find lead by id
export async function getLeadById(id: string): Promise<Lead | undefined> {
  // Try retrieving from active in-memory cache first if available
  if (dbCache.leads && (Date.now() - dbCache.leads.timestamp < CACHE_TTL_MS)) {
    return dbCache.leads.data.find(l => l.id === id);
  }

  if (checkCloudStatus()) {
    try {
      const docSnap = await runWithTimeout(getDoc(doc(db, 'leads', id)), 2000);
      if (docSnap.exists()) {
        return docSnap.data() as Lead;
      }
      return undefined;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to get lead by ID from cloud, falling back:', err);
      handleCloudError(err);
    }
  }
  const leads = await getLeads();
  return leads.find(l => l.id === id);
}

// Save all leads using smart delta-saving for Firestore
export async function saveLeads(leads: Lead[]): Promise<void> {
  await initializeDatabase();

  // Update in-memory cache immediately so local changes are instantly reflected on reads
  dbCache.leads = { data: leads, timestamp: Date.now() };

  // Read previous leads from local cache to compute the delta (new, modified, deleted)
  let oldLeads: Lead[] = [];
  try {
    if (fs.existsSync(DATA_FILE)) {
      const oldData = fs.readFileSync(DATA_FILE, 'utf-8');
      oldLeads = JSON.parse(oldData) as Lead[];
    }
  } catch (err) {
    console.error('[saveLeads] Failed to read old leads for delta comparison:', err);
  }

  // Write to local JSON file first so we ALWAYS have a local copy and stay fully functional!
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write database', err);
  }

  if (checkCloudStatus()) {
    // Run asynchronously in the background so it is completely non-blocking!
    (async () => {
      try {
        const oldLeadsMap = new Map<string, Lead>();
        oldLeads.forEach(l => {
          if (l && l.id) {
            oldLeadsMap.set(l.id, l);
          }
        });

        const leadsToSave: Lead[] = [];
        leads.forEach(l => {
          if (!l || !l.id) return;
          const oldL = oldLeadsMap.get(l.id);
          if (!oldL) {
            // This is a new lead
            leadsToSave.push(l);
          } else {
            // Compare JSON string or updatedAt to check for edits
            if (l.updatedAt !== oldL.updatedAt || JSON.stringify(l) !== JSON.stringify(oldL)) {
              leadsToSave.push(l);
            }
          }
        });

        const currentLeadsMap = new Map<string, Lead>();
        leads.forEach(l => {
          if (l && l.id) {
            currentLeadsMap.set(l.id, l);
          }
        });

        const leadsToDelete: string[] = [];
        oldLeads.forEach(oldL => {
          if (oldL && oldL.id && !currentLeadsMap.has(oldL.id)) {
            leadsToDelete.push(oldL.id);
          }
        });

        if (leadsToSave.length > 0 || leadsToDelete.length > 0) {
          console.log(`[Firestore Client] Background saveLeads diff: ${leadsToSave.length} leads to set, ${leadsToDelete.length} leads to delete (total: ${leads.length})`);
        }

        // Write changes in batches of 400
        if (leadsToSave.length > 0) {
          const CHUNK_SIZE = 400;
          for (let i = 0; i < leadsToSave.length; i += CHUNK_SIZE) {
            const chunk = leadsToSave.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);
            chunk.forEach(l => {
              const docRef = doc(db, 'leads', l.id);
              batch.set(docRef, cleanForFirestore(l));
            });
            await runWithTimeout(batch.commit(), 5000);
          }
        }

        // Delete removed documents in batches of 400
        if (leadsToDelete.length > 0) {
          const CHUNK_SIZE = 400;
          for (let i = 0; i < leadsToDelete.length; i += CHUNK_SIZE) {
            const chunk = leadsToDelete.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);
            chunk.forEach(id => {
              const docRef = doc(db, 'leads', id);
              batch.delete(docRef);
            });
            await runWithTimeout(batch.commit(), 5000);
          }
        }
      } catch (err: any) {
        console.error('[Firestore Client] Failed to save leads delta to cloud in background:', err);
        handleCloudError(err);
      }
    })();
  }
}

// Add custom lead
export async function addLead(lead: Lead): Promise<void> {
  const leads = await getLeads();
  leads.unshift(lead);
  await saveLeads(leads);
}

// Get aggregate statistics
export async function getStats(): Promise<StatSummary> {
  const leads = await getLeads();
  
  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.stage === 'new').length;
  const convertedLeads = leads.filter(l => l.stage === 'won').length;
  const lostLeads = leads.filter(l => l.stage === 'lost').length;
  
  const totalBudgetValue = leads
    .filter(l => l.stage !== 'lost')
    .reduce((sum, l) => sum + (l.budget || 0), 0);

  const averageFitScore = {
    high: leads.filter(l => l.fitScore === 'high').length,
    medium: leads.filter(l => l.fitScore === 'medium').length,
    low: leads.filter(l => l.fitScore === 'low').length,
    unqualified: leads.filter(l => l.fitScore === 'unqualified').length,
  };

  const byStage: Record<LeadStage, number> = {
    new: 0,
    negotiating: 0,
    rotations: 0,
    proposal: 0,
    won: 0,
    lost: 0
  };

  leads.forEach(l => {
    if (byStage[l.stage] !== undefined) {
      byStage[l.stage]++;
    }
  });

  const countryMap: Record<string, { count: number; value: number }> = {};
  leads.forEach(l => {
    const country = l.country || 'OTHER';
    const cleanCountryName = country.toUpperCase();
    if (!countryMap[cleanCountryName]) {
      countryMap[cleanCountryName] = { count: 0, value: 0 };
    }
    countryMap[cleanCountryName].count++;
    if (l.stage !== 'lost') {
      countryMap[cleanCountryName].value += (l.budget || 0);
    }
  });

  const byCampaign = Object.entries(countryMap).map(([campaign, data]) => ({
    campaign: `${campaign} Openings`,
    count: data.count,
    value: data.value
  }));

  return {
    totalLeads,
    newLeads,
    convertedLeads,
    lostLeads,
    totalBudgetValue,
    averageFitScore,
    byStage,
    byCampaign
  };
}

// Ensure jobs database exists with default seed jobs
export async function initializeJobsDatabase() {
  const defaultJobs: Job[] = [
    {
      id: 'job_nesto_hypermarket',
      title: 'NESTO HYPERMARKET',
      country: 'Dubai',
      requirement: 'Sales (1400 AED)',
      processingFeeMale: '95k',
      processingFeeFemale: '65k',
      accommodation: 'Free Accommodation & Transportation + Air ticket every 2 years',
      ageLimit: 'Max 32',
      conditions: [
        'Pre Medical',
        'No Stamping Required',
        'Need to send Introduction Video',
        'Original Passport is mandatory',
        'Qualification 10th above'
      ],
      modeOfInterview: 'Online',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: 'Freshers can Apply. Includes International Flight Tickets.',
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_guest_relations_dubai',
      title: 'GUEST RELATIONSHIP EXECUTIVE(DUBAI) (Highend Fine Dine)',
      country: 'Dubai',
      requirement: 'Guest Relations (2000 - 2700 AED)',
      processingFeeMale: '75k',
      processingFeeFemale: '75k',
      accommodation: 'Free Meal & Transportation + Air ticket every 2 years, Accomodation Free for the 1st month',
      ageLimit: 'Max 32',
      conditions: [
        'Pre Medical',
        'No Stamping Required',
        'Min 1 - 2 yrs experience in Restaurant or Hotel Reception',
        'Original Passport is mandatory'
      ],
      modeOfInterview: 'Online',
      applicability: 'Only Female Candidates can Apply',
      otherTerms: 'Company Name (Highend Fine Dine). Includes International Flight Tickets.',
      createdAt: new Date().toISOString()
    }
  ];

  // ALWAYS write to local file first so we have a local copy and stay fully functional!
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JOBS_FILE)) {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(defaultJobs, null, 2), 'utf-8');
  }

  if (checkCloudStatus()) {
    try {
      const statusRef = doc(db, 'metadata', 'jobs_status');
      const statusSnap = await runWithTimeout(getDoc(statusRef), 2000);
      if (!statusSnap.exists()) {
        console.log('[Firestore Client] Seeding default jobs to cloud...');
        const batch = writeBatch(db);
        defaultJobs.forEach(j => {
          const docRef = doc(db, 'jobs', j.id);
          batch.set(docRef, cleanForFirestore(j));
        });
        batch.set(statusRef, { seeded: true, updatedAt: new Date().toISOString() });
        await runWithTimeout(batch.commit(), 2000);
        console.log('[Firestore Client] Seeded jobs successfully.');
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to check/seed jobs, falling back to local file:', err);
      handleCloudError(err);
    }
  }
}

// Get all jobs
export async function getJobs(): Promise<Job[]> {
  await initializeJobsDatabase();

  // Check in-memory cache first
  if (dbCache.jobs && (Date.now() - dbCache.jobs.timestamp < CACHE_TTL_MS)) {
    return dbCache.jobs.data;
  }

  if (checkCloudStatus()) {
    try {
      const snapshot = await runWithTimeout(getDocs(collection(db, 'jobs')), 2000);
      const jobs: Job[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data) {
          jobs.push({
            id: docSnap.id,
            title: data.title || '',
            country: data.country || 'Other',
            requirement: data.requirement || '',
            processingFeeMale: data.processingFeeMale || '',
            processingFeeFemale: data.processingFeeFemale || '',
            accommodation: data.accommodation || '',
            ageLimit: data.ageLimit || '',
            conditions: Array.isArray(data.conditions) ? data.conditions : [],
            modeOfInterview: data.modeOfInterview || 'Online',
            applicability: data.applicability || 'Both Male & Female Candidates can Apply',
            otherTerms: data.otherTerms || '',
            isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
            createdAt: data.createdAt || new Date().toISOString()
          } as Job);
        }
      });
      const sortedJobs = jobs.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

      // Update in-memory cache
      dbCache.jobs = { data: sortedJobs, timestamp: Date.now() };

      // Sync the local file cache with current cloud state so cold-starts are fully populated!
      try {
        fs.writeFileSync(JOBS_FILE, JSON.stringify(sortedJobs, null, 2), 'utf-8');
      } catch (err) {
        console.error('Failed to sync cloud jobs to local cache:', err);
      }

      return sortedJobs;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch jobs from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }
  try {
    const data = fs.readFileSync(JOBS_FILE, 'utf-8');
    const jobs = JSON.parse(data) as Job[];
    const sanitized = jobs.map(j => ({
      id: j.id || `job_${Math.random().toString(36).substring(2, 7)}`,
      title: j.title || '',
      country: j.country || 'Other',
      requirement: j.requirement || '',
      processingFeeMale: j.processingFeeMale || '',
      processingFeeFemale: j.processingFeeFemale || '',
      accommodation: j.accommodation || '',
      ageLimit: j.ageLimit || '',
      conditions: Array.isArray(j.conditions) ? j.conditions : [],
      modeOfInterview: j.modeOfInterview || 'Online',
      applicability: j.applicability || 'Both Male & Female Candidates can Apply',
      otherTerms: j.otherTerms || '',
      isActive: j.isActive !== undefined ? Boolean(j.isActive) : true,
      createdAt: j.createdAt || new Date().toISOString()
    }));
    const sortedSanitized = sanitized.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    // Cache the fallback local values too
    dbCache.jobs = { data: sortedSanitized, timestamp: Date.now() };

    return sortedSanitized;
  } catch (err) {
    console.error('Failed to read jobs file', err);
    return [];
  }
}

// Save all jobs
export async function saveJobs(jobs: Job[]): Promise<void> {
  await initializeJobsDatabase();
  const validJobs = (jobs || []).filter(j => j && typeof j === 'object' && j.id);

  // Update in-memory cache immediately so changes are instantly reflected on reads
  dbCache.jobs = { data: validJobs, timestamp: Date.now() };

  // Write to local file first so we ALWAYS have a local copy and stay fully functional!
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(validJobs, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write jobs file', err);
  }

  if (checkCloudStatus()) {
    // Run asynchronously in background to avoid blocking client requests
    (async () => {
      try {
        const batch = writeBatch(db);
        validJobs.forEach(j => {
          const docRef = doc(db, 'jobs', j.id);
          batch.set(docRef, cleanForFirestore(j));
        });
        await runWithTimeout(batch.commit(), 2000);

        // Delete any removed jobs
        const snapshot = await runWithTimeout(getDocs(collection(db, 'jobs')), 2000);
        const deleteBatch = writeBatch(db);
        let hasDeletes = false;
        snapshot.forEach(docSnap => {
          if (!validJobs.some(j => j.id === docSnap.id)) {
            deleteBatch.delete(docSnap.ref);
            hasDeletes = true;
          }
        });
        if (hasDeletes) {
          await runWithTimeout(deleteBatch.commit(), 2000);
        }
      } catch (err: any) {
        console.error('[Firestore Client] Failed to save jobs to cloud in background:', err);
        handleCloudError(err);
      }
    })();
  }
}

// Ensure updates database exists with default seed updates
export async function initializeUpdatesDatabase() {
  const defaultUpdates: ImportantUpdate[] = [
    {
      id: 'update_1',
      text: "Today's interviews: Nesto Hypermarket screening starting at 3:00 PM. Zoom link: https://zoom.us/j/9876543210",
      createdAt: new Date().toISOString()
    },
    {
      id: 'update_2',
      text: "Guest Relations Dubai (Highend Fine Dine) second round interview via Google Meet: https://meet.google.com/abc-defg-hij on June 28 at 4:30 PM.",
      createdAt: new Date().toISOString()
    }
  ];

  // ALWAYS write to local file first so we have a local copy and stay fully functional!
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPDATES_FILE)) {
    fs.writeFileSync(UPDATES_FILE, JSON.stringify(defaultUpdates, null, 2), 'utf-8');
  }

  if (checkCloudStatus()) {
    try {
      const statusRef = doc(db, 'metadata', 'updates_status');
      const statusSnap = await runWithTimeout(getDoc(statusRef), 2000);
      if (!statusSnap.exists()) {
        console.log('[Firestore Client] Seeding default updates to cloud...');
        const batch = writeBatch(db);
        defaultUpdates.forEach(upd => {
          const docRef = doc(db, 'updates', upd.id);
          batch.set(docRef, cleanForFirestore(upd));
        });
        batch.set(statusRef, { seeded: true, updatedAt: new Date().toISOString() });
        await runWithTimeout(batch.commit(), 2000);
        console.log('[Firestore Client] Seeded updates successfully.');
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to check/seed updates, falling back to local file:', err);
      handleCloudError(err);
    }
  }
}

// Get all updates
export async function getUpdates(): Promise<ImportantUpdate[]> {
  await initializeUpdatesDatabase();

  // Check in-memory cache first
  if (dbCache.updates && (Date.now() - dbCache.updates.timestamp < CACHE_TTL_MS)) {
    return dbCache.updates.data;
  }

  if (checkCloudStatus()) {
    try {
      const snapshot = await runWithTimeout(getDocs(collection(db, 'updates')), 2000);
      const updates: ImportantUpdate[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data) {
          updates.push({
            id: docSnap.id,
            text: data.text || '',
            createdAt: data.createdAt || new Date().toISOString()
          } as ImportantUpdate);
        }
      });
      const sortedUpdates = updates.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

      // Update in-memory cache
      dbCache.updates = { data: sortedUpdates, timestamp: Date.now() };

      // Sync the local file cache with current cloud state so cold-starts are fully populated!
      try {
        fs.writeFileSync(UPDATES_FILE, JSON.stringify(sortedUpdates, null, 2), 'utf-8');
      } catch (err) {
        console.error('Failed to sync cloud updates to local cache:', err);
      }

      return sortedUpdates;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch updates from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }
  try {
    const data = fs.readFileSync(UPDATES_FILE, 'utf-8');
    const updates = JSON.parse(data) as ImportantUpdate[];
    const sortedSanitized = updates.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    // Cache the fallback local values too
    dbCache.updates = { data: sortedSanitized, timestamp: Date.now() };

    return sortedSanitized;
  } catch (err) {
    console.error('Failed to read updates file', err);
    return [];
  }
}

// Save all updates
export async function saveUpdates(updates: ImportantUpdate[]): Promise<void> {
  await initializeUpdatesDatabase();
  const validUpdates = (updates || []).filter(u => u && typeof u === 'object' && u.id);

  // Update in-memory cache immediately so changes are instantly reflected on reads
  dbCache.updates = { data: validUpdates, timestamp: Date.now() };

  try {
    fs.writeFileSync(UPDATES_FILE, JSON.stringify(validUpdates, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write updates file', err);
  }

  if (checkCloudStatus()) {
    // Run asynchronously in background to avoid blocking client requests
    (async () => {
      try {
        const batch = writeBatch(db);
        validUpdates.forEach(u => {
          const docRef = doc(db, 'updates', u.id);
          batch.set(docRef, cleanForFirestore(u));
        });
        await runWithTimeout(batch.commit(), 2000);

        // Delete any removed updates
        const snapshot = await runWithTimeout(getDocs(collection(db, 'updates')), 2000);
        const deleteBatch = writeBatch(db);
        let hasDeletes = false;
        snapshot.forEach(docSnap => {
          if (!validUpdates.some(u => u.id === docSnap.id)) {
            deleteBatch.delete(docSnap.ref);
            hasDeletes = true;
          }
        });
        if (hasDeletes) {
          await runWithTimeout(deleteBatch.commit(), 2000);
        }
      } catch (err: any) {
        console.error('[Firestore Client] Failed to save updates to cloud in background:', err);
        handleCloudError(err);
      }
    })();
  }
}

export interface CgpMetadata {
  countries: string[];
  positions: string[];
  projects: string[];
  tagsList: string[];
}

export async function initializeMetadataDatabase() {
  const defaultMetadata: CgpMetadata = {
    countries: ['Kuwait', 'Dubai', 'Qatar', 'Germany', 'Japan', 'Albania'],
    positions: ['Waiter', 'Waitress', 'Chef', 'Nurse', 'Cleaner', 'Driver', 'Electrician'],
    projects: ['Napkin affairs', 'Alltoobi', 'Lulu hypermarket', 'General Intake'],
    tagsList: [
      'Chef', 'Nurse', 'Waiter', 'Waitress', 'Driver', 'Accountant', 
      'Manager', 'Sales', 'Developer', 'Electrician', 'Plumber', 
      'Receptionist', 'Housekeeper', 'Security', 'Painter', 'Mechanic', 'Operator'
    ]
  };

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(METADATA_FILE)) {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(defaultMetadata, null, 2), 'utf-8');
  }

  if (checkCloudStatus()) {
    try {
      const docRef = doc(db, 'metadata', 'options');
      const docSnap = await runWithTimeout(getDoc(docRef), 2000);
      if (!docSnap.exists()) {
        console.log('[Firestore Client] Seeding default metadata to cloud...');
        await runWithTimeout(setDoc(docRef, cleanForFirestore(defaultMetadata)), 2000);
        console.log('[Firestore Client] Seeded metadata successfully.');
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to check/seed metadata, falling back to local file:', err);
      handleCloudError(err);
    }
  }
}

export async function getMetadata(): Promise<CgpMetadata> {
  await initializeMetadataDatabase();

  // Check in-memory cache first
  if (dbCache.metadata && (Date.now() - dbCache.metadata.timestamp < CACHE_TTL_MS)) {
    return dbCache.metadata.data;
  }

  if (checkCloudStatus()) {
    try {
      const docSnap = await runWithTimeout(getDoc(doc(db, 'metadata', 'options')), 2000);
      if (docSnap.exists()) {
        const data = docSnap.data();
        const metadata: CgpMetadata = {
          countries: Array.isArray(data.countries) ? data.countries : [],
          positions: Array.isArray(data.positions) ? data.positions : [],
          projects: Array.isArray(data.projects) ? data.projects : [],
          tagsList: Array.isArray(data.tagsList) ? data.tagsList : []
        };

        // Update in-memory cache
        dbCache.metadata = { data: metadata, timestamp: Date.now() };

        // Sync the local file cache with current cloud state so cold-starts are fully populated!
        try {
          fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
        } catch (err) {
          console.error('Failed to sync cloud metadata to local cache:', err);
        }

        return metadata;
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch metadata from cloud, falling back to local file:', err);
      handleCloudError(err);
    }
  }
  try {
    const data = fs.readFileSync(METADATA_FILE, 'utf-8');
    const metadata = JSON.parse(data) as CgpMetadata;

    // Cache the fallback local values too
    dbCache.metadata = { data: metadata, timestamp: Date.now() };

    return metadata;
  } catch (err) {
    console.error('Failed to read metadata file', err);
    const fallbackMetadata = {
      countries: ['Kuwait', 'Dubai', 'Qatar', 'Germany', 'Japan', 'Albania'],
      positions: ['Waiter', 'Waitress', 'Chef', 'Nurse', 'Cleaner', 'Driver', 'Electrician'],
      projects: ['Napkin affairs', 'Alltoobi', 'Lulu hypermarket', 'General Intake'],
      tagsList: [
        'Chef', 'Nurse', 'Waiter', 'Waitress', 'Driver', 'Accountant', 
        'Manager', 'Sales', 'Developer', 'Electrician', 'Plumber', 
        'Receptionist', 'Housekeeper', 'Security', 'Painter', 'Mechanic', 'Operator'
      ]
    };

    dbCache.metadata = { data: fallbackMetadata, timestamp: Date.now() };
    return fallbackMetadata;
  }
}

export async function saveMetadata(metadata: CgpMetadata): Promise<void> {
  await initializeMetadataDatabase();

  // Update in-memory cache immediately so changes are instantly reflected on reads
  dbCache.metadata = { data: metadata, timestamp: Date.now() };

  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write metadata file', err);
  }

  if (checkCloudStatus()) {
    // Run asynchronously in background to avoid blocking client requests
    (async () => {
      try {
        await runWithTimeout(setDoc(doc(db, 'metadata', 'options'), cleanForFirestore(metadata)), 2000);
      } catch (err: any) {
        console.error('[Firestore Client] Failed to save metadata to cloud in background:', err);
        handleCloudError(err);
      }
    })();
  }
}

