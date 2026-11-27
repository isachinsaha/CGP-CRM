import React, { useState } from 'react';
import { Lead, LeadStage, Coordinator } from '../types.ts';
import { 
  MessageSquare, 
  Briefcase, 
  Calendar, 
  ShieldCheck, 
  Inbox,
  X,
  Search,
  Zap,
  Snowflake
} from 'lucide-react';
import { getCountryFlagUrl, getEffectiveIntake, isCoordinatorMatch } from '../utils';
import { MultiSearchableSelect } from './MultiSearchableSelect.tsx';
import { LeadCard } from './LeadCard.tsx';

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
  
  // Selected stage for Pipeline Hub View
  const [selectedStage, setSelectedStage] = useState<LeadStage>('new');

  // Bucket filtering for agents
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null);

  // Coordinator multi-select filter state (for Admin View; [] = All)
  const [coordinatorFilter, setCoordinatorFilter] = useState<string[]>([]);

  // Search input state for Pipeline
  const [searchQuery, setSearchQuery] = useState('');

  // Remarks multi-select filter state ([] = All)
  const [remarksFilter, setRemarksFilter] = useState<string[]>([]);

  // Country, Position, Gender, and Tag multi-select Filters for selected stage ([] = All)
  const [boardCountryFilter, setBoardCountryFilter] = useState<string[]>([]);
  const [boardPositionFilter, setBoardPositionFilter] = useState<string[]>([]);
  const [boardGenderFilter, setBoardGenderFilter] = useState<string[]>([]);
  const [boardTagFilter, setBoardTagFilter] = useState<string[]>([]);

  // Reset stage filters when stage is switched
  React.useEffect(() => {
    setBoardCountryFilter([]);
    setBoardPositionFilter([]);
    setBoardGenderFilter([]);
    setBoardTagFilter([]);
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

  // Date filter multi-select state: [] = All, values in ['today', 'yesterday', 'date-wise']
  const [pipelineDateFilter, setPipelineDateFilter] = useState<string[]>([]);
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
      lifetimeScopeLeads = leads.filter(l => isCoordinatorMatch(l.assignedTo, currentAgentId, coordinators));
    } else if (coordinatorFilter.length > 0) {
      lifetimeScopeLeads = leads.filter(l =>
        coordinatorFilter.some(cf => isCoordinatorMatch(l.assignedTo, cf, coordinators))
      );
    }

    const totalAssignedLifetime = lifetimeScopeLeads.length;
    const inDiscussionCount = lifetimeScopeLeads.filter(l => l.stage === 'in_discussion' || l.stage === 'negotiating').length;
    const percentage = totalAssignedLifetime > 0 ? (inDiscussionCount / totalAssignedLifetime) * 100 : 0;

    let level: 'green' | 'yellow' | 'orange' | 'red' = 'green';
    let rangeLabel = '0-25%';
    let selectedClass = 'bg-emerald-50 dark:bg-emerald-950/80 border-2 border-emerald-500 text-emerald-950 dark:text-slate-100 shadow-md ring-2 ring-emerald-500/20';
    let unselectedClass = 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-600/35 dark:border-emerald-500/20 hover:border-emerald-500 text-emerald-900 dark:text-emerald-200 shadow-3xs';
    let badgeColor = 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-500/40 font-black';
    let iconColor = 'text-emerald-600 dark:text-emerald-400';
    let headerColor = 'text-emerald-900 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 font-bold border border-emerald-300 dark:border-emerald-800/50';
    let textColor = 'text-emerald-700 dark:text-emerald-300';

    if (percentage >= 75) {
      level = 'red';
      rangeLabel = '>75%';
      selectedClass = 'bg-rose-50 dark:bg-rose-950/80 border-2 border-rose-500 text-rose-950 dark:text-slate-100 shadow-md ring-2 ring-rose-500/20';
      unselectedClass = 'bg-rose-50/50 dark:bg-rose-950/20 border-emerald-600/35 dark:border-emerald-500/20 hover:border-rose-500 text-rose-900 dark:text-rose-200 shadow-3xs';
      badgeColor = 'bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-500/40 font-black';
      iconColor = 'text-rose-600 dark:text-rose-400';
      headerColor = 'text-rose-900 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/60 font-bold border border-rose-300 dark:border-rose-800/50';
      textColor = 'text-rose-700 dark:text-rose-300';
    } else if (percentage >= 50) {
      level = 'orange';
      rangeLabel = '50-75%';
      selectedClass = 'bg-orange-50 dark:bg-orange-950/85 border-2 border-orange-600 text-orange-950 dark:text-slate-100 shadow-md ring-2 ring-orange-600/30';
      unselectedClass = 'bg-orange-50/50 dark:bg-orange-950/30 border-emerald-600/35 dark:border-emerald-500/20 hover:border-orange-500 text-orange-900 dark:text-orange-200 shadow-3xs';
      badgeColor = 'bg-orange-100 dark:bg-orange-500/20 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-500/60 font-black';
      iconColor = 'text-orange-600 dark:text-orange-500';
      headerColor = 'text-orange-900 dark:text-orange-200 bg-orange-100 dark:bg-orange-950/80 font-bold border border-orange-300 dark:border-orange-700/70';
      textColor = 'text-orange-700 dark:text-orange-300';
    } else if (percentage >= 25) {
      level = 'yellow';
      rangeLabel = '25-50%';
      selectedClass = 'bg-yellow-50 dark:bg-yellow-950/85 border-2 border-yellow-400 text-yellow-950 dark:text-yellow-100 shadow-md ring-2 ring-yellow-400/40';
      unselectedClass = 'bg-yellow-50/50 dark:bg-yellow-950/25 border-emerald-600/35 dark:border-emerald-500/20 hover:border-yellow-300 text-yellow-900 dark:text-yellow-200 shadow-3xs';
      badgeColor = 'bg-yellow-100 dark:bg-yellow-400/25 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-400/60 font-black';
      iconColor = 'text-yellow-600 dark:text-yellow-300';
      headerColor = 'text-yellow-900 dark:text-yellow-200 bg-yellow-100 dark:bg-yellow-950/80 font-bold border border-yellow-300 dark:border-yellow-400/60';
      textColor = 'text-yellow-700 dark:text-yellow-300';
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
  }, [leads, userRole, currentAgentId, coordinatorFilter, coordinators]);

  const COLUMNS: Column[] = [
    { id: 'new', title: '1. New Inbound', color: 'border-sky-900/40 bg-sky-950/15', headerColor: 'text-sky-400 bg-sky-950/40 font-medium' },
    { id: 'in_discussion', title: '2. In Discussion', color: 'border-slate-750 bg-slate-900/35', headerColor: inDiscussionPctInfo.headerColor },
    { id: 'strong_opportunity', title: '3. Strong Opportunity', color: 'border-sky-900/40 bg-sky-950/15', headerColor: 'text-sky-400 bg-sky-950/40 font-medium' },
    { id: 'office_visited', title: '4. Office Visited / Interview', color: 'border-purple-900/40 bg-purple-950/15', headerColor: 'text-purple-400 bg-purple-950/40 font-medium' },
    { id: 'won', title: '5. Won', color: 'border-emerald-900/40 bg-emerald-950/15', headerColor: 'text-emerald-400 bg-emerald-950/40 font-semibold' },
    { id: 'cold_leads', title: '6. Cold Leads', color: 'border-blue-900/40 bg-blue-950/15', headerColor: 'text-blue-400 bg-blue-950/40 font-medium' },
    { id: 'lost', title: '7. Lost', color: 'border-slate-750 bg-slate-900/20', headerColor: 'text-slate-400 bg-slate-800' }
  ];

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
      filtered = filtered.filter(lead => isCoordinatorMatch(lead.assignedTo, currentAgentId, coordinators));
    }

    // Coordinator Multi-Filter (only in Admin view)
    if (userRole === 'admin' && coordinatorFilter.length > 0) {
      filtered = filtered.filter(lead =>
        coordinatorFilter.some(cf => isCoordinatorMatch(lead.assignedTo, cf, coordinators))
      );
    }

    // Multi-select Date range filter ([] = all)
    if (pipelineDateFilter.length > 0) {
      const todayStr = new Date().toLocaleDateString('en-CA');
      const todayStart = new Date(todayStr + 'T00:00:00').getTime();
      const todayEnd = new Date(todayStr + 'T23:59:59').getTime();

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('en-CA');
      const yesterdayStart = new Date(yesterdayStr + 'T00:00:00').getTime();
      const yesterdayEnd = new Date(yesterdayStr + 'T23:59:59').getTime();

      const customStart = filterStartDate ? new Date(filterStartDate + 'T00:00:00').getTime() : 0;
      const customEnd = filterEndDate ? new Date(filterEndDate + 'T23:59:59').getTime() : Infinity;

      filtered = filtered.filter(lead => {
        const st = String(lead.stage || 'new').toLowerCase().trim();
        const stageDate = lead.stageChangedAt || lead.createdAt || lead.entryDate;
        const datesToTry = st === 'new'
          ? [lead.stageChangedAt, lead.assignDate, lead.createdAt, lead.entryDate]
          : [stageDate];
        return pipelineDateFilter.some(df => {
          let startMs = 0;
          let endMs = Infinity;
          if (df === 'today') {
            startMs = todayStart;
            endMs = todayEnd;
          } else if (df === 'yesterday') {
            startMs = yesterdayStart;
            endMs = yesterdayEnd;
          } else if (df === 'date-wise') {
            startMs = customStart;
            endMs = customEnd;
          }
          return datesToTry.some(dateStr => {
            if (!dateStr) return false;
            const ms = new Date(dateStr).getTime();
            if (isNaN(ms)) return false;
            return ms >= startMs && ms <= endMs;
          });
        });
      });
    }

    // Remarks Wise Multi-Filter
    if (remarksFilter.length > 0) {
      filtered = filtered.filter(lead => {
        const r1 = !!(lead.remarks1 && lead.remarks1.trim());
        const r2 = !!(lead.remarks2 && lead.remarks2.trim());
        const r3 = !!(lead.remarks3 && lead.remarks3.trim());

        return remarksFilter.some(rf => {
          if (rf === 'remarks1') return r1;
          if (rf === 'remarks2') return r2;
          if (rf === 'remarks3') return r3;
          if (rf === 'remarks1Only') return r1 && !r2 && !r3;
          if (rf === 'remarks2Only') return r2 && !r1 && !r3;
          if (rf === 'remarks3Only') return r3 && !r1 && !r2;
          if (rf === 'noRemarks') return !r1 && !r2 && !r3;
          if (rf === 'allRemarks') return r1 && r2 && r3;
          return true;
        });
      });
    }

    return filtered;
  }, [leads, searchQuery, userRole, currentAgentId, coordinatorFilter, pipelineDateFilter, filterStartDate, filterEndDate, remarksFilter, coordinators]);

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

  const searchableTagOptions = React.useMemo(() => {
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    stageLeads.forEach(l => {
      if (l.tags && Array.isArray(l.tags)) {
        l.tags.forEach(t => {
          if (t && t.trim()) {
            const trimmed = t.trim();
            const lower = trimmed.toLowerCase();
            if (!seen.has(lower)) {
              seen.add(lower);
              deduplicated.push(trimmed);
            }
          }
        });
      }
    });
    
    // Sort and map tags
    const sortedTags = deduplicated.sort((a, b) => a.localeCompare(b));
    
    // Create Tag Count map for current stageLeads
    const tagCounts: { [tag: string]: number } = {};
    stageLeads.forEach(l => {
      if (l.tags && Array.isArray(l.tags)) {
        // Dedup tags per lead to avoid double counting
        const uniqueLeadTags = Array.from(new Set(l.tags.map(t => t.trim().toLowerCase())));
        uniqueLeadTags.forEach(lowTag => {
          // Find original case
          const orig = sortedTags.find(ot => ot.toLowerCase() === lowTag);
          if (orig) {
            tagCounts[orig] = (tagCounts[orig] || 0) + 1;
          }
        });
      }
    });

    const options = [
      {
        value: 'All',
        label: `All Tags (${stageLeads.length})`,
        icon: <span className="text-xs">🏷️</span>
      }
    ];

    sortedTags.forEach(tag => {
      options.push({
        value: tag,
        label: `${tag} (${tagCounts[tag] || 0})`,
        icon: <span className="text-xs text-indigo-400">🏷️</span>
      });
    });

    return options;
  }, [stageLeads]);

  // Dynamically filter and sort active column leads by Country, Position, Gender, and Tags (all multi-select)
  const filteredStageLeads = React.useMemo(() => {
    const filtered = stageLeads.filter(l => {
      // Country filter
      if (boardCountryFilter.length > 0) {
        const cUpper = String(l.country || '').toUpperCase().trim();
        if (!cUpper || !boardCountryFilter.some(cf => cf.toUpperCase().trim() === cUpper)) return false;
      }

      // Position filter
      if (boardPositionFilter.length > 0) {
        const pUpper = String(l.position || '').toUpperCase().trim();
        if (!pUpper || !boardPositionFilter.some(pf => pf.toUpperCase().trim() === pUpper)) return false;
      }

      // Gender filter
      if (boardGenderFilter.length > 0) {
        const leadGender = String(l.gender || '').toUpperCase().trim();
        const matchesGender = boardGenderFilter.some(gf => {
          const targetShort = gf === 'MALE' ? 'M' : gf === 'FEMALE' ? 'F' : gf;
          return leadGender === targetShort || leadGender === gf;
        });
        if (!matchesGender) return false;
      }

      // Tag filter
      if (boardTagFilter.length > 0) {
        if (
          !l.tags ||
          !Array.isArray(l.tags) ||
          !boardTagFilter.some(tf => l.tags!.some(t => t.trim().toLowerCase() === tf.trim().toLowerCase()))
        ) {
          return false;
        }
      }

      return true;
    });

    // Prioritize candidates with unread replies, then sort by date desc
    return sortLeadsByUnreadAndDate(filtered);
  }, [stageLeads, boardCountryFilter, boardPositionFilter, boardGenderFilter, boardTagFilter]);

  const hasTopFilters =
    coordinatorFilter.length > 0 ||
    remarksFilter.length > 0 ||
    pipelineDateFilter.length > 0 ||
    searchQuery.trim() !== '';

  return (
    <div className="space-y-4 2xl:space-y-6" id="cgp-leads-pipeline">

      {/* Pipeline Border Card Container */}
      <div className="bg-slate-950/40 rounded-3xl border border-emerald-600/35 dark:border-emerald-500/20 p-3.5 sm:p-4 2xl:p-6 shadow-xl text-left">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between mb-4 2xl:mb-5 border-b border-slate-700 pb-3.5 2xl:pb-4 gap-3">
          {/* Left Side: Controls wrapping nicely on small screens to prevent clipping */}
          <div className="flex flex-wrap items-center gap-2 2xl:gap-3.5 w-full xl:w-auto pb-1 xl:pb-0">
            {/* 1. Search option */}
            <div className="relative w-40 2xl:w-56 text-left shrink-0">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search candidate..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-[0.6875rem] xl:text-xs rounded-xl border border-slate-750 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-900 text-slate-100 placeholder-slate-500 font-semibold"
              />
            </div>

            {/* 2. All coordinators multi-select filter - only in Admin View */}
            {userRole === 'admin' && (
              <MultiSearchableSelect
                values={coordinatorFilter}
                onChange={setCoordinatorFilter}
                options={coordinatorOptions}
                allLabel="👤 All Coordinators"
                placeholder="Search coordinators..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-white"
                activeBorderClass="border-emerald-400 ring-1 ring-emerald-400/40"
                className="text-[11px] xl:text-xs px-2.5 xl:px-3.5 py-1.5 rounded-xl border border-emerald-700 dark:border-emerald-600 bg-emerald-800 dark:bg-emerald-950 hover:bg-emerald-900 dark:hover:bg-emerald-900 text-white dark:text-emerald-100 font-black focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer uppercase shadow-xs shrink-0"
              />
            )}

            {/* Remarks wise multi-select Filter */}
            <MultiSearchableSelect
              values={remarksFilter}
              onChange={setRemarksFilter}
              options={remarksOptions}
              allLabel={`💬 Remarks: All (${leads.length})`}
              placeholder="Search remarks filter..."
              badgeColor="bg-emerald-600"
              activeTextClass="text-white"
              activeBorderClass="border-emerald-400 ring-1 ring-emerald-400/40"
              className="text-[11px] xl:text-xs px-2.5 xl:px-3.5 py-1.5 rounded-xl border border-emerald-700 dark:border-emerald-600 bg-emerald-800 dark:bg-emerald-950 hover:bg-emerald-900 dark:hover:bg-emerald-900 text-white dark:text-emerald-100 font-black focus:outline-none focus:ring-1 focus:ring-emerald-400 cursor-pointer uppercase shadow-xs shrink-0"
            />

            {/* 3. Multi-select Time filters: All, Today, Yesterday, Date */}
            <div className="flex items-center gap-0.5 xl:gap-1 bg-slate-900 border border-slate-750 p-1 rounded-xl shadow-inner shrink-0">
              <button
                type="button"
                onClick={() => setPipelineDateFilter([])}
                className={`px-2 xl:px-3 py-1 rounded-lg text-[9.5px] xl:text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                  pipelineDateFilter.length === 0
                    ? 'bg-emerald-800 text-white border border-emerald-600/60 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              {[
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: 'date-wise', label: 'Date' }
              ].map(filter => {
                const isActive = pipelineDateFilter.includes(filter.id);
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => {
                      setPipelineDateFilter(prev =>
                        prev.includes(filter.id)
                          ? prev.filter(item => item !== filter.id)
                          : [...prev, filter.id]
                      );
                    }}
                    className={`px-2 xl:px-3 py-1 rounded-lg text-[9.5px] xl:text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
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

            {pipelineDateFilter.includes('date-wise') && (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 px-3 py-1 rounded-xl text-left animate-fade-in shrink-0">
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

            {hasTopFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCoordinatorFilter([]);
                  setRemarksFilter([]);
                  setPipelineDateFilter([]);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-rose-950/30 hover:bg-rose-950/50 text-rose-400 border border-rose-500/30 text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all"
              >
                ✕ Reset Filters
              </button>
            )}
          </div>

          {/* Right Side: Results indicator */}
          <div className="flex items-center shrink-0">
            {hasTopFilters ? (
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

        {/* Pipeline Hub Layout (Classic View removed) */}
          <div className="space-y-4 2xl:space-y-6 animate-fade-in">
            {/* Stage Selector Grid — Refined Executive Metric Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 2xl:gap-3.5">
              {COLUMNS.map((col, idx) => {
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

                // Per-stage refined visual tokens (preserving dynamic workload health tier on In Discussion)
                let accentHex = '#64748b';
                let iconColorClass = 'text-slate-400';
                let metricAccentClass = 'text-slate-400';
                let selectedSurfaceClass = 'border-sky-500/70 bg-slate-900 shadow-lg';
                let hoverBorderClass = 'hover:border-slate-600';

                if (col.id === 'new') {
                  accentHex = '#38bdf8';
                  iconColorClass = isSelected ? 'text-sky-600 dark:text-sky-400' : 'text-sky-600/80 dark:text-sky-400/80 group-hover:text-sky-500 dark:group-hover:text-sky-400';
                  metricAccentClass = 'text-sky-600 dark:text-sky-400';
                  selectedSurfaceClass = 'border-sky-500/80 bg-sky-500/10 dark:bg-sky-950/45 shadow-lg shadow-sky-950/20';
                  hoverBorderClass = 'hover:border-sky-500/50';
                } else if (col.id === 'in_discussion' || col.id === 'negotiating') {
                  if (inDiscussionPctInfo.level === 'red') {
                    accentHex = '#f43f5e';
                    iconColorClass = isSelected ? 'text-rose-600 dark:text-rose-400' : 'text-rose-600/85 dark:text-rose-400/85 group-hover:text-rose-500 dark:group-hover:text-rose-400';
                    metricAccentClass = inDiscussionPctInfo.textColor;
                    selectedSurfaceClass = 'border-rose-500/80 bg-rose-500/10 dark:bg-rose-950/45 shadow-lg shadow-rose-950/20';
                    hoverBorderClass = 'hover:border-rose-500/50';
                  } else if (inDiscussionPctInfo.level === 'orange') {
                    accentHex = '#f97316';
                    iconColorClass = isSelected ? 'text-orange-600 dark:text-orange-400' : 'text-orange-600/85 dark:text-orange-400/85 group-hover:text-orange-500 dark:group-hover:text-orange-400';
                    metricAccentClass = inDiscussionPctInfo.textColor;
                    selectedSurfaceClass = 'border-orange-500/80 bg-orange-500/10 dark:bg-orange-950/45 shadow-lg shadow-orange-950/20';
                    hoverBorderClass = 'hover:border-orange-500/50';
                  } else if (inDiscussionPctInfo.level === 'yellow') {
                    accentHex = '#eab308';
                    iconColorClass = isSelected ? 'text-amber-600 dark:text-amber-400' : 'text-amber-600/85 dark:text-amber-400/85 group-hover:text-amber-500 dark:group-hover:text-amber-400';
                    metricAccentClass = inDiscussionPctInfo.textColor;
                    selectedSurfaceClass = 'border-amber-500/80 bg-amber-500/10 dark:bg-amber-950/40 shadow-lg shadow-amber-950/20';
                    hoverBorderClass = 'hover:border-amber-500/50';
                  } else {
                    accentHex = '#10b981';
                    iconColorClass = isSelected ? 'text-emerald-600 dark:text-emerald-400' : 'text-emerald-600/85 dark:text-emerald-400/85 group-hover:text-emerald-500 dark:group-hover:text-emerald-400';
                    metricAccentClass = inDiscussionPctInfo.textColor;
                    selectedSurfaceClass = 'border-emerald-500/80 bg-emerald-500/10 dark:bg-emerald-950/45 shadow-lg shadow-emerald-950/20';
                    hoverBorderClass = 'hover:border-emerald-500/50';
                  }
                } else if (col.id === 'strong_opportunity') {
                  accentHex = '#f59e0b';
                  iconColorClass = isSelected ? 'text-amber-600 dark:text-amber-400' : 'text-amber-600/80 dark:text-amber-400/80 group-hover:text-amber-500 dark:group-hover:text-amber-400';
                  metricAccentClass = 'text-amber-600 dark:text-amber-400';
                  selectedSurfaceClass = 'border-amber-500/80 bg-amber-500/10 dark:bg-amber-950/45 shadow-lg shadow-amber-950/20';
                  hoverBorderClass = 'hover:border-amber-500/50';
                } else if (col.id === 'office_visited' || col.id === 'proposal') {
                  accentHex = '#818cf8';
                  iconColorClass = isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-indigo-600/80 dark:text-indigo-400/80 group-hover:text-indigo-500 dark:group-hover:text-indigo-400';
                  metricAccentClass = 'text-indigo-600 dark:text-indigo-400';
                  selectedSurfaceClass = 'border-indigo-500/80 bg-indigo-500/10 dark:bg-indigo-950/45 shadow-lg shadow-indigo-950/20';
                  hoverBorderClass = 'hover:border-indigo-500/50';
                } else if (col.id === 'won') {
                  accentHex = '#10b981';
                  iconColorClass = isSelected ? 'text-emerald-600 dark:text-emerald-400' : 'text-emerald-600/80 dark:text-emerald-400/80 group-hover:text-emerald-500 dark:group-hover:text-emerald-400';
                  metricAccentClass = 'text-emerald-600 dark:text-emerald-400';
                  selectedSurfaceClass = 'border-emerald-500/80 bg-emerald-500/10 dark:bg-emerald-950/45 shadow-lg shadow-emerald-950/20';
                  hoverBorderClass = 'hover:border-emerald-500/50';
                } else if (col.id === 'cold_leads' || col.id === 'rotations') {
                  accentHex = '#3b82f6';
                  iconColorClass = isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-blue-600/80 dark:text-blue-400/80 group-hover:text-blue-500 dark:group-hover:text-blue-400';
                  metricAccentClass = 'text-blue-600 dark:text-blue-400';
                  selectedSurfaceClass = 'border-blue-500/80 bg-blue-500/10 dark:bg-blue-950/45 shadow-lg shadow-blue-950/20';
                  hoverBorderClass = 'hover:border-blue-500/50';
                } else if (col.id === 'lost') {
                  accentHex = '#f43f5e';
                  iconColorClass = isSelected ? 'text-rose-600 dark:text-rose-400' : 'text-rose-600/80 dark:text-rose-400/80 group-hover:text-rose-500 dark:group-hover:text-rose-400';
                  metricAccentClass = 'text-rose-600 dark:text-rose-400';
                  selectedSurfaceClass = 'border-rose-500/80 bg-rose-500/10 dark:bg-rose-950/45 shadow-lg shadow-rose-950/20';
                  hoverBorderClass = 'hover:border-rose-500/50';
                }

                const cleanStageName = col.title.replace(/^\d+\.\s*/, '');
                const stageSharePct = visibleLeads.length > 0 ? (colLeads.length / visibleLeads.length) * 100 : 0;
                const displayPct = col.id === 'in_discussion' ? inDiscussionPctInfo.percentage : stageSharePct;
                const pctTitle =
                  col.id === 'in_discussion'
                    ? `In Discussion load: ${inDiscussionPctInfo.inDiscussionCount}/${inDiscussionPctInfo.totalAssignedLifetime} lifetime assigned leads (${inDiscussionPctInfo.percentage.toFixed(1)}%)`
                    : `${stageSharePct.toFixed(1)}% of visible leads`;

                // Real 6-bucket recent activity trend from colLeads (older -> 30d -> 14d -> 7d -> 3d -> 24h)
                const nowMs = Date.now();
                const buckets = [0, 0, 0, 0, 0, 0];
                for (const l of colLeads) {
                  const ts = new Date(l.updatedAt || l.createdAt || 0).getTime();
                  const ageDays = ts > 0 ? Math.max(0, (nowMs - ts) / 86400000) : 99;
                  if (ageDays <= 1) buckets[5] += 1;
                  else if (ageDays <= 3) buckets[4] += 1;
                  else if (ageDays <= 7) buckets[3] += 1;
                  else if (ageDays <= 14) buckets[2] += 1;
                  else if (ageDays <= 30) buckets[1] += 1;
                  else buckets[0] += 1;
                }
                const maxBucket = Math.max(...buckets, 1);
                const chartPts = buckets.map((val, bIdx) => {
                  const x = Math.round((bIdx / 5) * 200);
                  // Keep curve gracefully inside y=[10..38] so it complements text without collision
                  const norm = colLeads.length === 0 ? 0.08 : 0.14 + (val / maxBucket) * 0.72;
                  const y = Math.round((42 - norm * 34) * 10) / 10;
                  return { x, y };
                });
                let curvePath = `M ${chartPts[0].x},${chartPts[0].y}`;
                for (let p = 0; p < chartPts.length - 1; p++) {
                  const curr = chartPts[p];
                  const next = chartPts[p + 1];
                  const midX = Math.round(((curr.x + next.x) / 2) * 10) / 10;
                  curvePath += ` C ${midX},${curr.y} ${midX},${next.y} ${next.x},${next.y}`;
                }
                const areaPath = `${curvePath} L 200,44 L 0,44 Z`;
                const lastPt = chartPts[chartPts.length - 1];

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
                    title={col.title}
                    style={
                      isSelected
                        ? { boxShadow: `0 10px 28px -10px ${accentHex}55, inset 0 1px 0 0 ${accentHex}45` }
                        : undefined
                    }
                    className={`group relative overflow-hidden rounded-2xl border p-3.5 2xl:p-4 pb-4 2xl:pb-5 text-left transition-all duration-150 ease-out select-none cursor-pointer flex flex-col justify-between min-h-[7.75rem] 2xl:min-h-[8.25rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                      isDraggedOver
                        ? 'border-accent-purple bg-accent-purple/10 ring-2 ring-accent-purple/40 shadow-lg'
                        : isSelected
                        ? `${selectedSurfaceClass}`
                        : `bg-slate-900 border-slate-750 ${hoverBorderClass} hover:bg-slate-850`
                    }`}
                  >
                    {/* Gradient Halo Glow Aura */}
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${
                        isSelected ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'
                      }`}
                      style={{
                        background: `radial-gradient(120% 85% at 88% 8%, ${accentHex}${isSelected ? '2e' : '18'} 0%, transparent 62%), radial-gradient(90% 60% at 18% 100%, ${accentHex}${isSelected ? '1c' : '0c'} 0%, transparent 65%)`
                      }}
                    />

                    {/* Crisp Top Edge Highlight Bar on Active Stage */}
                    {isSelected && (
                      <span
                        aria-hidden="true"
                        className="absolute top-0 left-0 right-0 h-[2.5px] z-10"
                        style={{ backgroundColor: accentHex }}
                      />
                    )}

                    {/* Top Row: Clean Icon + Step Index on Left, Unread Alert or Active State on Right */}
                    <div className="relative z-10 flex items-center justify-between gap-2 w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        <IconComponent className={`w-[1.125rem] h-[1.125rem] shrink-0 transition-colors ${iconColorClass}`} />
                        <span className="text-xs font-mono font-bold tabular-nums text-slate-400">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {colUnreadCount > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400"
                            title={`${colUnreadCount} unread WhatsApp messages`}
                          >
                            <MessageSquare className="w-3.5 h-3.5 fill-current" />
                            <span>{colUnreadCount}</span>
                          </span>
                        ) : isSelected ? (
                          <span className={`text-xs font-bold whitespace-nowrap ${metricAccentClass}`}>
                            Active
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Hero Metric Row: Larger Bold Tabular Count with natural digit spacing + Share/Load Percentage */}
                    <div className="relative z-10 flex items-baseline justify-between gap-2 mt-3 2xl:mt-3.5 w-full">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-[1.65rem] 2xl:text-[1.875rem] font-extrabold font-display tracking-[0.04em] tabular-nums leading-none text-slate-100">
                          {colLeads.length.toLocaleString()}
                        </span>
                        <span className="text-xs font-medium tracking-wide text-slate-400">
                          {colLeads.length === 1 ? 'lead' : 'leads'}
                        </span>
                      </div>

                      <span
                        title={pctTitle}
                        className={`text-xs font-mono font-bold tabular-nums shrink-0 ${
                          col.id === 'in_discussion'
                            ? inDiscussionPctInfo.textColor
                            : isSelected
                            ? metricAccentClass
                            : 'text-slate-400'
                        }`}
                      >
                        {displayPct.toFixed(1)}%
                      </span>
                    </div>

                    {/* Stage Title */}
                    <h3
                      className={`relative z-10 mt-2.5 2xl:mt-3 text-[0.8125rem] 2xl:text-[0.875rem] font-bold tracking-tight leading-snug truncate w-full transition-colors ${
                        isSelected ? 'text-slate-100' : 'text-slate-200 group-hover:text-slate-100'
                      }`}
                    >
                      {cleanStageName}
                    </h3>

                    {/* Data-Driven Gradient Area Graph along Bottom */}
                    <svg
                      aria-hidden="true"
                      className={`absolute bottom-[2px] left-0 right-0 w-full h-11 pointer-events-none transition-opacity duration-200 z-0 ${
                        isSelected ? 'opacity-85' : 'opacity-45 group-hover:opacity-75'
                      }`}
                      viewBox="0 0 200 44"
                      preserveAspectRatio="none"
                    >
                      <defs>
                        <linearGradient id={`stage-graph-grad-${col.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={accentHex} stopOpacity="0.38" />
                          <stop offset="100%" stopColor={accentHex} stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      <path d={areaPath} fill={`url(#stage-graph-grad-${col.id})`} />
                      <path
                        d={curvePath}
                        fill="none"
                        stroke={accentHex}
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <circle cx={lastPt.x - 2} cy={lastPt.y} r="2.2" fill={accentHex} />
                    </svg>

                    {/* Bottom 2px Proportional Stage Share Track */}
                    <div
                      aria-hidden="true"
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-800/60 z-10"
                    >
                      <div
                        className="h-full transition-opacity duration-150"
                        style={{
                          width: `${colLeads.length > 0 ? Math.min(100, Math.max(4, stageSharePct)) : 0}%`,
                          backgroundColor: accentHex,
                          opacity: isSelected ? 1 : 0.65
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Active Stage Container (Active Jobs Hub style) */}
            {selectedStage && (
              <div className="bg-slate-950/40 border border-emerald-600/35 dark:border-emerald-500/20 rounded-3xl p-3.5 sm:p-4 2xl:p-6 shadow-3xs text-left space-y-4 2xl:space-y-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-slate-700 pb-3.5 2xl:pb-4 gap-3 2xl:gap-4">
                  {/* Left Title, Stats AND Filters grouped beautifully with fully responsive layout */}
                  <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 2xl:gap-6 min-w-0 flex-1">
                    <div className="shrink-0">
                      <h3 className="text-sm 2xl:text-base font-black text-slate-100 uppercase tracking-wide flex items-center gap-2">
                        📂 {COLUMNS.find(c => c.id === selectedStage || (selectedStage === 'negotiating' && c.id === 'in_discussion') || (selectedStage === 'proposal' && c.id === 'office_visited') || (selectedStage === 'rotations' && c.id === 'cold_leads'))?.title} Candidates
                      </h3>
                      <p className="text-xs text-slate-400 font-bold mt-0.5">
                        Showing <span className="text-emerald-400 font-mono font-extrabold">{filteredStageLeads.length}</span> active records in pipeline phase
                      </p>
                    </div>

                    {/* Inline Premium Multi-Select Filters next to title in a responsive grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 xl:flex xl:flex-row gap-2 2xl:gap-2.5 w-full xl:w-auto items-center">
                      {/* Country Filter */}
                      <div className="w-full xl:w-auto">
                        <MultiSearchableSelect
                          values={boardCountryFilter}
                          onChange={setBoardCountryFilter}
                          options={searchableCountryOptions}
                          allLabel={`All Countries (${stageLeads.length})`}
                          placeholder="Search countries..."
                          badgeColor="bg-emerald-600"
                          activeTextClass="text-emerald-300"
                          activeBorderClass="border-emerald-500/80 ring-1 ring-emerald-500/30"
                          className="w-full text-xs px-3 py-1.5 rounded-xl border border-slate-750 dark:border-slate-700 bg-slate-900 hover:bg-slate-850 text-slate-200 font-black cursor-pointer uppercase transition-all shadow-xs"
                          dropdownClassName="dark:bg-slate-950 border-slate-700 w-60"
                        />
                      </div>
 
                      {/* Position Filter */}
                      <div className="w-full xl:w-auto">
                        <MultiSearchableSelect
                          values={boardPositionFilter}
                          onChange={setBoardPositionFilter}
                          options={searchablePositionOptions}
                          allLabel={`All Positions (${stageLeads.length})`}
                          placeholder="Search positions..."
                          badgeColor="bg-emerald-600"
                          activeTextClass="text-emerald-300"
                          activeBorderClass="border-emerald-500/80 ring-1 ring-emerald-500/30"
                          className="w-full text-xs px-3 py-1.5 rounded-xl border border-slate-750 dark:border-slate-700 bg-slate-900 hover:bg-slate-850 text-slate-200 font-black cursor-pointer uppercase transition-all shadow-xs truncate"
                          dropdownClassName="dark:bg-slate-950 border-slate-700 w-64"
                        />
                      </div>
 
                      {/* Gender Filter */}
                      <div className="w-full xl:w-auto">
                        <MultiSearchableSelect
                          values={boardGenderFilter}
                          onChange={setBoardGenderFilter}
                          options={searchableGenderOptions}
                          allLabel={`All Genders (${stageLeads.length})`}
                          placeholder="Filter genders..."
                          badgeColor="bg-emerald-600"
                          activeTextClass="text-emerald-300"
                          activeBorderClass="border-emerald-500/80 ring-1 ring-emerald-500/30"
                          className="w-full text-xs px-3 py-1.5 rounded-xl border border-slate-750 dark:border-slate-700 bg-slate-900 hover:bg-slate-850 text-slate-200 font-black cursor-pointer uppercase transition-all shadow-xs"
                          dropdownClassName="dark:bg-slate-950 border-slate-700 w-48"
                        />
                      </div>

                      {/* Tags Filter */}
                      <div className="w-full xl:w-auto">
                        <MultiSearchableSelect
                          values={boardTagFilter}
                          onChange={setBoardTagFilter}
                          options={searchableTagOptions}
                          allLabel={`All Tags (${stageLeads.length})`}
                          placeholder="Search tags..."
                          badgeColor="bg-emerald-600"
                          activeTextClass="text-emerald-300"
                          activeBorderClass="border-emerald-500/80 ring-1 ring-emerald-500/30"
                          align="right"
                          className="w-full text-xs px-3 py-1.5 rounded-xl border border-slate-750 dark:border-slate-700 bg-slate-900 hover:bg-slate-850 text-slate-200 font-black cursor-pointer uppercase transition-all shadow-xs"
                          dropdownClassName="dark:bg-slate-950 border-slate-700 w-52"
                        />
                      </div>

                      {/* Reset Filters button if any are active */}
                      {(boardCountryFilter.length > 0 || boardPositionFilter.length > 0 || boardGenderFilter.length > 0 || boardTagFilter.length > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            setBoardCountryFilter([]);
                            setBoardPositionFilter([]);
                            setBoardGenderFilter([]);
                            setBoardTagFilter([]);
                          }}
                          className="col-span-2 sm:col-span-4 xl:col-span-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white text-xs font-black rounded-xl transition cursor-pointer border border-slate-700 w-full xl:w-auto"
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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 2xl:gap-4 py-1">
                  {filteredStageLeads.length > 0 ? (
                    filteredStageLeads.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onSelectLead={onSelectLead}
                        onUpdateStage={onUpdateStage}
                        draggable={true}
                      />
                    ))
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
      </div>
    </div>
  );
}
