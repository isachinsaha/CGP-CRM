import React, { useState, useEffect, useRef } from 'react';
import { Lead, Job } from '../types';
import {
  Send,
  ImagePlus,
  Briefcase,
  X,
  RotateCcw,
  UserCheck,
  ShieldCheck,
  FileText,
  Download,
  Loader2,
  MessageSquare,
  Phone
} from 'lucide-react';

interface AiProfileMatcherProps {
  onSelectLead: (lead: Lead) => void;
  onUpdateLead: (lead: Lead) => Promise<void>;
  userRole: string;
  currentUser?: {
    id: string;
    username: string;
    displayName: string;
    role: 'admin' | 'agent';
    token?: string;
  } | null;
}

type MatchedLead = Lead & { matchScore: number; matchReason: string };

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imagePreview?: string | null;
  jobLabel?: string;
  jobTitleForShortlist?: string;
  matches?: MatchedLead[];
  scopedCount?: number;
  scopeLabel?: string;
  elapsedMs?: number;
  isError?: boolean;
}

const QUICK_STARTERS = [
  'Show all female waitress',
  'Need cook or chef for Dubai',
  'Nurse or caregiver for Qatar',
  'How many leads I have?'
];

export default function AiProfileMatcher({
  onSelectLead,
  onUpdateLead,
  userRole,
  currentUser
}: AiProfileMatcherProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [imageFile, setImageFile] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [assignedStatus, setAssignedStatus] = useState<Record<string, boolean>>({});
  const [listFilterByMsg, setListFilterByMsg] = useState<Record<string, string>>({});
  const [hideLostByMsg, setHideLostByMsg] = useState<Record<string, boolean>>({});
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isAdmin = userRole === 'admin';
  const displayName = currentUser?.displayName || currentUser?.username || 'Friend';
  const agentId = currentUser?.username || 'unassigned';

  // Fetch active jobs for quick pick
  useEffect(() => {
    fetch('/api/jobs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setJobs(data.filter(j => j && j.isActive !== false && !j.isDeleted));
        }
      })
      .catch(err => console.error('Error fetching jobs:', err));
  }, []);

  // Scroll smoothly when new chat messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-user-role': userRole || 'agent',
      'x-agent-id': agentId
    };
    if (currentUser?.token) {
      h['Authorization'] = `Bearer ${currentUser.token}`;
    }
    return h;
  };

  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setActionNotice('Please upload image file only (PNG, JPG, WEBP).');
      return;
    }
    setActionNotice(null);
    setImageName(file.name || 'job_photo.png');
    const reader = new FileReader();
    reader.onloadend = () => {
      setImageFile(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSendMessage = async (overrideText?: string) => {
    if (isSending) return;
    const textToSend = (overrideText !== undefined ? overrideText : inputText).trim();
    const chosenJob = jobs.find(j => j.id === selectedJobId);
    const chosenJobLabel = chosenJob
      ? chosenJob.serviceCharge || chosenJob.title || 'Active Job'
      : '';

    if (!textToSend && !imageFile && !chosenJob) {
      return;
    }

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: textToSend || (chosenJobLabel ? `Find leads for ${chosenJobLabel}` : 'Check this job photo'),
      imagePreview: imageFile || (chosenJob?.imageUrl || null),
      jobLabel: chosenJobLabel || undefined
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInputText('');
    const outgoingImage = imageFile;
    const outgoingJobId = selectedJobId;
    setImageFile(null);
    setImageName('');
    setSelectedJobId('');
    setActionNotice(null);
    setIsSending(true);

    // Collect recent history & previously shown lead IDs for follow-up chat filtering
    const recentHistory = nextMessages.slice(-6).map(m => ({
      role: m.role,
      text: m.text
    }));
    const lastAssistantWithMatches = [...messages]
      .reverse()
      .find(m => m.role === 'assistant' && m.matches && m.matches.length > 0);
    const previousLeadIds = lastAssistantWithMatches?.matches?.map(m => m.id) || [];

    try {
      const response = await fetch('/api/ai-match-leads', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          message: textToSend || undefined,
          jobId: outgoingJobId || undefined,
          image: outgoingImage || undefined,
          history: recentHistory,
          previousLeadIds,
          userRole,
          agentId
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to check leads');
      }

      const data = await response.json();
      const assistantMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        text: data.reply || 'Done! Here is result from your leads.',
        jobTitleForShortlist: data.jobSummary || data.jobDetails?.title || chosenJobLabel || 'AI Match',
        matches: Array.isArray(data.matches) ? data.matches : [],
        scopedCount: typeof data.scopedCount === 'number' ? data.scopedCount : undefined,
        scopeLabel: data.scopeLabel,
        elapsedMs: typeof data.elapsedMs === 'number' ? data.elapsedMs : undefined
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error('AI Matcher Chat error:', err);
      setMessages(prev => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          text: 'Sorry, something went wrong. Please try again in 2 second.',
          isError: true
        }
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleAssignProject = async (lead: Lead, projectTitle: string) => {
    try {
      const isCurrentlyAssigned =
        assignedStatus[lead.id] !== undefined
          ? assignedStatus[lead.id]
          : lead.project === projectTitle;

      const updatedLead: Lead = {
        ...lead,
        project: isCurrentlyAssigned ? '' : projectTitle,
        stage: !isCurrentlyAssigned && lead.stage === 'new' ? 'negotiating' : lead.stage,
        updatedAt: new Date().toISOString()
      };

      const response = await fetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(updatedLead)
      });

      if (!response.ok) {
        throw new Error('Failed to update lead');
      }

      await onUpdateLead(updatedLead);
      setAssignedStatus(prev => ({ ...prev, [lead.id]: !isCurrentlyAssigned }));
    } catch (err) {
      console.error('Error shortlisting candidate:', err);
      setActionNotice('Could not shortlist this candidate right now. Please try again.');
    }
  };

  const handleExportShortlistedCSV = (matches: MatchedLead[], jobTitle: string) => {
    const shortlisted = matches.filter(m =>
      assignedStatus[m.id] !== undefined ? assignedStatus[m.id] : m.project === jobTitle
    );
    const listToExport = shortlisted.length > 0 ? shortlisted : matches;

    const headers = [
      'Serial No',
      'Name',
      'Gender',
      'Age',
      'Phone',
      'Origin',
      'Position',
      'Experience',
      'Match Score',
      'AI Note'
    ];
    const rows = listToExport.map((match, idx) => [
      match.serialNo || `C-${idx + 1}`,
      match.name,
      match.gender,
      match.age,
      `="${match.phone}"`,
      match.origin,
      match.position,
      match.experience,
      `${match.matchScore}%`,
      match.matchReason
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row =>
        row
          .map(val => {
            const s = String(val ?? '');
            return s.includes(',') || s.includes('\n') || s.includes('"')
              ? `"${s.replace(/"/g, '""')}"`
              : s;
          })
          .join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeTitle = (jobTitle || 'ai_matches').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `Matched_Leads_${safeTitle}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const stageLabel = (stage?: string) => {
    switch (stage) {
      case 'new':
        return 'New Inbound';
      case 'in_discussion':
      case 'negotiating':
        return 'In Discussion';
      case 'strong_opportunity':
      case 'strong':
        return 'Strong Opportunity';
      case 'office_visited':
        return 'Office Visited';
      case 'won':
        return 'Won';
      case 'cold_leads':
      case 'cold':
        return 'Cold';
      case 'lost':
        return 'Lost';
      default:
        return stage || 'New';
    }
  };

  return (
    <div
      id="ai-profile-matcher-dashboard"
      className={`flex flex-col flex-1 min-h-[26rem] h-[calc(100vh-8.75rem)] bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden transition-colors ${
        isDragging ? 'border-emerald-500' : ''
      }`}
      onDragOver={e => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={e => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          processImageFile(e.dataTransfer.files[0]);
        }
      }}
    >
      {/* Simple Chat Header */}
      <div className="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>AI Matcher Chat</span>
          </h2>
          <p className="text-xs text-slate-400 truncate mt-0.5">
            {isAdmin
              ? 'Admin mode · Checking all CRM leads'
              : `Coordinator mode · Checking only ${displayName}'s leads`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setMessages([]);
            setImageFile(null);
            setImageName('');
            setSelectedJobId('');
            setActionNotice(null);
          }}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          New Chat
        </button>
      </div>

      {/* Inline Notice Bar */}
      {actionNotice && (
        <div className="px-5 py-2 bg-rose-950/50 border-b border-rose-900/40 text-xs text-rose-300 flex items-center justify-between">
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-rose-300 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Chat Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Friendly Welcome Bubble */}
        <div className="flex justify-start">
          <div className="max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-left">
            <p className="text-sm text-slate-100 leading-relaxed">
              Hi <span className="font-bold text-emerald-400">{displayName}</span>! Tell me what worker you need in simple words — or upload job photo / pick active job below.
              {!isAdmin && (
                <span className="text-slate-300"> I will check only your leads fast.</span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_STARTERS.map(prompt => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isSending}
                  onClick={() => handleSendMessage(prompt)}
                  className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/40 text-xs text-slate-200 transition cursor-pointer disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Conversation Turns */}
        {messages.map(msg => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end">
                <div className="max-w-lg bg-emerald-500/15 border border-emerald-500/30 rounded-2xl px-4 py-3 text-left space-y-2">
                  {msg.jobLabel && (
                    <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                      <Briefcase className="w-3.5 h-3.5 shrink-0" />
                      <span>Job: {msg.jobLabel}</span>
                    </div>
                  )}
                  {msg.imagePreview && (
                    <img
                      src={msg.imagePreview}
                      alt="Uploaded job"
                      referrerPolicy="no-referrer"
                      className="w-40 max-h-48 object-contain rounded-lg border border-slate-700 bg-slate-950"
                    />
                  )}
                  <p className="text-sm text-slate-100 whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            );
          }

          const matches = msg.matches || [];
          const jobTitleForShortlist = msg.jobTitleForShortlist || 'AI Match';
          const listFilter = (listFilterByMsg[msg.id] || '').trim().toLowerCase();
          const hideLost = Boolean(hideLostByMsg[msg.id]);
          const lostCount = matches.filter(m => m.stage === 'lost').length;
          const visibleMatches = matches.filter(m => {
            if (hideLost && m.stage === 'lost') return false;
            if (!listFilter) return true;
            const hay = `${m.name || ''} ${m.origin || ''} ${m.position || ''} ${m.country || ''} ${m.experience || ''} ${m.phone || ''}`.toLowerCase();
            return hay.includes(listFilter);
          });
          const shortlistedCount = matches.filter(m =>
            assignedStatus[m.id] !== undefined ? assignedStatus[m.id] : m.project === jobTitleForShortlist
          ).length;

          return (
            <div key={msg.id} className="space-y-3">
              {/* AI Reply Bubble */}
              <div className="flex justify-start">
                <div className="max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-left space-y-1.5">
                  <p className={`text-sm leading-relaxed ${msg.isError ? 'text-rose-300' : 'text-slate-100'}`}>
                    {msg.text}
                  </p>

                  {!msg.isError && (msg.scopeLabel || msg.elapsedMs !== undefined) && (
                    <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400 tabular-nums pt-1">
                      <div className="flex items-center gap-2">
                        {msg.scopeLabel && <span>{msg.scopeLabel}</span>}
                        {matches.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{matches.length} match found</span>
                          </>
                        )}
                        {msg.elapsedMs !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{(msg.elapsedMs / 1000).toFixed(1)}s</span>
                          </>
                        )}
                      </div>

                      {matches.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleExportShortlistedCSV(visibleMatches.length > 0 ? visibleMatches : matches, jobTitleForShortlist)}
                          className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {shortlistedCount > 0
                            ? `Download CSV (${shortlistedCount} Shortlisted)`
                            : `Download All CSV (${visibleMatches.length})`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Optional compact inline filter bar for large lists (full list always visible by default) */}
              {matches.length > 10 && (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/70 border border-slate-800/80 rounded-xl px-3.5 py-2">
                  <input
                    type="text"
                    value={listFilterByMsg[msg.id] || ''}
                    onChange={e => setListFilterByMsg(prev => ({ ...prev, [msg.id]: e.target.value }))}
                    placeholder={`Filter these ${matches.length} leads by name, place, job, country...`}
                    className="flex-1 min-w-[200px] bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <div className="flex items-center gap-3 text-xs text-slate-400 tabular-nums shrink-0">
                    {lostCount > 0 && (
                      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-slate-300">
                        <input
                          type="checkbox"
                          checked={hideLost}
                          onChange={e => setHideLostByMsg(prev => ({ ...prev, [msg.id]: e.target.checked }))}
                          className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-0"
                        />
                        <span>Hide Lost ({lostCount})</span>
                      </label>
                    )}
                    <span>
                      Showing <strong className="text-slate-200">{visibleMatches.length}</strong> of {matches.length}
                    </span>
                  </div>
                </div>
              )}

              {/* Single-Elevation Candidate Cards Below Chat Bubble */}
              {visibleMatches.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 text-left">
                  {visibleMatches.map((match, idx) => {
                    const isAssigned =
                      assignedStatus[match.id] !== undefined
                        ? assignedStatus[match.id]
                        : match.project === jobTitleForShortlist;

                    const scoreTextClass =
                      match.matchScore >= 85
                        ? 'text-emerald-400'
                        : match.matchScore >= 70
                        ? 'text-sky-400'
                        : 'text-amber-400';

                    return (
                      <div
                        key={`${msg.id}_${match.id}`}
                        className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-3.5 flex flex-col justify-between gap-3 transition-colors"
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h4 className="text-sm font-bold text-slate-100 truncate">
                                {idx + 1}. {match.name}
                              </h4>
                              <div className="text-xs text-slate-400 flex flex-wrap items-center gap-1.5 mt-0.5">
                                <span>{match.gender === 'F' ? 'Female' : match.gender === 'M' ? 'Male' : (match.gender || 'N/A')}</span>
                                {match.age && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="tabular-nums">Age {match.age}</span>
                                  </>
                                )}
                                {match.origin && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="truncate">{match.origin}</span>
                                  </>
                                )}
                              </div>
                            </div>

                            <span className={`text-xs font-bold font-mono tabular-nums shrink-0 ${scoreTextClass}`}>
                              {match.matchScore}%
                            </span>
                          </div>

                          <div className="text-xs text-slate-300 space-y-0.5 pt-1.5 border-t border-slate-800/80">
                            <div className="truncate">
                              <span className="text-slate-500">Work: </span>
                              <span className="font-semibold text-slate-200">{match.position || 'General'}</span>
                              {match.experience ? ` (${match.experience})` : ''}
                            </div>
                            <div className="flex items-center gap-2 text-slate-400 tabular-nums">
                              <Phone className="w-3 h-3 shrink-0 text-slate-500" />
                              <span className="truncate font-mono">{match.phone || 'No phone'}</span>
                              <span aria-hidden="true">·</span>
                              <span className="shrink-0">{stageLabel(match.stage)}</span>
                            </div>
                          </div>

                          <p className="text-xs text-slate-300 leading-snug">
                            {match.matchReason}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                          <button
                            type="button"
                            onClick={() => onSelectLead(match)}
                            className="flex-1 py-2 px-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-200 inline-flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            Open Profile
                          </button>

                          <button
                            type="button"
                            onClick={() => handleAssignProject(match, jobTitleForShortlist)}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer whitespace-nowrap border ${
                              isAssigned
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-rose-500/15 hover:border-rose-500/40 hover:text-rose-300'
                                : 'bg-slate-950 hover:bg-emerald-500 hover:text-zinc-950 border-slate-700 text-slate-200 hover:border-emerald-500'
                            }`}
                          >
                            {isAssigned ? (
                              <>
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Shortlisted
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-3.5 h-3.5" />
                                Shortlist
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Fast Pending Indicator */}
        {isSending && (
          <div className="flex justify-start">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 inline-flex items-center gap-2.5 text-sm text-slate-300">
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
              <span>Checking your leads fast...</span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Bottom Chat Composer */}
      <div className="bg-slate-900 border-t border-slate-800 p-3.5 sm:px-5 space-y-2.5 shrink-0">
        {/* Attached Job Photo or Selected Job Preview */}
        {(imageFile || selectedJobId) && (
          <div className="flex flex-wrap items-center gap-2">
            {imageFile && (
              <div className="inline-flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200">
                <img
                  src={imageFile}
                  alt="Job preview"
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 object-cover rounded"
                />
                <span className="max-w-[160px] truncate">{imageName || 'Job photo ready'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null);
                    setImageName('');
                  }}
                  className="text-slate-400 hover:text-rose-400 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {selectedJobId && (
              <div className="inline-flex items-center gap-2 bg-slate-950 border border-emerald-500/30 rounded-lg px-2.5 py-1.5 text-xs text-emerald-300">
                <Briefcase className="w-3.5 h-3.5 shrink-0" />
                <span className="max-w-[240px] truncate">
                  {jobs.find(j => j.id === selectedJobId)?.serviceCharge ||
                    jobs.find(j => j.id === selectedJobId)?.title ||
                    'Selected Job'}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedJobId('')}
                  className="text-slate-400 hover:text-rose-400 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          {/* Upload Job Photo Button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              if (e.target.files && e.target.files[0]) {
                processImageFile(e.target.files[0]);
              }
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={isSending}
            onClick={() => fileInputRef.current?.click()}
            className="h-10 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-emerald-400 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
            title="Upload job flyer image"
          >
            <ImagePlus className="w-4 h-4" />
            <span className="hidden sm:inline">Job Photo</span>
          </button>

          {/* Compact Active Job Picker */}
          {jobs.length > 0 && (
            <select
              value={selectedJobId}
              disabled={isSending}
              onChange={e => setSelectedJobId(e.target.value)}
              className="h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold text-slate-200 focus:outline-none focus:border-emerald-500 max-w-[190px] truncate cursor-pointer"
              title="Pick from Active Jobs"
            >
              <option value="">Pick Active Job...</option>
              {jobs.map(job => (
                <option key={job.id} value={job.id}>
                  {job.serviceCharge || job.title || 'Active Job'}
                  {job.country ? ` (${job.country})` : ''}
                </option>
              ))}
            </select>
          )}

          {/* Chat Input Box */}
          <input
            type="text"
            value={inputText}
            disabled={isSending}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            onPaste={e => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                  const file = items[i].getAsFile();
                  if (file) {
                    e.preventDefault();
                    processImageFile(file);
                    break;
                  }
                }
              }
            }}
            placeholder="Type what worker you need (e.g. female waiter Kuwait) or paste job photo..."
            className="flex-1 min-w-[200px] h-10 px-4 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />

          {/* Send Button */}
          <button
            type="button"
            disabled={isSending || (!inputText.trim() && !imageFile && !selectedJobId)}
            onClick={() => handleSendMessage()}
            className="h-10 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-zinc-950 text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
