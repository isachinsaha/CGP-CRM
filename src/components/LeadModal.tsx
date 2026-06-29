import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Lead, LeadStage, FitScore, Coordinator } from '../types.ts';
import { 
  X, Info, Sparkles, CheckCircle2, RefreshCw, AlertTriangle, 
  Calendar, Clipboard, Check, Star, ListTodo, History, 
  Send, Trash2, ArrowRight, CheckSquare, Square, MessageSquare, ExternalLink, Bell, Plus
} from 'lucide-react';
import { getCountryFlagUrl } from '../utils';

interface LeadModalProps {
  lead: Lead;
  onClose: () => void;
  onLeadUpdated: () => void;
  userRole: 'admin' | 'agent';
  currentAgentId: string;
  allLeads?: Lead[];
  coordinators?: Coordinator[];
}

export default function LeadModal({ 
  lead: initialLead, 
  onClose, 
  onLeadUpdated, 
  userRole, 
  currentAgentId,
  allLeads = [],
  coordinators = []
}: LeadModalProps) {
  const [lead, setLead] = useState<Lead>(initialLead);
  const [activeLeftTab, setActiveLeftTab] = useState<'ai' | 'profile'>('ai');
  const [activeRightTab, setActiveRightTab] = useState<'tasks' | 'timeline'>('tasks');
  
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
    const defaults = [
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
    const saved = localStorage.getItem('crm_projects');
    return saved ? JSON.parse(saved) : ['Napkin affairs', 'Alltoobi', 'Lulu hypermarket', 'General Intake'];
  });
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    localStorage.setItem('crm_projects', JSON.stringify(projects));
  }, [projects]);

  // Editable Form fields supporting entire spreadsheet columns of Career Growth Placement
  const [formFields, setFormFields] = useState({
    name: initialLead.name,
    phone: initialLead.phone,
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
    gender: initialLead.gender || 'M',
    age: initialLead.age !== undefined ? String(initialLead.age) : '24',
    origin: initialLead.origin || '',
    country: initialLead.country || '',
    position: initialLead.position || '',
    experience: initialLead.experience || '',
    adminRemarks: initialLead.adminRemarks || '',
    assignedTo: initialLead.assignedTo || '',
    importance: initialLead.importance !== undefined ? Number(initialLead.importance) : 3,
    remarks1: initialLead.remarks1 || '',
    remarks2: initialLead.remarks2 || '',
    remarks3: initialLead.remarks3 || '',
    source: initialLead.source || '',
    project: initialLead.project || '',
    docPassportCopy: !!initialLead.docPassportCopy,
    docResume: !!initialLead.docResume,
    docOfficeVisited: !!initialLead.docOfficeVisited,
    docOthers: !!initialLead.docOthers,
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
      gender: initialLead.gender || 'M',
      age: initialLead.age !== undefined ? String(initialLead.age) : '24',
      origin: initialLead.origin || '',
      country: initialLead.country || '',
      position: initialLead.position || '',
      experience: initialLead.experience || '',
      adminRemarks: initialLead.adminRemarks || '',
      assignedTo: initialLead.assignedTo || '',
      importance: initialLead.importance !== undefined ? Number(initialLead.importance) : 3,
      remarks1: initialLead.remarks1 || '',
      remarks2: initialLead.remarks2 || '',
      remarks3: initialLead.remarks3 || '',
      source: initialLead.source || '',
      project: initialLead.project || '',
      docPassportCopy: !!initialLead.docPassportCopy,
      docResume: !!initialLead.docResume,
      docOfficeVisited: !!initialLead.docOfficeVisited,
      docOthers: !!initialLead.docOthers,
      reminderEnabled: !!initialLead.reminderEnabled
    });
    isFirstMountOrChangeRef.current = true;
  }, [initialLead.id]);

  // Background auto-save has been disabled to prevent continuous re-rendering and the modal re-opening bug.
  // Changes are now explicitly committed using the Save buttons.

  const handleFieldChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormFields(prev => {
      const updated = {
        ...prev,
        [name]: value
      };
      
      // Auto-move stage from 'new' to 'contacted' when the 1'st remark is logged
      if (
        prev.stage === 'new' &&
        ['remarks1', 'remarks2', 'remarks3'].includes(name) &&
        value.trim() !== ''
      ) {
        updated.stage = 'contacted';
      }
      
      return updated;
    });
  };

  // Submit profile updates to backend server
  const saveProfileEdits = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSavingForm(true);
    setSaveSuccess(false);

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
        body: JSON.stringify({
          ...formFields,
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
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-left" id="cgp-leads-modal">
      <div className="bg-slate-850 rounded-3xl shadow-2xl border border-slate-750 w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-300">
        
        {/* Header ribbon */}
        <div className="bg-slate-900/30 px-6 py-4 border-b border-slate-750 flex flex-col sm:flex-row gap-4 justify-between sm:items-center">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-slate-900 text-slate-100 rounded-xl">
              <Info className="h-5.5 w-5.5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-extrabold text-slate-100 text-lg">{lead.name}</h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${getFitStyle(lead.fitScore)}`}>
                  {lead.fitScore} Fit
                </span>
                {lead.country && (
                  <span className="text-[10px] bg-emerald-950/40 text-emerald-400 border border-emerald-900/30 rounded-md px-1.5 py-0.5 font-bold uppercase flex items-center gap-1">
                    {getCountryFlagUrl(lead.country) ? (
                      <img 
                        src={getCountryFlagUrl(lead.country)} 
                        alt="" 
                        className="w-3.5 h-2.5 object-cover rounded-2xs shadow-3xs"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span>🌐</span>
                    )}
                    Target: {lead.country}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Serial No: <span className="text-slate-200 font-bold">{lead.serialNo || 'Pending'}</span> 
                {' • '} Phone: <span className="text-slate-200 font-bold">{lead.phone}</span> 
                {lead.assignedTo && (
                  <>
                    {' • '} Coordinator:{' '}
                    <span className="text-emerald-400 font-extrabold bg-emerald-950/40 px-1.5 py-0.5 rounded-sm border border-emerald-900/30">
                      {lead.assignedTo}
                    </span>
                  </>
                )}
                {lead.source && (
                  <>
                    {' • '} Source:{' '}
                    <span className="text-amber-400 font-bold bg-amber-950/40 px-1.5 py-0.5 rounded-sm border border-amber-900/30 uppercase">
                      {lead.source}
                    </span>
                  </>
                )}
                {lead.project && (
                  <>
                    {' • '} Project:{' '}
                    <span className="text-indigo-400 font-bold bg-purple-950/40 px-1.5 py-0.5 rounded-sm border border-purple-900/30 uppercase">
                      {lead.project}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
            {/* Smaller Stage selection */}
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-750">
              <span className="text-[9px] uppercase font-black text-slate-400 px-1 font-mono">Stage:</span>
              <select
                value={formFields.stage}
                name="stage"
                onChange={handleFieldChange}
                className="text-[11px] font-extrabold rounded bg-slate-950 text-slate-300 px-2 py-1 border-none focus:outline-none cursor-pointer"
              >
                <option value="new">New Inbound</option>
                <option value="contacted">Initial Contact</option>
                <option value="negotiating">In Discussion</option>
                <option value="proposal">Office Visited</option>
                <option value="won">Closed Won</option>
                <option value="lost">Closed Lost</option>
              </select>
            </div>

            {/* Smaller Reminder Toggle Switch */}
            <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-750">
              <span className="text-[9px] uppercase font-black text-slate-400 px-1 font-mono flex items-center gap-0.5">
                <Bell className={`h-3 w-3 ${formFields.reminderEnabled ? 'text-indigo-400 fill-indigo-400' : 'text-slate-450'}`} />
                <span>Reminder:</span>
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
                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  formFields.reminderEnabled ? 'bg-indigo-600' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    formFields.reminderEnabled ? 'translate-x-3' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Top-Right Save Changes Button */}
            <button
              type="button"
              onClick={() => saveProfileEdits()}
              disabled={savingForm}
              className={`flex items-center justify-center gap-1.5 px-3.5 py-1.5 h-8 min-w-[92px] font-black text-[11px] rounded-xl shadow-3xs transition-all duration-200 cursor-pointer disabled:opacity-50 uppercase tracking-wider border select-none ${
                saveSuccess 
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm shadow-emerald-600/15' 
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 hover:shadow-md hover:shadow-emerald-600/15 active:scale-95'
              }`}
            >
              {savingForm ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="h-3.5 w-3.5 text-white stroke-[3.5px]" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Save</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-100 rounded-xl transition-all"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Double Column Area */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Left Column: Form Details / Smart Metadata */}
          <div className="w-1/2 border-r border-slate-750 flex flex-col bg-slate-900/10 overflow-y-auto">
            
            {/* Left Tabs */}
            <div className="flex p-2 bg-slate-900/50 border-b border-slate-750 shrink-0 sticky top-0 z-20 gap-2">
              <button
                type="button"
                onClick={() => setActiveLeftTab('ai')}
                className={`flex-1 py-2.5 text-[11px] font-black tracking-wider uppercase transition-all duration-200 rounded-xl flex items-center justify-center gap-2 shadow-3xs ${
                  activeLeftTab === 'ai'
                    ? 'bg-emerald-600 text-white border border-emerald-700'
                    : 'bg-transparent text-slate-400 hover:text-slate-100 font-bold'
                }`}
              >
                <Sparkles className={`h-3.5 w-3.5 ${activeLeftTab === 'ai' ? 'text-white' : 'text-emerald-600'}`} /> AI Classification
              </button>
              <button
                type="button"
                onClick={() => setActiveLeftTab('profile')}
                className={`flex-1 py-2.5 text-[11px] font-black tracking-wider uppercase transition-all duration-200 rounded-xl flex items-center justify-center gap-2 shadow-3xs ${
                  activeLeftTab === 'profile'
                    ? 'bg-emerald-600 text-white border border-emerald-700'
                    : 'bg-transparent text-slate-400 hover:text-slate-100 font-bold'
                }`}
              >
                <Clipboard className={`h-3.5 w-3.5 ${activeLeftTab === 'profile' ? 'text-white' : 'text-slate-400'}`} /> Office Form Sheet
              </button>
            </div>

            <div className="p-5.5 space-y-6 flex-1 text-left">
              {activeLeftTab === 'ai' ? (
                <div className="space-y-5 animate-in fade-in duration-200">
                  
                  {/* AI Profiling Highlights block */}
                  <div className="bg-emerald-950/20 p-4 rounded-xl border border-emerald-900/30 relative">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 tracking-wider">
                        <Sparkles className="h-4 w-4 text-emerald-500" /> AI PLACEMENT INTERPRETER
                      </div>
                      <button
                        type="button"
                        onClick={triggerRequalification}
                        disabled={isRequalifying}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-emerald-600 hover:text-zinc-950 border border-slate-700 text-emerald-400 font-bold text-[9px] rounded transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className={`h-2.5 w-2.5 ${isRequalifying ? 'animate-spin' : ''}`} />
                        {isRequalifying ? 'Analyzing...' : 'Re-Analyze Profile'}
                      </button>
                    </div>

                    <div className="space-y-2.5 text-xs">
                      <div>
                        <span className="text-slate-400 font-semibold block">Inbound Intent Summary:</span>
                        <p className="text-slate-300 leading-relaxed font-semibold mt-0.5">{lead.summary}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-slate-400 font-semibold block">Extracted Target Country:</span>
                          <span className="text-slate-100 font-bold flex items-center gap-1.5 mt-0.5">
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
                          <span className="text-slate-400 font-semibold block">Placement Target Position:</span>
                          <span className="text-slate-100 font-extrabold block mt-0.5">
                            💼 {lead.position || 'General Openings'}
                          </span>
                        </div>
                      </div>

                      <div>
                        <span className="text-slate-400 font-semibold block">Skills Extracted:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {lead.requirements && lead.requirements.length > 0 ? (
                            lead.requirements.map((req, idx) => (
                              <span key={idx} className="bg-emerald-950/40 text-emerald-400 border border-emerald-900/20 text-[9px] px-2 py-0.5 rounded font-bold uppercase">
                                {req}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400 italic text-[10px]">None extracted</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Call Remarks Sheet overview (G-Sheet Equivalent!) */}
                  <div className="bg-slate-900/20 p-4.5 rounded-xl border border-slate-750 space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-750 pb-1.5 flex items-center justify-between">
                      <span>Live Telecaller Remarks columns</span>
                      <span className="text-[9px] font-semibold text-slate-400 uppercase bg-slate-900 border border-slate-750 px-1.5 py-0.5 rounded-sm font-mono">Synced on commit</span>
                    </h4>

                    <div className="space-y-2.5 text-xs">
                      <div className="grid grid-cols-1 gap-2.5">
                        <div className="p-2.5 bg-slate-900/40 rounded-lg border border-slate-750 text-left">
                          <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Remarks 1 (First Contact Outcome)</span>
                          <p className="text-slate-300 italic font-mono mt-1 leading-relaxed">
                            {lead.remarks1 ? `"${lead.remarks1}"` : '— No remarks logged yet.'}
                          </p>
                        </div>
                        <div className="p-2.5 bg-slate-900/40 rounded-lg border border-slate-750 text-left">
                          <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Remarks 2 (Follow-up Call Comments)</span>
                          <p className="text-slate-300 italic font-mono mt-1 leading-relaxed">
                            {lead.remarks2 ? `"${lead.remarks2}"` : '— No remarks logged yet.'}
                          </p>
                        </div>
                        <div className="p-2.5 bg-slate-900/40 rounded-lg border border-slate-750 text-left">
                          <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider">Remarks 3 (Final Decision Remarks)</span>
                          <p className="text-slate-300 italic font-mono mt-1 leading-relaxed">
                            {lead.remarks3 ? `"${lead.remarks3}"` : '— No remarks logged yet.'}
                          </p>
                        </div>
                      </div>

                      {lead.adminRemarks && (
                        <div className="mt-2 p-2.5 bg-rose-950/20 border border-rose-900/30 text-rose-300 rounded-lg text-left">
                          <span className="text-[9px] font-bold text-rose-400 block uppercase">Admin Placement Instructions Directive</span>
                          <p className="font-semibold leading-relaxed mt-0.5">{lead.adminRemarks}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Documents Status Visualization */}
                  <div className="bg-slate-900/20 p-4.5 rounded-xl border border-slate-750 text-left">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-750 pb-1.5 mb-3 flex items-center justify-between">
                      <span>Candidate Document Checklist</span>
                      <span className="text-[9px] font-semibold text-slate-400 uppercase bg-slate-900 border border-slate-750 px-1.5 py-0.5 rounded-sm">Verification Desk</span>
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`h-4.5 w-4.5 rounded-md flex items-center justify-center border text-[10px] font-black ${lead.docPassportCopy ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-slate-900 border-slate-750 text-slate-500'}`}>
                          {lead.docPassportCopy ? '✓' : ''}
                        </span>
                        <span className={`font-bold ${lead.docPassportCopy ? 'text-slate-100' : 'text-slate-500'}`}>Passport Copy</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`h-4.5 w-4.5 rounded-md flex items-center justify-center border text-[10px] font-black ${lead.docResume ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-slate-900 border-slate-750 text-slate-500'}`}>
                          {lead.docResume ? '✓' : ''}
                        </span>
                        <span className={`font-bold ${lead.docResume ? 'text-slate-100' : 'text-slate-500'}`}>Resume / CV</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`h-4.5 w-4.5 rounded-md flex items-center justify-center border text-[10px] font-black ${lead.docOfficeVisited ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-slate-900 border-slate-750 text-slate-500'}`}>
                          {lead.docOfficeVisited ? '✓' : ''}
                        </span>
                        <span className={`font-bold ${lead.docOfficeVisited ? 'text-slate-100' : 'text-slate-500'}`}>Office Visited</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`h-4.5 w-4.5 rounded-md flex items-center justify-center border text-[10px] font-black ${lead.docOthers ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-slate-900 border-slate-750 text-slate-500'}`}>
                          {lead.docOthers ? '✓' : ''}
                        </span>
                        <span className={`font-bold ${lead.docOthers ? 'text-slate-100' : 'text-slate-500'}`}>Other Documents</span>
                      </div>
                    </div>
                  </div>

                  {/* Manual Observations (Editable Notes) */}
                  <div className="bg-slate-900/20 p-4.5 rounded-xl border border-slate-750 text-left">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-xs font-bold text-slate-300 block uppercase tracking-wider">Manual General Notes</h4>
                      <span className="text-[10px] text-slate-400 font-medium">Quick-save notes directly</span>
                    </div>
                    <textarea
                      placeholder="Type custom notes, documentation status, candidate preferences here..."
                      value={formFields.notes}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormFields(prev => ({ ...prev, notes: val }));
                      }}
                      className="w-full text-xs p-3 rounded-lg bg-slate-900 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-900 transition-all font-semibold font-sans min-h-[100px] text-slate-100"
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
                        className="px-3 py-1 bg-slate-900 hover:bg-black text-white rounded text-[10px] font-extrabold transition-all"
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
                    <div className="p-3 bg-amber-950/20 border border-amber-900/30 text-amber-400 text-[11px] rounded-lg flex items-center gap-1.5 leading-relaxed font-semibold">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span>Seat Restriction: Sensitive fields (Name, Phone, Target country, Serial) are locked. Telecaller comments below are fully editable!</span>
                    </div>
                  )}

                  {/* 1. SPREADSHEET INDICES */}
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-750 pb-1">1. Spreadsheet Ingestion Identifiers</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Serial No</label>
                      <input
                        type="text"
                        name="serialNo"
                        disabled={isSubAgent}
                        value={formFields.serialNo}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none font-mono disabled:bg-slate-950 disabled:text-slate-400 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Entry Date</label>
                      <input
                        type="text"
                        name="entryDate"
                        disabled={isSubAgent}
                        value={formFields.entryDate}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none font-mono disabled:bg-slate-950 disabled:text-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Star Importance</label>
                      <select
                        name="importance"
                        disabled={isSubAgent}
                        value={formFields.importance}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400 cursor-pointer"
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
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-750 pb-1 pt-2">2. Candidate Information</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Candidate Name</label>
                      <input
                        type="text"
                        name="name"
                        disabled={isSubAgent}
                        value={formFields.name}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400 font-extrabold uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Candidate Mobile No</label>
                      <input
                        type="text"
                        name="phone"
                        disabled={isSubAgent}
                        value={formFields.phone}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400 font-mono font-bold"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Gender</label>
                      <select
                        name="gender"
                        disabled={isSubAgent}
                        value={formFields.gender}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400 cursor-pointer uppercase font-bold"
                      >
                        <option value="MALE">Male (MALE)</option>
                        <option value="FEMALE">Female (FEMALE)</option>
                        <option value="M">Male (M)</option>
                        <option value="F">Female (F)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Age</label>
                      <input
                        type="number"
                        name="age"
                        disabled={isSubAgent}
                        value={formFields.age}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Origin / State</label>
                      <input
                        type="text"
                        name="origin"
                        placeholder="e.g. DARJEELING"
                        disabled={isSubAgent}
                        value={formFields.origin}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400 font-semibold uppercase"
                      />
                    </div>
                  </div>

                  {/* 3. JOB SECTOR */}
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-750 pb-1 pt-2">3. Job Applied Profile</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Target Country</label>
                      <input
                        type="text"
                        name="country"
                        placeholder="e.g. QATAR"
                        disabled={isSubAgent}
                        value={formFields.country}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 text-slate-100 font-bold uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Coordinator</label>
                      <select
                        name="assignedTo"
                        disabled={isSubAgent}
                        value={formFields.assignedTo}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 text-emerald-400 font-bold cursor-pointer"
                      >
                        <option value="">-- Unassigned --</option>
                        {coordinators && coordinators.length > 0 ? (
                          coordinators.filter(c => c.role === 'agent').map(coord => (
                            <option key={coord.id} value={coord.username}>{coord.displayName} (Telecaller)</option>
                          ))
                        ) : (
                          ['Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'].map(coord => (
                            <option key={coord} value={coord}>{coord} (Telecaller)</option>
                          ))
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Assign Date</label>
                      <input
                        type="text"
                        name="assignDate"
                        disabled={isSubAgent}
                        placeholder="yyyy-mm-dd"
                        value={formFields.assignDate}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none font-mono disabled:bg-slate-950 disabled:text-slate-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Target Position / Line</label>
                      <input
                        type="text"
                        name="position"
                        placeholder="e.g. WAITSTAND / Nurse"
                        disabled={isSubAgent}
                        value={formFields.position}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400 font-medium uppercase"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Experience Criteria</label>
                      <input
                        type="text"
                        name="experience"
                        placeholder="e.g. FRESHER"
                        disabled={isSubAgent}
                        value={formFields.experience}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Lead Source</label>
                      <select
                        name="source"
                        disabled={isSubAgent}
                        value={formFields.source}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400 font-medium uppercase cursor-pointer"
                      >
                        <option value="">-- Unknown --</option>
                        <option value="Ads">Ads 📣</option>
                        <option value="Organic">Organic 🌱</option>
                        <option value="Website">Website 🌐</option>
                        <option value="Instagram">Instagram 📸</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-0.5">
                        <label className="block text-[11px] font-semibold text-slate-400">Hiring Project</label>
                        {!isSubAgent && (
                          <button
                            type="button"
                            onClick={() => setIsAddingProject(!isAddingProject)}
                            className="text-[10px] font-extrabold text-emerald-500 hover:text-emerald-400 cursor-pointer"
                          >
                            {isAddingProject ? 'Cancel' : '+ Add Project'}
                          </button>
                        )}
                      </div>
                      {isAddingProject ? (
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="Project..."
                            className="flex-1 text-xs px-2 py-1 rounded border border-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-900 text-slate-100 font-bold"
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
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shrink-0"
                          >
                            Add
                          </button>
                        </div>
                      ) : (
                        <select
                          name="project"
                          disabled={isSubAgent}
                          value={formFields.project}
                          onChange={handleFieldChange}
                          className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none disabled:bg-slate-950 disabled:text-slate-400 font-semibold uppercase cursor-pointer"
                        >
                          <option value="">-- Unknown / General --</option>
                          {projects.map((proj, idx) => (
                            <option key={idx} value={proj}>{proj}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* 3.5 DOCUMENTS RECEIVED STATUS */}
                  <h4 className="text-xs font-black text-slate-300 uppercase tracking-widest border-b border-slate-750 pb-1 pt-2">Candidate Document received status</h4>
                  <div className="grid grid-cols-2 gap-3 bg-slate-900/40 p-3 rounded-xl border border-slate-750">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs font-bold text-slate-300">
                      <input
                        type="checkbox"
                        checked={formFields.docPassportCopy}
                        onChange={(e) => setFormFields(prev => ({ ...prev, docPassportCopy: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-700 text-indigo-400 focus:ring-indigo-500 cursor-pointer bg-slate-950"
                      />
                      <span>Passport Copy Received</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs font-bold text-slate-300">
                      <input
                        type="checkbox"
                        checked={formFields.docResume}
                        onChange={(e) => setFormFields(prev => ({ ...prev, docResume: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-700 text-indigo-400 focus:ring-indigo-500 cursor-pointer bg-slate-950"
                      />
                      <span>Resume / CV Received</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs font-bold text-slate-300">
                      <input
                        type="checkbox"
                        checked={formFields.docOfficeVisited}
                        onChange={(e) => setFormFields(prev => ({ ...prev, docOfficeVisited: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-700 text-indigo-400 focus:ring-indigo-500 cursor-pointer bg-slate-950"
                      />
                      <span>Office Visited Status</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs font-bold text-slate-300">
                      <input
                        type="checkbox"
                        checked={formFields.docOthers}
                        onChange={(e) => setFormFields(prev => ({ ...prev, docOthers: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-700 text-indigo-400 focus:ring-indigo-500 cursor-pointer bg-slate-950"
                      />
                      <span>Others (Additional Docs)</span>
                    </label>
                  </div>

                  {/* 4. TELECALLER REMARKS (FULLY EDITABLE FOR ALL SEATS) */}
                  <h4 className="text-xs font-black text-slate-300 uppercase tracking-widest border-b border-slate-750 pb-1 pt-2">4. Live Telecaller Call Comments</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 mb-0.5">📞 Call Remarks Column 1 (First Contact outcome)</label>
                      <input
                        type="text"
                        name="remarks1"
                        placeholder="Write first phone call comments..."
                        value={formFields.remarks1}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:ring-1 focus:ring-accent-purple focus:outline-none font-mono font-medium text-slate-200"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 mb-0.5">📞 Call Remarks Column 2 (Follow up outcome)</label>
                      <input
                        type="text"
                        name="remarks2"
                        placeholder="Write follow up phone comments..."
                        value={formFields.remarks2}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:ring-1 focus:ring-accent-purple focus:outline-none font-mono font-medium text-slate-200"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 mb-0.5">📞 Call Remarks Column 3 (Final Resolution outcome)</label>
                      <input
                        type="text"
                        name="remarks3"
                        placeholder="Write final decision comments..."
                        value={formFields.remarks3}
                        onChange={handleFieldChange}
                        className="w-full text-xs px-3 py-2 rounded-lg bg-white border border-slate-200 focus:ring-1 focus:ring-slate-900 focus:outline-none font-mono font-medium text-slate-800"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-rose-400 mb-0.5">Admin Placement instructions (Admins Only)</label>
                      <textarea
                        name="adminRemarks"
                        placeholder="Admin instructions only..."
                        disabled={isSubAgent}
                        value={formFields.adminRemarks}
                        onChange={handleFieldChange}
                        rows={2}
                        className="w-full text-xs p-3 rounded-lg bg-rose-950/20 border border-rose-900/30 text-rose-300 focus:ring-1 focus:ring-rose-500 focus:outline-none disabled:bg-slate-950 disabled:text-slate-400"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Additional General Notes</label>
                      <textarea
                        name="notes"
                        placeholder="Alternate phone contacts, family numbers, medical condition warnings..."
                        value={formFields.notes || ''}
                        onChange={handleFieldChange}
                        rows={3}
                        className="w-full text-xs p-3 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none"
                      />
                    </div>

                    {/* Interactive tags creator section */}
                    <div className="pt-2 border-t border-slate-750">
                      <label className="block text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1.5 uppercase tracking-wider">
                        <span>🏷️ Candidate Category Tags</span>
                        <span className="text-[9px] font-normal text-slate-400 capitalize">(Enter or click Add to save)</span>
                      </label>
                      <div className="flex flex-wrap gap-1.5 mb-2 p-2 bg-slate-900/40 rounded-xl border border-slate-750 min-h-[44px]">
                        {tags.length > 0 ? (
                          tags.map((tag, idx) => (
                            <span key={idx} className="bg-slate-800 text-slate-200 text-[10px] font-extrabold px-2 py-1 rounded-lg flex items-center gap-1 border border-slate-700">
                              {tag}
                              <button
                                type="button"
                                onClick={() => setTags(tags.filter(t => t !== tag))}
                                className="text-slate-400 hover:text-rose-400 transition-colors cursor-pointer text-[12px] font-bold leading-none inline-block ml-1"
                              >
                                ×
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-400 italic self-center pl-1">No tags assigned. (e.g. Waiter, Waitress, Chef, Nurse)</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          id="new-tag-input"
                          value={tagInputVal}
                          onChange={(e) => setTagInputVal(e.target.value)}
                          placeholder="Add tag (e.g. Chef, Nurse, Waiter)..."
                          className="flex-1 text-xs px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none font-bold animate-all"
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
                          className="px-3.5 py-2 bg-slate-900 hover:bg-black text-slate-100 rounded-xl text-xs font-black transition-all cursor-pointer border border-slate-700"
                        >
                          Add Tag
                        </button>
                      </div>

                      {/* Auto-suggest dropdown matches */}
                      {suggestedTags.length > 0 && (
                        <div className="mt-2 p-2 bg-purple-950/20 border border-purple-900/30 rounded-xl animate-in fade-in slide-in-from-top-1 text-left">
                          <p className="text-[9px] uppercase font-bold text-indigo-400 mb-1 tracking-wider">
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
                                className="bg-slate-900 hover:bg-indigo-600 text-slate-300 hover:text-white text-[10px] font-extrabold px-2 py-1 rounded-lg border border-slate-700 hover:border-indigo-600 transition-all cursor-pointer flex items-center gap-1 shadow-3xs"
                              >
                                <Plus className="h-2.5 w-2.5 text-indigo-400 hover:text-white" />
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
                    className="w-full py-3 bg-slate-900 hover:bg-black text-slate-100 hover:text-white font-extrabold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-md shrink-0 cursor-pointer border border-slate-700"
                  >
                    {savingForm ? 'Saving Updates to cloud DB...' : 'Commit Remarks & Profile Changes'}
                    {saveSuccess && <CheckCircle2 className="h-4 w-4 text-emerald-400 animate-bounce" />}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Right Column: Dynamic Action Hub (Timeline, Task Center, AISensy Templates) */}
          <div className="w-1/2 flex flex-col h-full bg-slate-900/10 relative justify-between border-l border-slate-750">
            
            {/* Header / Tabs switcher */}
            <div className="flex p-2 bg-slate-900/50 border-b border-slate-750 sticky top-0 z-20 shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setActiveRightTab('tasks')}
                className={`flex-1 py-2.5 text-[11px] font-black tracking-wider uppercase transition-all duration-200 rounded-xl flex items-center justify-center gap-2 shadow-3xs ${
                  activeRightTab === 'tasks'
                    ? 'bg-slate-850 text-slate-100 border border-slate-700'
                    : 'bg-transparent text-slate-400 hover:text-slate-100 font-bold'
                }`}
              >
                <ListTodo className="h-3.5 w-3.5 text-emerald-500" /> Actions & Reminders ({ (lead.tasks || []).filter(t => !t.completed).length })
              </button>
              
              <button
                type="button"
                onClick={() => setActiveRightTab('timeline')}
                className={`flex-1 py-2.5 text-[11px] font-black tracking-wider uppercase transition-all duration-200 rounded-xl flex items-center justify-center gap-2 shadow-3xs ${
                  activeRightTab === 'timeline'
                    ? 'bg-slate-850 text-slate-100 border border-slate-700'
                    : 'bg-transparent text-slate-400 hover:text-slate-100 font-bold'
                }`}
              >
                <History className="h-3.5 w-3.5 text-blue-500" /> Audit Timeline
              </button>
            </div>

            {/* Display selected tab */}
            <div className="flex-1 overflow-y-auto p-5 text-left">
              
              {/* TAB 1: ACTIONS & REMINDERS (Tasks list) */}
              {activeRightTab === 'tasks' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="bg-slate-900/20 p-4 rounded-xl border border-slate-750">
                    <h4 className="text-xs font-extrabold text-slate-300 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                      <ListTodo className="h-4.5 w-4.5 text-emerald-500" /> Schedule Telecaller Action Item
                    </h4>

                    <form onSubmit={handleAddTask} className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase">Action Description</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Callback to request passport scan..."
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                          className="w-full text-xs px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-900 transition-all text-slate-100 mt-1 font-semibold"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase">Follow-up Due Date</label>
                          <input
                            type="date"
                            required
                            value={newTaskDueDate}
                            onChange={(e) => setNewTaskDueDate(e.target.value)}
                            className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-900 text-slate-100 mt-1 font-semibold"
                          />
                        </div>
                        <div className="flex items-end">
                          <button
                            type="submit"
                            className="w-full py-2 bg-slate-900 hover:bg-black text-slate-100 hover:text-white text-xs font-bold rounded-lg transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1 border border-slate-700"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            Schedule Task
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Scheduled Tasks list</h4>
                    
                    {lead.tasks && lead.tasks.length > 0 ? (
                      <div className="space-y-2">
                        {lead.tasks.map((task) => (
                          <div 
                            key={task.id}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                              task.completed 
                                ? 'bg-slate-900/10 text-slate-500 border-slate-800 line-through' 
                                : 'bg-slate-900/45 text-slate-300 border-slate-750 hover:border-slate-700 shadow-3xs'
                            }`}
                          >
                            <div className="flex items-start gap-2.5 flex-1 pr-4">
                              <button
                                type="button"
                                onClick={() => handleToggleTask(task.id)}
                                className="p-0.5 hover:text-slate-100 transition-colors shrink-0 mt-0.5"
                              >
                                {task.completed ? (
                                  <CheckSquare className="h-4.5 w-4.5 text-emerald-500" />
                                ) : (
                                  <Square className="h-4.5 w-4.5 text-slate-500" />
                                )}
                              </button>
                              <div className="text-xs text-left">
                                <p className={`font-semibold ${task.completed ? 'text-slate-500' : 'text-slate-100 font-bold'}`}>{task.title}</p>
                                <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                                  <Calendar className="h-3 w-3" /> Due: <strong className={task.completed ? 'text-slate-500' : 'text-rose-400 font-extrabold'}>{task.dueDate}</strong>
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteTask(task.id)}
                              className="p-1 hover:bg-rose-950/20 text-slate-400 hover:text-rose-400 rounded transition-colors shrink-0"
                              title="Delete task item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-10 bg-slate-900/20 rounded-xl border border-slate-750 text-slate-400 space-y-1">
                        <ListTodo className="h-8 w-8 text-slate-500 mx-auto opacity-40" />
                        <p className="text-xs font-semibold text-slate-400">No active follow-up reminders scheduled.</p>
                        <p className="text-[10px] text-slate-400">Add tasks above to remind your telecaller of client updates.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: AUDIT TIMELINE (Audit log feed) */}
              {activeRightTab === 'timeline' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black text-slate-350 uppercase tracking-widest flex items-center gap-1.5">
                      <History className="h-4.5 w-4.5 text-blue-500" /> Live Audit Log
                    </h4>
                    <span className="text-[9px] uppercase font-bold text-slate-400 font-mono bg-slate-900 border border-slate-750 rounded-sm px-2 py-0.5">
                      Cloud Recorders
                    </span>
                  </div>

                  {lead.timeline && lead.timeline.length > 0 ? (
                    <div className="relative pl-4 border-l border-slate-750 ml-2 space-y-5.5">
                      {lead.timeline.slice().reverse().map((event) => (
                        <div key={event.id} className="relative group text-left">
                          
                          {/* Anchor point style icon marker */}
                          <div className={`absolute -left-6.5 top-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center text-[10px] ${
                            event.type === 'status' 
                              ? 'bg-purple-950/40 text-purple-400 border-purple-900/30'
                              : event.type === 'assignment'
                              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30'
                              : event.type === 'remark'
                              ? 'bg-amber-950/40 text-amber-400 border-amber-900/30'
                              : event.type === 'task'
                              ? 'bg-teal-950/40 text-teal-400 border-teal-900/30'
                              : 'bg-slate-900 text-slate-400 border-slate-700'
                          }`}>
                            {event.type === 'status' && '📈'}
                            {event.type === 'assignment' && '👤'}
                            {event.type === 'remark' && '📞'}
                            {event.type === 'task' && '📝'}
                            {event.type === 'creation' && '✨'}
                            {!['status', 'assignment', 'remark', 'task', 'creation'].includes(event.type) && '⚙️'}
                          </div>

                          <div className="bg-slate-900/20 p-3 rounded-xl border border-slate-750 text-xs shadow-3xs">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-bold text-slate-100 block uppercase tracking-wider text-[10px]">
                                {event.actor}
                              </span>
                              <span className="text-[9px] text-slate-400 font-mono">
                                {new Date(event.timestamp).toLocaleDateString()} {new Date(event.timestamp).toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'})}
                              </span>
                            </div>
                            <p className="text-slate-300 leading-relaxed font-medium font-mono whitespace-pre-wrap">{event.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-slate-900/20 rounded-xl border border-slate-750 text-slate-400 space-y-1.5">
                      <History className="h-8 w-8 text-slate-500 mx-auto opacity-40" />
                      <p className="text-xs font-semibold text-slate-400">Audit pipeline is empty.</p>
                      <p className="text-[10px] text-slate-400">Timelines automatically log on Remarks commit, Stage transitions, or Task updates.</p>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Footer quick instructions banner */}
            <div className="bg-slate-900/80 border-t border-slate-750 p-3 text-[10px] text-slate-400 font-mono text-center shrink-0">
              ⚡ Career Growth Placement • Candidate Pipeline & Follow-ups live in Cloud Storage.
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
