import React, { useState } from 'react';
import { 
  X, Plus, Edit2, Trash2, Check, Tags, Briefcase, Globe, UserCheck, Folder 
} from 'lucide-react';

interface MetadataManagerProps {
  userRole: 'admin' | 'agent';
  onClose: () => void;
  // Current states
  tagsList: string[];
  projects: string[];
  countries: string[];
  positions: string[];
  // State setters passed from App
  onUpdateTagsList: (tags: string[]) => void;
  onUpdateProjects: (projects: string[]) => void;
  onUpdateCountries: (countries: string[]) => void;
  onUpdatePositions: (positions: string[]) => void;
}

type TabType = 'tags' | 'projects' | 'countries' | 'positions';

export default function MetadataManager({
  userRole,
  onClose,
  tagsList,
  projects,
  countries,
  positions,
  onUpdateTagsList,
  onUpdateProjects,
  onUpdateCountries,
  onUpdatePositions
}: MetadataManagerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('tags');
  const [newItemText, setNewItemText] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  if (userRole !== 'admin') {
    return (
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-sm text-center">
          <Lock className="h-10 w-10 text-red-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-100">Access Denied</h3>
          <p className="text-xs text-slate-400 mt-2">Only administrators can manage metadata options.</p>
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

  // Helper to get active list and updater
  const getActiveListAndUpdater = (): { list: string[]; updateFn: (arr: string[]) => void; label: string } => {
    switch (activeTab) {
      case 'tags':
        return { list: tagsList, updateFn: onUpdateTagsList, label: 'Tag' };
      case 'projects':
        return { list: projects, updateFn: onUpdateProjects, label: 'Hiring Project' };
      case 'countries':
        return { list: countries, updateFn: onUpdateCountries, label: 'Destination Country' };
      case 'positions':
        return { list: positions, updateFn: onUpdatePositions, label: 'Job Position' };
    }
  };

  const { list, updateFn, label } = getActiveListAndUpdater();

  // Add new item
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    const text = newItemText.trim();
    if (!text) return;

    if (list.some(item => item.toLowerCase() === text.toLowerCase())) {
      alert(`${label} "${text}" already exists.`);
      return;
    }

    const updated = [...list, text];
    updateFn(updated);
    setNewItemText('');
  };

  // Start editing item
  const startEditing = (idx: number, item: string) => {
    setEditingIndex(idx);
    setEditingText(item);
  };

  // Save edited item
  const handleSaveEdit = (idx: number) => {
    const text = editingText.trim();
    if (!text) return;

    // Check duplicate (excluding self)
    const duplicate = list.some((item, i) => i !== idx && item.toLowerCase() === text.toLowerCase());
    if (duplicate) {
      alert(`${label} "${text}" already exists.`);
      return;
    }

    const updated = [...list];
    updated[idx] = text;
    updateFn(updated);
    setEditingIndex(null);
    setEditingText('');
  };

  // Delete item
  const handleDeleteItem = (idx: number) => {
    const itemToDelete = list[idx];
    if (confirm(`Are you sure you want to delete ${label}: "${itemToDelete}"?`)) {
      const updated = list.filter((_, i) => i !== idx);
      updateFn(updated);
      if (editingIndex === idx) {
        setEditingIndex(null);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col h-[580px] text-left">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-accent-purple/10 text-accent-purple rounded-lg border border-purple-900/30">
                <Globe className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-black text-slate-100 uppercase tracking-wider font-display">
                CRM Metadata Manager
              </h3>
            </div>
            <p className="text-[10px] text-slate-450 font-bold mt-1">
              Admin Control Panel to edit, delete and add dynamic selection dropdown options.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-slate-850 rounded-xl text-slate-400 hover:text-slate-200 transition cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Headers */}
        <div className="flex bg-slate-950/60 border-b border-slate-850 p-1">
          {[
            { id: 'tags', label: 'Candidate Tags', icon: Tags },
            { id: 'projects', label: 'Hiring Projects', icon: Folder },
            { id: 'countries', label: 'Countries', icon: Globe },
            { id: 'positions', label: 'Job Positions', icon: Briefcase }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as TabType);
                  setEditingIndex(null);
                  setNewItemText('');
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-wider py-3 rounded-xl transition cursor-pointer ${
                  isActive 
                    ? 'bg-slate-900 text-accent-purple border-b-2 border-accent-purple' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-accent-purple' : 'text-slate-450'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Add New Item Form */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/50">
          <form onSubmit={handleAddItem} className="flex gap-2">
            <input
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder={`Add new ${label.toLowerCase()} option...`}
              className="flex-1 text-xs px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:ring-1 focus:ring-accent-purple focus:outline-none text-slate-100 placeholder-slate-500 font-bold uppercase"
            />
            <button
              type="submit"
              disabled={!newItemText.trim()}
              className="px-4 py-2 bg-accent-purple hover:bg-accent-purple/90 text-white rounded-xl text-xs font-black uppercase flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          </form>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-900/10">
          {list.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-10 text-slate-500">
              <Tags className="h-10 w-10 opacity-20 mb-2" />
              <p className="text-xs font-bold">No active options in this list</p>
              <p className="text-[10px] text-slate-650">Create options using the box above to build standard selections.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {list.map((item, idx) => {
                const isEditing = editingIndex === idx;
                return (
                  <div 
                    key={idx} 
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                      isEditing 
                        ? 'bg-slate-950 border-accent-purple/60' 
                        : 'bg-slate-850/60 border-slate-800/80 hover:bg-slate-800/40'
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1.5 flex-1 mr-2">
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className="w-full text-xs px-2 py-1 rounded bg-slate-900 border border-slate-750 text-slate-100 font-bold focus:outline-none focus:ring-1 focus:ring-accent-purple uppercase"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(idx);
                            if (e.key === 'Escape') setEditingIndex(null);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(idx)}
                          className="p-1 bg-emerald-950 text-accent-emerald hover:bg-emerald-900/60 rounded transition cursor-pointer"
                          title="Save Changes"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingIndex(null)}
                          className="p-1 bg-slate-900 text-slate-400 hover:bg-slate-800 rounded transition cursor-pointer"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs font-extrabold text-slate-200 tracking-wide font-mono uppercase truncate max-w-[180px]">
                        {item}
                      </span>
                    )}

                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditing(idx, item)}
                          className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer"
                          title="Edit Option"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(idx)}
                          className="p-1.5 hover:bg-red-950/60 rounded-lg text-red-500 hover:text-red-400 transition cursor-pointer"
                          title="Delete Option"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950/50 border-t border-slate-800 text-[10px] text-slate-450 font-semibold flex items-center justify-between">
          <span>Total options defined: {list.length}</span>
          <span className="text-accent-purple uppercase font-black">Changes sync instantly across lists</span>
        </div>

      </div>
    </div>
  );
}
