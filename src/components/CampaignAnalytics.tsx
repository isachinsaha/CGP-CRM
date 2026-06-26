import React, { useState, useMemo } from 'react';
import { StatSummary, Lead } from '../types.ts';
import { 
  BarChart3, TrendingUp, Target, Percent, Sparkles, 
  UserCheck, Inbox, Calendar, Users, Award, ShieldAlert, Clock, MapPin, CheckCircle,
  CheckSquare2, Square, AlertCircle, ListTodo, User, Bell
} from 'lucide-react';

interface CampaignAnalyticsProps {
  stats: StatSummary;
  leads?: Lead[]; // Optional to prevent compilation issues
  onRefreshData?: () => void;
  userRole?: 'admin' | 'agent';
  currentAgentId?: string;
  onSelectLead?: (lead: Lead) => void;
}

const isAssignedToday = (dateStr?: string) => {
  if (!dateStr) return false;
  const todayStr = new Date().toISOString().split('T')[0];
  if (dateStr === todayStr) return true;
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toDateString() === new Date().toDateString();
    }
  } catch (e) {}
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const today = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = parseInt(parts[0], 10);
    const month = parts[1];
    const year = parseInt(parts[2], 10);
    if (day === today.getDate() && month.toLowerCase() === months[today.getMonth()].toLowerCase() && year === today.getFullYear()) {
      return true;
    }
  }
  return false;
};

export default function CampaignAnalytics({ 
  stats, 
  leads = [], 
  onRefreshData,
  userRole = 'admin',
  currentAgentId,
  onSelectLead
}: CampaignAnalyticsProps) {
  const [reportTab, setReportTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  // Help calculate percentage safely
  const calculatePercent = (value: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  };

  const activeLeads = useMemo(() => {
    if (userRole === 'agent' && currentAgentId) {
      return leads.filter(l => l.assignedTo?.toLowerCase() === currentAgentId.toLowerCase());
    }
    return leads;
  }, [leads, userRole, currentAgentId]);

  const totalLeadsCount = activeLeads.length;

  // Extract all pending follow-up tasks across leads
  const pendingTasks = useMemo(() => {
    const list: Array<{
      leadId: string;
      leadName: string;
      leadPhone: string;
      leadCountry: string;
      leadAssignedTo: string;
      id: string;
      title: string;
      dueDate: string;
      completed: boolean;
      createdAt: string;
    }> = [];

    activeLeads.forEach(lead => {
      if (lead.tasks && Array.isArray(lead.tasks)) {
        lead.tasks.forEach(task => {
          if (!task.completed) {
            list.push({
              leadId: lead.id,
              leadName: lead.name,
              leadPhone: lead.phone,
              leadCountry: lead.country || 'QATAR',
              leadAssignedTo: lead.assignedTo || 'Unassigned',
              ...task
            });
          }
        });
      }
    });

    // Sort by due date (overdue/today/upcoming first)
    return list.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [activeLeads]);

  const handleCompleteTask = async (leadId: string, taskId: string) => {
    const lead = activeLeads.find(l => l.id === leadId);
    if (!lead) return;

    const updatedTasks = (lead.tasks || []).map(task => {
      if (task.id === taskId) {
        return { ...task, completed: true };
      }
      return task;
    });

    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tasks: updatedTasks
        })
      });
      if (res.ok) {
        if (onRefreshData) {
          onRefreshData();
        }
      }
    } catch (err) {
      console.error('Failed to update task state on the dashboard', err);
    }
  };

  // Extract all leads with active reminders
  const reminderLeads = useMemo(() => {
    return activeLeads.filter(l => l.reminderEnabled);
  }, [activeLeads]);

  const handleToggleReminder = async (leadId: string, currentVal?: boolean) => {
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole || 'admin',
          'x-agent-id': currentAgentId || ''
        },
        body: JSON.stringify({ reminderEnabled: !currentVal })
      });
      if (res.ok && onRefreshData) {
        onRefreshData();
      }
    } catch (err) {
      console.error('Failed to toggle reminder on report', err);
    }
  };

  // 1. DAILY REPORT ESTIMATIONS (Leads / Remarks updated today)
  const dailyStats = useMemo(() => {
    const todayStr = new Date().toDateString(); // Or check created/updated matches
    const todayLeads = activeLeads.filter(l => {
      const createdDate = new Date(l.createdAt).toDateString();
      return createdDate === todayStr;
    });

    const activeOutreachCount = activeLeads.filter(l => {
      const updatedDate = new Date(l.updatedAt).toDateString();
      const isOutreach = l.stage !== 'new' && (l.remarks1 || l.remarks2 || l.notes);
      return updatedDate === todayStr && isOutreach;
    }).length;

    const wonToday = activeLeads.filter(l => {
      const updatedDate = new Date(l.updatedAt).toDateString();
      return updatedDate === todayStr && l.stage === 'won';
    }).length;

    // Fetch remarks logged today
    const remarksToday = activeLeads.filter(l => {
      const updatedDate = new Date(l.updatedAt).toDateString();
       return updatedDate === todayStr && (l.remarks1 || l.remarks2 || l.remarks3);
    }).map(l => ({
      id: l.id,
      name: l.name,
      assignedTo: l.assignedTo,
      country: l.country,
      remarks: l.remarks2 || l.remarks1,
      time: new Date(l.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    return {
      createdCount: todayLeads.length,
      todayLeads,
      activeOutreachCount,
      wonToday,
      remarksToday
    };
  }, [activeLeads]);

  // 2. WEEKLY REPORT ESTIMATIONS (Leads created in last 7 days)
  const weeklyStats = useMemo(() => {
    const oneWeekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const weeklyLeads = activeLeads.filter(l => new Date(l.createdAt).getTime() >= oneWeekAgo);

    const countryDistribution: Record<string, number> = {};
    weeklyLeads.forEach(l => {
      const country = l.country?.toUpperCase() || 'QATAR';
      countryDistribution[country] = (countryDistribution[country] || 0) + 1;
    });

    const sortedCountries = Object.entries(countryDistribution).map(([country, count]) => ({
      country,
      count,
      percent: calculatePercent(count, weeklyLeads.length)
    })).sort((a, b) => b.count - a.count);

    return {
      count: weeklyLeads.length,
      wonCount: weeklyLeads.filter(l => l.stage === 'won').length,
      countries: sortedCountries,
    };
  }, [activeLeads]);

  // 3. MONTHLY REPORT ESTIMATIONS & SUB AGENT LEADERBOARD
  const monthlyStats = useMemo(() => {
    const oneMonthAgo = Date.now() - 30 * 24 * 3600 * 1000;
    const monthlyLeads = activeLeads.filter(l => new Date(l.createdAt).getTime() >= oneMonthAgo);

    // List of 10 sub agents
    const coordinators = [
      'Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 
      'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'
    ];

    // Compute stats for each coordinator
    const agentLeaderboard = coordinators.map(name => {
      const agentLeads = activeLeads.filter(l => l.assignedTo === name);
      const total = agentLeads.length;
      const won = agentLeads.filter(l => l.stage === 'won').length;
      const progress = agentLeads.filter(l => ['contacted', 'negotiating', 'proposal'].includes(l.stage)).length;
      const lost = agentLeads.filter(l => l.stage === 'lost').length;
      const assignedToday = agentLeads.filter(l => isAssignedToday(l.assignDate));

      return {
        name,
        total,
        won,
        progress,
        lost,
        assignedToday,
        conversionRate: calculatePercent(won, total)
      };
    }).sort((a, b) => b.won - a.won || b.total - a.total); // Sort by won, then total

    return {
      count: monthlyLeads.length,
      wonCount: monthlyLeads.filter(l => l.stage === 'won').length,
      leaderboard: agentLeaderboard
    };
  }, [activeLeads]);

  return (
    <div className="space-y-6" id="consultancy-reports-dashboard">
      
      {/* Dynamic Upper Cards Bento Row */}
      {userRole === 'admin' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white p-5 rounded-2xl border border-slate-100 flex items-center gap-4 shadow-xs text-left">
            <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
              <Inbox className="h-5 w-5" />
            </div>
            <div>
              <span className="text-slate-400 text-xs font-semibold block">Total Inbound Candidates</span>
              <span className="text-2xl font-black text-slate-800 tracking-tight">{stats.totalLeads}</span>
              <span className="text-[10px] text-emerald-600 font-bold block mt-0.5">{stats.newLeads} new unassigned entries</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-100 flex items-center gap-4 shadow-xs text-left">
            <div className="p-3 bg-blue-50 rounded-xl text-blue-600">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-slate-400 text-xs font-semibold block">Placements Won (Abroad)</span>
              <span className="text-2xl font-black text-slate-800 tracking-tight">{stats.convertedLeads}</span>
              <span className="text-[10px] text-blue-600 font-bold block mt-0.5">{stats.convertedLeads} visas issued successfully</span>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-100 flex items-center gap-4 shadow-xs text-left">
            <div className="p-3 bg-pink-50 rounded-xl text-pink-600">
              <Percent className="h-5 w-5" />
            </div>
            <div>
              <span className="text-slate-400 text-xs font-semibold block">Consultancy Success Ratio</span>
              <span className="text-2xl font-black text-slate-800 tracking-tight">
                {calculatePercent(stats.convertedLeads, stats.totalLeads - stats.lostLeads)}%
              </span>
              <span className="text-[10px] text-pink-600 font-bold block mt-0.5">Won of non-archived candidates</span>
            </div>
          </div>
        </div>
      )}

      {/* CANDIDATES MARKED FOR REMINDER (🔔) */}
      <div className="bg-white rounded-2xl border border-slate-150 p-5 text-left">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4 select-none">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Bell className="h-4.5 w-4.5 text-indigo-600 fill-indigo-100 animate-pulse" />
              Candidates Marked with Reminders
            </h3>
            <p className="text-xs text-slate-400 font-medium font-sans">These files have an active reminder bell enabled for priority tracking and follow-up.</p>
          </div>
          <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-black uppercase border border-indigo-100">
            🔔 {reminderLeads.length} Flagged
          </span>
        </div>

        {reminderLeads.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[300px] overflow-y-auto pr-1">
            {reminderLeads.map((lead) => (
              <div key={lead.id} className="p-3.5 bg-indigo-50/15 rounded-xl border border-indigo-100 flex gap-3 items-start group hover:bg-indigo-50/40 transition-colors">
                <button
                  type="button"
                  onClick={() => handleToggleReminder(lead.id, lead.reminderEnabled)}
                  className="mt-0.5 text-indigo-500 hover:text-slate-400 transition-colors shrink-0 cursor-pointer"
                  title="Click to Turn Off Reminder"
                >
                  <Bell className="h-4.5 w-4.5 text-indigo-600 fill-indigo-600 hover:scale-110 transition-transform animate-bounce" />
                </button>
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1.5">
                    <p 
                      onClick={() => onSelectLead?.(lead)}
                      className="text-xs font-black text-slate-800 leading-tight group-hover:text-indigo-950 transition-colors cursor-pointer hover:underline break-words uppercase"
                    >
                      {lead.name}
                    </p>
                    <span className="text-[9px] bg-indigo-100/70 border border-indigo-200 px-1.5 py-0.2 rounded text-indigo-800 font-mono font-bold uppercase shrink-0">
                      ✈️ {lead.country || 'QATAR'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold">
                      <span className="text-[9px] bg-slate-100 border border-slate-200 px-1 py-0.2 rounded text-slate-600 font-medium capitalize">
                        Stage: {lead.stage}
                      </span>
                      {lead.phone && (
                        <span className="text-slate-400 font-mono text-[9px]">{lead.phone}</span>
                      )}
                    </div>
                    <div className="text-[9px] text-slate-400">
                      Assigned to: <span className="font-extrabold text-emerald-700">{lead.assignedTo || 'Unassigned'}</span>
                    </div>
                    {lead.remarks2 && (
                      <p className="text-[10px] text-slate-650 italic border-l-2 border-indigo-200 pl-2 mt-1 truncate" title={lead.remarks2}>
                        "{lead.remarks2}"
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/20 space-y-1">
            <p className="font-semibold">🔔 No active reminder flags</p>
            <p className="text-[10px]">Toggle the bell icon in the Candidate List spreadsheet to flag urgent files here.</p>
          </div>
        )}
      </div>

      {/* CALLER FOLLOW-UPS & DAILY TO-DO LIST REMINDERS */}
      <div className="bg-white rounded-2xl border border-slate-150 p-5 text-left">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4 select-none">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ListTodo className="h-4.5 w-4.5 text-slate-900" />
              Real-time Follow-up To-Do List & Reminders
            </h3>
            <p className="text-xs text-slate-400 font-medium">Daily interactive action items scheduled for candidates by callers.</p>
          </div>
          <span className="text-[10px] bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-black uppercase">
            ⏳ {pendingTasks.length} Pending
          </span>
        </div>

        {pendingTasks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[300px] overflow-y-auto pr-1">
            {pendingTasks.map((task) => {
              const taskDate = new Date(task.dueDate);
              const today = new Date();
              today.setHours(0,0,0,0);
              const isOverdue = taskDate < today;
              const isToday = taskDate.toDateString() === new Date().toDateString();

              let dateBadgeColor = "bg-slate-50 text-slate-500 border-slate-200";
              let dateBadgeText = task.dueDate;

              if (isOverdue) {
                dateBadgeColor = "bg-rose-50 text-rose-700 border-rose-150 animate-pulse";
                dateBadgeText = `⚠️ Overdue (${task.dueDate})`;
              } else if (isToday) {
                dateBadgeColor = "bg-amber-50 text-amber-700 border-amber-150";
                dateBadgeText = `🔥 Due Today (${task.dueDate})`;
              } else {
                dateBadgeColor = "bg-indigo-50 text-indigo-700 border-indigo-100";
                dateBadgeText = `📅 Upcoming (${task.dueDate})`;
              }

              return (
                <div key={task.id} className="p-3.5 bg-slate-50/50 rounded-xl border border-slate-150 flex gap-3 items-start group hover:bg-slate-50 transition-colors">
                  <button
                    type="button"
                    onClick={() => handleCompleteTask(task.leadId, task.id)}
                    className="mt-0.5 text-slate-400 hover:text-emerald-600 transition-colors shrink-0 cursor-pointer"
                    title="Mark follow-up completed"
                  >
                    <Square className="h-4.5 w-4.5 text-slate-300 hover:text-emerald-500 group-hover:scale-110 transition-transform" />
                  </button>
                  <div className="space-y-2 flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-800 leading-tight group-hover:text-slate-950 transition-colors break-words">
                      {task.title}
                    </p>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-semibold">
                        <User className="h-3 w-3 text-slate-400" />
                        <span className="truncate uppercase font-black text-slate-700">{task.leadName}</span>
                        <span className="text-[9px] bg-slate-200 px-1 py-0.2 rounded text-slate-600 font-mono">
                          ✈️ {task.leadCountry}
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-400">
                        Caller: <span className="font-extrabold text-emerald-700">{task.leadAssignedTo}</span>
                      </div>
                    </div>
                    <span className={`inline-block text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-md border ${dateBadgeColor}`}>
                      {dateBadgeText}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/20 space-y-1.5">
            <p className="font-semibold">🎉 All follow-up tasks completed!</p>
            <p className="text-[10px]">When agents log action items on any candidate profile, they will appear here as daily checklist reminders.</p>
          </div>
        )}
      </div>

      {/* Reports Interval Toggle Navigation */}
      <div className="bg-white rounded-2xl border border-slate-150 p-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-3 mb-4 gap-3">
          <div className="text-left">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="h-4.5 w-4.5 text-emerald-600" />
              Interval Placement Activity Reports
            </h3>
            <p className="text-xs text-slate-400 font-medium">Daily remarks logs, weekly countries distribution, and monthly leadership matrix.</p>
          </div>
          <div className="flex bg-slate-100/80 p-1 rounded-xl">
            {[
              { id: 'daily', label: 'Daily Report' },
              { id: 'weekly', label: 'Weekly Report' },
              { id: 'monthly', label: 'Monthly Report' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setReportTab(tab.id as any)}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  reportTab === tab.id
                    ? 'bg-white text-slate-800 shadow-xs'
                    : 'text-slate-400 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* --- DAILY REPORT CONTENT --- */}
        {reportTab === 'daily' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
            <div className="lg:col-span-4 space-y-4">
              <div className="p-4 bg-emerald-50/20 border border-emerald-100/40 rounded-xl space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Inflow Today</span>
                <span className="text-3xl font-black text-slate-800 block">{dailyStats.createdCount}</span>
                <p className="text-xs text-slate-500">Newly assigned job leads received today.</p>
              </div>

              <div className="p-4 bg-blue-50/25 border border-blue-100/40 rounded-xl space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Telecaller Touches Today</span>
                <span className="text-3xl font-black text-slate-800 block">{dailyStats.activeOutreachCount}</span>
                <p className="text-xs text-slate-500">Calls placed and remark notes updated today.</p>
              </div>

              <div className="p-4 bg-amber-50/20 border border-amber-100/40 rounded-xl space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Placements Finalized Today</span>
                <span className="text-3xl font-black text-slate-800 block">{dailyStats.wonToday}</span>
                <p className="text-xs text-slate-500">Candidates confirmed and visa-cleared today.</p>
              </div>
            </div>

            <div className="lg:col-span-8 border border-slate-100 rounded-xl p-4 bg-slate-50/30">
              <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-3 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-emerald-600" />
                Latest Remarks Logged Today
              </h4>
              {dailyStats.remarksToday.length > 0 ? (
                <div className="space-y-3 max-h-[290px] overflow-y-auto pr-1">
                  {dailyStats.remarksToday.map((item, idx) => (
                    <div key={idx} className="bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex justify-between items-start gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 text-xs">{item.name}</span>
                          <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono font-medium text-slate-500 uppercase">
                            ✈️ {item.country}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 italic">"{item.remarks}"</p>
                        <div className="text-[10px] text-slate-400">
                          Caller: <span className="font-bold text-emerald-700">{item.assignedTo}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">{item.time}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-150 rounded-xl bg-white space-y-1.5">
                  <p>No phone calls or remarks logged today yet.</p>
                  <p className="text-[10px]">Agents can select a lead from Spreadsheet or Pipeline to update remarks.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- WEEKLY REPORT CONTENT --- */}
        {reportTab === 'weekly' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-emerald-50/30 p-5 border border-emerald-100/50 rounded-xl">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Weekly Highlights</h4>
                <div className="space-y-2 mt-4">
                  <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-100/80">
                    <span className="text-xs font-medium text-slate-600">Total Inbounds (Last 7 Days)</span>
                    <span className="font-bold text-slate-800 text-sm">{weeklyStats.count} candidates</span>
                  </div>
                  <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-100/80">
                    <span className="text-xs font-medium text-slate-600">Visas Cleared This Week</span>
                    <span className="font-bold text-emerald-700 text-sm">{weeklyStats.wonCount} candidate(s)</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-150">
                <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest block mb-1">PROMOTION INSIGHTS</span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Meta ad recruitment campaigns for <strong>Qatar Withstand</strong> and <strong>Germany Nursing visa service</strong> showed 40% higher response frequency on weekends.
                </p>
              </div>
            </div>

            <div className="lg:col-span-7 border border-slate-100 rounded-xl p-5 bg-white">
              <h4 className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-4 flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-emerald-600" />
                Abroad Country Demands (Weekly Attributions)
              </h4>
              <div className="space-y-3.5">
                {weeklyStats.countries.length > 0 ? (
                  weeklyStats.countries.map((item, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-700">{item.country} Candidates</span>
                        <span className="font-mono text-slate-500">{item.count} leads ({item.percent}%)</span>
                      </div>
                      <div className="w-full bg-slate-50 h-3 rounded-lg overflow-hidden p-0.5">
                        <div 
                          className="h-full bg-emerald-600 rounded-md" 
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-10 text-center text-xs text-slate-400">No leads captured in the last 7 days.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* --- MONTHLY REPORT & LEADERBOARD CONTENT --- */}
        {reportTab === 'monthly' && (
          <div className="space-y-5 text-left">
            <div className="bg-slate-900 text-white rounded-2xl p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 rounded-full px-2.5 py-0.5 font-bold uppercase tracking-wide">
                  Monthly Performance Ledger
                </span>
                <h4 className="text-lg font-black tracking-tight mt-1">Coordinators Leaderboard (Active Agents)</h4>
                <p className="text-xs text-slate-400">Activity index for Career Growth Placement's 10 sub-agents.</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs text-slate-400 block font-medium">Monthly Successful Placements</span>
                <span className="text-2xl font-black text-emerald-400">{monthlyStats.wonCount} candidates</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-150">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-150 text-left">
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase select-none">Rank</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase select-none">Coordinator Name</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase text-center select-none">Assigned Leads</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase text-left select-none">Assigned Today (Candidates)</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase text-center select-none">Progressing Candidates</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase text-center text-rose-500 select-none">Lost / Unqualified</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-500 uppercase text-center text-emerald-600 select-none">Visa-Cleared (Won)</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-550 uppercase text-right select-none">Conversion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {monthlyStats.leaderboard.map((agent, index) => {
                    const isTop1 = index === 0;
                    return (
                      <tr key={index} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-5 py-3 text-xs font-bold text-slate-800">
                          {isTop1 ? (
                            <span className="flex items-center gap-1 text-amber-500" title="Top Performer">
                              🏆 1
                            </span>
                          ) : (
                            <span># {index + 1}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs font-extrabold text-slate-800">
                          {agent.name}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600 text-center font-mono">
                          {agent.total}
                        </td>
                        <td className="px-5 py-3 text-xs text-left">
                          {agent.assignedToday && agent.assignedToday.length > 0 ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 font-extrabold text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider">
                                📢 {agent.assignedToday.length} Assigned
                              </span>
                              <div className="text-[11px] text-slate-800 font-bold leading-tight">
                                {agent.assignedToday.map((lead: Lead) => lead.name).join(', ')}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-350 font-medium">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-600 text-center font-mono font-medium">
                          {agent.progress}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-400 text-center font-mono">
                          {agent.lost}
                        </td>
                        <td className="px-5 py-3 text-xs text-center font-bold text-emerald-600 font-mono bg-emerald-50/15">
                          {agent.won}
                        </td>
                        <td className="px-5 py-3 text-xs text-right font-extrabold text-slate-700 font-mono">
                          {agent.conversionRate}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Visual Attributions & Pipeline breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Ad Country Demands breakdown */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-150">
          <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2 text-left">
            <BarChart3 className="h-4.5 w-4.5 text-emerald-600" />
            Active Consultancy Target Country Attribution
          </h3>
          <div className="space-y-4">
            {stats.byCampaign && stats.byCampaign.length > 0 ? (
              stats.byCampaign.map((camp, idx) => {
                const maxCount = Math.max(...stats.byCampaign.map(c => c.count), 1);
                const percentLength = Math.round((camp.count / maxCount) * 100);
                return (
                  <div key={idx} className="space-y-1 text-left">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-700 truncate max-w-[280px]">
                        ✈️ {camp.campaign.replace(' Openings', '')} Placement Program
                      </span>
                      <span className="text-slate-500 font-mono font-bold">
                        {camp.count} leads
                      </span>
                    </div>
                    <div className="h-6 w-full bg-slate-50 rounded-lg overflow-hidden flex items-center p-0.5 border border-slate-100">
                      <div
                        style={{ width: `${percentLength}%` }}
                        className="h-full bg-emerald-600 hover:bg-emerald-700 rounded-md transition-all duration-500 flex items-center px-2"
                      >
                        {percentLength > 15 && (
                          <span className="text-[9px] text-white font-black uppercase tracking-wider">
                            {percentLength}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-slate-400 py-10 text-center">No campaign attributions available.</div>
            )}
          </div>
        </div>

        {/* Lead pipeline stage funnel */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-150 text-left">
          <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Target className="h-4.5 w-4.5 text-emerald-600" />
            Candidate Pipeline Funnel Stages
          </h3>
          <div className="space-y-2.5">
            {[
              { label: 'New Lead Inbound', key: 'new', color: 'bg-slate-400 hover:bg-slate-500' },
              { label: 'Initial Contacted', key: 'contacted', color: 'bg-sky-500 hover:bg-sky-600' },
              { label: 'In Negotiation', key: 'negotiating', color: 'bg-amber-500 hover:bg-amber-600' },
              { label: 'Office Visited', key: 'proposal', color: 'bg-purple-500 hover:bg-purple-600' },
              { label: 'Closed Converted', key: 'won', color: 'bg-emerald-600 hover:bg-emerald-700' },
              { label: 'Unqualified / Lost', key: 'lost', color: 'bg-slate-350 hover:bg-slate-400' }
            ].map((funnel, idx) => {
              const count = stats.byStage[funnel.key as any] || 0;
              const maxVal = Math.max(...Object.values(stats.byStage), 1);
              const pct = calculatePercent(count, stats.totalLeads);
              const barWidth = Math.max(10, calculatePercent(count, maxVal));
              return (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-28 text-xs font-semibold text-slate-600 text-right truncate">
                    {funnel.label}
                  </div>
                  <div className="flex-1 h-8 bg-slate-50 rounded-lg flex items-center px-1 overflow-hidden border border-slate-100">
                    <div
                      style={{ width: `${barWidth}%` }}
                      className={`h-6 rounded-md ${funnel.color} transition-all duration-500 flex items-center justify-between px-2 text-white font-mono text-[10px] font-bold`}
                    >
                      <span className="text-white drop-shadow-xs">{count}</span>
                      {pct > 0 && <span className="text-[8px] opacity-80">{pct}%</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
