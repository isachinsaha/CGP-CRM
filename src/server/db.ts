import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { DEFAULT_WHATSAPP_TEMPLATES } from './whatsapp.ts';
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
  where,
  orderBy, 
  limit, 
  writeBatch,
  setLogLevel
} from 'firebase/firestore';
import { Lead, LeadStage, StatSummary, Coordinator, Job, ImportantUpdate, Wallet, WalletTransaction, IncentiveRule, WhatsAppTemplate, WhatsAppAutoReplySettings } from '../types.ts';
import { getEffectiveIntake } from '../utils.ts';

// Configure Firebase SDK to only log errors, suppressing gRPC connection warnings
setLogLevel('error');

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DATA_FILE = path.join(DATA_DIR, 'leads.json');
const DATA_FILE_SYNCED = path.join(DATA_DIR, 'leads_last_synced.json');
const COORDINATORS_FILE = path.join(DATA_DIR, 'coordinators.json');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const UPDATES_FILE = path.join(DATA_DIR, 'updates.json');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const WALLETS_FILE = path.join(DATA_DIR, 'wallets.json');
const INCENTIVE_RULES_FILE = path.join(DATA_DIR, 'incentive_rules.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'whatsapp_templates.json');
const AUTOREPLY_FILE = path.join(DATA_DIR, 'whatsapp_autoreply.json');

// --- SAFE ATOMIC JSON READ / WRITE / RECOVERY HELPERS ---

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch {}
}

/**
 * Atomically writes JSON to disk via temp file replacement to prevent corrupted/truncated files on crashes or interrupts.
 */
export function safeWriteJsonSync(filePath: string, data: any): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const serialized = JSON.stringify(data, null, 2);
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
    fs.writeFileSync(tempPath, serialized, 'utf-8');
    fs.renameSync(tempPath, filePath);

    // Write primary backup file
    try {
      const backupPath = `${filePath}.bak`;
      fs.writeFileSync(backupPath, serialized, 'utf-8');
    } catch {
      // Ignore backup error
    }

    // If data is a non-empty array with substantial records, preserve a periodic snapshot
    if (Array.isArray(data) && data.length > 50 && filePath.includes('leads')) {
      try {
        const baseName = path.basename(filePath, '.json');
        const snapshotPath = path.join(BACKUP_DIR, `${baseName}_snapshot.json`);
        // Only write snapshot if it doesn't exist or is older than 30 mins
        if (!fs.existsSync(snapshotPath) || (Date.now() - fs.statSync(snapshotPath).mtimeMs > 1800000)) {
          fs.writeFileSync(snapshotPath, serialized, 'utf-8');
        }
      } catch {
        // Ignore snapshot error
      }
    }
  } catch (err) {
    console.error(`[SafeJSON] Atomic write failed for ${filePath}, attempting direct write:`, err);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (directErr) {
      console.error(`[SafeJSON] Fatal: Direct write failed for ${filePath}:`, directErr);
    }
  }
}

/**
 * Recovers truncated JSON arrays by finding the last closed object and closing the array.
 */
function attemptTruncatedJsonArrayRepair<T>(corruptedStr: string): T | null {
  const trimmed = corruptedStr.trim();
  if (!trimmed.startsWith('[')) return null;
  let lastCloseBracket = trimmed.lastIndexOf('}');
  while (lastCloseBracket > 0) {
    const candidate = trimmed.substring(0, lastCloseBracket + 1) + '\n]';
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[SafeJSON] Successfully salvaged ${parsed.length} records from truncated JSON array!`);
        return parsed as T;
      }
    } catch {
      lastCloseBracket = trimmed.lastIndexOf('}', lastCloseBracket - 1);
    }
  }
  return null;
}

/**
 * Safely reads JSON from disk, automatically falling back to snapshots/backups or repairing truncated JSON files.
 */
export function safeReadJsonSync<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw || raw.trim().length === 0) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch (err: any) {
    console.warn(`[SafeJSON] Corrupted or incomplete JSON detected in ${filePath} (${err?.message || err}). Initiating automatic recovery...`);
    
    // 1. Try reading the snapshot file first if available
    try {
      const baseName = path.basename(filePath, '.json');
      const snapshotPath = path.join(BACKUP_DIR, `${baseName}_snapshot.json`);
      if (fs.existsSync(snapshotPath)) {
        const snapRaw = fs.readFileSync(snapshotPath, 'utf-8');
        if (snapRaw && snapRaw.trim().length > 0) {
          const parsedSnap = JSON.parse(snapRaw) as T;
          if (Array.isArray(parsedSnap) && parsedSnap.length > 0) {
            console.log(`[SafeJSON] Successfully recovered ${parsedSnap.length} records from snapshot for ${filePath}`);
            safeWriteJsonSync(filePath, parsedSnap);
            return parsedSnap;
          }
        }
      }
    } catch {}

    // 2. Try reading the .bak backup file
    const backupPath = `${filePath}.bak`;
    if (fs.existsSync(backupPath)) {
      try {
        const backupRaw = fs.readFileSync(backupPath, 'utf-8');
        if (backupRaw && backupRaw.trim().length > 0) {
          const parsedBackup = JSON.parse(backupRaw) as T;
          console.log(`[SafeJSON] Successfully recovered valid data from backup for ${filePath}`);
          safeWriteJsonSync(filePath, parsedBackup);
          return parsedBackup;
        }
      } catch (backupErr) {
        console.warn(`[SafeJSON] Backup file was also corrupted for ${backupPath}`);
      }
    }

    // 3. Try salvaging truncated JSON array
    try {
      const rawCorrupted = fs.readFileSync(filePath, 'utf-8');
      const salvaged = attemptTruncatedJsonArrayRepair<T>(rawCorrupted);
      if (salvaged) {
        safeWriteJsonSync(filePath, salvaged);
        return salvaged;
      }
    } catch (salvageErr) {
      console.warn(`[SafeJSON] Salvage attempt failed for ${filePath}:`, salvageErr);
    }

    // 4. Fallback to default state and repair the corrupted file
    console.warn(`[SafeJSON] Re-initializing ${filePath} with clean default state.`);
    safeWriteJsonSync(filePath, fallback);
    return fallback;
  }
}

// Mutex to prevent overlapping database read/write and Firestore sync operations
class DatabaseMutex {
  private queue: Promise<any> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
}

export const dbMutex = new DatabaseMutex();

// Initialize client-side Firebase Firestore with standard Web SDK
// This bypasses GCP Service Account IAM permissions propagation issues on shared databases!
let db: any = null;
let firebaseApp: any = null;
let currentDbId: string = '(default)';
let dbVerified = false;
let dbVerifying = false;

// Helper to enforce timeouts on async Firestore promises so they never hang the server
function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number = 8000): Promise<T> {
  const actualTimeout = timeoutMs;
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
let cloudBreakerCooldownMs = 5 * 60 * 1000; // default 5 minutes
let quotaLimitExceeded = false;

async function verifyDatabaseAccess(): Promise<boolean> {
  if (dbVerified) return true;
  if (!db) return false;
  if (dbVerifying) return false;
  dbVerifying = true;
  
  try {
    console.log(`[Firestore Client] Verifying connectivity to database: "${currentDbId}"...`);
    const testRef = doc(db, 'metadata', 'test_connection');
    await runWithTimeout(getDoc(testRef), 8000);
    dbVerified = true;
    cloudSyncEnabled = true;
    cloudErrorCount = 0;
    console.log(`[Firestore Client] Database "${currentDbId}" verified and active.`);
    return true;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const isQuota = errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota') || errMsg.includes('quota') || errMsg.includes('limit exceeded');
    
    if (isQuota) {
      handleCloudError('Database Verification', err);
      dbVerified = false;
      return false;
    }

    // If database does not exist or we get NOT_FOUND / INVALID, fallback to default database
    if (currentDbId !== '(default)' && (
      errMsg.includes('NOT_FOUND') || 
      errMsg.includes('not found') || 
      errMsg.includes('Database') || 
      errMsg.includes('database') ||
      errMsg.includes('Invalid database') ||
      errMsg.includes('invalid')
    )) {
      console.warn(`[Firestore Client] Custom database "${currentDbId}" unavailable. Falling back to "(default)".`);
      try {
        db = getFirestore(firebaseApp, '(default)');
        currentDbId = '(default)';
        const testRef = doc(db, 'metadata', 'test_connection');
        await runWithTimeout(getDoc(testRef), 2500);
        dbVerified = true;
        cloudSyncEnabled = true;
        console.log(`[Firestore Client] Successfully connected to "(default)" database.`);
        return true;
      } catch (fallbackErr) {
        dbVerified = false;
        cloudSyncEnabled = false;
        lastCloudErrorTime = Date.now();
        console.warn('[Firestore Client] Firestore connection timed out or unavailable. Operating smoothly in local storage mode.');
        return false;
      }
    } else {
      dbVerified = false;
      cloudSyncEnabled = false;
      lastCloudErrorTime = Date.now();
      console.warn('[Firestore Client] Firestore connection timed out or unavailable. Operating smoothly in local storage mode.');
      return false;
    }
  } finally {
    dbVerifying = false;
  }
}

function checkCloudStatus(): boolean {
  if (!db) return false;
  
  if (!cloudSyncEnabled) {
    const now = Date.now();
    if (now - lastCloudErrorTime > cloudBreakerCooldownMs) {
      cloudSyncEnabled = true;
      cloudErrorCount = 0;
      quotaLimitExceeded = false;
      dbVerified = false;
    } else {
      return false;
    }
  }

  if (!dbVerified && !dbVerifying) {
    const now = Date.now();
    if (now - lastCloudErrorTime > 15000) {
      console.log('[Firestore Client] Cloud connection not verified. Attempting background verification retry...');
      verifyDatabaseAccess().catch(err => {
        console.error('[Firestore Client] Background database verification failed:', err);
      });
    }
  }

  return dbVerified;
}

function handleCloudError(context: string | any, err?: any) {
  let contextStr = 'Cloud operation';
  let errorObj = err;
  if (typeof context === 'string') {
    contextStr = context;
  } else {
    errorObj = context;
  }

  const errMsg = errorObj?.message || String(errorObj);
  const isQuota = errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota') || errMsg.includes('quota') || errMsg.includes('limit exceeded');
  const isTimeout = errMsg.includes('timed out') || errMsg.includes('timeout');
  
  if (isQuota) {
    if (!quotaLimitExceeded) {
      console.warn(`[Firestore Client] Daily quota limit reached (${contextStr}). Operating seamlessly in local JSON storage mode.`);
    }
    quotaLimitExceeded = true;
    cloudSyncEnabled = false;
    lastCloudErrorTime = Date.now();
    cloudBreakerCooldownMs = 60 * 60 * 1000; // 1 hour cooldown for Quota errors
  } else if (isTimeout) {
    cloudErrorCount++;
    if (cloudErrorCount >= 2) {
      console.warn(`[Firestore Client] Circuit breaker tripped due to timeouts (${contextStr}). Temporarily disabling cloud sync for 3 minutes to maintain server responsiveness.`);
      cloudSyncEnabled = false;
      lastCloudErrorTime = Date.now();
      cloudBreakerCooldownMs = 3 * 60 * 1000;
    }
  } else {
    console.warn(`[Firestore Client] Cloud error during ${contextStr}: ${errMsg}`);
  }
}

export function getCloudSyncStatus() {
  return {
    cloudSyncEnabled,
    cloudErrorCount,
    lastCloudErrorTime,
    quotaLimitExceeded,
    cooldownRemainingMs: cloudSyncEnabled ? 0 : Math.max(0, cloudBreakerCooldownMs - (Date.now() - lastCloudErrorTime)),
    currentDbId,
    dbInitialized: !!db
  };
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
      firebaseApp = app;
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
setTimeout(() => {
  verifyDatabaseAccess().catch(() => {});
}, 1000);

// In-Memory Cache for Firestore to dramatically reduce Firestore read operations (and avoid hitting Quota Limits)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 300000; // 5 minutes Cache TTL (300s). Dramatically reduces Firestore read quota usage!

const dbCache = {
  leads: null as CacheEntry<Lead[]> | null,
  coordinators: null as CacheEntry<Coordinator[]> | null,
  jobs: null as CacheEntry<Job[]> | null,
  updates: null as CacheEntry<ImportantUpdate[]> | null,
  metadata: null as CacheEntry<CgpMetadata> | null,
  wallets: null as CacheEntry<Wallet[]> | null,
  incentive_rules: null as CacheEntry<IncentiveRule[]> | null,
  templates: null as CacheEntry<WhatsAppTemplate[]> | null,
  auto_reply: null as CacheEntry<WhatsAppAutoReplySettings> | null,
};

let lastFullLeadsSyncTime = 0;

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
  if (!fs.existsSync(COORDINATORS_FILE)) {
    safeWriteJsonSync(COORDINATORS_FILE, defaultCoordinators);
  }

  if (checkCloudStatus()) {
    try {
      const q = query(collection(db, 'coordinators'), limit(1));
      const snapshot = await runWithTimeout(getDocs(q), 8000);
      if (snapshot.empty) {
        console.log('[Firestore Client] Seeding default coordinators to cloud...');
        const batch = writeBatch(db);
        defaultCoordinators.forEach(c => {
          const docRef = doc(db, 'coordinators', c.id);
          batch.set(docRef, cleanForFirestore(c));
        });
        await runWithTimeout(batch.commit(), 8000);
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
      const snapshot = await runWithTimeout(getDocs(collection(db, 'coordinators')), 8000);
      const coords: Coordinator[] = [];
      snapshot.forEach(docSnap => {
        coords.push(docSnap.data() as Coordinator);
      });

      // Update in-memory cache
      dbCache.coordinators = { data: coords, timestamp: Date.now() };

      // Sync and warm the local cache file
      safeWriteJsonSync(COORDINATORS_FILE, coords);

      return coords;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch coordinators from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }
  const coords = safeReadJsonSync<Coordinator[]>(COORDINATORS_FILE, []);
  dbCache.coordinators = { data: coords, timestamp: Date.now() };
  return coords;
}

// Save all coordinators
export async function saveCoordinators(coordinators: Coordinator[]): Promise<void> {
  await initializeCoordinatorsDatabase();

  // Update in-memory cache immediately so changes are instantly reflected on reads
  dbCache.coordinators = { data: coordinators, timestamp: Date.now() };

  // Write to local JSON file first so we ALWAYS have a local copy and stay fully functional!
  safeWriteJsonSync(COORDINATORS_FILE, coordinators);

  if (checkCloudStatus()) {
    // Await cloud sync to guarantee data persistence under Cloud Run
    try {
      const batch = writeBatch(db);
      coordinators.forEach(c => {
        const docRef = doc(db, 'coordinators', c.id);
        batch.set(docRef, cleanForFirestore(c));
      });
      await runWithTimeout(batch.commit(), 8000);

      // Delete any removed coordinators
      const snapshot = await runWithTimeout(getDocs(collection(db, 'coordinators')), 8000);
      const deleteBatch = writeBatch(db);
      let hasDeletes = false;
      snapshot.forEach(docSnap => {
        if (!coordinators.some(c => c.id === docSnap.id)) {
          deleteBatch.delete(docSnap.ref);
          hasDeletes = true;
        }
      });
      if (hasDeletes) {
        await runWithTimeout(deleteBatch.commit(), 8000);
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to save coordinators to cloud:', err);
      handleCloudError(err);
    }
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
  if (!fs.existsSync(DATA_FILE)) {
    safeWriteJsonSync(DATA_FILE, initialLeads);
  }

  if (checkCloudStatus()) {
    try {
      const q = query(collection(db, 'leads'), limit(1));
      const snapshot = await runWithTimeout(getDocs(q), 8000);
      if (snapshot.empty) {
        console.log('[Firestore Client] Seeding default leads to cloud...');
        const batch = writeBatch(db);
        initialLeads.forEach(l => {
          const docRef = doc(db, 'leads', l.id);
          batch.set(docRef, cleanForFirestore(l));
        });
        await runWithTimeout(batch.commit(), 8000);
        console.log('[Firestore Client] Seeded leads successfully.');
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to check/seed leads:', err);
      handleCloudError(err);
    }
  }
}

// Helper function to perform bi-directional merge between local changes, last synced, and latest cloud data
function syncAndMergeLeadsList(
  localLeads: Lead[], 
  cloudLeads: Lead[], 
  lastSyncedLeads: Lead[]
): { mergedLeads: Lead[], pendingUpload: Lead[], pendingDeleteIds: string[] } {
  
  const localMap = new Map<string, Lead>();
  localLeads.forEach(l => { if (l && l.id) localMap.set(l.id, l); });

  const cloudMap = new Map<string, Lead>();
  cloudLeads.forEach(l => { if (l && l.id) cloudMap.set(l.id, l); });

  const syncedMap = new Map<string, Lead>();
  lastSyncedLeads.forEach(l => { if (l && l.id) syncedMap.set(l.id, l); });

  const mergedLeads: Lead[] = [];
  const pendingUpload: Lead[] = [];
  const pendingDeleteIds: string[] = []; // Intentionally empty to block physical Firestore deletion

  const allIds = new Set([
    ...localMap.keys(),
    ...cloudMap.keys(),
    ...syncedMap.keys()
  ]);

  for (const id of allIds) {
    const local = localMap.get(id);
    const cloud = cloudMap.get(id);

    if (local && cloud) {
      // Exist in both local and cloud
      if (JSON.stringify(local) === JSON.stringify(cloud)) {
        mergedLeads.push(local);
      } else {
        // Different. Determine who has newer edits based on updatedAt or default to local
        const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
        const cloudTime = new Date(cloud.updatedAt || cloud.createdAt || 0).getTime();

        let chosen: Lead;
        if (localTime > cloudTime) {
          chosen = { ...local };
          pendingUpload.push(chosen);
        } else {
          chosen = { ...cloud };
        }

        // Keep autoReplySent true if either version had it set
        if (local.autoReplySent || cloud.autoReplySent) {
          chosen.autoReplySent = true;
        }

        // Keep isDeleted true if either version had it set
        if (local.isDeleted || cloud.isDeleted) {
          chosen.isDeleted = true;
        }

        mergedLeads.push(chosen);
      }
    } else if (local && !cloud) {
      // Exist locally but missing from Cloud. We NEVER delete it! We instead preserve it and upload to Cloud.
      console.log(`[Sync Safeguard] Lead ${local.name || id} exists locally but is missing from Cloud. Preserving and uploading to Cloud.`);
      mergedLeads.push(local);
      pendingUpload.push(local);
    } else if (!local && cloud) {
      // Exist in Cloud but missing locally. We NEVER delete it! We preserve it locally.
      console.log(`[Sync Safeguard] Lead ${cloud.name || id} exists in Cloud but is missing locally. Preserving locally.`);
      mergedLeads.push(cloud);
    }
  }

  // Sort by createdAt desc
  mergedLeads.sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  return { mergedLeads, pendingUpload, pendingDeleteIds };
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

// Read database with bidirectional sync
async function getLeadsInternal(forceBypassCache = false): Promise<Lead[]> {
  await initializeDatabase();

  // Check in-memory cache first
  if (!forceBypassCache && dbCache.leads && (Date.now() - dbCache.leads.timestamp < CACHE_TTL_MS)) {
    return dbCache.leads.data;
  }

  // 1. Read existing local leads safely with auto-recovery
  const localLeads: Lead[] = safeReadJsonSync<Lead[]>(DATA_FILE, []);

  // 2. Read last successfully synced leads safely
  let lastSyncedLeads: Lead[] = [];
  if (fs.existsSync(DATA_FILE_SYNCED)) {
    lastSyncedLeads = safeReadJsonSync<Lead[]>(DATA_FILE_SYNCED, []);
  } else {
    lastSyncedLeads = [];
    safeWriteJsonSync(DATA_FILE_SYNCED, lastSyncedLeads);
  }

  let finalLeads = [...localLeads];

  // 3. Try to sync with Cloud
  if (checkCloudStatus()) {
    try {
      const nowTime = Date.now();
      const doFullSync = (nowTime - lastFullLeadsSyncTime) > 60 * 60 * 1000 || lastSyncedLeads.length === 0;
      let cloudLeads: Lead[] = [];

      if (doFullSync) {
        console.log('[Firestore Client] Performing FULL sync of leads to check for deletions and reconcile all changes...');
        const q = query(collection(db, 'leads'), orderBy('createdAt', 'desc'));
        const snapshot = await runWithTimeout(getDocs(q), 5000);
        snapshot.forEach(docSnap => {
          cloudLeads.push(docSnap.data() as Lead);
        });
        lastFullLeadsSyncTime = nowTime;
      } else {
        // Delta sync! Find latest updatedAt timestamp in lastSyncedLeads or localLeads
        let maxUpdatedAt = 0;
        const allReferenceLeads = lastSyncedLeads.length > 0 ? lastSyncedLeads : localLeads;
        allReferenceLeads.forEach(l => {
          if (l) {
            const upTime = new Date(l.updatedAt || l.createdAt || 0).getTime();
            if (upTime > maxUpdatedAt) {
              maxUpdatedAt = upTime;
            }
          }
        });

        // Use a 3-minute overlap to capture any concurrent writes safely
        const lastSyncThreshold = maxUpdatedAt > 0 
          ? new Date(maxUpdatedAt - 3 * 60 * 1000).toISOString() 
          : '1970-01-01T00:00:00.000Z';

        console.log(`[Firestore Client] Performing DELTA sync for leads modified since: ${lastSyncThreshold} (Saving Firestore Quotas)`);

        const q = query(
          collection(db, 'leads'),
          where('updatedAt', '>=', lastSyncThreshold)
        );
        const snapshot = await runWithTimeout(getDocs(q), 5000);
        
        const cloudLeadsDelta: Lead[] = [];
        snapshot.forEach(docSnap => {
          cloudLeadsDelta.push(docSnap.data() as Lead);
        });

        console.log(`[Firestore Client] Delta query returned ${cloudLeadsDelta.length} updated/new leads.`);

        // Reconstruct full cloud list by overlaying delta on lastSyncedLeads
        const reconstructedMap = new Map<string, Lead>();
        lastSyncedLeads.forEach(l => {
          if (l && l.id) reconstructedMap.set(l.id, l);
        });

        cloudLeadsDelta.forEach(c => {
          if (c && c.id) reconstructedMap.set(c.id, c);
        });

        cloudLeads = Array.from(reconstructedMap.values());
      }

      // Execute Merge and Sync!
      const mergeResult = syncAndMergeLeadsList(localLeads, cloudLeads, lastSyncedLeads);
      
      finalLeads = mergeResult.mergedLeads;

      // Handle any pending uploads to Firestore (which are local-only modifications or creations)
      if (mergeResult.pendingUpload.length > 0) {
        console.log(`[Firestore Client] Found ${mergeResult.pendingUpload.length} pending local changes/creations to upload to Firestore...`);
        const CHUNK_SIZE = 400;
        for (let i = 0; i < mergeResult.pendingUpload.length; i += CHUNK_SIZE) {
          const chunk = mergeResult.pendingUpload.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          chunk.forEach(l => {
            const docRef = doc(db, 'leads', l.id);
            batch.set(docRef, cleanForFirestore(l));
          });
          await runWithTimeout(batch.commit(), 5000);
        }
        console.log(`[Firestore Client] Uploaded ${mergeResult.pendingUpload.length} pending leads successfully.`);
      }

      // Handle any pending deletes from Firestore (deleted locally but still on cloud)
      if (mergeResult.pendingDeleteIds.length > 0) {
        console.log(`[Firestore Client] Found ${mergeResult.pendingDeleteIds.length} pending deletes to propagate to cloud...`);
        const CHUNK_SIZE = 400;
        for (let i = 0; i < mergeResult.pendingDeleteIds.length; i += CHUNK_SIZE) {
          const chunk = mergeResult.pendingDeleteIds.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          chunk.forEach(id => {
            const docRef = doc(db, 'leads', id);
            batch.delete(docRef);
          });
          await runWithTimeout(batch.commit(), 5000);
        }
        console.log(`[Firestore Client] Deleted ${mergeResult.pendingDeleteIds.length} leads from cloud successfully.`);
      }

      // Since cloud synchronization was fully successful, we update local and synced files with final merged state!
      safeWriteJsonSync(DATA_FILE, finalLeads);
      safeWriteJsonSync(DATA_FILE_SYNCED, finalLeads);

    } catch (err: any) {
      console.error('[Firestore Client] Failed to get/sync leads with cloud, using local-only state:', err);
      handleCloudError(err);
      // Fallback to local leads since cloud check failed
      finalLeads = localLeads;
    }
  } else {
    // Cloud sync disabled/offline - keep using local-only state
    finalLeads = localLeads;
  }

  // Auto-migrate "CGP-" prefix to "INQ-" and "contacted" stage to "negotiating"
  let hasChanges = false;
  finalLeads = finalLeads.map(l => {
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
    saveLeads(finalLeads).catch(err => console.error('Failed to save migrated leads:', err));
  }

  // Update in-memory cache
  dbCache.leads = { data: finalLeads, timestamp: Date.now() };

  return finalLeads;
}

// Save all leads using smart delta-saving for Firestore
async function saveLeadsInternal(leads: Lead[]): Promise<void> {
  await initializeDatabase();

  // Update in-memory cache immediately so local changes are instantly reflected on reads
  dbCache.leads = { data: leads, timestamp: Date.now() };

  // Write to local JSON file first so we ALWAYS have a local copy and stay fully functional!
  safeWriteJsonSync(DATA_FILE, leads);

  if (checkCloudStatus()) {
    try {
      // Compare local leads with our last synced file to identify what needs to be saved/deleted in Firestore
      const lastSyncedLeads: Lead[] = safeReadJsonSync<Lead[]>(DATA_FILE_SYNCED, []);

      const syncedMap = new Map<string, Lead>();
      lastSyncedLeads.forEach(l => { if (l && l.id) syncedMap.set(l.id, l); });

      const leadsToSave: Lead[] = [];
      leads.forEach(l => {
        if (!l || !l.id) return;
        const syncedL = syncedMap.get(l.id);
        if (!syncedL) {
          // This is a new lead (unsynced)
          leadsToSave.push(l);
        } else {
          // Compare updatedAt or structural JSON to find edits
          if (l.updatedAt !== syncedL.updatedAt || JSON.stringify(l) !== JSON.stringify(syncedL)) {
            leadsToSave.push(l);
          }
        }
      });

      const currentIds = new Set(leads.map(l => l.id).filter(Boolean));
      const leadsToDelete: string[] = [];
      lastSyncedLeads.forEach(syncedL => {
        if (syncedL && syncedL.id && !currentIds.has(syncedL.id)) {
          leadsToDelete.push(syncedL.id);
        }
      });

      // Safety guardrail: Prevent cascading cloud deletion if local array shrunk unexpectedly by >30%
      if (leadsToDelete.length > 50 && leads.length < lastSyncedLeads.length * 0.7) {
        console.warn(`[Firestore Client] SAFETY INTERVENTION: Detected abrupt drop in lead count (${lastSyncedLeads.length} -> ${leads.length}). Suppressing ${leadsToDelete.length} automatic cloud deletions to protect database integrity.`);
        leadsToDelete.length = 0;
      }

      if (leadsToSave.length > 0 || leadsToDelete.length > 0) {
        console.log(`[Firestore Client] Syncing saveLeads diff: ${leadsToSave.length} leads to set, ${leadsToDelete.length} leads to delete (total: ${leads.length})`);
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

      // Safety guardrail: Convert removed documents to soft-deleted on Cloud to prevent physical data loss
      if (leadsToDelete.length > 0) {
        console.log(`[Firestore Client] Converting ${leadsToDelete.length} removed leads to soft-deleted on Cloud...`);
        const CHUNK_SIZE = 400;
        for (let i = 0; i < leadsToDelete.length; i += CHUNK_SIZE) {
          const chunk = leadsToDelete.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          chunk.forEach(id => {
            const docRef = doc(db, 'leads', id);
            batch.set(docRef, { 
              isDeleted: true, 
              deletedAt: new Date().toISOString(), 
              updatedAt: new Date().toISOString() 
            }, { merge: true });
          });
          await runWithTimeout(batch.commit(), 5000);
        }
      }

      // Since all Firestore operations succeeded, we can safely update the local DATA_FILE_SYNCED cache
      safeWriteJsonSync(DATA_FILE_SYNCED, leads);

    } catch (err: any) {
      console.error('[Firestore Client] Failed to save leads delta to cloud:', err);
      handleCloudError(err);
      // We do NOT update DATA_FILE_SYNCED because the writes failed to reach the cloud.
      // This leaves them as "unsynced" in our metadata so that they will be retried and merged on the next read!
    }
  }
}

export async function getLeads(forceRefresh = false): Promise<Lead[]> {
  return dbMutex.run(() => getLeadsInternal(forceRefresh));
}

export function clearLeadsCache(): void {
  dbCache.leads = null;
  lastFullLeadsSyncTime = 0;
}

export async function saveLeads(leads: Lead[]): Promise<void> {
  return dbMutex.run(() => saveLeadsInternal(leads));
}

// Add custom lead
export async function addLead(lead: Lead): Promise<void> {
  const leads = await getLeads();
  leads.unshift(lead);
  await saveLeads(leads);
}

// Get aggregate statistics
export async function getStats(): Promise<StatSummary> {
  const rawLeads = await getLeads();
  // Filter out unassigned leads in stage 'new' (Requesting chats in WhatsApp menu)
  // as well as soft-deleted leads
  const leads = rawLeads.filter(lead => !lead.isDeleted && getEffectiveIntake(lead));
  
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
    in_discussion: 0,
    strong_opportunity: 0,
    office_visited: 0,
    won: 0,
    cold_leads: 0,
    lost: 0,
    negotiating: 0,
    proposal: 0,
    rotations: 0
  };

  leads.forEach(l => {
    let stageKey = l.stage;
    if (stageKey === 'negotiating') stageKey = 'in_discussion';
    else if (stageKey === 'proposal') stageKey = 'office_visited';
    else if (stageKey === 'rotations') stageKey = 'cold_leads';

    if (byStage[stageKey] !== undefined) {
      byStage[stageKey]++;
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
      id: 'job_malta_online_game_presenter',
      title: 'ONLINE GAME PRESENTER',
      country: 'Malta',
      salaryRange: '1000 euros upto',
      requirement: 'SMART FEMALE CANDIDATE (SALARY - 1000 EURO)',
      processingFeeMale: 'NA',
      processingFeeFemale: 'TBA',
      accommodation: 'NOT PROVIDED',
      ageLimit: '21 TO 33',
      conditions: [
        'Premedical',
        'Freshers can apply',
        'An original passport is mandatory'
      ],
      modeOfInterview: 'Face to Face',
      applicability: 'Only Female Candidates can Apply',
      otherTerms: 'Medical insurance and flight Tickets is borne by the candidates',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_malta_hospitality',
      title: 'HOSPITALITY',
      country: 'Malta',
      salaryRange: '1000 to 1400 euro',
      requirement: 'WAITER/WAITRESS/COMII/HOUSEKEEPING',
      processingFeeMale: 'TBA',
      processingFeeFemale: 'TBA',
      accommodation: 'NA',
      ageLimit: '21 TO 35',
      conditions: [
        'MALTESE SKILL TEST IS REQUIRED',
        'RELEVENT EXPERIENCE IS MANDATORY',
        'Original Passport is mandatory',
        '12 PASS IS MANDATORY'
      ],
      modeOfInterview: 'Online',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: 'MEDICAL INSURANCE AND FLIGHT TICKETS IS NOT INCLUDED IN THE SERVICE CHARGE',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_nesto_hypermarket',
      title: 'NESTO HYPERMARKET',
      country: 'Dubai',
      salaryRange: '1400 AED',
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
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_guest_relations_dubai',
      title: 'GUEST RELATIONSHIP EXECUTIVE(DUBAI)',
      country: 'Dubai',
      salaryRange: '2000 - 2700 AED',
      requirement: 'Guest Relations (2000 - 2700 AED)',
      processingFeeMale: '75k',
      processingFeeFemale: '75k',
      accommodation: 'Free Meal & Transportation + Air ticket every 2 years, Accomodation Free for 1st month',
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
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_kuwait_restaurant_crew',
      title: 'RESTAURANT & RETAIL CREW',
      country: 'Kuwait',
      salaryRange: '150 - 180 KWD',
      requirement: 'Counter Sales & Kitchen Staff',
      processingFeeMale: '85k',
      processingFeeFemale: '60k',
      accommodation: 'Free Accommodation, Duty Meals & Transport Provided',
      ageLimit: '21 TO 32',
      conditions: [
        'Pre Medical Required',
        'Good English Communication',
        'Original Passport Required',
        '10th / 12th Pass'
      ],
      modeOfInterview: 'Online',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: '2 Years renewable contract, flight tickets included.',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_kuwait_drivers',
      title: 'LOGISTICS & HEAVY DRIVER',
      country: 'Kuwait',
      salaryRange: '180 - 240 KWD',
      requirement: 'GCC License Drivers',
      processingFeeMale: '90k',
      processingFeeFemale: 'NA',
      accommodation: 'Company Accommodation Provided',
      ageLimit: '24 TO 42',
      conditions: [
        'Valid GCC License Mandatory',
        'Clean Driving Record',
        'PCC Required'
      ],
      modeOfInterview: 'Face to Face',
      applicability: 'Only Male Candidates can Apply',
      otherTerms: 'Overtime available extra as per company policy.',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_qatar_hotel_facility',
      title: 'LUXURY HOTEL & FACILITY STAFF',
      country: 'Qatar',
      salaryRange: '1600 - 2200 QAR',
      requirement: 'Front Desk & Housekeeping',
      processingFeeMale: '80k',
      processingFeeFemale: '70k',
      accommodation: 'Free Food, Accommodation & Transport',
      ageLimit: '20 TO 33',
      conditions: [
        'Hotel Management Diploma or Hospitality experience preferred',
        'Valid Passport'
      ],
      modeOfInterview: 'Online',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: 'Joining ticket provided by company.',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_singapore_warehouse',
      title: 'WAREHOUSE & LOGISTICS ASSOCIATE',
      country: 'Singapore',
      salaryRange: '1800 - 2400 SGD',
      requirement: 'Cargo Handler & Picker Packer',
      processingFeeMale: '110k',
      processingFeeFemale: '95k',
      accommodation: 'Housing allowance SGD 300 provided',
      ageLimit: '21 TO 35',
      conditions: [
        'Physical Fitness Required',
        'Basic Computer Literacy',
        '12th Pass'
      ],
      modeOfInterview: 'Online',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: 'S-Pass / Work Permit processing as per MOM Singapore.',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_albania_factory',
      title: 'FACTORY & MANUFACTURING OPERATOR',
      country: 'Albania',
      salaryRange: '450 - 600 Euros',
      requirement: 'General Factory Worker',
      processingFeeMale: '85k',
      processingFeeFemale: '85k',
      accommodation: 'Free Sharing Accommodation & Food',
      ageLimit: '20 TO 40',
      conditions: [
        'No High Qualification Required',
        'European Work Permit Route',
        'Medical Fitness mandatory'
      ],
      modeOfInterview: 'Online',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: 'Pathway to TRP card in Albania (Europe).',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_japan_ssw_caregiver',
      title: 'TITLED SKILLED WORKER (CARE WORKER / FOOD)',
      country: 'Japan',
      salaryRange: '180,000 - 230,000 JPY',
      requirement: 'Specified Skilled Worker (SSW-1)',
      processingFeeMale: '120k',
      processingFeeFemale: '120k',
      accommodation: 'Subsidized Apartment Provided',
      ageLimit: '20 TO 35',
      conditions: [
        'JLPT N4 or JFT-Basic Japanese Language Certificate',
        'Skill Pass Certificate',
        'Passport valid 2+ yrs'
      ],
      modeOfInterview: 'Online',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: '5 Years Japanese Residency & Work Visa.',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_israel_caregiver',
      title: 'CERTIFIED CAREGIVER & ASSISTANT',
      country: 'Israel',
      salaryRange: '5300 - 6500 ILS',
      requirement: 'Elderly & Home Caregiver',
      processingFeeMale: '130k',
      processingFeeFemale: '130k',
      accommodation: 'Free Lodging & Food with Host Family / Facility',
      ageLimit: '23 TO 42',
      conditions: [
        'Nurse / Caregiver Certificate',
        'Good English Communication',
        'Clean Criminal Record (PCC)'
      ],
      modeOfInterview: 'Online',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: 'High salary earning destination with long-term visa options.',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_germany_healthcare',
      title: 'HEALTHCARE & NURSING ASSISTANT',
      country: 'Germany',
      salaryRange: '2200 - 2800 Euros',
      requirement: 'Hospital & Elderly Care Staff',
      processingFeeMale: '140k',
      processingFeeFemale: '140k',
      accommodation: 'Subsidized Hostel / Flat provided',
      ageLimit: '22 TO 38',
      conditions: [
        'B1 / B2 German Language Certificate',
        'B.Sc / GNM Nursing Degree or Diploma'
      ],
      modeOfInterview: 'Online',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: 'EU Blue Card / Fast-track Work Permit in Germany.',
      isActive: true,
      createdAt: new Date().toISOString()
    },
    {
      id: 'job_dubai_security',
      title: 'SECURITY GUARD (DPS / SIRA)',
      country: 'Dubai',
      salaryRange: '2200 - 2500 AED',
      requirement: 'Certified Security Personnel',
      processingFeeMale: '90k',
      processingFeeFemale: '85k',
      accommodation: 'Company Accommodation & Transportation',
      ageLimit: '21 TO 35',
      conditions: [
        'Min Height 5ft 8in for Male',
        'Good English',
        'Clean Medical'
      ],
      modeOfInterview: 'Face to Face',
      applicability: 'Both Male & Female Candidates can Apply',
      otherTerms: 'SIRA license training provided by company upon arrival.',
      isActive: true,
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
            salaryRange: data.salaryRange || '',
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
      safeWriteJsonSync(JOBS_FILE, sortedJobs);

      return sortedJobs;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch jobs from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }
  const jobs = safeReadJsonSync<Job[]>(JOBS_FILE, []);
  const sanitized = jobs.map(j => ({
    id: j.id || `job_${Math.random().toString(36).substring(2, 7)}`,
    title: j.title || '',
    country: j.country || 'Other',
    salaryRange: j.salaryRange || '',
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
}

// Save all jobs
export async function saveJobs(jobs: Job[]): Promise<void> {
  await initializeJobsDatabase();
  const validJobs = (jobs || []).filter(j => j && typeof j === 'object' && j.id);

  // Update in-memory cache immediately so changes are instantly reflected on reads
  dbCache.jobs = { data: validJobs, timestamp: Date.now() };

  // Write to local file first so we ALWAYS have a local copy and stay fully functional!
  safeWriteJsonSync(JOBS_FILE, validJobs);

  if (checkCloudStatus()) {
    // Await cloud sync to guarantee data persistence under Cloud Run
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
      console.error('[Firestore Client] Failed to save jobs to cloud:', err);
      handleCloudError(err);
    }
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
  if (!fs.existsSync(UPDATES_FILE)) {
    safeWriteJsonSync(UPDATES_FILE, defaultUpdates);
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
      safeWriteJsonSync(UPDATES_FILE, sortedUpdates);

      return sortedUpdates;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch updates from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }
  const updates = safeReadJsonSync<ImportantUpdate[]>(UPDATES_FILE, []);
  const sortedSanitized = updates.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  // Cache the fallback local values too
  dbCache.updates = { data: sortedSanitized, timestamp: Date.now() };

  return sortedSanitized;
}

// Save all updates
export async function saveUpdates(updates: ImportantUpdate[]): Promise<void> {
  await initializeUpdatesDatabase();
  const validUpdates = (updates || []).filter(u => u && typeof u === 'object' && u.id);

  // Update in-memory cache immediately so changes are instantly reflected on reads
  dbCache.updates = { data: validUpdates, timestamp: Date.now() };

  safeWriteJsonSync(UPDATES_FILE, validUpdates);

  if (checkCloudStatus()) {
    // Await cloud sync to guarantee data persistence under Cloud Run
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
      console.error('[Firestore Client] Failed to save updates to cloud:', err);
      handleCloudError(err);
    }
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

  if (!fs.existsSync(METADATA_FILE)) {
    safeWriteJsonSync(METADATA_FILE, defaultMetadata);
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

  const fallbackMetadata: CgpMetadata = {
    countries: ['Kuwait', 'Dubai', 'Qatar', 'Germany', 'Japan', 'Albania'],
    positions: ['Waiter', 'Waitress', 'Chef', 'Nurse', 'Cleaner', 'Driver', 'Electrician'],
    projects: ['Napkin affairs', 'Alltoobi', 'Lulu hypermarket', 'General Intake'],
    tagsList: [
      'Chef', 'Nurse', 'Waiter', 'Waitress', 'Driver', 'Accountant', 
      'Manager', 'Sales', 'Developer', 'Electrician', 'Plumber', 
      'Receptionist', 'Housekeeper', 'Security', 'Painter', 'Mechanic', 'Operator'
    ]
  };

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
        safeWriteJsonSync(METADATA_FILE, metadata);

        return metadata;
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch metadata from cloud, falling back to local file:', err);
      handleCloudError(err);
    }
  }
  const metadata = safeReadJsonSync<CgpMetadata>(METADATA_FILE, fallbackMetadata);
  dbCache.metadata = { data: metadata, timestamp: Date.now() };
  return metadata;
}

export async function saveMetadata(metadata: CgpMetadata): Promise<void> {
  await initializeMetadataDatabase();

  // Update in-memory cache immediately so changes are instantly reflected on reads
  dbCache.metadata = { data: metadata, timestamp: Date.now() };

  safeWriteJsonSync(METADATA_FILE, metadata);

  if (checkCloudStatus()) {
    // Await cloud sync to guarantee data persistence under Cloud Run
    try {
      await runWithTimeout(setDoc(doc(db, 'metadata', 'options'), cleanForFirestore(metadata)), 2000);
    } catch (err: any) {
      console.error('[Firestore Client] Failed to save metadata to cloud:', err);
      handleCloudError(err);
    }
  }
}

// --- WALLET DATABASE FUNCTIONS ---

export async function initializeWalletsDatabase() {
  if (!fs.existsSync(WALLETS_FILE)) {
    safeWriteJsonSync(WALLETS_FILE, []);
  }

  if (checkCloudStatus()) {
    try {
      const q = query(collection(db, 'wallets'), limit(1));
      const snapshot = await runWithTimeout(getDocs(q), 2000);
      if (snapshot.empty) {
        console.log('[Firestore Client] Seeding default wallets from coordinators...');
        const coords = await getCoordinators();
        const batch = writeBatch(db);
        const defaultWallets: Wallet[] = coords.map(c => ({
          id: c.username.toLowerCase(),
          username: c.username.toLowerCase(),
          displayName: c.displayName,
          balance: 0,
          transactions: [],
          updatedAt: new Date().toISOString()
        }));
        defaultWallets.forEach(w => {
          const docRef = doc(db, 'wallets', w.id);
          batch.set(docRef, cleanForFirestore(w));
        });
        await runWithTimeout(batch.commit(), 2000);
        console.log('[Firestore Client] Seeded wallets successfully.');
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to check/seed wallets:', err);
      handleCloudError(err);
    }
  }
}

export async function getWallets(): Promise<Wallet[]> {
  await initializeWalletsDatabase();

  if (dbCache.wallets && (Date.now() - dbCache.wallets.timestamp < CACHE_TTL_MS)) {
    return dbCache.wallets.data;
  }

  if (checkCloudStatus()) {
    try {
      const snapshot = await runWithTimeout(getDocs(collection(db, 'wallets')), 2000);
      const wallets: Wallet[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        wallets.push({
          id: docSnap.id,
          username: data.username || docSnap.id,
          displayName: data.displayName || data.username || docSnap.id,
          balance: Number(data.balance) || 0,
          transactions: Array.isArray(data.transactions) ? data.transactions : [],
          updatedAt: data.updatedAt || new Date().toISOString()
        });
      });

      // Update cache
      dbCache.wallets = { data: wallets, timestamp: Date.now() };

      safeWriteJsonSync(WALLETS_FILE, wallets);

      return wallets;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch wallets from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }

  const wallets = safeReadJsonSync<Wallet[]>(WALLETS_FILE, []);
  dbCache.wallets = { data: wallets, timestamp: Date.now() };
  return wallets;
}

export async function saveWallets(wallets: Wallet[]): Promise<void> {
  await initializeWalletsDatabase();

  dbCache.wallets = { data: wallets, timestamp: Date.now() };

  safeWriteJsonSync(WALLETS_FILE, wallets);

  if (checkCloudStatus()) {
    try {
      const batch = writeBatch(db);
      wallets.forEach(w => {
        const docRef = doc(db, 'wallets', w.id);
        batch.set(docRef, cleanForFirestore(w));
      });
      await runWithTimeout(batch.commit(), 2000);
    } catch (err: any) {
      console.error('[Firestore Client] Failed to save wallets to cloud:', err);
      handleCloudError(err);
    }
  }
}

export async function getWalletByUsername(username: string): Promise<Wallet> {
  const wallets = await getWallets();
  const cleanUser = String(username).trim().toLowerCase();
  let wallet = wallets.find(w => w.username.toLowerCase() === cleanUser);
  
  if (!wallet) {
    // Lazy initialize a new wallet for this coordinator
    const coords = await getCoordinators();
    const coord = coords.find(c => c.username.toLowerCase() === cleanUser);
    
    wallet = {
      id: cleanUser,
      username: cleanUser,
      displayName: coord ? coord.displayName : username,
      balance: 0,
      transactions: [],
      updatedAt: new Date().toISOString()
    };
    wallets.push(wallet);
    await saveWallets(wallets);
  }
  
  return wallet;
}

export async function addWalletTransaction(
  username: string, 
  type: 'credit' | 'debit', 
  amount: number, 
  reason: string, 
  leadId?: string
): Promise<Wallet> {
  const wallet = await getWalletByUsername(username);
  
  const transaction: WalletTransaction = {
    id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type,
    amount: Number(amount),
    reason,
    leadId,
    timestamp: new Date().toISOString()
  };

  if (!wallet.transactions) wallet.transactions = [];
  wallet.transactions.unshift(transaction); // Add to beginning for newest first
  
  if (type === 'credit') {
    wallet.balance += Number(amount);
  } else {
    wallet.balance = Math.max(0, wallet.balance - Number(amount));
  }
  
  wallet.updatedAt = new Date().toISOString();
  
  // Save to database
  const wallets = await getWallets();
  const idx = wallets.findIndex(w => w.id === wallet.id);
  if (idx !== -1) {
    wallets[idx] = wallet;
  } else {
    wallets.push(wallet);
  }
  await saveWallets(wallets);
  
  return wallet;
}

// Ensure incentive rules database exists with default seed rules
export async function initializeIncentiveRulesDatabase() {
  const defaultRules: IncentiveRule[] = [
    {
      id: 'rule_japan_all',
      projectName: 'any',
      country: 'Japan',
      amount: 1000,
      createdAt: new Date().toISOString()
    },
    {
      id: 'rule_kuwait_napkin',
      projectName: 'Napkin affairs',
      country: 'Kuwait',
      amount: 400,
      createdAt: new Date().toISOString()
    },
    {
      id: 'rule_kuwait_all',
      projectName: 'any',
      country: 'Kuwait',
      amount: 400,
      createdAt: new Date().toISOString()
    },
    {
      id: 'rule_all_fallback',
      projectName: 'any',
      country: 'All',
      amount: 400,
      createdAt: new Date().toISOString()
    }
  ];

  if (!fs.existsSync(INCENTIVE_RULES_FILE)) {
    safeWriteJsonSync(INCENTIVE_RULES_FILE, defaultRules);
  }

  if (checkCloudStatus()) {
    try {
      const statusRef = doc(db, 'metadata', 'incentive_rules_status');
      const statusSnap = await runWithTimeout(getDoc(statusRef), 2000);
      if (!statusSnap.exists()) {
        console.log('[Firestore Client] Seeding default incentive rules to cloud...');
        const batch = writeBatch(db);
        defaultRules.forEach(rule => {
          const docRef = doc(db, 'incentive_rules', rule.id);
          batch.set(docRef, cleanForFirestore(rule));
        });
        batch.set(statusRef, { seeded: true, updatedAt: new Date().toISOString() });
        await runWithTimeout(batch.commit(), 2000);
        console.log('[Firestore Client] Seeded incentive rules successfully.');
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to check/seed incentive rules, falling back to local file:', err);
      handleCloudError(err);
    }
  }
}

async function getIncentiveRulesInternal(): Promise<IncentiveRule[]> {
  await initializeIncentiveRulesDatabase();

  if (dbCache.incentive_rules && (Date.now() - dbCache.incentive_rules.timestamp < CACHE_TTL_MS)) {
    return dbCache.incentive_rules.data;
  }

  if (checkCloudStatus()) {
    try {
      const snapshot = await runWithTimeout(getDocs(collection(db, 'incentive_rules')), 2000);
      const rules: IncentiveRule[] = [];
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data) {
          rules.push({
            id: docSnap.id,
            projectName: data.projectName || '',
            country: data.country || '',
            amount: Number(data.amount) || 0,
            createdAt: data.createdAt || new Date().toISOString()
          } as IncentiveRule);
        }
      });

      dbCache.incentive_rules = { data: rules, timestamp: Date.now() };

      safeWriteJsonSync(INCENTIVE_RULES_FILE, rules);

      return rules;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch incentive rules from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }

  const rules = safeReadJsonSync<IncentiveRule[]>(INCENTIVE_RULES_FILE, []);
  dbCache.incentive_rules = { data: rules, timestamp: Date.now() };
  return rules;
}

async function saveIncentiveRulesInternal(rules: IncentiveRule[]): Promise<void> {
  await initializeIncentiveRulesDatabase();
  const validRules = (rules || []).filter(r => r && typeof r === 'object' && r.id);

  dbCache.incentive_rules = { data: validRules, timestamp: Date.now() };

  safeWriteJsonSync(INCENTIVE_RULES_FILE, validRules);

  if (checkCloudStatus()) {
    try {
      const batch = writeBatch(db);
      validRules.forEach(r => {
        const docRef = doc(db, 'incentive_rules', r.id);
        batch.set(docRef, cleanForFirestore(r));
      });
      await runWithTimeout(batch.commit(), 2000);

      const snapshot = await runWithTimeout(getDocs(collection(db, 'incentive_rules')), 2000);
      const deleteBatch = writeBatch(db);
      let hasDeletes = false;
      snapshot.forEach(docSnap => {
        if (!validRules.some(r => r.id === docSnap.id)) {
          deleteBatch.delete(docSnap.ref);
          hasDeletes = true;
        }
      });
      if (hasDeletes) {
        await runWithTimeout(deleteBatch.commit(), 2000);
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to save incentive rules to cloud:', err);
      handleCloudError(err);
    }
  }
}

export async function getIncentiveRules(): Promise<IncentiveRule[]> {
  return dbMutex.run(() => getIncentiveRulesInternal());
}

export async function saveIncentiveRules(rules: IncentiveRule[]): Promise<void> {
  return dbMutex.run(() => saveIncentiveRulesInternal(rules));
}

// ==========================================
// AUTOMATIC FULL DATABASE & XLSX BACKUP SYSTEM
// ==========================================

export interface FullDatabaseBackup {
  version: number;
  timestamp: string;
  source: string;
  data: {
    leads: Lead[];
    coordinators: Coordinator[];
    jobs: Job[];
    updates: ImportantUpdate[];
    wallets: Wallet[];
    incentiveRules: IncentiveRule[];
    metadata: any;
  };
  summary: {
    totalLeads: number;
    totalCoordinators: number;
    totalJobs: number;
    totalWallets: number;
    totalIncentiveRules: number;
  };
}

export interface BackupFileInfo {
  fileName: string;
  filePath: string;
  type: 'db_json' | 'xlsx';
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  timestamp: number;
  isMondayScheduled?: boolean;
}

const SCHEDULED_BACKUP_DIR = path.join(DATA_DIR, 'backups', 'scheduled');
if (!fs.existsSync(SCHEDULED_BACKUP_DIR)) {
  try {
    fs.mkdirSync(SCHEDULED_BACKUP_DIR, { recursive: true });
  } catch {}
}

/**
 * Creates a 100% complete, restorable JSON Database Backup object.
 */
export async function createFullDatabaseBackup(sourceDescription: string = 'Manual'): Promise<FullDatabaseBackup> {
  const leads = await getLeads();
  const coordinators = await getCoordinators();
  const jobs = await getJobs();
  const updates = await getUpdates();
  const wallets = await getWallets();
  const incentiveRules = await getIncentiveRules();
  const metadata = await getMetadata();

  const backup: FullDatabaseBackup = {
    version: 1,
    timestamp: new Date().toISOString(),
    source: sourceDescription,
    data: {
      leads,
      coordinators,
      jobs,
      updates,
      wallets,
      incentiveRules,
      metadata
    },
    summary: {
      totalLeads: leads.length,
      totalCoordinators: coordinators.length,
      totalJobs: jobs.length,
      totalWallets: wallets.length,
      totalIncentiveRules: incentiveRules.length
    }
  };

  return backup;
}

/**
 * Generates the full master Excel workbook buffer for all database collections.
 */
export async function generateFullXLSXBuffer(): Promise<Buffer> {
  const rawLeads = await getLeads();
  // Filter out unassigned leads in stage 'new' (Requesting chats in WhatsApp menu)
  const leads = rawLeads.filter(lead => !lead.isDeleted && getEffectiveIntake(lead));
  const deletedLeads = rawLeads.filter(lead => lead.isDeleted === true);
  const coordinators = await getCoordinators();
  const jobs = await getJobs();
  const updates = await getUpdates();
  const wallets = await getWallets();
  const incentiveRules = await getIncentiveRules();

  const workbook = XLSX.utils.book_new();

  // 1. Sheet: "Candidates Master"
  const masterCandidatesData = leads.map((lead, idx) => ({
    'Serial': lead.serialNo || `INQ-${1000 + idx + 1}`,
    'Lead ID': lead.id,
    'Applicant Name': lead.name || '',
    'Phone': lead.phone || '',
    'Alternate Phone': lead.alternateNo || '',
    'Gender': lead.gender || 'M',
    'Age': lead.age || '',
    'Origin / City': lead.origin || '',
    'Country Interest': lead.country || '',
    'Job Position': lead.position || '',
    'Experience': lead.experience || '',
    'Qualification': lead.qualification || '',
    'Pipeline Stage': lead.stage,
    'Stage Key': lead.stage,
    'Fit Score': (lead.fitScore || 'unqualified').toUpperCase(),
    'Assigned Coordinator': lead.assignedTo || 'Unassigned',
    'Admin Remarks': lead.adminRemarks || '',
    'Remarks 1 (First Call)': lead.remarks1 || '',
    'Remarks 2 (Follow-up)': lead.remarks2 || '',
    'Remarks 3 (Final Status)': lead.remarks3 || '',
    'Call Connected Status': lead.callConnected || '',
    'Office Visited': lead.docOfficeVisited ? 'YES' : 'NO',
    'Passport Copy': lead.docPassportCopy ? 'YES' : 'NO',
    'Resume Received': lead.docResume ? 'YES' : 'NO',
    'Other Docs': lead.docOthers ? 'YES' : 'NO',
    'Importance Rating': lead.importance || 3,
    'Project': lead.project || '',
    'Source / Campaign': lead.source || lead.campaign || '',
    'Tags': Array.isArray(lead.tags) ? lead.tags.join(', ') : '',
    'Next Action': lead.nextAction || '',
    'Commission / Budget': lead.budget || 0,
    'Entry Date': lead.entryDate || (lead.createdAt ? lead.createdAt.split('T')[0] : ''),
    'Assign Date': lead.assignDate || '',
    'Created At': lead.createdAt || '',
    'Updated At': lead.updatedAt || ''
  }));
  const sheetCandidates = XLSX.utils.json_to_sheet(masterCandidatesData);
  XLSX.utils.book_append_sheet(workbook, sheetCandidates, "Candidates Master");

  // 2. Sheet: "WhatsApp Messages"
  const messagesData: any[] = [];
  leads.forEach(lead => {
    if (Array.isArray(lead.messages) && lead.messages.length > 0) {
      lead.messages.forEach(msg => {
        messagesData.push({
          'Candidate Serial': lead.serialNo || '',
          'Candidate Name': lead.name || '',
          'Candidate Phone': lead.phone || '',
          'Assigned Coordinator': lead.assignedTo || '',
          'Sender': msg.sender || '',
          'Message Text': msg.text || '',
          'Timestamp': msg.timestamp || ''
        });
      });
    }
  });
  if (messagesData.length > 0) {
    const sheetMessages = XLSX.utils.json_to_sheet(messagesData);
    XLSX.utils.book_append_sheet(workbook, sheetMessages, "WhatsApp Messages");
  }

  // 3. Sheet: "Scheduled Tasks"
  const tasksData: any[] = [];
  leads.forEach(lead => {
    if (Array.isArray(lead.tasks) && lead.tasks.length > 0) {
      lead.tasks.forEach(t => {
        tasksData.push({
          'Candidate Serial': lead.serialNo || '',
          'Candidate Name': lead.name || '',
          'Candidate Phone': lead.phone || '',
          'Assigned Coordinator': lead.assignedTo || '',
          'Task Title': t.title || '',
          'Due Date': t.dueDate || '',
          'Status': t.completed ? 'COMPLETED' : 'PENDING',
          'Created At': t.createdAt || ''
        });
      });
    }
  });
  if (tasksData.length > 0) {
    const sheetTasks = XLSX.utils.json_to_sheet(tasksData);
    XLSX.utils.book_append_sheet(workbook, sheetTasks, "Scheduled Tasks");
  }

  // 4. Sheet: "Activity Logs"
  const timelineData: any[] = [];
  leads.forEach(lead => {
    if (Array.isArray(lead.timeline) && lead.timeline.length > 0) {
      lead.timeline.forEach(tl => {
        timelineData.push({
          'Candidate Serial': lead.serialNo || '',
          'Candidate Name': lead.name || '',
          'Candidate Phone': lead.phone || '',
          'Event Type': tl.type || '',
          'Actor': tl.actor || '',
          'Activity Detail': tl.text || '',
          'Timestamp': tl.timestamp || ''
        });
      });
    }
  });
  if (timelineData.length > 0) {
    const sheetTimeline = XLSX.utils.json_to_sheet(timelineData);
    XLSX.utils.book_append_sheet(workbook, sheetTimeline, "Activity Logs");
  }

  // 5. Sheet: "Staff Coordinators"
  const coordsData = coordinators.map(c => ({
    'ID': c.id,
    'Username': c.username,
    'Display Name': c.displayName,
    'Role': c.role,
    'Created At': c.createdAt || ''
  }));
  const sheetCoords = XLSX.utils.json_to_sheet(coordsData);
  XLSX.utils.book_append_sheet(workbook, sheetCoords, "Staff Coordinators");

  // 6. Sheet: "Job Openings"
  const jobsData = jobs.map(j => ({
    'Job ID': j.id,
    'Title': j.title,
    'Country': j.country,
    'Salary Range': j.salaryRange || '',
    'Requirements': j.requirement || '',
    'Age Limit': j.ageLimit || '',
    'Accommodation': j.accommodation || '',
    'Interview Mode': j.modeOfInterview || '',
    'Processing Fee (M)': j.processingFeeMale || '',
    'Processing Fee (F)': j.processingFeeFemale || '',
    'Active Status': j.isActive !== false ? 'ACTIVE' : 'INACTIVE',
    'Created At': j.createdAt || ''
  }));
  const sheetJobs = XLSX.utils.json_to_sheet(jobsData);
  XLSX.utils.book_append_sheet(workbook, sheetJobs, "Job Openings");

  // 7. Sheet: "Wallets & Balances"
  const walletsData = wallets.map(w => {
    const credits = (w.transactions || []).filter(t => t.type === 'credit').reduce((acc, t) => acc + (t.amount || 0), 0);
    const debits = (w.transactions || []).filter(t => t.type === 'debit').reduce((acc, t) => acc + (t.amount || 0), 0);
    return {
      'Username': w.username,
      'Display Name': w.displayName,
      'Current Balance (INR)': w.balance || 0,
      'Total Credits (INR)': credits,
      'Total Debits (INR)': debits,
      'Transaction Count': (w.transactions || []).length,
      'Updated At': w.updatedAt || ''
    };
  });
  const sheetWallets = XLSX.utils.json_to_sheet(walletsData);
  XLSX.utils.book_append_sheet(workbook, sheetWallets, "Coordinators Wallets");

  // 8. Sheet: "Incentive Rules"
  const rulesData = incentiveRules.map(r => ({
    'Rule ID': r.id,
    'Project Name': r.projectName || 'All',
    'Country': r.country || 'All',
    'Incentive Amount (INR)': r.amount || 0,
    'Created At': r.createdAt || ''
  }));
  if (rulesData.length > 0) {
    const sheetRules = XLSX.utils.json_to_sheet(rulesData);
    XLSX.utils.book_append_sheet(workbook, sheetRules, "Incentive Rules");
  }

  // 9. Sheet: "Archived & Deleted"
  const archivedData = deletedLeads.map((lead, idx) => ({
    'Serial': lead.serialNo || '',
    'Lead ID': lead.id,
    'Applicant Name': lead.name || '',
    'Phone': lead.phone || '',
    'Gender': lead.gender || 'M',
    'Origin / City': lead.origin || '',
    'Country Interest': lead.country || '',
    'Job Position': lead.position || '',
    'Pipeline Stage': lead.stage,
    'Assigned Coordinator': lead.assignedTo || 'Unassigned',
    'Deleted At': lead.deletedAt || '',
    'Admin Remarks': lead.adminRemarks || '',
    'Remarks 1 (First Call)': lead.remarks1 || '',
    'Remarks 2 (Follow-up)': lead.remarks2 || '',
    'Remarks 3 (Final Status)': lead.remarks3 || ''
  }));
  if (archivedData.length > 0) {
    const sheetArchived = XLSX.utils.json_to_sheet(archivedData);
    XLSX.utils.book_append_sheet(workbook, sheetArchived, "Archived & Deleted");
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Executes a full automatic backup of both the Database JSON (restorable) and the Master XLSX workbook to disk.
 */
export async function executeScheduledFullBackup(isMondayRun: boolean = false): Promise<{ dbPath: string; xlsxPath: string; summary: any }> {
  const now = new Date();
  const dateStamp = now.toISOString().split('T')[0];
  const timeStamp = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  const prefix = isMondayRun ? 'MONDAY_AUTO_BACKUP' : 'AUTO_BACKUP';

  // 1. Generate full restorable DB backup
  const fullDbBackup = await createFullDatabaseBackup(isMondayRun ? 'Automatic Monday Scheduled Full Backup' : 'Automatic Backup');
  const dbFileName = `${prefix}_DB_${dateStamp}_${timeStamp}.json`;
  const dbFilePath = path.join(SCHEDULED_BACKUP_DIR, dbFileName);
  safeWriteJsonSync(dbFilePath, fullDbBackup);

  // Also maintain a 'latest_master_backup.json' for instant 1-click fallback
  const latestDbPath = path.join(SCHEDULED_BACKUP_DIR, 'latest_master_backup.json');
  safeWriteJsonSync(latestDbPath, fullDbBackup);

  // 2. Generate Master XLSX workbook
  const xlsxBuffer = await generateFullXLSXBuffer();
  const xlsxFileName = `${prefix}_SPREADSHEET_${dateStamp}_${timeStamp}.xlsx`;
  const xlsxFilePath = path.join(SCHEDULED_BACKUP_DIR, xlsxFileName);
  fs.writeFileSync(xlsxFilePath, xlsxBuffer);

  // Also maintain a 'latest_master_backup.xlsx'
  const latestXlsxPath = path.join(SCHEDULED_BACKUP_DIR, 'latest_master_backup.xlsx');
  fs.writeFileSync(latestXlsxPath, xlsxBuffer);

  console.log(`[AutoBackup] Completed ${prefix}: Created DB backup (${fullDbBackup.summary.totalLeads} leads) and Master XLSX backup.`);

  return {
    dbPath: dbFilePath,
    xlsxPath: xlsxFilePath,
    summary: fullDbBackup.summary
  };
}

/**
 * Restores the entire database from a FullDatabaseBackup object smoothly into both Local Disk and Cloud Firestore.
 */
export async function restoreDatabaseFromBackup(backupData: FullDatabaseBackup): Promise<{ success: boolean; restoredCounts: any; message: string }> {
  if (!backupData || !backupData.data || !Array.isArray(backupData.data.leads)) {
    throw new Error('Invalid backup file format: Missing candidates dataset.');
  }

  const { leads, coordinators, jobs, updates, wallets, incentiveRules, metadata } = backupData.data;

  // 1. Save all datasets through their respective transactional internal methods
  if (Array.isArray(leads) && leads.length > 0) {
    await saveLeads(leads);
  }
  if (Array.isArray(coordinators) && coordinators.length > 0) {
    await saveCoordinators(coordinators);
  }
  if (Array.isArray(jobs) && jobs.length > 0) {
    await saveJobs(jobs);
  }
  if (Array.isArray(updates) && updates.length > 0) {
    await saveUpdates(updates);
  }
  if (Array.isArray(wallets) && wallets.length > 0) {
    await saveWallets(wallets);
  }
  if (Array.isArray(incentiveRules) && incentiveRules.length > 0) {
    await saveIncentiveRules(incentiveRules);
  }
  if (metadata && typeof metadata === 'object') {
    await saveMetadata(metadata);
  }

  console.log(`[RestoreSystem] Successfully restored full database from backup dated ${backupData.timestamp}: ${leads.length} candidates restored.`);

  return {
    success: true,
    restoredCounts: {
      leads: leads?.length || 0,
      coordinators: coordinators?.length || 0,
      jobs: jobs?.length || 0,
      wallets: wallets?.length || 0,
      incentiveRules: incentiveRules?.length || 0
    },
    message: `Database successfully restored ${leads?.length || 0} candidates and all system tables.`
  };
}

/**
 * Lists all existing scheduled and manual backups on disk.
 */
export function listAvailableBackups(): BackupFileInfo[] {
  const backups: BackupFileInfo[] = [];
  if (!fs.existsSync(SCHEDULED_BACKUP_DIR)) return backups;

  const files = fs.readdirSync(SCHEDULED_BACKUP_DIR);
  for (const file of files) {
    if (file.endsWith('.json') || file.endsWith('.xlsx')) {
      const fullPath = path.join(SCHEDULED_BACKUP_DIR, file);
      try {
        const stats = fs.statSync(fullPath);
        const isJson = file.endsWith('.json');
        const sizeKb = (stats.size / 1024).toFixed(1);
        const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
        const sizeFormatted = stats.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;

        backups.push({
          fileName: file,
          filePath: fullPath,
          type: isJson ? 'db_json' : 'xlsx',
          sizeBytes: stats.size,
          sizeFormatted,
          createdAt: new Date(stats.mtime).toISOString(),
          timestamp: stats.mtimeMs,
          isMondayScheduled: file.includes('MONDAY')
        });
      } catch {}
    }
  }

  return backups.sort((a, b) => b.timestamp - a.timestamp);
}

// Retrieve custom + default WhatsApp templates
export async function getWhatsAppTemplates(): Promise<WhatsAppTemplate[]> {
  await initializeDatabase();

  if (dbCache.templates && (Date.now() - dbCache.templates.timestamp < CACHE_TTL_MS)) {
    return dbCache.templates.data;
  }

  let customTemplates: WhatsAppTemplate[] = [];
  let isNewSetup = false;

  // If local file does not exist, consider it a new setup
  if (!fs.existsSync(TEMPLATES_FILE)) {
    isNewSetup = true;
  }

  if (checkCloudStatus()) {
    try {
      const snapshot = await runWithTimeout(getDocs(collection(db, 'whatsapp_templates')), 8000);
      snapshot.forEach(docSnap => {
        customTemplates.push(docSnap.data() as WhatsAppTemplate);
      });
      
      // If Firestore collection is empty and it's a new setup, seed
      if (snapshot.empty && isNewSetup) {
        console.log('[Templates] Firestore and local templates are empty. Seeding default templates...');
        customTemplates = DEFAULT_WHATSAPP_TEMPLATES.map(t => ({
          ...t,
          type: t.type || 'template'
        }));
        
        // Write local copy
        safeWriteJsonSync(TEMPLATES_FILE, customTemplates);
        
        // Write to Firestore
        for (const t of customTemplates) {
          try {
            await setDoc(doc(db, 'whatsapp_templates', t.id), t);
          } catch (e) {
            console.error('Failed to seed default template to cloud:', t.id, e);
          }
        }
      } else {
        // Update local file with latest from cloud
        safeWriteJsonSync(TEMPLATES_FILE, customTemplates);
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch custom templates from cloud, falling back to local files:', err);
      customTemplates = safeReadJsonSync<WhatsAppTemplate[]>(TEMPLATES_FILE, []);
    }
  } else {
    if (isNewSetup) {
      console.log('[Templates] Local templates are empty. Seeding default templates locally...');
      customTemplates = DEFAULT_WHATSAPP_TEMPLATES.map(t => ({
        ...t,
        type: t.type || 'template'
      }));
      safeWriteJsonSync(TEMPLATES_FILE, customTemplates);
    } else {
      customTemplates = safeReadJsonSync<WhatsAppTemplate[]>(TEMPLATES_FILE, []);
    }
  }

  const finalTemplates = customTemplates;
  console.log(`[Templates] Loaded count: ${finalTemplates.length}`);
  dbCache.templates = { data: finalTemplates, timestamp: Date.now() };
  return finalTemplates;
}

// Persist a custom WhatsApp template
export async function saveWhatsAppTemplate(template: WhatsAppTemplate): Promise<void> {
  await initializeDatabase();
  console.log(`[Templates] Saving template: ${template.id}, type: ${template.type}`);

  // Read current custom templates
  const customTemplates = safeReadJsonSync<WhatsAppTemplate[]>(TEMPLATES_FILE, []);
  const idx = customTemplates.findIndex(t => t.id === template.id);
  if (idx !== -1) {
    customTemplates[idx] = template;
  } else {
    customTemplates.push(template);
  }

  // Write local copy immediately
  safeWriteJsonSync(TEMPLATES_FILE, customTemplates);

  // Clear templates cache
  dbCache.templates = null;

  if (checkCloudStatus()) {
    try {
      const docRef = doc(db, 'whatsapp_templates', template.id);
      await runWithTimeout(setDoc(docRef, cleanForFirestore(template)), 8000);
      console.log(`[Firestore Client] Saved WhatsApp template to cloud: ${template.title}`);
    } catch (err: any) {
      console.error('[Firestore Client] Failed to sync WhatsApp template to cloud:', err);
      handleCloudError('Save WhatsApp Template', err);
    }
  }
}

// Delete a custom WhatsApp template
export async function deleteWhatsAppTemplate(templateId: string): Promise<void> {
  await initializeDatabase();

  // Read current custom templates
  let customTemplates = safeReadJsonSync<WhatsAppTemplate[]>(TEMPLATES_FILE, []);
  
  // Update local copy
  customTemplates = customTemplates.filter(t => t.id !== templateId);
  safeWriteJsonSync(TEMPLATES_FILE, customTemplates);

  // Clear templates cache
  dbCache.templates = null;

  if (checkCloudStatus()) {
    try {
      console.log(`[Firestore Client] Attempting to delete template from cloud: ${templateId}`);
      const docRef = doc(db, 'whatsapp_templates', templateId);
      await runWithTimeout(deleteDoc(docRef), 8000);
      console.log(`[Firestore Client] Deleted WhatsApp template from cloud: ${templateId}`);
    } catch (err: any) {
      console.error('[Firestore Client] Failed to delete WhatsApp template from cloud:', err);
      // If cloud deletion fails, we should NOT rely on the cloud version anymore for this specific template.
      // But we can't easily prevent getDocs from returning it.
      // For now, we will log and continue. The local file is already filtered.
      handleCloudError('Delete WhatsApp Template', err);
      // Force a re-fetch to be safe
      dbCache.templates = null;
    }
  }
  // Force cache clear again after cloud operations
  dbCache.templates = null;
}

const DEFAULT_AUTO_REPLY_SETTINGS: WhatsAppAutoReplySettings = {
  enabled: false,
  text: "Hello! Thank you for contacting Career Growth Placement. We have received your query and one of our job coordinators will review your application and get back to you shortly. Have a great day! ✨",
  delay: 5 // Default delay of 5 seconds
};

export async function getWhatsAppAutoReplySettings(): Promise<WhatsAppAutoReplySettings> {
  await initializeDatabase();

  if (dbCache.auto_reply && (Date.now() - dbCache.auto_reply.timestamp < CACHE_TTL_MS)) {
    return dbCache.auto_reply.data;
  }

  let settings: WhatsAppAutoReplySettings = { ...DEFAULT_AUTO_REPLY_SETTINGS };

  if (checkCloudStatus()) {
    try {
      const docRef = doc(db, 'settings', 'whatsapp_autoreply');
      const docSnap = await runWithTimeout(getDoc(docRef), 8000);
      if (docSnap.exists()) {
        settings = docSnap.data() as WhatsAppAutoReplySettings;
      } else {
        // Seed default settings to Cloud
        await runWithTimeout(setDoc(docRef, cleanForFirestore(settings)), 8000);
        safeWriteJsonSync(AUTOREPLY_FILE, settings);
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch auto-reply settings, falling back to local files:', err);
      settings = safeReadJsonSync<WhatsAppAutoReplySettings>(AUTOREPLY_FILE, DEFAULT_AUTO_REPLY_SETTINGS);
    }
  } else {
    settings = safeReadJsonSync<WhatsAppAutoReplySettings>(AUTOREPLY_FILE, DEFAULT_AUTO_REPLY_SETTINGS);
  }

  dbCache.auto_reply = { data: settings, timestamp: Date.now() };
  return settings;
}

export async function saveWhatsAppAutoReplySettings(settings: WhatsAppAutoReplySettings): Promise<void> {
  await initializeDatabase();
  console.log(`[AutoReply] Saving auto-reply settings. Enabled: ${settings.enabled}, Delay: ${settings.delay}s`);

  // Write local copy
  safeWriteJsonSync(AUTOREPLY_FILE, settings);

  // Clear cache
  dbCache.auto_reply = null;

  if (checkCloudStatus()) {
    try {
      const docRef = doc(db, 'settings', 'whatsapp_autoreply');
      await runWithTimeout(setDoc(docRef, cleanForFirestore(settings)), 8000);
      console.log(`[Firestore Client] Saved WhatsApp auto-reply settings to cloud.`);
    } catch (err: any) {
      console.error('[Firestore Client] Failed to sync auto-reply settings to cloud:', err);
      handleCloudError('Save WhatsApp Auto Reply', err);
    }
  }
}



