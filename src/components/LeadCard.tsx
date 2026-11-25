import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Ban, ExternalLink, MessageSquare, Star } from 'lucide-react';
import { Lead, LeadStage } from '../types.ts';
import { getCountryFlagUrl, formatCandidateName } from '../utils';

export function getStageNeighbors(current: LeadStage): { prev: LeadStage | null; next: LeadStage | null } {
  const list: LeadStage[] = ['new', 'in_discussion', 'strong_opportunity', 'office_visited', 'won', 'cold_leads', 'lost'];
  let normalized = current;
  if (current === 'negotiating') normalized = 'in_discussion';
  else if (current === 'proposal') normalized = 'office_visited';
  else if (current === 'rotations') normalized = 'cold_leads';

  const idx = list.indexOf(normalized);
  return {
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx < list.length - 1 && idx >= 0 ? list[idx + 1] : null
  };
}

function getStageBadgeMeta(stage: LeadStage): { label: string; className: string } {
  switch (stage) {
    case 'new':
      return { label: '1. New Inbound', className: 'bg-sky-950/60 text-sky-300 border-sky-700/60' };
    case 'in_discussion':
    case 'negotiating':
      return { label: '2. In Discussion', className: 'bg-amber-950/60 text-amber-300 border-amber-700/60' };
    case 'strong_opportunity':
      return { label: '3. Strong Opportunity', className: 'bg-purple-950/60 text-purple-300 border-purple-700/60' };
    case 'office_visited':
    case 'proposal':
      return { label: '4. Office Visited', className: 'bg-indigo-950/60 text-indigo-300 border-indigo-700/60' };
    case 'won':
      return { label: '5. Won', className: 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60' };
    case 'cold_leads':
    case 'rotations':
      return { label: '6. Cold Leads', className: 'bg-blue-950/60 text-blue-300 border-blue-700/60' };
    case 'lost':
      return { label: '7. Lost', className: 'bg-rose-950/60 text-rose-300 border-rose-700/60' };
    default:
      return { label: String(stage || 'New'), className: 'bg-slate-800 text-slate-300 border-slate-700' };
  }
}

interface LeadCardProps {
  lead: Lead;
  onSelectLead: (lead: Lead) => void;
  onUpdateStage: (id: string, stage: LeadStage) => void;
  draggable?: boolean;
  showStageBadge?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export const LeadCard: React.FC<LeadCardProps> = ({
  lead,
  onSelectLead,
  onUpdateStage,
  draggable = true,
  showStageBadge = false,
  isSelected = false,
  onToggleSelect
}) => {
  const { prev, next } = getStageNeighbors(lead.stage);
  const r1 = String(lead.remarks1 || '').trim();
  const r2 = String(lead.remarks2 || '').trim();
  const r3 = String(lead.remarks3 || '').trim();
  const rawAdminR = String(lead.adminRemarks || '').trim();
  const adminR = rawAdminR.toLowerCase() === 'inbound whatsapp ad enquiry' ? '' : rawAdminR;
  const assigned = String(lead.assignedTo || '').trim();
  const hasRemarks = r1 !== '' || r2 !== '' || r3 !== '';
  const latestRemarkLabel = r3 !== '' ? '📞 3rd Remark' : r2 !== '' ? '📞 2nd Remark' : '📞 1st Remark';
  const latestRemarkValue = r3 !== '' ? r3 : r2 !== '' ? r2 : r1;

  let formattedDate = 'Recent';
  try {
    if (lead.updatedAt) {
      const d = new Date(lead.updatedAt);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
    }
  } catch {
    formattedDate = 'Recent';
  }

  const stageMeta = showStageBadge ? getStageBadgeMeta(lead.stage) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      draggable={draggable}
      onDragStart={(e: any) => {
        if (draggable && e.dataTransfer) {
          e.dataTransfer.setData('text/plain', lead.id);
          e.dataTransfer.effectAllowed = 'move';
        }
      }}
      className={`bg-slate-900/95 rounded-xl border p-3.5 2xl:p-4.5 shadow-[0_0_15px_rgba(16,185,129,0.02)] ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } relative group flex flex-col text-left h-full transition-all duration-150 ease-out transform hover:-translate-y-1 hover:border-emerald-500/50 hover:shadow-[0_0_22px_rgba(16,185,129,0.12)] select-none ${
        isSelected ? 'border-accent-purple ring-2 ring-accent-purple/40' : 'border-slate-800/90'
      }`}
      onClick={() => onSelectLead(lead)}
    >
      {/* Top Row: Selection Checkbox (optional) + Country Badge on Left, Document Checklists on Right */}
      <div className="flex justify-between items-center gap-1.5 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelect(lead.id)}
              className="h-3.5 w-3.5 rounded border-slate-700 text-accent-purple focus:ring-accent-purple cursor-pointer bg-slate-950 shrink-0"
              title="Select candidate for bulk action"
            />
          )}
          <span className="text-xs font-bold text-slate-200 bg-slate-805/90 border border-slate-700/80 px-2.5 py-1 rounded-md uppercase tracking-wider flex items-center gap-1.5 font-sans shrink-0 shadow-2xs">
            {lead.country && getCountryFlagUrl(String(lead.country)) ? (
              <img
                src={getCountryFlagUrl(String(lead.country))}
                alt=""
                className="w-4.5 h-3.5 object-cover rounded-2xs inline-block shadow-2xs shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span>🌐</span>
            )}
            {lead.country || 'Pending'}
          </span>

          {(() => {
            const unreadCount = (lead.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
            if (unreadCount > 0) {
              return (
                <span
                  className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-2xs font-mono border text-emerald-950 dark:text-emerald-100 bg-emerald-400 dark:bg-emerald-900/60 border-emerald-500/50 dark:border-emerald-500/60 animate-pulse"
                  title={`${unreadCount} unread WhatsApp message${unreadCount > 1 ? 's' : ''} received`}
                >
                  <MessageSquare className="h-3 w-3 fill-emerald-400 text-emerald-100" />
                  <span>{unreadCount}</span>
                </span>
              );
            }
            return null;
          })()}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {lead.docResume && (
            lead.resumeUrl ? (
              <a
                href={lead.resumeUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`View ${formatCandidateName(String(lead.name || 'Candidate'))}'s CV`}
                className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-800/60 hover:border-emerald-700 px-2 py-1 rounded-sm tracking-wider uppercase shadow-2xs transition-all flex items-center gap-1 cursor-pointer"
              >
                <span>CV ✓</span>
                <ExternalLink className="h-2.5 w-2.5 opacity-80" />
              </a>
            ) : (
              <span
                title="Resume marked as received offline (Click card to view details or generate CV)"
                className="text-[11px] font-bold text-emerald-400/80 bg-emerald-950/30 border border-emerald-900/40 px-2 py-1 rounded-sm tracking-wider uppercase shadow-2xs"
              >
                CV ✓
              </span>
            )
          )}
          {lead.docPassportCopy && (
            lead.passportCopyUrl ? (
              <a
                href={lead.passportCopyUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`View passport for ${formatCandidateName(String(lead.name || 'Candidate'))}`}
                className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-800/60 hover:border-emerald-700 px-2 py-1 rounded-sm tracking-wider uppercase shadow-2xs transition-all flex items-center gap-1 cursor-pointer"
              >
                <span>Passport ✓</span>
                <ExternalLink className="h-2.5 w-2.5 opacity-80" />
              </a>
            ) : (
              <span
                title="Passport marked as received offline"
                className="text-[11px] font-bold text-emerald-400/80 bg-emerald-950/30 border border-emerald-900/40 px-2 py-1 rounded-sm tracking-wider uppercase shadow-2xs"
              >
                Passport ✓
              </span>
            )
          )}
        </div>
      </div>

      {/* Optional Stage Badge for Spreadsheet Grid View */}
      {stageMeta && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className={`text-[9.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${stageMeta.className}`}>
            {stageMeta.label}
          </span>
          {lead.serialNo && (
            <span className="text-[10px] font-mono font-bold text-slate-400">
              {lead.serialNo}
            </span>
          )}
        </div>
      )}

      {/* Name, Stars & Blocked badge Section */}
      <div className="flex items-start justify-between gap-1.5 mb-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h4 className="font-extrabold text-slate-100 text-[0.9375rem] 2xl:text-base leading-tight tracking-wide uppercase font-poppins truncate" title={lead.name}>
              {formatCandidateName(String(lead.name || 'Candidate'))}
            </h4>
            {lead.isBlocked && (
              <span
                className="shrink-0 text-[0.5625rem] font-black text-white bg-red-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-xs uppercase tracking-wider"
                title={`BLOCKED: ${lead.blockedReason || 'Blocked candidate'}`}
              >
                <Ban className="h-2.5 w-2.5 stroke-[2.5]" />
                BLOCKED
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-0.5" title={`${lead.importance || 3} Stars`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`h-3.5 w-3.5 ${
                  i < (lead.importance || 3)
                    ? 'text-amber-400 fill-amber-400'
                    : 'text-slate-700'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Sub-Header: Contact Info & Gender-Age inline */}
      <div className="flex items-center justify-between gap-1.5 text-[0.75rem] 2xl:text-[0.84375rem] text-slate-400 font-sans pb-2 border-b border-slate-800/60 mb-2">
        <span className="font-mono tracking-wider font-bold text-slate-200 truncate min-w-0">{lead.phone || 'No Phone'}</span>
        <span className="font-mono text-slate-400 text-xs font-bold shrink-0 whitespace-nowrap">
          {(() => {
            const g = String(lead.gender || '').toUpperCase().trim();
            if (g === 'F' || g === 'FEMALE') return 'F';
            if (g === 'M' || g === 'MALE') return 'M';
            return 'N/A';
          })()} • Age {lead.age || 'N/A'}
        </span>
      </div>

      {/* Layer 1 Container: Candidate Info (Position, Project, Source, ECR) */}
      <div className="bg-slate-950/40 dark:bg-slate-950/30 border border-slate-800/80 rounded-lg p-3 space-y-2 mt-3 2xl:mt-4">
        <div className="flex items-center gap-1.5 truncate text-[0.78125rem] text-slate-200">
          <span className="text-slate-500 shrink-0">💼</span>
          <span className="font-bold truncate">
            {lead.position || 'General Applicant'}
          </span>
        </div>

        {lead.project && (
          <>
            <div className="h-[1px] bg-slate-800/40 w-full" />
            <div className="flex items-center gap-1.5 truncate text-[0.78125rem] text-slate-300">
              <span className="text-slate-500 shrink-0">🎯</span>
              <span className="truncate">
                Project: <span className="text-white font-extrabold">{lead.project}</span>
              </span>
            </div>
          </>
        )}

        {lead.source && (
          <>
            <div className="h-[1px] bg-slate-800/40 w-full" />
            <div className="flex items-center gap-1.5 truncate text-[0.78125rem] text-slate-300">
              <span className="text-slate-500 shrink-0">📣</span>
              <span className="truncate">
                Source: <span className="text-white font-extrabold">{lead.source}</span>
              </span>
            </div>
          </>
        )}

        {lead.docEcrPassport && (
          <>
            <div className="h-[1px] bg-slate-800/40 w-full" />
            <div className="inline-flex items-center gap-1.5 bg-red-950/20 border border-red-900/35 text-red-400 px-2 py-0.5 rounded-sm text-[0.65625rem] mt-1">
              <span>🛂 ECR Passport</span>
            </div>
          </>
        )}
      </div>

      {/* Layer 2 Container: Remarks */}
      <div className="bg-slate-950/40 dark:bg-slate-950/30 border border-slate-800/80 rounded-lg p-3 mt-2.5">
        {hasRemarks ? (
          <div className="border-l-2 border-emerald-500/40 pl-2.5 py-0.5 text-left transition-all group/remarks cursor-help">
            <span className="text-[0.625rem] uppercase font-bold text-emerald-400 block mb-1 tracking-wider flex justify-between items-center font-sans">
              <span>{latestRemarkLabel}</span>
              <span className="text-[0.5625rem] text-slate-500 normal-case font-normal group-hover/remarks:opacity-0 transition-opacity">Hover for full</span>
            </span>
            <p className="text-slate-100 italic font-sans text-[0.8125rem] leading-relaxed line-clamp-1 group-hover/remarks:line-clamp-none transition-all font-medium">
              "{latestRemarkValue}"
            </p>
          </div>
        ) : adminR !== '' ? (
          <div className="border-l-2 border-amber-500/40 pl-2.5 py-0.5 text-left transition-all group/adminRemarks cursor-help">
            <span className="text-[0.625rem] uppercase font-bold text-amber-400 block mb-1 tracking-wider flex justify-between items-center font-sans">
              <span className="flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                👑 ADMIN REMARK
              </span>
              <span className="text-[0.5625rem] text-slate-500 normal-case font-normal group-hover/adminRemarks:opacity-0 transition-opacity">Hover for full</span>
            </span>
            <p className="text-slate-100 italic font-sans text-[0.8125rem] leading-relaxed line-clamp-1 group-hover/adminRemarks:line-clamp-none transition-all font-medium">
              "{adminR}"
            </p>
          </div>
        ) : (
          <div className="text-[0.71875rem] text-left text-slate-500 font-sans font-medium italic flex items-center justify-between">
            <span>{lead.position ? `Intake: ${lead.position}` : 'Awaiting Telecaller Call'}</span>
            <span className="text-[0.59375rem] text-slate-500 font-mono uppercase tracking-wider">Awaiting Call</span>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1 min-h-[12px]" />

      {/* Move Controls */}
      <div className="flex justify-between items-center gap-1 pt-2 border-t border-slate-800/60 mt-1">
        <div>
          {prev ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdateStage(lead.id, prev);
              }}
              className="p-1 px-2.5 rounded-md bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-slate-100 transition-all flex items-center gap-0.5 border border-slate-700/40 cursor-pointer"
              title={`Move back to ${prev}`}
            >
              <ArrowLeft className="h-3 w-3" />
            </button>
          ) : (
            <div className="w-6" />
          )}
        </div>

        <div className="flex items-center gap-1.5 select-none text-center justify-center font-sans text-[0.6875rem] 2xl:text-[0.71875rem] font-bold text-slate-400 min-w-0 flex-1 px-1">
          <span className="font-mono tracking-wider whitespace-nowrap shrink-0">
            {formattedDate}
          </span>
          <span className="text-slate-600 font-normal shrink-0">|</span>
          {assigned !== '' && assigned.toLowerCase() !== 'unassigned' ? (
            <span className="text-indigo-400 font-black tracking-wider uppercase flex items-center gap-0.5 truncate min-w-0">
              👤 <span className="truncate">{assigned}</span>
            </span>
          ) : (
            <span className="text-slate-500 font-extrabold tracking-wider uppercase flex items-center gap-0.5 truncate min-w-0">
              👤 UNASSIGNED
            </span>
          )}
        </div>

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
          ) : (
            <div className="w-6" />
          )}
        </div>
      </div>
    </motion.div>
  );
};
