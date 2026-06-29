import React, { useState } from 'react';
import { Send, Terminal, ShieldAlert, Sparkles, UserPlus, HelpCircle } from 'lucide-react';
import { motion } from 'motion/react';

interface SandboxPreset {
  name: string;
  phone: string;
  message: string;
  campaign: string;
  description: string;
  badge: 'high' | 'medium' | 'low' | 'unqualified';
}

interface WebhookSandboxProps {
  onLeadAdded: () => void;
  apiMode: 'live' | 'simulation';
}

export default function WebhookSandbox({ onLeadAdded, apiMode }: WebhookSandboxProps) {
  const PRESETS: SandboxPreset[] = [
    {
      name: 'SUBHA TAMANG',
      phone: '9801234567',
      campaign: 'Qatar Hospitality Program',
      message: 'Hi, I saw your ad for Qatar hotel waiter vacancies. I am from Darjeeling, have 1 year experience in a restaurant, and hold a valid passport. Can I apply?',
      description: 'High-Intent Waiter Candidate from Darjeeling',
      badge: 'high'
    },
    {
      name: 'NIMA SHERPA',
      phone: '7001452291',
      campaign: 'Germany Nursing Visa Program',
      message: 'Hello, I am Nima, a registered nurse with GNM degree in Siliguri. I want to inquire about the Germany Nursing Pathway. I started basic German language classes. Please advise.',
      description: 'Professional GNM Nurse Applicant',
      badge: 'high'
    },
    {
      name: 'DIPESH PRADHAN',
      phone: '8116390112',
      campaign: 'Japan Sales Assistant',
      message: 'Good morning, regarding Japan sales assistant vacancies. Do you require Japanese language certifications or is English speaking sufficient? I returned from Kuwait last year.',
      description: 'Gulf Returnee Retail Candidate',
      badge: 'medium'
    },
    {
      name: 'Crypto Spam Bot',
      phone: '+1 500 555-0199',
      campaign: 'Qatar Hospitality Program',
      message: '🔥 EXCLUSIVE TRADING OPPORTUNITY! Make $25000/day guaranteed in BTC mining pool clicks. Telegram fast sign-up!',
      description: 'Irrelevant Inbound Spam Ad Garbage',
      badge: 'unqualified'
    }
  ];

  const [activePresetIndex, setActivePresetIndex] = useState<number | null>(0);
  const [formData, setFormData] = useState({
    whatsappName: PRESETS[0].name,
    phone: PRESETS[0].phone,
    campaignName: PRESETS[0].campaign,
    initialMessage: PRESETS[0].message,
    adSet: 'Meta Feed Ads 2026'
  });

  const [loading, setLoading] = useState(false);
  const [responseLog, setResponseLog] = useState<{
    success: boolean;
    lead?: any;
    simulated?: boolean;
    error?: string;
  } | null>(null);

  const selectPreset = (idx: number) => {
    setActivePresetIndex(idx);
    const p = PRESETS[idx];
    setFormData({
      whatsappName: p.name,
      phone: p.phone,
      campaignName: p.campaign,
      initialMessage: p.message,
      adSet: 'Meta Stories Ads 2026'
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setActivePresetIndex(null); // break preset sync on custom edits
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const triggerWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResponseLog(null);

    try {
      const res = await fetch('/api/webhook/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      
      setResponseLog(data);
      if (data.success) {
        onLeadAdded();
      }
    } catch (err) {
      setResponseLog({
        success: false,
        error: (err as Error).message
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="webhook-sandbox-root">
      {/* Configuration Column */}
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-100 tracking-tight flex items-center gap-2">
                <Terminal className="h-5 w-5 text-accent-emerald" />
                Inbound Meta Ads Simulator
              </h2>
              <p className="text-slate-400 text-sm mt-0.5">
                Simulate Meta ad callbacks and candidate query submissions when they click your placement ads.
              </p>
            </div>
          </div>

          {/* Quick Preset Pickers */}
          <div className="mb-6">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Select Test Persona Preset
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => selectPreset(idx)}
                  className={`text-left p-3 rounded-xl border text-sm transition-all flex flex-col justify-between h-24 cursor-pointer ${
                    activePresetIndex === idx
                      ? 'border-accent-emerald bg-emerald-950/20'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-950/30'
                  }`}
                >
                  <div className="flex justify-between items-start w-full">
                    <span className="font-semibold text-slate-100 truncate block max-w-[130px]">{p.name}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                        p.badge === 'high'
                          ? 'bg-emerald-950/40 text-accent-emerald border border-emerald-900/30'
                          : p.badge === 'medium'
                          ? 'bg-emerald-950/25 text-emerald-400 border border-emerald-900/20'
                          : p.badge === 'low'
                          ? 'bg-amber-950/40 text-accent-amber border border-amber-900/30'
                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                      }`}
                    >
                      {p.badge}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 block truncate">{p.campaign}</span>
                    <span className="text-[10px] text-slate-500 block truncate">{p.description}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={triggerWebhook} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Candidate Profile Name</label>
                <input
                  type="text"
                  name="whatsappName"
                  value={formData.whatsappName}
                  onChange={handleInputChange}
                  required
                  placeholder="e.g. SUBHA TAMANG"
                  className="w-full text-sm px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-950 transition-all text-slate-100 uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Candidate Phone Number</label>
                <input
                  type="text"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  required
                  placeholder="e.g. 9801234567"
                  className="w-full text-sm px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-950 transition-all text-slate-100 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Inbound Recruitment Ad Campaign</label>
              <select
                name="campaignName"
                value={formData.campaignName}
                onChange={handleInputChange}
                className="w-full text-sm px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-950 transition-all text-slate-100 appearance-none cursor-pointer"
              >
                <option value="Qatar Hospitality Program">✈️ Qatar Hospitality Program (Hotel Waiter/Crew)</option>
                <option value="Germany Nursing Visa Program">👩‍⚕️ Germany Nursing Visa Program (GNM/BSc Nurses)</option>
                <option value="Japan Sales Assistant">🇯🇵 Japan Sales Assistant (English/Retail Positions)</option>
                <option value="Dubai Construction Program">🏗️ Dubai Construction Program (Technicians/Workers)</option>
                <option value="General Abroad Recruitment Intake">🌍 General Abroad Recruitment Intake Ad Campaign</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Inbound Ad Message / Candidate Query Text</label>
              <textarea
                name="initialMessage"
                value={formData.initialMessage}
                onChange={handleInputChange}
                required
                rows={4}
                placeholder="Type raw incoming message text..."
                className="w-full text-sm p-3.5 rounded-xl bg-slate-950 border border-slate-800 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-950 transition-all text-slate-100 resize-none font-sans"
              />
            </div>

            {apiMode === 'simulation' && (
              <div className="flex gap-2.5 items-start p-3 bg-amber-950/20 rounded-xl border border-amber-900/30 text-amber-400 text-xs text-left">
                <HelpCircle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                <span>
                  No live <strong>GEMINI_API_KEY</strong> detected in Secrets. Dynamic AI extraction is offline; processing lead via fallback rule-based matching. Apply a live key in Settings to inspect live conversational extraction!
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-3 px-4 rounded-xl text-white font-medium text-sm flex items-center justify-center gap-2.5 transition-all shadow-sm cursor-pointer ${
                loading
                  ? 'bg-slate-800 cursor-not-allowed text-slate-500'
                  : 'bg-accent-purple hover:bg-purple-600'
              }`}
            >
              <Send className={`h-4 w-4 ${loading ? 'animate-pulse' : ''}`} />
              {loading ? 'Processing Webhook Payload...' : 'Fire Inbound Lead Callback'}
            </button>
          </form>
        </div>
      </div>

      {/* Terminal Output Log Column */}
      <div className="lg:col-span-5 space-y-6">
        <div className="bg-slate-950 text-white rounded-2xl border border-slate-900 p-6 flex flex-col h-full min-h-[460px]">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
            <span className="text-xs text-slate-400 font-mono flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              CRM SERVER LOGS (PORT 3000)
            </span>
            <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-2 py-0.5 rounded uppercase">
              Webhook Hooked
            </span>
          </div>

          <div className="flex-1 font-mono text-xs space-y-4 overflow-y-auto max-h-[360px] text-left">
            <div className="text-slate-500">
              [SYSTEM 05:57:40] Server listening on host 0.0.0.0:3000...
            </div>
            <div className="text-slate-500">
              [SYSTEM 05:57:41] Ready to receive Meta callback at POST /api/webhook/inbound
            </div>

            {loading && (
              <div className="text-emerald-400 animate-pulse">
                [SERVER] Receiving payload...
                <br />
                [AI-QUALIFY] Launching gemini-3.5-flash to extract candidate profile, experience, and score fit metrics...
              </div>
            )}

            {responseLog && (
              <div className="space-y-3">
                <div className="text-emerald-400 font-bold">
                  ✓ [Inbound Hook Handled Successfully - 200 OK]
                </div>
                {responseLog.simulated && (
                  <div className="text-yellow-400">
                    ℹ [STATUS] Running in localized rule-based simulation.
                  </div>
                )}
                {!responseLog.simulated && responseLog.success && (
                  <div className="text-sky-400 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> [STATUS] Gemini-3.5-pro processed candidate query semantics gracefully.
                  </div>
                )}

                {responseLog.success && responseLog.lead && (
                  <div className="bg-slate-900 p-3 rounded-lg text-slate-300 border border-slate-800 space-y-1.5 overflow-x-auto text-[11px]">
                    <span className="text-slate-400 block font-bold text-xs border-b border-slate-800 pb-1 mb-1 text-slate-200">
                      EXTRACTED AI PROFILE INGESTION SHEET
                    </span>
                    <div><span className="text-pink-400">ID:</span> {responseLog.lead.id}</div>
                    <div><span className="text-purple-400">Qualified Name:</span> {responseLog.lead.name}</div>
                    <div><span className="text-blue-400">Campaign source:</span> {responseLog.lead.campaign}</div>
                    <div><span className="text-yellow-400">Fit Score Assigned:</span> {(responseLog.lead.fitScore || 'unqualified').toUpperCase()}</div>
                    <div><span className="text-emerald-400">Calculated Budget:</span> ${responseLog.lead.budget.toLocaleString()} ({responseLog.lead.budgetRaw})</div>
                    <div><span className="text-indigo-400">Requirements Extracted:</span> [{responseLog.lead.requirements.join(', ')}]</div>
                    <div className="border-t border-slate-800 pt-1 mt-1 font-sans text-slate-400 italic">
                      "Summary: {responseLog.lead.summary}"
                    </div>
                    <div className="text-emerald-400 font-sans mt-1">
                      → Next Step: {responseLog.lead.nextAction}
                    </div>
                  </div>
                )}

                {responseLog.error && (
                  <div className="bg-rose-950/40 p-3 rounded-lg text-rose-300 border border-rose-900 flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                    <span>Failed processing webhook: {responseLog.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="border-t border-slate-900 pt-3 mt-4 text-[10px] text-slate-500 font-mono text-center">
            Click 'Fire Webhook' to test. Leads are persistent during container runtime.
          </div>
        </div>
      </div>
    </div>
  );
}
