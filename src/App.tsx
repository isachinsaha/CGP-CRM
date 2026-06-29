/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Lead, LeadStage, StatSummary, Coordinator } from './types.ts';
import { 
  LayoutGrid, Table, BarChart3, Briefcase, ShieldAlert, Sparkles, 
  RefreshCw, MessageSquare, Plus, HelpCircle, Layers, Lock, User, Check, X, Shield,
  LogOut, Users, UserCheck, Sun, Moon
} from 'lucide-react';
import { motion } from 'motion/react';

// Import child components
import LeadBoard from './components/LeadBoard.tsx';
import LeadList from './components/LeadList.tsx';
import CampaignAnalytics from './components/CampaignAnalytics.tsx';
import ActiveJobs from './components/ActiveJobs.tsx';
import LeadModal from './components/LeadModal.tsx';
import LoginScreen from './components/LoginScreen.tsx';
import CoordinatorsManager from './components/CoordinatorsManager.tsx';

// Import local assets
// @ts-ignore
import cgpLogo from './assets/images/cgp_logo_1782388689853.jpg';

export default function App() {
  const [activeTab, setActiveTab] = useState<'board' | 'list' | 'analytics' | 'jobs'>('board');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [stats, setStats] = useState<StatSummary | null>(null);
  
  // Dynamic coordinators list loaded from server
  const [coordinatorsList, setCoordinatorsList] = useState<Coordinator[]>([]);
  const [isCoordManagerOpen, setIsCoordManagerOpen] = useState(false);

  // Authentication & session state
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string; displayName: string; role: 'admin' | 'agent' } | null>(() => {
    const saved = localStorage.getItem('cgp_crm_session');
    return saved ? JSON.parse(saved) : null;
  });

  const userRole = currentUser?.role || 'agent';
  const currentAgentId = currentUser?.username || 'unassigned';

  // Environment metadata
  const [apiMode, setApiMode] = useState<'live' | 'simulation'>('simulation');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    localStorage.setItem('crm_countries', JSON.stringify(countries));
  }, [countries]);

  useEffect(() => {
    localStorage.setItem('crm_positions', JSON.stringify(positions));
  }, [positions]);

  useEffect(() => {
    localStorage.setItem('crm_projects', JSON.stringify(projects));
  }, [projects]);

  // Manual Enrolling Dialog State for Admin power
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createFields, setCreateFields] = useState({
    name: '',
    phone: '',
    gender: 'M',
    age: '24',
    origin: '',
    country: 'Kuwait',
    position: 'Waiter',
    experience: '',
    assignedTo: 'Joyce',
    importance: '3',
    source: 'Ads',
    project: 'Napkin affairs'
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
      // 1. Fetch active job leads list
      const leadsRes = await fetch('/api/leads');
      if (leadsRes.ok) {
        const leadsData = await leadsRes.json();
        setLeads(leadsData);
        
        // Match active modal with fresh server changes
        if (selectedLead) {
          const updated = leadsData.find((l: Lead) => l.id === selectedLead.id);
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
    } catch (err) {
      console.error('Failed to sync placement entries from Express REST routes:', err);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    pullCrmData();
  }, []);

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
    if (!createFields.name || !createFields.phone) {
      alert('Please fill out Name and Mobile number fields.');
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
          age: Number(createFields.age) || 24,
          importance: Number(createFields.importance) || 3,
          tags: enrollTags
        })
      });
      if (res.ok) {
        setSuccessMsg('Candidate registered in directory successfully!');
        setCreateFields({
          name: '',
          phone: '',
          gender: 'M',
          age: '24',
          origin: '',
          country: 'Kuwait',
          position: 'Waiter',
          experience: '',
          assignedTo: 'Joyce',
          importance: '3',
          source: 'Ads',
          project: 'Napkin affairs'
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
    <div className="min-h-screen bg-slate-950 flex flex-col font-sans text-slate-100 antialiased selection:bg-accent-purple selection:text-white" id="cgp-root-viewport">
      
      {/* Dynamic Slide-in Success Welcome Toast */}
      {toastMessage && (
        <motion.div
          initial={{ opacity: 0, y: -40, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          className="fixed top-6 left-1/2 z-50 bg-slate-900 border border-slate-800 text-slate-100 px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3.5 min-w-[320px] max-w-md select-none"
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
      
      {/* Upper Navigation Bar */}
      <header className="bg-slate-900/95 border-b border-slate-850/80 lg:sticky lg:top-0 static z-40 backdrop-blur-md shadow-lg">
        <div className="max-w-[1550px] mx-auto px-6 py-4 lg:py-0 lg:h-18 flex flex-col lg:flex-row items-center justify-between gap-4">
          
          {/* Brand header */}
          <div className="flex items-center gap-3 text-left w-full lg:w-auto justify-between lg:justify-start">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl flex items-center justify-center overflow-hidden bg-slate-950 text-white border border-slate-800 shadow-inner select-none shrink-0">
                {!logoError ? (
                  <img 
                    src={cgpLogo} 
                    alt="CGP Logo" 
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={() => setLogoError(true)}
                  />
                ) : (
                  <span className="font-black text-xs tracking-tighter">CGP</span>
                )}
              </div>
              <div>
                <h1 className="font-black text-slate-50 tracking-wide text-sm sm:text-base leading-none flex items-center uppercase font-display">
                  <span className="mr-2 sm:mr-3.5">Career</span>
                  <span className="mr-2 sm:mr-3.5">Growth</span>
                  <span className="mr-2 sm:mr-3.5">Placement</span>
                  {apiMode === 'live' ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-accent-emerald animate-pulse mt-0.5" title="Live Auto-Parser Active" />
                  ) : (
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500 mt-0.2" title="Simulation" />
                  )}
                </h1>
                <p className="text-[10px] text-accent-emerald font-extrabold uppercase font-mono mt-1 tracking-wider">
                  Abroad Recruiting Tele-calling Hub
                </p>
              </div>
            </div>
          </div>

          {/* STAFF USER PANEL (Authentication & Coordinator Manager) */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-center lg:justify-end">
            
            {/* Simulation Status bar */}
            <div className="text-[10px] uppercase font-bold text-slate-400 font-mono px-2.5 py-1 bg-slate-850 rounded-lg border border-slate-800 text-center whitespace-nowrap">
              {apiMode === 'live' ? '🤖 AI Inbound Parser' : '🧪 Manual Simulation'}
            </div>

            {/* Active user badge */}
            <div className="flex items-center gap-2 bg-slate-850 p-1.5 rounded-xl border border-slate-800 shadow-inner">
              <span className="h-6 w-6 rounded-full bg-accent-purple text-white flex items-center justify-center text-[10px] font-black uppercase shadow-sm">
                {currentUser?.displayName.charAt(0).toUpperCase() || 'U'}
              </span>
              <div className="text-left leading-none pr-1">
                <p className="text-[11px] font-black text-slate-200">
                  {(() => {
                    const hr = new Date().getHours();
                    let greeting = 'Hello';
                    if (hr >= 5 && hr < 12) greeting = 'Good morning';
                    else if (hr >= 12 && hr < 17) greeting = 'Good afternoon';
                    else greeting = 'Good evening';
                    return `${greeting}, ${currentUser?.displayName}`;
                  })()}
                </p>
                <span className="text-[9px] font-black uppercase text-accent-purple tracking-wider">
                  {userRole === 'admin' ? '👑 Master Admin' : '📞 Coordinator'}
                </span>
              </div>
            </div>

            {/* Admin-only Coordinator Manager Toggle */}
            {userRole === 'admin' && (
              <button
                onClick={() => setIsCoordManagerOpen(true)}
                className="text-xs font-black px-3.5 py-2 bg-accent-purple hover:bg-accent-purple/90 text-white rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-accent-purple/10 cursor-pointer uppercase tracking-wider"
                title="Manage Staff & Credentials"
              >
                <Users className="h-3.5 w-3.5" />
                <span>Manage Staff</span>
              </button>
            )}

            {/* Theme Toggle Button */}
            <button
              onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
              className="p-2 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-100 transition-all flex items-center justify-center bg-slate-850 cursor-pointer"
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            >
              {theme === 'light' ? <Moon className="h-4.5 w-4.5" /> : <Sun className="h-4.5 w-4.5" />}
            </button>

            {/* Sync Refresh Button */}
            <button
              onClick={() => pullCrmData()}
              disabled={isRefreshing}
              className="p-2 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-100 transition-all flex items-center justify-center bg-slate-850 cursor-pointer"
              title="Pull Cloud Data"
            >
              <RefreshCw className={`h-4.5 w-4.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            {/* Sign Out Button */}
            <button
              onClick={() => {
                localStorage.removeItem('cgp_crm_session');
                setCurrentUser(null);
              }}
              className="p-2 border border-red-950 hover:bg-red-950/40 rounded-xl text-red-400 hover:text-red-300 transition-all flex items-center justify-center bg-slate-850 cursor-pointer"
              title="Log Out / Exit Session"
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>

        </div>
      </header>

      {/* Main Core Content Container */}
      <main className="flex-1 max-w-[1550px] w-full mx-auto px-6 pt-6 pb-2 space-y-6 flex flex-col">
        
        {/* Navigation Tabs Menu */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 p-3 rounded-2xl border border-slate-800/80 shadow-xl">
          
          <div className="flex space-x-1.5 w-full sm:w-auto overflow-x-auto max-w-full">
            {[
              { id: 'board', label: 'Your Pipeline', icon: LayoutGrid },
              { id: 'list', label: 'Spreadsheet Explorer', icon: Table },
              { id: 'analytics', label: 'Consultancy Reports', icon: BarChart3 },
              { id: 'jobs', label: 'Active Jobs Hub', icon: Briefcase }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 text-xs font-extrabold px-4 py-2.5 rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-accent-purple text-white shadow-lg shadow-accent-purple/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end shrink-0">
            {/* Quick Stats overview */}
            <div className="text-xs text-slate-500 font-mono text-left select-none">
              Synced: {new Date().toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'})} • <strong className="text-slate-350">{leads.length}</strong> candidates
            </div>

            {/* Admin Manual Enrollment Trigger */}
            {userRole === 'admin' && (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black bg-accent-emerald hover:bg-accent-emerald/90 text-white rounded-xl transition-all shadow-md shadow-accent-emerald/10 cursor-pointer"
                title="Enroll candidate directly"
              >
                <Plus className="h-4 w-4" /> Enrol Candidate
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Display Stage Router */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 min-h-[400px]">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center max-w-sm text-center bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl space-y-5"
            >
              <div className="relative h-24 w-24 rounded-3xl overflow-hidden bg-slate-950 border border-slate-800 shadow-inner p-1 select-none animate-pulse">
                <img 
                  src={cgpLogo} 
                  alt="Career Growth Placement" 
                  className="h-full w-full object-cover rounded-2xl"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-black text-slate-100 tracking-wider uppercase font-display">CGP HR Solutions</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">Abroad Recruiting Tele-calling Hub</p>
              </div>
              <div className="flex items-center gap-2 bg-slate-850 px-3.5 py-2 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-400">
                <RefreshCw className="h-3.5 w-3.5 text-slate-400 animate-spin" />
                <span>Synchronizing pipeline records...</span>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {activeTab === 'board' && (
              <LeadBoard
                leads={leads}
                onSelectLead={setSelectedLead}
                onUpdateStage={handleUpdateStage}
                userRole={userRole}
                currentAgentId={currentAgentId}
              />
            )}

            {activeTab === 'list' && (
              <LeadList
                leads={leads}
                onSelectLead={setSelectedLead}
                onUpdateStage={handleUpdateStage}
                onDeleteLead={handleDeleteLead}
                userRole={userRole}
                currentAgentId={currentAgentId}
                onRefreshData={() => pullCrmData(true)}
                coordinators={coordinatorsList}
              />
            )}

            {activeTab === 'analytics' && stats && (
              <CampaignAnalytics 
                stats={stats} 
                leads={leads} 
                onRefreshData={() => pullCrmData(true)} 
                userRole={userRole}
                currentAgentId={currentAgentId}
                onSelectLead={setSelectedLead}
                coordinators={coordinatorsList}
              />
            )}

            {activeTab === 'jobs' && (
              <ActiveJobs
                currentUser={currentUser}
                countries={countries}
              />
            )}
          </div>
        )}

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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Candidate Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. DEWAS BHUJEL"
                    value={createFields.name}
                    onChange={(e) => setCreateFields({...createFields, name: e.target.value})}
                    className="w-full text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none uppercase font-bold placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Candidate Mobile No *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. +91 98765 43210"
                    value={createFields.phone}
                    onChange={(e) => setCreateFields({...createFields, phone: e.target.value})}
                    className="w-full text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono placeholder-slate-500"
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
                              setCountries([...countries, trimmed]);
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
                              setPositions([...positions, trimmed]);
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Previous Experience criteria</label>
                  <input
                    type="text"
                    placeholder="e.g. 5 yrs Gulf Exp"
                    value={createFields.experience}
                    onChange={(e) => setCreateFields({...createFields, experience: e.target.value})}
                    className="w-full text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold placeholder-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-400 mb-0.5">Star Importance</label>
                  <select
                    value={createFields.importance}
                    onChange={(e) => setCreateFields({...createFields, importance: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold"
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
                              setProjects([...projects, trimmed]);
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

      {/* Straight single line for end */}
      <div className="border-t border-slate-150 w-full mt-auto" />

    </div>
  );
}
