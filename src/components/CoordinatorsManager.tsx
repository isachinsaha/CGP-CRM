import React, { useState, useEffect } from 'react';
import { Coordinator } from '../types.ts';
import { 
  UserPlus, Pencil, Trash2, Key, UserCheck, ShieldAlert, X, Plus, 
  Check, Shield, Users, RefreshCw, Eye, EyeOff, Search
} from 'lucide-react';

interface CoordinatorsManagerProps {
  userRole: 'admin' | 'agent';
  onCoordinatorsChanged: () => void;
  onClose: () => void;
}

export default function CoordinatorsManager({ userRole, onCoordinatorsChanged, onClose }: CoordinatorsManagerProps) {
  const [coordinators, setCoordinators] = useState<Coordinator[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Create / Edit Form State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCoord, setEditingCoord] = useState<Coordinator | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<'admin' | 'agent'>('agent');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showFormPass, setShowFormPass] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // Load accounts
  const loadCoordinators = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/coordinators');
      if (res.ok) {
        const data = await res.json();
        setCoordinators(data);
      }
    } catch (err) {
      console.error('Failed to load coordinators:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCoordinators();
  }, []);

  const handleOpenCreate = () => {
    setEditingCoord(null);
    setFormUsername('');
    setFormDisplayName('');
    setFormPassword('');
    setFormRole('agent');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenEdit = (coord: Coordinator) => {
    setEditingCoord(coord);
    setFormUsername(coord.username);
    setFormDisplayName(coord.displayName);
    setFormPassword(coord.password || '');
    setFormRole(coord.role);
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formUsername.trim() || !formDisplayName.trim() || !formPassword.trim()) {
      setFormError('All fields (Username, Name, and Password) are required.');
      return;
    }

    // Username should not contain spaces or special characters for login safety
    const spaceRegex = /\s/g;
    if (spaceRegex.test(formUsername.trim())) {
      setFormError('Username cannot contain spaces.');
      return;
    }

    setSaving(true);

    try {
      const url = editingCoord ? `/api/coordinators/${editingCoord.id}` : '/api/coordinators';
      const method = editingCoord ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole 
        },
        body: JSON.stringify({
          username: formUsername.trim(),
          displayName: formDisplayName.trim(),
          password: formPassword.trim(),
          role: formRole
        })
      });

      const data = await res.json();
      if (res.ok) {
        setIsFormOpen(false);
        loadCoordinators();
        onCoordinatorsChanged(); // update parent so selectors refresh
      } else {
        setFormError(data.error || 'Failed to save coordinator details.');
      }
    } catch (err) {
      console.error(err);
      setFormError('Failed to connect to backend server.');
    } finally {
      setSaving(false);
    }
  };

  const executeDelete = async (id: string, name: string) => {
    if (id === 'coord_admin') {
      setDeleteError('The primary master administrator account cannot be deleted.');
      return;
    }

    try {
      const res = await fetch(`/api/coordinators/${id}`, {
        method: 'DELETE',
        headers: { 
          'x-user-role': userRole 
        }
      });
      if (res.ok) {
        setDeleteTarget(null);
        loadCoordinators();
        onCoordinatorsChanged();
      } else {
        const err = await res.json();
        setDeleteError(err.error || 'Deletion failed.');
      }
    } catch (e) {
      console.error(e);
      setDeleteError('Network failure during deletion.');
    }
  };

  const filteredCoordinators = coordinators.filter(c => 
    c.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs font-sans animate-in fade-in duration-200">
      <div className="bg-slate-900 rounded-3xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-slate-800 animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-accent-purple rounded-xl text-white">
              <Users className="h-5.5 w-5.5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-100 uppercase tracking-wide">
                Staff & Coordinator Directory
              </h2>
              <p className="text-[11px] text-slate-400 font-bold">
                Add, modify, change ID/Passwords, or delete CRM coordinators
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg cursor-pointer transition-all"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Search and Quick Action row */}
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900">
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-450">
              <Search className="h-4 w-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search coordinators by display name, username, or role..."
              className="pl-9 pr-4 py-2 w-full text-xs font-bold text-slate-100 placeholder-slate-450 bg-slate-950 hover:bg-slate-950/50 focus:bg-slate-950 border border-slate-850 focus:border-accent-purple rounded-xl focus:outline-none focus:ring-1 focus:ring-accent-purple transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadCoordinators}
              className="p-2 border border-slate-800 hover:bg-slate-850 rounded-xl text-slate-400 transition-all bg-slate-900 cursor-pointer"
              title="Refresh Accounts"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleOpenCreate}
              className="bg-accent-purple hover:bg-purple-600 text-white text-xs font-black px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all shadow-3xs cursor-pointer uppercase tracking-wider"
            >
              <UserPlus className="h-4 w-4" />
              <span>Add Coordinator</span>
            </button>
          </div>
        </div>

        {/* Content body split: Form (if open) on one side or full list */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[350px]">
          {isFormOpen ? (
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-6 max-w-xl mx-auto space-y-5 text-left shadow-3xs animate-in slide-in-from-top-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-xs font-black text-slate-100 uppercase tracking-wide flex items-center gap-1.5">
                  {editingCoord ? <Pencil className="h-4 w-4 text-accent-purple" /> : <UserPlus className="h-4 w-4 text-accent-emerald" />}
                  {editingCoord ? 'Update Coordinator Credentials' : 'Enroll New Coordinator Profile'}
                </h3>
                <button
                  onClick={() => setIsFormOpen(false)}
                  className="text-xs font-black text-slate-400 hover:text-slate-200 uppercase"
                >
                  Cancel
                </button>
              </div>

              {formError && (
                <div className="p-3.5 bg-rose-950/20 border border-rose-900/30 text-rose-450 rounded-xl text-xs font-bold flex items-start gap-2 animate-shake">
                  <ShieldAlert className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Username / ID */}
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                      Username (Login ID) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. shreya"
                      value={formUsername}
                      onChange={(e) => setFormUsername(e.target.value.toLowerCase())}
                      className="block w-full px-3.5 py-2.5 text-xs font-bold text-slate-100 placeholder-slate-500 bg-slate-900 border border-slate-800 focus:border-accent-purple rounded-xl focus:outline-none focus:ring-1 focus:ring-accent-purple transition-all font-mono"
                    />
                  </div>

                  {/* Display Name */}
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                      Display Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Shreya"
                      value={formDisplayName}
                      onChange={(e) => setFormDisplayName(e.target.value)}
                      className="block w-full px-3.5 py-2.5 text-xs font-bold text-slate-100 placeholder-slate-500 bg-slate-900 border border-slate-800 focus:border-accent-purple rounded-xl focus:outline-none focus:ring-1 focus:ring-accent-purple transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Password */}
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                      Security Password *
                    </label>
                    <div className="relative rounded-xl shadow-3xs">
                      <input
                        type={showFormPass ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={formPassword}
                        onChange={(e) => setFormPassword(e.target.value)}
                        className="block w-full pl-3.5 pr-10 py-2.5 text-xs font-bold text-slate-100 placeholder-slate-500 bg-slate-900 border border-slate-800 focus:border-accent-purple rounded-xl focus:outline-none focus:ring-1 focus:ring-accent-purple transition-all font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowFormPass(!showFormPass)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        {showFormPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* System Role */}
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5">
                      Dashboard Access Role
                    </label>
                    <select
                      value={formRole}
                      disabled={editingCoord?.id === 'coord_admin'}
                      onChange={(e) => setFormRole(e.target.value as 'admin' | 'agent')}
                      className="block w-full px-3.5 py-2.5 text-xs font-bold text-slate-100 bg-slate-900 border border-slate-800 focus:border-accent-purple rounded-xl focus:outline-none focus:ring-1 focus:ring-accent-purple transition-all cursor-pointer"
                    >
                      <option value="agent">📞 Coordinator (Can only view/edit assigned leads)</option>
                      <option value="admin">👨‍💼 Administrator (Full global systems control)</option>
                    </select>
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs font-black text-slate-300 transition-all cursor-pointer uppercase"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 bg-accent-purple hover:bg-purple-600 text-white rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 uppercase"
                  >
                    {saving ? (
                      <>
                        <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        <span>{editingCoord ? 'Update Account' : 'Commit Account'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* Coordinators List */
            <div className="space-y-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-2">
                  <div className="h-7 w-7 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-bold text-slate-500">Retrieving coordinator database profiles...</span>
                </div>
              ) : filteredCoordinators.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/50">
                  <p className="text-xs font-black text-slate-400">No staff accounts match your current query.</p>
                  <p className="text-[11px] text-slate-500 font-bold mt-1">Try broadening your parameters or add a new coordinator.</p>
                </div>
              ) : (
                <div className="overflow-hidden border border-slate-800 rounded-2xl shadow-3xs bg-slate-950 text-left">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-950 border-b border-slate-800 font-black uppercase text-slate-400 tracking-wider text-[10px]">
                      <tr>
                        <th className="px-5 py-3 text-left">Staff Member</th>
                        <th className="px-5 py-3 text-left">Login Username / ID</th>
                        <th className="px-5 py-3 text-left">Current Password</th>
                        <th className="px-5 py-3 text-left">Access level</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-medium text-slate-300">
                      {filteredCoordinators.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-900/55 transition-all">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <div className="h-8.5 w-8.5 rounded-full bg-purple-950/40 border border-purple-900/30 flex items-center justify-center text-xs font-black text-accent-purple">
                                {c.displayName.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-extrabold text-slate-100">{c.displayName}</p>
                                <p className="text-[9.5px] text-slate-500 font-bold uppercase tracking-wider">
                                  ID: {c.id}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-[11px] font-bold text-slate-400">
                            {c.username}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-[11px] text-slate-500">
                            <span className="font-bold border border-slate-800 px-2 py-0.5 rounded bg-slate-900 text-slate-300 select-all">
                              {c.password}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            {c.role === 'admin' ? (
                              <span className="inline-flex items-center gap-1 bg-emerald-950/40 text-accent-emerald border border-emerald-900/30 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">
                                <Shield className="h-3 w-3" />
                                <span>Master Admin</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 bg-slate-900 text-slate-400 border border-slate-800 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                                <span>📞 Coordinator</span>
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleOpenEdit(c)}
                                className="p-1.5 bg-slate-800 hover:bg-accent-purple border border-slate-700 hover:border-accent-purple text-slate-300 hover:text-white rounded-lg transition-all cursor-pointer"
                                title="Edit Username / Password / Name"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              
                              {c.id !== 'coord_admin' && (
                                <button
                                  onClick={() => {
                                    setDeleteError('');
                                    setDeleteTarget({ id: c.id, name: c.displayName });
                                  }}
                                  className="p-1.5 bg-slate-800 hover:bg-rose-950/40 hover:border-rose-900/40 text-slate-400 hover:text-rose-450 rounded-lg border border-slate-700 hover:border-rose-900/30 transition-all cursor-pointer"
                                  title="Delete Account"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Footer info banner */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 text-[10px] text-slate-500 font-bold flex justify-between uppercase tracking-wider">
          <span>Active Staff: {coordinators.length} registered users</span>
          <span className="text-slate-600">Security Gate Active</span>
        </div>
        
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xs font-sans animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full text-left space-y-4 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-500">
              <div className="p-2.5 bg-rose-950/30 rounded-xl border border-rose-900/30">
                <Trash2 className="h-5.5 w-5.5" />
              </div>
              <h3 className="text-sm font-black uppercase tracking-wide">
                Confirm Deletion
              </h3>
            </div>
            
            <p className="text-xs text-slate-300 font-bold leading-relaxed">
              Are you sure you want to permanently delete coordinator <strong className="text-slate-100">"{deleteTarget.name}"</strong>?
            </p>
            <p className="text-[11px] text-slate-400 font-semibold leading-relaxed">
              All future candidates assigned to "{deleteTarget.name.toLowerCase()}" will default to unassigned. This action cannot be undone.
            </p>

            {deleteError && (
              <div className="p-3.5 bg-rose-950/20 border border-rose-900/30 text-rose-450 rounded-xl text-xs font-bold flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs font-black text-slate-300 transition-all cursor-pointer uppercase"
              >
                Cancel
              </button>
              <button
                onClick={() => executeDelete(deleteTarget.id, deleteTarget.name)}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition-all cursor-pointer uppercase"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
