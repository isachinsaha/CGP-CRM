/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Lead, LeadStage, StatSummary, Coordinator } from './types.ts';
import { 
  LayoutGrid, Table, BarChart3, Terminal, ShieldAlert, Sparkles, 
  RefreshCw, MessageSquare, Plus, HelpCircle, Layers, Lock, User, Check, X, Shield,
  LogOut, Users, UserCheck
} from 'lucide-react';
import { motion } from 'motion/react';

// Import child components
import LeadBoard from './components/LeadBoard.tsx';
import LeadList from './components/LeadList.tsx';
import CampaignAnalytics from './components/CampaignAnalytics.tsx';
import WebhookSandbox from './components/WebhookSandbox.tsx';
import LeadModal from './components/LeadModal.tsx';
import LoginScreen from './components/LoginScreen.tsx';
import CoordinatorsManager from './components/CoordinatorsManager.tsx';

export default function App() {
  const [activeTab, setActiveTab] = useState<'board' | 'list' | 'analytics' | 'sandbox'>('board');
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
    <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans text-slate-800 antialiased" id="cgp-root-viewport">
      
      {/* Upper Navigation Bar */}
      <header className="bg-white border-b border-slate-150 sticky top-0 z-40 shadow-xs">
        <div className="max-w-[1550px] mx-auto px-6 h-18 flex flex-col sm:flex-row items-center justify-between gap-4 py-3 sm:py-0">
          
          {/* Brand header */}
          <div className="flex items-center gap-3 text-left w-full sm:w-auto">
            <div className="h-12 w-12 rounded-xl flex items-center justify-center overflow-hidden bg-white border border-slate-200 shadow-sm select-none shrink-0">
              <img 
                src="/src/assets/images/cgp_logo_1782388689853.jpg" 
                alt="CGP Logo" 
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div>
              <h1 className="font-black text-slate-900 tracking-wide text-base leading-none flex items-center uppercase">
                <span className="mr-3.5">Career</span>
                <span className="mr-3.5">Growth</span>
                <span className="mr-3.5">Placement</span>
                {apiMode === 'live' ? (
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse mt-0.5" title="Live Auto-Parser Active" />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500 mt-0.2" title="Simulation" />
                )}
              </h1>
              <p className="text-[10px] text-emerald-600 font-extrabold uppercase font-mono mt-1 tracking-wider">
                Abroad Recruiting Tele-calling Hub
              </p>
            </div>
          </div>

          {/* STAFF USER PANEL (Authentication & Coordinator Manager) */}
          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
            
            {/* Simulation Status bar */}
            <div className="text-[10px] uppercase font-bold text-slate-400 font-mono px-2 py-1 bg-slate-100 rounded-md border text-center whitespace-nowrap">
              {apiMode === 'live' ? '🤖 AI Inbound Parser' : '🧪 Manual Simulation'}
            </div>

            {/* Active user badge */}
            <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200 shadow-3xs">
              <span className="h-6 w-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[10px] font-black uppercase">
                {currentUser?.displayName.charAt(0).toUpperCase() || 'U'}
              </span>
              <div className="text-left leading-none pr-1">
                <p className="text-[11px] font-black text-slate-800">{currentUser?.displayName}</p>
                <span className="text-[9px] font-black uppercase text-indigo-650 tracking-wider">
                  {userRole === 'admin' ? '👑 Master Admin' : '📞 Coordinator'}
                </span>
              </div>
            </div>

            {/* Admin-only Coordinator Manager Toggle */}
            {userRole === 'admin' && (
              <button
                onClick={() => setIsCoordManagerOpen(true)}
                className="text-xs font-black px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all flex items-center gap-1.5 shadow-3xs cursor-pointer uppercase tracking-wider"
                title="Manage Staff & Credentials"
              >
                <Users className="h-3.5 w-3.5" />
                <span>Manage Staff</span>
              </button>
            )}

            {/* Sync Refresh Button */}
            <button
              onClick={() => pullCrmData()}
              disabled={isRefreshing}
              className="p-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-500 hover:text-slate-800 transition-all flex items-center justify-center bg-white cursor-pointer"
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
              className="p-2 border border-red-200 hover:bg-red-50 rounded-xl text-red-500 hover:text-red-700 transition-all flex items-center justify-center bg-white cursor-pointer"
              title="Log Out / Exit Session"
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>

        </div>
      </header>

      {/* Main Core Content Container */}
      <main className="flex-1 max-w-[1550px] w-full mx-auto p-6 space-y-6 flex flex-col">
        
        {/* Navigation Tabs Menu */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-3 rounded-2xl border border-slate-150 shadow-xs">
          
          <div className="flex space-x-1.5 w-full sm:w-auto overflow-x-auto max-w-full">
            {[
              { id: 'board', label: 'Your Pipeline', icon: LayoutGrid },
              { id: 'list', label: 'Spreadsheet Explorer', icon: Table },
              { id: 'analytics', label: 'Consultancy Reports', icon: BarChart3 },
              { id: 'sandbox', label: 'Inbound Simulator', icon: Terminal }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 text-xs font-extrabold px-4 py-2.5 rounded-xl transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-slate-900 text-white shadow-md shadow-slate-100'
                      : 'text-slate-400 hover:text-slate-850 hover:bg-slate-50'
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
            <div className="text-xs text-slate-400 font-mono text-left select-none">
              Synced: {new Date().toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'})} • <strong>{leads.length}</strong> candidates
            </div>

            {/* Admin Manual Enrollment Trigger */}
            {userRole === 'admin' && (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-emerald-50 rounded-xl transition-all shadow-sm cursor-pointer"
                title="Enroll candidate directly"
              >
                <Plus className="h-4 w-4" /> Enrol Candidate
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Display Stage Router */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-20 space-y-3">
            <RefreshCw className="h-8 w-8 text-slate-900 animate-spin" />
            <p className="text-sm font-semibold text-slate-500">Connecting database and checking environment parameters...</p>
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
              />
            )}

            {activeTab === 'sandbox' && (
              <WebhookSandbox
                onLeadAdded={() => pullCrmData(true)}
                apiMode={apiMode}
              />
            )}
          </div>
        )}

      </main>

      {/* 2. MANUALLY ENROLL CANDIDATE MODAL DIALOG (Admin Power option) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-left">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="bg-slate-50 px-5.5 py-4 border-b border-slate-150 flex justify-between items-center">
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">Enroll New Job Candidate</h3>
                <p className="text-[10px] text-slate-400 font-mono mt-0.5">MANUAL SPREADSHEET INSERTION DIRECTORY</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 px-1.5 hover:bg-slate-200 text-slate-450 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* From body */}
            <form onSubmit={handleCreateLead} className="p-5.5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-0.5">Candidate Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. DEWAS BHUJEL"
                    value={createFields.name}
                    onChange={(e) => setCreateFields({...createFields, name: e.target.value})}
                    className="w-full text-xs px-3 py-2 rounded-lg bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none uppercase font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-0.5">Candidate Mobile No *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. +91 98765 43210"
                    value={createFields.phone}
                    onChange={(e) => setCreateFields({...createFields, phone: e.target.value})}
                    className="w-full text-xs px-3 py-2 rounded-lg bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-0.5">Gender</label>
                  <select
                    value={createFields.gender}
                    onChange={(e) => setCreateFields({...createFields, gender: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white"
                  >
                    <option value="M">Male (M)</option>
                    <option value="F">Female (F)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-0.5">Age</label>
                  <input
                    type="number"
                    value={createFields.age}
                    onChange={(e) => setCreateFields({...createFields, age: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-0.5">Origin / State</label>
                  <input
                    type="text"
                    placeholder="e.g. Darjeeling"
                    value={createFields.origin}
                    onChange={(e) => setCreateFields({...createFields, origin: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Apply Destination Country Selection */}
                <div>
                  <div className="flex justify-between items-center mb-0.5">
                    <label className="block text-[11px] font-bold text-slate-500">Apply Destination Country</label>
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        onClick={() => setIsAddingCountry(!isAddingCountry)}
                        className="text-[10px] font-extrabold text-emerald-600 hover:text-emerald-800 cursor-pointer"
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
                        className="flex-1 text-xs px-2 py-1 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white font-bold"
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
                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <select
                      value={createFields.country}
                      onChange={(e) => setCreateFields({...createFields, country: e.target.value})}
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-bold text-slate-800"
                    >
                      <option value="">-- Select Country --</option>
                      {countries.map((c, idx) => (
                        <option key={idx} value={c}>{c}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Target Job Position Selection */}
                <div>
                  <div className="flex justify-between items-center mb-0.5">
                    <label className="block text-[11px] font-bold text-slate-500">Target Job Position</label>
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        onClick={() => setIsAddingPosition(!isAddingPosition)}
                        className="text-[10px] font-extrabold text-emerald-600 hover:text-emerald-800 cursor-pointer"
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
                        className="flex-1 text-xs px-2 py-1 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white font-bold"
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
                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <select
                      value={createFields.position}
                      onChange={(e) => setCreateFields({...createFields, position: e.target.value})}
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-bold text-slate-800"
                    >
                      <option value="">-- Select Position --</option>
                      {positions.map((p, idx) => (
                        <option key={idx} value={p}>{p}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-0.5">Previous Experience criteria</label>
                  <input
                    type="text"
                    placeholder="e.g. 5 yrs Gulf Exp"
                    value={createFields.experience}
                    onChange={(e) => setCreateFields({...createFields, experience: e.target.value})}
                    className="w-full text-xs px-3 py-2 rounded-lg bg-white border border-slate-200 focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-0.5">Star Importance</label>
                  <select
                    value={createFields.importance}
                    onChange={(e) => setCreateFields({...createFields, importance: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white"
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
                  <label className="block text-[11px] font-bold text-slate-500 mb-0.5">Lead Source</label>
                  <select
                    value={createFields.source}
                    onChange={(e) => setCreateFields({...createFields, source: e.target.value})}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800"
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
                    <label className="block text-[11px] font-bold text-slate-500">Hiring Project</label>
                    {userRole === 'admin' && (
                      <button
                        type="button"
                        onClick={() => setIsAddingProject(!isAddingProject)}
                        className="text-[10px] font-extrabold text-emerald-600 hover:text-emerald-800 cursor-pointer"
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
                        className="flex-1 text-xs px-2 py-1 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white font-bold"
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
                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  ) : (
                    <select
                      value={createFields.project}
                      onChange={(e) => setCreateFields({...createFields, project: e.target.value})}
                      className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold text-slate-800"
                    >
                      <option value="">-- Select Project --</option>
                      {projects.map((p, idx) => (
                        <option key={idx} value={p}>{p}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {/* Dynamic Tag Builder during Enrollment */}
              <div className="border-t border-slate-100 pt-3">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">
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
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
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
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold"
                  >
                    + Add Tag
                  </button>
                </div>

                {enrollTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 p-2 bg-slate-50 border border-slate-150 rounded-lg">
                    {enrollTags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1 bg-white text-slate-700 text-[10px] font-black px-2 py-0.5 rounded-md border border-slate-200"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => setEnrollTags(enrollTags.filter(t => t !== tag))}
                          className="text-slate-400 hover:text-slate-600 font-extrabold cursor-pointer ml-1"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-emerald-800 mb-0.5">Assign Telecaller Coordinator Directly</label>
                <select
                  value={createFields.assignedTo}
                  onChange={(e) => setCreateFields({...createFields, assignedTo: e.target.value})}
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-800 font-extrabold"
                >
                  <option value="">-- Leave Unassigned --</option>
                  {coordinatorsList && coordinatorsList.length > 0 ? (
                    coordinatorsList.filter(c => c.role === 'agent').map(coord => (
                      <option key={coord.id} value={coord.username}>{coord.displayName} (Telecaller)</option>
                    ))
                  ) : (
                    ['Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'].map(coord => (
                      <option key={coord} value={coord}>{coord} (Telecaller)</option>
                    ))
                  )}
                </select>
              </div>

              {successMsg && (
                <div className="text-[11px] text-center font-bold text-emerald-700 bg-emerald-50 p-2.5 rounded border border-emerald-150 animate-pulse mt-3">
                  {successMsg}
                </div>
              )}

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border text-xs text-slate-500 hover:bg-slate-50 text-center font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingProgress}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white text-xs text-center font-bold"
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

      {/* Clean Minimalist footer */}
      <footer className="py-6 border-t border-slate-150 text-center text-xs text-slate-400 font-mono mt-auto max-w-[1550px] w-full mx-auto px-6 flex flex-col sm:flex-row justify-between gap-4 select-none">
        <span>© 2026 Career Growth Placement • Candidate Pipeline CRM</span>
        <span>Agency seat portal active via port 3000 • Crafted on React 19 & Express with D3 analytics</span>
      </footer>

    </div>
  );
}
