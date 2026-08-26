import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lead, Coordinator, LeadStage } from '../types.ts';
import { 
  MessageSquare, Search, Filter, Phone, User, Calendar, 
  ExternalLink, Sparkles, Send, CheckCircle2, ChevronRight, 
  ArrowLeft, Clock, Briefcase, RefreshCw, Layers, CheckCheck,
  UserCheck, Plus, AlertCircle, Save, ArrowRightLeft, Shield,
  GraduationCap, Globe, Wrench, FileText, Check, Tag
} from 'lucide-react';
import LeadWhatsAppChat from './LeadWhatsAppChat.tsx';
import { getCountryFlagUrl, formatCandidateName } from '../utils.ts';

interface MessagingCenterProps {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  userRole: 'admin' | 'agent';
  currentAgentId: string;
  coordinators: Coordinator[];
  countries?: string[];
  positions?: string[];
  projects?: string[];
  tagsList?: string[];
  onUpdateCountries?: (countries: string[]) => void;
  onUpdatePositions?: (positions: string[]) => void;
  onUpdateProjects?: (projects: string[]) => void;
  onUpdateTagsList?: (tags: string[]) => void;
  onRefreshData?: () => void;
  onLeadUpdated?: (updatedLead?: Lead) => void;
  isRefreshing?: boolean;
}

const DEFAULT_AISENSY_TAGS = [
  'JAPAN', 'Sales', 'QATAR', 'Hospitality', 'EUROPE', 'Kitchen Helper', 
  'House Keeping', 'Website/Organic', 'Waiter', 'Barista', 'Passport Ready', 
  'ECG', 'Fresher', 'Gulf Exp', 'Nurse', 'Electrician', 'Plumber', 'Driver', 'Dubai Jobs'
];

export default function MessagingCenter({
  leads,
  onSelectLead,
  userRole,
  currentAgentId,
  coordinators,
  countries = ['Kuwait', 'Qatar', 'Dubai', 'Saudi Arabia', 'Japan', 'Germany', 'Russia', 'Oman', 'Bahrain'],
  positions = ['Nurse', 'General Worker', 'Electrician', 'Plumber', 'Welder', 'Cook', 'Waiter', 'Driver', 'Security Guard', 'Mason', 'Carpenter'],
  projects = ['Gulf General Recruitment', 'Hospitality Division', 'Healthcare Abroad', 'Construction & Technical', 'Aviation & Logistics'],
  tagsList = DEFAULT_AISENSY_TAGS,
  onUpdateCountries,
  onUpdatePositions,
  onUpdateProjects,
  onUpdateTagsList,
  onRefreshData,
  onLeadUpdated,
  isRefreshing = false
}: MessagingCenterProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'requesting' | 'active' | 'history'>(
    userRole === 'admin' ? 'requesting' : 'active'
  );
  const [selectedCoordinatorFilter, setSelectedCoordinatorFilter] = useState<string>('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showLeadDetailsPanel, setShowLeadDetailsPanel] = useState(userRole === 'admin');
  const [isSavingLead, setIsSavingLead] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [tagAddedToast, setTagAddedToast] = useState<string | null>(null);
  const [showSimulatorModal, setShowSimulatorModal] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isRefreshingChat, setIsRefreshingChat] = useState(false);

  // Start New Chat States
  const [showStartChatModal, setShowStartChatModal] = useState(false);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [startChatPhone, setStartChatPhone] = useState('');
  const [startChatName, setStartChatName] = useState('');
  const [startChatInitialMessage, setStartChatInitialMessage] = useState('Hello! Welcome to Career Growth Placement. We received your request. Let\'s connect here on WhatsApp.');
  const [startChatPosition, setStartChatPosition] = useState('General openings');
  const [startChatCountry, setStartChatCountry] = useState('Kuwait');
  const [startChatError, setStartChatError] = useState<string | null>(null);

  // Quick inline add toggles for country, position, and project
  const [isAddingCountry, setIsAddingCountry] = useState(false);
  const [newCountryInput, setNewCountryInput] = useState('');
  const [isAddingPosition, setIsAddingPosition] = useState(false);
  const [newPositionInput, setNewPositionInput] = useState('');
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectInput, setNewProjectInput] = useState('');

  // AiSensy Tag Input & Dropdown State
  const [tagInput, setTagInput] = useState('');
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);

  // Form state matching full Enrollment Directory
  const [leadFormData, setLeadFormData] = useState({
    name: '',
    phone: '',
    alternateNo: '',
    gender: 'M',
    age: '24',
    origin: '',
    country: 'Kuwait',
    position: 'General Applicant',
    experience: 'Fresher',
    qualification: '10th Pass',
    importance: '3',
    source: 'Ads',
    project: 'Gulf General Recruitment',
    stage: 'negotiating' as LeadStage,
    assignedTo: 'unassigned',
    tags: [] as string[],
    adminRemarks: ''
  });

  // Filter leads who have existing WhatsApp messages or are active in chat
  const activeChatLeads = useMemo(() => {
    return leads.filter(l => {
      const msgs = (l.messages || []).filter(m => m && m.text && !m.text.includes('Lead enrolled manually in CGP system database'));
      return msgs.length > 0;
    });
  }, [leads]);

  // Helper to determine if the chat is older than 24 hours (History archive)
  const isOlderThan24Hours = (lead: Lead) => {
    const msgs = (lead.messages || []).filter(m => m && m.text && !m.text.includes('Lead enrolled manually in CGP system database'));
    if (msgs.length === 0) return true;
    const latestMsg = msgs[msgs.length - 1];
    if (!latestMsg?.timestamp) return true;
    const latestTime = new Date(latestMsg.timestamp).getTime();
    if (isNaN(latestTime)) return true;
    const now = new Date().getTime();
    const diffMs = now - latestTime;
    return diffMs > 24 * 60 * 60 * 1000;
  };

  // Helper to match coordinator assignment
  const isAssignedToAgent = (lead: Lead, agentId: string) => {
    if (!lead.assignedTo) return false;
    const assigned = lead.assignedTo.trim().toLowerCase();
    const target = (agentId || '').trim().toLowerCase();
    return assigned === target || assigned === target.replace(/_/g, ' ') || assigned === target.replace(/\s+/g, '_');
  };

  // Admin Counts
  const requestingLeadsCount = useMemo(() => {
    return activeChatLeads.filter(l => {
      const isUnassigned = !l.assignedTo || 
        l.assignedTo.toLowerCase() === 'unassigned' || 
        l.assignedTo.toLowerCase() === 'all' ||
        l.assignedTo.trim() === '';
      return isUnassigned && !isOlderThan24Hours(l);
    }).length;
  }, [activeChatLeads]);

  const activeLeadsCount = useMemo(() => {
    return activeChatLeads.filter(l => {
      const isUnassigned = !l.assignedTo || 
        l.assignedTo.toLowerCase() === 'unassigned' || 
        l.assignedTo.toLowerCase() === 'all' ||
        l.assignedTo.trim() === '';
      const isMine = isAssignedToAgent(l, currentAgentId);
      
      if (userRole === 'admin') {
        if (isUnassigned || isOlderThan24Hours(l)) return false;
        if (selectedCoordinatorFilter) {
          if (selectedCoordinatorFilter === 'unassigned') {
            if (!isUnassigned) return false;
          } else if (!isAssignedToAgent(l, selectedCoordinatorFilter)) {
            return false;
          }
        }
        return true;
      }
      return isMine && !isOlderThan24Hours(l);
    }).length;
  }, [activeChatLeads, currentAgentId, userRole, selectedCoordinatorFilter]);

  const historyLeadsCount = useMemo(() => {
    return activeChatLeads.filter(l => {
      const isUnassigned = !l.assignedTo || 
        l.assignedTo.toLowerCase() === 'unassigned' || 
        l.assignedTo.toLowerCase() === 'all' ||
        l.assignedTo.trim() === '';
      const isMine = isAssignedToAgent(l, currentAgentId);
      if (userRole === 'admin') {
        if (!isOlderThan24Hours(l)) return false;
        if (selectedCoordinatorFilter) {
          if (selectedCoordinatorFilter === 'unassigned') {
            if (!isUnassigned) return false;
          } else if (!isAssignedToAgent(l, selectedCoordinatorFilter)) {
            return false;
          }
        }
        return true;
      }
      return isMine && isOlderThan24Hours(l);
    }).length;
  }, [activeChatLeads, currentAgentId, userRole, selectedCoordinatorFilter]);

  // Total unread messages count for requesting
  const requestingUnreadCount = useMemo(() => {
    return activeChatLeads.reduce((sum, l) => {
      const isUnassigned = !l.assignedTo || 
        l.assignedTo.toLowerCase() === 'unassigned' || 
        l.assignedTo.toLowerCase() === 'all' ||
        l.assignedTo.trim() === '';
      const isReq = isUnassigned && !isOlderThan24Hours(l);
      if (!isReq) return sum;
      const unreadMsgs = (l.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
      return sum + unreadMsgs;
    }, 0);
  }, [activeChatLeads]);

  // Total unread messages count for active chats
  const activeUnreadCount = useMemo(() => {
    return activeChatLeads.reduce((sum, l) => {
      const isUnassigned = !l.assignedTo || 
        l.assignedTo.toLowerCase() === 'unassigned' || 
        l.assignedTo.toLowerCase() === 'all' ||
        l.assignedTo.trim() === '';
      const isMine = isAssignedToAgent(l, currentAgentId);
      let isActive = false;
      if (userRole === 'admin') {
        isActive = !isUnassigned && !isOlderThan24Hours(l);
        if (selectedCoordinatorFilter) {
          if (selectedCoordinatorFilter === 'unassigned') {
            if (!isUnassigned) isActive = false;
          } else if (!isAssignedToAgent(l, selectedCoordinatorFilter)) {
            isActive = false;
          }
        }
      } else {
        isActive = isMine && !isOlderThan24Hours(l);
      }
      if (!isActive) return sum;
      const unreadMsgs = (l.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
      return sum + unreadMsgs;
    }, 0);
  }, [activeChatLeads, currentAgentId, userRole, selectedCoordinatorFilter]);

  // Total unread messages count for history (closed) chats
  const historyUnreadCount = useMemo(() => {
    return activeChatLeads.reduce((sum, l) => {
      const isUnassigned = !l.assignedTo || 
        l.assignedTo.toLowerCase() === 'unassigned' || 
        l.assignedTo.toLowerCase() === 'all' ||
        l.assignedTo.trim() === '';
      const isMine = isAssignedToAgent(l, currentAgentId);
      let isHist = false;
      if (userRole === 'admin') {
        isHist = isOlderThan24Hours(l);
        if (selectedCoordinatorFilter) {
          if (selectedCoordinatorFilter === 'unassigned') {
            if (!isUnassigned) isHist = false;
          } else if (!isAssignedToAgent(l, selectedCoordinatorFilter)) {
            isHist = false;
          }
        }
      } else {
        isHist = isMine && isOlderThan24Hours(l);
      }
      if (!isHist) return sum;
      const unreadMsgs = (l.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
      return sum + unreadMsgs;
    }, 0);
  }, [activeChatLeads, currentAgentId, userRole, selectedCoordinatorFilter]);

  // Filtered leads based on RBAC (Admin vs Coordinator) and active filter
  const filteredChatLeads = useMemo(() => {
    return activeChatLeads.filter(lead => {
      const isUnassigned = !lead.assignedTo || 
        lead.assignedTo.toLowerCase() === 'unassigned' || 
        lead.assignedTo.toLowerCase() === 'all' ||
        lead.assignedTo.trim() === '';
      const olderThan24h = isOlderThan24Hours(lead);
      const assignedToMe = isAssignedToAgent(lead, currentAgentId);

      // Admin coordinator filter (applies to active and history tabs, since requesting is unassigned)
      if (userRole === 'admin' && selectedCoordinatorFilter && filterType !== 'requesting') {
        if (selectedCoordinatorFilter === 'unassigned') {
          if (!isUnassigned) return false;
        } else {
          if (!isAssignedToAgent(lead, selectedCoordinatorFilter)) return false;
        }
      }

      // Requesting: Always unassigned
      if (filterType === 'requesting') {
        if (olderThan24h || !isUnassigned) return false;
      } 
      // Active: Assigned (All for admin, Me for coordinator), not older than 24h
      else if (filterType === 'active') {
        if (olderThan24h || isUnassigned) return false;
        if (userRole !== 'admin' && !assignedToMe) return false;
      }
      // History: Older than 24h
      else if (filterType === 'history') {
        if (!olderThan24h) return false;
        if (userRole !== 'admin' && !assignedToMe) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = lead.name?.toLowerCase().includes(q);
        const matchPhone = lead.phone?.toLowerCase().includes(q);
        const matchOrigin = lead.origin?.toLowerCase().includes(q);
        const matchProject = lead.project?.toLowerCase().includes(q);
        const matchPosition = lead.position?.toLowerCase().includes(q);
        const matchCoord = lead.assignedTo?.toLowerCase().includes(q);
        const matchTags = (lead.tags || []).some(t => t.toLowerCase().includes(q));
        const matchMsg = (lead.messages || []).some(m => m.text?.toLowerCase().includes(q));
        return matchName || matchPhone || matchOrigin || matchProject || matchPosition || matchCoord || matchTags || matchMsg;
      }

      return true;
    }).sort((a, b) => {
      // Sort by latest message timestamp descending
      const aMsgs = a.messages || [];
      const bMsgs = b.messages || [];
      const aLatest = aMsgs.length > 0 ? new Date(aMsgs[aMsgs.length - 1].timestamp || 0).getTime() : 0;
      const bLatest = bMsgs.length > 0 ? new Date(bMsgs[bMsgs.length - 1].timestamp || 0).getTime() : 0;
      return bLatest - aLatest;
    });
  }, [activeChatLeads, searchQuery, filterType, userRole, currentAgentId]);

  // Currently active lead for chat panel
  const currentChatLead = useMemo(() => {
    if (!selectedLeadId) return null;
    return leads.find(l => l.id === selectedLeadId) || null;
  }, [leads, selectedLeadId]);

  // Sync lead form data when active lead changes
  useEffect(() => {
    if (currentChatLead) {
      setLeadFormData({
        name: currentChatLead.name || '',
        phone: currentChatLead.phone || '',
        alternateNo: currentChatLead.alternateNo || '',
        gender: currentChatLead.gender || 'M',
        age: String(currentChatLead.age || '24'),
        origin: currentChatLead.origin || '',
        country: currentChatLead.country || 'Kuwait',
        position: currentChatLead.position || 'General Applicant',
        experience: currentChatLead.experience || 'Fresher',
        qualification: currentChatLead.qualification || '10th Pass',
        importance: String(currentChatLead.importance || '3'),
        source: currentChatLead.source || 'Ads',
        project: currentChatLead.project || 'Gulf General Recruitment',
        stage: currentChatLead.stage || 'negotiating',
        assignedTo: currentChatLead.assignedTo || 'unassigned',
        tags: currentChatLead.tags || [],
        adminRemarks: currentChatLead.adminRemarks || ''
      });
      setSaveSuccessMsg(null);
      setTagAddedToast(null);
    }
  }, [currentChatLead?.id]);

  // Mark as read when active lead changes in MessagingCenter
  useEffect(() => {
    if (selectedLeadId) {
      const activeLead = leads.find(l => l.id === selectedLeadId);
      const hasUnread = activeLead && (activeLead.messages || []).some(m => m.sender === 'lead' && m.status !== 'read');
      
      if (hasUnread) {
        fetch(`/api/leads/${selectedLeadId}/read`, { method: 'POST' })
          .then(async (res) => {
            if (res.ok) {
              const updatedLeadRes = await fetch(`/api/leads/${selectedLeadId}`);
              if (updatedLeadRes.ok) {
                const updatedLead = await updatedLeadRes.json();
                if (onLeadUpdated) {
                  onLeadUpdated(updatedLead);
                }
              }
            }
          })
          .catch(err => console.error('Error marking as read in MessagingCenter:', err));
      }
    }
  }, [selectedLeadId, leads, onLeadUpdated]);

  // Handle lead item click in list
  const handleSelectChat = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setMobileView('chat');
  };

  // Add a tag to the candidate record (AiSensy style)
  const handleAddTag = (tagToAdd: string) => {
    const trimmed = tagToAdd.trim();
    if (!trimmed) return;
    if (!leadFormData.tags.includes(trimmed)) {
      const nextTags = [...leadFormData.tags, trimmed];
      setLeadFormData(prev => ({ ...prev, tags: nextTags }));
      if (onUpdateTagsList && tagsList && !tagsList.includes(trimmed)) {
        onUpdateTagsList([...tagsList, trimmed]);
      }
      setTagAddedToast(`Tag added successfully !`);
      setTimeout(() => setTagAddedToast(null), 3000);
    }
    setTagInput('');
    setIsTagDropdownOpen(false);
  };

  // Remove tag
  const handleRemoveTag = (tagToRemove: string) => {
    setLeadFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tagToRemove)
    }));
  };

  // Refresh currently active chat messages and details directly
  const handleRefreshActiveChat = async () => {
    if (!currentChatLead || isRefreshingChat) return;
    setIsRefreshingChat(true);
    try {
      const res = await fetch(`/api/leads/${currentChatLead.id}`);
      if (res.ok) {
        const updatedLead = await res.json();
        if (onLeadUpdated) {
          onLeadUpdated(updatedLead);
        }
      }
      if (onRefreshData) {
        onRefreshData();
      }
    } catch (err) {
      console.error('Error refreshing active chat:', err);
    } finally {
      setIsRefreshingChat(false);
    }
  };

  // Save lead details and transfer to coordinator
  const handleSaveAndTransferLead = async (targetCoordinator?: string) => {
    if (!currentChatLead) return;
    setIsSavingLead(true);
    setSaveSuccessMsg(null);

    const coordToAssign = targetCoordinator || leadFormData.assignedTo;

    try {
      const updatedPayload = {
        ...currentChatLead,
        name: leadFormData.name.trim() || 'Unnamed candidate',
        phone: leadFormData.phone.trim() || currentChatLead.phone,
        alternateNo: leadFormData.alternateNo.trim() || currentChatLead.alternateNo || '',
        gender: leadFormData.gender,
        age: leadFormData.age,
        origin: leadFormData.origin.trim() || currentChatLead.origin || '',
        country: leadFormData.country,
        position: leadFormData.position,
        experience: leadFormData.experience,
        qualification: leadFormData.qualification,
        importance: Number(leadFormData.importance || 3),
        source: leadFormData.source || currentChatLead.source || 'Ads',
        project: leadFormData.project,
        stage: leadFormData.stage,
        assignedTo: coordToAssign,
        tags: leadFormData.tags || [],
        adminRemarks: leadFormData.adminRemarks,
        intake: true,
        assignedFrom: 'whatsapp_chat_menu'
      };

      const res = await fetch(`/api/leads/${currentChatLead.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPayload)
      });

      if (!res.ok) {
        throw new Error('Failed to update lead information');
      }

      const savedLead = await res.json();

      // Trigger callbacks
      if (onLeadUpdated) {
        onLeadUpdated(savedLead);
      }
      if (onRefreshData) {
        onRefreshData();
      }

      setSaveSuccessMsg(`Lead successfully updated & transferred to ${coordToAssign || 'Coordinator'}!`);
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } catch (err) {
      console.error('Error saving lead from messaging:', err);
      alert('Error updating lead. Please try again.');
    } finally {
      setIsSavingLead(false);
    }
  };

  // Simulate a new inbound WhatsApp message (like in AiSensy webhook)
  const handleSimulateInboundMessage = async (templateData: { name: string; phone: string; message: string; trade: string; country: string }) => {
    setIsSimulating(true);
    try {
      const res = await fetch('/api/webhook/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsappName: templateData.name,
          phone: templateData.phone,
          initialMessage: templateData.message,
          campaignName: `${templateData.country} ${templateData.trade} Recruitment`
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (onRefreshData) onRefreshData();
        setShowSimulatorModal(false);
        setFilterType('requesting');
        if (data.lead && data.lead.id) {
          setSelectedLeadId(data.lead.id);
        }
      }
    } catch (err) {
      console.error('Failed to simulate inbound message:', err);
    } finally {
      setIsSimulating(false);
    }
  };

  // Start a brand new WhatsApp Conversation
  const handleStartWhatsAppChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setStartChatError(null);

    const trimmedPhone = startChatPhone.replace(/\s+/g, '');
    if (!trimmedPhone) {
      setStartChatError('Please enter a valid WhatsApp phone number.');
      return;
    }

    setIsStartingChat(true);

    try {
      const res = await fetch('/api/whatsapp/start-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify({
          phone: trimmedPhone,
          name: startChatName.trim() || undefined,
          initialMessage: startChatInitialMessage.trim() || undefined,
          position: startChatPosition,
          country: startChatCountry,
          assignedTo: currentAgentId
        })
      });

      if (res.ok) {
        const data = await res.json();
        
        // Close modal and reset fields
        setShowStartChatModal(false);
        setStartChatPhone('');
        setStartChatName('');
        setStartChatInitialMessage('Hello! Welcome to Career Growth Placement. We received your request. Let\'s connect here on WhatsApp.');
        
        // Refresh all local data so the new lead is pulled in
        if (onRefreshData) {
          onRefreshData();
        }

        // Set to coordinator's active tab so they see it instantly
        setFilterType(userRole === 'admin' ? 'requesting' : 'active');
        
        // Auto select the newly created or loaded active lead
        if (data.lead && data.lead.id) {
          setSelectedLeadId(data.lead.id);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setStartChatError(errData.error || errData.message || 'Failed to start WhatsApp conversation. Please check your token or phone number structure.');
      }
    } catch (err: any) {
      console.error('Error starting WhatsApp chat:', err);
      setStartChatError(err?.message || 'Server network error occurred.');
    } finally {
      setIsStartingChat(false);
    }
  };

  // Helper to format relative or short time
  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // Total inbound count across all leads
  const totalInboundCount = useMemo(() => {
    return leads.reduce((acc, l) => {
      const inbounds = (l.messages || []).filter(m => m.sender === 'lead').length;
      return acc + inbounds;
    }, 0);
  }, [leads]);

  return (
    <div className="flex-1 flex min-h-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-lg overflow-hidden text-left" id="cgp-messaging-center">
      
      {/* Left Pane: Candidate Conversation List (Width increased by 15% from original) */}
      <div className={`w-full md:w-[405px] lg:w-[450px] xl:w-[495px] flex flex-col border-r border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 ${
        mobileView === 'chat' ? 'hidden md:flex' : 'flex'
      }`}>
        
        {/* Left Pane Top Header */}
        <div className="p-2.5 px-3 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <MessageSquare className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs font-black text-slate-100 dark:text-white uppercase tracking-tight truncate">
                WhatsApp Chats
              </h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
                <span><strong>{requestingLeadsCount}</strong> requesting • <strong>{activeLeadsCount}</strong> active • <strong>{historyLeadsCount}</strong> in history</span>
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Start New Chat button */}
            <button
              onClick={() => setShowStartChatModal(true)}
              className="px-2.5 py-1.5 rounded-lg text-white bg-emerald-600 hover:bg-emerald-500 font-bold text-xs flex items-center gap-1 shadow-2xs border border-emerald-700 transition-all cursor-pointer uppercase tracking-wider"
              title="Start New Chat"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Start Chat</span>
            </button>

            {/* Simulator button for testing inbound flow (Admin only) */}
            {userRole === 'admin' && (
              <button
                onClick={() => setShowSimulatorModal(true)}
                className="p-1.5 rounded-lg text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 transition cursor-pointer shadow-2xs"
                title="Simulate Inbound Lead"
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              </button>
            )}
            {onRefreshData && (
              <button
                onClick={onRefreshData}
                disabled={isRefreshing}
                className="p-1.5 rounded-lg text-slate-100 dark:text-slate-300 bg-slate-800 dark:bg-slate-800 hover:bg-slate-750 dark:hover:bg-slate-700 border border-slate-750 dark:border-slate-700 transition cursor-pointer shadow-2xs disabled:opacity-60"
                title="Refresh Chats"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* Search and Filter Toolbar */}
        <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2 bg-white dark:bg-slate-900">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search by name, phone, state, trade..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-750 rounded-xl text-xs text-slate-100 placeholder-slate-600 focus:outline-hidden focus:border-emerald-500 transition-all font-sans"
            />
          </div>

          {/* Coordinator Filter (Admin only) */}
          {userRole === 'admin' && (
            <div className="flex items-center gap-1.5 bg-slate-800 p-1.5 px-2.5 rounded-xl border border-slate-750">
              <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase shrink-0">Coordinator:</span>
              <select
                value={selectedCoordinatorFilter}
                onChange={(e) => setSelectedCoordinatorFilter(e.target.value)}
                className="flex-1 bg-transparent border-none p-0 focus:ring-0 text-xs font-black text-slate-200 focus:outline-hidden cursor-pointer"
              >
                <option value="" className="bg-slate-900 text-slate-100 font-sans font-medium text-xs">👤 All Coordinators</option>
                <option value="unassigned" className="bg-slate-900 text-slate-100 font-sans font-medium text-xs">⚠️ Unassigned</option>
                {coordinators.map(c => (
                  <option key={c.id} value={c.displayName || c.username} className="bg-slate-900 text-slate-100 font-sans font-medium text-xs">
                    👤 {c.displayName || c.username}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Filter Buttons: Single Line, No-Wrap */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-nowrap w-full py-0.5">
            {/* Tab 1: Requesting (Admin Only) */}
            {userRole === 'admin' && (
              <button
                onClick={() => setFilterType('requesting')}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all cursor-pointer border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  filterType === 'requesting'
                    ? 'bg-amber-500 text-white border-amber-500 shadow-2xs font-black'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100'
                }`}
              >
                <span>📥 Requesting</span>
                {requestingLeadsCount > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-black ${
                    filterType === 'requesting' ? 'bg-white text-amber-700' : 'bg-amber-100 dark:bg-amber-900 text-amber-400 dark:text-amber-200'
                  }`}>
                    {requestingLeadsCount}
                  </span>
                )}
                {requestingUnreadCount > 0 && (
                  <span className="text-[9.5px] px-1.5 py-0.2 rounded-full font-mono font-black bg-rose-500 text-white animate-pulse" title={`${requestingUnreadCount} unread WhatsApp messages`}>
                    ✉ {requestingUnreadCount}
                  </span>
                )}
              </button>
            )}

            {/* Tab 2: Active Chats */}
            <button
              onClick={() => setFilterType('active')}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all cursor-pointer border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                filterType === 'active'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs font-black'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
              }`}
            >
              <MessageSquare className="h-3 w-3" />
              <span>Active Chats</span>
              {activeLeadsCount > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-black ${
                  filterType === 'active' ? 'bg-white text-emerald-700' : 'bg-emerald-100 dark:bg-emerald-900 text-emerald-400 dark:text-emerald-200'
                }`}>
                  {activeLeadsCount}
                </span>
              )}
              {activeUnreadCount > 0 && (
                <span className="text-[9.5px] px-1.5 py-0.2 rounded-full font-mono font-black bg-rose-500 text-white animate-pulse" title={`${activeUnreadCount} unread WhatsApp messages`}>
                  ✉ {activeUnreadCount}
                </span>
              )}
            </button>

            {/* Tab 3: History */}
            <button
              onClick={() => setFilterType('history')}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all cursor-pointer border flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                filterType === 'history'
                  ? 'bg-slate-800 dark:bg-slate-700 text-white border-slate-800 shadow-2xs font-black'
                  : 'bg-slate-800 dark:bg-slate-850 border-slate-750 dark:border-slate-700 text-slate-400 dark:text-slate-300 hover:bg-slate-750'
              }`}
            >
              <Clock className="h-3 w-3" />
              <span>History (&gt;24h)</span>
              {historyLeadsCount > 0 && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-black ${
                  filterType === 'history' ? 'bg-white text-slate-100' : 'bg-slate-900 dark:bg-slate-700 text-slate-300 dark:text-slate-300'
                }`}>
                  {historyLeadsCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* List of Chat Threads */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
            {filteredChatLeads.length === 0 ? (
              <div className="p-8 text-center space-y-3 text-slate-500 dark:text-slate-400">
                <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <p className="text-xs font-bold">
                  {filterType === 'requesting' 
                    ? 'No unassigned chats in Requesting' 
                    : filterType === 'history' 
                      ? 'No chat history older than 24 hours' 
                      : 'No conversations found'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {filterType === 'requesting' 
                    ? 'All inbound candidate messages have been assigned to coordinators!' 
                    : filterType === 'history'
                      ? 'Conversations older than 24 hours will automatically archive here.'
                      : 'Assigned candidate messages will appear here.'}
                </p>
              </div>
            ) : (
              filteredChatLeads.map(lead => {
                const isSelected = currentChatLead?.id === lead.id;
                const msgs = (lead.messages || []).filter(m => m && m.text && !m.text.includes('Lead enrolled manually in CGP system database'));
                const latestMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
                const inboundCount = msgs.filter(m => m.sender === 'lead' && m.status !== 'read').length;
                const isLatestFromLead = latestMsg?.sender === 'lead';
                const isUnassigned = !lead.assignedTo || 
                  lead.assignedTo.toLowerCase() === 'unassigned' || 
                  lead.assignedTo.toLowerCase() === 'all' ||
                  lead.assignedTo.trim() === '';

                return (
                  <div
                    key={lead.id}
                    onClick={() => handleSelectChat(lead)}
                    className={`p-3 transition-all cursor-pointer flex items-start gap-2.5 hover:bg-slate-800 dark:hover:bg-slate-800/60 ${
                      isSelected
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/30 border-l-4 border-l-emerald-600'
                        : 'border-l-4 border-l-transparent'
                    }`}
                  >
                    {/* Avatar & Indicator */}
                    <div className="relative shrink-0 mt-0.5">
                      <div className="h-9 w-9 rounded-full bg-emerald-700 dark:bg-emerald-800 flex items-center justify-center text-white font-black text-xs shadow-xs">
                        {lead.name ? lead.name.charAt(0).toUpperCase() : 'C'}
                      </div>
                      <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 border-2 border-white dark:border-slate-900 rounded-full ${
                        isUnassigned ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'
                      }`} />
                    </div>

                    {/* Chat Thread Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <h4 className="text-xs font-black text-slate-100 dark:text-slate-100 truncate uppercase tracking-tight">
                          {formatCandidateName(lead.name)}
                        </h4>
                        <span className="text-[9.5px] font-mono text-slate-500 dark:text-slate-400 shrink-0 font-medium">
                          {formatTime(latestMsg?.timestamp)}
                        </span>
                      </div>

                      {/* Phone, Origin & Trade tags */}
                      <div className="flex items-center gap-1.5 flex-wrap mb-1 text-[9.5px]">
                        <span className="font-mono text-slate-600 dark:text-slate-400 font-semibold">{lead.phone}</span>
                        {lead.origin && (
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-1 py-0.2 rounded border border-emerald-200 dark:border-emerald-800/60">
                            📍 {lead.origin}
                          </span>
                        )}
                        {lead.country && (
                          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-0.5">
                            <span>•</span>
                            <span>{lead.country}</span>
                          </span>
                        )}
                      </div>

                      {/* Tag Chips */}
                      {lead.tags && lead.tags.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap mb-1">
                          {lead.tags.slice(0, 2).map((t, idx) => (
                            <span key={idx} className="bg-slate-800 dark:bg-slate-800 text-slate-400 dark:text-slate-300 px-1.5 py-0.2 rounded text-[8.5px] font-bold">
                              {t}
                            </span>
                          ))}
                          {lead.tags.length > 2 && (
                            <span className="text-[8.5px] text-slate-400 font-bold">+{lead.tags.length - 2}</span>
                          )}
                        </div>
                      )}

                      {/* Latest Message Snippet */}
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-[11px] truncate leading-tight ${
                          isLatestFromLead 
                            ? 'font-bold text-slate-100 dark:text-emerald-300' 
                            : 'text-slate-600 dark:text-slate-400'
                        }`}>
                          {latestMsg ? (
                            <span className="inline-flex items-center gap-0.5">
                              {latestMsg.sender !== 'lead' && (
                                <span 
                                  className={`inline-flex items-center shrink-0 mr-1 ${
                                    latestMsg.status === 'read' 
                                      ? 'text-sky-500 dark:text-sky-400' 
                                      : 'text-slate-400 dark:text-slate-500'
                                  }`}
                                >
                                  {latestMsg.status === 'sent' ? (
                                    <Check className="h-3 w-3 stroke-[2.5]" />
                                  ) : (
                                    <CheckCheck className="h-3 w-3 stroke-[2.5]" />
                                  )}
                                </span>
                              )}
                              <span>{latestMsg.text}</span>
                            </span>
                          ) : (
                            <span className="italic text-slate-400">No message snippet</span>
                          )}
                        </p>

                        {/* Inbound Message Badge */}
                        {inboundCount > 0 && (
                          <span 
                            className="shrink-0 text-[9.5px] font-black text-emerald-950 dark:text-emerald-300 bg-emerald-400 dark:bg-emerald-950/90 border border-emerald-500/50 dark:border-emerald-700/80 px-1.5 py-0.2 rounded-full font-mono flex items-center gap-0.5"
                            title={`${inboundCount} candidate message${inboundCount > 1 ? 's' : ''}`}
                          >
                            <MessageSquare className="h-2.5 w-2.5 fill-current" />
                            <span>{inboundCount}</span>
                          </span>
                        )}
                      </div>

                      {/* Status / Assigned Coordinator Tag */}
                      <div className="mt-1 flex items-center justify-between gap-1 text-[9px]">
                        {isUnassigned ? (
                          <span className="text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 px-1.5 py-0.2 rounded font-black border border-amber-300 dark:border-amber-800 uppercase flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Requesting (Unassigned)
                          </span>
                        ) : (
                          <div className="flex items-center gap-1 text-purple-700 dark:text-purple-300 font-bold">
                            <User className="h-2.5 w-2.5" />
                            <span>Assigned: {lead.assignedTo}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center Pane: Active WhatsApp Messaging Console */}
        <div className={`flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-900 ${
          mobileView === 'list' ? 'hidden md:flex' : 'flex'
        }`}>
          {currentChatLead ? (
            <div className="flex-1 flex flex-col min-h-0">
              
              {/* Uplifted Active Chat Candidate Header (Aligned directly at the top with rich details) */}
              <div className="py-2.5 px-3 sm:px-4 bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  
                  {/* Mobile Back to List Button */}
                  <button
                    onClick={() => setMobileView('list')}
                    className="md:hidden p-1 rounded-lg text-slate-500 hover:text-slate-100 dark:hover:text-white bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0"
                    title="Back to conversation list"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>

                  <div className="relative shrink-0">
                    <div className="h-9 w-9 rounded-full bg-emerald-600 flex items-center justify-center text-white font-black text-xs shadow-xs">
                      {currentChatLead.name ? currentChatLead.name.charAt(0).toUpperCase() : 'C'}
                    </div>
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 bg-emerald-400 border-2 border-white dark:border-slate-900 rounded-full" />
                  </div>

                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Candidate Name */}
                      <h3 className="text-xs sm:text-sm font-black text-slate-100 dark:text-white tracking-tight uppercase truncate">
                        {formatCandidateName(currentChatLead.name)}
                      </h3>

                      {/* Phone Number with INCREASED size */}
                      <span className="text-xs sm:text-sm font-mono font-black text-slate-100 dark:text-slate-100 bg-slate-800 dark:bg-slate-800 px-2.5 py-0.5 rounded-lg border border-slate-750 dark:border-slate-700 tracking-wider shadow-2xs">
                        {currentChatLead.phone}
                      </span>

                      {/* Applied Job Position */}
                      {(currentChatLead.position || (currentChatLead as any).positionAppliedFor) && (
                        <span className="text-[11px] bg-blue-50 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800/80 px-2 py-0.5 rounded-md font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1 whitespace-nowrap">
                          <Briefcase className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                          <span>{currentChatLead.position || (currentChatLead as any).positionAppliedFor}</span>
                        </span>
                      )}

                      {/* Location / Origin */}
                      {(currentChatLead.origin || (currentChatLead as any).state) && (
                        <span className="text-[11px] bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800/80 px-2 py-0.5 rounded-md font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1 whitespace-nowrap">
                          <span>📍 {currentChatLead.origin || (currentChatLead as any).state}</span>
                        </span>
                      )}

                      {/* Target Country */}
                      {currentChatLead.country && (
                        <span className="text-[11px] bg-purple-50 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800/80 px-2 py-0.5 rounded-md font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap">
                          {currentChatLead.country}
                        </span>
                      )}

                      {/* Coordinator / Requesting Badge */}
                      {(!currentChatLead.assignedTo || currentChatLead.assignedTo === 'unassigned') ? (
                        <span className="text-[10.5px] bg-amber-100 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-800 px-2 py-0.5 rounded-md font-black text-amber-800 dark:text-amber-300 uppercase animate-pulse whitespace-nowrap">
                          📥 Requesting
                        </span>
                      ) : (
                        <span className="text-[10.5px] bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 rounded-md font-bold text-indigo-700 dark:text-indigo-300 uppercase whitespace-nowrap">
                          {currentChatLead.assignedTo}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Candidate Action Buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Lead Details & Transfer toggle for Admin only */}
                  {userRole === 'admin' && (
                    <button
                      onClick={() => setShowLeadDetailsPanel(!showLeadDetailsPanel)}
                      className={`text-xs font-bold px-2.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs border ${
                        showLeadDetailsPanel
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-slate-800 dark:bg-slate-800 text-slate-100 dark:text-slate-300 border-slate-750 dark:border-slate-700 hover:bg-slate-750'
                      }`}
                      title="Toggle Lead Intake & Assignment Panel"
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      <span className="hidden lg:inline">Lead Details & Transfer</span>
                    </button>
                  )}

                  {/* Full Profile button */}
                  <button
                    onClick={() => onSelectLead(currentChatLead)}
                    className="text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-800 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs whitespace-nowrap"
                    title="Open Full Candidate Profile Modal"
                  >
                    <User className="h-3.5 w-3.5" />
                    <span>Full Profile</span>
                  </button>

                  {/* Refresh button */}
                  <button
                    onClick={handleRefreshActiveChat}
                    disabled={isRefreshingChat}
                    className="text-xs font-bold text-slate-100 dark:text-slate-300 bg-slate-800 dark:bg-slate-800 hover:bg-slate-750 dark:hover:bg-slate-700 border border-slate-750 dark:border-slate-700 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-xs cursor-pointer whitespace-nowrap disabled:opacity-50"
                    title="Refresh Chat"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingChat ? 'animate-spin' : ''}`} />
                    <span>{isRefreshingChat ? 'Refreshing...' : 'Refresh'}</span>
                  </button>
                </div>
              </div>

              {/* Chat Window & Side Intake Form */}
              <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* Chat Feed */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <LeadWhatsAppChat
                    lead={currentChatLead}
                    onLeadUpdated={(updated) => {
                      if (onLeadUpdated) onLeadUpdated(updated);
                      if (onRefreshData) onRefreshData();
                    }}
                    userRole={userRole}
                    currentAgentId={currentAgentId}
                  />
                </div>

                {/* Right Sub-Pane: Lead Form & Transfer Panel (Admin Only) */}
                {userRole === 'admin' && showLeadDetailsPanel && (
                  <div className="w-[320px] lg:w-[370px] xl:w-[410px] border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-col min-h-0 shrink-0">
                    
                    {/* Header with Title and Unassigned Badge */}
                    <div className="p-3.5 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <div className="text-left">
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          <h4 className="text-xs font-black text-slate-100 dark:text-white uppercase tracking-wider">
                            Lead Intake & Transfer
                          </h4>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-mono font-bold tracking-widest mt-0.5">
                          ENROLLMENT FORMAT DIRECTORY
                        </p>
                      </div>
                      {(!currentChatLead.assignedTo || currentChatLead.assignedTo === 'unassigned') ? (
                        <span className="text-[9.5px] font-black text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-800 font-mono animate-pulse">
                          UNASSIGNED
                        </span>
                      ) : (
                        <span className="text-[9.5px] font-black text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-950/80 px-2 py-0.5 rounded-full border border-purple-300 dark:border-purple-800 font-mono">
                          {currentChatLead.assignedTo}
                        </span>
                      )}
                    </div>

                    {/* AiSensy Green Toast Banner when tag is added */}
                    {tagAddedToast && (
                      <div className="p-2.5 bg-emerald-500 text-slate-950 text-xs font-black flex items-center justify-between shadow-md">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 shrink-0 stroke-[2.5]" />
                          <span>{tagAddedToast}</span>
                        </div>
                        <button 
                          onClick={() => setTagAddedToast(null)}
                          className="hover:opacity-80 text-xs font-black cursor-pointer px-1"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* Success Alert Banner for Save */}
                    {saveSuccessMsg && (
                      <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/80 border-b border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span className="text-[11px] leading-tight">{saveSuccessMsg}</span>
                      </div>
                    )}

                    {/* Scrollable Form Fields (Matching Enrollment Modal Form) */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-left">
                      
                      {/* Candidate Name */}
                      <div>
                        <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                          Candidate Full Name *
                        </label>
                        <input
                          type="text"
                          value={leadFormData.name}
                          onChange={(e) => setLeadFormData({ ...leadFormData, name: e.target.value })}
                          className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500 shadow-xs"
                          placeholder="e.g. Rahul Sharma"
                        />
                      </div>

                      {/* Phone & Alternative No */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                            Mobile No *
                          </label>
                          <input
                            type="text"
                            value={leadFormData.phone}
                            onChange={(e) => setLeadFormData({ ...leadFormData, phone: e.target.value })}
                            className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-mono font-semibold focus:outline-hidden focus:border-emerald-500 shadow-xs"
                            placeholder="+91..."
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                            Alternative No
                          </label>
                          <input
                            type="text"
                            value={leadFormData.alternateNo}
                            onChange={(e) => setLeadFormData({ ...leadFormData, alternateNo: e.target.value })}
                            className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-mono font-semibold focus:outline-hidden focus:border-emerald-500 shadow-xs"
                            placeholder="Optional phone"
                          />
                        </div>
                      </div>

                      {/* Gender, Age & Origin State Row */}
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                            Gender
                          </label>
                          <select
                            value={leadFormData.gender}
                            onChange={(e) => setLeadFormData({ ...leadFormData, gender: e.target.value })}
                            className="w-full px-2 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500"
                          >
                            <option value="M">Male (M)</option>
                            <option value="F">Female (F)</option>
                            <option value="Not defined">Not defined</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                            Age
                          </label>
                          <input
                            type="text"
                            value={leadFormData.age}
                            onChange={(e) => setLeadFormData({ ...leadFormData, age: e.target.value })}
                            className="w-full px-2.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500"
                            placeholder="e.g. 26"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 uppercase block mb-1 truncate">
                            Origin / State
                          </label>
                          <input
                            type="text"
                            value={leadFormData.origin}
                            onChange={(e) => setLeadFormData({ ...leadFormData, origin: e.target.value })}
                            className="w-full px-2 py-2 bg-white dark:bg-slate-950 border border-emerald-300 dark:border-emerald-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500"
                            placeholder="e.g. Darjeeling"
                          />
                        </div>
                      </div>

                      {/* Country Applying & Position */}
                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase">
                              Apply Destination Country *
                            </label>
                            {userRole === 'admin' && (
                              <button
                                type="button"
                                onClick={() => setIsAddingCountry(!isAddingCountry)}
                                className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline font-bold"
                              >
                                {isAddingCountry ? 'Cancel' : '+ Add Country'}
                              </button>
                            )}
                          </div>
                          {isAddingCountry ? (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={newCountryInput}
                                onChange={(e) => setNewCountryInput(e.target.value)}
                                placeholder="New Country..."
                                className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (newCountryInput.trim() && onUpdateCountries && countries) {
                                    onUpdateCountries([...countries, newCountryInput.trim()]);
                                    setLeadFormData({ ...leadFormData, country: newCountryInput.trim() });
                                    setNewCountryInput('');
                                    setIsAddingCountry(false);
                                  }
                                }}
                                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            <select
                              value={leadFormData.country}
                              onChange={(e) => setLeadFormData({ ...leadFormData, country: e.target.value })}
                              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500 shadow-xs"
                            >
                              <option value="">Select Country (Leave Blank)</option>
                              {countries.map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase">
                              Target Job Position *
                            </label>
                            {userRole === 'admin' && (
                              <button
                                type="button"
                                onClick={() => setIsAddingPosition(!isAddingPosition)}
                                className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline font-bold"
                              >
                                {isAddingPosition ? 'Cancel' : '+ Add Position'}
                              </button>
                            )}
                          </div>
                          {isAddingPosition ? (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={newPositionInput}
                                onChange={(e) => setNewPositionInput(e.target.value)}
                                placeholder="New Position..."
                                className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (newPositionInput.trim() && onUpdatePositions && positions) {
                                    onUpdatePositions([...positions, newPositionInput.trim()]);
                                    setLeadFormData({ ...leadFormData, position: newPositionInput.trim() });
                                    setNewPositionInput('');
                                    setIsAddingPosition(false);
                                  }
                                }}
                                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold"
                              >
                                Save
                              </button>
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={leadFormData.position}
                              onChange={(e) => setLeadFormData({ ...leadFormData, position: e.target.value })}
                              className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500 shadow-xs"
                              placeholder="e.g. Nurse, Welder, Cook, Waiter..."
                            />
                          )}
                        </div>
                      </div>

                      {/* Experience & Qualification */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                            Experience
                          </label>
                          <input
                            type="text"
                            value={leadFormData.experience}
                            onChange={(e) => setLeadFormData({ ...leadFormData, experience: e.target.value })}
                            className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500"
                            placeholder="e.g. 2 yrs Gulf / Fresher"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                            Qualification
                          </label>
                          <input
                            type="text"
                            value={leadFormData.qualification}
                            onChange={(e) => setLeadFormData({ ...leadFormData, qualification: e.target.value })}
                            className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500"
                            placeholder="e.g. 10th / Graduate / ITI"
                          />
                        </div>
                      </div>

                      {/* Star Importance & Lead Source */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                            Importance
                          </label>
                          <select
                            value={leadFormData.importance}
                            onChange={(e) => setLeadFormData({ ...leadFormData, importance: e.target.value })}
                            className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500"
                          >
                            <option value="1">⭐ 1 Star (Low)</option>
                            <option value="2">⭐⭐ 2 Stars (Normal)</option>
                            <option value="3">⭐⭐⭐ 3 Stars (Good)</option>
                            <option value="4">⭐⭐⭐⭐ 4 Stars (High)</option>
                            <option value="5">⭐⭐⭐⭐⭐ 5 Stars (Top)</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                            Lead Source
                          </label>
                          <select
                            value={leadFormData.source}
                            onChange={(e) => setLeadFormData({ ...leadFormData, source: e.target.value })}
                            className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500"
                          >
                            <option value="Ads">Ads 📣</option>
                            <option value="Organic">Organic 🌱</option>
                            <option value="Website">Website 🌐</option>
                            <option value="Instagram">Instagram 📸</option>
                            <option value="Referral">Referral 🤝</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                      </div>

                      {/* Hiring Project */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase">
                            Hiring Project
                          </label>
                          {userRole === 'admin' && (
                            <button
                              type="button"
                              onClick={() => setIsAddingProject(!isAddingProject)}
                              className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline font-bold"
                            >
                              {isAddingProject ? 'Cancel' : '+ Add Project'}
                            </button>
                          )}
                        </div>
                        {isAddingProject ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newProjectInput}
                              onChange={(e) => setNewProjectInput(e.target.value)}
                              placeholder="New Project..."
                              className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (newProjectInput.trim() && onUpdateProjects && projects) {
                                  onUpdateProjects([...projects, newProjectInput.trim()]);
                                  setLeadFormData({ ...leadFormData, project: newProjectInput.trim() });
                                  setNewProjectInput('');
                                  setIsAddingProject(false);
                                }
                              }}
                              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold"
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <select
                            value={leadFormData.project}
                            onChange={(e) => setLeadFormData({ ...leadFormData, project: e.target.value })}
                            className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500 shadow-xs"
                          >
                            <option value="">Select Project (Leave Blank)</option>
                            {projects.map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Pipeline Stage */}
                      <div>
                        <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                          Pipeline Stage
                        </label>
                        <select
                          value={leadFormData.stage}
                          onChange={(e) => setLeadFormData({ ...leadFormData, stage: e.target.value as LeadStage })}
                          className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-semibold focus:outline-hidden focus:border-emerald-500"
                        >
                          <option value="new">New Inbound</option>
                          <option value="negotiating">In Discussion</option>
                          <option value="rotations">In Rotations / Follow-up</option>
                          <option value="proposal">Office Visited / Document</option>
                          <option value="won">Closed Won / Visa Process</option>
                          <option value="lost">Closed Lost</option>
                        </select>
                      </div>

                      {/* ASSIGN TO COORDINATOR (CRITICAL TRANSFER SECTION) */}
                      <div className="p-3.5 bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-xl space-y-2">
                        <label className="text-[11px] font-black text-indigo-900 dark:text-indigo-300 uppercase flex items-center gap-1.5">
                          <UserCheck className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                          <span>Assign / Transfer to Coordinator</span>
                        </label>
                        <select
                          value={leadFormData.assignedTo}
                          onChange={(e) => setLeadFormData({ ...leadFormData, assignedTo: e.target.value })}
                          className="w-full px-3 py-2 bg-white dark:bg-slate-900 border-2 border-indigo-300 dark:border-indigo-700 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-black focus:outline-hidden focus:border-indigo-500 shadow-xs cursor-pointer"
                        >
                          <option value="unassigned" className="bg-white dark:bg-slate-900 text-slate-100 dark:text-slate-100 font-sans font-medium text-xs">⚠️ Unassigned (Keep in Requesting)</option>
                          {coordinators.map(c => (
                            <option key={c.id} value={c.displayName || c.username} className="bg-white dark:bg-slate-900 text-slate-100 dark:text-slate-100 font-sans font-medium text-xs">
                              👤 {c.displayName || c.username} ({c.role === 'admin' ? 'Admin' : 'Coordinator'})
                            </option>
                          ))}
                        </select>
                        <p className="text-[10px] text-indigo-700 dark:text-indigo-400 leading-tight">
                          Transferring moves this candidate record and WhatsApp thread directly to the coordinator's personal workspace.
                        </p>
                      </div>

                      {/* AiSensy TAGS SECTION (Reference Image 3 & 4 Parity) */}
                      <div className="p-3.5 bg-slate-800 dark:bg-slate-950 border border-slate-750 dark:border-slate-800 rounded-xl space-y-2.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-black text-slate-100 dark:text-slate-200 uppercase flex items-center gap-1.5">
                            <Tag className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>Tags (AiSensy Hub)</span>
                          </label>
                          <span className="text-[9.5px] font-bold text-slate-500 dark:text-slate-400 font-mono">
                            {leadFormData.tags.length} assigned
                          </span>
                        </div>

                        {/* Active Tag Chips (Pills like in Image 3: [JAPAN ×], [Sales ×], [QATAR ×]) */}
                        {leadFormData.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 p-2 bg-white dark:bg-slate-900 border border-slate-750 dark:border-slate-800 rounded-lg min-h-[36px] items-center">
                            {leadFormData.tags.map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-850 text-slate-100 dark:bg-slate-200 dark:text-slate-950 border border-slate-750 dark:border-transparent shadow-2xs group"
                              >
                                <span>{t}</span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTag(t)}
                                  className="text-slate-400 dark:text-slate-600 hover:text-slate-100 dark:hover:text-black font-black text-xs leading-none cursor-pointer"
                                  title={`Remove tag ${t}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-slate-400 italic">No tags attached to candidate yet.</p>
                        )}

                        {/* Tag Input & Dropdown Selector */}
                        <div className="space-y-1.5">
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={tagInput}
                              onChange={(e) => setTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleAddTag(tagInput);
                                }
                              }}
                              placeholder="Type custom tag or choose..."
                              className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-750 dark:border-slate-700 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-medium focus:outline-hidden focus:border-emerald-500"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddTag(tagInput)}
                              disabled={!tagInput.trim()}
                              className="px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white rounded-lg text-xs font-black uppercase cursor-pointer disabled:opacity-40 transition-all"
                            >
                              + Add
                            </button>
                          </div>

                          {/* Predefined AiSensy Tags Dropdown Selector */}
                          <div className="relative">
                            <select
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleAddTag(e.target.value);
                                  e.target.value = '';
                                }
                              }}
                              defaultValue=""
                              className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-750 dark:border-slate-700 rounded-lg text-xs text-slate-100 dark:text-slate-300 font-medium focus:outline-hidden focus:border-emerald-500 cursor-pointer"
                            >
                              <option value="" disabled className="text-slate-400">Select & add tag...</option>
                              {tagsList
                                .filter(t => !leadFormData.tags.includes(t))
                                .map(t => (
                                  <option key={t} value={t} className="bg-white dark:bg-slate-900 text-slate-100 dark:text-slate-100">{t}</option>
                                ))}
                            </select>
                          </div>

                          {/* Quick Suggestion Pills */}
                          <div className="flex flex-wrap gap-1 pt-1">
                            {['JAPAN', 'QATAR', 'Sales', 'Hospitality', 'EUROPE', 'Kitchen Helper', 'House Keeping', 'Waiter', 'Fresher', 'Gulf Exp']
                              .filter(t => !leadFormData.tags.includes(t))
                              .slice(0, 6)
                              .map(tag => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => handleAddTag(tag)}
                                  className="text-[10px] px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 border border-slate-750 dark:border-slate-700 text-slate-100 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-300 font-bold transition-all cursor-pointer"
                                >
                                  + {tag}
                                </button>
                              ))}
                          </div>
                        </div>
                      </div>

                      {/* Admin Remarks / Notes */}
                      <div>
                        <label className="text-[10px] font-black text-slate-600 dark:text-slate-400 uppercase block mb-1">
                          Intake Remarks / Notes
                        </label>
                        <textarea
                          rows={2}
                          value={leadFormData.adminRemarks}
                          onChange={(e) => setLeadFormData({ ...leadFormData, adminRemarks: e.target.value })}
                          className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-100 dark:text-slate-100 font-medium focus:outline-hidden focus:border-emerald-500 resize-none shadow-xs"
                          placeholder="Candidate WhatsApp query details & qualifications..."
                        />
                      </div>
                    </div>

                    {/* Bottom Action Footer */}
                    <div className="p-3.5 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 space-y-2">
                      <button
                        onClick={() => handleSaveAndTransferLead()}
                        disabled={isSavingLead}
                        className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-emerald-950/20 cursor-pointer transition-all disabled:opacity-50"
                      >
                        {isSavingLead ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            <span>Saving & Transferring...</span>
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" />
                            <span>Save Lead & Transfer</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="h-16 w-16 rounded-3xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-md">
                <MessageSquare className="h-8 w-8" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h3 className="text-base font-black text-slate-100 dark:text-white">
                  No Conversation Selected
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Select a candidate thread from the left list to read messages, qualify their details, and assign the lead to a coordinator.
                </p>
              </div>
            </div>
          )}
        </div>

      {/* Simulator Modal for Testing New Inbound WhatsApp Messages */}
      {showSimulatorModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 text-left">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-500" />
                <h3 className="text-sm font-black text-slate-100 dark:text-white uppercase">
                  Simulate New Inbound Lead
                </h3>
              </div>
              <button
                onClick={() => setShowSimulatorModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400">
              Pick a realistic candidate message scenario to simulate what happens when a stranger clicks a Meta WhatsApp Ad and texts the CGP number. It will immediately appear in <strong>📥 Requesting</strong>.
            </p>

            <div className="space-y-2">
              {[
                {
                  name: 'Suresh Gurung',
                  phone: '+91 98320 44123',
                  trade: 'Nurse',
                  country: 'Germany',
                  message: 'Hello sir, I saw your Facebook ad for Nurse vacancies in Germany. My name is Suresh, age 27, B.Sc Nursing with 3 years hospital ICU experience. What is the process?'
                },
                {
                  name: 'Pooja Thapa',
                  phone: '+91 97331 88219',
                  trade: 'Cook / Commis',
                  country: 'Dubai',
                  message: 'Good morning CGP, I want to apply for Cook in Dubai 5-star hotel. Age 24, female, 2 years restaurant exp. Please send salary and visa processing details.'
                },
                {
                  name: 'Bikash Chettri',
                  phone: '+91 98002 11984',
                  trade: 'Electrician',
                  country: 'Qatar',
                  message: 'Sir I am ITI certified Electrician, 29 years old. Looking for Qatar or Kuwait project job. Can I apply directly from Siliguri office?'
                }
              ].map((sim, i) => (
                <div
                  key={i}
                  onClick={() => handleSimulateInboundMessage(sim)}
                  className="p-3 bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-slate-200 dark:border-slate-700 hover:border-emerald-400 rounded-xl cursor-pointer transition-all space-y-1"
                >
                  <div className="flex items-center justify-between text-xs font-black text-slate-100 dark:text-white">
                    <span>{sim.name} ({sim.phone})</span>
                    <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded font-mono">
                      {sim.country} • {sim.trade}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 italic font-mono line-clamp-2">
                    "{sim.message}"
                  </p>
                </div>
              ))}
            </div>

            <div className="pt-2 text-right">
              <button
                onClick={() => setShowSimulatorModal(false)}
                className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3 py-1.5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start New Chat Modal */}
      {showStartChatModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 text-left">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-sm font-black text-slate-100 dark:text-white uppercase tracking-tight">
                  Start New WhatsApp Chat
                </h3>
              </div>
              <button
                onClick={() => setShowStartChatModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleStartWhatsAppChat} className="space-y-4">
              {startChatError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/80 rounded-xl flex items-start gap-2 text-xs text-red-800 dark:text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                  <div>
                    <strong className="font-bold">Error starting chat:</strong>
                    <p className="mt-0.5 font-mono">{startChatError}</p>
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-600 dark:text-slate-400">
                Enter the candidate's phone number and information. If the candidate already exists, this will load their chat conversation. If they do not exist, a new lead profile will automatically enroll.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Phone Number */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
                    Phone Number * (With country code, e.g. +918967389503)
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. +919876543210"
                    value={startChatPhone}
                    onChange={(e) => setStartChatPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-100 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:border-emerald-500 transition-all font-sans"
                  />
                </div>

                {/* Candidate Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
                    Candidate Name (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Rajesh Kumar"
                    value={startChatName}
                    onChange={(e) => setStartChatName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-100 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:border-emerald-500 transition-all font-sans"
                  />
                </div>

                {/* Candidate Country */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
                    Target Job Country
                  </label>
                  <select
                    value={startChatCountry}
                    onChange={(e) => setStartChatCountry(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-100 dark:text-slate-100 focus:outline-hidden focus:border-emerald-500 transition-all font-sans"
                  >
                    {countries.map((c, idx) => (
                      <option key={idx} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Candidate Position */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
                    Target Job Position
                  </label>
                  <select
                    value={startChatPosition}
                    onChange={(e) => setStartChatPosition(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-100 dark:text-slate-100 focus:outline-hidden focus:border-emerald-500 transition-all font-sans"
                  >
                    {positions.map((p, idx) => (
                      <option key={idx} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Initial Outreach Message */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">
                  Initial Message (Optional - Leave blank to start empty)
                </label>
                <textarea
                  rows={3}
                  placeholder="Type an introductory message to dispatch automatically..."
                  value={startChatInitialMessage}
                  onChange={(e) => setStartChatInitialMessage(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-100 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:border-emerald-500 transition-all font-sans"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 pt-3">
                <button
                  type="button"
                  onClick={() => setShowStartChatModal(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isStartingChat}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800/80 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
                >
                  {isStartingChat ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      <span>Opening Conversation...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3 w-3" />
                      <span>Start Conversation</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
