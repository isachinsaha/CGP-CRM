import React, { useState, useEffect } from 'react';
import { X, Copy, Trash2, CheckCircle2, AlertTriangle, RefreshCw, ArrowRight, ShieldAlert } from 'lucide-react';
import { Lead } from '../types';

interface DuplicateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshData: () => void;
}

interface DuplicateGroup {
  normalizedPhone: string;
  originalPhone: string;
  leads: Lead[];
}

export const DuplicateManagerModal: React.FC<DuplicateManagerModalProps> = ({
  isOpen,
  onClose,
  onRefreshData,
}) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [masterSelections, setMasterSelections] = useState<{ [normalizedPhone: string]: string }>({});

  const fetchLeads = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/leads');
      if (!res.ok) throw new Error('Failed to fetch leads');
      const data = await res.json();
      const allLeads = data.leads || data;
      setLeads(allLeads);

      // Auto-select master for each duplicate group (oldest created lead)
      const groups = computeDuplicateGroups(allLeads);
      const selections: { [key: string]: string } = {};
      groups.forEach(g => {
        if (g.leads.length > 0) {
          // Sort by createdAt or entryDate ascending (oldest first)
          const sorted = [...g.leads].sort((a, b) => {
            const timeA = new Date(a.createdAt || a.entryDate || 0).getTime();
            const timeB = new Date(b.createdAt || b.entryDate || 0).getTime();
            return timeA - timeB;
          });
          selections[g.normalizedPhone] = sorted[0].id;
        }
      });
      setMasterSelections(selections);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error loading leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLeads();
    }
  }, [isOpen]);

  const normalizePhone = (phone?: string): string => {
    if (!phone) return '';
    let digits = String(phone).replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      digits = digits.slice(2);
    } else if (digits.length === 13 && digits.startsWith('091')) {
      digits = digits.slice(3);
    }
    return digits;
  };

  const computeDuplicateGroups = (currentLeads: Lead[]): DuplicateGroup[] => {
    const map = new Map<string, { originalPhone: string; leads: Lead[] }>();

    currentLeads.forEach(lead => {
      const nPhone = normalizePhone(lead.phone);
      if (!nPhone || nPhone.length < 6) return; // Ignore invalid/empty phones

      if (!map.has(nPhone)) {
        map.set(nPhone, { originalPhone: lead.phone, leads: [] });
      }
      map.get(nPhone)!.leads.push(lead);
    });

    const groups: DuplicateGroup[] = [];
    map.forEach((value, key) => {
      if (value.leads.length > 1) {
        groups.push({
          normalizedPhone: key,
          originalPhone: value.originalPhone,
          leads: value.leads,
        });
      }
    });

    return groups;
  };

  const duplicateGroups = computeDuplicateGroups(leads);

  const handleMergeGroup = async (normalizedPhone: string, groupLeads: Lead[]) => {
    const masterId = masterSelections[normalizedPhone];
    if (!masterId) {
      alert('Please select a master lead to keep.');
      return;
    }

    const masterLead = groupLeads.find(l => l.id === masterId);
    const duplicates = groupLeads.filter(l => l.id !== masterId);

    if (!masterLead || duplicates.length === 0) return;

    if (!confirm(`Are you sure you want to merge ${duplicates.length} duplicate record(s) into ${masterLead.name} (${masterLead.serialNo})? The duplicate entries will be deleted and their history merged.`)) {
      return;
    }

    setMergingId(normalizedPhone);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/leads/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterLeadId: masterLead.id,
          duplicateLeadIds: duplicates.map(d => d.id),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Failed to merge duplicates');
      }

      setSuccessMsg(`Successfully merged duplicates for phone ${normalizedPhone}!`);
      await fetchLeads();
      onRefreshData();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to merge leads');
    } finally {
      setMergingId(null);
    }
  };

  const handleAutoMergeAll = async () => {
    if (duplicateGroups.length === 0) return;
    if (!confirm(`Are you sure you want to auto-merge all duplicate groups? The oldest record for each phone number will be kept as master, and all newer duplicates will be merged and deleted.`)) {
      return;
    }

    setMergingId('all');
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      let mergedCount = 0;
      for (const group of duplicateGroups) {
        const masterId = masterSelections[group.normalizedPhone] || group.leads[0].id;
        const duplicates = group.leads.filter(l => l.id !== masterId);
        if (duplicates.length === 0) continue;

        const res = await fetch('/api/leads/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            masterLeadId: masterId,
            duplicateLeadIds: duplicates.map(d => d.id),
          }),
        });
        if (res.ok) {
          mergedCount += duplicates.length;
        }
      }

      setSuccessMsg(`Successfully auto-merged and cleaned up duplicate leads (${mergedCount} duplicates removed)!`);
      await fetchLeads();
      onRefreshData();
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error during auto-merge');
    } finally {
      setMergingId(null);
    }
  };

  const handleDeleteSingle = async (leadId: string) => {
    if (!confirm('Are you sure you want to delete this duplicate lead?')) return;
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete lead');
      await fetchLeads();
      onRefreshData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-850 border-b border-slate-750 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 rounded-2xl border border-amber-500/20">
              <Copy className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-black text-white flex items-center gap-2">
                Duplicate Leads Manager & Strict Uniqueness Guard
              </h2>
              <p className="text-xs text-slate-400">
                Identify leads sharing the same phone number (ignoring +91 country code differences) and merge them securely.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {duplicateGroups.length > 0 && (
              <button
                onClick={handleAutoMergeAll}
                disabled={mergingId !== null}
                className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-amber-950/40 cursor-pointer disabled:opacity-50"
              >
                {mergingId === 'all' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                <span>Auto-Merge All Duplicates</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {successMsg && (
            <div className="p-4 bg-emerald-950/50 border border-emerald-500/30 rounded-2xl flex items-center gap-3 text-emerald-300 text-xs font-bold">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 bg-rose-950/50 border border-rose-500/30 rounded-2xl flex items-center gap-3 text-rose-300 text-xs font-bold">
              <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
              <RefreshCw className="h-8 w-8 animate-spin text-amber-400" />
              <p className="text-xs font-bold uppercase tracking-wider">Scanning CRM database for duplicate phone numbers...</p>
            </div>
          ) : duplicateGroups.length === 0 ? (
            <div className="text-center py-16 space-y-3 bg-slate-850/50 rounded-3xl border border-slate-800">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20">
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              </div>
              <h3 className="text-sm font-black text-white">No Duplicate Leads Found!</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                All lead phone numbers are completely unique across the CRM database. Strict country code (+91) uniqueness enforcement is active.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                  <span className="text-xs font-bold text-amber-200">
                    Found <strong className="text-amber-400">{duplicateGroups.length}</strong> phone number group(s) with duplicate entries (+91 / country code variations).
                  </span>
                </div>
                <span className="text-[10px] font-mono text-amber-300/80 uppercase bg-amber-500/20 px-2 py-1 rounded-lg">
                  Strict Rule Active
                </span>
              </div>

              <div className="space-y-4">
                {duplicateGroups.map((group) => {
                  const selectedMasterId = masterSelections[group.normalizedPhone] || group.leads[0].id;
                  const isMerging = mergingId === group.normalizedPhone;

                  return (
                    <div key={group.normalizedPhone} className="bg-slate-850 border border-slate-750 rounded-2xl p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-750 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-black text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-xl border border-amber-500/20">
                            Phone: {group.originalPhone} (Norm: {group.normalizedPhone})
                          </span>
                          <span className="text-xs font-bold text-slate-400">
                            ({group.leads.length} records)
                          </span>
                        </div>
                        <button
                          onClick={() => handleMergeGroup(group.normalizedPhone, group.leads)}
                          disabled={isMerging || mergingId !== null}
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-md shadow-emerald-950/30 cursor-pointer disabled:opacity-50"
                        >
                          {isMerging ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                          <span>Merge Group (Keep Selected Master)</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {group.leads.map((lead) => {
                          const isMaster = lead.id === selectedMasterId;
                          return (
                            <div
                              key={lead.id}
                              onClick={() => setMasterSelections({ ...masterSelections, [group.normalizedPhone]: lead.id })}
                              className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between gap-3 ${
                                isMaster
                                  ? 'bg-amber-500/10 border-amber-500/50 shadow-sm'
                                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-white">{lead.name}</span>
                                    <span className="text-[10px] font-mono text-slate-400">{lead.serialNo}</span>
                                  </div>
                                  <p className="text-[11px] text-slate-300 mt-0.5">Phone: {lead.phone} {lead.alternateNo ? `(Alt: ${lead.alternateNo})` : ''}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  {isMaster ? (
                                    <span className="px-2 py-0.5 bg-amber-500 text-slate-950 text-[10px] font-black uppercase rounded-md">
                                      ★ Master
                                    </span>
                                  ) : (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteSingle(lead.id);
                                      }}
                                      className="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded-lg transition"
                                      title="Delete this duplicate record"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
                                <span>Assigned: <strong className="text-slate-200">{lead.assignedTo || 'Unassigned'}</strong></span>
                                <span>Stage: <strong className="text-slate-200 uppercase">{lead.stage}</strong></span>
                                <span>Date: {lead.entryDate || lead.createdAt?.split('T')[0]}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-850 border-t border-slate-750 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            Click any card to select it as the <strong className="text-amber-400">Master Record</strong> when merging.
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer"
          >
            Close Manager
          </button>
        </div>
      </div>
    </div>
  );
};
