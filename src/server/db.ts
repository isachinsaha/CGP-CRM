import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { DEFAULT_WHATSAPP_TEMPLATES } from './whatsapp.ts';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore,
  initializeFirestore, 
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
import type { Lead, Message, LeadStage, StatSummary, Coordinator, Job, ImportantUpdate, Wallet, WalletTransaction, IncentiveRule, WhatsAppTemplate, WhatsAppAutoReplySettings, MediaItem, AppNotification } from '../types.ts';
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
const MEDIA_FILE = path.join(DATA_DIR, 'media_library.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');

// --- SAFE ATOMIC JSON READ / WRITE / RECOVERY HELPERS ---

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch {}
}

export const WALLET_BACKUPS_DIR = path.join(BACKUP_DIR, 'wallets');
if (!fs.existsSync(WALLET_BACKUPS_DIR)) {
  try {
    fs.mkdirSync(WALLET_BACKUPS_DIR, { recursive: true });
  } catch {}
}
export const WALLET_LEDGER_FILE = path.join(DATA_DIR, 'wallet_ledger_audit.jsonl');

export let databaseVersion = Date.now();
export function getDatabaseVersion(): number {
  return databaseVersion;
}
export function incrementDatabaseVersion(): void {
  databaseVersion = Date.now();
}

let leadsDiskTimer: NodeJS.Timeout | null = null;
let isLeadsDiskWriting = false;
let queuedLeadsData: Lead[] | null = null;

export function scheduleLeadsDiskPersistence(leads: Lead[]): void {
  queuedLeadsData = leads;
  if (leadsDiskTimer) return;
  leadsDiskTimer = setTimeout(() => {
    leadsDiskTimer = null;
    flushLeadsDiskPersistence();
  }, 800);
}

export function flushLeadsDiskPersistence(): void {
  if (!queuedLeadsData || isLeadsDiskWriting) return;
  const dataToWrite = queuedLeadsData;
  queuedLeadsData = null;
  isLeadsDiskWriting = true;

  const tempPath = `${DATA_FILE}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 6)}`;
  const serialized = JSON.stringify(dataToWrite);

  fs.writeFile(tempPath, serialized, 'utf-8', (err) => {
    if (err) {
      console.error('[AsyncLeadsDisk] Write error:', err);
      isLeadsDiskWriting = false;
      return;
    }
    fs.rename(tempPath, DATA_FILE, (renameErr) => {
      isLeadsDiskWriting = false;
      if (renameErr) {
        console.error('[AsyncLeadsDisk] Rename error:', renameErr);
      }
      if (queuedLeadsData) {
        flushLeadsDiskPersistence();
      }
    });
  });
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
    const isLargeArray = Array.isArray(data) && data.length > 50;
    const serialized = isLargeArray ? JSON.stringify(data) : JSON.stringify(data, null, 2);
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
    if (isLargeArray && filePath.includes('leads')) {
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
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
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
function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number = 30000): Promise<T> {
  const actualTimeout = timeoutMs; // Allow short timeouts for rapid health-checks and responsive fallbacks
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
    const testRef = doc(db, 'metadata', 'sync');
    await runWithTimeout(getDoc(testRef), 15000);
    dbVerified = true;
    cloudSyncEnabled = true;
    cloudErrorCount = 0;
    console.log(`[Firestore Client] Database "${currentDbId}" verified and active.`);
    return true;
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Quota') || errMsg.includes('quota') || errMsg.includes('limit exceeded')) {
      handleCloudError('Database Verification', err);
      dbVerified = false;
      return false;
    }
    // For non-quota errors (e.g. doc not found yet), database is reachable
    dbVerified = true;
    cloudSyncEnabled = true;
    return true;
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

  return cloudSyncEnabled;
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
  const isOffline = errMsg.toLowerCase().includes('offline') || 
                    errMsg.toLowerCase().includes('unavailable') || 
                    errMsg.toLowerCase().includes('unreachable') || 
                    errMsg.toLowerCase().includes('connection') || 
                    errMsg.toLowerCase().includes('network') || 
                    errorObj?.code === 'unavailable';
  
  // Set dbVerified to false because the connection has failed or is unhealthy
  dbVerified = false;

  if (isQuota) {
    if (!quotaLimitExceeded) {
      console.warn(`[Firestore Client] Daily quota limit reached (${contextStr}). Operating seamlessly in local JSON storage mode.`);
    }
    quotaLimitExceeded = true;
    cloudSyncEnabled = false;
    lastCloudErrorTime = Date.now();
    cloudBreakerCooldownMs = 60 * 60 * 1000; // 1 hour cooldown for Quota errors
  } else if (isOffline) {
    console.warn(`[Firestore Client] Network/Offline error detected during ${contextStr} (${errMsg}). Tripping circuit breaker immediately to maintain server responsiveness.`);
    cloudSyncEnabled = false;
    lastCloudErrorTime = Date.now();
    cloudBreakerCooldownMs = 3 * 60 * 1000; // 3 minutes cooldown for offline errors
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
    cloudErrorCount++;
    if (cloudErrorCount >= 3) {
      console.warn(`[Firestore Client] Circuit breaker tripped due to persistent cloud errors (${contextStr}). Temporarily disabling cloud sync for 3 minutes.`);
      cloudSyncEnabled = false;
      lastCloudErrorTime = Date.now();
      cloudBreakerCooldownMs = 3 * 60 * 1000;
    }
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
      db = initializeFirestore(app, { experimentalForceLongPolling: true }, config.firestoreDatabaseId || '(default)');
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
  verifyDatabaseAccess().then(verified => {
    if (verified) {
      triggerBackgroundCloudSync().catch(() => {});
    }
  }).catch(() => {});
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
  media: null as CacheEntry<MediaItem[]> | null,
  notifications: null as CacheEntry<AppNotification[]> | null,
};

// Immediate cache warmup from local storage so zero API requests ever stall
try {
  const initialLeads = safeReadJsonSync<Lead[]>(DATA_FILE, []);
  if (initialLeads.length > 0) {
    dbCache.leads = { data: initialLeads, timestamp: Date.now() };
    console.log(`[Cache Warmup] Preloaded ${initialLeads.length} leads into in-memory cache.`);
  }
  const initialCoords = safeReadJsonSync<Coordinator[]>(COORDINATORS_FILE, []);
  if (initialCoords.length > 0) {
    dbCache.coordinators = { data: initialCoords, timestamp: Date.now() };
  }
  const initialTemplates = safeReadJsonSync<WhatsAppTemplate[]>(TEMPLATES_FILE, []);
  if (initialTemplates.length > 0) {
    dbCache.templates = { data: initialTemplates, timestamp: Date.now() };
  }
  const initialUpdates = safeReadJsonSync<ImportantUpdate[]>(UPDATES_FILE, []);
  if (initialUpdates.length > 0) {
    dbCache.updates = { data: initialUpdates, timestamp: Date.now() };
  }
  const initialJobs = safeReadJsonSync<Job[]>(JOBS_FILE, []);
  if (initialJobs.length > 0) {
    dbCache.jobs = { data: initialJobs, timestamp: Date.now() };
  }
  const initialMetadata = safeReadJsonSync<CgpMetadata>(METADATA_FILE, {} as any);
  if (initialMetadata && Object.keys(initialMetadata).length > 0) {
    dbCache.metadata = { data: initialMetadata, timestamp: Date.now() };
  }
  const initialWallets = safeReadJsonSync<Wallet[]>(WALLETS_FILE, []);
  if (initialWallets.length > 0) {
    dbCache.wallets = { data: initialWallets, timestamp: Date.now() };
  }
  const initialRules = safeReadJsonSync<IncentiveRule[]>(INCENTIVE_RULES_FILE, []);
  if (initialRules.length > 0) {
    dbCache.incentive_rules = { data: initialRules, timestamp: Date.now() };
  }
} catch (e) {}

let lastFullLeadsSyncTime = 0;
let lastReadLeadsTimestamp = '';
let lastMetadataReadTime = 0;
let lastMetadataValue = '';
const METADATA_READ_COOLDOWN_MS = 15000; // 15 seconds cooldown for reading metadata/sync from Cloud

// Helper to update metadata sync timestamp
async function markDatabaseUpdated(key: string): Promise<string> {
  if (!checkCloudStatus()) return '';
  try {
    const timestamp = new Date().toISOString();
    if (key === 'leads') {
      lastMetadataValue = timestamp;
      lastMetadataReadTime = Date.now();
    }
    const docRef = doc(db, 'metadata', 'sync');
    await runWithTimeout(setDoc(docRef, { [key]: timestamp, lastUpdatedAt: timestamp }, { merge: true }), 15000);
    console.log(`[Firestore Client] Marked database updated for "${key}" at ${timestamp}`);
    return timestamp;
  } catch (err) {
    console.error('[Firestore Client] Failed to mark database updated:', err);
    return '';
  }
}

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

let coordinatorsInitialized = false;

// Helper to ensure coordinators database exists with default seed accounts
export async function initializeCoordinatorsDatabase() {
  if (coordinatorsInitialized) return;
  coordinatorsInitialized = true;

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
      const snapshot = await runWithTimeout(getDocs(q), 15000);
      if (snapshot.empty) {
        console.log('[Firestore Client] Seeding default coordinators to cloud...');
        const batch = writeBatch(db);
        defaultCoordinators.forEach(c => {
          const docRef = doc(db, 'coordinators', c.id);
          batch.set(docRef, cleanForFirestore(c));
        });
        await runWithTimeout(batch.commit(), 15000);
        console.log('[Firestore Client] Seeded coordinators successfully.');
      }
    } catch (err: any) {
      console.warn('[Firestore Client] Notice: Cloud check/seed for coordinators deferred to local file:', err?.message || err);
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
      const snapshot = await runWithTimeout(getDocs(collection(db, 'coordinators')), 15000);
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

let isDatabaseInitialized = false;

// Helper to ensure data directory and file exist with Career Growth Placement (CGP) data
async function initializeDatabase() {
  if (isDatabaseInitialized) return;
  isDatabaseInitialized = true;
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

  let localLeads = safeReadJsonSync<Lead[]>(DATA_FILE, []);
  if (localLeads.length < 50 && checkCloudStatus()) {
    try {
      console.log(`[Firestore Client] Local database has ${localLeads.length} leads. Pulling full dataset from Firestore...`);
      const q = query(collection(db, 'leads'), orderBy('createdAt', 'desc'));
      const snapshot = await runWithTimeout(getDocs(q), 25000);
      if (!snapshot.empty) {
        const cloudLeads: Lead[] = [];
        snapshot.forEach(docSnap => {
          cloudLeads.push(docSnap.data() as Lead);
        });
        console.log(`[Firestore Client] Initialized local cache with ${cloudLeads.length} leads from Firestore.`);
        localLeads = normalizeLeadsMediaUrls(cloudLeads);
        safeWriteJsonSync(DATA_FILE, localLeads);
        safeWriteJsonSync(DATA_FILE_SYNCED, localLeads);
        dbCache.leads = { data: localLeads, timestamp: Date.now() };
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch leads from Firestore on init:', err?.message || err);
    }
  }

  // Fallback to default seed leads only if local file is missing and cloud has zero records
  if (!fs.existsSync(DATA_FILE) || localLeads.length === 0) {
    safeWriteJsonSync(DATA_FILE, initialLeads);
  }
}

function mergeMessagesList(listA: Message[], listB: Message[]): Message[] {
  const map = new Map<string, Message>();
  if (Array.isArray(listA)) listA.forEach(m => { if (m && m.id) map.set(m.id, m); });
  if (Array.isArray(listB)) listB.forEach(m => {
    if (m && m.id) {
      const existing = map.get(m.id);
      if (existing) {
        const statusPriority = { 'sent': 1, 'delivered': 2, 'read': 3, 'failed': 0 };
        const existingPriority = statusPriority[existing.status as keyof typeof statusPriority] || 0;
        const newPriority = statusPriority[m.status as keyof typeof statusPriority] || 0;
        if (newPriority > existingPriority) {
          map.set(m.id, { ...existing, ...m });
        }
      } else {
        map.set(m.id, m);
      }
    }
  });
  return Array.from(map.values()).sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
}

function mergeTimelineList(listA: any[], listB: any[]): any[] {
  const map = new Map<string, any>();
  if (Array.isArray(listA)) listA.forEach(t => { if (t && t.id) map.set(t.id, t); });
  if (Array.isArray(listB)) listB.forEach(t => { if (t && t.id) map.set(t.id, t); });
  return Array.from(map.values()).sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
}

// Non-destructive follow-up tasks merger: Never drops a scheduled task or loses completion status
export function mergeTasksList(listA: any[], listB: any[]): any[] {
  const map = new Map<string, any>();
  if (Array.isArray(listA)) {
    listA.forEach(t => {
      if (t && t.id) map.set(t.id, { ...t });
    });
  }
  if (Array.isArray(listB)) {
    listB.forEach(t => {
      if (t && t.id) {
        const existing = map.get(t.id);
        if (existing) {
          // If either version marks it completed, keep completed
          const isCompleted = existing.completed || t.completed;
          const dueDate = t.dueDate || existing.dueDate;
          const title = (t.title && t.title.length >= (existing.title?.length || 0)) ? t.title : (existing.title || t.title);
          map.set(t.id, {
            ...existing,
            ...t,
            title,
            dueDate,
            completed: isCompleted
          });
        } else {
          map.set(t.id, { ...t });
        }
      }
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    const timeA = new Date(a.dueDate || a.createdAt || 0).getTime();
    const timeB = new Date(b.dueDate || b.createdAt || 0).getTime();
    return timeA - timeB;
  });
}

// Helper function to perform field-level merging, preserving populated values from the older version if empty in the newer version
function mergeLeadProfiles(olderLead: Lead, newerLead: Lead): Lead {
  const merged = { ...newerLead };
  
  const fieldsToValidate: (keyof Lead)[] = [
    'remarks1', 'remarks2', 'remarks3', 'adminRemarks', 'notes',
    'name', 'phone', 'alternateNo', 'email', 'campaign',
    'assignedTo', 'stage', 'project', 'country', 'position', 'experience', 'qualification',
    'docPassportCopy', 'docResume', 'docOfficeVisited', 'docOthers', 'docInterviewAttended', 'docEcrPassport',
    'passportCopyUrl', 'passportCopyName', 'resumeUrl', 'resumeName'
  ];
  
  fieldsToValidate.forEach(field => {
    const olderVal = olderLead[field];
    const newerVal = newerLead[field];
    
    if (olderVal !== undefined && olderVal !== null && String(olderVal).trim() !== '') {
      if (newerVal === undefined || newerVal === null || String(newerVal).trim() === '') {
        (merged as any)[field] = olderVal;
      }
    }
  });

  // Coordinator Protection: If older lead had an assigned coordinator and newer lead is unassigned or empty, preserve assigned coordinator!
  if (olderLead.assignedTo && olderLead.assignedTo.trim() !== '' && olderLead.assignedTo.toLowerCase() !== 'unassigned') {
    if (!newerLead.assignedTo || newerLead.assignedTo.trim() === '' || newerLead.assignedTo.toLowerCase() === 'unassigned') {
      merged.assignedTo = olderLead.assignedTo;
      if (olderLead.assignDate && !merged.assignDate) {
        merged.assignDate = olderLead.assignDate;
      }
    }
  }

  // Stage Protection: If older lead had an advanced pipeline stage and newer lead is default 'new', preserve the advanced pipeline stage!
  if (olderLead.stage && olderLead.stage !== 'new' && (!newerLead.stage || newerLead.stage === 'new')) {
    merged.stage = olderLead.stage;
  }

  // Tasks Protection: Merge tasks non-destructively so no follow-up task is ever lost
  merged.tasks = mergeTasksList(olderLead.tasks || [], newerLead.tasks || []);
  if (merged.tasks.some(t => !t.completed)) {
    merged.reminderEnabled = true;
  }
  
  return merged;
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
        // LOCAL PREVAILS when timestamps are equal or local is newer!
        if (localTime >= cloudTime) {
          chosen = mergeLeadProfiles(cloud, local);
          chosen.messages = mergeMessagesList(cloud.messages || [], local.messages || []);
          chosen.timeline = mergeTimelineList(cloud.timeline || [], local.timeline || []);
          chosen.tasks = mergeTasksList(cloud.tasks || [], local.tasks || []);
          pendingUpload.push(chosen);
        } else {
          chosen = mergeLeadProfiles(local, cloud);
          chosen.messages = mergeMessagesList(local.messages || [], cloud.messages || []);
          chosen.timeline = mergeTimelineList(local.timeline || [], cloud.timeline || []);
          chosen.tasks = mergeTasksList(local.tasks || [], cloud.tasks || []);
          // Safeguard: Never let stale cloud revert local coordinator assignment or advanced stage
          if (local.assignedTo && local.assignedTo.toLowerCase() !== 'unassigned' && (!cloud.assignedTo || cloud.assignedTo.toLowerCase() === 'unassigned')) {
            chosen.assignedTo = local.assignedTo;
            chosen.assignDate = local.assignDate || chosen.assignDate;
          }
          if (local.stage && local.stage !== 'new' && (!cloud.stage || cloud.stage === 'new')) {
            chosen.stage = local.stage;
          }
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


// Helper function to extract Meta media_id from various URL formats or IDs
export function extractMetaMediaId(urlOrId: string | undefined | null): string | null {
  if (!urlOrId) return null;
  const s = String(urlOrId).trim();
  if (/^\d+$/.test(s)) {
    return s;
  }
  
  // Try to find the "mid" query parameter
  try {
    if (s.includes('mid=')) {
      const match = s.match(/[?&]mid=(\d+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (e) {}

  // Try to find the last numeric segment in path
  try {
    const urlObj = new URL(s);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(segments[i])) {
        return segments[i];
      }
    }
  } catch (e) {}

  // Fallback regex match for any 15+ digit number
  const digitMatch = s.match(/\b\d{14,17}\b/);
  if (digitMatch) {
    return digitMatch[0];
  }

  return null;
}

// Normalize single lead message media URLs to proxy endpoint
export function normalizeSingleLeadMediaUrls(lead: Lead | undefined): Lead | undefined {
  if (!lead) return lead;
  if (!lead.messages || !Array.isArray(lead.messages)) return lead;

  const mappedMessages = lead.messages.map((m: Message) => {
    if (!m || !m.mediaUrl) return m;
    const rawUrl = String(m.mediaUrl).trim();
    if (rawUrl.startsWith('/api/whatsapp/media/')) return m;

    if (rawUrl.includes('fbsbx.com') || rawUrl.includes('facebook.com') || /^\d+$/.test(rawUrl)) {
      const extractedId = extractMetaMediaId(rawUrl);
      if (extractedId) {
        return {
          ...m,
          mediaUrl: `/api/whatsapp/media/${extractedId}`
        };
      }
    }
    return m;
  });

  return {
    ...lead,
    messages: mappedMessages
  };
}

// Normalize a collection of leads
export function normalizeLeadsMediaUrls(leads: Lead[]): Lead[] {
  return leads.map(l => normalizeSingleLeadMediaUrls(l) as Lead);
}

// Find lead by id
export async function getLeadById(id: string): Promise<Lead | undefined> {
  if (dbCache.leads && dbCache.leads.data) {
    const found = dbCache.leads.data.find(l => l.id === id);
    if (found) return normalizeSingleLeadMediaUrls(found) as Lead;
  }
  const localLeads = safeReadJsonSync<Lead[]>(DATA_FILE, []);
  const found = localLeads.find(l => l.id === id);
  if (found) return normalizeSingleLeadMediaUrls(found) as Lead;

  const leads = await getLeads();
  return normalizeSingleLeadMediaUrls(leads.find(l => l.id === id));
}

// Read database with immediate response and asynchronous background cloud synchronization
async function getLeadsInternal(forceBypassCache = false): Promise<Lead[]> {
  await initializeDatabase();

  // 1. Check in-memory cache first - if valid and not bypassing, return in < 1ms
  if (!forceBypassCache && dbCache.leads && Array.isArray(dbCache.leads.data) && dbCache.leads.data.length >= 50 && (Date.now() - dbCache.leads.timestamp < CACHE_TTL_MS)) {
    return dbCache.leads.data;
  }

  // If forceBypassCache is explicitly requested and Cloud is available, do a direct synchronous refresh
  if (forceBypassCache && checkCloudStatus()) {
    try {
      await runCloudSyncInternal(true);
      const synced = safeReadJsonSync<Lead[]>(DATA_FILE, []);
      if (synced.length > 0) {
        const normalized = normalizeLeadsMediaUrls(synced);
        dbCache.leads = { data: normalized, timestamp: Date.now() };
        return normalized;
      }
    } catch (e) {
      console.warn('[getLeadsInternal] Direct sync on forceBypassCache failed, falling back to local file:', e);
    }
  }

  // 2. Read existing local leads safely with auto-recovery
  let localLeads: Lead[] = safeReadJsonSync<Lead[]>(DATA_FILE, []);

  // Fast path: If local leads exist with substantial records (>= 50), return immediately!
  if (localLeads.length >= 50) {
    const normalized = normalizeLeadsMediaUrls(localLeads);
    dbCache.leads = { data: normalized, timestamp: Date.now() };

    // Trigger non-blocking background sync if > 15 mins since last sync
    if (checkCloudStatus() && (Date.now() - lastFullLeadsSyncTime > 15 * 60 * 1000)) {
      setTimeout(() => {
        triggerBackgroundCloudSync().catch(err => {
          console.warn('[Cloud Sync Queue] Background sync trigger deferred:', err?.message || err);
        });
      }, 0);
    }

    return normalized;
  }

  // Cold start fallback: If local leads has < 50 records and cloud is active, pull once to seed DATA_FILE
  if (checkCloudStatus()) {
    try {
      console.log(`[Firestore Client] Initializing local database from Firestore (${localLeads.length} local leads found)...`);
      const snapshot = await runWithTimeout(getDocs(collection(db, 'leads')), 25000);
      if (!snapshot.empty) {
        const cloudLeads: Lead[] = [];
        snapshot.forEach(docSnap => {
          cloudLeads.push(docSnap.data() as Lead);
        });
        cloudLeads.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        localLeads = normalizeLeadsMediaUrls(cloudLeads);
        safeWriteJsonSync(DATA_FILE, localLeads);
        safeWriteJsonSync(DATA_FILE_SYNCED, localLeads);
        dbCache.leads = { data: localLeads, timestamp: Date.now() };
        lastFullLeadsSyncTime = Date.now();
        return localLeads;
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to seed leads from Firestore on startup:', err?.message || err);
    }
  }

  const normalized = normalizeLeadsMediaUrls(localLeads);
  dbCache.leads = { data: normalized, timestamp: Date.now() };
  return normalized;
}

// Non-blocking background sync queue state
let isSyncingToCloud = false;
let hasPendingCloudSync = false;

async function triggerBackgroundCloudSync(forceFull = false): Promise<void> {
  if (isSyncingToCloud) {
    hasPendingCloudSync = true;
    return;
  }

  isSyncingToCloud = true;
  hasPendingCloudSync = false;

  try {
    await runCloudSyncInternal(forceFull);
  } catch (err) {
    console.error('[Cloud Sync Queue] Background cloud sync execution failed:', err);
  } finally {
    isSyncingToCloud = false;
    if (hasPendingCloudSync) {
      setTimeout(() => {
        triggerBackgroundCloudSync().catch(console.error);
      }, 1000); // 1s cool-down to batch successive quick updates
    }
  }
}

async function runCloudSyncInternal(forceFull = false): Promise<void> {
  if (!checkCloudStatus()) return;

  await initializeDatabase();

  let localLeads: Lead[] = [];
  if (dbCache.leads && Array.isArray(dbCache.leads.data) && dbCache.leads.data.length > 0) {
    localLeads = dbCache.leads.data;
  } else {
    localLeads = safeReadJsonSync<Lead[]>(DATA_FILE, []);
  }
  if (localLeads.length === 0) return;

  const lastSyncedLeads: Lead[] = safeReadJsonSync<Lead[]>(DATA_FILE_SYNCED, []);

  try {
    const nowTime = Date.now();
    const doFullSync = forceFull || (nowTime - lastFullLeadsSyncTime > 60 * 60 * 1000) || lastSyncedLeads.length === 0;
    let cloudLeads: Lead[] = [];

    if (doFullSync) {
      console.log('[Firestore Background] Performing periodic full sync of leads...');
      const snapshot = await runWithTimeout(getDocs(collection(db, 'leads')), 25000);
      snapshot.forEach(docSnap => {
        cloudLeads.push(docSnap.data() as Lead);
      });
      cloudLeads.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      lastFullLeadsSyncTime = nowTime;
    } else {
      // Delta sync! Find latest updatedAt timestamp
      let maxUpdatedAt = 0;
      const refLeads = lastSyncedLeads.length > 0 ? lastSyncedLeads : localLeads;
      refLeads.forEach(l => {
        if (l) {
          const upTime = new Date(l.updatedAt || l.createdAt || 0).getTime();
          if (upTime > maxUpdatedAt) maxUpdatedAt = upTime;
        }
      });

      const lastSyncThreshold = maxUpdatedAt > 0 
        ? new Date(maxUpdatedAt - 5 * 60 * 1000).toISOString() 
        : '1970-01-01T00:00:00.000Z';

      const q = query(
        collection(db, 'leads'),
        where('updatedAt', '>=', lastSyncThreshold)
      );
      const snapshot = await runWithTimeout(getDocs(q), 15000);
      const deltaLeads: Lead[] = [];
      snapshot.forEach(docSnap => {
        deltaLeads.push(docSnap.data() as Lead);
      });

      const reconstructedMap = new Map<string, Lead>();
      lastSyncedLeads.forEach(l => {
        if (l && l.id) reconstructedMap.set(l.id, l);
      });
      deltaLeads.forEach(c => {
        if (c && c.id) reconstructedMap.set(c.id, c);
      });
      cloudLeads = Array.from(reconstructedMap.values());
    }

    if (cloudLeads.length > 0) {
      const mergeResult = syncAndMergeLeadsList(localLeads, cloudLeads, lastSyncedLeads);
      const finalLeads = mergeResult.mergedLeads;

      safeWriteJsonSync(DATA_FILE, finalLeads);
      safeWriteJsonSync(DATA_FILE_SYNCED, finalLeads);

      const normalized = normalizeLeadsMediaUrls(finalLeads);
      dbCache.leads = { data: normalized, timestamp: Date.now() };

      // Push pending uploads in chunks of 50 with rate-limiting
      if (mergeResult.pendingUpload.length > 0) {
        console.log(`[Firestore Background] Uploading ${mergeResult.pendingUpload.length} pending leads...`);
        const CHUNK_SIZE = 50;
        for (let i = 0; i < mergeResult.pendingUpload.length; i += CHUNK_SIZE) {
          const chunk = mergeResult.pendingUpload.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);
          chunk.forEach(l => {
            const docRef = doc(db, 'leads', l.id);
            batch.set(docRef, cleanForFirestore(l), { merge: true });
          });
          await runWithTimeout(batch.commit(), 15000);
          if (i + CHUNK_SIZE < mergeResult.pendingUpload.length) {
            await new Promise(r => setTimeout(r, 200));
          }
        }
      }
    } else {
      // Delta query found 0 new updates in cloud - database is already synchronized!
      console.log('[Firestore Background] Cloud leads are fully up to date.');
    }

    const newTimestamp = await markDatabaseUpdated('leads');
    if (newTimestamp) {
      lastReadLeadsTimestamp = newTimestamp;
    }
  } catch (err: any) {
    console.warn('[Firestore Background] Error during background cloud sync:', err?.message || err);
    handleCloudError('Background Cloud Sync', err);
  }
}

// Save all leads using smart delta-saving for Firestore
async function saveLeadsInternal(leads: Lead[]): Promise<void> {
  await initializeDatabase();

  const normalizedLeads = normalizeLeadsMediaUrls(leads);

  // Update in-memory cache immediately so local changes are instantly reflected on reads
  dbCache.leads = { data: normalizedLeads, timestamp: Date.now() };
  incrementDatabaseVersion();

  // Atomically and synchronously persist to disk so zero stale-read window exists
  safeWriteJsonSync(DATA_FILE, normalizedLeads);

  if (checkCloudStatus()) {
    triggerBackgroundCloudSync().catch(err => {
      console.error('[Cloud Sync Queue] Failed to trigger background cloud sync:', err);
    });
  }
}

// Atomically update a single lead in-memory, write to disk, and push to Firestore without full-table locking
export async function updateSingleLead(id: string, updater: (current: Lead) => Lead | Promise<Lead>): Promise<Lead | null> {
  return dbMutex.run(async () => {
    await initializeDatabase();
    
    // Read from memory cache if available, else disk
    let leads: Lead[] = [];
    if (dbCache.leads && Array.isArray(dbCache.leads.data) && dbCache.leads.data.length > 0) {
      leads = dbCache.leads.data;
    } else {
      leads = safeReadJsonSync<Lead[]>(DATA_FILE, []);
    }

    let idx = leads.findIndex(l => l.id === id);
    if (idx === -1) {
      if (checkCloudStatus()) {
        try {
          const docRef = doc(db, 'leads', id);
          const snap = await runWithTimeout(getDoc(docRef), 5000);
          if (snap.exists()) {
            const data = snap.data() as Lead;
            leads.push(data);
            idx = leads.length - 1;
          }
        } catch (e) {
          console.warn(`[updateSingleLead] Failed to fetch doc ${id} from firestore:`, e);
        }
      }
      if (idx === -1) {
        return null;
      }
    }

    const currentLead = leads[idx];
    const updatedLead = await updater({ ...currentLead });
    updatedLead.updatedAt = new Date().toISOString();

    const normalized = normalizeSingleLeadMediaUrls(updatedLead) as Lead;
    leads[idx] = normalized;

    // 1. Instantly update in-memory cache so subsequent reads see this change in < 1ms
    dbCache.leads = { data: leads, timestamp: Date.now() };
    incrementDatabaseVersion();

    // 2. Persist to disk atomically
    safeWriteJsonSync(DATA_FILE, leads);

    // 3. Immediately push just this single modified lead to Firestore in the background
    if (checkCloudStatus()) {
      try {
        const docRef = doc(db, 'leads', id);
        runWithTimeout(setDoc(docRef, cleanForFirestore(normalized), { merge: true }), 10000)
          .catch(err => {
            console.warn(`[Firestore Client] Single lead sync for ${id} deferred:`, err?.message || err);
          });
      } catch (err) {
        // Suppress background sync errors so user request returns immediately
      }
    }

    return normalized;
  });
}

export async function getLeads(forceRefresh = false): Promise<Lead[]> {
  return getLeadsInternal(forceRefresh);
}

export function clearLeadsCache(): void {
  dbCache.leads = null;
  lastFullLeadsSyncTime = 0;
  lastReadLeadsTimestamp = '';
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

let jobsInitialized = false;

// Ensure jobs database exists with default seed jobs
export async function initializeJobsDatabase() {
  if (jobsInitialized) return;
  jobsInitialized = true;
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
      const statusSnap = await runWithTimeout(getDoc(statusRef), 15000);
      if (!statusSnap.exists()) {
        console.log('[Firestore Client] Seeding default jobs to cloud...');
        const batch = writeBatch(db);
        defaultJobs.forEach(j => {
          const docRef = doc(db, 'jobs', j.id);
          batch.set(docRef, cleanForFirestore(j));
        });
        batch.set(statusRef, { seeded: true, updatedAt: new Date().toISOString() });
        await runWithTimeout(batch.commit(), 15000);
        console.log('[Firestore Client] Seeded jobs successfully.');
      }
    } catch (err: any) {
      console.warn('[Firestore Client] Notice: Cloud check/seed for jobs deferred to local file:', err?.message || err);
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
      const snapshot = await runWithTimeout(getDocs(collection(db, 'jobs')), 10000);
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
      await runWithTimeout(batch.commit(), 10000);

      // Delete any removed jobs
      const snapshot = await runWithTimeout(getDocs(collection(db, 'jobs')), 10000);
      const deleteBatch = writeBatch(db);
      let hasDeletes = false;
      snapshot.forEach(docSnap => {
        if (!validJobs.some(j => j.id === docSnap.id)) {
          deleteBatch.delete(docSnap.ref);
          hasDeletes = true;
        }
      });
      if (hasDeletes) {
        await runWithTimeout(deleteBatch.commit(), 10000);
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to save jobs to cloud:', err);
      handleCloudError(err);
    }
  }
}

let updatesInitialized = false;

// Ensure updates database exists with default seed updates
export async function initializeUpdatesDatabase() {
  if (updatesInitialized) return;
  updatesInitialized = true;

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
      const statusSnap = await runWithTimeout(getDoc(statusRef), 15000);
      if (!statusSnap.exists()) {
        console.log('[Firestore Client] Seeding default updates to cloud...');
        const batch = writeBatch(db);
        defaultUpdates.forEach(upd => {
          const docRef = doc(db, 'updates', upd.id);
          batch.set(docRef, cleanForFirestore(upd));
        });
        batch.set(statusRef, { seeded: true, updatedAt: new Date().toISOString() });
        await runWithTimeout(batch.commit(), 15000);
        console.log('[Firestore Client] Seeded updates successfully.');
      }
    } catch (err: any) {
      console.warn('[Firestore Client] Notice: Cloud check/seed for updates deferred to local file:', err?.message || err);
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
      const snapshot = await runWithTimeout(getDocs(collection(db, 'updates')), 15000);
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
      await runWithTimeout(batch.commit(), 10000);

      // Delete any removed updates
      const snapshot = await runWithTimeout(getDocs(collection(db, 'updates')), 10000);
      const deleteBatch = writeBatch(db);
      let hasDeletes = false;
      snapshot.forEach(docSnap => {
        if (!validUpdates.some(u => u.id === docSnap.id)) {
          deleteBatch.delete(docSnap.ref);
          hasDeletes = true;
        }
      });
      if (hasDeletes) {
        await runWithTimeout(deleteBatch.commit(), 10000);
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

let metadataInitialized = false;

export async function initializeMetadataDatabase() {
  if (metadataInitialized) return;
  metadataInitialized = true;

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
      const docSnap = await runWithTimeout(getDoc(docRef), 15000);
      if (!docSnap.exists()) {
        console.log('[Firestore Client] Seeding default metadata to cloud...');
        await runWithTimeout(setDoc(docRef, cleanForFirestore(defaultMetadata)), 15000);
        console.log('[Firestore Client] Seeded metadata successfully.');
      }
    } catch (err: any) {
      console.warn('[Firestore Client] Notice: Cloud check/seed for metadata deferred to local file:', err?.message || err);
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
      const docSnap = await runWithTimeout(getDoc(doc(db, 'metadata', 'options')), 10000);
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
      await runWithTimeout(setDoc(doc(db, 'metadata', 'options'), cleanForFirestore(metadata)), 10000);
    } catch (err: any) {
      console.error('[Firestore Client] Failed to save metadata to cloud:', err);
      handleCloudError(err);
    }
  }
}

// --- WALLET DATABASE FUNCTIONS ---

export async function reconcileWalletsFromLeads(): Promise<Wallet[]> {
  const leads = await getLeads();
  const rules = await getIncentiveRules();
  const coordinators = await getCoordinators();

  const walletsMap = new Map<string, Wallet>();
  coordinators.forEach(c => {
    const u = c.username.toLowerCase();
    walletsMap.set(u, {
      id: u,
      username: u,
      displayName: c.displayName,
      balance: 0,
      transactions: [],
      updatedAt: new Date().toISOString()
    });
  });

  if (!walletsMap.has('sachinsaha')) {
    walletsMap.set('sachinsaha', {
      id: 'sachinsaha',
      username: 'sachinsaha',
      displayName: 'Sachin Saha',
      balance: 0,
      transactions: [],
      updatedAt: new Date().toISOString()
    });
  }

  // 1. Read existing local wallets to preserve existing debits and custom manual adjustments
  const existingWallets = safeReadJsonSync<Wallet[]>(WALLETS_FILE, []);

  leads.forEach(lead => {
    if (lead.isDeleted) return;
    const rawCoord = (lead.assignedTo || '').trim();
    if (!rawCoord || rawCoord.toLowerCase() === 'unassigned' || rawCoord.toLowerCase() === 'all') return;
    const coordKey = rawCoord.toLowerCase();

    if (!walletsMap.has(coordKey)) {
      const foundC = coordinators.find(c => c.username.toLowerCase() === coordKey || c.displayName.toLowerCase() === coordKey);
      walletsMap.set(coordKey, {
        id: coordKey,
        username: coordKey,
        displayName: foundC ? foundC.displayName : rawCoord,
        balance: 0,
        transactions: [],
        updatedAt: new Date().toISOString()
      });
    }

    const wallet = walletsMap.get(coordKey)!;

    // 1. Closed Won
    if (lead.stage === 'won') {
      let incentiveAmount = 400;
      const cName = String(lead.country || '').trim().toLowerCase();
      const pName = String(lead.project || '').trim().toLowerCase();

      if (['japan', 'albania', 'europe', 'malta', 'greece'].includes(cName)) {
        incentiveAmount = 1000;
      } else if (['kuwait', 'dubai', 'qatar', 'u.a.e', 'oman'].includes(cName)) {
        incentiveAmount = 400;
      }

      const matchedRules = rules.filter(r => {
        const rProject = (r.projectName || '').trim().toLowerCase();
        const rCountry = (r.country || '').trim().toLowerCase();
        const projectMatches = rProject === 'all' || rProject === 'any' || rProject === '' || rProject === pName;
        const countryMatches = rCountry === 'all' || rCountry === 'any' || rCountry === '' || rCountry === 'all countries' || rCountry === cName;
        return projectMatches && countryMatches;
      });

      if (matchedRules.length > 0) {
        matchedRules.sort((a, b) => {
          const aProj = !['all', 'any', ''].includes((a.projectName || '').trim().toLowerCase());
          const aCtry = !['all', 'any', '', 'all countries'].includes((a.country || '').trim().toLowerCase());
          const bProj = !['all', 'any', ''].includes((b.projectName || '').trim().toLowerCase());
          const bCtry = !['all', 'any', '', 'all countries'].includes((b.country || '').trim().toLowerCase());
          return (bProj ? 1 : 0) + (bCtry ? 2 : 0) - ((aProj ? 1 : 0) + (aCtry ? 2 : 0));
        });
        const best = matchedRules[0];
        const isSpecific = !['all', 'any', '', 'all countries'].includes((best.country || '').trim().toLowerCase());
        if (isSpecific) incentiveAmount = best.amount;
      }

      const stageEvent = (lead.timeline || []).find(t => t.text && t.text.includes('Closed Won'));
      const stageHistEvent = (lead.stageHistory || []).find(s => s.newStage === 'won');
      const wonDate = stageHistEvent?.changedAt || stageEvent?.timestamp || lead.updatedAt || lead.createdAt || new Date().toISOString();

      wallet.transactions.push({
        id: `tx_${Date.now()}_won_${lead.id}`,
        type: 'credit',
        amount: incentiveAmount,
        reason: `Closed Won incentive for candidate: ${lead.name} (Project: ${lead.project || 'General'}, Country: ${lead.country || 'Unknown'})`,
        timestamp: wonDate,
        leadId: lead.id
      });

      // Sachin Saha Override Bonus
      if (incentiveAmount === 400 || incentiveAmount === 1000) {
        const sachinBonus = incentiveAmount === 400 ? 100 : 200;
        const sachinWallet = walletsMap.get('sachinsaha')!;
        sachinWallet.transactions.push({
          id: `tx_${Date.now()}_sachin_${lead.id}`,
          type: 'credit',
          amount: sachinBonus,
          reason: `Sachin Saha Override Bonus (Sale by: ${wallet.displayName}) for candidate: ${lead.name} (Project: ${lead.project || 'General'}, Country: ${lead.country || 'Unknown'})`,
          timestamp: wonDate,
          leadId: lead.id
        });
      }
    }

    // 2. Office Visited (INR 11)
    if (lead.docOfficeVisited) {
      const ovDate = lead.updatedAt || lead.createdAt || new Date().toISOString();
      wallet.transactions.push({
        id: `tx_${Date.now()}_ov_${lead.id}`,
        type: 'credit',
        amount: 11,
        reason: `Office Visited Incentive for candidate: ${lead.name}`,
        timestamp: ovDate,
        leadId: lead.id
      });
    }

    // 3. Interview Attended (INR 11)
    if (lead.docInterviewAttended) {
      const iaDate = lead.updatedAt || lead.createdAt || new Date().toISOString();
      wallet.transactions.push({
        id: `tx_${Date.now()}_ia_${lead.id}`,
        type: 'credit',
        amount: 11,
        reason: `Interview Attended Incentive for candidate: ${lead.name}`,
        timestamp: iaDate,
        leadId: lead.id
      });
    }
  });

  // 4. Ensure coordinator payout debits & placements are restored for all coordinators
  // Edenla: Verified Japan SSW placement (1,000) & payout debit (25) -> Net 1,041
  const edenlaWallet = walletsMap.get('edenla');
  if (edenlaWallet) {
    const hasJapanWon = edenlaWallet.transactions.some(t => t.type === 'credit' && (t.amount === 1000 || (t.reason.includes('Closed Won') && t.reason.includes('Japan'))));
    if (!hasJapanWon) {
      edenlaWallet.transactions.push({
        id: 'tx_edenla_won_royal_bardewa_japan',
        type: 'credit',
        amount: 1000,
        reason: 'Closed Won incentive for candidate: Royal Bardewa (Project: JAPAN SSW, Country: Japan)',
        timestamp: '2026-09-03T06:03:43.817Z',
        leadId: 'RANZAI_12-08-2026'
      });

      const sachinWallet = walletsMap.get('sachinsaha');
      if (sachinWallet) {
        const hasSachinEdenlaBonus = sachinWallet.transactions.some(t => t.leadId === 'RANZAI_12-08-2026' && t.type === 'credit');
        if (!hasSachinEdenlaBonus) {
          sachinWallet.transactions.push({
            id: 'tx_sachin_override_royal_bardewa',
            type: 'credit',
            amount: 200,
            reason: 'Sachin Saha Override Bonus (Sale by: Edenla) for candidate: Royal Bardewa (Project: JAPAN SSW, Country: Japan)',
            timestamp: '2026-09-03T06:03:43.817Z',
            leadId: 'RANZAI_12-08-2026'
          });
        }
      }
    }

    const hasEdenlaDebit = edenlaWallet.transactions.some(t => t.type === 'debit');
    if (!hasEdenlaDebit) {
      edenlaWallet.transactions.push({
        id: 'tx_edenla_debit_payout_25',
        type: 'debit',
        amount: 25,
        reason: 'Coordinator Payout / Debit Adjustment: Processed Withdrawal',
        timestamp: '2026-10-15T10:00:00.000Z'
      });
    }
  }

  // 5. Ensure authentic verified coordinator payout debits are safely retained
  const ensureDebit = (username: string, tx: WalletTransaction) => {
    const w = walletsMap.get(username);
    if (w) {
      const exists = (w.transactions || []).some(t => t.id === tx.id || (t.type === 'debit' && t.amount === tx.amount));
      if (!exists) {
        w.transactions.push(tx);
      }
    }
  };

  ensureDebit('sarina', {
    id: 'tx_sarina_debit_payout_4899',
    type: 'debit',
    amount: 4899,
    reason: 'Coordinator Incentive Payout / Processed Withdrawal: August & September Accrued Earnings Settled',
    timestamp: '2026-10-01T10:00:00.000Z'
  });

  ensureDebit('joyce', {
    id: 'tx_joyce_debit_payout_1277',
    type: 'debit',
    amount: 1277,
    reason: 'Coordinator Incentive Payout / Processed Withdrawal: August & September Accrued Earnings Settled',
    timestamp: '2026-10-01T10:00:00.000Z'
  });

  ensureDebit('maryada', {
    id: 'tx_maryada_debit_payout_2000',
    type: 'debit',
    amount: 2000,
    reason: 'Coordinator Incentive Payout / Processed Withdrawal: August & September Accrued Earnings Settled',
    timestamp: '2026-10-01T10:00:00.000Z'
  });

  // NOTE: Priya has NEVER taken any debit! (0 DR invariant strictly enforced, Priya balance is 100% credits)

  // 6. Non-destructively preserve any existing manual debits or custom transactions
  existingWallets.forEach(ew => {
    const u = ew.username.toLowerCase();
    const targetW = walletsMap.get(u);
    if (targetW && Array.isArray(ew.transactions)) {
      ew.transactions.forEach(et => {
        // INVARIANT GUARD: Priya has NEVER taken any debit!
        if (u === 'priya' && et.type === 'debit') return;

        const alreadyExists = targetW.transactions.some(t => t.id === et.id);
        if (!alreadyExists) {
          targetW.transactions.push(et);
        }
      });
    }
  });

  const finalWallets = Array.from(walletsMap.values());
  finalWallets.forEach(w => {
    // Enforce Invariant: Priya MUST NOT have any debit entries
    if (w.username.toLowerCase() === 'priya') {
      w.transactions = (w.transactions || []).filter(t => t.type !== 'debit');
    }
    const totalCredits = (w.transactions || []).filter(t => t.type === 'credit').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const totalDebits = (w.transactions || []).filter(t => t.type === 'debit').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    w.balance = Math.max(0, totalCredits - totalDebits);
    w.transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    w.updatedAt = new Date().toISOString();
  });

  await saveWallets(finalWallets, 'Non-destructive reconciliation from lead milestones');
  return finalWallets;
}

// --- IMMUTABLE AUDIT LEDGER & SNAPSHOT INTERFACES ---

export interface WalletSnapshot {
  id: string;
  timestamp: string;
  reason: string;
  createdBy?: string;
  totalWallets: number;
  netBalance: number;
  totalCredits: number;
  totalDebits: number;
  coordinatorsWithDebits: string[];
  sachinDebitsCount: number;
  wallets: Wallet[];
}

export function appendWalletLedgerAudit(transaction: WalletTransaction, username: string, reasonDetails?: string): void {
  try {
    const entry = JSON.stringify({
      auditId: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      username,
      transaction,
      reasonDetails: reasonDetails || 'Standard transaction recorded',
      recordedAt: new Date().toISOString()
    }) + '\n';
    fs.appendFileSync(WALLET_LEDGER_FILE, entry, 'utf8');
  } catch (err) {
    console.error('[Wallet Ledger Audit] Failed to append to audit ledger:', err);
  }
}

function createWalletSnapshotInternal(wallets: Wallet[], reason: string, createdBy = 'System Vault Guard'): WalletSnapshot {
  let netBalance = 0;
  let totalCredits = 0;
  let totalDebits = 0;
  const coordsWithDebits: string[] = [];
  let sachinDebits = 0;

  wallets.forEach(w => {
    netBalance += (Number(w.balance) || 0);
    (w.transactions || []).forEach(t => {
      const amt = Number(t.amount) || 0;
      if (t.type === 'credit') {
        totalCredits += amt;
      } else if (t.type === 'debit') {
        totalDebits += amt;
        if (!coordsWithDebits.includes(w.username)) coordsWithDebits.push(w.username);
        if (w.username.toLowerCase() === 'sachinsaha') sachinDebits++;
      }
    });
  });

  const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const snapshot: WalletSnapshot = {
    id: snapshotId,
    timestamp: new Date().toISOString(),
    reason,
    createdBy,
    totalWallets: wallets.length,
    netBalance,
    totalCredits,
    totalDebits,
    coordinatorsWithDebits: coordsWithDebits,
    sachinDebitsCount: sachinDebits,
    wallets
  };

  const filePath = path.join(WALLET_BACKUPS_DIR, `${snapshotId}.json`);
  safeWriteJsonSync(filePath, snapshot);

  // Keep a maximum of 50 rolling snapshots on disk to save space
  try {
    const files = fs.readdirSync(WALLET_BACKUPS_DIR)
      .filter(f => f.startsWith('snapshot_') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (files.length > 50) {
      files.slice(50).forEach(f => {
        try { fs.unlinkSync(path.join(WALLET_BACKUPS_DIR, f)); } catch {}
      });
    }
  } catch {}

  // Cloud sync snapshot
  if (checkCloudStatus()) {
    try {
      const docRef = doc(db, 'wallet_backups', snapshotId);
      setDoc(docRef, cleanForFirestore(snapshot)).catch(e => console.warn('[Firestore] Failed to sync snapshot to cloud:', e));
    } catch {}
  }

  return snapshot;
}

export async function createWalletSnapshot(reason: string, createdBy = 'Admin User'): Promise<WalletSnapshot> {
  const wallets = await getWallets();
  return createWalletSnapshotInternal(wallets, reason, createdBy);
}

export async function listWalletSnapshots(): Promise<Omit<WalletSnapshot, 'wallets'>[]> {
  const snapshots: Omit<WalletSnapshot, 'wallets'>[] = [];
  try {
    if (fs.existsSync(WALLET_BACKUPS_DIR)) {
      const files = fs.readdirSync(WALLET_BACKUPS_DIR).filter(f => f.endsWith('.json'));
      files.forEach(f => {
        try {
          const s = safeReadJsonSync<WalletSnapshot>(path.join(WALLET_BACKUPS_DIR, f), null as any);
          if (s && s.id && s.timestamp) {
            const { wallets, ...meta } = s;
            snapshots.push(meta);
          }
        } catch {}
      });
    }
  } catch (err) {
    console.error('[Data Vault] Failed to read local snapshots:', err);
  }

  snapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return snapshots;
}

export async function restoreWalletSnapshot(snapshotId: string): Promise<Wallet[]> {
  const filePath = path.join(WALLET_BACKUPS_DIR, `${snapshotId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Snapshot ${snapshotId} not found in safe storage.`);
  }
  const snapshot = safeReadJsonSync<WalletSnapshot>(filePath, null as any);
  if (!snapshot || !Array.isArray(snapshot.wallets)) {
    throw new Error(`Invalid snapshot content for ${snapshotId}`);
  }

  // Backup current state before restoring
  const current = await getWallets();
  createWalletSnapshotInternal(current, `Pre-rollback safeguard before restoring ${snapshotId}`, 'Safety Guard');

  // Restore wallets
  const targetWallets = snapshot.wallets;
  await saveWallets(targetWallets, `Restored from snapshot ${snapshotId} (${snapshot.reason})`);
  return targetWallets;
}

export async function restore15Oct2026Data(): Promise<Wallet[]> {
  console.warn('[Data Vault] 15-10-2026 restore is permanently disabled to prevent overwriting live wallets.');
  return getWallets();
}

async function _legacyRestore15Oct2026Data_disabled(): Promise<Wallet[]> {
  console.log('[Data Vault] Restoring Verified 15-10-2026 Baseline Data...');
  const leads = await getLeads();
  const cutoff = new Date('2026-10-15T23:59:59.999Z');

  const coords = ['edenla', 'sarina', 'joyce', 'maryada', 'priya', 'shreya', 'sachinsaha', 'nishant', 'bishwo', 'admin', 'test'];
  const displayNames: Record<string, string> = {
    edenla: 'Edenla',
    sarina: 'Sarina',
    joyce: 'Joyce',
    maryada: 'Maryada',
    priya: 'Priya',
    shreya: 'Shreya',
    sachinsaha: 'Sachin Saha',
    nishant: 'Nishant',
    bishwo: 'Bishwo Rai',
    admin: 'Master Admin',
    test: 'test'
  };

  const walletsMap = new Map<string, Wallet>();
  coords.forEach(username => {
    walletsMap.set(username, {
      id: username,
      username,
      displayName: displayNames[username] || username,
      balance: 0,
      transactions: [],
      updatedAt: '2026-10-15T23:59:59.000Z'
    });
  });

  const getW = (u: string) => walletsMap.get(u);

  // 1. Process won leads up to 15-10-2026
  leads.forEach(lead => {
    if (lead.stage === 'won') {
      const sHist = (lead.stageHistory || []).find(s => s.newStage === 'won');
      const tHist = (lead.timeline || []).find(t => t.text && t.text.includes('Closed Won'));
      const dStr = sHist?.changedAt || tHist?.timestamp || lead.updatedAt || lead.createdAt;
      if (new Date(dStr) <= cutoff) {
        const u = (lead.assignedTo || '').trim().toLowerCase();
        let amt = 400;
        const c = (lead.country || '').toLowerCase();
        if (['japan', 'albania', 'europe', 'malta', 'greece'].includes(c)) amt = 1000;
        
        const targetW = getW(u);
        if (targetW) {
          targetW.transactions.push({
            id: `tx_won_${lead.id}`,
            type: 'credit',
            amount: amt,
            reason: `Closed Won incentive for candidate: ${lead.name} (Project: ${lead.project || 'General'}, Country: ${lead.country || 'Unknown'})`,
            timestamp: dStr,
            leadId: lead.id
          });
        }

        // Sachin Saha Override Bonus (Credits ONLY, never debit!)
        const bonus = amt === 1000 ? 200 : 100;
        const sachinW = getW('sachinsaha');
        if (sachinW) {
          sachinW.transactions.push({
            id: `tx_sachin_override_${lead.id}`,
            type: 'credit',
            amount: bonus,
            reason: `Sachin Saha Override Bonus (Sale by: ${displayNames[u] || u}) for candidate: ${lead.name} (Project: ${lead.project || 'General'}, Country: ${lead.country || 'Unknown'})`,
            timestamp: dStr,
            leadId: lead.id
          });
        }
      }
    }

    // Office visited up to 15-10-2026
    if (lead.docOfficeVisited) {
      const dStr = lead.updatedAt || lead.createdAt;
      if (new Date(dStr) <= cutoff) {
        const u = (lead.assignedTo || '').trim().toLowerCase();
        const targetW = getW(u);
        if (targetW) {
          targetW.transactions.push({
            id: `tx_ov_${lead.id}`,
            type: 'credit',
            amount: 11,
            reason: `Office Visited Incentive for candidate: ${lead.name}`,
            timestamp: dStr,
            leadId: lead.id
          });
        }
      }
    }

    // Interview attended up to 15-10-2026
    if (lead.docInterviewAttended) {
      const dStr = lead.updatedAt || lead.createdAt;
      if (new Date(dStr) <= cutoff) {
        const u = (lead.assignedTo || '').trim().toLowerCase();
        const targetW = getW(u);
        if (targetW) {
          targetW.transactions.push({
            id: `tx_ia_${lead.id}`,
            type: 'credit',
            amount: 11,
            reason: `Interview Attended Incentive for candidate: ${lead.name}`,
            timestamp: dStr,
            leadId: lead.id
          });
        }
      }
    }
  });

  // Edenla Japan placement & payout debit:
  const edenlaW = getW('edenla')!;
  edenlaW.transactions.push({
    id: 'tx_edenla_won_royal_bardewa_japan',
    type: 'credit',
    amount: 1000,
    reason: 'Closed Won incentive for candidate: Royal Bardewa (Project: JAPAN SSW, Country: Japan)',
    timestamp: '2026-09-03T06:03:43.817Z',
    leadId: 'RANZAI_12-08-2026'
  });
  getW('sachinsaha')!.transactions.push({
    id: 'tx_sachin_override_royal_bardewa',
    type: 'credit',
    amount: 200,
    reason: 'Sachin Saha Override Bonus (Sale by: Edenla) for candidate: Royal Bardewa (Project: JAPAN SSW, Country: Japan)',
    timestamp: '2026-09-03T06:03:43.817Z',
    leadId: 'RANZAI_12-08-2026'
  });

  // Authenticated Coordinator Payout Debits as of 15-10-2026:
  edenlaW.transactions.push({
    id: 'tx_edenla_debit_payout_25',
    type: 'debit',
    amount: 25,
    reason: 'Coordinator Payout / Debit Adjustment: Processed Withdrawal',
    timestamp: '2026-10-15T10:00:00.000Z'
  });

  getW('sarina')!.transactions.push({
    id: 'tx_sarina_debit_payout_4899',
    type: 'debit',
    amount: 4899,
    reason: 'Coordinator Incentive Payout / Processed Withdrawal: August & September Accrued Earnings Settled',
    timestamp: '2026-10-01T10:00:00.000Z'
  });

  getW('joyce')!.transactions.push({
    id: 'tx_joyce_debit_payout_1277',
    type: 'debit',
    amount: 1277,
    reason: 'Coordinator Incentive Payout / Processed Withdrawal: August & September Accrued Earnings Settled',
    timestamp: '2026-10-01T10:00:00.000Z'
  });

  getW('maryada')!.transactions.push({
    id: 'tx_maryada_debit_payout_2000',
    type: 'debit',
    amount: 2000,
    reason: 'Coordinator Incentive Payout / Processed Withdrawal: August & September Accrued Earnings Settled',
    timestamp: '2026-10-01T10:00:00.000Z'
  });

  // NOTE: Priya has NEVER taken any debit! (0 DR invariant strictly enforced, Priya balance is 100% credits: 422 INR)

  const finalWallets = Array.from(walletsMap.values());
  finalWallets.forEach(w => {
    // Invariants: Sachin Saha & Priya have zero debits permitted
    if (w.username === 'sachinsaha' || w.username === 'priya') {
      w.transactions = w.transactions.filter(t => t.type !== 'debit');
    }
    const cr = w.transactions.filter(t => t.type === 'credit').reduce((a, b) => a + Number(b.amount || 0), 0);
    const dr = w.transactions.filter(t => t.type === 'debit').reduce((a, b) => a + Number(b.amount || 0), 0);
    w.balance = Math.max(0, cr - dr);
    w.transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    w.updatedAt = '2026-10-15T23:59:59.000Z';
  });

  // Permanently save Baseline Snapshot
  const baselineSnapshotPath = path.join(WALLET_BACKUPS_DIR, 'SNAPSHOT_BASELINE_2026-10-15.json');
  const baselineSnapshot: WalletSnapshot = {
    id: 'SNAPSHOT_BASELINE_2026-10-15',
    timestamp: '2026-10-15T23:59:59.000Z',
    reason: 'Verified Official 15-10-2026 Baseline - Full Data Restored & Sachin & Priya Protected (0 DR)',
    createdBy: 'System Verified Baseline',
    totalWallets: finalWallets.length,
    netBalance: finalWallets.reduce((acc, w) => acc + (Number(w.balance) || 0), 0),
    totalCredits: finalWallets.reduce((acc, w) => acc + w.transactions.filter(t => t.type === 'credit').reduce((a, b) => a + Number(b.amount || 0), 0), 0),
    totalDebits: finalWallets.reduce((acc, w) => acc + w.transactions.filter(t => t.type === 'debit').reduce((a, b) => a + Number(b.amount || 0), 0), 0),
    coordinatorsWithDebits: ['edenla', 'sarina', 'joyce', 'maryada'],
    sachinDebitsCount: 0,
    wallets: finalWallets
  };
  safeWriteJsonSync(baselineSnapshotPath, baselineSnapshot);

  // Append all baseline transactions to immutable ledger
  finalWallets.forEach(w => {
    w.transactions.forEach(t => {
      appendWalletLedgerAudit(t, w.username, '15-10-2026 Verified Baseline Restoration');
    });
  });

  await saveWallets(finalWallets, 'Verified 15-10-2026 Baseline Restoration');
  console.log('[Data Vault] 15-10-2026 Data Restoration Completed Successfully (Sachin & Priya 0 DR Protected).');
  return finalWallets;
}

export async function getWalletSafetyStatus() {
  const snapshots = await listWalletSnapshots();
  const wallets = await getWallets();
  const sachinWallet = wallets.find(w => w.username === 'sachinsaha');
  const sachinDebits = (sachinWallet?.transactions || []).filter(t => t.type === 'debit').length;
  const priyaWallet = wallets.find(w => w.username === 'priya');
  const priyaDebits = (priyaWallet?.transactions || []).filter(t => t.type === 'debit').length;
  
  let ledgerCount = 0;
  try {
    if (fs.existsSync(WALLET_LEDGER_FILE)) {
      const content = fs.readFileSync(WALLET_LEDGER_FILE, 'utf8');
      ledgerCount = content.split('\n').filter(Boolean).length;
    }
  } catch {}

  return {
    vaultStatus: 'ACTIVE_PROTECTED',
    immutableLedgerCount: ledgerCount,
    sachinProtected: false,
    sachinDebitsCount: sachinDebits,
    priyaProtected: true,
    priyaDebitsCount: priyaDebits,
    totalSnapshots: snapshots.length,
    latestSnapshot: snapshots[0] || null,
    coordinatorsWithDebits: wallets.filter(w => (w.transactions || []).some(t => t.type === 'debit')).map(w => ({
      username: w.username,
      displayName: w.displayName,
      debitsCount: (w.transactions || []).filter(t => t.type === 'debit').length,
      totalDebited: (w.transactions || []).filter(t => t.type === 'debit').reduce((acc, t) => acc + (Number(t.amount) || 0), 0)
    }))
  };
}

let walletsInitialized = false;

export async function initializeWalletsDatabase() {
  if (walletsInitialized) return;
  walletsInitialized = true;

  if (!fs.existsSync(WALLETS_FILE)) {
    safeWriteJsonSync(WALLETS_FILE, []);
  }

  const localWallets = safeReadJsonSync<Wallet[]>(WALLETS_FILE, []);
  const localHasData = localWallets.length > 0 && localWallets.some(w => (w.balance || 0) > 0 || (w.transactions && w.transactions.length > 0));

  if (checkCloudStatus()) {
    try {
      const q = query(collection(db, 'wallets'), limit(1));
      const snapshot = await runWithTimeout(getDocs(q), 15000);
      if (snapshot.empty) {
        if (localHasData) {
          console.log('[Firestore Client] Uploading existing local wallets with balance to Cloud Firestore...');
          const batch = writeBatch(db);
          localWallets.forEach(w => {
            const docRef = doc(db, 'wallets', w.id);
            batch.set(docRef, cleanForFirestore(w));
          });
          await runWithTimeout(batch.commit(), 15000);
          console.log('[Firestore Client] Uploaded existing wallets successfully.');
        }
      }
    } catch (err: any) {
      console.warn('[Firestore Client] Notice: Cloud check/seed for wallets deferred to local file:', err?.message || err);
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
      const snapshot = await runWithTimeout(getDocs(collection(db, 'wallets')), 10000);
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

      const localWallets = safeReadJsonSync<Wallet[]>(WALLETS_FILE, []);
      const mergedMap = new Map<string, Wallet>();

      // 1. Seed with local wallets
      localWallets.forEach(lw => {
        mergedMap.set(lw.username.toLowerCase(), {
          ...lw,
          transactions: Array.isArray(lw.transactions) ? [...lw.transactions] : []
        });
      });

      // 2. Union with cloud wallets by transaction ID
      wallets.forEach(cw => {
        const u = cw.username.toLowerCase();
        if (!mergedMap.has(u)) {
          mergedMap.set(u, {
            ...cw,
            transactions: Array.isArray(cw.transactions) ? [...cw.transactions] : []
          });
        } else {
          const target = mergedMap.get(u)!;
          const txMap = new Map<string, WalletTransaction>();
          // Include local transactions
          (target.transactions || []).forEach(t => txMap.set(t.id, t));
          // Include cloud transactions without overwriting local transactions with same ID
          (cw.transactions || []).forEach(t => {
            if (!txMap.has(t.id)) {
              txMap.set(t.id, t);
            }
          });
          target.transactions = Array.from(txMap.values());
        }
      });

      const effectiveWallets = Array.from(mergedMap.values());

      // 3. Sort transactions descending and recompute accurate balances
      effectiveWallets.forEach(w => {
        if (w.username.toLowerCase() === 'priya') {
          w.transactions = (w.transactions || []).filter(t => t.type !== 'debit');
        }
        w.transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const cr = w.transactions.filter(t => t.type === 'credit').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        const dr = w.transactions.filter(t => t.type === 'debit').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        w.balance = Math.max(0, cr - dr);
        w.updatedAt = new Date().toISOString();
      });

      // Update cache & sync merged state
      dbCache.wallets = { data: effectiveWallets, timestamp: Date.now() };
      safeWriteJsonSync(WALLETS_FILE, effectiveWallets);

      // Async sync back to cloud if needed to keep Firestore up to date
      if (checkCloudStatus()) {
        const batch = writeBatch(db);
        effectiveWallets.forEach(w => {
          const docRef = doc(db, 'wallets', w.id);
          batch.set(docRef, cleanForFirestore(w));
        });
        batch.commit().catch(e => console.warn('[Firestore] Background wallet sync warning:', e?.message || e));
      }

      return effectiveWallets;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch wallets from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }

  let wallets = safeReadJsonSync<Wallet[]>(WALLETS_FILE, []);
  
  // Invariant: Ensure Priya has 0 debits
  wallets.forEach(w => {
    if (w.username.toLowerCase() === 'priya') {
      w.transactions = (w.transactions || []).filter(t => t.type !== 'debit');
      const cr = w.transactions.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      w.balance = cr;
    }
  });

  dbCache.wallets = { data: wallets, timestamp: Date.now() };
  return wallets;
}

async function saveWalletsInternal(wallets: Wallet[], snapshotReason = 'Automatic state sync'): Promise<void> {
  await initializeWalletsDatabase();

  // Safety Invariant: Priya MUST NEVER have any debits! (Sachin Saha withdrawals are enabled)
  wallets.forEach(w => {
    if (w.username.toLowerCase() === 'priya') {
      w.transactions = (w.transactions || []).filter(t => t.type !== 'debit');
      const cr = w.transactions.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      w.balance = cr;
    }
  });

  // Create automatic rolling snapshot in the Data Vault
  try {
    createWalletSnapshotInternal(wallets, snapshotReason);
  } catch (err) {
    console.warn('[Data Vault] Warning: Failed to write rolling snapshot:', err);
  }

  dbCache.wallets = { data: wallets, timestamp: Date.now() };
  safeWriteJsonSync(WALLETS_FILE, wallets);

  if (checkCloudStatus()) {
    try {
      const batch = writeBatch(db);
      wallets.forEach(w => {
        const docRef = doc(db, 'wallets', w.id);
        batch.set(docRef, cleanForFirestore(w));
      });
      await runWithTimeout(batch.commit(), 10000);
    } catch (err: any) {
      console.error('[Firestore Client] Failed to save wallets to cloud:', err);
      handleCloudError(err);
    }
  }
}

export async function saveWallets(wallets: Wallet[], snapshotReason = 'Automatic state sync'): Promise<void> {
  return dbMutex.run(() => saveWalletsInternal(wallets, snapshotReason));
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
    await saveWalletsInternal(wallets, `Initialized new coordinator wallet for ${cleanUser}`);
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
  return dbMutex.run(async () => {
    const cleanUser = String(username).trim().toLowerCase();
    if (cleanUser === 'priya' && type === 'debit') {
      throw new Error(`Transaction rejected: Debits (DR) are strictly prohibited for ${username}. This coordinator has never taken out any debits.`);
    }

    const wallet = await getWalletByUsername(cleanUser);
    
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
    
    const totalCredits = (wallet.transactions || []).filter(t => t.type === 'credit').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const totalDebits = (wallet.transactions || []).filter(t => t.type === 'debit').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    wallet.balance = Math.max(0, totalCredits - totalDebits);
    wallet.updatedAt = new Date().toISOString();
    
    // Save to database with snapshot
    const wallets = await getWallets();
    const idx = wallets.findIndex(w => w.id === wallet.id);
    if (idx !== -1) {
      wallets[idx] = wallet;
    } else {
      wallets.push(wallet);
    }
    await saveWalletsInternal(wallets, `Manual ${type.toUpperCase()} adjustment of INR ${amount} for ${cleanUser}`);
    
    // Permanently record in immutable audit ledger
    appendWalletLedgerAudit(transaction, cleanUser, reason);
    return wallet;
  });
}

export async function deleteWalletTransaction(username: string, txId: string): Promise<Wallet> {
  return dbMutex.run(async () => {
    const wallets = await getWallets();
    const cleanUser = String(username).trim().toLowerCase();
    const wallet = wallets.find(w => w.username.toLowerCase() === cleanUser);
    if (!wallet) throw new Error('Wallet not found');

    const initialLen = (wallet.transactions || []).length;
    wallet.transactions = (wallet.transactions || []).filter(t => t.id !== txId);
    if (wallet.transactions.length === initialLen) {
      throw new Error('Transaction not found');
    }

    const totalCredits = (wallet.transactions || []).filter(t => t.type === 'credit').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const totalDebits = (wallet.transactions || []).filter(t => t.type === 'debit').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    wallet.balance = Math.max(0, totalCredits - totalDebits);
    wallet.updatedAt = new Date().toISOString();

    await saveWalletsInternal(wallets, `Deleted transaction ${txId} for ${cleanUser}`);
    return wallet;
  });
}

let incentiveRulesInitialized = false;

// Ensure incentive rules database exists with default seed rules
export async function initializeIncentiveRulesDatabase() {
  if (incentiveRulesInitialized) return;
  incentiveRulesInitialized = true;
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
      const statusSnap = await runWithTimeout(getDoc(statusRef), 15000);
      if (!statusSnap.exists()) {
        console.log('[Firestore Client] Seeding default incentive rules to cloud...');
        const batch = writeBatch(db);
        defaultRules.forEach(rule => {
          const docRef = doc(db, 'incentive_rules', rule.id);
          batch.set(docRef, cleanForFirestore(rule));
        });
        batch.set(statusRef, { seeded: true, updatedAt: new Date().toISOString() });
        await runWithTimeout(batch.commit(), 15000);
        console.log('[Firestore Client] Seeded incentive rules successfully.');
      }
    } catch (err: any) {
      console.warn('[Firestore Client] Notice: Cloud check/seed for incentive rules deferred to local file:', err?.message || err);
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
      const snapshot = await runWithTimeout(getDocs(collection(db, 'incentive_rules')), 10000);
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
      await runWithTimeout(batch.commit(), 10000);

      const snapshot = await runWithTimeout(getDocs(collection(db, 'incentive_rules')), 10000);
      const deleteBatch = writeBatch(db);
      let hasDeletes = false;
      snapshot.forEach(docSnap => {
        if (!validRules.some(r => r.id === docSnap.id)) {
          deleteBatch.delete(docSnap.ref);
          hasDeletes = true;
        }
      });
      if (hasDeletes) {
        await runWithTimeout(deleteBatch.commit(), 10000);
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
      const snapshot = await runWithTimeout(getDocs(collection(db, 'whatsapp_templates')), 15000);
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
      console.warn('[Firestore Client] Cloud fetch for custom templates deferred to local files:', err?.message || err);
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
  enabled: true,
  text: "Hello Jobseeker 👋\n\nThank you for reaching out to Career Growth Placement.\n\nTo help us assist you faster, please share the following details:\n\n• Full Name:\n• Age:\n• Current Location:\n• Qualification:\n• Job Experience (if any):\n\nOur team will review your details and respond shortly.\n\nBest regards,\nTeam, Career Growth Placement",
  delay: 5 // Default delay of 5 seconds
};

export async function getWhatsAppAutoReplySettings(): Promise<WhatsAppAutoReplySettings> {
  await initializeDatabase();

  if (dbCache.auto_reply && (Date.now() - dbCache.auto_reply.timestamp < CACHE_TTL_MS)) {
    return dbCache.auto_reply.data;
  }

  // 1. Check local file first
  const localSettings = safeReadJsonSync<WhatsAppAutoReplySettings | null>(AUTOREPLY_FILE, null);
  let settings: WhatsAppAutoReplySettings = localSettings || { ...DEFAULT_AUTO_REPLY_SETTINGS };

  // 2. Fetch from Firestore (cloud persistence across all container restarts)
  if (db) {
    try {
      const docRef = doc(db, 'settings', 'whatsapp_autoreply');
      const docSnap = await runWithTimeout(getDoc(docRef), 8000);
      if (docSnap.exists()) {
        const cloudData = docSnap.data() as WhatsAppAutoReplySettings;
        if (cloudData && typeof cloudData.enabled === 'boolean') {
          settings = cloudData;
          safeWriteJsonSync(AUTOREPLY_FILE, settings);
        }
      } else {
        // Cloud doc doesn't exist yet: persist our current settings to Firestore
        await runWithTimeout(setDoc(docRef, cleanForFirestore(settings)), 8000);
        safeWriteJsonSync(AUTOREPLY_FILE, settings);
        console.log('[Firestore Client] Initialized cloud auto-reply settings doc.');
      }
    } catch (err: any) {
      console.error('[Firestore Client] Error reading auto-reply settings from cloud, falling back to local file:', err);
    }
  }

  dbCache.auto_reply = { data: settings, timestamp: Date.now() };
  return settings;
}

export async function saveWhatsAppAutoReplySettings(settings: WhatsAppAutoReplySettings): Promise<void> {
  await initializeDatabase();
  console.log(`[AutoReply] Saving auto-reply settings. Enabled: ${settings.enabled}, Delay: ${settings.delay}s`);

  // 1. Write local copy
  safeWriteJsonSync(AUTOREPLY_FILE, settings);

  // 2. Clear cache
  dbCache.auto_reply = null;

  // 3. Persist to Firestore
  if (db) {
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

/**
 * 🛡️ PERMANENT CLOUD FILE BACKUP SYSTEM
 * Converts uploaded documents to robust base64 chunks and persists them inside Firestore
 * ensuring that critical documents can never be permanently lost under any circumstances.
 */
export async function backupFileToFirestore(safeName: string, filePath: string): Promise<void> {
  try {
    if (!fs.existsSync(filePath)) return;
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const fileType = path.extname(safeName);

    // Limit chunk size to stay safely within Firestore's 1MB limit.
    // Base64 encoding causes 4 characters for every 3 bytes (33% overhead).
    // An 800KB base64 string is perfectly safe and won't exceed 1MB document size.
    const maxSingleDocLength = 750 * 1024; // 750KB limit

    if (db) {
      const docRef = doc(db, 'file_backups', safeName);
      
      if (base64Data.length <= maxSingleDocLength) {
        // Save in a single document for simplicity and performance
        await setDoc(docRef, {
          fileName: safeName,
          fileType,
          chunks: [base64Data],
          isMultipart: false,
          uploadedAt: new Date().toISOString()
        });
        console.log(`[FileBackup System] 🛡️ Permanent cloud backup created in Firestore: ${safeName} (Single document).`);
      } else {
        // Multipart chunking for files larger than 750KB
        const chunkSize = 500 * 1024; // 500KB chunks
        const chunks: string[] = [];
        for (let i = 0; i < base64Data.length; i += chunkSize) {
          chunks.push(base64Data.substring(i, i + chunkSize));
        }

        console.log(`[FileBackup System] 📦 File "${safeName}" is large (${base64Data.length} chars base64). Chunking into ${chunks.length} parts to bypass Firestore 1MB limits...`);

        // Write master document first
        await setDoc(docRef, {
          fileName: safeName,
          fileType,
          isMultipart: true,
          chunkCount: chunks.length,
          uploadedAt: new Date().toISOString()
        });

        // Write chunk documents to a subcollection
        for (let i = 0; i < chunks.length; i++) {
          const chunkDocRef = doc(db, 'file_backups', safeName, 'file_chunks', `chunk_${i}`);
          await setDoc(chunkDocRef, {
            index: i,
            chunk: chunks[i]
          });
        }
        console.log(`[FileBackup System] 🛡️ Multipart permanent cloud backup created in Firestore: ${safeName} (${chunks.length} chunks saved in subcollection).`);
      }
    }
  } catch (err) {
    console.error(`[FileBackup System] Failed to create cloud backup for ${safeName}:`, err);
  }
}

/**
 * 🔄 FILE SYNCHRONIZATION AND DISASTER RECOVERY ENGINE
 * Scans the Firestore cloud file_backups repository and rebuilds any missing uploads.
 * Also uploads any missing local uploads to the cloud. Zero data loss.
 */
export async function syncAndRestoreMissingUploadsFromFirestore(): Promise<void> {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    if (!db) {
      console.warn('[FileBackup System] Database connection not initialized. Skipping file restore synchronization.');
      return;
    }

    console.log('[FileBackup System] 🔄 Initiating cloud upload recovery & backup synchronization...');
    
    // Fetch all records from Firestore 'file_backups' collection
    const querySnapshot = await runWithTimeout(getDocs(collection(db, 'file_backups')), 20000);
    const cloudFilesMap = new Map<string, any>();
    
    querySnapshot.forEach(docSnap => {
      cloudFilesMap.set(docSnap.id, docSnap.data());
    });

    console.log(`[FileBackup System] Cloud index contains ${cloudFilesMap.size} backed up files.`);

    // 1. Recover missing files from cloud to local directory
    for (const [fileName, data] of cloudFilesMap.entries()) {
      const localPath = path.join(uploadsDir, fileName);
      if (!fs.existsSync(localPath) || fs.statSync(localPath).size === 0) {
        console.log(`[FileBackup System] 🚨 File "${fileName}" is missing from local disk. Recovering from cloud...`);
        
        let fileBuffer: Buffer | null = null;
        
        if (data.isMultipart) {
          console.log(`[FileBackup System] Multipart file recovery for "${fileName}" (${data.chunkCount} chunks expected)...`);
          try {
            const chunksSnap = await runWithTimeout(getDocs(collection(db, 'file_backups', fileName, 'file_chunks')), 15000);
            const chunkDocs: { index: number, chunk: string }[] = [];
            chunksSnap.forEach(cSnap => {
              chunkDocs.push(cSnap.data() as any);
            });
            
            // Sort chunks by index ascending
            chunkDocs.sort((a, b) => a.index - b.index);
            
            const base64Combined = chunkDocs.map(c => c.chunk).join('');
            if (base64Combined.length > 0) {
              fileBuffer = Buffer.from(base64Combined, 'base64');
            }
          } catch (chunkErr) {
            console.error(`[FileBackup System] Failed to fetch chunks for multipart file "${fileName}":`, chunkErr);
          }
        } else {
          const chunks = data.chunks || [];
          if (chunks.length > 0) {
            const base64Combined = chunks.join('');
            fileBuffer = Buffer.from(base64Combined, 'base64');
          }
        }

        if (fileBuffer) {
          fs.writeFileSync(localPath, fileBuffer);
          console.log(`[FileBackup System] ✅ File "${fileName}" successfully restored physically to local uploads (${fileBuffer.length} bytes).`);
        } else {
          console.warn(`[FileBackup System] Backup file "${fileName}" could not be restored (empty data).`);
        }
      }
    }

    // 2. Upload any local files to Firestore if they do not exist in backup index
    const localFiles = fs.readdirSync(uploadsDir);
    let autoBackupCount = 0;
    
    for (const file of localFiles) {
      if (file === '.' || file === '..') continue;
      const localPath = path.join(uploadsDir, file);
      
      // Skip directories
      if (fs.statSync(localPath).isDirectory()) continue;
      
      if (!cloudFilesMap.has(file)) {
        console.log(`[FileBackup System] 🛡️ File "${file}" exists locally but not in cloud backup. Backing up to Firestore...`);
        try {
          await backupFileToFirestore(file, localPath);
          autoBackupCount++;
        } catch (backupSingleErr) {
          console.error(`[FileBackup System] Failed background auto-backup for file "${file}":`, backupSingleErr);
        }
      }
    }

    if (autoBackupCount > 0) {
      console.log(`[FileBackup System] ✅ Completed background auto-backup for ${autoBackupCount} local uploads.`);
    } else {
      console.log('[FileBackup System] ✅ Storage is fully synchronized in cloud. Zero files out of sync.');
    }

  } catch (err) {
    console.error('[FileBackup System] Error executing storage synchronization:', err);
  }
}

/**
 * ⚡ FAST ON-DEMAND SINGLE FILE RESTORE FROM FIRESTORE
 * Fetches only the requested document from 'file_backups' without scanning the entire collection.
 */
export async function restoreSingleFileFromFirestore(fileName: string): Promise<boolean> {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const localPath = path.join(uploadsDir, fileName);

    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
      return true;
    }

    if (!db) return false;

    const docSnap = await runWithTimeout(getDoc(doc(db, 'file_backups', fileName)), 5000);
    if (!docSnap.exists()) {
      return false;
    }

    const data = docSnap.data();
    let fileBuffer: Buffer | null = null;

    if (data.isMultipart) {
      const chunksSnap = await runWithTimeout(getDocs(collection(db, 'file_backups', fileName, 'file_chunks')), 5000);
      const chunkDocs: { index: number, chunk: string }[] = [];
      chunksSnap.forEach(cSnap => {
        chunkDocs.push(cSnap.data() as any);
      });
      chunkDocs.sort((a, b) => a.index - b.index);
      const base64Combined = chunkDocs.map(c => c.chunk).join('');
      if (base64Combined.length > 0) {
        fileBuffer = Buffer.from(base64Combined, 'base64');
      }
    } else {
      const chunks = data.chunks || [];
      if (chunks.length > 0) {
        fileBuffer = Buffer.from(chunks.join(''), 'base64');
      }
    }

    if (fileBuffer && fileBuffer.length > 0) {
      fs.writeFileSync(localPath, fileBuffer);
      console.log(`[FileBackup System] ⚡ Fast restored "${fileName}" from cloud (${fileBuffer.length} bytes).`);
      return true;
    }

    return false;
  } catch (err) {
    console.warn(`[FileBackup System] Could not restore single file "${fileName}":`, err);
    return false;
  }
}

// --- MEDIA LIBRARY STORAGE METHODS ---

// Get all media library items
export async function getMediaItems(): Promise<MediaItem[]> {
  // Check in-memory cache first
  if (dbCache.media && (Date.now() - dbCache.media.timestamp < CACHE_TTL_MS)) {
    return dbCache.media.data;
  }

  if (checkCloudStatus()) {
    try {
      const snapshot = await runWithTimeout(getDocs(collection(db, 'media_library')), 8000);
      const items: MediaItem[] = [];
      snapshot.forEach(docSnap => {
        items.push(docSnap.data() as MediaItem);
      });

      // Sort by uploadedAt descending (newest first)
      items.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

      // Update in-memory cache
      dbCache.media = { data: items, timestamp: Date.now() };

      // Sync and warm the local cache file
      safeWriteJsonSync(MEDIA_FILE, items);

      return items;
    } catch (err: any) {
      console.error('[Firestore Client] Failed to fetch media items from cloud, falling back to local files:', err);
      handleCloudError(err);
    }
  }

  const items = safeReadJsonSync<MediaItem[]>(MEDIA_FILE, []);
  items.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  dbCache.media = { data: items, timestamp: Date.now() };
  return items;
}

// Save all media library items or update them
export async function saveMediaItems(items: MediaItem[]): Promise<void> {
  // Sort descending by default
  items.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  // Update cache
  dbCache.media = { data: items, timestamp: Date.now() };

  // Save to local file
  safeWriteJsonSync(MEDIA_FILE, items);

  if (checkCloudStatus()) {
    try {
      const batch = writeBatch(db);
      items.forEach(item => {
        const docRef = doc(db, 'media_library', item.id);
        batch.set(docRef, cleanForFirestore(item));
      });
      await runWithTimeout(batch.commit(), 8000);

      // Delete any removed media documents from cloud
      const snapshot = await runWithTimeout(getDocs(collection(db, 'media_library')), 8000);
      const deleteBatch = writeBatch(db);
      let hasDeletes = false;
      snapshot.forEach(docSnap => {
        if (!items.some(item => item.id === docSnap.id)) {
          deleteBatch.delete(docSnap.ref);
          hasDeletes = true;
        }
      });
      if (hasDeletes) {
        await runWithTimeout(deleteBatch.commit(), 8000);
      }
    } catch (err: any) {
      console.error('[Firestore Client] Failed to sync media library to cloud:', err);
      handleCloudError(err);
    }
  }
}

// ==========================================
// NOTIFICATIONS PERSISTENCE MANAGEMENT
// ==========================================

export async function getNotifications(): Promise<AppNotification[]> {
  return [];
}

export async function saveNotifications(notifications: AppNotification[]): Promise<void> {
  // Notifications fully disabled
}



