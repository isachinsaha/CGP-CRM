/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Lead, LeadStage, StatSummary, Coordinator } from './types.ts';
import { 
  LayoutGrid, Table, BarChart3, Briefcase, ShieldAlert, Sparkles, 
  RefreshCw, MessageSquare, Plus, HelpCircle, Layers, Lock, User, Check, X, Shield,
  LogOut, Users, UserCheck, Sun, Moon, PiggyBank, Menu, ChevronRight, Settings, ChevronDown, Download
} from 'lucide-react';
import { motion } from 'motion/react';

// Import child components
import LeadBoard from './components/LeadBoard.tsx';
import LeadList from './components/LeadList.tsx';
import CampaignAnalytics from './components/CampaignAnalytics.tsx';
import ActiveJobs from './components/ActiveJobs.tsx';
import AiProfileMatcher from './components/AiProfileMatcher.tsx';
import LeadModal from './components/LeadModal.tsx';
import LoginScreen from './components/LoginScreen.tsx';
import CoordinatorsManager from './components/CoordinatorsManager.tsx';
import MetadataManager from './components/MetadataManager.tsx';
import IncentiveRulesManager from './components/IncentiveRulesManager.tsx';
import MessagingCenter from './components/MessagingCenter.tsx';
import CGPLogo from './components/CGPLogo.tsx';
import ImportantUpdatesBar from './components/ImportantUpdatesBar.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { BackupManagerModal } from './components/BackupManagerModal.tsx';

// Import local assets

export default function App() {
  const [activeTab, setActiveTab] = useState<'board' | 'list' | 'messages' | 'analytics' | 'jobs' | 'ai-matcher' | 'wallet'>('board');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [stats, setStats] = useState<StatSummary | null>(null);
  
  // Dynamic coordinators list loaded from server
  const [coordinatorsList, setCoordinatorsList] = useState<Coordinator[]>([]);
  const [isCoordManagerOpen, setIsCoordManagerOpen] = useState(false);
  const [isMetadataManagerOpen, setIsMetadataManagerOpen] = useState(false);
  const [isIncentiveRulesOpen, setIsIncentiveRulesOpen] = useState(false);
  const [isBackupManagerOpen, setIsBackupManagerOpen] = useState(false);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement>(null);

  // Authentication & session state
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string; displayName: string; role: 'admin' | 'agent' } | null>(() => {
    const saved = localStorage.getItem('cgp_crm_session');
    return saved ? JSON.parse(saved) : null;
  });

  const userRole = currentUser?.role || 'agent';
  const currentAgentId = currentUser?.username || 'unassigned';

  // Server-side pagination & filter states
  const [totalLeadsCount, setTotalLeadsCount] = useState(0);
  const [totalPagesCount, setTotalPagesCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [metaCountries, setMetaCountries] = useState<string[]>([]);
  const [metaProjects, setMetaProjects] = useState<string[]>([]);
  const [metaPositions, setMetaPositions] = useState<string[]>([]);
  const [metaTags, setMetaTags] = useState<string[]>([]);
  const [filters, setFilters] = useState<any>({
    search: '',
    country: 'All',
    coordinator: 'All',
    fitScore: 'All',
    tag: 'All',
    project: 'All',
    position: 'All',
    dateFilter: 'All',
    customStartDate: '',
    customEndDate: '',
    bucket: 'all',
    gender: 'All',
    remarksFilter: 'All'
  });

  // Environment metadata
  const [apiMode, setApiMode] = useState<'live' | 'simulation'>('simulation');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('cgp_crm_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('cgp_crm_theme', theme);
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
  }, [theme]);

  // Auto welcome greeting when user logs in or restores session
  useEffect(() => {
    if (currentUser) {
      const hr = new Date().getHours();
      let timeGreeting = 'Good evening';
      if (hr >= 5 && hr < 12) timeGreeting = 'Good morning';
      else if (hr >= 12 && hr < 17) timeGreeting = 'Good afternoon';
      
      setToastMessage(`${timeGreeting}, ${currentUser.displayName}!`);
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [currentUser?.username]);

  // Listen for Escape and Click Outside to close open dropdowns/modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedLead(null);
        setIsCreateModalOpen(false);
        setIsCoordManagerOpen(false);
        setIsMetadataManagerOpen(false);
        setIsIncentiveRulesOpen(false);
        setIsAdminMenuOpen(false);
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target as Node)) {
        setIsAdminMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Dynamic countries and positions list states
  const [countries, setCountries] = useState<string[]>(() => {
    const saved = localStorage.getItem('crm_countries');
    return saved ? JSON.parse(saved) : ['Kuwait', 'Dubai', 'Qatar', 'Germany', 'Japan', 'Albania'];
  });
  const [positions, setPositions] = useState<string[]>(() => {
    const saved = localStorage.getItem('crm_positions');
    return saved ? JSON.parse(saved) : ['Waiter', 'Waitress', 'Chef', 'Nurse', 'Cleaner', 'Driver', 'Electrician'];
  });
  const [projects, setProjects] = useState<string[]>(() => {
    const saved = localStorage.getItem('crm_projects');
    return saved ? JSON.parse(saved) : ['Napkin affairs', 'Alltoobi', 'Lulu hypermarket', 'General Intake'];
  });
  const [tagsList, setTagsList] = useState<string[]>(() => {
    const saved = localStorage.getItem('crm_tags');
    return saved ? JSON.parse(saved) : [
      'Chef', 'Nurse', 'Waiter', 'Waitress', 'Driver', 'Accountant', 
      'Manager', 'Sales', 'Developer', 'Electrician', 'Plumber', 
      'Receptionist', 'Housekeeper', 'Security', 'Painter', 'Mechanic', 'Operator'
    ];
  });

  useEffect(() => {
    localStorage.setItem('crm_countries', JSON.stringify(countries));
  }, [countries]);

  useEffect(() => {
    localStorage.setItem('crm_positions', JSON.stringify(positions));
  }, [positions]);

  useEffect(() => {
    localStorage.setItem('crm_projects', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('crm_tags', JSON.stringify(tagsList));
  }, [tagsList]);

  const updateMetadataOnServer = async (updated: { countries?: string[]; positions?: string[]; projects?: string[]; tagsList?: string[] }) => {
    if (userRole !== 'admin') return;
    const body = {
      countries: updated.countries || countries,
      positions: updated.positions || positions,
      projects: updated.projects || projects,
      tagsList: updated.tagsList || tagsList
    };
    try {
      await fetch('/api/metadata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      console.error('Error syncing CRM metadata to server:', err);
    }
  };

  const handleUpdateCountries = (newCountries: string[]) => {
    setCountries(newCountries);
    updateMetadataOnServer({ countries: newCountries });
  };

  const handleUpdatePositions = (newPositions: string[]) => {
    setPositions(newPositions);
    updateMetadataOnServer({ positions: newPositions });
  };

  const handleUpdateProjects = (newProjects: string[]) => {
    setProjects(newProjects);
    updateMetadataOnServer({ projects: newProjects });
  };

  const handleUpdateTagsList = (newTags: string[]) => {
    setTagsList(newTags);
    updateMetadataOnServer({ tagsList: newTags });
  };

  // Manual Enrolling Dialog State for Admin power
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createFields, setCreateFields] = useState({
    name: '',
    phone: '',
    alternateNo: '',
    gender: 'Not defined',
    age: '',
    origin: '',
    country: '',
    position: 'Waiter',
    experience: '',
    qualification: '',
    assignedTo: '',
    importance: '3',
    source: 'Ads',
    project: 'Napkin affairs',
    adminRemarks: ''
  });
  const [creatingProgress, setCreatingProgress] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // States for safe, iframe-compatible custom country and position insertion
  const [isAddingCountry, setIsAddingCountry] = useState(false);
  const [newCountryName, setNewCountryName] = useState('');
  const [isAddingPosition, setIsAddingPosition] = useState(false);
  const [newPositionName, setNewPositionName] = useState('');
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // Tags configuration while enrolling
  const [enrollTags, setEnrollTags] = useState<string[]>([]);
  const [newEnrollTagInput, setNewEnrollTagInput] = useState('');

  // Handle filters update safely without recreating object references
  const handleFiltersChange = useCallback((newFilters: any) => {
    setFilters((prev: any) => {
      const prevKeys = Object.keys(prev);
      const newKeys = Object.keys(newFilters);
      if (prevKeys.length !== newKeys.length) return newFilters;
      for (const k of newKeys) {
        if (prev[k] !== newFilters[k]) return newFilters;
      }
      return prev;
    });
  }, []);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  // Initial one-time app bootstrap for static rosters, health, and custom tags
  const fetchAppMetadata = useCallback(async () => {
    try {
      const [coordsRes, healthRes, metaRes] = await Promise.all([
        fetch('/api/coordinators').catch(() => null),
        fetch('/api/health').catch(() => null),
        fetch('/api/metadata').catch(() => null)
      ]);

      if (coordsRes && coordsRes.ok) {
        const coordsData = await coordsRes.json();
        setCoordinatorsList(coordsData);
      }
      if (healthRes && healthRes.ok) {
        const healthData = await healthRes.json();
        setApiMode(healthData.aiMode);
      }
      if (metaRes && metaRes.ok) {
        const metaData = await metaRes.json();
        if (metaData.countries) setCountries(metaData.countries);
        if (metaData.positions) setPositions(metaData.positions);
        if (metaData.projects) setProjects(metaData.projects);
        if (metaData.tagsList) setTagsList(metaData.tagsList);
      }
    } catch (err) {
      console.warn('Failed to load static app metadata:', err);
    }
  }, []);

  useEffect(() => {
    fetchAppMetadata();
  }, [fetchAppMetadata]);

  // Synchronize data from Express REST API
  const pullCrmData = async (silent = false, forceRefresh = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      // 1. Fetch active job leads list with server-side queries & pagination parameters
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: '100', // Load 100 items at a time as requested!
        search: filters.search || '',
        country: filters.country || 'All',
        coordinator: filters.coordinator || 'All',
        fitScore: filters.fitScore || 'All',
        tag: filters.tag || 'All',
        project: filters.project || 'All',
        position: filters.position || 'All',
        dateFilter: filters.dateFilter || 'All',
        customStartDate: filters.customStartDate || '',
        customEndDate: filters.customEndDate || '',
        bucket: userRole === 'agent' ? 'my' : (filters.bucket || 'all'),
        agentId: currentAgentId,
        userRole: userRole,
        all: activeTab !== 'list' ? 'true' : 'false',
        gender: filters.gender || 'All',
        remarksFilter: filters.remarksFilter || 'All'
      });

      if (forceRefresh) {
        params.append('forceRefresh', 'true');
      }

      const [leadsRes, statsRes] = await Promise.all([
        fetch(`/api/leads?${params.toString()}`),
        fetch('/api/stats').catch(() => null)
      ]);

      if (leadsRes.ok) {
        const leadsData = await leadsRes.json();
        const leadsArray = Array.isArray(leadsData) ? leadsData : (leadsData.leads || []);
        setLeads(leadsArray);
        
        if (!Array.isArray(leadsData)) {
          setTotalLeadsCount(leadsData.totalCount || 0);
          setTotalPagesCount(leadsData.totalPages || 1);
          if (leadsData.meta) {
            if (leadsData.meta.countries) setMetaCountries(leadsData.meta.countries);
            if (leadsData.meta.projects) setMetaProjects(leadsData.meta.projects);
            if (leadsData.meta.positions) setMetaPositions(leadsData.meta.positions);
            if (leadsData.meta.tags) setMetaTags(leadsData.meta.tags);
          }
        } else {
          setTotalLeadsCount(leadsData.length);
          setTotalPagesCount(1);
        }
        
        // Match active modal with fresh server changes
        if (selectedLead) {
          const updated = leadsArray.find((l: Lead) => l.id === selectedLead.id);
          if (updated) setSelectedLead(updated);
        }
      }

      // 2. Fetch aggregate stats
      if (statsRes && statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (err) {
      console.error('Failed to sync placement entries from Express REST routes:', err);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    pullCrmData();
  }, [currentPage, filterKey, activeTab]);

  // Set up background polling to fetch new WhatsApp replies or lead modifications every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      // Pass silent = true, forceRefresh = true to bypass memory cache on the server
      pullCrmData(true, true);
    }, 5000);

    return () => clearInterval(timer);
  }, [currentPage, filterKey, activeTab]);

  // Update lead stage pipeline state
  const handleUpdateStage = async (id: string, stage: LeadStage) => {
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage })
      });
      if (res.ok) {
        pullCrmData(true); // silent sync
      }
    } catch (err) {
      console.error('Failed to modify stage metadata', err);
    }
  };

  // Remove a lead from records
  const handleDeleteLead = async (id: string) => {
    if (userRole !== 'admin') {
      alert('Security Alert: Sub-agents do not have privileges to remove database records.');
      return;
    }
    if (!window.confirm('Are you absolutely sure you want to permanently remove this candidate from the placement database? This will clear all call remarks.')) return;
    try {
      const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedLead && selectedLead.id === id) setSelectedLead(null);
        pullCrmData(true);
      }
    } catch (err) {
      console.error('Failed to remove placement lead', err);
    }
  };

  // Submit manual candidate enroll
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createFields.phone) {
      alert('Please fill out Mobile number field.');
      return;
    }
    setCreatingProgress(true);
    setSuccessMsg('');

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify({
          ...createFields,
          age: createFields.age !== '' ? (Number(createFields.age) || '') : '',
          importance: Number(createFields.importance) || 3,
          tags: enrollTags
        })
      });
      if (res.ok) {
        setSuccessMsg('Candidate registered in directory successfully!');
        setCreateFields({
          name: '',
          phone: '',
          alternateNo: '',
          gender: 'Not defined',
          age: '',
          origin: '',
          country: '',
          position: 'Waiter',
          experience: '',
          qualification: '',
          assignedTo: '',
          importance: '3',
          source: 'Ads',
          project: 'Napkin affairs',
          adminRemarks: ''
        });
        setEnrollTags([]);
        pullCrmData(true);
        setTimeout(() => {
          setIsCreateModalOpen(false);
          setSuccessMsg('');
        }, 1500);
      } else {
        const errData = await res.json();
        alert(errData.error || 'Failed to create record.');
      }
    } catch (err) {
      console.error(err);
      alert('Error connecting with backend server.');
    } finally {
      setCreatingProgress(false);
    }
  };

  if (!currentUser) {
    return <LoginScreen onLoginSuccess={(user) => setCurrentUser(user)} />;
  }

  return (
    <div className="h-screen w-full flex flex-col bg-slate-100 dark:bg-slate-950 font-sans text-slate-900 dark:text-slate-100 antialiased overflow-hidden selection:bg-indigo-600 selection:text-white" id="cgp-root-viewport">
      
      {/* Dynamic Slide-in Success Welcome Toast */}
      {toastMessage && (
        <motion.div
          initial={{ opacity: 0, y: -20, x: 20 }}
          animate={{ opacity: 1, y: 0, x: 0 }}
          className="fixed top-4 right-4 z-50 bg-slate-900 border border-slate-800 text-slate-100 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3.5 min-w-[300px] max-w-sm select-none"
        >
          <div className="h-10 w-10 rounded-xl bg-slate-800 flex items-center justify-center text-accent-purple border border-slate-750 shrink-0">
            <UserCheck className="h-5 w-5" />
          </div>
          <div className="text-left">
            <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Access Granted</h4>
            <p className="text-sm font-black text-slate-100 mt-0.5">{toastMessage}</p>
          </div>
          <button 
            onClick={() => setToastMessage(null)} 
            className="ml-auto p-1 text-slate-500 hover:text-slate-300 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </motion.div>
      )}

      {/* TOP HEADER & NAVIGATION BAR */}
      {(() => {
        const activeChatCount = leads.filter(l => {
          const msgs = (l.messages || []).filter(m => m && m.text && !m.text.includes('Lead enrolled manually in CGP system database'));
          return msgs.length > 0;
        }).length;

        const requestingCount = leads.filter(l => {
          const msgs = (l.messages || []).filter(m => m && m.text && !m.text.includes('Lead enrolled manually in CGP system database'));
          const isUnassigned = !l.assignedTo || l.assignedTo.toLowerCase() === 'unassigned' || l.assignedTo.toLowerCase() === 'all' || l.assignedTo.trim() === '';
          return msgs.length > 0 && isUnassigned;
        }).length;

        const navItems = [
          { id: 'board', label: 'Pipeline', icon: LayoutGrid },
          { id: 'messages', label: 'WhatsApp Chats', icon: MessageSquare, badge: activeChatCount, requestingBadge: requestingCount },
          { id: 'list', label: 'Spreadsheet', icon: Table },
          { id: 'analytics', label: 'Reports', icon: BarChart3 },
          { id: 'ai-matcher', label: 'AI Matcher', icon: Sparkles },
          { id: 'jobs', label: 'Active Jobs', icon: Briefcase },
          { id: 'wallet', label: 'Incentive Wallet', icon: PiggyBank },
        ];

        return (
          <div className="shrink-0 z-30 flex flex-col bg-white dark:bg-slate-900 shadow-xs">
            {/* ROW 1: PRIMARY TOP HEADER BAR */}
            <header className="px-3 sm:px-5 py-2.5 flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              
              {/* Left Brand Identity */}
              <div 
                className="flex items-center gap-2.5 cursor-pointer select-none shrink-0" 
                onClick={() => setActiveTab('board')}
                title="Career Growth Placement CRM"
              >
                <div className="h-9 w-9 bg-slate-900 dark:bg-white rounded-xl flex items-center justify-center p-1 shadow-xs shrink-0">
                  <CGPLogo size={32} rounded="rounded-lg" />
                </div>
                <div className="text-left min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h1 className="font-black text-slate-900 dark:text-slate-100 text-sm tracking-wider uppercase font-display leading-tight truncate">
                      CAREER GROWTH
                    </h1>
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" title="System Operational" />
                  </div>
                  <p className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-mono font-extrabold uppercase tracking-wider">
                    Abroad Recruiting CRM
                  </p>
                </div>
              </div>

              {/* Right Profile Actions & Utilities */}
              <div className="flex items-center gap-2 shrink-0">
                {/* AI Inbound Parser button */}
                <button
                  onClick={() => setApiMode(prev => prev === 'live' ? 'simulation' : 'live')}
                  className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs"
                  title="Toggle Live Parser / Simulation"
                >
                  <span className="text-sm">🤖</span>
                  <span className="uppercase text-[10px] font-mono tracking-wider font-extrabold hidden md:inline">
                    AI PARSER
                  </span>
                </button>

                {/* Admin Master Controls Dropdown */}
                {userRole === 'admin' && (
                  <div className="relative" ref={adminMenuRef}>
                    <button
                      onClick={() => setIsAdminMenuOpen(prev => !prev)}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                      <Settings className="h-3.5 w-3.5 text-indigo-500" />
                      <span className="hidden sm:inline">Admin Controls</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${isAdminMenuOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isAdminMenuOpen && (
                      <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-slate-850 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-750 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150 text-left">
                        <div className="px-3.5 py-1 text-[10px] font-mono font-bold uppercase text-slate-400">Master Controls</div>
                        <button
                          onClick={() => { setIsCoordManagerOpen(true); setIsAdminMenuOpen(false); }}
                          className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition text-left cursor-pointer"
                        >
                          <Users className="h-4 w-4 text-indigo-500 shrink-0" />
                          <span>Manage Staff Desk</span>
                        </button>
                        <button
                          onClick={() => { setIsMetadataManagerOpen(true); setIsAdminMenuOpen(false); }}
                          className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition text-left cursor-pointer"
                        >
                          <Layers className="h-4 w-4 text-indigo-500 shrink-0" />
                          <span>Manage Options & Tags</span>
                        </button>
                        <button
                          onClick={() => { setIsIncentiveRulesOpen(true); setIsAdminMenuOpen(false); }}
                          className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition text-left cursor-pointer"
                        >
                          <PiggyBank className="h-4 w-4 text-emerald-500 shrink-0" />
                          <span>Incentive Rules</span>
                        </button>
                        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                        <button
                          onClick={() => {
                            setIsBackupManagerOpen(true);
                            setIsAdminMenuOpen(false);
                          }}
                          className="w-full px-3.5 py-2 text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-950/40 flex items-center gap-2.5 transition text-left cursor-pointer"
                          title="Open Automated Database & XLSX Backup Center with scheduled Monday archives & full database restore"
                        >
                          <Download className="h-4 w-4 text-cyan-500 shrink-0 animate-bounce" />
                          <span>📦 Backup & Restore Center</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 1-Click Whole CRM Database Backup Center Button */}
                <button
                  onClick={() => setIsBackupManagerOpen(true)}
                  className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-cyan-50 hover:bg-cyan-100 dark:bg-cyan-950/30 dark:hover:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60 transition cursor-pointer shadow-3xs"
                  title="Automated Monday DB & XLSX Backups & 1-Click Restore Center"
                >
                  <Download className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
                  <span className="font-extrabold whitespace-nowrap">Backup & Restore</span>
                </button>

                {/* Theme Toggle */}
                <button
                  onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
                  className="p-1.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                  title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
                >
                  {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </button>

                {/* Refresh Cloud Data */}
                <button
                  onClick={() => pullCrmData()}
                  disabled={isRefreshing}
                  className="p-1.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                  title="Pull Cloud Data"
                >
                  <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>

                {/* User Profile Pill & Sign out */}
                <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-indigo-600 text-white font-black text-xs flex items-center justify-center uppercase shadow-2xs shrink-0">
                      {currentUser?.displayName?.charAt(0).toUpperCase() || 'M'}
                    </div>
                    <div className="text-left hidden xl:block">
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate leading-tight max-w-[120px]">
                        {currentUser?.displayName}
                      </p>
                      <p className="text-[9px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider font-mono">
                        {userRole === 'admin' ? '👑 MASTER ADMIN' : 'COORDINATOR'}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      localStorage.removeItem('cgp_crm_session');
                      setCurrentUser(null);
                    }}
                    className="p-1.5 rounded-xl text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-950/40 transition cursor-pointer"
                    title="Sign Out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </header>

            {/* ROW 2: SEPARATE DEDICATED NAVIGATION MENU BAR WITH BREATHING SPACE AND INCREASED HEIGHT */}
            <div className="px-3 sm:px-5 pt-2 pb-2.5 bg-slate-100/60 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800">
              <nav className="bg-slate-950 text-white rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-3 overflow-x-auto no-scrollbar shadow-md border border-slate-800/80">
                
                {/* Left Navigation Buttons */}
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {navItems.map((tab) => {
                    const Icon = tab.icon;
                    const isSelected = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`group px-3 sm:px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shrink-0 ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-sm font-black'
                            : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                        }`}
                      >
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
                        <span className="whitespace-nowrap">{tab.label}</span>
                        {tab.requestingBadge !== undefined && tab.requestingBadge > 0 && (
                          <span className={`text-[9.5px] font-mono font-black px-1.5 py-0.2 rounded-full ${
                            isSelected ? 'bg-amber-400 text-slate-950' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                          }`} title={`${tab.requestingBadge} requesting chats`}>
                            {tab.requestingBadge}
                          </span>
                        )}
                        {tab.badge !== undefined && tab.badge > 0 && (
                          <span className={`text-[9.5px] font-mono font-black px-1.5 py-0.2 rounded-full ${
                            isSelected ? 'bg-white text-indigo-700' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          }`}>
                            {tab.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Right Status & Enrol Candidate CTA Button (Only for Admin) */}
                <div className="flex items-center gap-3 shrink-0 ml-auto pl-3 border-l border-slate-800">
                  {/* Synced Info */}
                  <div className="text-xs font-mono text-emerald-400 font-semibold hidden sm:flex items-center gap-1.5 whitespace-nowrap">
                    <span>Synced: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                    <span>•</span>
                    <strong className="text-emerald-300 font-black">{totalLeadsCount || leads.length} candidates</strong>
                  </div>

                  {/* Enrol Candidate CTA Button - ONLY VISIBLE FOR ADMIN */}
                  {userRole === 'admin' && (
                    <button
                      onClick={() => setIsCreateModalOpen(true)}
                      className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-black py-2 px-3.5 rounded-xl shadow-xs flex items-center gap-1.5 uppercase cursor-pointer transition-all tracking-wider whitespace-nowrap"
                    >
                      <Plus className="h-4 w-4 stroke-[3]" />
                      <span>ENROL CANDIDATE</span>
                    </button>
                  )}
                </div>
              </nav>
            </div>
          </div>
        );
      })()}

      {/* MAIN WORKSPACE VIEWPORT */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6 space-y-4 flex flex-col min-h-0">
        {/* Dynamic Display Stage Router */}
        <div className="flex-1 flex flex-col min-h-0">
          <ErrorBoundary fallbackTitle="Could Not Display Selected View">
            {activeTab === 'board' && (
              <div key="board-tab" className="flex-1 flex flex-col min-h-0 space-y-4">
                {/* Important Live Broadcast Updates Ticker - ONLY on Pipeline Screen */}
                <ErrorBoundary fallbackTitle="Updates Ticker Unavailable">
                  <ImportantUpdatesBar />
                </ErrorBoundary>
                
                <LeadBoard
                  leads={leads}
                  onSelectLead={setSelectedLead}
                  onUpdateStage={handleUpdateStage}
                  userRole={userRole}
                  currentAgentId={currentAgentId}
                  coordinators={coordinatorsList}
                />
              </div>
            )}

            {activeTab === 'list' && (
              <div key="list-tab" className="flex-1 flex flex-col min-h-0">
                <LeadList
                  leads={leads}
                  onSelectLead={setSelectedLead}
                  onUpdateStage={handleUpdateStage}
                  onDeleteLead={handleDeleteLead}
                  userRole={userRole}
                  currentAgentId={currentAgentId}
                  onRefreshData={() => pullCrmData(true)}
                  coordinators={coordinatorsList}
                  totalLeadsCount={totalLeadsCount}
                  totalPagesCount={totalPagesCount}
                  currentPageOverride={currentPage}
                  onPageChange={setCurrentPage}
                  onFiltersChange={handleFiltersChange}
                  metaCountries={metaCountries}
                  metaProjects={metaProjects}
                  metaPositions={metaPositions}
                  metaTags={metaTags}
                />
              </div>
            )}

            {activeTab === 'messages' && (
              <div key="messages-tab" className="flex-1 flex flex-col min-h-0">
                <MessagingCenter
                  leads={leads}
                  onSelectLead={setSelectedLead}
                  userRole={userRole}
                  currentAgentId={currentAgentId}
                  coordinators={coordinatorsList}
                  countries={countries}
                  positions={positions}
                  projects={projects}
                  onRefreshData={() => pullCrmData(true)}
                  onLeadUpdated={async () => { await pullCrmData(true); }}
                />
              </div>
            )}

            {activeTab === 'analytics' && (
              <div key="analytics-tab" className="flex-1 flex flex-col min-h-0">
                {stats ? (
                  <CampaignAnalytics 
                    stats={stats} 
                    leads={leads} 
                    onRefreshData={() => pullCrmData(true)} 
                    userRole={userRole}
                    currentAgentId={currentAgentId}
                    onSelectLead={setSelectedLead}
                    coordinators={coordinatorsList}
                  />
                ) : (
                  <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center gap-3">
                    <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Loading consultancy analytics...</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'jobs' && (
              <div key="jobs-tab" className="flex-1 flex flex-col min-h-0">
                <ActiveJobs
                  currentUser={currentUser}
                  countries={countries}
                  view="jobs"
                />
              </div>
            )}

            {activeTab === 'wallet' && (
              <div key="wallet-tab" className="flex-1 flex flex-col min-h-0">
                <ActiveJobs
                  currentUser={currentUser}
                  countries={countries}
                  view="wallet"
                />
              </div>
            )}

            {activeTab === 'ai-matcher' && (
              <div key="ai-matcher-tab" className="flex-1 flex flex-col min-h-0">
                <AiProfileMatcher
                  onSelectLead={setSelectedLead}
                  onUpdateLead={async () => { await pullCrmData(true); }}
                  userRole={userRole}
                />
              </div>
            )}
          </ErrorBoundary>
        </div>
      </main>

      {/* 2. MANUALLY ENROLL CANDIDATE MODAL DIALOG (Admin Power option) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-left">
          <div className="bg-slate-850 rounded-3xl shadow-2xl border border-slate-750 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-100">
            
            {/* Header */}
            <div className="bg-slate-900 px-5.5 py-4 border-b border-slate-800 flex justify-between items-center">
              <div>
                <h3 className="font-extrabold text-slate-100 text-base">Enroll New Job Candidate</h3>
                <p className="text-[10px] text-slate-400 font-mono mt-0.5">MANUAL SPREADSHEET INSERTION DIRECTORY</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 px-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-100 rounded-lg cursor-pointer transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* From body */}
            <form onSubmit={handleCreateLead} className="p-5.5 space-y-3">
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Candidate Name</label>
                  <input
                    type="text"
                    placeholder="e.g. DEWAS BHUJEL"
                    value={createFields.name}
                    onChange={(e) => setCreateFields({...createFields, name: e.target.value})}
                    className="w-full text-xs px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none uppercase font-bold placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Mobile No *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. +91 98765"
                    value={createFields.phone}
                    onChange={(e) => setCreateFields({...createFields, phone: e.target.value})}
                    className="w-full text-xs px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Alternative No</label>
                  <input
                    type="text"
                    placeholder="e.g. +91 98765"
                    value={createFields.alternateNo}
                    onChange={(e) => setCreateFields({...createFields, alternateNo: e.target.value})}
                    className="w-full text-xs px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono placeholder-slate-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Gender</label>
                  <select
                    value={createFields.gender}
                    onChange={(e) => setCreateFields({...createFields, gender: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-bold"
                  >
                    <option value="M">Male (M)</option>
                    <option value="F">Female (F)</option>
                    <option value="Not defined">Not defined</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Age</label>
                  <input
                    type="number"
                    value={createFields.age}
                    onChange={(e) => setCreateFields({...createFields, age: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Origin / State</label>
                  <input
                    type="text"
                    placeholder="e.g. Darjeeling"
                    value={createFields.origin}
                    onChange={(e) => setCreateFields({...createFields, origin: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold placeholder-slate-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Apply Destination Country Selection */}
                <div>
                  <div className="flex justify-between items-center mb-0.5">
                    <label className="block text-[11px] font-bold text-slate-400">Apply Destination Country</label>
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        onClick={() => setIsAddingCountry(!isAddingCountry)}
                        className="text-[10px] font-extrabold text-emerald-600 hover:text-emerald-400 cursor-pointer"
                      >
                        {isAddingCountry ? 'Cancel' : '+ Add Country'}
                      </button>
                    )}
                  </div>
                  {isAddingCountry ? (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newCountryName}
                        onChange={(e) => setNewCountryName(e.target.value)}
                        placeholder="Country..."
                        className="flex-1 text-xs px-2 py-1 rounded border border-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-950 text-slate-100 font-bold placeholder-slate-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newCountryName.trim()) {
                            const trimmed = newCountryName.trim();
                            if (!countries.includes(trimmed)) {
                              handleUpdateCountries([...countries, trimmed]);
                            }
                            setCreateFields(prev => ({ ...prev, country: trimmed }));
                            setNewCountryName('');
                            setIsAddingCountry(false);
                          }
                        }}
                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shrink-0 cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <select
                      value={createFields.country}
                      onChange={(e) => setCreateFields({...createFields, country: e.target.value})}
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 font-bold text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    >
                      <option value="">-- Select Country --</option>
                      {countries.map((c, idx) => (
                        <option key={idx} value={c} className="bg-slate-900 text-slate-100">{c}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Target Job Position Selection */}
                <div>
                  <div className="flex justify-between items-center mb-0.5">
                    <label className="block text-[11px] font-bold text-slate-400">Target Job Position</label>
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        onClick={() => setIsAddingPosition(!isAddingPosition)}
                        className="text-[10px] font-extrabold text-emerald-600 hover:text-emerald-400 cursor-pointer"
                      >
                        {isAddingPosition ? 'Cancel' : '+ Add Position'}
                      </button>
                    )}
                  </div>
                  {isAddingPosition ? (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newPositionName}
                        onChange={(e) => setNewPositionName(e.target.value)}
                        placeholder="Position..."
                        className="flex-1 text-xs px-2 py-1 rounded border border-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-950 text-slate-100 font-bold placeholder-slate-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newPositionName.trim()) {
                            const trimmed = newPositionName.trim();
                            if (!positions.includes(trimmed)) {
                              handleUpdatePositions([...positions, trimmed]);
                            }
                            setCreateFields(prev => ({ ...prev, position: trimmed }));
                            setNewPositionName('');
                            setIsAddingPosition(false);
                          }
                        }}
                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shrink-0 cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <select
                      value={createFields.position}
                      onChange={(e) => setCreateFields({...createFields, position: e.target.value})}
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 font-bold text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    >
                      <option value="">-- Select Position --</option>
                      {positions.map((p, idx) => (
                        <option key={idx} value={p} className="bg-slate-900 text-slate-100">{p}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Previous Experience</label>
                  <input
                    type="text"
                    placeholder="e.g. 5 yrs Gulf Exp"
                    value={createFields.experience}
                    onChange={(e) => setCreateFields({...createFields, experience: e.target.value})}
                    className="w-full text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Qualification</label>
                  <input
                    type="text"
                    placeholder="e.g. 10th, 12th, Graduate, ITI"
                    value={createFields.qualification}
                    onChange={(e) => setCreateFields({...createFields, qualification: e.target.value})}
                    className="w-full text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Star Importance</label>
                  <select
                    value={createFields.importance}
                    onChange={(e) => setCreateFields({...createFields, importance: e.target.value})}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-slate-800 bg-slate-950 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold"
                  >
                    <option value="1">⭐ Star Low (1)</option>
                    <option value="2">⭐⭐ Star Fair (2)</option>
                    <option value="3">⭐⭐⭐ Star Normal (3)</option>
                    <option value="4">⭐⭐⭐⭐ Star High (4)</option>
                    <option value="5">⭐⭐⭐⭐⭐ Star Urgent (5)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Lead Source selection */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Lead Source</label>
                  <select
                    value={createFields.source}
                    onChange={(e) => setCreateFields({...createFields, source: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 font-semibold text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="Ads">Ads 📣</option>
                    <option value="Organic">Organic 🌱</option>
                    <option value="Website">Website 🌐</option>
                    <option value="Instagram">Instagram 📸</option>
                    <option value="Referral">Referral 🤝</option>
                    <option value="Other">Other / Unknown</option>
                  </select>
                </div>

                {/* Hiring Project selection with Add New toggle */}
                <div>
                  <div className="flex justify-between items-center mb-0.5">
                    <label className="block text-[11px] font-bold text-slate-400">Hiring Project</label>
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        onClick={() => setIsAddingProject(!isAddingProject)}
                        className="text-[10px] font-extrabold text-emerald-600 hover:text-emerald-400 cursor-pointer"
                      >
                        {isAddingProject ? 'Cancel' : '+ Add Project'}
                      </button>
                    )}
                  </div>
                  {isAddingProject ? (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        placeholder="Project name..."
                        className="flex-1 text-xs px-2 py-1 rounded border border-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-950 text-slate-100 font-bold placeholder-slate-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (newProjectName.trim()) {
                            const trimmed = newProjectName.trim();
                            if (!projects.includes(trimmed)) {
                              handleUpdateProjects([...projects, trimmed]);
                            }
                            setCreateFields(prev => ({ ...prev, project: trimmed }));
                            setNewProjectName('');
                            setIsAddingProject(false);
                          }
                        }}
                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shrink-0 cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <select
                      value={createFields.project}
                      onChange={(e) => setCreateFields({...createFields, project: e.target.value})}
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 font-semibold text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    >
                      <option value="">-- Select Project --</option>
                      {projects.map((p, idx) => (
                        <option key={idx} value={p} className="bg-slate-900 text-slate-100">{p}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Dynamic Tag Builder during Enrollment */}
              <div className="border-t border-slate-800/80 pt-3">
                <label className="block text-[11px] font-bold text-slate-400 mb-1">
                  Assign Candidate Tags while Enrolling
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Type tag (e.g. Passport Ready, ECG, GNM) and click Add"
                    value={newEnrollTagInput}
                    onChange={(e) => setNewEnrollTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (newEnrollTagInput.trim()) {
                          const tag = newEnrollTagInput.trim();
                          if (!enrollTags.includes(tag)) {
                            setEnrollTags([...enrollTags, tag]);
                          }
                          setNewEnrollTagInput('');
                        }
                      }
                    }}
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-950 text-slate-100 placeholder-slate-500 font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newEnrollTagInput.trim()) {
                        const tag = newEnrollTagInput.trim();
                        if (!enrollTags.includes(tag)) {
                          setEnrollTags([...enrollTags, tag]);
                        }
                        setNewEnrollTagInput('');
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    + Add Tag
                  </button>
                </div>

                {/* Intelligent Clickable Tag Suggestions */}
                <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-slate-500 font-extrabold uppercase mr-1">Suggestions:</span>
                  {(newEnrollTagInput.trim() === '' 
                    ? tagsList.slice(0, 8)
                    : tagsList.filter(t => t.toLowerCase().includes(newEnrollTagInput.toLowerCase()))
                  )
                    .filter(t => !enrollTags.includes(t))
                    .slice(0, 8)
                    .map((tag, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          if (!enrollTags.includes(tag)) {
                            setEnrollTags([...enrollTags, tag]);
                          }
                          setNewEnrollTagInput('');
                        }}
                        className="text-[10px] bg-slate-900 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 font-extrabold px-2 py-0.5 rounded border border-slate-800 hover:border-emerald-900 transition-all cursor-pointer"
                      >
                        {tag}
                      </button>
                    ))}
                  {newEnrollTagInput.trim() !== '' && tagsList.filter(t => t.toLowerCase().includes(newEnrollTagInput.toLowerCase())).filter(t => !enrollTags.includes(t)).length === 0 && (
                    <span className="text-[10px] text-slate-500 italic">No matching tags. Press Enter or click Add to create.</span>
                  )}
                </div>

                {enrollTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 p-2 bg-slate-900 border border-slate-800 rounded-lg">
                    {enrollTags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 bg-slate-800 text-slate-200 text-[10px] font-black px-2 py-0.5 rounded-md border border-slate-700"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => setEnrollTags(enrollTags.filter(t => t !== tag))}
                          className="text-slate-400 hover:text-slate-200 font-extrabold cursor-pointer ml-1"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-1">
                <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Admin Remarks / Initial Notes</label>
                <textarea
                  placeholder="e.g. Passport Ready, ECG, GNM, urgent placement requirements, etc."
                  value={createFields.adminRemarks}
                  onChange={(e) => setCreateFields({...createFields, adminRemarks: e.target.value})}
                  rows={2}
                  className="w-full text-xs px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none placeholder-slate-500 resize-none font-sans"
                />
              </div>

              <div className="mt-1">
                <label className="block text-[11px] font-bold text-accent-emerald mb-0.5">Assign Telecaller Coordinator Directly</label>
                <select
                  value={createFields.assignedTo}
                  onChange={(e) => setCreateFields({...createFields, assignedTo: e.target.value})}
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-accent-emerald bg-slate-950 text-accent-emerald font-extrabold focus:outline-none focus:ring-1 focus:ring-accent-emerald"
                >
                  <option value="" className="bg-slate-900 text-slate-300">-- Leave Unassigned --</option>
                  {coordinatorsList && coordinatorsList.length > 0 ? (
                    coordinatorsList.filter(c => c.role === 'agent').map(coord => (
                      <option key={coord.id} value={coord.username} className="bg-slate-900 text-slate-100">{coord.displayName} (Telecaller)</option>
                    ))
                  ) : (
                    ['Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'].map(coord => (
                      <option key={coord} value={coord} className="bg-slate-900 text-slate-100">{coord} (Telecaller)</option>
                    ))
                  )}
                </select>
              </div>

              {successMsg && (
                <div className="text-[11px] text-center font-bold text-emerald-400 bg-emerald-950/20 p-2.5 rounded border border-emerald-800/60 animate-pulse mt-3">
                  {successMsg}
                </div>
              )}

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100 text-center font-bold cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingProgress}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs text-center font-bold cursor-pointer transition-all disabled:opacity-50"
                >
                  {creatingProgress ? 'Inserting Record...' : 'Confirm Enrollment'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* Profile Cabinet modal */}
      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onLeadUpdated={() => pullCrmData(true)}
          userRole={userRole}
          currentAgentId={currentAgentId}
          allLeads={leads}
          coordinators={coordinatorsList}
          projects={projects}
          countries={countries}
          positions={positions}
          tagsList={tagsList}
        />
      )}

      {/* Coordinators Staff Directory Manager */}
      {isCoordManagerOpen && (
        <CoordinatorsManager
          userRole={userRole}
          onClose={() => setIsCoordManagerOpen(false)}
          onCoordinatorsChanged={() => pullCrmData(true)}
        />
      )}

      {/* CRM Metadata Manager (Tags, Hiring Projects, Countries, Positions) */}
      {isMetadataManagerOpen && (
        <MetadataManager
          userRole={userRole}
          onClose={() => setIsMetadataManagerOpen(false)}
          tagsList={tagsList}
          projects={projects}
          countries={countries}
          positions={positions}
          onUpdateTagsList={handleUpdateTagsList}
          onUpdateProjects={handleUpdateProjects}
          onUpdateCountries={handleUpdateCountries}
          onUpdatePositions={handleUpdatePositions}
        />
      )}

      {/* Incentive Structures & Compensation Rules Manager */}
      {isIncentiveRulesOpen && (
        <IncentiveRulesManager
          userRole={userRole}
          onClose={() => setIsIncentiveRulesOpen(false)}
          onRulesChanged={() => pullCrmData(true)}
          countries={countries}
          projects={projects}
        />
      )}

      {/* Automated Database & XLSX Backup / Restore Modal */}
      {isBackupManagerOpen && (
        <BackupManagerModal
          isOpen={isBackupManagerOpen}
          onClose={() => setIsBackupManagerOpen(false)}
          onRestoreSuccess={() => {
            pullCrmData(true);
            setTimeout(() => {
              window.location.reload();
            }, 1000);
          }}
        />
      )}

      {/* Straight single line for end */}
      <div className="border-t border-slate-150 w-full mt-auto" />

    </div>
  );
}
