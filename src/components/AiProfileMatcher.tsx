import React, { useState, useEffect } from 'react';
import { Lead, Job } from '../types';
import { 
  Sparkles, UploadCloud, CheckCircle, TrendingUp, UserCheck, Phone, MapPin, 
  AlertCircle, Trash2, Send, RefreshCw, FileText, Check, LayoutGrid, Award, ShieldCheck,
  Download
} from 'lucide-react';

interface AiProfileMatcherProps {
  onSelectLead: (lead: Lead) => void;
  onUpdateLead: (lead: Lead) => Promise<void>;
  userRole: string;
}

export default function AiProfileMatcher({ onSelectLead, onUpdateLead, userRole }: AiProfileMatcherProps) {
  // State
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [textCommand, setTextCommand] = useState<string>('');
  const [imageFile, setImageFile] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [results, setResults] = useState<{
    jobDetails: {
      title: string;
      country: string;
      salary: string;
      experience: string;
      skills: string;
      preferredRegion: string;
      benefits: string;
    };
    matches: Array<Lead & { matchScore: number; matchReason: string }>;
    isSimulated: boolean;
  } | null>(null);
  const [assignedStatus, setAssignedStatus] = useState<Record<string, boolean>>({});

  // Fetch available jobs on mount
  useEffect(() => {
    fetch('/api/jobs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setJobs(data.filter(j => j.isActive !== false));
        }
      })
      .catch(err => console.error('Error fetching jobs:', err));
  }, []);

  // Autofill text command when a job is selected from dropdown
  const handleJobSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedJobId(id);
    if (!id) return;

    const selected = jobs.find(j => j.id === id);
    if (selected) {
      const requirementsText = `Match candidates for "${selected.title}" role in "${selected.country}".
Requirements: ${selected.requirement}
Age Limit: ${selected.ageLimit || 'N/A'}
Other details: ${selected.otherTerms || 'None'}`;
      setTextCommand(requirementsText);
    }
  };

  // Drag and drop image upload handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG, JPG, or JPEG).');
      return;
    }
    setImageName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImageFile(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processImageFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processImageFile(e.target.files[0]);
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImageName('');
  };

  // Perform AI scan
  const handleScan = async () => {
    if (!textCommand && !imageFile && !selectedJobId) {
      alert('Please select an active job demand, type matching keywords, or attach a flyer image.');
      return;
    }

    setLoading(true);
    setResults(null);
    setAssignedStatus({});

    // Beautiful step-by-step loading simulation
    const steps = [
      'Scanning local database for active talent profiles...',
      'Analyzing active candidate pools and remarks log...',
      'Invoking server-side Google GenAI model context...',
      'Matching resume skills, age, and location heuristics...',
      'Structuring final strategic ranking...'
    ];

    let currentStepIndex = 0;
    setLoadingStep(steps[0]);
    const stepInterval = setInterval(() => {
      currentStepIndex++;
      if (currentStepIndex < steps.length) {
        setLoadingStep(steps[currentStepIndex]);
      }
    }, 1500);

    try {
      const response = await fetch('/api/ai-match-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: selectedJobId || undefined,
          textCommand: textCommand || undefined,
          image: imageFile || undefined
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();
      setResults(data);
    } catch (err) {
      console.error('Error during AI candidate matching:', err);
      alert(`AI Match Error: ${(err as Error).message}`);
    } finally {
      clearInterval(stepInterval);
      setLoading(false);
    }
  };

  // Quick Action: Link or unlink candidate directly to this project/job (Toggle)
  const handleAssignProject = async (lead: Lead, projectTitle: string) => {
    try {
      const isCurrentlyAssigned = assignedStatus[lead.id] !== undefined
        ? assignedStatus[lead.id]
        : lead.project === projectTitle;

      const updatedLead: Lead = {
        ...lead,
        project: isCurrentlyAssigned ? "" : projectTitle,
        stage: (!isCurrentlyAssigned && lead.stage === 'new') ? 'contacted' : lead.stage, // automatically engage them!
        updatedAt: new Date().toISOString()
      };

      // Call API to persist changes in database
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole
        },
        body: JSON.stringify(updatedLead)
      });

      if (!response.ok) {
        throw new Error('Failed to update lead');
      }

      // Update parent component's state
      await onUpdateLead(updatedLead);

      // Track successful local state UI response
      setAssignedStatus(prev => ({ ...prev, [lead.id]: !isCurrentlyAssigned }));
    } catch (err) {
      console.error('Error linking/unlinking candidate to job:', err);
      alert('Failed to update candidate shortlist status. Please try manually editing the lead profile.');
    }
  };

  // Export only shortlisted candidates for this job
  const handleExportShortlistedCSV = () => {
    if (!results) return;
    
    // Find shortlisted candidates
    const shortlisted = results.matches.filter(match => {
      return assignedStatus[match.id] !== undefined
        ? assignedStatus[match.id]
        : match.project === results.jobDetails.title;
    });

    if (shortlisted.length === 0) {
      alert("No candidates are currently shortlisted for this job. Shortlist some candidates first by clicking the 'Shortlist' button on their cards!");
      return;
    }

    // Convert to CSV
    const headers = ["Serial No", "Name", "Gender", "Age", "Phone", "Origin", "Logged Position", "Experience", "Current Project", "Match Score", "AI Recommendation"];
    const rows = shortlisted.map((match, idx) => [
      match.serialNo || `C-${idx + 1}`,
      match.name,
      match.gender,
      match.age,
      `="${match.phone}"`, // Beautiful phone formatting for Excel
      match.origin,
      match.position,
      match.experience,
      match.project || results.jobDetails.title,
      `${match.matchScore}%`,
      `"${match.matchReason.replace(/"/g, '""')}"`
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(e => e.map(val => {
        const strVal = String(val);
        if (strVal.includes(",") || strVal.includes("\n") || strVal.includes('"')) {
          return `"${strVal.replace(/"/g, '""')}"`;
        }
        return strVal;
      }).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const sanitizedJobTitle = results.jobDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.setAttribute("download", `Shortlisted_Candidates_${sanitizedJobTitle}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6" id="ai-profile-matcher-dashboard">
      
      {/* Introduction Card */}
      <div className="bg-slate-950/40 rounded-3xl border border-slate-750/85 p-6 shadow-xl text-left relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-accent-purple/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center relative z-10 border-b border-slate-750/50 pb-4">
          <div>
            <h2 className="text-sm font-black text-slate-100 uppercase tracking-widest flex items-center gap-2.5 font-display">
              <Sparkles className="h-5 w-5 text-accent-purple animate-pulse" />
              AI Candidate Matcher & Recruiter Engine
            </h2>
            <p className="text-[11px] text-slate-400 font-bold mt-1">
              Find the top 20-30 best-fit profiles from the entire database in seconds by selecting a job, entering text, or dragging in a job poster creative.
            </p>
          </div>
          <span className="text-[10px] bg-purple-950/40 border border-purple-900/30 px-3 py-1.5 rounded-full font-black text-accent-purple uppercase tracking-wider font-mono">
            Powered by Gemini 3.5 Flash
          </span>
        </div>

        {/* Inputs Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-5">
          
          {/* Left Inputs (Job select & Custom Command) */}
          <div className="lg:col-span-7 space-y-4 text-left">
            <div>
              <label className="block text-[11px] font-black text-slate-300 uppercase tracking-wider mb-1.5 font-display">
                1. Select Active Job Demand (Optional)
              </label>
              <select
                value={selectedJobId}
                onChange={handleJobSelect}
                className="w-full bg-slate-900 border border-slate-750 rounded-xl p-3 text-xs text-slate-100 focus:border-accent-purple outline-none cursor-pointer transition-all font-mono"
              >
                <option value="">-- No active job selected (Custom Prompt Match) --</option>
                {jobs.map(job => (
                  <option key={job.id} value={job.id}>
                    💼 {job.title} ({job.country})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-black text-slate-300 uppercase tracking-wider mb-1.5 font-display">
                2. Specify Requirements or Custom Prompt
              </label>
              <textarea
                value={textCommand}
                onChange={(e) => setTextCommand(e.target.value)}
                placeholder="Enter job roles, target countries, experience requirements, preferred candidate origins (e.g., Darjeeling, Siliguri), or custom recruiting instructions..."
                rows={5}
                className="w-full bg-slate-900 border border-slate-750 rounded-xl p-3 text-xs text-slate-100 focus:border-accent-purple outline-none resize-none transition-all font-mono placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* Right Inputs (Image Creative Upload) */}
          <div className="lg:col-span-5 flex flex-col justify-between">
            <div className="h-full flex flex-col">
              <span className="block text-[11px] font-black text-slate-300 uppercase tracking-wider mb-1.5 font-display text-left">
                3. Drag & Drop Job Creative Flyer Image (Optional)
              </span>
              
              {!imageFile ? (
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  className="flex-1 border-2 border-dashed border-slate-750 hover:border-accent-purple rounded-2xl flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-all hover:bg-slate-900/40 relative group min-h-[170px]"
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <UploadCloud className="h-10 w-10 text-slate-500 group-hover:text-accent-purple transition-all mb-2.5" />
                  <span className="text-xs font-bold text-slate-300">Upload job creative flyer</span>
                  <span className="text-[10px] text-slate-500 font-bold mt-1">PNG, JPG, or JPEG (Max 5MB)</span>
                </div>
              ) : (
                <div className="flex-1 border border-slate-750 rounded-2xl p-3.5 bg-slate-900 relative flex items-center gap-4 min-h-[170px] text-left">
                  <div className="w-24 h-28 bg-slate-950 rounded-lg border border-slate-750 overflow-hidden shrink-0 shadow-inner">
                    <img
                      src={imageFile}
                      alt="Job Creative Upload"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-black text-slate-200 block truncate uppercase font-mono mb-1">
                      📸 Creative Loaded
                    </span>
                    <span className="text-[10px] text-slate-500 font-bold block truncate font-mono">
                      {imageName || 'job_flyer_creative.png'}
                    </span>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-black uppercase text-rose-400 bg-rose-950/40 border border-rose-900/30 hover:bg-rose-900/40 rounded-lg transition-all cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" /> Clear Image
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Scan Button Action row */}
        <div className="flex justify-end pt-5 border-t border-slate-750/50 mt-6">
          <button
            type="button"
            disabled={loading}
            onClick={handleScan}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all select-none cursor-pointer shadow-lg hover:-translate-y-0.5 ${
              loading 
                ? 'bg-slate-800 text-slate-500 border border-slate-750 cursor-not-allowed'
                : 'bg-accent-purple text-white hover:bg-purple-600 shadow-accent-purple/20'
            }`}
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Analyzing CRM & Candidate Directories...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-amber-300 animate-pulse" />
                Scan & Match Candidates
              </>
            )}
          </button>
        </div>
      </div>

      {/* Loading State Feedback */}
      {loading && (
        <div className="bg-slate-900 rounded-3xl border border-slate-800 p-8 shadow-xl text-center space-y-4 animate-pulse">
          <RefreshCw className="h-10 w-10 text-accent-purple animate-spin mx-auto" />
          <h3 className="text-xs font-black text-slate-300 uppercase tracking-widest font-mono">
            {loadingStep}
          </h3>
          <p className="text-[10px] text-slate-500 max-w-sm mx-auto font-bold">
            Gemini is evaluating your recruitment pool against parameters. This should only take a few moments.
          </p>
        </div>
      )}

      {/* Match Results Display */}
      {results && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Extracted Job Profile Badge */}
          <div className="bg-slate-900 border border-slate-850 rounded-3xl p-6 text-left shadow-md flex flex-col md:flex-row justify-between gap-6">
            <div className="space-y-3">
              <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest font-display">
                🎯 Job Demand Context Generated by AI
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-6 text-left">
                <div>
                  <span className="text-[9px] uppercase font-black text-slate-500 block">Position Title</span>
                  <span className="text-xs font-bold text-slate-200">{results.jobDetails.title}</span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-black text-slate-500 block">Work Location</span>
                  <span className="text-xs font-bold text-slate-200">{results.jobDetails.country}</span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-black text-slate-500 block">Salary Package</span>
                  <span className="text-xs font-bold text-slate-200">{results.jobDetails.salary}</span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-black text-slate-500 block">Experience Required</span>
                  <span className="text-xs font-bold text-slate-200">{results.jobDetails.experience}</span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-black text-slate-500 block">Skills Preference</span>
                  <span className="text-xs font-bold text-slate-200">{results.jobDetails.skills}</span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-black text-slate-500 block">Target Origin Group</span>
                  <span className="text-xs font-bold text-accent-emerald">{results.jobDetails.preferredRegion}</span>
                </div>
              </div>
            </div>

            {imageFile && (
              <div className="self-start md:self-center shrink-0 flex items-center gap-2.5 bg-slate-950 p-2 rounded-2xl border border-slate-800">
                <img
                  src={imageFile}
                  alt="Job Flyer"
                  className="w-12 h-14 object-cover rounded-lg border border-slate-700"
                  referrerPolicy="no-referrer"
                />
                <div className="text-left">
                  <span className="text-[8px] text-slate-500 block uppercase font-mono">Matched using flyer</span>
                  <span className="text-[10px] text-slate-300 font-bold block max-w-[120px] truncate font-mono">
                    {imageName || 'flyer_creative.png'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Simulation mode warning */}
          {results.isSimulated && (
            <div className="bg-amber-950/20 border border-amber-900/30 rounded-2xl p-4 flex gap-3 text-left">
              <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
              <div>
                <h4 className="text-xs font-black text-amber-300 uppercase tracking-wider">Simulation Mode Enabled</h4>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                  CRM matches generated locally using smart indexing. Connect your real <strong>GEMINI_API_KEY</strong> secret key inside settings to unlock direct flyer visual parsing!
                </p>
              </div>
            </div>
          )}

          {/* Matched candidates section */}
          <div className="bg-slate-950/30 rounded-3xl border border-slate-750/70 p-6 text-left space-y-5">
            <div className="flex justify-between items-center border-b border-slate-750 pb-3">
              <div>
                <h3 className="text-xs font-black text-slate-100 uppercase tracking-widest flex items-center gap-2 font-display">
                  <Award className="h-4.5 w-4.5 text-accent-purple" />
                  Top Candidate Matches ({results.matches.length} Results)
                </h3>
                <p className="text-[10px] text-slate-500 font-bold">
                  Candidates ranked by skills alignment, experience metrics, target origin preferences, and telecaller remarks logs.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportShortlistedCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent-purple hover:bg-purple-600 text-white text-[10px] font-black uppercase transition-all shadow-md shadow-accent-purple/20 border border-transparent cursor-pointer"
                  title="Export shortlisted candidates to .CSV"
                >
                  <Download className="h-3.5 w-3.5" /> Export Shortlisted
                </button>
                <span className="text-[9px] bg-slate-900 border border-slate-750 text-slate-400 px-3 py-2 rounded-xl font-bold font-mono">
                  Dec 2026 - Date
                </span>
              </div>
            </div>

            {results.matches.length > 0 ? (
              /* Denser high density grid of candidate cards with side actions */
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {results.matches.map((match, idx) => {
                  const scoreColor = match.matchScore >= 90 
                    ? 'text-accent-emerald bg-emerald-950/40 border-emerald-900/30' 
                    : match.matchScore >= 75
                    ? 'text-accent-purple bg-purple-950/40 border-purple-900/30'
                    : 'text-amber-500 bg-amber-950/40 border-amber-900/30';

                  const isAssigned = assignedStatus[match.id] !== undefined
                    ? assignedStatus[match.id]
                    : match.project === results.jobDetails.title;

                  return (
                    <div
                      key={match.id}
                      className="bg-slate-850/80 rounded-2xl border border-slate-750/70 p-4.5 hover:border-accent-purple transition-all duration-200 flex flex-col justify-between group/card relative shadow-3xs"
                    >
                      {/* Ranking Badge & Score */}
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[10px] font-black text-slate-400 bg-slate-900/60 px-2.5 py-0.5 rounded font-mono uppercase tracking-wider">
                          Rank #{idx + 1}
                        </span>
                        
                        <div className={`text-[10px] font-black px-2.5 py-0.5 rounded border flex items-center gap-1 font-mono uppercase ${scoreColor}`}>
                          <Sparkles className="h-3 w-3" />
                          {match.matchScore}% Match
                        </div>
                      </div>

                      {/* Candidate Name & Info */}
                      <div className="space-y-1 text-left">
                        <h4 className="font-extrabold text-slate-100 text-sm tracking-tight uppercase font-display group-hover/card:text-accent-purple transition-colors">
                          {match.name}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold font-mono">
                          <span>{match.gender === 'F' ? 'F' : 'M'}, Age {match.age || '24'}</span>
                          <span>•</span>
                          <span className="flex items-center gap-0.5">
                            <MapPin className="h-2.5 w-2.5 inline text-slate-500" /> {match.origin || 'Darjeeling'}
                          </span>
                        </div>
                      </div>

                      {/* Profile details */}
                      <div className="mt-2.5 pt-2 border-t border-slate-800/80 space-y-1.5 text-left">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-slate-500 font-bold">Logged position:</span>
                          <span className="text-slate-200 font-extrabold uppercase font-mono truncate max-w-[130px]" title={match.position}>
                            {match.position || 'General'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-slate-500 font-bold">Experience:</span>
                          <span className="text-slate-300 font-bold truncate max-w-[150px]">
                            {match.experience || 'Not specified'}
                          </span>
                        </div>
                        {(isAssigned || match.project) && (
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-slate-500 font-bold">Current project:</span>
                            <span className="text-accent-purple font-black bg-purple-950/20 border border-purple-900/10 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                              {isAssigned ? results.jobDetails.title : match.project}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* AI Matching Justification */}
                      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-[10px] text-slate-300 mt-3.5 space-y-1 leading-relaxed text-left">
                        <span className="text-[8px] font-black uppercase text-accent-purple tracking-widest block font-display">
                          ⭐ AI Evaluation Insights
                        </span>
                        <p className="font-mono italic font-medium leading-normal">
                          "{match.matchReason}"
                        </p>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 mt-4.5 pt-3 border-t border-slate-800/80">
                        <button
                          type="button"
                          onClick={() => onSelectLead(match)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white text-[10px] font-black uppercase transition-all cursor-pointer border border-slate-750"
                        >
                          <FileText className="h-3.5 w-3.5" /> Profile
                        </button>

                        <button
                          type="button"
                          onClick={() => handleAssignProject(match, results.jobDetails.title)}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-black uppercase transition-all cursor-pointer ${
                            isAssigned
                              ? 'bg-emerald-950/40 border border-emerald-900/35 text-accent-emerald hover:bg-rose-950/45 hover:border-rose-900/30 hover:text-rose-400'
                              : 'bg-accent-purple/10 border border-accent-purple/30 hover:bg-accent-purple text-accent-purple hover:text-white hover:border-transparent'
                          }`}
                          title={isAssigned ? "Click to deselect / remove from shortlist" : "Click to shortlist candidate"}
                        >
                          {isAssigned ? (
                            <>
                              <ShieldCheck className="h-3.5 w-3.5" /> Shortlisted
                            </>
                          ) : (
                            <>
                              <UserCheck className="h-3.5 w-3.5" /> Shortlist
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="border border-dashed border-slate-750 rounded-2xl flex flex-col items-center justify-center py-16 text-slate-500 space-y-2 bg-slate-900/20">
                <AlertCircle className="h-8 w-8 text-slate-600 animate-bounce" />
                <span className="text-xs font-black text-slate-400">No profile matches found</span>
                <p className="text-[10px] text-slate-500 max-w-xs text-center font-bold">
                  Try broadening your matching query text command or clear filters to locate matches.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
