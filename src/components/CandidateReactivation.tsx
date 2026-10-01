import React, { useState, useEffect, useMemo } from 'react';
import { SearchableSelect } from './SearchableSelect';
import { 
  Sparkles, 
  Send, 
  RefreshCw, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  MessageSquare, 
  UserCheck, 
  Clock, 
  Filter, 
  Briefcase, 
  ArrowRight,
  TrendingUp,
  UserX,
  MapPin,
  Check,
  CheckSquare,
  Square,
  BadgeAlert,
  Sliders,
  ChevronRight,
  HelpCircle,
  FileText
} from 'lucide-react';
import { Lead, Job } from '../types';

interface CandidateReactivationProps {
  onSelectLead: (lead: Lead) => void;
  onUpdateLead: (lead: Lead) => Promise<void>;
  userRole: string;
}

export default function CandidateReactivation({ onSelectLead, onUpdateLead, userRole }: CandidateReactivationProps) {
  // State for Job selection & custom parameters
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  
  // Job Detail states (filled from selected job or customized)
  const [jobTitle, setJobTitle] = useState('Hotel Supervisor');
  const [jobCountry, setJobCountry] = useState('Dubai');
  const [jobSalary, setJobSalary] = useState('₹65,000');
  const [jobExperience, setJobExperience] = useState('3 years');
  const [jobRequirements, setJobRequirements] = useState('Leadership, guest relations, fluent English, luxury hospitality experience.');
  const [jobGender, setJobGender] = useState<'ALL' | 'MALE' | 'FEMALE'>('ALL');

  // Reactivation Filters
  const [inactivityMonths, setInactivityMonths] = useState<number>(6);
  const [limitCount, setLimitCount] = useState<number>(30);
  
  // WhatsApp Template states for BLAST
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [isTemplatesLoading, setIsTemplatesLoading] = useState(false);
  const [isSyncingTemplates, setIsSyncingTemplates] = useState(false);

  // Loading & process states
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  
  // Results
  const [matchedCandidates, setMatchedCandidates] = useState<Array<Lead & { 
    matchScore: number; 
    matchReason: string; 
    lastContactedMonths: number;
    customMessage: string;
  }>>([]);
  
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [campaignLaunched, setCampaignLaunched] = useState(false);
  const [launchSummary, setLaunchSummary] = useState<{ sentCount: number; jobTitle: string } | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  // Campaign Dashboard statistics & tracking (loaded from DB/API)
  const [activeCampaigns, setActiveCampaigns] = useState<any[]>([]);
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(true);
  const [expandedCampaignName, setExpandedCampaignName] = useState<string | null>(null);
  const [campaignSubFilter, setCampaignSubFilter] = useState<'all' | 'replied' | 'qualified'>('all');

  // Reactivation Directory Filter States
  const [countryFilter, setCountryFilter] = useState('All');
  const [coordinatorFilter, setCoordinatorFilter] = useState('All');
  const [projectFilter, setProjectFilter] = useState('All');
  const [positionFilter, setPositionFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [fitScoreFilter, setFitScoreFilter] = useState('All');
  const [genderFilter, setGenderFilter] = useState('All');
  const [remarksFilter, setRemarksFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('All');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Loaded metadata & coordinators list
  const [allCoordinators, setAllCoordinators] = useState<any[]>([]);
  const [globalMetadata, setGlobalMetadata] = useState<{ countries?: string[]; positions?: string[]; projects?: string[]; tagsList?: string[] }>({});

  // Fetch available jobs, campaigns, WhatsApp templates, coordinators, and metadata
  useEffect(() => {
    fetchActiveJobs();
    fetchReactivationCampaigns();
    fetchTemplates();
    fetchCoordinators();
    fetchMetadata();
    loadCandidatesOnMount();
  }, []);

  const fetchCoordinators = () => {
    fetch('/api/coordinators')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setAllCoordinators(data);
        }
      })
      .catch(err => console.error('Error fetching coordinators:', err));
  };

  const fetchMetadata = () => {
    fetch('/api/metadata')
      .then(res => res.json())
      .then(data => {
        if (data) {
          setGlobalMetadata(data);
        }
      })
      .catch(err => console.error('Error fetching metadata:', err));
  };

  const loadCandidatesOnMount = async () => {
    try {
      const res = await fetch('/api/reactivation/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle: '',
          country: '',
          salary: '',
          experience: '',
          requirements: '',
          inactivityMonths: -1, // -1 means Show All Candidates (Active & Inactive)
          limit: -1, // -1 means All Profiles (Whole CRM - No Limit)
          gender: 'ALL',
          skipAI: true
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.candidates) {
          setMatchedCandidates(data.candidates);
          // By default, do not select any on mount so they can filter first
          setSelectedCandidateIds(new Set());
        }
      }
    } catch (err) {
      console.error('Error loading candidates on mount:', err);
    }
  };

  // Extract unique filter lists dynamically
  const targetCountriesList = useMemo(() => {
    const list = globalMetadata.countries && globalMetadata.countries.length > 0
      ? globalMetadata.countries
      : Array.from(new Set(matchedCandidates.map(l => l.country).filter(Boolean)));
    
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    list.forEach(c => {
      const lower = c.trim().toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        deduplicated.push(c.trim());
      }
    });
    return ['All', ...deduplicated.sort((a, b) => a.localeCompare(b))];
  }, [matchedCandidates, globalMetadata.countries]);

  const targetProjectsList = useMemo(() => {
    const list = globalMetadata.projects && globalMetadata.projects.length > 0
      ? globalMetadata.projects
      : Array.from(new Set(matchedCandidates.map(l => l.project).filter(Boolean)));
    
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    list.forEach(p => {
      const lower = p.trim().toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        deduplicated.push(p.trim());
      }
    });
    return ['All', ...deduplicated.sort((a, b) => a.localeCompare(b))];
  }, [matchedCandidates, globalMetadata.projects]);

  const targetPositionsList = useMemo(() => {
    const list = globalMetadata.positions && globalMetadata.positions.length > 0
      ? globalMetadata.positions
      : Array.from(new Set(matchedCandidates.map(l => l.position).filter(Boolean)));
    
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    list.forEach(p => {
      const lower = p.trim().toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        deduplicated.push(p.trim());
      }
    });
    return ['All', ...deduplicated.sort((a, b) => a.localeCompare(b))];
  }, [matchedCandidates, globalMetadata.positions]);

  const availableTagsList = useMemo(() => {
    const list = globalMetadata.tagsList && globalMetadata.tagsList.length > 0
      ? globalMetadata.tagsList
      : [];
    
    // Always include global metadata tags plus any tags actually assigned to the matched candidates
    const rawTags = [...list];
    matchedCandidates.forEach(l => {
      if (l.tags && Array.isArray(l.tags)) {
        l.tags.forEach(t => { if (t && t.trim()) rawTags.push(t.trim()); });
      }
    });
    
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    rawTags.forEach(t => {
      const lower = t.trim().toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        deduplicated.push(t.trim());
      }
    });
    return ['All', ...deduplicated.sort((a, b) => a.localeCompare(b))];
  }, [matchedCandidates, globalMetadata.tagsList]);

  // Option lists for SearchableSelect
  const countryOptions = useMemo(() => [
    { value: 'All', label: 'All Applied Countries' },
    ...targetCountriesList.filter(c => c !== 'All').map(country => ({
      value: country,
      label: `✈️ ${country.toUpperCase()}`
    }))
  ], [targetCountriesList]);

  const coordinatorOptions = useMemo(() => {
    const list = [
      { value: 'All', label: '👤 All Coordinators' },
      { value: 'Unassigned', label: '👤 Unassigned Only' }
    ];
    if (allCoordinators && allCoordinators.length > 0) {
      allCoordinators.forEach(coord => {
        list.push({
          value: coord.username,
          label: `👤 ${coord.displayName.toUpperCase()}`
        });
      });
    }
    return list;
  }, [allCoordinators]);

  const projectOptions = useMemo(() => [
    { value: 'All', label: 'All Projects' },
    ...targetProjectsList.filter(p => p !== 'All').map(proj => ({
      value: proj,
      label: `🎯 ${proj.toUpperCase()}`
    }))
  ], [targetProjectsList]);

  const positionOptions = useMemo(() => [
    { value: 'All', label: 'All Target Positions' },
    ...targetPositionsList.filter(p => p !== 'All').map(pos => ({
      value: pos,
      label: `💼 ${pos.toUpperCase()}`
    }))
  ], [targetPositionsList]);

  const tagOptions = useMemo(() => [
    { value: 'All', label: 'All Tags' },
    ...availableTagsList.filter(t => t !== 'All').map(tag => ({
      value: tag,
      label: `🏷️ ${tag}`
    }))
  ], [availableTagsList]);

  const fitScoreOptions = useMemo(() => [
    { value: 'All', label: 'All AI Quality Fit' },
    { value: 'high', label: '🥇 High Fit Quality' },
    { value: 'medium', label: '🥈 Medium Fit Quality' },
    { value: 'low', label: '🥉 Low Fit Quality' },
    { value: 'unqualified', label: '🛑 Unqualified / Spam' }
  ], []);

  const genderOptions = useMemo(() => [
    { value: 'All', label: 'All Genders' },
    { value: 'MALE', label: '👨 MALE' },
    { value: 'FEMALE', label: '👩 FEMALE' }
  ], []);

  const remarksOptions = useMemo(() => [
    { value: 'All', label: 'Remarks: All' },
    { value: 'remarks1', label: '💬 Has 1st Remarks' },
    { value: 'remarks2', label: '💬 Has 2nd Remarks' },
    { value: 'remarks3', label: '💬 Has 3rd Remarks' },
    { value: 'remarks1Only', label: '💬 Has 1st Remarks ONLY' },
    { value: 'remarks2Only', label: '💬 Has 2nd Remarks ONLY' },
    { value: 'remarks3Only', label: '💬 Has 3rd Remarks ONLY' },
    { value: 'noRemarks', label: '💬 No Remarks Added' },
    { value: 'allRemarks', label: '💬 Has All 3 Remarks' }
  ], []);

  const dateOptions = useMemo(() => [
    { value: 'All', label: '📅 All Dates' },
    { value: 'Today', label: '📅 Today' },
    { value: 'Yesterday', label: '📅 Yesterday' },
    { value: 'Last7Days', label: '📅 Last 7 Days' },
    { value: 'Last30Days', label: '📅 Last 30 Days' },
    { value: 'Custom', label: '📅 Custom Date Range...' }
  ], []);

  // Filter matchedCandidates to obtain filteredCandidates
  const filteredCandidates = useMemo(() => {
    return matchedCandidates.filter(lead => {
      // 1. Country Applied filter
      const matchesCountry = countryFilter === 'All' || 
        (lead.country && lead.country.trim().toLowerCase() === countryFilter.trim().toLowerCase());
      
      // 2. Hiring Project filter
      const matchesProject = projectFilter === 'All' || 
        (lead.project && lead.project.trim().toLowerCase() === projectFilter.trim().toLowerCase());

      // 3. Target Job Position filter
      const matchesPosition = positionFilter === 'All' || 
        (lead.position && lead.position.trim().toLowerCase() === positionFilter.trim().toLowerCase());

      // 4. Inbound Quality Fit score filter
      const matchesFit = fitScoreFilter === 'All' || 
        (lead.fitScore && lead.fitScore.trim().toLowerCase() === fitScoreFilter.trim().toLowerCase());

      // 5. Dynamic Tags filter
      const matchesTag = tagFilter === 'All' || 
        (lead.tags && lead.tags.some(t => t.trim().toLowerCase() === tagFilter.trim().toLowerCase()));

      // 6. Date Wise Filter
      let matchesDate = true;
      if (dateFilter !== 'All') {
        const leadTime = new Date(lead.createdAt || lead.entryDate || Date.now()).getTime();
        const startOfDay = (d: Date) => {
          const res = new Date(d);
          res.setHours(0,0,0,0);
          return res.getTime();
        };
        const endOfDay = (d: Date) => {
          const res = new Date(d);
          res.setHours(23,59,59,999);
          return res.getTime();
        };

        const today = new Date();
        if (dateFilter === 'Today') {
          matchesDate = leadTime >= startOfDay(today) && leadTime <= endOfDay(today);
        } else if (dateFilter === 'Yesterday') {
          const yesterday = new Date();
          yesterday.setDate(today.getDate() - 1);
          matchesDate = leadTime >= startOfDay(yesterday) && leadTime <= endOfDay(yesterday);
        } else if (dateFilter === 'Last7Days') {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(today.getDate() - 7);
          matchesDate = leadTime >= startOfDay(sevenDaysAgo) && leadTime <= endOfDay(today);
        } else if (dateFilter === 'Last30Days') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(today.getDate() - 30);
          matchesDate = leadTime >= startOfDay(thirtyDaysAgo) && leadTime <= endOfDay(today);
        } else if (dateFilter === 'Custom') {
          const start = customStartDate ? startOfDay(new Date(customStartDate)) : 0;
          const end = customEndDate ? endOfDay(new Date(customEndDate)) : Infinity;
          matchesDate = leadTime >= start && leadTime <= end;
        }
      }

      // 7. Coordinator Filter (only relevant for admin)
      const matchesCoordinator = 
        userRole !== 'admin' || 
        coordinatorFilter === 'All' || 
        (coordinatorFilter === 'Unassigned' ? !lead.assignedTo : (lead.assignedTo?.toLowerCase() === coordinatorFilter.toLowerCase() || lead.assignedTo === coordinatorFilter));

      // 8. Gender Filter
      let matchesGender = true;
      if (genderFilter !== 'All') {
        const g = String(lead.gender || '').toUpperCase().trim();
        const filterG = String(genderFilter).toUpperCase().trim();
        if (filterG === 'MALE' || filterG === 'M') {
          matchesGender = g === 'M' || g === 'MALE';
        } else if (filterG === 'FEMALE' || filterG === 'F') {
          matchesGender = g === 'F' || g === 'FEMALE';
        }
      }

      // 9. Remarks Filter
      let matchesRemarks = true;
      if (remarksFilter !== 'All') {
        const r1 = !!(lead.remarks1 && lead.remarks1.trim());
        const r2 = !!(lead.remarks2 && lead.remarks2.trim());
        const r3 = !!(lead.remarks3 && lead.remarks3.trim());

        if (remarksFilter === 'remarks1') {
          matchesRemarks = r1;
        } else if (remarksFilter === 'remarks2') {
          matchesRemarks = r2;
        } else if (remarksFilter === 'remarks3') {
          matchesRemarks = r3;
        } else if (remarksFilter === 'remarks1Only') {
          matchesRemarks = r1 && !r2 && !r3;
        } else if (remarksFilter === 'remarks2Only') {
          matchesRemarks = r2 && !r1 && !r3;
        } else if (remarksFilter === 'remarks3Only') {
          matchesRemarks = r3 && !r1 && !r2;
        } else if (remarksFilter === 'noRemarks') {
          matchesRemarks = !r1 && !r2 && !r3;
        } else if (remarksFilter === 'allRemarks') {
          matchesRemarks = r1 && r2 && r3;
        }
      }

      return matchesCountry && matchesProject && matchesPosition && matchesFit && matchesTag && matchesDate && matchesCoordinator && matchesGender && matchesRemarks;
    });
  }, [matchedCandidates, countryFilter, projectFilter, positionFilter, genderFilter, fitScoreFilter, tagFilter, dateFilter, customStartDate, customEndDate, userRole, coordinatorFilter, remarksFilter]);

  const fetchActiveJobs = () => {
    fetch('/api/jobs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setJobs(data.filter(j => j.isActive !== false));
        }
      })
      .catch(err => console.error('Error fetching jobs:', err));
  };

  const renderClientTemplate = (templateText: string, tplId: string, cand: any) => {
    let result = templateText;
    
    const resolveVar = (vName: string) => {
      const v = vName.trim().toLowerCase();
      const nameVal = cand.name ? cand.name.split(' ')[0] : 'Candidate';
      const countryVal = jobCountry || 'Gulf / Overseas';
      const positionVal = jobTitle || cand.position || 'Openings';
      const phoneVal = cand.phone || '';
      const serialNoVal = cand.serialNo || 'N/A';
      
      let coordinatorVal = cand.assignedTo || 'Maryada';
      if (coordinatorVal === 'admin') {
        coordinatorVal = 'Administrator';
      } else if (coordinatorVal && coordinatorVal.length > 0) {
        coordinatorVal = coordinatorVal.charAt(0).toUpperCase() + coordinatorVal.slice(1);
      }

      if (v === 'name') return nameVal;
      if (v === 'country') return countryVal;
      if (v === 'position') return positionVal;
      if (v === 'phone') return phoneVal;
      if (v === 'serialno') return serialNoVal;
      if (v === 'coordinator') return coordinatorVal;

      const lowerId = tplId.toLowerCase();
      const lowerText = templateText.toLowerCase();

      if (v === '1') {
        if (lowerId.includes('assign') || lowerText.includes('assist') || lowerText.includes('save')) {
          return coordinatorVal;
        }
        return nameVal;
      }
      if (v === '2') {
        if (lowerId.includes('assign') || lowerText.includes('assist')) {
          return phoneVal;
        }
        return positionVal;
      }
      if (v === '3') {
        if (lowerId.includes('assign') || lowerText.includes('assist')) {
          return nameVal;
        }
        return countryVal;
      }
      if (v === '4') {
        if (lowerId.includes('assign') || lowerText.includes('assist')) {
          return positionVal;
        }
        return jobSalary || '₹65,000';
      }
      if (v === '5') {
        return cand.experience || 'hospitality';
      }

      return '';
    };

    const regex = /\{\{([^}]+)\}\}/g;
    let match;
    const matches: string[] = [];
    while ((match = regex.exec(templateText)) !== null) {
      matches.push(match[1]);
    }

    const uniqueVariables = Array.from(new Set(matches));
    for (const v of uniqueVariables) {
      const val = resolveVar(v);
      const escapedVar = v.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const replaceRegex = new RegExp(`\\{\\{\\s*${escapedVar}\\s*\\}\\}`, 'gi');
      result = result.replace(replaceRegex, val);
    }

    return result;
  };

  const handleTemplateSelectChange = (tplId: string) => {
    setSelectedTemplateId(tplId);
    
    const matchedTpl = templates.find(t => t.id === tplId);
    if (!matchedTpl || !matchedTpl.text) return;

    setMatchedCandidates(prev => 
      prev.map(c => {
        const rendered = renderClientTemplate(matchedTpl.text, tplId, c);
        return {
          ...c,
          customMessage: rendered
        };
      })
    );
  };

  const fetchTemplates = () => {
    setIsTemplatesLoading(true);
    fetch('/api/whatsapp/templates')
      .then(res => res.json())
      .then(data => {
        if (data && Array.isArray(data.templates)) {
          setTemplates(data.templates);
          // Set default template
          const defTpl = data.templates.find((t: any) => t.id === 'tpl_urgent_intake' || t.id.includes('intake') || t.id.includes('reactivate'));
          if (defTpl) {
            setSelectedTemplateId(defTpl.id);
          } else if (data.templates.length > 0) {
            setSelectedTemplateId(data.templates[0].id);
          }
        }
      })
      .catch(err => console.error('Error fetching templates:', err))
      .finally(() => setIsTemplatesLoading(false));
  };

  const handleSyncTemplates = async () => {
    setIsSyncingTemplates(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      alert(data.message || 'Successfully synced templates from Meta Business!');
      fetchTemplates(); // Refresh template list
    } catch (err: any) {
      console.error('Error syncing templates:', err);
      alert(`Template sync failed: ${err.message}`);
    } finally {
      setIsSyncingTemplates(false);
    }
  };

  const fetchReactivationCampaigns = () => {
    setIsCampaignsLoading(true);
    fetch('/api/reactivation/campaigns')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setActiveCampaigns(data);
        }
      })
      .catch(err => console.error('Error fetching reactivation campaigns:', err))
      .finally(() => setIsCampaignsLoading(false));
  };

  // Autofill fields when selected job changes
  const handleJobChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedJobId(id);
    if (!id) return;

    const selected = jobs.find(j => j.id === id);
    if (selected) {
      setJobTitle(selected.title);
      setJobCountry(selected.country);
      setJobSalary(selected.salaryRange || '₹60,000 - ₹75,000');
      setJobExperience(selected.requirement.match(/\d+\s*(?:years?|yrs?)/gi)?.[0] || '2-3 years');
      setJobRequirements(selected.requirement);
    }
  };

  // Run AI Search on Old Database
  const handleScanOldDatabase = async () => {
    setIsScanning(true);
    setHasScanned(true);
    setCampaignLaunched(false);
    setLaunchSummary(null);
    setMatchedCandidates([]);
    setSelectedCandidateIds(new Set());

    const steps = [
      'Retrieving stale database archives (contact > 3-12 months)...',
      'Filtering out active profiles under active placement negotiation...',
      'Matching credentials with position tags & experience criteria...',
      'Invoking Gemini 3.8 to rank candidate capabilities against vacancy terms...',
      'Formulating highly optimized custom WhatsApp greeting messages...'
    ];

    let stepIdx = 0;
    setScanStep(steps[0]);
    const stepInterval = setInterval(() => {
      stepIdx++;
      if (stepIdx < steps.length) {
        setScanStep(steps[stepIdx]);
      }
    }, 1200);

    try {
      const res = await fetch('/api/reactivation/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle,
          country: jobCountry,
          salary: jobSalary,
          experience: jobExperience,
          requirements: jobRequirements,
          inactivityMonths,
          limit: limitCount,
          gender: jobGender,
          candidateIds: isDefaultFilters ? undefined : filteredCandidates.map(c => c.id)
        })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();
      if (data.candidates) {
        const activeTpl = templates.find(t => t.id === selectedTemplateId);
        const candidatesWithTpl = data.candidates.map((c: any) => {
          if (activeTpl && activeTpl.text) {
            return {
              ...c,
              customMessage: renderClientTemplate(activeTpl.text, selectedTemplateId, c)
            };
          }
          return c;
        });
        setMatchedCandidates(candidatesWithTpl);
        // Auto-select candidates with match score >= 70
        const autoSelected = new Set<string>();
        candidatesWithTpl.forEach((c: any) => {
          if (c.matchScore >= 70) {
            autoSelected.add(c.id);
          }
        });
        setSelectedCandidateIds(autoSelected);
      }
    } catch (err: any) {
      console.error('Error scanning old database:', err);
      alert(`Scan failed: ${err.message}`);
    } finally {
      clearInterval(stepInterval);
      setIsScanning(false);
    }
  };

  // Toggle selection
  const handleToggleSelectCandidate = (id: string) => {
    const updated = new Set(selectedCandidateIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedCandidateIds(updated);
  };

  // Toggle all visible candidates
  const handleToggleSelectAll = () => {
    const visibleIds = filteredCandidates.map(c => c.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedCandidateIds.has(id));
    
    const updated = new Set(selectedCandidateIds);
    if (allVisibleSelected) {
      // Deselect all visible
      visibleIds.forEach(id => updated.delete(id));
    } else {
      // Select all visible
      visibleIds.forEach(id => updated.add(id));
    }
    setSelectedCandidateIds(updated);
  };

  // Edit custom message for specific candidate inline
  const handleUpdateMessageText = (id: string, text: string) => {
    setMatchedCandidates(prev => 
      prev.map(c => c.id === id ? { ...c, customMessage: text } : c)
    );
  };

  // Launch campaign (Send WhatsApp Outreach)
  const handleLaunchCampaign = async () => {
    const visibleSelectedTargets = filteredCandidates.filter(c => selectedCandidateIds.has(c.id));
    if (visibleSelectedTargets.length === 0) {
      alert('Please select at least 1 candidate to launch the outreach campaign.');
      return;
    }

    if (!window.confirm(`Are you sure you want to launch the WhatsApp Reactivation Campaign for ${visibleSelectedTargets.length} candidate(s)? This will send personalized messages instantly.`)) {
      return;
    }

    setIsLaunching(true);
    try {
      const targets = visibleSelectedTargets.map(c => ({
        leadId: c.id,
        message: c.customMessage,
        phone: c.phone,
        name: c.name
      }));

      const res = await fetch('/api/reactivation/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle,
          country: jobCountry,
          salary: jobSalary,
          targets,
          templateId: selectedTemplateId
        })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      setLaunchSummary({
        sentCount: visibleSelectedTargets.length,
        jobTitle
      });
      setCampaignLaunched(true);
      setMatchedCandidates([]);
      setSelectedCandidateIds(new Set());
      fetchReactivationCampaigns(); // Refresh campaigns dashboard
    } catch (err: any) {
      console.error('Error launching campaign:', err);
      alert(`Failed to launch campaign: ${err.message}`);
    } finally {
      setIsLaunching(false);
    }
  };

  // Force simulation of candidate replying YES
  const handleSimulateCandidateReply = async (leadId: string, replyText: string) => {
    try {
      const res = await fetch('/api/reactivation/simulate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, replyText })
      });
      if (res.ok) {
        alert(`Inbound message "${replyText}" successfully simulated for candidate! AI is executing pre-screening conversation in background.`);
        fetchReactivationCampaigns();
      } else {
        throw new Error(await res.text());
      }
    } catch (err: any) {
      alert(`Simulation failed: ${err.message}`);
    }
  };

  // Calculate stats for campaign list
  const totalCampaignLeads = activeCampaigns.reduce((sum, c) => sum + (c.leadsCount || 0), 0);
  const totalReplies = activeCampaigns.reduce((sum, c) => sum + (c.repliedCount || 0), 0);
  const totalInterested = activeCampaigns.reduce((sum, c) => sum + (c.interestedCount || 0), 0);
  const totalQualified = activeCampaigns.reduce((sum, c) => sum + (c.qualifiedCount || 0), 0);

  const isDefaultFilters = 
    countryFilter === 'All' &&
    coordinatorFilter === 'All' &&
    projectFilter === 'All' &&
    positionFilter === 'All' &&
    tagFilter === 'All' &&
    fitScoreFilter === 'All' &&
    genderFilter === 'All' &&
    remarksFilter === 'All' &&
    dateFilter === 'All';

  return (
    <div className="space-y-6 text-slate-100" id="candidate-reactivation-view">
      
      {/* Title Header */}
      <div className="bg-slate-900/50 rounded-3xl border border-slate-800 p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center border-b border-slate-800 pb-4">
          <div className="text-left">
            <h2 className="text-sm font-black text-slate-100 uppercase tracking-widest flex items-center gap-2.5 font-display">
              <Sparkles className="h-5 w-5 text-indigo-400 animate-pulse" />
              Broadcast Hub (AI Outreach)
            </h2>
            <p className="text-[11px] text-slate-400 font-bold mt-1">
              Automatically identify stale, inactive placement candidates from your archives, match them against new active vacancies, and engage them on WhatsApp.
            </p>
          </div>
          <span className="text-[10px] bg-indigo-950/40 border border-indigo-900/30 px-3 py-1.5 rounded-full font-black text-indigo-400 uppercase tracking-wider font-mono">
            Powered by Gemini 3.8 Smart Chat Agent
          </span>
        </div>

        {/* STEP 1: SEARCH & FILTER CRM POOL */}
        <div className="pt-5 space-y-3.5 text-left border-b border-slate-800/60 pb-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-indigo-400 uppercase tracking-widest leading-none select-none font-mono">
              <Filter className="h-3.5 w-3.5" /> 1. SEARCH & FILTER CRM POOL ({filteredCandidates.length} Matches / {matchedCandidates.length} Total):
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              {matchedCandidates.length < 1500 && (
                <button
                  type="button"
                  onClick={() => {
                    setHasScanned(true);
                    loadCandidatesOnMount();
                  }}
                  className="text-[9px] font-black text-indigo-400 hover:text-indigo-300 uppercase tracking-widest flex items-center gap-1.5 bg-indigo-950/25 px-2.5 py-1 rounded-lg cursor-pointer transition-all border border-indigo-500/20 active:scale-95 font-mono"
                >
                  🔄 Reload Full CRM Pool
                </button>
              )}

              {(countryFilter !== 'All' || coordinatorFilter !== 'All' || projectFilter !== 'All' || positionFilter !== 'All' || tagFilter !== 'All' || fitScoreFilter !== 'All' || genderFilter !== 'All' || remarksFilter !== 'All' || dateFilter !== 'All') && (
                <button
                  type="button"
                  onClick={() => {
                    setCountryFilter('All');
                    setCoordinatorFilter('All');
                    setProjectFilter('All');
                    setPositionFilter('All');
                    setTagFilter('All');
                    setFitScoreFilter('All');
                    setGenderFilter('All');
                    setRemarksFilter('All');
                    setDateFilter('All');
                    setCustomStartDate('');
                    setCustomEndDate('');
                  }}
                  className="text-[9px] font-black text-red-400 hover:text-red-300 uppercase tracking-widest flex items-center gap-1.5 bg-red-950/20 px-2.5 py-1 rounded-lg cursor-pointer transition-all border border-red-500/20 active:scale-95 font-mono"
                >
                  ✕ Clear All Filters
                </button>
              )}
            </div>
          </div>

          {/* Filters Responsive Grid - 9 Filters total */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2 w-full">
            
            {/* Country filter */}
            <div className="w-full">
              <label className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-mono">Country</label>
              <SearchableSelect
                value={countryFilter}
                onChange={setCountryFilter}
                options={countryOptions}
                className="w-full text-[10px] px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer uppercase font-mono"
              />
            </div>

            {/* Coordinator Filter */}
            <div className="w-full">
              <label className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-mono">Coordinator</label>
              <SearchableSelect
                value={coordinatorFilter}
                onChange={setCoordinatorFilter}
                options={coordinatorOptions}
                className="w-full text-[10px] px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer uppercase font-mono"
              />
            </div>

            {/* Hiring Project filter */}
            <div className="w-full">
              <label className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-mono">Project</label>
              <SearchableSelect
                value={projectFilter}
                onChange={setProjectFilter}
                options={projectOptions}
                className="w-full text-[10px] px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer uppercase font-mono"
              />
            </div>

            {/* Target Job Position Filter */}
            <div className="w-full">
              <label className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-mono">Position</label>
              <SearchableSelect
                value={positionFilter}
                onChange={setPositionFilter}
                options={positionOptions}
                className="w-full text-[10px] px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer uppercase font-mono"
              />
            </div>

            {/* Tags Filter Dropdown */}
            <div className="w-full">
              <label className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-mono">Tag</label>
              <SearchableSelect
                value={tagFilter}
                onChange={setTagFilter}
                options={tagOptions}
                className="w-full text-[10px] px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer uppercase font-mono"
              />
            </div>

            {/* Fit Score Filter */}
            <div className="w-full">
              <label className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-mono">Fit Score</label>
              <SearchableSelect
                value={fitScoreFilter}
                onChange={setFitScoreFilter}
                options={fitScoreOptions}
                className="w-full text-[10px] px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer uppercase font-mono"
              />
            </div>

            {/* Gender Filter */}
            <div className="w-full">
              <label className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-mono">Gender</label>
              <SearchableSelect
                value={genderFilter}
                onChange={setGenderFilter}
                options={genderOptions}
                className="w-full text-[10px] px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer uppercase font-mono"
              />
            </div>

            {/* Remarks Status Filter */}
            <div className="w-full">
              <label className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-mono">Remarks Status</label>
              <SearchableSelect
                value={remarksFilter}
                onChange={setRemarksFilter}
                options={remarksOptions}
                className="w-full text-[10px] px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer uppercase font-mono"
              />
            </div>

            {/* Date wise Period filter */}
            <div className="w-full">
              <label className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-wider mb-1 font-mono">Date Period</label>
              <SearchableSelect
                value={dateFilter}
                onChange={setDateFilter}
                options={dateOptions}
                className="w-full text-[10px] px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer uppercase font-mono"
              />
            </div>

          </div>

          {/* Custom Date Range selector if Custom is selected */}
          {dateFilter === 'Custom' && (
            <div className="flex flex-wrap items-center gap-2.5 p-3.5 bg-slate-950 rounded-xl border border-slate-800/80 w-fit text-xs animate-fade-in mt-1">
              <span className="font-extrabold text-[10px] text-indigo-400 uppercase tracking-wider font-mono">Custom Range:</span>
              <input 
                type="date" 
                value={customStartDate} 
                onChange={e => setCustomStartDate(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs focus:border-indigo-500 outline-none font-mono text-slate-300"
              />
              <span className="text-slate-500">to</span>
              <input 
                type="date" 
                value={customEndDate} 
                onChange={e => setCustomEndDate(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs focus:border-indigo-500 outline-none font-mono text-slate-300"
              />
            </div>
          )}
        </div>

        {/* STEP 2: JOB VACANCY & SCAN PARAMETERS PANEL */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-5">
          {/* Left: Input parameters */}
          <div className="lg:col-span-8 space-y-4 text-left">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                  2. Match against Vacancy / Active Job
                </label>
                <select
                  value={selectedJobId}
                  onChange={handleJobChange}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:border-indigo-500 outline-none transition-all font-mono"
                >
                  <option value="">-- Custom Vacancy (Type Details Below) --</option>
                  {jobs.map(job => (
                    <option key={job.id} value={job.id}>
                      💼 {job.title} — {job.country} ({job.salaryRange || 'N/A'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                    Inactivity Months
                  </label>
                  <select
                    value={inactivityMonths}
                    onChange={(e) => setInactivityMonths(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:border-indigo-500 outline-none transition-all font-mono"
                  >
                    <option value={-1}>Show All Candidates (Active & Inactive)</option>
                    <option value={1}>1+ Month Inactive</option>
                    <option value={3}>3+ Months Inactive</option>
                    <option value={6}>6+ Months Inactive (Default)</option>
                    <option value={12}>12+ Months Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1.5">
                    Max Candidates
                  </label>
                  <select
                    value={limitCount}
                    onChange={(e) => setLimitCount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:border-indigo-500 outline-none transition-all font-mono"
                  >
                    <option value={10}>10 Profiles</option>
                    <option value={30}>30 Profiles</option>
                    <option value={50}>50 Profiles</option>
                    <option value={100}>100 Profiles</option>
                    <option value={250}>250 Profiles</option>
                    <option value={500}>500 Profiles</option>
                    <option value={1000}>1000 Profiles</option>
                    <option value={-1}>All Profiles (Whole CRM)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Custom Vacancy details */}
            <div className="border border-slate-800/60 bg-slate-950/40 rounded-2xl p-4 space-y-3.5">
              <h3 className="text-[10px] font-black uppercase text-indigo-400 tracking-wider">Vacancy Details Configuration</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Position / Title</label>
                  <input 
                    type="text" 
                    value={jobTitle} 
                    onChange={e => setJobTitle(e.target.value)} 
                    placeholder="e.g. Hotel Supervisor"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Destination Country</label>
                  <input 
                    type="text" 
                    value={jobCountry} 
                    onChange={e => setJobCountry(e.target.value)} 
                    placeholder="e.g. Dubai"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Monthly Salary Offered</label>
                  <input 
                    type="text" 
                    value={jobSalary} 
                    onChange={e => setJobSalary(e.target.value)} 
                    placeholder="e.g. ₹65,000/month + accommodation"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-1">
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Required Experience</label>
                  <input 
                    type="text" 
                    value={jobExperience} 
                    onChange={e => setJobExperience(e.target.value)} 
                    placeholder="e.g. 3 years"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
                <div className="md:col-span-1">
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Target Gender</label>
                  <select
                    value={jobGender}
                    onChange={e => setJobGender(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 text-slate-200 outline-none font-mono"
                  >
                    <option value="ALL">👫 All Genders</option>
                    <option value="MALE">👨 Male Only</option>
                    <option value="FEMALE">👩 Female Only</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] text-slate-400 font-bold mb-1">Requirements / Skill Tags</label>
                  <input 
                    type="text" 
                    value={jobRequirements} 
                    onChange={e => setJobRequirements(e.target.value)} 
                    placeholder="e.g. Leadership, guest relations, fluent English, luxury hospitality experience."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Right: Explainer & Action Button */}
          <div className="lg:col-span-4 flex flex-col justify-between border-l border-slate-800 pl-6 text-left">
            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase text-indigo-400 tracking-wider">Reactivation Blueprint</h4>
              <ul className="text-[11px] text-slate-300 space-y-2 list-disc list-inside">
                <li>Processes the filtered pool of candidates with no outbound/inbound texts.</li>
                <li>Uses AI to analyze their past profile resumes, remarks, and logged positions.</li>
                <li>Shortlists best suitability fits and drafts targeted WhatsApp hooks.</li>
                <li><strong>Interactive AI chat</strong>: Gemini handles replies, pre-screens credentials, and automatically shortlists candidates in the Pipeline!</li>
              </ul>
            </div>

            <button
              onClick={handleScanOldDatabase}
              disabled={isScanning}
              className="mt-6 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-3 rounded-xl transition duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isScanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Scanning Database...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  <span>Scan Old Database</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Scan Status Steps */}
        {isScanning && (
          <div className="mt-4 bg-slate-950/80 border border-slate-800 p-3 rounded-xl text-left flex items-center gap-2.5 animate-pulse">
            <Loader2 className="h-4 w-4 text-indigo-400 animate-spin shrink-0" />
            <span className="text-[11px] font-mono font-black text-indigo-300 uppercase tracking-widest">{scanStep}</span>
          </div>
        )}
      </div>

      {/* Campaign Success Notification */}
      {campaignLaunched && launchSummary && (
        <div className="bg-emerald-950/40 border border-emerald-900/60 p-5 rounded-3xl text-left flex gap-4 items-center">
          <div className="h-12 w-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-400 border border-emerald-500/20 shrink-0">
            <CheckCircle className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-100 uppercase tracking-wider">Campaign Dispatched Successfully!</h3>
            <p className="text-xs text-slate-300 mt-1">
              Personalized WhatsApp outreach sent to <strong>{launchSummary.sentCount}</strong> suitable candidates regarding the <strong>{launchSummary.jobTitle}</strong> opening.
            </p>
            <p className="text-[10px] text-emerald-400 font-mono mt-1 font-bold">
              AI pre-screening chatbot is now active on their replies. The CRM will automatically notify you and shortlist candidates who reply YES.
            </p>
          </div>
        </div>
      )}

      {/* Scan Results Panel */}
      {matchedCandidates.length > 0 && (
        <div className="bg-slate-900/40 rounded-3xl border border-slate-800 p-6 shadow-xl text-left space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-xs font-black uppercase text-indigo-400 tracking-wider">
                Matched Stale Candidates ({filteredCandidates.length} matches / {matchedCandidates.length} total found)
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Review suitability, select targets, edit their custom WhatsApp hook, and initiate blast.</p>
            </div>
            
            <div className="flex gap-2.5 mt-3 sm:mt-0">
              <button
                onClick={handleToggleSelectAll}
                className="text-[11px] bg-slate-950 border border-slate-800 hover:bg-slate-800 px-3.5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer"
              >
                {filteredCandidates.length > 0 && filteredCandidates.every(c => selectedCandidateIds.has(c.id)) ? 'Deselect All' : 'Select All'}
              </button>
              
              <button
                onClick={handleLaunchCampaign}
                disabled={isLaunching || filteredCandidates.filter(c => selectedCandidateIds.has(c.id)).length === 0}
                className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl font-black uppercase tracking-wider flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
              >
                {isLaunching ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Launching...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Launch Blast ({filteredCandidates.filter(c => selectedCandidateIds.has(c.id)).length})</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* WhatsApp Template Selector & Sync Tool */}
          <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-2xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-[11px] font-black uppercase text-indigo-400 tracking-wider">
                  📢 WhatsApp Cloud Template for Outreach
                </h4>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Select the Meta-approved template for this broadcast blast. Variable placeholders will be auto-replaced.
                </p>
              </div>

              <button
                onClick={handleSyncTemplates}
                disabled={isSyncingTemplates}
                className="text-[10px] bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSyncingTemplates ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                    <span>Syncing Meta...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Sync from Meta</span>
                  </>
                )}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <label className="block text-[10px] text-slate-400 font-bold mb-1">Outreach Template</label>
                {isTemplatesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-2.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading templates...</span>
                  </div>
                ) : (
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleTemplateSelectChange(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-100 focus:border-indigo-500 outline-none font-mono"
                  >
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.title || t.id}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="md:col-span-2 bg-slate-950 border border-slate-800/80 p-3 rounded-lg text-xs">
                <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider block mb-1">
                  Template Body Preview
                </span>
                <p className="text-slate-300 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                  {templates.find(t => t.id === selectedTemplateId)?.text || 'No template selected or available.'}
                </p>
              </div>
            </div>
          </div>



          {/* Table list */}
          {isDefaultFilters && !hasScanned ? (
            <div className="text-center py-10 text-slate-500 text-[11px] italic bg-slate-950/20 rounded-2xl border border-slate-800/40">
              Please click "Scan Old Database" or apply any directory filters above to explore candidate profiles.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-950/20">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/60 border-b border-slate-800/80">
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[5%] text-center">Select</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[35%] min-w-[280px]">Candidate Details</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[10%] text-center">Inactivity</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[10%] text-center">Coordinator</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[12%] text-center">Match Score</th>
                  <th className="p-3 text-[10px] font-mono uppercase text-slate-400 w-[28%] min-w-[320px]">Personalized Hook (Edit Inline)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {filteredCandidates.map(c => {
                  const isSelected = selectedCandidateIds.has(c.id);
                  return (
                    <tr 
                      key={c.id} 
                      className={`hover:bg-slate-900/30 transition-colors ${isSelected ? 'bg-indigo-500/5' : ''}`}
                    >
                      {/* Checkbox */}
                      <td className="p-3 text-center">
                        <button
                          onClick={() => handleToggleSelectCandidate(c.id)}
                          className="text-slate-400 hover:text-indigo-400 transition"
                        >
                          {isSelected ? (
                            <CheckSquare className="h-4.5 w-4.5 text-indigo-500" />
                          ) : (
                            <Square className="h-4.5 w-4.5" />
                          )}
                        </button>
                      </td>

                      {/* Details */}
                      <td className="p-3 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span 
                            onClick={() => onSelectLead(c)} 
                            className="text-xs font-black text-indigo-400 hover:underline cursor-pointer"
                          >
                            {c.name}
                          </span>
                          <span className="text-[10px] text-slate-400">({c.phone})</span>
                        </div>
                        <div className="text-[10px] text-slate-300 flex flex-wrap gap-2">
                          <span>👤 {c.gender}</span>
                          <span>•</span>
                          <span>🎂 {c.age || 'N/A'} yrs</span>
                          <span>•</span>
                          <span>📁 {c.experience || 'Fresh criteria'}</span>
                          <span>•</span>
                          <span>🎯 {c.position}</span>
                        </div>
                        {c.tags && c.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {c.tags.map((tag, tIdx) => (
                              <span key={tIdx} className="bg-slate-800 text-slate-300 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-slate-700">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        {c.adminRemarks && (
                          <div className="text-[9px] text-slate-500 bg-slate-900/50 px-2 py-0.5 rounded-md inline-block max-w-sm truncate mt-1">
                            Remarks: {c.adminRemarks}
                          </div>
                        )}
                      </td>

                      {/* Last contacted */}
                      <td className="p-3 text-center">
                        <span className="text-[10px] font-mono bg-slate-900 px-2 py-1 rounded-md text-amber-500/90 border border-amber-500/10 flex items-center justify-center gap-1">
                          <Clock className="h-3 w-3" />
                          {c.inactivityText || `${c.lastContactedMonths}m ago`}
                        </span>
                      </td>

                      {/* Coordinator */}
                      <td className="p-3 text-center">
                        <span className="text-[10px] font-mono font-bold bg-slate-900/60 px-2.5 py-1 rounded-md text-indigo-300 border border-indigo-500/10 inline-block max-w-[110px] truncate" title={c.assignedTo || 'Unassigned'}>
                          👤 {c.assignedTo && c.assignedTo !== 'unassigned' ? `@${c.assignedTo}` : 'Unassigned'}
                        </span>
                      </td>

                       {/* Match Score */}
                      <td className="p-3 text-center">
                        <div className="flex flex-col items-center justify-center gap-1.5 py-1">
                          <span className={`inline-block text-xs font-mono font-black px-2.5 py-1 rounded-md border ${
                            c.matchScore >= 80 
                              ? 'bg-emerald-950/50 text-emerald-400 border-emerald-500/20' 
                              : c.matchScore >= 50 
                                ? 'bg-amber-950/50 text-amber-400 border-amber-500/20' 
                                : c.matchScore >= 30 
                                  ? 'bg-rose-950/50 text-rose-400 border-rose-500/20' 
                                  : 'bg-slate-900/60 text-slate-400 border-slate-800/80'
                          }`}>
                            {c.matchScore}%
                          </span>
                          <p className="text-[9px] text-slate-400 leading-normal max-w-[130px] mx-auto whitespace-normal break-words text-center" title={c.matchReason}>
                            {c.matchReason}
                          </p>
                        </div>
                      </td>

                      {/* Hook editor */}
                      <td className="p-3">
                        <div className="flex gap-2">
                          <textarea
                            value={c.customMessage}
                            onChange={(e) => handleUpdateMessageText(c.id, e.target.value)}
                            rows={4}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-[11px] focus:border-indigo-500 outline-none font-sans text-slate-200 resize-y leading-relaxed"
                          />
                        </div>
                      </td>

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}

      {/* Campaigns Monitoring Dashboard */}
      <div className="bg-slate-900/40 rounded-3xl border border-slate-800 p-6 shadow-xl text-left space-y-4">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-xs font-black uppercase text-indigo-400 tracking-wider">Active Reactivation Campaigns</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">Real-time status of candidate responses, chatbot progress, and interested shortlist.</p>
          </div>
          
          <button
            onClick={fetchReactivationCampaigns}
            className="text-[11px] bg-slate-950 border border-slate-800 hover:bg-slate-800 px-3.5 py-2 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
            <span>Refresh Stats</span>
          </button>
        </div>

        {/* Active Campaigns list */}
        {isCampaignsLoading ? (
          <div className="py-12 flex justify-center items-center gap-2">
            <Loader2 className="h-5 w-5 text-indigo-400 animate-spin" />
            <p className="text-xs text-slate-400">Loading campaign records...</p>
          </div>
        ) : activeCampaigns.length === 0 ? (
          <div className="py-12 text-center text-slate-400 border border-slate-800/50 rounded-2xl bg-slate-950/10">
            <BadgeAlert className="h-8 w-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs font-bold">No active reactivation campaigns found.</p>
            <p className="text-[10px] text-slate-500 mt-1">Select a vacancy above and launch an AI campaign to populate records.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeCampaigns.map((campaign, idx) => {
              const isExpanded = expandedCampaignName === campaign.name;

              // Filter candidates for list rendering based on selected badge sub-filter
              const filteredCampaignCandidates = (campaign.candidates || []).filter((cand: any) => {
                if (campaignSubFilter === 'replied') {
                  return cand.hasReplied === true;
                }
                if (campaignSubFilter === 'qualified') {
                  return cand.reactivationStatus === 'qualified';
                }
                return true; // 'all'
              });

              return (
                <div 
                  key={campaign.name} 
                  className="border border-slate-800 bg-slate-950/30 rounded-2xl overflow-hidden transition-all duration-200"
                >
                  {/* Header Row (Click to toggle expansion) */}
                  <div 
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedCampaignName(null);
                        setCampaignSubFilter('all');
                      } else {
                        setExpandedCampaignName(campaign.name);
                        setCampaignSubFilter('all');
                      }
                    }}
                    className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-4 hover:bg-slate-900/30 transition cursor-pointer select-none"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 md:gap-6 text-left">
                      <div>
                        <h4 className="text-xs font-black text-indigo-300 uppercase tracking-wide flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-indigo-400" />
                          {campaign.name}
                        </h4>
                        <p className="text-[9px] font-mono text-slate-500 mt-0.5">Created: {campaign.createdAt ? new Date(campaign.createdAt).toLocaleDateString() : 'N/A'}</p>
                      </div>

                      {/* Clickable Badges next to campaign name */}
                      <div className="flex flex-wrap items-center gap-2 font-mono">
                        {/* Sent Badge */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isExpanded) {
                              setExpandedCampaignName(campaign.name);
                            }
                            setCampaignSubFilter('all');
                          }}
                          className={`text-[9.5px] px-2.5 py-1 rounded-lg border font-bold flex items-center gap-1.5 transition active:scale-95 cursor-pointer ${
                            isExpanded && campaignSubFilter === 'all'
                              ? 'ring-2 ring-indigo-500 bg-indigo-500/20 border-indigo-500 text-indigo-300'
                              : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          🎯 {campaign.leadsCount} outreach sent
                        </button>

                        {/* Replied Badge */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isExpanded) {
                              setExpandedCampaignName(campaign.name);
                            }
                            setCampaignSubFilter('replied');
                          }}
                          className={`text-[9.5px] px-2.5 py-1 rounded-lg border font-bold flex items-center gap-1.5 transition active:scale-95 cursor-pointer ${
                            isExpanded && campaignSubFilter === 'replied'
                              ? 'ring-2 ring-amber-500 bg-amber-500/20 border-amber-500 text-amber-300'
                              : 'bg-slate-900/80 border-slate-800 text-amber-400 hover:bg-slate-800'
                          }`}
                        >
                          💬 {campaign.repliedCount || 0} replied ({campaign.leadsCount > 0 ? Math.round(((campaign.repliedCount || 0)/campaign.leadsCount)*100) : 0}%)
                        </button>

                        {/* Qualified Badge */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isExpanded) {
                              setExpandedCampaignName(campaign.name);
                            }
                            setCampaignSubFilter('qualified');
                          }}
                          className={`text-[9.5px] px-2.5 py-1 rounded-lg border font-bold flex items-center gap-1.5 transition active:scale-95 cursor-pointer ${
                            isExpanded && campaignSubFilter === 'qualified'
                              ? 'ring-2 ring-emerald-500 bg-emerald-500/20 border-emerald-500 text-emerald-300'
                              : 'bg-slate-900/80 border-slate-800 text-emerald-400 hover:bg-slate-800'
                          }`}
                        >
                          ⭐ {campaign.qualifiedCount || 0} qualified
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2.5 shrink-0 self-end md:self-auto">
                      <ChevronRight className={`h-4 w-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-90 text-indigo-400' : ''}`} />
                    </div>
                  </div>

                  {/* Collapsible Candidate list details */}
                  {isExpanded && (
                    <div className="p-4 border-t border-slate-800/80 bg-slate-950/20 space-y-4 animate-fade-in">
                      {/* Active filter category indicator */}
                      <div className="text-[10px] text-slate-400 flex items-center justify-between pb-2 border-b border-slate-800/60 font-mono select-none">
                        <span>
                          Active Category Filter: <strong className="uppercase font-bold tracking-wide text-indigo-400">{campaignSubFilter === 'all' ? 'All Candidates' : campaignSubFilter === 'replied' ? 'Replied' : 'Qualified'}</strong>
                        </span>
                        <span>
                          Showing {filteredCampaignCandidates.length} of {campaign.candidates?.length || 0} profiles
                        </span>
                      </div>

                      {/* Candidate list under this campaign */}
                      <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                        {filteredCampaignCandidates.length === 0 ? (
                          <div className="text-center py-6 text-slate-500 text-[10.5px] italic bg-slate-950/40 rounded-xl border border-slate-800/40">
                            No candidates match the selected sub-filter ({campaignSubFilter === 'replied' ? 'Replied' : 'Qualified'}).
                          </div>
                        ) : (
                          filteredCampaignCandidates.map((cand: any) => {
                            // Compute simplified YES/NO response badge
                            let responseBadge = null;
                            const statusVal = cand.reactivationStatus || 'sent';

                            if (statusVal === 'qualified' || statusVal === 'interested') {
                              responseBadge = (
                                <span className="text-[9.5px] bg-emerald-950/45 border border-emerald-900/60 text-emerald-400 font-extrabold uppercase px-2 py-0.5 rounded-lg flex items-center gap-1.5 shadow-sm">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                  YES (Interested)
                                </span>
                              );
                            } else if (statusVal === 'unqualified' || statusVal === 'not_interested') {
                              responseBadge = (
                                <span className="text-[9.5px] bg-rose-950/45 border border-rose-900/60 text-rose-400 font-extrabold uppercase px-2 py-0.5 rounded-lg flex items-center gap-1.5 shadow-sm">
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                                  NO (Not Interested)
                                </span>
                              );
                            } else if (statusVal === 'replied') {
                              responseBadge = (
                                <span className="text-[9.5px] bg-amber-950/45 border border-amber-900/60 text-amber-400 font-extrabold uppercase px-2 py-0.5 rounded-lg flex items-center gap-1.5 shadow-sm">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                                  Replied (Pending AI)
                                </span>
                              );
                            } else if (statusVal === 'failed') {
                              responseBadge = (
                                <span className="text-[9.5px] bg-rose-950/45 border border-rose-900/60 text-rose-500 font-extrabold uppercase px-2 py-0.5 rounded-lg flex items-center gap-1.5 shadow-sm">
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-600 animate-pulse"></span>
                                  Failed to Deliver
                                </span>
                              );
                            } else {
                              responseBadge = (
                                <span className="text-[9.5px] bg-slate-900 border border-slate-800 text-slate-400 font-extrabold uppercase px-2 py-0.5 rounded-lg flex items-center gap-1.5 shadow-sm">
                                  <span className="h-1.5 w-1.5 rounded-full bg-slate-600"></span>
                                  Outreach Sent
                                </span>
                              );
                            }

                            return (
                              <div 
                                key={cand.id}
                                className="bg-slate-950/60 hover:bg-slate-900/50 border border-slate-800/80 p-3 rounded-xl flex flex-col md:flex-row justify-between md:items-center gap-4 transition"
                              >
                                {/* Name/Details */}
                                <div className="text-left space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span 
                                      onClick={() => onSelectLead(cand)}
                                      className="text-xs font-black text-indigo-400 hover:underline cursor-pointer"
                                    >
                                      {cand.name}
                                    </span>
                                    <span className="text-[10px] text-slate-400">({cand.phone})</span>
                                    {responseBadge}
                                  </div>
                                  
                                  {cand.tags && cand.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {cand.tags.map((tag: string, tIdx: number) => (
                                        <span key={tIdx} className="bg-slate-800 text-slate-300 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-slate-700">
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  
                                  {/* Messages preview */}
                                  {cand.messages && cand.messages.length > 0 ? (
                                    <div className="text-[10px] bg-slate-900/40 p-1.5 rounded-lg border border-slate-800/40 max-w-xl">
                                      <span className="font-bold text-indigo-300">Last message:</span>{' '}
                                      <span className="text-slate-300 italic">
                                        "{cand.messages[cand.messages.length - 1]?.text}"
                                      </span>
                                      <span className="text-[8px] text-slate-500 ml-1.5 font-mono">
                                        ({new Date(cand.messages[cand.messages.length - 1]?.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                                      </span>
                                      {cand.messages[cand.messages.length - 1]?.status === 'failed' && (
                                        <div className="text-[9.5px] text-rose-400 mt-1 font-mono flex items-center gap-1.5 font-bold">
                                          <AlertCircle className="h-3.5 w-3.5 animate-pulse shrink-0" />
                                          <span>Error: {cand.messages[cand.messages.length - 1]?.errorDetails || 'Meta Delivery Fail'}</span>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-slate-500 italic">No incoming response yet. Waiting on WhatsApp hook...</span>
                                  )}
                                </div>

                                {/* Quick actions */}
                                <div className="flex items-center gap-2.5 shrink-0 self-end md:self-auto">
                                  <button
                                    onClick={() => onSelectLead(cand)}
                                    className="text-[9.5px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 cursor-pointer"
                                  >
                                    <span>Open Profile</span>
                                    <ChevronRight className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
