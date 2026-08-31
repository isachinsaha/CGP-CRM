import React, { useState, useEffect, useRef } from 'react';
import { Lead, Message, WhatsAppTemplate } from '../types.ts';
import { 
  Send, MessageSquare, ExternalLink, Sparkles, Check, CheckCheck, 
  Clock, RefreshCw, FileText, Calendar, Phone, PhoneCall, Copy, 
  ChevronDown, ChevronUp, Bot, UserCheck, AlertCircle, Info, Plus, Paperclip, Zap,
  CornerUpLeft, Smile, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatPhoneForWhatsApp, replaceTemplatePlaceholders, resolveTemplateVariable } from '../server/whatsapp.ts';

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

  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedTemplateIdHistory, setSelectedTemplateIdHistory] = useState('');
  const [historyPreviewText, setHistoryPreviewText] = useState('');
  const [syncingMeta, setSyncingMeta] = useState(false);

  // Parameter Customizer States
  const [historyParamValues, setHistoryParamValues] = useState<Record<string, string>>({});
  const [historyParamKeys, setHistoryParamKeys] = useState<string[]>([]);

  const [selectedConfigTemplate, setSelectedConfigTemplate] = useState<WhatsAppTemplate | null>(null);
  const [configParamValues, setConfigParamValues] = useState<Record<string, string>>({});
  const [configParamKeys, setConfigParamKeys] = useState<string[]>([]);

  // Local Storage Autocomplete cache state (grouped by parameter key/index to remember numbers vs names)
  const [paramSuggestions, setParamSuggestions] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem('whatsapp_param_cache');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [activeSuggestionField, setActiveSuggestionField] = useState<{ type: 'config' | 'history', key: string } | null>(null);

  const saveParamToCache = (paramKey: string, val: string) => {
    if (!val || !val.trim()) return;
    const trimmed = val.trim();
    setParamSuggestions(prev => {
      const existing = prev[paramKey] || [];
      if (existing.includes(trimmed)) return prev;
      const updated = [trimmed, ...existing].slice(0, 20); // Limit to 20 unique history items
      const next = { ...prev, [paramKey]: updated };
      try {
        localStorage.setItem('whatsapp_param_cache', JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };

  const extractTemplateParams = (text: string): string[] => {
    const regex = /\{\{([^}]+)\}\}/g;
    const keys: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      keys.push(match[1].trim());
    }
    return Array.from(new Set(keys)).sort((a, b) => {
      const aNum = parseInt(a, 10);
      const bNum = parseInt(b, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      if (!isNaN(aNum)) return -1;
      if (!isNaN(bNum)) return 1;
      return a.localeCompare(b);
    });
  };

  const getFormattedPreviewText = (text: string, paramValues: Record<string, string>): string => {
    let result = text;
    Object.entries(paramValues).forEach(([key, val]) => {
      const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'gi');
      result = result.replace(regex, val);
    });
    return result;
  };

  const handleSyncMetaTemplates = async () => {
    try {
      setSyncingMeta(true);
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        // Fetch fresh templates list
        const tplRes = await fetch('/api/whatsapp/templates').catch(() => null);
        if (tplRes && tplRes.ok && tplRes.headers.get('content-type')?.includes('application/json')) {
          const tplData = await tplRes.json();
          if (Array.isArray(tplData.templates)) {
            setTemplates(tplData.templates);
          }
        }
        alert(data.message || 'WhatsApp templates synced successfully from Meta!');
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to sync templates. Please verify your Meta Business Manager integration settings or try again.');
      }
    } catch (err: any) {
      console.error('[Sync Meta Templates Error]', err);
      alert('Failed to connect to server to sync templates. Please check your network and try again.');
    } finally {
      setSyncingMeta(false);
    }
  };

  // Determine if the chat's latest message is older than 24 hours (24h Window Expired)
  // Or if the last action was outbound and the candidate has not replied to our template yet.
  const isChatOlderThan24Hours = () => {
    const msgs = (messages || []).filter(m => m && m.text && !m.text.includes('Lead enrolled manually in CGP system database'));
    if (msgs.length === 0) return true; // Require templates for brand new chats
    
    // If the last message in the entire chat is outbound (not from lead),
    // it means we sent a template (or message) and the candidate has not replied to it yet.
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg && lastMsg.sender !== 'lead') {
      return true; // Keep chat locked (templates only) until they reply
    }

    const leadMsgs = msgs.filter(m => m.sender === 'lead');
    if (leadMsgs.length === 0) return true; // Require templates if candidate hasn't replied yet
    const latestLeadMsg = leadMsgs[leadMsgs.length - 1];
    if (!latestLeadMsg?.timestamp) return true;
    const latestTime = new Date(latestLeadMsg.timestamp).getTime();
    if (isNaN(latestTime)) return true;
    const now = new Date().getTime();
    const diffMs = now - latestTime;
    return diffMs > 24 * 60 * 60 * 1000;
  };
  const sessionExpired = isChatOlderThan24Hours();

  const emojis = [
    '👍', '❤️', '😂', '😮', '😢', '🙏', '👋', '✨', '✅', '🔥', '🎉', '💯',
    '😀', '😊', '😍', '😎', '🤔', '🙌', '👏', '🤝', '💪', '✍️', '📝', '💼',
    '📞', '💬', '✉️', '📅', '⏰', '✈️', '🏠', '🔑', '🎯', '⭐️', '📍'
  ];

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

  // Auto-resize the message textarea based on content length
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      if (!inputText) {
        textarea.style.height = '42px';
      } else {
        textarea.style.height = `${scrollHeight}px`;
      }
    }
  }, [inputText]);

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
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          const updatedLead = await res.json();
          if (JSON.stringify(updatedLead.messages) !== JSON.stringify(messagesRef.current)) {
            setMessages(updatedLead.messages || []);
            onLeadUpdated(updatedLead);
          }
        }
      } catch (err: any) {
        if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
          // Gracefully suppress logs during local dev server restarts / cold boots
          console.warn('[Chat Poll] Connection skipped (backend is starting up or offline)');
        } else {
          console.error('Error polling for new messages:', err);
        }
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
            if (updatedRes.ok && updatedRes.headers.get('content-type')?.includes('application/json')) {
              const updatedLead = await updatedRes.json();
              setMessages(updatedLead.messages || []);
              onLeadUpdated(updatedLead);
            }
          }
        })
        .catch(err => {
          if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
            console.warn('[Chat Read] Connection skipped (backend offline)');
          } else {
            console.error('Error marking as read in LeadWhatsAppChat:', err);
          }
        });
    }
  }, [lead.id, messages, onLeadUpdated]);

  const fetchConfigAndTemplates = async () => {
    try {
      setLoadingTemplates(true);
      const [configRes, tplRes] = await Promise.all([
        fetch('/api/whatsapp/config').catch(() => null),
        fetch('/api/whatsapp/templates').catch(() => null)
      ]);

      if (configRes && configRes.ok && configRes.headers.get('content-type')?.includes('application/json')) {
        const configData = await configRes.json();
        setConfig(configData);
      }

      if (tplRes && tplRes.ok && tplRes.headers.get('content-type')?.includes('application/json')) {
        const tplData = await tplRes.json();
        if (Array.isArray(tplData.templates)) {
          setTemplates(tplData.templates);
        }
      }
    } catch (err: any) {
      if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        console.warn('[Chat Config] Config fetch skipped (backend offline)');
      } else {
        console.error('Error fetching WhatsApp configuration:', err);
      }
    } finally {
      setLoadingTemplates(false);
    }
  };

  // Send outbound message
  const handleSendMessage = async (
    customText?: string, 
    templateName?: string, 
    mediaParams?: { type: 'image' | 'pdf' | 'document'; mediaUrl: string; fileName: string; fileSize: string },
    templateParams?: Record<string, string>
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
          templateParams: templateParams || undefined,
          channel: 'whatsapp',
          ...(mediaParams || {}),
          replyToId: replyingToMessage?.id || undefined,
          replyToText: replyingToMessage?.text || undefined,
          replyToSender: replyingToMessage ? (replyingToMessage.senderName || (replyingToMessage.sender === 'lead' ? lead.name : 'Coordinator')) : undefined
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
        setReplyingToMessage(null);
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
    const keys = extractTemplateParams(template.text);
    if (keys.length > 0) {
      // It has variables! Open parameter configuration view
      setSelectedConfigTemplate(template);
      const initialParams: Record<string, string> = {};
      keys.forEach(k => {
        initialParams[k] = resolveTemplateVariable(
          k,
          template.id,
          template.text,
          lead,
          lead.phone || '',
          lead.name || '',
          lead.assignedTo || currentAgentId
        );
      });
      setConfigParamKeys(keys);
      setConfigParamValues(initialParams);
    } else {
      // Direct send/insert since there are no parameters
      const formatted = replaceTemplatePlaceholders(template.text, lead, lead.assignedTo || currentAgentId, template.id);
      if (directSend) {
        handleSendMessage(formatted, template.title);
      } else {
        setInputText(formatted);
        setShowTemplates(false);
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
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
        ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase()
        : '';

      const dateString = msg.timestamp ? getMessageDateString(msg.timestamp) : '';
      const showDateHeader = dateString && dateString !== lastDateString;
      if (dateString) {
        lastDateString = dateString;
      }

      const dateHeaderElement = showDateHeader ? (
        <div key={`date-header-${msg.id || index}`} className="flex justify-center my-3 w-full select-none z-10">
          <span className="bg-[#ffffff]/90 dark:bg-[#182229]/95 text-[#54656f] dark:text-[#8696a0] px-3 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide shadow-[0_1px_0.5px_rgba(0,0,0,0.08)]">
            {dateString}
          </span>
        </div>
      ) : null;

      return (
        <React.Fragment key={msg.id || index}>
          {dateHeaderElement}

          {isSystem ? (
            <div className="flex justify-center my-1.5 w-full z-10">
              <div className="bg-[#ffeecd] dark:bg-[#182229] text-[#54656f] dark:text-[#8696a0] px-3.5 py-1.5 rounded-lg text-[11.5px] font-normal text-center max-w-[85%] sm:max-w-[70%] shadow-[0_1px_0.5px_rgba(0,0,0,0.08)] leading-relaxed border-none">
                {msg.text}
              </div>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.12 }}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group max-w-full w-full mb-1 z-10`}
            >
              {/* Message Bubble Wrapper to hold the Tail, Main body, and Floating Hover Actions */}
              <div className="relative flex items-center max-w-[85%] sm:max-w-[460px]">
                
                {/* Bubble - Real WhatsApp styling */}
                <div
                  className={`w-fit rounded-lg pl-3 pr-2.5 pt-1.5 pb-1 text-[14.2px] leading-[19px] shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] relative transition-all ${
                    isUser
                      ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-tr-none ml-2'
                      : 'bg-white dark:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] rounded-tl-none mr-2'
                  }`}
                >
                  {/* Tailwind-based Triangle Tail */}
                  {isUser ? (
                    <div className="absolute top-0 -right-1.5 w-1.5 h-2.5 bg-[#d9fdd3] dark:bg-[#005c4b]" style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
                  ) : (
                    <div className="absolute top-0 -left-1.5 w-1.5 h-2.5 bg-white dark:bg-[#202c33]" style={{ clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }} />
                  )}

                  {/* Template tag if sent from template */}
                  {msg.templateName && (
                    <div className="mb-1.5 pb-0.5 border-b border-[#000000]/05 dark:border-white/10 text-[10px] font-bold uppercase text-[#00a884] dark:text-emerald-400 flex items-center gap-1 select-none">
                      <span>📑 Template:</span>
                      <span className="truncate">{msg.templateName}</span>
                    </div>
                  )}

                  {/* Quoted Message Reply Box */}
                  {msg.replyToId && (
                    <div className="mb-1.5 p-2 rounded-md bg-[#000000]/04 dark:bg-[#000000]/25 border-l-[4px] border-[#00a884] dark:border-emerald-500 text-[12px] leading-tight select-none text-[#111b21]/80 dark:text-[#e9edef]/85">
                      <div className="font-bold text-[11px] text-[#00a884] dark:text-emerald-400 mb-0.5 truncate flex items-center gap-1">
                        <CornerUpLeft className="h-3 w-3" />
                        <span>{msg.replyToSender || 'Contact'}</span>
                      </div>
                      <div className="line-clamp-2 italic text-[#111b21]/70 dark:text-[#e9edef]/75">
                        {msg.replyToText}
                      </div>
                    </div>
                  )}

                  {/* Media Content Previews */}
                  {msg.type === 'image' && msg.mediaUrl && (
                    <div className="mb-1.5 rounded-md overflow-hidden border border-[#000000]/05 bg-[#f0f2f5] dark:bg-[#111b21] max-w-full">
                      <img
                        src={msg.mediaUrl}
                        alt={msg.fileName || 'WhatsApp Attachment'}
                        referrerPolicy="no-referrer"
                        className="max-h-64 w-full object-cover hover:scale-[1.01] transition-transform duration-200 cursor-zoom-in"
                        onClick={() => window.open(msg.mediaUrl, '_blank')}
                      />
                    </div>
                  )}

                  {(msg.type === 'pdf' || msg.type === 'document') && msg.mediaUrl && (
                    <div className="mb-1.5 p-2 rounded-lg border border-[#000000]/05 bg-[#f0f2f5]/60 dark:bg-[#111b21]/40 flex items-center gap-2.5 max-w-full">
                      <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 shrink-0">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-[#111b21] dark:text-[#e9edef] truncate">
                           {msg.fileName || 'Attachment Document'}
                        </p>
                        <p className="text-[10px] text-[#667781] dark:text-[#8696a0] font-mono">
                          {msg.fileSize || 'Unknown Size'} • {msg.type?.toUpperCase()}
                        </p>
                      </div>
                      <a
                        href={msg.mediaUrl}
                        download={msg.fileName || 'document'}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15 text-[#54656f] dark:text-[#8696a0] transition-colors cursor-pointer shrink-0"
                        title="Download File"
                      >
                        <ChevronDown className="h-4 w-4 rotate-180" />
                      </a>
                    </div>
                  )}

                  {/* Body Text */}
                  {msg.text && msg.text !== 'Sent an image' && msg.text !== 'Sent a PDF document' && msg.text !== 'Sent a document' && (
                    <span className="whitespace-pre-wrap leading-normal font-sans font-normal text-[14px] select-text break-words tracking-normal">
                      {msg.text}
                    </span>
                  )}

                  {/* Bubble Footer Info - Floated gracefully in the bottom-right corner */}
                  <span className="inline-flex items-center justify-end gap-1 text-[10px] text-[#667781] dark:text-[#8696a0] select-none float-right ml-4 mt-1 leading-none">
                    <span className="font-sans">{formattedTime}</span>

                    {isUser && (
                      <span 
                        className={`inline-flex items-center ${
                          msg.status === 'failed'
                            ? 'text-red-500 font-bold cursor-help'
                            : msg.status === 'read' 
                              ? 'text-[#53bdeb]' 
                              : 'text-[#8696a0]'
                        }`} 
                        title={
                          msg.status === 'failed'
                            ? `Failed to send: ${msg.errorDetails || 'Meta Template validation or setup error. Check WABA configuration.'}`
                            : msg.status === 'read' 
                              ? "Read by candidate (Blue tick)" 
                              : msg.status === 'delivered' 
                                ? "Delivered to candidate" 
                                : "Sent to candidate"
                        }
                      >
                        {msg.status === 'failed' ? (
                          <AlertCircle className="h-3.5 w-3.5 stroke-[2.5]" />
                        ) : msg.status === 'sent' ? (
                          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                        ) : (
                          <CheckCheck className="h-3.5 w-3.5 stroke-[2.5]" />
                        )}
                      </span>
                    )}
                  </span>

                  {/* Float Clearing */}
                  <div className="clear-both" />

                </div>

                {/* Floating Hover Actions Outside the Bubble - Completely decoupled to prevent bubble stretching */}
                <div className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-0.5 p-1 bg-white/90 dark:bg-[#202c33]/90 backdrop-blur-xs rounded-lg shadow-md border border-slate-200/50 dark:border-slate-800/80 transition-all duration-150 opacity-0 group-hover:opacity-100 z-20 ${
                  isUser ? 'right-full mr-2' : 'left-full ml-2'
                }`}>
                  <button
                    type="button"
                    onClick={() => setReplyingToMessage(msg)}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-[#667781] hover:text-[#111b21] dark:text-[#8696a0] dark:hover:text-[#e9edef] cursor-pointer transition-colors"
                    title="Reply"
                  >
                    <CornerUpLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyMessage(msg.text, msg.id)}
                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-[#667781] hover:text-[#111b21] dark:text-[#8696a0] dark:hover:text-[#e9edef] cursor-pointer transition-colors"
                    title="Copy"
                  >
                    {copiedId === msg.id ? (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

              </div>
              
              {/* Coordinator Sublabel if sent by Admin or specific Coordinator */}
              {isUser && msg.senderName && (
                <span className="text-[9.5px] text-[#667781] dark:text-[#8696a0] mr-2.5 mt-0.5 select-none font-medium">
                  Sent by: {msg.senderName.replace('Coordinator ', '')}
                </span>
              )}
            </motion.div>
          )}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-[#efeae2] dark:bg-[#0b141a] overflow-hidden text-left relative" id="whatsapp-inbuilt-module">
      
      {/* Repeating WhatsApp Doodle Pattern Overlay in Background */}
      <div 
        className="absolute inset-0 opacity-[0.38] dark:opacity-[0.16] pointer-events-none z-0" 
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Cg fill='none' stroke='%238696a0' stroke-width='0.6'%3E%3Cpath d='M10,20 C12,17 17,17 17,20 C17,23 12,23 10,20 Z M30,50 C33,50 35,52 35,55 C35,58 33,60 30,60 C27,60 25,58 25,55 C25,52 27,50 30,50 Z M65,30 L75,30 L75,40 L65,40 Z M45,75 C50,75 50,85 45,85 C40,85 40,75 45,75 Z' /%3E%3Ccircle cx='50' cy='35' r='1.5' /%3E%3Ccircle cx='20' cy='70' r='2' /%3E%3Cpath d='M70,65 C73,62 77,66 74,69' /%3E%3C/g%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
        }}
      />

      {/* WhatsApp Native Style Top Header Bar */}
      <div className="bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#e9edef] dark:border-slate-800/60 px-4 py-2.5 flex items-center justify-between shrink-0 select-none z-10 shadow-xs">
        <div className="flex items-center gap-3">
          {/* Circular Initials Profile Picture */}
          <div className="h-9 w-9 rounded-full bg-[#00a884] text-white flex items-center justify-center font-bold text-sm tracking-wide uppercase select-none shadow-3xs shrink-0">
            {lead.name?.charAt(0) || 'C'}
          </div>
          <div className="min-w-0">
            <h4 className="text-[14.5px] font-bold text-[#111b21] dark:text-[#e9edef] leading-tight truncate">
              {lead.name || 'Candidate Chat'}
            </h4>
            <p className="text-[11.5px] text-[#667781] dark:text-[#8696a0] font-mono leading-none mt-0.5">
              {lead.phone} • {lead.country || 'N/A'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lead.assignedTo && lead.assignedTo.toLowerCase() !== 'unassigned' && (
            <span className="hidden sm:inline-flex items-center bg-[#e1f5fe] dark:bg-[#182229] text-[#0288d1] dark:text-sky-400 text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider">
              👤 Assigned: {lead.assignedTo}
            </span>
          )}
          <div className="flex items-center gap-1.5 text-[10.5px] text-[#00a884] dark:text-emerald-400 font-bold uppercase tracking-wider font-mono bg-[#d9fdd3] dark:bg-[#005c4b]/20 px-2.5 py-1 rounded-full shadow-3xs">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00a884] animate-pulse" />
            <span>AI Sensy Active</span>
          </div>
        </div>
      </div>

      {/* Messages Stream Container */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2 relative z-10">
        {displayMessages.length === 0 ? (
          <div className="text-center py-16 space-y-3 bg-white dark:bg-[#111b21]/80 rounded-2xl border border-[#e9edef] dark:border-slate-800 p-6 shadow-xs max-w-md mx-auto my-6 z-10 relative">
            <div className="h-12 w-12 rounded-full bg-[#d9fdd3] dark:bg-[#005c4b]/30 text-[#00a884] dark:text-emerald-400 flex items-center justify-center mx-auto shadow-3xs">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h5 className="text-[15px] font-bold text-[#111b21] dark:text-[#e9edef]">Start WhatsApp Conversation</h5>
            <p className="text-[12.5px] text-[#667781] dark:text-[#8696a0] max-w-sm mx-auto leading-relaxed">
              No WhatsApp messages sent yet to <strong>{lead.name || 'Candidate'}</strong> ({lead.phone}). Choose a recruitment template below or write a custom message.
            </p>
            <div className="pt-2 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowTemplates(true)}
                className="px-4 py-2 bg-[#00a884] hover:bg-[#008f72] text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-xs cursor-pointer uppercase tracking-wider"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Browse Templates
              </button>
            </div>
          </div>
        ) : (
          renderMessageStream()
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* 3. Templates Drawer (Expandable) */}
      <AnimatePresence>
        {showTemplates && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="bg-white dark:bg-[#111b21] border-t border-[#e9edef] dark:border-slate-800 shadow-lg shrink-0 z-20 relative font-sans"
          >
            {selectedConfigTemplate ? (
              <div className="p-4 space-y-4 text-left">
                {/* Back button and title header */}
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-850 pb-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedConfigTemplate(null);
                      setConfigParamKeys([]);
                      setConfigParamValues({});
                    }}
                    className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 cursor-pointer bg-transparent border-none"
                  >
                    ← Back to Template List
                  </button>
                  <span className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">
                    Configure Variables
                  </span>
                </div>

                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {selectedConfigTemplate.title}
                  </h4>
                  <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">
                    Category: {selectedConfigTemplate.category}
                  </p>
                </div>

                {/* Parameters Editor Card (Aisensy Style) */}
                <div className="bg-[#f0f2f5]/60 dark:bg-slate-900/40 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-800/60 space-y-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                    <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span>Parameters</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {configParamKeys.map((key) => (
                      <div key={key} className="flex items-center gap-2 bg-white dark:bg-slate-850 p-1.5 rounded-lg border border-slate-150 dark:border-slate-800 shadow-3xs relative">
                        <span className="text-[10px] font-mono font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-0.5 rounded border border-blue-200/40 shrink-0">
                          {"{{" + key + "}}"}
                        </span>
                        <input
                          type="text"
                          value={configParamValues[key] || ''}
                          onChange={(e) => {
                            const updated = { ...configParamValues, [key]: e.target.value };
                            setConfigParamValues(updated);
                          }}
                          onFocus={() => setActiveSuggestionField({ type: 'config', key })}
                          onBlur={() => setTimeout(() => setActiveSuggestionField(null), 200)}
                          placeholder="value"
                          className="flex-1 min-w-0 bg-transparent text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden px-1 border-none placeholder-slate-400 dark:placeholder-slate-600 font-bold"
                        />
                        
                        {/* Dropdown Suggestions matching AiSensy style (sleek black theme) */}
                        {activeSuggestionField?.type === 'config' && activeSuggestionField.key === key && paramSuggestions[key] && paramSuggestions[key].length > 0 && (
                          <div className="absolute top-[102%] left-0 right-0 bg-[#151d24] dark:bg-[#1f2c34] text-slate-100 rounded-lg border border-slate-700/80 dark:border-slate-800 shadow-xl max-h-36 overflow-y-auto z-50 py-1 font-sans text-xs">
                            {paramSuggestions[key].map((suggestedVal, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onMouseDown={() => {
                                  const updated = { ...configParamValues, [key]: suggestedVal };
                                  setConfigParamValues(updated);
                                  setActiveSuggestionField(null);
                                }}
                                className="w-full px-3 py-1.5 text-left hover:bg-emerald-600 dark:hover:bg-emerald-500 hover:text-white transition-colors text-slate-100 font-bold"
                              >
                                {suggestedVal}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Live Preview Panel */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">
                      Preview
                    </label>
                    <span className="text-[8px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/20 px-1 py-0.2 rounded">
                      Outbound Text
                    </span>
                  </div>
                  <div className="p-2.5 bg-[#e1f3fc]/40 dark:bg-[#0b141a]/60 border border-[#b3e0f2]/50 dark:border-slate-800/60 rounded-md text-[11px] text-[#111b21] dark:text-[#e9edef] whitespace-pre-wrap font-sans leading-normal">
                    {getFormattedPreviewText(selectedConfigTemplate.text, configParamValues)}
                  </div>
                </div>

                 {/* Send / Insert Action Buttons */}
                 <div className="flex items-center gap-2 pt-1">
                   <button
                     type="button"
                     onClick={() => {
                       const finalMsg = getFormattedPreviewText(selectedConfigTemplate.text, configParamValues);
                       setInputText(finalMsg);
                       
                       // Cache parameter values for autocomplete suggestions next time
                       Object.entries(configParamValues).forEach(([k, val]) => {
                         saveParamToCache(k, val);
                       });

                       setSelectedConfigTemplate(null);
                       setConfigParamKeys([]);
                       setConfigParamValues({});
                       setShowTemplates(false);
                       if (textareaRef.current) {
                         textareaRef.current.focus();
                       }
                     }}
                     className="flex-1 py-2 bg-white dark:bg-[#2a3942] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] font-bold rounded-lg text-xs border border-[#e9edef] dark:border-slate-800 transition-all cursor-pointer text-center uppercase tracking-wider h-[34px]"
                   >
                     Insert to Chat
                   </button>
                   <button
                     type="button"
                     disabled={sending}
                     onClick={async () => {
                       const finalMsg = getFormattedPreviewText(selectedConfigTemplate.text, configParamValues);
                       setSending(true);
                       try {
                         await handleSendMessage(finalMsg, selectedConfigTemplate.title, undefined, configParamValues);
                         
                         // Cache parameter values for autocomplete suggestions next time
                         Object.entries(configParamValues).forEach(([k, val]) => {
                           saveParamToCache(k, val);
                         });

                         setSelectedConfigTemplate(null);
                         setConfigParamKeys([]);
                         setConfigParamValues({});
                         setShowTemplates(false);
                       } catch (e) {
                         console.error('Failed to send template outreach:', e);
                       } finally {
                         setSending(false);
                       }
                     }}
                     className="py-2 px-4 bg-[#00a884] hover:bg-[#008f72] text-white font-bold rounded-lg text-xs transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-3xs uppercase tracking-wider h-[34px]"
                   >
                    {sending ? (
                      <RefreshCw className="h-4 w-4 animate-spin text-white" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    <span>{sending ? 'Sending...' : 'Send Message'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-3.5 border-b border-[#e9edef] dark:border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[#00a884] dark:text-emerald-400 animate-pulse" />
                    <h5 className="text-xs font-bold text-[#111b21] dark:text-[#e9edef] uppercase tracking-wider">
                      WhatsApp Recruitment Templates
                    </h5>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSyncMetaTemplates}
                      disabled={syncingMeta}
                      className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-450 dark:hover:text-emerald-400 cursor-pointer bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-2.5 py-1 rounded-md flex items-center gap-1.5"
                    >
                      <RefreshCw className={`h-3 w-3 ${syncingMeta ? 'animate-spin' : ''}`} />
                      <span>{syncingMeta ? 'Syncing...' : 'Sync Meta'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTemplates(false)}
                      className="text-xs font-bold text-[#667781] hover:text-[#111b21] dark:text-[#8696a0] dark:hover:text-[#e9edef] cursor-pointer bg-black/5 dark:bg-white/5 px-2.5 py-1 rounded-md"
                    >
                      ✕ Close
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 p-2 px-3 bg-[#f0f2f5] dark:bg-[#202c33] overflow-x-auto select-none">
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
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer border ${
                        selectedCategory === cat.id
                          ? 'bg-[#00a884] text-white border-transparent shadow-3xs'
                          : 'bg-white dark:bg-[#2a3942] text-[#54656f] dark:text-[#8696a0] border-[#e9edef] dark:border-slate-800 hover:bg-[#f0f2f5]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="max-h-52 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {filteredTemplates.map(tpl => {
                    const preview = replaceTemplatePlaceholders(tpl.text, lead, lead.assignedTo || currentAgentId, tpl.id);
                    return (
                      <div
                        key={tpl.id}
                        className="p-3 bg-[#f0f2f5]/50 dark:bg-[#202c33]/40 rounded-xl border border-[#e9edef] dark:border-slate-800/80 hover:border-[#00a884] dark:hover:border-emerald-600 transition-all text-xs flex flex-col justify-between space-y-2 group"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="font-bold text-[#111b21] dark:text-[#e9edef] text-xs">{tpl.title}</span>
                            <span className="text-[9px] font-bold uppercase text-[#00a884] dark:text-emerald-400 bg-[#d9fdd3] dark:bg-[#005c4b]/20 px-1.5 py-0.5 rounded">
                              {tpl.category}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#667781] dark:text-[#8696a0] line-clamp-3 italic font-sans leading-relaxed">
                            {preview}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 pt-1.5 border-t border-[#000000]/05 dark:border-white/5">
                          <button
                            type="button"
                            onClick={() => handleSelectTemplate(tpl, false)}
                            className="flex-1 py-1 bg-white dark:bg-[#2a3942] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] font-bold rounded-lg text-[11px] border border-[#e9edef] dark:border-slate-800 transition-all cursor-pointer text-center"
                          >
                            Insert
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectTemplate(tpl, true)}
                            className="py-1 px-3 bg-[#00a884] hover:bg-[#008f72] text-white font-bold rounded-lg text-[11px] transition-all cursor-pointer flex items-center gap-1 shadow-3xs"
                          >
                            <Send className="h-3 w-3" />
                            Send
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </motion.div>
        )}

        {showQuickReplies && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="bg-white dark:bg-[#111b21] border-t border-[#e9edef] dark:border-slate-800 shadow-lg shrink-0 z-20 relative"
          >
            <div className="p-3.5 border-b border-[#e9edef] dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500 fill-current animate-pulse" />
                <h5 className="text-xs font-bold text-[#111b21] dark:text-[#e9edef] uppercase tracking-wider">
                  ⚡ Quick Reply Messages
                </h5>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateQuickReply(!showCreateQuickReply)}
                  className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:text-amber-500 flex items-center gap-1 cursor-pointer bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-200/50 dark:border-amber-900/40"
                >
                  <Plus className="h-3 w-3" />
                  {showCreateQuickReply ? 'View Quick Replies' : 'Add Quick Reply'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickReplies(false)}
                  className="text-xs font-bold text-[#667781] hover:text-[#111b21] dark:text-[#8696a0] dark:hover:text-[#e9edef] cursor-pointer bg-black/5 dark:bg-white/5 px-2.5 py-1 rounded-md"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {showCreateQuickReply ? (
              <form onSubmit={handleCreateQuickReply} className="p-4 bg-[#f0f2f5]/50 dark:bg-[#202c33]/40 border-b border-[#e9edef] dark:border-slate-800 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-[#667781] dark:text-[#8696a0] mb-1">
                      Quick Reply ID (e.g. `welcome`) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. welcome"
                      value={newQuickReply.id}
                      onChange={e => setNewQuickReply(p => ({ ...p, id: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                      className="w-full text-xs p-2.5 rounded-lg border border-[#e9edef] dark:border-slate-800 bg-white dark:bg-[#2a3942] focus:outline-none text-[#111b21] dark:text-[#e9edef]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-[#667781] dark:text-[#8696a0] mb-1">
                      Display Title *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Greeting Welcome"
                      value={newQuickReply.title}
                      onChange={e => setNewQuickReply(p => ({ ...p, title: e.target.value }))}
                      className="w-full text-xs p-2.5 rounded-lg border border-[#e9edef] dark:border-slate-800 bg-white dark:bg-[#2a3942] focus:outline-none text-[#111b21] dark:text-[#e9edef]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-[#667781] dark:text-[#8696a0] mb-1">
                    Short Description / Note
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. For initial introductions"
                    value={newQuickReply.description}
                    onChange={e => setNewQuickReply(p => ({ ...p, description: e.target.value }))}
                    className="w-full text-xs p-2.5 rounded-lg border border-[#e9edef] dark:border-slate-800 bg-white dark:bg-[#2a3942] focus:outline-none text-[#111b21] dark:text-[#e9edef]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-[#667781] dark:text-[#8696a0] mb-1">
                    Message Body Content (Variables: {"{{name}}, {{country}}, {{position}}, {{coordinator}}"}) *
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Enter message body..."
                    value={newQuickReply.text}
                    onChange={e => setNewQuickReply(p => ({ ...p, text: e.target.value }))}
                    className="w-full text-xs p-2.5 rounded-lg border border-[#e9edef] dark:border-slate-800 bg-white dark:bg-[#2a3942] focus:outline-none font-sans text-[#111b21] dark:text-[#e9edef]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCreateQuickReply(false)}
                    className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 dark:bg-[#2a3942] dark:hover:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] text-xs font-bold border border-[#e9edef] dark:border-slate-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-3xs cursor-pointer uppercase tracking-wider"
                  >
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <div className="max-h-52 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {templates.filter(t => t.type === 'quick_reply').map(tpl => {
                  const preview = replaceTemplatePlaceholders(tpl.text, lead, lead.assignedTo || currentAgentId, tpl.id);
                  return (
                    <div
                      key={tpl.id}
                      className="p-3 bg-amber-50/10 dark:bg-amber-950/10 rounded-xl border border-amber-400/30 dark:border-amber-900/20 hover:border-amber-400 dark:hover:border-amber-600 transition-all text-xs flex flex-col justify-between space-y-2 group shadow-3xs"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-bold text-[#111b21] dark:text-[#e9edef] text-xs flex items-center gap-1">
                            <Zap className="h-3 w-3 text-amber-500 fill-current" />
                            {tpl.title}
                          </span>
                          <span className="text-[9px] font-bold uppercase text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                            Quick
                          </span>
                        </div>
                        <p className="text-[11px] text-[#667781] dark:text-[#8696a0] italic font-sans leading-relaxed">
                          {preview}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1 border-t border-[#000000]/05 dark:border-white/5">
                        <button
                          type="button"
                          onClick={() => {
                            setInputText(preview);
                            setShowQuickReplies(false);
                          }}
                          className="flex-1 py-1 bg-white dark:bg-[#2a3942] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] text-[#111b21] dark:text-[#e9edef] font-bold rounded-lg text-[11px] border border-[#e9edef] dark:border-slate-800 transition-all cursor-pointer text-center"
                        >
                          Insert
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
                          className="py-1 px-3 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-[11px] transition-all cursor-pointer flex items-center gap-1 shadow-3xs"
                        >
                          <Send className="h-3 w-3" />
                          Send
                        </button>
                      </div>
                    </div>
                  );
                })}
                {templates.filter(t => t.type === 'quick_reply').length === 0 && (
                  <div className="col-span-full py-8 text-center text-xs text-[#667781] dark:text-[#8696a0] italic">
                    No quick replies configured in the Admin Control.
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4. WhatsApp Message Composer Bar - High Fidelity Web Layout */}
      <div className="p-3.5 bg-[#f0f2f5] dark:bg-[#202c33] border-t border-[#e9edef] dark:border-slate-800/80 shrink-0 space-y-3 shadow-md relative z-20">
        
        {sessionExpired ? (
          <div className="space-y-3.5">
            {/* Session Expired Notice */}
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200/50 dark:border-amber-900/60 rounded-lg p-2 text-[11px] text-amber-900 dark:text-amber-200 flex items-center gap-2 shadow-3xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-bold uppercase tracking-wider text-[9px] text-amber-700 dark:text-amber-300">24-Hour Session Expired:</span>
                <span className="opacity-95 text-amber-900 dark:text-amber-100">Meta rules prohibit free-text messages after 24 hours of inactivity. Please send an approved WhatsApp template to restart the window.</span>
              </div>
            </div>

            {/* Template Selector Dropdown & Live Preview */}
            <div className="bg-white dark:bg-[#111b21] p-2.5 rounded-xl border border-[#e9edef] dark:border-slate-800/80 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-[#00a884]" />
                  SELECT PRE-APPROVED META TEMPLATE
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSyncMetaTemplates}
                    disabled={syncingMeta}
                    className="text-[9px] font-black uppercase text-emerald-600 dark:text-emerald-450 hover:underline flex items-center gap-1 cursor-pointer bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded-md border border-emerald-150 dark:border-emerald-900/50"
                  >
                    <RefreshCw className={`h-2.5 w-2.5 ${syncingMeta ? 'animate-spin' : ''}`} />
                    <span>{syncingMeta ? 'Syncing...' : 'Sync Meta'}</span>
                  </button>
                  <span className="text-[8px] bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-350 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">
                    META VERIFIED ONLY
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={selectedTemplateIdHistory}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedTemplateIdHistory(val);
                    const selected = templates.find(t => t.id === val);
                    if (selected) {
                      const keys = extractTemplateParams(selected.text);
                      const initialParams: Record<string, string> = {};
                      keys.forEach(k => {
                        initialParams[k] = resolveTemplateVariable(
                          k,
                          selected.id,
                          selected.text,
                          lead,
                          lead.phone || '',
                          lead.name || '',
                          lead.assignedTo || currentAgentId
                        );
                      });
                      setHistoryParamKeys(keys);
                      setHistoryParamValues(initialParams);
                      const formatted = getFormattedPreviewText(selected.text, initialParams);
                      setHistoryPreviewText(formatted);
                    } else {
                      setHistoryParamKeys([]);
                      setHistoryParamValues({});
                      setHistoryPreviewText('');
                    }
                  }}
                  className="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-lg text-xs text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-emerald-500 transition-all font-sans font-bold"
                >
                  <option value="">-- Choose an Approved Meta Template to Re-Activate --</option>
                  {templates.filter(t => t.type !== 'quick_reply').map((t) => {
                    const emojiMap: Record<string, string> = {
                      onboarding: '👋',
                      interview: '📅',
                      documentation: '📄',
                      status: '📢',
                      offer: '🎉',
                      quick_reply: '⚡'
                    };
                    const emoji = emojiMap[t.category] || '💬';
                    const snippet = t.text ? t.text.replace(/\s+/g, ' ').substring(0, 50) : '';
                    const label = `${emoji} ${t.title} - "${snippet}..."`;
                    return (
                      <option key={t.id} value={t.id} className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 font-sans">
                        {label}
                      </option>
                    );
                  })}
                </select>

                <button
                  type="button"
                  disabled={!selectedTemplateIdHistory || sending}
                  onClick={async () => {
                    const selected = templates.find(t => t.id === selectedTemplateIdHistory);
                    if (selected) {
                      setSending(true);
                      try {
                        await handleSendMessage(historyPreviewText, selected.id, undefined, historyParamValues);
                        
                        // Cache parameter values for next time
                        Object.entries(historyParamValues).forEach(([k, val]) => {
                          saveParamToCache(k, val);
                        });

                        setSelectedTemplateIdHistory('');
                        setHistoryPreviewText('');
                        setHistoryParamKeys([]);
                        setHistoryParamValues({});
                      } catch (e) {
                        console.error('Failed to send template outreach:', e);
                      } finally {
                        setSending(false);
                      }
                    }
                  }}
                  className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer uppercase tracking-wider transition-all select-none h-[34px] shrink-0 ${
                    selectedTemplateIdHistory && !sending
                      ? 'bg-[#00a884] hover:bg-[#008f72] text-white shadow-xs active:scale-98'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 cursor-not-allowed'
                  }`}
                >
                  {sending ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  <span>{sending ? 'Sending...' : 'Send Template'}</span>
                </button>
              </div>

              {/* Aisensy-style Parameters Grid for Session Expired */}
              {selectedTemplateIdHistory && historyParamKeys.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-lg border border-slate-200/60 dark:border-slate-800/60 space-y-2 text-left">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                    <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span>Parameters</span>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {historyParamKeys.map((key) => (
                      <div key={key} className="flex items-center gap-2 bg-white dark:bg-slate-850 p-1.5 rounded-lg border border-slate-150 dark:border-slate-800 shadow-3xs relative">
                        <span className="text-[10px] font-mono font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded border border-blue-200/40 shrink-0">
                          {"{{" + key + "}}"}
                        </span>
                        <input
                          type="text"
                          value={historyParamValues[key] || ''}
                          onChange={(e) => {
                            const updated = { ...historyParamValues, [key]: e.target.value };
                            setHistoryParamValues(updated);
                            const selected = templates.find(t => t.id === selectedTemplateIdHistory);
                            if (selected) {
                              setHistoryPreviewText(getFormattedPreviewText(selected.text, updated));
                            }
                          }}
                          onFocus={() => setActiveSuggestionField({ type: 'history', key })}
                          onBlur={() => setTimeout(() => setActiveSuggestionField(null), 200)}
                          placeholder="value"
                          className="flex-1 min-w-0 bg-transparent text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden px-1 border-none placeholder-slate-400 dark:placeholder-slate-600 font-bold"
                        />
                        
                        {/* Dropdown Suggestions matching AiSensy style (sleek black theme) */}
                        {activeSuggestionField?.type === 'history' && activeSuggestionField.key === key && paramSuggestions[key] && paramSuggestions[key].length > 0 && (
                          <div className="absolute top-[102%] left-0 right-0 bg-[#151d24] dark:bg-[#1f2c34] text-slate-100 rounded-lg border border-slate-700/80 dark:border-slate-800 shadow-xl max-h-36 overflow-y-auto z-50 py-1 font-sans text-xs">
                            {paramSuggestions[key].map((suggestedVal, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onMouseDown={() => {
                                  const updated = { ...historyParamValues, [key]: suggestedVal };
                                  setHistoryParamValues(updated);
                                  const selected = templates.find(t => t.id === selectedTemplateIdHistory);
                                  if (selected) {
                                    setHistoryPreviewText(getFormattedPreviewText(selected.text, updated));
                                  }
                                  setActiveSuggestionField(null);
                                }}
                                className="w-full px-3 py-1.5 text-left hover:bg-emerald-600 dark:hover:bg-emerald-500 hover:text-white transition-colors text-slate-100 font-bold"
                              >
                                {suggestedVal}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Preview Panel - Rendered compactly */}
              {selectedTemplateIdHistory && (
                <div className="space-y-1 animate-fadeIn border-t border-slate-100 dark:border-slate-800/80 pt-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">
                      Preview
                    </label>
                    <span className="text-[8px] text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/20 px-1 py-0.2 rounded">
                      Outbound Text
                    </span>
                  </div>
                  <div className="p-2.5 bg-[#e1f3fc]/40 dark:bg-[#0b141a]/60 border border-[#b3e0f2]/50 dark:border-slate-800/60 rounded-md text-[11px] text-[#111b21] dark:text-[#e9edef] whitespace-pre-wrap font-sans leading-normal">
                    {historyPreviewText}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Reply Message Preview Panel */}
            {replyingToMessage && (
              <div className="bg-white dark:bg-[#2a3942] border-l-[4px] border-[#00a884] p-2.5 rounded-lg flex items-center justify-between text-xs transition-all relative shadow-3xs">
                <div className="flex-1 min-w-0 pr-4">
                  <span className="font-bold text-[#00a884] dark:text-emerald-400 block mb-0.5 text-[11px]">
                    Replying to {replyingToMessage.senderName || (replyingToMessage.sender === 'lead' ? lead.name : 'Coordinator')}
                  </span>
                  <span className="text-[#667781] dark:text-[#8696a0] truncate block italic text-[11.5px]">
                    {replyingToMessage.text}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingToMessage(null)}
                  className="p-1 text-[#667781] hover:text-[#111b21] dark:hover:text-white transition-colors cursor-pointer rounded-full hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] shrink-0"
                  title="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Helper quick tools row */}
            <div className="flex items-center justify-between text-xs px-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowTemplates(!showTemplates);
                    setShowQuickReplies(false);
                  }}
                  className={`text-[10.5px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer border ${
                    showTemplates
                      ? 'bg-[#00a884] text-white border-transparent shadow-3xs'
                      : 'bg-white dark:bg-[#2a3942] text-[#00a884] dark:text-[#00c298] border-emerald-500/30 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20'
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Templates ({templates.filter(t => t.type !== 'quick_reply').length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowQuickReplies(!showQuickReplies);
                    setShowTemplates(false);
                  }}
                  className={`text-[10.5px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer border ${
                    showQuickReplies
                      ? 'bg-amber-600 text-white border-transparent shadow-3xs'
                      : 'bg-white dark:bg-[#2a3942] text-amber-800 dark:text-amber-400 border-[#e9edef] dark:border-slate-800 hover:bg-amber-50'
                  }`}
                >
                  <Zap className="h-3 w-3 fill-current" />
                  <span>Quick Replies ({templates.filter(t => t.type === 'quick_reply').length})</span>
                </button>
              </div>

              <div className="text-[9.5px] text-[#667781] dark:text-[#8696a0] font-mono font-bold uppercase select-none">
                <span>Enter to Send</span>
              </div>
            </div>

            {/* Popover Emoji Picker */}
            {showEmojiPicker && (
              <div className="absolute bottom-[72px] left-3 bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-slate-800 rounded-xl shadow-xl p-3.5 z-30 w-64 text-left">
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[#e9edef] dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-[#667781] dark:text-[#8696a0]">Emojis</span>
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(false)}
                    className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 text-[#667781] hover:text-[#111b21] dark:hover:text-white transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-6 gap-2 max-h-44 overflow-y-auto pr-1">
                  {emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        setInputText(prev => prev + emoji);
                        textareaRef.current?.focus();
                      }}
                      className="text-lg p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-md active:scale-90 transition-transform cursor-pointer select-none text-center flex items-center justify-center h-8 w-8"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Main Composer Row */}
            <div className="flex items-center gap-2.5">
              {/* Hidden File Input */}
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={handleFileChange}
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
              />

              {/* Left Accessory Icon Actions */}
              <div className="flex items-center gap-1.5">
                {/* Emoji Trigger Button */}
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className={`p-2.5 rounded-full transition-all cursor-pointer flex items-center justify-center shrink-0 hover:bg-black/5 dark:hover:bg-white/5 ${
                    showEmojiPicker
                      ? 'text-[#00a884]'
                      : 'text-[#54656f] dark:text-[#8696a0]'
                  }`}
                  title="Emoji"
                >
                  <Smile className="h-6 w-6" />
                </button>

                {/* Attachment Button */}
                <button
                  type="button"
                  onClick={handleFileUploadClick}
                  disabled={uploading || sending}
                  className="p-2.5 rounded-full transition-all cursor-pointer flex items-center justify-center shrink-0 hover:bg-black/5 dark:hover:bg-white/5 text-[#54656f] dark:text-[#8696a0]"
                  title="Attach Document or Media"
                >
                  {uploading ? (
                    <RefreshCw className="h-5.5 w-5.5 animate-spin text-[#00a884]" />
                  ) : (
                    <Paperclip className="h-5.5 w-5.5 rotate-45" />
                  )}
                </button>
              </div>

              {/* Textarea Input Field */}
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Type a message"
                className="flex-1 text-[14.5px] py-2.5 px-4 rounded-lg bg-white dark:bg-[#2a3942] border-none focus:outline-none focus:ring-0 text-[#111b21] dark:text-[#e9edef] placeholder-[#667781] dark:placeholder-[#8696a0] font-normal leading-normal max-h-36 min-h-[42px] resize-none overflow-y-auto"
                style={{ height: '42px' }}
              />

              {/* Send Button - Rounded Circle style like true WhatsApp Web */}
              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={(!inputText.trim() && !sending) || sending}
                className={`h-11 w-11 rounded-full flex items-center justify-center shadow-md transition-all shrink-0 cursor-pointer ${
                  inputText.trim() 
                    ? 'bg-[#00a884] hover:bg-[#008f72] text-white active:scale-95' 
                    : 'bg-black/5 dark:bg-white/5 text-[#54656f] dark:text-[#8696a0] opacity-40 cursor-not-allowed'
                }`}
                title="Send message"
              >
                {sending ? (
                  <RefreshCw className="h-5 w-5 animate-spin text-white" />
                ) : (
                  <Send className="h-5 w-5 text-white ml-0.5 fill-current" />
                )}
              </button>
            </div>
          </>
        )}
      </div>

    </div>
  );
}
