import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';
import cron from 'node-cron';

// Load environment variables
dotenv.config();

// Load local database helper
import { 
  getLeads, 
  addLead, 
  saveLeads, 
  getStats, 
  getLeadById, 
  getCoordinators, 
  saveCoordinators, 
  initializeCoordinatorsDatabase, 
  getJobs, 
  saveJobs, 
  getUpdates, 
  saveUpdates, 
  getMetadata, 
  saveMetadata, 
  getWallets, 
  saveWallets, 
  getWalletByUsername, 
  addWalletTransaction, 
  getIncentiveRules, 
  saveIncentiveRules,
  createFullDatabaseBackup,
  generateFullXLSXBuffer,
  executeScheduledFullBackup,
  restoreDatabaseFromBackup,
  listAvailableBackups,
  FullDatabaseBackup,
  clearLeadsCache,
  getWhatsAppTemplates,
  saveWhatsAppTemplate,
  deleteWhatsAppTemplate,
  getWhatsAppAutoReplySettings,
  saveWhatsAppAutoReplySettings,
  extractMetaMediaId
} from './src/server/db.ts';
import { Lead, Message, LeadStage, FitScore, Coordinator, Job, ImportantUpdate, Wallet, WalletTransaction, IncentiveRule, WhatsAppTemplate, WhatsAppAutoReplySettings } from './src/types.ts';
import { isDefaultExperience, getEffectiveExperience, getEffectiveIntake } from './src/utils.ts';
import { DEFAULT_WHATSAPP_TEMPLATES, sendWhatsAppMessage, replaceTemplatePlaceholders, formatPhoneForWhatsApp } from './src/server/whatsapp.ts';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ensure uploads directory exists and mount it statically
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

// POST base64 file upload
app.post('/api/upload', (req, res) => {
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

    const fileUrl = `/uploads/${safeName}`;
    console.log(`[UploadSystem] File uploaded: ${safeName} (${buffer.length} bytes)`);
    res.json({ success: true, url: fileUrl, safeName });
  } catch (err: any) {
    console.error('File upload failed:', err);
    res.status(500).json({ error: 'File upload failed' });
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
app.get('/api/health', (req, res) => {
  const hasKey = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';
  res.json({
    status: 'ok',
    aiMode: hasKey ? 'live' : 'simulation',
    hasApiKey: hasKey
  });
});

// GET /api/backup/full-xlsx - Complete Master Database XLSX Backup Download (Zero limitations, 100% of all data)
app.get('/api/backup/full-xlsx', async (req, res) => {
  try {
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
    const backup = await createFullDatabaseBackup('Manual Download via API');
    const todayStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="CGP_CRM_DATABASE_BACKUP_${todayStr}.json"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/backup/list - Get list of all automatic and manual backups on disk
app.get('/api/backup/list', (req, res) => {
  try {
    const backups = listAvailableBackups();
    res.json({ backups });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/backup/trigger - Immediately trigger a full automated backup of both DB and XLSX right now
app.post('/api/backup/trigger', async (req, res) => {
  try {
    const isMonday = req.body?.isMonday === true;
    const result = await executeScheduledFullBackup(isMonday);
    res.json({
      success: true,
      message: 'Automatic full backup executed immediately for both Database JSON and Master XLSX.',
      result
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/backup/restore - Restore DB from uploaded JSON backup payload
app.post('/api/backup/restore', async (req, res) => {
  try {
    const backupData: FullDatabaseBackup = req.body;
    if (!backupData || !backupData.data || !Array.isArray(backupData.data.leads)) {
      return res.status(400).json({ error: 'Invalid backup file structure: missing data.leads array.' });
    }
    const restoreResult = await restoreDatabaseFromBackup(backupData);
    res.json(restoreResult);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/backup/download-file - Download a specific backup file by filename from the backup repository
app.get('/api/backup/download-file', (req, res) => {
  try {
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

// GET all leads with server-side pagination, searching, and filtering
app.get('/api/leads', async (req, res) => {
  try {
    const forceRefresh = req.query.forceRefresh === 'true';
    const showDeleted = req.query.showDeleted === 'true';
    const rawLeads = await getLeads(forceRefresh);

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

    const meta = {
      countries: Array.from(countriesMap.values()).sort((a, b) => a.localeCompare(b)),
      projects: Array.from(projectsMap.values()).sort((a, b) => a.localeCompare(b)),
      positions: Array.from(positionsMap.values()).sort((a, b) => a.localeCompare(b)),
      tags: Array.from(tagsMap.values()).sort((a, b) => a.localeCompare(b))
    };

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

    // 3. Apply multi-layer filters
    let filteredLeads = rawLeads.filter(lead => {
      // Filter by deletion status
      if (!showDeleted && lead.isDeleted) {
        return false;
      }
      if (showDeleted && !lead.isDeleted) {
        return false;
      }

      // Filter out unassigned leads in stage 'new' (Requesting chats in WhatsApp menu)
      // OR leads that have not been intaken yet (intake === false)
      // unless we are specifically inside the 'messages' (WhatsApp Chats) tab view!
      if (activeTab !== 'messages') {
        if (!getEffectiveIntake(lead)) {
          return false;
        }
      }

      // A. Bucket / Agent filter
      if (userRole === 'agent' || bucket === 'my') {
        const agentUsername = String(agentId || '').trim().toLowerCase();
        if (agentUsername) {
          const assignedUsername = String(lead.assignedTo || '').trim().toLowerCase();
          if (assignedUsername !== agentUsername) {
            return false;
          }
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

      // C. Country Interest filter
      if (country && country !== 'All') {
        if (!lead.country || lead.country.trim().toLowerCase() !== country.trim().toLowerCase()) return false;
      }

      // D. Project filter
      if (project && project !== 'All') {
        if (!lead.project || lead.project.trim().toLowerCase() !== project.trim().toLowerCase()) return false;
      }

      // D.5 Target Job Position filter
      if (position && position !== 'All') {
        if (!lead.position || lead.position.trim().toLowerCase() !== position.trim().toLowerCase()) return false;
      }

      // E. Fit score filter
      if (fitScore && fitScore !== 'All') {
        if (!lead.fitScore || lead.fitScore.trim().toLowerCase() !== fitScore.trim().toLowerCase()) return false;
      }

      // F. Tag filter
      if (tag && tag !== 'All') {
        if (!lead.tags || !lead.tags.some(t => t.trim().toLowerCase() === tag.trim().toLowerCase())) return false;
      }

      // G. Coordinator / Telecaller filter
      if (coordinator && coordinator !== 'All') {
        if (coordinator === 'Unassigned') {
          if (lead.assignedTo) return false;
        } else {
          const leadCoord = String(lead.assignedTo || '').trim().toLowerCase();
          const filterCoord = String(coordinator).trim().toLowerCase();
          if (leadCoord !== filterCoord) return false;
        }
      }

      // H. Pipeline Stage filter
      if (stage && stage !== 'All') {
        if (lead.stage !== stage) return false;
      }

      // I. Date wise filter
      if (dateFilter && dateFilter !== 'All') {
        const leadTime = new Date(lead.createdAt).getTime();
        if (isNaN(leadTime)) return true; // fallback to include

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
        if (dateFilter === 'Today') {
          const start = startOfDay(today);
          const end = endOfDay(today);
          if (leadTime < start || leadTime > end) return false;
        } else if (dateFilter === 'Yesterday') {
          const yesterday = new Date();
          yesterday.setDate(today.getDate() - 1);
          const start = startOfDay(yesterday);
          const end = endOfDay(yesterday);
          if (leadTime < start || leadTime > end) return false;
        } else if (dateFilter === 'Last7Days') {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(today.getDate() - 7);
          const start = startOfDay(sevenDaysAgo);
          const end = endOfDay(today);
          if (leadTime < start || leadTime > end) return false;
        } else if (dateFilter === 'Last30Days') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(today.getDate() - 30);
          const start = startOfDay(thirtyDaysAgo);
          const end = endOfDay(today);
          if (leadTime < start || leadTime > end) return false;
        } else if (dateFilter === 'Custom') {
          const start = customStartDate ? startOfDay(new Date(customStartDate)) : 0;
          const end = customEndDate ? endOfDay(new Date(customEndDate)) : Infinity;
          if (leadTime < start || leadTime > end) return false;
        }
      }

      // J. Gender-wise filter
      if (gender && gender !== 'All') {
        const g = String(lead.gender || '').toUpperCase().trim();
        const filterG = String(gender).toUpperCase().trim();
        if (filterG === 'MALE' || filterG === 'M') {
          if (g !== 'M' && g !== 'MALE') return false;
        } else if (filterG === 'FEMALE' || filterG === 'F') {
          if (g !== 'F' && g !== 'FEMALE') return false;
        }
      }

      // K. Remarks-wise filter
      if (remarksFilter && remarksFilter !== 'All') {
        const r1 = !!(lead.remarks1 && lead.remarks1.trim());
        const r2 = !!(lead.remarks2 && lead.remarks2.trim());
        const r3 = !!(lead.remarks3 && lead.remarks3.trim());

        if (remarksFilter === 'remarks1') {
          if (!r1) return false;
        } else if (remarksFilter === 'remarks2') {
          if (!r2) return false;
        } else if (remarksFilter === 'remarks3') {
          if (!r3) return false;
        } else if (remarksFilter === 'remarks1Only') {
          if (!r1 || r2 || r3) return false;
        } else if (remarksFilter === 'remarks2Only') {
          if (!r2 || r1 || r3) return false;
        } else if (remarksFilter === 'remarks3Only') {
          if (!r3 || r1 || r2) return false;
        } else if (remarksFilter === 'noRemarks') {
          if (r1 || r2 || r3) return false;
        } else if (remarksFilter === 'allRemarks') {
          if (!r1 || !r2 || !r3) return false;
        }
      }

      return true;
    });

    // 4. Return complete or paginated payload
    if (all === 'true') {
      res.json({
        leads: filteredLeads,
        totalCount: filteredLeads.length,
        totalPages: 1,
        page: 1,
        limit: filteredLeads.length,
        meta
      });
      return;
    }

    const totalCount = filteredLeads.length;
    const totalPages = Math.ceil(totalCount / limitNum) || 1;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedLeads = filteredLeads.slice(startIndex, startIndex + limitNum);

    res.json({
      leads: paginatedLeads,
      totalCount,
      totalPages,
      page: pageNum,
      limit: limitNum,
      meta
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST manual lead creation (Admin power)
app.post('/api/leads', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || 'user';
    if (role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: Only administrators are authorized to manually enroll new candidates.' });
      return;
    }

    const { name, phone, alternateNo, gender, age, origin, country, position, experience, qualification, assignedTo, importance, tags, source, project, adminRemarks } = req.body;
    if (!phone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const leads = await getLeads();
    
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

    leads.push(newLead);
    await saveLeads(leads);

    res.status(201).json(newLead);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST Bulk Enrollment of candidates (Admin power)
app.post('/api/leads/bulk', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || 'user';
    if (role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: Only administrators are authorized to bulk enroll candidates.' });
      return;
    }

    const { leads: batchLeads } = req.body;
    if (!Array.isArray(batchLeads) || batchLeads.length === 0) {
      res.status(400).json({ error: 'leads must be a non-empty array' });
      return;
    }

    const currentLeads = await getLeads();
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
      const duplicateExists = currentLeads.some((l: any) => String(l.phone).trim() === cleanPhone) || 
                              newLeadsToAdd.some((l: any) => String(l.phone).trim() === cleanPhone);
      if (duplicateExists) {
        skipped.push(`${formattedName} (${phone}): Already exists in database.`);
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

    // Return user info (excluding password for security)
    res.json({
      success: true,
      user: {
        id: matched.id,
        username: matched.username,
        displayName: matched.displayName,
        role: matched.role
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
    const role = req.headers['x-user-role'] || 'user';
    if (role !== 'admin') {
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
    res.status(500).json({ error: (err as Error).message });
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
    const role = req.headers['x-user-role'] || 'user';
    if (role !== 'admin') {
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
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/coordinators/:id (Admin only)
app.put('/api/coordinators/:id', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || 'user';
    if (role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: Only administrators can manage coordinators.' });
      return;
    }

    const { id } = req.params;
    const { username, displayName, password, role: coordRole } = req.body;

    const coordinators = await getCoordinators();
    const matchedIdx = coordinators.findIndex(c => c.id === id);

    if (matchedIdx === -1) {
      res.status(444).json({ error: 'Coordinator account not found.' });
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
      const leads = await getLeads();
      let updatedLeadsCount = 0;
      leads.forEach(l => {
        if (l.assignedTo && l.assignedTo.toLowerCase() === originalUsername.toLowerCase()) {
          l.assignedTo = cleanUsername;
          updatedLeadsCount++;
        }
      });
      if (updatedLeadsCount > 0) {
        await saveLeads(leads);
      }
    }

    res.json({ success: true, coordinator: coordinators[matchedIdx] });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/coordinators/:id (Admin only)
app.delete('/api/coordinators/:id', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || 'user';
    if (role !== 'admin') {
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
    const leads = await getLeads();
    let updatedLeadsCount = 0;
    leads.forEach(l => {
      if (l.assignedTo && l.assignedTo.toLowerCase() === targetCoord.username.toLowerCase()) {
        l.assignedTo = ''; // reset to unassigned
        updatedLeadsCount++;
      }
    });
    if (updatedLeadsCount > 0) {
      await saveLeads(leads);
    }

    res.json({ success: true, message: `Coordinator ${targetCoord.displayName} successfully deleted.` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
    const role = req.headers['x-user-role'] || 'user';
    if (role !== 'admin') {
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
    res.status(500).json({ error: (err as Error).message });
  }
});


// GET statistics summary
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET single lead by ID
app.get('/api/leads/:id', async (req, res) => {
  try {
    const lead = await getLeadById(req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT update lead fields
app.put('/api/leads/:id', async (req, res) => {
  try {
    const { 
      stage, notes, name, phone, alternateNo, email, budget, fitScore, campaign,
      serialNo, entryDate, assignDate, gender, age, origin, country,
      position, experience, qualification, adminRemarks, assignedTo, importance,
      remarks1, remarks2, remarks3, callConnected, tasks, timeline, tags, source, project,
      docPassportCopy, docResume, docOfficeVisited, docOthers, reminderEnabled,
      autoReplySent, intake, assignedFrom
    } = req.body;
    const leads = await getLeads();
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const lead = leads[idx];

    // Check wallet incentive triggers
    const coordinatorToIncentivize = assignedTo !== undefined ? assignedTo : lead.assignedTo;
    if (coordinatorToIncentivize) {
      const cleanCoord = String(coordinatorToIncentivize).trim().toLowerCase();
      const prevCoord = lead.assignedTo ? String(lead.assignedTo).trim().toLowerCase() : cleanCoord;
      
      // 1. Closed Won Trigger
      const isClosedWonTransition = (stage === 'won' && lead.stage !== 'won');
      if (isClosedWonTransition) {
        try {
          const wallet = await getWalletByUsername(cleanCoord);
          const alreadyCredited = (wallet.transactions || []).some(
            tx => tx.leadId === lead.id && tx.type === 'credit' && tx.reason.includes('Closed Won')
          );
          if (!alreadyCredited) {
            // Dynamic Rule Match with direct country fallbacks
            const rules = await getIncentiveRules();
            let incentiveAmount = 400; // Ultimate fallback default
            const pName = String(project !== undefined ? project : (lead.project || '')).trim().toLowerCase();
            const cName = String(country !== undefined ? country : (lead.country || '')).trim().toLowerCase();
            const cNameLower = cName.trim();
            
            // Set regional baseline defaults first
            if (['japan', 'albania', 'europe', 'malta', 'greece'].includes(cNameLower)) {
              incentiveAmount = 1000;
            } else if (['kuwait', 'dubai', 'qatar', 'u.a.e', 'oman'].includes(cNameLower)) {
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
              // Sort by specificity
              matchedRules.sort((a, b) => {
                const aProjSpecific = !['all', 'any', ''].includes((a.projectName || '').trim().toLowerCase());
                const aCtrySpecific = !['all', 'any', '', 'all countries'].includes((a.country || '').trim().toLowerCase());
                const bProjSpecific = !['all', 'any', ''].includes((b.projectName || '').trim().toLowerCase());
                const bCtrySpecific = !['all', 'any', '', 'all countries'].includes((b.country || '').trim().toLowerCase());
                
                const aScore = (aProjSpecific ? 1 : 0) + (aCtrySpecific ? 2 : 0);
                const bScore = (bProjSpecific ? 1 : 0) + (bCtrySpecific ? 2 : 0);
                
                return bScore - aScore; // highest score first
              });
              
              const bestRule = matchedRules[0];
              const bestRuleCtrySpecific = !['all', 'any', '', 'all countries'].includes((bestRule.country || '').trim().toLowerCase());
              
              // Apply matched rule if it is specific to the country. Otherwise, fall back to our premium regions first.
              if (bestRuleCtrySpecific) {
                incentiveAmount = bestRule.amount;
              } else {
                if (['japan', 'albania', 'europe', 'malta', 'greece'].includes(cNameLower)) {
                  incentiveAmount = 1000;
                } else if (['kuwait', 'dubai', 'qatar', 'u.a.e', 'oman'].includes(cNameLower)) {
                  incentiveAmount = 400;
                } else {
                  incentiveAmount = bestRule.amount;
                }
              }
            }
            
            await addWalletTransaction(
              cleanCoord,
              'credit',
              incentiveAmount,
              `Closed Won incentive for candidate: ${name || lead.name} (Project: ${project !== undefined ? project : (lead.project || 'General')}, Country: ${country !== undefined ? country : (lead.country || 'Unknown')})`,
              lead.id
            );

            // Sachin Saha override bonus credit
            if (incentiveAmount === 400 || incentiveAmount === 1000) {
              const sachinBonus = incentiveAmount === 400 ? 100 : 200;
              try {
                const sachinWallet = await getWalletByUsername('sachinsaha');
                const sachinAlreadyCredited = (sachinWallet.transactions || []).some(
                  tx => tx.leadId === lead.id && tx.type === 'credit' && tx.reason.includes('Sachin Saha Override Bonus')
                );
                if (!sachinAlreadyCredited) {
                  await addWalletTransaction(
                    'sachinsaha',
                    'credit',
                    sachinBonus,
                    `Sachin Saha Override Bonus (Sale by: ${cleanCoord}) for candidate: ${name || lead.name} (Project: ${project !== undefined ? project : (lead.project || 'General')}, Country: ${country !== undefined ? country : (lead.country || 'Unknown')})`,
                    lead.id
                  );
                }
              } catch (sachinErr) {
                console.error('Failed to auto-credit Sachin override bonus:', sachinErr);
              }
            }
          }
        } catch (walletErr) {
          console.error('Failed to auto-credit Closed Won incentive:', walletErr);
        }
      }

      // 2. Closed Won Reversal (Debit) Trigger
      const isClosedWonReversal = (lead.stage === 'won' && stage !== undefined && stage !== 'won');
      if (isClosedWonReversal) {
        try {
          const wallet = await getWalletByUsername(prevCoord);
          
          const creditsForLead = (wallet.transactions || []).filter(
            tx => tx.leadId === lead.id && tx.type === 'credit' && tx.reason.includes('Closed Won')
          );
          
          const reversalsForLead = (wallet.transactions || []).filter(
            tx => tx.leadId === lead.id && tx.type === 'debit' && tx.reason.includes('Reversal: Closed Won')
          );
          
          if (creditsForLead.length > reversalsForLead.length) {
            const amountToDebit = creditsForLead[0].amount;
            
            await addWalletTransaction(
              prevCoord,
              'debit',
              amountToDebit,
              `Reversal: Closed Won stage corrected/removed. Candidate: ${name || lead.name} (moved to ${stage})`,
              lead.id
            );
          }

          // Sachin Saha override reversal
          try {
            const sachinWallet = await getWalletByUsername('sachinsaha');
            const sachinCredits = (sachinWallet.transactions || []).filter(
              tx => tx.leadId === lead.id && tx.type === 'credit' && tx.reason.includes('Sachin Saha Override Bonus')
            );
            const sachinReversals = (sachinWallet.transactions || []).filter(
              tx => tx.leadId === lead.id && tx.type === 'debit' && tx.reason.includes('Reversal: Sachin Saha Override Bonus')
            );
            if (sachinCredits.length > sachinReversals.length) {
              const amountToDebitSachin = sachinCredits[0].amount;
              await addWalletTransaction(
                'sachinsaha',
                'debit',
                amountToDebitSachin,
                `Reversal: Sachin Saha Override Bonus (Stage corrected/removed for candidate: ${name || lead.name})`,
                lead.id
              );
            }
          } catch (sachinErr) {
            console.error('Failed to auto-debit Sachin override bonus reversal:', sachinErr);
          }
        } catch (walletErr) {
          console.error('Failed to auto-debit Closed Won reversal:', walletErr);
        }
      }

      // 3. Interview Attended / Office Visited Trigger & Reversal
      const wasOfficeVisitedActive = !!(
        lead.docOfficeVisited || 
        lead.stage === 'proposal' || 
        lead.stage === 'won'
      );
      
      const isOfficeVisitedActiveNow = !!(
        (docOfficeVisited !== undefined ? docOfficeVisited : lead.docOfficeVisited) || 
        (stage !== undefined ? stage : lead.stage) === 'proposal' ||
        (stage !== undefined ? stage : lead.stage) === 'won'
      );

      const isOfficeVisitedTransition = 
        (!wasOfficeVisitedActive && isOfficeVisitedActiveNow) || 
        (stage === 'proposal' && lead.stage !== 'proposal' && lead.stage !== 'won') ||
        (docOfficeVisited === true && !lead.docOfficeVisited);
      const isOfficeVisitedReversal = wasOfficeVisitedActive && !isOfficeVisitedActiveNow;

      if (isOfficeVisitedTransition) {
        try {
          const wallet = await getWalletByUsername(cleanCoord);
          const alreadyCredited = (wallet.transactions || []).some(
            tx => tx.leadId === lead.id && tx.type === 'credit' && (tx.reason.includes('Interview Attended') || tx.reason.includes('Office Visited'))
          );
          if (!alreadyCredited) {
            await addWalletTransaction(
              cleanCoord,
              'credit',
              11,
              `Interview Attended / Office Visited incentive for candidate: ${name || lead.name}`,
              lead.id
            );
          }
        } catch (walletErr) {
          console.error('Failed to auto-credit Office Visited incentive:', walletErr);
        }
      }

      if (isOfficeVisitedReversal) {
        try {
          const wallet = await getWalletByUsername(prevCoord);
          const creditsForLead = (wallet.transactions || []).filter(
            tx => tx.leadId === lead.id && tx.type === 'credit' && (tx.reason.includes('Interview Attended') || tx.reason.includes('Office Visited'))
          );
          const reversalsForLead = (wallet.transactions || []).filter(
            tx => tx.leadId === lead.id && tx.type === 'debit' && tx.reason.includes('Reversal: Interview Attended')
          );
          if (creditsForLead.length > reversalsForLead.length) {
            await addWalletTransaction(
              prevCoord,
              'debit',
              11,
              `Reversal: Interview Attended / Office Visited milestone removed. Candidate: ${name || lead.name}`,
              lead.id
            );
          }
        } catch (walletErr) {
          console.error('Failed to auto-debit Office Visited reversal:', walletErr);
        }
      }
    }
    
    // Ensure lists exist
    if (!lead.timeline) lead.timeline = [];
    if (!lead.tasks) lead.tasks = [];

    // Actor context
    const actorRole = req.headers['x-user-role'] || 'user';
    const rawAgentId = (req.headers['x-agent-id'] as string) || lead.assignedTo || 'System';
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
      lead.stage = stage as LeadStage;
    }

    // Log Coordinator assignments
    let isAssignDateSetByServer = false;
    if (assignedTo !== undefined && lead.assignedTo !== assignedTo) {
      const isFromWa = assignedFrom === 'whatsapp_chat_menu' || req.headers['x-assigned-from'] === 'whatsapp_chat_menu';
      const suffix = isFromWa ? ' via WhatsApp Chat Menu' : '';
      lead.timeline.push({
        id: `tl_${Date.now()}_assign`,
        type: 'assignment',
        text: `Assigned coordinator changed from "${lead.assignedTo || 'Unassigned'}" to "${assignedTo || 'Unassigned'}"${suffix}`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.assignedTo = assignedTo;
      lead.assignDate = new Date().toISOString().split('T')[0];
      isAssignDateSetByServer = true;
      if (isFromWa) {
        lead.assignedFrom = 'whatsapp_chat_menu';
      }

      // Automatically set intake to true and generate serialNo when assigned to a real coordinator
      const hasRealCoordinator = assignedTo && assignedTo.trim() !== '' && assignedTo.toLowerCase() !== 'unassigned' && assignedTo.toLowerCase() !== 'all';
      if (hasRealCoordinator) {
        lead.intake = true;
        if (!lead.serialNo) {
          const sequence = leads.filter(l => l.intake && l.serialNo).length + 1;
          lead.serialNo = `INQ-${1000 + sequence}`;
        }
      }
    }

    // Auto-move stage from 'new' (New Inbound) to 'negotiating' (In Discussion) when the 1'st remark is logged
    if (lead.stage === 'new') {
      const isAddingRemark = 
        (remarks1 !== undefined && remarks1.trim() !== '' && !lead.remarks1) ||
        (remarks2 !== undefined && remarks2.trim() !== '' && !lead.remarks2) ||
        (remarks3 !== undefined && remarks3.trim() !== '' && !lead.remarks3);
      if (isAddingRemark) {
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

    // Log Remarks column logs
    if (remarks1 !== undefined && lead.remarks1 !== remarks1) {
      lead.timeline.push({
        id: `tl_${Date.now()}_rem1`,
        type: 'remark',
        text: `Updated 1st Remarks: "${remarks1 || 'cleared'}"`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.remarks1 = remarks1;
    }
    if (remarks2 !== undefined && lead.remarks2 !== remarks2) {
      lead.timeline.push({
        id: `tl_${Date.now()}_rem2`,
        type: 'remark',
        text: `Updated 2nd Remarks: "${remarks2 || 'cleared'}"`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.remarks2 = remarks2;
    }
    if (remarks3 !== undefined && lead.remarks3 !== remarks3) {
      lead.timeline.push({
        id: `tl_${Date.now()}_rem3`,
        type: 'remark',
        text: `Updated 3rd Remarks: "${remarks3 || 'cleared'}"`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.remarks3 = remarks3;
    }

    if (adminRemarks !== undefined && lead.adminRemarks !== adminRemarks) {
      lead.timeline.push({
        id: `tl_${Date.now()}_adminrem`,
        type: 'remark',
        text: `Updated Admin Remarks: "${adminRemarks || 'cleared'}"`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.adminRemarks = adminRemarks;
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
    if (notes !== undefined) lead.notes = notes;
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
    if (adminRemarks !== undefined) lead.adminRemarks = adminRemarks;
    if (importance !== undefined) lead.importance = Number(importance);
    if (source !== undefined) lead.source = source;
    if (project !== undefined) lead.project = project;
    if (callConnected !== undefined) lead.callConnected = callConnected;

    // Document received status flags
    if (docPassportCopy !== undefined) lead.docPassportCopy = Boolean(docPassportCopy);
    if (docResume !== undefined) lead.docResume = Boolean(docResume);
    if (docOfficeVisited !== undefined) lead.docOfficeVisited = Boolean(docOfficeVisited);
    if (docOthers !== undefined) lead.docOthers = Boolean(docOthers);
    if (reminderEnabled !== undefined) lead.reminderEnabled = Boolean(reminderEnabled);
    if (autoReplySent !== undefined) lead.autoReplySent = Boolean(autoReplySent);
    if (intake !== undefined) {
      lead.intake = Boolean(intake);
      if (Boolean(intake) && !lead.serialNo) {
        const sequence = leads.filter(l => l.intake && l.serialNo).length + 1;
        lead.serialNo = `INQ-${1000 + sequence}`;
      }
    }

    // Direct overrides for tasks and custom timelines
    if (tasks !== undefined) lead.tasks = tasks;
    if (timeline !== undefined) lead.timeline = timeline;
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
    leads[idx] = lead;
    await saveLeads(leads);

    res.json(lead);
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
    res.status(500).json({ error: err.message });
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
    const initialLeads = await getLeads();
    const leadIdx = initialLeads.findIndex(l => l.id === leadId);
    if (leadIdx === -1) return;
    const initialLead = initialLeads[leadIdx];

    if (initialLead.autoReplySent) {
      console.log(`[AutoReply] Skip scheduling. Lead ${initialLead.name} already received or scheduled an auto-reply.`);
      return;
    }

    const hasPriorAutoReply = (initialLead.messages || []).some(m => 
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
    if (hasPriorAutoReply) {
      initialLead.autoReplySent = true;
      initialLead.updatedAt = new Date().toISOString();
      initialLeads[leadIdx] = initialLead;
      clearLeadsCache();
      await saveLeads(initialLeads);
      console.log(`[AutoReply] Skip scheduling. Lead ${initialLead.name} already had prior auto-reply message. Synchronized flag.`);
      return;
    }

    // Set persistent lock immediately to avoid concurrent schedule triggers from quick user double-messages!
    initialLead.autoReplySent = true;
    initialLead.updatedAt = new Date().toISOString();
    initialLeads[leadIdx] = initialLead;
    clearLeadsCache();
    await saveLeads(initialLeads);
    console.log(`[AutoReply] Lock flag set and saved for ${initialLead.name}. Scheduling delayed execution...`);

    const delayMs = Math.max(0, settings.delay) * 1000;
    console.log(`[AutoReply] Scheduling auto-reply for ${initialLead.name} with a delay of ${delayMs}ms...`);
    
    setTimeout(async () => {
      try {
        // Check 2 (Upon execution): Re-fetch freshest state and double-check messages
        const leads = await getLeads();
        const matchIdx = leads.findIndex(l => l.id === leadId);
        if (matchIdx === -1) return;

        const lead = leads[matchIdx];
        
        const doubleCheckPrior = (lead.messages || []).some(m => 
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
        if (doubleCheckPrior) {
          console.log(`[AutoReply] Skip execution. Lead ${lead.name} already received an auto-reply message.`);
          return;
        }

        // Construct reply text using placeholders
        const replyText = replaceTemplatePlaceholders(settings.text, lead, 'CGP Auto-Reply');

        console.log(`[AutoReply] Triggering auto-reply to ${lead.name} (${leadPhone})...`);

        // Send the message
        const result = await sendWhatsAppMessage(leadPhone, replyText, leadName);

        if (result.success) {
          const autoReplyMsg: Message = {
            id: result.messageId || `msg_auto_${Date.now()}`,
            sender: 'system',
            senderName: 'CGP Auto-Reply',
            text: replyText,
            timestamp: new Date().toISOString(),
            status: 'sent',
            channel: 'whatsapp'
          };

          if (!Array.isArray(lead.messages)) lead.messages = [];
          lead.messages.push(autoReplyMsg);

          if (!Array.isArray(lead.timeline)) lead.timeline = [];
          lead.timeline.push({
            id: `tl_${Date.now()}_autoreply`,
            type: 'message',
            text: `Automated WhatsApp Reply Sent: "${replyText.substring(0, 75)}"`,
            actor: 'System',
            timestamp: new Date().toISOString()
          });

          lead.updatedAt = new Date().toISOString();
          leads[matchIdx] = lead;
          clearLeadsCache();
          await saveLeads(leads);
          console.log(`[AutoReply] Auto-reply successfully sent and saved.`);

          // Transition auto-reply to 'delivered' in background after 1.5 seconds
          const autoMsgId = autoReplyMsg.id;
          const targetLeadId = lead.id;
          setTimeout(async () => {
            try {
              const latestLeads = await getLeads();
              const lIdx = latestLeads.findIndex(l => l.id === targetLeadId);
              if (lIdx !== -1) {
                const l = latestLeads[lIdx];
                const mIdx = (l.messages || []).findIndex(m => m.id === autoMsgId);
                if (mIdx !== -1 && l.messages[mIdx].status === 'sent') {
                  l.messages[mIdx].status = 'delivered';
                  clearLeadsCache();
                  await saveLeads(latestLeads);
                  console.log(`[AutoReplyStatus] Transitioned auto-reply message ${autoMsgId} to 'delivered'`);
                }
              }
            } catch (err) {
              console.error('Error transitioning auto-reply to delivered:', err);
            }
          }, 1500);
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
    const { phone, name, initialMessage, position, country, assignedTo } = req.body;
    if (!phone || !String(phone).trim()) {
      res.status(400).json({ error: 'Phone number is required to start a chat.' });
      return;
    }

    const cleanPhone = String(phone).trim();
    const userRole = (req.headers['x-user-role'] as string) || 'user';
    const agentId = (req.headers['x-agent-id'] as string) || 'Coordinator';

    const leads = await getLeads();

    // Check if a lead with this phone already exists (normalizing digits)
    const rawTargetDigits = cleanPhone.replace(/[^0-9]/g, '').slice(-10);
    let existingIndex = -1;
    if (rawTargetDigits.length >= 7) {
      existingIndex = leads.findIndex(l => {
        const leadDigits = (l.phone || '').replace(/[^0-9]/g, '').slice(-10);
        return leadDigits === rawTargetDigits;
      });
    }

    let targetLead: Lead;
    const nowIso = new Date().toISOString();
    const isNewLead = existingIndex === -1;

    if (existingIndex !== -1) {
      targetLead = leads[existingIndex];
      // Update name if provided and existing is generic
      if (name && name.trim() && (!targetLead.name || targetLead.name === 'Unnamed Candidate' || targetLead.name === 'WhatsApp Contact')) {
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
    if (initialMessage && String(initialMessage).trim()) {
      const msgText = String(initialMessage).trim();
      deliveryResult = await sendWhatsAppMessage(
        targetLead.phone,
        msgText,
        targetLead.name
      );

      const senderName = userRole === 'admin' ? 'Administrator' : `Coordinator (${agentId})`;
      const newMessage: Message = {
        id: deliveryResult?.messageId || `m_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        sender: 'user',
        senderName,
        text: msgText,
        timestamp: nowIso,
        status: 'sent',
        channel: 'whatsapp'
      };

      if (!Array.isArray(targetLead.messages)) {
        targetLead.messages = [];
      }
      targetLead.messages.push(newMessage);

      // Transition to 'delivered' in background after 1.5 seconds
      const msgId = newMessage.id;
      const targetLeadId = targetLead.id;
      setTimeout(async () => {
        try {
          const latestLeads = await getLeads();
          const lIdx = latestLeads.findIndex(l => l.id === targetLeadId);
          if (lIdx !== -1) {
            const l = latestLeads[lIdx];
            const mIdx = (l.messages || []).findIndex(m => m.id === msgId);
            if (mIdx !== -1 && l.messages[mIdx].status === 'sent') {
              l.messages[mIdx].status = 'delivered';
              clearLeadsCache();
              await saveLeads(latestLeads);
              console.log(`[MessageStatus] Auto-transitioned start-chat message ${msgId} to 'delivered'`);
            }
          }
        } catch (err) {
          console.error('Error transitioning message to delivered:', err);
        }
      }, 1500);

      if (!Array.isArray(targetLead.timeline)) {
        targetLead.timeline = [];
      }
      targetLead.timeline.push({
        id: `tl_${Date.now()}_startmsg`,
        type: 'message',
        text: `Sent initial WhatsApp message: "${msgText.length > 80 ? msgText.substring(0, 77) + '...' : msgText}"`,
        actor: senderName,
        timestamp: nowIso
      });
    }

    targetLead.updatedAt = nowIso;
    if (existingIndex !== -1) {
      leads[existingIndex] = targetLead;
    }
    await saveLeads(leads);

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
    res.status(500).json({ error: 'Failed to save template' });
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
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Sync templates from Meta Business
app.post('/api/whatsapp/templates/sync', async (req, res) => {
  try {
    console.log('[System] Syncing templates from Meta Business...');
    // TODO: Implement actual API call with credentials
    res.json({ success: true, message: 'Sync triggered (stub)' });
  } catch (err: any) {
    console.error('Failed to sync templates:', err);
    res.status(500).json({ error: 'Failed to sync templates' });
  }
});

// POST mark all WhatsApp messages for a lead as read
app.post('/api/leads/:id/read', async (req, res) => {
  try {
    const leads = await getLeads();
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const lead = leads[idx];
    let changed = false;
    if (Array.isArray(lead.messages)) {
      lead.messages.forEach(m => {
        if (m.sender === 'lead' && m.status !== 'read') {
          m.status = 'read';
          changed = true;
        }
      });
    }

    if (changed) {
      clearLeadsCache();
      await saveLeads(leads);
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to mark messages as read:', err);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// POST send WhatsApp message to a lead (Outbound via Meta Cloud API)
app.post('/api/leads/:id/messages', async (req, res) => {
  try {
    const { text, sender, senderName, templateName, channel, type, mediaUrl, fileName, fileSize, replyToId, replyToText, replyToSender } = req.body;
    
    // For media messages, body text is optional (can act as a caption)
    const msgType = type || 'text';
    const isMedia = msgType !== 'text';
    const messageText = (text || '').trim() || (msgType === 'image' ? 'Sent an image' : msgType === 'pdf' ? 'Sent a PDF document' : 'Sent a document');

    const leads = await getLeads();
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const lead = leads[idx];
    const userRole = req.headers['x-user-role'] || 'user';
    const agentId = (req.headers['x-agent-id'] as string) || senderName || 'Coordinator';

    // Build absolute URL for Meta Cloud API to download if it's a local/relative URL
    let absoluteMediaUrl = mediaUrl;
    if (mediaUrl && mediaUrl.startsWith('/')) {
      absoluteMediaUrl = `${req.protocol}://${req.get('host')}${mediaUrl}`;
    }

    // Dispatch directly via Meta Cloud API or Sandbox Engine
    const isOutbound = sender !== 'lead';
    let deliveryResult: { success: boolean; channel: string; status: 'sent' | 'delivered' | 'read'; messageId?: string; details?: any } = {
      success: true,
      channel: 'simulation',
      status: 'delivered'
    };
    if (isOutbound && lead.phone) {
      deliveryResult = await sendWhatsAppMessage(
        lead.phone,
        messageText,
        lead.name,
        templateName,
        absoluteMediaUrl,
        msgType,
        fileName
      );
    }

    const isOutboundSender = (sender || 'user') !== 'lead';
    const newMessage: Message = {
      id: deliveryResult?.messageId || `m_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sender: sender || 'user',
      senderName: senderName || (sender === 'lead' ? lead.name : (agentId === 'admin' ? 'Administrator' : agentId)),
      text: messageText,
      timestamp: new Date().toISOString(),
      status: isOutboundSender ? 'sent' : 'delivered',
      templateName: templateName || undefined,
      channel: channel || 'whatsapp',
      type: msgType,
      mediaUrl: mediaUrl || undefined,
      fileName: fileName || undefined,
      fileSize: fileSize || undefined,
      replyToId: replyToId || undefined,
      replyToText: replyToText || undefined,
      replyToSender: replyToSender || undefined
    };

    if (!Array.isArray(lead.messages)) {
      lead.messages = [];
    }
    lead.messages.push(newMessage);

    // Transition outbound message to 'delivered' in background after 1.5 seconds
    if (isOutboundSender) {
      const msgId = newMessage.id;
      const targetLeadId = lead.id;
      setTimeout(async () => {
        try {
          const latestLeads = await getLeads();
          const lIdx = latestLeads.findIndex(l => l.id === targetLeadId);
          if (lIdx !== -1) {
            const l = latestLeads[lIdx];
            const mIdx = (l.messages || []).findIndex(m => m.id === msgId);
            if (mIdx !== -1 && l.messages[mIdx].status === 'sent') {
              l.messages[mIdx].status = 'delivered';
              clearLeadsCache();
              await saveLeads(latestLeads);
              console.log(`[MessageStatus] Auto-transitioned message ${msgId} to 'delivered'`);
            }
          }
        } catch (err) {
          console.error('Error transitioning message to delivered:', err);
        }
      }, 1500);
    }

    // Auto-record message activity into lead timeline
    if (!Array.isArray(lead.timeline)) {
      lead.timeline = [];
    }

    const timelineSnippet = text.length > 80 ? text.substring(0, 77) + '...' : text;
    lead.timeline.push({
      id: `tl_${Date.now()}_msg`,
      type: 'message',
      text: isOutbound
        ? `Sent WhatsApp message${templateName ? ` [Template: ${templateName}]` : ''}: "${timelineSnippet}"`
        : `Received WhatsApp reply: "${timelineSnippet}"`,
      actor: newMessage.senderName || 'System',
      timestamp: new Date().toISOString()
    });

    lead.updatedAt = new Date().toISOString();
    leads[idx] = lead;
    await saveLeads(leads);

    res.json({ 
      success: true, 
      lead, 
      message: newMessage,
      deliveryResult
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST simulate candidate incoming WhatsApp reply (Inbound)
app.post('/api/leads/:id/simulate-reply', async (req, res) => {
  try {
    const { text, customName } = req.body;
    const leads = await getLeads();
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const lead = leads[idx];
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

    if (!Array.isArray(lead.messages)) {
      lead.messages = [];
    }
    
    // Mark all previous outbound messages as read!
    lead.messages.forEach(m => {
      if (m && m.sender !== 'lead') {
        m.status = 'read';
      }
    });

    lead.messages.push(incomingMessage);

    if (!Array.isArray(lead.timeline)) {
      lead.timeline = [];
    }
    lead.timeline.push({
      id: `tl_${Date.now()}_inbound`,
      type: 'message',
      text: `Received candidate WhatsApp reply: "${replyText.length > 80 ? replyText.substring(0, 77) + '...' : replyText}"`,
      actor: candidateName,
      timestamp: new Date().toISOString()
    });

    lead.updatedAt = new Date().toISOString();
    leads[idx] = lead;
    await saveLeads(leads);

    // Trigger auto-reply if enabled
    handleAutoReplyIfEnabled(lead.id, lead.phone, candidateName);

    res.json({
      success: true,
      lead,
      message: incomingMessage
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST webhook listener for incoming Meta WhatsApp Cloud API / Webhook events
app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    console.log(`[Meta Webhook POST] Received payload:`, JSON.stringify(payload, null, 2));

    // Handle Meta WhatsApp Status Webhook (read receipts, delivery ticks)
    let isStatusUpdate = false;
    const statusesToProcess: { id: string; status: string; recipient_id?: string }[] = [];

    // 1. Check for standard Meta nested statuses array
    if (payload.entry && Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            const val = change.value;
            if (val && val.statuses && Array.isArray(val.statuses)) {
              for (const s of val.statuses) {
                if (s.id && s.status) {
                  statusesToProcess.push({
                    id: String(s.id),
                    status: String(s.status),
                    recipient_id: s.recipient_id ? String(s.recipient_id) : undefined
                  });
                }
              }
            }
          }
        }
      }
    }

    // 2. Check for flat or custom/AISensy/Simulation webhook status updates
    // Check if the payload itself represents a status update
    // e.g. { "status": "read", "id": "wamid.ID", "phone": "..." }
    const flatStatusRaw = payload.status || payload.messageStatus || payload.eventStatus || payload.state || payload.event;
    const flatId = payload.messageId || payload.id || payload.wamid || payload.msgId || payload.msg_id;
    const flatPhone = payload.phone || payload.recipient || payload.to || payload.from || payload.mobile || payload.recipient_id;

    if (flatStatusRaw && flatId && !payload.text && !payload.message && !payload.body) {
      let flatStatus = String(flatStatusRaw).toLowerCase();
      if (flatStatus.includes('read')) flatStatus = 'read';
      else if (flatStatus.includes('deliver')) flatStatus = 'delivered';
      else if (flatStatus.includes('sent')) flatStatus = 'sent';
      else if (flatStatus.includes('fail')) flatStatus = 'failed';

      const validStatuses = ['sent', 'delivered', 'read', 'failed'];
      if (validStatuses.includes(flatStatus)) {
        statusesToProcess.push({
          id: String(flatId),
          status: flatStatus,
          recipient_id: flatPhone ? String(flatPhone) : undefined
        });
      }
    }

    // Process all identified status updates (nested and flat)
    if (statusesToProcess.length > 0) {
      isStatusUpdate = true;
      const leads = await getLeads();
      let leadsUpdated = false;

      for (const s of statusesToProcess) {
        const wamid = s.id;
        const newStatus = s.status; // 'sent' | 'delivered' | 'read' | 'failed'
        const recipientId = s.recipient_id;
        console.log(`[Meta Webhook POST] Processing status update: ID "${wamid}" to "${newStatus}" for recipient "${recipientId || 'unknown'}"`);

        let matched = false;

        // A. Primary Match: Find by exact message ID
        for (let i = 0; i < leads.length; i++) {
          const lead = leads[i];
          if (Array.isArray(lead.messages)) {
            const mIdx = lead.messages.findIndex(m => m.id === wamid);
            if (mIdx !== -1) {
              matched = true;
              const oldStatus = lead.messages[mIdx].status;
              const statusPriority = { 'sent': 1, 'delivered': 2, 'read': 3, 'failed': 0 };
              const oldPriority = statusPriority[oldStatus as keyof typeof statusPriority] || 0;
              const newPriority = statusPriority[newStatus as keyof typeof statusPriority] || 0;

              if (newPriority > oldPriority || newStatus === 'failed') {
                lead.messages[mIdx].status = newStatus as 'sent' | 'delivered' | 'read' | 'failed';
                leadsUpdated = true;
                console.log(`[Meta Webhook POST] Match exact ID: Updated message "${wamid}" status from "${oldStatus}" to "${newStatus}" for lead "${lead.name}"`);
                
                if (newStatus === 'read' && oldStatus !== 'read') {
                  if (!Array.isArray(lead.timeline)) lead.timeline = [];
                  const snippet = (lead.messages[mIdx].text || '').substring(0, 50);
                  lead.timeline.push({
                    id: `tl_${Date.now()}_read_${Math.random().toString(36).substring(2, 5)}`,
                    type: 'message',
                    text: `Candidate read message: "${snippet}..."`,
                    actor: lead.name,
                    timestamp: new Date().toISOString()
                  });
                }
              }
              break;
            }
          }
        }

        // B. Secondary Match: If exact message ID wasn't matched, match by recipient phone number
        if (!matched && recipientId) {
          const cleanRecipient = String(recipientId).replace(/\D/g, '');
          if (cleanRecipient) {
            for (let i = 0; i < leads.length; i++) {
              const lead = leads[i];
              const leadDigits = String(lead.phone || '').replace(/\D/g, '');
              if (leadDigits && (leadDigits.includes(cleanRecipient) || cleanRecipient.includes(leadDigits) || (leadDigits.length >= 10 && cleanRecipient.endsWith(leadDigits.slice(-10))))) {
                if (Array.isArray(lead.messages) && lead.messages.length > 0) {
                  let updatedAny = false;
                  const statusPriority = { 'sent': 1, 'delivered': 2, 'read': 3, 'failed': 0 };
                  const newPriority = statusPriority[newStatus as keyof typeof statusPriority] || 0;

                  // Update any preceding outbound message that isn't read/delivered yet, prioritizing the most recent ones
                  for (let mIdx = lead.messages.length - 1; mIdx >= 0; mIdx--) {
                    const m = lead.messages[mIdx];
                    if (m && m.sender !== 'lead') {
                      const oldStatus = m.status;
                      const oldPriority = statusPriority[oldStatus as keyof typeof statusPriority] || 0;
                      if (newPriority > oldPriority || newStatus === 'failed') {
                        m.status = newStatus as 'sent' | 'delivered' | 'read' | 'failed';
                        updatedAny = true;
                        console.log(`[Meta Webhook POST] Match phone secondary: Updated message "${m.id}" status from "${oldStatus}" to "${newStatus}" for lead "${lead.name}"`);

                        if (newStatus === 'read' && oldStatus !== 'read') {
                          if (!Array.isArray(lead.timeline)) lead.timeline = [];
                          const snippet = (m.text || '').substring(0, 50);
                          lead.timeline.push({
                            id: `tl_${Date.now()}_read_${Math.random().toString(36).substring(2, 5)}`,
                            type: 'message',
                            text: `Candidate read message: "${snippet}..."`,
                            actor: lead.name,
                            timestamp: new Date().toISOString()
                          });
                        }
                      }
                    }
                  }

                  if (updatedAny) {
                    leadsUpdated = true;
                  }
                }
                break;
              }
            }
          }
        }
      }

      if (leadsUpdated) {
        clearLeadsCache();
        await saveLeads(leads);
        console.log(`[Meta Webhook POST] Saved status updates to database.`);
      }
    }

    if (isStatusUpdate) {
      res.status(200).json({ success: true, processedStatus: true });
      return;
    }

    let fromNumber = payload.destination || payload.from || payload.phone || payload.mobile;
    let messageBody = payload.text || payload.message || payload.body || payload.caption;
    let mediaUrl = payload.mediaUrl || payload.fileUrl || payload.imageUrl || payload.url;
    let mediaType: 'text' | 'image' | 'pdf' | 'document' = 'text';
    let fileName = payload.fileName || payload.filename;
    let fileSize = payload.fileSize || payload.filesize;

    // Support standard Meta WhatsApp Cloud API Webhook JSON structure
    // entry[0].changes[0].value.messages[0]
    if (payload.entry && Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            const val = change.value;
            if (val && val.messages && Array.isArray(val.messages)) {
              for (const m of val.messages) {
                fromNumber = m.from;
                if (m.type === 'text' && m.text) {
                  messageBody = m.text.body;
                } else if (m.type === 'image' && m.image) {
                  mediaType = 'image';
                  messageBody = m.image.caption || 'Sent an image';
                  mediaUrl = m.image.url || m.image.link || m.image.id;
                  fileName = m.image.filename || 'image.jpg';
                } else if (m.type === 'document' && m.document) {
                  const isPdf = m.document.mime_type === 'application/pdf' || String(m.document.filename || '').toLowerCase().endsWith('.pdf');
                  mediaType = isPdf ? 'pdf' : 'document';
                  messageBody = m.document.caption || m.document.filename || 'Sent a document';
                  mediaUrl = m.document.url || m.document.link || m.document.id;
                  fileName = m.document.filename || 'document';
                  fileSize = m.document.file_size ? `${(Number(m.document.file_size) / (1024 * 1024)).toFixed(2)} MB` : 'Unknown size';
                } else if (m.type === 'button') {
                  messageBody = m.button?.text || m.button?.payload;
                } else if (m.type === 'interactive') {
                  messageBody = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || 'Interactive response';
                }
              }
            }
          }
        }
      }
    }

    // Secondary parsing for flattened formats
    if (payload.type === 'image' || payload.messageType === 'image') {
      mediaType = 'image';
      messageBody = messageBody || 'Sent an image';
    } else if (payload.type === 'pdf' || payload.messageType === 'pdf') {
      mediaType = 'pdf';
      messageBody = messageBody || 'Sent a PDF document';
    } else if (payload.type === 'document' || payload.messageType === 'document' || payload.type === 'file' || payload.messageType === 'file') {
      const isPdf = String(fileName || '').toLowerCase().endsWith('.pdf') || String(mediaUrl || '').toLowerCase().includes('.pdf');
      mediaType = isPdf ? 'pdf' : 'document';
      messageBody = messageBody || 'Sent a document';
    }

    // Set fallback body if media is present but caption is absent
    if (!messageBody && mediaUrl) {
      messageBody = mediaType === 'image' ? 'Sent an image' : (mediaType === 'pdf' ? 'Sent a PDF document' : 'Sent a document');
    }

    if (fromNumber && (messageBody || mediaUrl)) {
      const cleanPhone = String(fromNumber).replace(/\D/g, '');
      console.log(`[Meta Webhook POST] Parsing inbound message. Raw phone="${fromNumber}", Clean phone="${cleanPhone}", Message="${messageBody}", MediaUrl="${mediaUrl}"`);

      // Proxy Meta Media IDs through our local /api/whatsapp/media/:mediaId helper endpoint
      let parsedMediaUrl = mediaUrl;
      const extractedId = extractMetaMediaId(mediaUrl);
      if (extractedId) {
        parsedMediaUrl = `/api/whatsapp/media/${extractedId}`;
      } else if (mediaUrl && !mediaUrl.startsWith('http') && !mediaUrl.startsWith('/')) {
        parsedMediaUrl = `/api/whatsapp/media/${mediaUrl}`;
      }

      const leads = await getLeads();
      const matchIdx = leads.findIndex(l => {
        const leadDigits = String(l.phone || '').replace(/\D/g, '');
        if (!leadDigits || !cleanPhone) return false;
        
        // Exact match of digits or suffix overlap (e.g. 10 digits suffix matching)
        const match = leadDigits.includes(cleanPhone) || cleanPhone.includes(leadDigits) ||
          (leadDigits.length >= 10 && cleanPhone.endsWith(leadDigits.slice(-10))) ||
          (cleanPhone.length >= 10 && leadDigits.endsWith(cleanPhone.slice(-10)));
        return match;
      });

      if (matchIdx !== -1) {
        const lead = leads[matchIdx];
        console.log(`[Meta Webhook POST] Match successful! Associated candidate: ID="${lead.id}", Name="${lead.name}"`);

        const incomingMsg: Message = {
          id: `m_hook_${Date.now()}`,
          sender: 'lead',
          senderName: lead.name,
          text: String(messageBody),
          timestamp: new Date().toISOString(),
          status: 'delivered',
          channel: 'whatsapp',
          ...(mediaUrl ? {
            type: mediaType,
            mediaUrl: String(parsedMediaUrl),
            fileName: fileName ? String(fileName) : undefined,
            fileSize: fileSize ? String(fileSize) : undefined
          } : {})
        };

        if (!Array.isArray(lead.messages)) lead.messages = [];
        // Mark all previous outbound messages as read!
        lead.messages.forEach(m => {
          if (m && m.sender !== 'lead') {
            m.status = 'read';
          }
        });
        lead.messages.push(incomingMsg);

        if (!Array.isArray(lead.timeline)) lead.timeline = [];
        lead.timeline.push({
          id: `tl_${Date.now()}_hook`,
          type: 'message',
          text: `Inbound Meta WhatsApp received: "${String(messageBody).substring(0, 75)}"`,
          actor: lead.name,
          timestamp: new Date().toISOString()
        });

        lead.updatedAt = new Date().toISOString();
        leads[matchIdx] = lead;
        clearLeadsCache();
        await saveLeads(leads);
        console.log(`[Meta Webhook POST] Saved inbound message to candidate database and cleared memory cache.`);

        // Trigger auto-reply if enabled
        handleAutoReplyIfEnabled(lead.id, lead.phone, lead.name);
      } else {
        console.warn(`[Meta Webhook POST] Candidate match not found for phone "${cleanPhone}". Adding as new conversion inquiry.`);
        // Fallback: If candidate doesn't exist, create a new Inquiry automatically!
        const cleanNameId = `CONTACT_${cleanPhone.slice(-10)}`;
        const newLeadId = generateUniqueLeadId(leads, cleanNameId);
        
        const newLead: Lead = {
          id: newLeadId,
          serialNo: '',
          entryDate: new Date().toISOString().split('T')[0],
          assignDate: '',
          name: `WhatsApp Lead ${cleanPhone.slice(-10)}`,
          phone: `+${cleanPhone}`,
          gender: 'M',
          age: 24,
          origin: 'Inbound Message',
          country: 'Kuwait',
          position: 'General openings',
          experience: 'Verification pending',
          adminRemarks: 'INBOUND WHATSAPP CONVERSION',
          notes: 'Auto-enrolled from direct WhatsApp conversation reply.',
          assignedTo: 'unassigned',
          importance: 3,
          remarks1: '',
          remarks2: '',
          remarks3: '',
          stage: 'new',
          budget: 0,
          budgetRaw: 'N/A',
          summary: `Inbound WhatsApp message received: "${messageBody}"`,
          requirements: ['WhatsApp Inbound'],
          fitScore: 'medium',
          nextAction: 'Qualify credentials and documents.',
          campaign: 'Direct WhatsApp',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          intake: false,
          messages: [
            {
              id: `msg_inbound_${Date.now()}`,
              sender: 'lead',
              senderName: `WhatsApp Lead ${cleanPhone.slice(-10)}`,
              text: String(messageBody),
              timestamp: new Date().toISOString(),
              status: 'delivered',
              channel: 'whatsapp',
              ...(mediaUrl ? {
                type: mediaType,
                mediaUrl: String(parsedMediaUrl),
                fileName: fileName ? String(fileName) : undefined,
                fileSize: fileSize ? String(fileSize) : undefined
              } : {})
            }
          ]
        };

        clearLeadsCache();
        await addLead(newLead);
        console.log(`[Meta Webhook POST] Created new active lead ID="${newLeadId}" for inbound message and cleared memory cache.`);

        // Trigger auto-reply if enabled
        handleAutoReplyIfEnabled(newLead.id, newLead.phone, newLead.name);
      }
    } else {
      console.warn(`[Meta Webhook POST] Ignored webhook payload. Missing fromNumber ("${fromNumber}") or messageBody ("${messageBody}")`);
    }

    res.status(200).json({ success: true, received: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


// GET WhatsApp Media proxy from Meta
app.get('/api/whatsapp/media/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    const metaToken = process.env.WHATSAPP_API_KEY || process.env.META_WA_ACCESS_TOKEN;
    if (!metaToken || metaToken === 'MY_WHATSAPP_API_KEY' || !metaToken.trim()) {
      return res.status(400).send('WhatsApp API Key is not configured in CRM.');
    }

    console.log(`[Meta Media Proxy] Fetching media info for ID="${mediaId}"`);
    const infoRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: {
        'Authorization': `Bearer ${metaToken.trim()}`
      }
    });

    if (!infoRes.ok) {
      const errorText = await infoRes.text();
      console.error('[Meta Media Proxy] Meta returned error:', errorText);
      return res.status(infoRes.status).send(`Failed to fetch media metadata: ${errorText}`);
    }

    const info = await infoRes.json() as any;
    const mediaUrl = info.url;
    if (!mediaUrl) {
      return res.status(404).send('Media download URL not found in Meta response.');
    }

    console.log(`[Meta Media Proxy] Fetching binary media from Lookaside URL`);
    const binaryRes = await fetch(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${metaToken.trim()}`
      }
    });

    if (!binaryRes.ok) {
      return res.status(binaryRes.status).send('Failed to fetch binary file from Facebook server.');
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
    console.error('[Meta Media Proxy] Exception:', err);
    res.status(500).send(`Internal Media Proxy Error: ${err.message}`);
  }
});


// DELETE a lead (Soft Delete to prevent any accidental permanent data loss)
app.delete('/api/leads/:id', async (req, res) => {
  try {
    const leads = await getLeads();
    const leadIndex = leads.findIndex(l => l.id === req.params.id);
    if (leadIndex === -1) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    
    // Mark as soft-deleted so it can be fully recovered anytime by an administrator
    leads[leadIndex].isDeleted = true;
    leads[leadIndex].deletedAt = new Date().toISOString();
    leads[leadIndex].updatedAt = new Date().toISOString();
    
    await saveLeads(leads);
    console.log(`[Backup System] Lead ${leads[leadIndex].name || req.params.id} was soft-deleted instead of being permanently removed.`);
    res.json({ success: true, message: 'Candidate soft-deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST restore a soft-deleted lead
app.post('/api/leads/:id/restore', async (req, res) => {
  try {
    const leads = await getLeads();
    const leadIndex = leads.findIndex(l => l.id === req.params.id);
    if (leadIndex === -1) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    
    // Restore
    leads[leadIndex].isDeleted = false;
    leads[leadIndex].deletedAt = null;
    leads[leadIndex].updatedAt = new Date().toISOString();
    
    await saveLeads(leads);
    console.log(`[Backup System] Lead ${leads[leadIndex].name || req.params.id} was successfully restored.`);
    res.json({ success: true, message: 'Candidate successfully restored' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});


// ---------------- ACTIVE JOBS CRUD ENDPOINTS ----------------

// GET all active jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await getJobs();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST add a new job
app.post('/api/jobs', async (req, res) => {
  try {
    const { title, country, salaryRange, requirement, positions, processingFeeMale, processingFeeFemale, accommodation, ageLimit, conditions, modeOfInterview, applicability, otherTerms, isActive } = req.body;
    if (!title) {
      res.status(400).json({ error: 'Job title is required.' });
      return;
    }

    const jobs = await getJobs();
    const newJob: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: String(title).trim(),
      country: country ? String(country).trim() : 'Kuwait',
      salaryRange: salaryRange ? String(salaryRange).trim() : '',
      requirement: requirement ? String(requirement).trim() : 'General Requirement',
      positions: Array.isArray(positions) ? positions : undefined,
      processingFeeMale: processingFeeMale ? String(processingFeeMale).trim() : 'No fee listed',
      processingFeeFemale: processingFeeFemale ? String(processingFeeFemale).trim() : 'No fee listed',
      accommodation: accommodation ? String(accommodation).trim() : 'No details provided',
      ageLimit: ageLimit ? String(ageLimit).trim() : 'N/A',
      conditions: Array.isArray(conditions) ? conditions.map(c => String(c).trim()).filter(Boolean) : [],
      modeOfInterview: modeOfInterview ? String(modeOfInterview) : 'Online',
      applicability: applicability ? String(applicability) : 'Both Male & Female can Apply',
      otherTerms: otherTerms ? String(otherTerms).trim() : '',
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      createdAt: new Date().toISOString()
    };

    jobs.unshift(newJob);
    await saveJobs(jobs);

    res.status(201).json(newJob);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT update an existing job
app.put('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, country, salaryRange, requirement, positions, processingFeeMale, processingFeeFemale, accommodation, ageLimit, conditions, modeOfInterview, applicability, otherTerms, isActive } = req.body;

    const jobs = await getJobs();
    const idx = jobs.findIndex(j => j.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const updatedJob = {
      ...jobs[idx],
      title: title !== undefined ? String(title).trim() : (jobs[idx].title || ''),
      country: country !== undefined ? String(country).trim() : (jobs[idx].country || 'Kuwait'),
      salaryRange: salaryRange !== undefined ? String(salaryRange).trim() : (jobs[idx].salaryRange || ''),
      requirement: requirement !== undefined ? String(requirement).trim() : (jobs[idx].requirement || 'General Requirement'),
      positions: positions !== undefined ? (Array.isArray(positions) ? positions : undefined) : jobs[idx].positions,
      processingFeeMale: processingFeeMale !== undefined ? String(processingFeeMale).trim() : (jobs[idx].processingFeeMale || 'No fee listed'),
      processingFeeFemale: processingFeeFemale !== undefined ? String(processingFeeFemale).trim() : (jobs[idx].processingFeeFemale || 'No fee listed'),
      accommodation: accommodation !== undefined ? String(accommodation).trim() : (jobs[idx].accommodation || 'No details provided'),
      ageLimit: ageLimit !== undefined ? String(ageLimit).trim() : (jobs[idx].ageLimit || 'N/A'),
      conditions: conditions !== undefined ? (Array.isArray(conditions) ? conditions.map(c => String(c).trim()).filter(Boolean) : (jobs[idx].conditions || [])) : (jobs[idx].conditions || []),
      modeOfInterview: modeOfInterview !== undefined ? String(modeOfInterview) : (jobs[idx].modeOfInterview || 'Online'),
      applicability: applicability !== undefined ? String(applicability) : (jobs[idx].applicability || 'Both Male & Female can Apply'),
      otherTerms: otherTerms !== undefined ? String(otherTerms).trim() : (jobs[idx].otherTerms || ''),
      isActive: isActive !== undefined ? Boolean(isActive) : (jobs[idx].isActive !== undefined ? jobs[idx].isActive : true)
    };

    jobs[idx] = updatedJob;
    await saveJobs(jobs);

    res.json(updatedJob);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE a job
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const jobs = await getJobs();
    const filtered = jobs.filter(j => j.id !== id);
    if (jobs.length === filtered.length) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    await saveJobs(filtered);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
    res.status(500).json({ error: (err as Error).message });
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
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE an update
app.delete('/api/updates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = await getUpdates();
    const filtered = updates.filter(u => u.id !== id);
    if (updates.length === filtered.length) {
      res.status(404).json({ error: 'Update not found' });
      return;
    }

    await saveUpdates(filtered);
    res.json({ success: true });
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
    res.status(500).json({ error: (err as Error).message });
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
    res.status(500).json({ error: (err as Error).message });
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
    res.status(500).json({ error: (err as Error).message });
  }
});



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

        const response = await ai.models.generateContent({
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

    // Save newly created lead
    const leads = await getLeads();
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
      gender: 'M',
      age: 24,
      origin: 'Online conversion',
      country: finalCampaignName.split(' ')[0] || 'Kuwait',
      position: aiAnalysis.requirements[0] || 'General Opening',
      experience: 'Verification pending',
      adminRemarks: 'META ADS WHATSAPP CONVERSION',
      notes: 'Lead received automatically via Meta Ads Click-to-WhatsApp webhook simulator.',
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

    await addLead(newLead);
    
    // Trigger auto-reply if enabled
    handleAutoReplyIfEnabled(newLead.id, phone, newLead.name);

    res.json({ success: true, lead: newLead, simulated: !ai });

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

    const response = await ai.models.generateContent({
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
    const leads = await getLeads();
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const lead = leads[idx];
    const ai = getGemini();

    if (!ai) {
      // Mock re-qualification: increment budget by 10% and update text in notes
      lead.notes = `${lead.notes}\n[AI Sim Re-qualify ${new Date().toLocaleDateString()}]: Lead context refreshed. Budget maintained.`;
      lead.updatedAt = new Date().toISOString();
      leads[idx] = lead;
      await saveLeads(leads);
      res.json(lead);
      return;
    }

    console.log(`Re-qualifying lead ${lead.name} with live Gemini API...`);

    const formattedTranscript = lead.messages.map(m => `${m.sender === 'lead' ? 'Lead' : 'Sales Rep'}: ${m.text}`).join('\n');

    const promptSystem = `You are a Lead Scoring and Qualification Engine for a WhatsApp Meta CRM.
Analyze the updated chat conversation log and synthesize/refine the lead's profile, requirements, and budget details.
Respond strictly in JSON format. Do not add markdown except for the JSON structure.`;

    const requestPrompt = `Evaluate this active WhatsApp chat log for Lead: ${lead.name}:

Chat history:
${formattedTranscript}

Current lead status:
- Budget Raw: ${lead.budgetRaw}
- Requirements list: ${lead.requirements.join(', ')}
- Summary: ${lead.summary}

Provide updated qualification attributes:
1. budget: Updated numeric budget in USD (0 if unknown).
2. budgetRaw: Cleaned text representation of their budget.
3. summary: Re-synthesized qualification summary (1-2 sentences), adjusting for any newly shared needs, objections, or timeline details.
4. requirements: Array of strings listing confirmed requirements or core topics discussed.
5. fitScore: Adjust fitScore ("high", "medium", "low", "unqualified") based on updated parameters.
6. nextAction: Recommended next action for the sales representative.`;

    const response = await ai.models.generateContent({
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
    if (output) {
      const parsed = JSON.parse(output.trim());
      
      let cleanFitScore: FitScore = lead.fitScore;
      if (['high', 'medium', 'low', 'unqualified'].includes(parsed.fitScore)) {
        cleanFitScore = parsed.fitScore as FitScore;
      }

      lead.budget = Number(parsed.budget) || lead.budget || 0;
      lead.budgetRaw = parsed.budgetRaw || lead.budgetRaw;
      lead.summary = parsed.summary || lead.summary;
      lead.requirements = parsed.requirements || lead.requirements;
      lead.fitScore = cleanFitScore;
      lead.nextAction = parsed.nextAction || lead.nextAction;
      lead.updatedAt = new Date().toISOString();

      // Record system log message
      lead.messages.push({
        id: `sys_${Date.now()}`,
        sender: 'system',
        text: `Lead automatically qualified by Gemini AI. Fit Score: ${cleanFitScore.toUpperCase()}. Next action updated to: "${parsed.nextAction}"`,
        timestamp: new Date().toISOString()
      });

      leads[idx] = lead;
      await saveLeads(leads);
    }

    res.json(lead);

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

    const response = await ai.models.generateContent({
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


// POST Smart AI Candidate Profiler and Matcher
app.post('/api/ai-match-leads', async (req, res) => {
  try {
    const { jobId, textCommand, image } = req.body;

    let jobDetails = {
      title: 'Hotel Receptionist',
      country: 'Maldives/MVR (or other)',
      salary: 'USD 450 per month',
      experience: 'Minimum 3 years as a Receptionist',
      skills: 'Good English communication skills',
      preferredRegion: 'West Bengal, Darjeeling, or Siliguri region',
      benefits: 'Free Food, Free Accommodation'
    };

    // If an existing job was selected, fetch its details and merge
    if (jobId) {
      const jobs = await getJobs();
      const matchedJob = jobs.find(j => j.id === jobId);
      if (matchedJob) {
        jobDetails.title = matchedJob.title || jobDetails.title;
        jobDetails.country = matchedJob.country || jobDetails.country;
        jobDetails.experience = matchedJob.requirement || jobDetails.experience;
        jobDetails.skills = matchedJob.applicability || jobDetails.skills;
        jobDetails.preferredRegion = matchedJob.otherTerms || jobDetails.preferredRegion;
        jobDetails.benefits = (matchedJob.conditions && matchedJob.conditions.join(', ')) || jobDetails.benefits;
      }
    }

    // Parse textCommand details directly if provided without image
    if (textCommand && !image) {
      jobDetails.title = textCommand.split('\n')[0].replace(/Match candidates for/i, '').replace(/role/i, '').replace(/"/g, '').trim() || jobDetails.title;
    }

    const ai = getGemini();
    let isFlyerParsed = false;

    // Phase 1: Flyer Image Visual Extraction using Gemini 3.5 Flash
    if (ai && image) {
      try {
        let base64Data = image;
        let mimeType = 'image/png';
        if (image.startsWith('data:')) {
          const parts = image.split(',');
          base64Data = parts[1];
          const mimeMatch = parts[0].match(/data:(.*?);base64/);
          if (mimeMatch) mimeType = mimeMatch[1];
        }

        const imagePart = {
          inlineData: {
            mimeType,
            data: base64Data
          }
        };

        const parsePrompt = `Analyze this job vacancy flyer/advertisement creative.
Extract the job requirements and details.

CRITICAL INSTRUCTIONS FOR TEXT DEDUPLICATION:
If you notice any phrase, sentence, requirement, slogan, or benefit repeated multiple times in the image, DO NOT repeat them in the JSON output fields. Clean up the extracted text to be unique, concise, and professional. Only extract each piece of information ONCE.

Return a JSON object with these fields:
{
  "title": "the job position title, e.g. Receptionist",
  "country": "the country/region of work, e.g. Maldives, Germany, Qatar",
  "salary": "the salary details listed, e.g. USD 450 per month",
  "experience": "required experience, e.g. 3 years as receptionist. Ensure no repeating lines/text.",
  "skills": "required skills/criteria, e.g. English speaking. Ensure no repeating phrases.",
  "preferredRegion": "any preferred region of origin, e.g. West Bengal, Darjeeling, or Siliguri region",
  "benefits": "benefits listed, e.g. Free food, free accommodation"
}
Ensure the output is valid JSON.`;

        const parseRes = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: { parts: [imagePart, { text: parsePrompt }] },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                country: { type: Type.STRING },
                salary: { type: Type.STRING },
                experience: { type: Type.STRING },
                skills: { type: Type.STRING },
                preferredRegion: { type: Type.STRING },
                benefits: { type: Type.STRING }
              },
              required: ["title"]
            }
          }
        });

        if (parseRes.text) {
          const parsed = JSON.parse(parseRes.text.trim());
          
          // Apply deduplication to all parsed fields to prevent repetitive looping
          if (parsed.title) parsed.title = deduplicateText(parsed.title);
          if (parsed.country) parsed.country = deduplicateText(parsed.country);
          if (parsed.salary) parsed.salary = deduplicateText(parsed.salary);
          if (parsed.experience) parsed.experience = deduplicateText(parsed.experience);
          if (parsed.skills) parsed.skills = deduplicateText(parsed.skills);
          if (parsed.preferredRegion) parsed.preferredRegion = deduplicateText(parsed.preferredRegion);
          if (parsed.benefits) parsed.benefits = deduplicateText(parsed.benefits);

          jobDetails = { ...jobDetails, ...parsed };
          isFlyerParsed = true;
        }
      } catch (parseErr) {
        console.error('Error parsing flyer image with Gemini:', parseErr);
      }
    }

    // Merge custom command rules on top of parsed values if both exist
    if (textCommand && isFlyerParsed) {
      jobDetails.experience += ` | Additional requirement: ${textCommand}`;
    }

    // Apply overall deduplication to ensure final job details are extremely clean
    jobDetails.title = deduplicateText(jobDetails.title);
    jobDetails.country = deduplicateText(jobDetails.country);
    jobDetails.salary = deduplicateText(jobDetails.salary);
    jobDetails.experience = deduplicateText(jobDetails.experience);
    jobDetails.skills = deduplicateText(jobDetails.skills);
    jobDetails.preferredRegion = deduplicateText(jobDetails.preferredRegion);
    jobDetails.benefits = deduplicateText(jobDetails.benefits);

    // Determine required gender from parsed job context
    const combinedJobText = `${jobDetails.title} ${jobDetails.skills} ${jobDetails.experience}`.toLowerCase();
    const requiresFemale = /\b(female|girls|women|woman|lady|ladies)\b/i.test(combinedJobText);
    const requiresMale = /\b(male|boys|men|man|gentleman|gentlemen)\b/i.test(combinedJobText);

    let requiredGender: 'female' | 'male' | 'any' = 'any';
    if (requiresFemale && !requiresMale) {
      requiredGender = 'female';
    } else if (requiresMale && !requiresFemale) {
      requiredGender = 'male';
    }

    const leads = await getLeads();

    // Phase 2: Double-Stage Matching (Fast keyword filter to find top 120 potential fits, then AI score)
    const searchTerms = [
      ...jobDetails.title.toLowerCase().split(/[\s-/]+/),
      ...jobDetails.preferredRegion.toLowerCase().split(/[\s,.-]+/)
    ].filter(t => t && t.length > 2);

    const preScored = leads.map(lead => {
      let score = 0;
      const leadText = `
        ${lead.name} 
        ${lead.position || ''} 
        ${lead.origin || ''} 
        ${lead.experience || ''} 
        ${lead.country || ''} 
        ${lead.remarks1 || ''} 
        ${lead.remarks2 || ''} 
        ${lead.remarks3 || ''}
      `.toLowerCase();

      // Check if this lead is a strict gender mismatch
      const leadGenderStr = String(lead.gender || '').trim().toUpperCase();
      const isLeadFemale = leadGenderStr === 'F' || leadGenderStr === 'FEMALE';
      const isLeadMale = leadGenderStr === 'M' || leadGenderStr === 'MALE';

      let genderMismatch = false;
      if (requiredGender === 'female' && isLeadMale) {
        genderMismatch = true;
      } else if (requiredGender === 'male' && isLeadFemale) {
        genderMismatch = true;
      }

      // Position Match weights high
      if (lead.position && lead.position.toLowerCase().includes(jobDetails.title.toLowerCase())) {
        score += 60;
      }

      // Origin matcher
      const regions = ['darjeeling', 'siliguri', 'bengal', 'sikkim'];
      regions.forEach(r => {
        if (jobDetails.preferredRegion.toLowerCase().includes(r) && leadText.includes(r)) {
          score += 40;
        }
      });

      // Search term index matching
      searchTerms.forEach(term => {
        if (leadText.includes(term)) score += 10;
      });

      if (lead.stage === 'lost') score -= 30; // lower priority for lost leads

      return { lead, preScore: score, genderMismatch };
    });

    // Select the top 120 leads for high-precision Gemini evaluation, filtering out gender mismatches strictly
    const topCandidates = preScored
      .filter(item => !item.genderMismatch)
      .sort((a, b) => b.preScore - a.preScore)
      .slice(0, 120)
      .map(item => item.lead);

    let matchedProfiles: any[] = [];
    let isSimulatedResult = false;

    // Phase 3: AI precision evaluation using Gemini 3.5 Flash JSON schema matching
    if (ai && topCandidates.length > 0) {
      try {
        const systemInstruction = `You are an elite, highly professional AI recruiter for overseas placements.
Evaluate the candidate list against the given Job Demand requirements.
Assign a matching score (0 to 100) based on their skills, gender/age, origin/preferred regions, experience, and Remarks Log.
Strictly respect the required gender constraint (do not match candidates of the wrong gender).
Provide a clear, brief 1-sentence matching explanation.
Return the output strictly in the requested JSON schema.`;

        // Only send the top 25 candidates to Gemini to guarantee sub-2-second responses and save token limits
        const geminiCandidates = topCandidates.slice(0, 25);
        const remainingCandidates = topCandidates.slice(25);

        const evaluationPrompt = `Job Demand Details:
- Title: ${jobDetails.title}
- Target Location: ${jobDetails.country}
- Salary Package: ${jobDetails.salary}
- Required Experience: ${jobDetails.experience}
- Skills Preference: ${jobDetails.skills}
- Origin Group/Region Preference: ${jobDetails.preferredRegion}
- Additional Benefits: ${jobDetails.benefits}
- Required Gender: ${requiredGender === 'female' ? 'Strictly Female Only' : requiredGender === 'male' ? 'Strictly Male Only' : 'Any Gender'}

Candidates to Evaluate:
${JSON.stringify(geminiCandidates.map(c => ({
  id: c.id,
  name: c.name,
  gender: c.gender,
  age: c.age,
  origin: c.origin,
  position: c.position,
  experience: c.experience,
  remarks: `${c.remarks1} ${c.remarks2} ${c.remarks3}`.trim()
})), null, 2)}`;

        const evalRes = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: evaluationPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                matches: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      leadId: { type: Type.STRING },
                      score: { type: Type.INTEGER },
                      reason: { type: Type.STRING }
                    },
                    required: ["leadId", "score", "reason"]
                  }
                }
              },
              required: ["matches"]
            }
          }
        });

        if (evalRes.text) {
          const parsedEval = JSON.parse(evalRes.text.trim());
          const matchMap = new Map<string, { score: number; reason: string }>();
          parsedEval.matches.forEach((m: any) => {
            matchMap.set(m.leadId, { score: m.score, reason: m.reason });
          });

          const geminiEvaluated = geminiCandidates.map(c => {
            const matchInfo = matchMap.get(c.id) || { score: 50, reason: 'Candidate matches general profile criteria.' };
            return {
              ...c,
              matchScore: matchInfo.score,
              matchReason: matchInfo.reason
            };
          });

          // Evaluate the remaining candidates using fast, local, high-quality heuristics
          const heuristicEvaluated = remainingCandidates.map(c => {
            let score = 50;
            let reason = 'Candidate holds general profiles corresponding to position keywords.';

            const leadText = `
              ${c.name} 
              ${c.position || ''} 
              ${c.origin || ''} 
              ${c.experience || ''} 
              ${c.remarks1 || ''} 
              ${c.remarks2 || ''} 
              ${c.remarks3 || ''}
            `.toLowerCase();

            // Double check gender mismatch programmatically just in case
            const leadGenderStr = String(c.gender || '').trim().toUpperCase();
            const isLeadFemale = leadGenderStr === 'F' || leadGenderStr === 'FEMALE';
            const isLeadMale = leadGenderStr === 'M' || leadGenderStr === 'MALE';

            if (requiredGender === 'female' && isLeadMale) {
              return {
                ...c,
                matchScore: 0,
                matchReason: 'Candidate gender mismatch (Job requires Female).'
              };
            } else if (requiredGender === 'male' && isLeadFemale) {
              return {
                ...c,
                matchScore: 0,
                matchReason: 'Candidate gender mismatch (Job requires Male).'
              };
            }

            // Check for position relevance
            const isPositionMatch = c.position && c.position.toLowerCase().includes(jobDetails.title.toLowerCase());
            if (isPositionMatch) {
              score += 35;
              reason = `Strong keyword matching for ${jobDetails.title} roles.`;
            } else if (leadText.includes(jobDetails.title.toLowerCase())) {
              score += 25;
              reason = `Resume mentions experience or interest relevant to ${jobDetails.title} positions.`;
            }

            // Check for region preference
            if (jobDetails.preferredRegion && jobDetails.preferredRegion.toLowerCase().trim() !== 'none' && jobDetails.preferredRegion.toLowerCase().trim() !== 'n/a') {
              const regionWords = jobDetails.preferredRegion.toLowerCase().split(/[\s,.-]+/);
              const matchedRegions = regionWords.filter(w => w.length > 3 && leadText.includes(w));
              if (matchedRegions.length > 0) {
                score += 15;
                reason += ` Origin aligns with the preferred region of ${jobDetails.preferredRegion}.`;
              }
            }

            score = Math.min(88, Math.max(40, score));

            return {
              ...c,
              matchScore: score,
              matchReason: reason
            };
          });

          matchedProfiles = [...geminiEvaluated, ...heuristicEvaluated]
            // Keep scores > 0 to filter out potential mismatches
            .filter(item => item.matchScore > 0)
            .sort((a, b) => b.matchScore - a.matchScore);
        }
      } catch (evalErr) {
        console.error('Error during precise Gemini evaluation:', evalErr);
        isSimulatedResult = true;
      }
    } else {
      isSimulatedResult = true;
    }

    // Heuristics-based Fallback/Simulated Matching Mode
    if (isSimulatedResult || matchedProfiles.length === 0) {
      matchedProfiles = topCandidates.map(c => {
        let score = 50;
        let reason = 'Candidate holds general profiles corresponding to position keywords.';

        const leadText = `
          ${c.name} 
          ${c.position || ''} 
          ${c.origin || ''} 
          ${c.experience || ''} 
          ${c.remarks1 || ''} 
          ${c.remarks2 || ''} 
          ${c.remarks3 || ''}
        `.toLowerCase();

        // Check for position relevance
        const isReceptionist = leadText.includes('reception') || leadText.includes('front') || leadText.includes('hotel') || leadText.includes('office') || leadText.includes('admin') || leadText.includes('cook') || leadText.includes('housekeep');
        if (isReceptionist) {
          score += 35;
          reason = `Excellent matches found in resume keywords for ${jobDetails.title} roles.`;
        }

        // Check for region preference
        const isPreferredOrigin = leadText.includes('darjeeling') || leadText.includes('siliguri') || leadText.includes('bengal') || leadText.includes('sikkim');
        if (isPreferredOrigin) {
          score += 12;
          reason += ' Origin aligns with the preferred West Bengal/Darjeeling region.';
        }

        if (c.experience && c.experience.toLowerCase().includes('years')) {
          score += 3;
        }

        score = Math.min(98, Math.max(55, score));

        return {
          ...c,
          matchScore: score,
          matchReason: reason
        };
      }).sort((a, b) => b.matchScore - a.matchScore);
    }

    res.json({
      jobDetails,
      matches: matchedProfiles.slice(0, 30),
      isSimulated: isSimulatedResult || !ai
    });

  } catch (err) {
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
  }, 5000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`-----------------------------------------`);
    console.log(`🚀 CRM server booting successfully!`);
    console.log(`🌐 Port Bind: http://localhost:${PORT}`);
    console.log(`⏰ Monday Automatic Full Backup Cron: ACTIVE`);
    console.log(`-----------------------------------------`);
  });
}

startServer();
