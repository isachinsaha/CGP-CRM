import React, { useState } from 'react';
import { Lead, LeadStage } from '../types.ts';
import { TrendingUp, ArrowRight, ArrowLeft, MessageSquare, Briefcase, Calendar, ShieldCheck, Sparkles, Star } from 'lucide-react';

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
  
  // Bucket filtering for agents
  const [bucketToggle, setBucketToggle] = useState<'my' | 'all'>(userRole === 'agent' ? 'my' : 'all');

  const COLUMNS: Column[] = [
    { id: 'new', title: 'New Inbound', color: 'border-slate-100 bg-slate-50/35', headerColor: 'text-slate-700 bg-slate-100/60 font-medium' },
    { id: 'contacted', title: 'Initial Contact', color: 'border-slate-100 bg-slate-50/35', headerColor: 'text-sky-700 bg-sky-50 font-medium' },
    { id: 'negotiating', title: 'In Discussion', color: 'border-slate-100 bg-slate-50/35', headerColor: 'text-amber-700 bg-amber-50 font-medium' },
    { id: 'proposal', title: 'Office Visited', color: 'border-slate-100 bg-slate-50/35', headerColor: 'text-purple-700 bg-purple-50 font-medium' },
    { id: 'won', title: 'Closed Won', color: 'border-emerald-100 bg-emerald-50/15', headerColor: 'text-emerald-700 bg-emerald-50 font-semibold' },
    { id: 'lost', title: 'Closed Lost', color: 'border-slate-100 bg-slate-50/20', headerColor: 'text-slate-500 bg-slate-100/55' }
  ];

  const getFitScoreBadge = (score: string) => {
    switch (score) {
      case 'high':
        return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'medium':
        return 'bg-teal-50 text-teal-600 border-teal-100/50';
      case 'low':
        return 'bg-amber-50 text-amber-700 border-amber-100/50';
      case 'unqualified':
      default:
        return 'bg-slate-50 text-slate-500 border-slate-150';
    }
  };

  const getStageNeighbors = (current: LeadStage): { prev: LeadStage | null; next: LeadStage | null } => {
    const list: LeadStage[] = ['new', 'contacted', 'negotiating', 'proposal', 'won', 'lost'];
    const idx = list.indexOf(current);
    return {
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx < list.length - 1 ? list[idx + 1] : null
    };
  };

  // Filter leads based on agent bucket selection
  const visibleLeads = React.useMemo(() => {
    return leads.filter(lead => {
      if (userRole === 'agent') {
        return lead.assignedTo?.toLowerCase() === currentAgentId.toLowerCase();
      }
      return true;
    });
  }, [leads, userRole, currentAgentId]);

  return (
    <div className="space-y-6" id="cgp-leads-pipeline">
      
      {/* Sub Agent Bucket Select Bar inside Kanban */}
      {userRole === 'agent' && (
        <div className="flex bg-slate-50/50 p-3.5 rounded-2xl border border-slate-150 justify-between items-center text-left">
          <div className="text-xs">
            <span className="font-extrabold text-slate-700 block uppercase tracking-wider font-mono">Coordinator Desk</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white rounded-xl text-[10px] font-black tracking-wider uppercase select-none shadow-sm">
            <span>🔒 Private Bucket ({visibleLeads.length} Candidates)</span>
          </div>
        </div>
      )}

      {/* Pipeline Border Card Container */}
      <div className="bg-white rounded-3xl border border-slate-150 p-6 shadow-xs text-left">
        <div className="flex items-center justify-between mb-5 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              Your Candidate Pipeline
            </h3>
            <p className="text-[11px] text-slate-400 font-bold mt-0.5">
              Drag-and-drop or use quick arrows to progress candidates from initial entry to successful placement
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
            <span>Columns: {COLUMNS.length} Stages</span>
          </div>
        </div>

        {/* Grid Columns */}
        <div className="flex gap-4 overflow-x-auto pb-4 w-full" id="kanban-pipeline-columns">
          {COLUMNS.map(col => {
            const colLeads = visibleLeads.filter(l => l.stage === col.id);
            const colValue = colLeads.reduce((sum, l) => sum + (l.budget || 0), 0);

            return (
              <div
                key={col.id}
                className={`rounded-2xl border ${col.color} p-4 flex flex-col min-h-[580px] w-[270px] lg:w-[285px] shrink-0 h-full text-left`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between mb-3.5">
                  <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${col.headerColor}`}>
                    {col.title} ({colLeads.length})
                  </span>
                </div>

              {/* Leads Stack */}
              <div className="space-y-3 flex-1 overflow-y-auto max-h-[550px] scrollbar-none">
                {colLeads.length > 0 ? (
                  colLeads.map(lead => {
                    const { prev, next } = getStageNeighbors(lead.stage);
                    const hasRemarks = lead.remarks1 || lead.remarks2 || lead.remarks3;

                    return (
                      <div
                        key={lead.id}
                        className="bg-white rounded-xl border border-slate-150 p-3.5 shadow-xs hover:shadow-xs hover:border-emerald-350 transition-all cursor-pointer relative group flex flex-col"
                        onClick={() => onSelectLead(lead)}
                      >
                        {/* Target country badge & Stars */}
                        <div className="flex justify-between items-center gap-1.5 mb-2">
                          <span className="text-[10px] font-extrabold text-slate-750 uppercase">
                            ✈️ {lead.country || 'Pending'}
                          </span>
                          <div className="flex items-center gap-0.5" title={`${lead.importance || 3} Stars`}>
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star 
                                key={i} 
                                className={`h-2.5 w-2.5 ${
                                  i < (lead.importance || 3) 
                                    ? 'text-amber-500 fill-amber-500' 
                                    : 'text-slate-255 text-slate-200'
                                }`} 
                              />
                            ))}
                          </div>
                        </div>

                        {/* Name / Phone */}
                        <h4 className="font-extrabold text-slate-900 text-sm tracking-tight uppercase">{lead.name}</h4>
                        <div className="flex items-center justify-between mt-0.5 pb-2 border-b border-slate-50">
                          <span className="text-[10px] text-slate-400 font-mono">{lead.phone}</span>
                          <span className="text-[9px] bg-slate-100 font-bold px-1.5 py-0.2 rounded-xs text-slate-500 uppercase">
                            {lead.gender === 'F' ? 'F' : 'M'}, Age {lead.age || '24'}
                          </span>
                        </div>

                        {/* Position Indicator */}
                        <span className="text-[9px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded font-bold uppercase truncate block mt-2 text-left w-full">
                          💼 {lead.position || 'General Applicant'}
                        </span>

                        {lead.project && (
                          <span className="text-[9px] text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded font-extrabold uppercase truncate block mt-1 text-left w-full">
                            🎯 Project: {lead.project}
                          </span>
                        )}

                        {lead.source && (
                          <span className="text-[9px] text-slate-750 bg-slate-100 px-2 py-0.5 rounded font-bold uppercase truncate block mt-1 text-left w-full">
                            📣 Source: {lead.source}
                          </span>
                        )}

                        {/* Telecaller Remarks Log Indicator */}
                        {hasRemarks ? (
                          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-[10px] text-left">
                            <span className="text-[8px] uppercase font-bold text-emerald-800 block mb-0.5">
                              📞 Current remarks updated
                            </span>
                            <p className="text-slate-600 truncate italic font-mono">
                              "{lead.remarks1 || lead.remarks2 || lead.remarks3}"
                            </p>
                          </div>
                        ) : (
                          <div className="bg-slate-50 p-2 rounded-lg border border-dashed text-[10px] text-left text-slate-400">
                            NoRemarksLogged
                          </div>
                        )}

                        {/* Coordinator Badge */}
                        {lead.assignedTo && (
                          <div className="text-[10px] mt-2 flex justify-between items-center border-t border-slate-50 pt-2 text-left">
                            <span className="text-slate-400">Coordinator:</span>
                            <span className="text-emerald-700 font-black bg-emerald-50 px-1.5 py-0.2 rounded text-[9px]">
                              👤 {lead.assignedTo}
                            </span>
                          </div>
                        )}

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Move Controls */}
                        <div className="flex justify-between items-center gap-1 pt-2 border-t border-slate-50 mt-2">
                          <div>
                            {prev ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onUpdateStage(lead.id, prev);
                                }}
                                className="p-1 px-1.5 rounded-md hover:bg-slate-105 text-slate-400 hover:text-slate-700 transition-all flex items-center gap-0.5 text-[9px] font-medium"
                                title={`Move back to ${prev}`}
                              >
                                <ArrowLeft className="h-3 w-3" />
                              </button>
                            ) : <div className="w-6" />}
                          </div>

                          <span className="text-[9px] text-slate-400 font-mono">
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
                                className="p-1 px-1.5 rounded-md hover:bg-slate-105 text-slate-450 hover:text-emerald-600 transition-all flex items-center gap-0.5 text-[9px] font-medium"
                                title={`Advance to ${next}`}
                              >
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            ) : <div className="w-6" />}
                          </div>
                        </div>

                      </div>
                    );
                  })
                ) : (
                  <div className="h-full border border-dashed border-slate-150 rounded-xl flex flex-col items-center justify-center py-10 text-slate-400 space-y-1 bg-white/40">
                    <Briefcase className="h-4.5 w-4.5 opacity-40 text-slate-300" />
                    <span className="text-xs">No leads in channel</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>

    </div>
  );
}
