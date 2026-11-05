import React, { useState, useEffect } from 'react';
import { 
  X, Plus, Edit2, Trash2, Check, Coins, Lock, Globe, Briefcase, Info, Target, Trophy, CheckCircle 
} from 'lucide-react';
import { IncentiveRule } from '../types.ts';

interface IncentiveRulesManagerProps {
  userRole: 'admin' | 'agent';
  onClose: () => void;
  onRulesChanged?: () => void;
  countries: string[];
  projects: string[];
}

export default function IncentiveRulesManager({
  userRole,
  onClose,
  onRulesChanged,
  countries = [],
  projects = []
}: IncentiveRulesManagerProps) {
  const [rules, setRules] = useState<IncentiveRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states for adding a new rule
  const [newProject, setNewProject] = useState('any');
  const [newCountry, setNewCountry] = useState('All');
  const [newAmount, setNewAmount] = useState<number | ''>('');

  // Editing states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProject, setEditProject] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editAmount, setEditAmount] = useState<number>(0);

  // Monthly Target states (Coord Bishwo & Priya)
  const [targetWonCount, setTargetWonCount] = useState<number>(15);
  const [tier1Rate, setTier1Rate] = useState<number>(300);
  const [tier2Rate, setTier2Rate] = useState<number>(150);
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetSuccess, setTargetSuccess] = useState<string | null>(null);

  const fetchMonthlyTargetSettings = async () => {
    try {
      const res = await fetch('/api/monthly-target-settings');
      if (res.ok) {
        const data = await res.json();
        setTargetWonCount(data.targetWonCount || 15);
        setTier1Rate(data.tier1Rate || 300);
        setTier2Rate(data.tier2Rate || 150);
      }
    } catch {}
  };

  const handleSaveMonthlyTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTarget(true);
    setTargetSuccess(null);
    try {
      const res = await fetch('/api/monthly-target-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetWonCount: Number(targetWonCount) || 15,
          tier1Rate: Number(tier1Rate) || 300,
          tier2Rate: Number(tier2Rate) || 150,
          targetCoordinators: ['bishwo', 'priya']
        })
      });
      if (res.ok) {
        setTargetSuccess('Monthly target rules saved successfully!');
        if (onRulesChanged) onRulesChanged();
        setTimeout(() => setTargetSuccess(null), 3500);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingTarget(false);
    }
  };

  // Fetch rules from server on mount
  const fetchRules = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/incentive-rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data);
      } else {
        setError('Failed to fetch incentive rules from Express backend');
      }
    } catch (err) {
      console.error(err);
      setError('Network error loading incentive structures');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userRole === 'admin') {
      fetchRules();
      fetchMonthlyTargetSettings();
    }
  }, [userRole]);

  if (userRole !== 'admin') {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-sm text-center">
          <Lock className="h-10 w-10 text-red-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-100">Access Denied</h3>
          <p className="text-xs text-slate-400 mt-2">Only administrators are permitted to configure incentive rules & compensation amounts.</p>
          <button 
            onClick={onClose} 
            className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Handle adding a rule
  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newAmount === '') {
      alert('Please enter a valid incentive amount');
      return;
    }

    try {
      const res = await fetch('/api/incentive-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: newProject,
          country: newCountry,
          amount: Number(newAmount)
        })
      });

      if (res.ok) {
        setNewAmount('');
        setNewProject('any');
        setNewCountry('All');
        await fetchRules();
        if (onRulesChanged) onRulesChanged();
      } else {
        const errData = await res.json();
        alert(errData.error || 'Failed to create rule.');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to connect to backend server');
    }
  };

  // Start editing a rule
  const startEditing = (rule: IncentiveRule) => {
    setEditingId(rule.id);
    setEditProject(rule.projectName);
    setEditCountry(rule.country);
    setEditAmount(rule.amount);
  };

  // Save edit
  const handleSaveEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/incentive-rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: editProject,
          country: editCountry,
          amount: Number(editAmount)
        })
      });

      if (res.ok) {
        setEditingId(null);
        await fetchRules();
        if (onRulesChanged) onRulesChanged();
      } else {
        const errData = await res.json();
        alert(errData.error || 'Failed to update rule');
      }
    } catch (err) {
      console.error(err);
      alert('Connection error saving rule updates');
    }
  };

  // Delete a rule
  const handleDeleteRule = async (id: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this incentive structure rule? It will revert to default fallback rules.')) return;
    try {
      const res = await fetch(`/api/incentive-rules/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await fetchRules();
        if (onRulesChanged) onRulesChanged();
      } else {
        alert('Failed to delete rule from backend database');
      }
    } catch (err) {
      console.error(err);
      alert('Connection error deleting rule');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-left">
      <div className="bg-slate-850 rounded-3xl shadow-2xl border border-slate-750 w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-100">
        
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4.5 border-b border-slate-750 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-950 border border-purple-800 text-accent-purple rounded-xl">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-100 text-base">Incentive structures & Compensation Rules</h3>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">MANAGE SYSTEM COMPENSATION CRITERIA & REWARD AMOUNTS</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 px-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-100 rounded-lg cursor-pointer transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-purple-950/20 border-b border-purple-900/30 px-6 py-3 flex items-start gap-3 text-xs text-purple-200">
          <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">How Rules are Evaluated:</p>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
              When a lead transitions to <strong>Closed Won ✅</strong>, the system checks these rules. The rule matching the candidate's exact <strong>Project</strong> and target <strong>Country</strong> is used. Wildcards (<code className="text-slate-300 font-mono">any</code> project or <code className="text-slate-300 font-mono">All</code> countries) serve as fallbacks if no specific override exists.
            </p>
          </div>
        </div>

        {/* Scrollable Container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Monthly Won Target Form (Bishwo & Priya) */}
          <div className="bg-gradient-to-r from-slate-900/80 via-slate-900 to-indigo-950/40 p-5 rounded-2xl border border-indigo-500/30 shadow-lg space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/20 border border-indigo-500/30 rounded-xl text-indigo-400">
                  <Target className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-black text-slate-100 uppercase tracking-wider">
                      Monthly Won Target & Tier Rates
                    </h4>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[9px] font-black uppercase">
                      Bishwo & Priya
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Target milestone bonuses for Coord Bishwo (BDM) & Priya (Manager) credited at month end.
                  </p>
                </div>
              </div>
              
              {targetSuccess && (
                <div className="px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5 animate-in fade-in">
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>{targetSuccess}</span>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveMonthlyTarget} className="space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    🎯 Monthly Won Target (Candidates)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={targetWonCount}
                    onChange={(e) => setTargetWonCount(Number(e.target.value) || 1)}
                    className="w-full text-xs px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    placeholder="e.g. 15"
                    required
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Target threshold (default: 15 won)</p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    🏆 Target Met Rate (INR / candidate)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={tier1Rate}
                    onChange={(e) => setTier1Rate(Number(e.target.value) || 0)}
                    className="w-full text-xs px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    placeholder="e.g. 300"
                    required
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Applied when won ≥ target (15 won = 4,500 INR)</p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    ⏳ Below Target Rate (INR / candidate)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={tier2Rate}
                    onChange={(e) => setTier2Rate(Number(e.target.value) || 0)}
                    className="w-full text-xs px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono focus:ring-1 focus:ring-amber-500 focus:outline-none"
                    placeholder="e.g. 150"
                    required
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Applied when won &lt; target (14 won = 2,100 INR)</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                <div className="text-[11px] text-slate-400">
                  <span className="font-bold text-slate-300">Live Preview: </span>
                  <span className="text-emerald-400 font-mono font-bold">15 won = INR {(15 * tier1Rate).toLocaleString()}</span>
                  <span className="text-slate-500"> | </span>
                  <span className="text-emerald-400 font-mono font-bold">16 won = INR {(16 * tier1Rate).toLocaleString()}</span>
                  <span className="text-slate-500"> | </span>
                  <span className="text-amber-400 font-mono font-bold">14 won = INR {(14 * tier2Rate).toLocaleString()}</span>
                </div>

                <button
                  type="submit"
                  disabled={savingTarget}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50 self-end sm:self-auto shadow-md"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>{savingTarget ? 'Saving...' : 'Save Target & Rates'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Rule Creator Form */}
          <div className="bg-slate-900/40 p-4 rounded-2xl border border-slate-800">
            <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider mb-3">Create New Incentive Structure Rule</h4>
            <form onSubmit={handleAddRule} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1">
                  <Briefcase className="h-3 w-3" /> Target Project
                </label>
                <select
                  value={newProject}
                  onChange={(e) => setNewProject(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none"
                >
                  <option value="any">-- Any Project (Wildcard) --</option>
                  {projects.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1">
                  <Globe className="h-3 w-3" /> Destination Country
                </label>
                <select
                  value={newCountry}
                  onChange={(e) => setNewCountry(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none"
                >
                  <option value="All">-- All Countries (Wildcard) --</option>
                  {countries.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1 flex items-center gap-1">
                  💵 Incentive Amount (INR)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 500"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value !== '' ? Number(e.target.value) : '')}
                  className="w-full text-xs px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-accent-purple focus:outline-none font-mono"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-accent-purple hover:bg-accent-purple/90 text-white rounded-xl text-xs font-black cursor-pointer flex items-center justify-center gap-1.5 transition-all shadow-md shadow-accent-purple/10"
              >
                <Plus className="h-4 w-4" /> Add Structure Rule
              </button>
            </form>
          </div>

          {/* Rules List */}
          <div className="space-y-3">
            <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span>Active Incentive structures ({rules.length})</span>
              {loading && <span className="text-[10px] text-slate-500 animate-pulse font-mono font-bold uppercase">Refreshing...</span>}
            </h4>

            {error && (
              <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/60 p-3 rounded-xl">
                {error}
              </div>
            )}

            {!loading && rules.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                No custom incentive structures have been added yet. Standard fallback is INR 400.
              </div>
            ) : (
              <div className="overflow-hidden border border-slate-800 rounded-2xl bg-slate-900/10">
                <table className="w-full text-left text-xs text-slate-200 border-collapse">
                  <thead>
                    <tr className="bg-slate-900/65 text-slate-400 font-mono uppercase text-[10px] border-b border-slate-800">
                      <th className="p-4 font-black">Hiring Project</th>
                      <th className="p-4 font-black">Destination Country</th>
                      <th className="p-4 font-black">Incentive Reward (INR)</th>
                      <th className="p-4 font-black text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => {
                      const isEditing = editingId === rule.id;
                      return (
                        <tr key={rule.id} className="border-b border-slate-800/60 hover:bg-slate-900/20 transition-all">
                          <td className="p-4 font-semibold">
                            {isEditing ? (
                              <select
                                value={editProject}
                                onChange={(e) => setEditProject(e.target.value)}
                                className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-750 text-slate-100"
                              >
                                <option value="any">any</option>
                                {projects.map(p => (
                                  <option key={p} value={p}>{p}</option>
                                ))}
                              </select>
                            ) : (
                              <span className={rule.projectName === 'any' ? 'text-slate-500 italic' : 'text-slate-200'}>
                                {rule.projectName === 'any' ? 'Any Project (Wildcard)' : rule.projectName}
                              </span>
                            )}
                          </td>
                          <td className="p-4 font-semibold">
                            {isEditing ? (
                              <select
                                value={editCountry}
                                onChange={(e) => setEditCountry(e.target.value)}
                                className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-750 text-slate-100"
                              >
                                <option value="All">All</option>
                                {countries.map(c => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            ) : (
                              <span className={['all', 'any', 'all countries'].includes(rule.country.toLowerCase()) ? 'text-slate-500 italic' : 'text-slate-200'}>
                                {['all', 'any', 'all countries'].includes(rule.country.toLowerCase()) ? 'All Countries (Wildcard)' : rule.country}
                              </span>
                            )}
                          </td>
                          <td className="p-4 font-bold text-accent-emerald font-mono">
                            {isEditing ? (
                              <input
                                type="number"
                                value={editAmount}
                                onChange={(e) => setEditAmount(Number(e.target.value))}
                                className="w-24 text-xs px-2 py-1 bg-slate-950 border border-slate-750 text-slate-100 font-mono rounded"
                              />
                            ) : (
                              <span>INR {rule.amount.toLocaleString('en-IN')}</span>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            {isEditing ? (
                              <div className="flex gap-1.5 justify-end">
                                <button
                                  onClick={() => handleSaveEdit(rule.id)}
                                  className="p-1.5 bg-emerald-950 border border-emerald-800 hover:bg-emerald-900 text-emerald-400 hover:text-emerald-300 rounded-lg transition-all cursor-pointer"
                                  title="Save rule edits"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="p-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition-all cursor-pointer"
                                  title="Cancel edit"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-1.5 justify-end">
                                <button
                                  onClick={() => startEditing(rule)}
                                  className="p-1.5 bg-slate-800 border border-slate-700 hover:bg-slate-750 text-slate-350 hover:text-slate-100 rounded-lg transition-all cursor-pointer"
                                  title="Edit incentive rule"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteRule(rule.id)}
                                  className="p-1.5 bg-rose-950/40 border border-rose-900/60 hover:bg-rose-900 text-rose-400 hover:text-rose-200 rounded-lg transition-all cursor-pointer"
                                  title="Delete incentive rule"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-900 px-6 py-4.5 border-t border-slate-750 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer transition-all border border-slate-700"
          >
            Close Manager
          </button>
        </div>

      </div>
    </div>
  );
}
