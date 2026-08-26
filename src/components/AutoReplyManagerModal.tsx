import React, { useState, useEffect } from 'react';
import { X, Save, Clock, MessageSquare, ToggleLeft, ToggleRight, AlertCircle, Sparkles } from 'lucide-react';
import { WhatsAppAutoReplySettings } from '../types.ts';

interface AutoReplyManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AutoReplyManagerModal({ isOpen, onClose }: AutoReplyManagerModalProps) {
  const [settings, setSettings] = useState<WhatsAppAutoReplySettings>({
    enabled: false,
    text: '',
    delay: 5
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Fetch settings on open
  useEffect(() => {
    if (!isOpen) return;

    const fetchSettings = async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(false);
        const res = await fetch('/api/whatsapp/auto-reply');
        if (!res.ok) {
          throw new Error('Failed to retrieve auto-reply settings');
        }
        const data = await res.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      } catch (err: any) {
        console.error('[AutoReplyModal] Error fetching settings:', err);
        setError(err.message || 'Error fetching auto-reply settings.');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      const res = await fetch('/api/whatsapp/auto-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      if (!res.ok) {
        throw new Error('Failed to update settings');
      }

      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err: any) {
      console.error('[AutoReplyModal] Error saving settings:', err);
      setError(err.message || 'Error saving auto-reply settings.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-100 dark:text-white uppercase tracking-wider">WhatsApp Auto-Reply</h2>
              <p className="text-xxs text-slate-500 dark:text-slate-400">Configure automated replies to incoming WhatsApp inquiries</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 hover:bg-slate-800 dark:hover:bg-slate-800 rounded-full text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors cursor-pointer"
            id="close-auto-reply-modal-btn"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-8 text-center flex flex-col items-center justify-center gap-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Loading configurations...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl flex gap-2 items-start text-xs text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs text-emerald-600 dark:text-emerald-400">
                Auto-reply settings saved successfully!
              </div>
            )}

            {/* Toggle Switch */}
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-slate-900 dark:text-white block">Enable Auto-Reply</span>
                <span className="text-xxs text-slate-500 dark:text-slate-400 block">
                  Automatically respond to all incoming client and candidate WhatsApp messages.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSettings(s => ({ ...s, enabled: !s.enabled }))}
                className="focus:outline-none cursor-pointer"
                id="toggle-auto-reply-active-btn"
              >
                {settings.enabled ? (
                  <ToggleRight className="h-9 w-9 text-emerald-500" />
                ) : (
                  <ToggleLeft className="h-9 w-9 text-slate-400 dark:text-slate-600" />
                )}
              </button>
            </div>

            {/* Response Delay */}
            <div className="space-y-1.5">
              <label className="text-xxs font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Clock className="h-3 w-3" /> Response Delay (Seconds)
              </label>
              <input
                type="number"
                min="0"
                max="3600"
                value={settings.delay}
                onChange={e => setSettings(s => ({ ...s, delay: parseInt(e.target.value) || 0 }))}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-100 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-shadow"
                placeholder="e.g. 5"
                required
                disabled={!settings.enabled}
              />
              <span className="text-xxs text-slate-500 dark:text-slate-400 block px-1">
                Delay time before sending the reply message. Useful to make automated replies feel more natural (e.g. 5 - 10 seconds).
              </span>
            </div>

            {/* Response Message Text */}
            <div className="space-y-1.5">
              <label className="text-xxs font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> Auto-Reply Message Text
              </label>
              <textarea
                rows={5}
                value={settings.text}
                onChange={e => setSettings(s => ({ ...s, text: e.target.value }))}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-100 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-shadow resize-none"
                placeholder="Write your automated message here..."
                required
                disabled={!settings.enabled}
              />
              
              {/* Dynamic Placeholders Guide */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800/50 space-y-1">
                <span className="text-xxs font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">
                  Supported Template Placeholders
                </span>
                <div className="grid grid-cols-2 gap-1.5 text-xxs text-slate-500 dark:text-slate-400">
                  <div>
                    <code className="text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 rounded">{"{{name}}"}</code>
                    <span className="ml-1">Candidate's Name</span>
                  </div>
                  <div>
                    <code className="text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 rounded">{"{{position}}"}</code>
                    <span className="ml-1">Target Job Position</span>
                  </div>
                  <div>
                    <code className="text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 rounded">{"{{serialNo}}"}</code>
                    <span className="ml-1">Candidate ID</span>
                  </div>
                  <div>
                    <code className="text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/40 px-1 py-0.5 rounded">{"{{country}}"}</code>
                    <span className="ml-1">Destination Country</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
                id="cancel-auto-reply-save-btn"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                id="submit-auto-reply-save-btn"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
