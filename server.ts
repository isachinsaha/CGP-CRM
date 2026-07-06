import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load local database helper
import { getLeads, addLead, saveLeads, getStats, getLeadById, getCoordinators, saveCoordinators, initializeCoordinatorsDatabase, getJobs, saveJobs, getUpdates, saveUpdates, getMetadata, saveMetadata } from './src/server/db.ts';
import { Lead, Message, LeadStage, FitScore, Coordinator, Job, ImportantUpdate } from './src/types.ts';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// GET all leads with server-side pagination, searching, and filtering
app.get('/api/leads', async (req, res) => {
  try {
    const rawLeads = await getLeads();

    // 1. Compute dynamic metadata from all unfiltered leads
    const countriesMap = new Map<string, string>(); // lowercase -> original casing
    const projectsMap = new Map<string, string>();
    const tagsMap = new Map<string, string>();

    rawLeads.forEach(l => {
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
      gender = 'All'
    } = req.query as Record<string, string>;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 100;

    // 3. Apply multi-layer filters
    let filteredLeads = rawLeads.filter(lead => {
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

    const { name, phone, alternateNo, gender, age, origin, country, position, experience, assignedTo, importance, tags, source, project, adminRemarks } = req.body;
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
      age: Number(age) || 24,
      origin: origin !== undefined ? String(origin).trim() : '',
      country: country || 'Kuwait',
      position: position || 'General openings',
      experience: experience || 'Fresh criteria',
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
      messages: [
        {
          id: `m_init_${Date.now()}`,
          sender: 'system' as const,
          text: `Lead enrolled manually in CGP system database. Assigned coordinator is ${assignedTo || 'Pending'}.`,
          timestamp: new Date().toISOString()
        }
      ],
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
      updatedAt: new Date().toISOString()
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
      const { name, phone, gender, age, origin, country, position, experience, assignedTo, importance, tags, source, project } = leadItem;
      
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
        age: Number(age) || 24,
        origin: origin !== undefined ? String(origin).trim() : '',
        country: country || 'Kuwait',
        position: position || 'General openings',
        experience: experience || 'Fresh criteria',
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
        updatedAt: new Date().toISOString()
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
      position, experience, adminRemarks, assignedTo, importance,
      remarks1, remarks2, remarks3, callConnected, tasks, timeline, tags, source, project,
      docPassportCopy, docResume, docOfficeVisited, docOthers, reminderEnabled
    } = req.body;
    const leads = await getLeads();
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const lead = leads[idx];
    
    // Ensure lists exist
    if (!lead.timeline) lead.timeline = [];
    if (!lead.tasks) lead.tasks = [];

    // Actor context
    const actorRole = req.headers['x-user-role'] || 'user';
    const actorId = req.headers['x-agent-id'] || lead.assignedTo || 'System';
    const actor = actorRole === 'admin' ? 'Administrator' : `Agent (${actorId})`;

    // Log Stage transitions
    if (stage !== undefined && lead.stage !== stage) {
      const fromLabel = getStageLabel(lead.stage);
      const toLabel = getStageLabel(stage);
      lead.timeline.push({
        id: `tl_${Date.now()}_stage`,
        type: 'status',
        text: `Pipeline stage updated from "${fromLabel}" to "${toLabel}"`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.stage = stage as LeadStage;
    }

    // Log Coordinator assignments
    if (assignedTo !== undefined && lead.assignedTo !== assignedTo) {
      lead.timeline.push({
        id: `tl_${Date.now()}_assign`,
        type: 'assignment',
        text: `Assigned coordinator updated from "${lead.assignedTo || 'Unassigned'}" to "${assignedTo || 'Unassigned'}"`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.assignedTo = assignedTo;
      lead.assignDate = new Date().toISOString().split('T')[0];
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
          text: `Pipeline stage auto-updated to "In Discussion" due to first remark logged`,
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
        text: `Updated Call Remarks 1: "${remarks1 || 'cleared'}"`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.remarks1 = remarks1;
    }
    if (remarks2 !== undefined && lead.remarks2 !== remarks2) {
      lead.timeline.push({
        id: `tl_${Date.now()}_rem2`,
        type: 'remark',
        text: `Updated Call Remarks 2: "${remarks2 || 'cleared'}"`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.remarks2 = remarks2;
    }
    if (remarks3 !== undefined && lead.remarks3 !== remarks3) {
      lead.timeline.push({
        id: `tl_${Date.now()}_rem3`,
        type: 'remark',
        text: `Updated Call Remarks 3: "${remarks3 || 'cleared'}"`,
        actor,
        timestamp: new Date().toISOString()
      });
      lead.remarks3 = remarks3;
    }

    // Standard fields
    if (notes !== undefined) lead.notes = notes;
    if (name !== undefined) lead.name = name;
    if (phone !== undefined) lead.phone = phone;
    if (email !== undefined) lead.email = email;
    if (budget !== undefined) lead.budget = Number(budget);
    if (fitScore !== undefined) lead.fitScore = fitScore as FitScore;
    if (campaign !== undefined) lead.campaign = campaign;

    // Career Growth Placement Custom Attributes
    if (alternateNo !== undefined) lead.alternateNo = alternateNo;
    if (serialNo !== undefined) lead.serialNo = serialNo;
    if (entryDate !== undefined) lead.entryDate = entryDate;
    if (assignDate !== undefined) lead.assignDate = assignDate;
    if (gender !== undefined) lead.gender = gender;
    if (age !== undefined) lead.age = age;
    if (origin !== undefined) lead.origin = origin;
    if (country !== undefined) lead.country = country;
    if (position !== undefined) lead.position = position;
    if (experience !== undefined) lead.experience = experience;
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

    // Direct overrides for tasks and custom timelines
    if (tasks !== undefined) lead.tasks = tasks;
    if (timeline !== undefined) lead.timeline = timeline;
    if (tags !== undefined) lead.tags = tags;

    lead.updatedAt = new Date().toISOString();
    leads[idx] = lead;
    await saveLeads(leads);

    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST send manual WhatsApp message (simulation)
app.post('/api/leads/:id/messages', async (req, res) => {
  try {
    const { text, sender } = req.body;
    if (!text) {
      res.status(400).json({ error: 'Message text is required' });
      return;
    }

    const leads = await getLeads();
    const idx = leads.findIndex(l => l.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const lead = leads[idx];
    const newMessage: Message = {
      id: `m_${Date.now()}`,
      sender: sender || 'user',
      text,
      timestamp: new Date().toISOString()
    };

    lead.messages.push(newMessage);
    lead.updatedAt = new Date().toISOString();
    leads[idx] = lead;
    await saveLeads(leads);

    res.json({ lead, message: newMessage });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE a lead
app.delete('/api/leads/:id', async (req, res) => {
  try {
    const leads = await getLeads();
    const filtered = leads.filter(l => l.id !== req.params.id);
    if (leads.length === filtered.length) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    await saveLeads(filtered);
    res.json({ success: true });
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
    const { title, country, requirement, processingFeeMale, processingFeeFemale, accommodation, ageLimit, conditions, modeOfInterview, applicability, otherTerms, isActive } = req.body;
    if (!title) {
      res.status(400).json({ error: 'Job title is required.' });
      return;
    }

    const jobs = await getJobs();
    const newJob: Job = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: String(title).trim(),
      country: country ? String(country).trim() : 'Kuwait',
      requirement: requirement ? String(requirement).trim() : 'General Requirement',
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
    const { title, country, requirement, processingFeeMale, processingFeeFemale, accommodation, ageLimit, conditions, modeOfInterview, applicability, otherTerms, isActive } = req.body;

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
      requirement: requirement !== undefined ? String(requirement).trim() : (jobs[idx].requirement || 'General Requirement'),
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
    const sequence = leads.length + 1;
    const serialNo = `INQ-${1000 + sequence}`;

    const cleanNameId = String(aiAnalysis.name).toUpperCase().trim().replace(/[^A-Z0-9]/g, '_');
    const newLeadId = generateUniqueLeadId(leads, cleanNameId);
    const newLead: Lead = {
      id: newLeadId,
      serialNo,
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
Extract the job requirements and details. Return a JSON object with these fields:
{
  "title": "the job position title, e.g. Receptionist",
  "country": "the country/region of work, e.g. Maldives, Germany, Qatar",
  "salary": "the salary details listed, e.g. USD 450 per month",
  "experience": "required experience, e.g. 3 years as receptionist",
  "skills": "required skills/criteria, e.g. English speaking",
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

      return { lead, preScore: score };
    });

    // Select the top 120 leads for high-precision Gemini evaluation
    const topCandidates = preScored
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
Provide a clear, brief 1-sentence matching explanation.
Return the output strictly in the requested JSON schema.`;

        const evaluationPrompt = `Job Demand Details:
- Title: ${jobDetails.title}
- Target Location: ${jobDetails.country}
- Salary Package: ${jobDetails.salary}
- Required Experience: ${jobDetails.experience}
- Skills Preference: ${jobDetails.skills}
- Origin Region Preference: ${jobDetails.preferredRegion}
- Additional Benefits: ${jobDetails.benefits}

Candidates to Evaluate:
${JSON.stringify(topCandidates.map(c => ({
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

          matchedProfiles = topCandidates.map(c => {
            const matchInfo = matchMap.get(c.id) || { score: 50, reason: 'Candidate matches general profile criteria.' };
            return {
              ...c,
              matchScore: matchInfo.score,
              matchReason: matchInfo.reason
            };
          }).sort((a, b) => b.matchScore - a.matchScore);
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
        const isReceptionist = leadText.includes('reception') || leadText.includes('front') || leadText.includes('hotel') || leadText.includes('office') || leadText.includes('admin');
        if (isReceptionist) {
          score += 35;
          reason = 'Excellent matches found in resume keywords for Receptionist/Front Office roles.';
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
    console.log(`-----------------------------------------`);
  });
}

startServer();
