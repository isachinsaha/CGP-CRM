import React, { useState, useEffect, useRef } from 'react';
import { Lead, Message, WhatsAppTemplate } from '../types.ts';
import { 
  Send, MessageSquare, ExternalLink, Sparkles, Check, CheckCheck, 
  Clock, RefreshCw, FileText, Calendar, Phone, PhoneCall, Copy, 
  ChevronDown, ChevronUp, Bot, UserCheck, AlertCircle, Info, Plus, Paperclip, Zap
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
  const [showQuickReplies, setShowQuickReplies] = useState(false);
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
  const [uploading, setUploading] = useState(false);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);
  const [showCreateQuickReply, setShowCreateQuickReply] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    id: '',
    title: '',
    category: 'onboarding' as WhatsAppTemplate['category'],
    description: '',
    text: ''
  });
  const [newQuickReply, setNewQuickReply] = useState({
    id: '',
    title: '',
    description: '',
    text: ''
  });

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef(messages);
  const lastLeadIdRef = useRef<string | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const lastMessagesLengthRef = useRef<number>(0);

  // Sync internal messages whenever parent lead prop updates
  useEffect(() => {
    setMessages(lead.messages || []);
  }, [lead.messages]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const isInitialLoad = lastLeadIdRef.current !== lead.id;
    const currentMessages = messages || [];
    const lastMsg = currentMessages[currentMessages.length - 1];
    const currentMsgId = lastMsg?.id || null;
    const currentLength = currentMessages.length;

    const hasNewMessage = lastLeadIdRef.current === lead.id && 
                          currentLength > lastMessagesLengthRef.current && 
                          currentMsgId !== lastMessageIdRef.current;

    const isNewMessageFromSelf = hasNewMessage && (lastMsg?.sender === 'user' || lastMsg?.sender === 'system');

    // Update refs
    lastLeadIdRef.current = lead.id;
    lastMessageIdRef.current = currentMsgId;
    lastMessagesLengthRef.current = currentLength;

    if (isInitialLoad) {
      // Force instant bottom alignment
      el.scrollTop = el.scrollHeight;
      chatBottomRef.current?.scrollIntoView({ behavior: 'auto' });

      const timer1 = setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
        chatBottomRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 40);

      const timer2 = setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);

      const timer3 = setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
      }, 350);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    } else if (isNewMessageFromSelf) {
      // Scroll unconditionally when sending a message ourselves
      el.scrollTop = el.scrollHeight;
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      
      const timer = setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
      return () => clearTimeout(timer);
    } else if (hasNewMessage) {
      // Only scroll on new incoming messages if they were already reading near the bottom
      const offset = el.scrollHeight - el.scrollTop - el.clientHeight;
      const userNearBottom = offset < 280;
      if (userNearBottom) {
        chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        const timer = setTimeout(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
          chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
        return () => clearTimeout(timer);
      }
    }
  }, [messages, showTemplates, lead.id]);

  // Load WhatsApp templates & engine configuration from backend
  useEffect(() => {
    fetchConfigAndTemplates();
  }, []);

  // Poll for new messages every 3 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/leads/${lead.id}`);
        if (res.ok) {
          const updatedLead = await res.json();
          if (JSON.stringify(updatedLead.messages) !== JSON.stringify(messagesRef.current)) {
            setMessages(updatedLead.messages || []);
            onLeadUpdated(updatedLead);
          }
        }
      } catch (err) {
        console.error('Error polling for new messages:', err);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lead.id, onLeadUpdated]);

  // Mark messages as read when viewing this active chat
  useEffect(() => {
    const hasUnread = (messages || []).some(m => m.sender === 'lead' && m.status !== 'read');
    if (hasUnread) {
      fetch(`/api/leads/${lead.id}/read`, { method: 'POST' })
        .then(async (res) => {
          if (res.ok) {
            const updatedRes = await fetch(`/api/leads/${lead.id}`);
            if (updatedRes.ok) {
              const updatedLead = await updatedRes.json();
              setMessages(updatedLead.messages || []);
              onLeadUpdated(updatedLead);
            }
          }
        })
        .catch(err => console.error('Error marking as read in LeadWhatsAppChat:', err));
    }
  }, [lead.id, messages, onLeadUpdated]);

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
  const handleSendMessage = async (
    customText?: string, 
    templateName?: string, 
    mediaParams?: { type: 'image' | 'pdf' | 'document'; mediaUrl: string; fileName: string; fileSize: string }
  ) => {
    const textToSend = (customText !== undefined ? customText : inputText).trim();
    if (!textToSend && !mediaParams && !sending) return;

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
          channel: 'whatsapp',
          ...(mediaParams || {})
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

  const handleFileUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = reader.result as string;

        try {
          const uploadRes = await fetch('/api/upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fileName: file.name,
              fileType: file.type,
              base64Data
            })
          });

          if (!uploadRes.ok) {
            throw new Error('Server upload failed');
          }

          const uploadData = await uploadRes.json();
          if (uploadData.success && uploadData.url) {
            const sizeStr = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
            const isImg = file.type.startsWith('image/');
            const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
            const computedType = isImg ? 'image' : (isPdf ? 'pdf' : 'document');

            await handleSendMessage(
              inputText || `Sent ${computedType === 'image' ? 'an image' : computedType === 'pdf' ? 'a PDF document' : 'a document'}: ${file.name}`,
              undefined,
              {
                type: computedType,
                mediaUrl: uploadData.url,
                fileName: file.name,
                fileSize: sizeStr
              }
            );
          } else {
            alert('Failed to upload file');
          }
        } catch (err) {
          console.error('File upload error:', err);
          alert('Failed to upload file to CRM server.');
        } finally {
          setUploading(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        }
      };

      reader.onerror = () => {
        setUploading(false);
        alert('Failed to read file');
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Error in handleFileChange:', err);
      setUploading(false);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplate.id || !newTemplate.title || !newTemplate.text) {
      alert('Please fill in all required fields (Code/ID, Title, Message text)');
      return;
    }

    try {
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newTemplate)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.template) {
          setTemplates(prev => {
            const idx = prev.findIndex(t => t.id === data.template.id);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = data.template;
              return updated;
            } else {
              return [...prev, data.template];
            }
          });
          setShowCreateTemplate(false);
          setNewTemplate({
            id: '',
            title: '',
            category: 'onboarding',
            description: '',
            text: ''
          });
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to save template: ${errData.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error saving template:', err);
      alert('Failed to connect to server to save template.');
    }
  };

  const handleCreateQuickReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuickReply.id || !newQuickReply.title || !newQuickReply.text) {
      alert('Please fill in all required fields (Code/ID, Title, Message text)');
      return;
    }

    try {
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: newQuickReply.id.toLowerCase().replace(/\s+/g, '_'),
          title: newQuickReply.title,
          description: newQuickReply.description,
          text: newQuickReply.text,
          category: 'status',
          type: 'quick_reply'
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.template) {
          setTemplates(prev => {
            const idx = prev.findIndex(t => t.id === data.template.id);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = data.template;
              return updated;
            } else {
              return [...prev, data.template];
            }
          });
          setShowCreateQuickReply(false);
          setNewQuickReply({
            id: '',
            title: '',
            description: '',
            text: ''
          });
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to save quick reply: ${errData.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error saving quick reply:', err);
      alert('Failed to connect to server to save quick reply.');
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
    if (t.type === 'quick_reply') return false;
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

  // Helper to format date header segregation (WhatsApp style)
  const getMessageDateString = (timestamp?: string) => {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      if (isNaN(d.getTime())) return '';
      
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      
      const isSameDay = (d1: Date, d2: Date) => 
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();
        
      if (isSameDay(d, today)) {
        return 'Today';
      } else if (isSameDay(d, yesterday)) {
        return 'Yesterday';
      } else {
        return d.toLocaleDateString(undefined, { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
      }
    } catch {
      return '';
    }
  };

  // Helper to render the map stream with sequential variables (wrapped cleanly)
  const renderMessageStream = () => {
    let lastDateString = '';
    return displayMessages.map((msg, index) => {
      const isUser = msg.sender === 'user';
      const isLead = msg.sender === 'lead';
      const isSystem = msg.sender === 'system';

      const formattedTime = msg.timestamp
        ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      const dateString = msg.timestamp ? getMessageDateString(msg.timestamp) : '';
      const showDateHeader = dateString && dateString !== lastDateString;
      if (dateString) {
        lastDateString = dateString;
      }

      const dateHeaderElement = showDateHeader ? (
        <div key={`date-header-${msg.id || index}`} className="flex justify-center my-4 w-full select-none">
          <span className="bg-slate-200/90 dark:bg-slate-850/90 text-slate-600 dark:text-slate-300 px-3.5 py-1 rounded-full text-[10px] font-black tracking-wide uppercase border border-slate-300/40 dark:border-slate-700/40 shadow-xs">
            {dateString}
          </span>
        </div>
      ) : null;

      return (
        <React.Fragment key={msg.id || index}>
          {dateHeaderElement}

          {isSystem ? (
            <div className="flex justify-center my-1.5 w-full">
              <div className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1 rounded-lg text-[10.5px] font-bold font-mono text-center max-w-[70%] border border-slate-300 dark:border-slate-700">
                ℹ️ {msg.text}
              </div>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.15 }}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group max-w-full w-full`}
            >
                {/* Sender Tag Header */}
                <div className={`flex items-center gap-1.5 text-[9px] font-bold mb-0.5 px-1 max-w-[85%] sm:max-w-[420px] ${isUser ? 'text-emerald-700 dark:text-emerald-400 justify-end' : 'text-slate-500 dark:text-slate-400 justify-start'}`}>
                  {isUser ? (
                    <>
                      <span>{msg.senderName || 'Coordinator'}</span>
                      <span className="text-[8.5px] opacity-75 font-mono">({config.provider.split(' ')[0]})</span>
                    </>
                  ) : (
                    <>
                      <span>{msg.senderName || lead.name || 'Candidate'}</span>
                    </>
                  )}
                </div>

                {/* Message Bubble - Compact, readable & neat width */}
                <div
                  className={`max-w-[85%] sm:max-w-[420px] w-fit rounded-xl py-1 px-2.5 text-[11.5px] leading-snug shadow-3xs relative transition-all border ${
                    isUser
                      ? 'bg-emerald-100/90 dark:bg-emerald-950/80 border-emerald-300/60 dark:border-emerald-850/60 text-slate-950 dark:text-emerald-50 rounded-tr-xs'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-xs'
                  }`}
                >
                  {/* Template tag if sent from template */}
                  {msg.templateName && (
                    <div className="mb-1 pb-0.5 border-b border-emerald-200/80 dark:border-emerald-800/80 text-[9px] font-black uppercase text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                      <span>📑 Template:</span>
                      <span className="truncate">{msg.templateName}</span>
                    </div>
                  )}

                  {/* Media Content Previews */}
                  {msg.type === 'image' && msg.mediaUrl && (
                    <div className="mb-2 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950">
                      <img
                        src={msg.mediaUrl}
                        alt={msg.fileName || 'WhatsApp Attachment'}
                        referrerPolicy="no-referrer"
                        className="max-h-60 w-full object-cover hover:scale-[1.02] transition-transform duration-200 cursor-zoom-in"
                        onClick={() => window.open(msg.mediaUrl, '_blank')}
                      />
                    </div>
                  )}

                  {(msg.type === 'pdf' || msg.type === 'document') && msg.mediaUrl && (
                    <div className="mb-2 p-2 px-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 shrink-0">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-extrabold text-slate-900 dark:text-white truncate">
                          {msg.fileName || 'Attachment Document'}
                        </p>
                        <p className="text-[9.5px] text-slate-500 dark:text-slate-400 font-mono">
                          {msg.fileSize || 'Unknown Size'} • {msg.type?.toUpperCase()}
                        </p>
                      </div>
                      <a
                        href={msg.mediaUrl}
                        download={msg.fileName || 'document'}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer shrink-0"
                        title="Download File"
                      >
                        <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                      </a>
                    </div>
                  )}

                  {/* Body Text */}
                  {msg.text && msg.text !== 'Sent an image' && msg.text !== 'Sent a PDF document' && msg.text !== 'Sent a document' && (
                    <p className="whitespace-pre-wrap leading-snug font-sans font-medium select-text break-words">
                      {msg.text}
                    </p>
                  )}

                  {/* Bubble Footer Info */}
                  <div className="flex items-center justify-end gap-1 mt-0.5 text-[9px] font-mono text-slate-500 dark:text-slate-400">
                    <span>{formattedTime}</span>

                    {isUser && (
                      <span 
                        className={`inline-flex items-center ${
                          msg.status === 'read' 
                            ? 'text-sky-500 dark:text-sky-400 font-extrabold' 
                            : 'text-slate-400 dark:text-slate-500'
                        }`} 
                        title={
                          msg.status === 'read' 
                            ? "Read by candidate (Blue tick)" 
                            : msg.status === 'delivered' 
                              ? "Delivered to candidate (Double tick)" 
                              : "Sent to candidate (Single tick)"
                        }
                      >
                        {msg.status === 'sent' ? (
                          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                        ) : (
                          <CheckCheck className="h-3.5 w-3.5 stroke-[2.5]" />
                        )}
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
            )}
          </React.Fragment>
        );
      });
    };

    return (
      <div className="flex flex-col h-full bg-slate-50/70 dark:bg-slate-950/60 overflow-hidden text-left relative" id="whatsapp-inbuilt-module">
        
        {/* Sticky API Branding Header */}
        <div className="bg-emerald-500/10 dark:bg-emerald-500/5 border-b border-emerald-500/20 px-3 py-1 flex items-center justify-between shrink-0 select-none z-10">
          <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>(Powered by AI Sensy Cloud API)</span>
          </div>
          <span className="text-[9px] text-emerald-600/60 dark:text-emerald-400/50 font-semibold font-mono">LIVE CLOUD CHANNEL</span>
        </div>

        {/* 2. Messages Stream List - Maximized Room */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-1.5 text-xs">
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
            renderMessageStream()
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
                  WhatsApp Recruitment Templates
                </h5>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowTemplates(false)}
                  className="text-xs font-extrabold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            <>
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
            </>
          </motion.div>
        )}

        {showQuickReplies && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 overflow-hidden shadow-md shrink-0"
          >
            <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400 fill-current animate-pulse" />
                <h5 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                  ⚡ Quick Reply Messages
                </h5>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateQuickReply(!showCreateQuickReply)}
                  className="text-xs font-black text-amber-700 dark:text-amber-400 hover:text-amber-600 flex items-center gap-1 cursor-pointer bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1 rounded-lg"
                >
                  <Plus className="h-3 w-3" />
                  {showCreateQuickReply ? 'View Quick Replies' : 'Add Quick Reply'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickReplies(false)}
                  className="text-xs font-extrabold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {showCreateQuickReply ? (
              <form onSubmit={handleCreateQuickReply} className="p-4 bg-slate-50 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-800 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">
                      Quick Reply ID (Short code, e.g. `welcome`) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. welcome"
                      value={newQuickReply.id}
                      onChange={e => setNewQuickReply(p => ({ ...p, id: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">
                      Display Title *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Greeting Welcome"
                      value={newQuickReply.title}
                      onChange={e => setNewQuickReply(p => ({ ...p, title: e.target.value }))}
                      className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">
                    Short Description / Note
                  </label>
                  <input
                    type="text"
                    placeholder="Brief description about when to use this quick reply"
                    value={newQuickReply.description}
                    onChange={e => setNewQuickReply(p => ({ ...p, description: e.target.value }))}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 mb-1">
                    Message Body Content (Variables: {"{{name}}, {{country}}, {{position}}, {{coordinator}}"}) *
                  </label>
                  <textarea
                    rows={4}
                    required
                    placeholder="Enter quick reply text here... Use variables to auto-fill candidate or coordinator data."
                    value={newQuickReply.text}
                    onChange={e => setNewQuickReply(p => ({ ...p, text: e.target.value }))}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 font-sans text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCreateQuickReply(false)}
                    className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-extrabold shadow-2xs cursor-pointer uppercase tracking-wider"
                  >
                    Save Quick Reply
                  </button>
                </div>
              </form>
            ) : (
              <div className="max-h-56 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {templates.filter(t => t.type === 'quick_reply').map(tpl => {
                  const preview = replaceTemplatePlaceholders(tpl.text, lead, lead.assignedTo || currentAgentId);
                  return (
                    <div
                      key={tpl.id}
                      className="p-3 bg-amber-50/10 dark:bg-amber-950/10 rounded-xl border border-amber-200/40 dark:border-amber-900/30 hover:border-amber-400 dark:hover:border-amber-600 transition-all text-xs flex flex-col justify-between space-y-2 group shadow-3xs"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-extrabold text-slate-900 dark:text-white text-xs flex items-center gap-1">
                            <Zap className="h-3 w-3 text-amber-500 fill-current" />
                            {tpl.title}
                          </span>
                          <span className="text-[9px] font-bold uppercase text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                            Quick
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 italic font-sans leading-relaxed">
                          {preview}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200 dark:border-slate-800/60">
                        <button
                          type="button"
                          onClick={() => {
                            setInputText(preview);
                            setShowQuickReplies(false);
                          }}
                          className="flex-1 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-lg text-[10.5px] border border-slate-200 dark:border-slate-700 transition-all cursor-pointer text-center"
                        >
                          Insert to Input
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const fakeTemplate: WhatsAppTemplate = {
                              ...tpl,
                              text: preview
                            };
                            handleSelectTemplate(fakeTemplate, true);
                            setShowQuickReplies(false);
                          }}
                          className="py-1.5 px-3 bg-amber-600 hover:bg-amber-500 text-white font-extrabold rounded-lg text-[10.5px] transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                        >
                          <Send className="h-3 w-3" />
                          Send Now
                        </button>
                      </div>
                    </div>
                  );
                })}
                {templates.filter(t => t.type === 'quick_reply').length === 0 && (
                  <div className="col-span-full py-8 text-center text-xs text-slate-400 italic">
                    No quick replies configured in the Admin Control.
                  </div>
                )}
              </div>
            )}
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
              onClick={() => {
                setShowTemplates(!showTemplates);
                setShowQuickReplies(false);
              }}
              className={`text-[11px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer border ${
                showTemplates
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              <span>Templates ({templates.filter(t => t.type !== 'quick_reply').length})</span>
              {showTemplates ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowQuickReplies(!showQuickReplies);
                setShowTemplates(false);
              }}
              className={`text-[11px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer border ${
                showQuickReplies
                  ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                  : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-100'
              }`}
            >
              <Zap className="h-3 w-3 fill-current" />
              <span>Quick Replies ({templates.filter(t => t.type === 'quick_reply').length})</span>
              {showQuickReplies ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>
          </div>

          <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-bold">
            <span>Press Enter to send</span>
          </div>
        </div>

        {/* Input box & action controls */}
        <div className="flex items-end gap-2">
          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
          />

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

          {/* Attachment Button */}
          <button
            type="button"
            onClick={handleFileUploadClick}
            disabled={uploading || sending}
            className="p-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700 h-[42px] w-[42px]"
            title="Attach Image, PDF, or Document"
          >
            {uploading ? (
              <RefreshCw className="h-4 w-4 animate-spin text-slate-600 dark:text-slate-400" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || sending}
            className="py-3 px-4.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-extrabold rounded-xl text-xs transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5 shrink-0 uppercase tracking-wider h-[42px]"
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
