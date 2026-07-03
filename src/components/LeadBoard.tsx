import React, { useState } from 'react';
import { Lead, LeadStage } from '../types.ts';
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
  RotateCw
} from 'lucide-react';
import { getCountryFlagUrl, formatCandidateName } from '../utils';
import ImportantUpdatesBar from './ImportantUpdatesBar.tsx';

interface LeadBoardProps {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  onUpdateStage: (id: string, stage: LeadStage) => void;
  userRole: 'admin' | 'agent';
  currentAgentId: string;
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
  currentAgentId 
}: LeadBoardProps) {
  
  // View mode switcher: 'hub' (container tabs view like Active Jobs Hub) or 'board' (classic kanban)
  const [viewMode, setViewMode] = useState<'board' | 'hub'>('hub');
  
  // Selected stage for Pipeline Hub View
  const [selectedStage, setSelectedStage] = useState<LeadStage>('new');

  // Bucket filtering for agents
  const [bucketToggle, setBucketToggle] = useState<'my' | 'all'>(userRole === 'agent' ? 'my' : 'all');
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null);

  // Date filter state: 'all' | 'today' | 'yesterday' | 'date-wise'
  const [pipelineDateFilter, setPipelineDateFilter] = useState<'all' | 'today' | 'yesterday' | 'date-wise'>('all');
  // From Date and To Date for custom range filtering
  const [filterStartDate, setFilterStartDate] = useState<string>(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toLocaleDateString('en-CA');
  });
  const [filterEndDate, setFilterEndDate] = useState<string>(() => new Date().toLocaleDateString('en-CA'));

  const COLUMNS: Column[] = [
    { id: 'new', title: 'New Inbound', color: 'border-slate-750 bg-slate-900/35', headerColor: 'text-slate-300 bg-slate-800 font-medium' },
    { id: 'negotiating', title: 'In Discussion', color: 'border-slate-750 bg-slate-900/35', headerColor: 'text-amber-400 bg-amber-950/40 font-medium' },
    { id: 'rotations', title: 'In Rotations', color: 'border-slate-750 bg-slate-900/35', headerColor: 'text-indigo-400 bg-indigo-950/40 font-medium animate-pulse' },
    { id: 'proposal', title: 'Office Visited/Interview Attended', color: 'border-slate-750 bg-slate-900/35', headerColor: 'text-purple-400 bg-purple-950/40 font-medium' },
    { id: 'won', title: 'Closed Won', color: 'border-emerald-900/40 bg-emerald-950/15', headerColor: 'text-emerald-400 bg-emerald-950/40 font-semibold' },
    { id: 'lost', title: 'Closed Lost', color: 'border-slate-750 bg-slate-900/20', headerColor: 'text-slate-400 bg-slate-800' }
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
    const list: LeadStage[] = ['new', 'negotiating', 'rotations', 'proposal', 'won', 'lost'];
    const idx = list.indexOf(current);
    return {
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx < list.length - 1 ? list[idx + 1] : null
    };
  };

  // Filter leads based on agent bucket selection AND date filters
  const visibleLeads = React.useMemo(() => {
    let filtered = leads;

    // Agent bucket filter
    if (userRole === 'agent') {
      filtered = filtered.filter(lead => lead.assignedTo?.toLowerCase() === currentAgentId.toLowerCase());
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

    return filtered;
  }, [leads, userRole, currentAgentId, pipelineDateFilter, filterStartDate, filterEndDate]);

  // Lead Card Render Helper to avoid duplicate JSX
  const renderLeadCard = (lead: Lead) => {
    const { prev, next } = getStageNeighbors(lead.stage);
    const hasRemarks = lead.remarks1 || lead.remarks2 || lead.remarks3;

    return (
      <div
        key={lead.id}
        draggable="true"
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', lead.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        className="bg-slate-850 rounded-xl border border-slate-750 p-3.5 shadow-sm hover:shadow-xl hover:border-accent-purple hover:-translate-y-0.5 transition-all duration-200 cursor-grab active:cursor-grabbing relative group flex flex-col text-left h-full"
        onClick={() => onSelectLead(lead)}
      >
        {/* Target country badge & Stars */}
        <div className="flex justify-between items-center gap-1.5 mb-2">
          <span className="text-[10px] font-black text-slate-300 bg-slate-800 px-2.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1.5">
            {lead.country && getCountryFlagUrl(lead.country) ? (
              <img 
                src={getCountryFlagUrl(lead.country)} 
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
              />
            ))}
          </div>
        </div>

        {/* Name / Phone */}
        <h4 className="font-black text-slate-100 text-sm tracking-tight uppercase font-display">{formatCandidateName(lead.name)}</h4>
        <div className="flex items-center justify-between mt-1 pb-1.5 border-b border-slate-750/80">
          <span className="text-[10px] text-slate-400 font-bold font-mono">{lead.phone}</span>
          <span className="text-[9px] bg-slate-800 border border-slate-750 font-bold px-1.5 py-0.5 rounded text-slate-300 uppercase font-mono">
            {lead.gender === 'F' ? 'F' : 'M'}, Age {lead.age || '24'}
          </span>
        </div>

        {/* Position Indicator */}
        <span className="text-[9px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/30 px-2.5 py-1 rounded font-bold uppercase truncate block mt-2 text-left w-full font-display">
          💼 {lead.position || 'General Applicant'}
        </span>

        {lead.project && (
          <span className="text-[9px] text-accent-purple bg-purple-950/40 border border-purple-900/30 px-2.5 py-1 rounded font-black uppercase truncate block mt-1 text-left w-full font-display">
            🎯 Project: {lead.project}
          </span>
        )}

        {lead.source && (
          <span className="text-[9px] text-slate-300 bg-slate-800 border border-slate-750 px-2.5 py-1 rounded font-bold uppercase truncate block mt-1 text-left w-full font-display">
            📣 Source: {lead.source}
          </span>
        )}

        {/* Telecaller Remarks Log Indicator */}
        {hasRemarks ? (
          <div className="bg-slate-900 p-2 rounded-lg border border-slate-750 text-[10px] text-left mt-2 transition-all duration-200 hover:bg-slate-800/90 group/remarks cursor-help">
            <span className="text-[8px] uppercase font-black text-accent-emerald block mb-0.5 tracking-wider flex justify-between items-center font-display">
              <span>{lead.remarks3 ? "📞 3rd" : lead.remarks2 ? "📞 2nd" : "📞 1st"} Remark</span>
              <span className="text-[7px] text-slate-500 normal-case font-normal group-hover/remarks:hidden">Full</span>
            </span>
            <p className="text-slate-300 truncate group-hover/remarks:whitespace-normal group-hover/remarks:break-all italic font-medium font-mono transition-all duration-250">
              "{lead.remarks3 || lead.remarks2 || lead.remarks1}"
            </p>
          </div>
        ) : (
          <div className="text-[9px] text-left text-slate-500 mt-2 font-mono">
            No Remarks Logged
          </div>
        )}

        {/* Coordinator Badge */}
        {lead.assignedTo && (
          <div className="text-[10px] mt-2 flex justify-between items-center border-t border-slate-750 pt-1.5 text-left">
            <span className="text-slate-500 font-bold">Coordinator:</span>
            <span className="text-accent-purple font-black bg-purple-950/40 border border-purple-900/30 px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-display">
              👤 {lead.assignedTo}
            </span>
          </div>
        )}

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
            {new Date(lead.updatedAt).toLocaleDateString(undefined, {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})}
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

      </div>
    );
  };

  return (
    <div className="space-y-6" id="cgp-leads-pipeline">
      
      {/* Live Scrolling Important Updates Bar */}
      <ImportantUpdatesBar />
      
      {/* Sub Agent Bucket Select Bar inside Kanban */}
      {userRole === 'agent' && (
        <div className="flex bg-slate-900 p-3.5 rounded-2xl border border-slate-800 justify-between items-center text-left">
          <div className="text-xs">
            <span className="font-extrabold text-slate-300 block uppercase tracking-wider font-mono">Coordinator Desk</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-purple text-white rounded-xl text-[10px] font-black tracking-wider uppercase select-none shadow-md shadow-accent-purple/15">
            <span>🔒 Private Bucket ({visibleLeads.length} Candidates)</span>
          </div>
        </div>
      )}

      {/* Pipeline Border Card Container */}
      <div className="bg-slate-950/40 rounded-3xl border border-slate-750/85 p-6 shadow-xl text-left">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-5 border-b border-slate-750/80 pb-4 gap-4">
          <div>
            <h3 className="text-xs font-black text-slate-100 uppercase tracking-widest flex items-center gap-2 font-display">
              <TrendingUp className="h-4 w-4 text-accent-emerald" />
              Your Candidate Pipeline
            </h3>
            <p className="text-[11px] text-slate-500 font-bold mt-0.5">
              Drag-and-drop leads between selectors or use quick arrows to progress candidates from inbound to success
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* View Switcher segment button styled beautifully */}
            <div className="flex items-center bg-slate-900 border border-slate-750 p-1 rounded-xl shadow-inner">
              <button
                type="button"
                onClick={() => setViewMode('hub')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                  viewMode === 'hub'
                    ? 'bg-accent-purple text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="h-3 w-3" />
                Pipeline Hub View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('board')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                  viewMode === 'board'
                    ? 'bg-accent-purple text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Trello className="h-3 w-3" />
                Classic Kanban View
              </button>
            </div>

            {/* Shifted & Minimalist Pipeline Filters */}
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-750 p-1 rounded-xl shadow-inner">
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
                        ? 'bg-accent-purple text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>

            {pipelineDateFilter === 'date-wise' && (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-750 px-3 py-1.5 rounded-xl text-left animate-fade-in">
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="bg-transparent text-[10px] text-slate-100 font-extrabold outline-none border-0 p-0 cursor-pointer h-4 w-24 focus:ring-0"
                />
                <span className="text-[9px] text-slate-500 font-bold font-mono">to</span>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="bg-transparent text-[10px] text-slate-100 font-extrabold outline-none border-0 p-0 cursor-pointer h-4 w-24 focus:ring-0"
                />
              </div>
            )}

            {pipelineDateFilter !== 'all' && (
              <div className="text-[10px] text-slate-400 font-bold bg-slate-900 border border-slate-750 px-3 py-1.5 rounded-xl">
                Filtered: <span className="text-accent-emerald font-black font-mono">{visibleLeads.length} matches</span>
              </div>
            )}
          </div>
        </div>

        {/* View Layout Conditional Render */}
        {viewMode === 'hub' ? (
          <div className="space-y-6 animate-fade-in">
            {/* Stage Selector Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
              {COLUMNS.map((col) => {
                const colLeads = visibleLeads.filter(l => l.stage === col.id);
                const isSelected = selectedStage === col.id;
                const isDraggedOver = draggedOverColumn === col.id;
                
                // Map icons dynamically
                let IconComponent = Inbox;
                if (col.id === 'negotiating') IconComponent = Briefcase;
                else if (col.id === 'rotations') IconComponent = RotateCw;
                else if (col.id === 'proposal') IconComponent = Calendar;
                else if (col.id === 'won') IconComponent = ShieldCheck;
                else if (col.id === 'lost') IconComponent = X;

                // Determine visual accent based on stage
                let selectedClass = '';
                let badgeColor = '';
                let iconColor = 'text-slate-400';
                
                if (col.id === 'new') {
                  selectedClass = isSelected ? 'bg-slate-800 border-slate-500 text-slate-100 shadow-md ring-2 ring-slate-500/20' : '';
                  badgeColor = isSelected ? 'bg-slate-900/30 text-slate-100 border-slate-500/30' : 'bg-slate-900 text-slate-300 border-slate-750';
                  if (isSelected) iconColor = 'text-slate-100';
                } else if (col.id === 'negotiating') {
                  selectedClass = isSelected ? 'bg-amber-950/80 border-amber-500 text-slate-100 shadow-md ring-2 ring-amber-500/20' : '';
                  badgeColor = isSelected ? 'bg-amber-400/20 text-amber-400 border-amber-400/30' : 'bg-amber-950/40 text-amber-400 border-amber-900/30';
                  if (isSelected) iconColor = 'text-amber-400';
                } else if (col.id === 'rotations') {
                  selectedClass = isSelected ? 'bg-indigo-950/80 border-indigo-500 text-slate-100 shadow-md ring-2 ring-indigo-500/20' : '';
                  badgeColor = isSelected ? 'bg-indigo-400/20 text-indigo-400 border-indigo-400/30' : 'bg-indigo-950/40 text-indigo-400 border-indigo-900/30';
                  if (isSelected) iconColor = 'text-indigo-400';
                } else if (col.id === 'proposal') {
                  selectedClass = isSelected ? 'bg-purple-950/80 border-purple-500 text-slate-100 shadow-md ring-2 ring-purple-500/20' : '';
                  badgeColor = isSelected ? 'bg-purple-400/20 text-purple-400 border-purple-400/30' : 'bg-purple-950/40 text-purple-400 border-purple-900/30';
                  if (isSelected) iconColor = 'text-purple-400';
                } else if (col.id === 'won') {
                  selectedClass = isSelected ? 'bg-emerald-950/80 border-emerald-500 text-slate-100 shadow-md ring-2 ring-emerald-500/20' : '';
                  badgeColor = isSelected ? 'bg-emerald-400/20 text-emerald-400 border-emerald-400/30' : 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30';
                  if (isSelected) iconColor = 'text-emerald-400';
                } else if (col.id === 'lost') {
                  selectedClass = isSelected ? 'bg-rose-950/80 border-rose-500 text-slate-100 shadow-md ring-2 ring-rose-500/20' : '';
                  badgeColor = isSelected ? 'bg-rose-400/20 text-rose-400 border-rose-400/30' : 'bg-rose-950/40 text-rose-400 border-rose-900/30';
                  if (isSelected) iconColor = 'text-rose-400';
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
                    className={`group p-2 px-3 rounded-2xl border text-left transition-all duration-200 select-none cursor-pointer flex flex-col justify-between h-[92px] relative overflow-hidden ${
                      isDraggedOver
                        ? 'border-accent-purple bg-accent-purple/10 scale-[1.03] ring-2 ring-accent-purple/40 shadow-lg'
                        : isSelected
                        ? `${selectedClass} scale-[1.02]`
                        : 'bg-slate-850 border-slate-750 hover:border-slate-600 text-slate-200 hover:bg-slate-800/50 shadow-3xs'
                    }`}
                  >
                    <div className="relative z-10 flex items-start justify-between w-full">
                      <div className={`text-sm font-bold flex items-center justify-center w-6.5 h-6.5 rounded-lg border ${isSelected ? 'bg-slate-900/20 border-slate-700' : 'bg-slate-900 border-slate-800'}`}>
                        <IconComponent className={`w-3.5 h-3.5 ${iconColor}`} />
                      </div>
                      <span className={`text-[11px] font-black px-2 py-0.5 rounded-md font-mono border ${badgeColor}`}>
                        {colLeads.length} {colLeads.length === 1 ? 'Lead' : 'Leads'}
                      </span>
                    </div>
                    
                    <div className="relative z-10 mt-1">
                      <h3 className={`font-black text-[10px] tracking-wide uppercase leading-tight line-clamp-2 ${isSelected ? 'text-slate-100' : 'text-slate-200'}`}>
                        {col.title}
                      </h3>
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
              <div className="bg-slate-950/40 border border-slate-750/80 rounded-3xl p-6 shadow-3xs text-left space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-750/60 pb-4 gap-3">
                  <div>
                    <h3 className="text-sm font-black text-slate-100 uppercase tracking-wide flex items-center gap-2">
                      📂 {COLUMNS.find(c => c.id === selectedStage)?.title} Candidates
                    </h3>
                    <p className="text-xs text-slate-500 font-bold">
                      Showing {visibleLeads.filter(l => l.stage === selectedStage).length} active records in pipeline phase
                    </p>
                  </div>
                  <span className="self-start sm:self-center text-[10px] uppercase font-black text-accent-purple bg-purple-950/40 border border-purple-900/30 px-3 py-1.5 rounded-full font-mono">
                    Active Directory
                  </span>
                </div>

                {/* Grid layout of lead cards under the selected stage */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 py-1">
                  {visibleLeads.filter(l => l.stage === selectedStage).length > 0 ? (
                    visibleLeads.filter(l => l.stage === selectedStage).map((lead) => renderLeadCard(lead))
                  ) : (
                    <div className="col-span-full border border-dashed border-slate-750 rounded-2xl flex flex-col items-center justify-center py-20 text-slate-500 space-y-2 bg-slate-900/20">
                      <Inbox className="h-10 w-10 opacity-30 text-slate-400" />
                      <span className="text-sm font-bold text-slate-400">No candidates currently in this stage</span>
                      <p className="text-xs text-slate-500 max-w-xs text-center">
                        Drag candidates here from other columns or enroll a new inbound candidate directly.
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
            <div className="flex gap-4 overflow-x-auto pb-4 w-full relative z-10 xl:justify-between" id="kanban-pipeline-columns">
              {COLUMNS.map(col => {
                const colLeads = visibleLeads.filter(l => l.stage === col.id);
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
                    className={`rounded-2xl border p-3.5 flex flex-col min-h-[580px] w-[240px] sm:w-[260px] lg:w-[280px] xl:w-auto xl:flex-1 shrink-0 h-full text-left shadow-md transition-all duration-200 ${
                      isDraggedOver 
                        ? 'border-accent-purple bg-accent-purple/10 scale-[1.01] shadow-xl ring-2 ring-accent-purple/20' 
                        : 'border-slate-750 bg-slate-900/90'
                    }`}
                  >
                    {/* Column Header */}
                    <div className="flex items-center justify-between mb-4 border-b border-slate-750 pb-2.5 min-h-[44px]">
                      <span className={`text-[9px] sm:text-[9.5px] font-black uppercase tracking-tight px-2 py-1 rounded-md leading-normal break-words inline-block ${col.headerColor}`}>
                        {col.title} ({colLeads.length})
                      </span>
                    </div>

                    {/* Leads Stack */}
                    <div className="space-y-3.5 flex-1 overflow-y-auto max-h-[550px] scrollbar-none py-2 px-0.5">
                      {colLeads.length > 0 ? (
                        colLeads.map(lead => renderLeadCard(lead))
                      ) : (
                        <div className="h-full border border-dashed border-slate-750 rounded-xl flex flex-col items-center justify-center py-10 text-slate-500 space-y-1 bg-slate-900/20">
                          <Briefcase className="h-4.5 w-4.5 opacity-40 text-slate-600" />
                          <span className="text-xs font-bold text-slate-500">No leads in channel</span>
                        </div>
                      )}
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
