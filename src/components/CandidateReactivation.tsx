import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Send, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  MessageSquare, 
  UserCheck, 
  Clock, 
  Filter, 
  Briefcase, 
  ArrowRight,
  TrendingUp,
  UserX,
  MapPin,
  Check,
  CheckSquare,
  Square,
  BadgeAlert,
  Sliders,
  ChevronRight,
  HelpCircle,
  FileText
} from 'lucide-react';
import { Lead, Job } from '../types';

interface CandidateReactivationProps {
  onSelectLead: (lead: Lead) => void;
  onUpdateLead: (lead: Lead) => Promise<void>;
  userRole: string;
}

export default function CandidateReactivation({ onSelectLead, onUpdateLead, userRole }: CandidateReactivationProps) {
  // State for Job selection & custom parameters
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  
  // Job Detail states (filled from selected job or customized)
  const [jobTitle, setJobTitle] = useState('Hotel Supervisor');
  const [jobCountry, setJobCountry] = useState('Dubai');
  const [jobSalary, setJobSalary] = useState('₹65,000');
  const [jobExperience, setJobExperience] = useState('3 years');
  const [jobRequirements, setJobRequirements] = useState('Leadership, guest relations, fluent English, luxury hospitality experience.');
  const [jobGender, setJobGender] = useState<'ALL' | 'MALE' | 'FEMALE'>('ALL');

  // Reactivation Filters
  const [inactivityMonths, setInactivityMonths] = useState<number>(6);
  const [limitCount, setLimitCount] = useState<number>(30);
  
  // WhatsApp Template states for BLAST
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(false);
  const [isSyncingTemplates, setIsSyncingTemplates] = useState(false);

  // Loading & process states
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  
  // Results
  const [matchedCandidates, setMatchedCandidates] = useState<Array<Lead & { 
    matchScore: number; 
    matchReason: string; 
    lastContactedMonths: number;
    customMessage: string;
  }>>([]);
  
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [campaignLaunched, setCampaignLaunched] = useState(false);
  const [launchSummary, setLaunchSummary] = useState<{ sentCount: number; jobTitle: string } | null>(null);

  // Campaign Dashboard statistics & tracking (loaded from DB/API)
  const [activeCampaigns, setActiveCampaigns] = useState<any[]>([]);
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(true);

  // Fetch available jobs, campaigns, and WhatsApp templates
  useEffect(() => {
    fetchActiveJobs();
    fetchReactivationCampaigns();
    fetchTemplates();
  }, []);

  const fetchActiveJobs = () => {
    fetch('/api/jobs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setJobs(data.filter(j => j.isActive !== false));
        }
      })
      .catch(err => console.error('Error fetching jobs:', err));
  };

  const renderClientTemplate = (templateText: string, tplId: string, cand: any) => {
    let result = templateText;
    
    const resolveVar = (vName: string) => {
      const v = vName.trim().toLowerCase();
      const nameVal = cand.name ? cand.name.split(' ')[0] : 'Candidate';
      const countryVal = jobCountry || 'Gulf / Overseas';
      const positionVal = jobTitle || cand.position || 'Openings';
      const phoneVal = cand.phone || '';
      const serialNoVal = cand.serialNo || 'N/A';
      
      let coordinatorVal = cand.assignedTo || 'Maryada';
      if (coordinatorVal === 'admin') {
        coordinatorVal = 'Administrator';
      } else if (coordinatorVal && coordinatorVal.length > 0) {
        coordinatorVal = coordinatorVal.charAt(0).toUpperCase() + coordinatorVal.slice(1);
      }

      if (v === 'name') return nameVal;
      if (v === 'country') return countryVal;
      if (v === 'position') return positionVal;
      if (v === 'phone') return phoneVal;
      if (v === 'serialno') return serialNoVal;
      if (v === 'coordinator') return coordinatorVal;

      const lowerId = tplId.toLowerCase();
      const lowerText = templateText.toLowerCase();

      if (v === '1') {
        if (lowerId.includes('assign') || lowerText.includes('assist') || lowerText.includes('save')) {
          return coordinatorVal;
        }
        return nameVal;
      }
      if (v === '2') {
        if (lowerId.includes('assign') || lowerText.includes('assist')) {
          return phoneVal;
        }
        return positionVal;
      }
      if (v === '3') {
        if (lowerId.includes('assign') || lowerText.includes('assist')) {
          return nameVal;
        }
        return countryVal;
      }
      if (v === '4') {
        if (lowerId.includes('assign') || lowerText.includes('assist')) {
          return positionVal;
        }
        return jobSalary || '₹65,000';
      }
      if (v === '5') {
        return cand.experience || 'hospitality';
      }

      return '';
    };

    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    const matches: string[] = [];
    while ((match = regex.exec(templateText)) !== null) {
      matches.push(match[1]);
    }

    const uniqueVariables = Array.from(new Set(matches));
    for (const v of uniqueVariables) {
      const val = resolveVar(v);
      const escapedVar = v.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const replaceRegex = new RegExp(`\\{\\{\\s*${escapedVar}\\s*\\}\\}`, 'gi');
      result = result.replace(replaceRegex, val);
    }

    return result;
  };

  const handleTemplateSelectChange = (tplId: string) => {
    setSelectedTemplateId(tplId);
    
    const matchedTpl = templates.find(t => t.id === tplId);
    if (!matchedTpl || !matchedTpl.text) return;

    setMatchedCandidates(prev => 
      prev.map(c => {
        const rendered = renderClientTemplate(matchedTpl.text, tplId, c);
        return {
          ...c,
          customMessage: rendered
        };
      })
    );
  };

  const fetchTemplates = () => {
    setIsTemplatesLoading(true);
    fetch('/api/whatsapp/templates')
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.templates)) {
          setTemplates(data.templates);
          // Set default template
          const defTpl = data.templates.find((t: any) => t.id === 'tpl_urgent_intake' || t.id.includes('intake') || t.id.includes('reactivate'));
          if (defTpl) {
            setSelectedTemplateId(defTpl.id);
          } else if (data.templates.length > 0) {
            setSelectedTemplateId(data.templates[0].id);
          }
        }
      })
      .catch(err => console.error('Error fetching templates:', err))
      .finally(() => setIsTemplatesLoading(false));
  };

  const handleSyncTemplates = async () => {
    setIsSyncingTemplates(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      alert(data.message || 'Successfully synced templates from Meta Business!');
      fetchTemplates(); // Refresh template list
    } catch (err: any) {
      console.error('Error syncing templates:', err);
      alert(`Template sync failed: ${err.message}`);
    } finally {
      setIsSyncingTemplates(false);
    }
  };

  const fetchReactivationCampaigns = () => {
    setIsCampaignsLoading(true);
    fetch('/api/reactivation/campaigns')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setActiveCampaigns(data);
        }
      })
      .catch(err => console.error('Error fetching reactivation campaigns:', err))
      .finally(() => setIsCampaignsLoading(false));
  };

  // Autofill fields when selected job changes
  const handleJobChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedJobId(id);
    if (!id) return;

    const selected = jobs.find(j => j.id === id);
    if (selected) {
      setJobTitle(selected.title);
      setJobCountry(selected.country);
      setJobSalary(selected.salaryRange || '₹60,000 - ₹75,000');
      setJobExperience(selected.requirement.match(/\d+\s*(?:years?|yrs?)/gi)?.[0] || '2-3 years');
      setJobRequirements(selected.requirement);
    }
  };

  // Run AI Search on Old Database
  const handleScanOldDatabase = async () => {
    setIsScanning(true);
    setCampaignLaunched(false);
    setLaunchSummary(null);
    setMatchedCandidates([]);
    setSelectedCandidateIds(new Set());

    const steps = [
      'Retrieving stale database archives (contact > 3-12 months)...',
      'Filtering out active profiles under active placement negotiation...',
      'Matching credentials with position tags & experience criteria...',
      'Invoking Gemini 3.8 to rank candidate capabilities against vacancy terms...',
      'Formulating highly optimized custom WhatsApp greeting messages...'
    ];

    let stepIdx = 0;
    setScanStep(steps[0]);
    const stepInterval = setInterval(() => {
      stepIdx++;
      if (stepIdx < steps.length) {
        setScanStep(steps[stepIdx]);
      }
    }, 1200);

    try {
      const res = await fetch('/api/reactivation/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle,
          country: jobCountry,
          salary: jobSalary,
          experience: jobExperience,
          requirements: jobRequirements,
          inactivityMonths,
          limit: limitCount,
          gender: jobGender
        })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      if (data.candidates) {
        const activeTpl = templates.find(t => t.id === selectedTemplateId);
        const candidatesWithTpl = data.candidates.map((c: any) => {
          if (activeTpl && activeTpl.text) {
            return {
              ...c,
              customMessage: renderClientTemplate(activeTpl.text, selectedTemplateId, c)
            };
          }
          return c;
        });
        setMatchedCandidates(candidatesWithTpl);
        // Auto-select candidates with match score >= 70
        const autoSelected = new Set<string>();
        candidatesWithTpl.forEach((c: any) => {
          if (c.matchScore >= 70) {
            autoSelected.add(c.id);
          }
        });
        setSelectedCandidateIds(autoSelected);
      }
    } catch (err: any) {
      console.error('Error scanning old database:', err);
      alert(`Scan failed: ${err.message}`);
    } finally {
      clearInterval(stepInterval);
      setIsScanning(false);
    }
  };

  // Toggle selection
  const handleToggleSelectCandidate = (id: string) => {
    const updated = new Set(selectedCandidateIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedCandidateIds(updated);
  };

  // Toggle all
  const handleToggleSelectAll = () => {
    if (selectedCandidateIds.size === matchedCandidates.length) {
      setSelectedCandidateIds(new Set());
    } else {
      const allIds = matchedCandidates.map(c => c.id);
      setSelectedCandidateIds(new Set(allIds));
    }
  };

  // Edit custom message for specific candidate inline
  const handleUpdateMessageText = (id: string, text: string) => {
    setMatchedCandidates(prev => 
      prev.map(c => c.id === id ? { ...c, customMessage: text } : c)
    );
  };

  // Launch campaign (Send WhatsApp Outreach)
  const handleLaunchCampaign = async () => {
    if (selectedCandidateIds.size === 0) {
      alert('Please select at least 1 candidate to launch the outreach campaign.');
      return;
    }

    if (!window.confirm(`Are you sure you want to launch the WhatsApp Reactivation Campaign for ${selectedCandidateIds.size} candidate(s)? This will send personalized messages instantly.`)) {
      return;
    }

    setIsLaunching(true);
    try {
      const targets = matchedCandidates
        .filter(c => selectedCandidateIds.has(c.id))
        .map(c => ({
          leadId: c.id,
          message: c.customMessage,
          phone: c.phone,
          name: c.name
        }));

      const res = await fetch('/api/reactivation/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle,
          country: jobCountry,
          salary: jobSalary,
          targets,
          templateId: selectedTemplateId
        })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      setLaunchSummary({
        sentCount: selectedCandidateIds.size,
        jobTitle
      });
      setCampaignLaunched(true);
      setMatchedCandidates([]);
      setSelectedCandidateIds(new Set());
      fetchReactivationCampaigns(); // Refresh campaigns dashboard
    } catch (err: any) {
      console.error('Error launching campaign:', err);
      alert(`Failed to launch campaign: ${err.message}`);
    } finally {
      setIsLaunching(false);
    }
  };

  // Force simulation of candidate replying YES
  const handleSimulateCandidateReply = async (leadId: string, replyText: string) => {
    try {
      const res = await fetch('/api/reactivation/simulate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, replyText })
      });
      if (res.ok) {
        alert(`Inbound message "${replyText}" successfully simulated for candidate! AI is executing pre-screening conversation in background.`);
        fetchReactivationCampaigns();
      } else {
        throw new Error(await res.text());
      }
    } catch (err: any) {
      alert(`Simulation failed: ${err.message}`);
    }
  };

  // Calculate stats for campaign list
  const totalCampaignLeads = activeCampaigns.reduce((sum, c) => sum + (c.leadsCount || 0), 0);
  const totalReplies = activeCampaigns.reduce((sum, c) => sum + (c.repliedCount || 0), 0);
  const totalInterested = activeCampaigns.reduce((sum, c) => sum + (c.interestedCount || 0), 0);
  const totalQualified = activeCampaigns.reduce((sum, c) => sum + (c.qualifiedCount || 0), 0);

  return (
    <div className="space-y-6 text-slate-100" id="candidate-reactivation-view">
      
      {/* Title Header */}
      <div className="bg-slate-900/50 rounded-3xl border border-slate-800 p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center border-b border-slate-800 pb-4">
          <div className="text-left">
            <h2 className="text-sm font-black text-slate-100 uppercase tracking-widest flex items-center gap-2.5 font-display">
              <Sparkles className="h-5 w-5 text-indigo-400 animate-pulse" />
              Talent Re-Engage Hub (AI Outreach)
            </h2>
            <p className="text-[11px] text-slate-400 font-bold mt-1">
              Automatically identify stale, inactive placement candidates from your archives, match them against new active vacancies, and engage them on WhatsApp.
            </p>
          </div>
          <span className="text-[10px] bg-indigo-950/40 border border-indigo-900/30 px-3 py-1.5 rounded-full font-black text-indigo-400 uppercase tracking-wider font-mono">
            Powered by Gemini 3.8 Smart Chat Agent
          </span>
        </div>

        {/* Setup Parameters Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-5">
          {/* Left: Input parameters */}
          <div className="lg:col-span-8 space-y-4 text-left">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                  1. Match against Vacancy / Active Job
                </label>
                <select
                  value={selectedJobId}
                  onChange={handleJobChange}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:border-indigo-500 outline-none transition-all font-mono"
                >
                  <option value="">-- Custom Vacancy (Type Details Below) --</option>
                  {jobs.map(job => (
                    <option key={job.id} value={job.id}>
                      💼 {job.title} — {job.country} ({job.salaryRange || 'N/A'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                    Inactivity Months
                  </label>
                  <select
                    value={inactivityMonths}
                    onChange={(e) => setInactivityMonths(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:border-indigo-500 outline-none transition-all font-mono"
                  >
                    <option value={1}>1+ Month Inactive</option>
                    <option value={3}>3+ Months Inactive</option>
                    <option value={6}>6+ Months Inactive (Default)</option>
                    <option value={12}>12+ Months Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                    Max Candidates
                  </label>
                  <select
                    value={limitCount}
                    onChange={(e) => setLimitCount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:border-indigo-500 outline-none transition-all font-mono"
                  >
                    <option value={10}>10 Profiles</option>
                    <option value={30}>30 Profiles</option>
                    <option value={50}>50 Profiles</option>
                    <option value={100}>100 Profiles</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Custom Vacancy details */}
            <div className="border border-slate-800/60 bg-slate-950/40 rounded-2xl p-4 space-y-3.5">
              <h3 className="text-[10px] font-black uppercase text-indigo-400 tracking-wider">Vacancy Details Configuration</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Position / Title</label>
                  <input 
                    type="text" 
                    value={jobTitle} 
                    onChange={e => setJobTitle(e.target.value)} 
                    placeholder="e.g. Hotel Supervisor"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Destination Country</label>
                  <input 
                    type="text" 
                    value={jobCountry} 
                    onChange={e => setJobCountry(e.target.value)} 
                    placeholder="e.g. Dubai"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Monthly Salary Offered</label>
                  <input 
                    type="text" 
                    value={jobSalary} 
                    onChange={e => setJobSalary(e.target.value)} 
                    placeholder="e.g. ₹65,000/month + accommodation"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-1">
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Required Experience</label>
                  <input 
                    type="text" 
                    value={jobExperience} 
                    onChange={e => setJobExperience(e.target.value)} 
                    placeholder="e.g. 3 years"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Target Gender</label>
                  <select
                    value={jobGender}
                    onChange={e => setJobGender(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 text-slate-200 outline-none font-mono"
                  >
                    <option value="ALL">👫 All Genders</option>
                    <option value="MALE">👨 Male Only</option>
                    <option value="FEMALE">👩 Female Only</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Requirements / Skill Tags</label>
                  <input 
                    type="text" 
                    value={jobRequirements} 
                    onChange={e => setJobRequirements(e.target.value)} 
                    placeholder="e.g. Leadership, guest relations, fluent English, luxury hospitality experience."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Right: Explainer & Action Button */}
          <div className="lg:col-span-4 flex flex-col justify-between border-l border-slate-800 pl-6 text-left">
            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase text-indigo-400 tracking-wider">Reactivation Blueprint</h4>
              <ul className="text-[11px] text-slate-300 space-y-2 list-disc list-inside">
                <li>Retrieves archives with no outbound/inbound texts for <strong>{inactivityMonths} months</strong>.</li>
                <li>Uses AI to analyze their past profile resumes, remarks, and logged positions.</li>
                <li>Shortlists best suitability fits and drafts targeted WhatsApp hooks.</li>
                <li><strong>Interactive AI chat</strong>: Gemini handles replies, pre-screens credentials, and automatically shortlists candidates in the Pipeline!</li>
              </ul>
            </div>

            <button
              onClick={handleScanOldDatabase}
              disabled={isScanning}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-3 rounded-xl transition duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isScanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Scanning Database...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  <span>Scan Old Database</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Scan Status Steps */}
        {isScanning && (
          <div className="mt-4 bg-slate-950/80 border border-slate-800 p-3 rounded-xl text-left flex items-center gap-2.5 animate-pulse">
            <Loader2 className="h-4 w-4 text-indigo-400 animate-spin shrink-0" />
            <span className="text-[11px] font-mono font-black text-indigo-300 uppercase tracking-widest">{scanStep}</span>
          </div>
        )}
      </div>

      {/* Campaign Success Notification */}
      {campaignLaunched && launchSummary && (
        <div className="bg-emerald-950/40 border border-emerald-900/60 p-5 rounded-3xl text-left flex gap-4 items-center">
          <div className="h-12 w-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-400 border border-emerald-500/20 shrink-0">
            <CheckCircle className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-100 uppercase tracking-wider">Campaign Dispatched Successfully!</h3>
            <p className="text-xs text-slate-300 mt-1">
              Personalized WhatsApp outreach sent to <strong>{launchSummary.sentCount}</strong> suitable candidates regarding the <strong>{launchSummary.jobTitle}</strong> opening.
            </p>
            <p className="text-[10px] text-emerald-400 font-mono mt-1 font-bold">
              AI pre-screening chatbot is now active on their replies. The CRM will automatically notify you and shortlist candidates who reply YES.
            </p>
          </div>
        </div>
      )}

      {/* Scan Results Panel */}
      {matchedCandidates.length > 0 && (
        <div className="bg-slate-900/40 rounded-3xl border border-slate-800 p-6 shadow-xl text-left space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-xs font-black uppercase text-indigo-400 tracking-wider">Matched Stale Candidates ({matchedCandidates.length} found)</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Review suitability, select targets, edit their custom WhatsApp hook, and initiate blast.</p>
            </div>
            
            <div className="flex gap-2.5 mt-3 sm:mt-0">
              <button
                onClick={handleToggleSelectAll}
                className="text-[11px] bg-slate-950 border border-slate-800 hover:bg-slate-800 px-3.5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                {selectedCandidateIds.size === matchedCandidates.length ? 'Deselect All' : 'Select All'}
              </button>
              
              <button
                onClick={handleLaunchCampaign}
                disabled={isLaunching || selectedCandidateIds.size === 0}
                className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl font-black uppercase tracking-wider flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
              >
                {isLaunching ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Launching...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Launch Blast ({selectedCandidateIds.size})</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* WhatsApp Template Selector & Sync Tool */}
          <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-2xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-[11px] font-black uppercase text-indigo-400 tracking-wider">
                  📢 WhatsApp Cloud Template for Outreach
                </h4>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Select the Meta-approved template for this broadcast blast. Variable placeholders will be auto-replaced.
                </p>
              </div>

              <button
                onClick={handleSyncTemplates}
                disabled={isSyncingTemplates}
                className="text-[10px] bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSyncingTemplates ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                    <span>Syncing Meta...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Sync from Meta</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <label className="block text-[10px] text-slate-400 font-bold mb-1">Outreach Template</label>
                {isTemplatesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-2.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading templates...</span>
                  </div>
                ) : (
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleTemplateSelectChange(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-100 focus:border-indigo-500 outline-none font-mono"
                  >
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.title || t.id}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="md:col-span-2 bg-slate-950 border border-slate-800/80 p-3 rounded-lg text-xs">
                <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider block mb-1">
                  Template Body Preview
                </span>
                <p className="text-slate-300 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                  {templates.find(t => t.id === selectedTemplateId)?.text || 'No template selected or available.'}
                </p>
              </div>
            </div>
          </div>



          {/* Table list */}
          <div className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-950/20">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800/80">
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[5%] text-center">Select</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[35%] min-w-[280px]">Candidate Details</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[10%] text-center">Inactivity</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[10%] text-center">Coordinator</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[12%] text-center">Match Score</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[28%] min-w-[320px]">Personalized Hook (Edit Inline)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {matchedCandidates.map(c => {
                  const isSelected = selectedCandidateIds.has(c.id);
                  return (
                    <tr 
                      key={c.id} 
                      className={`hover:bg-slate-900/30 transition-colors ${isSelected ? 'bg-indigo-500/5' : ''}`}
                    >
                      {/* Checkbox */}
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleToggleSelectCandidate(c.id)}
                          className="text-slate-400 hover:text-indigo-400 transition"
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4.5 w-4.5 text-indigo-500" />
                          ) : (
                            <Square className="h-4.5 w-4.5" />
                          )}
                        </button>
                      </td>

                      {/* Details */}
                      <td className="p-3 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span 
                            onClick={() => onSelectLead(c)} 
                            className="text-xs font-black text-indigo-400 hover:underline cursor-pointer"
                          >
                            {c.name}
                          </span>
                          <span className="text-[10px] text-slate-400">({c.phone})</span>
                        </div>
                        <div className="text-[10px] text-slate-300 flex flex-wrap gap-2">
                          <span>👤 {c.gender}</span>
                          <span>•</span>
                          <span>🎂 {c.age || 'N/A'} yrs</span>
                          <span>•</span>
                          <span>📁 {c.experience || 'Fresh criteria'}</span>
                          <span>•</span>
                          <span>🎯 {c.position}</span>
                        </div>
                        {c.adminRemarks && (
                          <div className="text-[9px] text-slate-500 bg-slate-900/50 px-2 py-0.5 rounded-md inline-block max-w-sm truncate">
                            Remarks: {c.adminRemarks}
                          </div>
                        )}
                      </td>

                      {/* Last contacted */}
                      <td className="p-3 text-center">
                        <span className="text-[10px] font-mono bg-slate-900 px-2 py-1 rounded-md text-amber-500/90 border border-amber-500/10 flex items-center justify-center gap-1">
                          <Clock className="h-3 w-3" />
                          {c.inactivityText || `${c.lastContactedMonths}m ago`}
                        </span>
                      </td>

                      {/* Coordinator */}
                      <td className="p-3 text-center">
                        <span className="text-[10px] font-mono font-bold bg-slate-900/60 px-2.5 py-1 rounded-md text-indigo-300 border border-indigo-500/10 inline-block max-w-[110px] truncate" title={c.assignedTo || 'Unassigned'}>
                          👤 {c.assignedTo && c.assignedTo !== 'unassigned' ? `@${c.assignedTo}` : 'Unassigned'}
                        </span>
                      </td>

                       {/* Match Score */}
                      <td className="p-3 text-center">
                        <div className="flex flex-col items-center justify-center gap-1.5 py-1">
                          <span className={`inline-block text-xs font-mono font-black px-2.5 py-1 rounded-md border ${
                            c.matchScore >= 80 
                              ? 'bg-emerald-950/50 text-emerald-400 border-emerald-500/20' 
                              : c.matchScore >= 50 
                                ? 'bg-amber-950/50 text-amber-400 border-amber-500/20' 
                                : c.matchScore >= 30 
                                  ? 'bg-rose-950/50 text-rose-400 border-rose-500/20' 
                                  : 'bg-slate-900/60 text-slate-400 border-slate-800/80'
                          }`}>
                            {c.matchScore}%
                          </span>
                          <p className="text-[9px] text-slate-400 leading-normal max-w-[130px] mx-auto whitespace-normal break-words text-center" title={c.matchReason}>
                            {c.matchReason}
                          </p>
                        </div>
                      </td>

                      {/* Hook editor */}
                      <td className="p-3">
                        <div className="flex gap-2">
                          <textarea
                            value={c.customMessage}
                            onChange={(e) => handleUpdateMessageText(c.id, e.target.value)}
                            rows={4}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-[11px] focus:border-indigo-500 outline-none font-sans text-slate-200 resize-y leading-relaxed"
                          />
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Campaigns Monitoring Dashboard */}
      <div className="bg-slate-900/40 rounded-3xl border border-slate-800 p-6 shadow-xl text-left space-y-4">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-xs font-black uppercase text-indigo-400 tracking-wider">Active Reactivation Campaigns</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Real-time status of candidate responses, chatbot progress, and interested shortlist.</p>
          </div>
          
          <button
            onClick={fetchReactivationCampaigns}
            className="text-[11px] bg-slate-950 border border-slate-800 hover:bg-slate-800 px-3.5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
            <span>Refresh Stats</span>
          </button>
        </div>

        {/* Global stats block */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-slate-950/50 border border-slate-800 p-3.5 rounded-2xl text-left">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Sent Outreach</span>
            <strong className="text-lg font-black text-indigo-400 mt-1 block">{totalCampaignLeads}</strong>
          </div>
          <div className="bg-slate-950/50 border border-slate-800 p-3.5 rounded-2xl text-left">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Replied (YES / Other)</span>
            <strong className="text-lg font-black text-amber-400 mt-1 block">
              {totalReplies} <span className="text-xs text-slate-500">({totalCampaignLeads > 0 ? Math.round((totalReplies/totalCampaignLeads)*100) : 0}%)</span>
            </strong>
          </div>
          <div className="bg-slate-950/50 border border-slate-800 p-3.5 rounded-2xl text-left">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Interested</span>
            <strong className="text-lg font-black text-emerald-400 mt-1 block">{totalInterested}</strong>
          </div>
          <div className="bg-slate-950/50 border border-slate-800 p-3.5 rounded-2xl text-left">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Qualified & Shortlisted</span>
            <strong className="text-lg font-black text-indigo-400 mt-1 block">{totalQualified}</strong>
          </div>
        </div>

        {/* Active Campaigns list */}
        {isCampaignsLoading ? (
          <div className="py-12 flex justify-center items-center gap-2">
            <Loader2 className="h-5 w-5 text-indigo-400 animate-spin" />
            <p className="text-xs text-slate-400">Loading campaign records...</p>
          </div>
        ) : activeCampaigns.length === 0 ? (
          <div className="py-12 text-center text-slate-400 border border-slate-800/50 rounded-2xl bg-slate-950/10">
            <BadgeAlert className="h-8 w-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs font-bold">No active reactivation campaigns found.</p>
            <p className="text-[10px] text-slate-500 mt-1">Select a vacancy above and launch an AI campaign to populate records.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeCampaigns.map((campaign, idx) => (
              <div 
                key={campaign.name} 
                className="border border-slate-800 bg-slate-950/30 rounded-2xl p-4 space-y-4"
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <h4 className="text-xs font-black text-indigo-300 uppercase tracking-wide flex items-center gap-1.5">
                      <Briefcase className="h-4 w-4 text-indigo-400" />
                      {campaign.name}
                    </h4>
                    <span className="text-[9px] font-mono text-slate-500">Created: {campaign.createdAt ? new Date(campaign.createdAt).toLocaleDateString() : 'N/A'}</span>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-md text-slate-300">
                      🎯 <strong>{campaign.leadsCount}</strong> outreach sent
                    </span>
                    <span className="text-[10px] bg-emerald-950/30 border border-emerald-900/50 px-2.5 py-1 rounded-md text-emerald-400">
                      ⭐ <strong>{campaign.qualifiedCount}</strong> qualified
                    </span>
                  </div>
                </div>

                {/* Candidate list under this campaign */}
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {campaign.candidates && campaign.candidates.map((cand: any) => {
                    // Check status style
                    let statusClass = 'text-slate-400 bg-slate-900 border border-slate-800';
                    if (cand.reactivationStatus === 'qualified') {
                      statusClass = 'text-emerald-400 bg-emerald-950/50 border border-emerald-900/30';
                    } else if (cand.reactivationStatus === 'interested') {
                      statusClass = 'text-amber-400 bg-amber-950/50 border border-amber-900/30';
                    } else if (cand.reactivationStatus === 'replied') {
                      statusClass = 'text-indigo-400 bg-indigo-950/50 border border-indigo-900/30';
                    }

                    return (
                      <div 
                        key={cand.id}
                        className="bg-slate-950/60 hover:bg-slate-900/50 border border-slate-800/80 p-3 rounded-xl flex flex-col md:flex-row justify-between md:items-center gap-4 transition"
                      >
                        {/* Name/Details */}
                        <div className="text-left space-y-1">
                          <div className="flex items-center gap-2">
                            <span 
                              onClick={() => onSelectLead(cand)}
                              className="text-xs font-black text-indigo-400 hover:underline cursor-pointer"
                            >
                              {cand.name}
                            </span>
                            <span className="text-[10px] text-slate-400">{cand.phone}</span>
                            <span className={`text-[9px] font-mono font-black uppercase px-2 py-0.5 rounded-full ${statusClass}`}>
                              {cand.reactivationStatus || 'sent'}
                            </span>
                          </div>
                          
                          {/* Messages preview */}
                          {cand.messages && cand.messages.length > 0 ? (
                            <div className="text-[10px] bg-slate-900/40 p-1.5 rounded-lg border border-slate-800/40 max-w-xl">
                              <span className="font-bold text-indigo-300">Last reply:</span>{' '}
                              <span className="text-slate-300 italic">
                                "{cand.messages[cand.messages.length - 1]?.text}"
                              </span>
                              <span className="text-[8px] text-slate-500 ml-1.5 font-mono">
                                ({new Date(cand.messages[cand.messages.length - 1]?.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                              </span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-500 italic">No incoming response yet. Waiting on WhatsApp hook...</span>
                          )}
                        </div>

                        {/* Quick actions & simulation */}
                        <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0">
                          {cand.reactivationStatus === 'sent' && (
                            <>
                              <button
                                onClick={() => handleSimulateCandidateReply(cand.id, 'YES')}
                                className="text-[9px] bg-emerald-950/30 hover:bg-emerald-900/30 border border-emerald-900/50 text-emerald-400 px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition"
                              >
                                Simulate YES Reply
                              </button>
                              <button
                                onClick={() => handleSimulateCandidateReply(cand.id, 'No, not looking for Dubai right now')}
                                className="text-[9px] bg-rose-950/30 hover:bg-rose-900/30 border border-rose-900/50 text-rose-400 px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition"
                              >
                                Simulate NO Reply
                              </button>
                            </>
                          )}

                          {cand.reactivationStatus === 'replied' && (
                            <button
                              onClick={() => handleSimulateCandidateReply(cand.id, 'I have 4 years experience in 5-star hotels and a valid Indian passport.')}
                              className="text-[9px] bg-indigo-950 border border-indigo-800/50 text-indigo-400 px-2.5 py-1.5 rounded-lg font-extrabold cursor-pointer transition"
                            >
                              Simulate Pre-Screen Response
                            </button>
                          )}

                          <button
                            onClick={() => onSelectLead(cand)}
                            className="text-[9.5px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <span>Open Profile</span>
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
