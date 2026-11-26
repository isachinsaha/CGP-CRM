/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Lead, LeadStage, StatSummary, Coordinator, WhatsAppTemplate } from './types.ts';
import { 
  LayoutGrid, Table, BarChart3, Briefcase, ShieldAlert, Sparkles, Bot,
  RefreshCw, MessageSquare, Plus, HelpCircle, Layers, Lock, User, Check, X, Shield,
  LogOut, Users, UserCheck, Sun, Moon, PiggyBank, Menu, ChevronRight, Settings, ChevronDown, Download, Trash2, Image,
  CheckCheck, AlertCircle, Copy, UploadCloud, Clock
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  OutboxItem,
  getOutboxItems,
  subscribeOutbox,
  flushOutbox,
  removeOutboxItem,
  hasUnsavedWork
} from './utils/syncOutbox.ts';

// Import child components
import LeadBoard from './components/LeadBoard.tsx';
import LeadList from './components/LeadList.tsx';
import CampaignAnalytics from './components/CampaignAnalytics.tsx';
import ActiveJobs from './components/ActiveJobs.tsx';
import AiProfileMatcher from './components/AiProfileMatcher.tsx';
import CandidateReactivation from './components/CandidateReactivation.tsx';
import LeadModal from './components/LeadModal.tsx';
import LoginScreen from './components/LoginScreen.tsx';
import CoordinatorsManager from './components/CoordinatorsManager.tsx';
import MetadataManager from './components/MetadataManager.tsx';
import IncentiveRulesManager from './components/IncentiveRulesManager.tsx';
import MessagingCenter from './components/MessagingCenter.tsx';
import TemplateManagerModal from './components/TemplateManagerModal.tsx';
import AutoReplyManagerModal from './components/AutoReplyManagerModal.tsx';
import CGPLogo from './components/CGPLogo.tsx';
import ImportantUpdatesBar from './components/ImportantUpdatesBar.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { BackupManagerModal } from './components/BackupManagerModal.tsx';
import RecycleBinModal from './components/RecycleBinModal.tsx';
import MediaLibrary from './components/MediaLibrary.tsx';
import { DuplicateManagerModal } from './components/DuplicateManagerModal.tsx';
import { AiSentinelModal } from './components/AiSentinelModal.tsx';

// Import local assets

// Global fetch interceptor: injects session token, deduplicates identical concurrent GETs,
// and transparently retries HTTP 429 Rate Limit responses with exponential backoff + jitter.
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch.bind(window);
  const inFlightGets = new Map<string, Promise<Response>>();
  let globalRateLimitedUntil = 0;
  (window as any).__cgpRateLimitedUntil = () => globalRateLimitedUntil;

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET') || 'GET').toUpperCase();

    const buildInit = (): RequestInit => {
      const nextInit: RequestInit = { ...(init || {}) };
      const headers = new Headers(nextInit.headers || (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined));
      const sessionStr = localStorage.getItem('cgp_crm_session');
      if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          if (session && session.token && !headers.has('x-session-token')) {
            headers.set('x-session-token', session.token);
          }
        } catch {
          // ignore parsing errors
        }
      }
      nextInit.headers = headers;
      return nextInit;
    };

    const runWithRetry = async (): Promise<Response> => {
      const canRetry429 = method === 'GET' || method === 'HEAD' || method === 'PUT';
      const maxRetries = canRetry429 ? 3 : 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (init?.signal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }

        const res = await originalFetch(input, buildInit());
        if (res.status !== 429) {
          return res;
        }

        globalRateLimitedUntil = Math.max(globalRateLimitedUntil, Date.now() + 30000);
        if (attempt >= maxRetries || !canRetry429) {
          return res;
        }

        const retryAfterRaw = res.headers.get('Retry-After');
        const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN;
        const baseDelay = !isNaN(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 12000)
          : Math.min(1500 * Math.pow(2, attempt), 8000);
        const jitter = Math.floor(Math.random() * 700);
        await sleep(baseDelay + jitter);
      }

      return originalFetch(input, buildInit());
    };

    // Single-flight dedupe for identical concurrent GET calls without custom AbortSignal or ETag headers
    const rawHeaders = init?.headers as Record<string, string> | undefined;
    const hasCustomEtag = !!(rawHeaders && (rawHeaders['If-None-Match'] || rawHeaders['if-none-match']));
    const canDedupe = method === 'GET' && !init?.signal && !hasCustomEtag && urlStr.startsWith('/api/');

    if (canDedupe) {
      const existing = inFlightGets.get(urlStr);
      if (existing) {
        const res = await existing;
        return res.clone();
      }
      const p = runWithRetry().finally(() => {
        inFlightGets.delete(urlStr);
      });
      inFlightGets.set(urlStr, p);
      const res = await p;
      return res.clone();
    }

    return runWithRetry();
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'board' | 'list' | 'messages' | 'analytics' | 'jobs' | 'ai-matcher' | 'reactivation' | 'wallet' | 'media'>('board');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const selectedLeadRef = useRef<Lead | null>(null);

  // Sync selectedLeadRef with selectedLead state instantly to avoid stale closures in background polling
  useEffect(() => {
    selectedLeadRef.current = selectedLead;
  }, [selectedLead]);

  const [stats, setStats] = useState<StatSummary | null>(null);
  
  // Dynamic coordinators list loaded from server
  const [coordinatorsList, setCoordinatorsList] = useState<Coordinator[]>([]);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]); // Add state
  const [isCoordManagerOpen, setIsCoordManagerOpen] = useState(false);
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false); // Add this
  const [isAutoReplyOpen, setIsAutoReplyOpen] = useState(false);
  const [isMetadataManagerOpen, setIsMetadataManagerOpen] = useState(false);
  const [isIncentiveRulesOpen, setIsIncentiveRulesOpen] = useState(false);
  const [isBackupManagerOpen, setIsBackupManagerOpen] = useState(false);
  const [isDuplicateManagerOpen, setIsDuplicateManagerOpen] = useState(false);
  const [isSentinelOpen, setIsSentinelOpen] = useState(false);
  const [isRecycleBinOpen, setIsRecycleBinOpen] = useState(false);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const adminMenuRef = useRef<HTMLDivElement>(null);
  const lastFetchTimeRef = useRef<number>(0);
  const rateLimitedUntilRef = useRef<number>(0);
  const lastEtagMapRef = useRef<Map<string, string>>(new Map());
  const statsEtagRef = useRef<string>('');
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const inFlightLoadKeyRef = useRef<string>('');
  const lastKnownVersionRef = useRef<number>(0);
  const loadedStateRef = useRef<{ user: string; mode: 'none' | 'light-all' | 'analytics-all' | 'list'; queryKey: string }>({
    user: '',
    mode: 'none',
    queryKey: ''
  });
  const leadsRef = useRef<Lead[]>([]);
  const loadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    leadsRef.current = leads;
  }, [leads]);

  // Authentication & session state
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string; displayName: string; role: 'admin' | 'agent'; token?: string } | null>(() => {
    const saved = localStorage.getItem('cgp_crm_session');
    return saved ? JSON.parse(saved) : null;
  });

  const isUserAdminName = currentUser?.username?.toLowerCase() === 'admin' || currentUser?.username?.toLowerCase() === 'sachinsaha' || currentUser?.role === 'admin';
  const userRole: 'admin' | 'agent' = isUserAdminName ? 'admin' : (currentUser?.role || 'agent');
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [outboxItems, setOutboxItems] = useState<OutboxItem[]>(() => getOutboxItems());
  const [isFlushingOutbox, setIsFlushingOutbox] = useState(false);
  const [isOutboxPopoverOpen, setIsOutboxPopoverOpen] = useState(false);
  const outboxPopoverRef = useRef<HTMLDivElement>(null);
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
        selectedLeadRef.current = null;
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
      if (outboxPopoverRef.current && !outboxPopoverRef.current.contains(e.target as Node)) {
        setIsOutboxPopoverOpen(false);
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
      const res = await fetch('/api/metadata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setActionError(errData.error || 'Failed to persist CRM options/tags to cloud database.');
      }
    } catch (err: any) {
      console.error('Error syncing CRM metadata to server:', err);
      setActionError(err?.message || 'Network error while saving CRM options/tags to cloud.');
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
  const [enrollTagError, setEnrollTagError] = useState<string | null>(null);

  const handleEnrollAddTag = (rawVal: string) => {
    setEnrollTagError(null);
    const val = rawVal.trim();
    if (!val) return;

    const lowerVal = val.toLowerCase();

    // Check if tag is already assigned to enrolling candidate
    if (enrollTags.some(t => t.toLowerCase() === lowerVal)) {
      setEnrollTagError(`Tag "${val}" already exists.`);
      setTimeout(() => setEnrollTagError(null), 4000);
      return;
    }

    // Match case-insensitively with global tagsList
    const existingMatch = tagsList.find(t => t.toLowerCase() === lowerVal);
    const finalTag = existingMatch || val; // Reuse existing casing if matched, otherwise keep as typed

    setEnrollTags([...enrollTags, finalTag]);
    setNewEnrollTagInput('');
  };

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

  // One-time app bootstrap when authenticated user logs in
  const fetchAppMetadata = useCallback(async () => {
    if (!currentUser) return;
    try {
      const [coordsRes, healthRes, metaRes] = await Promise.all([
        fetch('/api/coordinators').catch(() => null),
        fetch('/api/health').catch(() => null),
        fetch('/api/metadata').catch(() => null)
      ]);

      if (coordsRes && coordsRes.ok && coordsRes.headers.get('content-type')?.includes('application/json')) {
        const coordsData = await coordsRes.json();
        setCoordinatorsList(coordsData);
      }
      if (healthRes && healthRes.ok && healthRes.headers.get('content-type')?.includes('application/json')) {
        const healthData = await healthRes.json();
        setApiMode(healthData.aiMode);
      }
      if (metaRes && metaRes.ok && metaRes.headers.get('content-type')?.includes('application/json')) {
        const metaData = await metaRes.json();
        if (metaData.countries) setCountries(metaData.countries);
        if (metaData.positions) setPositions(metaData.positions);
        if (metaData.projects) setProjects(metaData.projects);
        if (metaData.tagsList) {
          const uniqueMap = new Map<string, string>();
          metaData.tagsList.forEach((t: string) => {
            const trimmed = t.trim();
            if (trimmed) {
              uniqueMap.set(trimmed.toLowerCase(), trimmed);
            }
          });
          setTagsList(Array.from(uniqueMap.values()).sort((a, b) => a.localeCompare(b)));
        }
      }
    } catch (err) {
      console.warn('Failed to load static app metadata:', err);
    }
  }, [currentUser?.username]);

  useEffect(() => {
    if (!currentUser) return;
    fetchAppMetadata();
  }, [fetchAppMetadata, currentUser?.username]);

  useEffect(() => {
    if (!currentUser) return;
    fetch('/api/whatsapp/templates')
      .then(res => {
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          return res.json();
        }
        return { templates: [] };
      })
      .then(data => setTemplates(data.templates || []))
      .catch(err => {
        if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
          console.warn('[Sync] Templates fetch skipped (server starting up or offline)');
        } else {
          console.error('[Sync] Templates fetch error:', err);
        }
      });
  }, [currentUser?.username]);

  // Helper to build consistent /api/leads query params
  const buildLeadsQuery = useCallback((forceRefresh = false) => {
    const isListTab = activeTab === 'list';
    const targetMode: 'light-all' | 'analytics-all' | 'list' = isListTab
      ? 'list'
      : activeTab === 'analytics'
        ? 'analytics-all'
        : 'light-all';

    const params = new URLSearchParams({
      page: String(currentPage),
      limit: '100',
      search: isListTab ? (filters.search || '') : '',
      country: isListTab ? (filters.country || 'All') : 'All',
      coordinator: isListTab ? (filters.coordinator || 'All') : 'All',
      fitScore: isListTab ? (filters.fitScore || 'All') : 'All',
      tag: isListTab ? (filters.tag || 'All') : 'All',
      project: isListTab ? (filters.project || 'All') : 'All',
      position: isListTab ? (filters.position || 'All') : 'All',
      dateFilter: isListTab ? (filters.dateFilter || 'All') : 'All',
      customStartDate: isListTab ? (filters.customStartDate || '') : '',
      customEndDate: isListTab ? (filters.customEndDate || '') : '',
      bucket: userRole === 'agent' ? 'my' : (isListTab ? (filters.bucket || 'all') : 'all'),
      agentId: currentAgentId,
      userRole: userRole,
      all: !isListTab ? 'true' : 'false',
      activeTab: targetMode === 'analytics-all' ? 'analytics' : (isListTab ? 'list' : 'board'),
      gender: isListTab ? (filters.gender || 'All') : 'All',
      remarksFilter: isListTab ? (filters.remarksFilter || 'All') : 'All',
      stage: isListTab ? (filters.stage || 'All') : 'All'
    });
    if (forceRefresh) {
      params.append('forceRefresh', 'true');
    }
    return { params, targetMode, queryKey: params.toString() };
  }, [activeTab, currentPage, filters, userRole, currentAgentId]);

  // Synchronize data from Express REST API
  const pullCrmData = async (silent = false, forceRefresh = false) => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    if (loadRetryTimerRef.current) {
      clearTimeout(loadRetryTimerRef.current);
      loadRetryTimerRef.current = null;
    }

    const { params, targetMode, queryKey } = buildLeadsQuery(forceRefresh);
    const baseKey = (() => {
      const p = new URLSearchParams(params);
      p.delete('forceRefresh');
      return `${currentAgentId}::${p.toString()}`;
    })();

    const now = Date.now();
    if (silent && now < rateLimitedUntilRef.current) {
      return; // Pause background polling while Cloud Armor cooldown is active
    }

    // Do not abort an identical in-flight load (e.g., React StrictMode double-mount or duplicate effect trigger)
    if (activeAbortControllerRef.current && !activeAbortControllerRef.current.signal.aborted && inFlightLoadKeyRef.current === baseKey) {
      if (!forceRefresh || (now - lastFetchTimeRef.current < 3000)) {
        return;
      }
    }

    const minIntervalMs = silent ? 15000 : 1200;
    if (!forceRefresh && (now - lastFetchTimeRef.current < minIntervalMs) && inFlightLoadKeyRef.current === baseKey) {
      return; // Skip duplicate rapid triggers for the same query
    }
    lastFetchTimeRef.current = now;

    if (!silent) {
      setIsRefreshing(true);
      if (leadsRef.current.length === 0) {
        setLoading(true);
      }
    }

    // Cancel any in-flight request only when genuinely superseded
    if (activeAbortControllerRef.current) {
      try {
        if (!activeAbortControllerRef.current.signal.aborted) {
          activeAbortControllerRef.current.abort(new DOMException('Superseded by newer sync request', 'AbortError'));
        }
      } catch {
        // ignore abort error
      }
    }

    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    inFlightLoadKeyRef.current = baseKey;
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      try {
        if (!controller.signal.aborted) {
          controller.abort(new DOMException('Sync request timed out', 'AbortError'));
        }
      } catch {
        // ignore abort error
      }
    }, 25000);

    try {
      const reqHeaders: Record<string, string> = {};
      if (forceRefresh) {
        lastEtagMapRef.current.delete(queryKey);
        statsEtagRef.current = '';
      } else {
        const cachedEtag = lastEtagMapRef.current.get(queryKey);
        if (cachedEtag) {
          reqHeaders['If-None-Match'] = cachedEtag;
        }
      }

      const statsHeaders: Record<string, string> = {};
      if (!forceRefresh && statsEtagRef.current) {
        statsHeaders['If-None-Match'] = statsEtagRef.current;
      }

      const safeFetch = (url: string, options: RequestInit) =>
        fetch(url, options).catch(err => {
          if (controller.signal.aborted || err?.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('abort')) {
            return null;
          }
          throw err;
        });

      const [leadsRes, statsRes] = await Promise.all([
        safeFetch(`/api/leads?${queryKey}`, {
          signal: controller.signal,
          headers: reqHeaders
        }),
        safeFetch('/api/stats', {
          signal: controller.signal,
          headers: statsHeaders
        }).catch(() => null)
      ]);

      clearTimeout(timeoutId);

      // If this request was aborted/superseded by a newer pullCrmData call, exit silently
      if (controller.signal.aborted || activeAbortControllerRef.current !== controller) {
        if (didTimeout && activeAbortControllerRef.current === controller && leadsRef.current.length === 0) {
          setLoadError('Sync timed out — retrying automatically...');
          loadRetryTimerRef.current = setTimeout(() => {
            pullCrmData(false, false);
          }, 3000);
        }
        return;
      }

      // Handle HTTP 429 Rate Limit gracefully with retry if leads haven't loaded yet
      if ((leadsRes && leadsRes.status === 429) || (statsRes && statsRes.status === 429)) {
        rateLimitedUntilRef.current = Date.now() + 30000;
        console.warn('[Sync] Rate limit detected (429). Scheduling safe backoff.');
        if (leadsRef.current.length === 0) {
          setLoadError('Connection busy — automatically retrying to load your leads...');
          loadRetryTimerRef.current = setTimeout(() => {
            pullCrmData(false, false);
          }, 4000);
        }
        return;
      }

      if (leadsRes && leadsRes.status === 304) {
        setLoadError(null);
      } else if (leadsRes && leadsRes.ok && leadsRes.headers.get('content-type')?.includes('application/json')) {
        const etag = leadsRes.headers.get('ETag');
        if (etag) lastEtagMapRef.current.set(queryKey, etag);

        const leadsData = await leadsRes.json().catch(err => {
          if (controller.signal.aborted || err?.name === 'AbortError') return null;
          throw err;
        });
        if (!leadsData || controller.signal.aborted || activeAbortControllerRef.current !== controller) {
          return;
        }

        if (leadsData.version) {
          lastKnownVersionRef.current = Number(leadsData.version);
        }
        const leadsArray = Array.isArray(leadsData) ? leadsData : (leadsData.leads || []);
        setLeads(leadsArray);
        setLoadError(null);
        loadedStateRef.current = {
          user: currentAgentId,
          mode: targetMode,
          queryKey
        };

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

        // Match active modal with fresh server changes if and only if the modal is still open in the UI
        if (selectedLeadRef.current) {
          const updated = leadsArray.find((l: Lead) => l.id === selectedLeadRef.current?.id);
          if (updated) setSelectedLead(updated);
        }
      } else if (leadsRef.current.length === 0) {
        setLoadError('Unable to sync leads right now — retrying automatically...');
        loadRetryTimerRef.current = setTimeout(() => {
          pullCrmData(false, false);
        }, 4000);
      }

      // 2. Fetch aggregate stats
      if (statsRes && statsRes.ok && statsRes.headers.get('content-type')?.includes('application/json')) {
        const sEtag = statsRes.headers.get('ETag');
        if (sEtag) statsEtagRef.current = sEtag;
        const statsData = await statsRes.json().catch(() => null);
        if (statsData && !controller.signal.aborted && activeAbortControllerRef.current === controller) {
          setStats(statsData);
        }
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isAbort =
        controller.signal.aborted ||
        err?.name === 'AbortError' ||
        String(err?.message || '').toLowerCase().includes('abort');
      if (isAbort) {
        if (didTimeout && activeAbortControllerRef.current === controller && leadsRef.current.length === 0) {
          setLoadError('Sync timed out — retrying automatically...');
          loadRetryTimerRef.current = setTimeout(() => {
            pullCrmData(false, false);
          }, 3000);
        }
        return;
      }
      if (err instanceof TypeError && err.message?.includes('Failed to fetch')) {
        console.warn('[Sync] Express REST server offline or restarting, skipping poll sync.');
      } else {
        console.error('Failed to sync placement entries from Express REST routes:', err);
      }
      if (activeAbortControllerRef.current === controller && leadsRef.current.length === 0) {
        setLoadError('Network hiccup while loading leads — retrying automatically...');
        loadRetryTimerRef.current = setTimeout(() => {
          pullCrmData(false, false);
        }, 4000);
      }
    } finally {
      clearTimeout(timeoutId);
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
        inFlightLoadKeyRef.current = '';
        setIsRefreshing(false);
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!currentUser) {
      // Clear cached state upon sign-out so next login starts completely fresh
      loadedStateRef.current = { user: '', mode: 'none', queryKey: '' };
      lastKnownVersionRef.current = 0;
      lastEtagMapRef.current.clear();
      statsEtagRef.current = '';
      setLeads([]);
      setStats(null);
      setLoadError(null);
      return;
    }

    const userChanged = loadedStateRef.current.user !== currentAgentId;
    if (userChanged) {
      loadedStateRef.current = { user: '', mode: 'none', queryKey: '' };
      lastEtagMapRef.current.clear();
      statsEtagRef.current = '';
      setLeads([]);
      setLoading(true);
      pullCrmData(false, true);
      return;
    }

    // Avoid re-fetching 2,400+ leads when switching between all-leads tabs (board, messages, jobs, wallet, etc.)
    const { targetMode, queryKey } = buildLeadsQuery(false);
    const loaded = loadedStateRef.current;
    if (leadsRef.current.length > 0 && loaded.user === currentAgentId) {
      if (targetMode === 'light-all' && (loaded.mode === 'light-all' || loaded.mode === 'analytics-all')) {
        return;
      }
      if (targetMode === 'analytics-all' && loaded.mode === 'analytics-all') {
        return;
      }
      if (targetMode === 'list' && loaded.mode === 'list' && loaded.queryKey === queryKey) {
        return;
      }
    }

    pullCrmData(false, false);
  }, [currentUser?.username, currentAgentId, currentPage, filterKey, activeTab]);

  // Ultra-lightweight background polling + Delta Sync (downloads only changed leads, not whole DB)
  useEffect(() => {
    if (!currentUser) return;
    const shouldPollLeads = activeTab === 'board' || activeTab === 'list' || activeTab === 'messages';
    if (!shouldPollLeads) return;

    const jitterMs = Math.floor(Math.random() * 6000);
    const pollIntervalMs = (activeTab === 'messages' ? 25000 : 45000) + jitterMs;

    const timer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (Date.now() < rateLimitedUntilRef.current) return;
      try {
        const res = await fetch('/api/sync/version');
        if (res.status === 429) {
          rateLimitedUntilRef.current = Date.now() + 60000;
          return;
        }
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          const syncData = await res.json();
          if (syncData.version && lastKnownVersionRef.current && syncData.version !== lastKnownVersionRef.current) {
            const loaded = loadedStateRef.current;
            if (loaded.mode === 'light-all' || loaded.mode === 'analytics-all') {
              const deltaParams = new URLSearchParams({
                sinceVersion: String(lastKnownVersionRef.current),
                userRole,
                agentId: currentAgentId,
                activeTab: loaded.mode === 'analytics-all' ? 'analytics' : 'board'
              });
              const deltaRes = await fetch(`/api/leads/changes?${deltaParams.toString()}`);
              if (deltaRes.ok && deltaRes.headers.get('content-type')?.includes('application/json')) {
                const delta = await deltaRes.json();
                if (delta.fullSyncRequired) {
                  pullCrmData(true, false);
                  return;
                }
                if (delta.version) {
                  lastKnownVersionRef.current = Number(delta.version);
                }
                const changedLeads: Lead[] = delta.changedLeads || [];
                const removedSet = new Set<string>(delta.removedIds || []);
                if (changedLeads.length > 0 || removedSet.size > 0) {
                  const changedMap = new Map(changedLeads.map(l => [l.id, l]));
                  setLeads(prev => {
                    const next: Lead[] = [];
                    const seen = new Set<string>();
                    for (const l of prev) {
                      if (removedSet.has(l.id)) continue;
                      const updated = changedMap.get(l.id);
                      if (updated) {
                        next.push({ ...l, ...updated });
                        seen.add(l.id);
                      } else {
                        next.push(l);
                        seen.add(l.id);
                      }
                    }
                    changedLeads.forEach(cl => {
                      if (!seen.has(cl.id)) next.unshift(cl);
                    });
                    return next;
                  });
                  if (selectedLeadRef.current) {
                    const updatedOpen = changedMap.get(selectedLeadRef.current.id);
                    if (updatedOpen) {
                      setSelectedLead(prev => {
                        if (!prev || prev.id !== updatedOpen.id) return prev;
                        return {
                          ...prev,
                          ...updatedOpen,
                          timeline: (updatedOpen.timeline && updatedOpen.timeline.length > 0) ? updatedOpen.timeline : prev.timeline,
                          messages: (updatedOpen.messages && updatedOpen.messages.length >= (prev.messages?.length || 0)) ? updatedOpen.messages : prev.messages,
                          cvTextContent: updatedOpen.cvTextContent ?? prev.cvTextContent,
                          deletedDocuments: (updatedOpen as any).deletedDocuments ?? (prev as any).deletedDocuments
                        };
                      });
                    }
                  }
                }
                return;
              }
            }
            pullCrmData(true, false);
          }
        }
      } catch {
        // Suppress background heartbeat errors
      }
    }, pollIntervalMs);

    return () => clearInterval(timer);
  }, [currentUser?.username, activeTab, userRole, currentAgentId]);

  // Handle in-place single lead updates without causing full-CRM re-fetching or flashing
  const handleSingleLeadUpdated = useCallback((updatedLead: Lead) => {
    if (!updatedLead || !updatedLead.id) return;
    setLeads(prev => prev.map(l => l.id === updatedLead.id ? { ...l, ...updatedLead } : l));
    setSelectedLead(prev => (prev && prev.id === updatedLead.id ? { ...prev, ...updatedLead } : prev));
  }, []);

  // Subscribe to durable Retry Outbox + auto-flush every 15s and on browser online event
  useEffect(() => {
    const syncItems = () => setOutboxItems(getOutboxItems());
    const unsub = subscribeOutbox(syncItems);

    const runFlush = async () => {
      if (getOutboxItems().length === 0) return;
      setIsFlushingOutbox(true);
      try {
        await flushOutbox(handleSingleLeadUpdated);
      } finally {
        setIsFlushingOutbox(false);
        syncItems();
      }
    };

    const handleOnline = () => {
      runFlush();
    };
    window.addEventListener('online', handleOnline);
    const intervalId = setInterval(() => {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        runFlush();
      }
    }, 15000);

    // Trigger initial flush shortly after login/mount if leftover items exist
    if (currentUser && getOutboxItems().length > 0) {
      runFlush();
    }

    return () => {
      unsub();
      window.removeEventListener('online', handleOnline);
      clearInterval(intervalId);
    };
  }, [currentUser?.username, handleSingleLeadUpdated]);

  // Warn before closing tab if there are unsaved local drafts or pending outbox writes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Update lead stage pipeline state with instant optimistic update
  const handleUpdateStage = async (id: string, stage: LeadStage) => {
    // 1. Instantly update UI state optimistically so stage change is instantaneous and never reverts
    const prevLead = leads.find(l => l.id === id);
    const prevStage = prevLead?.stage;
    setLeads(prev => prev.map(l => l.id === id ? { ...l, stage } : l));
    if (selectedLead && selectedLead.id === id) {
      setSelectedLead(prev => prev ? { ...prev, stage } : null);
    }

    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId,
          'x-source-view': 'pipeline_board'
        },
        body: JSON.stringify({ stage })
      });
      if (res.ok) {
        const updatedLead = await res.json();
        setLeads(prev => prev.map(l => l.id === id ? updatedLead : l));
        if (selectedLead && selectedLead.id === id) {
          setSelectedLead(updatedLead);
        }
      } else {
        if (prevStage) {
          setLeads(prev => prev.map(l => l.id === id ? { ...l, stage: prevStage } : l));
          if (selectedLead && selectedLead.id === id) {
            setSelectedLead(prev => prev ? { ...prev, stage: prevStage } : null);
          }
        }
        const errJson = await res.json().catch(() => ({}));
        setActionError(errJson.error || 'Failed to update lead stage in cloud database. Reverted.');
      }
    } catch (err: any) {
      console.error('Failed to modify stage metadata', err);
      if (prevStage) {
        setLeads(prev => prev.map(l => l.id === id ? { ...l, stage: prevStage } : l));
        if (selectedLead && selectedLead.id === id) {
          setSelectedLead(prev => prev ? { ...prev, stage: prevStage } : null);
        }
      }
      setActionError(err?.message || 'Network error while updating lead stage. Reverted.');
    }
  };

  // Remove a lead from records
  const handleDeleteLead = async (id: string) => {
    if (userRole !== 'admin') {
      setActionError('Security Alert: Sub-agents do not have privileges to remove database records.');
      return;
    }
    if (!window.confirm('Are you absolutely sure you want to remove this candidate from the active placement database? This moves them to the Recycle Bin.')) return;
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'DELETE',
        headers: {
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        }
      });
      if (res.ok) {
        if (selectedLead && selectedLead.id === id) {
          selectedLeadRef.current = null;
          setSelectedLead(null);
        }
        pullCrmData(true);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setActionError(errJson.error || 'Failed to move candidate to Recycle Bin.');
      }
    } catch (err: any) {
      console.error('Failed to remove placement lead', err);
      setActionError(err?.message || 'Network error while removing placement lead.');
    }
  };

  // Submit manual candidate enroll
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    if (!createFields.phone) {
      setCreateError('Please fill out Mobile number field.');
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
          'x-agent-id': currentAgentId,
          'x-source-view': 'enroll_modal',
          ...(currentUser?.token ? { 'Authorization': `Bearer ${currentUser.token}` } : {})
        },
        body: JSON.stringify({
          ...createFields,
          userRole,
          agentId: currentAgentId,
          age: createFields.age !== '' ? (Number(createFields.age) || '') : '',
          importance: Number(createFields.importance) || 3,
          tags: enrollTags
        })
      });
      if (res.ok) {
        setSuccessMsg('Candidate registered in directory successfully!');
        setCreateError(null);
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
        const errData = await res.json().catch(() => ({}));
        setCreateError(errData.error || 'Failed to create record in cloud database.');
      }
    } catch (err: any) {
      console.error(err);
      setCreateError(err?.message || 'Error connecting with backend server.');
    } finally {
      setCreatingProgress(false);
    }
  };

  if (!currentUser) {
    return <LoginScreen onLoginSuccess={(user) => setCurrentUser(user)} />;
  }

  return (
    <div className="h-screen w-full flex flex-col bg-slate-950 font-sans text-slate-100 dark:text-slate-100 antialiased overflow-hidden selection:bg-indigo-600 selection:text-white" id="cgp-root-viewport">
      
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

      {/* Visible Cloud Persistence Error Banner */}
      {actionError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[150] bg-rose-950/95 border border-rose-500/70 text-rose-100 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 max-w-lg">
          <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
          <span className="text-xs font-bold">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-2 p-1 text-rose-300 hover:text-white transition cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* TOP HEADER & NAVIGATION BAR */}
      {(() => {
        const isOlderThan24Hours = (lead: Lead) => {
          const msgs = (lead.messages || []).filter(m => m && m.text && !m.text.includes('Lead enrolled manually in CGP system database'));
          
          // 1. If there are no messages at all (brand new, or older lead but never texted), allow free-text (not in history)
          if (msgs.length === 0) return false;

          const leadMsgs = msgs.filter(m => m.sender === 'lead');
          const outboundMsgs = msgs.filter(m => m.sender !== 'lead');

          // 2. If the candidate HAS sent at least one incoming message,
          // then Meta strictly enforces the 24h customer care window from their LATEST incoming message.
          if (leadMsgs.length > 0) {
            const latestLeadMsg = leadMsgs[leadMsgs.length - 1];
            if (latestLeadMsg?.timestamp) {
              const latestTime = new Date(latestLeadMsg.timestamp).getTime();
              if (!isNaN(latestTime)) {
                const now = new Date().getTime();
                const diffMs = now - latestTime;
                return diffMs > 24 * 60 * 60 * 1000; // Expired if older than 24 hours
              }
            }
            return true; // Fallback
          }

          // 3. If the candidate has NEVER sent an incoming message:
          // Standard typing is allowed until 24 hours after our first/latest outbound message.
          if (outboundMsgs.length === 0) {
            return false; // No messages from either side, standard free-text allowed
          }

          const latestOutboundMsg = outboundMsgs[outboundMsgs.length - 1];
          if (latestOutboundMsg?.timestamp) {
            const latestOutboundTime = new Date(latestOutboundMsg.timestamp).getTime();
            if (!isNaN(latestOutboundTime)) {
              const now = new Date().getTime();
              const diffMs = now - latestOutboundTime;
              return diffMs > 24 * 60 * 60 * 1000; // Expired if older than 24 hours
            }
          }

          return true;
        };

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
          { id: 'reactivation', label: 'Broadcast', icon: RefreshCw },
          { id: 'jobs', label: 'Active Jobs', icon: Briefcase },
          { id: 'wallet', label: 'Incentive Wallet', icon: PiggyBank },
          { id: 'media', label: 'Media Library', icon: Image },
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
                    <h1 className="font-black text-slate-100 dark:text-slate-100 text-sm tracking-wider uppercase font-display leading-tight truncate">
                      CAREER GROWTH PLACEMENT
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
                {/* AI Sentinel Copilot button */}
                <button
                  onClick={() => setIsSentinelOpen(true)}
                  className="bg-gradient-to-r from-indigo-950/80 via-slate-900 to-purple-950/80 hover:from-indigo-900 hover:to-purple-900 text-indigo-200 hover:text-white text-xs font-bold px-2.5 py-1.5 rounded-xl border border-indigo-500/40 flex items-center gap-1.5 cursor-pointer transition-all shadow-md group"
                  title="Open AI Sentinel & Operations Copilot"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <Bot className="h-3.5 w-3.5 text-indigo-400 group-hover:scale-110 transition-transform" />
                  <span className="uppercase text-[10px] font-mono tracking-wider font-extrabold hidden md:inline">
                    AI SENTINEL
                  </span>
                </button>

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
                          onClick={() => { setIsTemplateManagerOpen(true); setIsAdminMenuOpen(false); }}
                          className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition text-left cursor-pointer"
                        >
                          <MessageSquare className="h-4 w-4 text-emerald-500 shrink-0" />
                          <span>Manage Templates</span>
                        </button>
                        <button
                          onClick={() => { setIsAutoReplyOpen(true); setIsAdminMenuOpen(false); }}
                          className="w-full px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2.5 transition text-left cursor-pointer"
                          id="admin-menu-auto-reply-btn"
                        >
                          <Sparkles className="h-4 w-4 text-emerald-500 shrink-0" />
                          <span>Auto-Reply Settings</span>
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
                        <button
                          onClick={() => {
                            setIsDuplicateManagerOpen(true);
                            setIsAdminMenuOpen(false);
                          }}
                          className="w-full px-3.5 py-2 text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 flex items-center gap-2.5 transition text-left cursor-pointer border-t border-slate-100 dark:border-slate-800"
                          title="Identify and Merge/Delete Duplicate Leads by Phone Number (+91 country code normalization)"
                        >
                          <Copy className="h-4 w-4 text-amber-500 shrink-0" />
                          <span>👥 Duplicate Leads Manager</span>
                        </button>
                        <button
                          onClick={() => {
                            setIsRecycleBinOpen(true);
                            setIsAdminMenuOpen(false);
                          }}
                          className="w-full px-3.5 py-2 text-xs font-bold text-rose-600 dark:text-rose-450 hover:bg-rose-50 dark:hover:bg-rose-950/20 flex items-center gap-2.5 transition text-left cursor-pointer border-t border-slate-100 dark:border-slate-800"
                          title="Open Safeguard Recycle Bin & Recovery Center to restore any soft-deleted candidates"
                        >
                          <Trash2 className="h-4 w-4 text-rose-500 shrink-0" />
                          <span>🗑️ Recycle Bin (Recovery)</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Theme Toggle */}
                <button
                  onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
                  className="p-1.5 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
                  title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
                >
                  {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </button>

                {/* Pending Cloud Sync Outbox Indicator */}
                {outboxItems.length > 0 && (
                  <div className="relative" ref={outboxPopoverRef}>
                    <button
                      type="button"
                      onClick={() => setIsOutboxPopoverOpen(prev => !prev)}
                      className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-black flex items-center gap-1.5 cursor-pointer transition-all"
                      title="Edits queued locally waiting to sync with Cloud Firestore"
                    >
                      <UploadCloud className={`h-3.5 w-3.5 text-amber-400 ${isFlushingOutbox ? 'animate-bounce' : 'animate-pulse'}`} />
                      <span className="hidden sm:inline">Pending Cloud Sync</span>
                      <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-mono text-[10px] font-black">
                        {outboxItems.length}
                      </span>
                    </button>

                    {isOutboxPopoverOpen && (
                      <div className="absolute top-full right-0 mt-2 w-80 bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl p-3 z-50 text-left space-y-2.5">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <div>
                            <h4 className="text-xs font-black text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5" />
                              Queued Cloud Saves ({outboxItems.length})
                            </h4>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Protected locally — auto-retries every 15s and on reconnect.
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={isFlushingOutbox}
                            onClick={async () => {
                              setIsFlushingOutbox(true);
                              try {
                                await flushOutbox(handleSingleLeadUpdated);
                              } finally {
                                setIsFlushingOutbox(false);
                                setOutboxItems(getOutboxItems());
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[10px] font-black uppercase cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {isFlushingOutbox ? 'Syncing...' : 'Retry All Now'}
                          </button>
                        </div>

                        <div className="max-h-56 overflow-y-auto space-y-1.5">
                          {outboxItems.map((item) => (
                            <div
                              key={item.id}
                              className="p-2 rounded-xl bg-slate-950/90 border border-slate-800 flex items-start justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <p className="text-[11px] font-bold text-slate-100 truncate">
                                  {item.leadName || item.phone || item.leadId}
                                </p>
                                <p className="text-[10px] text-slate-400 font-mono">
                                  {item.headers?.sourceView || 'crm'} • Attempts: {item.attempts}
                                </p>
                                {item.lastError && (
                                  <p className="text-[10px] text-rose-400 truncate mt-0.5" title={item.lastError}>
                                    {item.lastError}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeOutboxItem(item.id)}
                                className="text-[10px] font-bold text-slate-500 hover:text-rose-400 px-1.5 py-0.5 rounded hover:bg-rose-950/30 cursor-pointer shrink-0"
                                title="Discard queued change"
                              >
                                Discard
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Refresh Cloud Data */}
                <button
                  onClick={() => pullCrmData(false, true)}
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
                      <p className="text-xs font-bold text-slate-100 dark:text-slate-100 truncate leading-tight max-w-[120px]">
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
            <div className="px-2.5 sm:px-4 2xl:px-5 pt-1.5 2xl:pt-2 pb-2 2xl:pb-2.5 bg-slate-950/60 border-b border-slate-200 dark:border-slate-800">
              <nav className="bg-slate-950 text-slate-100 rounded-2xl px-2 sm:px-3 2xl:px-4 py-1.5 2xl:py-2.5 flex items-center justify-between gap-1.5 2xl:gap-2 overflow-x-auto no-scrollbar shadow-md border border-slate-800/80 w-full">
                
                {/* Left Navigation Buttons */}
                <div className="flex items-center gap-1 xl:gap-1.5 2xl:gap-3 shrink-0">
                  {navItems.map((tab) => {
                    const Icon = tab.icon;
                    const isSelected = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`group px-2 md:px-2.5 xl:px-3 2xl:px-4.5 py-1.5 md:py-2 rounded-xl text-[0.7rem] xl:text-[0.75rem] 2xl:text-[0.8125rem] font-extrabold flex items-center gap-1.5 2xl:gap-2 transition-all cursor-pointer shrink-0 ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-sm font-black'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <Icon className={`h-3.5 w-3.5 2xl:h-4 2xl:w-4 shrink-0 ${isSelected ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'}`} />
                        <span className="whitespace-nowrap">{tab.label}</span>
                        {tab.requestingBadge !== undefined && tab.requestingBadge > 0 && (
                          <span className={`text-[0.6rem] 2xl:text-[0.625rem] font-mono font-black px-1.5 py-0.2 rounded-full ${
                            isSelected ? 'bg-amber-400 text-slate-950' : 'bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse'
                          }`} title={`${tab.requestingBadge} requesting chats`}>
                            {tab.requestingBadge}
                          </span>
                        )}
                        {tab.badge !== undefined && tab.badge > 0 && (
                          <span className={`text-[0.6rem] 2xl:text-[0.625rem] font-mono font-black px-1.5 py-0.2 rounded-full ${
                            isSelected ? 'bg-white text-indigo-700' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          }`}>
                            {tab.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Right Status & Enrol Candidate CTA Button (Only for Admin) */}
                <div className="flex items-center gap-2 2xl:gap-3 shrink-0 ml-auto pl-2 2xl:pl-3 border-l border-slate-800">
                  {/* Synced Info */}
                  <div className="text-[0.65rem] 2xl:text-xs font-mono text-emerald-400 font-semibold hidden min-[1360px]:flex items-center gap-1 2xl:gap-1.5 whitespace-nowrap">
                    <span>Synced: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                    <span>•</span>
                    <strong className="text-emerald-300 font-black">{totalLeadsCount || leads.length} candidates</strong>
                  </div>

                  {/* Enrol Candidate CTA Button - ONLY VISIBLE FOR ADMIN */}
                  {userRole === 'admin' && (
                    <button
                      onClick={() => setIsCreateModalOpen(true)}
                      className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-[0.7rem] 2xl:text-xs font-black py-1.5 2xl:py-2 px-2.5 2xl:px-3.5 rounded-xl shadow-xs flex items-center gap-1.5 uppercase cursor-pointer transition-all tracking-wider whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5 2xl:h-4 2xl:w-4 stroke-[3]" />
                      <span className="hidden sm:inline">ENROL CANDIDATE</span>
                    </button>
                  )}
                </div>
              </nav>
            </div>
          </div>
        );
      })()}

      {/* MAIN WORKSPACE VIEWPORT */}
      <main className="flex-1 overflow-y-auto p-2.5 sm:p-4 2xl:p-6 space-y-3 2xl:space-y-4 flex flex-col min-h-0">
        {/* Dynamic Display Stage Router */}
        <div className="flex-1 flex flex-col min-h-0">
          <ErrorBoundary fallbackTitle="Could Not Display Selected View">
            {activeTab === 'board' && (
              <div key="board-tab" className="flex-1 flex flex-col min-h-0 space-y-4">
                {/* Important Live Broadcast Updates Ticker - ONLY on Pipeline Screen */}
                <ErrorBoundary fallbackTitle="Updates Ticker Unavailable">
                  <ImportantUpdatesBar />
                </ErrorBoundary>

                {(loading || loadError) && leads.length === 0 ? (
                  <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center gap-3 text-center">
                    <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {loadError || 'Loading your CRM pipeline leads...'}
                    </p>
                    {loadError && (
                      <button
                        type="button"
                        onClick={() => pullCrmData(false, true)}
                        className="mt-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider cursor-pointer transition-all"
                      >
                        Retry Now
                      </button>
                    )}
                  </div>
                ) : (
                  <LeadBoard
                    leads={leads}
                    onSelectLead={setSelectedLead}
                    onUpdateStage={handleUpdateStage}
                    userRole={userRole}
                    currentAgentId={currentAgentId}
                    coordinators={coordinatorsList}
                  />
                )}
              </div>
            )}

            {activeTab === 'list' && (
              <div key="list-tab" className="flex-1 flex flex-col min-h-0">
                {(loading || loadError) && leads.length === 0 ? (
                  <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center gap-3 text-center">
                    <RefreshCw className="h-8 w-8 text-indigo-500 animate-spin" />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      {loadError || 'Loading spreadsheet records...'}
                    </p>
                    {loadError && (
                      <button
                        type="button"
                        onClick={() => pullCrmData(false, true)}
                        className="mt-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider cursor-pointer transition-all"
                      >
                        Retry Now
                      </button>
                    )}
                  </div>
                ) : (
                  <LeadList
                    leads={leads}
                    onSelectLead={setSelectedLead}
                    onUpdateStage={handleUpdateStage}
                    onDeleteLead={handleDeleteLead}
                    userRole={userRole}
                    currentAgentId={currentAgentId}
                    onRefreshData={() => pullCrmData(true, true)}
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
                )}
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
                  onUpdatePositions={handleUpdatePositions}
                  projects={projects}
                  onRefreshData={() => pullCrmData(false, true)}
                  onLeadUpdated={handleSingleLeadUpdated}
                  isRefreshing={isRefreshing}
                />
              </div>
            )}

            {activeTab === 'analytics' && (
              <div key="analytics-tab" className="flex-1 flex flex-col min-h-0">
                {stats ? (
                  <CampaignAnalytics 
                    stats={stats} 
                    leads={leads} 
                    onRefreshData={() => pullCrmData(true, true)} 
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
                  onUpdateLead={async (lead) => {
                    handleSingleLeadUpdated(lead);
                  }}
                  userRole={userRole}
                  currentUser={currentUser}
                />
              </div>
            )}

            {activeTab === 'reactivation' && (
              <div key="reactivation-tab" className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 bg-slate-950">
                <CandidateReactivation
                  onSelectLead={setSelectedLead}
                  onUpdateLead={async (lead) => {
                    handleSingleLeadUpdated(lead);
                  }}
                  userRole={userRole}
                />
              </div>
            )}

            {activeTab === 'media' && (
              <div key="media-tab" className="flex-1 flex flex-col min-h-0">
                <MediaLibrary currentUser={currentUser} />
              </div>
            )}
          </ErrorBoundary>
        </div>
      </main>

      {/* 2. MANUALLY ENROLL CANDIDATE MODAL DIALOG (Admin Power option) */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-left">
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
                    onChange={(e) => {
                      setNewEnrollTagInput(e.target.value);
                      setEnrollTagError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleEnrollAddTag(newEnrollTagInput);
                      }
                    }}
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-slate-950 text-slate-100 placeholder-slate-500 font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => handleEnrollAddTag(newEnrollTagInput)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    + Add Tag
                  </button>
                </div>

                {enrollTagError && (
                  <p className="text-[11px] text-rose-500 font-bold mt-1 flex items-center gap-1">
                    <span>⚠️</span> {enrollTagError}
                  </p>
                )}

                {/* Intelligent Clickable Tag Suggestions */}
                <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-slate-500 font-extrabold uppercase mr-1">Suggestions:</span>
                  {(newEnrollTagInput.trim() === '' 
                    ? tagsList.slice(0, 8)
                    : tagsList.filter(t => t.toLowerCase().includes(newEnrollTagInput.toLowerCase()))
                  )
                    .filter(t => !enrollTags.some(et => et.toLowerCase() === t.toLowerCase()))
                    .slice(0, 8)
                    .map((tag, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleEnrollAddTag(tag)}
                        className="text-[10px] bg-slate-900 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 font-extrabold px-2 py-0.5 rounded border border-slate-800 hover:border-emerald-900 transition-all cursor-pointer"
                      >
                        {tag}
                      </button>
                    ))}
                  {newEnrollTagInput.trim() !== '' && tagsList.filter(t => t.toLowerCase().includes(newEnrollTagInput.toLowerCase())).filter(t => !enrollTags.some(et => et.toLowerCase() === t.toLowerCase())).length === 0 && (
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

              {createError && (
                <div className="text-[11px] text-center font-bold text-rose-400 bg-rose-950/30 p-2.5 rounded border border-rose-800/60 mt-3">
                  {createError}
                </div>
              )}

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
          onClose={() => {
            selectedLeadRef.current = null;
            setSelectedLead(null);
          }}
          onLeadUpdated={(updated) => {
            if (updated && updated.id) {
              handleSingleLeadUpdated(updated);
            } else {
              pullCrmData(true, false);
            }
          }}
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

      {/* WhatsApp Template Manager */}
      {isTemplateManagerOpen && (
        <TemplateManagerModal
          isOpen={isTemplateManagerOpen}
          onClose={() => setIsTemplateManagerOpen(false)}
          templates={templates}
          onRefresh={() => {
            fetch('/api/whatsapp/templates')
              .then(res => res.json())
              .then(data => setTemplates(data.templates || []))
              .catch(console.error);
          }}
        />
      )}

      {/* WhatsApp Auto-Reply Manager */}
      {isAutoReplyOpen && (
        <AutoReplyManagerModal
          isOpen={isAutoReplyOpen}
          onClose={() => setIsAutoReplyOpen(false)}
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

      {/* Soft-Deletes Recycle Bin & Safe Recovery Console */}
      {isRecycleBinOpen && (
        <RecycleBinModal
          isOpen={isRecycleBinOpen}
          onClose={() => setIsRecycleBinOpen(false)}
          onRestoreSuccess={() => pullCrmData(true)}
        />
      )}

      {/* Duplicate Leads Manager & Strict Uniqueness Guard Modal */}
      {isDuplicateManagerOpen && (
        <DuplicateManagerModal
          isOpen={isDuplicateManagerOpen}
          onClose={() => setIsDuplicateManagerOpen(false)}
          onRefreshData={() => pullCrmData(true)}
        />
      )}

      {/* AI Sentinel & Operations Copilot Modal */}
      {isSentinelOpen && (
        <AiSentinelModal
          isOpen={isSentinelOpen}
          onClose={() => setIsSentinelOpen(false)}
          userRole={userRole}
          currentAgentId={currentAgentId}
          onFilterByStage={(stage) => {
            setActiveTab('board');
          }}
          onNavigateToWhatsApp={() => {
            setActiveTab('messages');
          }}
        />
      )}

    </div>
  );
}
