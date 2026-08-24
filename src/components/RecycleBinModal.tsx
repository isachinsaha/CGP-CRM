import React, { useState, useEffect } from 'react';
import { Lead } from '../types.ts';
import { X, Search, RotateCcw, ShieldAlert, CheckCircle, RefreshCw, Calendar, User, Phone } from 'lucide-react';

interface RecycleBinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreSuccess: () => void;
}

export default function RecycleBinModal({ isOpen, onClose, onRestoreSuccess }: RecycleBinModalProps) {
  const [deletedLeads, setDeletedLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchDeletedLeads = async () => {
    setLoading(true);
    try {
      // Fetch all soft-deleted leads (limit=1000 to get a comprehensive history)
      const res = await fetch('/api/leads?showDeleted=true&limit=1000');
      if (res.ok) {
        const data = await res.json();
        // The API returns { leads: [...], total: ... }
        if (data && Array.isArray(data.leads)) {
          setDeletedLeads(data.leads);
        } else if (Array.isArray(data)) {
          setDeletedLeads(data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch soft-deleted leads:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDeletedLeads();
      setFeedbackMsg(null);
      setSearchQuery('');
    }
  }, [isOpen]);

  const handleRestore = async (id: string, name: string) => {
    setRestoringId(id);
    setFeedbackMsg(null);
    try {
      const res = await fetch(`/api/leads/${id}/restore`, {
        method: 'POST'
      });
      if (res.ok) {
        setFeedbackMsg({
          type: 'success',
          text: `Successfully restored candidate "${name || 'Unnamed'}" back into the active pipeline!`
        });
        // Refresh local list
        await fetchDeletedLeads();
        // Refresh CRM parent dashboard
        onRestoreSuccess();
      } else {
        const errData = await res.json().catch(() => ({}));
        setFeedbackMsg({
          type: 'error',
          text: errData.error || 'Failed to restore candidate.'
        });
      }
    } catch (err) {
      console.error('Error during candidate restoration:', err);
      setFeedbackMsg({
        type: 'error',
        text: 'An error occurred during restoration.'
      });
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) return null;

  const filtered = deletedLeads.filter(l => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (l.name && l.name.toLowerCase().includes(q)) ||
      (l.phone && l.phone.includes(q)) ||
      (l.country && l.country.toLowerCase().includes(q)) ||
      (l.position && l.position.toLowerCase().includes(q)) ||
      (l.serialNo && l.serialNo.toLowerCase().includes(q)) ||
      (l.assignedTo && l.assignedTo.toLowerCase().includes(q))
    );
  });

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[999] p-4 animate-in fade-in duration-200">
      <div 
        className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        id="recycle-bin-modal-container"
      >
        {/* Header */}
        <div className="px-6 py-5 bg-slate-50 dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 text-rose-500 dark:text-rose-400 rounded-xl">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                Recycle Bin & Recovery Console
                <span className="text-[10px] font-mono font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded-full">
                  Foolproof Safe Guard
                </span>
              </h2>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                All deleted candidates are automatically preserved here. Only administrators can view and recover them.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-3 items-center justify-between bg-white dark:bg-slate-900">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input 
              type="text"
              placeholder="Search deleted candidates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs font-bold bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 focus:outline-hidden focus:border-indigo-500"
            />
          </div>
          
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span className="font-mono px-2 py-0.5 bg-slate-100 dark:bg-slate-950 rounded-md">
              {filtered.length} of {deletedLeads.length}
            </span>
            <span>records found</span>
            <button
              onClick={fetchDeletedLeads}
              className="p-1 text-slate-400 hover:text-indigo-500 transition cursor-pointer ml-1"
              title="Refresh Records"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Feedback Alert Banner */}
        {feedbackMsg && (
          <div className={`mx-6 mt-4 p-3.5 rounded-2xl flex items-start gap-3 border ${
            feedbackMsg.type === 'success' 
              ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300' 
              : 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300'
          }`}>
            {feedbackMsg.type === 'success' ? (
              <CheckCircle className="h-5 w-5 shrink-0 text-emerald-500 mt-0.5" />
            ) : (
              <ShieldAlert className="h-5 w-5 shrink-0 text-rose-500 mt-0.5" />
            )}
            <div>
              <p className="text-xs font-bold leading-relaxed">{feedbackMsg.text}</p>
            </div>
          </div>
        )}

        {/* Table / Content */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[300px]">
          {loading && deletedLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
              <p className="text-xs font-bold text-slate-400">Loading archived candidate records...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-16 w-16 bg-slate-50 dark:bg-slate-950 text-slate-400 rounded-full flex items-center justify-center mb-4">
                <ShieldAlert className="h-8 w-8 text-slate-300 dark:text-slate-700" />
              </div>
              <h3 className="text-sm font-black text-slate-700 dark:text-slate-300">
                {searchQuery ? 'No matching records' : 'Recycle Bin is empty'}
              </h3>
              <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs mt-1 leading-relaxed">
                {searchQuery 
                  ? 'Try modifying your search keywords or check spelling.' 
                  : 'Perfect! Every single lead is safely stored inside your active pipeline.'}
              </p>
            </div>
          ) : (
            <div className="border border-slate-100 dark:border-slate-800/80 rounded-2xl overflow-hidden bg-slate-50/40 dark:bg-slate-950/20">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100/50 dark:bg-slate-950/80 border-b border-slate-200/50 dark:border-slate-800">
                      <th className="px-4 py-3 text-[10px] font-mono font-bold uppercase text-slate-400">Candidate Info</th>
                      <th className="px-4 py-3 text-[10px] font-mono font-bold uppercase text-slate-400">Interest</th>
                      <th className="px-4 py-3 text-[10px] font-mono font-bold uppercase text-slate-400">Coordinator / Stage</th>
                      <th className="px-4 py-3 text-[10px] font-mono font-bold uppercase text-slate-400">Deleted Date</th>
                      <th className="px-4 py-3 text-right text-[10px] font-mono font-bold uppercase text-slate-400">Recovery Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/40">
                    {filtered.map((lead) => (
                      <tr key={lead.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition">
                        {/* Candidate Info */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                              {lead.name || 'Unnamed Applicant'}
                              {lead.serialNo && (
                                <span className="text-[9.5px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.2 rounded-sm">
                                  {lead.serialNo}
                                </span>
                              )}
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 mt-0.5">
                              <Phone className="h-2.5 w-2.5" />
                              {lead.phone || 'No phone'}
                            </span>
                          </div>
                        </td>

                        {/* Country / Position */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                              {lead.position || 'General Position'}
                            </span>
                            <span className="text-[10px] font-bold text-indigo-500 mt-0.5">
                              {lead.country || 'No Specific Country'}
                            </span>
                          </div>
                        </td>

                        {/* Coordinator / Stage */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                              <User className="h-3 w-3 text-slate-400" />
                              {lead.assignedTo || 'Unassigned'}
                            </span>
                            <span className="text-[10px] font-mono font-bold text-slate-400 mt-0.5">
                              Stage: <span className="uppercase text-amber-500 font-black">{lead.stage || 'new'}</span>
                            </span>
                          </div>
                        </td>

                        {/* Deleted Date */}
                        <td className="px-4 py-3 text-xs font-bold text-slate-500 dark:text-slate-400 font-mono">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-slate-400" />
                            {lead.deletedAt ? new Date(lead.deletedAt).toLocaleDateString() : 'N/A'}
                          </div>
                        </td>

                        {/* Recovery Action */}
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleRestore(lead.id, lead.name || '')}
                            disabled={restoringId !== null}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                              restoringId === lead.id
                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                                : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 shadow-xs'
                            }`}
                          >
                            <RotateCcw className={`h-3 w-3 ${restoringId === lead.id ? 'animate-spin' : ''}`} />
                            <span>{restoringId === lead.id ? 'Restoring...' : 'Restore'}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-black rounded-xl transition cursor-pointer"
          >
            Close Console
          </button>
        </div>
      </div>
    </div>
  );
}
