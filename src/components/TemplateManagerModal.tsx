import React, { useState, useEffect } from 'react';
import { WhatsAppTemplate } from '../types.ts';
import { Plus, Trash2, Edit2, X, Save, AlertCircle } from 'lucide-react';

interface TemplateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: WhatsAppTemplate[];
  onRefresh: () => void;
}

export default function TemplateManagerModal({ isOpen, onClose, templates, onRefresh }: TemplateManagerModalProps) {
  const [editingTemplate, setEditingTemplate] = useState<WhatsAppTemplate | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<WhatsAppTemplate>({
    id: '', title: '', category: 'onboarding', description: '', text: '', type: 'template'
  });
  const [activeTab, setActiveTab] = useState<'template' | 'quick_reply'>('template');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({...formData, type: activeTab})
      });
      if (res.ok) {
        onRefresh();
        setIsAdding(false);
        setEditingTemplate(null);
        setFormData({ id: '', title: '', category: 'onboarding', description: '', text: '', type: 'template' });
      } else {
        alert('Failed to save template');
      }
    } catch (err) {
      console.error(err);
      alert('Error saving template');
    }
  };

  const syncTemplates = async () => {
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      if (res.ok) {
        onRefresh();
        alert('Templates synced successfully');
      } else {
        alert('Failed to sync templates');
      }
    } catch (err) {
      console.error(err);
      alert('Error syncing templates');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    try {
      const res = await fetch(`/api/whatsapp/templates/${id}`, { method: 'DELETE' });
      if (res.ok) {
        onRefresh();
      } else {
        alert('Failed to delete template');
      }
    } catch (err) {
      console.error(err);
      alert('Error deleting template');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Manage {activeTab === 'template' ? 'Templates' : 'Quick Replies'}</h2>
            <div className="flex gap-2">
              <button onClick={syncTemplates} className="text-xs bg-emerald-100 dark:bg-emerald-900 px-2 rounded cursor-pointer">Sync Meta</button>
              <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex gap-2 border-b">
            <button onClick={() => setActiveTab('template')} className={`text-xs px-2 pb-1 ${activeTab === 'template' ? 'font-bold border-b-2 border-emerald-500' : 'text-slate-500'}`}>Templates</button>
            <button onClick={() => setActiveTab('quick_reply')} className={`text-xs px-2 pb-1 ${activeTab === 'quick_reply' ? 'font-bold border-b-2 border-emerald-500' : 'text-slate-500'}`}>Quick Replies</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {(isAdding || editingTemplate) ? (
            <form onSubmit={handleSubmit} className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
              <input type="text" placeholder="ID (e.g. follow_up)" value={formData.id} onChange={e => setFormData(p => ({...p, id: e.target.value}))} className="w-full text-xs p-2 rounded-lg border dark:bg-slate-900" required disabled={!!editingTemplate} />
              <input type="text" placeholder="Title" value={formData.title} onChange={e => setFormData(p => ({...p, title: e.target.value}))} className="w-full text-xs p-2 rounded-lg border dark:bg-slate-900" required />
              <textarea rows={3} placeholder="Message Text" value={formData.text} onChange={e => setFormData(p => ({...p, text: e.target.value}))} className="w-full text-xs p-2 rounded-lg border dark:bg-slate-900" required />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setIsAdding(false); setEditingTemplate(null); }} className="px-3 py-1.5 rounded-lg text-xs bg-slate-200 cursor-pointer">Cancel</button>
                <button type="submit" className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 text-white cursor-pointer">Save</button>
              </div>
            </form>
          ) : (
            <button onClick={() => {setIsAdding(true); setFormData({id: '', title: '', category: 'onboarding', description: '', text: '', type: activeTab})}} className="flex items-center gap-2 text-xs font-bold text-emerald-600 cursor-pointer">
              <Plus className="h-4 w-4" /> Add New {activeTab === 'template' ? 'Template' : 'Quick Reply'}
            </button>
          )}

          <div className="space-y-2">
            {templates.filter(t => (t.type || 'template') === activeTab).map(tpl => (
              <div key={tpl.id} className="p-3 border rounded-lg flex items-center justify-between dark:border-slate-800">
                <div className="text-xs">
                  <p className="font-bold">{tpl.title}</p>
                  <p className="text-slate-500 truncate max-w-xs">{tpl.text}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setEditingTemplate(tpl); setFormData(tpl); }} className="p-1.5 text-slate-500 cursor-pointer"><Edit2 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => handleDelete(tpl.id)} className="p-1.5 text-red-500 cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
