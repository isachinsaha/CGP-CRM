import React, { useState } from 'react';
import { Lead, LeadStage, Coordinator } from '../types.ts';
import { 
  TrendingUp, 
  ArrowRight, 
  ArrowLeft, 
  MessageSquare, 
  Briefcase, 
  Calendar, 
  ShieldCheck, 
  Sparkles, 
  Star,
  Inbox,
  X,
  LayoutGrid,
  Trello,
  RotateCw,
  Search,
  Zap,
  Snowflake,
  CheckCircle2
} from 'lucide-react';
import { motion } from 'motion/react';
import { getCountryFlagUrl, formatCandidateName, getEffectiveIntake } from '../utils';
import { SearchableSelect } from './SearchableSelect.tsx';

interface LeadBoardProps {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  onUpdateStage: (id: string, stage: LeadStage) => void;
  userRole: 'admin' | 'agent';
  currentAgentId: string;
  coordinators?: Coordinator[];
}

interface Column {
  id: LeadStage;
  title: string;
  color: string;
  headerColor: string;
}

export default function LeadBoard({ 
  leads, 
  onSelectLead, 
  onUpdateStage, 
  userRole, 
  currentAgentId,
  coordinators = []
}: LeadBoardProps) {
  
  // View mode switcher: 'hub' (container tabs view like Active Jobs Hub) or 'board' (classic kanban)
  const [viewMode, setViewMode] = useState<'board' | 'hub'>('hub');
  
  // Selected stage for Pipeline Hub View
  const [selectedStage, setSelectedStage] = useState<LeadStage>('new');

  // Bucket filtering for agents
  const [bucketToggle, setBucketToggle] = useState<'my' | 'all'>(userRole === 'agent' ? 'my' : 'all');
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null);

  // Coordinator filter state (for Admin View)
  const [coordinatorFilter, setCoordinatorFilter] = useState('All');

  // Search input state for Pipeline
  const [searchQuery, setSearchQuery] = useState('');

  // Remarks filter state
  const [remarksFilter, setRemarksFilter] = useState('All');

  // Country, Position, and Gender Filters for selected stage
  const [boardCountryFilter, setBoardCountryFilter] = useState('All');
  const [boardPositionFilter, setBoardPositionFilter] = useState('All');
  const [boardGenderFilter, setBoardGenderFilter] = useState('All');

  // Reset stage filters when stage is switched
  React.useEffect(() => {
    setBoardCountryFilter('All');
    setBoardPositionFilter('All');
    setBoardGenderFilter('All');
  }, [selectedStage]);

  // Memoized options list for searchable coordinator select
  const coordinatorOptions = React.useMemo(() => {
    const list = [
      { value: 'All', label: '👤 All Coordinators' },
      { value: 'Unassigned', label: '👤 Unassigned Only' }
    ];
    if (coordinators && coordinators.length > 0) {
      coordinators.filter(c => c.role === 'agent').forEach(coord => {
        list.push({
          value: coord.username,
          label: `👤 ${coord.displayName.toUpperCase()}`
        });
      });
    }
    return list;
  }, [coordinators]);

  const remarksOptions = React.useMemo(() => {
    let r1Count = 0;
    let r2Count = 0;
    let r3Count = 0;
    let r1OnlyCount = 0;
    let r2OnlyCount = 0;
    let r3OnlyCount = 0;
    let noneCount = 0;
    let allCount = 0;

    leads.forEach(lead => {
      const h1 = !!(lead.remarks1 && lead.remarks1.trim());
      const h2 = !!(lead.remarks2 && lead.remarks2.trim());
      const h3 = !!(lead.remarks3 && lead.remarks3.trim());

      if (h1) r1Count++;
      if (h2) r2Count++;
      if (h3) r3Count++;
      if (h1 && !h2 && !h3) r1OnlyCount++;
      if (h2 && !h1 && !h3) r2OnlyCount++;
      if (h3 && !h1 && !h2) r3OnlyCount++;
      if (!h1 && !h2 && !h3) noneCount++;
      if (h1 && h2 && h3) allCount++;
    });

    return [
      { value: 'All', label: `💬 Remarks: All (${leads.length})` },
      { value: 'remarks1', label: `💬 Has 1st Remarks (${r1Count})` },
      { value: 'remarks2', label: `💬 Has 2nd Remarks (${r2Count})` },
      { value: 'remarks3', label: `💬 Has 3rd Remarks (${r3Count})` },
      { value: 'remarks1Only', label: `💬 1st Remarks Only (${r1OnlyCount})` },
      { value: 'remarks2Only', label: `💬 2nd Remarks Only (${r2OnlyCount})` },
      { value: 'remarks3Only', label: `💬 3rd Remarks Only (${r3OnlyCount})` },
      { value: 'noRemarks', label: `💬 No Remarks (${noneCount})` },
      { value: 'allRemarks', label: `💬 Has All 3 Remarks (${allCount})` }
    ];
  }, [leads]);

  // Date filter state: 'all' | 'today' | 'yesterday' | 'date-wise'
  const [pipelineDateFilter, setPipelineDateFilter] = useState<'all' | 'today' | 'yesterday' | 'date-wise'>('all');
  // From Date and To Date for custom range filtering
  const [filterStartDate, setFilterStartDate] = useState<string>(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toLocaleDateString('en-CA');
  });
  const [filterEndDate, setFilterEndDate] = useState<string>(() => new Date().toLocaleDateString('en-CA'));

  // Dynamic percentage calculation and color rules for "In Discussion" container
  const inDiscussionPctInfo = React.useMemo(() => {
    let lifetimeScopeLeads: Lead[] = leads;

    if (userRole === 'agent') {
      lifetimeScopeLeads = leads.filter(l => l.assignedTo && l.assignedTo.toLowerCase() === currentAgentId.toLowerCase());
    } else if (coordinatorFilter !== 'All') {
      if (coordinatorFilter === 'Unassigned') {
        lifetimeScopeLeads = leads.filter(l => !l.assignedTo);
      } else {
        lifetimeScopeLeads = leads.filter(l => l.assignedTo && l.assignedTo.toLowerCase() === coordinatorFilter.toLowerCase());
      }
    }

    const totalAssignedLifetime = lifetimeScopeLeads.length;
    const inDiscussionCount = lifetimeScopeLeads.filter(l => l.stage === 'in_discussion' || l.stage === 'negotiating').length;
    const percentage = totalAssignedLifetime > 0 ? (inDiscussionCount / totalAssignedLifetime) * 100 : 0;

    let level: 'green' | 'yellow' | 'orange' | 'red' = 'green';
    let rangeLabel = '0-25%';
    let selectedClass = 'bg-emerald-50 dark:bg-emerald-950/80 border-2 border-emerald-500 text-emerald-950 dark:text-slate-100 shadow-md ring-2 ring-emerald-500/20';
    let unselectedClass = 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60 hover:border-emerald-500 text-emerald-900 dark:text-emerald-200 shadow-3xs';
    let badgeColor = 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/40 font-black';
    let iconColor = 'text-emerald-600 dark:text-emerald-400';
    let headerColor = 'text-emerald-900 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 font-bold border border-emerald-300 dark:border-emerald-800/50';
    let textColor = 'text-emerald-700 dark:text-emerald-400';

    if (percentage >= 75) {
      level = 'red';
      rangeLabel = '>75%';
      selectedClass = 'bg-rose-50 dark:bg-rose-950/80 border-2 border-rose-500 text-rose-950 dark:text-slate-100 shadow-md ring-2 ring-rose-500/20';
      unselectedClass = 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60 hover:border-rose-500 text-rose-900 dark:text-rose-200 shadow-3xs';
      badgeColor = 'bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-400 border-rose-300 dark:border-rose-500/40 font-black';
      iconColor = 'text-rose-600 dark:text-rose-400';
      headerColor = 'text-rose-900 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/60 font-bold border border-rose-300 dark:border-rose-800/50';
      textColor = 'text-rose-700 dark:text-rose-400';
    } else if (percentage >= 50) {
      level = 'orange';
      rangeLabel = '50-75%';
      selectedClass = 'bg-orange-50 dark:bg-orange-950/85 border-2 border-orange-600 text-orange-950 dark:text-slate-100 shadow-md ring-2 ring-orange-600/30';
      unselectedClass = 'bg-orange-50/50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-700/80 hover:border-orange-500 text-orange-900 dark:text-orange-200 shadow-3xs';
      badgeColor = 'bg-orange-100 dark:bg-orange-600/30 text-orange-800 dark:text-orange-350 border-orange-300 dark:border-orange-500/60 font-black';
      iconColor = 'text-orange-600 dark:text-orange-500';
      headerColor = 'text-orange-900 dark:text-orange-200 bg-orange-100 dark:bg-orange-950/80 font-bold border border-orange-300 dark:border-orange-700/70';
      textColor = 'text-orange-700 dark:text-orange-400';
    } else if (percentage >= 25) {
      level = 'yellow';
      rangeLabel = '25-50%';
      selectedClass = 'bg-yellow-50 dark:bg-yellow-950/85 border-2 border-yellow-400 text-yellow-950 dark:text-yellow-100 shadow-md ring-2 ring-yellow-400/40';
      unselectedClass = 'bg-yellow-50/50 dark:bg-yellow-950/25 border-yellow-200 dark:border-yellow-400/90 hover:border-yellow-300 text-yellow-900 dark:text-yellow-200 shadow-3xs';
      badgeColor = 'bg-yellow-100 dark:bg-yellow-400/25 text-yellow-800 dark:text-yellow-350 border-yellow-300 dark:border-yellow-400/60 font-black';
      iconColor = 'text-yellow-600 dark:text-yellow-300';
      headerColor = 'text-yellow-900 dark:text-yellow-200 bg-yellow-100 dark:bg-yellow-950/80 font-bold border border-yellow-300 dark:border-yellow-400/60';
      textColor = 'text-yellow-700 dark:text-yellow-350';
    }

    return {
      totalAssignedLifetime,
      inDiscussionCount,
      percentage,
      level,
      rangeLabel,
      selectedClass,
      unselectedClass,
      badgeColor,
      iconColor,
      headerColor,
      textColor,
    };
  }, [leads, userRole, currentAgentId, coordinatorFilter]);

  const COLUMNS: Column[] = [
    { id: 'new', title: '1. New Inbound', color: 'border-sky-900/40 bg-sky-950/15', headerColor: 'text-sky-400 bg-sky-950/40 font-medium' },
    { id: 'in_discussion', title: '2. In Discussion', color: 'border-slate-750 bg-slate-900/35', headerColor: inDiscussionPctInfo.headerColor },
    { id: 'strong_opportunity', title: '3. Strong Opportunity', color: 'border-sky-900/40 bg-sky-950/15', headerColor: 'text-sky-400 bg-sky-950/40 font-medium' },
    { id: 'office_visited', title: '4. Office Visited / Interview', color: 'border-purple-900/40 bg-purple-950/15', headerColor: 'text-purple-400 bg-purple-950/40 font-medium' },
    { id: 'won', title: '5. Won', color: 'border-emerald-900/40 bg-emerald-950/15', headerColor: 'text-emerald-400 bg-emerald-950/40 font-semibold' },
    { id: 'cold_leads', title: '6. Cold Leads', color: 'border-blue-900/40 bg-blue-950/15', headerColor: 'text-blue-400 bg-blue-950/40 font-medium' },
    { id: 'lost', title: '7. Lost', color: 'border-slate-750 bg-slate-900/20', headerColor: 'text-slate-400 bg-slate-800' }
  ];

  const getFitScoreBadge = (score: string) => {
    switch (score) {
      case 'high':
        return 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30';
      case 'medium':
        return 'bg-teal-950/40 text-teal-400 border-teal-900/30';
      case 'low':
        return 'bg-amber-950/40 text-amber-400 border-amber-900/30';
      case 'unqualified':
      default:
        return 'bg-slate-800 text-slate-400 border-slate-750';
    }
  };

  const getStageNeighbors = (current: LeadStage): { prev: LeadStage | null; next: LeadStage | null } => {
    const list: LeadStage[] = ['new', 'in_discussion', 'strong_opportunity', 'office_visited', 'won', 'cold_leads', 'lost'];
    // Map legacy alias to standard
    let normalized = current;
    if (current === 'negotiating') normalized = 'in_discussion';
    else if (current === 'proposal') normalized = 'office_visited';
    else if (current === 'rotations') normalized = 'cold_leads';

    const idx = list.indexOf(normalized);
    return {
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx < list.length - 1 && idx >= 0 ? list[idx + 1] : null
    };
  };

  // Filter leads based on agent bucket selection AND date filters
  const visibleLeads = React.useMemo(() => {
    let filtered = leads;

    // Filter out unassigned leads in stage 'new' (Requesting chats in WhatsApp menu)
    // OR leads that have not been intaken yet
    filtered = filtered.filter(lead => getEffectiveIntake(lead));

    // Search query filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(lead => 
        (lead.name && lead.name.toLowerCase().includes(q)) ||
        (lead.phone && lead.phone.toLowerCase().includes(q)) ||
        (lead.country && lead.country.toLowerCase().includes(q)) ||
        (lead.position && lead.position.toLowerCase().includes(q)) ||
        (lead.project && lead.project.toLowerCase().includes(q)) ||
        (lead.source && lead.source.toLowerCase().includes(q))
      );
    }

    // Agent bucket filter
    if (userRole === 'agent') {
      filtered = filtered.filter(lead => lead.assignedTo?.toLowerCase() === currentAgentId.toLowerCase());
    }

    // Coordinator Filter (only in Admin view)
    if (userRole === 'admin' && coordinatorFilter !== 'All') {
      if (coordinatorFilter === 'Unassigned') {
        filtered = filtered.filter(lead => !lead.assignedTo);
      } else {
        filtered = filtered.filter(lead => lead.assignedTo?.toLowerCase() === coordinatorFilter.toLowerCase() || lead.assignedTo === coordinatorFilter);
      }
    }

    // Date range filter
    if (pipelineDateFilter !== 'all') {
      let startMs: number | null = null;
      let endMs: number | null = null;

      if (pipelineDateFilter === 'today') {
        const todayStr = new Date().toLocaleDateString('en-CA');
        startMs = new Date(todayStr + 'T00:00:00').getTime();
        endMs = new Date(todayStr + 'T23:59:59').getTime();
      } else if (pipelineDateFilter === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toLocaleDateString('en-CA');
        startMs = new Date(yesterdayStr + 'T00:00:00').getTime();
        endMs = new Date(yesterdayStr + 'T23:59:59').getTime();
      } else if (pipelineDateFilter === 'date-wise') {
        startMs = new Date(filterStartDate + 'T00:00:00').getTime();
        endMs = new Date(filterEndDate + 'T23:59:59').getTime();
      }

      if (startMs !== null && endMs !== null) {
        filtered = filtered.filter(lead => {
          const datesToTry = [lead.createdAt, lead.updatedAt, lead.assignDate, lead.entryDate];
          return datesToTry.some(dateStr => {
            if (!dateStr) return false;
            const dateObj = new Date(dateStr);
            const ms = dateObj.getTime();
            if (isNaN(ms)) return false;
            return ms >= startMs! && ms <= endMs!;
          });
        });
      }
    }

    // Remarks Wise Filter
    if (remarksFilter && remarksFilter !== 'All') {
      filtered = filtered.filter(lead => {
        const r1 = !!(lead.remarks1 && lead.remarks1.trim());
        const r2 = !!(lead.remarks2 && lead.remarks2.trim());
        const r3 = !!(lead.remarks3 && lead.remarks3.trim());

        if (remarksFilter === 'remarks1') {
          return r1;
        } else if (remarksFilter === 'remarks2') {
          return r2;
        } else if (remarksFilter === 'remarks3') {
          return r3;
        } else if (remarksFilter === 'remarks1Only') {
          return r1 && !r2 && !r3;
        } else if (remarksFilter === 'remarks2Only') {
          return r2 && !r1 && !r3;
        } else if (remarksFilter === 'remarks3Only') {
          return r3 && !r1 && !r2;
        } else if (remarksFilter === 'noRemarks') {
          return !r1 && !r2 && !r3;
        } else if (remarksFilter === 'allRemarks') {
          return r1 && r2 && r3;
        }
        return true;
      });
    }

    return filtered;
  }, [leads, searchQuery, userRole, currentAgentId, coordinatorFilter, pipelineDateFilter, filterStartDate, filterEndDate, remarksFilter]);

  // Helper to sort leads such that candidates with unread messages (replies) come first
  const sortLeadsByUnreadAndDate = (leadsList: Lead[]) => {
    return [...leadsList].sort((a, b) => {
      const unreadA = (a.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
      const unreadB = (b.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
      
      if (unreadA > 0 && unreadB === 0) return -1;
      if (unreadA === 0 && unreadB > 0) return 1;
      
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  };

  // Extract all leads belonging to the currently selected stage (without board filters applied)
  const stageLeads = React.useMemo(() => {
    return visibleLeads.filter(l => {
      if (selectedStage === 'in_discussion' || selectedStage === 'negotiating') {
        return l.stage === 'in_discussion' || l.stage === 'negotiating';
      } else if (selectedStage === 'office_visited' || selectedStage === 'proposal') {
        return l.stage === 'office_visited' || l.stage === 'proposal';
      } else if (selectedStage === 'cold_leads' || selectedStage === 'rotations') {
        return l.stage === 'cold_leads' || l.stage === 'rotations';
      } else {
        return l.stage === selectedStage;
      }
    });
  }, [visibleLeads, selectedStage]);

  // Compute dynamic options with exact candidate counts for the current stage
  const boardCountryOptions = React.useMemo(() => {
    const counts: Record<string, number> = {};
    stageLeads.forEach(lead => {
      if (lead.country) {
        const c = lead.country.toUpperCase().trim();
        counts[c] = (counts[c] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => a.country.localeCompare(b.country));
  }, [stageLeads]);

  const boardPositionOptions = React.useMemo(() => {
    const counts: Record<string, number> = {};
    stageLeads.forEach(lead => {
      if (lead.position) {
        const p = lead.position.toUpperCase().trim();
        counts[p] = (counts[p] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .map(([position, count]) => ({ position, count }))
      .sort((a, b) => a.position.localeCompare(b.position));
  }, [stageLeads]);

  const boardGenderCounts = React.useMemo(() => {
    let male = 0;
    let female = 0;
    stageLeads.forEach(lead => {
      const g = String(lead.gender || '').toUpperCase().trim();
      if (g === 'M' || g === 'MALE') {
        male++;
      } else if (g === 'F' || g === 'FEMALE') {
        female++;
      }
    });
    return { male, female };
  }, [stageLeads]);

  // Map computed counts to SearchableOption arrays
  const searchableCountryOptions = React.useMemo(() => {
    const options = [
      {
        value: 'All',
        label: `All Countries (${stageLeads.length})`,
        icon: <span className="text-xs">🌍</span>
      }
    ];
    boardCountryOptions.forEach(c => {
      const flagUrl = getCountryFlagUrl(c.country);
      options.push({
        value: c.country,
        label: `${c.country} (${c.count})`,
        icon: flagUrl ? (
          <img
            src={flagUrl}
            alt={c.country}
            className="w-4 h-3 object-cover rounded-xs border border-slate-700/50"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-xs">📍</span>
        )
      });
    });
    return options;
  }, [boardCountryOptions, stageLeads.length]);

  const searchablePositionOptions = React.useMemo(() => {
    const options = [
      {
        value: 'All',
        label: `All Positions (${stageLeads.length})`,
        icon: <Briefcase className="h-3 w-3 text-emerald-500 shrink-0" />
      }
    ];
    boardPositionOptions.forEach(p => {
      options.push({
        value: p.position,
        label: `${p.position} (${p.count})`,
        icon: <span className="text-[10px] text-indigo-400 font-bold font-mono">💼</span>
      });
    });
    return options;
  }, [boardPositionOptions, stageLeads.length]);

  const searchableGenderOptions = React.useMemo(() => {
    return [
      {
        value: 'All',
        label: `All Genders (${stageLeads.length})`,
        icon: <span className="text-xs">👥</span>
      },
      {
        value: 'MALE',
        label: `Male (${boardGenderCounts.male})`,
        icon: <span className="text-xs font-black text-sky-400">♂</span>
      },
      {
        value: 'FEMALE',
        label: `Female (${boardGenderCounts.female})`,
        icon: <span className="text-xs font-black text-rose-400">♀</span>
      }
    ];
  }, [boardGenderCounts, stageLeads.length]);

  // Dynamically filter and sort active column leads by Country, Position, and Gender
  const filteredStageLeads = React.useMemo(() => {
    const filtered = stageLeads.filter(l => {
      // Country filter
      if (boardCountryFilter !== 'All') {
        if (!l.country || l.country.toUpperCase().trim() !== boardCountryFilter) return false;
      }

      // Position filter
      if (boardPositionFilter !== 'All') {
        if (!l.position || l.position.toUpperCase().trim() !== boardPositionFilter) return false;
      }

      // Gender filter
      if (boardGenderFilter !== 'All') {
        const leadGender = String(l.gender || '').toUpperCase().trim();
        const targetGender = boardGenderFilter === 'MALE' ? 'M' : 'F';
        if (leadGender !== targetGender && leadGender !== boardGenderFilter) return false;
      }

      return true;
    });

    // Prioritize candidates with unread replies, then sort by date desc
    return sortLeadsByUnreadAndDate(filtered);
  }, [stageLeads, boardCountryFilter, boardPositionFilter, boardGenderFilter]);

  // Lead Card Render Helper to avoid duplicate JSX
  const renderLeadCard = (lead: Lead) => {
    const { prev, next } = getStageNeighbors(lead.stage);
    const r1 = String(lead.remarks1 || '').trim();
    const r2 = String(lead.remarks2 || '').trim();
    const r3 = String(lead.remarks3 || '').trim();
    const adminR = String(lead.adminRemarks || '').trim();
    const assigned = String(lead.assignedTo || '').trim();
    const hasRemarks = r1 !== '' || r2 !== '' || r3 !== '';
    const latestRemarkLabel = r3 !== '' ? '📞 3rd Remark' : r2 !== '' ? '📞 2nd Remark' : '📞 1st Remark';
    const latestRemarkValue = r3 !== '' ? r3 : r2 !== '' ? r2 : r1;

    let formattedDate = 'Recent';
    try {
      if (lead.updatedAt) {
        const d = new Date(lead.updatedAt);
        if (!isNaN(d.getTime())) {
          formattedDate = d.toLocaleDateString(undefined, {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
        }
      }
    } catch {
      formattedDate = 'Recent';
    }

    return (
      <motion.div
        key={lead.id}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        whileHover={{ scale: 1.015, y: -3, borderColor: "var(--color-accent-emerald)" }}
        whileTap={{ scale: 0.995 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        draggable="true"
        onDragStart={(e: any) => {
          if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', lead.id);
            e.dataTransfer.effectAllowed = 'move';
          }
        }}
        className="bg-slate-850 rounded-2xl border border-emerald-900/60 dark:border-emerald-800/50 p-4 shadow-xs cursor-grab active:cursor-grabbing relative group flex flex-col text-left h-full hover:shadow-lg hover:shadow-accent-emerald/5"
        onClick={() => onSelectLead(lead)}
      >
        {/* Target country badge & Stars */}
        <div className="flex justify-between items-center gap-1.5 mb-2">
          <span className="text-[10px] font-extrabold text-[#0f172a] dark:text-slate-200 bg-[#e2e8f0] dark:bg-slate-800 border border-[#cbd5e1] dark:border-slate-700 px-2.5 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1.5 shadow-2xs font-sans">
            {lead.country && getCountryFlagUrl(String(lead.country)) ? (
              <img 
                src={getCountryFlagUrl(String(lead.country))} 
                alt="" 
                className="w-4 h-3 object-cover rounded-2xs inline-block shadow-2xs"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span>🌐</span>
            )}
            {lead.country || 'Pending'}
          </span>
          <div className="flex items-center gap-0.5" title={`${lead.importance || 3} Stars`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star 
                key={i} 
                className={`h-2.5 w-2.5 ${
                  i < (lead.importance || 3) 
                    ? 'text-amber-500 fill-amber-500' 
                    : 'text-slate-700'
                }`} 
                id={`lead-board-star-${lead.id}-${i}`}
              />
            ))}
          </div>
        </div>

        {/* Name / Phone & Message Count Badge */}
        <div className="flex items-center justify-between gap-1.5">
          <h4 className="font-extrabold text-slate-100 text-sm tracking-wide uppercase font-sans truncate">{formatCandidateName(String(lead.name || 'Candidate'))}</h4>
          {(() => {
            const inboundCount = (lead.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
            const totalMsgCount = (lead.messages || []).filter(m => m && m.sender !== 'system').length;
            if (inboundCount > 0) {
              return (
                <span 
                  className="shrink-0 text-[10px] font-black text-emerald-950 dark:text-emerald-300 bg-emerald-400 dark:bg-emerald-950/90 border border-emerald-500/50 dark:border-emerald-700/80 px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs animate-pulse font-mono"
                  title={`${inboundCount} unread WhatsApp message${inboundCount > 1 ? 's' : ''} received (${totalMsgCount} total messages)`}
                >
                  <MessageSquare className="h-2.5 w-2.5 fill-current" />
                  <span>{inboundCount}</span>
                </span>
              );
            }
            return null;
          })()}
        </div>
        <div className="flex items-center justify-between mt-1 pb-1.5 border-b border-slate-700">
          <span className="text-[11px] text-slate-300 font-semibold font-mono tracking-wide">{lead.phone || 'N/A'}</span>
          <span className="text-[10px] bg-[#e2e8f0] dark:bg-slate-800 border border-[#cbd5e1] dark:border-slate-700 font-extrabold px-2.5 py-0.5 rounded-md text-[#0f172a] dark:text-slate-200 uppercase tracking-wider font-mono shadow-2xs">
            {(() => {
              const g = String(lead.gender || '').toUpperCase().trim();
              if (g === 'F' || g === 'FEMALE') return 'F';
              if (g === 'M' || g === 'MALE') return 'M';
              return 'N/A';
            })()}, Age {lead.age || 'N/A'}
          </span>
        </div>

        {/* Position Indicator */}
        <span className="text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-600/60 px-2.5 py-1 rounded-md font-bold uppercase truncate block mt-2 text-left w-full font-sans tracking-wide">
          💼 {lead.position || 'General Applicant'}
        </span>

        {lead.project && (
          <span className="text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-600/60 px-2.5 py-1 rounded-md font-bold uppercase truncate block mt-1 text-left w-full font-sans tracking-wide">
            🎯 Project: {lead.project}
          </span>
        )}

        {lead.source && (
          <span className="text-[11px] text-purple-800 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/80 border border-purple-300 dark:border-purple-500/60 px-2.5 py-1 rounded-md font-bold uppercase truncate block mt-1 text-left w-full font-sans tracking-wide">
            📣 Source: {lead.source}
          </span>
        )}

        {/* Telecaller & Admin Remarks Log Indicators */}
        {hasRemarks ? (
          <div className="bg-emerald-50 dark:bg-slate-900/90 p-2.5 rounded-lg border border-emerald-200/90 dark:border-slate-800 text-[11px] text-left mt-2 shadow-2xs transition-all group/remarks cursor-help hover:bg-emerald-100/80 dark:hover:bg-slate-800">
            <span className="text-[10px] uppercase font-black text-emerald-800 dark:text-emerald-400 block mb-1 tracking-wider flex justify-between items-center font-sans">
              <span>{latestRemarkLabel}</span>
              <span className="text-[8px] text-emerald-700/80 dark:text-slate-500 normal-case font-normal group-hover/remarks:hidden">Hover for full</span>
            </span>
            <p className="text-slate-100 font-extrabold italic font-mono text-[11px] leading-snug truncate group-hover/remarks:whitespace-normal group-hover/remarks:break-words">
              "{latestRemarkValue}"
            </p>
          </div>
        ) : adminR !== '' ? (
          <div className="bg-red-50 dark:bg-slate-900/90 p-2.5 rounded-lg border border-red-200 dark:border-red-900/60 text-[11px] text-left mt-2 shadow-2xs transition-all group/adminRemarks cursor-help hover:bg-red-100/80 dark:hover:bg-slate-800">
            <span className="text-[10px] uppercase font-black text-red-700 dark:text-red-400 block mb-1 tracking-wider flex justify-between items-center font-sans">
              <span className="flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 bg-red-600 dark:bg-red-500 rounded-full animate-pulse" />
                👑 ADMIN REMARK
              </span>
              <span className="text-[8px] text-red-700/80 dark:text-slate-500 normal-case font-normal group-hover/adminRemarks:hidden">Hover for full</span>
            </span>
            <p className="text-red-950 dark:text-red-200 font-extrabold italic font-mono text-[11px] leading-snug truncate group-hover/adminRemarks:whitespace-normal group-hover/adminRemarks:break-words">
              "{adminR}"
            </p>
          </div>
        ) : (
          <div className="text-[11px] text-left text-slate-400 mt-2 font-sans font-medium italic">
            No Remarks Logged
          </div>
        )}

        {/* Coordinator Badge */}
        <div className="text-[11px] mt-2 flex justify-between items-center border-t border-slate-200 dark:border-slate-800/80 pt-2 text-left">
          <span className="text-slate-600 dark:text-slate-300 font-extrabold">Coordinator:</span>
          {assigned !== '' && assigned.toLowerCase() !== 'unassigned' ? (
            <span className="text-purple-800 dark:text-purple-300 font-black bg-purple-50 dark:bg-purple-950/80 border border-purple-300 dark:border-purple-500/60 px-2.5 py-1 rounded-md text-[10px] uppercase tracking-wider font-sans shadow-2xs">
              👤 {assigned}
            </span>
          ) : (
            <span className="text-purple-800 dark:text-purple-300 font-black bg-purple-50 dark:bg-purple-950/80 border border-purple-300 dark:border-purple-500/60 px-2.5 py-1 rounded text-[10px] uppercase tracking-wider font-sans shadow-2xs">
              👤 UNASSIGNED
            </span>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1 min-h-[8px]" />

        {/* Move Controls */}
        <div className="flex justify-between items-center gap-1 pt-1.5 border-t border-slate-750 mt-2">
          <div>
            {prev ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateStage(lead.id, prev);
                }}
                className="p-1 px-2 rounded-md bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-slate-100 transition-all flex items-center gap-0.5 border border-slate-700/60 cursor-pointer"
                title={`Move back to ${prev}`}
              >
                <ArrowLeft className="h-3 w-3" />
              </button>
            ) : <div className="w-6" />}
          </div>

          <span className="text-[9px] text-slate-500 font-bold font-mono">
            {formattedDate}
          </span>

          <div>
            {next ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateStage(lead.id, next);
                }}
                className="p-1 px-2 rounded-md bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-accent-purple transition-all flex items-center gap-0.5 border border-slate-700/60 cursor-pointer"
                title={`Advance to ${next}`}
              >
                <ArrowRight className="h-3 w-3" />
              </button>
            ) : <div className="w-6" />}
          </div>
        </div>

      </motion.div>
    );
  };

  return (
    <div className="space-y-6" id="cgp-leads-pipeline">

      {/* Pipeline Border Card Container */}
      <div className="bg-slate-950/40 rounded-3xl border border-emerald-900/60 dark:border-emerald-800/60 p-6 shadow-xl text-left">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-5 border-b border-slate-700 pb-4 gap-4">
          {/* Left Side: Controls in One Straight Line in exact requested order */}
          <div className="flex flex-wrap items-center gap-3">
            {/* 1. Search option */}
            <div className="relative w-full sm:w-60 text-left shrink-0">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search candidate..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl border border-slate-750 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-900 text-slate-100 placeholder-slate-500 font-medium"
              />
            </div>

            {/* 2. All coordinators filter - only in Admin View */}
            {userRole === 'admin' && (
              <SearchableSelect
                value={coordinatorFilter}
                onChange={setCoordinatorFilter}
                options={coordinatorOptions}
                className="text-xs px-3 py-1.5 rounded-xl border border-emerald-700 dark:border-emerald-600 bg-emerald-800 dark:bg-emerald-950 hover:bg-emerald-900 dark:hover:bg-emerald-900 text-white dark:text-emerald-100 font-black focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer uppercase shadow-xs shrink-0"
              />
            )}

            {/* Remarks wise Filter */}
            <SearchableSelect
              value={remarksFilter}
              onChange={setRemarksFilter}
              options={remarksOptions}
              className="text-xs px-3 py-1.5 rounded-xl border border-emerald-700 dark:border-emerald-600 bg-emerald-800 dark:bg-emerald-950 hover:bg-emerald-900 dark:hover:bg-emerald-900 text-white dark:text-emerald-100 font-black focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer uppercase shadow-xs shrink-0"
            />

            {/* 3. Time filters: All, Today, Yesterday, Date */}
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-750 p-1 rounded-xl shadow-inner shrink-0">
              {[
                { id: 'all', label: 'All' },
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'date-wise', label: 'Date' }
              ].map(filter => {
                const isActive = pipelineDateFilter === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => {
                      if (isActive) {
                        setPipelineDateFilter('all');
                      } else {
                        setPipelineDateFilter(filter.id as any);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                      isActive
                        ? 'bg-emerald-800 text-white border border-emerald-600/60 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>

            {pipelineDateFilter === 'date-wise' && (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-xl text-left animate-fade-in shrink-0">
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="bg-transparent text-[10px] text-slate-100 font-extrabold outline-none border-0 p-0 cursor-pointer h-4 w-24 focus:ring-0 [color-scheme:dark]"
                  style={{ colorScheme: 'dark' }}
                />
                <span className="text-[9px] text-slate-500 font-bold font-mono">to</span>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="bg-transparent text-[10px] text-slate-100 font-extrabold outline-none border-0 p-0 cursor-pointer h-4 w-24 focus:ring-0 [color-scheme:dark]"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
            )}

            {/* 4. View Switcher segment button styled beautifully (Pipeline & Classic) */}
            <div className="flex items-center bg-slate-900 border border-slate-750 p-1 rounded-xl shadow-inner shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('hub')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                  viewMode === 'hub'
                    ? 'bg-emerald-800 text-white border border-emerald-600/60 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="h-3 w-3" />
                Pipeline View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('board')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                  viewMode === 'board'
                    ? 'bg-emerald-800 text-white border border-emerald-600/60 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Trello className="h-3 w-3" />
                Classic View
              </button>
            </div>
          </div>

          {/* Right Side: Results indicator */}
          <div className="flex items-center shrink-0">
            {pipelineDateFilter !== 'all' ? (
              <div className="text-[10px] text-slate-400 font-bold bg-slate-900 border border-slate-750 px-3 py-1.5 rounded-xl">
                Filtered: <span className="text-accent-emerald font-black font-mono">{visibleLeads.length} matches</span>
              </div>
            ) : (
              <div className="text-[10px] text-slate-400 font-bold bg-slate-900 border border-slate-750 px-3 py-1.5 rounded-xl">
                Showing: <span className="text-accent-emerald font-black font-mono">{visibleLeads.length} candidates</span>
              </div>
            )}
          </div>
        </div>

        {/* View Layout Conditional Render */}
        {viewMode === 'hub' ? (
          <div className="space-y-6 animate-fade-in">
            {/* Stage Selector Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
              {COLUMNS.map((col) => {
                const colLeads = visibleLeads.filter(l => {
                  if (col.id === 'in_discussion') return l.stage === 'in_discussion' || l.stage === 'negotiating';
                  if (col.id === 'office_visited') return l.stage === 'office_visited' || l.stage === 'proposal';
                  if (col.id === 'cold_leads') return l.stage === 'cold_leads' || l.stage === 'rotations';
                  return l.stage === col.id;
                });
                const colUnreadCount = colLeads.reduce((acc, lead) => {
                  const leadUnread = (lead.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
                  return acc + leadUnread;
                }, 0);
                const isSelected = selectedStage === col.id || 
                  (selectedStage === 'negotiating' && col.id === 'in_discussion') ||
                  (selectedStage === 'proposal' && col.id === 'office_visited') ||
                  (selectedStage === 'rotations' && col.id === 'cold_leads');
                const isDraggedOver = draggedOverColumn === col.id;
                
                // Map icons dynamically for 7 stages
                let IconComponent = Inbox;
                if (col.id === 'in_discussion' || col.id === 'negotiating') IconComponent = Briefcase;
                else if (col.id === 'strong_opportunity') IconComponent = Zap;
                else if (col.id === 'office_visited' || col.id === 'proposal') IconComponent = Calendar;
                else if (col.id === 'won') IconComponent = ShieldCheck;
                else if (col.id === 'cold_leads' || col.id === 'rotations') IconComponent = Snowflake;
                else if (col.id === 'lost') IconComponent = X;

                // Determine visual accent based on stage
                let selectedClass = '';
                let badgeColor = '';
                let iconColor = 'text-slate-400';
                let unselectedClass = 'bg-slate-850 border-slate-750 hover:border-slate-600 text-slate-200 hover:bg-slate-800/50 shadow-3xs';
                
                if (col.id === 'new') {
                  selectedClass = isSelected ? 'bg-sky-950/20 dark:bg-sky-950/80 border-2 border-sky-600 dark:border-sky-500 text-slate-100 shadow-md ring-2 ring-sky-500/20' : '';
                  badgeColor = isSelected ? 'bg-sky-500/20 text-sky-700 dark:text-sky-400 border-sky-500/30' : 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20';
                  if (isSelected) iconColor = 'text-sky-600 dark:text-sky-400';
                } else if (col.id === 'in_discussion' || col.id === 'negotiating') {
                  selectedClass = inDiscussionPctInfo.selectedClass;
                  badgeColor = inDiscussionPctInfo.badgeColor;
                  iconColor = inDiscussionPctInfo.iconColor;
                  unselectedClass = inDiscussionPctInfo.unselectedClass;
                } else if (col.id === 'strong_opportunity') {
                  selectedClass = isSelected ? 'bg-amber-950/25 dark:bg-amber-950/80 border-2 border-amber-500 text-slate-100 shadow-md ring-2 ring-amber-500/20' : '';
                  badgeColor = isSelected ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
                  if (isSelected) iconColor = 'text-amber-500 dark:text-amber-400';
                } else if (col.id === 'office_visited' || col.id === 'proposal') {
                  selectedClass = isSelected ? 'bg-purple-950/20 dark:bg-purple-950/80 border-2 border-purple-600 dark:border-purple-500 text-slate-100 shadow-md ring-2 ring-purple-500/20' : '';
                  badgeColor = isSelected ? 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30' : 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20';
                  if (isSelected) iconColor = 'text-purple-600 dark:text-purple-400';
                } else if (col.id === 'won') {
                  selectedClass = isSelected ? 'bg-emerald-950/20 dark:bg-emerald-950/80 border-2 border-emerald-600 dark:border-emerald-500 text-slate-100 shadow-md ring-2 ring-emerald-500/20' : '';
                  badgeColor = isSelected ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
                  if (isSelected) iconColor = 'text-emerald-600 dark:text-emerald-400';
                } else if (col.id === 'cold_leads' || col.id === 'rotations') {
                  selectedClass = isSelected ? 'bg-blue-950/20 dark:bg-blue-950/80 border-2 border-blue-600 dark:border-blue-500 text-slate-100 shadow-md ring-2 ring-blue-500/20' : '';
                  badgeColor = isSelected ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20';
                  if (isSelected) iconColor = 'text-blue-600 dark:text-blue-400';
                } else if (col.id === 'lost') {
                  selectedClass = isSelected ? 'bg-rose-950/20 dark:bg-rose-950/80 border-2 border-rose-600 dark:border-rose-500 text-slate-100 shadow-md ring-2 ring-rose-500/20' : '';
                  badgeColor = isSelected ? 'bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-500/30' : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20';
                  if (isSelected) iconColor = 'text-rose-600 dark:text-rose-400';
                }

                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => setSelectedStage(col.id)}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDragEnter={() => setDraggedOverColumn(col.id)}
                    onDragLeave={() => setDraggedOverColumn(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDraggedOverColumn(null);
                      const leadId = e.dataTransfer.getData('text/plain');
                      if (leadId) {
                        onUpdateStage(leadId, col.id);
                      }
                    }}
                    className={`group p-2.5 px-3 rounded-2xl border text-left transition-all duration-200 select-none cursor-pointer flex flex-col justify-between h-[112px] min-h-[112px] relative overflow-hidden ${
                      isDraggedOver
                        ? 'border-accent-purple bg-accent-purple/10 scale-[1.03] ring-2 ring-accent-purple/40 shadow-lg'
                        : isSelected
                        ? `${selectedClass} scale-[1.02]`
                        : unselectedClass
                    }`}
                  >
                    <div className="relative z-10 flex items-start justify-between w-full">
                      <div className={`text-sm font-bold flex items-center justify-center w-7.5 h-7.5 rounded-lg border ${isSelected ? 'bg-slate-900/20 border-slate-700' : 'bg-slate-900 border-slate-800'}`}>
                        <IconComponent className={`w-4 h-4 ${iconColor}`} />
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={`text-xs sm:text-[13px] font-black px-2 py-0.5 rounded-md font-mono border ${badgeColor}`}>
                          {colLeads.length} {colLeads.length === 1 ? 'Lead' : 'Leads'}
                        </span>
                        {col.id === 'in_discussion' && (
                          <span className={`text-[9px] font-extrabold font-mono ${inDiscussionPctInfo.textColor}`} title={`In Discussion load: ${inDiscussionPctInfo.inDiscussionCount}/${inDiscussionPctInfo.totalAssignedLifetime} lifetime assigned leads (${inDiscussionPctInfo.percentage.toFixed(1)}%)`}>
                            {inDiscussionPctInfo.percentage.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="relative z-10 mt-1.5 w-full">
                      <div className="flex items-center justify-between gap-1 w-full">
                        <h3 className={`font-black text-[11.5px] sm:text-[13px] tracking-wide uppercase leading-tight line-clamp-2 ${isSelected ? 'text-slate-100' : 'text-slate-200'}`}>
                          {col.title}
                        </h3>
                        {colUnreadCount > 0 && (
                          <span 
                            className="shrink-0 flex items-center gap-1 bg-emerald-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full animate-pulse shadow-xs"
                            title={`${colUnreadCount} unread WhatsApp messages`}
                          >
                            <MessageSquare className="h-2.5 w-2.5 fill-current text-white" />
                            <span>{colUnreadCount}</span>
                          </span>
                        )}
                      </div>
                      <p className={`text-[9px] font-bold mt-0.5 ${isSelected ? 'text-slate-100 opacity-90' : 'text-slate-400'}`}>
                        {isSelected ? '● Selected' : 'Click to view'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Active Stage Container (Active Jobs Hub style) */}
            {selectedStage && (
              <div className="bg-slate-950/40 border border-slate-700 rounded-3xl p-6 shadow-3xs text-left space-y-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-slate-700 pb-4 gap-4">
                  {/* Left Title, Stats AND Filters grouped beautifully with an increased generous gap */}
                  <div className="flex flex-col md:flex-row md:items-center gap-14 md:gap-28 min-w-0 flex-1">
                    <div>
                      <h3 className="text-sm sm:text-base font-black text-slate-100 uppercase tracking-wide flex items-center gap-2">
                        📂 {COLUMNS.find(c => c.id === selectedStage || (selectedStage === 'negotiating' && c.id === 'in_discussion') || (selectedStage === 'proposal' && c.id === 'office_visited') || (selectedStage === 'rotations' && c.id === 'cold_leads'))?.title} Candidates
                      </h3>
                      <p className="text-xs text-slate-400 font-bold mt-0.5">
                        Showing <span className="text-emerald-400 font-mono font-extrabold">{filteredStageLeads.length}</span> active records in pipeline phase
                      </p>
                    </div>

                    {/* Inline Premium Filters next to title with a nice gap */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      {/* Country Filter */}
                      <SearchableSelect
                        value={boardCountryFilter}
                        onChange={setBoardCountryFilter}
                        options={searchableCountryOptions}
                        className="text-xs px-3 py-1.5 rounded-xl border border-slate-750 dark:border-slate-700 bg-slate-900 hover:bg-slate-850 text-slate-200 font-black cursor-pointer uppercase transition-all shadow-xs shrink-0"
                        dropdownClassName="dark:bg-slate-950 border-slate-700 w-60"
                      />
 
                      {/* Position Filter */}
                      <SearchableSelect
                        value={boardPositionFilter}
                        onChange={setBoardPositionFilter}
                        options={searchablePositionOptions}
                        className="text-xs px-3 py-1.5 rounded-xl border border-slate-750 dark:border-slate-700 bg-slate-900 hover:bg-slate-850 text-slate-200 font-black cursor-pointer uppercase transition-all shadow-xs shrink-0 max-w-[180px] truncate"
                        dropdownClassName="dark:bg-slate-950 border-slate-700 w-64"
                      />
 
                      {/* Gender Filter */}
                      <SearchableSelect
                        value={boardGenderFilter}
                        onChange={setBoardGenderFilter}
                        options={searchableGenderOptions}
                        className="text-xs px-3 py-1.5 rounded-xl border border-slate-750 dark:border-slate-700 bg-slate-900 hover:bg-slate-850 text-slate-200 font-black cursor-pointer uppercase transition-all shadow-xs shrink-0"
                        dropdownClassName="dark:bg-slate-950 border-slate-700 w-48"
                      />

                      {/* Reset Filters button if any are active */}
                      {(boardCountryFilter !== 'All' || boardPositionFilter !== 'All' || boardGenderFilter !== 'All') && (
                        <button
                          onClick={() => {
                            setBoardCountryFilter('All');
                            setBoardPositionFilter('All');
                            setBoardGenderFilter('All');
                          }}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white text-xs font-black rounded-xl transition cursor-pointer border border-slate-700"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Status Indicator Badge */}
                  {selectedStage === 'in_discussion' || selectedStage === 'negotiating' ? (
                    <span className={`self-start lg:self-center text-[10px] uppercase font-black px-3 py-1.5 rounded-full font-mono border ${inDiscussionPctInfo.badgeColor}`}>
                      In Discussion Load: {inDiscussionPctInfo.percentage.toFixed(1)}% ({inDiscussionPctInfo.inDiscussionCount}/{inDiscussionPctInfo.totalAssignedLifetime} assigned)
                    </span>
                  ) : (
                    <span className="self-start lg:self-center text-[10px] uppercase font-black text-accent-purple bg-purple-950/40 border border-purple-900/30 px-3 py-1.5 rounded-full font-mono">
                      Active Directory
                    </span>
                  )}
                </div>

                {/* Grid layout of lead cards under the selected stage */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 py-1">
                  {filteredStageLeads.length > 0 ? (
                    filteredStageLeads.map((lead) => renderLeadCard(lead))
                  ) : (
                    <div className="col-span-full border border-dashed border-slate-750 rounded-2xl flex flex-col items-center justify-center py-20 text-slate-500 space-y-2 bg-slate-900/20">
                      <Inbox className="h-10 w-10 opacity-30 text-slate-400" />
                      <span className="text-sm font-bold text-slate-400">No candidates currently match filters in this stage</span>
                      <p className="text-xs text-slate-500 max-w-xs text-center">
                        Try modifying your Country, Target Position, or Gender filter choices.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Classic horizontal scrollable Kanban channels */
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-accent-purple/5 via-transparent to-accent-emerald/5 pointer-events-none rounded-2xl" />
            
            {/* Grid Columns */}
            <div className="flex gap-4 overflow-x-auto pb-4 w-full relative z-10 xl:justify-start" id="kanban-pipeline-columns">
              {COLUMNS.map(col => {
                const colLeads = visibleLeads.filter(l => {
                  if (col.id === 'in_discussion') return l.stage === 'in_discussion' || l.stage === 'negotiating';
                  if (col.id === 'office_visited') return l.stage === 'office_visited' || l.stage === 'proposal';
                  if (col.id === 'cold_leads') return l.stage === 'cold_leads' || l.stage === 'rotations';
                  return l.stage === col.id;
                });
                const colClassicUnreadCount = colLeads.reduce((acc, lead) => {
                  const leadUnread = (lead.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
                  return acc + leadUnread;
                }, 0);
                const isDraggedOver = draggedOverColumn === col.id;

                return (
                  <div
                    key={col.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDragEnter={() => setDraggedOverColumn(col.id)}
                    onDragLeave={() => setDraggedOverColumn(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDraggedOverColumn(null);
                      const leadId = e.dataTransfer.getData('text/plain');
                      if (leadId) {
                        onUpdateStage(leadId, col.id);
                      }
                    }}
                    className={`rounded-2xl border p-3.5 flex flex-col min-h-[580px] w-[280px] sm:w-[300px] md:w-[310px] shrink-0 h-full text-left shadow-md transition-all duration-200 ${
                      isDraggedOver 
                        ? 'border-accent-purple bg-accent-purple/10 scale-[1.01] shadow-xl ring-2 ring-accent-purple/20' 
                        : 'border-slate-700 bg-slate-900/90'
                    }`}
                  >
                    {/* Column Header */}
                    <div className="flex items-center justify-between mb-4 border-b border-slate-700 pb-2.5 min-h-[44px]">
                      <div className="flex items-center justify-between w-full gap-2">
                        <span className={`text-[9px] sm:text-[9.5px] font-black uppercase tracking-tight px-2 py-1 rounded-md leading-normal break-words inline-block ${
                          colClassicUnreadCount > 0 
                            ? 'bg-rose-600 text-white animate-pulse' 
                            : col.headerColor
                        }`}>
                          {col.title} ({colClassicUnreadCount > 0 ? `${colLeads.length} - ${colClassicUnreadCount}` : colLeads.length}{col.id === 'in_discussion' ? ` • ${inDiscussionPctInfo.percentage.toFixed(1)}%` : ''})
                        </span>
                        {colClassicUnreadCount > 0 && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-600 text-white font-mono animate-pulse shrink-0 flex items-center gap-0.5" title={`${colClassicUnreadCount} unread WhatsApp messages`}>
                            ✉ {colClassicUnreadCount}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Leads Stack */}
                    <div className="space-y-3.5 flex-1 overflow-y-auto max-h-[550px] scrollbar-none py-2 px-0.5">
                      {(() => {
                        const sorted = sortLeadsByUnreadAndDate(colLeads);
                        return sorted.length > 0 ? (
                          sorted.map(lead => renderLeadCard(lead))
                        ) : (
                          <div className="h-full border border-dashed border-slate-750 rounded-xl flex flex-col items-center justify-center py-10 text-slate-500 space-y-1 bg-slate-900/20">
                            <Briefcase className="h-4.5 w-4.5 opacity-40 text-slate-600" />
                            <span className="text-xs font-bold text-slate-500">No leads in channel</span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
