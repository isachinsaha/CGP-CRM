import React, { useState, useEffect } from 'react';
import { 
  Bot, 
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
  TrendingUp, 
  ArrowRight,
  Activity,
  UserCheck,
  ChevronRight
} from 'lucide-react';
import type { Lead } from '../types.ts';

interface SentinelAlert {
  id: string;
  type: 'urgent' | 'warning' | 'opportunity' | 'info';
  title: string;
  description: string;
  count?: number;
  leadIds?: string[];
  suggestedAction: string;
  actionType?: 'view_leads' | 'reassign' | 'send_template';
}

interface CoordinatorWorkload {
  id: string;
  name: string;
  activeLeads: number;
  newInbound: number;
  inDiscussion: number;
  stagnantLeads: number;
  wonLeads: number;
  status: 'optimal' | 'busy' | 'overloaded' | 'available';
  recommendation: string;
}

interface SentinelOverview {
  healthScore: number;
  totalActiveCandidates: number;
  alerts: SentinelAlert[];
  coordinatorWorkloads: CoordinatorWorkload[];
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
  aiInsights: string[];
  lastScannedAt: string;
}

interface MessageItem {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestions?: string[];
}

interface AiSentinelModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole: string;
  currentAgentId: string;
  onFilterByStage?: (stage: string) => void;
  onNavigateToWhatsApp?: (leadId?: string) => void;
}

export const AiSentinelModal: React.FC<AiSentinelModalProps> = ({
  isOpen,
  onClose,
  userRole,
  currentAgentId,
  onFilterByStage,
  onNavigateToWhatsApp
}) => {
  const [activeTab, setActiveTab] = useState<'radar' | 'chat'>('radar');
  const [overview, setOverview] = useState<SentinelOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<MessageItem[]>([
    {
      id: 'm_welcome',
      sender: 'assistant',
      text: `Hello ${userRole === 'admin' ? 'Master Admin' : currentAgentId}! 👋\n\nI am your **AI Operations Sentinel & Copilot**. I am monitoring all candidate pipelines, unassigned inbounds, stagnant leads, and coordinator workloads in real time.\n\nHow can I assist you right now?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      suggestions: [
        'What are our operational priorities today?',
        'Show stagnant leads needing follow-up',
        'Coordinator workload balance check',
        'Who are top Kuwait Hospitality candidates?'
      ]
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isSendingQuery, setIsSendingQuery] = useState(false);

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/sentinel');
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
      }
    } catch (err) {
      console.error('Failed to fetch Sentinel overview', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchOverview();
    }
  }, [isOpen]);

  const handleSendMessage = async (textToSend?: string) => {
    const q = (textToSend || inputText).trim();
    if (!q || isSendingQuery) return;

    const userMsg: MessageItem = {
      id: `u_${Date.now()}`,
      sender: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setChatMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsSendingQuery(true);

    try {
      const res = await fetch('/api/ai/copilot/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify({ query: q })
      });

      if (res.ok) {
        const data = await res.json();
        const aiMsg: MessageItem = {
          id: `ai_${Date.now()}`,
          sender: 'assistant',
          text: data.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestions: data.suggestions
        };
        setChatMessages(prev => [...prev, aiMsg]);
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to get response');
      }
    } catch (err: any) {
      const errorMsg: MessageItem = {
        id: `err_${Date.now()}`,
        sender: 'assistant',
        text: `⚠️ **AI Sentinel Alert:** Unable to complete query right now. ${err?.message || 'Please try again in a few seconds.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setChatMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsSendingQuery(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl h-[92vh] bg-slate-900 border border-slate-750 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="relative p-2.5 bg-gradient-to-br from-indigo-500/20 via-sky-500/20 to-emerald-500/20 border border-indigo-500/30 rounded-xl flex items-center justify-center shadow-inner">
              <Bot className="w-6 h-6 text-indigo-400 animate-pulse" />
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border border-slate-900"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  CGP AI Sentinel & Operations Copilot
                </h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  Live Surveillance
                </span>
              </div>
              <p className="text-xs text-slate-400">
                24/7 autonomous monitoring of pipelines, coordinator workloads, bottlenecks & real-time guidance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Tab Pills */}
            <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
              <button
                onClick={() => setActiveTab('radar')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'radar'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                Live Radar & Alerts
                {overview && overview.alerts.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-black text-[10px]">
                    {overview.alerts.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'chat'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Ask Copilot (Gemini)
              </button>
            </div>

            <button
              onClick={fetchOverview}
              disabled={loading}
              title="Refresh Sentinel Scan"
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
          {activeTab === 'radar' ? (
            <div className="space-y-6">
              
              {/* Top Pulse & Health Banner */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Health Index Card */}
                <div className="bg-gradient-to-br from-slate-900 to-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 flex items-center justify-between shadow-sm">
                  <div>
                    <span className="text-xs uppercase font-semibold text-slate-400 tracking-wider">
                      CRM Health Index
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-extrabold text-white">
                        {overview?.healthScore ?? '--'}%
                      </span>
                      <span className="text-xs font-medium text-emerald-400">
                        {overview && overview.healthScore >= 80 ? 'Optimal' : overview && overview.healthScore >= 60 ? 'Moderate' : 'Needs Action'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Based on lead response latency & progression
                    </p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
                    <ShieldAlert className="w-6 h-6 text-indigo-400" />
                  </div>
                </div>

                {/* Unassigned Inbound Leads */}
                <div 
                  onClick={() => {
                    if (onNavigateToWhatsApp) {
                      onNavigateToWhatsApp();
                      onClose();
                    }
                  }}
                  className="cursor-pointer bg-slate-900/90 hover:bg-slate-850 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between shadow-sm transition"
                >
                  <div>
                    <span className="text-xs uppercase font-semibold text-amber-400/90 tracking-wider flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      Unassigned Inbounds
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-extrabold text-amber-300">
                        {overview?.unassignedCount ?? 0}
                      </span>
                      <span className="text-xs text-amber-400/80">pending</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Inquiries awaiting coordinator assignment
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                </div>

                {/* Stagnant In-Discussion Leads */}
                <div 
                  onClick={() => {
                    if (onFilterByStage) {
                      onFilterByStage('in_discussion');
                      onClose();
                    }
                  }}
                  className="cursor-pointer bg-slate-900/90 hover:bg-slate-850 border border-sky-500/30 rounded-2xl p-4 flex items-center justify-between shadow-sm transition"
                >
                  <div>
                    <span className="text-xs uppercase font-semibold text-sky-400 tracking-wider flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-sky-400" />
                      Stagnant in Discussion
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-extrabold text-sky-300">
                        {overview?.stagnantCount ?? 0}
                      </span>
                      <span className="text-xs text-sky-400/80">&gt; 3 days inactive</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Candidates needing re-activation touchpoint
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                </div>

                {/* Awaiting Replies */}
                <div 
                  onClick={() => {
                    if (onNavigateToWhatsApp) {
                      onNavigateToWhatsApp();
                      onClose();
                    }
                  }}
                  className="cursor-pointer bg-slate-900/90 hover:bg-slate-850 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between shadow-sm transition"
                >
                  <div>
                    <span className="text-xs uppercase font-semibold text-emerald-400 tracking-wider flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                      Unread Replies
                    </span>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-3xl font-extrabold text-emerald-300">
                        {overview?.unreadRepliesCount ?? 0}
                      </span>
                      <span className="text-xs text-emerald-400/80">unread</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Incoming candidate replies in WhatsApp
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* Actionable Alerts Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    Priority Actionable Alerts ({overview?.alerts?.length || 0})
                  </h3>
                  <span className="text-xs text-slate-400">
                    Auto-generated from live database telemetry
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {overview?.alerts && overview.alerts.length > 0 ? (
                    overview.alerts.map(alert => (
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
                            <span className="font-semibold text-sm text-white">
                              {alert.title}
                            </span>
                            <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                              alert.type === 'urgent' 
                                ? 'bg-rose-500/20 text-rose-400' 
                                : alert.type === 'warning'
                                ? 'bg-amber-500/20 text-amber-400'
                                : 'bg-emerald-500/20 text-emerald-400'
                            }`}>
                              {alert.type}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                            {alert.description}
                          </p>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs text-indigo-300">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                            <span>{alert.suggestedAction}</span>
                          </div>
                          {alert.actionType === 'reassign' && onNavigateToWhatsApp && (
                            <button
                              onClick={() => {
                                onNavigateToWhatsApp();
                                onClose();
                              }}
                              className="px-2.5 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                            >
                              Intake Leads
                            </button>
                          )}
                          {alert.actionType === 'view_leads' && onFilterByStage && (
                            <button
                              onClick={() => {
                                onFilterByStage('in_discussion');
                                onClose();
                              }}
                              className="px-2.5 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                            >
                              View
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 p-6 bg-slate-900/60 rounded-xl border border-slate-800 text-center">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-white">All Operations Clear</p>
                      <p className="text-xs text-slate-400 mt-1">
                        No critical bottlenecks detected. Pipeline stages and coordinator queues are moving smoothly.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Coordinator Workload & Radar */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-400" />
                    Coordinator Radar & Workload Distribution
                  </h3>
                  <span className="text-xs text-slate-400">
                    Real-time lead capacity and stagnation tracking
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
                          <th className="py-3 px-4">Placed (Won)</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4">AI Sentinel Recommendation</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {overview?.coordinatorWorkloads?.map(coord => (
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
                              <span className={coord.stagnantLeads > 15 ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                                {coord.stagnantLeads}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-emerald-400 font-bold">{coord.wonLeads}</td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                coord.status === 'overloaded'
                                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                  : coord.status === 'busy'
                                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                  : coord.status === 'available'
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}>
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

              {/* AI Strategic Insights */}
              <div className="p-4 bg-gradient-to-r from-indigo-950/30 via-slate-900 to-slate-900 border border-indigo-500/25 rounded-2xl space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  Autonomous Strategic Observations
                </span>
                <div className="space-y-1.5 text-xs text-slate-300">
                  {overview?.aiInsights?.map((insight, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-indigo-400 font-bold">•</span>
                      <span>{insight}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          ) : (
            /* Interactive Chat with Copilot */
            <div className="flex flex-col h-full space-y-4">
              
              {/* Messages Stream */}
              <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                {chatMessages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.sender === 'assistant' && (
                      <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-indigo-400" />
                      </div>
                    )}
                    <div
                      className={`max-w-2xl p-4 rounded-2xl text-xs leading-relaxed space-y-2 ${
                        msg.sender === 'user'
                          ? 'bg-indigo-600 text-white rounded-tr-none'
                          : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none shadow-sm'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                      
                      {/* Suggestion Chips */}
                      {msg.suggestions && msg.suggestions.length > 0 && (
                        <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-1.5 mt-2">
                          {msg.suggestions.map((sug, i) => (
                            <button
                              key={i}
                              onClick={() => handleSendMessage(sug)}
                              className="text-[11px] px-2.5 py-1 bg-slate-800 hover:bg-slate-750 text-indigo-300 hover:text-white rounded-lg border border-slate-700 transition flex items-center gap-1"
                            >
                              <span>{sug}</span>
                              <ChevronRight className="w-3 h-3 text-slate-500" />
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="text-[10px] text-slate-400 text-right mt-1">
                        {msg.timestamp}
                      </div>
                    </div>
                  </div>
                ))}

                {isSendingQuery && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-indigo-400 animate-pulse" />
                    </div>
                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none text-xs text-indigo-300 flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                      <span>AI Sentinel is analyzing CRM data and generating actionable insights...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Input */}
              <div className="pt-3 border-t border-slate-800">
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
                    placeholder="Ask AI Sentinel about candidate pipelines, coordinators, follow-ups, or advice..."
                    className="flex-1 bg-slate-900 border border-slate-750 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim() || isSendingQuery}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-md"
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
            <span>Sentinel Core: Gemini 3.8 Flash • Real-time DB Grounding</span>
          </div>
          <div>
            <span>Last full scan: {overview ? new Date(overview.lastScannedAt).toLocaleTimeString() : 'Active'}</span>
          </div>
        </div>

      </div>
    </div>
  );
};
