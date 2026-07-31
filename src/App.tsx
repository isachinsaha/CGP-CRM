/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Lead, LeadStage, StatSummary, Coordinator } from './types.ts';
import { 
  LayoutGrid, Table, BarChart3, Briefcase, ShieldAlert, Sparkles, 
  RefreshCw, MessageSquare, Plus, HelpCircle, Layers, Lock, User, Check, X, Shield,
  LogOut, Users, UserCheck, Sun, Moon, PiggyBank, Menu, ChevronRight, Settings, ChevronDown
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
import CGPLogo from './components/CGPLogo.tsx';
import ImportantUpdatesBar from './components/ImportantUpdatesBar.tsx';

// Import local assets

export default function App() {
  const [activeTab, setActiveTab] = useState<'board' | 'list' | 'analytics' | 'jobs' | 'ai-matcher' | 'wallet'>('board');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [stats, setStats] = useState<StatSummary | null>(null);
  
  // Dynamic coordinators list loaded from server
  const [coordinatorsList, setCoordinatorsList] = useState<Coordinator[]>([]);
  const [isCoordManagerOpen, setIsCoordManagerOpen] = useState(false);
  const [isMetadataManagerOpen, setIsMetadataManagerOpen] = useState(false);
  const [isIncentiveRulesOpen, setIsIncentiveRulesOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(true);

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

  // Listen for Escape key to close open modals/panels
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedLead(null);
        setIsCreateModalOpen(false);
        setIsCoordManagerOpen(false);
        setIsMetadataManagerOpen(false);
        setIsIncentiveRulesOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
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

  // Synchronize data from Express REST API
  const pullCrmData = async (silent = false) => {
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

      const leadsRes = await fetch(`/api/leads?${params.toString()}`);
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
      const statsRes = await fetch('/api/stats');
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      // Fetch dynamic staff roster list
      const coordsRes = await fetch('/api/coordinators');
      if (coordsRes.ok) {
        const coordsData = await coordsRes.json();
        setCoordinatorsList(coordsData);
      }

      // 3. System capabilities configuration
      const healthRes = await fetch('/api/health');
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setApiMode(healthData.aiMode);
      }

      // 4. Fetch dynamic CRM metadata options from server
      const metaRes = await fetch('/api/metadata');
      if (metaRes.ok) {
        const metaData = await metaRes.json();
        if (metaData.countries) setCountries(metaData.countries);
        if (metaData.positions) setPositions(metaData.positions);
        if (metaData.projects) setProjects(metaData.projects);
        if (metaData.tagsList) setTagsList(metaData.tagsList);
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
  }, [currentPage, filters, activeTab]);

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
    <div className="min-h-screen bg-slate-900 dark:bg-slate-950 flex flex-col font-sans text-slate-100 antialiased selection:bg-accent-purple selection:text-white" id="cgp-root-viewport">
      
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

      {/* TOP HEADER BAR (Reference Layout) */}
      <header className="bg-slate-900 dark:bg-slate-900 border-b border-slate-800 px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-40 shadow-lg">
        {/* Left: Brand & Logo */}
        <div className="flex items-center gap-3.5">
          <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center p-1 shadow-md shrink-0 cursor-pointer" onClick={() => setActiveTab('board')}>
            <CGPLogo size={36} rounded="rounded-lg" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-black text-slate-100 text-sm sm:text-base tracking-wider uppercase font-display leading-none">
                CAREER GROWTH PLACEMENT
              </h1>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" title="System Operational" />
            </div>
            <p className="text-[10px] text-emerald-400 font-mono font-extrabold uppercase tracking-wider mt-1">
              Abroad Recruiting Tele-Calling Hub
            </p>
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* AI Inbound Parser button */}
          <button
            onClick={() => setApiMode(prev => prev === 'live' ? 'simulation' : 'live')}
            className="bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-bold px-3.5 py-1.5 rounded-full border border-slate-700 flex items-center gap-2 cursor-pointer transition-all shadow-xs"
            title="Toggle Live Parser / Simulation"
          >
            <span className="text-sm">🤖</span>
            <span className="uppercase text-[11px] font-mono tracking-wider font-extrabold">
              AI INBOUND PARSER
            </span>
          </button>

          {/* User Badge */}
          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700/80 px-3 py-1 rounded-full shadow-xs">
            <div className="h-7 w-7 rounded-full bg-indigo-600 text-white font-black text-xs flex items-center justify-center uppercase shadow-xs">
              {currentUser?.displayName?.charAt(0).toUpperCase() || 'M'}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-[11px] font-bold text-slate-200 leading-tight">
                Good afternoon, {currentUser?.displayName}
              </p>
              <p className="text-[9px] font-black text-indigo-400 uppercase tracking-wider font-mono">
                {userRole === 'admin' ? '👑 MASTER ADMIN' : 'COORDINATOR'}
              </p>
            </div>
          </div>

          {/* Admin Header Action Pills */}
          {userRole === 'admin' && (
            <>
              <button
                onClick={() => setIsCoordManagerOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold px-4 py-1.5 rounded-full shadow-md shadow-indigo-950/30 flex items-center gap-1.5 uppercase cursor-pointer transition-all"
              >
                <Users className="h-3.5 w-3.5" />
                <span>MANAGE STAFF</span>
              </button>

              <button
                onClick={() => setIsMetadataManagerOpen(true)}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold px-4 py-1.5 rounded-full shadow-xs flex items-center gap-1.5 uppercase cursor-pointer transition-all"
              >
                <Layers className="h-3.5 w-3.5 text-indigo-400" />
                <span>MANAGE OPTIONS</span>
              </button>

              <button
                onClick={() => setIsIncentiveRulesOpen(true)}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold px-4 py-1.5 rounded-full shadow-xs flex items-center gap-1.5 uppercase cursor-pointer transition-all"
              >
                <PiggyBank className="h-3.5 w-3.5 text-emerald-400" />
                <span>INCENTIVE RULES</span>
              </button>
            </>
          )}

          {/* Theme, Refresh, Logout Buttons */}
          <div className="flex items-center gap-1 pl-1 border-l border-slate-800">
            <button
              onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>

            <button
              onClick={() => pullCrmData()}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Pull Cloud Data"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={() => {
                localStorage.removeItem('cgp_crm_session');
                setCurrentUser(null);
              }}
              className="p-1.5 rounded-lg text-rose-400 hover:text-rose-200 hover:bg-rose-950/40 transition cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* HORIZONTAL TABS NAVIGATION BAR (Reference Layout) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-lg p-2 flex flex-wrap items-center justify-between gap-3 my-3 mx-4 sm:mx-6">
        {/* Left Horizontal Tabs Pill Stack */}
        <nav className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: 'board', label: 'Your Pipeline', icon: LayoutGrid },
            { id: 'list', label: 'Spreadsheet Explorer', icon: Table },
            { id: 'analytics', label: 'Consultancy Reports', icon: BarChart3 },
            { id: 'ai-matcher', label: 'AI Profile Matcher', icon: Sparkles },
            { id: 'jobs', label: 'Active Jobs Hub', icon: Briefcase },
            { id: 'wallet', label: 'Incentive Wallet', icon: PiggyBank },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-950/40'
                    : 'bg-transparent border-transparent text-black dark:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`h-4 w-4 ${isSelected ? 'text-white' : 'text-black dark:text-slate-300'}`} />
                <span className={isSelected ? 'text-white font-black' : 'text-black dark:text-slate-200 font-black'}>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right Sync Status & Enrol Action */}
        <div className="flex items-center gap-4 ml-auto">
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400 font-medium hidden md:inline-block">
            Synced: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} • <strong className="text-slate-800 dark:text-slate-200">{totalLeadsCount || leads.length}</strong> candidates
          </span>

          {userRole === 'admin' && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold px-4 py-2 rounded-xl shadow-md shadow-emerald-950/30 flex items-center gap-1.5 uppercase cursor-pointer transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>Enrol Candidate</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Core Content Area */}
      <main className="flex-1 min-w-0 px-4 sm:px-6 pb-6 space-y-4 flex flex-col">
        {/* Important Live Broadcast Updates Ticker */}
        <ImportantUpdatesBar />

        {/* Dynamic Display Stage Router */}
        <div className="flex-1 flex flex-col">
          {activeTab === 'board' && (
              <motion.div
                key="board-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="flex-1 flex flex-col"
              >
                <LeadBoard
                  leads={leads}
                  onSelectLead={setSelectedLead}
                  onUpdateStage={handleUpdateStage}
                  userRole={userRole}
                  currentAgentId={currentAgentId}
                  coordinators={coordinatorsList}
                />
              </motion.div>
            )}

            {activeTab === 'list' && (
              <motion.div
                key="list-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="flex-1 flex flex-col"
              >
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
                  onFiltersChange={setFilters}
                  metaCountries={metaCountries}
                  metaProjects={metaProjects}
                  metaPositions={metaPositions}
                  metaTags={metaTags}
                />
              </motion.div>
            )}

            {activeTab === 'analytics' && stats && (
              <motion.div
                key="analytics-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="flex-1 flex flex-col"
              >
                <CampaignAnalytics 
                  stats={stats} 
                  leads={leads} 
                  onRefreshData={() => pullCrmData(true)} 
                  userRole={userRole}
                  currentAgentId={currentAgentId}
                  onSelectLead={setSelectedLead}
                  coordinators={coordinatorsList}
                />
              </motion.div>
            )}

            {activeTab === 'jobs' && (
              <motion.div
                key="jobs-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="flex-1 flex flex-col"
              >
                <ActiveJobs
                  currentUser={currentUser}
                  countries={countries}
                  view="jobs"
                />
              </motion.div>
            )}

            {activeTab === 'wallet' && (
              <motion.div
                key="wallet-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="flex-1 flex flex-col"
              >
                <ActiveJobs
                  currentUser={currentUser}
                  countries={countries}
                  view="wallet"
                />
              </motion.div>
            )}

            {activeTab === 'ai-matcher' && (
              <motion.div
                key="ai-matcher-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="flex-1 flex flex-col"
              >
                <AiProfileMatcher
                  onSelectLead={setSelectedLead}
                  onUpdateLead={async () => { await pullCrmData(true); }}
                  userRole={userRole}
                />
              </motion.div>
            )}
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

      {/* Straight single line for end */}
      <div className="border-t border-slate-150 w-full mt-auto" />

    </div>
  );
}
