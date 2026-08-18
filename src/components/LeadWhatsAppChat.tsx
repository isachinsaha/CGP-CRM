import React, { useState, useEffect, useRef } from 'react';
import { Lead, Message, WhatsAppTemplate } from '../types.ts';
import { 
  Send, MessageSquare, ExternalLink, Sparkles, Check, CheckCheck, 
  Clock, RefreshCw, FileText, Calendar, Phone, PhoneCall, Copy, 
  ChevronDown, ChevronUp, Bot, UserCheck, AlertCircle, Info, Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatPhoneForWhatsApp, replaceTemplatePlaceholders } from '../server/whatsapp.ts';

interface LeadWhatsAppChatProps {
  lead: Lead;
  onLeadUpdated: (updatedLead?: Lead) => void;
  userRole: 'admin' | 'agent';
  currentAgentId: string;
}

export default function LeadWhatsAppChat({
  lead,
  onLeadUpdated,
  userRole,
  currentAgentId
}: LeadWhatsAppChatProps) {
  const [messages, setMessages] = useState<Message[]>(lead.messages || []);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [simulatingReply, setSimulatingReply] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [config, setConfig] = useState<{ mode: string; provider: string; hasApiKey: boolean; costModel?: string }>({
    mode: 'sandbox_simulation',
    provider: 'Direct Meta Cloud API',
    hasApiKey: false,
    costModel: 'Direct Meta Pricing (1000 Free conversations/mo)'
  });

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync internal messages whenever parent lead prop updates
  useEffect(() => {
    setMessages(lead.messages || []);
  }, [lead.messages]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showTemplates]);

  // Load WhatsApp templates & engine configuration from backend
  useEffect(() => {
    fetchConfigAndTemplates();
  }, []);

  const fetchConfigAndTemplates = async () => {
    try {
      setLoadingTemplates(true);
      const [configRes, tplRes] = await Promise.all([
        fetch('/api/whatsapp/config').catch(() => null),
        fetch('/api/whatsapp/templates').catch(() => null)
      ]);

      if (configRes && configRes.ok) {
        const configData = await configRes.json();
        setConfig(configData);
      }

      if (tplRes && tplRes.ok) {
        const tplData = await tplRes.json();
        if (Array.isArray(tplData.templates)) {
          setTemplates(tplData.templates);
        }
      }
    } catch (err) {
      console.error('Error fetching WhatsApp configuration:', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  // Send outbound message
  const handleSendMessage = async (customText?: string, templateName?: string) => {
    const textToSend = (customText !== undefined ? customText : inputText).trim();
    if (!textToSend || sending) return;

    setSending(true);
    const senderName = userRole === 'admin' ? 'Administrator' : `Coordinator (${currentAgentId})`;

    try {
      const res = await fetch(`/api/leads/${lead.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify({
          text: textToSend,
          sender: 'user',
          senderName,
          templateName: templateName || undefined,
          channel: 'whatsapp'
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.lead) {
          setMessages(data.lead.messages || []);
          onLeadUpdated(data.lead);
        }
        setInputText('');
        setShowTemplates(false);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to send message: ${errData.error || 'Unknown server error'}`);
      }
    } catch (err) {
      console.error('Failed to send WhatsApp message', err);
    } finally {
      setSending(false);
    }
  };

  // Simulate inbound candidate reply for testing
  const handleSimulateReply = async (customReplyText?: string) => {
    if (simulatingReply) return;
    setSimulatingReply(true);

    try {
      const res = await fetch(`/api/leads/${lead.id}/simulate-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: customReplyText,
          customName: lead.name
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.lead) {
          setMessages(data.lead.messages || []);
          onLeadUpdated(data.lead);
        }
      }
    } catch (err) {
      console.error('Error simulating candidate reply:', err);
    } finally {
      setSimulatingReply(false);
    }
  };

  // Handle template selection
  const handleSelectTemplate = (template: WhatsAppTemplate, directSend = false) => {
    const formatted = replaceTemplatePlaceholders(template.text, lead, lead.assignedTo || currentAgentId);
    if (directSend) {
      handleSendMessage(formatted, template.title);
    } else {
      setInputText(formatted);
      setShowTemplates(false);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  };

  // Copy message to clipboard
  const handleCopyMessage = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter templates by category
  const filteredTemplates = templates.filter(t => {
    if (selectedCategory === 'all') return true;
    return t.category === selectedCategory;
  });

  // Filter out internal system enrollment notices and empty system items
  const displayMessages = (messages || []).filter(msg => {
    if (!msg || !msg.text) return false;
    if (msg.text.includes('Lead enrolled manually in CGP system database')) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-slate-50/70 dark:bg-slate-950/60 overflow-hidden text-left relative" id="whatsapp-inbuilt-module">
      
      {/* 2. Messages Stream List - Maximized Room */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 text-xs">
        {displayMessages.length === 0 ? (
          <div className="text-center py-12 space-y-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xs">
            <div className="h-12 w-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-2xs">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h5 className="text-sm font-black text-slate-900 dark:text-white">Start WhatsApp Conversation</h5>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
              No WhatsApp messages sent yet to <strong>{lead.name || 'Candidate'}</strong> ({lead.phone}). Choose a recruitment template below or write a custom message.
            </p>
            <div className="pt-2 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowTemplates(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl text-xs flex items-center gap-1.5 shadow-xs cursor-pointer uppercase tracking-wider"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Browse WhatsApp Templates
              </button>
            </div>
          </div>
        ) : (
          displayMessages.map((msg, index) => {
            const isUser = msg.sender === 'user';
            const isLead = msg.sender === 'lead';
            const isSystem = msg.sender === 'system';

            const formattedTime = msg.timestamp
              ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';

            if (isSystem) {
              return (
                <div key={msg.id || index} className="flex justify-center my-1.5">
                  <div className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1 rounded-lg text-[10.5px] font-bold font-mono text-center max-w-[70%] border border-slate-300 dark:border-slate-700">
                    ℹ️ {msg.text}
                  </div>
                </div>
              );
            }

            return (
              <motion.div
                key={msg.id || index}
                initial={{ opacity: 0, y: 6, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.15 }}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group max-w-full`}
              >
                {/* Sender Tag Header */}
                <div className={`flex items-center gap-1.5 text-[10px] font-bold mb-1 px-1 max-w-[85%] sm:max-w-[460px] ${isUser ? 'text-emerald-700 dark:text-emerald-400 justify-end' : 'text-slate-500 dark:text-slate-400 justify-start'}`}>
                  {isUser ? (
                    <>
                      <span>{msg.senderName || 'Coordinator'}</span>
                      <span className="text-[9px] opacity-75 font-mono">({config.provider.split(' ')[0]})</span>
                    </>
                  ) : (
                    <>
                      <span>{msg.senderName || lead.name || 'Candidate'}</span>
                    </>
                  )}
                </div>

                {/* Message Bubble - Compact, readable & neat width */}
                <div
                  className={`max-w-[85%] sm:max-w-[460px] w-fit rounded-2xl p-3 px-3.5 text-[12.5px] leading-relaxed shadow-xs relative transition-all border ${
                    isUser
                      ? 'bg-emerald-100/90 dark:bg-emerald-950/80 border-emerald-300 dark:border-emerald-800 text-slate-950 dark:text-emerald-50 rounded-tr-xs'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-xs'
                  }`}
                >
                  {/* Template tag if sent from template */}
                  {msg.templateName && (
                    <div className="mb-1.5 pb-1 border-b border-emerald-200/80 dark:border-emerald-800/80 text-[10px] font-black uppercase text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                      <span>📑 Template:</span>
                      <span className="truncate">{msg.templateName}</span>
                    </div>
                  )}

                  {/* Body Text */}
                  <p className="whitespace-pre-wrap leading-relaxed font-sans font-medium select-text break-words">
                    {msg.text}
                  </p>

                  {/* Bubble Footer Info */}
                  <div className="flex items-center justify-end gap-1.5 mt-1.5 text-[9.5px] font-mono text-slate-600 dark:text-slate-400">
                    <span>{formattedTime}</span>

                    {isUser && (
                      <span className="inline-flex items-center text-emerald-700 dark:text-emerald-400" title="Delivered via Meta WhatsApp Cloud API">
                        <CheckCheck className="h-3.5 w-3.5 stroke-[2.5]" />
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleCopyMessage(msg.text, msg.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-slate-900 dark:hover:text-white cursor-pointer ml-1"
                      title="Copy text"
                    >
                      {copiedId === msg.id ? (
                        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* 3. Templates Drawer / Quick Selector (Expandable) */}
      <AnimatePresence>
        {showTemplates && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 overflow-hidden shadow-md shrink-0"
          >
            <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h5 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                  Meta WhatsApp Recruitment Templates
                </h5>
              </div>
              <button
                type="button"
                onClick={() => setShowTemplates(false)}
                className="text-xs font-extrabold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            {/* Template Category Pills */}
            <div className="flex items-center gap-1.5 p-2 px-3 bg-slate-50 dark:bg-slate-950/60 overflow-x-auto">
              {[
                { id: 'all', label: 'All Templates' },
                { id: 'documentation', label: '📄 Documents & Passport' },
                { id: 'interview', label: '📅 Interviews' },
                { id: 'onboarding', label: '🏢 Office Visits' },
                { id: 'offer', label: '🎉 Visa & Offer' },
                { id: 'status', label: '📞 Callbacks' }
              ].map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer border ${
                    selectedCategory === cat.id
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Template Cards List */}
            <div className="max-h-56 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {filteredTemplates.map(tpl => {
                const preview = replaceTemplatePlaceholders(tpl.text, lead, lead.assignedTo || currentAgentId);
                return (
                  <div
                    key={tpl.id}
                    className="p-3 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-600 transition-all text-xs flex flex-col justify-between space-y-2 group shadow-3xs"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-extrabold text-slate-900 dark:text-white text-xs">{tpl.title}</span>
                        <span className="text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                          {tpl.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-3 italic font-sans leading-relaxed">
                        {preview}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200 dark:border-slate-800/60">
                      <button
                        type="button"
                        onClick={() => handleSelectTemplate(tpl, false)}
                        className="flex-1 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-lg text-[10.5px] border border-slate-200 dark:border-slate-700 transition-all cursor-pointer text-center"
                      >
                        Insert to Input
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectTemplate(tpl, true)}
                        className="py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-lg text-[10.5px] transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                      >
                        <Send className="h-3 w-3" />
                        Send Now
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4. WhatsApp Message Composer Bar */}
      <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0 space-y-2 shadow-sm">
        
        {/* Helper tools row */}
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTemplates(!showTemplates)}
              className={`text-[11px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer border ${
                showTemplates
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>Templates ({templates.length})</span>
              {showTemplates ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>

            {/* Quick prefill greeting */}
            <button
              type="button"
              onClick={() => setInputText(`Hello ${lead.name || 'Candidate'}, greetings from Career Growth Placement!`)}
              className="text-[10.5px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-bold cursor-pointer hidden sm:inline"
            >
              + Quick Hello
            </button>
          </div>

          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-bold">
            <span>Press Enter to send</span>
          </div>
        </div>

        {/* Input box & action controls */}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={`Type a WhatsApp message to ${lead.name || 'Candidate'} (${lead.phone})...`}
            className="flex-1 text-xs sm:text-[13px] p-2.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 font-medium resize-none leading-relaxed transition-all"
          />

          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || sending}
            className="py-3 px-4.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-extrabold rounded-xl text-xs transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5 shrink-0 uppercase tracking-wider"
          >
            {sending ? (
              <RefreshCw className="h-4 w-4 animate-spin text-white" />
            ) : (
              <>
                <Send className="h-3.5 w-3.5 stroke-[2.5]" />
                <span>Send</span>
              </>
            )}
          </button>
        </div>
      </div>

    </div>
  );
}
