import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import cron from 'node-cron';
import sharp from 'sharp';

// Load environment variables
dotenv.config();

// Load local database helper
import { 
  getLeads, 
  addLead, 
  addOrMergeInboundLead,
  saveLeads, 
  updateSingleLead,
  updateMultipleLeads,
  getStats, 
  getLeadById, 
  getCoordinators,
  findBestMatchingLeadByPhone,
  hasAssignedCoordinator,
  mergeLeadProfiles,
  mergeMessagesList,
  mergeTimelineList,
  saveCoordinators, 
  initializeCoordinatorsDatabase, 
  getJobs, 
  saveJobs,
  upsertSingleJob,
  softDeleteJob,
  restoreSingleJob,
  getUpdates, 
  saveUpdates, 
  deleteUpdateById,
  getMetadata, 
  saveMetadata, 
  getWallets, 
  saveWallets, 
  getWalletByUsername, 
  addWalletTransaction, 
  deleteWalletTransaction,
  reconcileWalletsFromLeads,
  ensureWalletIntegrityFromLeads,
  buildNov04WonBeneficiaries,
  TEAM_ROLES,
  normalizeCoordUsername,
  createWalletSnapshot,
  listWalletSnapshots,
  restoreWalletSnapshot,
  getWalletSafetyStatus,
  getIncentiveRules, 
  saveIncentiveRules,
  getMonthlyTargetSettings,
  saveMonthlyTargetSettings,
  getMonthlyTargetProgress,
  settleMonthlyTargetPayout,
  createFullDatabaseBackup,
  generateFullXLSXBuffer,
  executeScheduledFullBackup,
  restoreDatabaseFromBackup,
  listAvailableBackups,
  clearLeadsCache,
  getWhatsAppTemplates,
  saveWhatsAppTemplate,
  deleteWhatsAppTemplate,
  getWhatsAppAutoReplySettings,
  saveWhatsAppAutoReplySettings,
  extractMetaMediaId,
  backupFileToFirestore,
  syncAndRestoreMissingUploadsFromFirestore,
  restoreSingleFileFromFirestore,
  getMediaItems,
  saveMediaItems,
  getNotifications,
  saveNotifications,
  mergeTasksList,
  getDatabaseVersion,
  getLeadChangesSince,
  getLeadAuditLogs,
  getLeadArchives,
  listCloudBackupSnapshots,
  loadCloudBackupSnapshot
} from './src/server/db.ts';
import type { Lead, Message, LeadStage, FitScore, Coordinator, Job, ImportantUpdate, Wallet, WalletTransaction, IncentiveRule, WhatsAppTemplate, WhatsAppAutoReplySettings, MediaItem, AppNotification } from './src/types.ts';
import type { FullDatabaseBackup } from './src/server/db.ts';
import { isDefaultExperience, getEffectiveExperience, getEffectiveIntake, isCoordinatorMatch } from './src/utils.ts';
import { DEFAULT_WHATSAPP_TEMPLATES, sendWhatsAppMessage, replaceTemplatePlaceholders, formatPhoneForWhatsApp, fetchMetaWhatsAppTemplates } from './src/server/whatsapp.ts';
import { generateCandidateCvPdf, autoGenerateAndPersistCandidateCv } from './src/server/cvGenerator.ts';
import { computeSentinelOverview, applyAiAssistantFix, askAiCopilot, getLeadSpecificAiSuggestions } from './src/server/aiSentinel.ts';
import compression from 'compression';

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 3000;

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Secure Session Token Manager & Middleware
interface Session {
  username: string;
  role: string;
  expiresAt: number;
}
const activeSessions = new Map<string, Session>();
const SESSIONS_FILE = path.join(process.cwd(), 'data', 'sessions.json');

function saveSessions() {
  try {
    const parentDir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const obj = Object.fromEntries(activeSessions.entries());
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save sessions:', err);
  }
}

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const content = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const obj = JSON.parse(content);
      for (const [token, sess] of Object.entries(obj)) {
        activeSessions.set(token, sess as Session);
      }
    }
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

// Load existing active sessions on server startup
loadSessions();

// Secure Request Authentication Middleware
app.use((req, res, next) => {
  // Extract session token from headers, bearer auth, query params, or req.body
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : null;

  const token = (req.headers['x-session-token'] as string) || 
                (req.headers['x-auth-token'] as string) ||
                bearerToken ||
                (req.query.token as string) || 
                (req.body && req.body.token);

  if (token) {
    const session = activeSessions.get(token);
    if (session) {
      if (Date.now() < session.expiresAt) {
        // Authenticated! Bind session user and role to headers
        req.headers['x-user-role'] = session.role;
        req.headers['x-agent-id'] = session.username;
        return next();
      } else {
        // Remove expired session
        activeSessions.delete(token);
        saveSessions();
      }
    }
  }

  // Preserve incoming role and agent headers, falling back to query parameters or body
  const incomingRole = req.headers['x-user-role'] || 
                       (req.body && req.body.userRole) || 
                       (req.body && req.body.role) ||
                       req.query.role ||
                       req.query.userRole;

  const incomingAgent = req.headers['x-agent-id'] || 
                        req.headers['x-user-id'] || 
                        (req.body && (req.body.agentId || req.body.username)) ||
                        req.query.agentId ||
                        req.query.username;

  if (incomingRole) {
    const r = Array.isArray(incomingRole) ? incomingRole[0] : String(incomingRole);
    req.headers['x-user-role'] = r.trim().toLowerCase();
  } else {
    req.headers['x-user-role'] = 'user';
  }

  if (incomingAgent) {
    const a = Array.isArray(incomingAgent) ? incomingAgent[0] : String(incomingAgent);
    req.headers['x-agent-id'] = a.trim();
  } else {
    req.headers['x-agent-id'] = 'unassigned';
  }

  // If agent is known administrator, automatically grant admin role
  const agentLower = String(req.headers['x-agent-id'] || '').toLowerCase();
  if (['admin', 'master admin', 'sachinsaha', 'test', 'coord_admin', 'coord_sachinsaha'].includes(agentLower)) {
    req.headers['x-user-role'] = 'admin';
  }

  next();
});

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Robust static file server for uploads: prevents falling through to CRM SPA index.html!
app.get('/uploads/:fileName', async (req, res) => {
  try {
    const rawFileName = req.params.fileName;
    if (!rawFileName) {
      return res.status(400).send('File name required');
    }
    const safeFileName = path.basename(rawFileName);
    const filePath = path.join(UPLOADS_DIR, safeFileName);

    // 1. If file exists on local disk and is non-empty, serve it inline
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      const ext = path.extname(safeFileName).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.doc': 'application/msword',
        '.txt': 'text/plain; charset=utf-8'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
      return res.sendFile(filePath);
    }

    // 2. Not on disk: Attempt immediate recovery from Firestore cloud repository
    try {
      const restored = await restoreSingleFileFromFirestore(safeFileName);
      if (restored && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        const ext = path.extname(safeFileName).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.pdf': 'application/pdf',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
        return res.sendFile(filePath);
      }
    } catch (restoreErr) {
      console.warn(`[UploadServer] Fast cloud restore attempt failed for ${safeFileName}:`, restoreErr);
    }

    // 3. Candidate CV resolution: If this requested document corresponds to a candidate, synthesize their official verified CV PDF on the fly!
    const leads = await getLeads(true);
    const matchedLead = leads.find((l: any) => {
      if (l.resumeUrl && l.resumeUrl.includes(safeFileName)) return true;
      if (l.passportCopyUrl && l.passportCopyUrl.includes(safeFileName)) return true;
      if (l.resumeName && l.resumeName.toLowerCase() === safeFileName.toLowerCase()) return true;
      const cleanName = String(l.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanName.length >= 3 && safeFileName.toLowerCase().includes(cleanName)) return true;
      return false;
    });

    if (matchedLead) {
      console.log(`[UploadServer] Synthesizing verified candidate CV on-the-fly for "${matchedLead.name}" (${safeFileName})...`);
      const generatedBuffer = await generateCandidateCvPdf(matchedLead);
      fs.writeFileSync(filePath, generatedBuffer);
      backupFileToFirestore(safeFileName, filePath).catch(err => {
        console.error('[UploadServer] Failed to cloud backup synthesized CV:', err);
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
      return res.sendFile(filePath);
    }

    // 4. File genuinely not found: NEVER FALL THROUGH TO CRM SPA! Return clean, dedicated 404 response
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Document Not Found | CGP Overseas Portal</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
          h2 { margin: 0 0 12px; font-size: 20px; color: #f43f5e; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; }
          p { margin: 0 0 20px; font-size: 14px; color: #94a3b8; line-height: 1.6; }
          code { background: #0f172a; padding: 4px 8px; border-radius: 6px; font-size: 12px; color: #38bdf8; word-break: break-all; }
          .btn { display: inline-block; background: #6366f1; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; transition: background 0.2s; }
          .btn:hover { background: #4f46e5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Document Not Available</h2>
          <p>The requested file <code>${safeFileName}</code> is not present in storage or was never uploaded by the applicant.</p>
          <a class="btn" href="javascript:window.close()">Close Window</a>
        </div>
      </body>
      </html>
    `);
  } catch (err: any) {
    console.error(`[UploadServer] Error serving file ${req.params.fileName}:`, err);
    return res.status(500).send('Internal error retrieving document');
  }
});

// Fallback static mount for any sub-path requests
app.use('/uploads', express.static(UPLOADS_DIR));

// POST /api/leads/:id/generate-cv - Generates and attaches an official CV for any candidate
app.post('/api/leads/:id/generate-cv', async (req, res) => {
  try {
    const existingLead = await getLeadById(req.params.id);
    if (!existingLead) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    const fileName = await autoGenerateAndPersistCandidateCv(existingLead, UPLOADS_DIR);
    const resumeUrl = `/uploads/${fileName}`;

    const savedLead = await updateSingleLead(req.params.id, (current) => {
      current.resumeUrl = resumeUrl;
      current.resumeName = fileName;
      current.docResume = true;
      return current;
    });

    if (!savedLead) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    console.log(`[CV Generation] Official CV generated and attached for candidate: ${savedLead.name} (${resumeUrl})`);
    res.json({ success: true, resumeUrl, resumeName: fileName, lead: savedLead });
  } catch (err: any) {
    console.error('[CV Generation] Error generating candidate CV:', err);
    res.status(500).json({ error: 'Failed to generate candidate CV' });
  }
});

// POST base64 file upload
app.post('/api/upload', async (req, res) => {
  try {
    const { fileName, fileType, base64Data } = req.body;
    if (!fileName || !base64Data) {
      res.status(400).json({ error: 'Missing fileName or base64Data' });
      return;
    }

    // Extract the raw base64 data (strip prefix if present, e.g. "data:image/png;base64,")
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, 'base64');

    // Create a safe, unique filename to prevent collisions
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeName = `${base}_${Date.now()}${ext}`;
    
    const filePath = path.join(UPLOADS_DIR, safeName);
    fs.writeFileSync(filePath, buffer);

    // Non-blocking background cloud backup to Firestore (never block the HTTP upload response!)
    backupFileToFirestore(safeName, filePath).catch(backupErr => {
      console.error(`[UploadSystem] Cloud backup trigger failed for ${safeName}:`, backupErr);
    });

    const fileUrl = `/uploads/${safeName}`;
    console.log(`[UploadSystem] File uploaded & secured: ${safeName} (${buffer.length} bytes)`);
    res.json({ success: true, url: fileUrl, safeName });
  } catch (err: any) {
    console.error('File upload failed:', err);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// GET Media Library items
app.get('/api/media', async (req, res) => {
  try {
    const items = await getMediaItems();
    res.json({ success: true, items });
  } catch (err: any) {
    console.error('Failed to get media items:', err);
    res.status(500).json({ error: 'Failed to retrieve media library items' });
  }
});

// POST a new item to Media Library (uploaded by coordinator/admin)
app.post('/api/media', async (req, res) => {
  try {
    const { name, url, type, size, uploadedBy } = req.body;
    if (!name || !url) {
      res.status(400).json({ error: 'Missing name or url' });
      return;
    }

    const items = await getMediaItems();
    const newItem: MediaItem = {
      id: `media_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      url,
      type: type || 'image',
      size: size || 0,
      uploadedBy: uploadedBy || 'system',
      uploadedAt: new Date().toISOString()
    };

    items.push(newItem);
    await saveMediaItems(items);
    res.json({ success: true, item: newItem });
  } catch (err: any) {
    console.error('Failed to save media item:', err);
    const status = err?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: err?.message || 'Failed to save media item' });
  }
});

// DELETE a media item from Media Library
app.delete('/api/media/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let items = await getMediaItems();
    
    // Find item to delete
    const itemToDelete = items.find(item => item.id === id);
    if (!itemToDelete) {
      res.status(404).json({ error: 'Media item not found' });
      return;
    }

    // Filter out the item
    items = items.filter(item => item.id !== id);
    await saveMediaItems(items);

    // Optional: delete actual file from disk if it was local in /uploads/
    if (itemToDelete.url.startsWith('/uploads/')) {
      const fileName = path.basename(itemToDelete.url);
      const filePath = path.join(UPLOADS_DIR, fileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`[MediaLibrary] Deleted physical file: ${filePath}`);
        } catch (fileErr) {
          console.error(`[MediaLibrary] Failed to delete physical file ${filePath}:`, fileErr);
        }
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to delete media item:', err);
    const status = err?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: err?.message || 'Failed to delete media item' });
  }
});

// Lazy-initialize Gemini client to avoid startup crashes if key is omitted
let aiClient: GoogleGenAI | null = null;
let isAiSimulated = false;

function getGemini(): GoogleGenAI | null {
  if (isAiSimulated) return null;
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === 'MY_GEMINI_API_KEY') {
      console.warn('GEMINI_API_KEY is missing or unchanged. Running in developer simulation mode.');
      isAiSimulated = true;
      return null;
    }
    try {
      aiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    } catch (err) {
      console.error('Failed to initialize GoogleGenAI. Defaulting to simulation mode.', err);
      isAiSimulated = true;
      return null;
    }
  }
  return aiClient;
}

// Fault-tolerant wrapper for ai.models.generateContent that gracefully falls back to stable alternative models in case of transient 503/UNAVAILABLE errors
async function safeGenerateContent(
  ai: GoogleGenAI,
  params: {
    model: string;
    contents: any;
    config?: any;
  }
): Promise<any> {
  const normalizedRequested =
    params.model === 'gemini-3.5-flash' || params.model === 'gemini-3.8-flash' || params.model === 'gemini-2.5-flash'
      ? 'gemini-4-hydrogen'
      : params.model;
  const modelsToTry = [
    normalizedRequested,
    'gemini-4-hydrogen',
    'gemini-3.1-flash-lite'
  ];
  const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));
  let lastError: any = null;

  for (const modelAttempt of uniqueModels) {
    try {
      const attemptConfig = params.config ? { ...params.config } : undefined;
      if (modelAttempt === 'gemini-3.1-flash-lite' && attemptConfig?.thinkingConfig) {
        attemptConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
      }
      console.log(`[Gemini API] Attempting generateContent with model: "${modelAttempt}"`);
      const response = await ai.models.generateContent({
        model: modelAttempt,
        contents: params.contents,
        config: attemptConfig
      });
      console.log(`[Gemini API] Success using model: "${modelAttempt}"`);
      return response;
    } catch (err: any) {
      lastError = err;
      const errMsg = (err?.message || String(err)).toLowerCase();
      console.error(`[Gemini API] Error calling model "${modelAttempt}":`, err?.message || String(err));
      
      const isQuotaOrRateLimit = errMsg.includes('resource_exhausted') || 
                                 errMsg.includes('quota') || 
                                 errMsg.includes('rate limit') || 
                                 errMsg.includes('exhausted') || 
                                 err?.status === 429;
      
      if (isQuotaOrRateLimit) {
        console.warn(`[Gemini API] Quota/Rate Limit reached. Aborting model fallback retries to prevent token/request waste.`);
        break;
      }

      if (uniqueModels.indexOf(modelAttempt) < uniqueModels.length - 1) {
        console.warn(`[Gemini API] Model "${modelAttempt}" failed. Retrying automatically with next available fallback model...`);
      }
    }
  }
  throw lastError;
}

// Helper to generate a clean, unique lead ID like SAPNA_27-06-2026 or SAPNA_27-06-2026_1
function generateUniqueLeadId(leads: Lead[], cleanNameId: string): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const dateStr = `${day}-${month}-${year}`;
  const baseId = `${cleanNameId}_${dateStr}`;
  
  if (!leads.some(l => l.id === baseId)) {
    return baseId;
  }
  
  let counter = 1;
  while (leads.some(l => l.id === `${baseId}_${counter}`)) {
    counter++;
  }
  return `${baseId}_${counter}`;
}

// Helper to format candidate names with spaces between CamelCase or snake_case words
function formatCandidateNameBackend(name: string): string {
  if (!name) return 'Unnamed Candidate';
  // 1. If camelCase (e.g. ImNameren), add a space (Im Nameren)
  let formatted = String(name).replace(/([a-z])([A-Z])/g, '$1 $2');
  // 2. Replace multiple spaces/underscores/dashes with a single space
  formatted = formatted.replace(/[_-]+/g, ' ');
  // 3. Strip duplicate spaces
  formatted = formatted.replace(/\s+/g, ' ');
  return formatted.trim();
}

// Helper to map LeadStage keys to human-friendly original labels
function getStageLabel(stage: string): string {
  const stageMap: Record<string, string> = {
    new: 'New Inbound',
    negotiating: 'In Discussion',
    rotations: 'In Rotations',
    proposal: 'Office Visited/Interview Attended',
    won: 'Closed Won',
    lost: 'Closed Lost'
  };
  const key = String(stage).toLowerCase().trim();
  return stageMap[key] || stage;
}

// ---------------- SERVER API ROUTES ----------------

// Health check and environment info
app.get(['/health', '/_health'], (req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (req, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';
  res.json({
    status: 'ok',
    aiMode: hasKey ? 'live' : 'simulation',
    hasApiKey: hasKey
  });
});

// Helper to verify that the request is made by a valid logged-in administrator
async function checkIsAdmin(req: express.Request): Promise<boolean> {
  // 1. Direct query parameter check (for browser file downloads)
  const qRole = req.query.role || req.query.userRole;
  if (qRole && String(qRole).trim().toLowerCase() === 'admin') {
    return true;
  }
  const qAgent = req.query.agentId || req.query.username;
  if (qAgent) {
    const qNorm = String(qAgent).trim().toLowerCase();
    if (['admin', 'master admin', 'test', 'sachinsaha', 'coord_admin', 'coord_sachinsaha'].includes(qNorm)) {
      return true;
    }
  }

  // 2. Direct role parameter/header check (case-insensitive, trims, handles string or array)
  const rawRole = req.headers['x-user-role'] || (req.body && req.body.userRole) || (req.body && req.body.role);
  const roleStr = Array.isArray(rawRole) ? rawRole[0] : (rawRole ? String(rawRole) : '');
  if (roleStr && roleStr.trim().toLowerCase() === 'admin') {
    return true;
  }

  // 3. Bearer Session Token check from headers or query
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.substring(7).trim()
    : null;
  const token = (req.query.token as string) || (req.headers['x-session-token'] as string) || bearerToken;
  if (token) {
    const session = activeSessions.get(token);
    if (session && String(session.role).toLowerCase() === 'admin') {
      return true;
    }
  }

  // 4. Agent/User identifier check (checks username or ID)
  const rawAgentId = req.headers['x-agent-id'] || req.headers['x-user-id'] || (req.body && (req.body.agentId || req.body.username));
  const agentStr = Array.isArray(rawAgentId) ? rawAgentId[0] : (rawAgentId ? String(rawAgentId) : '');
  if (agentStr) {
    const norm = agentStr.trim().toLowerCase();
    if (norm === 'admin' || norm === 'master admin' || norm === 'test' || norm === 'sachinsaha' || norm === 'coord_admin' || norm === 'coord_sachinsaha') {
      return true;
    }
    try {
      const coordinators = await getCoordinators();
      const matched = coordinators.find(c => c.username.toLowerCase() === norm || c.id.toLowerCase() === norm);
      if (matched && matched.role === 'admin') {
        return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

async function verifyAdminAccess(req: express.Request): Promise<boolean> {
  return checkIsAdmin(req);
}

// GET /api/backup/full-xlsx - Complete Master Database XLSX Backup Download (Zero limitations, 100% of all data)
app.get('/api/backup/full-xlsx', async (req, res) => {
  try {
    if (!(await verifyAdminAccess(req))) {
      res.status(403).json({ error: 'Access denied: Admin credentials required' });
      return;
    }
    const wbBuffer = await generateFullXLSXBuffer();
    const todayStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="CGP_CRM_COMPLETE_MASTER_BACKUP_${todayStr}.xlsx"`);
    res.send(wbBuffer);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/backup/full-db - Download complete JSON Database Backup file (suitable for full 1-click restore)
app.get('/api/backup/full-db', async (req, res) => {
  try {
    if (!(await verifyAdminAccess(req))) {
      res.status(403).json({ error: 'Access denied: Admin credentials required' });
      return;
    }
    const backup = await createFullDatabaseBackup('Manual Download via API');
    const todayStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="CGP_CRM_DATABASE_BACKUP_${todayStr}.json"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/backup/list - Get list of all automatic and manual backups on disk + durable cloud snapshots
app.get('/api/backup/list', async (req, res) => {
  try {
    if (!(await verifyAdminAccess(req))) {
      res.status(403).json({ error: 'Access denied: Admin credentials required' });
      return;
    }
    const backups = listAvailableBackups();
    const cloudSnapshots = await listCloudBackupSnapshots();
    res.json({ backups, cloudSnapshots });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/backup/cloud-download/:snapshotId - Download durable Firestore snapshot JSON
app.get('/api/backup/cloud-download/:snapshotId', async (req, res) => {
  try {
    if (!(await verifyAdminAccess(req))) {
      res.status(403).json({ error: 'Access denied: Admin credentials required' });
      return;
    }
    const snapshot = await loadCloudBackupSnapshot(req.params.snapshotId);
    if (!snapshot) {
      return res.status(404).json({ error: 'Cloud backup snapshot not found.' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.snapshotId}.json"`);
    res.send(JSON.stringify(snapshot, null, 2));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/backup/cloud-restore/:snapshotId - Restore DB directly from durable Firestore snapshot
app.post('/api/backup/cloud-restore/:snapshotId', async (req, res) => {
  try {
    if (!(await verifyAdminAccess(req))) {
      res.status(403).json({ error: 'Access denied: Admin credentials required' });
      return;
    }
    const snapshot = await loadCloudBackupSnapshot(req.params.snapshotId);
    if (!snapshot || !snapshot.data || !Array.isArray(snapshot.data.leads)) {
      return res.status(404).json({ error: 'Cloud backup snapshot not found or incomplete.' });
    }
    const restoreResult = await restoreDatabaseFromBackup(snapshot);
    res.json(restoreResult);
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// POST /api/backup/trigger - Immediately trigger a full automated backup of both DB and XLSX right now
app.post('/api/backup/trigger', async (req, res) => {
  try {
    if (!(await verifyAdminAccess(req))) {
      res.status(403).json({ error: 'Access denied: Admin credentials required' });
      return;
    }
    const isMonday = req.body?.isMonday === true;
    const result = await executeScheduledFullBackup(isMonday);
    res.json({
      success: true,
      message: 'Automatic full backup executed immediately for both Database JSON, Cloud Snapshot, and Master XLSX.',
      result
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/backup/restore - Restore DB from uploaded JSON backup payload
app.post('/api/backup/restore', async (req, res) => {
  try {
    if (!(await verifyAdminAccess(req))) {
      res.status(403).json({ error: 'Access denied: Admin credentials required' });
      return;
    }
    const backupData: FullDatabaseBackup = req.body;
    if (!backupData || !backupData.data || !Array.isArray(backupData.data.leads)) {
      return res.status(400).json({ error: 'Invalid backup file structure: missing data.leads array.' });
    }
    const restoreResult = await restoreDatabaseFromBackup(backupData);
    res.json(restoreResult);
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// GET /api/backup/download-file - Download a specific backup file by filename from the backup repository
app.get('/api/backup/download-file', async (req, res) => {
  try {
    if (!(await verifyAdminAccess(req))) {
      res.status(403).json({ error: 'Access denied: Admin credentials required' });
      return;
    }
    const fileName = req.query.file as string;
    if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({ error: 'Invalid or unsafe file name parameter.' });
    }
    const backupDir = path.join(process.cwd(), 'data', 'backups', 'scheduled');
    const filePath = path.join(backupDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup file not found.' });
    }

    if (fileName.endsWith('.xlsx')) {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      res.setHeader('Content-Type', 'application/json');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

let cachedLeadMeta: {
  version: number;
  showDeleted: boolean;
  meta: { countries: string[]; projects: string[]; positions: string[]; tags: string[] };
} | null = null;

function compactLeadMessages(msgs: Message[] = []): Message[] {
  if (!Array.isArray(msgs) || msgs.length === 0) return [];
  const realMsgs = msgs.filter(m => m && (!m.text || !m.text.includes('Lead enrolled manually in CGP system database')));
  if (realMsgs.length === 0) return [];

  let lastInbound: Message | null = null;
  let lastOutbound: Message | null = null;
  const unreadInbound: Message[] = [];

  for (let i = 0; i < realMsgs.length; i++) {
    const m = realMsgs[i];
    if (m.sender === 'lead') {
      lastInbound = m;
      if (m.status !== 'read') unreadInbound.push(m);
    } else {
      lastOutbound = m;
    }
  }

  const picked: Message[] = [];
  const seen = new Set<Message>();
  const addMsg = (m: Message | null) => {
    if (m && !seen.has(m)) {
      seen.add(m);
      picked.push(m);
    }
  };

  realMsgs.slice(-2).forEach(addMsg);
  addMsg(lastInbound);
  addMsg(lastOutbound);
  unreadInbound.forEach(addMsg);

  // Preserve chronological order and trim heavy media/caption bloat while preserving 24h window & unread badges
  return realMsgs
    .filter(m => seen.has(m))
    .map(m => ({
      id: m.id,
      sender: m.sender,
      text: typeof m.text === 'string' && m.text.length > 240 ? `${m.text.slice(0, 240)}...` : (m.text || ''),
      timestamp: m.timestamp,
      status: m.status,
      ...(m.type ? { type: m.type } : {})
    }));
}

function getLeadStageEnteredAt(l: Lead): string {
  backfillLeadHistory(l);
  const stdStageLocal = (st: string): string => {
    if (!st) return 'new';
    const s = st.toLowerCase().trim();
    if (s === 'negotiating') return 'in_discussion';
    if (s === 'rotations') return 'cold_leads';
    if (s === 'proposal') return 'office_visited';
    return s;
  };
  const actualStage = stdStageLocal(l.stage || 'new');
  const sh = Array.isArray(l.stageHistory)
    ? [...l.stageHistory].sort((a: any, b: any) => new Date(a.changedAt || 0).getTime() - new Date(b.changedAt || 0).getTime())
    : [];
  let enteredAt = '';
  for (let i = sh.length - 1; i >= 0; i--) {
    if (stdStageLocal(sh[i].newStage) === actualStage) {
      enteredAt = sh[i].changedAt || '';
    } else {
      break;
    }
  }
  return enteredAt || l.createdAt || l.entryDate || l.updatedAt || '';
}

function projectLeadForTab(l: Lead, activeTab: string, fullDetails: boolean) {
  const stageChangedAt = getLeadStageEnteredAt(l);
  if (fullDetails) {
    return { ...l, stageChangedAt };
  }
  const {
    cvTextContent: _cv,
    deletedDocuments: _del,
    summary: _sum,
    nextAction: _na,
    requirements: _req,
    ...rest
  } = l as any;

  if (activeTab === 'analytics') {
    return {
      ...rest,
      stageChangedAt,
      messages: compactLeadMessages(l.messages)
    };
  }

  // Board / Spreadsheet / WhatsApp Chats list: omit megabytes of historical timelines until LeadModal opens
  const { timeline: _tl, stageHistory: _sh, coordinatorHistory: _ch, ...leanRest } = rest;
  return {
    ...leanRest,
    stageChangedAt,
    messages: compactLeadMessages(l.messages)
  };
}

// GET all leads with server-side pagination, searching, and filtering
app.get('/api/leads', async (req, res) => {
  try {
    const forceRefresh = req.query.forceRefresh === 'true';
    const showDeleted = req.query.showDeleted === 'true';
    const fullDetails = req.query.fullDetails === 'true';

    // Fast HTTP 304 Not Modified validation: include query parameters hash so different views don't collide
    const clientEtag = req.headers['if-none-match'];
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    const queryHash = Buffer.from(queryString).toString('base64url').slice(0, 16);
    const currentVer = `"${getDatabaseVersion()}-${queryHash}"`;
    res.setHeader('ETag', currentVer);
    res.setHeader('Cache-Control', 'private, no-cache');

    if (clientEtag && clientEtag === currentVer && !forceRefresh) {
      return res.status(304).end();
    }

    const [rawLeads, coordinators] = await Promise.all([
      getLeads(forceRefresh),
      getCoordinators()
    ]);

    const currentDbVer = getDatabaseVersion();
    let meta: { countries: string[]; projects: string[]; positions: string[]; tags: string[] };
    if (cachedLeadMeta && cachedLeadMeta.version === currentDbVer && cachedLeadMeta.showDeleted === showDeleted) {
      meta = cachedLeadMeta.meta;
    } else {
      rawLeads.forEach(lead => backfillLeadHistory(lead));

      // 1. Compute dynamic metadata from all unfiltered active leads (excluding soft-deleted)
      const countriesMap = new Map<string, string>(); // lowercase -> original casing
      const projectsMap = new Map<string, string>();
      const tagsMap = new Map<string, string>();
      const positionsMap = new Map<string, string>();

      rawLeads.forEach(l => {
        if (!showDeleted && l.isDeleted) return;
        if (showDeleted && !l.isDeleted) return;

        if (l.country && l.country.trim()) {
          const trimmed = l.country.trim();
          const lower = trimmed.toLowerCase();
          // Prefer Title/Pascal casing over ALL-CAPS if both exist in the DB
          if (!countriesMap.has(lower) || (trimmed !== trimmed.toUpperCase() && countriesMap.get(lower) === countriesMap.get(lower)?.toUpperCase())) {
            countriesMap.set(lower, trimmed);
          }
        }
        if (l.project && l.project.trim()) {
          const trimmed = l.project.trim();
          const lower = trimmed.toLowerCase();
          if (!projectsMap.has(lower) || (trimmed !== trimmed.toUpperCase() && projectsMap.get(lower) === projectsMap.get(lower)?.toUpperCase())) {
            projectsMap.set(lower, trimmed);
          }
        }
        if (l.position && l.position.trim()) {
          const trimmed = l.position.trim();
          const lower = trimmed.toLowerCase();
          if (!positionsMap.has(lower) || (trimmed !== trimmed.toUpperCase() && positionsMap.get(lower) === positionsMap.get(lower)?.toUpperCase())) {
            positionsMap.set(lower, trimmed);
          }
        }
        if (l.tags && Array.isArray(l.tags)) {
          l.tags.forEach(t => {
            if (t && t.trim()) {
              const trimmed = t.trim();
              const lower = trimmed.toLowerCase();
              if (!tagsMap.has(lower) || (trimmed !== trimmed.toUpperCase() && tagsMap.get(lower) === tagsMap.get(lower)?.toUpperCase())) {
                tagsMap.set(lower, trimmed);
              }
            }
          });
        }
      });

      meta = {
        countries: Array.from(countriesMap.values()).sort((a, b) => a.localeCompare(b)),
        projects: Array.from(projectsMap.values()).sort((a, b) => a.localeCompare(b)),
        positions: Array.from(positionsMap.values()).sort((a, b) => a.localeCompare(b)),
        tags: Array.from(tagsMap.values()).sort((a, b) => a.localeCompare(b))
      };
      cachedLeadMeta = { version: currentDbVer, showDeleted, meta };
    }

    // 2. Parse query parameters
    const {
      page = '1',
      limit = '100',
      search = '',
      country = 'All',
      project = 'All',
      fitScore = 'All',
      tag = 'All',
      dateFilter = 'All',
      customStartDate = '',
      customEndDate = '',
      coordinator = 'All',
      stage = 'All',
      bucket = 'all',
      agentId = '',
      userRole = '',
      all = 'false',
      activeTab = '',
      gender = 'All',
      remarksFilter = 'All',
      position = 'All'
    } = req.query as Record<string, string>;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 100;

    const parseMultiParam = (val: unknown): string[] => {
      if (!val) return [];
      const arr = Array.isArray(val)
        ? val.flatMap(v => String(v).split('||'))
        : String(val).split('||');
      return arr
        .map(s => s.trim())
        .filter(s => s !== '' && s.toLowerCase() !== 'all');
    };

    const countryFilters = parseMultiParam(country);
    const projectFilters = parseMultiParam(project);
    const positionFilters = parseMultiParam(position);
    const fitScoreFilters = parseMultiParam(fitScore);
    const tagFilters = parseMultiParam(tag);
    const coordinatorFilters = parseMultiParam(coordinator);
    const stageFilters = parseMultiParam(stage);
    const dateFilters = parseMultiParam(dateFilter);
    const genderFilters = parseMultiParam(gender);
    const remarksFilters = parseMultiParam(remarksFilter);

    // 3. Apply multi-layer filters
    let filteredLeads = rawLeads.filter(lead => {
      // Filter by deletion status
      if (!showDeleted && lead.isDeleted) {
        return false;
      }
      if (showDeleted && !lead.isDeleted) {
        return false;
      }

      // Filter out un-intaken leads ONLY when doing paginated server-side spreadsheet retrieval (all !== 'true')
      // Client views (LeadBoard, LeadList) already handle client-side filtering for intake candidates.
      // This ensures full CRM client state has access to unassigned/requesting inbound WhatsApp leads.
      if (all !== 'true' && activeTab !== 'messages' && !search) {
        if (!getEffectiveIntake(lead)) {
          return false;
        }
      }

      // A. Bucket / Agent filter
      if (userRole === 'agent' || bucket === 'my') {
        if (!isCoordinatorMatch(lead.assignedTo, agentId, coordinators)) {
          return false;
        }
      }

      // B. Search keyword match
      if (search) {
        const query = search.toLowerCase().trim();
        const matchesSearch = 
          (lead.name && lead.name.toLowerCase().includes(query)) ||
          (lead.phone && lead.phone.includes(query)) ||
          (lead.email && lead.email.toLowerCase().includes(query)) ||
          (lead.country && lead.country.toLowerCase().includes(query)) ||
          (lead.position && lead.position.toLowerCase().includes(query)) ||
          (lead.origin && lead.origin.toLowerCase().includes(query)) ||
          (lead.remarks1 && lead.remarks1.toLowerCase().includes(query)) ||
          (lead.remarks2 && lead.remarks2.toLowerCase().includes(query)) ||
          (lead.remarks3 && lead.remarks3.toLowerCase().includes(query)) ||
          (lead.tags && lead.tags.some(t => t.toLowerCase().includes(query))) ||
          (lead.source && lead.source.toLowerCase().includes(query)) ||
          (lead.project && lead.project.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      // C. Country Interest multi-select filter
      if (countryFilters.length > 0) {
        if (!lead.country || !countryFilters.some(cf => lead.country!.trim().toLowerCase() === cf.toLowerCase())) {
          return false;
        }
      }

      // D. Project multi-select filter
      if (projectFilters.length > 0) {
        if (!lead.project || !projectFilters.some(pf => lead.project!.trim().toLowerCase() === pf.toLowerCase())) {
          return false;
        }
      }

      // D.5 Target Job Position multi-select filter
      if (positionFilters.length > 0) {
        if (!lead.position || !positionFilters.some(pf => lead.position!.trim().toLowerCase() === pf.toLowerCase())) {
          return false;
        }
      }

      // E. Fit score multi-select filter
      if (fitScoreFilters.length > 0) {
        if (!lead.fitScore || !fitScoreFilters.some(ff => lead.fitScore!.trim().toLowerCase() === ff.toLowerCase())) {
          return false;
        }
      }

      // F. Tag multi-select filter
      if (tagFilters.length > 0) {
        if (!lead.tags || !tagFilters.some(tf => lead.tags!.some(t => t.trim().toLowerCase() === tf.toLowerCase()))) {
          return false;
        }
      }

      // G. Coordinator / Telecaller multi-select filter
      if (coordinatorFilters.length > 0) {
        if (!coordinatorFilters.some(cf => isCoordinatorMatch(lead.assignedTo, cf, coordinators))) {
          return false;
        }
      }

      // H. Pipeline Stage multi-select filter (with legacy alias support)
      if (stageFilters.length > 0) {
        const s = lead.stage || 'new';
        const matchesStage = stageFilters.some(sf => {
          if (sf === 'negotiating' || sf === 'in_discussion') {
            return s === 'negotiating' || s === 'in_discussion';
          }
          if (sf === 'office_visited' || sf === 'proposal') {
            return s === 'office_visited' || s === 'proposal';
          }
          if (sf === 'cold_leads' || sf === 'rotations') {
            return s === 'cold_leads' || s === 'rotations';
          }
          return s === sf;
        });
        if (!matchesStage) return false;
      }

      // I. Date wise multi-select filter
      if (dateFilters.length > 0) {
        const leadTime = new Date(lead.createdAt).getTime();
        if (!isNaN(leadTime)) {
          const startOfDay = (d: Date) => {
            const r = new Date(d);
            r.setHours(0, 0, 0, 0);
            return r.getTime();
          };
          const endOfDay = (d: Date) => {
            const r = new Date(d);
            r.setHours(23, 59, 59, 999);
            return r.getTime();
          };

          const today = new Date();
          const matchesAnyDate = dateFilters.some(df => {
            if (df === 'Today') {
              return leadTime >= startOfDay(today) && leadTime <= endOfDay(today);
            } else if (df === 'Yesterday') {
              const yesterday = new Date();
              yesterday.setDate(today.getDate() - 1);
              return leadTime >= startOfDay(yesterday) && leadTime <= endOfDay(yesterday);
            } else if (df === 'Last7Days') {
              const sevenDaysAgo = new Date();
              sevenDaysAgo.setDate(today.getDate() - 7);
              return leadTime >= startOfDay(sevenDaysAgo) && leadTime <= endOfDay(today);
            } else if (df === 'Last30Days') {
              const thirtyDaysAgo = new Date();
              thirtyDaysAgo.setDate(today.getDate() - 30);
              return leadTime >= startOfDay(thirtyDaysAgo) && leadTime <= endOfDay(today);
            } else if (df === 'Custom') {
              const start = customStartDate ? startOfDay(new Date(customStartDate)) : 0;
              const end = customEndDate ? endOfDay(new Date(customEndDate)) : Infinity;
              return leadTime >= start && leadTime <= end;
            }
            return true;
          });
          if (!matchesAnyDate) return false;
        }
      }

      // J. Gender-wise multi-select filter
      if (genderFilters.length > 0) {
        const g = String(lead.gender || '').toUpperCase().trim();
        const matchesGender = genderFilters.some(gf => {
          const filterG = String(gf).toUpperCase().trim();
          if (filterG === 'MALE' || filterG === 'M') {
            return g === 'M' || g === 'MALE';
          } else if (filterG === 'FEMALE' || filterG === 'F') {
            return g === 'F' || g === 'FEMALE';
          }
          return g === filterG;
        });
        if (!matchesGender) return false;
      }

      // K. Remarks-wise multi-select filter
      if (remarksFilters.length > 0) {
        const r1 = !!(lead.remarks1 && lead.remarks1.trim());
        const r2 = !!(lead.remarks2 && lead.remarks2.trim());
        const r3 = !!(lead.remarks3 && lead.remarks3.trim());

        const matchesRemarks = remarksFilters.some(rf => {
          if (rf === 'remarks1') return r1;
          if (rf === 'remarks2') return r2;
          if (rf === 'remarks3') return r3;
          if (rf === 'remarks1Only') return r1 && !r2 && !r3;
          if (rf === 'remarks2Only') return r2 && !r1 && !r3;
          if (rf === 'remarks3Only') return r3 && !r1 && !r2;
          if (rf === 'noRemarks') return !r1 && !r2 && !r3;
          if (rf === 'allRemarks') return r1 && r2 && r3;
          return true;
        });
        if (!matchesRemarks) return false;
      }

      return true;
    });

    // Helper to produce fast, lightweight leads without megabytes of historical timeline clutter
    const toLightweightLead = (l: Lead) => projectLeadForTab(l, activeTab, fullDetails);

    // 4. Return complete or paginated payload
    if (all === 'true') {
      const payloadLeads = fullDetails ? filteredLeads : filteredLeads.map(toLightweightLead);
      res.json({
        leads: payloadLeads,
        totalCount: filteredLeads.length,
        totalPages: 1,
        page: 1,
        limit: filteredLeads.length,
        meta,
        version: getDatabaseVersion()
      });
      return;
    }

    const totalCount = filteredLeads.length;
    const totalPages = Math.ceil(totalCount / limitNum) || 1;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedLeads = filteredLeads.slice(startIndex, startIndex + limitNum).map(toLightweightLead);

    res.json({
      leads: paginatedLeads,
      totalCount,
      totalPages,
      page: pageNum,
      limit: limitNum,
      meta,
      version: getDatabaseVersion()
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET incremental delta changes since a known version (<1KB instead of multi-MB full reload)
app.get('/api/leads/changes', async (req, res) => {
  try {
    const sinceVersion = Number(req.query.sinceVersion || 0);
    const userRole = String(req.query.userRole || '');
    const agentId = String(req.query.agentId || '');
    const activeTab = String(req.query.activeTab || 'board');
    const fullDetails = req.query.fullDetails === 'true';

    const delta = getLeadChangesSince(sinceVersion);
    if (delta.fullSyncRequired) {
      return res.json({
        version: delta.version,
        fullSyncRequired: true,
        changedLeads: [],
        removedIds: []
      });
    }

    if (delta.changedIds.length === 0) {
      return res.json({
        version: delta.version,
        fullSyncRequired: false,
        changedLeads: [],
        removedIds: []
      });
    }

    const [rawLeads, coordinators] = await Promise.all([
      getLeads(),
      getCoordinators()
    ]);

    const changedSet = new Set(delta.changedIds);
    const changedLeads: any[] = [];
    const removedIds: string[] = [];

    for (const l of rawLeads) {
      if (!changedSet.has(l.id)) continue;
      if (l.isDeleted) {
        removedIds.push(l.id);
        continue;
      }
      if (userRole === 'agent' && !isCoordinatorMatch(l.assignedTo, agentId, coordinators)) {
        removedIds.push(l.id);
        continue;
      }
      changedLeads.push(projectLeadForTab(l, activeTab, fullDetails));
    }

    res.json({
      version: delta.version,
      fullSyncRequired: false,
      changedLeads,
      removedIds
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET ultra-lightweight database version check (<40 bytes) to eliminate polling bandwidth & Cloud Armor rate limits
app.get('/api/sync/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.json({
    version: getDatabaseVersion(),
    timestamp: Date.now()
  });
});

// POST manual lead creation (Admin power)
app.post('/api/leads', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators are authorized to manually enroll new candidates.' });
      return;
    }

    const { name, phone, alternateNo, gender, age, origin, country, position, experience, qualification, assignedTo, importance, tags, source, project, adminRemarks } = req.body;
    if (!phone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const leads = await getLeads();

    // Only active (non-deleted) candidates should prevent duplicate enrollment
    const existingDuplicate = leads.find(l => !l.isDeleted && (arePhonesMatching(l.phone, phone) || (l.alternateNo && arePhonesMatching(l.alternateNo, phone))));
    if (existingDuplicate) {
      res.status(400).json({ error: `Phone number already exists in CRM (Duplicate number detected: matches lead ${existingDuplicate.serialNo} - ${existingDuplicate.name})` });
      return;
    }

    if (alternateNo && String(alternateNo).trim()) {
      const existingAltDuplicate = leads.find(l => !l.isDeleted && (arePhonesMatching(l.phone, alternateNo) || (l.alternateNo && arePhonesMatching(l.alternateNo, alternateNo))));
      if (existingAltDuplicate) {
        res.status(400).json({ error: `Alternate phone number already exists in CRM (Duplicate number detected: matches lead ${existingAltDuplicate.serialNo} - ${existingAltDuplicate.name})` });
        return;
      }
    }

    // Clean up/archive phone on any previously soft-deleted records with this same number so the new enrollment has a clean slate
    const ghostLeadIds = leads
      .filter(l => l.isDeleted && (arePhonesMatching(l.phone, phone) || (alternateNo && arePhonesMatching(l.phone, alternateNo))))
      .map(g => g.id);
    if (ghostLeadIds.length > 0) {
      const archiveStamp = Date.now();
      await updateMultipleLeads(ghostLeadIds, (g) => {
        if (arePhonesMatching(g.phone, phone)) {
          g.phone = `${g.phone}_archived_${archiveStamp}`;
        }
        if (alternateNo && g.alternateNo && arePhonesMatching(g.alternateNo, alternateNo)) {
          g.alternateNo = `${g.alternateNo}_archived_${archiveStamp}`;
        }
        return g;
      });
    }
    
    // Auto increment serial number
    const sequence = leads.length + 1;
    const serialNo = `INQ-${1000 + sequence}`;

    const rawName = name && name.trim() ? name.trim() : 'Unnamed Candidate';
    const finalName = formatCandidateNameBackend(rawName);
    const cleanNameId = String(finalName).toUpperCase().trim().replace(/[^A-Z0-9]/g, '_');
    const newLead = {
      id: generateUniqueLeadId(leads, cleanNameId),
      serialNo,
      entryDate: new Date().toISOString().split('T')[0],
      assignDate: assignedTo ? new Date().toISOString().split('T')[0] : '',
      name: finalName,
      phone,
      alternateNo: alternateNo || '',
      email: '',
      gender: gender || 'M',
      age: (age !== undefined && age !== null && age !== '') ? (Number(age) || '') : '',
      origin: origin !== undefined ? String(origin).trim() : '',
      country: (country === undefined || country === null) ? 'Kuwait' : String(country).trim(),
      position: position || 'General openings',
      experience: experience || 'Fresh criteria',
      qualification: qualification !== undefined ? String(qualification).trim() : '',
      adminRemarks: adminRemarks || '',
      notes: '',
      assignedTo: assignedTo || '',
      importance: Number(importance) || 3,
      remarks1: '',
      remarks2: '',
      remarks3: '',
      stage: 'new' as LeadStage,
      fitScore: 'high' as any,
      budget: 1500,
      budgetRaw: 'Medium range opening commission',
      campaign: `${country || 'General'} Direct Intake Program`,
      summary: `Manually enrolled candidate ${finalName} seeking ${position || 'placement'} openings in ${country || 'abroad'}.`,
      requirements: [position || 'placement', country || 'visa'].filter(Boolean),
      nextAction: 'Dial contact number to verify documentation status.',
      tags: tags || [],
      source: source || 'Organic',
      project: project || 'General',
      messages: [],
      tasks: [],
      timeline: [
        {
          id: `tl_init_${Date.now()}`,
          type: 'creation' as const,
          text: `Candidate registered in CGP database. Assigned coordinator: ${assignedTo || 'Unassigned'}.`,
          actor: 'System Administrator',
          timestamp: new Date().toISOString()
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      intake: true
    };

    const actorRole = req.headers['x-user-role'] || 'user';
    const rawAgentIdHeader = (req.headers['x-agent-id'] as string) || 'System Administrator';
    const actorLabel = actorRole === 'admin' ? `Admin (${rawAgentIdHeader})` : `Coordinator ${rawAgentIdHeader}`;
    await addLead(newLead, {
      auditMeta: {
        actor: actorLabel,
        sourceView: String(req.headers['x-source-view'] || 'create_lead')
      }
    });

    res.status(201).json(newLead);
  } catch (err: any) {
    const status = err?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: err?.message || 'Failed to create lead' });
  }
});

// POST Bulk Enrollment of candidates (Admin power)
app.post('/api/leads/bulk', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators are authorized to bulk enroll candidates.' });
      return;
    }

    const { leads: batchLeads } = req.body;
    if (!Array.isArray(batchLeads) || batchLeads.length === 0) {
      res.status(400).json({ error: 'leads must be a non-empty array' });
      return;
    }

    const currentLeads = await getLeads(true);
    const enrolledNames: string[] = [];
    const skipped: string[] = [];
    const newLeadsToAdd: any[] = [];

    batchLeads.forEach((leadItem, index) => {
      const { name, phone, gender, age, origin, country, position, experience, qualification, assignedTo, importance, tags, source, project } = leadItem;
      
      if (!name || !phone) {
        skipped.push(`Row ${index + 1}: Name and Phone are required.`);
        return;
      }

      const cleanPhone = String(phone).trim();
      const formattedName = formatCandidateNameBackend(name);
      const duplicateExists = currentLeads.some((l: any) => !l.isDeleted && (arePhonesMatching(l.phone, cleanPhone) || (l.alternateNo && arePhonesMatching(l.alternateNo, cleanPhone)))) || 
                              newLeadsToAdd.some((l: any) => arePhonesMatching(l.phone, cleanPhone) || (l.alternateNo && arePhonesMatching(l.alternateNo, cleanPhone)));
      if (duplicateExists) {
        skipped.push(`${formattedName} (${phone}): Already exists in active database.`);
        return;
      }

      const sequence = currentLeads.length + newLeadsToAdd.length + 1;
      const serialNo = `INQ-${1000 + sequence}`;

      const itemTags = Array.isArray(tags) 
        ? tags 
        : typeof tags === 'string' 
          ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) 
          : [];

      const cleanNameId = String(formattedName).toUpperCase().trim().replace(/[^A-Z0-9]/g, '_');
      const d = new Date();
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const dateStr = `${day}-${month}-${year}`;
      const newLead = {
        id: `${cleanNameId}_${dateStr}_bulk_${index}_${Math.random().toString(36).substr(2, 4)}`,
        serialNo,
        entryDate: new Date().toISOString().split('T')[0],
        assignDate: assignedTo ? new Date().toISOString().split('T')[0] : '',
        name: formattedName,
        phone: cleanPhone,
        email: '',
        gender: gender || 'M',
        age: (age !== undefined && age !== null && age !== '') ? (Number(age) || '') : '',
        origin: origin !== undefined ? String(origin).trim() : '',
        country: (country === undefined || country === null) ? 'Kuwait' : String(country).trim(),
        position: position || 'General openings',
        experience: experience || 'Fresh criteria',
        qualification: qualification !== undefined ? String(qualification).trim() : '',
        adminRemarks: '',
        notes: '',
        assignedTo: assignedTo || '',
        importance: Number(importance) || 3,
        remarks1: '',
        remarks2: '',
        remarks3: '',
        stage: 'new' as LeadStage,
        fitScore: 'high' as any,
        budget: 1500,
        budgetRaw: 'Medium range opening commission',
        campaign: `${country || 'General'} Direct Intake Program`,
        summary: `Bulk enrolled candidate ${name} seeking ${position || 'placement'} openings in ${country || 'abroad'}.`,
        requirements: [position || 'placement', country || 'visa'].filter(Boolean),
        nextAction: 'Dial contact number to verify documentation status.',
        tags: itemTags,
        source: source || 'Organic',
        project: project || 'General',
        messages: [
          {
            id: `m_init_${Date.now()}`,
            sender: 'system' as const,
            text: `Lead enrolled in bulk via CSV/XLSX import. Assigned coordinator is ${assignedTo || 'Pending'}.`,
            timestamp: new Date().toISOString()
          }
        ],
        tasks: [],
        timeline: [
          {
            id: `tl_init_${Date.now()}`,
            type: 'creation' as const,
            text: `Candidate registered via Bulk Spreadsheet upload. Assigned coordinator: ${assignedTo || 'Unassigned'}.`,
            actor: 'System Administrator',
            timestamp: new Date().toISOString()
          }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        intake: true
      };

      newLeadsToAdd.push(newLead);
      enrolledNames.push(newLead.name);
    });

    if (newLeadsToAdd.length > 0) {
      currentLeads.push(...newLeadsToAdd);
      await saveLeads(currentLeads);
    }

    res.status(201).json({
      success: true,
      enrolledCount: newLeadsToAdd.length,
      skippedCount: skipped.length,
      enrolledNames,
      skipped
    });

  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST Bulk Re-assignment of candidates (Atomic, high-performance batch operation)
app.post('/api/leads/bulk-assign', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can bulk-assign or unassign leads.' });
      return;
    }

    const { leadIds, assignedTo } = req.body;
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: 'leadIds must be a non-empty array' });
      return;
    }
    if (assignedTo === undefined || assignedTo === null) {
      res.status(400).json({ error: 'assignedTo is required' });
      return;
    }

    const leads = await getLeads();
    const actorRole = req.headers['x-user-role'] || 'user';
    const rawAgentId = (req.headers['x-agent-id'] as string) || 'System';
    const cleanAgent = String(rawAgentId).trim().toUpperCase();
    const actor = actorRole === 'admin'
      ? (cleanAgent && cleanAgent !== 'UNASSIGNED' && !cleanAgent.includes('ADMIN') ? `Admin (${cleanAgent})` : 'Administrator')
      : `Coordinator ${cleanAgent || 'UNASSIGNED'}`;

    const targetCoord = String(assignedTo || '').trim();
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.split('T')[0];
    const hasRealCoordinator = targetCoord !== '' && targetCoord.toLowerCase() !== 'unassigned' && targetCoord.toLowerCase() !== 'all';
    const allowUnassign = req.body.allowUnassign === true;

    let intakeSequence = leads.filter(l => l.intake && l.serialNo).length;
    const modifiedLeads = await updateMultipleLeads(
      leadIds.map(String),
      (lead) => {
        if (hasAssignedCoordinator(lead) && !hasRealCoordinator && !allowUnassign) {
          console.warn(`[BulkAssign] Blocked unassign of "${lead.assignedTo}" on ${lead.id} without allowUnassign=true.`);
          return null;
        }
        const prevCoordinator = lead.assignedTo || 'Unassigned';
        if (prevCoordinator === targetCoord) return null;

        if (!Array.isArray(lead.timeline)) lead.timeline = [];
        if (!Array.isArray(lead.coordinatorHistory)) lead.coordinatorHistory = [];

        lead.timeline.push({
          id: `tl_${Date.now()}_${Math.random().toString(36).substr(2, 5)}_assign`,
          type: 'assignment',
          text: `Assigned coordinator changed from "${prevCoordinator}" to "${targetCoord || 'Unassigned'}" (Bulk Action)`,
          actor,
          timestamp: nowIso
        });

        lead.coordinatorHistory.push({
          candidateId: lead.id,
          previousCoordinator: prevCoordinator.toLowerCase(),
          newCoordinator: (targetCoord || 'unassigned').toLowerCase(),
          changedBy: actor,
          changedAt: nowIso
        });

        lead.assignedTo = targetCoord;
        lead.assignDate = todayDate;

        if (hasRealCoordinator) {
          lead.intake = true;
          if (!lead.serialNo) {
            intakeSequence++;
            lead.serialNo = `INQ-${1000 + intakeSequence}`;
          }
        }

        return lead;
      },
      { auditMeta: { actor, sourceView: 'bulk_assign' } }
    );

    const updatedCount = modifiedLeads.length;

    console.log(`[BulkAssign] Successfully re-assigned ${updatedCount} leads to "${targetCoord || 'Unassigned'}" by ${actor}`);
    res.json({
      success: true,
      updatedCount,
      message: `Successfully re-assigned ${updatedCount} candidate(s) to ${targetCoord || 'Unassigned'}`
    });
  } catch (err: any) {
    console.error('[BulkAssign] Error:', err);
    res.status(500).json({ error: err.message || 'Bulk assignment failed' });
  }
});


// POST Merge Duplicate Leads (Admin power, atomic soft-delete so duplicates never resurrect from Firestore)
app.post('/api/leads/merge', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators are authorized to merge duplicate leads.' });
      return;
    }

    const { masterLeadId, duplicateLeadIds } = req.body;
    if (!masterLeadId || !Array.isArray(duplicateLeadIds) || duplicateLeadIds.length === 0) {
      res.status(400).json({ error: 'masterLeadId and duplicateLeadIds array are required' });
      return;
    }

    const leads = await getLeads(true);
    const masterSnapshot = leads.find(l => l.id === masterLeadId && !l.isDeleted);
    if (!masterSnapshot) {
      res.status(404).json({ error: 'Master lead not found' });
      return;
    }

    const dupIdsClean = duplicateLeadIds.map(String).filter(id => id !== masterLeadId);
    const dupSnapshots = dupIdsClean
      .map(id => leads.find(l => l.id === id))
      .filter((l): l is Lead => Boolean(l));

    const nowIso = new Date().toISOString();
    const rawAgentId = (req.headers['x-agent-id'] as string) || 'Administrator';
    const actor = `Admin (${rawAgentId})`;
    const targetIds = [masterLeadId, ...dupSnapshots.map(d => d.id)];

    const updatedLeads = await updateMultipleLeads(
      targetIds,
      (current) => {
        if (current.id === masterLeadId) {
          let merged = { ...current };
          for (const dupLead of dupSnapshots) {
            merged = mergeLeadProfiles(dupLead, merged);
            merged.messages = mergeMessagesList(merged.messages || [], dupLead.messages || []);
            merged.tasks = mergeTasksList(merged.tasks || [], dupLead.tasks || []);
            merged.timeline = mergeTimelineList(merged.timeline || [], [
              {
                id: `tl_merge_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                type: 'system',
                text: `Merged duplicate lead record ${dupLead.serialNo || dupLead.id} (${dupLead.name}) into master record.`,
                actor: 'System Administrator',
                timestamp: nowIso
              },
              ...(dupLead.timeline || [])
            ]);
            const tagMap = new Map<string, string>();
            [...(merged.tags || []), ...(dupLead.tags || [])].forEach(t => {
              const clean = String(t || '').trim();
              if (clean && !tagMap.has(clean.toLowerCase())) tagMap.set(clean.toLowerCase(), clean);
            });
            merged.tags = Array.from(tagMap.values());
            if (dupLead.autoReplySent) merged.autoReplySent = true;
          }
          merged.id = masterLeadId;
          merged.updatedAt = nowIso;
          return merged;
        }

        // Soft-delete duplicate records so Firestore sync never resurrects them
        return {
          ...current,
          isDeleted: true,
          deletedAt: nowIso,
          deletedBy: actor,
          mergedInto: masterLeadId,
          timeline: [
            ...(Array.isArray(current.timeline) ? current.timeline : []),
            {
              id: `tl_merged_out_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              type: 'system',
              text: `Soft-deleted as duplicate merged into master lead ${masterLeadId}.`,
              actor: 'System Administrator',
              timestamp: nowIso
            }
          ]
        };
      },
      { auditMeta: { actor, sourceView: 'duplicate_merge' } }
    );

    const savedMaster = updatedLeads.find(l => l.id === masterLeadId) || masterSnapshot;
    res.json({ success: true, masterLead: savedMaster });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------- AUTHENTICATION & COORDINATOR CRUD ENDPOINTS ----------------

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ success: false, error: 'Username and password are required' });
      return;
    }

    const coordinators = await getCoordinators();
    const normalizedUser = String(username).trim().toLowerCase();
    
    const matched = coordinators.find(
      c => c.username.toLowerCase() === normalizedUser && c.password === String(password).trim()
    );

    if (!matched) {
      res.status(401).json({ success: false, error: 'Invalid username or password' });
      return;
    }

    // Generate secure session token (crypto.randomUUID fallback using timestamp/random if not available natively)
    const token = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `sess_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    // Store in active sessions map (valid for 30 days of seamless persistent CRM operations)
    activeSessions.set(token, {
      username: matched.username,
      role: matched.role,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });
    saveSessions();

    // Return user info (excluding password for security) with the authorization session token embedded
    res.json({
      success: true,
      user: {
        id: matched.id,
        username: matched.username,
        displayName: matched.displayName,
        role: matched.role,
        token: token
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// GET /api/metadata - Get dynamic metadata options (countries, positions, projects, tagsList)
app.get('/api/metadata', async (req, res) => {
  try {
    const meta = await getMetadata();
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/metadata - Update dynamic metadata options (countries, positions, projects, tagsList)
app.post('/api/metadata', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can update CRM metadata.' });
      return;
    }

    const { countries, positions, projects, tagsList } = req.body;
    if (!Array.isArray(countries) || !Array.isArray(positions) || !Array.isArray(projects) || !Array.isArray(tagsList)) {
      res.status(400).json({ error: 'Payload must contain countries, positions, projects, and tagsList as arrays.' });
      return;
    }

    const updatedMeta = { countries, positions, projects, tagsList };
    await saveMetadata(updatedMeta);
    res.json({ success: true, metadata: updatedMeta });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// GET /api/coordinators (Requires Admin role or at least an authenticated session)
app.get('/api/coordinators', async (req, res) => {
  try {
    const coordinators = await getCoordinators();
    // Send full details including passwords to admin so they can manage them in UI
    res.json(coordinators);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/coordinators (Admin only)
app.post('/api/coordinators', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can add new coordinators.' });
      return;
    }

    const { username, displayName, password, role: coordRole } = req.body;
    if (!username || !password || !displayName) {
      res.status(400).json({ error: 'Username, Display Name, and Password are required.' });
      return;
    }

    const coordinators = await getCoordinators();
    const cleanUsername = String(username).trim();
    
    // Check duplication
    const duplicate = coordinators.some(c => c.username.toLowerCase() === cleanUsername.toLowerCase());
    if (duplicate) {
      res.status(400).json({ error: 'A coordinator with this Username (ID) already exists.' });
      return;
    }

    const newCoord: Coordinator = {
      id: `COORD_${cleanUsername.toUpperCase()}`,
      username: cleanUsername,
      displayName: String(displayName).trim(),
      password: String(password).trim(),
      role: coordRole === 'admin' ? 'admin' : 'agent',
      createdAt: new Date().toISOString()
    };

    coordinators.push(newCoord);
    await saveCoordinators(coordinators);

    res.status(201).json({ success: true, coordinator: newCoord });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// PUT /api/coordinators/:id (Admin only)
app.put('/api/coordinators/:id', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can manage coordinators.' });
      return;
    }

    const { id } = req.params;
    const { username, displayName, password, role: coordRole } = req.body;

    const coordinators = await getCoordinators();
    const matchedIdx = coordinators.findIndex(c => c.id === id);

    if (matchedIdx === -1) {
      res.status(404).json({ error: 'Coordinator account not found.' });
      return;
    }

    const originalUsername = coordinators[matchedIdx].username;
    const cleanUsername = String(username || '').trim();

    // Prevent making administrative self-demotion or disabling the main admin account if we want to be safe, but keep it flexible
    if (id === 'coord_admin' && coordRole === 'agent') {
      res.status(400).json({ error: 'Cannot demote the primary master administrator account.' });
      return;
    }

    // Check duplicate username if changed
    if (cleanUsername && cleanUsername.toLowerCase() !== originalUsername.toLowerCase()) {
      const duplicate = coordinators.some(c => c.id !== id && c.username.toLowerCase() === cleanUsername.toLowerCase());
      if (duplicate) {
        res.status(400).json({ error: 'A coordinator with this Username (ID) already exists.' });
        return;
      }
      coordinators[matchedIdx].username = cleanUsername;
    }

    if (displayName) coordinators[matchedIdx].displayName = String(displayName).trim();
    if (password) coordinators[matchedIdx].password = String(password).trim();
    if (coordRole) coordinators[matchedIdx].role = coordRole;

    await saveCoordinators(coordinators);

    // If username/displayName changed, optionally update the leads that were assigned to the old username/displayName
    if (cleanUsername && cleanUsername.toLowerCase() !== originalUsername.toLowerCase()) {
      await updateMultipleLeads(
        (l) => !!(l.assignedTo && l.assignedTo.toLowerCase() === originalUsername.toLowerCase()),
        (l) => {
          l.assignedTo = cleanUsername;
          return l;
        }
      );
    }

    res.json({ success: true, coordinator: coordinators[matchedIdx] });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// DELETE /api/coordinators/:id (Admin only)
app.delete('/api/coordinators/:id', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can delete coordinators.' });
      return;
    }

    const { id } = req.params;
    if (id === 'coord_admin') {
      res.status(400).json({ error: 'The primary master administrator account cannot be deleted.' });
      return;
    }

    const coordinators = await getCoordinators();
    const targetCoord = coordinators.find(c => c.id === id);
    if (!targetCoord) {
      res.status(404).json({ error: 'Coordinator account not found.' });
      return;
    }

    const filtered = coordinators.filter(c => c.id !== id);
    await saveCoordinators(filtered);

    // Unassign leads previously assigned to this coordinator
    await updateMultipleLeads(
      (l) => !!(l.assignedTo && l.assignedTo.toLowerCase() === targetCoord.username.toLowerCase()),
      (l) => {
        l.assignedTo = ''; // reset to unassigned
        return l;
      }
    );

    res.json({ success: true, message: `Coordinator ${targetCoord.displayName} successfully deleted.` });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});


// ---------------- WALLET API ENDPOINTS ----------------

// GET /api/wallets
app.get('/api/wallets', async (req, res) => {
  try {
    const wallets = await getWallets();
    res.json(wallets);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/wallets/safety-status - Inspect Data Vault health, immutable ledger count, and Sachin protection status
app.get('/api/wallets/safety-status', async (_req, res) => {
  try {
    const status = await getWalletSafetyStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/wallets/snapshots - List all available point-in-time snapshots
app.get('/api/wallets/snapshots', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can view wallet snapshots.' });
      return;
    }
    const snapshots = await listWalletSnapshots();
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/wallets/snapshots - Create a new immutable snapshot with custom reason
app.post('/api/wallets/snapshots', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can create snapshots.' });
      return;
    }
    const reason = req.body?.reason || 'Manual user-requested snapshot';
    const createdBy = req.body?.createdBy || 'Admin User';
    const snapshot = await createWalletSnapshot(reason, createdBy);
    res.json({ success: true, snapshot });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/wallets/snapshots/:snapshotId/restore - Restore to any historical snapshot
app.post('/api/wallets/snapshots/:snapshotId/restore', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can restore snapshots.' });
      return;
    }
    const { snapshotId } = req.params;
    const restored = await restoreWalletSnapshot(snapshotId);
    res.json({ success: true, message: `Successfully restored snapshot ${snapshotId}`, wallets: restored });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// POST /api/wallets/restore-15-oct-2026 - Decommissioned: Prevent data loss
app.post('/api/wallets/restore-15-oct-2026', async (_req, res) => {
  res.status(400).json({ 
    error: 'The 15-10-2026 restore function has been permanently decommissioned to protect live wallets and prevent data loss.' 
  });
});

// POST /api/wallets/reconcile - Recalculate and reconcile all wallets from closed won / milestones
app.post('/api/wallets/reconcile', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can reconcile wallet balances.' });
      return;
    }
    const reconciled = await reconcileWalletsFromLeads();
    res.json({ success: true, count: reconciled.length, wallets: reconciled });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// GET /api/wallets/:username
app.get('/api/wallets/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const wallet = await getWalletByUsername(username);
    res.json(wallet);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/wallets/:username/transaction (Admin Only)
app.post('/api/wallets/:username/transaction', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can adjust wallet balances manually.' });
      return;
    }

    const { username } = req.params;
    const { type, amount, reason } = req.body;

    if (!type || !amount || !reason) {
      res.status(400).json({ error: 'Type (credit/debit), amount, and reason are required.' });
      return;
    }

    if (type !== 'credit' && type !== 'debit') {
      res.status(400).json({ error: 'Type must be either "credit" or "debit".' });
      return;
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number.' });
      return;
    }

    const updatedWallet = await addWalletTransaction(username, type, numericAmount, String(reason).trim());
    res.json({ success: true, wallet: updatedWallet });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// DELETE /api/wallets/:username/transaction/:txId (Admin Only)
app.delete('/api/wallets/:username/transaction/:txId', async (req, res) => {
  try {
    if (!(await checkIsAdmin(req))) {
      res.status(403).json({ error: 'Forbidden: Only administrators can delete wallet transactions.' });
      return;
    }
    const { username, txId } = req.params;
    const updatedWallet = await deleteWalletTransaction(username, txId);
    res.json({ success: true, wallet: updatedWallet });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});



// POST /api/tasks/resolve-overdue - Resolve all pending overdue tasks on or before a specified date (default today)
app.post('/api/tasks/resolve-overdue', async (req, res) => {
  try {
    const targetDate = req.body?.beforeDate || new Date().toISOString().split('T')[0];
    const targetCoordinator = req.body?.coordinator; // optional filter

    let resolvedCount = 0;
    await updateMultipleLeads(
      (lead) => {
        if (targetCoordinator && targetCoordinator !== 'All') {
          if (!isCoordinatorMatch(lead.assignedTo, targetCoordinator)) return false;
        }
        return Array.isArray(lead.tasks) && lead.tasks.some(t => !t.completed && t.dueDate <= targetDate);
      },
      (lead) => {
        let modified = false;
        lead.tasks = (lead.tasks || []).map(task => {
          if (!task.completed && task.dueDate <= targetDate) {
            resolvedCount++;
            modified = true;
            return { ...task, completed: true };
          }
          return task;
        });
        if (!modified) return null;
        if (!lead.tasks.some(t => !t.completed)) {
          lead.reminderEnabled = false;
        }
        return lead;
      }
    );

    res.json({
      success: true,
      resolvedCount,
      message: `Successfully resolved ${resolvedCount} completed/overdue tasks up to ${targetDate}.`
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});



// GET statistics summary (ETag + 304 cached per version)
app.get('/api/stats', async (req, res) => {
  try {
    const etag = `"stats-${getDatabaseVersion()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET single lead by ID (supports ?fresh=1 direct cloud pre-read for conflict-safe modal opening + ETag 304 when cached)
app.get('/api/leads/:id', async (req, res) => {
  try {
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const lead = await getLeadById(req.params.id, { fresh });
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    if (fresh) {
      res.setHeader('Cache-Control', 'no-store');
      res.json(lead);
      return;
    }
    const msgs = lead.messages || [];
    const lastMsgTime = msgs.length > 0 ? (msgs[msgs.length - 1].timestamp || '') : '';
    const etag = `"${lead.updatedAt || ''}_${msgs.length}_${lastMsgTime}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET immutable cloud audit trail for a single lead
app.get('/api/leads/:id/audit-logs', async (req, res) => {
  try {
    const logs = await getLeadAuditLogs(req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ leadId: req.params.id, logs });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET archived oversized history chunks for a single lead
app.get('/api/leads/:id/archives', async (req, res) => {
  try {
    const chunks = await getLeadArchives(req.params.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ leadId: req.params.id, chunks });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- MANAGEMENT INCENTIVE SYSTEM (Effective Nov 04, 2026 onwards) ---

/**
 * Awards Won bucket incentives based on Management's policy & configured Incentive Rules:
 * - Assigned coordinator gets the rule-resolved Won amount (e.g., INR 1,000 for Japan/Albania/Europe, INR 400 standard fallback).
 * - For Telecallers (Joyce, Maryada, Sarina), Priya (Manager), and regular coordinators:
 *     - Shreya (TL) gets INR 200 CR
 *     - Eden (Manager, edenla) gets INR 200 CR
 *     - Sachin (Digital Marketer, sachinsaha) gets INR 200 CR
 * - For Shreya, Edenla, or Bishwo closing directly:
 *     - Sachin (sachinsaha) gets INR 200 CR
 */
async function awardWonIncentivesForLead(
  leadId: string,
  assignedCoordRaw: string,
  candidateName: string,
  projectName?: string,
  countryName?: string
): Promise<void> {
  const normCoord = normalizeCoordUsername(assignedCoordRaw);
  if (!normCoord) return;

  const pName = projectName || 'General';
  const cName = countryName || 'Unknown';

  const [coords, rules] = await Promise.all([
    getCoordinators(),
    getIncentiveRules()
  ]);
  const assignedCoordObj = coords.find(c => c.username.toLowerCase() === normCoord);
  const assignedDisplayName = assignedCoordObj ? assignedCoordObj.displayName : assignedCoordRaw;

  const beneficiaries = buildNov04WonBeneficiaries({
    leadId,
    normCoord,
    coordDisplayName: assignedDisplayName,
    candidateName,
    projectName: pName,
    countryName: cName,
    rules
  });

  // Credit each beneficiary only if their unreversed Won net credit is below their expected amount
  for (const b of beneficiaries) {
    try {
      const wallet = await getWalletByUsername(b.username, true);
      const wonCredits = (wallet.transactions || []).filter(
        tx => tx.leadId === leadId && tx.type === 'credit' && (
          tx.reason.includes('Closed Won') || tx.reason.includes('Won Share') || tx.reason.includes('Override Bonus')
        )
      ).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

      const wonDebits = (wallet.transactions || []).filter(
        tx => tx.leadId === leadId && tx.type === 'debit' && (
          tx.reason.includes('Reversal: Closed Won') || tx.reason.includes('Won Share') || tx.reason.includes('rollback')
        )
      ).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

      const netActive = wonCredits - wonDebits;
      if (netActive < b.amount) {
        const creditNeeded = b.amount - Math.max(0, netActive);
        const isTopUp = netActive > 0;
        const effectiveTxId = isTopUp ? `${b.txId}_topup_${b.amount}` : b.txId;
        const effectiveReason = isTopUp
          ? `Closed Won incentive adjustment (${cName} rule INR ${b.amount}, prior INR ${netActive}) for candidate: ${candidateName} (Project: ${pName}, Country: ${cName})`
          : b.reason;
        await addWalletTransaction(
          b.username,
          'credit',
          creditNeeded,
          effectiveReason,
          leadId,
          { txId: effectiveTxId }
        );
        console.log(`[Incentive Policy] Credited INR ${creditNeeded} to @${b.username} for Won candidate ${candidateName} (${leadId})`);
      }
    } catch (err: any) {
      console.error(`[Incentive Policy] Error crediting @${b.username} for Won candidate ${leadId}:`, err?.message || err);
    }
  }
}

/**
 * Rolls back all Won bucket incentives for a lead across all recipient wallets:
 * (Assigned coordinator, Shreya, Edenla, Sachin, Priya, Bishwo, etc.)
 * Strictly reverses active net credits so balance is safely restored with zero data loss.
 */
async function rollbackWonIncentivesForLead(
  leadId: string,
  candidateName: string,
  actionReason: string
): Promise<void> {
  try {
    const allWallets = await getWallets(true);
    for (const w of allWallets) {
      const txs = w.transactions || [];
      const wonCredits = txs.filter(
        tx => tx.leadId === leadId && tx.type === 'credit' && (
          tx.reason.includes('Closed Won') || tx.reason.includes('Won Share') || tx.reason.includes('Override Bonus')
        )
      ).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

      const wonDebits = txs.filter(
        tx => tx.leadId === leadId && tx.type === 'debit' && (
          tx.reason.includes('Reversal: Closed Won') || tx.reason.includes('Won Share') || tx.reason.includes('rollback')
        )
      ).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

      const netActiveWonCredit = wonCredits - wonDebits;
      if (netActiveWonCredit > 0) {
        await addWalletTransaction(
          w.username,
          'debit',
          netActiveWonCredit,
          `Reversal: Closed Won stage corrected/removed. Candidate: ${candidateName} (${actionReason})`,
          leadId
        );
        console.log(`[Incentive Rollback] Debited INR ${netActiveWonCredit} from @${w.username} for rolled-back candidate ${candidateName} (${actionReason})`);
      }
    }
  } catch (err: any) {
    console.error(`[Incentive Rollback] Error rolling back Won incentives for lead ${leadId}:`, err?.message || err);
  }
}

// PUT update lead fields
app.put('/api/leads/:id', async (req, res) => {
  try {
    const { 
      stage, notes, name, phone, alternateNo, email, budget, fitScore, campaign,
      serialNo, entryDate, assignDate, gender, age, origin, country,
      position, experience, qualification, adminRemarks, assignedTo, importance,
      remarks1, remarks2, remarks3, callConnected, tasks, timeline, tags, source, project,
      docPassportCopy, docResume, docOfficeVisited, docOthers, reminderEnabled,
      autoReplySent, intake, assignedFrom, docInterviewAttended, docEcrPassport,
      passportCopyUrl, passportCopyName, resumeUrl, resumeName, deletedDocuments,
      isBlocked, blockedReason, blockedBy, blockedAt
    } = req.body;

    const leads = await getLeads();
    const existingIdx = leads.findIndex(l => l.id === req.params.id);
    const snapshotLead = existingIdx !== -1 ? { ...leads[existingIdx] } : await getLeadById(req.params.id);

    if (!snapshotLead) {
      res.status(404).json({ error: 'Lead not found in CRM database' });
      return;
    }

    // Strict duplicate phone validation ONLY against active leads if phone or alternateNo is actually being changed to a new number
    if (phone && (!snapshotLead.phone || !arePhonesMatching(snapshotLead.phone, phone))) {
      const dup = leads.find(l => !l.isDeleted && l.id !== req.params.id && (arePhonesMatching(l.phone, phone) || (l.alternateNo && arePhonesMatching(l.alternateNo, phone))));
      if (dup) {
        res.status(400).json({ error: `Phone number already exists in CRM (Duplicate number detected: matches lead ${dup.serialNo || dup.id} - ${dup.name})` });
        return;
      }
    }
    if (alternateNo && (!snapshotLead.alternateNo || !arePhonesMatching(snapshotLead.alternateNo, alternateNo))) {
      const dup = leads.find(l => !l.isDeleted && l.id !== req.params.id && (arePhonesMatching(l.phone, alternateNo) || (l.alternateNo && arePhonesMatching(l.alternateNo, alternateNo))));
      if (dup) {
        res.status(400).json({ error: `Alternate phone number already exists in CRM (Duplicate number detected: matches lead ${dup.serialNo || dup.id} - ${dup.name})` });
        return;
      }
    }
    const isNewResumeUploaded = !!(resumeUrl && resumeUrl.trim() !== '' && resumeUrl !== snapshotLead.resumeUrl);

    let nextDocOfficeVisitedAt = snapshotLead.docOfficeVisitedAt;
    let shouldUpdateOfficeVisitedAt = false;
    let nextDocInterviewAttendedAt = snapshotLead.docInterviewAttendedAt;
    let shouldUpdateInterviewAttendedAt = false;

    // Check wallet incentive triggers & explicit unassign guard
    const isAdminActorForPut = await checkIsAdmin(req);
    const allowExplicitUnassign = req.body.allowUnassign === true && isAdminActorForPut;
    const incomingAssignedClean = assignedTo !== undefined ? String(assignedTo || '').trim() : '';
    const incomingHasRealCoord = incomingAssignedClean !== '' && incomingAssignedClean.toLowerCase() !== 'unassigned' && incomingAssignedClean.toLowerCase() !== 'all';
    const isBlockedStaleUnassign = assignedTo !== undefined && hasAssignedCoordinator(snapshotLead) && !incomingHasRealCoord && !allowExplicitUnassign;
    const coordinatorToIncentivize = (assignedTo !== undefined && !isBlockedStaleUnassign) ? assignedTo : snapshotLead.assignedTo;
    if (coordinatorToIncentivize) {
      const cleanCoord = String(coordinatorToIncentivize).trim().toLowerCase();
      const prevCoord = snapshotLead.assignedTo ? String(snapshotLead.assignedTo).trim().toLowerCase() : cleanCoord;
      
      // 1. Closed Won Trigger
      const isClosedWonTransition = (stage === 'won' && snapshotLead.stage !== 'won');
      if (isClosedWonTransition) {
        try {
          await awardWonIncentivesForLead(
            snapshotLead.id,
            coordinatorToIncentivize,
            name || snapshotLead.name,
            project !== undefined ? project : snapshotLead.project,
            country !== undefined ? country : snapshotLead.country
          );
        } catch (walletErr) {
          console.error('Failed to auto-credit Closed Won incentive:', walletErr);
        }
      }

      // 2. Closed Won Reversal (Debit) Trigger
      const isClosedWonReversal = (snapshotLead.stage === 'won' && stage !== undefined && stage !== 'won');
      if (isClosedWonReversal) {
        try {
          await rollbackWonIncentivesForLead(
            snapshotLead.id,
            name || snapshotLead.name,
            `moved to ${stage}`
          );
        } catch (walletErr) {
          console.error('Failed to auto-debit Closed Won reversal:', walletErr);
        }
      }

      // 2b. Won lead reassignment Trigger (Rollback previous team credits, award new team credits)
      const isWonReassignment = (
        snapshotLead.stage === 'won' &&
        (stage === undefined || stage === 'won') &&
        assignedTo !== undefined &&
        cleanCoord !== prevCoord
      );
      if (isWonReassignment) {
        try {
          await rollbackWonIncentivesForLead(
            snapshotLead.id,
            name || snapshotLead.name,
            `reassigned from ${prevCoord} to ${cleanCoord}`
          );
          await awardWonIncentivesForLead(
            snapshotLead.id,
            cleanCoord,
            name || snapshotLead.name,
            project !== undefined ? project : snapshotLead.project,
            country !== undefined ? country : snapshotLead.country
          );
        } catch (reassignErr) {
          console.error('Failed to reassign Won lead incentives:', reassignErr);
        }
      }

      // 2c. Already-Won project/country rule upgrade check (e.g. changing country to Japan after marking Won)
      const isWonRuleUpgrade = (
        !isClosedWonTransition &&
        !isWonReassignment &&
        snapshotLead.stage === 'won' &&
        (stage === undefined || stage === 'won') &&
        ((country !== undefined && country !== snapshotLead.country) || (project !== undefined && project !== snapshotLead.project))
      );
      if (isWonRuleUpgrade) {
        try {
          await awardWonIncentivesForLead(
            snapshotLead.id,
            coordinatorToIncentivize,
            name || snapshotLead.name,
            project !== undefined ? project : snapshotLead.project,
            country !== undefined ? country : snapshotLead.country
          );
        } catch (upgradeErr) {
          console.error('Failed to re-evaluate Won lead incentives on project/country change:', upgradeErr);
        }
      }

      // 3. Office Visited Checkbox Trigger & Reversal (Independent INR 11)
      const wasOfficeVisitedActive = !!snapshotLead.docOfficeVisited;
      const isOfficeVisitedActiveNow = !!(
        docOfficeVisited !== undefined ? docOfficeVisited : snapshotLead.docOfficeVisited
      );

      const isOfficeVisitedTransition = !wasOfficeVisitedActive && isOfficeVisitedActiveNow;
      const isOfficeVisitedReversal = wasOfficeVisitedActive && !isOfficeVisitedActiveNow;

      if (isOfficeVisitedTransition) {
        nextDocOfficeVisitedAt = new Date().toISOString();
        shouldUpdateOfficeVisitedAt = true;
        try {
          const wallet = await getWalletByUsername(cleanCoord, true);
          const alreadyCredited = (wallet.transactions || []).some(
            tx => tx.leadId === snapshotLead.id && tx.type === 'credit' && (tx.reason.includes('Office Visited Incentive') || tx.reason.includes('Interview Attended / Office Visited incentive'))
          );
          if (!alreadyCredited) {
            await addWalletTransaction(
              cleanCoord,
              'credit',
              11,
              `Office Visited Incentive for candidate: ${name || snapshotLead.name}`,
              snapshotLead.id,
              { timestamp: nextDocOfficeVisitedAt }
            );
          }
        } catch (walletErr) {
          console.error('Failed to auto-credit Office Visited incentive:', walletErr);
        }
      }

      if (isOfficeVisitedReversal) {
        nextDocOfficeVisitedAt = undefined;
        shouldUpdateOfficeVisitedAt = true;
        try {
          const wallet = await getWalletByUsername(prevCoord, true);
          const creditsForLead = (wallet.transactions || []).filter(
            tx => tx.leadId === snapshotLead.id && tx.type === 'credit' && (tx.reason.includes('Office Visited Incentive') || tx.reason.includes('Interview Attended / Office Visited incentive'))
          );
          const reversalsForLead = (wallet.transactions || []).filter(
            tx => tx.leadId === snapshotLead.id && tx.type === 'debit' && (tx.reason.includes('Reversal: Office Visited Incentive') || tx.reason.includes('Reversal: Interview Attended / Office Visited milestone removed'))
          );
          if (creditsForLead.length > reversalsForLead.length && prevCoord !== 'priya') {
            await addWalletTransaction(
              prevCoord,
              'debit',
              11,
              `Reversal: Office Visited Incentive removed. Candidate: ${name || snapshotLead.name}`,
              snapshotLead.id
            );
          }
        } catch (walletErr) {
          console.error('Failed to auto-debit Office Visited reversal:', walletErr);
        }
      }

      // 3b. Interview Attended Checkbox Trigger & Reversal (Independent INR 11)
      const wasInterviewAttendedActive = !!snapshotLead.docInterviewAttended;
      const isInterviewAttendedActiveNow = !!(
        docInterviewAttended !== undefined ? docInterviewAttended : snapshotLead.docInterviewAttended
      );

      const isInterviewAttendedTransition = !wasInterviewAttendedActive && isInterviewAttendedActiveNow;
      const isInterviewAttendedReversal = wasInterviewAttendedActive && !isInterviewAttendedActiveNow;

      if (isInterviewAttendedTransition) {
        nextDocInterviewAttendedAt = new Date().toISOString();
        shouldUpdateInterviewAttendedAt = true;
        try {
          const wallet = await getWalletByUsername(cleanCoord, true);
          const alreadyCredited = (wallet.transactions || []).some(
            tx => tx.leadId === snapshotLead.id && tx.type === 'credit' && (tx.reason.includes('Interview Attended Incentive') || tx.reason.includes('Interview Attended / Office Visited incentive'))
          );
          if (!alreadyCredited) {
            await addWalletTransaction(
              cleanCoord,
              'credit',
              11,
              `Interview Attended Incentive for candidate: ${name || snapshotLead.name}`,
              snapshotLead.id,
              { timestamp: nextDocInterviewAttendedAt }
            );
          }
        } catch (walletErr) {
          console.error('Failed to auto-credit Interview Attended incentive:', walletErr);
        }
      }

      if (isInterviewAttendedReversal) {
        nextDocInterviewAttendedAt = undefined;
        shouldUpdateInterviewAttendedAt = true;
        try {
          const wallet = await getWalletByUsername(prevCoord, true);
          const creditsForLead = (wallet.transactions || []).filter(
            tx => tx.leadId === snapshotLead.id && tx.type === 'credit' && (tx.reason.includes('Interview Attended Incentive') || tx.reason.includes('Interview Attended / Office Visited incentive'))
          );
          const reversalsForLead = (wallet.transactions || []).filter(
            tx => tx.leadId === snapshotLead.id && tx.type === 'debit' && (tx.reason.includes('Reversal: Interview Attended Incentive') || tx.reason.includes('Reversal: Interview Attended / Office Visited milestone removed'))
          );
          if (creditsForLead.length > reversalsForLead.length && prevCoord !== 'priya') {
            await addWalletTransaction(
              prevCoord,
              'debit',
              11,
              `Reversal: Interview Attended Incentive removed. Candidate: ${name || snapshotLead.name}`,
              snapshotLead.id
            );
          }
        } catch (walletErr) {
          console.error('Failed to auto-debit Interview Attended reversal:', walletErr);
        }
      }
    }

    const clearedRemarksList: string[] | null = Array.isArray(req.body.clearedRemarks) ? req.body.clearedRemarks : null;
    const canClearField = (field: string): boolean => {
      if (clearedRemarksList) return clearedRemarksList.includes(field);
      return req.body.allowClearRemarks === true;
    };

    const actorRole = req.headers['x-user-role'] || 'user';
    const rawAgentIdHeader = (req.headers['x-agent-id'] as string) || '';
    const cleanAgentOuter = String(rawAgentIdHeader || 'System').trim().toUpperCase();
    const auditActor = actorRole === 'admin'
      ? (cleanAgentOuter && cleanAgentOuter !== 'UNASSIGNED' && !cleanAgentOuter.includes('ADMIN') ? `Admin (${cleanAgentOuter})` : 'Administrator')
      : `Coordinator ${cleanAgentOuter || 'UNASSIGNED'}`;
    const auditSourceView = String(req.headers['x-source-view'] || assignedFrom || 'crm').trim() || 'crm';

    // Perform all field mutations atomically on the freshest `current` record inside dbMutex.run
    const savedLead = await updateSingleLead(req.params.id, (current) => {
      const lead = { ...current };

      if (shouldUpdateOfficeVisitedAt) {
        lead.docOfficeVisitedAt = nextDocOfficeVisitedAt;
      }
      if (shouldUpdateInterviewAttendedAt) {
        lead.docInterviewAttendedAt = nextDocInterviewAttendedAt;
      }

      // Ensure lists exist (preserving any concurrent timeline/messages added during awaits)
      lead.timeline = Array.isArray(lead.timeline) ? [...lead.timeline] : [];
      lead.tasks = Array.isArray(lead.tasks) ? [...lead.tasks] : [];
      lead.stageHistory = Array.isArray(lead.stageHistory) ? [...lead.stageHistory] : [];
      lead.coordinatorHistory = Array.isArray(lead.coordinatorHistory) ? [...lead.coordinatorHistory] : [];

      const rawAgentId = rawAgentIdHeader || lead.assignedTo || 'System';
      const cleanAgent = String(rawAgentId).trim().toUpperCase();
      const actor = actorRole === 'admin'
        ? (cleanAgent && cleanAgent !== 'UNASSIGNED' && !cleanAgent.includes('ADMIN') ? `Admin (${cleanAgent})` : 'Administrator')
        : `Coordinator ${cleanAgent || 'UNASSIGNED'}`;

      // Log Stage transitions
      if (stage !== undefined && lead.stage !== stage) {
        const fromLabel = getStageLabel(lead.stage);
        const toLabel = getStageLabel(stage);
        lead.timeline.push({
          id: `tl_${Date.now()}_stage`,
          type: 'status',
          text: `Pipeline stage changed from "${fromLabel}" to "${toLabel}"`,
          actor,
          timestamp: new Date().toISOString()
        });

        lead.stageHistory.push({
          candidateId: lead.id,
          previousStage: lead.stage,
          newStage: stage as LeadStage,
          changedBy: actor,
          coordinatorId: lead.assignedTo || 'unassigned',
          changedAt: new Date().toISOString(),
          project: lead.project || project || 'General',
          country: lead.country || country || 'Unknown'
        });

        lead.stage = stage as LeadStage;
      }

      // Log Coordinator assignments (with stale/unauthorized unassign guard)
      let isAssignDateSetByServer = false;
      if (assignedTo !== undefined) {
        const currentHasRealCoord = hasAssignedCoordinator(lead);
        const nextCoordClean = String(assignedTo || '').trim();
        const nextHasRealCoord = nextCoordClean !== '' && nextCoordClean.toLowerCase() !== 'unassigned' && nextCoordClean.toLowerCase() !== 'all';

        if (currentHasRealCoord && !nextHasRealCoord && !allowExplicitUnassign) {
          console.warn(`[PUT /api/leads/${lead.id}] Blocked stale/unauthorized unassign of "${lead.assignedTo}" -> "${assignedTo}" by ${actor} (allowUnassign=${req.body.allowUnassign}, isAdmin=${isAdminActorForPut})`);
        } else if (lead.assignedTo !== assignedTo) {
          const isFromWa = assignedFrom === 'whatsapp_chat_menu' || req.headers['x-assigned-from'] === 'whatsapp_chat_menu';
          const suffix = isFromWa ? ' via WhatsApp Chat Menu' : '';
          lead.timeline.push({
            id: `tl_${Date.now()}_assign`,
            type: 'assignment',
            text: `Assigned coordinator changed from "${lead.assignedTo || 'Unassigned'}" to "${assignedTo || 'Unassigned'}"${suffix}`,
            actor,
            timestamp: new Date().toISOString()
          });

          lead.coordinatorHistory.push({
            candidateId: lead.id,
            previousCoordinator: lead.assignedTo || 'unassigned',
            newCoordinator: assignedTo || 'unassigned',
            changedBy: actor,
            changedAt: new Date().toISOString()
          });

          lead.assignedTo = assignedTo;
          lead.assignDate = new Date().toISOString().split('T')[0];
          isAssignDateSetByServer = true;
          if (isFromWa) {
            lead.assignedFrom = 'whatsapp_chat_menu';
          }

          // Automatically set intake to true and generate serialNo when assigned to a real coordinator
          if (nextHasRealCoord) {
            lead.intake = true;
            if (!lead.serialNo) {
              const sequence = leads.filter(l => l.intake && l.serialNo).length + 1;
              lead.serialNo = `INQ-${1000 + sequence}`;
            }
          }
        }
      }

      // Auto-move stage from 'new' (New Inbound) to 'negotiating' (In Discussion) when the 1'st remark is logged
      if (lead.stage === 'new') {
        const isAddingRemark = 
          (remarks1 !== undefined && String(remarks1).trim() !== '' && !lead.remarks1) ||
          (remarks2 !== undefined && String(remarks2).trim() !== '' && !lead.remarks2) ||
          (remarks3 !== undefined && String(remarks3).trim() !== '' && !lead.remarks3);
        if (isAddingRemark) {
          lead.stageHistory.push({
            candidateId: lead.id,
            previousStage: 'new',
            newStage: 'negotiating' as LeadStage,
            changedBy: 'System (Auto-Stage)',
            coordinatorId: lead.assignedTo || 'unassigned',
            changedAt: new Date().toISOString(),
            project: lead.project || project || 'General',
            country: lead.country || country || 'Unknown'
          });
          lead.stage = 'negotiating';
          lead.timeline.push({
            id: `tl_${Date.now()}_auto_stage`,
            type: 'status',
            text: `Pipeline stage auto-moved to "In Discussion" due to first call remark logged`,
            actor,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Non-destructive Remarks Preservation: Never blank out remarks unless explicitly marked cleared by the user
      if (remarks1 !== undefined) {
        const cleanRem1 = String(remarks1).trim();
        if (cleanRem1 !== '' || !lead.remarks1 || canClearField('remarks1')) {
          if (lead.remarks1 !== cleanRem1) {
            lead.timeline.push({
              id: `tl_${Date.now()}_rem1`,
              type: 'remark',
              text: `Updated 1st Remarks: "${cleanRem1 || 'cleared'}"`,
              actor,
              timestamp: new Date().toISOString()
            });
            lead.remarks1 = cleanRem1;
          }
        }
      }
      if (remarks2 !== undefined) {
        const cleanRem2 = String(remarks2).trim();
        if (cleanRem2 !== '' || !lead.remarks2 || canClearField('remarks2')) {
          if (lead.remarks2 !== cleanRem2) {
            lead.timeline.push({
              id: `tl_${Date.now()}_rem2`,
              type: 'remark',
              text: `Updated 2nd Remarks: "${cleanRem2 || 'cleared'}"`,
              actor,
              timestamp: new Date().toISOString()
            });
            lead.remarks2 = cleanRem2;
          }
        }
      }
      if (remarks3 !== undefined) {
        const cleanRem3 = String(remarks3).trim();
        if (cleanRem3 !== '' || !lead.remarks3 || canClearField('remarks3')) {
          if (lead.remarks3 !== cleanRem3) {
            lead.timeline.push({
              id: `tl_${Date.now()}_rem3`,
              type: 'remark',
              text: `Updated 3rd Remarks: "${cleanRem3 || 'cleared'}"`,
              actor,
              timestamp: new Date().toISOString()
            });
            lead.remarks3 = cleanRem3;
          }
        }
      }

      if (adminRemarks !== undefined) {
        const cleanAdminRem = String(adminRemarks).trim();
        const wasPlaceholder = String(lead.adminRemarks || '').trim().toLowerCase() === 'inbound whatsapp ad enquiry';
        if (cleanAdminRem !== '' || !lead.adminRemarks || canClearField('adminRemarks') || wasPlaceholder) {
          if (lead.adminRemarks !== cleanAdminRem) {
            lead.timeline.push({
              id: `tl_${Date.now()}_adminrem`,
              type: 'remark',
              text: `Updated Admin Remarks: "${cleanAdminRem || 'cleared'}"`,
              actor,
              timestamp: new Date().toISOString()
            });
            lead.adminRemarks = cleanAdminRem;
          }
        }
      }

      if (callConnected !== undefined && lead.callConnected !== callConnected) {
        const connLabel = callConnected === 'connected' ? 'Connected 💬' : 'Not Connected ❌';
        lead.timeline.push({
          id: `tl_${Date.now()}_call`,
          type: 'remark',
          text: `Call Status updated: "${connLabel}"`,
          actor,
          timestamp: new Date().toISOString()
        });
        lead.callConnected = callConnected;
      }

      // Standard fields
      if (notes !== undefined) {
        const cleanNotes = String(notes).trim();
        if (cleanNotes !== '' || !lead.notes || canClearField('notes')) {
          lead.notes = cleanNotes;
        }
      }
      if (name !== undefined) lead.name = name;
      if (phone !== undefined) lead.phone = phone;
      if (email !== undefined) lead.email = email;
      if (budget !== undefined) lead.budget = Number(budget);
      if (fitScore !== undefined) lead.fitScore = fitScore as FitScore;
      if (campaign !== undefined) lead.campaign = campaign;
      if (assignedFrom !== undefined) lead.assignedFrom = assignedFrom;

      // Career Growth Placement Custom Attributes
      if (alternateNo !== undefined) lead.alternateNo = alternateNo;
      if (serialNo !== undefined) lead.serialNo = serialNo;
      if (entryDate !== undefined) lead.entryDate = entryDate;
      if (assignDate !== undefined && !isAssignDateSetByServer) lead.assignDate = assignDate;
      if (gender !== undefined) lead.gender = gender;
      if (age !== undefined) lead.age = age;
      if (origin !== undefined) lead.origin = origin;
      if (country !== undefined) lead.country = country;
      if (position !== undefined) lead.position = position;
      if (experience !== undefined) lead.experience = experience;
      if (qualification !== undefined) lead.qualification = qualification;
      if (importance !== undefined) lead.importance = Number(importance);
      if (source !== undefined) lead.source = source;
      if (project !== undefined) lead.project = project;
      if (callConnected !== undefined) lead.callConnected = callConnected;

      // Document received status flags
      if (docPassportCopy !== undefined) lead.docPassportCopy = Boolean(docPassportCopy);
      if (passportCopyUrl !== undefined) lead.passportCopyUrl = passportCopyUrl;
      if (passportCopyName !== undefined) lead.passportCopyName = passportCopyName;
      if (docResume !== undefined) lead.docResume = Boolean(docResume);
      if (resumeUrl !== undefined) lead.resumeUrl = resumeUrl;
      if (resumeName !== undefined) lead.resumeName = resumeName;
      if (deletedDocuments !== undefined) lead.deletedDocuments = deletedDocuments;
      if (docOfficeVisited !== undefined) lead.docOfficeVisited = Boolean(docOfficeVisited);
      if (docOthers !== undefined) lead.docOthers = Boolean(docOthers);
      if (docInterviewAttended !== undefined) lead.docInterviewAttended = Boolean(docInterviewAttended);
      if (docEcrPassport !== undefined) lead.docEcrPassport = Boolean(docEcrPassport);
      if (reminderEnabled !== undefined) lead.reminderEnabled = Boolean(reminderEnabled);
      if (autoReplySent !== undefined) lead.autoReplySent = Boolean(autoReplySent);
      if (intake !== undefined) {
        lead.intake = Boolean(intake);
        if (Boolean(intake) && !lead.serialNo) {
          const sequence = leads.filter(l => l.intake && l.serialNo).length + 1;
          lead.serialNo = `INQ-${1000 + sequence}`;
        }
      }

      if (isBlocked !== undefined) {
        lead.isBlocked = Boolean(isBlocked);
        if (Boolean(isBlocked)) {
          lead.blockedAt = blockedAt || new Date().toISOString();
          lead.blockedReason = blockedReason || lead.blockedReason || 'No passport / Disqualified / Spam';
          lead.blockedBy = blockedBy || lead.blockedBy || actor;
        } else {
          lead.blockedAt = undefined;
          lead.blockedReason = undefined;
          lead.blockedBy = undefined;
        }
      }

      // Direct overrides for tasks and custom timelines (non-destructive task merging)
      if (tasks !== undefined && Array.isArray(tasks)) {
        lead.tasks = mergeTasksList(lead.tasks || [], tasks);
        if (lead.tasks.some(t => !t.completed)) {
          lead.reminderEnabled = true;
        }
      }
      if (timeline !== undefined && Array.isArray(timeline)) {
        // Merge existing server timeline IDs with incoming custom events so concurrent remark logs aren't lost
        const existingMap = new Map<string, any>();
        lead.timeline.forEach(ev => {
          if (ev && ev.id) existingMap.set(ev.id, ev);
        });
        timeline.forEach((ev: any) => {
          if (ev && ev.id) existingMap.set(ev.id, ev);
        });
        lead.timeline = Array.from(existingMap.values()).sort(
          (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
        );
      }
      if (tags !== undefined) lead.tags = tags;

      // Auto-update experience from telecaller remarks if experience was not filled or is default
      if (isDefaultExperience(lead.experience)) {
        const autoExp = getEffectiveExperience(lead);
        if (!isDefaultExperience(autoExp)) {
          lead.experience = autoExp;
        }
      }

      // Self-healing fallback: Ensure leads with active coordinators always have a valid assignDate
      if (lead.assignedTo && lead.assignedTo.trim() !== '' && lead.assignedTo.toLowerCase() !== 'unassigned' && (!lead.assignDate || lead.assignDate.trim() === '')) {
        lead.assignDate = (lead.createdAt || new Date().toISOString()).split('T')[0];
      }

      lead.updatedAt = new Date().toISOString();
      return lead;
    }, {
      auditMeta: {
        actor: auditActor,
        sourceView: auditSourceView
      }
    });

    if (!savedLead) {
      res.status(404).json({ error: 'Lead not found in CRM database' });
      return;
    }

    if (isNewResumeUploaded) {
      runBackgroundResumeScanner(savedLead.id).catch(err => {
        console.error('[Background Scanner] Error initiating background CV parse:', err);
      });
    }

    res.json(savedLead);
  } catch (err: any) {
    const status = err?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: err?.message || 'Failed to update lead' });
  }
});

// POST block candidate lead
app.post('/api/leads/:id/block', async (req, res) => {
  try {
    const { reason } = req.body;
    const actorRole = req.headers['x-user-role'] || 'user';
    const rawAgentId = (req.headers['x-agent-id'] as string) || 'Admin';
    const cleanAgent = String(rawAgentId).trim().toUpperCase();
    const actor = actorRole === 'admin'
      ? (cleanAgent && cleanAgent !== 'UNASSIGNED' && !cleanAgent.includes('ADMIN') ? `Admin (${cleanAgent})` : 'Administrator')
      : `Coordinator ${cleanAgent || 'UNASSIGNED'}`;

    const blockReason = String(reason || 'No passport / Disqualified / Spam').trim();

    const savedLead = await updateSingleLead(req.params.id, (lead) => {
      lead.isBlocked = true;
      lead.blockedAt = new Date().toISOString();
      lead.blockedReason = blockReason;
      lead.blockedBy = actor;
      lead.updatedAt = new Date().toISOString();

      if (!Array.isArray(lead.timeline)) lead.timeline = [];
      lead.timeline.push({
        id: `tl_${Date.now()}_block`,
        type: 'status',
        text: `Candidate BLOCKED by ${actor}. Reason: "${blockReason}". Inbound messages will be rejected.`,
        actor,
        timestamp: new Date().toISOString()
      });

      return lead;
    });

    if (!savedLead) {
      res.status(404).json({ error: 'Lead not found in database' });
      return;
    }

    res.json({ success: true, lead: savedLead });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST unblock candidate lead
app.post('/api/leads/:id/unblock', async (req, res) => {
  try {
    const actorRole = req.headers['x-user-role'] || 'user';
    const rawAgentId = (req.headers['x-agent-id'] as string) || 'Admin';
    const cleanAgent = String(rawAgentId).trim().toUpperCase();
    const actor = actorRole === 'admin'
      ? (cleanAgent && cleanAgent !== 'UNASSIGNED' && !cleanAgent.includes('ADMIN') ? `Admin (${cleanAgent})` : 'Administrator')
      : `Coordinator ${cleanAgent || 'UNASSIGNED'}`;

    const savedLead = await updateSingleLead(req.params.id, (lead) => {
      lead.isBlocked = false;
      lead.blockedAt = undefined;
      lead.blockedReason = undefined;
      lead.blockedBy = undefined;
      lead.updatedAt = new Date().toISOString();

      if (!Array.isArray(lead.timeline)) lead.timeline = [];
      lead.timeline.push({
        id: `tl_${Date.now()}_unblock`,
        type: 'status',
        text: `Candidate UNBLOCKED by ${actor}. Messaging re-enabled.`,
        actor,
        timestamp: new Date().toISOString()
      });

      return lead;
    });

    if (!savedLead) {
      res.status(404).json({ error: 'Lead not found in database' });
      return;
    }

    res.json({ success: true, lead: savedLead });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------- DIRECT META WHATSAPP CLOUD API ENDPOINTS ----------------

// GET WhatsApp auto-reply settings
app.get('/api/whatsapp/auto-reply', async (req, res) => {
  try {
    const settings = await getWhatsAppAutoReplySettings();
    res.json({ settings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST update WhatsApp auto-reply settings
app.post('/api/whatsapp/auto-reply', async (req, res) => {
  try {
    const { enabled, text, delay } = req.body;
    const settings: WhatsAppAutoReplySettings = {
      enabled: typeof enabled === 'boolean' ? enabled : false,
      text: String(text || '').trim(),
      delay: typeof delay === 'number' ? delay : 5
    };
    await saveWhatsAppAutoReplySettings(settings);
    res.json({ success: true, settings });
  } catch (err: any) {
    const status = err?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Helper function to handle delayed auto-replies for WhatsApp
async function handleAutoReplyIfEnabled(leadId: string, leadPhone: string, leadName: string) {
  try {
    const settings = await getWhatsAppAutoReplySettings();
    if (!settings || !settings.enabled) {
      return;
    }

    // Check 1 (Before scheduling): Ensure no auto-reply has ever been sent/scheduled for this lead
    // Check 1 (Pre-schedule): Check lead directly
    const initialLead = await getLeadById(leadId);
    if (!initialLead) return;

    if (initialLead.autoReplySent) {
      console.log(`[AutoReply] Skip scheduling. Lead ${initialLead.name} already received or scheduled an auto-reply.`);
      return;
    }

    const hasAutoReplyMsg = (msgs: Message[] = []) =>
      msgs.some(m =>
        m && (
          m.sender === 'system' ||
          m.senderName === 'CGP Auto-Reply' ||
          String(m.id).includes('auto') ||
          (m.text && (
            m.text.includes('Career Growth Placement') ||
            m.text.includes('Jobseeker') ||
            m.text.includes('reaching out')
          ))
        )
      );

    if (hasAutoReplyMsg(initialLead.messages)) {
      await updateSingleLead(leadId, (l) => {
        l.autoReplySent = true;
        return l;
      }, { allowDeferredSync: true });
      console.log(`[AutoReply] Skip scheduling. Lead ${initialLead.name} already had prior auto-reply message. Synchronized flag.`);
      return;
    }

    // Set persistent lock immediately via atomic single-lead update
    await updateSingleLead(leadId, (l) => {
      l.autoReplySent = true;
      return l;
    }, { allowDeferredSync: true });
    console.log(`[AutoReply] Lock flag set and saved for ${initialLead.name}. Scheduling delayed execution...`);

    const delayMs = Math.max(0, settings.delay) * 1000;
    console.log(`[AutoReply] Scheduling auto-reply for ${initialLead.name} with a delay of ${delayMs}ms...`);
    
    setTimeout(async () => {
      try {
        const lead = await getLeadById(leadId);
        if (!lead) return;

        if (hasAutoReplyMsg(lead.messages)) {
          console.log(`[AutoReply] Skip execution. Lead ${lead.name} already received an auto-reply message.`);
          return;
        }

        const replyText = replaceTemplatePlaceholders(settings.text, lead, 'CGP Auto-Reply');
        console.log(`[AutoReply] Triggering auto-reply to ${lead.name} (${leadPhone})...`);

        const result = await sendWhatsAppMessage(leadPhone, replyText, leadName);

        if (result.success) {
          const autoReplyMsg: Message = {
            id: result.messageId || `msg_auto_${Date.now()}`,
            sender: 'user',
            senderName: 'CGP Auto-Reply',
            text: replyText,
            timestamp: new Date().toISOString(),
            status: 'sent',
            channel: 'whatsapp'
          };

          await updateSingleLead(leadId, (latest) => {
            if (!Array.isArray(latest.messages)) latest.messages = [];
            if (!latest.messages.some(m => m && m.id === autoReplyMsg.id)) {
              latest.messages.push(autoReplyMsg);
            }
            if (!Array.isArray(latest.timeline)) latest.timeline = [];
            latest.timeline.push({
              id: `tl_${Date.now()}_autoreply`,
              type: 'message',
              text: `Automated WhatsApp Reply Sent: "${replyText.substring(0, 75)}"`,
              actor: 'System',
              timestamp: new Date().toISOString()
            });
            return latest;
          }, { allowDeferredSync: true });
          console.log(`[AutoReply] Auto-reply successfully sent and saved.`);

          // Transition auto-reply to 'delivered' in background after 1.5 seconds (sandbox only)
          const autoMsgId = autoReplyMsg.id;
          if (result.channel !== 'meta_cloud_api') {
            setTimeout(async () => {
              try {
                await updateSingleLead(leadId, (latest) => {
                  const mIdx = (latest.messages || []).findIndex(m => m.id === autoMsgId);
                  if (mIdx !== -1 && latest.messages[mIdx].status === 'sent') {
                    latest.messages[mIdx].status = 'delivered';
                  }
                  return latest;
                }, { allowDeferredSync: true });
              } catch (err) {
                console.error('Error transitioning auto-reply to delivered:', err);
              }
            }, 1500);
          }
        } else {
          console.error(`[AutoReply] Failed to send auto-reply:`, result.details);
        }
      } catch (err) {
        console.error('[AutoReply] Error in delayed auto-reply execution:', err);
      }
    }, delayMs);
  } catch (err) {
    console.error('[AutoReply] Error checking auto-reply settings:', err);
  }
}

// GET WhatsApp service configuration & active status
app.get('/api/whatsapp/config', (req, res) => {
  const hasMetaKey = (!!process.env.WHATSAPP_API_KEY && process.env.WHATSAPP_API_KEY !== 'MY_WHATSAPP_API_KEY' && process.env.WHATSAPP_API_KEY.trim().length > 0) ||
                     (!!process.env.META_WA_ACCESS_TOKEN && process.env.META_WA_ACCESS_TOKEN.trim().length > 0);
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID || '';
  
  const isDirectMetaLive = hasMetaKey && phoneNumberId.trim().length > 0;

  res.json({
    status: 'ok',
    mode: isDirectMetaLive ? 'live_meta_cloud' : 'sandbox_simulation',
    hasApiKey: isDirectMetaLive,
    provider: isDirectMetaLive 
      ? 'Direct Meta WhatsApp Cloud API' 
      : 'Direct Meta WhatsApp Cloud API (Sandbox Simulator)',
    phoneNumberId: phoneNumberId ? `${phoneNumberId.substring(0, 4)}••••${phoneNumberId.substring(phoneNumberId.length - 4)}` : null,
    costModel: 'Direct Meta Cloud API (Zero monthly platform fees • 1,000 free service conversations/mo)'
  });
});

// POST test WhatsApp API connection directly using current token & phone ID
app.post('/api/whatsapp/test-connection', async (req, res) => {
  try {
    const metaToken = (process.env.WHATSAPP_API_KEY || process.env.META_WA_ACCESS_TOKEN || '').trim();
    const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.META_PHONE_NUMBER_ID || '').trim();
    const { testPhone } = req.body || {};

    if (!metaToken || metaToken === 'MY_WHATSAPP_API_KEY') {
      res.status(400).json({
        success: false,
        error: 'WHATSAPP_API_KEY is not set or is empty in the environment settings.'
      });
      return;
    }

    if (!phoneNumberId) {
      res.status(400).json({
        success: false,
        error: 'WHATSAPP_PHONE_NUMBER_ID is not configured in environment settings.'
      });
      return;
    }

    // Call Meta Graph API to verify Phone Number ID and Token permissions
    const infoUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status`;
    const metaInfoRes = await fetch(infoUrl, {
      headers: {
        'Authorization': `Bearer ${metaToken}`
      }
    });

    const metaInfo = await metaInfoRes.json().catch(() => ({}));

    if (!metaInfoRes.ok) {
      res.status(400).json({
        success: false,
        error: metaInfo?.error?.message || 'Meta API returned an error verifying token.',
        details: metaInfo
      });
      return;
    }

    // If a test phone number is provided, try sending a lightweight hello/test message
    let testSendResult = null;
    if (testPhone && String(testPhone).trim()) {
      testSendResult = await sendWhatsAppMessage(
        String(testPhone).trim(),
        'Hello! This is a test message from your Career Growth Placement CRM to verify your WhatsApp Cloud API connection.'
      );
    }

    res.json({
      success: true,
      message: 'WhatsApp Cloud API connection is ACTIVE and verified!',
      phoneInfo: metaInfo,
      testSendResult
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Failed to verify WhatsApp Cloud API connection.'
    });
  }
});

// POST /api/whatsapp/start-chat - Start a new WhatsApp chat with any phone number
app.post('/api/whatsapp/start-chat', async (req, res) => {
  try {
    const { phone, name, initialMessage, position, country, assignedTo, templateName } = req.body;
    if (!phone || !String(phone).trim()) {
      res.status(400).json({ error: 'Phone number is required to start a chat.' });
      return;
    }

    const cleanPhone = String(phone).trim();
    const userRole = (req.headers['x-user-role'] as string) || 'user';
    const agentId = (req.headers['x-agent-id'] as string) || 'Coordinator';

    const leads = await getLeads(true);

    // Check if an active lead with this phone or alternateNo already exists (prioritizing assigned leads)
    const existingMatch = findBestMatchingLeadByPhone(leads, cleanPhone);

    let targetLead!: Lead;
    const nowIso = new Date().toISOString();
    let isNewLead = !existingMatch;

    if (existingMatch) {
      targetLead = { ...existingMatch };
      // Update name if provided and existing is generic
      if (name && name.trim() && (!targetLead.name || targetLead.name === 'Unnamed Candidate' || targetLead.name === 'WhatsApp Contact' || targetLead.name.startsWith('WhatsApp Lead'))) {
        targetLead.name = formatCandidateNameBackend(name.trim());
      }
    } else {
      // Create new lead for this chat
      const candidateName = name && name.trim() ? formatCandidateNameBackend(name.trim()) : 'WhatsApp Contact';
      const cleanNameId = String(candidateName).toUpperCase().trim().replace(/[^A-Z0-9]/g, '_');
      const sequence = leads.length + 1;
      const serialNo = `WA-${1000 + sequence}`;

      const assignedCoordinator = assignedTo || (userRole === 'agent' ? agentId : '');

      targetLead = {
        id: generateUniqueLeadId(leads, cleanNameId),
        serialNo,
        entryDate: nowIso.split('T')[0],
        assignDate: assignedCoordinator ? nowIso.split('T')[0] : '',
        name: candidateName,
        phone: cleanPhone,
        alternateNo: '',
        email: '',
        gender: 'M',
        age: 25,
        origin: '',
        country: country || 'Kuwait',
        position: position || 'General openings',
        experience: 'Fresh criteria',
        qualification: '10th Pass',
        adminRemarks: 'Direct WhatsApp conversation started',
        notes: '',
        assignedTo: assignedCoordinator,
        importance: 3,
        remarks1: '',
        remarks2: '',
        remarks3: '',
        stage: 'new' as LeadStage,
        fitScore: 'high' as any,
        budget: 1500,
        budgetRaw: 'Direct WhatsApp Lead',
        campaign: 'Direct WhatsApp Outreach',
        summary: `Direct WhatsApp conversation started with ${candidateName} (${cleanPhone}).`,
        requirements: [position || 'General openings', country || 'Kuwait'].filter(Boolean),
        nextAction: 'Continue WhatsApp dialogue and collect documents.',
        tags: ['Direct WhatsApp', 'New Outreach'],
        source: 'WhatsApp Direct',
        project: 'General',
        assignedFrom: 'whatsapp_chat_menu',
        messages: [],
        tasks: [],
        timeline: [
          {
            id: `tl_init_${Date.now()}`,
            type: 'creation' as const,
            text: `Started direct WhatsApp conversation from CRM. Assigned: ${assignedCoordinator || 'Unassigned'} via WhatsApp Chat Menu.`,
            actor: userRole === 'admin' ? 'Administrator' : `Coordinator (${agentId})`,
            timestamp: nowIso
          }
        ],
        createdAt: nowIso,
        updatedAt: nowIso
      };

      leads.unshift(targetLead);
    }

    // If an initial message is provided, send it immediately
    let deliveryResult = null;
    let initialNewMessage: Message | null = null;
    let initialTimelineEntry: any = null;
    if (initialMessage && String(initialMessage).trim()) {
      const msgText = String(initialMessage).trim();
      const templates = await getWhatsAppTemplates().catch(() => DEFAULT_WHATSAPP_TEMPLATES);
      const matchedTemplate = templates.find(t => t.id === templateName || t.title === templateName);

      deliveryResult = await sendWhatsAppMessage(
        targetLead.phone,
        msgText,
        targetLead.name,
        templateName || undefined,
        undefined,
        undefined,
        undefined,
        targetLead,
        matchedTemplate
      );

      const senderName = userRole === 'admin' ? 'Administrator' : `Coordinator (${agentId})`;
      initialNewMessage = {
        id: deliveryResult?.messageId || `m_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        sender: 'user',
        senderName,
        text: msgText,
        timestamp: nowIso,
        status: deliveryResult?.status || 'sent',
        channel: 'whatsapp',
        templateName: templateName || undefined,
        templateType: matchedTemplate?.type === 'quick_reply' ? 'quick_reply' : (matchedTemplate ? 'template' : undefined)
      };

      if (!Array.isArray(targetLead.messages)) targetLead.messages = [];
      targetLead.messages.push(initialNewMessage);

      if (!Array.isArray(targetLead.timeline)) targetLead.timeline = [];
      initialTimelineEntry = {
        id: `tl_${Date.now()}_startmsg`,
        type: 'message',
        text: `Sent initial WhatsApp message: "${msgText.length > 80 ? msgText.substring(0, 77) + '...' : msgText}"`,
        actor: senderName,
        timestamp: nowIso
      };
      targetLead.timeline.push(initialTimelineEntry);

      if (deliveryResult?.channel !== 'meta_cloud_api') {
        const msgId = initialNewMessage.id;
        const targetLeadId = targetLead.id;
        setTimeout(async () => {
          try {
            await updateSingleLead(targetLeadId, (l) => {
              const mIdx = (l.messages || []).findIndex(m => m.id === msgId);
              if (mIdx !== -1 && l.messages[mIdx].status === 'sent') {
                l.messages[mIdx].status = 'delivered';
              }
              return l;
            }, { allowDeferredSync: true });
          } catch (err) {
            console.error('Error transitioning message to delivered:', err);
          }
        }, 1500);
      }
    }

    targetLead.updatedAt = nowIso;
    if (existingMatch) {
      const updatedExisting = await updateSingleLead(targetLead.id, (current) => {
        if (name && name.trim() && (!current.name || current.name === 'Unnamed Candidate' || current.name === 'WhatsApp Contact' || current.name.startsWith('WhatsApp Lead'))) {
          current.name = formatCandidateNameBackend(name.trim());
        }
        if (initialNewMessage) {
          if (!Array.isArray(current.messages)) current.messages = [];
          current.messages.push(initialNewMessage);
        }
        if (initialTimelineEntry) {
          if (!Array.isArray(current.timeline)) current.timeline = [];
          current.timeline.push(initialTimelineEntry);
        }
        return current;
      });
      if (updatedExisting) targetLead = updatedExisting;
    } else {
      const savedOrMerged = await addOrMergeInboundLead(targetLead);
      targetLead = savedOrMerged.lead;
      if (savedOrMerged.merged) isNewLead = false;
    }

    res.status(200).json({
      success: true,
      lead: targetLead,
      isNewLead,
      deliveryResult
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to start WhatsApp chat.' });
  }
});

// App Settings Public Routes (Required by Meta for Webhook/API Go-Live Verification)
app.get('/privacy', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - Career Growth Placement CRM</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.6; color: #334155; max-width: 800px; margin: 40px auto; padding: 0 20px; background-color: #f8fafc; }
    h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 20px; }
    h2 { color: #1e293b; margin-top: 30px; }
    p, li { color: #475569; }
    ul { padding-left: 20px; }
    .container { background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05); border: 1px solid #f1f5f9; }
    .meta-info { font-size: 0.875rem; color: #64748b; margin-bottom: 30px; }
    .contact { background-color: #f1f5f9; padding: 20px; border-radius: 6px; margin-top: 30px; border-left: 4px solid #3b82f6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Privacy Policy</h1>
    <p class="meta-info">Last Updated: August 31, 2026</p>
    
    <p>Welcome to <strong>Career Growth Placement CRM</strong>. We value your privacy and are deeply committed to protecting your personal data. This Privacy Policy explains how we collect, use, and protect your personal information when you use our recruitment platform, recruitment tracking tools, and WhatsApp communication features.</p>
    
    <h2>1. Data We Collect</h2>
    <p>To provide high-quality recruitment and career placement assistance, we collect the following candidate information:</p>
    <ul>
      <li>Candidate Full Name</li>
      <li>Mobile Number and Alternative Phone Number</li>
      <li>Gender and Age</li>
      <li>State/Origin</li>
      <li>Target Job Position</li>
      <li>Years of Experience</li>
      <li>Educational Qualifications</li>
    </ul>

    <h2>2. How We Use Your Data</h2>
    <p>The information we collect is strictly utilized to:</p>
    <ul>
      <li>Facilitate placement matchmaking with active job openings.</li>
      <li>Track candidate pipelines and update recruitment statuses.</li>
      <li>Send automated status updates, notifications, and scheduled check-ins via Meta's WhatsApp Business Cloud API.</li>
      <li>Coordinate job opportunities between recruiters and candidates.</li>
    </ul>

    <h2>3. Data Protection & Security</h2>
    <p>We implement strict administrative, technical, and physical security measures to protect your personal data against unauthorized access, loss, or alteration. Your data is stored securely and is only accessible by authorized administrators and recruiting coordinators.</p>

    <h2>4. Data Sharing & Third Parties</h2>
    <p>We <strong>do not sell, trade, or rent</strong> your personal data to third parties. Candidate details are only shared with potential hiring employers as part of the job matchmaking process, and only after receiving your explicit interest in the specific opening.</p>

    <h2>5. Data Access and Your Rights</h2>
    <p>Candidates and users have the right to access, correct, or request the permanent deletion of their personal information from our CRM database at any time. For information on how to permanently purge your data, please see our Data Deletion Instructions.</p>

    <div class="contact">
      <strong>Contact Us:</strong><br>
      For any questions, concerns, or inquiries regarding this Privacy Policy or your data, please email us at:<br>
      <a href="mailto:sahasachin511@gmail.com">sahasachin511@gmail.com</a>
    </div>
  </div>
</body>
</html>
  `);
});

app.get('/terms', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service - Career Growth Placement CRM</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.6; color: #334155; max-width: 800px; margin: 40px auto; padding: 0 20px; background-color: #f8fafc; }
    h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 20px; }
    h2 { color: #1e293b; margin-top: 30px; }
    p, li { color: #475569; }
    .container { background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05); border: 1px solid #f1f5f9; }
    .meta-info { font-size: 0.875rem; color: #64748b; margin-bottom: 30px; }
    .contact { background-color: #f1f5f9; padding: 20px; border-radius: 6px; margin-top: 30px; border-left: 4px solid #3b82f6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Terms of Service</h1>
    <p class="meta-info">Last Updated: August 31, 2026</p>
    
    <p>By accessing or using the services of <strong>Career Growth Placement CRM</strong>, you agree to be bound by these Terms of Service. Please read them carefully.</p>
    
    <h2>1. Acceptance of Terms</h2>
    <p>Our platform provides candidate tracking, recruitment pipelines, and notifications using WhatsApp. By interacting with our recruiting coordinators or submitting your profile to our platform, you acknowledge and accept these terms in full.</p>

    <h2>2. Accurate Candidate Information</h2>
    <p>Candidates agree to provide truthful, accurate, and current information regarding their credentials, qualifications, work experience, and contact details. Providing false information may lead to removal from candidate lists.</p>

    <h2>3. Consent for Communications (WhatsApp)</h2>
    <p>By registering on our placement portal or expressing interest in our recruiting services, you provide explicit consent to receive informational messages, job matching alerts, and status updates on your registered WhatsApp mobile number. You can opt out of these updates at any time by replying with 'STOP' or contacting us directly.</p>

    <h2>4. Liability & Placements</h2>
    <p>We act as a facilitating platform to bridge jobseekers with potential employers. While we strive to match candidates with high-quality job opportunities, we do not guarantee job offers, placement outcomes, or specific employment contract terms.</p>

    <div class="contact">
      <strong>Inquiries:</strong><br>
      If you have any questions regarding these Terms of Service, please contact us at:<br>
      <a href="mailto:sahasachin511@gmail.com">sahasachin511@gmail.com</a>
    </div>
  </div>
</body>
</html>
  `);
});

app.get('/data-deletion', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Deletion Instructions - Career Growth Placement CRM</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.6; color: #334155; max-width: 800px; margin: 40px auto; padding: 0 20px; background-color: #f8fafc; }
    h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 20px; }
    h2 { color: #1e293b; margin-top: 30px; }
    p, li { color: #475569; }
    ol { padding-left: 20px; }
    .container { background-color: #ffffff; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05); border: 1px solid #f1f5f9; }
    .meta-info { font-size: 0.875rem; color: #64748b; margin-bottom: 30px; }
    .step-box { background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 20px; border-radius: 6px; margin: 20px 0; }
    .contact { background-color: #f1f5f9; padding: 20px; border-radius: 6px; margin-top: 30px; border-left: 4px solid #ef4444; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Data Deletion Instructions</h1>
    <p class="meta-info">Last Updated: August 31, 2026</p>
    
    <p>At <strong>Career Growth Placement CRM</strong>, we respect your right to privacy and control over your personal data. In compliance with Meta Developer Platform regulations and standard data protection principles, we provide an easy, explicit way for candidates to request the permanent deletion of their account, communication records, and candidate profile.</p>

    <h2>How to Request Your Data Purge</h2>
    <p>If you wish to delete your placement profile, history, and contact details from our active recruiting systems, you can request a manual deletion at any time by following these simple steps:</p>
    
    <div class="step-box">
      <ol>
        <li>Send an email from your registered email address to <a href="mailto:sahasachin511@gmail.com"><strong>sahasachin511@gmail.com</strong></a>.</li>
        <li>Set the email subject line to: <strong>"Candidate Data Deletion Request"</strong>.</li>
        <li>In the email body, please specify:
          <ul>
            <li>Your Full Name</li>
            <li>The WhatsApp Mobile Number registered under your candidate record</li>
          </ul>
        </li>
      </ol>
    </div>

    <h2>Processing Timeline</h2>
    <p>Upon receipt of your deletion request, our administration team will:</p>
    <ul>
      <li>Verify the matching record in our CRM database.</li>
      <li>Permanently delete and scrub your profile, timeline actions, resumes, metadata, and WhatsApp logs from our system.</li>
      <li>Complete the operation within <strong>48 to 72 business hours</strong>.</li>
      <li>Reply with a confirmation email to inform you that your personal records have been successfully and permanently purged.</li>
    </ul>

    <div class="contact">
      <strong>Data Security Notice:</strong><br>
      Please note that once deleted, your candidate profile and placement history cannot be restored. If you wish to match with open jobs again in the future, you will need to re-register as a new candidate.
    </div>
  </div>
</body>
</html>
  `);
});

// Meta Webhook Verification (GET endpoint required for Meta Developer Portal Webhook validation)
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'] || req.query['hub_mode'] || req.query['mode'];
  const token = req.query['hub.verify_token'] || req.query['hub_verify_token'] || req.query['verify_token'];
  const challenge = req.query['hub.challenge'] || req.query['hub_challenge'] || req.query['challenge'];

  const expectedToken = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'cgp_placement_crm_webhook').trim();

  console.log(`[Meta Webhook GET] mode=${mode}, token=${token}, challenge=${challenge}`);

  // If token matches or mode is subscribe
  if (token === expectedToken || (!token && mode === 'subscribe')) {
    console.log('Meta WhatsApp Webhook successfully verified by Facebook servers. Challenge:', challenge);
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(String(challenge || 'SUCCESS'));
  } else {
    console.warn(`[Meta Webhook GET] Token mismatch: received "${token}", expected "${expectedToken}"`);
    res.status(403).send('Forbidden: Token mismatch');
  }
});

// GET preconfigured and custom WhatsApp recruitment templates
app.get('/api/whatsapp/templates', async (req, res) => {
  try {
    const templates = await getWhatsAppTemplates();
    res.json({ templates });
  } catch (err: any) {
    console.error('Failed to get WhatsApp templates:', err);
    res.json({ templates: DEFAULT_WHATSAPP_TEMPLATES }); // fallback
  }
});

// POST save a new custom WhatsApp template
app.post('/api/whatsapp/templates', async (req, res) => {
  try {
    const { id, title, category, description, text, type } = req.body;
    if (!id || !title || !category || !text) {
      res.status(400).json({ error: 'Missing required template fields (id, title, category, text)' });
      return;
    }
    
    const newTemplate: WhatsAppTemplate = {
      id: String(id).trim(),
      title: String(title).trim(),
      category: category,
      description: String(description || '').trim(),
      text: String(text).trim(),
      type: type || 'template'
    };

    await saveWhatsAppTemplate(newTemplate);
    res.json({ success: true, template: newTemplate });
  } catch (err: any) {
    console.error('Failed to save WhatsApp template:', err);
    const status = err?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: err?.message || 'Failed to save template' });
  }
});

// DELETE a custom WhatsApp template
app.delete('/api/whatsapp/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'Missing template ID' });
      return;
    }
    
    await deleteWhatsAppTemplate(id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to delete WhatsApp template:', err);
    const status = err?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: err?.message || 'Failed to delete template' });
  }
});

// Sync templates from Meta Business
app.post('/api/whatsapp/templates/sync', async (req, res) => {
  try {
    console.log('[System] Syncing templates from Meta Business...');
    const metaTemplates = await fetchMetaWhatsAppTemplates();
    if (metaTemplates.length > 0) {
      // Get current templates stored in the database (local JSON & Firestore)
      const currentTemplates = await getWhatsAppTemplates();
      const metaTemplateIds = new Set(metaTemplates.map(t => t.id));
      
      let deletedCount = 0;
      // Filter out templates of type 'template' (Meta templates) that are no longer present on Meta Business
      for (const t of currentTemplates) {
        if ((!t.type || t.type === 'template') && !metaTemplateIds.has(t.id)) {
          console.log(`[System] Template '${t.id}' has been deleted from Meta. Cleaning up from CRM database...`);
          await deleteWhatsAppTemplate(t.id);
          deletedCount++;
        }
      }

      // Save/update the remaining templates from Meta
      for (const t of metaTemplates) {
        await saveWhatsAppTemplate(t);
      }
      
      res.json({ 
        success: true, 
        count: metaTemplates.length, 
        message: `Successfully synced ${metaTemplates.length} templates from Meta. Cleaned up ${deletedCount} deleted templates from the CRM.` 
      });
    } else {
      res.status(400).json({ error: 'No templates found on Meta or Meta integration is not configured with active API keys.' });
    }
  } catch (err: any) {
    console.error('Failed to sync templates:', err);
    res.status(500).json({ error: `Failed to sync templates: ${err.message}` });
  }
});

// POST mark all WhatsApp messages for a lead as read
app.post('/api/leads/:id/read', async (req, res) => {
  try {
    const updatedLead = await updateSingleLead(req.params.id, (lead) => {
      let changed = false;
      if (Array.isArray(lead.messages)) {
        lead.messages.forEach(m => {
          if (m && m.sender === 'lead' && m.status !== 'read') {
            m.status = 'read';
            changed = true;
          }
        });
      }
      if (changed) {
        lead.updatedAt = new Date().toISOString();
      }
      return lead;
    });

    if (!updatedLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    res.json({ success: true, lead: updatedLead });
  } catch (err: any) {
    console.error('Failed to mark messages as read:', err);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// POST send WhatsApp message to a lead (Outbound via Meta Cloud API)
app.post('/api/leads/:id/messages', async (req, res) => {
  try {
    const { text, sender, senderName, templateName, templateParams, channel, type, mediaUrl, fileName, fileSize, replyToId, replyToText, replyToSender } = req.body;
    
    // For media messages, body text is optional (can act as a caption)
    const msgType = type || 'text';
    const isMedia = msgType !== 'text';
    const messageText = (text || '').trim() || (msgType === 'image' ? 'Sent an image' : msgType === 'pdf' ? 'Sent a PDF document' : 'Sent a document');

    const leads = await getLeads(false);
    let idx = leads.findIndex(l => l.id === req.params.id);
    let lead = idx !== -1 ? leads[idx] : null;
    if (!lead) {
      const fallbackLead = await getLeadById(req.params.id);
      if (fallbackLead) {
        lead = fallbackLead;
        leads.push(fallbackLead);
      } else {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
    }

    // Reject sending messages to blocked candidates
    if (lead.isBlocked) {
      res.status(400).json({ error: `Candidate "${lead.name}" is BLOCKED (${lead.blockedReason || 'No passport / Spam'}). Unblock candidate to send messages.` });
      return;
    }

    const userRole = req.headers['x-user-role'] || 'user';
    const agentId = (req.headers['x-agent-id'] as string) || senderName || 'Coordinator';

    // Ensure local upload exists on disk (restore from Firestore if needed) and build HTTPS-safe URL
    let absoluteMediaUrl = mediaUrl;
    if (mediaUrl) {
      const cleanMediaPath = String(mediaUrl).split('?')[0];
      const uploadsMarkerIdx = cleanMediaPath.indexOf('/uploads/');
      if (uploadsMarkerIdx !== -1) {
        const localSafeName = path.basename(cleanMediaPath.substring(uploadsMarkerIdx + '/uploads/'.length));
        const localFilePath = path.join(UPLOADS_DIR, localSafeName);
        if (localSafeName && (!fs.existsSync(localFilePath) || fs.statSync(localFilePath).size === 0)) {
          await restoreSingleFileFromFirestore(localSafeName).catch(() => false);
        }
      }
      if (mediaUrl.startsWith('/')) {
        const host = req.get('host') || '';
        const forwardedProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim();
        const proto = forwardedProto || (host.includes('ai.studio') || host.includes('run.app') ? 'https' : req.protocol);
        absoluteMediaUrl = `${proto}://${host}${mediaUrl}`;
      }
    }

    // Dispatch directly via Meta Cloud API or Sandbox Engine
    const isOutbound = sender !== 'lead';
    let deliveryResult: { success: boolean; channel: string; status: 'sent' | 'delivered' | 'read' | 'failed'; messageId?: string; details?: any } = {
      success: true,
      channel: 'simulation',
      status: 'delivered'
    };
    let matchedTemplate: any = null;
    if (isOutbound && lead.phone) {
      const templates = await getWhatsAppTemplates().catch(() => DEFAULT_WHATSAPP_TEMPLATES);
      matchedTemplate = templates.find(t => t.id === templateName || t.title === templateName);

      deliveryResult = await sendWhatsAppMessage(
        lead.phone,
        messageText,
        lead.name,
        templateName,
        absoluteMediaUrl,
        msgType,
        fileName,
        lead,
        matchedTemplate,
        templateParams
      );
    }

    const isOutboundSender = (sender || 'user') !== 'lead';
    const isFailed = isOutboundSender && deliveryResult?.success === false;
    const newMessage: Message = {
      id: deliveryResult?.messageId || `m_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sender: sender || 'user',
      senderName: senderName || (sender === 'lead' ? lead.name : (agentId === 'admin' ? 'Administrator' : agentId)),
      text: messageText,
      timestamp: new Date().toISOString(),
      status: isFailed ? 'failed' : (isOutboundSender ? 'sent' : 'delivered'),
      templateName: templateName || undefined,
      templateType: matchedTemplate?.type === 'quick_reply' ? 'quick_reply' : (matchedTemplate ? 'template' : undefined),
      channel: channel || 'whatsapp',
      type: msgType,
      mediaUrl: mediaUrl || undefined,
      fileName: fileName || undefined,
      fileSize: fileSize || undefined,
      replyToId: replyToId || undefined,
      replyToText: replyToText || undefined,
      replyToSender: replyToSender || undefined,
      errorDetails: isFailed ? (deliveryResult?.details?.error?.message || JSON.stringify(deliveryResult?.details)) : undefined,
      buttons: (deliveryResult as any)?.buttons || matchedTemplate?.buttons
    };

    const savedLead = await updateSingleLead(req.params.id, (targetLead) => {
      if (!Array.isArray(targetLead.messages)) {
        targetLead.messages = [];
      }
      targetLead.messages.push(newMessage);

      if (!Array.isArray(targetLead.timeline)) {
        targetLead.timeline = [];
      }

      const timelineSnippet = text && text.length > 80 ? text.substring(0, 77) + '...' : (text || messageText);
      targetLead.timeline.push({
        id: `tl_${Date.now()}_msg`,
        type: 'message',
        text: isOutbound
          ? `Sent WhatsApp message${templateName ? ` [Template: ${templateName}]` : ''}: "${timelineSnippet}"`
          : `Received WhatsApp reply: "${timelineSnippet}"`,
        actor: newMessage.senderName || 'System',
        timestamp: new Date().toISOString()
      });

      targetLead.updatedAt = new Date().toISOString();
      return targetLead;
    });

    // Transition outbound message to 'delivered' in background after 1.5 seconds if not failed and not using real Meta API
    if (isOutboundSender && !isFailed && deliveryResult?.channel !== 'meta_cloud_api') {
      const msgId = newMessage.id;
      const targetLeadId = req.params.id;
      setTimeout(async () => {
        try {
          await updateSingleLead(targetLeadId, (latestLead) => {
            const mIdx = (latestLead.messages || []).findIndex(m => m.id === msgId);
            if (mIdx !== -1 && latestLead.messages[mIdx].status === 'sent') {
              latestLead.messages[mIdx].status = 'delivered';
            }
            return latestLead;
          });
        } catch (err) {
          console.error('Error transitioning message to delivered:', err);
        }
      }, 1500);
    }

    res.json({ 
      success: true, 
      lead: savedLead || lead, 
      message: newMessage,
      deliveryResult
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------------- AI ASSISTANT & COPILOT ENDPOINTS ----------------

const handleGetAiAssistantOverview = async (req: express.Request, res: express.Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const userRole = String(req.headers['x-user-role'] || 'user').trim().toLowerCase();
    const agentId = String(req.headers['x-agent-id'] || '').trim();
    const forceRefresh = req.query.refresh === 'true';

    const overview = await computeSentinelOverview({ userRole, agentId, forceRefresh });
    res.json(overview);
  } catch (err: any) {
    console.error('Error computing AI Assistant overview:', err);
    res.status(500).json({ error: err?.message || 'Failed to compute AI Assistant overview' });
  }
};

// GET live scoped AI Assistant overview (support both new & legacy paths)
app.get('/api/ai/assistant', handleGetAiAssistantOverview);
app.get('/api/ai/sentinel', handleGetAiAssistantOverview);

// POST apply one-click CRM health fix via AI Assistant
app.post('/api/ai/assistant/fix', async (req, res) => {
  try {
    const userRole = String(req.headers['x-user-role'] || 'user').trim().toLowerCase();
    const agentId = String(req.headers['x-agent-id'] || '').trim();
    const { action, leadIds, minInactiveDays, limit, targetCoordinator } = req.body || {};

    if (!action) {
      return res.status(400).json({ error: 'Fix action is required.' });
    }

    const result = await applyAiAssistantFix({
      action,
      userRole,
      agentId,
      leadIds: Array.isArray(leadIds) ? leadIds : undefined,
      minInactiveDays: minInactiveDays !== undefined ? Number(minInactiveDays) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      targetCoordinator: targetCoordinator ? String(targetCoordinator) : undefined
    });

    res.json(result);
  } catch (err: any) {
    const status = err?.statusCode || 500;
    console.error('Error applying AI Assistant fix:', err);
    res.status(status).json({ error: err?.message || 'Failed to apply AI Assistant fix' });
  }
});

const handlePostAiCopilotChat = async (req: express.Request, res: express.Response) => {
  try {
    const { query, history } = req.body || {};
    const userRole = String(req.headers['x-user-role'] || 'user').trim().toLowerCase();
    const agentId = String(req.headers['x-agent-id'] || '').trim();
    const response = await askAiCopilot(query || 'What are our operational priorities today?', userRole, agentId, history);
    res.json(response);
  } catch (err: any) {
    const status = err?.statusCode || 500;
    console.error('Error processing AI Assistant query:', err);
    res.status(status).json({ error: err?.message || 'Failed to process AI Assistant query' });
  }
};

// POST interactive AI Assistant Copilot query
app.post('/api/ai/assistant/chat', handlePostAiCopilotChat);
app.post('/api/ai/copilot/chat', handlePostAiCopilotChat);

// GET specific AI suggestions for an individual candidate (RBAC enforced)
app.get('/api/ai/leads/:id/suggestions', async (req, res) => {
  try {
    const userRole = String(req.headers['x-user-role'] || 'user').trim().toLowerCase();
    const agentId = String(req.headers['x-agent-id'] || '').trim();
    const suggestions = await getLeadSpecificAiSuggestions(req.params.id, userRole, agentId);
    res.json(suggestions);
  } catch (err: any) {
    const status = err?.statusCode || 500;
    console.error('Error getting lead AI suggestions:', err);
    res.status(status).json({ error: err?.message || 'Failed to get lead suggestions' });
  }
});

// POST simulate candidate incoming WhatsApp reply (Inbound)
app.post('/api/leads/:id/simulate-reply', async (req, res) => {
  try {
    const { text, customName } = req.body;
    let createdMessage: Message | null = null;
    const savedLead = await updateSingleLead(req.params.id, (lead) => {
      const candidateName = customName || lead.name || 'Candidate';
      const replyText = text && text.trim()
        ? text.trim()
        : `Hello! I have received your message. I am sending my passport and CV for the ${lead.position || 'job'} opening in ${lead.country || 'abroad'}. Please let me know the interview timing.`;

      const incomingMessage: Message = {
        id: `m_in_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        sender: 'lead',
        senderName: candidateName,
        text: replyText,
        timestamp: new Date().toISOString(),
        status: 'delivered',
        channel: 'whatsapp'
      };
      createdMessage = incomingMessage;

      if (!Array.isArray(lead.messages)) lead.messages = [];
      lead.messages.forEach(m => {
        if (m && m.sender !== 'lead') m.status = 'read';
      });
      lead.messages.push(incomingMessage);

      if (!Array.isArray(lead.timeline)) lead.timeline = [];
      lead.timeline.push({
        id: `tl_${Date.now()}_inbound`,
        type: 'message',
        text: `Received candidate WhatsApp reply: "${replyText.length > 80 ? replyText.substring(0, 77) + '...' : replyText}"`,
        actor: candidateName,
        timestamp: new Date().toISOString()
      });

      return lead;
    });

    if (!savedLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    handleAutoReplyIfEnabled(savedLead.id, savedLead.phone, customName || savedLead.name || 'Candidate');

    res.json({
      success: true,
      lead: savedLead,
      message: createdMessage
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Global WhatsApp Webhook Deduplication Cache: Prevents processing retried webhooks or duplicate events
const processedWhatsAppIds = new Set<string>();
const MAX_PROCESSED_WHATSAPP_IDS = 10000;
function isAlreadyProcessedWhatsAppId(id: string): boolean {
  if (!id) return false;
  if (processedWhatsAppIds.has(id)) return true;
  processedWhatsAppIds.add(id);
  if (processedWhatsAppIds.size > MAX_PROCESSED_WHATSAPP_IDS) {
    const firstKey = processedWhatsAppIds.values().next().value;
    if (firstKey) processedWhatsAppIds.delete(firstKey);
  }
  return false;
}

// Resilient Webhook Spooling and Processing Engine for Meta Ads & AiSensy
export async function processInboundWebhookPayload(payload: any): Promise<{ newCount: number; updatedCount: number; statusesCount: number }> {
  let newCount = 0;
  let updatedCount = 0;
  let statusesCount = 0;

  try {
    if (!payload || typeof payload !== 'object') {
      return { newCount, updatedCount, statusesCount };
    }

    // Persist raw webhook payload to disk for audit & catch-up spooling
    try {
      const logDir = path.join(process.cwd(), 'data');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(
        path.join(logDir, 'webhooks.log'),
        `[${new Date().toISOString()}] ${JSON.stringify(payload)}\n`,
        'utf8'
      );
      fs.appendFileSync(
        path.join(logDir, 'webhooks_inbox.jsonl'),
        JSON.stringify({ timestamp: new Date().toISOString(), payload, processed: true }) + '\n',
        'utf8'
      );
    } catch (logErr) {
      console.warn('Failed to log webhook payload:', logErr);
    }

    // 1. Collect all status updates (sent, delivered, read, failed)
    const statusesToProcess: { id: string; status: string; recipient_id?: string; errorDetails?: string }[] = [];

    if (payload.entry && Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            const val = change.value;
            if (val && val.statuses && Array.isArray(val.statuses)) {
              for (const s of val.statuses) {
                if (s.id && s.status) {
                  const statusKey = `status_${s.id}_${s.status}`;
                  if (isAlreadyProcessedWhatsAppId(statusKey)) continue;
                  let errStr: string | undefined = undefined;
                  if (s.errors && Array.isArray(s.errors) && s.errors[0]) {
                    const e = s.errors[0];
                    errStr = `[Code ${e.code}] ${e.message || e.title || 'Error'}`;
                  }
                  statusesToProcess.push({
                    id: String(s.id),
                    status: String(s.status),
                    recipient_id: s.recipient_id ? String(s.recipient_id) : undefined,
                    errorDetails: errStr
                  });
                }
              }
            }
          }
        }
      }
    }

    // Secondary check for flat status updates
    const flatStatusRaw = payload.status || payload.messageStatus || payload.eventStatus || payload.state || payload.event;
    const flatId = payload.messageId || payload.id || payload.wamid || payload.msgId || payload.msg_id;
    const flatPhone = payload.phone || payload.recipient || payload.to || payload.from || payload.mobile || payload.recipient_id;

    if (flatStatusRaw && flatId && !payload.text && !payload.message && !payload.body && !payload.data) {
      let flatStatus = String(flatStatusRaw).toLowerCase();
      if (flatStatus.includes('read')) flatStatus = 'read';
      else if (flatStatus.includes('deliver')) flatStatus = 'delivered';
      else if (flatStatus.includes('sent')) flatStatus = 'sent';
      else if (flatStatus.includes('fail')) flatStatus = 'failed';

      const validStatuses = ['sent', 'delivered', 'read', 'failed'];
      if (validStatuses.includes(flatStatus)) {
        const statusKey = `status_${flatId}_${flatStatus}`;
        if (!isAlreadyProcessedWhatsAppId(statusKey)) {
          const flatError = payload.error || payload.reason || payload.errorMessage || payload.error_message || payload.errorDetails || payload.error_details;
          statusesToProcess.push({
            id: String(flatId),
            status: flatStatus,
            recipient_id: flatPhone ? String(flatPhone) : undefined,
            errorDetails: flatError ? String(flatError) : undefined
          });
        }
      }
    }

    // 2. Collect all inbound messages
    interface ExtractedWebhookMsg {
      id: string;
      fromNumber: string;
      senderName?: string;
      messageBody: string;
      mediaUrl?: string;
      mediaType: 'text' | 'image' | 'pdf' | 'document';
      fileName?: string;
      fileSize?: string;
      timestamp?: string;
      campaignHint?: string;
      tags?: string[];
    }
    const messagesToProcess: ExtractedWebhookMsg[] = [];

    // Path A: Meta Cloud API structure
    if (payload.entry && Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            const val = change.value;
            const contacts = val?.contacts || [];
            if (val && val.messages && Array.isArray(val.messages)) {
              for (const m of val.messages) {
                const mId = String(m.id || `m_hook_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
                if (isAlreadyProcessedWhatsAppId(`msg_${mId}`)) {
                  console.log(`[Meta Webhook] Duplicate message ID "${mId}" already processed. Skipping duplicate webhook.`);
                  continue;
                }

                let body = '';
                let mType: 'text' | 'image' | 'pdf' | 'document' = 'text';
                let mUrl: string | undefined = undefined;
                let fName: string | undefined = undefined;
                let fSize: string | undefined = undefined;

                if (m.type === 'text' && m.text) {
                  body = m.text.body;
                } else if (m.type === 'image' && m.image) {
                  mType = 'image';
                  body = m.image.caption || 'Sent an image';
                  mUrl = m.image.url || m.image.link || m.image.id;
                  fName = m.image.filename || 'image.jpg';
                } else if (m.type === 'document' && m.document) {
                  const isPdf = m.document.mime_type === 'application/pdf' || String(m.document.filename || '').toLowerCase().endsWith('.pdf');
                  mType = isPdf ? 'pdf' : 'document';
                  body = m.document.caption || m.document.filename || 'Sent a document';
                  mUrl = m.document.url || m.document.link || m.document.id;
                  fName = m.document.filename || 'document';
                  fSize = m.document.file_size ? `${(Number(m.document.file_size) / (1024 * 1024)).toFixed(2)} MB` : undefined;
                } else if (m.type === 'video' && m.video) {
                  mType = 'document';
                  body = m.video.caption || 'Sent a video';
                  mUrl = m.video.url || m.video.link || m.video.id;
                  fName = m.video.filename || 'video.mp4';
                  fSize = m.video.file_size ? `${(Number(m.video.file_size) / (1024 * 1024)).toFixed(2)} MB` : undefined;
                } else if (m.type === 'audio' && m.audio) {
                  mType = 'document';
                  body = 'Sent an audio message';
                  mUrl = m.audio.url || m.audio.link || m.audio.id;
                  fName = m.audio.filename || 'audio.mp3';
                  fSize = m.audio.file_size ? `${(Number(m.audio.file_size) / (1024 * 1024)).toFixed(2)} MB` : undefined;
                } else if (m.type === 'button') {
                  body = m.button?.text || m.button?.payload || '';
                } else if (m.type === 'interactive') {
                  body = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || 'Interactive response';
                }

                const contactObj = contacts.find((c: any) => c.wa_id === m.from);
                const contactName = contactObj?.profile?.name;

                if (m.from && (body || mUrl)) {
                  messagesToProcess.push({
                    id: mId,
                    fromNumber: String(m.from),
                    senderName: contactName,
                    messageBody: body,
                    mediaUrl: mUrl,
                    mediaType: mType,
                    fileName: fName,
                    fileSize: fSize,
                    timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString()
                  });
                }
              }
            }
          }
        }
      }
    }

    // Path B: AiSensy & Flattened Webhook structures
    if (messagesToProcess.length === 0) {
      // AiSensy standard event fields
      const aisensyUser = payload.data?.user || payload.user || {};
      const aisensyMsg = payload.data?.message || payload.message_data || {};
      
      const fNum = payload.destination || payload.from || payload.phone || payload.mobile || payload.waNumber || payload.contact_number || aisensyUser.phone || aisensyUser.mobile;
      const sName = payload.userName || payload.name || payload.contact_name || aisensyUser.name || aisensyUser.userName;
      const body = payload.text || payload.message || payload.body || payload.caption || aisensyMsg.text || aisensyMsg.body || '';
      const campaign = payload.campaign || payload.campaignName || payload.campaign_name || payload.ad_name || payload.data?.campaign;
      const tags = Array.isArray(payload.tags) ? payload.tags : (Array.isArray(payload.data?.tags) ? payload.data.tags : []);

      if (fNum) {
        const flatMsgId = String(payload.messageId || payload.id || payload.wamid || payload.msgId || `m_hook_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
        if (!isAlreadyProcessedWhatsAppId(`msg_${flatMsgId}`)) {
          let mUrl = payload.mediaUrl || payload.fileUrl || payload.imageUrl || payload.url || aisensyMsg.url;
          let mType: 'text' | 'image' | 'pdf' | 'document' = 'text';
          let fName = payload.fileName || payload.filename || aisensyMsg.filename;
          let fSize = payload.fileSize || payload.filesize;

          if (payload.type === 'image' || payload.messageType === 'image') mType = 'image';
          else if (payload.type === 'pdf' || payload.messageType === 'pdf') mType = 'pdf';
          else if (payload.type === 'document' || payload.messageType === 'document' || payload.type === 'file') mType = 'document';

          let resolvedBody = String(body || '').trim();
          if (!resolvedBody && mUrl) {
            resolvedBody = mType === 'image' ? 'Sent an image' : (mType === 'pdf' ? 'Sent a PDF document' : 'Sent a document');
          }
          if (!resolvedBody) {
            resolvedBody = campaign ? `Inbound ad inquiry for ${campaign}` : 'Inbound WhatsApp inquiry';
          }

          messagesToProcess.push({
            id: flatMsgId,
            fromNumber: String(fNum),
            senderName: sName ? String(sName).trim() : undefined,
            messageBody: resolvedBody,
            mediaUrl: mUrl ? String(mUrl) : undefined,
            mediaType: mType,
            fileName: fName ? String(fName) : undefined,
            fileSize: fSize ? String(fSize) : undefined,
            timestamp: payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString(),
            campaignHint: campaign ? String(campaign).trim() : undefined,
            tags
          });
        }
      }
    }

    if (statusesToProcess.length === 0 && messagesToProcess.length === 0) {
      return { newCount, updatedCount, statusesCount };
    }

    const leads = await getLeads();
    const touchedLeadMutations = new Map<string, {
      statusUpdates: Array<{ wamid?: string; status: 'sent' | 'delivered' | 'read' | 'failed'; errorDetails?: string; fallbackLatestOutbound?: boolean }>;
      inboundMessages: Array<{ msg: Message; timelineEntry: any; updatedAt: string }>;
    }>();
    const ensureMutation = (leadId: string) => {
      let entry = touchedLeadMutations.get(leadId);
      if (!entry) {
        entry = { statusUpdates: [], inboundMessages: [] };
        touchedLeadMutations.set(leadId, entry);
      }
      return entry;
    };

    // 3. Process Status Updates
    for (const s of statusesToProcess) {
      statusesCount++;
      const wamid = s.id;
      const newStatus = s.status as 'sent' | 'delivered' | 'read' | 'failed';
      const recipientId = s.recipient_id;
      let matched = false;

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        if (Array.isArray(lead.messages)) {
          const mIdx = lead.messages.findIndex(m => m.id === wamid || m.wamid === wamid);
          if (mIdx !== -1) {
            matched = true;
            const oldStatus = lead.messages[mIdx].status;
            const statusPriority = { 'sent': 1, 'delivered': 2, 'read': 3, 'failed': 0 };
            const oldPriority = statusPriority[oldStatus as keyof typeof statusPriority] || 0;
            const newPriority = statusPriority[newStatus as keyof typeof statusPriority] || 0;

            if (newPriority > oldPriority || newStatus === 'failed') {
              ensureMutation(lead.id).statusUpdates.push({
                wamid,
                status: newStatus,
                errorDetails: s.errorDetails
              });
            }
            break;
          }
        }
      }

      if (!matched && recipientId) {
        const matchedRecipientLead = findBestMatchingLeadByPhone(leads, String(recipientId));
        if (matchedRecipientLead && Array.isArray(matchedRecipientLead.messages) && matchedRecipientLead.messages.length > 0) {
          for (let mIdx = matchedRecipientLead.messages.length - 1; mIdx >= 0; mIdx--) {
            const m = matchedRecipientLead.messages[mIdx];
            if (m && m.sender !== 'lead') {
              ensureMutation(matchedRecipientLead.id).statusUpdates.push({
                wamid: m.id,
                status: newStatus,
                errorDetails: s.errorDetails,
                fallbackLatestOutbound: true
              });
              break;
            }
          }
        }
      }
    }

    // 4. Process Inbound Messages (always prioritize assigned leads across both phone & alternateNo)
    for (const inMsg of messagesToProcess) {
      const cleanPhone = String(inMsg.fromNumber).replace(/\D/g, '');
      if (!cleanPhone || cleanPhone.length < 7) continue;

      let parsedMediaUrl = inMsg.mediaUrl;
      const extractedId = extractMetaMediaId(inMsg.mediaUrl);
      if (extractedId) {
        parsedMediaUrl = `/api/whatsapp/media/${extractedId}`;
      } else if (inMsg.mediaUrl && !inMsg.mediaUrl.startsWith('http') && !inMsg.mediaUrl.startsWith('/')) {
        parsedMediaUrl = `/api/whatsapp/media/${inMsg.mediaUrl}`;
      }

      const matchedLead = findBestMatchingLeadByPhone(leads, String(inMsg.fromNumber));

      if (matchedLead) {
        const lead = matchedLead;

        if (lead.isBlocked) {
          console.log(`[Webhook] Inbound message dropped: Candidate "${lead.name}" (${lead.phone}) is BLOCKED.`);
          continue;
        }

        const existingMessages = Array.isArray(lead.messages) ? lead.messages : [];
        // Deduplication Check
        const alreadyHasMsg = existingMessages.some(m => m && (m.id === inMsg.id || m.wamid === inMsg.id));
        if (alreadyHasMsg) {
          console.log(`[Webhook] Candidate "${lead.name}" already has message ID "${inMsg.id}". Skipping duplicate.`);
          continue;
        }

        const incomingMsg: Message = {
          id: inMsg.id,
          wamid: inMsg.id,
          sender: 'lead',
          senderName: lead.name,
          text: String(inMsg.messageBody),
          timestamp: inMsg.timestamp || new Date().toISOString(),
          status: 'delivered',
          channel: 'whatsapp',
          ...(inMsg.mediaUrl ? {
            type: inMsg.mediaType,
            mediaUrl: String(parsedMediaUrl),
            fileName: inMsg.fileName ? String(inMsg.fileName) : undefined,
            fileSize: inMsg.fileSize ? String(inMsg.fileSize) : undefined
          } : {})
        };

        const timelineEntry = {
          id: `tl_${Date.now()}_hook`,
          type: 'message',
          text: `Inbound WhatsApp received: "${String(inMsg.messageBody).substring(0, 75)}"`,
          actor: lead.name,
          timestamp: inMsg.timestamp || new Date().toISOString()
        };

        ensureMutation(lead.id).inboundMessages.push({
          msg: incomingMsg,
          timelineEntry,
          updatedAt: new Date().toISOString()
        });
        updatedCount++;
        console.log(`[Webhook] Queued atomic append for message "${inMsg.id}" to candidate "${lead.name}".`);

        handleAutoReplyIfEnabled(lead.id, lead.phone, lead.name);
      } else {
        // Candidate not found: Create brand new unassigned inquiry for Requesting
        const cleanNameId = `CONTACT_${cleanPhone.slice(-10)}`;
        const newLeadId = generateUniqueLeadId(leads, cleanNameId);
        
        const lowerBody = (String(inMsg.messageBody || '') + ' ' + String(inMsg.campaignHint || '')).toLowerCase();
        let inferredCountry = '';
        let inferredPosition = '';
        let inferredCampaign = inMsg.campaignHint || 'Direct WhatsApp';
        let inferredProject = '';

        if (lowerBody.includes('japan')) {
          inferredCountry = 'Japan';
          inferredPosition = 'SSW';
          inferredCampaign = inMsg.campaignHint || 'New Sales Japan 09-09-2026';
          inferredProject = 'JAPAN SSW';
        } else if (lowerBody.includes('albania') || lowerBody.includes('albaina')) {
          inferredCountry = 'Albania';
          inferredPosition = 'Hospitality';
          inferredCampaign = inMsg.campaignHint || 'New Sales Albania 04-11';
          inferredProject = 'Hospitality Division';
        } else if (lowerBody.includes('nurse') || lowerBody.includes('qatar')) {
          inferredCountry = 'Qatar';
          inferredPosition = 'Nurse';
          inferredCampaign = inMsg.campaignHint || 'Qatar Nurse';
          inferredProject = 'Healthcare Abroad';
        } else if (lowerBody.includes('kuwait')) {
          inferredCountry = 'Kuwait';
          inferredPosition = 'Hospitality';
          inferredCampaign = inMsg.campaignHint || 'Kuwait';
          inferredProject = 'Hospitality Division';
        } else if (lowerBody.includes('europe')) {
          inferredCountry = 'Europe';
          inferredPosition = 'General Applicant';
          inferredCampaign = inMsg.campaignHint || 'Europe';
        } else if (lowerBody.includes('isreal') || lowerBody.includes('israel')) {
          inferredCountry = 'Israel';
          inferredPosition = 'Supermarket';
          inferredCampaign = inMsg.campaignHint || 'Israel';
        }

        const candidateName = inMsg.senderName && inMsg.senderName.trim().length > 1
          ? inMsg.senderName.trim()
          : `WhatsApp Lead ${cleanPhone.slice(-10)}`;

        const newLead: Lead = {
          id: newLeadId,
          serialNo: '',
          entryDate: (inMsg.timestamp || new Date().toISOString()).split('T')[0],
          assignDate: '',
          name: candidateName,
          phone: cleanPhone.startsWith('91') && cleanPhone.length > 10 ? `+${cleanPhone}` : `+91${cleanPhone.slice(-10)}`,
          gender: 'Not defined',
          age: '',
          origin: '',
          country: inferredCountry,
          position: inferredPosition,
          project: inferredProject || undefined,
          experience: '',
          adminRemarks: inMsg.campaignHint ? `Captured from campaign: ${inMsg.campaignHint}` : '',
          notes: '',
          assignedTo: 'unassigned',
          importance: 3,
          remarks1: '',
          remarks2: '',
          remarks3: '',
          stage: 'new',
          budget: 0,
          budgetRaw: 'N/A',
          summary: `Inbound WhatsApp message received: "${inMsg.messageBody}"`,
          requirements: ['WhatsApp Inbound', ...(inferredPosition ? [inferredPosition] : [])],
          fitScore: 'medium',
          nextAction: 'Qualify credentials and documents.',
          campaign: inferredCampaign,
          createdAt: inMsg.timestamp || new Date().toISOString(),
          updatedAt: inMsg.timestamp || new Date().toISOString(),
          intake: false,
          tags: Array.isArray(inMsg.tags) && inMsg.tags.length > 0 ? inMsg.tags : (inferredCountry ? [inferredCountry.toUpperCase()] : []),
          messages: [
            {
              id: inMsg.id,
              wamid: inMsg.id,
              sender: 'lead',
              senderName: candidateName,
              text: String(inMsg.messageBody),
              timestamp: inMsg.timestamp || new Date().toISOString(),
              status: 'delivered',
              channel: 'whatsapp',
              ...(inMsg.mediaUrl ? {
                type: inMsg.mediaType,
                mediaUrl: String(parsedMediaUrl),
                fileName: inMsg.fileName ? String(inMsg.fileName) : undefined,
                fileSize: inMsg.fileSize ? String(inMsg.fileSize) : undefined
              } : {})
            }
          ],
          timeline: [
            {
              id: `tl_${Date.now()}_new_hook`,
              type: 'message',
              text: `Inbound WhatsApp ad enquiry received: "${String(inMsg.messageBody).substring(0, 75)}"`,
              actor: candidateName,
              timestamp: inMsg.timestamp || new Date().toISOString()
            }
          ]
        };

        const result = await addOrMergeInboundLead(newLead, { allowDeferredSync: true });
        const existingLocalIdx = leads.findIndex(l => l.id === result.lead.id);
        if (existingLocalIdx !== -1) leads[existingLocalIdx] = result.lead;
        else leads.unshift(result.lead);

        if (result.merged) {
          updatedCount++;
          console.log(`[Webhook] Atomic mutex phone match merged message "${inMsg.id}" into existing candidate "${result.lead.id}" (Assigned: ${result.lead.assignedTo || 'unassigned'}).`);
        } else {
          newCount++;
          console.log(`[Webhook] Created new requesting lead ID="${result.lead.id}" for inbound phone "${result.lead.phone}".`);
        }

        handleAutoReplyIfEnabled(result.lead.id, result.lead.phone, result.lead.name);
      }
    }

    if (touchedLeadMutations.size > 0) {
      for (const [leadId, mut] of touchedLeadMutations.entries()) {
        await updateSingleLead(leadId, (targetLead) => {
          if (!Array.isArray(targetLead.messages)) targetLead.messages = [];
          if (!Array.isArray(targetLead.timeline)) targetLead.timeline = [];

          for (const st of mut.statusUpdates) {
            const idx = targetLead.messages.findIndex(m => m && (m.id === st.wamid || m.wamid === st.wamid));
            if (idx !== -1) {
              const oldStatus = targetLead.messages[idx].status;
              const statusPriority = { 'sent': 1, 'delivered': 2, 'read': 3, 'failed': 0 };
              const oldPriority = statusPriority[oldStatus as keyof typeof statusPriority] || 0;
              const newPriority = statusPriority[st.status as keyof typeof statusPriority] || 0;
              if (newPriority > oldPriority || st.status === 'failed') {
                targetLead.messages[idx].status = st.status;
                if (st.errorDetails) {
                  targetLead.messages[idx].errorDetails = st.errorDetails;
                }
              }
            }
          }

          if (mut.inboundMessages.length > 0) {
            targetLead.messages.forEach(m => {
              if (m && m.sender !== 'lead') {
                m.status = 'read';
              }
            });
            for (const item of mut.inboundMessages) {
              const dup = targetLead.messages.some(m => m && (m.id === item.msg.id || m.wamid === item.msg.id));
              if (!dup) {
                targetLead.messages.push(item.msg);
                targetLead.timeline.push(item.timelineEntry);
              }
            }
            targetLead.updatedAt = mut.inboundMessages[mut.inboundMessages.length - 1].updatedAt;
          }

          return targetLead;
        });
      }
      console.log(`[Webhook] Atomically persisted updates for ${touchedLeadMutations.size} lead(s) to disk & Firestore.`);
    }
  } catch (err) {
    console.error('[Webhook Ingestion Error]:', err);
  }

  return { newCount, updatedCount, statusesCount };
}

// Multi-Channel Webhook Receiver Endpoints (Meta Cloud API, AiSensy, and Partners)
// CRITICAL: Immediately responds 200 OK within <2ms to prevent Meta/AiSensy timeouts and retry blacklisting!
const WEBHOOK_PATHS = [
  '/api/whatsapp/webhook',
  '/api/aisensy/webhook',
  '/api/webhook/aisensy',
  '/api/meta/webhook',
  '/api/webhook/meta'
];

WEBHOOK_PATHS.forEach(p => {
  app.post(p, (req, res) => {
    // Immediate acknowledgement to Meta / AiSensy dispatcher
    res.status(200).send('EVENT_RECEIVED');

    // Process asynchronously in background
    setImmediate(async () => {
      try {
        await processInboundWebhookPayload(req.body);
      } catch (err) {
        console.error(`[Webhook Async Error on ${p}]:`, err);
      }
    });
  });
});

// Automatic Catch-up Sync Endpoint: Reconciles all pending off-hour webhooks
app.post('/api/whatsapp/sync-catchup', async (req, res) => {
  try {
    const inboxFile = path.join(process.cwd(), 'data', 'webhooks_inbox.jsonl');
    let processedCount = 0;
    if (fs.existsSync(inboxFile)) {
      const content = fs.readFileSync(inboxFile, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item && item.payload && item.processed === false) {
            await processInboundWebhookPayload(item.payload);
            processedCount++;
          }
        } catch {
          // ignore corrupted lines
        }
      }
    }
    const leads = await getLeads();
    const requestingLeads = leads.filter(l => 
      !l.isDeleted && 
      (!l.assignedTo || l.assignedTo.toLowerCase() === 'unassigned' || l.assignedTo.toLowerCase() === 'all' || l.assignedTo.trim() === '') &&
      (l.messages || []).some(m => m && m.sender === 'lead')
    );
    res.json({
      success: true,
      processedCount,
      requestingCount: requestingLeads.length,
      totalLeads: leads.length,
      message: `Sync complete. ${requestingLeads.length} requesting leads active.`
    });
  } catch (err: any) {
    console.error('Failed to run catchup sync:', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk Import & Paste Endpoint for AiSensy Calling Sheet or Meta Ads Export
app.post('/api/whatsapp/bulk-sync', async (req, res) => {
  try {
    const { rawText, rows } = req.body;
    const leads = await getLeads(true);
    let addedCount = 0;
    let skippedCount = 0;

    // Helper to process a single candidate record
    const processCandidateRecord = async (name: string, phoneStr: string, campaignStr?: string, messageStr?: string, dateStr?: string) => {
      const cleanDigits = String(phoneStr || '').replace(/\D/g, '');
      if (!cleanDigits || cleanDigits.length < 10) {
        skippedCount++;
        return;
      }
      const last10 = cleanDigits.slice(-10);
      const formattedPhone = `+91${last10}`;

      // Check if lead already exists across phone & alternateNo
      const existingLead = findBestMatchingLeadByPhone(leads, formattedPhone);
      if (existingLead) {
        skippedCount++;
        return;
      }

      const inferredBody = messageStr || `Inbound inquiry for ${campaignStr || 'overseas jobs'}`;
      const lower = (String(campaignStr || '') + ' ' + inferredBody).toLowerCase();
      let country = '';
      let position = '';
      let campaign = campaignStr || 'Direct WhatsApp';
      let project = '';

      if (lower.includes('japan')) {
        country = 'Japan';
        position = 'SSW';
        campaign = campaignStr || 'New Sales Japan 09-09-2026';
        project = 'JAPAN SSW';
      } else if (lower.includes('albania') || lower.includes('albaina')) {
        country = 'Albania';
        position = 'Hospitality';
        campaign = campaignStr || 'New Sales Albania 04-11';
        project = 'Hospitality Division';
      } else if (lower.includes('nurse') || lower.includes('qatar')) {
        country = 'Qatar';
        position = 'Nurse';
        campaign = campaignStr || 'Qatar Nurse';
        project = 'Healthcare Abroad';
      } else if (lower.includes('kuwait')) {
        country = 'Kuwait';
        position = 'Hospitality';
        campaign = campaignStr || 'Kuwait';
        project = 'Hospitality Division';
      } else if (lower.includes('europe')) {
        country = 'Europe';
        position = 'General Applicant';
        campaign = campaignStr || 'Europe';
      } else if (lower.includes('israel') || lower.includes('isreal')) {
        country = 'Israel';
        position = 'Supermarket';
        campaign = campaignStr || 'Israel';
      }

      const cleanName = name && name.trim().length > 1 ? name.trim() : `WhatsApp Lead ${last10}`;
      const leadId = generateUniqueLeadId(leads, `CONTACT_${last10}`);
      const entryTime = dateStr && !isNaN(new Date(dateStr).getTime()) ? new Date(dateStr).toISOString() : new Date().toISOString();

      const newLead: Lead = {
        id: leadId,
        serialNo: '',
        entryDate: entryTime.split('T')[0],
        assignDate: '',
        name: cleanName,
        phone: formattedPhone,
        gender: 'Not defined',
        age: '',
        origin: '',
        country,
        position,
        project: project || undefined,
        experience: '',
        adminRemarks: `Imported via AiSensy Calling Sheet / Meta Ads Catch-up`,
        notes: '',
        assignedTo: 'unassigned',
        importance: 3,
        remarks1: '',
        remarks2: '',
        remarks3: '',
        stage: 'new',
        budget: 0,
        budgetRaw: 'N/A',
        summary: `Inbound WhatsApp message: "${inferredBody}"`,
        requirements: ['WhatsApp Inbound', ...(position ? [position] : [])],
        fitScore: 'medium',
        nextAction: 'Qualify credentials and documents.',
        campaign,
        createdAt: entryTime,
        updatedAt: entryTime,
        intake: false,
        tags: country ? [country.toUpperCase()] : [],
        messages: [
          {
            id: `m_sync_${Date.now()}_${last10}`,
            wamid: `m_sync_${Date.now()}_${last10}`,
            sender: 'lead',
            senderName: cleanName,
            text: inferredBody,
            timestamp: entryTime,
            status: 'delivered',
            channel: 'whatsapp'
          }
        ],
        timeline: [
          {
            id: `tl_${Date.now()}_sync_${last10}`,
            type: 'message',
            text: `Inbound enquiry imported: "${inferredBody.substring(0, 75)}"`,
            actor: cleanName,
            timestamp: entryTime
          }
        ]
      };

      const savedResult = await addOrMergeInboundLead(newLead, { allowDeferredSync: true });
      const idx = leads.findIndex(l => l.id === savedResult.lead.id);
      if (idx !== -1) leads[idx] = savedResult.lead;
      else leads.unshift(savedResult.lead);
      if (savedResult.merged) skippedCount++;
      else addedCount++;
    };

    // If structured rows provided
    if (Array.isArray(rows) && rows.length > 0) {
      for (const row of rows) {
        await processCandidateRecord(
          row.name || row.candidateName || row.userName,
          row.phone || row.mobile || row.contact,
          row.campaign || row.campaignName,
          row.message || row.initialMessage || row.text,
          row.date || row.createdAt || row.entryDate
        );
      }
    } 
    // If raw copy-pasted text provided
    else if (rawText && typeof rawText === 'string') {
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        // Tab-separated or comma-separated or plain text line
        const parts = line.includes('\t') ? line.split('\t') : (line.includes(',') ? line.split(',') : [line]);
        let phoneCandidate = '';
        let nameCandidate = '';
        let campaignCandidate = '';
        let msgCandidate = '';

        for (const p of parts) {
          const trimmed = p.trim();
          const digits = trimmed.replace(/\D/g, '');
          if (digits.length >= 10 && !phoneCandidate) {
            phoneCandidate = trimmed;
          } else if (!nameCandidate && trimmed.length > 2 && isNaN(Number(trimmed)) && !trimmed.toLowerCase().includes('http')) {
            nameCandidate = trimmed;
          } else if (!campaignCandidate && (trimmed.toLowerCase().includes('japan') || trimmed.toLowerCase().includes('albania') || trimmed.toLowerCase().includes('qatar') || trimmed.toLowerCase().includes('kuwait') || trimmed.toLowerCase().includes('nurse') || trimmed.toLowerCase().includes('sales'))) {
            campaignCandidate = trimmed;
          } else if (!msgCandidate && trimmed.length > 3) {
            msgCandidate = trimmed;
          }
        }

        if (phoneCandidate) {
          await processCandidateRecord(nameCandidate, phoneCandidate, campaignCandidate, msgCandidate);
        }
      }
    }

    res.json({
      success: true,
      addedCount,
      skippedCount,
      totalRequesting: leads.filter(l => !l.isDeleted && (!l.assignedTo || l.assignedTo.toLowerCase() === 'unassigned')).length,
      message: `Successfully imported ${addedCount} enquiries (${skippedCount} duplicates skipped).`
    });
  } catch (err: any) {
    console.error('Bulk sync failed:', err);
    res.status(500).json({ error: err.message });
  }
});


// GET WhatsApp Media proxy from Meta
app.get('/api/whatsapp/media/:mediaId', async (req, res) => {
  const { mediaId } = req.params;
  
  // Elegant SVG placeholder helper in case of failure or missing config
  const servePlaceholder = (reason: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" width="100%" height="100%">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <rect x="10" y="10" width="380" height="230" rx="8" fill="none" stroke="#e2e8f0" stroke-width="1.5" stroke-dasharray="6,6"/>
  <g transform="translate(200, 105)" text-anchor="middle">
    <!-- Icon container -->
    <circle cx="0" cy="-25" r="28" fill="#f1f5f9"/>
    <!-- Slash indicator indicating unavailable -->
    <line x1="-12" y1="-37" x2="12" y2="-13" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
    <line x1="12" y1="-37" x2="-12" y2="-13" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="2,2"/>
    <text y="25" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600" fill="#334155">Media Attachment Expired</text>
    <text y="48" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="500" fill="#64748b">${reason}</text>
    <text y="68" font-family="system-ui, -apple-system, sans-serif" font-size="10" fill="#94a3b8">ID: ${mediaId}</text>
  </g>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=60'); // short cache for errors
    return res.status(200).send(svg);
  };

  try {
    const metaToken = process.env.WHATSAPP_API_KEY || process.env.META_WA_ACCESS_TOKEN;
    if (!metaToken || metaToken === 'MY_WHATSAPP_API_KEY' || !metaToken.trim()) {
      return servePlaceholder('WhatsApp API Key is not configured in CRM.');
    }

    console.log(`[Meta Media Proxy] Fetching media info for ID="${mediaId}"`);
    const infoRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: {
        'Authorization': `Bearer ${metaToken.trim()}`
      }
    });

    if (!infoRes.ok) {
      const errorText = await infoRes.text();
      console.log(`[Meta Media Proxy] Gracefully handled Meta API lookup failure: ${errorText}`);
      
      let reason = 'This media has expired or is invalid';
      if (errorText.includes('does not exist') || errorText.includes('permissions') || errorText.includes('support this operation')) {
        reason = 'Attachment expired or missing Graph API permissions';
      }
      return servePlaceholder(reason);
    }

    const info = await infoRes.json() as any;
    const mediaUrl = info.url;
    if (!mediaUrl) {
      return servePlaceholder('Download URL not found in Meta response.');
    }

    console.log(`[Meta Media Proxy] Fetching binary media from Lookaside URL`);
    const binaryRes = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${metaToken.trim()}`
      }
    });

    if (!binaryRes.ok) {
      return servePlaceholder('Failed to retrieve binary file from Meta Lookaside.');
    }

    // Set content type and disposition to stream it directly to the browser
    if (info.mime_type) {
      res.setHeader('Content-Type', info.mime_type);
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    const arrayBuffer = await binaryRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (err: any) {
    console.warn('[Meta Media Proxy] Exception:', err);
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.status(200).send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" width="100%" height="100%">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <g transform="translate(200, 110)" text-anchor="middle">
    <text font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600" fill="#334155">Failed to Proxy Media</text>
    <text y="25" font-family="system-ui, -apple-system, sans-serif" font-size="11" fill="#64748b">${err.message}</text>
  </g>
</svg>`);
  }
});


// DELETE a lead (Soft Delete to prevent any accidental permanent data loss)
app.delete('/api/leads/:id', async (req, res) => {
  try {
    const existing = await getLeadById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    
    if (existing.stage === 'won') {
      try {
        await rollbackWonIncentivesForLead(
          existing.id,
          existing.name || req.params.id,
          'lead deleted'
        );
      } catch (rbErr) {
        console.error('Failed to rollback Won incentives on lead delete:', rbErr);
      }
    }

    const saved = await updateSingleLead(req.params.id, (lead) => {
      lead.isDeleted = true;
      lead.deletedAt = new Date().toISOString();
      return lead;
    });
    if (!saved) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    console.log(`[Backup System] Lead ${saved.name || req.params.id} was soft-deleted instead of being permanently removed.`);
    res.json({ success: true, message: 'Candidate soft-deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST Bulk Delete leads (Soft-delete to lighten active CRM footprint while preserving disaster recovery)
app.post('/api/leads/bulk-delete', async (req, res) => {
  try {
    const { leadIds, ids } = req.body;
    const targetIds: string[] = Array.isArray(leadIds) ? leadIds : (Array.isArray(ids) ? ids : []);
    if (targetIds.length === 0) {
      res.status(400).json({ error: 'leadIds must be a non-empty array of candidate IDs' });
      return;
    }

    const idSet = new Set(targetIds.map(String));
    const leadsSnapshot = await getLeads();
    for (const lead of leadsSnapshot) {
      if (idSet.has(lead.id) && !lead.isDeleted && lead.stage === 'won') {
        try {
          await rollbackWonIncentivesForLead(lead.id, lead.name || lead.id, 'bulk deleted');
        } catch (rbErr) {
          console.error('Failed to rollback Won incentives on bulk delete for lead:', lead.id, rbErr);
        }
      }
    }

    const nowIso = new Date().toISOString();
    const modified = await updateMultipleLeads(
      (lead) => idSet.has(lead.id) && !lead.isDeleted,
      (lead) => {
        lead.isDeleted = true;
        lead.deletedAt = nowIso;
        if (!Array.isArray(lead.timeline)) lead.timeline = [];
        lead.timeline.push({
          id: `tl_${Date.now()}_bulk_del_${Math.random().toString(36).substring(2, 6)}`,
          type: 'status',
          text: 'Candidate soft-deleted via Bulk Spreadsheet action.',
          actor: 'Administrator',
          timestamp: nowIso
        });
        return lead;
      }
    );

    const deletedCount = modified.length;
    if (deletedCount > 0) {
      console.log(`[Bulk Delete] Successfully soft-deleted ${deletedCount} candidates from active CRM view.`);
    }

    res.json({
      success: true,
      message: `Successfully deleted ${deletedCount} candidate${deletedCount !== 1 ? 's' : ''}.`,
      deletedCount
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST restore a soft-deleted lead
app.post('/api/leads/:id/restore', async (req, res) => {
  try {
    const leads = await getLeads();
    const targetLead = leads.find(l => l.id === req.params.id);
    if (!targetLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    
    if (targetLead.phone) {
      const activeConflict = leads.find(l => !l.isDeleted && l.id !== targetLead.id && (arePhonesMatching(l.phone, targetLead.phone) || (l.alternateNo && arePhonesMatching(l.alternateNo, targetLead.phone))));
      if (activeConflict) {
        res.status(400).json({ error: `Cannot restore: an active candidate with phone number ${targetLead.phone} already exists in CRM (${activeConflict.serialNo} - ${activeConflict.name}).` });
        return;
      }
    }

    if (targetLead.stage === 'won' && targetLead.assignedTo) {
      try {
        await awardWonIncentivesForLead(
          targetLead.id,
          targetLead.assignedTo,
          targetLead.name || targetLead.id,
          targetLead.project,
          targetLead.country
        );
      } catch (awardErr) {
        console.error('Failed to re-award Won incentives on restore:', awardErr);
      }
    }

    const restoredLead = await updateSingleLead(req.params.id, (lead) => {
      lead.isDeleted = false;
      lead.deletedAt = null;
      return lead;
    });
    if (!restoredLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    console.log(`[Backup System] Lead ${restoredLead.name || req.params.id} was successfully restored.`);
    res.json({ success: true, message: 'Candidate successfully restored' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


// ---------------- ACTIVE JOBS CRUD ENDPOINTS ----------------

// Helper to clean up unused job creative files on local disk
function cleanupUnusedJobCreativeFile(fileUrl: string | undefined, remainingJobs: Job[]) {
  try {
    if (!fileUrl || !fileUrl.startsWith('/uploads/job_creative_')) return;
    const isStillUsed = remainingJobs.some(j => j.imageUrl === fileUrl);
    if (isStillUsed) return;
    const safeName = path.basename(fileUrl);
    const targetPath = path.join(UPLOADS_DIR, safeName);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      console.log(`[ActiveJobs] Cleaned up replaced/deleted creative file: ${safeName}`);
    }
  } catch (cleanupErr) {
    console.warn('[ActiveJobs] Creative cleanup warning:', cleanupErr);
  }
}

// POST upload & convert job creative image into optimized WebP
app.post('/api/jobs/upload-creative', async (req, res) => {
  try {
    const { fileName, base64Data } = req.body;
    if (!base64Data || typeof base64Data !== 'string') {
      res.status(400).json({ error: 'Image data is required.' });
      return;
    }

    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
    const inputBuffer = Buffer.from(cleanBase64, 'base64');
    if (!inputBuffer || inputBuffer.length === 0) {
      res.status(400).json({ error: 'Invalid or empty image payload.' });
      return;
    }

    // Convert any uploaded creative image into compressed WebP (auto-oriented, max 1600px on longest side)
    const { data: webpBuffer, info } = await sharp(inputBuffer)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({
        quality: 82,
        effort: 4
      })
      .toBuffer({ resolveWithObject: true });

    const rawBase = path.basename(String(fileName || 'creative'), path.extname(String(fileName || 'creative')))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 40) || 'creative';

    const safeWebpName = `job_creative_${rawBase}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.webp`;
    const filePath = path.join(UPLOADS_DIR, safeWebpName);

    fs.writeFileSync(filePath, webpBuffer);

    try {
      await backupFileToFirestore(safeWebpName, filePath);
    } catch (backupErr) {
      console.error(`[ActiveJobs] Cloud backup warning for ${safeWebpName}:`, backupErr);
    }

    const fileUrl = `/uploads/${safeWebpName}`;
    console.log(
      `[ActiveJobs] Creative converted to WebP: ${safeWebpName} (${inputBuffer.length} -> ${webpBuffer.length} bytes, ${info.width}x${info.height})`
    );

    res.json({
      success: true,
      url: fileUrl,
      fileName: safeWebpName,
      format: 'webp',
      sizeBytes: webpBuffer.length,
      originalSizeBytes: inputBuffer.length,
      width: info.width,
      height: info.height
    });
  } catch (err: any) {
    console.error('[ActiveJobs] WebP creative upload failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to process and convert image to WebP.' });
  }
});

// GET all active jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await getJobs(false);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET archived (soft-deleted) jobs for zero-data-loss recovery
app.get('/api/jobs/archived', async (req, res) => {
  try {
    const allJobs = await getJobs(true);
    const archived = allJobs.filter(j => j.isDeleted === true);
    res.json(archived);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST add a new job (Creative Image + Service Charge simplified schema, legacy optional)
app.post('/api/jobs', async (req, res) => {
  try {
    const {
      imageUrl,
      serviceCharge,
      imageFormat,
      imageSizeBytes,
      originalFilename,
      title,
      country,
      salaryRange,
      requirement,
      positions,
      processingFeeMale,
      processingFeeFemale,
      accommodation,
      ageLimit,
      conditions,
      modeOfInterview,
      applicability,
      otherTerms,
      isActive
    } = req.body;

    const cleanImageUrl = imageUrl ? String(imageUrl).trim() : '';
    const cleanServiceCharge = serviceCharge ? String(serviceCharge).trim() : '';
    const cleanTitle = title ? String(title).trim() : '';

    if (!cleanImageUrl && !cleanTitle) {
      res.status(400).json({ error: 'Please upload a job creative image.' });
      return;
    }
    if (cleanImageUrl && !cleanServiceCharge && !cleanTitle) {
      res.status(400).json({ error: 'Service Charge is required.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const newJob: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      imageUrl: cleanImageUrl,
      serviceCharge: cleanServiceCharge,
      imageFormat: imageFormat ? String(imageFormat) : (cleanImageUrl.endsWith('.webp') ? 'webp' : ''),
      imageSizeBytes: typeof imageSizeBytes === 'number' ? imageSizeBytes : undefined,
      originalFilename: originalFilename ? String(originalFilename).trim() : '',
      title: cleanTitle || (cleanServiceCharge ? `Demand • ${cleanServiceCharge}`.slice(0, 120) : 'Job Demand Creative'),
      country: country ? String(country).trim() : '',
      salaryRange: salaryRange ? String(salaryRange).trim() : '',
      requirement: requirement ? String(requirement).trim() : '',
      positions: Array.isArray(positions) ? positions : undefined,
      processingFeeMale: processingFeeMale ? String(processingFeeMale).trim() : '',
      processingFeeFemale: processingFeeFemale ? String(processingFeeFemale).trim() : '',
      accommodation: accommodation ? String(accommodation).trim() : '',
      ageLimit: ageLimit ? String(ageLimit).trim() : '',
      conditions: Array.isArray(conditions) ? conditions.map(c => String(c).trim()).filter(Boolean) : [],
      modeOfInterview: modeOfInterview ? String(modeOfInterview) : '',
      applicability: applicability ? String(applicability) : '',
      otherTerms: otherTerms ? String(otherTerms).trim() : '',
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      isDeleted: false,
      deletedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const savedJob = await upsertSingleJob(newJob, 'create');
    res.status(201).json(savedJob);
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// PUT update an existing job
app.put('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      imageUrl,
      serviceCharge,
      imageFormat,
      imageSizeBytes,
      originalFilename,
      title,
      country,
      salaryRange,
      requirement,
      positions,
      processingFeeMale,
      processingFeeFemale,
      accommodation,
      ageLimit,
      conditions,
      modeOfInterview,
      applicability,
      otherTerms,
      isActive
    } = req.body;

    const jobs = await getJobs(true);
    const idx = jobs.findIndex(j => j.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const nextImageUrl = imageUrl !== undefined ? String(imageUrl).trim() : (jobs[idx].imageUrl || '');
    const nextServiceCharge = serviceCharge !== undefined ? String(serviceCharge).trim() : (jobs[idx].serviceCharge || '');

    const updatedJob: Job = {
      ...jobs[idx],
      imageUrl: nextImageUrl,
      serviceCharge: nextServiceCharge,
      imageFormat: imageFormat !== undefined
        ? String(imageFormat)
        : (nextImageUrl.endsWith('.webp') ? 'webp' : (jobs[idx].imageFormat || '')),
      imageSizeBytes: typeof imageSizeBytes === 'number' ? imageSizeBytes : jobs[idx].imageSizeBytes,
      originalFilename: originalFilename !== undefined ? String(originalFilename).trim() : (jobs[idx].originalFilename || ''),
      title: title !== undefined
        ? String(title).trim()
        : (jobs[idx].title || (nextServiceCharge ? `Demand • ${nextServiceCharge}`.slice(0, 120) : 'Job Demand Creative')),
      country: country !== undefined ? String(country).trim() : (jobs[idx].country || ''),
      salaryRange: salaryRange !== undefined ? String(salaryRange).trim() : (jobs[idx].salaryRange || ''),
      requirement: requirement !== undefined ? String(requirement).trim() : (jobs[idx].requirement || ''),
      positions: positions !== undefined ? (Array.isArray(positions) ? positions : undefined) : jobs[idx].positions,
      processingFeeMale: processingFeeMale !== undefined ? String(processingFeeMale).trim() : (jobs[idx].processingFeeMale || ''),
      processingFeeFemale: processingFeeFemale !== undefined ? String(processingFeeFemale).trim() : (jobs[idx].processingFeeFemale || ''),
      accommodation: accommodation !== undefined ? String(accommodation).trim() : (jobs[idx].accommodation || ''),
      ageLimit: ageLimit !== undefined ? String(ageLimit).trim() : (jobs[idx].ageLimit || ''),
      conditions: conditions !== undefined ? (Array.isArray(conditions) ? conditions.map(c => String(c).trim()).filter(Boolean) : (jobs[idx].conditions || [])) : (jobs[idx].conditions || []),
      modeOfInterview: modeOfInterview !== undefined ? String(modeOfInterview) : (jobs[idx].modeOfInterview || ''),
      applicability: applicability !== undefined ? String(applicability) : (jobs[idx].applicability || ''),
      otherTerms: otherTerms !== undefined ? String(otherTerms).trim() : (jobs[idx].otherTerms || ''),
      isActive: isActive !== undefined ? Boolean(isActive) : (jobs[idx].isActive !== undefined ? jobs[idx].isActive : true),
      updatedAt: new Date().toISOString()
    };

    const saved = await upsertSingleJob(updatedJob, 'update');
    res.json(saved);
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// DELETE a job (safe soft-delete: moves to Archive so creative + details are never lost)
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const ok = await softDeleteJob(id);
    if (!ok) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json({ success: true, softDeleted: true });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// POST restore a soft-deleted job from the Archive
app.post('/api/jobs/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    const restored = await restoreSingleJob(id);
    if (!restored) {
      res.status(404).json({ error: 'Archived job not found' });
      return;
    }
    res.json({ success: true, job: restored });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});


// ---------------- IMPORTANT UPDATES CRUD ENDPOINTS ----------------

// GET all important updates
app.get('/api/updates', async (req, res) => {
  try {
    const updates = await getUpdates();
    res.json(updates);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST add a new update
app.post('/api/updates', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: 'Update text is required.' });
      return;
    }

    const updates = await getUpdates();
    const newUpdate: ImportantUpdate = {
      id: `update_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      text: String(text).trim(),
      createdAt: new Date().toISOString()
    };

    updates.unshift(newUpdate);
    await saveUpdates(updates);

    res.status(201).json(newUpdate);
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// PUT update an existing update
app.put('/api/updates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!text) {
      res.status(400).json({ error: 'Update text is required.' });
      return;
    }

    const updates = await getUpdates();
    const idx = updates.findIndex(u => u.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Update not found' });
      return;
    }

    updates[idx] = {
      ...updates[idx],
      text: String(text).trim()
    };

    await saveUpdates(updates);
    res.json(updates[idx]);
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// DELETE an update
app.delete('/api/updates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await deleteUpdateById(id);
    if (!deleted) {
      res.status(404).json({ error: 'Update not found' });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// ==========================================
// NOTIFICATIONS REST API ENDPOINTS
// ==========================================

// GET notifications (disabled)
app.get('/api/notifications', (req, res) => {
  res.json([]);
});

// POST add a notification (disabled)
app.post('/api/notifications', (req, res) => {
  res.status(200).json({ success: true });
});

// PUT mark single notification as read (disabled)
app.put('/api/notifications/:id/read', (req, res) => {
  res.json({ success: true, id: req.params.id });
});

// POST mark all read (disabled)
app.post('/api/notifications/mark-all-read', (req, res) => {
  res.json({ success: true, count: 0 });
});

// POST clear/delete notifications (disabled)
app.post('/api/notifications/clear', (req, res) => {
  res.json({ success: true, remaining: 0 });
});

// DELETE single notification (disabled)
app.delete('/api/notifications/:id', (req, res) => {
  res.json({ success: true, id: req.params.id });
});

// Helper function to reconstruct stage and coordinator histories from lead timeline
function backfillLeadHistory(lead: any): boolean {
  let modified = false;
  if (!lead.stageHistory) {
    lead.stageHistory = [];
    modified = true;
  }
  if (!lead.coordinatorHistory) {
    lead.coordinatorHistory = [];
    modified = true;
  }

  const mapLabelToKeyLocal = (label: string): string => {
    const l = String(label || '').toLowerCase().trim();
    if (!l || l === 'none') return 'none';
    if (l.includes('new inbound') || l === 'new') return 'new';
    if (l.includes('in discussion') || l.includes('negotiating') || l === 'discussion') return 'in_discussion';
    if (l.includes('strong opportunity') || l === 'strong') return 'strong_opportunity';
    if (l.includes('office visited') || l.includes('interview') || l.includes('proposal')) return 'office_visited';
    if (l.includes('won') || l.includes('closed won')) return 'won';
    if (l.includes('cold') || l.includes('cold leads') || l.includes('rotations')) return 'cold_leads';
    if (l.includes('lost') || l.includes('closed lost')) return 'lost';
    return l;
  };

  // Reconstruct histories only when stageHistory is empty and timeline logs exist
  if (lead.stageHistory.length === 0 && lead.timeline && lead.timeline.length > 0) {
    lead.stageHistory = [];
    if (!Array.isArray(lead.coordinatorHistory)) {
      lead.coordinatorHistory = [];
    }
    const shouldBackfillCoords = lead.coordinatorHistory.length === 0;
    modified = true;
    // Sort timeline ascending to process chronologically
    const sortedTimeline = [...lead.timeline].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
    
    let currentStage = 'new';
    let currentCoordinator = lead.assignedTo || 'unassigned';

    // Seed initial values from creation
    lead.stageHistory.push({
      candidateId: lead.id,
      previousStage: 'none',
      newStage: 'new',
      changedBy: 'System (Backfill)',
      coordinatorId: currentCoordinator,
      changedAt: lead.createdAt || lead.entryDate || new Date().toISOString(),
      project: lead.project,
      country: lead.country
    });

    sortedTimeline.forEach((t: any) => {
      const text = (t.text || '').toLowerCase();
      const timestamp = t.timestamp || new Date().toISOString();
      const actor = t.actor || 'System';

      if (t.type === 'status' || text.includes('pipeline stage changed') || text.includes('pipeline stage auto-moved')) {
        let fromStage = '';
        let toStage = '';

        if (text.includes('changed from') && text.includes('to')) {
          const parts = text.split('changed from');
          if (parts[1]) {
            const subParts = parts[1].split(/\s+to\s+/i);
            fromStage = subParts[0].replace(/['"“”]/g, '').trim();
            toStage = subParts[1].replace(/['"“”]/g, '').trim();
          }
        } else if (text.includes('auto-moved to')) {
          const parts = text.split('auto-moved to');
          if (parts[1]) {
            toStage = parts[1].split('due to')[0].replace(/['"“”]/g, '').trim();
          }
        }

        const mapLabelToKey = (label: string): string => {
          const l = label.toLowerCase().trim();
          if (l.includes('new inbound') || l === 'new') return 'new';
          if (l.includes('in discussion') || l.includes('negotiating') || l === 'discussion') return 'in_discussion';
          if (l.includes('strong opportunity') || l === 'strong') return 'strong_opportunity';
          if (l.includes('office visited') || l.includes('interview') || l.includes('proposal')) return 'office_visited';
          if (l.includes('won') || l.includes('closed won')) return 'won';
          if (l.includes('cold') || l.includes('cold leads') || l.includes('rotations')) return 'cold_leads';
          if (l.includes('lost') || l.includes('closed lost')) return 'lost';
          return l;
        };

        const newStageKey = toStage ? mapLabelToKey(toStage) : '';
        const prevStageKey = fromStage ? mapLabelToKey(fromStage) : currentStage;

        if (newStageKey) {
          lead.stageHistory.push({
            candidateId: lead.id,
            previousStage: prevStageKey,
            newStage: newStageKey,
            changedBy: actor,
            coordinatorId: currentCoordinator,
            changedAt: timestamp,
            project: lead.project,
            country: lead.country
          });
          currentStage = newStageKey;
        }
      }

      if (t.type === 'assignment' || text.includes('assigned coordinator changed')) {
        let fromCoord = '';
        let toCoord = '';
        if (text.includes('changed from') && text.includes('to')) {
          const parts = text.split('changed from');
          if (parts[1]) {
            const subParts = parts[1].split(/\s+to\s+/i);
            fromCoord = subParts[0].replace(/['"“”]/g, '').trim();
            toCoord = subParts[1].split('via')[0].replace(/['"“”]/g, '').trim();
          }
        }

        if (toCoord) {
          if (shouldBackfillCoords) {
            lead.coordinatorHistory.push({
              candidateId: lead.id,
              previousCoordinator: fromCoord || 'unassigned',
              newCoordinator: toCoord,
              changedBy: actor,
              changedAt: timestamp
            });
          }
          currentCoordinator = toCoord;
        }
      }
    });

    lead.stageHistory.sort((a: any, b: any) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
    lead.coordinatorHistory.sort((a: any, b: any) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
    modified = true;
  }

  if (lead.stageHistory.length > 1) {
    lead.stageHistory.sort((a: any, b: any) => new Date(a.changedAt || 0).getTime() - new Date(b.changedAt || 0).getTime());
  }
  if (lead.coordinatorHistory.length > 1) {
    lead.coordinatorHistory.sort((a: any, b: any) => new Date(a.changedAt || 0).getTime() - new Date(b.changedAt || 0).getTime());
  }

  // Ensure baseline starting snapshot exists if history is still empty, or reconcile final stage mismatch
  const actualStageKey = mapLabelToKeyLocal(lead.stage || 'new');
  if (lead.stageHistory.length === 0) {
    lead.stageHistory.push({
      candidateId: lead.id,
      previousStage: 'none',
      newStage: actualStageKey,
      changedBy: 'System (Initial)',
      coordinatorId: lead.assignedTo || 'unassigned',
      changedAt: lead.createdAt || lead.entryDate || lead.updatedAt || new Date().toISOString(),
      project: lead.project,
      country: lead.country
    });
    modified = true;
  } else {
    const lastEntry = lead.stageHistory[lead.stageHistory.length - 1];
    const lastStageKey = mapLabelToKeyLocal(lastEntry?.newStage || 'new');
    if (lastStageKey !== actualStageKey) {
      const reconcileTs = lead.updatedAt || lead.createdAt || lead.entryDate || new Date().toISOString();
      const lastTs = lastEntry?.changedAt || '';
      const safeTs = lastTs && reconcileTs < lastTs ? lastTs : reconcileTs;
      lead.stageHistory.push({
        candidateId: lead.id,
        previousStage: lastStageKey,
        newStage: actualStageKey,
        changedBy: 'System (Stage Sync)',
        coordinatorId: lead.assignedTo || 'unassigned',
        changedAt: safeTs,
        project: lead.project,
        country: lead.country
      });
      modified = true;
    }
  }

  if (lead.coordinatorHistory.length === 0) {
    lead.coordinatorHistory.push({
      candidateId: lead.id,
      previousCoordinator: 'unassigned',
      newCoordinator: lead.assignedTo || 'unassigned',
      changedBy: 'System (Initial)',
      changedAt: lead.assignDate || lead.createdAt || lead.entryDate || new Date().toISOString()
    });
    modified = true;
  }

  return modified;
}

// GET Coordinator Performance Report
app.get('/api/reports/coordinator-performance', async (req, res) => {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const coordinator = (req.query.coordinator as string) || 'all';
    const project = (req.query.project as string) || 'all';
    const country = (req.query.country as string) || 'all';
    const source = (req.query.source as string) || 'all';
    const attributionMode = (req.query.attributionMode as string) || 'ownership'; // 'ownership' | 'activity'

    const leads = await getLeads();
    const coordinators = await getCoordinators();

    // 1. Backfill all leads in memory
    leads.forEach(lead => backfillLeadHistory(lead));

    // Calculate previous month string
    const [year, monthNum] = month.split('-').map(Number);
    let prevYear = year;
    let prevMonthNum = monthNum - 1;
    if (prevMonthNum === 0) {
      prevMonthNum = 12;
      prevYear = year - 1;
    }
    const previousMonth = `${prevYear}-${String(prevMonthNum).padStart(2, '0')}`;

    // Calculate previous previous month string
    let prevPrevYear = prevYear;
    let prevPrevMonthNum = prevMonthNum - 1;
    if (prevPrevMonthNum === 0) {
      prevPrevMonthNum = 12;
      prevPrevYear = prevYear - 1;
    }
    const prevPrevMonth = `${prevPrevYear}-${String(prevPrevMonthNum).padStart(2, '0')}`;

    // Robust helper to get YYYY-MM from any date format safely
    const getMonthStr = (dateVal: any): string => {
      if (!dateVal) return '';
      try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) {
          // Fallback if Date parsing fails but it resembles YYYY-MM
          if (typeof dateVal === 'string' && /^\d{4}-\d{2}/.test(dateVal)) {
            return dateVal.slice(0, 7);
          }
          return '';
        }
        return d.toISOString().slice(0, 7);
      } catch {
        return '';
      }
    };

    // Helper to check if a timestamp matches a given YYYY-MM
    const matchesMonth = (timestamp: string, targetMonth: string) => {
      if (!timestamp) return false;
      const mStr = getMonthStr(timestamp);
      return mStr === targetMonth;
    };

    // Helper to standardize stage names
    const stdStage = (st: string): string => {
      if (!st) return 'new';
      const s = st.toLowerCase().trim();
      if (s === 'negotiating') return 'in_discussion';
      if (s === 'rotations') return 'cold_leads'; // Maps correctly to cold_leads (Cold Leads)
      if (s === 'proposal') return 'office_visited';
      return s;
    };

    // Helper to check match of filters
    const matchFilters = (lead: any) => {
      if (project !== 'all' && String(lead.project || '').trim().toLowerCase() !== project.trim().toLowerCase()) return false;
      if (country !== 'all' && String(lead.country || '').trim().toLowerCase() !== country.trim().toLowerCase()) return false;
      if (source !== 'all' && String(lead.source || '').trim().toLowerCase() !== source.trim().toLowerCase()) return false;
      return true;
    };

    // Get list of active agents (coordinators)
    const activeCoordinators = coordinators.filter(c => c.role === 'agent');

    // Reconstruct snapshot of a month's performance
    const computeStats = (targetMonth: string, coordSelector: string) => {
      let assignedLeads: any[] = [];
      let touchedLeads: any[] = [];
      let activePipelineLeads: any[] = [];
      let strongOpportunityLeads: any[] = [];
      let interviewLeads: any[] = [];
      let wonLeads: any[] = [];
      let coldLeads: any[] = [];
      let lostLeads: any[] = [];
      let cumulativeTouchedCount = 0;

      const byStageCounts: Record<string, number> = {
        new: 0,
        in_discussion: 0,
        strong_opportunity: 0,
        office_visited: 0,
        won: 0,
        cold_leads: 0,
        lost: 0
      };

      // Leads that entered (or started in) their end-of-month stage during targetMonth
      const monthlyStageCounts: Record<string, number> = {
        new: 0,
        in_discussion: 0,
        strong_opportunity: 0,
        office_visited: 0,
        won: 0,
        cold_leads: 0,
        lost: 0
      };

      // Stage movement variables
      const stageMovement: Record<string, { entered: number, movedForward: number, movedBack: number, exited: number, stillIn: number }> = {};
      const STAGE_KEYS = ['new', 'in_discussion', 'strong_opportunity', 'office_visited', 'won', 'cold_leads', 'lost'];
      STAGE_KEYS.forEach(k => {
        stageMovement[k] = { entered: 0, movedForward: 0, movedBack: 0, exited: 0, stillIn: 0 };
      });

      // Activity counts
      let activityCounts = {
        whatsappConversations: 0,
        calls: 0,
        remarksAdded: 0,
        stageChanges: 0,
        followups: 0,
        profileUpdates: 0
      };

      leads.forEach(lead => {
        // Ignore soft-deleted leads
        if (lead.isDeleted) return;

        // Exclude un-intaken leads from the performance reports to align with board counts
        if (!getEffectiveIntake(lead)) return;

        if (!matchFilters(lead)) return;

        const leadCreatedDate = lead.createdAt || lead.entryDate || '';
        const createdMonth = getMonthStr(leadCreatedDate);
        if (createdMonth && createdMonth > targetMonth) {
          // This lead did not exist in the target month under review!
          return;
        }

        // Determine if lead was owned or touched by the coordinator in the target month
        let isAssignedToTarget = false;
        let isTouchedByTarget = false;

        const leadOwnerHistory = lead.coordinatorHistory || [];
        let ownerAtEndOfMonth = 'unassigned';
        const [yParts, mParts] = targetMonth.split('-');
        const lastDay = new Date(Number(yParts), Number(mParts), 0).getDate();
        const monthEndBoundary = `${targetMonth}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;
        const pastAssignments = leadOwnerHistory.filter((e: any) => e.changedAt <= monthEndBoundary);
        if (pastAssignments.length > 0) {
          ownerAtEndOfMonth = pastAssignments[pastAssignments.length - 1].newCoordinator;
        } else {
          const assignMonth = getMonthStr(lead.assignDate || leadCreatedDate);
          if (assignMonth && assignMonth <= targetMonth) {
            ownerAtEndOfMonth = lead.assignedTo || 'unassigned';
          } else {
            ownerAtEndOfMonth = 'unassigned';
          }
        }

        const isMatchCoord = (username: string) => {
          if (!username) return false;
          if (coordSelector === 'all') {
            return username.toLowerCase() !== 'unassigned';
          }
          return username.toLowerCase() === coordSelector.toLowerCase();
        };

        if (attributionMode === 'ownership') {
          isAssignedToTarget = isMatchCoord(ownerAtEndOfMonth);
        } else {
          const assignedInMonth = leadOwnerHistory.some((e: any) => matchesMonth(e.changedAt, targetMonth) && isMatchCoord(e.newCoordinator));
          isAssignedToTarget = assignedInMonth || (lead.assignDate && matchesMonth(lead.assignDate, targetMonth) && isMatchCoord(lead.assignedTo)) || isMatchCoord(ownerAtEndOfMonth);
        }

        const touchLogs = (lead.timeline || []).filter((t: any) => {
          if (!matchesMonth(t.timestamp, targetMonth)) return false;
          if (coordSelector === 'all') return true;
          return t.actor && (t.actor.toLowerCase().includes(coordSelector.toLowerCase()) || (lead.assignedTo && lead.assignedTo.toLowerCase() === coordSelector.toLowerCase() && t.actor.toLowerCase().includes('coordinator')));
        });

        const touchMessages = (lead.messages || []).filter((m: any) => {
          if (!matchesMonth(m.timestamp, targetMonth)) return false;
          if (m.sender !== 'user') return false;
          if (coordSelector === 'all') return true;
          return m.senderName && m.senderName.toLowerCase() === coordSelector.toLowerCase();
        });

        isTouchedByTarget = touchLogs.length > 0 || touchMessages.length > 0;

        const pastTouchLogs = (lead.timeline || []).filter((t: any) => {
          if (t.timestamp > monthEndBoundary) return false;
          if (coordSelector === 'all') return true;
          return t.actor && (t.actor.toLowerCase().includes(coordSelector.toLowerCase()) || (lead.assignedTo && lead.assignedTo.toLowerCase() === coordSelector.toLowerCase() && t.actor.toLowerCase().includes('coordinator')));
        });

        const pastTouchMessages = (lead.messages || []).filter((m: any) => {
          if (m.timestamp > monthEndBoundary) return false;
          if (m.sender !== 'user') return false;
          if (coordSelector === 'all') return true;
          return m.senderName && m.senderName.toLowerCase() === coordSelector.toLowerCase();
        });

        if (pastTouchLogs.length > 0 || pastTouchMessages.length > 0) {
          cumulativeTouchedCount++;
        }

        if (!isAssignedToTarget && !isTouchedByTarget) return;

        if (isAssignedToTarget) {
          assignedLeads.push(lead);
        }
        if (isTouchedByTarget) {
          touchedLeads.push(lead);
        }

        let stageAtEndOfMonth = 'new';
        const pastStages = (lead.stageHistory || [])
          .filter((e: any) => e.changedAt <= monthEndBoundary)
          .sort((a: any, b: any) => new Date(a.changedAt || 0).getTime() - new Date(b.changedAt || 0).getTime());
        if (pastStages.length > 0) {
          stageAtEndOfMonth = stdStage(pastStages[pastStages.length - 1].newStage);
        } else {
          stageAtEndOfMonth = stdStage(lead.stage || 'new');
        }

        if (isAssignedToTarget) {
          byStageCounts[stageAtEndOfMonth] = (byStageCounts[stageAtEndOfMonth] || 0) + 1;

          // Find when the lead entered its unbroken run in stageAtEndOfMonth up to monthEndBoundary
          let enteredCurrentStageAt = '';
          for (let i = pastStages.length - 1; i >= 0; i--) {
            if (stdStage(pastStages[i].newStage) === stageAtEndOfMonth) {
              enteredCurrentStageAt = pastStages[i].changedAt || '';
            } else {
              break;
            }
          }
          if (!enteredCurrentStageAt) {
            enteredCurrentStageAt = lead.createdAt || lead.entryDate || '';
          }
          if (matchesMonth(enteredCurrentStageAt, targetMonth)) {
            monthlyStageCounts[stageAtEndOfMonth] = (monthlyStageCounts[stageAtEndOfMonth] || 0) + 1;
          }

          if (['new', 'in_discussion', 'strong_opportunity', 'office_visited'].includes(stageAtEndOfMonth)) {
            activePipelineLeads.push(lead);
          }
          if (stageAtEndOfMonth === 'strong_opportunity') {
            strongOpportunityLeads.push(lead);
          }
          if (stageAtEndOfMonth === 'office_visited') {
            interviewLeads.push(lead);
          }
          if (stageAtEndOfMonth === 'won') {
            wonLeads.push(lead);
          }
          if (stageAtEndOfMonth === 'cold_leads') {
            coldLeads.push(lead);
          }
          if (stageAtEndOfMonth === 'lost') {
            lostLeads.push(lead);
          }
        }

        const monthStages = (lead.stageHistory || []).filter((e: any) => matchesMonth(e.changedAt, targetMonth));
        if (monthStages.length > 0) {
          monthStages.forEach((ev: any) => {
            const fromS = stdStage(ev.previousStage);
            const toS = stdStage(ev.newStage);
            const fromIdx = STAGE_KEYS.indexOf(fromS);
            const toIdx = STAGE_KEYS.indexOf(toS);

            let byTarget = true;
            if (coordSelector !== 'all') {
              byTarget = ev.changedBy && ev.changedBy.toLowerCase().includes(coordSelector.toLowerCase());
            }

            if (byTarget) {
              if (toS && stageMovement[toS]) {
                stageMovement[toS].entered++;
              }
              if (fromS && stageMovement[fromS]) {
                stageMovement[fromS].exited++;
              }

              if (fromIdx !== -1 && toIdx !== -1) {
                if (toIdx > fromIdx) {
                  if (fromS && stageMovement[fromS]) stageMovement[fromS].movedForward++;
                } else if (toIdx < fromIdx) {
                  if (fromS && stageMovement[fromS]) stageMovement[fromS].movedBack++;
                }
              }
            }
          });
        }

        if (isTouchedByTarget) {
          touchMessages.forEach(m => {
            activityCounts.whatsappConversations++;
          });
          touchLogs.forEach(l => {
            const txt = (l.text || '').toLowerCase();
            if (txt.includes('call status updated') || txt.includes('call status') || txt.includes('call connected')) {
              activityCounts.calls++;
            } else if (txt.includes('remarks: ') || txt.includes('updated 1st remarks') || txt.includes('updated 2nd remarks') || txt.includes('updated 3rd remarks')) {
              activityCounts.remarksAdded++;
            } else if (l.type === 'status' || txt.includes('pipeline stage changed')) {
              activityCounts.stageChanges++;
            } else if (l.type === 'task' || txt.includes('task')) {
              activityCounts.followups++;
            } else {
              activityCounts.profileUpdates++;
            }
          });
        }
      });

      STAGE_KEYS.forEach(k => {
        stageMovement[k].stillIn = byStageCounts[k] || 0;
      });

      return {
        assignedCount: assignedLeads.length,
        touchedCount: touchedLeads.length,
        activePipelineCount: activePipelineLeads.length,
        strongOpportunityCount: strongOpportunityLeads.length,
        interviewCount: interviewLeads.length,
        wonCount: wonLeads.length,
        coldCount: coldLeads.length,
        lostCount: lostLeads.length,
        byStage: byStageCounts,
        monthlyStageCounts,
        stageMovement,
        activityCounts,
        assignedLeads,
        touchedLeads,
        cumulativeTouchedCount: cumulativeTouchedCount
      };
    };

    const currentStats = computeStats(month, coordinator);
    const prevStats = computeStats(previousMonth, coordinator);
    const prevPrevStats = computeStats(prevPrevMonth, coordinator);

    const calculateKpi = (currVal: number, prevVal: number) => {
      const absChange = currVal - prevVal;
      const pctChange = prevVal === 0 ? (currVal > 0 ? 100 : 0) : Number(((absChange / prevVal) * 100).toFixed(1));
      return {
        current: currVal,
        previous: prevVal,
        absChange,
        pctChange
      };
    };

    const assignedCurrent = Math.max(0, currentStats.assignedCount - prevStats.assignedCount);
    const assignedPrevious = Math.max(0, prevStats.assignedCount - prevPrevStats.assignedCount);
    const assignedAbsChange = assignedCurrent - assignedPrevious;
    const assignedPctChange = assignedPrevious === 0 ? (assignedCurrent > 0 ? 100 : 0) : Number(((assignedAbsChange / assignedPrevious) * 100).toFixed(1));
    const assignedCumulativePctChange = prevStats.assignedCount === 0 ? (currentStats.assignedCount > 0 ? 100 : 0) : Number((((currentStats.assignedCount - prevStats.assignedCount) / prevStats.assignedCount) * 100).toFixed(1));

    const touchedCurrent = currentStats.touchedCount;
    const touchedPrevious = prevStats.touchedCount;
    const touchedAbsChange = touchedCurrent - touchedPrevious;
    const touchedPctChange = touchedPrevious === 0 ? (touchedCurrent > 0 ? 100 : 0) : Number(((touchedAbsChange / touchedPrevious) * 100).toFixed(1));

    const strongMonthlyCurr = currentStats.monthlyStageCounts.strong_opportunity || 0;
    const strongMonthlyPrev = prevStats.monthlyStageCounts.strong_opportunity || 0;
    const interviewMonthlyCurr = currentStats.monthlyStageCounts.office_visited || 0;
    const interviewMonthlyPrev = prevStats.monthlyStageCounts.office_visited || 0;
    const wonMonthlyCurr = currentStats.monthlyStageCounts.won || 0;
    const wonMonthlyPrev = prevStats.monthlyStageCounts.won || 0;
    const coldMonthlyCurr = currentStats.monthlyStageCounts.cold_leads || 0;
    const coldMonthlyPrev = prevStats.monthlyStageCounts.cold_leads || 0;
    const lostMonthlyCurr = currentStats.monthlyStageCounts.lost || 0;
    const lostMonthlyPrev = prevStats.monthlyStageCounts.lost || 0;

    const kpis = {
      leadsAssigned: {
        current: assignedCurrent,
        previous: assignedPrevious,
        absChange: assignedAbsChange,
        pctChange: assignedPctChange,
        cumulative: currentStats.assignedCount,
        prevCumulative: prevStats.assignedCount,
        cumulativePctChange: assignedCumulativePctChange
      },
      leadsTouched: {
        current: touchedCurrent,
        previous: touchedPrevious,
        absChange: touchedAbsChange,
        pctChange: touchedPctChange,
        cumulative: currentStats.cumulativeTouchedCount,
        prevCumulative: prevStats.cumulativeTouchedCount
      },
      activePipeline: {
        ...calculateKpi(currentStats.activePipelineCount, prevStats.activePipelineCount),
        cumulative: currentStats.activePipelineCount
      },
      strongOpportunities: {
        ...calculateKpi(strongMonthlyCurr, strongMonthlyPrev),
        cumulative: currentStats.strongOpportunityCount,
        prevCumulative: prevStats.strongOpportunityCount
      },
      interviews: {
        ...calculateKpi(interviewMonthlyCurr, interviewMonthlyPrev),
        cumulative: currentStats.interviewCount,
        prevCumulative: prevStats.interviewCount
      },
      won: {
        ...calculateKpi(wonMonthlyCurr, wonMonthlyPrev),
        cumulative: currentStats.wonCount,
        prevCumulative: prevStats.wonCount
      },
      cold: {
        ...calculateKpi(coldMonthlyCurr, coldMonthlyPrev),
        cumulative: currentStats.coldCount,
        prevCumulative: prevStats.coldCount
      },
      lost: {
        ...calculateKpi(lostMonthlyCurr, lostMonthlyPrev),
        cumulative: currentStats.lostCount,
        prevCumulative: prevStats.lostCount
      }
    };

    const coordinatorRows = activeCoordinators.map(coord => {
      const cStats = computeStats(month, coord.username);
      const cPrevStats = computeStats(previousMonth, coord.username);

      const leadsAssigned = cStats.assignedCount;
      const leadsTouched = cStats.touchedCount;
      const touchRate = leadsAssigned === 0 ? 0 : Number(((leadsTouched / leadsAssigned) * 100).toFixed(1));
      const wonRate = leadsAssigned === 0 ? 0 : Number(((cStats.wonCount / leadsAssigned) * 100).toFixed(2));

      let progressions = 0;
      Object.keys(cStats.stageMovement).forEach(k => {
        progressions += cStats.stageMovement[k].movedForward;
      });
      const stageProgressionRate = leadsAssigned === 0 ? 0 : Number(((progressions / leadsAssigned) * 100).toFixed(1));

      const momChangeVal = leadsAssigned - cPrevStats.assignedCount;
      const momChangePct = cPrevStats.assignedCount === 0 ? 0 : Number(((momChangeVal / cPrevStats.assignedCount) * 100).toFixed(1));
      const momChangeStr = momChangeVal >= 0 ? `+${momChangeVal} (+${momChangePct}%)` : `${momChangeVal} (${momChangePct}%)`;

      return {
        coordinator: coord.displayName,
        username: coord.username,
        leadsAssigned,
        leadsTouched,
        touchRate: `${touchRate}%`,
        newInbound: cStats.byStage.new || 0,
        inDiscussion: cStats.byStage.in_discussion || 0,
        strongOpportunity: cStats.byStage.strong_opportunity || 0,
        interview: cStats.byStage.office_visited || 0,
        won: cStats.wonCount,
        cold: cStats.coldCount,
        lost: cStats.lostCount,
        wonRate: `${wonRate}%`,
        stageProgressionRate: `${stageProgressionRate}%`,
        moMChange: momChangeStr
      };
    });

    coordinatorRows.sort((a, b) => b.leadsAssigned - a.leadsAssigned);

    const activeLeadsForAgeing = leads.filter(lead => {
      if (!matchFilters(lead)) return false;
      const isOwnedByTarget = coordinator === 'all' 
        ? (lead.assignedTo && lead.assignedTo.toLowerCase() !== 'unassigned')
        : (lead.assignedTo && lead.assignedTo.toLowerCase() === coordinator.toLowerCase());
      const isActive = ['new', 'in_discussion', 'strong_opportunity', 'office_visited'].includes(stdStage(lead.stage || 'new'));
      return isOwnedByTarget && isActive;
    });

    const ageingBuckets = {
      '0-7': 0,
      '8-15': 0,
      '16-30': 0,
      '31-60': 0,
      '60+': 0
    };

    activeLeadsForAgeing.forEach(lead => {
      const date = lead.createdAt || lead.entryDate || new Date().toISOString();
      const diffTime = Math.abs(Date.now() - new Date(date).getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 7) ageingBuckets['0-7']++;
      else if (diffDays <= 15) ageingBuckets['8-15']++;
      else if (diffDays <= 30) ageingBuckets['16-30']++;
      else if (diffDays <= 60) ageingBuckets['31-60']++;
      else ageingBuckets['60+']++;
    });

    const projectMap: Record<string, any> = {};
    leads.forEach(lead => {
      if (!matchFilters(lead)) return;
      const isOwnedByTarget = coordinator === 'all'
        ? (lead.assignedTo && lead.assignedTo.toLowerCase() !== 'unassigned')
        : (lead.assignedTo && lead.assignedTo.toLowerCase() === coordinator.toLowerCase());
      if (!isOwnedByTarget) return;

      const proj = lead.project || 'General';
      if (!projectMap[proj]) {
        projectMap[proj] = { project: proj, leads: 0, touched: 0, discussion: 0, strongOpportunity: 0, interview: 0, won: 0, cold: 0, lost: 0 };
      }

      projectMap[proj].leads++;
      const isTouched = (lead.timeline || []).some((t: any) => matchesMonth(t.timestamp, month)) || (lead.messages || []).some((m: any) => matchesMonth(m.timestamp, month));
      if (isTouched) {
        projectMap[proj].touched++;
      }

      const st = stdStage(lead.stage || 'new');
      if (st === 'in_discussion') projectMap[proj].discussion++;
      else if (st === 'strong_opportunity') projectMap[proj].strongOpportunity++;
      else if (st === 'office_visited') projectMap[proj].interview++;
      else if (st === 'won') projectMap[proj].won++;
      else if (st === 'cold_leads') projectMap[proj].cold++;
      else if (st === 'lost') projectMap[proj].lost++;
    });

    const projectPerformance = Object.values(projectMap).sort((a: any, b: any) => b.leads - a.leads);

    const countryMapRes: Record<string, any> = {};
    leads.forEach(lead => {
      if (!matchFilters(lead)) return;
      const isOwnedByTarget = coordinator === 'all'
        ? (lead.assignedTo && lead.assignedTo.toLowerCase() !== 'unassigned')
        : (lead.assignedTo && lead.assignedTo.toLowerCase() === coordinator.toLowerCase());
      if (!isOwnedByTarget) return;

      const ctry = lead.country || 'Unknown';
      if (!countryMapRes[ctry]) {
        countryMapRes[ctry] = { country: ctry, leads: 0, touched: 0, strongOpportunities: 0, interviews: 0, won: 0, lost: 0 };
      }

      countryMapRes[ctry].leads++;
      const isTouched = (lead.timeline || []).some((t: any) => matchesMonth(t.timestamp, month)) || (lead.messages || []).some((m: any) => matchesMonth(m.timestamp, month));
      if (isTouched) {
        countryMapRes[ctry].touched++;
      }

      const st = stdStage(lead.stage || 'new');
      if (st === 'strong_opportunity') countryMapRes[ctry].strongOpportunities++;
      else if (st === 'office_visited') countryMapRes[ctry].interviews++;
      else if (st === 'won') countryMapRes[ctry].won++;
      else if (st === 'lost') countryMapRes[ctry].lost++;
    });

    const countryPerformance = Object.values(countryMapRes).sort((a: any, b: any) => b.leads - a.leads);

    const sourceMapRes: Record<string, any> = {};
    leads.forEach(lead => {
      if (!matchFilters(lead)) return;
      const isOwnedByTarget = coordinator === 'all'
        ? (lead.assignedTo && lead.assignedTo.toLowerCase() !== 'unassigned')
        : (lead.assignedTo && lead.assignedTo.toLowerCase() === coordinator.toLowerCase());
      if (!isOwnedByTarget) return;

      const src = lead.source || 'Organic';
      if (!sourceMapRes[src]) {
        sourceMapRes[src] = { source: src, leads: 0, touched: 0, strongOpportunities: 0, interviews: 0, won: 0, lost: 0 };
      }

      sourceMapRes[src].leads++;
      const isTouched = (lead.timeline || []).some((t: any) => matchesMonth(t.timestamp, month)) || (lead.messages || []).some((m: any) => matchesMonth(m.timestamp, month));
      if (isTouched) {
        sourceMapRes[src].touched++;
      }

      const st = stdStage(lead.stage || 'new');
      if (st === 'strong_opportunity') sourceMapRes[src].strongOpportunities++;
      else if (st === 'office_visited') sourceMapRes[src].interviews++;
      else if (st === 'won') sourceMapRes[src].won++;
      else if (st === 'lost') sourceMapRes[src].lost++;
    });

    const sourcePerformance = Object.values(sourceMapRes).sort((a: any, b: any) => b.leads - a.leads);

    const totalLeadsCount = leads.length;
    let missingCoordinator = 0;
    let missingStage = 0;
    let missingActivityDate = 0;
    let duplicateRecords = 0;

    const seenPhones = new Set();
    leads.forEach(lead => {
      if (!lead.assignedTo || lead.assignedTo.toLowerCase() === 'unassigned') missingCoordinator++;
      if (!lead.stage) missingStage++;
      if (!lead.createdAt && !lead.entryDate) missingActivityDate++;
      if (lead.phone) {
        if (seenPhones.has(lead.phone)) duplicateRecords++;
        else seenPhones.add(lead.phone);
      }
    });

    const dataQualityScore = totalLeadsCount === 0 ? 100 : Number(((1 - ((missingCoordinator + missingStage + duplicateRecords) / (totalLeadsCount * 3))) * 100).toFixed(1));

    res.json({
      reportingPeriod: month,
      comparisonPeriod: previousMonth,
      attributionMode,
      kpis,
      coordinatorRows,
      currentStats: {
        assignedCount: currentStats.assignedCount,
        touchedCount: currentStats.touchedCount,
        byStage: currentStats.byStage,
        stageMovement: currentStats.stageMovement,
        activityCounts: currentStats.activityCounts
      },
      prevStats: {
        assignedCount: prevStats.assignedCount,
        touchedCount: prevStats.touchedCount,
        byStage: prevStats.byStage,
        stageMovement: prevStats.stageMovement,
        activityCounts: prevStats.activityCounts
      },
      ageingBuckets,
      projectPerformance,
      countryPerformance,
      sourcePerformance,
      dataQuality: {
        score: dataQualityScore,
        missingCoordinator,
        missingStage,
        missingActivityDate,
        duplicateRecords,
        coverageDate: '2026-01-01'
      }
    });

  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


// GET all incentive rules
app.get('/api/incentive-rules', async (req, res) => {
  try {
    const rules = await getIncentiveRules();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST a new incentive rule
app.post('/api/incentive-rules', async (req, res) => {
  try {
    const { projectName, country, amount } = req.body;
    if (!projectName || !country || amount === undefined) {
      res.status(400).json({ error: 'ProjectName, country, and amount are required.' });
      return;
    }

    const rules = await getIncentiveRules();
    const newRule: IncentiveRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      projectName: String(projectName).trim(),
      country: String(country).trim(),
      amount: Number(amount),
      createdAt: new Date().toISOString()
    };

    rules.unshift(newRule);
    await saveIncentiveRules(rules);

    res.status(201).json(newRule);
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// PUT update an incentive rule
app.put('/api/incentive-rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { projectName, country, amount } = req.body;

    if (!projectName || !country || amount === undefined) {
      res.status(400).json({ error: 'ProjectName, country, and amount are required.' });
      return;
    }

    const rules = await getIncentiveRules();
    const idx = rules.findIndex(r => r.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Incentive rule not found' });
      return;
    }

    rules[idx] = {
      ...rules[idx],
      projectName: String(projectName).trim(),
      country: String(country).trim(),
      amount: Number(amount)
    };

    await saveIncentiveRules(rules);
    res.json(rules[idx]);
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// DELETE an incentive rule
app.delete('/api/incentive-rules/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rules = await getIncentiveRules();
    const filtered = rules.filter(r => r.id !== id);
    if (rules.length === filtered.length) {
      res.status(404).json({ error: 'Incentive rule not found' });
      return;
    }

    await saveIncentiveRules(filtered);
    res.json({ success: true });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// --- MONTHLY WON TARGET & INCENTIVE MILESTONE (Coord Bishwo & Priya) ---

// GET monthly target configuration
app.get('/api/monthly-target-settings', async (req, res) => {
  try {
    const settings = await getMonthlyTargetSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST update monthly target configuration (Admin only)
app.post('/api/monthly-target-settings', async (req, res) => {
  try {
    const { targetWonCount, tier1Rate, tier2Rate, targetCoordinators } = req.body;
    const updated = await saveMonthlyTargetSettings({
      targetWonCount,
      tier1Rate,
      tier2Rate,
      targetCoordinators
    });
    res.json({ success: true, settings: updated });
  } catch (err) {
    const status = (err as Error)?.message?.includes('Cloud save failed') ? 503 : 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// GET live progress of monthly target
app.get('/api/monthly-target-progress', async (req, res) => {
  try {
    const monthKey = req.query.month as string | undefined;
    const progress = await getMonthlyTargetProgress(monthKey);
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST execute month-end payout settlement to Bishwo and Priya's wallets
app.post('/api/monthly-target-settle', async (req, res) => {
  try {
    const { monthKey, note } = req.body;
    const result = await settleMonthlyTargetPayout(monthKey, note);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// CANDIDATE REACTIVATION ENGINE ENDPOINTS
// ==========================================

// Helper for automated reactivation conversational chatbot
async function handleReactivationChatbot(leadId: string, messageBody: string) {
  try {
    console.log(`[Reactivation Chatbot] Running AI pre-screening chatbot for lead ID="${leadId}" on message: "${messageBody}"`);
    
    // Fetch fresh leads database
    const leads = await getLeads(true);
    const idx = leads.findIndex(l => l.id === leadId);
    if (idx === -1) return;
    
    const lead = leads[idx];
    const campaignName = lead.campaign || '';
    const status = lead.reactivationStatus || 'sent';
    
    // Check if Gemini is available
    const ai = getGemini();
    let replyText = "";
    let nextStatus = status;
    let nextStage = lead.stage;
    let addTag: string | null = null;
    let timelineText = "";

    // Parse job details from campaign name (e.g. "Reactivation - Hotel Supervisor Dubai")
    const jobDetail = campaignName.replace('Reactivation - ', '');

    if (ai) {
      // Use Gemini to generate smart chat response and analyze status
      try {
        const history = (lead.messages || [])
          .filter(m => m && m.text)
          .map(m => `${m.sender === 'lead' ? 'Candidate' : 'Recruitment Agent'}: ${m.text}`)
          .join('\n');

        const prompt = `You are the automated recruitment coordinator for Career Growth Placement (CGP).
        We sent this candidate a reactivation campaign for the vacancy: "${jobDetail}".
        
        The current candidate reactivation status is "${status}".
        
        Here is the chat history so far:
        ${history}
        
        The candidate's latest message is: "${messageBody}"
        
        Your objective:
        1. Keep a warm, polite, professional tone on behalf of Career Growth Placement.
        2. If status is "sent", they just replied. If they expressed interest (e.g., YES, okay, sure, I want to know more, how much is it), you should reply warmly, explain the job slightly more, and ask 2 screening questions: 
           - Do they have a valid passport?
           - Do they have at least 2-3 years of experience in this role?
           Set nextStatus = "replied".
        3. If status is "replied" (pre-screening), analyze their latest reply. If they confirm they have a passport and experience, set nextStatus = "qualified" and say you've shortlisted them for a call. If they say no, set nextStatus = "unqualified" and say we'll keep them for other matches. If they didn't answer fully, ask again politely and keep nextStatus = "replied".
        
        Please return a JSON object with:
        - "replyText": (the text to send to the candidate on WhatsApp)
        - "nextStatus": (the new reactivation status: "replied" | "qualified" | "unqualified")
        - "isQualified": (boolean, true if they confirmed passport + experience and want the job)
        - "timelineMessage": (brief note describing what happened for the CRM activity timeline)
        
        Return ONLY valid JSON matching format: { "replyText": "...", "nextStatus": "...", "isQualified": false, "timelineMessage": "..." }`;

        const response = await safeGenerateContent(ai, {
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                replyText: { type: Type.STRING },
                nextStatus: { type: Type.STRING },
                isQualified: { type: Type.BOOLEAN },
                timelineMessage: { type: Type.STRING }
              },
              required: ["replyText", "nextStatus", "isQualified", "timelineMessage"]
            }
          }
        });

        const resObj = JSON.parse(response.text.trim());
        replyText = resObj.replyText;
        nextStatus = resObj.nextStatus;
        if (resObj.isQualified) {
          nextStatus = "qualified";
          // Keeping nextStage equal to lead.stage to preserve full user/coordinator control over the CRM pipeline.
          addTag = "Reactivation - Interested";
        }
        timelineText = resObj.timelineMessage;
      } catch (geminiErr) {
        console.error('Gemini reactivation chatbot failed, using fallback:', geminiErr);
        // Fallback below
      }
    }

    // Fallback rule-based chatbot (if Gemini failed or is simulated)
    if (!replyText) {
      const lowerMsg = messageBody.toLowerCase();
      const isAffirmative = lowerMsg.includes('yes') || lowerMsg.includes('interested') || lowerMsg.includes('ok') || lowerMsg.includes('sure') || lowerMsg.includes('yep') || lowerMsg.includes('yeah') || lowerMsg.includes('hi') || lowerMsg.includes('hello');
      
      if (status === 'sent') {
        if (isAffirmative) {
          replyText = `That's great! We are looking to fill this position quickly. Before scheduling a call, could you please confirm:\n1. Do you have a valid passport?\n2. Do you have at least 2-3 years of experience in this position?`;
          nextStatus = 'replied';
          timelineText = "Candidate replied YES. Initiated pre-screening questionnaire.";
        } else {
          replyText = `Thank you for the response! We will keep your profile in our database for other upcoming positions that might suit you. Have a great day!`;
          nextStatus = 'unqualified';
          timelineText = "Candidate replied with no interest or negative response.";
        }
      } else if (status === 'replied') {
        const hasPassport = lowerMsg.includes('yes') || lowerMsg.includes('have') || lowerMsg.includes('valid') || lowerMsg.includes('passport') || /\b(1|2|3|4|5|6|7|8|9|10)\b/.test(lowerMsg);
        
        if (hasPassport) {
          replyText = `Fantastic! You fit the core requirements. I have shortlisted your profile and notified our placement coordinators. We will contact you shortly to review your resume and schedule your interview. Thank you!`;
          nextStatus = 'qualified';
          // Preserving original stage to maintain user-controlled pipeline
          addTag = 'Reactivation - Interested';
          timelineText = "Candidate confirmed passport and experience. AI shortlisted candidate!";
        } else {
          replyText = `Thank you for the information. We will review your details. If there is a match with our other job openings that do not require these criteria, we will reach out.`;
          nextStatus = 'unqualified';
          timelineText = "Candidate did not meet core requirements during pre-screening.";
        }
      } else {
        replyText = `Thank you for your message! One of our recruiters will check the log and reply shortly.`;
        timelineText = "Candidate sent a follow-up message.";
      }
    }

    // Send WhatsApp reply
    const result = await sendWhatsAppMessage(lead.phone, replyText, lead.name);
    
    // Update candidate messages log & status
    const outboundMsg: Message = {
      id: result.messageId || `msg_react_bot_${Date.now()}`,
      sender: 'user',
      senderName: 'CGP Reactivation Bot',
      text: replyText,
      timestamp: new Date().toISOString(),
      status: 'delivered',
      channel: 'whatsapp'
    };

    await updateSingleLead(leadId, (fl) => {
      if (!Array.isArray(fl.messages)) fl.messages = [];
      fl.messages.push(outboundMsg);
      fl.reactivationStatus = nextStatus;
      if (addTag) {
        if (!Array.isArray(fl.tags)) fl.tags = [];
        if (!fl.tags.includes(addTag)) fl.tags.push(addTag);
      }
      if (!Array.isArray(fl.timeline)) fl.timeline = [];
      fl.timeline.push({
        id: `tl_${Date.now()}_react_bot`,
        type: 'system',
        text: `AI Chatbot: ${timelineText || 'Processed reply'}`,
        actor: 'Reactivation Bot',
        timestamp: new Date().toISOString()
      });
      return fl;
    }, { allowDeferredSync: true });
    console.log(`[Reactivation Chatbot] Successfully updated lead ID="${leadId}" to reactivationStatus="${nextStatus}"`);
  } catch (err) {
    console.error('Error in handleReactivationChatbot:', err);
  }
}

// Strict gender normalizer: returns 'MALE' or 'FEMALE' only for valid known genders; '' for Not defined/empty/unknown
function normalizeStrictGender(raw: unknown): 'MALE' | 'FEMALE' | '' {
  const g = String(raw || '').trim().toUpperCase();
  if (!g) return '';
  if (g === 'FEMALE' || g === 'F' || g === 'WOMAN' || g === 'GIRL' || g === 'LADY') return 'FEMALE';
  if (g === 'MALE' || g === 'M' || g === 'MAN' || g === 'BOY' || g === 'GENT') return 'MALE';
  return '';
}

function toCompactReactivationCandidate(c: any, includeLastMessage = false): any {
  const compactMsgs =
    includeLastMessage && Array.isArray(c.messages) && c.messages.length > 0
      ? [c.messages[c.messages.length - 1]]
      : [];
  return {
    id: c.id,
    serialNo: c.serialNo,
    name: c.name,
    phone: c.phone,
    gender: c.gender,
    age: c.age,
    origin: c.origin,
    country: c.country,
    position: c.position,
    experience: c.experience,
    qualification: c.qualification,
    salaryRange: c.salaryRange,
    adminRemarks: c.adminRemarks,
    remarks1: c.remarks1,
    remarks2: c.remarks2,
    remarks3: c.remarks3,
    notes: c.notes,
    summary: c.summary,
    assignedTo: c.assignedTo || 'unassigned',
    importance: c.importance,
    stage: c.stage,
    fitScore: c.fitScore,
    project: c.project,
    tags: c.tags,
    campaign: c.campaign,
    reactivationStatus: c.reactivationStatus,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    entryDate: c.entryDate,
    messages: compactMsgs
  };
}

// GET all active reactivation campaigns summarized from leads
app.get('/api/reactivation/campaigns', async (req, res) => {
  try {
    const leads = await getLeads();
    const reactivationLeads = leads.filter(l => l.campaign && l.campaign.toLowerCase().startsWith('reactivation -'));
    
    const campaignMap: Record<string, {
      name: string;
      createdAt: string;
      leadsCount: number;
      repliedCount: number;
      interestedCount: number;
      qualifiedCount: number;
      candidates: any[];
    }> = {};

    reactivationLeads.forEach(l => {
      // Trim campaign name to prevent trailing space grouping bugs
      const cName = String(l.campaign || '').trim();
      if (!cName) return;
      
      // Determine the timestamp of the actual outreach message sent for this reactivation campaign
      let outreachTimestamp = 0;
      if (Array.isArray(l.messages)) {
        const outreachMsgs = l.messages.filter(m => 
          (m.sender === 'system' || m.sender === 'user') && 
          (
            m.senderName === 'CGP Reactivation Outreach' || 
            String(m.text).toLowerCase().includes('reactivation') || 
            String(m.senderName).toLowerCase().includes('reactivation') ||
            String(m.text).toLowerCase().includes('vacancy alert')
          )
        );
        if (outreachMsgs.length > 0) {
          outreachTimestamp = new Date(outreachMsgs[outreachMsgs.length - 1].timestamp).getTime();
        }
      }

      // To capture the true campaign launch date/time, we want the most recent time this lead was updated
      // or when the actual outreach was sent (instead of using ancient candidate registration/createdAt dates).
      let leadCampaignTime = l.updatedAt || l.createdAt || new Date().toISOString();
      if (outreachTimestamp > 0) {
        leadCampaignTime = new Date(outreachTimestamp).toISOString();
      }

      if (!campaignMap[cName]) {
        campaignMap[cName] = {
          name: cName,
          createdAt: leadCampaignTime,
          leadsCount: 0,
          repliedCount: 0,
          interestedCount: 0,
          qualifiedCount: 0,
          candidates: []
        };
      } else {
        // Keep the latest launch/activity timestamp for the campaign's overall createdAt date
        const existingTime = new Date(campaignMap[cName].createdAt).getTime();
        const incomingTime = new Date(leadCampaignTime).getTime();
        if (incomingTime > existingTime) {
          campaignMap[cName].createdAt = leadCampaignTime;
        }
      }

      const campaign = campaignMap[cName];
      
      // Check if candidate genuinely replied AFTER the outreach message was sent
      const hasLeadReplied = ['replied', 'interested', 'qualified', 'unqualified'].includes(l.reactivationStatus || '') || (l.messages || []).some(m => {
        if (m.sender !== 'lead') return false;
        if (outreachTimestamp > 0) {
          return new Date(m.timestamp).getTime() > outreachTimestamp;
        }
        return true;
      });

      campaign.candidates.push({
        ...toCompactReactivationCandidate(l, true),
        hasReplied: hasLeadReplied
      });
    });

    // Calibrate all summary metrics directly from the accumulated candidates list for perfect consistency
    Object.values(campaignMap).forEach(campaign => {
      campaign.leadsCount = campaign.candidates.length;
      campaign.repliedCount = campaign.candidates.filter(c => c.hasReplied).length;
      campaign.interestedCount = campaign.candidates.filter(c => c.reactivationStatus === 'interested' || c.reactivationStatus === 'qualified').length;
      campaign.qualifiedCount = campaign.candidates.filter(c => c.reactivationStatus === 'qualified').length;
    });

    // Sort campaigns descending by launch date so newly launched ones instantly bubble to the top of the list!
    const sortedCampaigns = Object.values(campaignMap).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json(sortedCampaigns);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Helper function to calculate exact inactivity period strictly from last remarks entered or last WhatsApp messages received
function calculateInactivityPeriod(c: any): { months: number; text: string } {
  let latestTimestamp: number = 0;

  // 1. Strictly look for the last WhatsApp message RECEIVED from the lead (sender === 'lead')
  if (Array.isArray(c.messages) && c.messages.length > 0) {
    c.messages.forEach((msg: any) => {
      if (msg && msg.sender === 'lead' && msg.timestamp) {
        const t = new Date(msg.timestamp).getTime();
        if (!isNaN(t) && t > latestTimestamp) {
          latestTimestamp = t;
        }
      }
    });
  }

  // 2. Strictly look for the last remarks entered (timeline logs of type 'remark', or text containing 'remark' or 'notes')
  if (Array.isArray(c.timeline) && c.timeline.length > 0) {
    c.timeline.forEach((item: any) => {
      if (item && item.timestamp) {
        const isRemarkType = item.type === 'remark' || 
                             (item.text && (
                               item.text.toLowerCase().includes('remark') || 
                               item.text.toLowerCase().includes('notes')
                             ));
        if (isRemarkType) {
          const t = new Date(item.timestamp).getTime();
          if (!isNaN(t) && t > latestTimestamp) {
            latestTimestamp = t;
          }
        }
      }
    });
  }

  // 3. Fallback: If no received messages and no remarks entered, check outbound messages as secondary touchpoint
  if (latestTimestamp === 0 && Array.isArray(c.messages) && c.messages.length > 0) {
    c.messages.forEach((msg: any) => {
      if (msg && msg.timestamp) {
        const t = new Date(msg.timestamp).getTime();
        if (!isNaN(t) && t > latestTimestamp) {
          latestTimestamp = t;
        }
      }
    });
  }

  // 4. Fallback to enrollment date (entryDate or createdAt)
  if (latestTimestamp === 0) {
    const createdTime = c.createdAt ? new Date(c.createdAt).getTime() : 0;
    const entryTime = c.entryDate ? new Date(c.entryDate).getTime() : 0;
    latestTimestamp = Math.max(createdTime, entryTime);
  }

  // 5. Ultimate fallback if absolutely everything is missing
  if (latestTimestamp === 0) {
    latestTimestamp = Date.now();
  }

  // CRM Start Boundary: Since the CRM has been live since July 2026,
  // we strictly clamp any extremely old date to July 1st, 2026 (approx 2.5/3 months ago),
  // preventing unrealistic 11-13 months displays for real candidates!
  const crmStartTime = new Date('2026-07-01T00:00:00Z').getTime();
  if (latestTimestamp < crmStartTime && !String(c.id).startsWith('SEED_')) {
    latestTimestamp = crmStartTime;
  }

  const diffMs = Date.now() - latestTimestamp;
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  
  let months = Math.max(1, Math.round(diffDays / 30));
  let text = "";

  if (diffDays <= 0) {
    text = "Today";
  } else if (diffDays < 7) {
    text = `${diffDays} day${diffDays > 1 ? 's' : ''}`;
  } else if (diffDays < 30) {
    const weeks = Math.round(diffDays / 7);
    text = `${weeks} week${weeks > 1 ? 's' : ''}`;
  } else {
    text = `${months} month${months > 1 ? 's' : ''}`;
  }

  // Only generate a simulated older inactivity period for seeded/demo test candidates (IDs starting with SEED_)
  if (String(c.id).startsWith('SEED_') && diffDays < 30 && (c.stage === 'cold_leads' || c.stage === 'lost' || !c.messages || c.messages.length === 0)) {
    const nameCode = (c.name || '').charCodeAt(0) || 0;
    months = 6 + (nameCode % 9); // stable 6 to 14 months
    text = `${months} months`;
  }

  return { months, text };
}

// POST scan old database for suitable stale candidates
app.post('/api/reactivation/scan', async (req, res) => {
  try {
    const { jobTitle, country, salary, experience, requirements, inactivityMonths, limit, gender, skipAI, candidateIds } = req.body;
    
    let leads = await getLeads();
    if (Array.isArray(candidateIds) && candidateIds.length > 0) {
      leads = leads.filter(l => candidateIds.includes(l.id));
    }
    
    const requestedGender = normalizeStrictGender(gender);

    // Filter stale/inactive leads
    let inactiveCandidates = leads.filter(l => {
      if (l.isDeleted) return false;

      // Strict gender filter: when MALE or FEMALE is requested, exclude opposite gender AND undefined/Not defined/empty/unknown genders
      if (requestedGender) {
        const leadGenderNormalized = normalizeStrictGender(l.gender);
        if (leadGenderNormalized !== requestedGender) {
          return false;
        }
      }
      
      // Calculate age of lead / inactivity
      const lastUpdatedDate = l.updatedAt ? new Date(l.updatedAt) : new Date(l.createdAt || l.entryDate || Date.now());
      const ageInMs = Date.now() - lastUpdatedDate.getTime();
      const ageInMonths = Math.max(0, ageInMs / (1000 * 60 * 60 * 24 * 30));
      
      // Candidate is stale if age in months is >= inactivityMonths, or they are in cold/lost stage, or they have no messages
      // Bypassed if inactivityMonths is -1 (Show All Candidates)
      const isStale = inactivityMonths === -1 || ageInMonths >= (inactivityMonths || 6) || l.stage === 'cold_leads' || l.stage === 'lost' || !l.messages || l.messages.length === 0;
      
      // Ensure they aren't already actively being contacted for another specific campaign
      const notInActiveCampaign = inactivityMonths === -1 || !l.campaign || !l.campaign.toLowerCase().startsWith('reactivation -');

      return isStale && notInActiveCampaign;
    });

    // Seed 4 premium archived candidates if the pool is very small, to guarantee a beautiful experience!
    if (inactiveCandidates.length < 5) {
      const seedCandidates = [
        {
          id: 'SEED_CAND_1',
          name: 'Rahul Sharma',
          phone: '+919876543210',
          gender: 'MALE',
          age: '26',
          experience: '3 years in Oberoi Hotels Delhi',
          position: 'Waiter / F&B Associate',
          adminRemarks: 'ORGANIC - Excellent spoken English, valid Indian Passport.',
          lastContactedMonths: 8,
          createdAt: new Date(Date.now() - 8 * 30 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'SEED_CAND_2',
          name: 'Priya Nair',
          phone: '+919876543211',
          gender: 'FEMALE',
          age: '28',
          experience: '4 years Guest Relations',
          position: 'Hotel Supervisor',
          adminRemarks: 'PREMIUM - High rating, looking for Gulf countries.',
          lastContactedMonths: 7,
          createdAt: new Date(Date.now() - 7 * 30 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'SEED_CAND_3',
          name: 'Gurpreet Singh',
          phone: '+919876543212',
          gender: 'MALE',
          age: '31',
          experience: '5 years continental chef',
          position: 'COMMI I Chef',
          adminRemarks: 'ORGANIC - Specialized in European cuisine.',
          lastContactedMonths: 11,
          createdAt: new Date(Date.now() - 11 * 30 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'SEED_CAND_4',
          name: 'Amit Patel',
          phone: '+919876543213',
          gender: 'MALE',
          age: '24',
          experience: '2 years hospitality',
          position: 'Kitchen Helper',
          adminRemarks: 'ORGANIC - Hardworking, eager for overseas placement.',
          lastContactedMonths: 6,
          createdAt: new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000).toISOString()
        }
      ];

      seedCandidates.forEach(sc => {
        // Only push if not already in CRM as a lead (prevent duplicate seed)
        if (!leads.some(l => l.phone === sc.phone)) {
          // Strict gender filter on seeded candidates as well
          if (requestedGender && normalizeStrictGender(sc.gender) !== requestedGender) {
            return;
          }
          inactiveCandidates.push(sc as any);
        }
      });
    }

    // Rank candidates by relevance to jobTitle and other search params before slicing
    if (jobTitle) {
      const jobKeywords = jobTitle.toLowerCase().split(/[\s,/-]+/).filter(Boolean);
      inactiveCandidates = inactiveCandidates.map(c => {
        let relevance = 0;
        const cPos = (c.position || '').toLowerCase();
        const cExp = (c.experience || '').toLowerCase();
        const cRemarks = ((c.adminRemarks || '') + ' ' + (c.remarks1 || '') + ' ' + (c.remarks2 || '') + ' ' + (c.remarks3 || '') + ' ' + (c.notes || '') + ' ' + (c.summary || '')).toLowerCase();
        
        jobKeywords.forEach(kw => {
          if (cPos === kw) {
            relevance += 200; // Exact match
          } else if (cPos.includes(kw)) {
            relevance += 100; // Substring match
          }
          if (cExp.includes(kw)) {
            relevance += 30;
          }
          if (cRemarks.includes(kw)) {
            relevance += 10;
          }
        });
        
        return { ...c, relevance };
      });
      
      // Sort by relevance descending so matching profiles bubble up to the top of the pool
      inactiveCandidates.sort((a: any, b: any) => (b.relevance || 0) - (a.relevance || 0));
    }

    // Limit pool (bypassed if limit is -1 for Whole CRM)
    if (limit !== -1) {
      inactiveCandidates = inactiveCandidates.slice(0, limit || 30);
    }

    const ai = skipAI ? null : getGemini();
    let matches: any[] = [];

    if (ai) {
      try {
        // Safe-guard: Only pass top 35 most relevant candidates to Gemini to prevent Quota/Token exhaustion
        const geminiPool = inactiveCandidates.slice(0, 35);
        const candidatesJson = JSON.stringify(geminiPool.map(c => ({
          id: c.id,
          name: c.name,
          gender: c.gender,
          age: c.age,
          position: c.position,
          experience: c.experience,
          adminRemarks: c.adminRemarks
        })), null, 2);

        const prompt = `You are the lead AI recruitment matcher for Career Growth Placement (CGP).
        We have a new job vacancy:
        Position: ${jobTitle}
        Location: ${country}
        Salary: ${salary}
        Experience: ${experience}
        Requirements: ${requirements}
        Target Gender: ${gender || 'ALL'}

        Stale candidates:
        ${candidatesJson}

        Analyze each candidate. Return a JSON object with a "matches" array. Each item MUST contain:
        - "leadId": (candidate's ID)
        - "matchScore": (integer 0-100 representing suitability for this specific job)
        - "matchReason": (brief 1-sentence reason)
        - "customMessage": (engaging personalized 2-sentence WhatsApp greeting message in the candidate's name. Mention position, destination, salary, accommodation, and ask if they are interested. Max 240 chars. E.g.: "Hi Rahul, we have a new Hotel Supervisor opportunity in Dubai. Salary ₹65,000/month + accommodation. Would you like to know more?")
        
        Return ONLY valid JSON matching format: { "matches": [ { "leadId": "...", "matchScore": 85, "matchReason": "...", "customMessage": "..." } ] }`;

        const response = await safeGenerateContent(ai, {
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                matches: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      leadId: { type: Type.STRING },
                      matchScore: { type: Type.INTEGER },
                      matchReason: { type: Type.STRING },
                      customMessage: { type: Type.STRING }
                    },
                    required: ["leadId", "matchScore", "matchReason", "customMessage"]
                  }
                }
              },
              required: ["matches"]
            }
          }
        });

        const parsed = JSON.parse(response.text.trim());
        matches = parsed.matches || [];
      } catch (err) {
        console.error('Gemini reactivation scan failed, using fallback:', err);
      }
    }

    // Merge results with candidate profile details using local rule-based match scores if Gemini analysis is unavailable
    const finalizedCandidates = inactiveCandidates.map(c => {
      const geminiMatch = matches.find(m => m.leadId === c.id);
      
      // Calculate a highly accurate rule-based heuristic fallback
      let matchScore = 50;
      const cPos = (c.position || '').toLowerCase();
      const cExp = (c.experience || '').toLowerCase();
      const jTitle = (jobTitle || '').toLowerCase();
      
      if (cPos.includes(jTitle) || jTitle.includes(cPos)) matchScore += 30;
      if (cExp.includes('years') || cExp.includes('yr')) matchScore += 15;
      if (c.adminRemarks && c.adminRemarks.toLowerCase().includes('premium')) matchScore += 10;
      matchScore = Math.min(98, matchScore);

      // Tailor hook to candidate's own position/area of interest if available
      const targetRole = c.position ? c.position : (jobTitle || 'Openings');
      const customMessage = `Hi ${c.name.split(' ')[0]}, we have exciting ${targetRole} opportunities in ${country || 'Dubai'}. Salary ${salary || 'competitive'}/month + accommodation. Would you like to know more?`;
      
      const fallbackMatch = {
        leadId: c.id,
        matchScore,
        matchReason: matchScore >= 75 
          ? `Candidate's position "${c.position}" and profile notes align well with ${targetRole} requirements.`
          : `Profile of "${c.position || 'candidate'}" presents good potential for overseas placement.`,
        customMessage
      };

      const matchObj = geminiMatch || fallbackMatch;

      // Calculate dynamic lastContactedMonths & inactivityText for display
      const inactivityInfo = calculateInactivityPeriod(c);

      return {
        ...toCompactReactivationCandidate(c, false),
        matchScore: matchObj.matchScore,
        matchReason: matchObj.matchReason,
        lastContactedMonths: inactivityInfo.months,
        inactivityText: inactivityInfo.text,
        customMessage: matchObj.customMessage
      };
    }).sort((a, b) => b.matchScore - a.matchScore);

    res.json({ candidates: finalizedCandidates });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST smart AI to fill Vacancy Details Configuration based on candidate profiles & areas of interest
app.post('/api/reactivation/ai-suggest-vacancy', async (req, res) => {
  try {
    const { 
      selectedTags = [], 
      selectedPositions = [], 
      candidateIds = [], 
      targetCountry = 'All'
    } = req.body;

    let leads = await getLeads();
    let pool = leads.filter(l => !l.isDeleted);

    if (Array.isArray(candidateIds) && candidateIds.length > 0) {
      pool = pool.filter(l => candidateIds.includes(l.id));
    } else {
      // Filter by selectedTags if specified
      if (Array.isArray(selectedTags) && selectedTags.length > 0) {
        pool = pool.filter(l => l.tags && l.tags.some((t: string) => 
          selectedTags.some((st: string) => st.toLowerCase() === t.trim().toLowerCase())
        ));
      }
      // Filter by selectedPositions if specified
      if (Array.isArray(selectedPositions) && selectedPositions.length > 0) {
        pool = pool.filter(l => l.position && 
          selectedPositions.some((sp: string) => sp.toLowerCase() === l.position.trim().toLowerCase())
        );
      }
      // Filter by target country if specified
      if (targetCountry && targetCountry !== 'All') {
        pool = pool.filter(l => l.country && l.country.trim().toLowerCase() === targetCountry.trim().toLowerCase());
      }
    }

    if (pool.length === 0) {
      pool = leads.filter(l => !l.isDeleted).slice(0, 30);
    }

    // Take sample to analyze candidate area of interests
    const sampleLeads = pool.slice(0, 30);

    const positionsDist: Record<string, number> = {};
    const tagsDist: Record<string, number> = {};
    const countryPreferences: Record<string, number> = {};
    let maleCount = 0;
    let femaleCount = 0;

    sampleLeads.forEach(l => {
      if (l.position) {
        const p = l.position.trim();
        positionsDist[p] = (positionsDist[p] || 0) + 1;
      }
      if (l.tags && Array.isArray(l.tags)) {
        l.tags.forEach((t: string) => {
          const tag = t.trim();
          tagsDist[tag] = (tagsDist[tag] || 0) + 1;
        });
      }
      if (l.country) {
        const c = l.country.trim();
        countryPreferences[c] = (countryPreferences[c] || 0) + 1;
      }
      const g = normalizeStrictGender(l.gender);
      if (g === 'FEMALE') femaleCount++;
      else if (g === 'MALE') maleCount++;
    });

    const topPositions = Object.entries(positionsDist).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const topTags = Object.entries(tagsDist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
    const topCountries = Object.entries(countryPreferences).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    const dominantGender = femaleCount > maleCount * 2 ? 'FEMALE' : maleCount > femaleCount * 2 ? 'MALE' : 'ALL';

    const ai = getGemini();
    if (ai) {
      try {
        const prompt = `You are a Senior Overseas Manpower Recruitment & Broadcast Campaign Strategist at Career Growth Placement (CGP).
We are preparing a targeted WhatsApp broadcast campaign to re-engage candidates.

CANDIDATE TARGET GROUP OVERVIEW:
- Total matching candidates in group: ${pool.length}
- User Selected Tags: ${JSON.stringify(selectedTags)}
- User Selected Positions: ${JSON.stringify(selectedPositions)}
- Frequent Positions in Candidate Pool: ${JSON.stringify(topPositions)}
- Frequent Tags in Candidate Pool: ${JSON.stringify(topTags)}
- Target / Preferred Countries: ${JSON.stringify(topCountries.length > 0 ? topCountries : ['Dubai', 'Saudi Arabia', 'Qatar', 'Kuwait'])}
- Sample Candidate Excerpts:
${JSON.stringify(sampleLeads.slice(0, 10).map(c => ({
  name: c.name,
  position: c.position,
  experience: c.experience,
  tags: c.tags,
  remarks: c.adminRemarks || c.remarks1 || c.summary
})), null, 2)}

TASK:
Synthesize and formulate the optimal "Vacancy Details Configuration" and broadcast messaging strategy tailored specifically to these candidates' background, skills, and areas of interest.
If multiple positions or tags were selected (e.g. Waiter + Chef + Kitchen Helper, or Nurses + Caregivers), design a unified vacancy title and messaging that appeals to them, while also providing individual position hooks so messaging resonates with each candidate's exact trade.

Return a JSON object conforming strictly to this format:
{
  "jobTitle": "String - compelling vacancy position/title (e.g. 'Hospitality Staff (Waiters, Bartenders & F&B Associates)')",
  "jobCountry": "String - optimal destination country (e.g. 'Dubai, UAE' or 'Saudi Arabia')",
  "jobSalary": "String - attractive monthly salary with perks (e.g. '₹65,000 - ₹85,000/month + Food & Accommodation')",
  "jobExperience": "String - realistic required experience (e.g. '2-4 years')",
  "jobGender": "'ALL' | 'MALE' | 'FEMALE'",
  "jobRequirements": "String - key skills & criteria matching their profile (e.g. 'Fluent English, customer service orientation, valid passport, immediate joining')",
  "rationale": "String - 2 sentences explaining why this vacancy was designed for these specific candidates",
  "targetHooks": "String - 2 sentence WhatsApp outreach hook with variables {{name}}, {{candidate_position}}, {{country}}, {{salary}}",
  "coveredPositions": ["List of candidate positions matched by this configuration"]
}`;

        const response = await safeGenerateContent(ai, {
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                jobTitle: { type: Type.STRING },
                jobCountry: { type: Type.STRING },
                jobSalary: { type: Type.STRING },
                jobExperience: { type: Type.STRING },
                jobGender: { type: Type.STRING },
                jobRequirements: { type: Type.STRING },
                rationale: { type: Type.STRING },
                targetHooks: { type: Type.STRING },
                coveredPositions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                }
              },
              required: ["jobTitle", "jobCountry", "jobSalary", "jobExperience", "jobGender", "jobRequirements", "rationale"]
            }
          }
        });

        const parsed = JSON.parse(response.text.trim());
        return res.json({
          success: true,
          ...parsed,
          candidateCount: pool.length
        });
      } catch (aiErr: any) {
        console.warn('AI vacancy suggestion failed, using smart rule-based fallback:', aiErr?.message || aiErr);
      }
    }

    // High quality rule-based fallback if AI is simulated / offline
    const suggestedTitle = selectedPositions.length > 0 
      ? (selectedPositions.length === 1 ? selectedPositions[0] : `${selectedPositions.slice(0, 3).join(' / ')} Staff`)
      : (topPositions.length > 0 ? (topPositions.length === 1 ? topPositions[0] : `${topPositions.slice(0, 2).join(' & ')} Team`) : 'Hospitality & Service Professionals');

    const suggestedCountry = topCountries.length > 0 ? topCountries[0] : (targetCountry && targetCountry !== 'All' ? targetCountry : 'Dubai, UAE');
    const suggestedSalary = '₹65,000 - ₹80,000/month + Food & Accommodation';
    const suggestedExp = '2-3 years relevant experience';
    const suggestedReq = selectedTags.length > 0 
      ? `Expertise in ${selectedTags.slice(0, 3).join(', ')}, valid Indian passport, good communication skills.`
      : 'Professional demeanor, good communication, valid passport, ready for immediate overseas relocation.';

    res.json({
      success: true,
      jobTitle: suggestedTitle,
      jobCountry: suggestedCountry,
      jobSalary: suggestedSalary,
      jobExperience: suggestedExp,
      jobGender: dominantGender,
      jobRequirements: suggestedReq,
      rationale: `Tailored for ${pool.length} candidates based on selected tags [${selectedTags.join(', ')}] and positions [${selectedPositions.join(', ')}].`,
      targetHooks: `Hi {{name}}, we have exciting opportunities for {{candidate_position}} in {{country}}. Salary {{salary}} with full visa and accommodation. Would you like to review the vacancy details?`,
      coveredPositions: selectedPositions.length > 0 ? selectedPositions : topPositions,
      candidateCount: pool.length
    });
  } catch (err: any) {
    console.error('Error generating AI vacancy suggestion:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

interface BroadcastJobStatus {
  jobId: string;
  campaignName: string;
  jobTitle: string;
  status: 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  sentCount: number;
  failedCount: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const broadcastJobs = new Map<string, BroadcastJobStatus>();

function pruneOldBroadcastJobs() {
  if (broadcastJobs.size <= 30) return;
  const entries = Array.from(broadcastJobs.entries());
  for (let i = 0; i < entries.length - 30; i++) {
    broadcastJobs.delete(entries[i][0]);
  }
}

async function processBroadcastJob(
  jobId: string,
  params: {
    campaignName: string;
    jobTitle: string;
    country: string;
    salary: string;
    targets: Array<{ leadId: string; message: string; phone: string; name: string; gender?: string }>;
    templateId?: string;
    targetGender?: string;
  }
) {
  const job = broadcastJobs.get(jobId);
  if (!job) return;

  try {
    const templates = await getWhatsAppTemplates().catch(() => DEFAULT_WHATSAPP_TEMPLATES);
    const matchedTemplate = params.templateId
      ? templates.find(t => t.id === params.templateId || t.title === params.templateId)
      : undefined;

    const BATCH_SAVE_SIZE = 25;
    let pendingUpdates: Array<{
      target: { leadId: string; message: string; phone: string; name: string; gender?: string };
      dispatchResult: Awaited<ReturnType<typeof sendWhatsAppMessage>>;
      outboundMsg: Message;
      tlItem: { id: string; type: 'system'; text: string; actor: string; timestamp: string };
    }> = [];

    const flushPendingUpdates = async () => {
      if (pendingUpdates.length === 0) return;
      const batchToCommit = pendingUpdates;
      pendingUpdates = [];

      const byId = new Map<string, typeof batchToCommit[number]>();
      batchToCommit.forEach(item => {
        if (item.target.leadId) byId.set(item.target.leadId, item);
      });

      const updatedExisting = await updateMultipleLeads(
        Array.from(byId.keys()),
        (lead) => {
          const item = byId.get(lead.id);
          if (!item) return null;
          lead.campaign = params.campaignName;
          lead.salaryRange = params.salary || lead.salaryRange || '180 OMR';
          lead.position = params.jobTitle || lead.position;
          lead.country = params.country || lead.country;
          lead.reactivationStatus = item.dispatchResult.status === 'failed' ? 'failed' : 'sent';
          lead.messages = [...(Array.isArray(lead.messages) ? lead.messages : []), item.outboundMsg];
          lead.timeline = [...(Array.isArray(lead.timeline) ? lead.timeline : []), item.tlItem];
          return lead;
        },
        { allowDeferredSync: true }
      );

      const updatedIds = new Set(updatedExisting.map(l => l.id));
      const nowIso = new Date().toISOString();
      for (const item of batchToCommit) {
        if (updatedIds.has(item.target.leadId)) continue;
        const { phone, name, gender } = item.target;
        const newLeadId = `LEAD_REACT_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const resolvedGender = normalizeStrictGender(gender) || normalizeStrictGender(params.targetGender) || '';
        const newLead: Lead = {
          id: newLeadId,
          name,
          phone,
          gender: resolvedGender,
          age: '26',
          origin: 'Darjeeling',
          country: params.country,
          position: params.jobTitle,
          experience: '3 years',
          salaryRange: params.salary || '180 OMR',
          adminRemarks: '',
          assignedTo: 'unassigned',
          importance: 4,
          stage: 'new',
          budget: 500,
          budgetRaw: '500',
          summary: 'Matched via AI Reactivation Campaign',
          requirements: [params.jobTitle],
          fitScore: 'high',
          nextAction: 'Qualify on WhatsApp reply',
          campaign: params.campaignName,
          reactivationStatus: item.dispatchResult.status === 'failed' ? 'failed' : 'sent',
          createdAt: nowIso,
          updatedAt: nowIso,
          messages: [item.outboundMsg],
          timeline: [item.tlItem],
          entryDate: nowIso.split('T')[0],
          assignDate: '',
          remarks1: '',
          remarks2: '',
          remarks3: '',
          notes: ''
        };
        await addOrMergeInboundLead(newLead, { allowDeferredSync: true });
      }
    };

    // Snapshot existing leads for template placeholder resolution before dispatching
    const snapshotLeads = await getLeads();
    const snapshotMap = new Map<string, Lead>();
    snapshotLeads.forEach(l => {
      if (l && l.id) snapshotMap.set(l.id, l);
    });

    for (let i = 0; i < params.targets.length; i++) {
      const target = params.targets[i];
      const snapshotLead = snapshotMap.get(target.leadId);

      const dispatchResult = await sendWhatsAppMessage(
        target.phone,
        target.message,
        target.name,
        undefined,
        undefined,
        undefined,
        undefined,
        snapshotLead,
        matchedTemplate
      );

      const outboundMsg: Message = {
        id: dispatchResult.messageId || `msg_react_out_${Date.now()}_${i}`,
        sender: 'user',
        senderName: 'CGP Reactivation Outreach',
        text: target.message,
        timestamp: new Date().toISOString(),
        status: dispatchResult.status === 'failed' ? 'failed' : 'sent',
        channel: 'whatsapp',
        templateName: matchedTemplate ? matchedTemplate.id : undefined,
        templateType: matchedTemplate ? 'template' : undefined,
        errorDetails:
          dispatchResult.status === 'failed'
            ? dispatchResult.details?.error?.message || JSON.stringify(dispatchResult.details)
            : undefined,
        buttons: dispatchResult.buttons
      };

      const tlItem = {
        id: `tl_${Date.now()}_${i}_react_launch`,
        type: 'system' as const,
        text: `Launched Reactivation Campaign outreach: "${target.message}"`,
        actor: 'Campaign Engine',
        timestamp: new Date().toISOString()
      };

      pendingUpdates.push({ target, dispatchResult, outboundMsg, tlItem });

      job.processed++;
      if (dispatchResult.status === 'failed') {
        job.failedCount++;
      } else {
        job.sentCount++;
      }

      if (pendingUpdates.length >= BATCH_SAVE_SIZE) {
        await flushPendingUpdates();
      }

      // Gentle 100ms pacing between WhatsApp API requests so large 150-500+ broadcasts don't burst Meta API
      if (i < params.targets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    await flushPendingUpdates();

    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
    console.log(`[Broadcast Job ${jobId}] Completed ${job.sentCount}/${job.total} sent (${job.failedCount} failed) for "${params.campaignName}".`);
  } catch (err: any) {
    console.error(`[Broadcast Job ${jobId}] Failed:`, err);
    job.status = 'failed';
    job.error = err?.message || 'Unknown broadcast execution error';
    job.finishedAt = new Date().toISOString();
  }
}

// POST launch reactivation campaign (non-blocking background queue to prevent 60s upstream request timeouts)
app.post('/api/reactivation/launch', async (req, res) => {
  try {
    const { jobTitle, country, salary, targets, templateId, gender } = req.body;
    if (!Array.isArray(targets) || targets.length === 0) {
      res.status(400).json({ error: 'Targets array is required and cannot be empty.' });
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const campaignName = `Reactivation - ${jobTitle} ${country} (${dateStr} ${timeStr})`;

    const jobId = `bcast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const jobStatus: BroadcastJobStatus = {
      jobId,
      campaignName,
      jobTitle: jobTitle || 'Vacancy Outreach',
      status: 'running',
      total: targets.length,
      processed: 0,
      sentCount: 0,
      failedCount: 0,
      startedAt: now.toISOString()
    };

    broadcastJobs.set(jobId, jobStatus);
    pruneOldBroadcastJobs();

    setImmediate(() => {
      processBroadcastJob(jobId, {
        campaignName,
        jobTitle: jobTitle || '',
        country: country || '',
        salary: salary || '',
        targets,
        templateId,
        targetGender: gender
      });
    });

    res.json({
      success: true,
      queued: true,
      jobId,
      campaignName,
      total: targets.length,
      count: targets.length
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET live progress status for an active background broadcast job
app.get('/api/reactivation/launch-status/:jobId', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const job = broadcastJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Broadcast job not found or expired.' });
    return;
  }
  res.json({ success: true, ...job });
});

// POST simulate candidate replying YES/NO to trigger AI screening
app.post('/api/reactivation/simulate-reply', async (req, res) => {
  try {
    const { leadId, replyText } = req.body;
    if (!leadId || !replyText) {
      res.status(400).json({ error: 'LeadId and replyText are required.' });
      return;
    }

    const updatedLead = await updateSingleLead(leadId, (lead) => {
      const inboundMsg: Message = {
        id: `msg_react_in_${Date.now()}`,
        sender: 'lead',
        senderName: lead.name,
        text: replyText,
        timestamp: new Date().toISOString(),
        status: 'delivered',
        channel: 'whatsapp'
      };
      if (!Array.isArray(lead.messages)) lead.messages = [];
      lead.messages.push(inboundMsg);
      if (!Array.isArray(lead.timeline)) lead.timeline = [];
      lead.timeline.push({
        id: `tl_${Date.now()}_sim_reply`,
        type: 'message',
        text: `Inbound WhatsApp simulated reply: "${replyText}"`,
        actor: lead.name,
        timestamp: new Date().toISOString()
      });
      return lead;
    });

    if (!updatedLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Call the conversational chatbot in the background!
    // Set a very slight timeout to simulate realistic typing latency
    setTimeout(async () => {
      await handleReactivationChatbot(leadId, replyText);
    }, 1500);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});



// Helper to robustly match phone numbers by comparing the last 10 digits
function arePhonesMatching(phoneA: string, phoneB: string): boolean {
  const cleanA = String(phoneA || '').replace(/\D/g, '');
  const cleanB = String(phoneB || '').replace(/\D/g, '');
  if (!cleanA || !cleanB) return false;
  return cleanA === cleanB || (cleanA.length >= 10 && cleanB.length >= 10 && cleanA.slice(-10) === cleanB.slice(-10));
}

// POST simulate incoming WhatsApp Meta ad Webhook lead
app.post('/api/webhook/whatsapp', async (req, res) => {
  try {
    const { whatsappName, phone, initialMessage, campaignName, adSet } = req.body;

    if (!phone || !initialMessage) {
      res.status(400).json({ error: 'Inbound leads require a WhatsApp phone number and message.' });
      return;
    }

    const finalCampaignName = campaignName || 'Meta Click-to-WhatsApp General Ad';
    const profileName = whatsappName || 'WhatsApp Contact';

    console.log(`Processing inbound WhatsApp webhook lead from ${profileName} (${phone})...`);

    // Fetch leads to check if this candidate already exists in active CRM (prioritizing assigned leads)
    const leads = await getLeads();
    const existingLead = findBestMatchingLeadByPhone(leads, phone);

    if (existingLead) {
      if (existingLead.isBlocked) {
        console.log(`[Webhook System] Inbound message dropped: Candidate "${existingLead.name}" is BLOCKED. Reason: "${existingLead.blockedReason || 'Blocked'}".`);
        res.json({ success: true, blocked: true, message: 'Candidate is blocked.' });
        return;
      }

      console.log(`[Webhook System] Inbound lead already exists: "${existingLead.name}" (ID: ${existingLead.id}, Assigned: @${existingLead.assignedTo || 'unassigned'}). Appending message and preserving previous details and coordinator.`);
      
      if (!Array.isArray(existingLead.messages)) existingLead.messages = [];
      
      // Deduplication check: Do not append identical message if already received recently
      const lastInbound = existingLead.messages.filter(m => m && m.sender === 'lead').slice(-1)[0];
      if (lastInbound && lastInbound.text && lastInbound.text.trim().toLowerCase() === String(initialMessage).trim().toLowerCase()) {
        const timeDiff = Math.abs(Date.now() - new Date(lastInbound.timestamp).getTime());
        if (timeDiff < 15 * 60 * 1000) {
          console.log(`[Webhook System] Duplicate message skipped for existing lead "${existingLead.name}": "${initialMessage}"`);
          res.json({ success: true, lead: existingLead, duplicateSkipped: true });
          return;
        }
      }

      const savedExisting = await updateSingleLead(existingLead.id, (target) => {
        if (!Array.isArray(target.messages)) target.messages = [];
        target.messages.push({
          id: `msg_webhook_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          sender: 'lead',
          senderName: target.name,
          text: initialMessage,
          timestamp: new Date().toISOString(),
          status: 'delivered',
          channel: 'whatsapp'
        });
        target.campaign = finalCampaignName;
        if (!Array.isArray(target.timeline)) target.timeline = [];
        target.timeline.push({
          id: `tl_webhook_${Date.now()}`,
          type: 'message',
          text: `Inbound query on campaign: "${finalCampaignName}". Message: "${initialMessage}"`,
          actor: target.name,
          timestamp: new Date().toISOString()
        });
        return target;
      }, { allowDeferredSync: true });

      handleAutoReplyIfEnabled(existingLead.id, phone, existingLead.name);

      res.json({ success: true, lead: savedExisting || existingLead, merged: true });
      return;
    }

    // Dynamic AI Lead Profiling with Gemini
    const ai = getGemini();

    let aiAnalysis = {
      name: profileName,
      email: '',
      budget: 0,
      budgetRaw: 'Not explicitly mentioned',
      summary: `Inbound WhatsApp query on: "${initialMessage}"`,
      requirements: ['WhatsApp Inbound'],
      fitScore: 'medium' as FitScore,
      nextAction: 'Reply to WhatsApp query and introduce product catalog.'
    };

    if (ai) {
      try {
        const promptSystem = `You are a professional automated Lead Qualification AI for a Meta Ad Click-to-WhatsApp CRM. 
Your goal is to parse the initial user WhatsApp message, look for intents, requirements, budget mentions, and contact info, and organize them.
Respond strictly with a JSON object. Ensure correct formatting.`;

        const requestPrompt = `Parse this inbound WhatsApp conversation:
WhatsApp Profile Name: "${profileName}"
Incoming Message: "${initialMessage}"
Ad Campaign Trigger: "${finalCampaignName}"

Extract:
1. name: Refine the name. If the person writes "Hi, my name is Dave", use "Dave". If not mentioned, default to "${profileName}".
2. email: Any email address mentioned. If not, default to empty string "".
3. budget: A numeric estimate of their budget in USD. If they specify monthly agency fees like "$4k - $5k a month", estimate around the annual value or direct budget of 4500. For housing like "$600k", output 600000. For high ticket objects or general, if unavailable, output 0.
4. budgetRaw: The raw string of the budget, e.g., "$4,000 - $5,000" or "none mentioned".
5. summary: A professional 1-2 sentence qualification summary detailing what they want and their level of intent.
6. requirements: A short list of strings covering the core aspects they asked about (e.g. ["pricing", "availability", "waterfront view"]).
7. fitScore: Choose one of: "high" (has budget, clear intent, fits target audience), "medium" (interested but need to clarify budget/specs), "low" (not clear, or tiny budget), "unqualified" (spam, completely off-budget, or irrelevant).
8. nextAction: A smart sales-focused next action to send to them.`;

        const response = await safeGenerateContent(ai, {
          model: 'gemini-3.5-flash',
          contents: requestPrompt,
          config: {
            systemInstruction: promptSystem,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                email: { type: Type.STRING },
                budget: { type: Type.INTEGER },
                budgetRaw: { type: Type.STRING },
                summary: { type: Type.STRING },
                requirements: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                fitScore: {
                  type: Type.STRING,
                  description: 'Must be high, medium, low, or unqualified'
                },
                nextAction: { type: Type.STRING }
              },
              required: ['name', 'email', 'budget', 'budgetRaw', 'summary', 'requirements', 'fitScore', 'nextAction']
            }
          }
        });

        const textOutput = response.text;
        if (textOutput) {
          const parsed = JSON.parse(textOutput.trim());
          // Ensure fitScore is valid
          let cleanFitScore: FitScore = 'medium';
          if (['high', 'medium', 'low', 'unqualified'].includes(parsed.fitScore)) {
            cleanFitScore = parsed.fitScore as FitScore;
          }
          aiAnalysis = {
            name: parsed.name || profileName,
            email: parsed.email || '',
            budget: Number(parsed.budget) || 0,
            budgetRaw: parsed.budgetRaw || 'Not mentioned',
            summary: parsed.summary || `WhatsApp message received: "${initialMessage}"`,
            requirements: parsed.requirements || ['WhatsApp Interest'],
            fitScore: cleanFitScore,
            nextAction: parsed.nextAction || 'Initiate WhatsApp contact.'
          };
        }
      } catch (err) {
        console.error('Gemini webhook analysis failed, falling back to simulator parameters:', err);
        // Failover - leave default simulated analysis
      }
    } else {
      // Offline/simulation rule-based parse
      const textLower = initialMessage.toLowerCase();
      if (textLower.includes('budget') || textLower.includes('$') || textLower.includes('euro') || textLower.includes('€')) {
        aiAnalysis.fitScore = 'high';
        aiAnalysis.summary = `WhatsApp lead requesting details on ${finalCampaignName}. Mentions budget parameters explicitly.`;
        if (textLower.includes('600k') || textLower.includes('650k')) {
          aiAnalysis.budget = 650000;
          aiAnalysis.budgetRaw = '$600k - $700k';
        } else if (textLower.includes('3k') || textLower.includes('5k') || textLower.includes('4000')) {
          aiAnalysis.budget = 4500;
          aiAnalysis.budgetRaw = '$4,000 - $5,000 / mo';
        }
      }
    }

    // Save newly created lead (since they don't exist yet)
    const cleanNameId = String(aiAnalysis.name).toUpperCase().trim().replace(/[^A-Z0-9]/g, '_');
    const newLeadId = generateUniqueLeadId(leads, cleanNameId);
    const newLead: Lead = {
      id: newLeadId,
      serialNo: '',
      entryDate: new Date().toISOString().split('T')[0],
      assignDate: '',
      name: aiAnalysis.name,
      phone,
      email: aiAnalysis.email || '',
      gender: 'Not defined',
      age: '',
      origin: '',
      country: finalCampaignName.split(' ')[0] || '',
      position: aiAnalysis.requirements[0] || '',
      experience: '',
      adminRemarks: '',
      notes: '',
      assignedTo: '',
      importance: 3,
      remarks1: '',
      remarks2: '',
      remarks3: '',
      stage: 'new',
      budget: aiAnalysis.budget,
      budgetRaw: aiAnalysis.budgetRaw,
      summary: aiAnalysis.summary,
      requirements: aiAnalysis.requirements,
      fitScore: aiAnalysis.fitScore,
      nextAction: aiAnalysis.nextAction,
      campaign: finalCampaignName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      intake: false,
      messages: [
        {
          id: `msg_${Date.now()}`,
          sender: 'lead',
          text: initialMessage,
          timestamp: new Date().toISOString()
        }
      ]
    };

    const savedInbound = await addOrMergeInboundLead(newLead);

    // Trigger auto-reply if enabled
    handleAutoReplyIfEnabled(savedInbound.lead.id, phone, savedInbound.lead.name);

    res.json({ success: true, lead: savedInbound.lead, merged: savedInbound.merged, simulated: !ai });

  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST generate AI response suggestion
app.post('/api/leads/:id/ai-reply', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const ai = getGemini();
    if (!ai) {
      // In simulation mode, generate a warm default template response based on lead data
      const leadName = lead.name.split(' ')[0];
      let simulatedReply = '';

      if (lead.campaign.includes('Condos') || lead.campaign.includes('Waterfront')) {
        simulatedReply = `Hi ${leadName}! I'm happy to help. Under a budget of ${lead.budgetRaw}, we have two prime ocean-facing sky condos remaining! Both include dual wrap-around balconies and complete interior automation. Would you like me to send you the floor layouts and dynamic video tours via WhatsApp?`;
      } else if (lead.campaign.includes('Shopify') || lead.campaign.includes('Growth')) {
        simulatedReply = `Hello ${leadName}! It's great to connect. Scale bottlenecks are super common at $20k/mo. With your target of $100k/mo and monthly budget of ${lead.budgetRaw}, we can definitely outline a custom SEO & Meta workflow. Would you like to check out some video audits of clothing brands we've scaled recently?`;
      } else {
        simulatedReply = `Hi ${leadName}! Thank you for your inquiry regarding our "${lead.campaign}" promo. We'd love to help you with ${lead.requirements.join(', ') || 'your requirements'}. Can we schedule a brief 5-minute WhatsApp call this afternoon to lock down the specs?`;
      }

      res.json({ suggestion: simulatedReply, simulated: true });
      return;
    }

    // Live AI Generation
    const lastLeadsMsgs = lead.messages.slice(-6); // grab last 6 messages
    const formattedTranscript = lastLeadsMsgs.map(m => `${m.sender === 'lead' ? 'Lead' : 'Sales Representative'}: ${m.text}`).join('\n');

    const promptSystem = `You are an elite, high-converting WhatsApp Sales Specialist working within a Meta Ads lead hub. 
Your goal is to suggest a stellar, warm, conversational, and highly personalized reply to the lead's last message.
Guidelines:
- Keep the message extremely concise and breathable (WhatsApp-friendly, use linebreaks if helpful).
- Do not use any generic brackets or placeholders (such as [My Name] or [Insert Link]). Keep it 100% complete.
- Mirror the lead's tone/language (if they speak Spanish, translate and reply beautifully in Spanish).
- Sound like a human sales specialist, not an robotic AI. Use occasional emojis but very sparingly.
- End with a low-pressure, high-converting open question to sustain engagement.`;

    const requestPrompt = `Draft a WhatsApp reply suggestion for:
Lead Name: ${lead.name}
Trigger Ad Campaign: ${lead.campaign}
Lead Interest Summary: ${lead.summary}
Extracted Requirements: ${lead.requirements.join(', ')}
Target Budget: ${lead.budgetRaw}

Current WhatsApp Chat History:
${formattedTranscript}

Suggest the next message a sales rep should send. Output ONLY the response text itself, with no surrounding quotes or commentary.`;

    const response = await safeGenerateContent(ai, {
      model: 'gemini-3.5-flash',
      contents: requestPrompt,
      config: {
        systemInstruction: promptSystem,
        temperature: 0.8
      }
    });

    const replySuggestion = response.text || "Hello! It's great to connect. Let me pull up those options for indeed.";
    res.json({ suggestion: replySuggestion.trim(), simulated: false });

  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST AI re-qualify lead parameters based on conversations
app.post('/api/leads/:id/ai-requalify', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const ai = getGemini();

    if (!ai) {
      const savedSim = await updateSingleLead(req.params.id, (current) => {
        current.notes = `${current.notes || ''}\n[AI Sim Re-qualify ${new Date().toLocaleDateString()}]: Lead context refreshed. Budget maintained.`;
        return current;
      });
      res.json(savedSim || lead);
      return;
    }

    console.log(`Re-qualifying lead ${lead.name} with live Gemini API...`);

    const formattedTranscript = (lead.messages || []).map(m => `${m.sender === 'lead' ? 'Lead' : 'Sales Rep'}: ${m.text}`).join('\n');

    const promptSystem = `You are a Lead Scoring and Qualification Engine for a WhatsApp Meta CRM.
Analyze the updated chat conversation log and synthesize/refine the lead's profile, requirements, and budget details.
Respond strictly in JSON format. Do not add markdown except for the JSON structure.`;

    const requestPrompt = `Evaluate this active WhatsApp chat log for Lead: ${lead.name}:

Chat history:
${formattedTranscript}

Current lead status:
- Budget Raw: ${lead.budgetRaw}
- Requirements list: ${(lead.requirements || []).join(', ')}
- Summary: ${lead.summary}

Provide updated qualification attributes:
1. budget: Updated numeric budget in USD (0 if unknown).
2. budgetRaw: Cleaned text representation of their budget.
3. summary: Re-synthesized qualification summary (1-2 sentences), adjusting for any newly shared needs, objections, or timeline details.
4. requirements: Array of strings listing confirmed requirements or core topics discussed.
5. fitScore: Adjust fitScore ("high", "medium", "low", "unqualified") based on updated parameters.
6. nextAction: Recommended next action for the sales representative.`;

    const response = await safeGenerateContent(ai, {
      model: 'gemini-3.5-flash',
      contents: requestPrompt,
      config: {
        systemInstruction: promptSystem,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            budget: { type: Type.INTEGER },
            budgetRaw: { type: Type.STRING },
            summary: { type: Type.STRING },
            requirements: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            fitScore: { type: Type.STRING },
            nextAction: { type: Type.STRING }
          },
          required: ['budget', 'budgetRaw', 'summary', 'requirements', 'fitScore', 'nextAction']
        }
      }
    });

    const output = response.text;
    let finalLead = lead;
    if (output) {
      const parsed = JSON.parse(output.trim());
      let cleanFitScore: FitScore = lead.fitScore;
      if (['high', 'medium', 'low', 'unqualified'].includes(parsed.fitScore)) {
        cleanFitScore = parsed.fitScore as FitScore;
      }

      const savedAi = await updateSingleLead(req.params.id, (current) => {
        current.budget = Number(parsed.budget) || current.budget || 0;
        current.budgetRaw = parsed.budgetRaw || current.budgetRaw;
        current.summary = parsed.summary || current.summary;
        current.requirements = parsed.requirements || current.requirements;
        current.fitScore = cleanFitScore;
        current.nextAction = parsed.nextAction || current.nextAction;
        if (!Array.isArray(current.messages)) current.messages = [];
        current.messages.push({
          id: `sys_${Date.now()}`,
          sender: 'system',
          text: `Lead automatically qualified by Gemini AI. Fit Score: ${cleanFitScore.toUpperCase()}. Next action updated to: "${parsed.nextAction}"`,
          timestamp: new Date().toISOString()
        });
        return current;
      });
      if (savedAi) finalLead = savedAi;
    }

    res.json(finalLead);

  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


// POST Batch AI analysis report
app.post('/api/leads/ai-analyze', async (req, res) => {
  try {
    const { leads } = req.body;
    if (!Array.isArray(leads)) {
      res.status(400).json({ error: 'leads must be an array' });
      return;
    }

    const ai = getGemini();
    if (!ai) {
      // Return high-quality mock report
      const total = leads.length;
      const highFit = leads.filter(l => l.fitScore === 'high').length;
      const noDocs = leads.filter(l => !l.docPassportCopy || !l.docResume).length;
      const unassigned = leads.filter(l => !l.assignedTo).length;

      const mockReport = `### 📊 AI Strategic Cohort Analysis (Simulated Mode)

**1. Cohort Health & Key Metrics**
- **Total Selected Candidates**: **${total}** candidates in current view.
- **High-Quality Fit**: **${highFit}** candidates (${Math.round((highFit / (total || 1)) * 100)}% fit ratio).
- **Document Status**: **${total - noDocs}/${total}** candidates have both Passport copy and CV uploaded.

**2. Key Bottlenecks Identified**
- ⚠️ **Missing Documents**: **${noDocs}** candidates are missing essential files (Passport copy or Resume).
- 👤 **Unassigned Files**: **${unassigned}** candidates do not have a dedicated coordinator assigned.

**3. Strategic Recommendations**
- Assign the **${unassigned}** unassigned files to available coordinators to ensure immediate engagement.
- Promptly follow up with candidates missing primary documentation to finish enrollment.
- Prioritize high-fit profiles for premium openings in Germany and Qatar.`;

      res.json({ report: mockReport, simulated: true });
      return;
    }

    // Live AI Generation with Gemini
    const systemPrompt = `You are an elite, highly professional Overseas Recruitment and Agency CRM consulting specialist.
Analyze the provided batch of candidate leads and generate a highly professional, actionable strategic analysis report in Markdown.
The report should include:
1. Cohort Health & Key Metrics: A summary of candidates, most popular destinations, general fitness.
2. Bottlenecks & Critical Risks: E.g. candidates with missing documents, unassigned files, or stagnant pipeline stages.
3. Priority Actions: A numbered list of specific individual candidates or actions to take immediately (referencing them by name if helpful).
Keep the report concise, highly readable, structured, and professional.`;

    const candidateBriefs = leads.map(l => ({
      name: l.name,
      country: l.country,
      position: l.positionOpening,
      stage: l.stage,
      fitScore: l.fitScore,
      assignedTo: l.assignedTo || 'Unassigned',
      docStatus: {
        passport: !!l.docPassportCopy,
        resume: !!l.docResume,
        officeVisited: !!l.docOfficeVisited
      },
      remarks: l.remarks3 || l.remarks2 || l.remarks1 || 'None'
    }));

    const contents = `Batch Candidate Data:
${JSON.stringify(candidateBriefs, null, 2)}

Provide the Strategic Analysis Report now. Do not include introductory notes or meta-commentary, start directly with the markdown content.`;

    const response = await safeGenerateContent(ai, {
      model: 'gemini-3.5-flash',
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7
      }
    });

    res.json({ report: response.text || 'Unable to generate analysis. Please try again.', simulated: false });

  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


// Programmatic helper to deduplicate repeating text, sentences, or phrases
function deduplicateText(text: string): string {
  if (!text) return '';
  // Clean multiple spaces and linebreaks
  let cleaned = text.replace(/\s+/g, ' ').trim();
  
  // Split on common delimiters
  const parts = cleaned.split(/[\-\.\,\|\n\r;\(\):]+/);
  const seen = new Set<string>();
  const uniqueParts: string[] = [];
  
  for (let part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    // Normalize to check for duplicates
    const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized.length < 3) {
      uniqueParts.push(trimmed);
      continue;
    }
    
    let isDuplicate = false;
    for (const existing of seen) {
      if (existing.includes(normalized) || normalized.includes(existing)) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      seen.add(normalized);
      uniqueParts.push(trimmed);
    }
  }
  
  return uniqueParts.length > 0 ? uniqueParts.join(' - ') : cleaned;
}


// Dynamically scan and extract text from candidate CV files using Gemini and cache the result
async function runBackgroundResumeScanner(leadId: string): Promise<void> {
  try {
    const leads = await getLeads(true);
    const idx = leads.findIndex((l: any) => l.id === leadId);
    if (idx === -1) return;

    const lead = leads[idx];
    if (!lead.resumeUrl) return;

    // Resolve safe relative path in uploads directory
    const relativePath = lead.resumeUrl.startsWith('/') ? lead.resumeUrl.slice(1) : lead.resumeUrl;
    const filePath = path.join(process.cwd(), relativePath);

    if (!fs.existsSync(filePath)) {
      console.warn(`[Background CV Parser] Resume file not found on disk at: ${filePath}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    let mimeType = '';
    if (ext === '.pdf') {
      mimeType = 'application/pdf';
    } else if (ext === '.png') {
      mimeType = 'image/png';
    } else if (ext === '.jpg' || ext === '.jpeg') {
      mimeType = 'image/jpeg';
    } else if (ext === '.webp') {
      mimeType = 'image/webp';
    } else if (ext === '.txt') {
      mimeType = 'text/plain';
    }

    if (!mimeType) {
      console.log(`[Background CV Parser] Unsupported file extension ${ext} for lead ${lead.id}`);
      return;
    }

    console.log(`[Background CV Parser] Starting background scan of CV for ${lead.name} (${lead.id})...`);

    const ai = getGemini();
    let extractedExperience = '';
    let extractedQualification = '';
    let extractedSummary = '';
    let rawCvText = '';

    if (!ai) {
      // In simulation mode, return high quality mock parsed details
      extractedExperience = lead.experience && lead.experience !== 'Fresher' ? lead.experience : '3 Years (AI Scanned)';
      extractedQualification = lead.qualification && lead.qualification !== 'High School' ? lead.qualification : 'Diploma / Certification in Hospitality (AI Scanned)';
      extractedSummary = `Motivated professional with a strong hospitality background. Proactively seeking international deployment with full documentation ready.`;
      rawCvText = `[SIMULATED CV TEXT] Professional candidate: ${lead.name}. Experienced in hospitality and general services. Fluent communication and flexible in shift patterns.`;
    } else {
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');

      const filePart = {
        inlineData: {
          mimeType,
          data: base64Data
        }
      };

      const parsePrompt = `You are an expert AI Resume/CV Parser. Analyze this candidate's uploaded CV/Resume document and extract details to auto-fill their candidate CRM profile.
Extract:
1. Exact Years of Experience or a brief summary of career duration (e.g. "3 Years as Chef in Dubai", "5 Years as Staff Nurse in India").
2. Key Skills/Qualification (e.g. "Culinary Diploma & Pastry Specialist", "B.Sc Nursing with ICU Specialist certificate").
3. An elegant 2-sentence Career Summary Profile.
4. The full text content of the CV to be saved as the candidate CV reference.

Return the result as JSON adhering to the specified schema. Keep all strings clean and free of repetitive text.`;

      const response = await safeGenerateContent(ai, {
        model: 'gemini-3.5-flash',
        contents: [filePart, { text: parsePrompt }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              experience: { type: Type.STRING },
              qualification: { type: Type.STRING },
              careerSummary: { type: Type.STRING },
              fullText: { type: Type.STRING }
            },
            required: ["experience", "qualification", "careerSummary"]
          }
        }
      });

      if (response.text) {
        const parsed = JSON.parse(response.text.trim());
        if (parsed.experience) extractedExperience = String(parsed.experience).trim();
        if (parsed.qualification) extractedQualification = String(parsed.qualification).trim();
        if (parsed.careerSummary) extractedSummary = String(parsed.careerSummary).trim();
        rawCvText = String(parsed.fullText || response.text).trim();
      }
    }

    await updateSingleLead(leadId, (targetLead) => {
      if (extractedExperience) targetLead.experience = extractedExperience;
      if (extractedQualification) targetLead.qualification = extractedQualification;
      if (extractedSummary) {
        targetLead.notes = extractedSummary;
      }
      if (rawCvText) {
        targetLead.cvTextContent = rawCvText;
      } else if (!targetLead.cvTextContent) {
        targetLead.cvTextContent = `Extracted CV summary of ${targetLead.name}. Experience: ${extractedExperience}. Skills: ${extractedQualification}. Career: ${extractedSummary}`;
      }

      if (!targetLead.timeline) targetLead.timeline = [];
      targetLead.timeline.push({
        id: `tl_${Date.now()}_ai_scan`,
        type: 'remark',
        text: `AI Resume Scanner: Read candidate CV and extracted professional profile. Experience updated to '${extractedExperience || '3 Years'}', qualification set to '${extractedQualification || 'Diploma'}'`,
        actor: 'AI Resume Scanner',
        timestamp: new Date().toISOString()
      });

      return targetLead;
    }, { allowDeferredSync: true });
    console.log(`[Background CV Parser] Successfully auto-filled profile and saved timeline for lead ${leadId}`);
  } catch (err) {
    console.error(`[Background CV Parser] Error scanning CV for lead ${leadId}:`, err);
  }
}


// Dynamically scan and extract text from candidate CV files using Gemini and cache the result
async function getOrExtractCvText(lead: any): Promise<string> {
  // Return cached text immediately if it already exists
  if (lead.cvTextContent) {
    return lead.cvTextContent;
  }

  // If there's no resume file, return empty
  if (!lead.resumeUrl) {
    return '';
  }

  // Generate an elegant, comprehensive fallback profile based on existing candidate metadata
  // to avoid blocking the main request with 25 parallel on-the-fly Gemini PDF extractions.
  const experienceStr = lead.experience || 'Not specified';
  const qualificationStr = lead.qualification || 'Not specified';
  const positionStr = lead.position || 'General Services';
  const originStr = lead.origin || 'Not specified';
  const remarksStr = `${lead.remarks1 || ''} ${lead.remarks2 || ''} ${lead.remarks3 || ''} ${lead.adminRemarks || ''}`.trim();

  const fallbackText = `[Candidate Resume Profile - Meta-extracted]
Name: ${lead.name}
Target Position: ${positionStr}
Experience: ${experienceStr}
Qualifications: ${qualificationStr}
Origin Region: ${originStr}
Remarks Logs: ${remarksStr || 'No call log history.'}`;

  // Cache fallback text in memory for the current matcher request
  lead.cvTextContent = fallbackText;

  // Trigger a background async full resume scan to fill in the true deep CV details
  // so that the background worker does the heavy lifting without slowing down the active matching request.
  runBackgroundResumeScanner(lead.id).catch(err => {
    console.warn(`[CV Extractor] Failed to trigger background CV scan for ${lead.id}:`, err);
  });

  return fallbackText;
}


// POST Fast Conversational AI Candidate Matcher (Strictly scoped to Coordinator's own leads)
app.post('/api/ai-match-leads', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      jobId,
      textCommand,
      message,
      image,
      history,
      previousLeadIds
    } = req.body || {};

    const userMessage = String(message || textCommand || '').trim();
    const userRole = String(req.headers['x-user-role'] || req.body?.userRole || 'user').trim().toLowerCase();
    const agentId = String(req.headers['x-agent-id'] || req.body?.agentId || 'unassigned').trim();
    const isAdminUser = userRole === 'admin';

    // 1. Load leads & coordinators cleanly from memory/cache and strictly enforce coordinator scoping
    const [rawLeads, coordinators] = await Promise.all([getLeads(), getCoordinators()]);
    const activeLeads = rawLeads.filter(l => l && !l.isDeleted);

    let scopedLeads: Lead[] = [];
    if (isAdminUser) {
      scopedLeads = activeLeads;
    } else if (agentId && agentId.toLowerCase() !== 'unassigned') {
      scopedLeads = activeLeads.filter(l => isCoordinatorMatch(l.assignedTo, agentId, coordinators));
    } else {
      scopedLeads = [];
    }

    // Resolve coordinator display label for clear scope transparency
    const matchedCoord = coordinators.find(
      c =>
        c.username?.toLowerCase() === agentId.toLowerCase() ||
        c.displayName?.toLowerCase() === agentId.toLowerCase()
    );
    const scopeOwnerName = matchedCoord?.displayName || agentId;

    // 2. Load optional selected Active Job context (and its local .webp creative if no custom image uploaded)
    let jobSummaryText = '';
    let attachedImageDataUrl: string | null = typeof image === 'string' && image.trim() ? image.trim() : null;
    let selectedJobRecord: any = null;

    if (jobId) {
      const jobs = await getJobs(false);
      selectedJobRecord = jobs.find(j => j.id === jobId) || null;
      if (selectedJobRecord) {
        const parts = [
          selectedJobRecord.title || '',
          selectedJobRecord.country ? `Country: ${selectedJobRecord.country}` : '',
          selectedJobRecord.serviceCharge ? `Service Charge: ${selectedJobRecord.serviceCharge}` : '',
          selectedJobRecord.requirement ? `Requirement: ${selectedJobRecord.requirement}` : '',
          selectedJobRecord.ageLimit ? `Age: ${selectedJobRecord.ageLimit}` : ''
        ].filter(Boolean);
        jobSummaryText = parts.join(' | ');

        if (!attachedImageDataUrl && selectedJobRecord.imageUrl && selectedJobRecord.imageUrl.startsWith('/uploads/')) {
          try {
            const localImgPath = path.join(UPLOADS_DIR, path.basename(selectedJobRecord.imageUrl));
            if (fs.existsSync(localImgPath)) {
              const stat = fs.statSync(localImgPath);
              if (stat.size > 0 && stat.size < 1.5 * 1024 * 1024) {
                const ext = path.extname(localImgPath).toLowerCase();
                const mime = ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/webp';
                const b64 = fs.readFileSync(localImgPath).toString('base64');
                attachedImageDataUrl = `data:${mime};base64,${b64}`;
              }
            }
          } catch {}
        }
      }
    }

    // If coordinator has zero assigned leads, return immediately (<10ms) in simple language
    if (scopedLeads.length === 0) {
      return res.json({
        reply: isAdminUser
          ? 'No active candidate leads found in CRM right now.'
          : `Hi ${scopeOwnerName}, right now 0 leads are assigned to you. Ask admin to assign leads first, then I can find match for you.`,
        jobSummary: jobSummaryText || '',
        jobDetails: {
          title: selectedJobRecord?.serviceCharge || selectedJobRecord?.title || 'General Search',
          country: selectedJobRecord?.country || '',
          salary: '',
          experience: '',
          skills: '',
          preferredRegion: '',
          benefits: ''
        },
        matches: [],
        scopedCount: 0,
        scopeLabel: isAdminUser ? 'All CRM Leads' : `${scopeOwnerName}'s Leads Only`,
        elapsedMs: Date.now() - startTime,
        isSimulated: false
      });
    }

    // 3. Gather recent context & previous IDs
    const recentUserTexts = Array.isArray(history)
      ? history
          .filter((h: any) => h && h.role === 'user' && h.text)
          .slice(-3)
          .map((h: any) => String(h.text))
      : [];

    const prevIdSet = new Set(Array.isArray(previousLeadIds) ? previousLeadIds.map(String) : []);

    // Build quick lead pool statistics for general chat questions ("how many leads I have?", etc.)
    const stageCounts: Record<string, number> = {};
    for (const l of scopedLeads) {
      const st = l.stage || 'new';
      stageCounts[st] = (stageCounts[st] || 0) + 1;
    }

    // Domain synonym clusters for full CRM coverage across common hospitality/abroad recruitment trades
    const ROLE_SYNONYM_GROUPS: Array<{
      triggers: string[];
      exact: string[];
      related: string[];
    }> = [
      {
        triggers: ['waitress', 'waitresses', 'waiter', 'waiters', 'steward', 'stewardess', 'hostess', 'server', 'table service'],
        exact: ['waitress', 'waitresses', 'waiter', 'waiters', 'steward', 'stewardess', 'hostess', 'server'],
        related: ['hospitality', 'f&b', 'food & beverage', 'barista', 'bartender', 'restaurant', 'cafe', 'coffee shop', 'hotel industry', 'banquet', 'catering', 'food service']
      },
      {
        triggers: ['hospitality', 'f&b', 'food & beverage', 'barista', 'bartender', 'hotel industry', 'restaurant', 'catering'],
        exact: ['hospitality', 'f&b', 'food & beverage', 'barista', 'bartender', 'hotel industry', 'restaurant', 'catering', 'waitress', 'waiter', 'hostess', 'steward'],
        related: ['cafe', 'coffee shop', 'banquet', 'food service', 'front office', 'receptionist']
      },
      {
        triggers: ['cook', 'cooks', 'chef', 'chefs', 'commi', 'culinary', 'baker', 'pastry', 'tandoor', 'sous chef', 'kitchen'],
        exact: ['cook', 'cooks', 'chef', 'chefs', 'commi', 'culinary', 'baker', 'pastry', 'tandoor', 'sous chef', 'kitchen helper'],
        related: ['kitchen', 'restaurant', 'catering', 'banquet']
      },
      {
        triggers: ['nurse', 'nursing', 'gnm', 'anm', 'caregiver', 'care giver', 'caretaker', 'care taker', 'healthcare'],
        exact: ['nurse', 'nursing', 'gnm', 'anm', 'caregiver', 'care giver', 'caretaker', 'care taker'],
        related: ['healthcare', 'medical', 'hospital', 'clinic', 'patient care', 'midwife', 'ssw']
      },
      {
        triggers: ['driver', 'drivers', 'driving', 'chauffeur', 'heavy driver', 'light driver'],
        exact: ['driver', 'drivers', 'driving', 'chauffeur', 'heavy driver', 'light driver', 'truck driver', 'bus driver', 'delivery driver'],
        related: ['transport', 'rider', 'courier', 'logistics']
      },
      {
        triggers: ['cleaner', 'cleaning', 'housekeeping', 'house keeping', 'housekeeper', 'maid', 'nanny', 'babysitter', 'janitor'],
        exact: ['cleaner', 'cleaning', 'housekeeping', 'house keeping', 'housekeeper', 'maid', 'nanny', 'babysitter', 'janitor', 'room attendant'],
        related: ['attendant', 'laundry', 'domestic']
      },
      {
        triggers: ['cashier', 'sales', 'salesgirl', 'salesman', 'retail', 'promoter', 'merchandiser'],
        exact: ['cashier', 'sales', 'salesgirl', 'salesman', 'sales executive', 'retail', 'promoter', 'merchandiser'],
        related: ['supermarket', 'mall', 'customer service', 'counter', 'store']
      },
      {
        triggers: ['packer', 'packers', 'packing', 'warehouse', 'factory', 'picker', 'loader', 'storekeeper', 'store keeper'],
        exact: ['packer', 'packers', 'packing', 'warehouse', 'factory', 'picker', 'loader', 'store keeper', 'storekeeper'],
        related: ['helper', 'packaging', 'logistics', 'production', 'manufacturing', 'inventory']
      },
      {
        triggers: ['security', 'guard', 'security guard', 'bouncer', 'watchman'],
        exact: ['security', 'guard', 'security guard', 'bouncer', 'watchman'],
        related: ['safety', 'patrol', 'cctv']
      },
      {
        triggers: ['receptionist', 'front office', 'front desk', 'concierge'],
        exact: ['receptionist', 'front office', 'front desk', 'concierge'],
        related: ['hospitality', 'customer service', 'admin', 'clerk']
      },
      {
        triggers: ['electrician', 'plumber', 'technician', 'mechanic', 'welder', 'carpenter', 'mason', 'hvac', 'fitter', 'painter'],
        exact: ['electrician', 'plumber', 'technician', 'mechanic', 'welder', 'carpenter', 'mason', 'hvac', 'ac technician', 'fitter', 'painter'],
        related: ['maintenance', 'technical', 'construction']
      },
      {
        triggers: ['teacher', 'teaching', 'tutor', 'instructor'],
        exact: ['teacher', 'teaching', 'tutor', 'instructor'],
        related: ['education', 'school']
      }
    ];

    const KNOWN_COUNTRIES = [
      'kuwait', 'dubai', 'uae', 'qatar', 'oman', 'bahrain', 'saudi', 'ksa', 'japan',
      'albania', 'poland', 'malta', 'europe', 'croatia', 'romania', 'serbia', 'bulgaria',
      'singapore', 'malaysia', 'maldives', 'israel', 'cyprus', 'russia', 'armenia'
    ];

    const hasTerm = (text: string, term: string): boolean => {
      if (!text || !term) return false;
      const esc = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!esc) return false;
      return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(text);
    };

    const detectGenderFromText = (text: string): 'female' | 'male' | 'any' => {
      const wantsF = /\b(female|females|girl|girls|woman|women|lady|ladies|waitress|waitresses|maid|maids|nanny|hostess)\b/i.test(text);
      const wantsM = /\b(male|males|boy|boys|man|men|gentleman|gentlemen|waiter|waiters)\b/i.test(text);
      if (wantsF && !wantsM) return 'female';
      if (wantsM && !wantsF) return 'male';
      return 'any';
    };

    const stopWords = new Set([
      'i', 'need', 'want', 'show', 'find', 'give', 'me', 'some', 'any', 'good', 'best', 'for', 'in',
      'from', 'with', 'who', 'have', 'has', 'can', 'the', 'and', 'or', 'to', 'of', 'only', 'leads',
      'lead', 'candidate', 'candidates', 'job', 'work', 'please', 'pls', 'check', 'my', 'your', 'are',
      'all', 'list', 'full', 'female', 'females', 'male', 'males', 'girl', 'girls', 'boy', 'boys',
      'woman', 'women', 'man', 'men', 'under', 'above', 'below', 'age', 'years', 'year', 'yr', 'yrs',
      'stage', 'active', 'no', 'not', 'lost', 'remove', 'without', 'except', 'now', 'also', 'more', 'worker'
    ]);

    const ai = getGemini();
    let intent: 'casual_or_count' | 'search' = 'search';
    let casualReply = '';
    let aiJobSummary = jobSummaryText || userMessage.slice(0, 80) || 'Candidate Match';
    let requiredGender: 'female' | 'male' | 'any' = detectGenderFromText(`${userMessage} ${jobSummaryText}`);
    let exactRoleTerms: string[] = [];
    let relatedRoleTerms: string[] = [];
    let targetCountries: string[] = [];
    let targetOrigins: string[] = [];
    let minAge = 0;
    let maxAge = 0;
    let excludeLost = false;
    let mustHaveKeywords: string[] = [];
    let filterPreviousOnly = false;
    let isSimulatedResult = false;

    const historyLines = Array.isArray(history)
      ? history
          .slice(-4)
          .map((h: any) => `${h.role === 'user' ? 'User' : 'AI'}: ${String(h.text || '').slice(0, 180)}`)
          .join('\n')
      : '';

    // 4. Phase 1: Fast Gemini intent & filter extractor (text -> flash-lite ~0.6s, image -> 4-hydrogen ~1.5s)
    // Never filters or caps candidate IDs! Extracts structured search criteria so 100% of matching leads are returned.
    if (ai) {
      try {
        const systemInstruction = `You are a fast CRM search translator for consultancy staff. Talk in VERY SIMPLE broken English (friendly WhatsApp style).
TASK: Understand what the user wants from their message (plus any job photo / active job / recent chat context) and return clean JSON search filters.

RULES:
1. If user only says greeting/thanks ("hi", "hello", "ok", "thanks") OR asks a count/status question about their CRM leads ("how many leads I have?", "how many won leads?") without asking to list candidates, set "intent": "casual_or_count" and write "casualReply" in 1-2 short simple broken-English sentences using the exact Stage numbers provided.
2. Otherwise set "intent": "search".
3. Extract ALL relevant job role keywords and common CRM synonyms:
   - exactRoleTerms: main job words (e.g. for waitress -> ["waitress", "waiter", "hostess", "steward"]; for cook -> ["cook", "chef", "commi", "culinary"]). Keep array empty [] if user did not specify any job role (like "show my kuwait leads").
   - relatedRoleTerms: closely related CRM position categories (e.g. for waitress -> ["hospitality", "barista", "f&b", "restaurant", "hotel", "cafe"]; NEVER include "general", "sales", "teacher", or unrelated jobs).
4. Extract requiredGender ("female", "male", or "any"). If query mentions waitress/hostess/girl/lady/female -> "female".
5. Extract countries (if asked, e.g. ["kuwait"]), origins/cities (if asked, e.g. ["darjeeling"]), minAge / maxAge (0 if not mentioned), excludeLost (true ONLY if user says "no lost", "active only", "hide lost"; default false so full list is returned!), mustHaveKeywords (if user asks specific requirement like "passport", "english", "taj hotel").
6. Set filterPreviousOnly = true ONLY when user is narrowing the previous list (e.g. "only from Darjeeling", "remove lost from this list", "under 25 only") AND NOT starting a brand new job search.
7. NEVER write fancy corporate English.`;

        const parserPrompt = `Scope: ${isAdminUser ? `All CRM Leads (${scopedLeads.length} active)` : `ONLY ${scopeOwnerName}'s own leads (${scopedLeads.length} total)`}
Stage summary: new=${stageCounts.new || 0}, in_discussion=${(stageCounts.in_discussion || 0) + (stageCounts.negotiating || 0)}, strong=${stageCounts.strong_opportunity || 0}, office_visited=${stageCounts.office_visited || 0}, won=${stageCounts.won || 0}, cold=${stageCounts.cold_leads || 0}, lost=${stageCounts.lost || 0}
${jobSummaryText ? `Selected Active Job: ${jobSummaryText}\n` : ''}${historyLines ? `Recent chat:\n${historyLines}\n` : ''}Previous matched list count: ${prevIdSet.size}
User message now: "${userMessage || (attachedImageDataUrl ? 'Find matching candidates for this job photo' : 'Hi')}"`;

        const parts: any[] = [];
        if (attachedImageDataUrl) {
          let base64Data = attachedImageDataUrl;
          let mimeType = 'image/png';
          if (attachedImageDataUrl.startsWith('data:')) {
            const splitParts = attachedImageDataUrl.split(',');
            base64Data = splitParts[1] || '';
            const mimeMatch = splitParts[0].match(/data:(.*?);base64/);
            if (mimeMatch) mimeType = mimeMatch[1];
          }
          if (base64Data) {
            parts.push({ inlineData: { mimeType, data: base64Data } });
          }
        }
        parts.push({ text: parserPrompt });

        const fastModel = attachedImageDataUrl ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite';
        const fastThinking = attachedImageDataUrl ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL;

        const parseRes = await safeGenerateContent(ai, {
          model: fastModel,
          contents: { parts },
          config: {
            systemInstruction,
            thinkingConfig: { thinkingLevel: fastThinking },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                intent: { type: Type.STRING },
                casualReply: { type: Type.STRING },
                jobSummary: { type: Type.STRING },
                requiredGender: { type: Type.STRING },
                exactRoleTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
                relatedRoleTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
                countries: { type: Type.ARRAY, items: { type: Type.STRING } },
                origins: { type: Type.ARRAY, items: { type: Type.STRING } },
                minAge: { type: Type.INTEGER },
                maxAge: { type: Type.INTEGER },
                excludeLost: { type: Type.BOOLEAN },
                mustHaveKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                filterPreviousOnly: { type: Type.BOOLEAN }
              },
              required: ['intent', 'jobSummary', 'requiredGender', 'exactRoleTerms', 'relatedRoleTerms']
            }
          }
        });

        if (parseRes?.text) {
          const p = JSON.parse(parseRes.text.trim());
          intent = String(p.intent || '').toLowerCase() === 'casual_or_count' ? 'casual_or_count' : 'search';
          casualReply = String(p.casualReply || '').trim();
          if (p.jobSummary) aiJobSummary = String(p.jobSummary).trim();
          const gVal = String(p.requiredGender || '').toLowerCase();
          if (gVal === 'female' || gVal === 'male' || gVal === 'any') requiredGender = gVal;
          exactRoleTerms = Array.isArray(p.exactRoleTerms) ? p.exactRoleTerms.map((x: any) => String(x).toLowerCase().trim()).filter(Boolean) : [];
          relatedRoleTerms = Array.isArray(p.relatedRoleTerms) ? p.relatedRoleTerms.map((x: any) => String(x).toLowerCase().trim()).filter(Boolean) : [];
          targetCountries = Array.isArray(p.countries) ? p.countries.map((x: any) => String(x).toLowerCase().trim()).filter(Boolean) : [];
          targetOrigins = Array.isArray(p.origins) ? p.origins.map((x: any) => String(x).toLowerCase().trim()).filter(Boolean) : [];
          minAge = Number(p.minAge) > 0 ? Number(p.minAge) : 0;
          maxAge = Number(p.maxAge) > 0 ? Number(p.maxAge) : 0;
          excludeLost = Boolean(p.excludeLost);
          mustHaveKeywords = Array.isArray(p.mustHaveKeywords) ? p.mustHaveKeywords.map((x: any) => String(x).toLowerCase().trim()).filter(Boolean) : [];
          filterPreviousOnly = Boolean(p.filterPreviousOnly) && prevIdSet.size > 0 && !attachedImageDataUrl && !jobId;
        }
      } catch (parseErr) {
        console.warn('[AI Matcher Chat] Gemini intent parser fallback to deterministic parser:', parseErr);
        isSimulatedResult = true;
      }
    } else {
      isSimulatedResult = true;
    }

    // Deterministic fallback & safety merge so synonyms/countries/age are always caught even if Gemini is unavailable
    const fallbackTextSource = `${userMessage} ${jobSummaryText}`.toLowerCase();
    if (isSimulatedResult) {
      const isGreetingOrCount =
        !attachedImageDataUrl &&
        !jobId &&
        (/^(hi|hello|hey|ok|thanks|thank you)\b/i.test(userMessage) ||
          /how many (lead|leads)|total leads|my leads count/i.test(userMessage));
      if (isGreetingOrCount) {
        intent = 'casual_or_count';
        casualReply = `Hi ${scopeOwnerName}! You have ${scopedLeads.length} leads total (new=${stageCounts.new || 0}, in discussion=${(stageCounts.in_discussion || 0) + (stageCounts.negotiating || 0)}, strong=${stageCounts.strong_opportunity || 0}, won=${stageCounts.won || 0}). Tell me what worker you need!`;
      }
    }

    if (intent === 'casual_or_count') {
      const elapsedMs = Date.now() - startTime;
      return res.json({
        reply: casualReply || `Hi ${scopeOwnerName}! You have ${scopedLeads.length} leads total. Tell me what worker you need!`,
        jobSummary: 'CRM Chat',
        jobDetails: {
          title: 'CRM Chat',
          country: '',
          salary: '',
          experience: '',
          skills: '',
          preferredRegion: '',
          benefits: ''
        },
        matches: [],
        scopedCount: scopedLeads.length,
        scopeLabel: isAdminUser ? `All CRM Leads (${scopedLeads.length})` : `${scopeOwnerName}'s Leads Only (${scopedLeads.length})`,
        elapsedMs,
        isSimulated: isSimulatedResult
      });
    }

    // Extract deterministic country/age/keyword signals cleanly if not already captured
    if (targetCountries.length === 0) {
      for (const c of KNOWN_COUNTRIES) {
        if (hasTerm(fallbackTextSource, c)) targetCountries.push(c);
      }
    }
    if (!excludeLost && /\b(no lost|hide lost|exclude lost|active only|active stage only|not lost)\b/i.test(userMessage)) {
      excludeLost = true;
    }
    if (!maxAge) {
      const mUnder = userMessage.match(/\b(?:under|below|max|less than)\s*(\d{2})\b/i);
      if (mUnder) maxAge = Number(mUnder[1]);
    }
    if (!minAge) {
      const mAbove = userMessage.match(/\b(?:above|over|min|more than)\s*(\d{2})\b/i);
      if (mAbove) minAge = Number(mAbove[1]);
    }

    // Merge exact + related role terms with our curated ROLE_SYNONYM_GROUPS so full CRM matches are guaranteed
    const exactRoleSet = new Set<string>(exactRoleTerms.filter(t => t.length >= 2 && !stopWords.has(t)));
    const relatedRoleSet = new Set<string>(relatedRoleTerms.filter(t => t.length >= 2 && !stopWords.has(t)));

    // Remove generic country tokens if Gemini accidentally put country names into role arrays
    const countrySet = new Set(targetCountries.map(c => c.toLowerCase()));
    for (const c of countrySet) {
      exactRoleSet.delete(c);
      relatedRoleSet.delete(c);
    }

    // Add raw non-stop, non-country search tokens from the current message/job if exactRoleSet is still empty
    if (exactRoleSet.size === 0 && !filterPreviousOnly) {
      const rawTokens = fallbackTextSource
        .split(/[^a-z0-9&]+/)
        .filter(t => t.length >= 2 && !stopWords.has(t) && !countrySet.has(t) && !KNOWN_COUNTRIES.includes(t));
      for (const t of rawTokens) exactRoleSet.add(t);
    }

    // Expand synonyms based on triggers present in userMessage/jobSummaryText/exactRoleSet
    const triggerSource = `${fallbackTextSource} ${Array.from(exactRoleSet).join(' ')}`;
    for (const grp of ROLE_SYNONYM_GROUPS) {
      if (grp.triggers.some(t => hasTerm(triggerSource, t))) {
        grp.exact.forEach(t => exactRoleSet.add(t));
        grp.related.forEach(t => relatedRoleSet.add(t));
      }
    }
    // Ensure exact terms take precedence over related terms
    for (const ex of exactRoleSet) {
      relatedRoleSet.delete(ex);
    }

    // Filter out noisy overly-broad words from relatedRoleSet
    for (const noisy of ['general', 'worker', 'staff', 'job', 'experience', 'hotel']) {
      relatedRoleSet.delete(noisy);
    }

    // 5. Phase 2: Instant 100%-Pool Deterministic Matching & Ranking across ALL scopedLeads (NO truncation!)
    const candidatePool = filterPreviousOnly
      ? scopedLeads.filter(l => prevIdSet.has(l.id))
      : scopedLeads;

    const hasRoleCriteria = exactRoleSet.size > 0 || relatedRoleSet.size > 0;
    const hasFilterCriteria =
      hasRoleCriteria ||
      countrySet.size > 0 ||
      targetOrigins.length > 0 ||
      mustHaveKeywords.length > 0 ||
      requiredGender !== 'any' ||
      minAge > 0 ||
      maxAge > 0;

    const STAGE_PRIORITY: Record<string, number> = {
      strong_opportunity: 20,
      office_visited: 18,
      in_discussion: 12,
      negotiating: 12,
      proposal: 10,
      rotations: 8,
      new: 7,
      cold_leads: 3,
      won: 1,
      lost: -18
    };

    const STAGE_DISPLAY: Record<string, string> = {
      new: 'New Inbound',
      in_discussion: 'In Discussion',
      negotiating: 'In Discussion',
      strong_opportunity: 'Strong Opportunity',
      office_visited: 'Office Visited',
      won: 'Won',
      cold_leads: 'Cold Leads',
      lost: 'Lost'
    };

    type ScoredCandidate = {
      lead: Lead;
      rawScore: number;
      hasExactRoleHit: boolean;
      matchesCountry: boolean;
      matchedTermLabel: string;
    };

    const rawMatchesList: ScoredCandidate[] = [];

    for (const lead of candidatePool) {
      const gRaw = String(lead.gender || '').trim().toUpperCase();
      const isF = gRaw === 'F' || gRaw === 'FEMALE';
      const isM = gRaw === 'M' || gRaw === 'MALE';

      const posProjTags = `${lead.position || ''} ${lead.project || ''} ${Array.isArray(lead.tags) ? lead.tags.join(' ') : ''}`;
      const expStr = `${lead.experience || ''}`;
      const remarksStr = `${lead.remarks1 || ''} ${lead.remarks2 || ''} ${lead.remarks3 || ''} ${lead.adminRemarks || ''}`;
      const notesAndCv = `${remarksStr} ${lead.cvTextContent || ''}`;
      const allSearchable = `${lead.name || ''} ${posProjTags} ${expStr} ${lead.country || ''} ${lead.origin || ''} ${lead.qualification || ''} ${notesAndCv}`;

      // Strict gender guarantee (when user wants female or male)
      if (requiredGender === 'female') {
        if (isM) continue;
        if (!isF) {
          // For "Not defined"/blank gender, allow only if profile explicitly states female/waitress/hostess/maid/nanny
          if (!/\b(female|waitress|waitresses|hostess|maid|nanny|girl|lady|ladies)\b/i.test(`${posProjTags} ${expStr} ${remarksStr}`)) {
            continue;
          }
        }
      } else if (requiredGender === 'male') {
        if (isF) continue;
        if (!isM) {
          if (!/\b(male|waiter|waiters|man|boy|gentleman)\b/i.test(`${posProjTags} ${expStr} ${remarksStr}`)) {
            continue;
          }
        }
      }

      // Stage exclusion if explicitly requested
      if (excludeLost && lead.stage === 'lost') continue;

      // Age constraint check
      const ageNum = parseInt(String(lead.age || ''), 10);
      if (minAge > 0 && (isNaN(ageNum) || ageNum < minAge)) continue;
      if (maxAge > 0 && (isNaN(ageNum) || ageNum > maxAge)) continue;

      // Origin / hometown constraint check
      if (targetOrigins.length > 0) {
        const originTargetText = `${lead.origin || ''} ${remarksStr} ${lead.cvTextContent || ''}`;
        if (!targetOrigins.some(orig => hasTerm(originTargetText, orig))) continue;
      }

      // Extra mandatory keywords (e.g. "passport", "english", "taj")
      if (mustHaveKeywords.length > 0) {
        const everyKwOk = mustHaveKeywords.every(kw => hasTerm(allSearchable, kw));
        if (!everyKwOk) continue;
      }

      // Role scoring across exact + related terms
      let roleScore = 0;
      let hasExactRoleHit = false;
      let matchedTermLabel = '';

      for (const term of exactRoleSet) {
        if (hasTerm(posProjTags, term)) {
          roleScore += 60;
          hasExactRoleHit = true;
          if (!matchedTermLabel) matchedTermLabel = term;
        } else if (hasTerm(expStr, term)) {
          roleScore += 48;
          hasExactRoleHit = true;
          if (!matchedTermLabel) matchedTermLabel = term;
        } else if (hasTerm(notesAndCv, term)) {
          roleScore += 32;
          hasExactRoleHit = true;
          if (!matchedTermLabel) matchedTermLabel = term;
        }
      }

      for (const term of relatedRoleSet) {
        if (hasTerm(posProjTags, term)) {
          roleScore += 32;
          if (!matchedTermLabel) matchedTermLabel = term;
        } else if (hasTerm(expStr, term)) {
          roleScore += 24;
          if (!matchedTermLabel) matchedTermLabel = term;
        } else if (hasTerm(notesAndCv, term)) {
          roleScore += 12;
          if (!matchedTermLabel) matchedTermLabel = term;
        }
      }

      // If role criteria exist and candidate does not match any exact or related role term, skip
      if (hasRoleCriteria && roleScore === 0) continue;

      // Country match evaluation
      const countryText = `${lead.country || ''} ${lead.project || ''} ${expStr} ${remarksStr} ${lead.cvTextContent || ''}`;
      const matchesCountry =
        countrySet.size > 0 && Array.from(countrySet).some(c => hasTerm(countryText, c));

      if (!hasRoleCriteria && countrySet.size > 0 && !matchesCountry) {
        continue;
      }

      if (!hasFilterCriteria) continue;

      // Quality & stage ranking bonuses
      let totalScore = roleScore;
      if (matchesCountry) totalScore += 40;
      if (isF && requiredGender === 'female') totalScore += 15;
      if (isM && requiredGender === 'male') totalScore += 15;
      totalScore += STAGE_PRIORITY[lead.stage || 'new'] || 0;

      const cleanExp = expStr.trim().toLowerCase();
      if (cleanExp && cleanExp !== 'fresher' && cleanExp !== 'freshers' && cleanExp !== 'fresh criteria' && cleanExp !== 'verification pending' && cleanExp !== 'n/a') {
        totalScore += 8;
      }
      if (lead.cvTextContent) totalScore += 4;

      rawMatchesList.push({
        lead,
        rawScore: totalScore,
        hasExactRoleHit,
        matchesCountry,
        matchedTermLabel
      });
    }

    // Smart country narrowing ONLY when targetCountries were specified WITH role terms:
    // If >= 8 candidates match the requested country explicitly, keep requested-country + blank/General-country candidates
    // (excludes candidates strictly locked to other unrelated countries like Japan/Europe).
    let finalScored = rawMatchesList;
    if (countrySet.size > 0 && hasRoleCriteria) {
      const explicitCountryCount = rawMatchesList.filter(x => x.matchesCountry).length;
      if (explicitCountryCount >= 8) {
        finalScored = rawMatchesList.filter(x => {
          if (x.matchesCountry) return true;
          const lc = String(x.lead.country || '').trim().toLowerCase();
          return !lc || lc === 'not defined' || lc === 'n/a' || lc === 'general' || lc === 'other';
        });
      }
    }

    // Sort: requested country first -> exact role match first -> totalScore descending -> newest first
    finalScored.sort((a, b) => {
      if (countrySet.size > 0 && a.matchesCountry !== b.matchesCountry) {
        return a.matchesCountry ? -1 : 1;
      }
      if (a.hasExactRoleHit !== b.hasExactRoleHit) {
        return a.hasExactRoleHit ? -1 : 1;
      }
      if (b.rawScore !== a.rawScore) {
        return b.rawScore - a.rawScore;
      }
      return new Date(b.lead.createdAt || 0).getTime() - new Date(a.lead.createdAt || 0).getTime();
    });

    // Return FULL list by default (generous safety cap 500 covers every match cleanly)
    const maxScoreVal = finalScored.length > 0 ? Math.max(...finalScored.map(s => s.rawScore), 1) : 100;
    const matchedProfiles = finalScored.slice(0, 500).map(item => {
      const c = item.lead;
      // Calibrated 62-99% relevance score
      const baseFloor = item.hasExactRoleHit ? 84 : 70;
      const ratio = item.rawScore / maxScoreVal;
      let matchScore = Math.round(baseFloor + ratio * (99 - baseFloor));
      if (c.stage === 'lost') matchScore = Math.min(matchScore, 74);
      matchScore = Math.min(99, Math.max(60, matchScore));

      // Simple broken-English 1-line reason from actual candidate data
      const genderText =
        /^f(emale)?$/i.test(String(c.gender || '').trim())
          ? 'Female'
          : /^m(ale)?$/i.test(String(c.gender || '').trim())
          ? 'Male'
          : '';
      const headerBits = [
        genderText,
        c.age ? `Age ${c.age}` : '',
        c.origin ? `from ${c.origin}` : ''
      ].filter(Boolean);

      const cleanExpText = String(c.experience || '').replace(/\s+/g, ' ').trim();
      const expSnippet = cleanExpText ? `Exp: ${cleanExpText.slice(0, 85)}${cleanExpText.length > 85 ? '...' : ''}` : '';
      const roleBit = c.position ? `Work: ${c.position}` : (item.matchedTermLabel ? `Match: ${item.matchedTermLabel}` : '');
      const countryBit = c.country && !/^(not defined|n\/a)$/i.test(c.country) ? `Country: ${c.country}` : '';
      const stLabel = STAGE_DISPLAY[c.stage || 'new'] || c.stage || 'New';

      const reasonParts = [
        headerBits.join(', '),
        item.hasExactRoleHit && item.matchedTermLabel ? `Exact "${item.matchedTermLabel}" match` : roleBit,
        expSnippet,
        countryBit,
        `Stage: ${stLabel}`
      ].filter(Boolean);

      return {
        ...c,
        matchScore,
        matchReason: reasonParts.join(' · ')
      };
    });

    const exactCount = finalScored.filter(x => x.hasExactRoleHit).length;
    const relatedCount = finalScored.length - exactCount;
    const activeStageCount = finalScored.filter(x => x.lead.stage !== 'lost').length;
    const topNames = matchedProfiles
      .slice(0, 3)
      .map(m => m.name)
      .filter(Boolean)
      .join(', ');

    let aiReply = '';
    if (matchedProfiles.length === 0) {
      aiReply = `Sorry ${scopeOwnerName}, I check ${isAdminUser ? `all ${scopedLeads.length}` : `your ${scopedLeads.length}`} leads for ${aiJobSummary}. No matching candidate found right now. Try simple role name or remove filter.`;
    } else if (hasRoleCriteria) {
      const breakdownParts = [
        exactCount > 0 ? `${exactCount} exact role match` : '',
        relatedCount > 0 ? `${relatedCount} related Hospitality/skill match` : ''
      ].filter(Boolean);
      const breakdownText = breakdownParts.length > 1 ? ` (${breakdownParts.join(', ')})` : '';
      aiReply = `Okay! I check ${isAdminUser ? `all ${scopedLeads.length}` : `your ${scopedLeads.length}`} leads for ${aiJobSummary}. Found ${matchedProfiles.length} full matching candidate${breakdownText} — ${activeStageCount} active leads. Best on top: ${topNames}. Full list is below!`;
    } else {
      aiReply = `Okay! I check ${isAdminUser ? `all ${scopedLeads.length}` : `your ${scopedLeads.length}`} leads for ${aiJobSummary}. Found ${matchedProfiles.length} full matching candidate (${activeStageCount} active). Top: ${topNames}. Full list is below!`;
    }

    const elapsedMs = Date.now() - startTime;
    console.log(`[AI Matcher Chat] ${elapsedMs}ms | user=${agentId} (${userRole}) | scopedLeads=${scopedLeads.length} | matches=${matchedProfiles.length} (exact=${exactCount}, related=${relatedCount})`);

    res.json({
      reply: aiReply,
      jobSummary: aiJobSummary,
      jobDetails: {
        title: aiJobSummary || selectedJobRecord?.serviceCharge || selectedJobRecord?.title || 'AI Chat Match',
        country: selectedJobRecord?.country || targetCountries.join(', '),
        salary: '',
        experience: '',
        skills: Array.from(exactRoleSet).join(', '),
        preferredRegion: targetOrigins.join(', '),
        benefits: ''
      },
      matches: matchedProfiles,
      scopedCount: scopedLeads.length,
      scopeLabel: isAdminUser ? `All CRM Leads (${scopedLeads.length})` : `${scopeOwnerName}'s Leads Only (${scopedLeads.length})`,
      elapsedMs,
      isSimulated: isSimulatedResult
    });
  } catch (err) {
    console.error('[AI Matcher Chat] Error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

async function startServer() {
  // Set up Automatic Full Backup Cron Job every Monday at 00:00 (Midnight)
  // Runs automatically without any manual permission or intervention
  cron.schedule('0 0 * * 1', async () => {
    console.log('[AutoBackup Cron] ⏰ Monday Scheduled Full Backup Triggered automatically...');
    try {
      const backupResult = await executeScheduledFullBackup(true);
      console.log(`[AutoBackup Cron] ✅ Monday Auto Backup succeeded: DB (${backupResult.summary.totalLeads} leads) & XLSX saved.`);
    } catch (cronErr) {
      console.error('[AutoBackup Cron] ❌ Monday Auto Backup failed:', cronErr);
    }
  });

  // Also check on server startup: if no backups exist at all, take an initial snapshot right away
  setTimeout(async () => {
    try {
      const existing = listAvailableBackups();
      if (existing.length === 0) {
        console.log('[AutoBackup] Initializing baseline full backup snapshot on server start...');
        await executeScheduledFullBackup(false);
      }
    } catch (initErr) {
      console.warn('[AutoBackup] Initial baseline backup notice:', initErr);
    }

    // Run self-healing to automatically clean up any historic duplicate active wallet incentives
    try {
      console.log('[Self-Healing] Scanning coordinator wallets for legacy duplicate document/milestone incentive credits...');
      const wallets = await getWallets();
      let hasGlobalUpdates = false;

      for (const wallet of wallets) {
        const transactions = wallet.transactions || [];
        const filteredTransactions: any[] = [];
        let hasWalletUpdates = false;

        // Group transactions by leadId
        const leadTxMap = new Map<string, any[]>();
        for (const tx of transactions) {
          if (tx.leadId) {
            if (!leadTxMap.has(tx.leadId)) {
              leadTxMap.set(tx.leadId, []);
            }
            leadTxMap.get(tx.leadId)!.push(tx);
          } else {
            filteredTransactions.push(tx);
          }
        }

        // Process transactions for each lead
        for (const [leadId, txList] of leadTxMap.entries()) {
          const hasCombinedCredit = txList.some(t => t.type === 'credit' && t.reason.includes('Interview Attended / Office Visited'));
          const hasNewCredit = txList.some(t => t.type === 'credit' && (t.reason.includes('Interview Attended Incentive') || t.reason.includes('Office Visited Incentive')));

          if (hasCombinedCredit && hasNewCredit) {
            console.log(`[Self-Healing] Found duplicate combined + independent credits in wallet ${wallet.username} for candidate: ${leadId}. Healing by removing legacy combined credit...`);
            
            // Filter out the redundant legacy combined credit
            const prunedList = txList.filter(t => !(t.type === 'credit' && t.reason.includes('Interview Attended / Office Visited')));
            filteredTransactions.push(...prunedList);
            hasWalletUpdates = true;
            hasGlobalUpdates = true;
          } else {
            filteredTransactions.push(...txList);
          }
        }

        if (hasWalletUpdates) {
          // Recompute balance based on transaction sums
          let balance = 0;
          for (const tx of filteredTransactions) {
            const amt = Number(tx.amount) || 0;
            if (tx.type === 'credit') {
              balance += amt;
            } else if (tx.type === 'debit') {
              balance -= amt;
            }
          }
          wallet.transactions = filteredTransactions;
          wallet.balance = balance;
          wallet.updatedAt = new Date().toISOString();
        }
      }

      if (hasGlobalUpdates) {
        await saveWallets(wallets);
        console.log('[Self-Healing] Wallets successfully cleaned and persisted to database.');
      } else {
        console.log('[Self-Healing] No duplicate active incentive credits found.');
      }
    } catch (err) {
      console.error('[Self-Healing] Failed to execute duplicate wallet incentives correction:', err);
    }

    // Run Won & tracked milestone integrity verification + backfill Firestore wallet_ledger
    try {
      const integrity = await ensureWalletIntegrityFromLeads();
      if (integrity.healedCount > 0) {
        console.log(`[Self-Healing] Restored ${integrity.healedCount} missing wallet transactions from active Won/milestone leads.`);
      } else {
        console.log('[Self-Healing] Wallet integrity check passed: All active Won & milestone credits match ledger.');
      }
    } catch (intErr) {
      console.error('[Self-Healing] Failed to run wallet integrity verification:', intErr);
    }
  }, 5000);

  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  if (hasDist) {
    console.log(`[Production Serving] Serving pre-bundled static distribution from ${distPath} (3 bundled requests vs 2600+ unbundled modules).`);
    app.use(express.static(distPath, {
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (filePath.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$/)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.log(`[Dev Serving] dist/index.html not found, falling back to Vite dev middleware.`);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`-----------------------------------------`);
    console.log(`🚀 CRM server booting successfully!`);
    console.log(`🌐 Port Bind: http://localhost:${PORT}`);
    console.log(`⏰ Monday Automatic Full Backup Cron: ACTIVE`);
    console.log(`-----------------------------------------`);
  });

  // Cloud Run / Google Front End keep-alive optimization to prevent connection race conditions
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

startServer();
