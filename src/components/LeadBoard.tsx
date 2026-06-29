import React, { useState } from 'react';
import { Lead, LeadStage } from '../types.ts';
import { TrendingUp, ArrowRight, ArrowLeft, MessageSquare, Briefcase, Calendar, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { getCountryFlagUrl } from '../utils';

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
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null);

  const COLUMNS: Column[] = [
    { id: 'new', title: 'New Inbound', color: 'border-slate-750 bg-slate-900/35', headerColor: 'text-slate-300 bg-slate-800 font-medium' },
    { id: 'contacted', title: 'Initial Contact', color: 'border-slate-750 bg-slate-900/35', headerColor: 'text-sky-400 bg-sky-950/40 font-medium' },
    { id: 'negotiating', title: 'In Discussion', color: 'border-slate-750 bg-slate-900/35', headerColor: 'text-amber-400 bg-amber-950/40 font-medium' },
    { id: 'proposal', title: 'Office Visited', color: 'border-slate-750 bg-slate-900/35', headerColor: 'text-purple-400 bg-purple-950/40 font-medium' },
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
        <div className="flex items-center justify-between mb-5 border-b border-slate-750/80 pb-4">
          <div>
            <h3 className="text-xs font-black text-slate-100 uppercase tracking-widest flex items-center gap-2 font-display">
              <TrendingUp className="h-4 w-4 text-accent-emerald" />
              Your Candidate Pipeline
            </h3>
            <p className="text-[11px] text-slate-500 font-bold mt-0.5">
              Drag-and-drop or use quick arrows to progress candidates from initial entry to successful placement
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-wider font-mono">
            <span>Columns: {COLUMNS.length} Stages</span>
          </div>
        </div>

        {/* Pipeline horizontal channel area (No Double Border) */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-accent-purple/5 via-transparent to-accent-emerald/5 pointer-events-none rounded-2xl" />
          
          {/* Grid Columns */}
          <div className="flex gap-4 overflow-x-auto pb-4 w-full relative z-10" id="kanban-pipeline-columns">
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
                className={`rounded-2xl border p-4 flex flex-col min-h-[580px] w-[270px] lg:w-[285px] shrink-0 h-full text-left shadow-md transition-all duration-200 ${
                  isDraggedOver 
                    ? 'border-accent-purple bg-accent-purple/10 scale-[1.01] shadow-xl ring-2 ring-accent-purple/20' 
                    : 'border-slate-750 bg-slate-900/90'
                }`}
              >
                {/* Column Header */}
                <div className="flex items-center justify-between mb-4 border-b border-slate-750 pb-2.5">
                  <span className={`text-[11px] font-black uppercase tracking-wider px-2.5 py-1 rounded-md ${col.headerColor}`}>
                    {col.title} ({colLeads.length})
                  </span>
                </div>

              {/* Leads Stack */}
              <div className="space-y-3.5 flex-1 overflow-y-auto max-h-[550px] scrollbar-none">
                {colLeads.length > 0 ? (
                  colLeads.map(lead => {
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
                        className="bg-slate-850 rounded-xl border border-slate-750 p-4 shadow-sm hover:shadow-xl hover:border-accent-purple hover:-translate-y-0.5 transition-all duration-200 cursor-grab active:cursor-grabbing relative group flex flex-col"
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
                        <h4 className="font-black text-slate-100 text-sm tracking-tight uppercase font-display">{lead.name}</h4>
                        <div className="flex items-center justify-between mt-1 pb-2 border-b border-slate-750/80">
                          <span className="text-[10px] text-slate-400 font-bold font-mono">{lead.phone}</span>
                          <span className="text-[9px] bg-slate-800 border border-slate-750 font-bold px-1.5 py-0.5 rounded text-slate-300 uppercase font-mono">
                            {lead.gender === 'F' ? 'F' : 'M'}, Age {lead.age || '24'}
                          </span>
                        </div>

                        {/* Position Indicator */}
                        <span className="text-[9px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/30 px-2.5 py-1 rounded font-bold uppercase truncate block mt-2.5 text-left w-full font-display">
                          💼 {lead.position || 'General Applicant'}
                        </span>

                        {lead.project && (
                          <span className="text-[9px] text-accent-purple bg-purple-950/40 border border-purple-900/30 px-2.5 py-1 rounded font-black uppercase truncate block mt-1.5 text-left w-full font-display">
                            🎯 Project: {lead.project}
                          </span>
                        )}

                        {lead.source && (
                          <span className="text-[9px] text-slate-300 bg-slate-800 border border-slate-750 px-2.5 py-1 rounded font-bold uppercase truncate block mt-1.5 text-left w-full font-display">
                            📣 Source: {lead.source}
                          </span>
                        )}

                        {/* Telecaller Remarks Log Indicator */}
                        {hasRemarks ? (
                          <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-750 text-[10px] text-left mt-2.5 transition-all duration-200 hover:bg-slate-800/90 group/remarks cursor-help">
                            <span className="text-[8px] uppercase font-black text-accent-emerald block mb-0.5 tracking-wider flex justify-between items-center font-display">
                              <span>{lead.remarks3 ? "📞 3'rd Remarks" : lead.remarks2 ? "📞 2'nd Remarks" : "📞 1'st Remark"}</span>
                              <span className="text-[7px] text-slate-500 normal-case font-normal group-hover/remarks:hidden">Hover to view full</span>
                            </span>
                            <p className="text-slate-300 truncate group-hover/remarks:whitespace-normal group-hover/remarks:break-all italic font-medium font-mono transition-all duration-250">
                              "{lead.remarks3 || lead.remarks2 || lead.remarks1}"
                            </p>
                          </div>
                        ) : (
                          <div className="bg-slate-900/40 p-2 rounded-lg border border-dashed border-slate-750 text-[10px] text-left text-slate-500 mt-2.5">
                            No Remarks Logged
                          </div>
                        )}

                        {/* Coordinator Badge */}
                        {lead.assignedTo && (
                          <div className="text-[10px] mt-2.5 flex justify-between items-center border-t border-slate-750 pt-2 text-left">
                            <span className="text-slate-500 font-bold">Coordinator:</span>
                            <span className="text-accent-purple font-black bg-purple-950/40 border border-purple-900/30 px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-display">
                              👤 {lead.assignedTo}
                            </span>
                          </div>
                        )}

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Move Controls */}
                        <div className="flex justify-between items-center gap-1 pt-2 border-t border-slate-750 mt-2.5">
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
                  })
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
      </div>
    </div>
  );
}
