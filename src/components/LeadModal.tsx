import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Lead, LeadStage, FitScore, Coordinator } from '../types.ts';
import { 
  X, Info, Sparkles, CheckCircle2, RefreshCw, AlertTriangle, 
  Calendar, Clipboard, Check, Star, ListTodo, History, 
  Send, Trash2, ArrowRight, CheckSquare, Square, MessageSquare, ExternalLink, Bell, Plus, PhoneCall, Search, Copy
} from 'lucide-react';
import { motion } from 'motion/react';
import { getCountryFlagUrl, formatCandidateName, isDefaultExperience, extractExperienceFromRemarks, getEffectiveExperience } from '../utils';
import { SearchableSelect } from './SearchableSelect.tsx';

interface LeadModalProps {
  lead: Lead;
  onClose: () => void;
  onLeadUpdated: () => void;
  userRole: 'admin' | 'agent';
  currentAgentId: string;
  allLeads?: Lead[];
  coordinators?: Coordinator[];
  projects?: string[];
  countries?: string[];
  positions?: string[];
  tagsList?: string[];
}

export default function LeadModal({ 
  lead: initialLead, 
  onClose, 
  onLeadUpdated, 
  userRole, 
  currentAgentId,
  allLeads = [],
  coordinators = [],
  projects: propProjects,
  countries: propCountries,
  positions: propPositions,
  tagsList
}: LeadModalProps) {
  const [lead, setLead] = useState<Lead>(initialLead);
  const [activeLeftTab, setActiveLeftTab] = useState<'ai' | 'profile'>('ai');
  const [activeRightTab, setActiveRightTab] = useState<'tasks' | 'timeline'>('tasks');
  
  // Activity Timeline filters & search
  const [timelineFilter, setTimelineFilter] = useState<'all' | 'status' | 'remark' | 'assignment' | 'task'>('all');
  const [timelineSearch, setTimelineSearch] = useState('');
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

  // Skeleton loading state for fetching historical remarks & timeline data
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);

  // Fetch fresh activity timeline and historical remarks from server
  const fetchTimelineData = async (showSkeleton = true) => {
    if (!lead || !lead.id) return;
    if (showSkeleton) setIsTimelineLoading(true);
    const start = Date.now();
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(lead.id)}`);
      if (res.ok) {
        const freshLead = await res.json();
        if (freshLead) {
          setLead(prev => ({
            ...prev,
            ...freshLead,
            timeline: freshLead.timeline || prev.timeline || []
          }));
        }
      }
    } catch (err) {
      console.error('Error fetching timeline data:', err);
    } finally {
      if (showSkeleton) {
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, 350 - elapsed);
        setTimeout(() => setIsTimelineLoading(false), remaining);
      }
    }
  };

  // Trigger fetch when switching to the timeline tab or when lead changes
  useEffect(() => {
    if (activeRightTab === 'timeline') {
      fetchTimelineData(true);
    }
  }, [activeRightTab, initialLead.id]);

  // Computed timeline items filtered by category and search query
  const timelineCounts = useMemo(() => {
    const list = lead.timeline || [];
    return {
      total: list.length,
      status: list.filter(e => e.type === 'status').length,
      remark: list.filter(e => e.type === 'remark').length,
      assignment: list.filter(e => e.type === 'assignment').length,
      task: list.filter(e => e.type === 'task').length,
    };
  }, [lead.timeline]);

  const filteredTimeline = useMemo(() => {
    if (!lead.timeline || !Array.isArray(lead.timeline)) return [];
    let list = lead.timeline.slice().reverse();
    if (timelineFilter !== 'all') {
      list = list.filter(e => e.type === timelineFilter);
    }
    if (timelineSearch.trim()) {
      const q = timelineSearch.trim().toLowerCase();
      list = list.filter(e => 
        (e.text && e.text.toLowerCase().includes(q)) ||
        (e.actor && e.actor.toLowerCase().includes(q))
      );
    }
    return list;
  }, [lead.timeline, timelineFilter, timelineSearch]);
  
  // Custom Task builder inputs
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState(new Date().toISOString().split('T')[0]);
  const [isCopiedId, setIsCopiedId] = useState<string | null>(null);

  const [isRequalifying, setIsRequalifying] = useState(false);
  const [tags, setTags] = useState<string[]>(initialLead.tags || []);
  const [tagInputVal, setTagInputVal] = useState('');

  // Collect all unique existing tags dynamically from all current leads + bootstrap defaults
  const allExistingTags = useMemo(() => {
    const tagsSet = new Set<string>();
    const defaults = tagsList && tagsList.length > 0 ? tagsList : [
      'Chef', 'Nurse', 'Waiter', 'Waitress', 'Driver', 'Accountant', 
      'Manager', 'Sales', 'Developer', 'Electrician', 'Plumber', 
      'Receptionist', 'Housekeeper', 'Security', 'Painter', 'Mechanic', 'Operator'
    ];
    defaults.forEach(t => tagsSet.add(t));
    
    if (Array.isArray(allLeads)) {
      allLeads.forEach(l => {
        if (l.tags && Array.isArray(l.tags)) {
          l.tags.forEach(t => {
            if (t && typeof t === 'string' && t.trim()) {
              tagsSet.add(t.trim());
            }
          });
        }
      });
    }
    return Array.from(tagsSet);
  }, [allLeads]);

  // Filter matched suggestions based on what the user is typing
  const suggestedTags = useMemo(() => {
    const val = tagInputVal.trim().toLowerCase();
    if (val.length < 1) return []; // Auto-suggest after typing 1 or more characters
    return allExistingTags.filter(
      t => t.toLowerCase().startsWith(val) && !tags.some(existing => existing.toLowerCase() === t.toLowerCase())
    ).slice(0, 6); // Limit to top 6 suggestions
  }, [tagInputVal, allExistingTags, tags]);

  const [projects, setProjects] = useState<string[]>(() => {
    if (propProjects && propProjects.length > 0) return propProjects;
    const saved = localStorage.getItem('crm_projects');
    return saved ? JSON.parse(saved) : ['Napkin affairs', 'Alltoobi', 'Lulu hypermarket', 'General Intake'];
  });
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    if (propProjects && propProjects.length > 0) {
      setProjects(propProjects);
    }
  }, [propProjects]);

  useEffect(() => {
    localStorage.setItem('crm_projects', JSON.stringify(projects));
  }, [projects]);

  // Editable Form fields supporting entire spreadsheet columns of Career Growth Placement
  const [formFields, setFormFields] = useState({
    name: initialLead.name,
    phone: initialLead.phone,
    alternateNo: initialLead.alternateNo || '',
    email: initialLead.email || '',
    campaign: initialLead.campaign || '',
    budget: initialLead.budget,
    budgetRaw: initialLead.budgetRaw,
    fitScore: initialLead.fitScore,
    stage: initialLead.stage,
    notes: initialLead.notes || '',
    
    serialNo: initialLead.serialNo || '',
    entryDate: initialLead.entryDate || '',
    assignDate: initialLead.assignDate || '',
    gender: initialLead.gender || 'Not defined',
    age: (initialLead.age !== undefined && initialLead.age !== null) ? String(initialLead.age) : '',
    origin: initialLead.origin || '',
    country: initialLead.country || '',
    position: initialLead.position || '',
    experience: initialLead.experience || '',
    qualification: initialLead.qualification || '',
    adminRemarks: initialLead.adminRemarks || '',
    assignedTo: initialLead.assignedTo || '',
    importance: initialLead.importance !== undefined ? Number(initialLead.importance) : 3,
    remarks1: initialLead.remarks1 || '',
    remarks2: initialLead.remarks2 || '',
    remarks3: initialLead.remarks3 || '',
    callConnected: initialLead.callConnected || 'connected',
    source: initialLead.source || '',
    project: initialLead.project || '',
    docPassportCopy: initialLead.docPassportCopy === true,
    docResume: initialLead.docResume === true,
    docOfficeVisited: initialLead.docOfficeVisited === true,
    docOthers: initialLead.docOthers === true,
    reminderEnabled: !!initialLead.reminderEnabled
  });

  const [savingForm, setSavingForm] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const isFirstMountOrChangeRef = useRef<boolean>(true);

  // Sync state on lead changes
  useEffect(() => {
    setLead(initialLead);
    setTags(initialLead.tags || []);
    setFormFields({
      name: initialLead.name,
      phone: initialLead.phone,
      alternateNo: initialLead.alternateNo || '',
      email: initialLead.email || '',
      campaign: initialLead.campaign || '',
      budget: initialLead.budget,
      budgetRaw: initialLead.budgetRaw,
      fitScore: initialLead.fitScore,
      stage: initialLead.stage,
      notes: initialLead.notes || '',
      
      serialNo: initialLead.serialNo || '',
      entryDate: initialLead.entryDate || '',
      assignDate: initialLead.assignDate || '',
      gender: initialLead.gender || 'Not defined',
      age: (initialLead.age !== undefined && initialLead.age !== null) ? String(initialLead.age) : '',
      origin: initialLead.origin || '',
      country: initialLead.country || '',
      position: initialLead.position || '',
      experience: initialLead.experience || '',
      qualification: initialLead.qualification || '',
      adminRemarks: initialLead.adminRemarks || '',
      assignedTo: initialLead.assignedTo || '',
      importance: initialLead.importance !== undefined ? Number(initialLead.importance) : 3,
      remarks1: initialLead.remarks1 || '',
      remarks2: initialLead.remarks2 || '',
      remarks3: initialLead.remarks3 || '',
      callConnected: initialLead.callConnected || 'connected',
      source: initialLead.source || '',
      project: initialLead.project || '',
      docPassportCopy: initialLead.docPassportCopy === true,
      docResume: initialLead.docResume === true,
      docOfficeVisited: initialLead.docOfficeVisited === true,
      docOthers: initialLead.docOthers === true,
      reminderEnabled: !!initialLead.reminderEnabled
    });
    isFirstMountOrChangeRef.current = true;
  }, [initialLead.id]);

  // Dynamically synthesize extracted skills from lead position, experience, qualification, requirements, and tags
  const extractedSkills = useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();

    const add = (val?: string) => {
      if (!val) return;
      const cleaned = val.trim();
      if (!cleaned) return;
      const lower = cleaned.toLowerCase();
      if (lower === 'whatsapp inbound' || lower === 'general openings' || lower === 'fresh criteria' || lower === 'not defined' || lower === 'fresher' || lower === 'none') return;
      if (!seen.has(lower)) {
        seen.add(lower);
        list.push(cleaned);
      }
    };

    if (lead.position) add(lead.position);
    if (lead.experience) add(lead.experience);
    if (lead.qualification) add(lead.qualification);

    if (Array.isArray(lead.requirements)) {
      lead.requirements.forEach(r => add(r));
    }

    if (Array.isArray(lead.tags)) {
      lead.tags.forEach(t => add(t));
    }

    return list;
  }, [lead.position, lead.experience, lead.qualification, lead.requirements, lead.tags]);

  // Background auto-save has been disabled to prevent continuous re-rendering and the modal re-opening bug.
  // Changes are now explicitly committed using the Save buttons.

  const handleFieldChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormFields(prev => {
      const updated = {
        ...prev,
        [name]: value
      };
      
      // Auto-move stage from 'new' to 'negotiating' when the 1'st remark is logged
      if (
        prev.stage === 'new' &&
        ['remarks1', 'remarks2', 'remarks3'].includes(name) &&
        value.trim() !== ''
      ) {
        updated.stage = 'negotiating';
      }

      // Automatically extract experience from remarks if experience is not explicitly filled
      if (
        ['remarks1', 'remarks2', 'remarks3', 'adminRemarks'].includes(name) &&
        isDefaultExperience(prev.experience)
      ) {
        const autoExtracted = extractExperienceFromRemarks(value);
        if (autoExtracted) {
          updated.experience = autoExtracted;
        }
      }
      
      return updated;
    });
  };

  // Submit profile updates to backend server
  const saveProfileEdits = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Validation for "Not Connected" calls - Callback task must be scheduled
    if (formFields.callConnected === 'not_connected') {
      const activeTasksCount = (lead.tasks || []).filter(t => !t.completed).length;
      if (activeTasksCount === 0) {
        alert("Action Required: When the call is marked as 'Not Connected', you must schedule a callback task/reminder in the right panel before saving.");
        return;
      }
    }

    setSavingForm(true);
    setSaveSuccess(false);

    try {
      const actorRole = userRole;
      const actorId = currentAgentId;

      // Compute effective experience if default or blank
      let finalExp = formFields.experience;
      if (isDefaultExperience(finalExp)) {
        const autoExp = getEffectiveExperience(formFields);
        if (!isDefaultExperience(autoExp)) {
          finalExp = autoExp;
        }
      }

      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': actorRole,
          'x-agent-id': actorId
        },
        body: JSON.stringify({
          ...formFields,
          experience: finalExp,
          age: Number(formFields.age) || 0,
          importance: Number(formFields.importance) || 3,
          tags
        })
      });
      const data = await res.json();
      if (res.ok) {
        setLead(data);
        setFormFields(prev => ({
          ...prev,
          stage: data.stage
        }));
        onLeadUpdated();
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (err) {
      console.error('Failed to update lead fields', err);
    } finally {
      setSavingForm(false);
    }
  };

  // Trigger Gemini dynamic AI qualifications re-parsing
  const triggerRequalification = async () => {
    setIsRequalifying(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/ai-requalify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok) {
        setLead(data);
        onLeadUpdated();
      }
    } catch (err) {
      console.error('AI Requalification query failed', err);
    } finally {
      setIsRequalifying(false);
    }
  };

  // Add a task & log it to timeline
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    const newTask = {
      id: `task_${Date.now()}`,
      title: newTaskTitle.trim(),
      dueDate: newTaskDueDate || new Date().toISOString().split('T')[0],
      completed: false,
      createdAt: new Date().toISOString()
    };

    const updatedTasks = [...(lead.tasks || []), newTask];
    
    const actor = userRole === 'admin' ? 'Administrator' : `Agent (${currentAgentId})`;
    const updatedTimeline = [
      ...(lead.timeline || []),
      {
        id: `tl_${Date.now()}_task`,
        type: 'task' as const,
        text: `Scheduled new telecaller task: "${newTaskTitle.trim()}" (Due: ${newTaskDueDate})`,
        actor,
        timestamp: new Date().toISOString()
      }
    ];

    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify({ tasks: updatedTasks, timeline: updatedTimeline })
      });
      const data = await res.json();
      if (res.ok) {
        setLead(data);
        setNewTaskTitle('');
        onLeadUpdated();
      }
    } catch (err) {
      console.error('Failed to save new task', err);
    }
  };

  // Toggle task status & log to timeline
  const handleToggleTask = async (taskId: string) => {
    const updatedTasks = (lead.tasks || []).map(t => {
      if (t.id === taskId) {
        return { ...t, completed: !t.completed };
      }
      return t;
    });

    const targetTask = (lead.tasks || []).find(t => t.id === taskId);
    const actionText = targetTask?.completed ? 'Reopened follow-up task' : 'Completed follow-up task';
    const actor = userRole === 'admin' ? 'Administrator' : `Agent (${currentAgentId})`;

    const updatedTimeline = [
      ...(lead.timeline || []),
      {
        id: `tl_${Date.now()}_task_toggle`,
        type: 'task' as const,
        text: `${actionText}: "${targetTask?.title}"`,
        actor,
        timestamp: new Date().toISOString()
      }
    ];

    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify({ tasks: updatedTasks, timeline: updatedTimeline })
      });
      const data = await res.json();
      if (res.ok) {
        setLead(data);
        onLeadUpdated();
      }
    } catch (err) {
      console.error('Failed to toggle task status', err);
    }
  };

  // Delete a task
  const handleDeleteTask = async (taskId: string) => {
    const updatedTasks = (lead.tasks || []).filter(t => t.id !== taskId);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: updatedTasks })
      });
      const data = await res.json();
      if (res.ok) {
        setLead(data);
        onLeadUpdated();
      }
    } catch (err) {
      console.error('Failed to remove task', err);
    }
  };

  const copyToClipboard = (text: string, templateId: string) => {
    navigator.clipboard.writeText(text);
    setIsCopiedId(templateId);
    setTimeout(() => setIsCopiedId(null), 2500);
  };

  const getFitStyle = (score: FitScore) => {
    switch (score) {
      case 'high': return 'bg-emerald-500 text-white border-emerald-600';
      case 'medium': return 'bg-teal-500 text-white border-teal-600';
      case 'low': return 'bg-amber-500 text-white border-amber-600';
      case 'unqualified': return 'bg-slate-400 text-white border-slate-500';
      default: return 'bg-slate-400 text-white border-slate-500';
    }
  };

  const isSubAgent = userRole === 'agent';

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 text-left" 
      id="cgp-leads-modal"
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 26 }}
        className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-[1310px] h-[92vh] flex flex-col overflow-hidden text-slate-900 dark:text-slate-100 text-sm"
      >
        
        {/* Header ribbon */}
        <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row gap-4 justify-between lg:items-center shrink-0 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2 border border-slate-200 dark:border-slate-700 rounded-full text-slate-700 dark:text-slate-300 shrink-0">
              <Info className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-black text-slate-900 dark:text-white text-xl tracking-tight uppercase">{formatCandidateName(lead.name)}</h3>
                <span className={`text-xs font-black px-3 py-0.5 rounded-full uppercase border ${getFitStyle(lead.fitScore)}`}>
                  {lead.fitScore} Fit
                </span>
                {lead.country && (
                  <span className="text-xs bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 rounded-full px-3 py-0.5 font-extrabold uppercase flex items-center gap-1.5">
                    {getCountryFlagUrl(lead.country) ? (
                      <img 
                        src={getCountryFlagUrl(lead.country)} 
                        alt="" 
                        className="w-4 h-3 object-cover rounded-2xs"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="text-xs">🟢</span>
                    )}
                    Target: {lead.country}
                  </span>
                )}
              </div>
              <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 font-mono mt-1">
                <span className="flex items-center gap-1">
                  Serial No: <strong className="text-slate-900 dark:text-white font-bold">{lead.serialNo || 'Pending'}</strong> 
                </span>
                <span className="text-slate-300 dark:text-slate-700 select-none">•</span>
                <span className="flex items-center gap-1">
                  Phone: <strong className="text-slate-900 dark:text-white font-bold">{lead.phone}</strong> 
                </span>
                {lead.alternateNo && (
                  <>
                    <span className="text-slate-300 dark:text-slate-700 select-none">•</span>
                    <span className="flex items-center gap-1">
                      Alt: <strong className="text-slate-900 dark:text-white font-bold">{lead.alternateNo}</strong>
                    </span>
                  </>
                )}
                {lead.assignedTo && (
                  <>
                    <span className="text-slate-300 dark:text-slate-700 select-none">•</span>
                    <span className="flex items-center gap-1">
                      Coordinator:{' '}
                      <span className="text-purple-700 dark:text-purple-300 font-extrabold bg-purple-50 dark:bg-purple-950/80 px-2 py-0.5 rounded border border-purple-200 dark:border-purple-800">
                        {lead.assignedTo}
                      </span>
                    </span>
                  </>
                )}
                {lead.source && (
                  <>
                    <span className="text-slate-300 dark:text-slate-700 select-none">•</span>
                    <span className="flex items-center gap-1">
                      Source:{' '}
                      <span className="text-purple-700 dark:text-purple-300 font-bold bg-purple-50 dark:bg-purple-950/80 px-2 py-0.5 rounded border border-purple-200 dark:border-purple-800 uppercase">
                        {lead.source}
                      </span>
                    </span>
                  </>
                )}
                {lead.project && (
                  <>
                    <span className="text-slate-300 dark:text-slate-700 select-none">•</span>
                    <span className="flex items-center gap-1">
                      Project:{' '}
                      <span className="text-emerald-700 dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 uppercase">
                        {lead.project}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
            {/* Shorter, Thicker, Bolder and More Attractive Stage selection */}
            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-950 py-1.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs">
              <span className="text-xs uppercase font-extrabold text-slate-500 dark:text-slate-400 font-mono tracking-wider">STAGE:</span>
              <select
                value={formFields.stage}
                name="stage"
                onChange={handleFieldChange}
                className="text-xs sm:text-[13px] font-extrabold bg-transparent text-slate-900 dark:text-slate-100 px-1 py-0.5 focus:outline-none cursor-pointer max-w-[150px] font-sans"
              >
                <option value="new" className="font-extrabold bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">New Inbound</option>
                <option value="negotiating" className="font-extrabold bg-white dark:bg-slate-900 text-amber-600">In Discussion</option>
                <option value="rotations" className="font-extrabold bg-white dark:bg-slate-900 text-indigo-600">In Rotations</option>
                <option value="proposal" className="font-extrabold bg-white dark:bg-slate-900 text-purple-600">Office Visited</option>
                <option value="won" className="font-extrabold bg-white dark:bg-slate-900 text-emerald-600">Closed Won ✅</option>
                <option value="lost" className="font-extrabold bg-white dark:bg-slate-900 text-rose-600">Closed Lost ❌</option>
              </select>
            </div>

            {/* Smaller Reminder Button matching Stage selection style but smaller */}
            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-950 py-1.5 px-3 rounded-lg border border-slate-200 dark:border-slate-700 shadow-2xs shrink-0">
              <span className="text-xs uppercase font-extrabold text-slate-500 dark:text-slate-400 font-mono tracking-wider flex items-center gap-1">
                <Bell className={`h-3.5 w-3.5 ${formFields.reminderEnabled ? 'text-indigo-600 dark:text-indigo-400 fill-indigo-600' : 'text-slate-400'}`} />
                <span>REMINDER:</span>
              </span>
              <button
                type="button"
                onClick={async () => {
                  const newVal = !formFields.reminderEnabled;
                  setFormFields(prev => ({ ...prev, reminderEnabled: newVal }));
                  try {
                    const actorRole = userRole;
                    const actorId = currentAgentId;
                    const res = await fetch(`/api/leads/${lead.id}`, {
                      method: 'PUT',
                      headers: { 
                        'Content-Type': 'application/json',
                        'x-user-role': actorRole,
                        'x-agent-id': actorId
                      },
                      body: JSON.stringify({ ...formFields, reminderEnabled: newVal })
                    });
                    if (res.ok) {
                      const updatedLead = await res.json();
                      setLead(updatedLead);
                      onLeadUpdated();
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }}
                className={`text-xs sm:text-[13px] font-black focus:outline-none cursor-pointer font-sans transition-all whitespace-nowrap ${
                  formFields.reminderEnabled ? 'text-indigo-600 dark:text-indigo-400 font-extrabold' : 'text-slate-500'
                }`}
              >
                {formFields.reminderEnabled ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Top-Right Save Changes Button */}
            <button
              type="button"
              onClick={() => saveProfileEdits()}
              disabled={savingForm}
              className={`flex items-center justify-center gap-2 py-2.5 px-6 rounded-xl shadow-xs font-black text-xs sm:text-sm uppercase tracking-wider transition-all duration-200 cursor-pointer disabled:opacity-50 select-none shrink-0 text-white ${
                saveSuccess 
                  ? 'bg-emerald-600' 
                  : 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
              }`}
            >
              {savingForm ? (
                <>
                  <RefreshCw className="h-4.5 w-4.5 animate-spin text-white" />
                  <span className="text-white font-black">Saving</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="h-4.5 w-4.5 text-white stroke-[3.5px]" />
                  <span className="text-white font-black">Saved</span>
                </>
              ) : (
                <>
                  <Check className="h-4.5 w-4.5 text-white stroke-[3.5px]" />
                  <span className="text-white font-black">SAVE</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg transition-all cursor-pointer"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* Double Column Area */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Column: Form Details / Smart Metadata */}
          <div className="w-1/2 border-r border-slate-200 dark:border-slate-750 flex flex-col bg-slate-50/50 dark:bg-slate-900/10 overflow-y-auto">
            
            {/* Left Tabs */}
            <div className="flex p-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0 sticky top-0 z-20 gap-2">
              <button
                type="button"
                onClick={() => setActiveLeftTab('ai')}
                className={`group flex-1 py-2.5 px-3 text-[11px] sm:text-xs font-black tracking-wider uppercase transition-all duration-200 rounded-full flex items-center justify-center gap-1.5 cursor-pointer border ${
                  activeLeftTab === 'ai'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-500 dark:bg-slate-800 dark:text-emerald-400 dark:border-slate-700 dark:hover:bg-[#1f293d]'
                }`}
              >
                <Sparkles className={`h-3.5 w-3.5 ${activeLeftTab === 'ai' ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'}`} />
                <span className={`font-black ${activeLeftTab === 'ai' ? 'text-white' : 'text-emerald-700 dark:text-emerald-400'}`}>AI Classification</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveLeftTab('profile')}
                className={`group flex-1 py-2.5 px-3 text-[11px] sm:text-xs font-black tracking-wider uppercase transition-all duration-200 rounded-full flex items-center justify-center gap-1.5 cursor-pointer border ${
                  activeLeftTab === 'profile'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50 hover:border-emerald-500 dark:bg-slate-800 dark:text-emerald-400 dark:border-slate-700 dark:hover:bg-[#1f293d]'
                }`}
              >
                <Clipboard className={`h-3.5 w-3.5 ${activeLeftTab === 'profile' ? 'text-white' : 'text-emerald-600 dark:text-emerald-400'}`} />
                <span className={`font-black ${activeLeftTab === 'profile' ? 'text-white' : 'text-emerald-700 dark:text-emerald-400'}`}>Office Form Sheet</span>
              </button>
            </div>

            <div className="p-5 space-y-5 flex-1 text-left">
              {activeLeftTab === 'ai' ? (
                <div className="space-y-5 animate-in fade-in duration-200">
                  
                  {/* AI Profiling Highlights block */}
                  <div className="bg-emerald-500/5 dark:bg-emerald-950/20 p-4 rounded-2xl border border-emerald-500/20 dark:border-emerald-900/40 relative space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-black text-emerald-800 dark:text-emerald-400 tracking-wider">
                        <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-emerald-800 dark:text-emerald-400 font-black">AI PLACEMENT INTERPRETER</span>
                      </div>
                      <button
                        type="button"
                        onClick={triggerRequalification}
                        disabled={isRequalifying}
                        className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-emerald-600 hover:text-white border border-slate-200 dark:border-slate-700 text-emerald-800 dark:text-emerald-400 font-bold text-[10px] rounded-lg transition-all flex items-center gap-1 cursor-pointer shadow-2xs"
                      >
                        <RefreshCw className={`h-2.5 w-2.5 ${isRequalifying ? 'animate-spin' : ''}`} />
                        {isRequalifying ? 'Analyzing...' : 'Re-Analyze Profile'}
                      </button>
                    </div>

                    <div className="space-y-3 text-xs">
                      {/* Extracted Target Details */}
                      <div className="grid grid-cols-2 gap-3 bg-white dark:bg-slate-900/80 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-3xs">
                        <div>
                          <span className="text-slate-700 dark:text-slate-400 font-bold block text-[11px]">Extracted Target Country:</span>
                          <span className="text-slate-900 dark:text-slate-100 font-extrabold flex items-center gap-1.5 mt-0.5 text-xs">
                            {lead.country && getCountryFlagUrl(lead.country) ? (
                              <img 
                                src={getCountryFlagUrl(lead.country)} 
                                alt="" 
                                className="w-4 h-3 object-cover rounded-2xs inline-block shadow-2xs"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <span>🌐</span>
                            )}
                            {lead.country || 'Not Confirmed'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-700 dark:text-slate-400 font-bold block text-[11px]">Placement Target Position:</span>
                          <span className="text-slate-900 dark:text-slate-100 font-extrabold block mt-0.5 text-xs">
                            💼 {lead.position || 'General Openings'}
                          </span>
                        </div>
                      </div>

                      {/* CANDIDATE KEY DETAILS LIST-WISE CONTAINER */}
                      <div className="space-y-2">
                        <span className="text-[10.5px] font-black text-emerald-800 dark:text-emerald-400 uppercase tracking-wider block">
                          Candidate Key Profile Details:
                        </span>
                        <div className="bg-white dark:bg-slate-900/80 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden shadow-xs">
                          <div className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                            <span className="text-slate-800 dark:text-slate-400 font-extrabold text-[11px] shrink-0 flex items-center gap-2">
                              <span>⏱️</span> Experience
                            </span>
                            <span className="text-slate-900 dark:text-slate-100 font-extrabold text-xs text-right break-words">
                              {getEffectiveExperience(lead)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                            <span className="text-slate-800 dark:text-slate-400 font-extrabold text-[11px] shrink-0 flex items-center gap-2">
                              <span>🎓</span> Qualification
                            </span>
                            <span className="text-slate-900 dark:text-slate-100 font-extrabold text-xs text-right break-words">
                              {lead.qualification || 'Not Specified'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                            <span className="text-slate-800 dark:text-slate-400 font-extrabold text-[11px] shrink-0 flex items-center gap-2">
                              <span>🎂</span> Age
                            </span>
                            <span className="text-slate-900 dark:text-slate-100 font-extrabold text-xs text-right break-words">
                              {lead.age ? `${lead.age} Yrs` : 'Not Specified'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                            <span className="text-slate-800 dark:text-slate-400 font-extrabold text-[11px] shrink-0 flex items-center gap-2">
                              <span>📍</span> Origin / State
                            </span>
                            <span className="text-slate-900 dark:text-slate-100 font-extrabold text-xs text-right break-words">
                              {lead.origin || 'Not Specified'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Live Telecaller Remarks (Primary) */}
                  <div className="bg-white dark:bg-slate-900/60 p-4.5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 shadow-xs">
                    <h4 className="text-xs font-black text-slate-900 dark:text-slate-300 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center justify-between">
                      <span>Live Telecaller Remarks</span>
                    </h4>

                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-1 gap-3">
                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 text-left focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
                          <span className="text-[10px] font-black text-slate-900 dark:text-slate-200 block uppercase tracking-wider">Remarks 1 (First Contact Outcome)</span>
                          <textarea
                            rows={2}
                            name="remarks1"
                            placeholder="— No remarks logged yet."
                            value={formFields.remarks1 || ''}
                            onChange={handleFieldChange}
                            className="w-full bg-transparent border-none p-0 text-slate-900 dark:text-slate-100 placeholder-slate-600 dark:placeholder-slate-400 font-mono italic mt-1 leading-relaxed focus:outline-none focus:ring-0 resize-none font-extrabold text-xs"
                          />
                        </div>
                        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 text-left focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
                          <span className="text-[10px] font-black text-slate-900 dark:text-slate-200 block uppercase tracking-wider">Remarks 2 (Follow-up Call Comments)</span>
                          <textarea
                            rows={2}
                            name="remarks2"
                            placeholder="— No remarks logged yet."
                            value={formFields.remarks2 || ''}
                            onChange={handleFieldChange}
                            className="w-full bg-transparent border-none p-0 text-slate-900 dark:text-slate-100 placeholder-slate-600 dark:placeholder-slate-400 font-mono italic mt-1 leading-relaxed focus:outline-none focus:ring-0 resize-none font-extrabold text-xs"
                          />
                        </div>
                        <div className="p-3.5 bg-amber-100/90 dark:bg-amber-950/40 rounded-xl border-2 border-amber-400 dark:border-amber-700 text-left focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20 transition-all shadow-2xs">
                          <span className="text-[11px] font-black text-black dark:text-amber-200 block uppercase tracking-wider flex items-center gap-1.5 mb-1">
                            <span className="inline-block w-2 h-2 bg-amber-600 dark:bg-amber-400 rounded-full animate-pulse" />
                            Remarks 3 (Final Decision Remarks)
                          </span>
                          <textarea
                            rows={2}
                            name="remarks3"
                            placeholder="— No remarks logged yet."
                            value={formFields.remarks3 || ''}
                            onChange={handleFieldChange}
                            className="w-full bg-transparent border-none p-0 text-black dark:text-amber-100 placeholder-slate-600 dark:placeholder-amber-400/60 font-mono italic leading-relaxed focus:outline-none focus:ring-0 resize-none font-extrabold text-xs"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => saveProfileEdits()}
                        disabled={savingForm}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm shrink-0 cursor-pointer border border-emerald-600"
                      >
                        {savingForm ? 'Saving Updates to cloud DB...' : 'Commit Remarks & Profile Changes'}
                        {saveSuccess && <CheckCircle2 className="h-4 w-4 text-white animate-bounce" />}
                      </button>

                      {lead.adminRemarks && (
                        <div className="mt-2 p-2.5 bg-red-50 dark:bg-red-950/90 border border-red-200 dark:border-red-800/80 rounded-lg text-left shadow-xs">
                          <span className="text-[9px] font-bold text-red-700 dark:text-red-400 block uppercase">Admin Placement Instructions Directive</span>
                          <p className="font-bold text-red-950 dark:text-red-200 leading-relaxed mt-0.5">{lead.adminRemarks}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Interactive Candidate Document Checklist - Verification Desk Clickable and Light-Mode Adaptive */}
                  <div className="bg-white dark:bg-slate-900/40 p-4.5 rounded-xl border border-slate-200 dark:border-slate-750 text-left shadow-xs">
                    <h4 className="text-xs font-black text-slate-900 dark:text-slate-200 uppercase tracking-wider border-b border-slate-200 dark:border-slate-750 pb-2 mb-3 flex items-center justify-between">
                      <span className="text-slate-900 dark:text-slate-200 font-extrabold flex items-center gap-1.5">Candidate Document Checklist</span>
                      <span className="text-[10px] font-black text-white bg-indigo-600 dark:bg-indigo-700 px-3 py-1 rounded-lg uppercase font-mono tracking-wider shadow-2xs">
                        Verification Desk
                      </span>
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-3.5 text-xs">
                      {/* Passport Copy Checkbox */}
                      <button
                        type="button"
                        onClick={() => {
                          setFormFields(prev => ({ ...prev, docPassportCopy: !prev.docPassportCopy }));
                        }}
                        className={`flex items-center gap-2.5 p-2 px-3 rounded-xl transition-all text-left cursor-pointer select-none border ${
                          formFields.docPassportCopy
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                        }`}
                        title="Toggle Passport Copy Received"
                      >
                        <span className={`h-5 w-5 rounded-md flex items-center justify-center border text-[11px] font-black shrink-0 transition-all ${
                          formFields.docPassportCopy 
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-2xs' 
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                        }`}>
                          {formFields.docPassportCopy && '✓'}
                        </span>
                        <span className={`text-xs transition-all ${
                          formFields.docPassportCopy 
                            ? 'text-emerald-800 dark:text-emerald-300 font-extrabold' 
                            : 'text-slate-800 dark:text-slate-300 font-bold'
                        }`}>
                          Passport Copy
                        </span>
                      </button>

                      {/* Resume / CV Checkbox */}
                      <button
                        type="button"
                        onClick={() => {
                          setFormFields(prev => ({ ...prev, docResume: !prev.docResume }));
                        }}
                        className={`flex items-center gap-2.5 p-2 px-3 rounded-xl transition-all text-left cursor-pointer select-none border ${
                          formFields.docResume
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                        }`}
                        title="Toggle Resume Received"
                      >
                        <span className={`h-5 w-5 rounded-md flex items-center justify-center border text-[11px] font-black shrink-0 transition-all ${
                          formFields.docResume 
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-2xs' 
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                        }`}>
                          {formFields.docResume && '✓'}
                        </span>
                        <span className={`text-xs transition-all ${
                          formFields.docResume 
                            ? 'text-emerald-800 dark:text-emerald-300 font-extrabold' 
                            : 'text-slate-800 dark:text-slate-300 font-bold'
                        }`}>
                          Resume / CV
                        </span>
                      </button>

                      {/* Office Visited Checkbox */}
                      <button
                        type="button"
                        onClick={() => {
                          setFormFields(prev => ({ ...prev, docOfficeVisited: !prev.docOfficeVisited }));
                        }}
                        className={`flex items-center gap-2.5 p-2 px-3 rounded-xl transition-all text-left cursor-pointer select-none border ${
                          formFields.docOfficeVisited
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                        }`}
                        title="Toggle Office Visited"
                      >
                        <span className={`h-5 w-5 rounded-md flex items-center justify-center border text-[11px] font-black shrink-0 transition-all ${
                          formFields.docOfficeVisited 
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-2xs' 
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                        }`}>
                          {formFields.docOfficeVisited && '✓'}
                        </span>
                        <span className={`text-xs transition-all ${
                          formFields.docOfficeVisited 
                            ? 'text-emerald-800 dark:text-emerald-300 font-extrabold' 
                            : 'text-slate-800 dark:text-slate-300 font-bold'
                        }`}>
                          Office Visited
                        </span>
                      </button>

                      {/* Other Documents Checkbox */}
                      <button
                        type="button"
                        onClick={() => {
                          setFormFields(prev => ({ ...prev, docOthers: !prev.docOthers }));
                        }}
                        className={`flex items-center gap-2.5 p-2 px-3 rounded-xl transition-all text-left cursor-pointer select-none border ${
                          formFields.docOthers
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                        }`}
                        title="Toggle Other Documents Received"
                      >
                        <span className={`h-5 w-5 rounded-md flex items-center justify-center border text-[11px] font-black shrink-0 transition-all ${
                          formFields.docOthers 
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-2xs' 
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                        }`}>
                          {formFields.docOthers && '✓'}
                        </span>
                        <span className={`text-xs transition-all ${
                          formFields.docOthers 
                            ? 'text-emerald-800 dark:text-emerald-300 font-extrabold' 
                            : 'text-slate-800 dark:text-slate-300 font-bold'
                        }`}>
                          Other Documents
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Manual Observations (Editable Notes) */}
                  <div className="bg-white dark:bg-slate-900 p-4.5 rounded-2xl border border-slate-200 dark:border-slate-800 text-left shadow-2xs">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-xs font-black text-slate-900 dark:text-slate-300 block uppercase tracking-wider">Manual General Notes</h4>
                      <span className="text-[10px] text-slate-700 dark:text-slate-400 font-bold">Quick-save notes directly</span>
                    </div>
                    <textarea
                      placeholder="Type custom notes, documentation status, candidate preferences here..."
                      value={formFields.notes}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormFields(prev => ({ ...prev, notes: val }));
                      }}
                      className="w-full text-xs p-3 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-bold font-sans min-h-[100px] text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-500"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/leads/${lead.id}`, {
                              method: 'PUT',
                              headers: { 
                                'Content-Type': 'application/json',
                                'x-user-role': userRole,
                                'x-agent-id': currentAgentId
                              },
                              body: JSON.stringify({ ...formFields, notes: formFields.notes })
                            });
                            const data = await res.json();
                            if (res.ok) {
                              setLead(data);
                              onLeadUpdated();
                              const btn = document.getElementById('quick-save-notes-btn');
                              if (btn) {
                                const oldText = btn.innerHTML;
                                btn.innerHTML = 'Saved ✓';
                                btn.classList.add('bg-emerald-600');
                                setTimeout(() => {
                                  btn.innerHTML = oldText;
                                  btn.classList.remove('bg-emerald-600');
                                }, 1500);
                              }
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        id="quick-save-notes-btn"
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-extrabold transition-all cursor-pointer shadow-2xs uppercase tracking-wider"
                      >
                        Save Notes
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                
                // CGP Comprehensive spreadsheet-like form
                <form onSubmit={saveProfileEdits} className="space-y-4 animate-in fade-in duration-200 text-left">
                  {isSubAgent && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-900/30 text-amber-800 dark:text-amber-400 text-[11px] rounded-lg flex items-center gap-1.5 leading-relaxed font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                      <span>Seat Restriction: Sensitive fields (Name, Phone, Target country, Serial) are locked. Telecaller comments below are fully editable!</span>
                    </div>
                  )}

                  {/* 1. SPREADSHEET INDICES */}
                  <h4 className="text-xs font-black text-slate-900 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-750 pb-1">1. Spreadsheet Ingestion Identifiers</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Serial No</label>
                      <input
                        type="text"
                        name="serialNo"
                        disabled={isSubAgent}
                        value={formFields.serialNo}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none font-mono disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Entry Date</label>
                      <input
                        type="text"
                        name="entryDate"
                        disabled={isSubAgent}
                        value={formFields.entryDate}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none font-mono disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Star Importance</label>
                      <select
                        name="importance"
                        disabled={isSubAgent}
                        value={formFields.importance}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 cursor-pointer font-semibold"
                      >
                        <option value="1">⭐ Star Low (1)</option>
                        <option value="2">⭐⭐ Star Fair (2)</option>
                        <option value="3">⭐⭐⭐ Star Normal (3)</option>
                        <option value="4">⭐⭐⭐⭐ Star High (4)</option>
                        <option value="5">⭐⭐⭐⭐⭐ Star Urgent (5)</option>
                      </select>
                    </div>
                  </div>

                  {/* 2. DEMOGRAPHICS */}
                  <h4 className="text-xs font-black text-slate-900 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-750 pb-1 pt-2">2. Candidate Information</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Candidate Name</label>
                      <input
                        type="text"
                        name="name"
                        value={formFields.name}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Candidate Mobile No</label>
                      <input
                        type="text"
                        name="phone"
                        disabled={isSubAgent}
                        value={formFields.phone}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-mono font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Alternative No (Optional)</label>
                      <input
                        type="text"
                        name="alternateNo"
                        value={formFields.alternateNo}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-mono font-semibold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Gender</label>
                      <SearchableSelect
                        value={formFields.gender}
                        onChange={(val) => setFormFields(prev => ({ ...prev, gender: val }))}
                        options={[
                          { value: 'MALE', label: '👱‍♂️ MALE' },
                          { value: 'M', label: '👨 M' },
                          { value: 'FEMALE', label: '👩‍🦰 FEMALE' },
                          { value: 'F', label: '👩 F' },
                          { value: 'Not defined', label: '❓ NOT DEFINED' }
                        ]}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 font-semibold uppercase cursor-pointer"
                        dropdownClassName="w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Age</label>
                      <input
                        type="number"
                        name="age"
                        value={formFields.age}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-mono font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-400 mb-1">Origin / State</label>
                      <input
                        type="text"
                        name="origin"
                        placeholder="e.g. DARJEELING"
                        value={formFields.origin}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold uppercase"
                      />
                    </div>
                  </div>

                  {/* 3. JOB SECTOR */}
                  <h4 className="text-xs font-black text-slate-900 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200 dark:border-slate-750 pb-1 pt-2">3. Job Applied Profile</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Target Country</label>
                      <SearchableSelect
                        value={formFields.country}
                        onChange={(val) => setFormFields(prev => ({ ...prev, country: val }))}
                        options={[
                          { value: '', label: '✈️ SELECT COUNTRY' },
                          ...(propCountries && propCountries.length > 0 ? propCountries : ['Kuwait', 'Dubai', 'Qatar', 'Germany', 'Japan', 'Albania']).map(c => ({
                            value: c,
                            label: `✈️ ${c.toUpperCase()}`
                          }))
                        ]}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 text-slate-900 dark:text-slate-100 font-semibold uppercase cursor-pointer"
                        dropdownClassName="w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Coordinator</label>
                      <SearchableSelect
                        value={formFields.assignedTo}
                        onChange={(val) => setFormFields(prev => ({ ...prev, assignedTo: val }))}
                        options={[
                          { value: '', label: '👤 UNASSIGNED' },
                          ...(coordinators && coordinators.length > 0 ? (
                            coordinators.filter(c => c.role === 'agent').map(coord => ({
                              value: coord.username,
                              label: `👤 ${coord.displayName.toUpperCase()} (TELECALLER)`
                            }))
                          ) : (
                            ['Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'].map(coord => ({
                              value: coord,
                              label: `👤 ${coord.toUpperCase()} (TELECALLER)`
                            }))
                          ))
                        ]}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 text-emerald-800 dark:text-emerald-400 font-semibold cursor-pointer"
                        dropdownClassName="w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Assign Date</label>
                      <input
                        type="text"
                        name="assignDate"
                        disabled={isSubAgent}
                        placeholder="yyyy-mm-dd"
                        value={formFields.assignDate}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none font-mono disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Target Position / Line</label>
                      <SearchableSelect
                        value={formFields.position}
                        onChange={(val) => setFormFields(prev => ({ ...prev, position: val }))}
                        options={[
                          { value: '', label: '💼 SELECT POSITION' },
                          ...(propPositions && propPositions.length > 0 ? propPositions : ['Waiter', 'Waitress', 'Chef', 'Nurse', 'Cleaner', 'Driver', 'Electrician']).map(p => ({
                            value: p,
                            label: `💼 ${p.toUpperCase()}`
                          }))
                        ]}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-500 dark:disabled:text-slate-400 font-semibold uppercase cursor-pointer"
                        dropdownClassName="w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Experience Criteria</label>
                      <input
                        type="text"
                        name="experience"
                        placeholder="e.g. FRESHER"
                        value={formFields.experience}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Qualification</label>
                      <input
                        type="text"
                        name="qualification"
                        placeholder="e.g. 10th Pass, 12th, Graduate, ITI"
                        value={formFields.qualification || ''}
                        onChange={handleFieldChange}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1">Lead Source</label>
                      <SearchableSelect
                        value={formFields.source}
                        onChange={(val) => setFormFields(prev => ({ ...prev, source: val }))}
                        options={[
                          { value: '', label: '📣 UNKNOWN' },
                          { value: 'Ads', label: '📣 ADS' },
                          { value: 'Organic', label: '🌱 ORGANIC' },
                          { value: 'Website', label: '🌐 WEBSITE' },
                          { value: 'Instagram', label: '📸 INSTAGRAM' },
                          { value: 'Referral', label: '🤝 REFERRAL' },
                          { value: 'Other', label: '❓ OTHER' }
                        ]}
                        className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold uppercase cursor-pointer"
                        dropdownClassName="w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300">Hiring Project</label>
                        <button
                          type="button"
                          onClick={() => setIsAddingProject(!isAddingProject)}
                          className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 cursor-pointer"
                        >
                          {isAddingProject ? 'Cancel' : '+ Add Project'}
                        </button>
                      </div>
                      {isAddingProject ? (
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="Project..."
                            className="flex-1 text-xs sm:text-[13px] px-2 py-1 rounded border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (newProjectName.trim()) {
                                const trimmed = newProjectName.trim();
                                if (!projects.includes(trimmed)) {
                                  setProjects([...projects, trimmed]);
                                }
                                setFormFields(prev => ({ ...prev, project: trimmed }));
                                setNewProjectName('');
                                setIsAddingProject(false);
                              }
                            }}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shrink-0 cursor-pointer"
                          >
                            Add
                          </button>
                        </div>
                      ) : (
                        <SearchableSelect
                          value={formFields.project}
                          onChange={(val) => setFormFields(prev => ({ ...prev, project: val }))}
                          options={[
                            { value: '', label: '📁 UNKNOWN / GENERAL' },
                            ...projects.map(proj => ({
                              value: proj,
                              label: `📁 ${proj.toUpperCase()}`
                            }))
                          ]}
                          className="w-full text-xs sm:text-[13px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold uppercase cursor-pointer"
                          dropdownClassName="w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                        />
                      )}
                    </div>
                  </div>

                  {/* 4. ADMIN PLACEMENT & NOTES */}
                  <h4 className="text-xs font-black text-slate-900 dark:text-slate-300 uppercase tracking-widest border-b border-slate-200 dark:border-slate-750 pb-1 pt-2">4. Admin Placement & Notes</h4>
                  <div className="space-y-3">

                    <div>
                      <label className="block text-xs font-semibold text-rose-800 dark:text-rose-400 mb-1">Admin Placement instructions (Admins Only)</label>
                      <textarea
                        name="adminRemarks"
                        placeholder="Admin instructions only..."
                        disabled={isSubAgent}
                        value={formFields.adminRemarks}
                        onChange={handleFieldChange}
                        rows={2}
                        className="w-full text-xs sm:text-[13px] p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/30 text-rose-900 dark:text-rose-400 focus:ring-1 focus:ring-rose-500 focus:outline-none disabled:bg-slate-100 dark:disabled:bg-slate-950 disabled:text-slate-600 dark:disabled:text-slate-400 font-semibold"
                      />
                    </div>

                    {/* Interactive tags creator section */}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-750">
                      <label className="block text-xs font-semibold text-slate-800 dark:text-slate-300 mb-1 flex items-center gap-1.5 uppercase tracking-wider">
                        <span>🏷️ Candidate Category Tags</span>
                        <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400 capitalize">(Enter or click Add to save)</span>
                      </label>
                      <div className="flex flex-wrap gap-1.5 mb-2 p-2 bg-white dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-slate-750 min-h-[44px]">
                        {tags.length > 0 ? (
                          tags.map((tag, idx) => (
                            <span key={idx} className="bg-slate-800 dark:bg-slate-800 text-slate-100 dark:text-slate-200 text-[10px] font-extrabold px-2 py-1 rounded-lg flex items-center gap-1 border border-slate-700 dark:border-slate-700">
                              {tag}
                              <button
                                type="button"
                                onClick={() => setTags(tags.filter(t => t !== tag))}
                                className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer text-[12px] font-bold leading-none inline-block ml-1"
                              >
                                ×
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 italic self-center pl-1">No tags assigned. (e.g. Waiter, Waitress, Chef, Nurse)</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          id="new-tag-input"
                          value={tagInputVal}
                          onChange={(e) => setTagInputVal(e.target.value)}
                          placeholder="Add tag (e.g. Chef, Nurse, Waiter)..."
                          className="flex-1 text-xs sm:text-[13px] px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none font-semibold transition-all"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const val = tagInputVal.trim();
                              if (val) {
                                if (!tags.some(t => t.toLowerCase() === val.toLowerCase())) {
                                  setTags([...tags, val]);
                                }
                                setTagInputVal('');
                              }
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const val = tagInputVal.trim();
                            if (val) {
                              if (!tags.some(t => t.toLowerCase() === val.toLowerCase())) {
                                  setTags([...tags, val]);
                              }
                              setTagInputVal('');
                            }
                          }}
                          className="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-2xs"
                        >
                          Add Tag
                        </button>
                      </div>

                      {/* Auto-suggest dropdown matches */}
                      {suggestedTags.length > 0 && (
                        <div className="mt-2 p-2 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/30 rounded-xl animate-in fade-in slide-in-from-top-1 text-left">
                          <p className="text-[9px] uppercase font-bold text-indigo-700 dark:text-indigo-400 mb-1 tracking-wider">
                            💡 Matches from earlier candidate records (Click to add):
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {suggestedTags.map((sTag, sIdx) => (
                              <button
                                key={sIdx}
                                type="button"
                                onClick={() => {
                                  setTags([...tags, sTag]);
                                  setTagInputVal('');
                                }}
                                className="bg-white dark:bg-slate-900 hover:bg-indigo-600 text-slate-700 dark:text-slate-300 hover:text-white text-[10px] font-extrabold px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-600 transition-all cursor-pointer flex items-center gap-1 shadow-3xs"
                              >
                                <Plus className="h-2.5 w-2.5 text-indigo-600 dark:text-indigo-400 hover:text-white" />
                                <span>{sTag}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={savingForm}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-xs shrink-0 cursor-pointer uppercase tracking-wider"
                  >
                    {savingForm ? 'Saving Updates to cloud DB...' : 'Commit Remarks & Profile Changes'}
                    {saveSuccess && <CheckCircle2 className="h-4 w-4 text-white animate-bounce" />}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Right Column: Dynamic Action Hub (Timeline, Task Center, AISensy Templates) */}
          <div className="w-1/2 flex flex-col h-full bg-slate-50/50 dark:bg-slate-950/40 relative justify-between border-l border-slate-200 dark:border-slate-800">
            
            {/* Live Telecaller Call Status */}
            <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 space-y-3 shrink-0 text-left shadow-2xs">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
                  <PhoneCall className="h-4 w-4 text-purple-600 dark:text-purple-400" /> Live Telecaller Call Status
                </h4>
                <span className="text-[9px] font-extrabold text-white bg-emerald-600 dark:bg-emerald-700 px-2.5 py-0.5 rounded font-mono uppercase shadow-2xs">
                  Connected status
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setFormFields(prev => ({ ...prev, callConnected: 'connected' }));
                  }}
                  className={`py-2.5 px-4 rounded-xl font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    formFields.callConnected === 'connected'
                      ? 'bg-emerald-600 dark:bg-emerald-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750'
                  }`}
                >
                  <span className="text-white text-xs">🟢</span>
                  <span className="text-white">CONNECTED</span>
                  <Check className="h-3.5 w-3.5 text-white stroke-[3px]" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setFormFields(prev => ({ ...prev, callConnected: 'not_connected' }));
                  }}
                  className={`py-2.5 px-4 rounded-xl font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    formFields.callConnected === 'not_connected'
                      ? 'bg-rose-600 dark:bg-rose-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750'
                  }`}
                >
                  <span className="text-white text-xs">🔴</span>
                  <span>NOT CONNECTED</span>
                  <X className="h-3.5 w-3.5 text-white stroke-[3px]" />
                </button>
              </div>

              {formFields.callConnected === 'not_connected' && (
                <div className="p-2.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 rounded-xl text-[10.5px] font-bold flex items-center gap-1.5 animate-pulse mt-1">
                  <span>⚠️ Please schedule a callback task under "Actions & Reminders" below before committing.</span>
                </div>
              )}
            </div>

            {/* Header / Tabs switcher */}
            <div className="flex p-2 mt-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-20 shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setActiveRightTab('tasks')}
                className={`group flex-1 py-2.5 px-3 text-[11px] sm:text-xs font-black tracking-wider uppercase transition-all duration-200 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer border ${
                  activeRightTab === 'tasks'
                    ? 'bg-violet-700 text-white border-violet-700 shadow-2xs'
                    : 'bg-white text-slate-900 border-slate-200 hover:bg-violet-50 hover:border-violet-500 hover:text-violet-700 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-[#1f293d]'
                }`}
              >
                <ListTodo className={`h-3.5 w-3.5 ${activeRightTab === 'tasks' ? 'text-white' : 'text-slate-800 dark:text-slate-100 group-hover:text-violet-600 dark:group-hover:text-white'}`} />
                <span className={`font-black ${activeRightTab === 'tasks' ? 'text-white' : 'text-slate-900 dark:text-slate-100 group-hover:text-violet-700 dark:group-hover:text-white'}`}>
                  Actions & Reminders ({ (lead.tasks || []).filter(t => !t.completed).length })
                </span>
              </button>
              
              <button
                type="button"
                onClick={() => setActiveRightTab('timeline')}
                className={`group flex-1 py-2.5 px-3 text-[11px] sm:text-xs font-black tracking-wider uppercase transition-all duration-200 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer border ${
                  activeRightTab === 'timeline'
                    ? 'bg-violet-700 text-white border-violet-700 shadow-2xs'
                    : 'bg-white text-slate-900 border-slate-200 hover:bg-violet-50 hover:border-violet-500 hover:text-violet-700 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-[#1f293d]'
                }`}
              >
                <History className={`h-3.5 w-3.5 ${activeRightTab === 'timeline' ? 'text-white' : 'text-slate-800 dark:text-slate-100 group-hover:text-violet-600 dark:group-hover:text-white'}`} />
                <span className={`font-black ${activeRightTab === 'timeline' ? 'text-white' : 'text-slate-900 dark:text-slate-100 group-hover:text-violet-700 dark:group-hover:text-white'}`}>
                  Activity Timeline ({ lead.timeline?.length || 0 })
                </span>
              </button>
            </div>

            {/* Display selected tab */}
            <div className="flex-1 overflow-y-auto p-5 text-left">
              
              {/* TAB 1: ACTIONS & REMINDERS (Tasks list) */}
              {activeRightTab === 'tasks' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <h4 className="text-xs font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <ListTodo className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Schedule Telecaller Action Item
                    </h4>

                    <form onSubmit={handleAddTask} className="space-y-3">
                      <div>
                        <label className="block text-xs font-extrabold text-slate-900 dark:text-slate-300 uppercase tracking-wider">Action Description</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Callback to request passport scan..."
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          className="w-full text-xs sm:text-[13px] px-3 py-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all mt-1 font-bold"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-extrabold text-slate-900 dark:text-slate-300 uppercase tracking-wider mb-1">Follow-up Due Date</label>
                          <div className="relative">
                            <input
                              type="date"
                              required
                              value={newTaskDueDate}
                              onChange={(e) => setNewTaskDueDate(e.target.value)}
                              className="w-full text-xs sm:text-[13px] pl-8 pr-3 py-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-900 dark:text-slate-100 font-bold cursor-pointer dark:[color-scheme:dark] [color-scheme:light]"
                            />
                            <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-emerald-600 dark:text-emerald-400 pointer-events-none" />
                          </div>
                        </div>
                        <div className="flex items-end">
                          <button
                            type="submit"
                            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold rounded-lg transition-all shadow-2xs cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wider"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            Schedule Task
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-black text-slate-100 dark:text-slate-300 uppercase tracking-wider">Scheduled Tasks list</h4>
                    
                    {lead.tasks && lead.tasks.length > 0 ? (
                      <div className="space-y-2">
                        {lead.tasks.map((task) => (
                          <div 
                            key={task.id}
                            className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${
                              task.completed 
                                ? 'bg-slate-100/90 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 line-through shadow-2xs' 
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'
                            }`}
                          >
                            <div className="flex items-start gap-2.5 flex-1 pr-4">
                              <button
                                type="button"
                                onClick={() => handleToggleTask(task.id)}
                                className="p-0.5 hover:text-slate-900 dark:hover:text-slate-100 transition-colors shrink-0 mt-0.5 cursor-pointer"
                              >
                                {task.completed ? (
                                  <CheckSquare className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <Square className="h-4.5 w-4.5 text-slate-500 dark:text-slate-500" />
                                )}
                              </button>
                              <div className="text-xs text-left">
                                <p className={`font-black uppercase tracking-wide ${task.completed ? 'text-slate-700 dark:text-slate-400' : 'text-black dark:text-slate-100'}`}>
                                  {task.title}
                                </p>
                                <span className="text-[10px] text-slate-700 dark:text-slate-400 font-mono flex items-center gap-1 mt-0.5 font-bold">
                                  <Calendar className="h-3 w-3 text-slate-600 dark:text-slate-400" /> 
                                  <span>Due:</span> 
                                  <strong className={task.completed ? 'text-slate-700 dark:text-slate-400' : 'text-rose-600 dark:text-rose-400 font-black'}>{task.dueDate}</strong>
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteTask(task.id)}
                              className="p-1.5 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg transition-colors shrink-0 cursor-pointer"
                              title="Delete task item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-400 space-y-1.5 shadow-2xs">
                        <ListTodo className="h-8 w-8 text-slate-400 dark:text-slate-600 mx-auto stroke-[1.5]" />
                        <p className="text-xs font-black text-black dark:text-slate-300">No active follow-up reminders scheduled.</p>
                        <p className="text-[10px] text-slate-700 dark:text-slate-400 font-semibold">Add tasks above to remind your telecaller of client updates.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: ACTIVITY TIMELINE */}
              {activeRightTab === 'timeline' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  {/* Timeline Header & Count */}
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <History className="h-4.5 w-4.5 text-indigo-600 dark:text-indigo-400" />
                        <h4 className="text-xs font-black text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                          Activity Timeline & Audit Trail
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-extrabold text-indigo-700 dark:text-indigo-400 font-mono bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/40 px-2.5 py-0.5 rounded-full">
                          {timelineCounts.total} Events Recorded
                        </span>
                        <button
                          type="button"
                          onClick={() => fetchTimelineData(true)}
                          disabled={isTimelineLoading}
                          className="text-[10px] font-extrabold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 px-2.5 py-0.5 rounded-full transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs active:scale-95 disabled:opacity-50"
                          title="Refresh historical call remarks & activity timeline"
                        >
                          <RefreshCw className={`h-3 w-3 text-indigo-600 dark:text-indigo-400 ${isTimelineLoading ? 'animate-spin' : ''}`} />
                          <span>Sync</span>
                        </button>
                      </div>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setTimelineFilter('all')}
                        className={`text-[11px] font-black px-3 py-1.5 rounded-lg transition-all cursor-pointer border ${
                          timelineFilter === 'all'
                            ? 'bg-violet-700 text-white border-violet-700 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        All ({timelineCounts.total})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTimelineFilter('status')}
                        className={`text-[11px] font-black px-3 py-1.5 rounded-lg transition-all cursor-pointer border ${
                          timelineFilter === 'status'
                            ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        📈 Stage ({timelineCounts.status})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTimelineFilter('remark')}
                        className={`text-[11px] font-black px-3 py-1.5 rounded-lg transition-all cursor-pointer border ${
                          timelineFilter === 'remark'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        📞 Remarks ({timelineCounts.remark})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTimelineFilter('assignment')}
                        className={`text-[11px] font-black px-3 py-1.5 rounded-lg transition-all cursor-pointer border ${
                          timelineFilter === 'assignment'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        👤 Coordinator ({timelineCounts.assignment})
                      </button>
                      <button
                        type="button"
                        onClick={() => setTimelineFilter('task')}
                        className={`text-[11px] font-black px-3 py-1.5 rounded-lg transition-all cursor-pointer border ${
                          timelineFilter === 'task'
                            ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        📝 Tasks ({timelineCounts.task})
                      </button>
                    </div>

                    {/* Search Input Box */}
                    <div className="relative mt-1">
                      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search timeline by coordinator or remark keywords..."
                        value={timelineSearch}
                        onChange={(e) => setTimelineSearch(e.target.value)}
                        className="w-full text-xs sm:text-[13px] pl-8.5 pr-7 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-semibold"
                      />
                      {timelineSearch && (
                        <button
                          type="button"
                          onClick={() => setTimelineSearch('')}
                          className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-bold"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Activity Timeline Content or Skeleton Loader */}
                  {isTimelineLoading ? (
                    <div className="space-y-4 pt-1 text-left animate-in fade-in duration-150">
                      <div className="flex items-center gap-2 py-2 px-3 bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/60 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-extrabold shadow-2xs">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span>Fetching historical remarks & activity timeline...</span>
                      </div>

                      {/* Skeleton Timeline Items */}
                      <div className="relative pl-5 border-l-2 border-slate-200 dark:border-slate-800 ml-2 space-y-4">
                        {[1, 2, 3].map((idx) => (
                          <div key={idx} className="relative text-left">
                            {/* Marker Icon Skeleton */}
                            <div className="absolute -left-7 top-1 h-5 w-5 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse border-2 border-slate-300 dark:border-slate-700 shadow-2xs" />

                            {/* Card Content Skeleton */}
                            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5 shadow-2xs animate-pulse">
                              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-2">
                                  {/* Event Type Badge Skeleton */}
                                  <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded-md" />
                                  {/* Coordinator Badge Skeleton */}
                                  <div className="h-4 w-28 bg-purple-100 dark:bg-purple-950/80 rounded-md" />
                                </div>
                                {/* Date Skeleton */}
                                <div className="h-3 w-28 bg-slate-200 dark:bg-slate-800 rounded" />
                              </div>

                              {/* Body Text Line Skeletons */}
                              <div className="space-y-1.5 pt-1">
                                <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-11/12" />
                                <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded w-3/4" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : filteredTimeline && filteredTimeline.length > 0 ? (
                    <div className="relative pl-5 border-l-2 border-slate-200 dark:border-slate-800 ml-2 space-y-4">
                      {filteredTimeline.map((event) => {
                        const isStage = event.type === 'status';
                        const isRemark = event.type === 'remark';
                        const isAssign = event.type === 'assignment';
                        const isTask = event.type === 'task';
                        const isCreation = event.type === 'creation';

                        const formattedDate = event.timestamp
                          ? `${new Date(event.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${new Date(event.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                          : 'Recent';

                        return (
                          <div key={event.id} className="relative group text-left">
                            {/* Marker Icon */}
                            <div className={`absolute -left-7 top-1 h-5 w-5 rounded-full border-2 flex items-center justify-center text-[10px] shadow-xs ${
                              isStage ? 'bg-purple-100 dark:bg-purple-950 border-purple-500 text-purple-700 dark:text-purple-300' :
                              isRemark ? 'bg-amber-100 dark:bg-amber-950 border-amber-500 text-amber-700 dark:text-amber-300' :
                              isAssign ? 'bg-emerald-100 dark:bg-emerald-950 border-emerald-500 text-emerald-700 dark:text-emerald-300' :
                              isTask ? 'bg-teal-100 dark:bg-teal-950 border-teal-500 text-teal-700 dark:text-teal-300' :
                              isCreation ? 'bg-indigo-100 dark:bg-indigo-950 border-indigo-500 text-indigo-700 dark:text-indigo-300' :
                              'bg-slate-100 dark:bg-slate-900 border-slate-400 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                            }`}>
                              {isStage && '📈'}
                              {isRemark && '📞'}
                              {isAssign && '👤'}
                              {isTask && '📝'}
                              {isCreation && '✨'}
                              {!isStage && !isRemark && !isAssign && !isTask && !isCreation && '⚙️'}
                            </div>

                            {/* Card Content */}
                            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-all text-xs shadow-xs space-y-2">
                              {/* Header Meta */}
                              <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1.5 border-b border-slate-100 dark:border-slate-800">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {/* Event Type Pill */}
                                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md tracking-wider border ${
                                    isStage ? 'bg-purple-50 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60' :
                                    isRemark ? 'bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60' :
                                    isAssign ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60' :
                                    isTask ? 'bg-teal-50 dark:bg-teal-950/80 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/60' :
                                    isCreation ? 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60' :
                                    'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                  }`}>
                                    {isStage && 'Stage Change'}
                                    {isRemark && 'Call Remark'}
                                    {isAssign && 'Coordinator Reassigned'}
                                    {isTask && 'Action Item'}
                                    {isCreation && 'Inbound Lead'}
                                    {!isStage && !isRemark && !isAssign && !isTask && !isCreation && 'System Log'}
                                  </span>

                                  {/* Coordinator / Actor Pill */}
                                  <span className="text-[10px] font-black bg-purple-100 dark:bg-purple-950/80 border border-purple-300 dark:border-purple-800 px-2.5 py-0.5 rounded-md inline-flex items-center gap-1 shadow-2xs">
                                    <span className="text-purple-900 dark:text-purple-300 font-black">By:</span>
                                    <span className="text-black dark:text-slate-100 font-black">
                                      {event.actor || 'System Administrator'}
                                    </span>
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                    {formattedDate}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(`${event.actor}: ${event.text} (${formattedDate})`);
                                      setCopiedLogId(event.id);
                                      setTimeout(() => setCopiedLogId(null), 2000);
                                    }}
                                    className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors cursor-pointer"
                                    title="Copy log entry"
                                  >
                                    {copiedLogId === event.id ? (
                                      <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                    ) : (
                                      <Copy className="h-3 w-3" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* Text Body */}
                              <p className="text-slate-800 dark:text-slate-200 leading-relaxed font-semibold font-sans whitespace-pre-wrap text-xs pt-0.5">
                                {event.text}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 space-y-1.5 shadow-xs">
                      <History className="h-8 w-8 text-slate-400 dark:text-slate-500 mx-auto opacity-40" />
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No activity events found.</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        {timelineSearch || timelineFilter !== 'all' 
                          ? 'Try clearing your search or category filters.'
                          : 'Stage transitions, call remarks, and coordinator updates automatically log here in real-time.'}
                      </p>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Footer quick instructions banner */}
            <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-3 text-[10px] text-slate-500 dark:text-slate-400 font-mono text-center shrink-0">
              ⚡ Career Growth Placement • Candidate Pipeline & Follow-ups live in Cloud Storage.
            </div>

          </div>

        </div>

      </motion.div>
    </motion.div>
  );
}
