import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  Send,
  RefreshCw,
  X,
  ShieldAlert,
  Zap,
  MessageSquare,
  ArrowRight,
  Activity,
  ChevronRight,
  Wrench,
  Search,
  ExternalLink,
  CheckSquare,
  Square,
  Snowflake,
  UserPlus,
  CheckCheck,
  TrendingUp,
  Copy,
  Check,
  RotateCcw,
  Star,
  ListChecks
} from 'lucide-react';

interface AssistantAlert {
  id: string;
  type: 'urgent' | 'warning' | 'opportunity' | 'info';
  title: string;
  description: string;
  count?: number;
  leadIds?: string[];
  suggestedAction: string;
  actionType?: 'view_leads' | 'reassign' | 'send_template' | 'fix_stale_unread' | 'archive_stagnant';
  bucketKey?:
    | 'unread'
    | 'staleUnread'
    | 'unassigned'
    | 'stagnant'
    | 'interviewReady'
    | 'highPotential'
    | 'waitingFollowUp';
}

interface CoordinatorWorkload {
  id: string;
  username: string;
  name: string;
  activeLeads: number;
  newInbound: number;
  inDiscussion: number;
  stagnantLeads: number;
  wonLeads: number;
  unreadLeads: number;
  status: 'optimal' | 'busy' | 'overloaded' | 'available';
  recommendation: string;
}

interface AssistantLeadItem {
  id: string;
  name: string;
  phone: string;
  country: string;
  project: string;
  position: string;
  stage: string;
  assignedTo: string;
  lastActivityAt: string;
  inactiveDays: number;
  unreadCount: number;
  latestMessageText?: string;
  hasDocs: boolean;
  potentialScore?: number;
  reason?: string;
}

interface AssistantActionStep {
  id: string;
  priority: 'now' | 'next' | 'opportunity';
  title: string;
  detail: string;
  actionLabel: string;
  bucketKey?: BucketKey;
  fixAction?: 'mark_stale_unread_read' | 'archive_stagnant_to_cold' | 'auto_assign_unassigned';
}

interface AssistantBriefing {
  greeting: string;
  headline: string;
  whatToDoNext: AssistantActionStep[];
}

interface HealthBreakdown {
  responseScore: number;
  responseMax: number;
  assignmentScore: number;
  assignmentMax: number;
  velocityScore: number;
  velocityMax: number;
  staleUnreadFlagCount: number;
  stagnant3to7Days: number;
  stagnant7to30Days: number;
  stagnantOver30Days: number;
}

interface AssistantOverview {
  healthScore: number;
  healthBreakdown: HealthBreakdown;
  scopedRole: 'admin' | 'coordinator';
  scopedAgentId: string;
  secondaryMetricMode: 'unassigned' | 'my_new_inbounds';
  totalActiveCandidates: number;
  alerts: AssistantAlert[];
  coordinatorWorkloads: CoordinatorWorkload[];
  availableCoordinators: { username: string; name: string }[];
  pipelineSummary: {
    newInbound: number;
    inDiscussion: number;
    strongOpportunity: number;
    officeVisited: number;
    won: number;
    coldLeads: number;
    lost: number;
  };
  stagnantCount: number;
  unassignedCount: number;
  unreadRepliesCount: number;
  unreadMessagesCount: number;
  staleUnreadCount: number;
  interviewReadyCount: number;
  highPotentialCount?: number;
  waitingFollowUpCount?: number;
  assistantBriefing?: AssistantBriefing;
  drilldowns: {
    unread: AssistantLeadItem[];
    staleUnread: AssistantLeadItem[];
    unassigned: AssistantLeadItem[];
    stagnant: AssistantLeadItem[];
    interviewReady: AssistantLeadItem[];
    highPotential?: AssistantLeadItem[];
    waitingFollowUp?: AssistantLeadItem[];
  };
  aiInsights: string[];
  lastScannedAt: string;
}

interface MessageItem {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestions?: string[];
  referencedLeads?: AssistantLeadItem[];
}

type BucketKey =
  | 'unread'
  | 'staleUnread'
  | 'unassigned'
  | 'stagnant'
  | 'interviewReady'
  | 'highPotential'
  | 'waitingFollowUp';

interface AiSentinelModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: string;
  currentAgentId: string;
  onFilterByStage?: (stage: string) => void;
  onNavigateToWhatsApp?: (leadId?: string) => void;
  onSelectLead?: (leadId: string) => void;
  onDataUpdated?: () => void;
  leadsVersion?: number;
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-bold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

const FormattedAssistantText: React.FC<{ text: string }> = ({ text }) => {
  const lines = String(text || '').split('\n');
  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-slate-200">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) return <div key={idx} className="h-1" />;

        if (line.startsWith('### ') || line.startsWith('## ')) {
          const clean = line.replace(/^#{2,3}\s+/, '');
          return (
            <div key={idx} className="text-xs font-bold uppercase tracking-wider text-cyan-300 pt-1.5">
              {renderInlineMarkdown(clean)}
            </div>
          );
        }

        if (line.startsWith('> ')) {
          return (
            <div
              key={idx}
              className="pl-3 py-1.5 border-l-2 border-cyan-400/70 bg-slate-950/60 rounded-r-lg text-slate-200 italic"
            >
              {renderInlineMarkdown(line.slice(2))}
            </div>
          );
        }

        if (/^(\*|-|•)\s+/.test(line)) {
          const clean = line.replace(/^(\*|-|•)\s+/, '');
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="text-cyan-400 font-bold mt-0.5">•</span>
              <span className="flex-1">{renderInlineMarkdown(clean)}</span>
            </div>
          );
        }

        const numMatch = line.match(/^(\d+\.)\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="text-indigo-400 font-bold min-w-[16px]">{numMatch[1]}</span>
              <span className="flex-1">{renderInlineMarkdown(numMatch[2])}</span>
            </div>
          );
        }

        return <p key={idx}>{renderInlineMarkdown(line)}</p>;
      })}
    </div>
  );
};

export const AiSentinelModal: React.FC<AiSentinelModalProps> = ({
  isOpen,
  onClose,
  userRole,
  currentAgentId,
  onFilterByStage,
  onNavigateToWhatsApp,
  onSelectLead,
  onDataUpdated,
  leadsVersion
}) => {
  const isAdmin = String(userRole || '').trim().toLowerCase() === 'admin';
  const [activeTab, setActiveTab] = useState<'overview' | 'chat'>('overview');
  const [overview, setOverview] = useState<AssistantOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixingAction, setFixingAction] = useState<string | null>(null);
  const [fixFeedback, setFixFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [activeBucket, setActiveBucket] = useState<BucketKey | null>(null);
  const [bucketSearch, setBucketSearch] = useState('');
  const [stagnantAgeFilter, setStagnantAgeFilter] = useState<'all' | '3_7' | '7_30' | 'over_30'>('all');
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [assignTargetCoord, setAssignTargetCoord] = useState<string>('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const buildWelcomeMessage = (): MessageItem => ({
    id: 'm_welcome',
    sender: 'assistant',
    text: `Hi ${isAdmin ? 'Master Admin' : currentAgentId}! 👋\n\nI am your **CGP AI Assistant** powered by Gemini. Ask me anything naturally — I can tell you **what to prioritize right now**, **who is waiting for your reply**, **which candidates have the highest potential**, or **draft WhatsApp messages** for any candidate${isAdmin ? ' across the agency.' : ' assigned to you.'}`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    suggestions: isAdmin
      ? [
          'What should I prioritize first today?',
          'Who is waiting for a reply right now?',
          'Show our highest-potential candidates',
          'Who needs follow-up urgently?',
          'Draft a polite WhatsApp check-in message'
        ]
      : [
          'What should I do first right now?',
          'Who of my candidates are waiting for a reply?',
          'Which of my candidates have the highest potential?',
          'Who is waiting on me for follow-up?',
          'Draft a warm WhatsApp follow-up message'
        ]
  });

  const [chatMessages, setChatMessages] = useState<MessageItem[]>([buildWelcomeMessage()]);
  const [inputText, setInputText] = useState('');
  const [isSendingQuery, setIsSendingQuery] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isSendingQuery, activeTab]);

  const fetchOverview = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        refresh: forceRefresh ? 'true' : 'false',
        role: userRole || 'user',
        agentId: currentAgentId || '',
        _t: String(Date.now())
      });
      const res = await fetch(`/api/ai/assistant?${qs.toString()}`, {
        cache: 'no-store',
        headers: {
          'x-user-role': userRole || 'user',
          'x-agent-id': currentAgentId || '',
          'Cache-Control': 'no-cache'
        }
      });
      if (res.ok) {
        const data: AssistantOverview = await res.json();
        setOverview(data);
      }
    } catch (err) {
      console.error('Failed to fetch AI Assistant overview:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchOverview(true);
    } else {
      setActiveBucket(null);
      setSelectedLeadIds([]);
      setFixFeedback(null);
    }
  }, [isOpen, userRole, currentAgentId]);

  useEffect(() => {
    if (isOpen && leadsVersion !== undefined) {
      fetchOverview(false);
    }
  }, [leadsVersion]);

  const runHealthFix = async (
    action:
      | 'mark_stale_unread_read'
      | 'mark_leads_read'
      | 'archive_stagnant_to_cold'
      | 'touch_stagnant_followup'
      | 'advance_to_strong_opp'
      | 'auto_assign_unassigned',
    payload?: {
      leadIds?: string[];
      minInactiveDays?: number;
      limit?: number;
      targetCoordinator?: string;
    }
  ) => {
    setFixingAction(action);
    setFixFeedback(null);
    try {
      const res = await fetch('/api/ai/assistant/fix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole || 'user',
          'x-agent-id': currentAgentId || ''
        },
        body: JSON.stringify({
          action,
          ...(payload || {})
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to apply fix.');
      }
      if (data.overview) {
        setOverview(data.overview);
      } else {
        await fetchOverview(true);
      }
      setSelectedLeadIds([]);
      setFixFeedback({
        type: data.success ? 'success' : 'error',
        text: data.message || 'CRM health action completed.'
      });
      if (data.fixedCount > 0) {
        onDataUpdated?.();
      }
    } catch (err: any) {
      setFixFeedback({
        type: 'error',
        text: err?.message || 'Failed to execute CRM fix.'
      });
    } finally {
      setFixingAction(null);
    }
  };

  const openBucket = (bucket: BucketKey) => {
    setActiveBucket((prev) => (prev === bucket ? null : bucket));
    setBucketSearch('');
    setSelectedLeadIds([]);
    if (bucket === 'stagnant') {
      setStagnantAgeFilter('all');
    }
  };

  const bucketItems = useMemo(() => {
    if (!overview || !activeBucket) return [];
    let items = overview.drilldowns?.[activeBucket] || [];

    if (activeBucket === 'stagnant') {
      if (stagnantAgeFilter === '3_7') {
        items = items.filter((i) => i.inactiveDays >= 3 && i.inactiveDays < 7);
      } else if (stagnantAgeFilter === '7_30') {
        items = items.filter((i) => i.inactiveDays >= 7 && i.inactiveDays < 30);
      } else if (stagnantAgeFilter === 'over_30') {
        items = items.filter((i) => i.inactiveDays >= 30);
      }
    }

    const q = bucketSearch.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.phone.toLowerCase().includes(q) ||
          i.country.toLowerCase().includes(q) ||
          i.position.toLowerCase().includes(q) ||
          i.assignedTo.toLowerCase().includes(q) ||
          (i.reason && i.reason.toLowerCase().includes(q))
      );
    }
    return items;
  }, [overview, activeBucket, stagnantAgeFilter, bucketSearch]);

  const toggleSelectAll = () => {
    if (bucketItems.length === 0) return;
    if (selectedLeadIds.length === bucketItems.length) {
      setSelectedLeadIds([]);
    } else {
      setSelectedLeadIds(bucketItems.map((i) => i.id));
    }
  };

  const toggleLeadSelection = (id: string) => {
    setSelectedLeadIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSendMessage = async (textToSend?: string) => {
    const q = (textToSend || inputText).trim();
    if (!q || isSendingQuery) return;

    const userMsg: MessageItem = {
      id: `u_${Date.now()}`,
      sender: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const historyPayload = chatMessages.slice(-10).map((m) => ({
      id: m.id,
      role: m.sender,
      text: m.text
    }));

    setChatMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsSendingQuery(true);
    setActiveTab('chat');

    try {
      const res = await fetch('/api/ai/assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole || 'user',
          'x-agent-id': currentAgentId || ''
        },
        body: JSON.stringify({ query: q, history: historyPayload })
      });

      if (res.ok) {
        const data = await res.json();
        const aiMsg: MessageItem = {
          id: `ai_${Date.now()}`,
          sender: 'assistant',
          text: data.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestions: data.suggestions,
          referencedLeads: data.referencedLeads
        };
        setChatMessages((prev) => [...prev, aiMsg]);
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to get response');
      }
    } catch (err: any) {
      const errorMsg: MessageItem = {
        id: `err_${Date.now()}`,
        sender: 'assistant',
        text: `Unable to complete query right now: ${err?.message || 'Please try again in a moment.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setChatMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSendingQuery(false);
    }
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId((cur) => (cur === id ? null : cur)), 1800);
  };

  if (!isOpen) return null;

  const isCoordinatorScope = overview ? overview.scopedRole === 'coordinator' : !isAdmin;
  const healthScore = overview?.healthScore ?? null;
  const healthBadge =
    healthScore === null
      ? { label: 'Scanning', color: 'text-slate-400' }
      : healthScore >= 80
      ? { label: 'Healthy', color: 'text-emerald-400' }
      : healthScore >= 60
      ? { label: 'Fair', color: 'text-amber-400' }
      : { label: 'Needs Action', color: 'text-rose-400' };

  const hasQuickFixes = Boolean(
    overview &&
      (overview.staleUnreadCount > 0 ||
        overview.healthBreakdown.stagnantOver30Days > 0 ||
        overview.unreadRepliesCount > 0 ||
        (!isCoordinatorScope && overview.unassignedCount > 0))
  );

  const bucketMeta: Record<BucketKey, { title: string; subtitle: string }> = {
    unread: {
      title: 'Candidates Waiting for WhatsApp Reply',
      subtitle: 'Real-time pending inbound candidate messages'
    },
    staleUnread: {
      title: 'Stale Unread Flags (Already Replied)',
      subtitle: 'Older inbound messages left marked unread after your team already replied'
    },
    unassigned: {
      title: isCoordinatorScope ? 'My New Inbounds' : 'Unassigned Inbound Leads',
      subtitle: isCoordinatorScope
        ? 'Your newly assigned leads currently in New Inbound'
        : 'Inbound leads waiting for coordinator assignment'
    },
    stagnant: {
      title: 'Stagnant in Discussion (> 3 Days Inactive)',
      subtitle: 'Intaken leads in In Discussion with no recorded activity for over 72 hours'
    },
    interviewReady: {
      title: 'Verified Candidates Ready for Strong Opportunity',
      subtitle: 'Leads in In Discussion with Passport or CV already uploaded'
    },
    highPotential: {
      title: 'High-Potential Candidates',
      subtitle: 'Strongest active prospects based on stage, uploaded documents, fit score & engagement'
    },
    waitingFollowUp: {
      title: 'Candidates Waiting for Follow-Up',
      subtitle: 'Pending replies, New Inbounds awaiting first call, and warm quiet leads (2–14 days)'
    }
  };

  const topWaitingReply = overview?.drilldowns?.unread?.slice(0, 3) || [];
  const topHighPotential = overview?.drilldowns?.highPotential?.slice(0, 3) || [];
  const topWaitingFollowUp = overview?.drilldowns?.waitingFollowUp?.slice(0, 3) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl h-[92vh] bg-slate-900 border border-slate-750 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-800 bg-slate-900/95">
          <div className="flex items-center gap-3">
            <div className="relative w-11 h-11 rounded-full p-0.5 bg-gradient-to-br from-cyan-400 via-indigo-500 to-emerald-400 flex items-center justify-center shadow-md shrink-0">
              <div className="w-full h-full rounded-full bg-white overflow-hidden">
                <img
                  src="/assets/aistudio/image_484c5e18.png"
                  alt="CGP AI Assistant"
                  className="w-full h-full rounded-full object-cover scale-110"
                />
              </div>
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-900"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold tracking-tight text-white">CGP AI Assistant</h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  {isCoordinatorScope ? `Personal Scope: ${currentAgentId}` : 'Agency Live Sync'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Your personal recruitment assistant — daily priorities, high-potential leads, follow-ups & Gemini chat
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
              <button
                onClick={() => setActiveTab('overview')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'overview'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                Assistant Briefing
                {overview && overview.alerts.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-md bg-amber-500 text-slate-950 font-black text-[10px]">
                    {overview.alerts.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'chat'
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Chat (Gemini)
              </button>
            </div>

            <button
              onClick={() => fetchOverview(true)}
              disabled={loading}
              title="Rescan Live Database"
              className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950/40">
          {activeTab === 'overview' ? (
            <div className="space-y-5">
              {/* Executive Personal Assistant Daily Briefing */}
              {overview?.assistantBriefing && (
                <div className="bg-gradient-to-r from-indigo-950/60 via-slate-900 to-cyan-950/40 border border-indigo-500/35 rounded-2xl p-5 space-y-4 shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 max-w-3xl">
                      <div className="flex items-center gap-2 text-cyan-300 text-xs font-bold uppercase tracking-wider">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Daily Assistant Game Plan</span>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-white">
                        {overview.assistantBriefing.greeting}
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                        {overview.assistantBriefing.headline}
                      </p>
                    </div>
                    <button
                      onClick={() => handleSendMessage('What should I prioritize first today and who should I contact next?')}
                      className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-xs font-semibold flex items-center gap-2 shadow-md transition shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Ask Gemini Chat</span>
                    </button>
                  </div>

                  {/* Ordered What To Do Next */}
                  {overview.assistantBriefing.whatToDoNext.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {overview.assistantBriefing.whatToDoNext.map((step, index) => (
                        <div
                          key={step.id}
                          className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span
                              className={`w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5 ${
                                step.priority === 'now'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : step.priority === 'opportunity'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                              }`}
                            >
                              {index + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">{step.title}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{step.detail}</div>
                            </div>
                          </div>

                          {step.fixAction ? (
                            <button
                              disabled={!!fixingAction}
                              onClick={() =>
                                runHealthFix(step.fixAction!, step.fixAction === 'archive_stagnant_to_cold' ? { minInactiveDays: 30 } : undefined)
                              }
                              className="px-2.5 py-1.5 rounded-lg bg-sky-600/25 hover:bg-sky-600/40 border border-sky-500/40 text-sky-200 text-[11px] font-semibold shrink-0 transition"
                            >
                              {step.actionLabel}
                            </button>
                          ) : step.bucketKey ? (
                            <button
                              onClick={() => openBucket(step.bucketKey!)}
                              className="px-2.5 py-1.5 rounded-lg bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 text-[11px] font-semibold shrink-0 transition"
                            >
                              {step.actionLabel}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Three Assistant Spotlights: Waiting for Reply | High Potential | Waiting Follow-Up */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 pt-1">
                    {/* Spotlight 1: Waiting for Reply */}
                    <div className="bg-slate-950/75 border border-emerald-500/25 rounded-xl p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5" />
                            Waiting for Reply ({overview.unreadRepliesCount})
                          </span>
                          <button
                            onClick={() => openBucket('unread')}
                            className="text-[11px] text-emerald-400 hover:underline font-medium"
                          >
                            View all
                          </button>
                        </div>
                        {topWaitingReply.length === 0 ? (
                          <p className="text-[11px] text-slate-400 py-3">
                            All caught up! Nobody is waiting on an unread message.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {topWaitingReply.map((item) => (
                              <div
                                key={item.id}
                                className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-white truncate">{item.name}</div>
                                  <div className="text-[10px] text-slate-400 truncate">
                                    {item.latestMessageText
                                      ? `"${item.latestMessageText}"`
                                      : `${item.country} • ${item.unreadCount} unread`}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {onNavigateToWhatsApp && (
                                    <button
                                      onClick={() => onNavigateToWhatsApp(item.id)}
                                      className="px-2 py-1 rounded bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 text-[10px] font-semibold"
                                    >
                                      Reply
                                    </button>
                                  )}
                                  {onSelectLead && (
                                    <button
                                      onClick={() => onSelectLead(item.id)}
                                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                                      title="Open Candidate"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Spotlight 2: High Potential */}
                    <div className="bg-slate-950/75 border border-indigo-500/25 rounded-xl p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                            <Star className="w-3.5 h-3.5 text-amber-400" />
                            Who Has Potential ({overview.highPotentialCount ?? topHighPotential.length})
                          </span>
                          <button
                            onClick={() => openBucket('highPotential')}
                            className="text-[11px] text-indigo-400 hover:underline font-medium"
                          >
                            View all
                          </button>
                        </div>
                        {topHighPotential.length === 0 ? (
                          <p className="text-[11px] text-slate-400 py-3">
                            Upload Passports/CVs or move warm leads to Strong Opportunity to spotlight top prospects.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {topHighPotential.map((item) => (
                              <div
                                key={item.id}
                                className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-white truncate">
                                    {item.name} <span className="text-[10px] text-slate-400">({item.country})</span>
                                  </div>
                                  <div className="text-[10px] text-indigo-300 truncate">
                                    {item.reason || item.position}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() =>
                                      handleSendMessage(
                                        `What is the best next step and WhatsApp message to send to ${item.name} (${item.country}, ${item.position})?`
                                      )
                                    }
                                    className="px-2 py-1 rounded bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-200 text-[10px] font-semibold"
                                    title="Ask AI Assistant what to send"
                                  >
                                    Draft
                                  </button>
                                  {onSelectLead && (
                                    <button
                                      onClick={() => onSelectLead(item.id)}
                                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                                      title="Open Candidate"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Spotlight 3: Who Is Waiting */}
                    <div className="bg-slate-950/75 border border-amber-500/25 rounded-xl p-3.5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-2.5">
                          <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                            <ListChecks className="w-3.5 h-3.5" />
                            Who Is Waiting ({overview.waitingFollowUpCount ?? topWaitingFollowUp.length})
                          </span>
                          <button
                            onClick={() => openBucket('waitingFollowUp')}
                            className="text-[11px] text-amber-400 hover:underline font-medium"
                          >
                            View all
                          </button>
                        </div>
                        {topWaitingFollowUp.length === 0 ? (
                          <p className="text-[11px] text-slate-400 py-3">
                            No candidates are currently waiting for follow-up.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {topWaitingFollowUp.map((item) => (
                              <div
                                key={item.id}
                                className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-white truncate">{item.name}</div>
                                  <div className="text-[10px] text-amber-300/90 truncate">
                                    {item.reason || `${item.stage} • ${item.inactiveDays}d ago`}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {onNavigateToWhatsApp && (
                                    <button
                                      onClick={() => onNavigateToWhatsApp(item.id)}
                                      className="px-2 py-1 rounded bg-amber-600/20 hover:bg-amber-600/35 text-amber-200 text-[10px] font-semibold"
                                    >
                                      Chat
                                    </button>
                                  )}
                                  {onSelectLead && (
                                    <button
                                      onClick={() => onSelectLead(item.id)}
                                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                                      title="Open Candidate"
                                    >
                                      <ExternalLink className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Top 4 KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* CRM Health Index */}
                <div className="bg-gradient-to-br from-slate-900 to-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] uppercase font-semibold text-slate-400 tracking-wider">
                        CRM Health Index
                      </span>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-3xl font-extrabold text-white">
                          {healthScore !== null ? `${healthScore}%` : '--%'}
                        </span>
                        <span className={`text-xs font-semibold ${healthBadge.color}`}>
                          {healthBadge.label}
                        </span>
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                      <ShieldAlert className="w-5 h-5 text-indigo-400" />
                    </div>
                  </div>
                  {overview?.healthBreakdown && (
                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 grid grid-cols-3 gap-1.5 text-[10px] text-slate-300">
                      <div className="bg-slate-950/50 rounded-lg px-2 py-1">
                        <div className="text-slate-400">Reply</div>
                        <div className="font-bold text-white">
                          {overview.healthBreakdown.responseScore}/{overview.healthBreakdown.responseMax}
                        </div>
                      </div>
                      <div className="bg-slate-950/50 rounded-lg px-2 py-1">
                        <div className="text-slate-400">{isCoordinatorScope ? 'Intake' : 'Assign'}</div>
                        <div className="font-bold text-white">
                          {overview.healthBreakdown.assignmentScore}/{overview.healthBreakdown.assignmentMax}
                        </div>
                      </div>
                      <div className="bg-slate-950/50 rounded-lg px-2 py-1">
                        <div className="text-slate-400">Velocity</div>
                        <div className="font-bold text-white">
                          {overview.healthBreakdown.velocityScore}/{overview.healthBreakdown.velocityMax}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card 2: Unassigned Inbounds (Admin) OR My New Inbounds (Coordinator) */}
                <button
                  type="button"
                  onClick={() => openBucket('unassigned')}
                  className={`text-left bg-slate-900/90 hover:bg-slate-800/80 border rounded-2xl p-4 flex items-center justify-between shadow-sm transition ${
                    activeBucket === 'unassigned' ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-amber-500/30'
                  }`}
                >
                  <div>
                    <span className="text-[11px] uppercase font-semibold text-amber-400/90 tracking-wider flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      {isCoordinatorScope ? 'My New Inbounds' : 'Unassigned Inbounds'}
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-extrabold text-amber-300">
                        {overview?.unassignedCount ?? 0}
                      </span>
                      <span className="text-xs text-amber-400/80">pending</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      {isCoordinatorScope
                        ? 'Your New Inbound leads awaiting first call'
                        : 'Click to inspect & assign leads'}
                    </p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </button>

                {/* Card 3: Stagnant in Discussion */}
                <button
                  type="button"
                  onClick={() => openBucket('stagnant')}
                  className={`text-left bg-slate-900/90 hover:bg-slate-800/80 border rounded-2xl p-4 flex items-center justify-between shadow-sm transition ${
                    activeBucket === 'stagnant' ? 'border-sky-400 ring-1 ring-sky-400/40' : 'border-sky-500/30'
                  }`}
                >
                  <div>
                    <span className="text-[11px] uppercase font-semibold text-sky-400 tracking-wider flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-sky-400" />
                      Stagnant in Discussion
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-extrabold text-sky-300">
                        {overview?.stagnantCount ?? 0}
                      </span>
                      <span className="text-xs text-sky-400/80">
                        of {overview?.pipelineSummary?.inDiscussion ?? 0}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      {overview?.healthBreakdown
                        ? `3-7d: ${overview.healthBreakdown.stagnant3to7Days} • 7-30d: ${overview.healthBreakdown.stagnant7to30Days} • >30d: ${overview.healthBreakdown.stagnantOver30Days}`
                        : '> 3 days without activity'}
                    </p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </button>

                {/* Card 4: Unread Replies */}
                <button
                  type="button"
                  onClick={() => openBucket('unread')}
                  className={`text-left bg-slate-900/90 hover:bg-slate-800/80 border rounded-2xl p-4 flex items-center justify-between shadow-sm transition ${
                    activeBucket === 'unread' ? 'border-emerald-400 ring-1 ring-emerald-400/40' : 'border-emerald-500/30'
                  }`}
                >
                  <div>
                    <span className="text-[11px] uppercase font-semibold text-emerald-400 tracking-wider flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                      Unread Replies
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-extrabold text-emerald-300">
                        {overview?.unreadRepliesCount ?? 0}
                      </span>
                      <span className="text-xs text-emerald-400/80">awaiting reply</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      {overview?.unreadMessagesCount ?? 0} pending msgs
                      {(overview?.staleUnreadCount ?? 0) > 0
                        ? ` • ${overview?.staleUnreadCount} stale flag`
                        : ''}
                    </p>
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </button>
              </div>

              {/* Feedback Toast */}
              {fixFeedback && (
                <div
                  className={`px-4 py-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
                    fixFeedback.type === 'success'
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {fixFeedback.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span>{fixFeedback.text}</span>
                  </div>
                  <button
                    onClick={() => setFixFeedback(null)}
                    className="text-slate-400 hover:text-white ml-4"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* One-Click Improve CRM Health Bar */}
              {hasQuickFixes && overview && (
                <div className="bg-slate-900/95 border border-indigo-500/30 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="p-2 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 shrink-0">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">One-Click CRM Health Fixes</div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Clean up stale flags and aged stagnant queues to raise your real-time CRM Health Index.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {overview.staleUnreadCount > 0 && (
                      <button
                        disabled={!!fixingAction}
                        onClick={() => runHealthFix('mark_stale_unread_read')}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>
                          {fixingAction === 'mark_stale_unread_read'
                            ? 'Clearing...'
                            : `Clear ${overview.staleUnreadCount} Stale Unread`}
                        </span>
                      </button>
                    )}

                    {overview.healthBreakdown.stagnantOver30Days > 0 && (
                      <button
                        disabled={!!fixingAction}
                        onClick={() => runHealthFix('archive_stagnant_to_cold', { minInactiveDays: 30 })}
                        className="px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-sky-300 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                      >
                        <Snowflake className="w-3.5 h-3.5" />
                        <span>
                          {fixingAction === 'archive_stagnant_to_cold'
                            ? 'Moving...'
                            : `Move ${overview.healthBreakdown.stagnantOver30Days} Aged (>30d) to Cold`}
                        </span>
                      </button>
                    )}

                    {!isCoordinatorScope && overview.unassignedCount > 0 && (
                      <button
                        disabled={!!fixingAction}
                        onClick={() => runHealthFix('auto_assign_unassigned', { limit: 25 })}
                        className="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>
                          {fixingAction === 'auto_assign_unassigned'
                            ? 'Assigning...'
                            : `Auto-Assign Next ${Math.min(25, overview.unassignedCount)} Inbound`}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Interactive Bucket Inspection & Bulk Fix Drawer */}
              {activeBucket && overview && (
                <div className="bg-slate-900 border border-indigo-500/40 rounded-2xl p-4 space-y-3 shadow-lg">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{bucketMeta[activeBucket].title}</h4>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300">
                          {bucketItems.length} showing
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{bucketMeta[activeBucket].subtitle}</p>
                    </div>
                    <button
                      onClick={() => setActiveBucket(null)}
                      className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700"
                    >
                      Close List
                    </button>
                  </div>

                  {/* Filters & Bulk Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          value={bucketSearch}
                          onChange={(e) => setBucketSearch(e.target.value)}
                          placeholder="Search name, phone, country..."
                          className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-56"
                        />
                      </div>

                      {activeBucket === 'stagnant' && (
                        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[11px]">
                          {(
                            [
                              ['all', 'All >3d'],
                              ['3_7', '3–7d'],
                              ['7_30', '7–30d'],
                              ['over_30', '>30d']
                            ] as const
                          ).map(([key, label]) => (
                            <button
                              key={key}
                              onClick={() => {
                                setStagnantAgeFilter(key);
                                setSelectedLeadIds([]);
                              }}
                              className={`px-2 py-1 rounded-md font-medium transition ${
                                stagnantAgeFilter === key
                                  ? 'bg-sky-600 text-white'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Bucket Fix Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      {bucketItems.length > 0 && (
                        <button
                          onClick={toggleSelectAll}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
                        >
                          {selectedLeadIds.length === bucketItems.length ? (
                            <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>
                            {selectedLeadIds.length > 0 ? `${selectedLeadIds.length} Selected` : 'Select All'}
                          </span>
                        </button>
                      )}

                      {(activeBucket === 'unread' || activeBucket === 'staleUnread') && (
                        <button
                          disabled={!!fixingAction || bucketItems.length === 0}
                          onClick={() =>
                            runHealthFix(
                              activeBucket === 'staleUnread' ? 'mark_stale_unread_read' : 'mark_leads_read',
                              selectedLeadIds.length > 0 ? { leadIds: selectedLeadIds } : undefined
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {selectedLeadIds.length > 0
                            ? `Mark ${selectedLeadIds.length} Read`
                            : 'Mark All Read'}
                        </button>
                      )}

                      {(activeBucket === 'stagnant' || activeBucket === 'waitingFollowUp') && (
                        <>
                          <button
                            disabled={!!fixingAction || selectedLeadIds.length === 0}
                            onClick={() => runHealthFix('touch_stagnant_followup', { leadIds: selectedLeadIds })}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50"
                          >
                            Log Follow-Up ({selectedLeadIds.length})
                          </button>
                          {activeBucket === 'stagnant' && (
                            <button
                              disabled={!!fixingAction || (selectedLeadIds.length === 0 && bucketItems.length === 0)}
                              onClick={() =>
                                runHealthFix(
                                  'archive_stagnant_to_cold',
                                  selectedLeadIds.length > 0
                                    ? { leadIds: selectedLeadIds }
                                    : { minInactiveDays: 30 }
                                )
                              }
                              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold disabled:opacity-50"
                            >
                              {selectedLeadIds.length > 0
                                ? `Move ${selectedLeadIds.length} to Cold`
                                : 'Archive >30d to Cold'}
                            </button>
                          )}
                        </>
                      )}

                      {(activeBucket === 'interviewReady' || activeBucket === 'highPotential') && (
                        <button
                          disabled={!!fixingAction || selectedLeadIds.length === 0}
                          onClick={() => runHealthFix('advance_to_strong_opp', { leadIds: selectedLeadIds })}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-50"
                        >
                          Promote {selectedLeadIds.length} to Strong Opp
                        </button>
                      )}

                      {activeBucket === 'unassigned' && !isCoordinatorScope && (
                        <div className="flex items-center gap-1.5">
                          <select
                            value={assignTargetCoord}
                            onChange={(e) => setAssignTargetCoord(e.target.value)}
                            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                          >
                            <option value="">Round-Robin Auto-Distribute</option>
                            {overview.availableCoordinators.map((c) => (
                              <option key={c.username} value={c.username}>
                                {c.name} (@{c.username})
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={!!fixingAction || bucketItems.length === 0}
                            onClick={() =>
                              runHealthFix('auto_assign_unassigned', {
                                leadIds: selectedLeadIds.length > 0 ? selectedLeadIds : undefined,
                                limit: selectedLeadIds.length > 0 ? selectedLeadIds.length : 25,
                                targetCoordinator: assignTargetCoord || undefined
                              })
                            }
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-50"
                          >
                            {selectedLeadIds.length > 0
                              ? `Assign ${selectedLeadIds.length}`
                              : `Assign Next ${Math.min(25, bucketItems.length)}`}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Candidates List */}
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/80 border border-slate-800 rounded-xl bg-slate-950/60">
                    {bucketItems.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No candidates match this filter. Great job keeping this queue clean!
                      </div>
                    ) : (
                      bucketItems.map((item) => {
                        const checked = selectedLeadIds.includes(item.id);
                        return (
                          <div
                            key={item.id}
                            className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-900/80 text-xs"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <button
                                onClick={() => toggleLeadSelection(item.id)}
                                className="text-slate-400 hover:text-indigo-400 shrink-0"
                              >
                                {checked ? (
                                  <CheckSquare className="w-4 h-4 text-indigo-400" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-white truncate">{item.name}</span>
                                  <span className="text-slate-400 font-mono text-[11px]">{item.phone}</span>
                                  {item.unreadCount > 0 && (
                                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                                      {item.unreadCount} unread
                                    </span>
                                  )}
                                  {item.hasDocs && (
                                    <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold">
                                      Docs OK
                                    </span>
                                  )}
                                  {item.potentialScore !== undefined && (
                                    <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold">
                                      Potential {item.potentialScore}%
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 truncate mt-0.5">
                                  {item.country} • {item.position} • Stage: {item.stage}
                                  {!isCoordinatorScope && ` • Coord: ${item.assignedTo}`}
                                  {item.reason && ` • ${item.reason}`}
                                  {!item.reason && item.latestMessageText && ` • "${item.latestMessageText}"`}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`text-[11px] font-medium px-2 py-0.5 rounded bg-slate-800 ${
                                  item.inactiveDays >= 30
                                    ? 'text-rose-400'
                                    : item.inactiveDays >= 3
                                    ? 'text-amber-300'
                                    : 'text-slate-300'
                                }`}
                              >
                                {item.inactiveDays}d ago
                              </span>
                              <button
                                onClick={() =>
                                  handleSendMessage(
                                    `Give me a quick strategy and draft a polite WhatsApp message for ${item.name} (${item.country}, ${item.position}, stage: ${item.stage}).`
                                  )
                                }
                                className="px-2 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-300 border border-indigo-500/30 text-[11px]"
                              >
                                Ask AI
                              </button>
                              {onSelectLead && (
                                <button
                                  onClick={() => onSelectLead(item.id)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] flex items-center gap-1"
                                >
                                  <span>Open</span>
                                  <ExternalLink className="w-3 h-3" />
                                </button>
                              )}
                              {onNavigateToWhatsApp && (
                                <button
                                  onClick={() => onNavigateToWhatsApp(item.id)}
                                  className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[11px]"
                                >
                                  Chat
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Priority Actionable Alerts */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    Priority Actionable Alerts ({overview?.alerts?.length || 0})
                  </h3>
                  <span className="text-xs text-slate-400">
                    Computed from real-time database state
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {overview?.alerts && overview.alerts.length > 0 ? (
                    overview.alerts.map((alert) => (
                      <div
                        key={alert.id}
                        className={`p-4 rounded-xl border flex flex-col justify-between transition ${
                          alert.type === 'urgent'
                            ? 'bg-rose-950/20 border-rose-500/30'
                            : alert.type === 'warning'
                            ? 'bg-amber-950/20 border-amber-500/30'
                            : alert.type === 'opportunity'
                            ? 'bg-emerald-950/20 border-emerald-500/30'
                            : 'bg-slate-900 border-slate-750'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-sm text-white">{alert.title}</span>
                            <span
                              className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                                alert.type === 'urgent'
                                  ? 'bg-rose-500/20 text-rose-400'
                                  : alert.type === 'warning'
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : alert.type === 'opportunity'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-sky-500/20 text-sky-400'
                              }`}
                            >
                              {alert.type}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 mt-2 leading-relaxed">{alert.description}</p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs text-indigo-300">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            <span>{alert.suggestedAction}</span>
                          </div>
                          {alert.actionType === 'fix_stale_unread' ? (
                            <button
                              disabled={!!fixingAction}
                              onClick={() => runHealthFix('mark_stale_unread_read')}
                              className="px-2.5 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shrink-0"
                            >
                              Clear Flags
                            </button>
                          ) : alert.bucketKey ? (
                            <button
                              onClick={() => openBucket(alert.bucketKey!)}
                              className="px-2.5 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition shrink-0"
                            >
                              {alert.actionType === 'reassign' ? 'Assign' : 'Inspect & Fix'}
                            </button>
                          ) : (
                            onFilterByStage && (
                              <button
                                onClick={() => {
                                  onFilterByStage('in_discussion');
                                  onClose();
                                }}
                                className="px-2.5 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition shrink-0"
                              >
                                Open Board
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 p-6 bg-slate-900/60 rounded-xl border border-slate-800 text-center">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-white">All Operations Clear</p>
                      <p className="text-xs text-slate-400 mt-1">
                        No critical bottlenecks detected. Pipelines and replies are healthy.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Coordinator Radar / My Workload */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-400" />
                    {isCoordinatorScope
                      ? 'My Pipeline Health & Workload'
                      : 'Team Workload & Capacity Overview'}
                  </h3>
                  <span className="text-xs text-slate-400">
                    {isCoordinatorScope
                      ? 'Strictly scoped to your assigned leads'
                      : 'Real-time lead capacity and In Discussion stagnation (>3d)'}
                  </span>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-850/80 border-b border-slate-750 text-slate-400 uppercase tracking-wider font-semibold">
                        <tr>
                          <th className="py-3 px-4">Coordinator</th>
                          <th className="py-3 px-4">Active Leads</th>
                          <th className="py-3 px-4">In Discussion</th>
                          <th className="py-3 px-4">Stagnant (&gt;3d)</th>
                          <th className="py-3 px-4">Unread</th>
                          <th className="py-3 px-4">Placed (Won)</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">AI Assistant Recommendation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {overview?.coordinatorWorkloads?.map((coord) => (
                          <tr key={coord.id} className="hover:bg-slate-850/40 transition">
                            <td className="py-3 px-4 font-bold text-white flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-300 font-bold flex items-center justify-center text-[10px] uppercase">
                                {coord.name.substring(0, 2)}
                              </div>
                              {coord.name}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-200">{coord.activeLeads}</td>
                            <td className="py-3 px-4 text-sky-400 font-medium">{coord.inDiscussion}</td>
                            <td className="py-3 px-4 font-medium">
                              <span
                                className={
                                  coord.stagnantLeads > 25 ? 'text-rose-400 font-bold' : 'text-slate-300'
                                }
                              >
                                {coord.stagnantLeads}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-emerald-300 font-medium">{coord.unreadLeads}</td>
                            <td className="py-3 px-4 text-emerald-400 font-bold">{coord.wonLeads}</td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                  coord.status === 'overloaded'
                                    ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                    : coord.status === 'busy'
                                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                    : coord.status === 'available'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                                }`}
                              >
                                {coord.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-slate-300 text-[11px] max-w-xs">
                              {coord.recommendation}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Gemini-Style Conversational AI Assistant Chat */
            <div className="flex flex-col h-full">
              {/* Sub-bar with New Chat & Live Sync badge */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>
                    Grounded in your live {isCoordinatorScope ? 'personal' : 'agency'} CRM data (
                    {overview?.totalActiveCandidates ?? '--'} leads)
                  </span>
                </div>
                <button
                  onClick={() => setChatMessages([buildWelcomeMessage()])}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-slate-300 flex items-center gap-1.5 transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>New Chat</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.sender === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-white border border-cyan-400/50 overflow-hidden flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                        <img
                          src="/assets/aistudio/image_484c5e18.png"
                          alt="AI Assistant"
                          className="w-full h-full rounded-full object-cover scale-110"
                        />
                      </div>
                    )}
                    <div
                      className={`max-w-3xl p-4 rounded-2xl space-y-2.5 ${
                        msg.sender === 'user'
                          ? 'bg-indigo-600 text-white rounded-tr-none text-[13px]'
                          : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none shadow-sm'
                      }`}
                    >
                      {msg.sender === 'assistant' ? (
                        <FormattedAssistantText text={msg.text} />
                      ) : (
                        <div className="whitespace-pre-wrap">{msg.text}</div>
                      )}

                      {/* Referenced Candidates Quick Actions */}
                      {msg.referencedLeads && msg.referencedLeads.length > 0 && (
                        <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Quick Open Mentioned Candidates
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.referencedLeads.map((leadItem) => (
                              <div
                                key={leadItem.id}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-700/80 text-[11px]"
                              >
                                <span className="font-semibold text-white">{leadItem.name}</span>
                                <span className="text-slate-400">({leadItem.country})</span>
                                {onSelectLead && (
                                  <button
                                    onClick={() => onSelectLead(leadItem.id)}
                                    className="ml-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[10px] font-semibold"
                                  >
                                    Open
                                  </button>
                                )}
                                {onNavigateToWhatsApp && (
                                  <button
                                    onClick={() => onNavigateToWhatsApp(leadItem.id)}
                                    className="px-1.5 py-0.5 rounded bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-300 text-[10px] font-semibold"
                                  >
                                    WhatsApp
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Follow-up Suggestion Chips */}
                      {msg.suggestions && msg.suggestions.length > 0 && (
                        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-1.5">
                          {msg.suggestions.map((sug, i) => (
                            <button
                              key={i}
                              onClick={() => handleSendMessage(sug)}
                              className="text-[11px] px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-cyan-200 hover:text-white rounded-lg border border-slate-700 transition flex items-center gap-1"
                            >
                              <span>{sug}</span>
                              <ChevronRight className="w-3 h-3 text-slate-500" />
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        {msg.sender === 'assistant' ? (
                          <button
                            onClick={() => handleCopyText(msg.id, msg.text)}
                            className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 transition"
                          >
                            {copiedMsgId === msg.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy reply</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <span />
                        )}
                        <span className="text-[10px] text-slate-400">{msg.timestamp}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {isSendingQuery && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 rounded-full bg-white border border-cyan-400/50 overflow-hidden flex items-center justify-center shrink-0 animate-pulse">
                      <img
                        src="/assets/aistudio/image_484c5e18.png"
                        alt="AI Assistant"
                        className="w-full h-full rounded-full object-cover scale-110"
                      />
                    </div>
                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none text-xs text-cyan-200 flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                      <span>AI Assistant is thinking and checking live CRM records...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="pt-3 mt-2 border-t border-slate-800">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Ask anything — e.g. 'Who is waiting for a reply?', 'Who has potential?', 'Draft a WhatsApp reply for...'"
                    className="flex-1 bg-slate-900 border border-slate-750 rounded-xl px-4 py-3 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim() || isSendingQuery}
                    className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-md"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>CGP AI Assistant • Real-Time Live CRM & Gemini Chat</span>
          </div>
          <div>
            <span>
              Last scanned: {overview ? new Date(overview.lastScannedAt).toLocaleTimeString() : 'Active'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AiAssistantModal = AiSentinelModal;
