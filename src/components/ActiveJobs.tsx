import React, { useState, useEffect } from 'react';
import { 
  Briefcase, 
  MapPin, 
  Clock, 
  Users, 
  Plus, 
  Trash2, 
  Edit3, 
  Coins, 
  Video, 
  CheckCircle, 
  X, 
  Loader2, 
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  AlertCircle,
  Globe
} from 'lucide-react';
import { Job } from '../types';
import { getCountryFlagUrl, getCountryCode } from '../utils';

interface ActiveJobsProps {
  currentUser: {
    id: string;
    username: string;
    displayName: string;
    role: 'admin' | 'agent';
  } | null;
  countries?: string[];
}

export default function ActiveJobs({ currentUser, countries }: ActiveJobsProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const safeCountries = Array.isArray(countries) ? countries : ['Kuwait', 'Dubai', 'Qatar', 'Germany', 'Japan', 'Albania'];

  // Selected country tab/card state
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  
  // Fields
  const [title, setTitle] = useState('');
  const [country, setCountry] = useState('Kuwait');
  const [customCountry, setCustomCountry] = useState('');
  const [requirement, setRequirement] = useState('');
  const [processingFeeMale, setProcessingFeeMale] = useState('');
  const [processingFeeFemale, setProcessingFeeFemale] = useState('');
  const [accommodation, setAccommodation] = useState('');
  const [ageLimit, setAgeLimit] = useState('');
  const [modeOfInterview, setModeOfInterview] = useState('Online');
  const [applicability, setApplicability] = useState('Both Male & Female Candidates can Apply');
  const [otherTerms, setOtherTerms] = useState('');
  const [conditionsText, setConditionsText] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Fetch all jobs
  const fetchJobs = async (focusCountry?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) throw new Error('Failed to load active jobs.');
           const data = await res.json();
      const safeData = Array.isArray(data) ? data.filter(j => j && typeof j === 'object') : [];
      setJobs(safeData);
      
      if (safeData.length > 0) {
        const uniqueFromData = Array.from(
          new Set(safeData.map((j: Job) => ((j.country || 'Other').trim())))
        ).sort() as string[];
        if (uniqueFromData.length > 0) {
          if (focusCountry && uniqueFromData.includes(focusCountry)) {
            setSelectedCountry(focusCountry);
          } else {
            setSelectedCountry((prev) => prev && uniqueFromData.includes(prev) ? prev : uniqueFromData[0]);
          }
        }
      } else {
        setSelectedCountry(null);
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  // Handle open form for creating new job
  const handleOpenCreate = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setFormError(null);
    setEditingJob(null);
    setTitle('');
    setCountry(safeCountries[0] || 'Kuwait');
    setCustomCountry('');
    setRequirement('');
    setProcessingFeeMale('');
    setProcessingFeeFemale('');
    setAccommodation('');
    setAgeLimit('');
    setModeOfInterview('Online');
    setApplicability('Both Male & Female Candidates can Apply');
    setOtherTerms('');
    setConditionsText([
      'Pre Medical',
      'No Stamping Required',
      'Original Passport is mandatory',
      'Need to send Introduction Video'
    ].join('\n'));
    setIsActive(true);
    setIsFormOpen(true);
  };

  // Handle edit job
  const handleOpenEdit = (job: Job, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFormError(null);
    setEditingJob(job);
    setTitle(job.title || '');
    
    const jobCountry = job.country || 'Kuwait';
    const isPredefined = safeCountries.includes(jobCountry);
    if (isPredefined) {
      setCountry(jobCountry);
      setCustomCountry('');
    } else {
      setCountry('Custom');
      setCustomCountry(jobCountry);
    }

    setRequirement(job.requirement || '');
    setProcessingFeeMale(job.processingFeeMale || '');
    setProcessingFeeFemale(job.processingFeeFemale || '');
    setAccommodation(job.accommodation || '');
    setAgeLimit(job.ageLimit || '');
    setModeOfInterview(job.modeOfInterview || 'Online');
    setApplicability(job.applicability || 'Both Male & Female Candidates can Apply');
    setOtherTerms(job.otherTerms || '');
    setConditionsText(Array.isArray(job.conditions) ? job.conditions.join('\n') : '');
    setIsActive(job.isActive !== false);
    setIsFormOpen(true);
  };

  // Handle submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const selectedCountry = country === 'Custom' ? customCountry.trim() : country;
    if (!selectedCountry) {
      setFormError('Please specify a country.');
      return;
    }

    const parsedConditions = (conditionsText || '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const payload = {
      title: title.trim(),
      country: selectedCountry,
      requirement: (requirement || '').trim(),
      processingFeeMale: (processingFeeMale || '').trim(),
      processingFeeFemale: (processingFeeFemale || '').trim(),
      accommodation: (accommodation || '').trim(),
      ageLimit: (ageLimit || '').trim(),
      conditions: parsedConditions,
      modeOfInterview,
      applicability,
      otherTerms: (otherTerms || '').trim(),
      isActive
    };

    try {
      let res;
      if (editingJob) {
        // Edit mode
        res = await fetch(`/api/jobs/${editingJob.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        // Create mode
        res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save the job vacancy.');
      }
      
      setIsFormOpen(false);
      setEditingJob(null);
      setFormError(null);
      fetchJobs(selectedCountry);
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  // Handle delete job (initiates custom confirmation modal)
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingJobId(id);
  };

  // Confirms actual deletion of job
  const confirmDelete = async () => {
    if (!deletingJobId) return;
    try {
      const res = await fetch(`/api/jobs/${deletingJobId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to delete job.');
      }
      setDeletingJobId(null);
      fetchJobs();
    } catch (err) {
      setError((err as Error).message);
      setDeletingJobId(null);
    }
  };

  // Group jobs by country
  const groupedJobs = React.useMemo(() => {
    const groups: Record<string, Job[]> = {};
    if (Array.isArray(jobs)) {
      jobs.forEach(job => {
        if (job) {
          // If NOT admin, skip inactive jobs
          if (currentUser?.role !== 'admin' && job.isActive === false) {
            return;
          }
          const cKey = (job.country || 'Other').trim();
          if (!groups[cKey]) {
            groups[cKey] = [];
          }
          groups[cKey].push(job);
        }
      });
    }
    return groups;
  }, [jobs, currentUser]);

  const uniqueCountriesWithJobs = Object.keys(groupedJobs).sort();

  return (
    <div id="active-jobs-container" className="space-y-8 animate-fade-in pb-16">
      
      {/* Top Header Card */}
      <div className="bg-radial from-slate-900 to-slate-950 text-slate-100 rounded-3xl py-4.5 px-6 sm:px-8 shadow-xl relative overflow-hidden border border-slate-750">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl -ml-20 -mb-20 pointer-events-none" />
        
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4 z-10">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Demand Requirement Hub
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight font-sans">
              Overseas Vacancy Tracker
            </h1>
          </div>
          
          <button 
            id="add-vacancy-btn"
            type="button"
            onClick={handleOpenCreate}
            className="self-start md:self-center px-5 py-3 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-zinc-950 font-black rounded-xl transition duration-150 shadow-lg shadow-emerald-500/25 inline-flex items-center gap-2 cursor-pointer text-xs select-none z-25 relative"
          >
            <Plus className="w-4 h-4" />
            Add Active Job
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Main Grid / Accordion Country-wise view */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
          <p className="text-slate-500 text-sm font-medium animate-pulse">Retrieving active job demands...</p>
        </div>
      ) : uniqueCountriesWithJobs.length === 0 ? (
        <div className="bg-slate-900 border border-slate-750 border-dashed rounded-3xl py-20 text-center max-w-xl mx-auto px-6">
          <Briefcase className="w-12 h-12 text-slate-400 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-100">No vacancies currently listed</h3>
          <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
            Get started by adding your first active international job vacancy to allow coordinators to reference pricing and benefits.
          </p>
          <button 
            onClick={handleOpenCreate}
            className="mt-6 px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-100 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Create vacancy requirement
          </button>
        </div>
      ) : (
        <div className="space-y-8 animate-fade-in">
          {/* Country Selection Header/Title */}
          <div className="text-left">
            <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Globe className="h-4 w-4 text-emerald-600" /> Country Wise Demand Directory
            </h2>
          </div>

          {/* Country Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5">
            {uniqueCountriesWithJobs.map((countryName) => {
              const countryJobs = groupedJobs[countryName] || [];
              const isSelected = selectedCountry === countryName;
              const flagUrl = getCountryFlagUrl(countryName);

              return (
                <button
                  key={countryName}
                  type="button"
                  onClick={() => setSelectedCountry(countryName)}
                  className={`group p-2.5 px-3.5 rounded-2xl border text-left transition-all duration-200 select-none cursor-pointer flex flex-col justify-between h-21 relative overflow-hidden ${
                    isSelected
                      ? 'bg-accent-purple border-accent-purple text-white shadow-lg shadow-accent-purple/20 scale-[1.02]'
                      : 'bg-slate-850 border-slate-750 hover:border-slate-600 text-slate-200 hover:bg-slate-800/50 shadow-3xs'
                  }`}
                >
                  {/* Background Country Flag Watermark */}
                  {flagUrl ? (
                    <img 
                      src={flagUrl} 
                      alt="" 
                      className="absolute -right-2 -bottom-3 w-16 h-12 object-cover opacity-[0.08] select-none pointer-events-none transition-all duration-300 group-hover:scale-115 group-hover:-rotate-3 rounded-md"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="absolute -right-2 -bottom-3 text-5xl opacity-[0.08] select-none pointer-events-none transition-transform duration-300 group-hover:scale-115 group-hover:-rotate-3">
                      🌐
                    </span>
                  )}

                  <div className="relative z-10 flex items-start justify-between w-full">
                    <div className={`text-sm font-bold flex items-center justify-center w-7 h-7 rounded-lg overflow-hidden border ${isSelected ? 'bg-white/20 border-white/30' : 'bg-slate-800 border-slate-700'}`}>
                      {flagUrl ? (
                        <img 
                          src={flagUrl} 
                          alt="" 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="text-xs">🌐</span>
                      )}
                    </div>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md font-mono ${
                      isSelected
                        ? 'bg-white/25 text-white border border-white/30'
                        : 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30'
                    }`}>
                      {countryJobs.length} {countryJobs.length === 1 ? 'Job' : 'Jobs'}
                    </span>
                  </div>
                  <div className="relative z-10">
                    <h3 className="font-black text-xs tracking-wide uppercase leading-none truncate">
                      {countryName}
                    </h3>
                    <p className={`text-[8px] font-bold mt-1.5 ${isSelected ? 'text-purple-100' : 'text-slate-500'}`}>
                      {isSelected ? '● Selected' : 'Click to view'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Jobs display area for the selected country */}
          {selectedCountry && groupedJobs[selectedCountry] && (
            <div className="bg-slate-950/40 border border-slate-750/80 rounded-3xl p-6 shadow-3xs text-left space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-750/60 pb-4 gap-3">
                <div>
                  <h3 className="text-lg font-black text-slate-100 uppercase tracking-wide flex items-center gap-2">
                    {getCountryFlagUrl(selectedCountry) ? (
                      <img 
                        src={getCountryFlagUrl(selectedCountry)} 
                        alt="" 
                        className="w-6 h-4.5 object-cover rounded-sm inline-block shadow-sm transform hover:scale-110 transition-transform"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="text-xl">🌐</span>
                    )} {selectedCountry} Active Vacancies</h3>
                  <p className="text-xs text-slate-500 font-bold">
                    Showing {groupedJobs[selectedCountry].length} official career opportunities listed for {selectedCountry}
                  </p>
                </div>
                <span className="self-start sm:self-center text-[10px] uppercase font-black text-emerald-400 bg-emerald-950/40 border border-emerald-900/30 px-3 py-1.5 rounded-full font-mono">
                  CGP Verified Demand
                </span>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {(groupedJobs[selectedCountry] || []).filter(Boolean).map((job) => (
                  <div 
                    key={job.id}
                    id={`job-card-${job.id}`}
                    className={`bg-slate-850 border rounded-2xl shadow-3xs hover:shadow-md hover:border-slate-600 transition-all duration-250 relative flex flex-col overflow-hidden ${
                      job.isActive === false ? 'border-dashed border-slate-700 bg-slate-900/50 opacity-80' : 'border-slate-750'
                    }`}
                  >
                    {/* Header block with country/title */}
                    <div className="p-5 pb-4 border-b border-slate-750 bg-slate-900/30 flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 bg-slate-900 text-slate-100 text-[9px] font-bold tracking-wider uppercase rounded-sm">
                            {(job.country || 'Other').toUpperCase()}
                          </span>
                          {job.isActive !== false ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-950/40 border border-emerald-900/30 text-emerald-400 text-[9px] font-bold tracking-wider uppercase rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Active Demand
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-950/40 border border-amber-900/30 text-amber-400 text-[9px] font-bold tracking-wider uppercase rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Demand Paused / Off
                            </span>
                          )}
                        </div>
                        <h3 className="text-base font-black text-slate-100 tracking-tight leading-snug">
                          {job.title}
                        </h3>
                      </div>
                      
                      {/* Actions & Status Switch */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {currentUser?.role === 'admin' && (
                          <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1 shadow-3xs">
                            <button
                               type="button"
                               onClick={(e) => handleOpenEdit(job, e)}
                               className="p-1.5 text-slate-500 hover:text-accent-purple hover:bg-slate-700 rounded-md transition duration-150 cursor-pointer"
                               title="Edit vacancy details"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDelete(job.id, e)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-700 rounded-md transition duration-150 cursor-pointer"
                              title="Delete vacancy"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {currentUser?.role === 'admin' && (
                          <div className="flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded-lg border border-slate-700 shadow-3xs">
                            <span className={`text-[8px] font-black uppercase tracking-wider ${job.isActive !== false ? 'text-emerald-400' : 'text-slate-400'}`}>
                              {job.isActive !== false ? 'Demand ON' : 'Demand OFF'}
                            </span>
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  const res = await fetch(`/api/jobs/${job.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ isActive: job.isActive === false })
                                  });
                                  if (res.ok) {
                                    fetchJobs(selectedCountry || undefined);
                                  }
                                } catch (err) {
                                  console.error('Failed to toggle job status', err);
                                }
                              }}
                              className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                job.isActive !== false ? 'bg-emerald-600' : 'bg-slate-700'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                  job.isActive !== false ? 'translate-x-3.5' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Main parameters block */}
                    <div className="p-5 space-y-4 flex-grow text-left">
                      {/* 1. Demand & Processing Charge */}
                      <div className="grid grid-cols-2 gap-3.5">
                        <div className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-750 space-y-0.5">
                          <span className="text-[10px] font-black text-slate-500 flex items-center gap-1 uppercase tracking-wider">
                            <Coins className="w-3 h-3 text-slate-400" /> Male Charge
                          </span>
                          <p className="text-base font-black text-slate-100">
                            {job.processingFeeMale || 'N/A'}
                          </p>
                        </div>
                        <div className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-750 space-y-0.5">
                          <span className="text-[10px] font-black text-slate-500 flex items-center gap-1 uppercase tracking-wider">
                            <Coins className="w-3 h-3 text-slate-400" /> Female Charge
                          </span>
                          <p className="text-base font-black text-slate-100">
                            {job.processingFeeFemale || 'N/A'}
                          </p>
                        </div>
                      </div>

                      {/* 2. Core specs list */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-y-3.5 gap-x-4 text-xs">
                        <div className="flex items-start gap-2">
                          <Briefcase className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Position & Salary</p>
                            <p className="text-slate-200 font-bold">{job.requirement}</p>
                          </div>
                        </div>
                        
                        <div className="flex items-start gap-2">
                          <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Age Bracket</p>
                            <p className="text-slate-200 font-bold">{job.ageLimit || 'Any'}</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2 md:col-span-2">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Accommodation & Transport</p>
                            <p className="text-slate-200 font-bold leading-relaxed">{job.accommodation}</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <Video className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Interview Mode</p>
                            <p className="text-slate-200 font-bold">{job.modeOfInterview}</p>
                          </div>
                        </div>

                        <div className="flex items-start gap-2">
                          <Users className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Applicability</p>
                            <p className="text-slate-200 font-bold">{job.applicability}</p>
                          </div>
                        </div>
                      </div>

                      {/* 3. Mandatory conditions checklist */}
                      {job.conditions && job.conditions.length > 0 && (
                        <div className="space-y-2 pt-1.5">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Mandatory Criteria & Medicals</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                            {job.conditions.map((cond, idx) => (
                              <div key={idx} className="flex items-center gap-1.5 text-slate-200 bg-slate-900/40 p-2 rounded-lg border border-slate-750 text-xs">
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                                <span className="font-bold truncate" title={cond}>{cond}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Footer text / Special other terms */}
                    {job.otherTerms && (
                      <div className="px-5 py-3.5 bg-purple-950/40 border-t border-slate-750 text-xs text-purple-400 font-bold leading-relaxed flex items-center gap-2 text-left">
                        <ShieldCheck className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                        <p>{job.otherTerms}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {deletingJobId && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            {/* Background overlay */}
            <div 
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity" 
              onClick={() => setDeletingJobId(null)}
            />

            {/* Trick to center modal */}
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            {/* Modal panel */}
            <div className="relative z-10 inline-block align-middle bg-slate-850 rounded-3xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full border border-slate-750">
              <div className="p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-rose-950/40 text-rose-400 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-slate-100">Remove Job Vacancy</h3>
                  <p className="text-sm text-slate-400">
                    Are you sure you want to permanently remove this job vacancy from the database? This action cannot be undone.
                  </p>
                </div>
                <div className="pt-4 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setDeletingJobId(null)}
                    className="px-4 py-2 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDelete}
                    className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold rounded-xl transition shadow-md shadow-rose-600/10 cursor-pointer"
                  >
                    Yes, Delete Vacancy
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-over Modal Form */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            {/* Background overlay */}
            <div 
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity" 
              onClick={() => setIsFormOpen(false)}
            />

            {/* Trick to center modal */}
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            {/* Modal panel */}
            <div className="relative z-10 inline-block align-middle bg-slate-850 rounded-3xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-xl sm:w-full border border-slate-750">
              <div className="p-6 border-b border-slate-750 flex items-center justify-between bg-slate-900/30">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-slate-100">
                    {editingJob ? 'Edit Vacancy Demand' : 'Add New Active Job Demand'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Provide precise pricing and criteria specifications. Accessible by anyone.
                  </p>
                </div>
                <button 
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {formError && (
                  <div className="bg-rose-950/40 border border-rose-900/30 text-rose-400 p-3.5 rounded-xl flex items-center gap-2 text-xs font-bold">
                    <AlertCircle className="w-4.5 h-4.5 flex-shrink-0 text-rose-500" />
                    <span>{formError}</span>
                  </div>
                )}
                
                {/* Title */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Job Title / Company Name</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. NESTO HYPERMARKET or HOTEL INTERCONTINENTAL QATAR"
                    className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                  />
                </div>

                {/* Country dropdown selection */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Target Country</label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                    >
                      {safeCountries.map((c) => (
                        <option key={c} value={c} className="bg-slate-850 text-slate-100">{c}</option>
                      ))}
                      <option value="Custom" className="bg-slate-850 text-slate-100">Custom (Type below)</option>
                    </select>
                  </div>

                  {country === 'Custom' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Custom Country Name</label>
                      <input
                        type="text"
                        required
                        value={customCountry}
                        onChange={(e) => setCustomCountry(e.target.value)}
                        placeholder="e.g. Kuwait, Oman, Bahrain"
                        className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                      />
                    </div>
                  )}
                </div>

                {/* Requirement / Salary */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Requirements & Salary Structure</label>
                  <input
                    type="text"
                    value={requirement}
                    onChange={(e) => setRequirement(e.target.value)}
                    placeholder="e.g. Sales (1400 AED) or Guest Relations (2000 - 2700 AED)"
                    className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                  />
                </div>

                {/* Processing Fee Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Male Service Charge</label>
                    <input
                      type="text"
                      value={processingFeeMale}
                      onChange={(e) => setProcessingFeeMale(e.target.value)}
                      placeholder="e.g. 95k"
                      className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Female Service Charge</label>
                    <input
                      type="text"
                      value={processingFeeFemale}
                      onChange={(e) => setProcessingFeeFemale(e.target.value)}
                      placeholder="e.g. 65k"
                      className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                    />
                  </div>
                </div>

                {/* Accommodation and Age limit */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Accommodation & Flights</label>
                    <input
                      type="text"
                      value={accommodation}
                      onChange={(e) => setAccommodation(e.target.value)}
                      placeholder="e.g. Free Accommodation, Meals & Transportation + Air ticket every 2 yrs"
                      className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Age Limit</label>
                    <input
                      type="text"
                      value={ageLimit}
                      onChange={(e) => setAgeLimit(e.target.value)}
                      placeholder="e.g. Max 32"
                      className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                    />
                  </div>
                </div>

                {/* Interview and Applicability */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Mode of Interview</label>
                    <select
                      value={modeOfInterview}
                      onChange={(e) => setModeOfInterview(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                    >
                      <option value="Online" className="bg-slate-850 text-slate-100">Online</option>
                      <option value="Face to Face" className="bg-slate-850 text-slate-100">Face to Face</option>
                      <option value="Online / CV Selection" className="bg-slate-850 text-slate-100">Online / CV Selection</option>
                      <option value="CV Selection Only" className="bg-slate-850 text-slate-100">CV Selection Only</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Applicability</label>
                    <select
                      value={applicability}
                      onChange={(e) => setApplicability(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                    >
                      <option value="Both Male & Female Candidates can Apply" className="bg-slate-850 text-slate-100">Both Male & Female</option>
                      <option value="Only Female Candidates can Apply" className="bg-slate-850 text-slate-100">Only Female</option>
                      <option value="Only Male Candidates can Apply" className="bg-slate-850 text-slate-100">Only Male</option>
                    </select>
                  </div>
                </div>

                {/* Conditions list */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">
                    Mandatory Criteria & Medicals (One item per line)
                  </label>
                  <textarea
                    rows={4}
                    value={conditionsText}
                    onChange={(e) => setConditionsText(e.target.value)}
                    placeholder="Pre Medical&#10;No Stamping Required&#10;Original Passport is mandatory"
                    className="w-full px-3 py-2 border border-slate-700 rounded-xl text-sm font-sans focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                  />
                </div>

                {/* Other special terms */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Special Rules & flight terms</label>
                  <input
                    type="text"
                    value={otherTerms}
                    onChange={(e) => setOtherTerms(e.target.value)}
                    placeholder="e.g. Includes International Flight Tickets. Freshers can Apply."
                    className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold"
                  />
                </div>

                {/* Admin-only: Enable/Publish Toggle */}
                {currentUser?.role === 'admin' && (
                  <div className="bg-slate-900/50 border border-slate-750 p-3.5 rounded-2xl flex items-center justify-between">
                    <div className="space-y-0.5 text-left">
                      <span className="block text-xs font-black text-slate-100 uppercase tracking-wide">Publish & Enable Demand</span>
                      <span className="block text-[10px] text-slate-400 font-bold">Turn this on to make this vacancy active and visible to all agents.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsActive(!isActive)}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isActive ? 'bg-emerald-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isActive ? 'translate-x-4.5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}

                <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-750">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-zinc-950 text-xs font-bold rounded-xl transition shadow-md shadow-emerald-500/10 cursor-pointer"
                  >
                    {editingJob ? 'Save Vacancy Changes' : 'Publish Active Vacancy'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
