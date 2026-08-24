import React, { useState, useMemo } from 'react';
import { StatSummary, Lead, Coordinator } from '../types.ts';
import { 
  BarChart3, TrendingUp, Target, Percent, Sparkles, 
  UserCheck, Inbox, Calendar, Users, Award, ShieldAlert, Clock, MapPin, CheckCircle,
  CheckSquare2, Square, AlertCircle, ListTodo, User, Bell, PieChart as PieIcon, AreaChart as AreaIcon,
  ExternalLink
} from 'lucide-react';
import { formatCandidateName } from '../utils';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';

interface CampaignAnalyticsProps {
  stats: StatSummary;
  leads?: Lead[]; // Optional to prevent compilation issues
  onRefreshData?: () => void;
  userRole?: 'admin' | 'agent';
  currentAgentId?: string;
  onSelectLead?: (lead: Lead) => void;
  coordinators?: Coordinator[];
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
  onSelectLead,
  coordinators = []
}: CampaignAnalyticsProps) {
  const [reportTab, setReportTab] = useState<'daily' | 'dpr' | 'weekly' | 'monthly' | 'custom'>('daily');
  const [customStartDate, setCustomStartDate] = useState<string>('2025-01-01');
  const [customEndDate, setCustomEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [selectedCoordFilter, setSelectedCoordFilter] = useState<string>('All');
  const [todoCoordFilter, setTodoCoordFilter] = useState<string>('All');
  const [attributionChartType, setAttributionChartType] = useState<'bar' | 'pie'>('bar');
  const [pipelineChartType, setPipelineChartType] = useState<'funnel' | 'pie'>('funnel');

  const [dprDate, setDprDate] = useState<string>(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [dprCoord, setDprCoord] = useState<string>('All');
  const [dprSubTab, setDprSubTab] = useState<'summary' | 'remarks' | 'bucket_movements' | 'assignments' | 'touches'>('summary');

  const allCoordinatorsNames = useMemo(() => {
    const list = coordinators && coordinators.length > 0
      ? coordinators.filter(c => c.role === 'agent').map(c => c.displayName)
      : [];
    
    leads.forEach(l => {
      if (l.assignedTo && l.assignedTo.trim() !== '' && l.assignedTo.toLowerCase() !== 'unassigned') {
        const found = list.some(name => name.toLowerCase() === l.assignedTo.toLowerCase());
        if (!found) {
          list.push(l.assignedTo);
        }
      }
    });
    
    return Array.from(new Set(list)).sort();
  }, [coordinators, leads]);

  // Selected coordinator display name for filtering
  const selectedCoordinatorName = useMemo(() => {
    if (userRole === 'agent' && currentAgentId) {
      const found = coordinators.find(c => c.username?.toLowerCase() === currentAgentId.toLowerCase() || c.displayName?.toLowerCase() === currentAgentId.toLowerCase());
      return found ? found.displayName : currentAgentId;
    }
    return selectedCoordFilter; // 'All' or a specific coordinator's displayName
  }, [userRole, currentAgentId, selectedCoordFilter, coordinators]);

  // Filter leads based on the selected coordinator filter
  const { campaignAttributionFiltered, pipelineStagesFiltered, filteredLeadsCount } = useMemo(() => {
    // Filter leads for the chosen coordinator (or all active leads if 'All' is selected)
    const filteredLeadsForCharts = selectedCoordinatorName === 'All'
      ? leads
      : selectedCoordinatorName === 'Unassigned'
        ? leads.filter(l => !l.assignedTo || l.assignedTo.trim() === '' || l.assignedTo === 'Unassigned')
        : leads.filter(l => l.assignedTo?.toLowerCase() === selectedCoordinatorName.toLowerCase() || l.assignedTo === selectedCoordinatorName);

    // 1. Compute Pipeline Funnel Stages
    const pipelineStages: Record<string, number> = {
      new: 0,
      in_discussion: 0,
      strong_opportunity: 0,
      office_visited: 0,
      won: 0,
      cold_leads: 0,
      lost: 0
    };

    filteredLeadsForCharts.forEach(l => {
      let stageKey = l.stage;
      if (stageKey === 'negotiating') stageKey = 'in_discussion';
      else if (stageKey === 'proposal') stageKey = 'office_visited';
      else if (stageKey === 'rotations') stageKey = 'cold_leads';

      if (pipelineStages[stageKey] !== undefined) {
        pipelineStages[stageKey]++;
      }
    });

    // 2. Compute Target Country Attribution
    const countryMap: Record<string, { count: number; value: number }> = {};
    filteredLeadsForCharts.forEach(l => {
      const country = l.country || 'OTHER';
      const cleanCountryName = country.toUpperCase().trim();
      if (!cleanCountryName) return;
      if (!countryMap[cleanCountryName]) {
        countryMap[cleanCountryName] = { count: 0, value: 0 };
      }
      countryMap[cleanCountryName].count++;
      if (l.stage !== 'lost') {
        countryMap[cleanCountryName].value += (l.budget || 0);
      }
    });

    const campaignAttribution = Object.entries(countryMap).map(([campaign, data]) => ({
      campaign: `${campaign} Openings`,
      count: data.count,
      value: data.value
    })).sort((a, b) => b.count - a.count);

    return {
      campaignAttributionFiltered: campaignAttribution,
      pipelineStagesFiltered: pipelineStages,
      filteredLeadsCount: filteredLeadsForCharts.length
    };
  }, [leads, selectedCoordinatorName]);

  // Help calculate percentage safely
  const calculatePercent = (value: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  };

  // Helper to calculate the target achievement ratio for a single lead
  const calculateLeadTargetRatio = (lead: Lead): number => {
    if (lead.stage === 'new') return 0;
    if (lead.stage === 'in_discussion' || lead.stage === 'negotiating' || lead.stage === 'cold_leads' || lead.stage === 'rotations') {
      // Stage: In Discussion / Cold Leads. If 3rd remarks is given by telecaller, achievement is 40%, otherwise 15%
      if (lead.remarks3 && lead.remarks3.trim().length > 0) {
        return 40;
      }
      return 15;
    }
    if (lead.stage === 'strong_opportunity') {
      return 50;
    }
    if (lead.stage === 'office_visited' || lead.stage === 'proposal') {
      // Stage: Office Visited/Interview Attended, achievement is 65%
      return 65;
    }
    if (lead.stage === 'won') {
      // Stage: Won, achievement is 100%
      return 100;
    }
    return 0; // Stage: lost or anything else is 0%
  };

  // Helper to calculate the average target achievement ratio for an array of leads
  const calculateAverageTargetRatio = (agentLeads: Lead[]): number => {
    if (agentLeads.length === 0) return 0;
    const sum = agentLeads.reduce((acc, lead) => acc + calculateLeadTargetRatio(lead), 0);
    return Math.round(sum / agentLeads.length);
  };

  const activeLeads = useMemo(() => {
    if (userRole === 'agent' && currentAgentId) {
      return leads.filter(l => l.assignedTo?.toLowerCase() === currentAgentId.toLowerCase());
    }
    return leads;
  }, [leads, userRole, currentAgentId]);

  // Helper check for same-day assignment
  const isAssignedToday = (assignDateStr?: string) => {
    if (!assignDateStr) return false;
    return new Date(assignDateStr).toDateString() === new Date().toDateString();
  };

  // Dynamic Coordinator Interval Stats
  const coordinatorIntervalStats = useMemo(() => {
    const baseCoordinatorsList = coordinators && coordinators.length > 0
      ? coordinators.filter(c => c.role === 'agent').map(c => c.displayName)
      : [
          'Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 
          'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'
        ];
    const coordinatorsList = [...baseCoordinatorsList, 'Unassigned'];

    let intervalLeads = activeLeads;
    if (reportTab === 'daily') {
      const todayStr = new Date().toDateString();
      intervalLeads = activeLeads.filter(l => {
        const createdDate = new Date(l.createdAt).toDateString();
        const updatedDate = new Date(l.updatedAt).toDateString();
        const assignDate = l.assignDate ? new Date(l.assignDate).toDateString() : '';
        return createdDate === todayStr || updatedDate === todayStr || assignDate === todayStr;
      });
    } else if (reportTab === 'weekly') {
      const oneWeekAgo = Date.now() - 7 * 24 * 3600 * 1000;
      intervalLeads = activeLeads.filter(l => {
        const dateToCheck = l.assignDate || l.updatedAt || l.createdAt;
        return new Date(dateToCheck).getTime() >= oneWeekAgo;
      });
    } else if (reportTab === 'monthly') {
      const oneMonthAgo = Date.now() - 30 * 24 * 3600 * 1000;
      intervalLeads = activeLeads.filter(l => {
        const dateToCheck = l.assignDate || l.updatedAt || l.createdAt;
        return new Date(dateToCheck).getTime() >= oneMonthAgo;
      });
    } else if (reportTab === 'custom') {
      const startMs = new Date(customStartDate + 'T00:00:00').getTime();
      const endMs = new Date(customEndDate + 'T23:59:59').getTime();
      intervalLeads = activeLeads.filter(l => {
        const dateToCheck = l.assignDate || l.updatedAt || l.createdAt;
        const ms = new Date(dateToCheck).getTime();
        return !isNaN(ms) && ms >= startMs && ms <= endMs;
      });
    }

    return coordinatorsList.map(name => {
      const agentLeads = name === 'Unassigned'
        ? intervalLeads.filter(l => !l.assignedTo || l.assignedTo.trim() === '' || l.assignedTo === 'Unassigned')
        : intervalLeads.filter(l => l.assignedTo?.toLowerCase() === name.toLowerCase() || l.assignedTo === name);
      const total = agentLeads.length;
      const won = agentLeads.filter(l => l.stage === 'won').length;
      const progress = agentLeads.filter(l => ['in_discussion', 'negotiating', 'strong_opportunity', 'office_visited', 'proposal'].includes(l.stage)).length;
      const lost = agentLeads.filter(l => l.stage === 'lost').length;
      
      const conversionRate = total > 0 ? Math.round((won / total) * 100) : 0;
      const targetAchievementRatio = calculateAverageTargetRatio(agentLeads);

      return {
        name,
        total,
        won,
        progress,
        lost,
        conversionRate,
        targetAchievementRatio
      };
    }).sort((a, b) => b.targetAchievementRatio - a.targetAchievementRatio || b.conversionRate - a.conversionRate || b.won - a.won);
  }, [activeLeads, reportTab, coordinators, customStartDate, customEndDate]);

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
        // Filter by coordinator if selected
        if (todoCoordFilter !== 'All') {
          const matched = todoCoordFilter === 'Unassigned'
            ? (!lead.assignedTo || lead.assignedTo.trim() === '' || lead.assignedTo === 'Unassigned')
            : (lead.assignedTo?.toLowerCase() === todoCoordFilter.toLowerCase() || lead.assignedTo === todoCoordFilter);
          if (!matched) return;
        }
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
  }, [activeLeads, todoCoordFilter]);

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
    let filtered = activeLeads.filter(l => l.reminderEnabled);
    if (todoCoordFilter !== 'All') {
      filtered = filtered.filter(l => todoCoordFilter === 'Unassigned'
        ? (!l.assignedTo || l.assignedTo.trim() === '' || l.assignedTo === 'Unassigned')
        : (l.assignedTo?.toLowerCase() === todoCoordFilter.toLowerCase() || l.assignedTo === todoCoordFilter)
      );
    }
    return filtered;
  }, [activeLeads, todoCoordFilter]);

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
      lead: l,
      name: l.name,
      assignedTo: l.assignedTo,
      country: l.country,
      remarks: l.remarks3 || l.remarks2 || l.remarks1,
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

  // 1b. DPR (DAILY PROGRESS REPORT) ESTIMATIONS
  const dprStats = useMemo(() => {
    const targetDate = dprDate;
    const leadsList = leads || [];
    
    const touchedLeadsSet = new Set<string>();
    const touchedLeadsList: any[] = [];
    
    let remarksCount = 0;
    const remarksList: any[] = [];
    
    let movedCount = 0;
    const movedList: any[] = [];
    
    const bucketMovements: Record<string, { count: number; leads: any[] }> = {
      'New Inbound': { count: 0, leads: [] },
      'In Discussion': { count: 0, leads: [] },
      'Strong Opportunity': { count: 0, leads: [] },
      'Office Visited/Interview Attended': { count: 0, leads: [] },
      'Closed Won': { count: 0, leads: [] },
      'In Rotations': { count: 0, leads: [] },
      'Closed Lost': { count: 0, leads: [] }
    };

    const normalizeBucketName = (name: string) => {
      const lower = name.toLowerCase();
      if (lower.includes('new')) return 'New Inbound';
      if (lower.includes('discussion') || lower.includes('negotiating')) return 'In Discussion';
      if (lower.includes('strong') || lower.includes('opportunity')) return 'Strong Opportunity';
      if (lower.includes('office') || lower.includes('visited') || lower.includes('interview') || lower.includes('proposal')) return 'Office Visited/Interview Attended';
      if (lower.includes('won') || lower.includes('closed won')) return 'Closed Won';
      if (lower.includes('rotation') || lower.includes('cold') || lower.includes('rotations')) return 'In Rotations';
      if (lower.includes('lost') || lower.includes('closed lost')) return 'Closed Lost';
      return name;
    };

    // Map to collect unique assignments for each lead ID
    const uniqueAssignmentsMap = new Map<string, any>();

    leadsList.forEach(l => {
      // 1. Check for initial/registration assignment done on targetDate
      if (l.assignDate === targetDate && l.assignedTo && l.assignedTo.trim() !== '' && l.assignedTo.toLowerCase() !== 'unassigned') {
        const matchesCoord = dprCoord === 'All' || (l.assignedTo || '').toLowerCase() === dprCoord.toLowerCase();
        if (matchesCoord) {
          uniqueAssignmentsMap.set(l.id, {
            id: l.id,
            name: l.name,
            lead: l,
            text: `Newly assigned to coordinator "${l.assignedTo}" by Administrator upon registration.`,
            actor: 'Administrator',
            timestamp: new Date(`${targetDate}T09:00:00`).toISOString()
          });
          touchedLeadsSet.add(l.id);
        }
      }

      if (!l.timeline || !Array.isArray(l.timeline)) return;

      l.timeline.forEach(e => {
        const eventDate = new Date(e.timestamp);
        if (isNaN(eventDate.getTime())) return;
        
        const eventYear = eventDate.getFullYear();
        const eventMonth = String(eventDate.getMonth() + 1).padStart(2, '0');
        const eventDay = String(eventDate.getDate()).padStart(2, '0');
        const eventDateStr = `${eventYear}-${eventMonth}-${eventDay}`;
        
        if (eventDateStr !== targetDate) return;

        const actorLower = (e.actor || '').toLowerCase();
        const coordLower = dprCoord.toLowerCase();
        
        if (dprCoord !== 'All') {
          const matchesActor = actorLower.includes(coordLower);
          const matchesCurrentAssigned = (l.assignedTo || '').toLowerCase() === coordLower;
          if (!matchesActor && !matchesCurrentAssigned) return;
        }

        // Only count assignment events that are performed by Administrator/Admin (or system automated triggers)
        const isAssignmentEvent = e.type === 'assignment' || e.text.toLowerCase().includes('assigned coordinator') || e.text.toLowerCase().includes('coordinator changed');
        if (isAssignmentEvent) {
          const match = e.text.match(/to\s+"([^"]+)"/i) || e.text.match(/to\s+([^"]+)$/i);
          const targetAssignedTo = match ? match[1] : l.assignedTo;

          const matchesCoord = dprCoord === 'All' || (targetAssignedTo || '').toLowerCase() === dprCoord.toLowerCase();
          if (matchesCoord) {
            uniqueAssignmentsMap.set(l.id, {
              id: l.id,
              name: l.name,
              lead: l,
              text: e.text,
              actor: e.actor || 'Administrator',
              timestamp: e.timestamp
            });
          }
          touchedLeadsSet.add(l.id);
        }

        if (e.type === 'remark' || e.type === 'message' || e.text.toLowerCase().includes('remark') || e.text.toLowerCase().includes('call status') || e.text.toLowerCase().includes('whatsapp')) {
          remarksCount++;
          remarksList.push({
            id: l.id,
            name: l.name,
            lead: l,
            text: e.text,
            actor: e.actor || 'System',
            timestamp: e.timestamp
          });
          touchedLeadsSet.add(l.id);
        }

        if (e.type === 'status' || e.text.toLowerCase().includes('pipeline stage changed') || e.text.toLowerCase().includes('pipeline stage auto-moved')) {
          movedCount++;
          const match = e.text.match(/to\s+"([^"]+)"/i) || e.text.match(/to\s+([^"]+)$/i);
          const rawTargetBucket = match ? match[1] : 'Unknown';
          const normalizedBucket = normalizeBucketName(rawTargetBucket);
          
          if (bucketMovements[normalizedBucket]) {
            bucketMovements[normalizedBucket].count++;
            bucketMovements[normalizedBucket].leads.push({
              id: l.id,
              name: l.name,
              lead: l,
              actor: e.actor || 'System',
              text: e.text,
              timestamp: e.timestamp
            });
          }
          
          movedList.push({
            id: l.id,
            name: l.name,
            lead: l,
            text: e.text,
            actor: e.actor || 'System',
            targetBucket: normalizedBucket,
            timestamp: e.timestamp
          });
          touchedLeadsSet.add(l.id);
        }

        touchedLeadsSet.add(l.id);
      });
    });

    const assignedLeadsList = Array.from(uniqueAssignmentsMap.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const assignedCount = assignedLeadsList.length;

    const whatsappAssignedCount = assignedLeadsList.filter(item => {
      const isFromWa = item.lead?.assignedFrom === 'whatsapp_chat_menu' || 
                       (item.text || '').toLowerCase().includes('via whatsapp chat menu') ||
                       (item.text || '').toLowerCase().includes('via whatsapp') ||
                       (item.text || '').toLowerCase().includes('started direct whatsapp') ||
                       (item.lead?.source || '').toLowerCase().includes('whatsapp');
      return isFromWa;
    }).length;

    touchedLeadsSet.forEach(id => {
      const leadObj = leadsList.find(l => l.id === id);
      if (leadObj) {
        const activities = (leadObj.timeline || []).filter(e => {
          const eventDate = new Date(e.timestamp);
          if (isNaN(eventDate.getTime())) return false;
          const eventDateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
          if (eventDateStr !== targetDate) return false;
          
          if (dprCoord !== 'All') {
            const actorLower = (e.actor || '').toLowerCase();
            const coordLower = dprCoord.toLowerCase();
            return actorLower.includes(coordLower) || (leadObj.assignedTo || '').toLowerCase() === coordLower;
          }
          return true;
        });

        touchedLeadsList.push({
          id: leadObj.id,
          name: leadObj.name,
          phone: leadObj.phone,
          country: leadObj.country,
          position: leadObj.position,
          assignedTo: leadObj.assignedTo,
          stage: leadObj.stage,
          activitiesCount: activities.length > 0 ? activities.length : 1,
          activities: activities.length > 0 ? activities : [{
            id: `fallback_${leadObj.id}`,
            type: 'system',
            text: `Lead updated on ${targetDate}`,
            actor: 'System',
            timestamp: new Date(`${targetDate}T12:00:00Z`).toISOString()
          }]
        });
      }
    });

    return {
      assignedCount,
      whatsappAssignedCount,
      assignedLeadsList,
      touchedCount: touchedLeadsSet.size,
      touchedLeadsList,
      remarksCount,
      remarksList: remarksList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
      movedCount,
      movedList: movedList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
      bucketMovements
    };
  }, [leads, dprDate, dprCoord]);

  const dprCoordinatorBreakdown = useMemo(() => {
    const leadsList = leads || [];
    const baseCoordinatorsList = coordinators && coordinators.length > 0
      ? coordinators.filter(c => c.role === 'agent').map(c => c.displayName)
      : [
          'Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 
          'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'
        ];

    return baseCoordinatorsList.map(name => {
      const assignedSet = new Set<string>();
      let remarks = 0;
      let moved = 0;
      const touchedSet = new Set<string>();

      leadsList.forEach(l => {
        if (l.assignDate === dprDate && (l.assignedTo || '').toLowerCase() === name.toLowerCase()) {
          assignedSet.add(l.id);
          touchedSet.add(l.id);
        }

        if (!l.timeline || !Array.isArray(l.timeline)) return;

        l.timeline.forEach(e => {
          const eventDate = new Date(e.timestamp);
          if (isNaN(eventDate.getTime())) return;
          const eventDateStr = `${eventDate.getFullYear()}-${String(eventDate.getMonth() + 1).padStart(2, '0')}-${String(eventDate.getDate()).padStart(2, '0')}`;
          if (eventDateStr !== dprDate) return;

          const actorLower = (e.actor || '').toLowerCase();
          const nameLower = name.toLowerCase();
          const matchesActor = actorLower.includes(nameLower);
          const matchesCurrentAssigned = (l.assignedTo || '').toLowerCase() === nameLower;

          if (matchesActor || matchesCurrentAssigned) {
            touchedSet.add(l.id);
          }

          // Check for assignments to this coordinator on this date
          const isAssignmentEvent = e.type === 'assignment' || e.text.toLowerCase().includes('assigned coordinator') || e.text.toLowerCase().includes('coordinator changed');
          if (isAssignmentEvent) {
            const match = e.text.match(/to\s+"([^"]+)"/i) || e.text.match(/to\s+([^"]+)$/i);
            const targetAssignedTo = match ? match[1] : l.assignedTo;

            if ((targetAssignedTo || '').toLowerCase() === nameLower) {
              assignedSet.add(l.id);
              touchedSet.add(l.id);
            }
          }

          if (matchesActor || (matchesCurrentAssigned && actorLower.includes('system'))) {
            if (e.type === 'remark' || e.type === 'message' || e.text.toLowerCase().includes('remark') || e.text.toLowerCase().includes('call status') || e.text.toLowerCase().includes('whatsapp')) {
              remarks++;
            }
            if (e.type === 'status' || e.text.toLowerCase().includes('pipeline stage changed') || e.text.toLowerCase().includes('pipeline stage auto-moved')) {
              moved++;
            }
          }
        });
      });

      return {
        name,
        assigned: assignedSet.size,
        touched: touchedSet.size,
        remarks,
        moved
      };
    }).sort((a, b) => b.touched - a.touched || b.remarks - a.remarks);
  }, [leads, dprDate, coordinators]);

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

    const activeOutreachCount = activeLeads.filter(l => {
      const updatedDate = new Date(l.updatedAt).getTime();
      const isOutreach = l.stage !== 'new' && (l.remarks1 || l.remarks2 || l.notes);
      return updatedDate >= oneWeekAgo && isOutreach;
    }).length;

    const wonCount = activeLeads.filter(l => {
      const updatedDate = new Date(l.updatedAt).getTime();
      return updatedDate >= oneWeekAgo && l.stage === 'won';
    }).length;

    const remarksWeekly = activeLeads.filter(l => {
      const updatedDate = new Date(l.updatedAt).getTime();
      return updatedDate >= oneWeekAgo && (l.remarks1 || l.remarks2 || l.remarks3);
    }).map(l => ({
      id: l.id,
      lead: l,
      name: l.name,
      assignedTo: l.assignedTo,
      country: l.country,
      remarks: l.remarks3 || l.remarks2 || l.remarks1,
      time: new Date(l.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + new Date(l.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    return {
      count: weeklyLeads.length,
      wonCount,
      countries: sortedCountries,
      activeOutreachCount,
      remarksWeekly
    };
  }, [activeLeads]);

  // 3. MONTHLY REPORT ESTIMATIONS & SUB AGENT LEADERBOARD
  const monthlyStats = useMemo(() => {
    const oneMonthAgo = Date.now() - 30 * 24 * 3600 * 1000;
    const monthlyLeads = activeLeads.filter(l => new Date(l.createdAt).getTime() >= oneMonthAgo);

    // List of sub agents
    const baseCoordinatorsList = coordinators && coordinators.length > 0
      ? coordinators.filter(c => c.role === 'agent').map(c => c.displayName)
      : [
          'Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 
          'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'
        ];
    const coordinatorsList = [...baseCoordinatorsList, 'Unassigned'];

    // Compute stats for each coordinator
    const agentLeaderboard = coordinatorsList.map(name => {
      const agentLeads = name === 'Unassigned'
        ? activeLeads.filter(l => !l.assignedTo || l.assignedTo.trim() === '' || l.assignedTo === 'Unassigned')
        : activeLeads.filter(l => l.assignedTo?.toLowerCase() === name.toLowerCase() || l.assignedTo === name);
      const total = agentLeads.length;
      const won = agentLeads.filter(l => l.stage === 'won').length;
      const progress = agentLeads.filter(l => ['negotiating', 'proposal'].includes(l.stage)).length;
      const lost = agentLeads.filter(l => l.stage === 'lost').length;
      const assignedToday = agentLeads.filter(l => isAssignedToday(l.assignDate));
      const targetAchievementRatio = calculateAverageTargetRatio(agentLeads);

      return {
        name,
        total,
        won,
        progress,
        lost,
        assignedToday,
        conversionRate: calculatePercent(won, total),
        targetAchievementRatio
      };
    }).sort((a, b) => b.targetAchievementRatio - a.targetAchievementRatio || b.won - a.won || b.total - a.total); // Sort primarily by target achievement ratio

    return {
      count: monthlyLeads.length,
      wonCount: monthlyLeads.filter(l => l.stage === 'won').length,
      leaderboard: agentLeaderboard
    };
  }, [activeLeads, coordinators]);
  
  // 4. CUSTOM DATE-WISE REPORT ESTIMATIONS
  const customStats = useMemo(() => {
    const startMs = new Date(customStartDate + 'T00:00:00').getTime();
    const endMs = new Date(customEndDate + 'T23:59:59').getTime();

    // Helper to check if a date is within range
    const isWithinRange = (dateToCheck?: string) => {
      if (!dateToCheck) return false;
      const ms = new Date(dateToCheck).getTime();
      return !isNaN(ms) && ms >= startMs && ms <= endMs;
    };

    const customLeads = activeLeads.filter(l => {
      const date = l.assignDate || l.updatedAt || l.createdAt;
      return isWithinRange(date);
    });

    const customLeadsCreated = activeLeads.filter(l => isWithinRange(l.createdAt));

    const activeOutreachCount = activeLeads.filter(l => {
      const isOutreach = l.stage !== 'new' && (l.remarks1 || l.remarks2 || l.notes);
      return isWithinRange(l.updatedAt) && isOutreach;
    }).length;

    const wonCount = customLeads.filter(l => l.stage === 'won').length;

    // Remarks logged during the period
    const remarksInPeriod = activeLeads.filter(l => {
       return isWithinRange(l.updatedAt) && (l.remarks1 || l.remarks2 || l.remarks3);
    }).map(l => ({
      id: l.id,
      lead: l,
      name: l.name,
      assignedTo: l.assignedTo,
      country: l.country,
      remarks: l.remarks3 || l.remarks2 || l.remarks1,
      date: new Date(l.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
      time: new Date(l.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    // Country distribution
    const countryDistribution: Record<string, number> = {};
    customLeads.forEach(l => {
      const country = l.country?.toUpperCase() || 'QATAR';
      countryDistribution[country] = (countryDistribution[country] || 0) + 1;
    });

    const sortedCountries = Object.entries(countryDistribution).map(([country, count]) => ({
      country,
      count,
      percent: calculatePercent(count, customLeads.length)
    })).sort((a, b) => b.count - a.count);

    // Leaderboard
    const baseCoordinatorsList = coordinators && coordinators.length > 0
      ? coordinators.filter(c => c.role === 'agent').map(c => c.displayName)
      : [
          'Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 
          'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'
        ];
    const coordinatorsList = [...baseCoordinatorsList, 'Unassigned'];

    const agentLeaderboard = coordinatorsList.map(name => {
      const agentLeads = name === 'Unassigned'
        ? customLeads.filter(l => !l.assignedTo || l.assignedTo.trim() === '' || l.assignedTo === 'Unassigned')
        : customLeads.filter(l => l.assignedTo?.toLowerCase() === name.toLowerCase() || l.assignedTo === name);
      const total = agentLeads.length;
      const won = agentLeads.filter(l => l.stage === 'won').length;
      const progress = agentLeads.filter(l => ['in_discussion', 'negotiating', 'strong_opportunity', 'office_visited', 'proposal'].includes(l.stage)).length;
      const lost = agentLeads.filter(l => l.stage === 'lost').length;
      const assignedInPeriod = agentLeads.filter(l => isWithinRange(l.assignDate));
      const targetAchievementRatio = calculateAverageTargetRatio(agentLeads);

      return {
        name,
        total,
        won,
        progress,
        lost,
        assignedInPeriod,
        conversionRate: calculatePercent(won, total),
        targetAchievementRatio
      };
    }).sort((a, b) => b.targetAchievementRatio - a.targetAchievementRatio || b.won - a.won || b.total - a.total);

    return {
      createdCount: customLeadsCreated.length,
      wonCount,
      activeOutreachCount,
      remarksInPeriod,
      countries: sortedCountries,
      leaderboard: agentLeaderboard,
      totalCount: customLeads.length
    };
  }, [activeLeads, customStartDate, customEndDate, coordinators]);

  const renderConversionGraph = () => {
    return (
      <div className="mt-4 p-5 bg-slate-950 rounded-2xl border border-slate-850 text-left">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h4 className="text-xs font-black uppercase text-slate-200 tracking-wider flex items-center gap-1.5 font-display">
              <span className="w-2 h-2 rounded-full bg-accent-purple animate-pulse" />
              Coordinator Conversion & Efficiency Report ({reportTab} view)
            </h4>
            <p className="text-[10px] text-slate-400 font-bold mt-0.5">
              Real-time conversion ratio of won placements vs. total leads handled by each coordinator during this timeframe.
            </p>
          </div>
          <div className="text-[10px] font-bold text-accent-purple bg-purple-950/40 px-2.5 py-1 rounded-lg border border-purple-900/30 shrink-0 self-start sm:self-center uppercase font-mono">
            Target: 70%+ Success Rate
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {coordinatorIntervalStats.slice(0, 10).map((coord) => {
            // Color strategy
            let barColor = 'bg-linear-to-r from-amber-500 to-orange-500';
            let textColor = 'text-amber-400';
            let badgeBg = 'bg-amber-950/40 border-amber-900/30';
            
            if (coord.conversionRate >= 70) {
              barColor = 'bg-linear-to-r from-emerald-400 to-accent-emerald';
              textColor = 'text-accent-emerald';
              badgeBg = 'bg-emerald-950/40 border-emerald-900/30';
            } else if (coord.conversionRate >= 35) {
              barColor = 'bg-linear-to-r from-purple-400 to-accent-purple';
              textColor = 'text-accent-purple';
              badgeBg = 'bg-purple-950/40 border-purple-900/30';
            } else if (coord.total === 0) {
              barColor = 'bg-slate-800';
              textColor = 'text-slate-500';
              badgeBg = 'bg-slate-900 border-slate-800';
            }

            return (
              <div 
                key={coord.name} 
                className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex flex-col justify-between hover:border-slate-700 transition duration-150"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-5 w-5 bg-slate-950 text-slate-300 rounded-md flex items-center justify-center text-[9px] font-black uppercase border border-slate-800">
                      {coord.name.charAt(0)}
                    </span>
                    <span className="text-xs font-black text-slate-200 uppercase tracking-tight font-display">{coord.name}</span>
                  </div>
                  
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-slate-450 font-bold">
                      {coord.won} Won / {coord.total} Total
                    </span>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${badgeBg} ${textColor}`}>
                      {coord.conversionRate}% Ratio
                    </span>
                  </div>
                </div>

                {/* Horizontal Bar Visualizer */}
                <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden relative border border-slate-850">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${coord.total > 0 ? coord.conversionRate : 0}%` }}
                  />
                </div>

                <div className="flex items-center justify-between mt-2 text-[9px] font-bold text-slate-450 uppercase font-mono">
                  <span>Active: {coord.progress}</span>
                  <span>Lost: {coord.lost}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTargetAchievementGraph = () => {
    return (
      <div className="mt-4 p-5 bg-slate-950 rounded-2xl border border-slate-850 text-left">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h4 className="text-xs font-black uppercase text-slate-200 tracking-wider flex items-center gap-1.5 font-display">
              <span className="w-2 h-2 rounded-full bg-accent-emerald animate-pulse" />
              Coordinators Weighted Target Achievement Ratio Report ({reportTab} view)
            </h4>
            <p className="text-[10px] text-slate-400 font-bold mt-0.5">
              Weighted performance metric based on pipeline stages: Inbound (0%), In Discussion + 3rd Remarks (40%), Office Visited/Interview Attended (60%), Closed Won (100%).
            </p>
          </div>
          <div className="text-[10px] font-bold text-accent-emerald bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-900/30 shrink-0 self-start sm:self-center uppercase font-mono">
            Target Achievement Goal: 50%+ Weighted
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {coordinatorIntervalStats.map((coord) => {
            const ratio = coord.targetAchievementRatio || 0;
            // Color strategy
            let barColor = 'bg-linear-to-r from-amber-500 to-orange-500';
            let textColor = 'text-amber-400';
            let badgeBg = 'bg-amber-950/40 border-amber-900/30';
            let grade = 'Needs Improvement ⚠️';
            
            if (ratio >= 80) {
              barColor = 'bg-linear-to-r from-emerald-400 to-accent-emerald';
              textColor = 'text-accent-emerald';
              badgeBg = 'bg-emerald-950/40 border-emerald-900/30';
              grade = 'Outstanding 🏆';
            } else if (ratio >= 50) {
              barColor = 'bg-linear-to-r from-teal-400 to-teal-500';
              textColor = 'text-teal-400';
              badgeBg = 'bg-teal-950/40 border-teal-900/30';
              grade = 'On Track ✨';
            } else if (ratio >= 25) {
              barColor = 'bg-linear-to-r from-purple-400 to-accent-purple';
              textColor = 'text-accent-purple';
              badgeBg = 'bg-purple-950/40 border-purple-900/30';
              grade = 'Nurturing Leads';
            } else if (coord.total === 0) {
              barColor = 'bg-slate-800';
              textColor = 'text-slate-500';
              badgeBg = 'bg-slate-900 border-slate-800';
              grade = 'No Leads Handled';
            }

            return (
              <div 
                key={coord.name} 
                className="p-3.5 bg-slate-900 rounded-xl border border-slate-800 flex flex-col justify-between hover:border-slate-750 transition duration-150"
              >
                <div className="flex items-center justify-between mb-1.5 font-sans">
                  <div className="flex items-center gap-1.5">
                    <span className="h-5 w-5 bg-slate-950 text-slate-300 rounded-md flex items-center justify-center text-[9px] font-black uppercase border border-slate-850">
                      {coord.name.charAt(0)}
                    </span>
                    <span className="text-xs font-black text-slate-200 uppercase tracking-tight font-display">{coord.name}</span>
                  </div>
                  
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-slate-400 font-bold font-mono">
                      {grade}
                    </span>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${badgeBg} ${textColor}`}>
                      {ratio}% Target
                    </span>
                  </div>
                </div>

                {/* Horizontal Bar Visualizer */}
                <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden relative border border-slate-850">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${coord.total > 0 ? ratio : 0}%` }}
                  />
                </div>

                <div className="flex items-center justify-between mt-2 text-[9px] font-bold text-slate-450 uppercase font-mono">
                  <span>Total Leads: {coord.total}</span>
                  <span>Conversion: {coord.conversionRate}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6" id="consultancy-reports-dashboard">
      
      {/* Dynamic Upper Cards Bento Row */}
      {userRole === 'admin' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 flex items-center gap-4 shadow-lg text-left">
            <div className="p-3 bg-slate-950 rounded-xl text-accent-emerald border border-slate-850">
              <Inbox className="h-5 w-5" />
            </div>
            <div>
              <span className="text-slate-450 text-xs font-semibold block">Total Inbound Candidates</span>
              <span className="text-2xl font-black text-slate-100 tracking-tight">{stats.totalLeads}</span>
              <span className="text-[10px] text-accent-emerald font-bold block mt-0.5">{stats.newLeads} new unassigned entries</span>
            </div>
          </div>

          <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 flex items-center gap-4 shadow-lg text-left">
            <div className="p-3 bg-slate-950 rounded-xl text-accent-purple border border-slate-850">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-slate-450 text-xs font-semibold block">Placements Won (Abroad)</span>
              <span className="text-2xl font-black text-slate-100 tracking-tight">{stats.convertedLeads}</span>
              <span className="text-[10px] text-accent-purple font-bold block mt-0.5">{stats.convertedLeads} visas issued successfully</span>
            </div>
          </div>

          <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 flex items-center gap-4 shadow-lg text-left">
            <div className="p-3 bg-slate-950 rounded-xl text-amber-400 border border-slate-850">
              <Percent className="h-5 w-5" />
            </div>
            <div>
              <span className="text-slate-450 text-xs font-semibold block">Consultancy Success Ratio</span>
              <span className="text-2xl font-black text-slate-100 tracking-tight">
                {calculatePercent(stats.convertedLeads, stats.totalLeads - stats.lostLeads)}%
              </span>
              <span className="text-[10px] text-amber-500 font-bold block mt-0.5">Won of non-archived candidates</span>
            </div>
          </div>
        </div>
      )}

      {/* ACTIONABLE FOLLOW-UPS FILTER BAR */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-left shadow-lg select-none">
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-slate-100 flex items-center gap-2 uppercase tracking-wide">
            <Users className="h-4 w-4 text-accent-purple" />
            Actionable Follow-up Filters
          </h3>
          <p className="text-xs text-slate-400 font-medium">
            Filter the priority reminder cards and real-time checklist below by coordinator.
          </p>
        </div>

        {userRole === 'admin' ? (
          <div className="flex items-center gap-2.5 bg-slate-950 border border-slate-800 px-3.5 py-2 rounded-xl w-full sm:w-auto shrink-0 shadow-sm hover:border-slate-700 transition">
            <span className="text-[10px] font-black text-slate-450 uppercase font-mono tracking-wider">Coordinator:</span>
            <select
              value={todoCoordFilter}
              onChange={(e) => setTodoCoordFilter(e.target.value)}
              className="bg-transparent text-xs text-slate-200 font-black outline-none border-0 p-0 cursor-pointer focus:ring-0 uppercase font-display max-w-[200px]"
            >
              <option value="All" className="bg-slate-950 text-slate-200">All Coordinators</option>
              <option value="Unassigned" className="bg-slate-950 text-slate-200">Unassigned Only</option>
              {coordinators.filter(c => c.role === 'agent').map(c => (
                <option key={c.id} value={c.displayName} className="bg-slate-950 text-slate-200">{c.displayName}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-950/40 text-accent-purple text-[10px] font-black uppercase tracking-wider rounded-xl border border-purple-900/30 font-display">
            <span>Coordinator: {userRole === 'agent' && currentAgentId ? (coordinators.find(c => c.username?.toLowerCase() === currentAgentId.toLowerCase() || c.displayName?.toLowerCase() === currentAgentId.toLowerCase())?.displayName || currentAgentId) : 'My Assigned Files'}</span>
          </div>
        )}
      </div>

      {/* CANDIDATES MARKED FOR REMINDER (🔔) */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5 text-left">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4 select-none">
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Bell className="h-4.5 w-4.5 text-rose-500 fill-rose-950/40 animate-pulse" />
              Candidates Marked with Reminders
            </h3>
            <p className="text-xs text-slate-400 font-medium font-sans">These files have an active reminder bell enabled for priority tracking and follow-up.</p>
          </div>
          <span className="text-[10px] bg-rose-950/40 text-rose-400 px-2.5 py-1 rounded-full font-black uppercase border border-rose-900/30">
            🔔 {reminderLeads.length} Flagged
          </span>
        </div>

        {reminderLeads.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 max-h-[300px] overflow-y-auto pr-1">
            {reminderLeads.map((lead) => (
              <div key={lead.id} className="p-2.5 bg-slate-850 rounded-xl border border-slate-750 flex gap-2 items-start group hover:bg-slate-900/50 transition-all shadow-xs">
                <button
                  type="button"
                  onClick={() => handleToggleReminder(lead.id, lead.reminderEnabled)}
                  className="mt-0.5 text-rose-500 hover:text-slate-400 transition-colors shrink-0 cursor-pointer"
                  title="Click to Turn Off Reminder"
                >
                  <Bell className="h-4.5 w-4.5 text-rose-500 fill-rose-500 hover:scale-110 transition-transform animate-bounce" />
                </button>
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1.5">
                    <p 
                      onClick={() => onSelectLead?.(lead)}
                      className="text-xs font-black text-slate-100 leading-tight group-hover:text-accent-purple transition-colors cursor-pointer hover:underline break-words uppercase"
                    >
                      {formatCandidateName(lead.name)}
                    </p>
                    <span className="text-[9px] bg-slate-900 border border-slate-800 px-1.5 py-0.2 rounded text-slate-300 font-mono font-bold uppercase shrink-0">
                      ✈️ {lead.country || 'QATAR'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-semibold">
                      <span className="text-[9px] bg-slate-900 border border-slate-800 px-1 py-0.2 rounded text-slate-300 font-medium capitalize">
                        Stage: {lead.stage}
                      </span>
                      {lead.phone && (
                        <span className="text-slate-400 font-mono text-[9px]">{lead.phone}</span>
                      )}
                    </div>
                    <div className="text-[9px] text-slate-400">
                      Assigned to: <span className="font-extrabold text-accent-emerald">{lead.assignedTo || 'Unassigned'}</span>
                    </div>
                    {lead.remarks2 && (
                      <p className="text-[10px] text-slate-300 italic border-l-2 border-accent-purple pl-2 mt-1 truncate" title={lead.remarks2}>
                        "{lead.remarks2}"
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-750 rounded-xl bg-slate-850/20 space-y-1">
            <p className="font-semibold">🔔 No active reminder flags</p>
            <p className="text-[10px]">Toggle the bell icon in the Candidate List spreadsheet to flag urgent files here.</p>
          </div>
        )}
      </div>

      {/* CALLER FOLLOW-UPS & DAILY TO-DO LIST REMINDERS */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 text-left shadow-2xs">
        <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3 mb-4 select-none">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ListTodo className="h-4.5 w-4.5 text-purple-600 dark:text-accent-purple" />
              Real-time Follow-up To-Do List & Reminders
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Daily interactive action items scheduled for candidates by callers.</p>
          </div>
          <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-full font-black uppercase">
            ⏳ {pendingTasks.length} Pending
          </span>
        </div>

        {pendingTasks.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 max-h-[300px] overflow-y-auto pr-1">
            {pendingTasks.map((task) => {
              const taskDate = new Date(task.dueDate);
              const today = new Date();
              today.setHours(0,0,0,0);
              const isOverdue = taskDate < today;
              const isToday = taskDate.toDateString() === new Date().toDateString();

              let dateBadgeColor = "bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-800";
              let dateBadgeText = task.dueDate;

              if (isOverdue) {
                dateBadgeColor = "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/30 animate-pulse";
                dateBadgeText = `⚠️ Overdue (${task.dueDate})`;
              } else if (isToday) {
                dateBadgeColor = "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-900/30";
                dateBadgeText = `🔥 Due Today (${task.dueDate})`;
              } else {
                dateBadgeColor = "bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-accent-purple border-purple-200 dark:border-purple-900/30";
                dateBadgeText = `📅 Upcoming (${task.dueDate})`;
              }

              return (
                <div key={task.id} className="p-2.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-755 flex gap-2 items-start group hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-all rounded-xl shadow-2xs">
                  <button
                    type="button"
                    onClick={() => handleCompleteTask(task.leadId, task.id)}
                    className="mt-0.5 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-accent-emerald transition-colors shrink-0 cursor-pointer"
                    title="Mark follow-up completed"
                  >
                    <Square className="h-4.5 w-4.5 text-slate-400 dark:text-slate-700 hover:text-emerald-600 dark:hover:text-accent-emerald group-hover:scale-110 transition-transform" />
                  </button>
                  <div className="space-y-2 flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-100 dark:text-slate-100 leading-tight group-hover:text-purple-600 dark:group-hover:text-accent-purple transition-colors break-words">
                      {task.title}
                    </p>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400 font-semibold">
                        <User className="h-3 w-3 text-slate-500 font-bold" />
                        <span 
                          onClick={() => {
                            const foundLead = activeLeads.find(l => l.id === task.leadId);
                            if (foundLead) {
                              onSelectLead?.(foundLead);
                            }
                          }}
                          className="truncate uppercase font-black text-slate-100 dark:text-slate-300 hover:text-purple-600 dark:hover:text-accent-purple hover:underline cursor-pointer transition-colors"
                          title="View Candidate Profile"
                        >
                          {task.leadName}
                        </span>
                        <span className="text-[9px] bg-slate-800 dark:bg-slate-900 border border-slate-700 dark:border-slate-800 px-1 py-0.2 rounded text-slate-100 dark:text-slate-300 font-mono font-bold shrink-0">
                          ✈️ {task.leadCountry}
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-600 dark:text-slate-400">
                        Caller: <span className="font-extrabold text-emerald-700 dark:text-accent-emerald">{task.leadAssignedTo}</span>
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
          <div className="py-12 text-center text-xs text-slate-600 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-750 rounded-xl bg-slate-50 dark:bg-slate-850/20 space-y-1.5">
            <p className="font-semibold text-slate-900 dark:text-slate-300">🎉 All follow-up tasks completed!</p>
            <p className="text-[10px] text-slate-600 dark:text-slate-400">When agents log action items on any candidate profile, they will appear here as daily checklist reminders.</p>
          </div>
        )}
      </div>

      {/* Reports Interval Toggle Navigation */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-3 mb-4 gap-3">
          <div className="text-left">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Calendar className="h-4.5 w-4.5 text-accent-emerald" />
              Interval Placement Activity Reports
            </h3>
            <p className="text-xs text-slate-400 font-medium font-sans">Daily remarks logs, weekly countries distribution, and monthly leadership matrix.</p>
          </div>
          <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 flex-wrap gap-1">
            {[
              { id: 'daily', label: 'Daily Report' },
              { id: 'dpr', label: 'Daily Progress Report (DPR)' },
              { id: 'weekly', label: 'Weekly Report' },
              { id: 'monthly', label: 'Monthly Report' },
              { id: 'custom', label: 'Select Date Wise' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setReportTab(tab.id as any)}
                className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  reportTab === tab.id
                    ? 'bg-slate-800 text-slate-100 shadow-xs'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* --- CUSTOM DATE RANGE PICKER (shows up when 'custom' is active) --- */}
        {reportTab === 'custom' && (
          <div className="mb-6 p-4 bg-slate-950 rounded-xl border border-slate-850 flex flex-col sm:flex-row items-center gap-4 text-left select-none">
            <div>
              <span className="text-[10px] font-black uppercase text-accent-purple tracking-widest block font-mono">Date Range Selector</span>
              <p className="text-[10px] text-slate-450 font-bold mt-0.5">Filter the reports and coordinator charts by a custom date range.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto sm:ml-auto">
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Start:</span>
                <input 
                  type="date" 
                  value={customStartDate} 
                  onChange={(e) => setCustomStartDate(e.target.value)} 
                  className="bg-transparent text-xs text-slate-100 font-bold outline-hidden focus:ring-0 border-0 p-0 cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">End:</span>
                <input 
                  type="date" 
                  value={customEndDate} 
                  onChange={(e) => setCustomEndDate(e.target.value)} 
                  className="bg-transparent text-xs text-slate-100 font-bold outline-hidden focus:ring-0 border-0 p-0 cursor-pointer"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setCustomStartDate('2025-01-01');
                  setCustomEndDate(new Date().toISOString().split('T')[0]);
                }}
                className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase bg-purple-950/40 text-accent-purple border border-purple-900/30 hover:bg-accent-purple hover:text-white transition-all cursor-pointer"
              >
                Reset (2025 - Now)
              </button>
            </div>
          </div>
        )}

        {/* --- DAILY REPORT CONTENT --- */}
        {reportTab === 'daily' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
            <div className="lg:col-span-4 space-y-4">
              <div className="p-4 bg-emerald-950/20 border border-emerald-900/20 rounded-xl space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Inflow Today</span>
                <span className="text-3xl font-black text-slate-100 block">{dailyStats.createdCount}</span>
                <p className="text-xs text-slate-450 font-sans">Newly assigned job leads received today.</p>
              </div>

              <div className="p-4 bg-purple-950/20 border border-purple-900/20 rounded-xl space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Telecaller Touches Today</span>
                <span className="text-3xl font-black text-slate-100 block">{dailyStats.activeOutreachCount}</span>
                <p className="text-xs text-slate-450 font-sans">Calls placed and remark notes updated today.</p>
              </div>

              <div className="p-4 bg-amber-950/20 border border-amber-900/20 rounded-xl space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Placements Finalized Today</span>
                <span className="text-3xl font-black text-slate-100 block">{dailyStats.wonToday}</span>
                <p className="text-xs text-slate-450 font-sans">Candidates confirmed and visa-cleared today.</p>
              </div>
            </div>

            <div className="lg:col-span-8 border border-slate-800 rounded-xl p-4 bg-slate-950/40 space-y-3">
              <div className="bg-slate-900/90 border border-slate-800 px-3 py-2 rounded-xl flex items-center gap-2 shadow-xs">
                <Clock className="h-4 w-4 text-accent-emerald shrink-0" />
                <h4 className="text-xs font-bold uppercase text-slate-200 tracking-wider font-display">
                  Latest Remarks Logged Today
                </h4>
              </div>
              {dailyStats.remarksToday.length > 0 ? (
                <div className="space-y-3 max-h-[290px] overflow-y-auto pr-1">
                  {dailyStats.remarksToday.map((item, idx) => {
                    const targetLead = item.lead || leads.find(l => l.id === item.id);
                    return (
                      <div 
                        key={idx} 
                        onClick={() => {
                          if (targetLead && onSelectLead) {
                            onSelectLead(targetLead);
                          }
                        }}
                        className="bg-slate-900 p-3 rounded-xl border border-slate-800/80 shadow-md flex justify-between items-start gap-4 hover:border-emerald-500/50 hover:bg-slate-850/80 cursor-pointer transition-all group"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-100 text-xs group-hover:text-emerald-400 group-hover:underline flex items-center gap-1 transition-colors">
                              {item.name}
                              <ExternalLink className="w-3 h-3 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </span>
                            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded font-mono font-medium text-slate-350 uppercase border border-slate-750">
                              ✈️ {item.country}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 italic">"{item.remarks}"</p>
                          <div className="text-[10px] text-slate-450">
                            Caller: <span className="font-bold text-accent-emerald">{item.assignedTo}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-450 font-mono shrink-0">{item.time}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-900/10 space-y-1.5">
                  <p>No phone calls or remarks logged today yet.</p>
                  <p className="text-[10px]">Agents can select a lead from Spreadsheet or Pipeline to update remarks.</p>
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {renderConversionGraph()}
            {renderTargetAchievementGraph()}
          </div>
        </div>
      )}

      {/* --- DPR (DAILY PROGRESS REPORT) CONTENT --- */}
      {reportTab === 'dpr' && (
        <div className="space-y-6 text-left">
          {/* Filter and Date bar */}
          <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div>
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-accent-purple animate-pulse" />
                DPR Configuration Engine
              </h4>
              <p className="text-[10px] text-slate-450 font-medium font-sans mt-0.5">Select target date and filter by coordinator to view absolute performance logs.</p>
            </div>
            
            <div className="flex flex-wrap gap-3 items-center w-full md:w-auto">
              {/* Date Picker */}
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
                <Calendar className="h-3.5 w-3.5 text-accent-emerald shrink-0" />
                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">DPR Date:</span>
                <input 
                  type="date" 
                  value={dprDate} 
                  onChange={(e) => setDprDate(e.target.value)} 
                  className="bg-transparent text-xs text-slate-100 font-bold outline-hidden focus:ring-0 border-0 p-0 cursor-pointer"
                />
              </div>

              {/* Coordinator Select */}
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl">
                <User className="h-3.5 w-3.5 text-accent-purple shrink-0" />
                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Agent:</span>
                <select
                  value={dprCoord}
                  onChange={(e) => setDprCoord(e.target.value)}
                  className="bg-slate-900 text-xs text-slate-100 font-bold outline-hidden border-0 p-0 cursor-pointer focus:ring-0"
                >
                  <option value="All">All Coordinators</option>
                  {allCoordinatorsNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* DPR KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Assigned */}
            <div 
              onClick={() => setDprSubTab('assignments')}
              className={`p-4 rounded-xl border transition-all cursor-pointer select-none relative overflow-hidden group ${
                dprSubTab === 'assignments' 
                  ? 'bg-blue-950/20 border-blue-500/50 shadow-md' 
                  : 'bg-slate-950/30 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Leads Assigned</span>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-3xl font-black text-slate-100 block">{dprStats.assignedCount}</span>
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-900/30">
                      {dprStats.whatsappAssignedCount || 0} from WhatsApp Chat
                    </span>
                  </div>
                </div>
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <UserCheck className="h-5 w-5 text-blue-400" />
                </div>
              </div>
              <p className="text-[10px] text-slate-450 mt-2">New/redistributed leads assigned on this date ({dprStats.whatsappAssignedCount || 0} claimed from WhatsApp Chat Menu).</p>
              {dprSubTab === 'assignments' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500" />}
            </div>

            {/* Card 2: Touched */}
            <div 
              onClick={() => setDprSubTab('touches')}
              className={`p-4 rounded-xl border transition-all cursor-pointer select-none relative overflow-hidden group ${
                dprSubTab === 'touches' 
                  ? 'bg-purple-950/20 border-purple-500/50 shadow-md' 
                  : 'bg-slate-950/30 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Leads Touched</span>
                  <span className="text-3xl font-black text-slate-100 block">{dprStats.touchedCount}</span>
                </div>
                <div className="p-2 bg-purple-500/10 rounded-lg">
                  <Users className="h-5 w-5 text-purple-400" />
                </div>
              </div>
              <p className="text-[10px] text-slate-450 mt-2">Unique candidates with any logged activity.</p>
              {dprSubTab === 'touches' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-500" />}
            </div>

            {/* Card 3: Remarks Made */}
            <div 
              onClick={() => setDprSubTab('remarks')}
              className={`p-4 rounded-xl border transition-all cursor-pointer select-none relative overflow-hidden group ${
                dprSubTab === 'remarks' 
                  ? 'bg-emerald-950/20 border-emerald-500/50 shadow-md' 
                  : 'bg-slate-950/30 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Remarks Logged</span>
                  <span className="text-3xl font-black text-slate-100 block">{dprStats.remarksCount}</span>
                </div>
                <div className="p-2 bg-emerald-500/10 rounded-lg">
                  <ListTodo className="h-5 w-5 text-emerald-400" />
                </div>
              </div>
              <p className="text-[10px] text-slate-450 mt-2">Total caller notes & message logs made today.</p>
              {dprSubTab === 'remarks' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500" />}
            </div>

            {/* Card 4: Bucket Movements */}
            <div 
              onClick={() => setDprSubTab('bucket_movements')}
              className={`p-4 rounded-xl border transition-all cursor-pointer select-none relative overflow-hidden group ${
                dprSubTab === 'bucket_movements' 
                  ? 'bg-amber-950/20 border-amber-500/50 shadow-md' 
                  : 'bg-slate-950/30 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Bucket Movements</span>
                  <span className="text-3xl font-black text-slate-100 block">{dprStats.movedCount}</span>
                </div>
                <div className="p-2 bg-amber-500/10 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-amber-400" />
                </div>
              </div>
              <p className="text-[10px] text-slate-450 mt-2">Leads transitioned to a different pipeline stage.</p>
              {dprSubTab === 'bucket_movements' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-amber-500" />}
            </div>
          </div>

          {/* Internal DPR Tab selectors */}
          <div className="flex border-b border-slate-850 gap-2 pb-px overflow-x-auto pb-1">
            {[
              { id: 'summary', label: '📊 Overview & Staff' },
              { id: 'remarks', label: `💬 Remarks Logged (${dprStats.remarksCount})` },
              { id: 'bucket_movements', label: `🔄 Stage Transitions (${dprStats.movedCount})` },
              { id: 'assignments', label: `👤 Assignments (${dprStats.assignedCount})` },
              { id: 'touches', label: `🎯 Touched Candidates (${dprStats.touchedCount})` }
            ].map(sub => (
              <button
                key={sub.id}
                onClick={() => setDprSubTab(sub.id as any)}
                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all shrink-0 cursor-pointer ${
                  dprSubTab === sub.id
                    ? 'border-accent-purple text-slate-100'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>

          {/* --- SUB-TAB CONTENT 1: OVERVIEW & STAFF --- */}
          {dprSubTab === 'summary' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Bucket movements summary */}
                <div className="lg:col-span-5 bg-slate-950/40 rounded-xl border border-slate-800 p-4 space-y-4">
                  <div>
                    <h5 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-accent-purple" />
                      Leads Moved to Buckets
                    </h5>
                    <p className="text-[10px] text-slate-450">Summary of target stage transitions on {dprDate}.</p>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    {Object.entries(dprStats.bucketMovements).map(([bucket, item]) => {
                      let dotColor = 'bg-slate-450';
                      if (bucket === 'New Inbound') dotColor = 'bg-blue-400';
                      else if (bucket === 'In Discussion') dotColor = 'bg-purple-400';
                      else if (bucket === 'Strong Opportunity') dotColor = 'bg-indigo-400';
                      else if (bucket === 'Office Visited/Interview Attended') dotColor = 'bg-amber-400';
                      else if (bucket === 'Closed Won') dotColor = 'bg-emerald-400';
                      else if (bucket === 'In Rotations') dotColor = 'bg-pink-400';
                      else if (bucket === 'Closed Lost') dotColor = 'bg-rose-400';

                      return (
                        <div 
                          key={bucket} 
                          className={`p-3 rounded-lg border flex justify-between items-center bg-slate-900/60 ${
                            item.count > 0 ? 'border-slate-700/80' : 'border-slate-800/40 opacity-70'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                            <span className="text-xs font-bold text-slate-300">{bucket}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {item.count > 0 && (
                              <span className="text-[10px] font-bold bg-slate-800 text-slate-350 px-2 py-0.5 rounded-sm">
                                {item.leads.map(l => l.name).slice(0, 3).join(', ')}
                                {item.leads.length > 3 ? '...' : ''}
                              </span>
                            )}
                            <span className={`text-sm font-black px-2.5 py-0.5 rounded-md ${
                              item.count > 0 ? 'bg-amber-500/10 text-accent-orange' : 'bg-slate-950 text-slate-500'
                            }`}>
                              {item.count}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Staff Performance Breakdown */}
                <div className="lg:col-span-7 bg-slate-950/40 rounded-xl border border-slate-800 p-4 space-y-4">
                  <div>
                    <h5 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                      <Users className="h-4 w-4 text-accent-emerald" />
                      Coordinator Activity Index
                    </h5>
                    <p className="text-[10px] text-slate-450">Individual team productivity metrics captured for {dprDate}.</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                          <th className="pb-2.5">Coordinator</th>
                          <th className="pb-2.5 text-center">Assigned</th>
                          <th className="pb-2.5 text-center">Leads Touched</th>
                          <th className="pb-2.5 text-center">Remarks Made</th>
                          <th className="pb-2.5 text-center">Stage Moves</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850/60">
                        {dprCoordinatorBreakdown.map((agent) => (
                          <tr 
                            key={agent.name} 
                            onClick={() => {
                              setDprCoord(agent.name);
                            }}
                            className={`text-xs hover:bg-slate-900/30 cursor-pointer transition-colors ${
                              dprCoord === agent.name ? 'bg-slate-900/50 font-semibold' : ''
                            }`}
                          >
                            <td className="py-2.5 flex items-center gap-2 text-slate-200 font-bold">
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                agent.touched > 0 ? 'bg-emerald-400' : 'bg-slate-600'
                              }`} />
                              {agent.name}
                            </td>
                            <td className="py-2.5 text-center font-mono font-bold text-blue-400">{agent.assigned}</td>
                            <td className="py-2.5 text-center font-mono font-bold text-purple-400">{agent.touched}</td>
                            <td className="py-2.5 text-center font-mono font-bold text-emerald-400">{agent.remarks}</td>
                            <td className="py-2.5 text-center font-mono font-bold text-amber-400">{agent.moved}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* --- SUB-TAB CONTENT 2: REMARKS LOGGED --- */}
          {dprSubTab === 'remarks' && (
            <div className="bg-slate-950/40 rounded-xl border border-slate-800 p-4 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <h5 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Full Remarks Detail Report
                  </h5>
                  <p className="text-[10px] text-slate-450">Direct text logs updated by coordinators on {dprDate}.</p>
                </div>
                <div className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-1 rounded">
                  Total: <span className="font-bold text-accent-emerald">{dprStats.remarksCount}</span> Remarks
                </div>
              </div>

              {dprStats.remarksList.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-1">
                  {dprStats.remarksList.map((item, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => {
                        if (item.lead && onSelectLead) {
                          onSelectLead(item.lead);
                        }
                      }}
                      className="p-3 bg-slate-900 border border-slate-800 rounded-xl hover:border-emerald-500/40 transition-all cursor-pointer flex justify-between gap-4 group text-left"
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-200 text-xs group-hover:text-emerald-400 group-hover:underline transition-colors truncate">
                            {item.name}
                          </span>
                          <span className="text-[9px] bg-slate-950 text-slate-400 px-1.5 py-0.5 rounded font-mono border border-slate-800">
                            ✈️ {item.lead?.country || 'N/A'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 italic line-clamp-3 bg-slate-950/50 p-2 rounded border border-slate-800/60 font-sans mt-1">
                          "{item.text}"
                        </p>
                        <div className="text-[10px] text-slate-450 mt-1 flex items-center gap-1.5">
                          Caller: <span className="font-bold text-accent-emerald">{item.actor}</span>
                        </div>
                      </div>
                      <span className="text-[9px] text-slate-400 font-mono self-start shrink-0">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-900/10 space-y-1">
                  <p>No remarks found for {dprDate}.</p>
                  <p className="text-[10px]">Change the date or coordinator filter above.</p>
                </div>
              )}
            </div>
          )}

          {/* --- SUB-TAB CONTENT 3: BUCKET MOVEMENTS --- */}
          {dprSubTab === 'bucket_movements' && (
            <div className="bg-slate-950/40 rounded-xl border border-slate-800 p-4 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <h5 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Pipeline Transitions Audit Trail
                  </h5>
                  <p className="text-[10px] text-slate-450">Chronological history of candidate status changes on {dprDate}.</p>
                </div>
                <div className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-1 rounded">
                  Total Moves: <span className="font-bold text-accent-orange">{dprStats.movedCount}</span> Transitions
                </div>
              </div>

              {dprStats.movedList.length > 0 ? (
                <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                  {dprStats.movedList.map((item, idx) => (
                    <div 
                      key={idx}
                      onClick={() => {
                        if (item.lead && onSelectLead) {
                          onSelectLead(item.lead);
                        }
                      }}
                      className="p-3 bg-slate-900 border border-slate-800 rounded-xl hover:border-amber-500/40 transition-all cursor-pointer flex justify-between items-center gap-4 group text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                          <TrendingUp className="h-4 w-4 text-amber-400" />
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-200 text-xs group-hover:text-amber-400 transition-colors truncate">
                              {item.name}
                            </span>
                            <span className="text-[9px] bg-amber-950/20 text-accent-orange px-1.5 py-0.2 rounded font-semibold">
                              {item.targetBucket}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">
                            {item.text}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[10px] font-bold text-slate-450">
                          By: {item.actor}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono">
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-900/10 space-y-1">
                  <p>No stage transitions found for {dprDate}.</p>
                  <p className="text-[10px]">Change the date or coordinator filter above.</p>
                </div>
              )}
            </div>
          )}

          {/* --- SUB-TAB CONTENT 4: ASSIGNMENTS --- */}
          {dprSubTab === 'assignments' && (
            <div className="bg-slate-950/40 rounded-xl border border-slate-800 p-4 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <h5 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    New Lead Assignments Log
                  </h5>
                  <p className="text-[10px] text-slate-450">Details of candidates assigned or transferred to coordinators on {dprDate}.</p>
                </div>
                <div className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-1 rounded">
                  Assigned: <span className="font-bold text-blue-400">{dprStats.assignedCount}</span> Leads
                </div>
              </div>

              {dprStats.assignedLeadsList.length > 0 ? (
                <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                  {dprStats.assignedLeadsList.map((item, idx) => (
                    <div 
                      key={idx}
                      onClick={() => {
                        if (item.lead && onSelectLead) {
                          onSelectLead(item.lead);
                        }
                      }}
                      className="p-3 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500/40 transition-all cursor-pointer flex justify-between items-center gap-4 group text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                          <UserCheck className="h-4 w-4 text-blue-400" />
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-200 text-xs group-hover:text-blue-400 transition-colors truncate">
                              {item.name}
                            </span>
                            {(item.lead?.assignedFrom === 'whatsapp_chat_menu' || 
                              (item.text || '').toLowerCase().includes('via whatsapp chat menu') || 
                              (item.text || '').toLowerCase().includes('whatsapp conversation') ||
                              (item.text || '').toLowerCase().includes('started direct whatsapp') ||
                              (item.lead?.source || '').toLowerCase().includes('whatsapp')) && (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-emerald-950/80 text-emerald-400 border border-emerald-900/40 select-none">
                                WhatsApp Chat Menu
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 truncate">
                            {item.text}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-[10px] font-bold text-slate-450">
                          Assigned to: <span className="text-blue-400 font-bold">{item.lead?.assignedTo || 'Unassigned'}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono">
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-900/10 space-y-1">
                  <p>No new assignments registered for {dprDate}.</p>
                  <p className="text-[10px]">Change the date or coordinator filter above.</p>
                </div>
              )}
            </div>
          )}

          {/* --- SUB-TAB CONTENT 5: TOUCHES --- */}
          {dprSubTab === 'touches' && (
            <div className="bg-slate-950/40 rounded-xl border border-slate-800 p-4 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <h5 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Touched Candidates Logs
                  </h5>
                  <p className="text-[10px] text-slate-450">Full list of candidates who had any contact or update on {dprDate}.</p>
                </div>
                <div className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-1 rounded">
                  Touched: <span className="font-bold text-purple-400">{dprStats.touchedCount}</span> Candidates
                </div>
              </div>

              {dprStats.touchedLeadsList.length > 0 ? (
                <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
                  {dprStats.touchedLeadsList.map((item, idx) => (
                    <div 
                      key={idx}
                      onClick={() => {
                        const originalLead = leads.find(l => l.id === item.id);
                        if (originalLead && onSelectLead) {
                          onSelectLead(originalLead);
                        }
                      }}
                      className="p-3 bg-slate-900 border border-slate-800 rounded-xl hover:border-purple-500/40 transition-all cursor-pointer flex justify-between items-center gap-4 group text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                          <Users className="h-4 w-4 text-purple-400" />
                        </div>
                        <div className="space-y-0.5 min-w-0">
                          <span className="font-bold text-slate-200 text-xs group-hover:text-purple-400 transition-colors block truncate">
                            {item.name}
                          </span>
                          <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                            <span>📞 {item.phone}</span>
                            <span>•</span>
                            <span>✈️ {item.country}</span>
                            <span>•</span>
                            <span className="text-[10px] font-semibold text-slate-350 bg-slate-950 px-1 rounded uppercase">
                              {item.stage}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-xs font-bold text-slate-300">
                          Agent: <span className="text-accent-purple">{item.assignedTo}</span>
                        </div>
                        <span className="text-[10px] font-bold bg-purple-950/30 text-purple-400 px-2 py-0.5 rounded-full border border-purple-900/30">
                          {item.activitiesCount} Actions
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-900/10 space-y-1">
                  <p>No candidates were touched on {dprDate}.</p>
                  <p className="text-[10px]">Change the date or coordinator filter above.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* --- WEEKLY REPORT CONTENT --- */}
        {reportTab === 'weekly' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
              <div className="lg:col-span-4 space-y-4">
                <div className="p-4 bg-emerald-950/20 border border-emerald-900/20 rounded-xl space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Inflow This Week</span>
                  <span className="text-3xl font-black text-slate-100 block">{weeklyStats.count}</span>
                  <p className="text-xs text-slate-450 font-sans">Newly assigned job leads received this week.</p>
                </div>

                <div className="p-4 bg-purple-950/20 border border-purple-900/20 rounded-xl space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Telecaller Touches This Week</span>
                  <span className="text-3xl font-black text-slate-100 block">{weeklyStats.activeOutreachCount}</span>
                  <p className="text-xs text-slate-450 font-sans">Calls placed and remark notes updated this week.</p>
                </div>

                {/* Placements Finalized Today(weekly) / This Week in Green Colour */}
                <div className="p-4 bg-emerald-950/30 border border-emerald-500/30 rounded-xl space-y-1 shadow-md shadow-emerald-950/5">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wide block">Placements Finalized Today (Weekly)</span>
                  <span className="text-3xl font-black text-emerald-400 block">{weeklyStats.wonCount}</span>
                  <p className="text-xs text-emerald-300 font-sans">Candidates confirmed and visa-cleared this week.</p>
                </div>
              </div>

              <div className="lg:col-span-8 border border-slate-800 rounded-xl p-4 bg-slate-950/40 space-y-3">
                <div className="bg-slate-900/90 border border-slate-800 px-3 py-2 rounded-xl flex items-center gap-2 shadow-xs">
                  <Clock className="h-4 w-4 text-accent-emerald shrink-0" />
                  <h4 className="text-xs font-bold uppercase text-slate-200 tracking-wider font-display">
                    Latest Remarks Logged This Week
                  </h4>
                </div>
                {weeklyStats.remarksWeekly.length > 0 ? (
                  <div className="space-y-3 max-h-[290px] overflow-y-auto pr-1">
                    {weeklyStats.remarksWeekly.map((item, idx) => {
                      const targetLead = item.lead || leads.find(l => l.id === item.id);
                      return (
                        <div 
                          key={idx} 
                          onClick={() => {
                            if (targetLead && onSelectLead) {
                              onSelectLead(targetLead);
                            }
                          }}
                          className="bg-slate-900 p-3 rounded-xl border border-slate-800/80 shadow-md flex justify-between items-start gap-4 hover:border-emerald-500/50 hover:bg-slate-850/80 cursor-pointer transition-all group animate-fade-in"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-100 text-xs group-hover:text-emerald-400 group-hover:underline flex items-center gap-1 transition-colors">
                                {item.name}
                                <ExternalLink className="w-3 h-3 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </span>
                              <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded font-mono font-medium text-slate-350 uppercase border border-slate-750">
                                ✈️ {item.country}
                              </span>
                            </div>
                            <p className="text-xs text-slate-300 italic">"{item.remarks}"</p>
                            <div className="text-[10px] text-slate-450">
                              Caller: <span className="font-bold text-accent-emerald">{item.assignedTo}</span>
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-450 font-mono shrink-0">{item.time}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-900/10 space-y-1.5">
                    <p>No remarks logged this week.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Abroad Country Demands as a standalone beautifully matched block */}
            <div className="border border-slate-800 rounded-xl p-5 bg-slate-950/40 text-left space-y-4">
              <div className="bg-slate-900/90 border border-slate-800 px-3 py-2.5 rounded-xl flex items-center gap-2 shadow-xs max-w-sm">
                <MapPin className="h-4 w-4 text-accent-emerald shrink-0" />
                <h4 className="text-xs font-bold uppercase text-slate-200 tracking-wider font-display">
                  Abroad Country Demands This Week
                </h4>
              </div>
              
              {weeklyStats.countries.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {weeklyStats.countries.map((item, idx) => (
                    <div key={idx} className="bg-slate-900/50 p-3.5 rounded-xl border border-slate-800/80 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-200">{item.country}</span>
                        <span className="font-mono text-slate-400 text-[10px] font-bold">{item.count} leads ({item.percent}%)</span>
                      </div>
                      <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden p-0.5 border border-slate-850">
                        <div 
                          className="h-full bg-accent-emerald rounded-full" 
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-450">No lead counts found for this week.</div>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {renderConversionGraph()}
              {renderTargetAchievementGraph()}
            </div>
          </div>
        )}

        {/* --- MONTHLY REPORT & LEADERBOARD CONTENT --- */}
        {reportTab === 'monthly' && (
          <div className="space-y-6">
            <div className="space-y-5 text-left">
            <div className="bg-slate-950 text-white rounded-2xl p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-slate-850">
              <div>
                <span className="text-[10px] bg-emerald-500/10 text-accent-emerald rounded-full px-2.5 py-0.5 font-bold uppercase tracking-wide border border-emerald-900/20">
                  Monthly Performance Ledger
                </span>
                <h4 className="text-lg font-black tracking-tight mt-1 font-display text-slate-100">Coordinators Leaderboard (Active Agents)</h4>
                <p className="text-xs text-slate-400">Activity index for Career Growth Placement's 10 sub-agents.</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs text-slate-400 block font-medium">Monthly Successful Placements</span>
                <span className="text-2xl font-black text-accent-emerald">{monthlyStats.wonCount} candidates</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800 text-left">
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase select-none">Rank</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase select-none">Coordinator Name</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-center select-none">Assigned Leads</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-left select-none">Assigned Today (Candidates)</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-center select-none">Progressing Candidates</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-center text-rose-400 select-none">Lost / Unqualified</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-center text-accent-emerald select-none">Visa-Cleared (Won)</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-right select-none">Conversion</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-right text-accent-emerald select-none">Target Achievement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 bg-slate-900">
                  {monthlyStats.leaderboard.map((agent, index) => {
                    const isTop1 = index === 0;
                    return (
                      <tr key={index} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-3 text-xs font-bold text-slate-300">
                          {isTop1 ? (
                            <span className="flex items-center gap-1 text-amber-500" title="Top Performer">
                              🏆 1
                            </span>
                          ) : (
                            <span># {index + 1}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs font-extrabold text-slate-200">
                          {agent.name}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-300 text-center font-mono">
                          {agent.total}
                        </td>
                        <td className="px-5 py-3 text-xs text-left">
                          {agent.assignedToday && agent.assignedToday.length > 0 ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 bg-slate-800 text-slate-300 font-extrabold text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider border border-slate-750">
                                📢 {agent.assignedToday.length} Assigned
                              </span>
                              <div className="text-[11px] text-slate-200 font-bold leading-tight flex flex-wrap gap-1">
                                {agent.assignedToday.map((lead: Lead, lIdx: number) => (
                                  <span
                                    key={lead.id || lIdx}
                                    onClick={() => onSelectLead?.(lead)}
                                    className="hover:text-emerald-400 hover:underline cursor-pointer transition-colors"
                                  >
                                    {formatCandidateName(lead.name)}{lIdx < agent.assignedToday.length - 1 ? ',' : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-500 font-medium">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-300 text-center font-mono font-medium">
                          {agent.progress}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500 text-center font-mono">
                          {agent.lost}
                        </td>
                        <td className="px-5 py-3 text-xs text-center font-bold text-accent-emerald font-mono bg-emerald-950/10">
                          {agent.won}
                        </td>
                        <td className="px-5 py-3 text-xs text-right font-extrabold text-slate-300 font-mono">
                          {agent.conversionRate}%
                        </td>
                        <td className="px-5 py-3 text-xs text-right font-black text-accent-emerald font-mono bg-emerald-950/5">
                          {agent.targetAchievementRatio}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {renderConversionGraph()}
            {renderTargetAchievementGraph()}
          </div>
        </div>
      )}

      {/* --- CUSTOM DATE-WISE REPORT CONTENT --- */}
      {reportTab === 'custom' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="p-4 bg-emerald-950/20 border border-emerald-900/20 rounded-xl space-y-1 text-left">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Inflow in Period</span>
              <span className="text-3xl font-black text-slate-100 block">{customStats.createdCount}</span>
              <p className="text-xs text-slate-450 font-sans">Newly created job leads during this period.</p>
            </div>

            <div className="p-4 bg-purple-950/20 border border-purple-900/20 rounded-xl space-y-1 text-left">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block">Outreach Logs in Period</span>
              <span className="text-3xl font-black text-slate-100 block">{customStats.activeOutreachCount}</span>
              <p className="text-xs text-slate-450 font-sans">Remarks updated & calls logged during this period.</p>
            </div>

            <div className="p-4 bg-amber-950/20 border border-amber-900/20 rounded-xl space-y-1 text-left">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wide block font-display">Placements Won in Period</span>
              <span className="text-3xl font-black text-slate-100 block">{customStats.wonCount}</span>
              <p className="text-xs text-slate-450 font-sans">Confirmed visa status / won leads in this range.</p>
            </div>
          </div>

          {/* Grid for Country Demands and Remarks Logs */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
            {/* Left Side: Country distribution */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-4 flex items-center gap-1.5 font-display">
                  <MapPin className="h-4 w-4 text-accent-emerald" />
                  Abroad Country Demands (Custom Range)
                </h4>
                <div className="space-y-3.5">
                  {customStats.countries.length > 0 ? (
                    customStats.countries.map((item, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-200">{item.country} Candidates</span>
                          <span className="font-mono text-slate-400">{item.count} leads ({item.percent}%)</span>
                        </div>
                        <div className="w-full bg-slate-950 h-3 rounded-lg overflow-hidden p-0.5 border border-slate-850">
                          <div 
                            className="h-full bg-accent-emerald rounded-md" 
                            style={{ width: `${item.percent}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-10 text-center text-xs text-slate-450">No leads captured in this date range.</div>
                  )}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-850">
                <span className="text-[10px] font-bold text-accent-purple uppercase tracking-widest block mb-1 font-mono">DATE-WISE SUMMARY</span>
                <p className="text-xs text-slate-450 leading-relaxed font-sans">
                  Showing statistics for {new Date(customStartDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} to {new Date(customEndDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}. Total active files matching criteria: <strong>{customStats.totalCount} leads</strong>.
                </p>
              </div>
            </div>

            {/* Right Side: Remarks log */}
            <div className="lg:col-span-7 border border-slate-800 rounded-xl p-4 bg-slate-950/40">
              <h4 className="text-xs font-bold uppercase text-slate-400 tracking-wider mb-3 flex items-center gap-1.5 font-display">
                <Clock className="h-4 w-4 text-accent-emerald" />
                Remarks Logged During This Period
              </h4>
              {customStats.remarksInPeriod.length > 0 ? (
                <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                  {customStats.remarksInPeriod.slice(0, 15).map((item, idx) => {
                    const targetLead = item.lead || leads.find(l => l.id === item.id);
                    return (
                      <div 
                        key={idx} 
                        onClick={() => {
                          if (targetLead && onSelectLead) {
                            onSelectLead(targetLead);
                          }
                        }}
                        className="bg-slate-900 p-3 rounded-xl border border-slate-800/80 shadow-md flex justify-between items-start gap-4 hover:border-emerald-500/50 hover:bg-slate-850/80 cursor-pointer transition-all group"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-100 text-xs group-hover:text-emerald-400 group-hover:underline flex items-center gap-1 transition-colors">
                              {item.name}
                              <ExternalLink className="w-3 h-3 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </span>
                            <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded font-mono font-medium text-slate-350 uppercase border border-slate-750">
                              ✈️ {item.country || 'QATAR'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300 italic">"{item.remarks}"</p>
                          <div className="text-[10px] text-slate-450">
                            Caller: <span className="font-bold text-accent-emerald">{item.assignedTo || 'Unassigned'}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[9px] text-slate-400 block font-mono font-bold">{item.date}</span>
                          <span className="text-[9px] text-slate-500 block font-mono">{item.time}</span>
                        </div>
                      </div>
                    );
                  })}
                  {customStats.remarksInPeriod.length > 15 && (
                    <div className="text-center text-[10px] text-slate-450 pt-1">
                      ...and {customStats.remarksInPeriod.length - 15} more remarks logged in this range.
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-16 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl bg-slate-900/10 space-y-1.5">
                  <p>No phone calls or remarks logged during this custom period.</p>
                  <p className="text-[10px]">Select a wider range or verify candidate remarks logs.</p>
                </div>
              )}
            </div>
          </div>

          {/* Leadership matrix table */}
          <div className="space-y-5 text-left pt-2">
            <div className="bg-slate-950 text-white rounded-2xl p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-slate-850">
              <div>
                <span className="text-[10px] bg-purple-500/10 text-accent-purple rounded-full px-2.5 py-0.5 font-bold uppercase tracking-wide border border-purple-900/20">
                  Custom Range Leadership matrix
                </span>
                <h4 className="text-lg font-black tracking-tight mt-1 font-display text-slate-100">Coordinators Leaderboard (Filtered Range)</h4>
                <p className="text-xs text-slate-400">Activity and conversion ratios for Career Growth Placement's agents within selected dates.</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs text-slate-400 block font-medium">Placements Won in Range</span>
                <span className="text-2xl font-black text-accent-emerald">{customStats.wonCount} candidates</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800 text-left">
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase select-none">Rank</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase select-none">Coordinator Name</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-center select-none">Assigned Leads</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-left select-none">Assigned in Range (Candidates)</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-center select-none">Progressing Candidates</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-center text-rose-400 select-none">Lost / Unqualified</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-center text-accent-emerald select-none">Visa-Cleared (Won)</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-right select-none">Conversion</th>
                    <th className="px-5 py-3 text-xs font-bold text-slate-400 uppercase text-right text-accent-emerald select-none">Target Achievement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 bg-slate-900">
                  {customStats.leaderboard.map((agent, index) => {
                    const isTop1 = index === 0;
                    return (
                      <tr key={index} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-3 text-xs font-bold text-slate-300">
                          {isTop1 ? (
                            <span className="flex items-center gap-1 text-amber-500" title="Top Performer">
                              🏆 1
                            </span>
                          ) : (
                            <span># {index + 1}</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs font-extrabold text-slate-200">
                          {agent.name}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-300 text-center font-mono">
                          {agent.total}
                        </td>
                        <td className="px-5 py-3 text-xs text-left">
                          {agent.assignedInPeriod && agent.assignedInPeriod.length > 0 ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 bg-slate-800 text-slate-300 font-extrabold text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider border border-slate-750">
                                📢 {agent.assignedInPeriod.length} Assigned
                              </span>
                              <div className="text-[11px] text-slate-200 font-bold leading-tight line-clamp-2 flex flex-wrap gap-1">
                                {agent.assignedInPeriod.map((lead: Lead, lIdx: number) => (
                                  <span
                                    key={lead.id || lIdx}
                                    onClick={() => onSelectLead?.(lead)}
                                    className="hover:text-emerald-400 hover:underline cursor-pointer transition-colors"
                                  >
                                    {formatCandidateName(lead.name)}{lIdx < agent.assignedInPeriod.length - 1 ? ',' : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-500 font-medium">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-300 text-center font-mono font-medium">
                          {agent.progress}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500 text-center font-mono">
                          {agent.lost}
                        </td>
                        <td className="px-5 py-3 text-xs text-center font-bold text-accent-emerald font-mono bg-emerald-950/10">
                          {agent.won}
                        </td>
                        <td className="px-5 py-3 text-xs text-right font-extrabold text-slate-300 font-mono">
                          {agent.conversionRate}%
                        </td>
                        <td className="px-5 py-3 text-xs text-right font-black text-accent-emerald font-mono bg-emerald-950/5">
                          {agent.targetAchievementRatio}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {renderConversionGraph()}
            {renderTargetAchievementGraph()}
          </div>
        </div>
      )}
      </div>

      {/* Visual Attributions & Pipeline breakdown Header & Filter */}
      <div className="bg-slate-900/60 p-4.5 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md mb-6 select-none">
        <div>
          <h3 className="text-xs font-black uppercase text-slate-300 tracking-wider font-display">
            Attribution & Pipeline Analytics
          </h3>
          <p className="text-[10px] text-slate-450 font-bold mt-0.5">
            {selectedCoordinatorName === 'All' 
              ? `Aggregate target countries and pipeline stages breakdown for all active leads.`
              : `Target countries and pipeline stages breakdown for leads handled by ${selectedCoordinatorName}.`
            }
          </p>
        </div>

        {userRole === 'admin' ? (
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl shrink-0">
            <span className="text-[10px] font-bold text-slate-450 uppercase font-mono">View Coordinator:</span>
            <select
              value={selectedCoordFilter}
              onChange={(e) => setSelectedCoordFilter(e.target.value)}
              className="bg-transparent text-xs text-slate-200 font-extrabold outline-none border-0 p-0 cursor-pointer focus:ring-0 uppercase font-display"
            >
              <option value="All" className="bg-slate-950 text-slate-200">All Coordinators</option>
              <option value="Unassigned" className="bg-slate-950 text-slate-200">Unassigned Only</option>
              {coordinators.filter(c => c.role === 'agent').map(c => (
                <option key={c.id} value={c.displayName} className="bg-slate-950 text-slate-200">{c.displayName}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-950/40 text-accent-purple text-[10px] font-black uppercase tracking-wider rounded-xl border border-purple-900/30 font-display">
            <span>Coordinator: {selectedCoordinatorName}</span>
          </div>
        )}
      </div>

      {/* Visual Attributions & Pipeline breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Ad Country Demands breakdown */}
        <div className="lg:col-span-7 bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4 select-none">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2 font-display">
                <BarChart3 className="h-4.5 w-4.5 text-accent-emerald" />
                Active Consultancy Target Country Attribution
              </h3>
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-855">
                <button
                  type="button"
                  onClick={() => setAttributionChartType('bar')}
                  className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                    attributionChartType === 'bar'
                      ? 'bg-emerald-500 text-zinc-950 font-black shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Bars
                </button>
                <button
                  type="button"
                  onClick={() => setAttributionChartType('pie')}
                  className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                    attributionChartType === 'pie'
                      ? 'bg-emerald-500 text-zinc-950 font-black shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Pie
                </button>
              </div>
            </div>

            {attributionChartType === 'bar' ? (
              <div className="space-y-4">
                {campaignAttributionFiltered && campaignAttributionFiltered.length > 0 ? (
                  campaignAttributionFiltered.map((camp, idx) => {
                    const maxCount = Math.max(...campaignAttributionFiltered.map(c => c.count), 1);
                    const percentLength = Math.round((camp.count / maxCount) * 100);
                    return (
                      <div key={idx} className="space-y-1 text-left">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-semibold text-slate-200 truncate max-w-[280px] font-sans">
                            ✈️ {camp.campaign.replace(' Openings', '')} Placement Program
                          </span>
                          <span className="text-slate-400 font-mono font-bold">
                            {camp.count} leads
                          </span>
                        </div>
                        <div className="h-6 w-full bg-slate-950 rounded-lg overflow-hidden flex items-center p-0.5 border border-slate-850">
                          <div
                            style={{ width: `${percentLength}%` }}
                            className="h-full bg-accent-emerald hover:bg-emerald-500 rounded-md transition-all duration-500 flex items-center px-2"
                          >
                            {percentLength > 15 && (
                              <span className="text-[9px] text-slate-950 font-black uppercase tracking-wider">
                                {percentLength}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-xs text-slate-450 py-10 text-center font-sans">No campaign attributions available.</div>
                )}
              </div>
            ) : (
              <div className="h-[280px] w-full flex items-center justify-center">
                {campaignAttributionFiltered && campaignAttributionFiltered.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={campaignAttributionFiltered.map(c => ({
                          name: c.campaign.replace(' Openings', '').replace(' Program', ''),
                          value: c.count
                        }))}
                        cx="50%"
                        cy="45%"
                        innerRadius={60}
                        outerRadius={85}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {campaignAttributionFiltered.map((entry, index) => {
                          const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#14b8a6', '#f43f5e'];
                          return <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />;
                        })}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                        itemStyle={{ color: '#f1f5f9', fontSize: '11px' }}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={36} 
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: '10px', color: '#94a3b8' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-xs text-slate-450 py-10 text-center font-sans">No campaign data for Pie Chart.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Lead pipeline stage funnel */}
        <div className="lg:col-span-5 bg-slate-900 p-6 rounded-2xl border border-slate-800 text-left shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4 select-none">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2 font-display">
                <Target className="h-4.5 w-4.5 text-accent-emerald" />
                Candidate Pipeline Funnel Stages
              </h3>
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-850">
                <button
                  type="button"
                  onClick={() => setPipelineChartType('funnel')}
                  className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                    pipelineChartType === 'funnel'
                      ? 'bg-emerald-500 text-zinc-950 font-black shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Funnel
                </button>
                <button
                  type="button"
                  onClick={() => setPipelineChartType('pie')}
                  className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-lg transition-all cursor-pointer ${
                    pipelineChartType === 'pie'
                      ? 'bg-emerald-500 text-zinc-950 font-black shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Pie
                </button>
              </div>
            </div>

            {pipelineChartType === 'funnel' ? (
              <div className="space-y-2.5">
                {[
                  { label: '1. New Inbound', key: 'new', color: 'bg-slate-600 hover:bg-slate-500' },
                  { label: '2. In Discussion', key: 'in_discussion', color: 'bg-amber-600 hover:bg-amber-500' },
                  { label: '3. Strong Opportunity', key: 'strong_opportunity', color: 'bg-sky-600 hover:bg-sky-500' },
                  { label: '4. Office Visited / Interview', key: 'office_visited', color: 'bg-purple-650 hover:bg-purple-605' },
                  { label: '5. Won', key: 'won', color: 'bg-accent-emerald hover:bg-emerald-500' },
                  { label: '6. Cold Leads', key: 'cold_leads', color: 'bg-blue-600 hover:bg-blue-500' },
                  { label: '7. Lost', key: 'lost', color: 'bg-slate-700 hover:bg-slate-650' }
                ].map((funnel, idx) => {
                  const count = pipelineStagesFiltered[funnel.key as any] || 0;
                  const maxVal = Math.max(...(Object.values(pipelineStagesFiltered) as number[]), 1);
                  const pct = calculatePercent(count, filteredLeadsCount);
                  const barWidth = Math.max(10, calculatePercent(count, maxVal));
                  return (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="w-28 text-xs font-bold text-slate-400 text-right leading-tight">
                        {funnel.label}
                      </div>
                      <div className="flex-1 h-11 bg-slate-950 rounded-xl flex items-center px-1.5 overflow-hidden border border-slate-850">
                        <div
                          style={{ width: `${barWidth}%` }}
                          className={`h-8 rounded-lg ${funnel.color} transition-all duration-500 flex items-center justify-between px-3.5 text-white font-sans`}
                        >
                          <span className="text-white drop-shadow-md font-black text-base sm:text-lg font-display tracking-wide">
                            {count}
                          </span>
                          {pct > 0 && (
                            <span className="text-xs sm:text-sm font-black text-white/90 font-mono tracking-tight bg-slate-950/20 px-1.5 py-0.5 rounded-md">
                              {pct}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-[280px] w-full mt-2 flex items-center justify-center">
                {(() => {
                  const pieData = [
                    { name: '1. New Inbound', value: pipelineStagesFiltered.new || 0, color: '#475569' },
                    { name: '2. In Discussion', value: pipelineStagesFiltered.in_discussion || 0, color: '#d97706' },
                    { name: '3. Strong Opportunity', value: pipelineStagesFiltered.strong_opportunity || 0, color: '#0284c7' },
                    { name: '4. Office Visited / Interview', value: pipelineStagesFiltered.office_visited || 0, color: '#7c3aed' },
                    { name: '5. Won', value: pipelineStagesFiltered.won || 0, color: '#10b981' },
                    { name: '6. Cold Leads', value: pipelineStagesFiltered.cold_leads || 0, color: '#2563eb' },
                    { name: '7. Lost', value: pipelineStagesFiltered.lost || 0, color: '#334155' }
                  ].filter(item => item.value > 0);

                  if (pieData.length === 0) {
                    return <div className="text-xs text-slate-450 py-10 text-center font-sans">No pipeline data for Pie Chart.</div>;
                  }

                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="45%"
                          innerRadius={60}
                          outerRadius={85}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                          itemStyle={{ color: '#f1f5f9', fontSize: '11px' }}
                        />
                        <Legend 
                          verticalAlign="bottom" 
                          height={36} 
                          iconType="circle"
                          iconSize={8}
                          wrapperStyle={{ fontSize: '10px', color: '#94a3b8' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
