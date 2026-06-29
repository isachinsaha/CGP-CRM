import React, { useState, useMemo } from 'react';
import { Lead, LeadStage, FitScore, Coordinator } from '../types.ts';
import { Search, Filter, Trash2, ExternalLink, RefreshCw, Star, ShieldAlert, Check, Plus, Lock, CheckSquare, Bell, Download, Sparkles, TrendingUp, X, UploadCloud } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getCountryFlagUrl } from '../utils';

interface LeadListProps {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  onUpdateStage: (id: string, stage: LeadStage) => void;
  onDeleteLead: (id: string) => void;
  userRole: 'admin' | 'agent';
  currentAgentId: string;
  onRefreshData?: () => void;
  coordinators?: Coordinator[];
}

const COORDINATORS = [
  'Joyce', 'Sarina', 'Shreya', 'Edenla', 'Priya', 
  'Monika', 'Sangita', 'Anjali', 'Dechen', 'Rinzing'
];

export default function LeadList({ 
  leads, 
  onSelectLead, 
  onUpdateStage, 
  onDeleteLead, 
  userRole, 
  currentAgentId,
  onRefreshData,
  coordinators = []
}: LeadListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState('All');
  const [coordinatorFilter, setCoordinatorFilter] = useState('All');
  const [fitScoreFilter, setFitScoreFilter] = useState('All');
  const [importanceFilter, setImportanceFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');
  const [projectFilter, setProjectFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('All'); // 'All', 'Today', 'Yesterday', 'Last7Days', 'Last30Days', 'Custom'
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  
  // Spreadsheet Quick Grid Inline Edit Mode Switch
  const [isInlineEdit, setIsInlineEdit] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Bulk Actions states
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [bulkCoordinator, setBulkCoordinator] = useState('');
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // Sub-Agent Bucket Toggle filter: default to "My Bucket" if the role is agent!
  const [bucketToggle, setBucketToggle] = useState<'my' | 'all'>(userRole === 'agent' ? 'my' : 'all');

  // AI Co-pilot states
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAiSimulated, setIsAiSimulated] = useState(false);

  // Bulk import states
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    loading?: boolean;
    success?: boolean;
    enrolledCount?: number;
    skippedCount?: number;
    skipped?: string[];
    error?: string;
  } | null>(null);

  const mapImportedRow = (row: any) => {
    // Helper to extract values leniently
    const getValue = (keys: string[]) => {
      for (const key of keys) {
        const matchKey = Object.keys(row).find(
          k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === key.toLowerCase().replace(/[^a-z0-9]/g, '')
        );
        if (matchKey) return row[matchKey];
      }
      return undefined;
    };

    const name = getValue(['applicantname', 'name', 'candidate', 'candidatename']);
    const phone = getValue(['phone', 'whatsappmobileno', 'mobileno', 'whatsapp', 'candidatemobileno']);
    const gender = getValue(['gender', 'sex']) || 'M';
    const age = Number(getValue(['age', 'years'])) || 24;
    const origin = getValue(['origin', 'sourcecountry', 'citizenship']) || 'Nepal';
    const country = getValue(['country', 'destination', 'targetcountry', 'countryinterest']) || 'Kuwait';
    const position = getValue(['position', 'job', 'positionopening', 'jobposition']) || 'General openings';
    const experience = getValue(['experience', 'workexperience']) || 'Fresh criteria';
    const assignedTo = getValue(['coordinator', 'assignedto', 'coordinatorassigned']) || '';
    const importance = Number(getValue(['importance', 'rating'])) || 3;
    const tags = getValue(['tags', 'skills', 'categories']);
    const source = getValue(['source', 'campaignsource']) || 'Bulk Import';
    const project = getValue(['project', 'hiringproject']) || 'General';

    return { name, phone, gender, age, origin, country, position, experience, assignedTo, importance, tags, source, project };
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportStatus({ loading: true });
    setIsImporting(true);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet);

        if (rawData.length === 0) {
          throw new Error("The uploaded sheet is empty.");
        }

        const parsedLeads = rawData.map(mapImportedRow).filter(item => item.name && item.phone);

        if (parsedLeads.length === 0) {
          throw new Error("No valid candidate rows found. Ensure columns like 'Applicant Name' and 'Phone' are present.");
        }

        const response = await fetch('/api/leads/bulk', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-user-role': userRole
          },
          body: JSON.stringify({ leads: parsedLeads })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed with status ${response.status}`);
        }

        const result = await response.json();
        setImportStatus({
          loading: false,
          success: true,
          enrolledCount: result.enrolledCount,
          skippedCount: result.skippedCount,
          skipped: result.skipped || []
        });

        if (onRefreshData) {
          onRefreshData();
        }

      } catch (err) {
        console.error(evt, err);
        setImportStatus({
          loading: false,
          success: false,
          error: (err as Error).message
        });
      } finally {
        setIsImporting(false);
        // Clear input value so same file can be uploaded again if needed
        e.target.value = '';
      }
    };

    reader.onerror = () => {
      setImportStatus({
        loading: false,
        success: false,
        error: "Failed to read the file."
      });
      setIsImporting(false);
    };

    reader.readAsBinaryString(file);
  };

  // Export handlers
  const handleExportXLSX = () => {
    if (filteredLeads.length === 0) return;
    const dataToExport = filteredLeads.map((lead, idx) => ({
      'Serial': idx + 1,
      'Applicant Name': lead.name,
      'Phone': lead.phone,
      'Country Interest': lead.country,
      'Job Position': lead.positionOpening,
      'Pipeline Stage': lead.stage,
      'Fit Score': (lead.fitScore || 'unqualified').toUpperCase(),
      'Coordinator Assigned': lead.assignedTo || 'Unassigned',
      'Passport Copy Received': lead.docPassportCopy ? 'YES' : 'NO',
      'Resume Received': lead.docResume ? 'YES' : 'NO',
      'Office Visited': lead.docOfficeVisited ? 'YES' : 'NO',
      'Remarks 1 (First Call)': lead.remarks1 || '',
      'Remarks 2 (Follow-up)': lead.remarks2 || '',
      'Remarks 3 (Final Status)': lead.remarks3 || '',
      'Created Date': new Date(lead.createdAt).toLocaleDateString()
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Candidates");
    XLSX.writeFile(workbook, `CRM_Spreadsheet_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportCSV = () => {
    if (filteredLeads.length === 0) return;
    const dataToExport = filteredLeads.map((lead, idx) => ({
      'Serial': idx + 1,
      'Applicant Name': lead.name,
      'Phone': lead.phone,
      'Country Interest': lead.country,
      'Job Position': lead.positionOpening,
      'Pipeline Stage': lead.stage,
      'Fit Score': (lead.fitScore || 'unqualified').toUpperCase(),
      'Coordinator Assigned': lead.assignedTo || 'Unassigned',
      'Passport Copy Received': lead.docPassportCopy ? 'YES' : 'NO',
      'Resume Received': lead.docResume ? 'YES' : 'NO',
      'Office Visited': lead.docOfficeVisited ? 'YES' : 'NO',
      'Remarks 1 (First Call)': lead.remarks1 || '',
      'Remarks 2 (Follow-up)': lead.remarks2 || '',
      'Remarks 3 (Final Status)': lead.remarks3 || '',
      'Created Date': new Date(lead.createdAt).toLocaleDateString()
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const csvContent = XLSX.utils.sheet_to_csv(worksheet);
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `CRM_Spreadsheet_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateAIReport = async () => {
    if (filteredLeads.length === 0) return;
    setIsAnalyzing(true);
    setAiError(null);
    setAiReport(null);
    try {
      const response = await fetch('/api/leads/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: filteredLeads })
      });
      if (!response.ok) {
        throw new Error(`AI Analysis failed with status ${response.status}`);
      }
      const data = await response.json();
      setAiReport(data.report);
      setIsAiSimulated(!!data.simulated);
    } catch (err) {
      console.error(err);
      setAiError((err as Error).message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Light markdown custom renderer
  const renderMarkdown = (text: string) => {
    return text.split('\n').map((line, idx) => {
      let content = line;
      let className = "text-slate-700 text-xs my-1 leading-relaxed";

      if (content.startsWith('### ')) {
        content = content.replace('### ', '');
        className = "text-sm font-black text-slate-800 mt-4 mb-2 uppercase tracking-wide flex items-center gap-1.5";
        return <h4 key={idx} className={className}><TrendingUp className="h-4 w-4 text-indigo-500 shrink-0" /> {content}</h4>;
      } else if (content.startsWith('## ')) {
        content = content.replace('## ', '');
        className = "text-base font-black text-slate-800 mt-5 mb-2.5 uppercase tracking-wide border-b pb-1 border-slate-100";
        return <h3 key={idx} className={className}>{content}</h3>;
      } else if (content.startsWith('# ')) {
        content = content.replace('# ', '');
        className = "text-lg font-black text-slate-800 mt-6 mb-3 uppercase tracking-wider";
        return <h2 key={idx} className={className}>{content}</h2>;
      }

      const isListItem = content.startsWith('- ') || content.startsWith('* ');
      if (isListItem) {
        content = content.substring(2);
        className = "text-xs text-slate-600 pl-4 relative my-1.5 flex items-start gap-1.5";
        const parts = content.split('**');
        const renderedParts = parts.map((part, pIdx) => {
          if (pIdx % 2 === 1) {
            return <strong key={pIdx} className="font-extrabold text-slate-900">{part}</strong>;
          }
          return part;
        });
        return (
          <div key={idx} className={className}>
            <span className="text-indigo-500 mt-1 select-none text-[10px]">•</span>
            <span>{renderedParts}</span>
          </div>
        );
      }

      const parts = content.split('**');
      const renderedParts = parts.map((part, pIdx) => {
        if (pIdx % 2 === 1) {
          return <strong key={pIdx} className="font-extrabold text-slate-900">{part}</strong>;
        }
        return part;
      });

      return (
        <div key={idx} className={className}>
          {renderedParts}
        </div>
      );
    });
  };

  // Extract unique target countries dynamically for filtering options
  const targetCountriesList = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => {
      if (l.country) set.add(l.country);
    });
    return ['All', ...Array.from(set)];
  }, [leads]);

  // Extract unique target projects dynamically for filtering options
  const targetProjectsList = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => {
      if (l.project) set.add(l.project);
    });
    return ['All', ...Array.from(set)];
  }, [leads]);

  // Extract unique candidate tags dynamically for filter options
  const availableTagsList = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => {
      if (l.tags && Array.isArray(l.tags)) {
        l.tags.forEach(t => {
          if (t && t.trim()) set.add(t.trim());
        });
      }
    });
    return ['All', ...Array.from(set)];
  }, [leads]);

  // Handle comprehensive search & multi-layer filters
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      // 1. Coordinator bucket constraint: force MY seats only if Agent role!
      if (userRole === 'agent') {
        const isAssignedToMe = lead.assignedTo?.toLowerCase() === currentAgentId.toLowerCase();
        if (!isAssignedToMe) return false;
      }

      // 2. Global keyword query search
      const query = searchQuery.toLowerCase();
      const matchesSearch = 
        lead.name.toLowerCase().includes(query) ||
        lead.phone.includes(query) ||
        (lead.email && lead.email.toLowerCase().includes(query)) ||
        (lead.country && lead.country.toLowerCase().includes(query)) ||
        (lead.position && lead.position.toLowerCase().includes(query)) ||
        (lead.origin && lead.origin.toLowerCase().includes(query)) ||
        (lead.remarks1 && lead.remarks1.toLowerCase().includes(query)) ||
        (lead.remarks2 && lead.remarks2.toLowerCase().includes(query)) ||
        (lead.remarks3 && lead.remarks3.toLowerCase().includes(query)) ||
        (lead.tags && lead.tags.some(t => t.toLowerCase().includes(query))) ||
        (lead.source && lead.source.toLowerCase().includes(query)) ||
        (lead.project && lead.project.toLowerCase().includes(query));

      // 3. Country Applied filter
      const matchesCountry = countryFilter === 'All' || lead.country === countryFilter;
      
      // 3.5 Hiring Project filter
      const matchesProject = projectFilter === 'All' || lead.project === projectFilter;

      // 4. Inbound Quality Fit score filter
      const matchesFit = fitScoreFilter === 'All' || lead.fitScore === fitScoreFilter;

      // 5. Importance Rating filter
      const matchesImportance = 
        importanceFilter === 'All' || 
        (lead.importance !== undefined && String(lead.importance) === importanceFilter);

      // 6. Dynamic Tags filter
      const matchesTag = tagFilter === 'All' || (lead.tags && lead.tags.includes(tagFilter));

      // 7. Date Wise Filter
      let matchesDate = true;
      if (dateFilter !== 'All') {
        const leadTime = new Date(lead.createdAt).getTime();
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

      // 8. Coordinator Filter (only relevant for admin)
      const matchesCoordinator = 
        userRole !== 'admin' || 
        coordinatorFilter === 'All' || 
        (coordinatorFilter === 'Unassigned' ? !lead.assignedTo : (lead.assignedTo?.toLowerCase() === coordinatorFilter.toLowerCase() || lead.assignedTo === coordinatorFilter));

      return matchesSearch && matchesCountry && matchesProject && matchesFit && matchesImportance && matchesTag && matchesDate && matchesCoordinator;
    });
  }, [leads, searchQuery, countryFilter, projectFilter, fitScoreFilter, importanceFilter, tagFilter, dateFilter, customStartDate, customEndDate, userRole, currentAgentId, coordinatorFilter]);

  // Bulk Re-assignment API Caller
  const handleBulkReassign = async () => {
    if (!bulkCoordinator) {
      alert('Please select a coordinator to assign to.');
      return;
    }
    if (selectedLeadIds.length === 0) {
      alert('No leads selected for re-assignment.');
      return;
    }
    
    setIsBulkUpdating(true);
    try {
      await Promise.all(
        selectedLeadIds.map(async (id) => {
          await fetch(`/api/leads/${id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'x-user-role': userRole,
              'x-agent-id': currentAgentId
            },
            body: JSON.stringify({ assignedTo: bulkCoordinator })
          });
        })
      );
      
      setSelectedLeadIds([]);
      setBulkCoordinator('');
      onRefreshData();
    } catch (err) {
      console.error(err);
      alert('Failed to re-assign some selected leads.');
    } finally {
      setIsBulkUpdating(false);
    }
  };

  // Inline updater directly communicates with the Express backend API
  const handleInlineUpdate = async (id: string, fields: Partial<Lead>) => {
    setSavingId(id);
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify(fields)
      });
      if (res.ok) {
        // Trigger silent state updates inside parent
        onUpdateStage(id, leads.find(l => l.id === id)?.stage || 'new');
      }
    } catch (err) {
      console.error('Spreadsheet inline update failed', err);
    } finally {
      setTimeout(() => setSavingId(null), 800);
    }
  };

  const getFitStyle = (score: FitScore) => {
    switch (score) {
      case 'high':
        return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'medium':
        return 'bg-teal-50 text-teal-700 border-teal-100';
      case 'low':
        return 'bg-amber-50 text-amber-700 border-amber-100/50';
      case 'unqualified':
      default:
        return 'bg-slate-100 text-slate-500 border-slate-205';
    }
  };

  const getStageHeader = (stage: LeadStage) => {
    switch (stage) {
      case 'new': return 'bg-slate-800 text-slate-300 border border-slate-700';
      case 'contacted': return 'bg-sky-950/40 text-sky-400 border border-sky-900/30';
      case 'negotiating': return 'bg-amber-950/40 text-amber-400 border border-amber-900/30';
      case 'proposal': return 'bg-purple-950/40 text-purple-400 border border-purple-900/30';
      case 'won': return 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30 font-bold';
      case 'lost': return 'bg-slate-800 text-slate-400 border border-slate-700';
    }
  };

  const isSubAgent = userRole === 'agent';

  return (
    <div className="space-y-4" id="cgp-spreadsheet-explorer">
      
      {/* Search, Buckets, and Filters Control Panel */}
      <div className="flex flex-col xl:flex-row gap-4 items-stretch xl:items-center justify-between bg-slate-850 p-5 rounded-2xl border border-slate-750 shadow-lg">
        
        {/* Left section: Search & bucket switcher */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center w-full xl:w-auto">
          {/* Search Box */}
          <div className="relative w-full sm:w-72 text-left">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search Name, Phone, Origin, Position..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-slate-800 focus:outline-none focus:ring-1 focus:ring-accent-purple bg-slate-950 text-slate-100 placeholder-slate-500 font-medium"
            />
          </div>

          {/* Sub Agent Bucket Selector Toggle */}
          {userRole === 'agent' && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-950 text-slate-300 border border-slate-800 rounded-xl text-[10px] font-black tracking-wider uppercase select-none shadow-sm">
              <span>🔒 CO-ORDINATOR PRIVATE SEAT ({filteredLeads.length} Contacts)</span>
            </div>
          )}
        </div>

        {/* Right Section: Filters & Grid Quick-Edit mode toggle */}
        <div className="flex flex-wrap gap-2.5 items-center w-full xl:w-auto justify-start xl:justify-end">
          <div className="flex items-center gap-1 text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none mr-1 select-none">
            <Filter className="h-3.5 w-3.5 text-slate-500" /> DIRECTORY FILTERS:
          </div>

          {/* Country filter */}
          <select
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-750 bg-slate-950 text-slate-300 font-bold focus:outline-none focus:ring-1 focus:ring-accent-purple cursor-pointer uppercase"
          >
            <option value="All">All Applied Countries</option>
            {targetCountriesList.filter(c => c !== 'All').map((country, idx) => (
              <option key={idx} value={country}>✈️ {country.toUpperCase()}</option>
            ))}
          </select>

          {/* Coordinator Filter - only in Admin View */}
          {userRole === 'admin' && (
            <select
              value={coordinatorFilter}
              onChange={(e) => setCoordinatorFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-750 bg-slate-950 text-accent-purple font-black focus:outline-none focus:ring-1 focus:ring-accent-purple cursor-pointer uppercase"
            >
              <option value="All">👤 All Coordinators</option>
              <option value="Unassigned">👤 Unassigned Only</option>
              {coordinators && coordinators.length > 0 ? (
                coordinators.map((coord) => (
                  <option key={coord.id} value={coord.username}>👤 {coord.displayName.toUpperCase()}</option>
                ))
              ) : (
                COORDINATORS.map((coord, idx) => (
                  <option key={idx} value={coord}>👤 {coord.toUpperCase()}</option>
                ))
              )}
            </select>
          )}

          {/* Hiring Project filter */}
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-750 bg-slate-950 text-slate-300 font-bold focus:outline-none focus:ring-1 focus:ring-accent-purple cursor-pointer uppercase"
          >
            <option value="All">All Projects</option>
            {targetProjectsList.filter(p => p !== 'All').map((proj, idx) => (
              <option key={idx} value={proj}>🎯 {proj.toUpperCase()}</option>
            ))}
          </select>

          {/* Tags Filter Dropdown */}
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-750 bg-slate-950 text-slate-300 font-bold focus:outline-none focus:ring-1 focus:ring-accent-purple cursor-pointer"
          >
            <option value="All">All Tags</option>
            {availableTagsList.filter(t => t !== 'All').map((tag, idx) => (
              <option key={idx} value={tag}>🏷️ {tag}</option>
            ))}
          </select>

          {/* Fit score filter */}
          <select
            value={fitScoreFilter}
            onChange={(e) => setFitScoreFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-750 bg-slate-950 text-slate-300 font-bold focus:outline-none focus:ring-1 focus:ring-accent-purple cursor-pointer"
          >
            <option value="All">All AI Quality Fit</option>
            <option value="high">🥇 High Fit Quality</option>
            <option value="medium">🥈 Medium Fit Quality</option>
            <option value="low">🥉 Low Fit Quality</option>
            <option value="unqualified">🛑 Unqualified / Spam</option>
          </select>

          {/* Importance filter */}
          <select
            value={importanceFilter}
            onChange={(e) => setImportanceFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-750 bg-slate-950 text-slate-300 font-bold focus:outline-none focus:ring-1 focus:ring-accent-purple cursor-pointer"
          >
            <option value="All">All Importance stars</option>
            <option value="5">⭐⭐⭐⭐⭐ 5 Stars (Urgent)</option>
            <option value="4">⭐⭐⭐⭐ 4 Stars (High)</option>
            <option value="3">⭐⭐⭐ 3 Stars (Medium)</option>
            <option value="2">⭐⭐ 2 Stars (Fair)</option>
            <option value="1">⭐ 1 Star (Low)</option>
          </select>

          {/* Date Wise Filter */}
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-750 bg-slate-950 text-slate-300 font-bold focus:outline-none focus:ring-1 focus:ring-accent-purple cursor-pointer uppercase"
          >
            <option value="All">📅 All Dates</option>
            <option value="Today">📅 Today</option>
            <option value="Yesterday">📅 Yesterday</option>
            <option value="Last7Days">📅 Last 7 Days</option>
            <option value="Last30Days">📅 Last 30 Days</option>
            <option value="Custom">📅 Custom Range...</option>
          </select>

          {dateFilter === 'Custom' && (
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-750 p-1 px-2 rounded-lg animate-in fade-in zoom-in-95">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="text-[10px] font-bold text-slate-300 bg-transparent border-none focus:outline-none cursor-pointer"
                title="Start Date"
              />
              <span className="text-[10px] text-slate-500 font-black">TO</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="text-[10px] font-bold text-slate-300 bg-transparent border-none focus:outline-none cursor-pointer"
                title="End Date"
              />
            </div>
          )}

          {/* Interactive G-Sheet Mode Toggle! */}
          <button
            type="button"
            onClick={() => setIsInlineEdit(!isInlineEdit)}
            className={`text-xs font-black px-3.5 py-1.5 rounded-lg transition-all border flex items-center gap-1.5 cursor-pointer shadow-3xs ${
              isInlineEdit 
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md' 
                : 'bg-slate-850 text-slate-300 border-slate-750 hover:bg-slate-800/80'
            }`}
            title="Enable fast double-click spreadsheet typing directly in cells"
          >
            <span>⚡ Grid Quick-Edit</span>
            <span className={`h-2 w-2 rounded-full ${isInlineEdit ? 'bg-white animate-pulse' : 'bg-emerald-500'}`} />
          </button>

          {/* AI Cohort Analysis Report Trigger */}
          <button
            type="button"
            onClick={handleGenerateAIReport}
            disabled={isAnalyzing || filteredLeads.length === 0}
            className="text-xs font-black px-3.5 py-1.5 bg-purple-950/20 hover:bg-purple-950/40 text-accent-purple border border-purple-900/35 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-3xs"
            title="Run Gemini AI Strategic Analysis on current cohort"
          >
            <Sparkles className="h-3.5 w-3.5 text-accent-purple animate-pulse" />
            <span>💡 AI Co-pilot Report</span>
          </button>

          {/* Export CSV Button */}
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={filteredLeads.length === 0}
            className="text-xs font-black px-3.5 py-1.5 bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-750 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-3xs"
            title="Export filtered directory to .CSV"
          >
            <Download className="h-3.5 w-3.5 text-slate-400" />
            <span>📄 Export CSV</span>
          </button>

          {/* Export XLSX Button */}
          <button
            type="button"
            onClick={handleExportXLSX}
            disabled={filteredLeads.length === 0}
            className="text-xs font-black px-3.5 py-1.5 bg-emerald-950/20 hover:bg-emerald-950/40 text-emerald-400 border border-emerald-900/30 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-3xs"
            title="Export filtered directory to Microsoft Excel .XLSX"
          >
            <Download className="h-3.5 w-3.5 text-emerald-500" />
            <span>📊 Export XLSX</span>
          </button>

          {/* Bulk Enrollment Button - Admin only */}
          {userRole === 'admin' && (
            <button
              type="button"
              onClick={() => setIsImportOpen(!isImportOpen)}
              className={`text-xs font-black px-3.5 py-1.5 border rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-3xs ${
                isImportOpen 
                  ? 'bg-accent-purple text-white border-purple-600 shadow-md font-extrabold' 
                  : 'bg-slate-850 text-purple-400 border-slate-750 hover:bg-slate-800 font-extrabold'
              }`}
              title="Bulk import candidates from XLSX or CSV"
            >
              <UploadCloud className="h-3.5 w-3.5 text-accent-purple" />
              <span>📥 Bulk Enrollment</span>
            </button>
          )}
        </div>
      </div>

      {/* Admin Bulk Import Panel */}
      {userRole === 'admin' && isImportOpen && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 shadow-sm text-left animate-in fade-in slide-in-from-top-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-accent-purple" />
          
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-accent-purple rounded-xl text-white">
                <UploadCloud className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-100 tracking-wide uppercase">
                  Bulk Candidate Enrollment Engine
                </h3>
                <p className="text-[11px] text-slate-400 font-bold">
                  Upload candidate spreadsheets in .XLSX, .XLS, or .CSV formats
                </p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => { setIsImportOpen(false); setImportStatus(null); }}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg cursor-pointer transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Guide & Instructions */}
            <div className="lg:col-span-5 space-y-3.5">
              <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800 text-xs space-y-2.5">
                <h4 className="font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5 text-[11px]">
                  💡 Quick Layout & Mapping Guide
                </h4>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  The engine automatically parses and cleans data. For successful imports, ensure your columns are named similarly to the template.
                </p>
                <div className="border-t border-slate-800 pt-2.5 space-y-1.5 font-mono text-[10px] text-slate-350">
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="font-bold text-slate-200">Applicant Name *</span>
                    <span className="text-accent-purple font-semibold">Text (e.g. John Doe)</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="font-bold text-slate-200">Phone *</span>
                    <span className="text-accent-purple font-semibold">Unique mobile number</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="font-bold text-slate-200">Country Interest</span>
                    <span className="text-accent-purple font-semibold">Kuwait, Germany, Qatar...</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800 pb-1">
                    <span className="font-bold text-slate-200">Job Position</span>
                    <span className="text-accent-purple font-semibold">Waiter, Nurse, Driver...</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-bold text-slate-200">Coordinator</span>
                    <span className="text-accent-purple font-semibold">Joyce, Sarina, Shreya...</span>
                  </div>
                </div>
                <div className="pt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const dummyData = [
                        {
                          'Applicant Name': 'Rabin Sharma',
                          'Phone': '9812345670',
                          'Gender': 'M',
                          'Age': 26,
                          'Country': 'Germany',
                          'Position': 'Nurse',
                          'Experience': '3 years GNM',
                          'Coordinator': 'Joyce',
                          'Tags': 'B1 German, GNM'
                        },
                        {
                          'Applicant Name': 'Sita Tamang',
                          'Phone': '9854321098',
                          'Gender': 'F',
                          'Age': 23,
                          'Country': 'Qatar',
                          'Position': 'Waiter',
                          'Experience': '1 year in hotel',
                          'Coordinator': 'Sarina',
                          'Tags': 'Fluent English'
                        }
                      ];
                      const worksheet = XLSX.utils.json_to_sheet(dummyData);
                      const workbook = XLSX.utils.book_new();
                      XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
                      XLSX.writeFile(workbook, "CGP_Bulk_Enrollment_Template.xlsx");
                    }}
                    className="text-[10px] text-accent-purple bg-purple-950/20 hover:bg-purple-950/40 border border-purple-900/35 font-bold px-2.5 py-1 rounded transition-all cursor-pointer flex items-center gap-1 uppercase"
                  >
                    <Download className="h-3 w-3" /> Download Sample Template
                  </button>
                </div>
              </div>
            </div>

            {/* Drop Zone Area */}
            <div className="lg:col-span-7 flex flex-col justify-between">
              <div className="flex-1">
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-750 hover:border-slate-550 bg-slate-950/20 hover:bg-slate-900/20 rounded-xl p-6 text-center cursor-pointer transition-all group min-h-[140px] relative">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileImport}
                    className="hidden"
                    disabled={isImporting}
                  />
                  <UploadCloud className="h-10 w-10 text-slate-400 group-hover:text-slate-200 transition-all mb-2" />
                  <span className="text-xs font-black text-slate-200 block">
                    {isImporting ? 'Enrolling candidates...' : 'Click to Browse or Drag & Drop Spreadsheet'}
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold block mt-1">
                    Supports Microsoft Excel (.xlsx, .xls) and standard text formats (.csv)
                  </span>
                </label>
              </div>

              {/* Status and Feedback messages */}
              {importStatus && (
                <div className="mt-4 animate-in fade-in zoom-in-95 duration-150">
                  {importStatus.loading && (
                    <div className="flex items-center gap-2.5 text-xs font-bold text-indigo-400 bg-indigo-950/20 border border-indigo-900/30 p-3.5 rounded-xl">
                      <div className="h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
                      <span>Reading, validating columns, verifying duplications, and writing into secure CRM datastore...</span>
                    </div>
                  )}

                  {importStatus.success && (
                    <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-xl space-y-2 text-xs text-left">
                      <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-[13px]">
                        <span>🎉 Bulk Enrollment Completed Successfully!</span>
                      </div>
                      <p className="text-slate-300 font-bold leading-relaxed">
                        Successfully ingested <strong className="text-emerald-400 text-sm font-black">{importStatus.enrolledCount}</strong> new candidate profiles. 
                        Skipped <strong className="text-amber-400">{importStatus.skippedCount}</strong> rows due to duplication or missing required data.
                      </p>

                      {importStatus.skipped && importStatus.skipped.length > 0 && (
                        <div className="bg-slate-950 p-2.5 border border-slate-800 rounded-lg max-h-[80px] overflow-y-auto mt-2">
                          <p className="text-[10px] uppercase font-black text-amber-400 mb-1 tracking-wider">Skipped Row Details:</p>
                          <ul className="list-disc list-inside font-mono text-[9px] text-amber-500 space-y-0.5">
                            {importStatus.skipped.map((reason, sIdx) => (
                              <li key={sIdx}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {importStatus.error && (
                    <div className="p-4 bg-rose-950/25 border border-rose-900/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-400 font-bold text-left">
                      <span className="text-sm">⚠️</span>
                      <div>
                        <p className="font-extrabold text-rose-300">Spreadsheet Parse Error</p>
                        <p className="text-[11px] text-rose-400 mt-0.5">{importStatus.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Cohort Analysis Report Panel */}
      {(isAnalyzing || aiReport || aiError) && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 shadow-sm text-left animate-in fade-in slide-in-from-top-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-accent-purple" />
          
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-accent-purple rounded-lg text-white">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <div>
                <h3 className="text-xs font-black text-slate-100 tracking-wide uppercase">
                  AI Strategic Cohort Co-pilot
                </h3>
                <p className="text-[10px] text-slate-400 font-bold">
                  {isAiSimulated ? 'Simulated AI Analysis' : 'Gemini 3.5 Active Insights'} • {filteredLeads.length} Candidates Analyzed
                </p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={() => { setAiReport(null); setAiError(null); }}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg cursor-pointer transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {isAnalyzing && (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <div className="relative">
                <div className="h-8 w-8 rounded-full border-2 border-slate-800 border-t-accent-purple animate-spin" />
                <Sparkles className="h-4 w-4 text-accent-purple absolute top-2 left-2 animate-pulse" />
              </div>
              <div className="text-center">
                <p className="text-xs font-black text-slate-300">Analyzing Candidate Demographics & Pipeline Health...</p>
                <p className="text-[10px] text-slate-500 font-bold mt-1">Evaluating file completeness, visa destinations, and action priorities...</p>
              </div>
            </div>
          )}

          {aiError && (
            <div className="p-4 bg-rose-950/25 border border-rose-900/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-400 font-bold">
              <span className="text-sm">⚠️</span>
              <div>
                <p className="font-extrabold text-rose-300">Co-pilot Analysis Interrupted</p>
                <p className="text-[11px] text-rose-450 mt-0.5">{aiError}</p>
                <button
                  type="button"
                  onClick={handleGenerateAIReport}
                  className="mt-2 text-[10px] bg-rose-600 text-white px-2.5 py-1 rounded font-black uppercase hover:bg-rose-750 transition-all cursor-pointer"
                >
                  Retry Analysis
                </button>
              </div>
            </div>
          )}

          {aiReport && (
            <div className="prose max-w-none space-y-1">
              {renderMarkdown(aiReport)}
            </div>
          )}
        </div>
      )}


      {/* Spreadsheet grid table */}
      {selectedLeadIds.length > 0 && (
        <div className="bg-purple-950/20 border border-purple-900/30 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="bg-accent-purple text-white text-[9px] font-black tracking-wider px-2 py-0.5 rounded uppercase">
              Bulk Action
            </span>
            <span className="text-xs text-slate-200 font-extrabold">
              Selected <strong className="text-accent-purple underline font-black">{selectedLeadIds.length}</strong> candidates for quick coordinator re-assignment.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bulkCoordinator}
              onChange={(e) => setBulkCoordinator(e.target.value)}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-750 bg-slate-900 text-slate-100 font-black focus:ring-1 focus:ring-accent-purple focus:outline-none cursor-pointer uppercase"
            >
              <option value="">-- Select Coordinator Agent --</option>
              {coordinators && coordinators.length > 0 ? (
                coordinators.map((coord) => (
                  <option key={coord.id} value={coord.username}>
                    📢 {coord.displayName.toUpperCase()}
                  </option>
                ))
              ) : (
                COORDINATORS.map((coord) => (
                  <option key={coord} value={coord}>
                    📢 {coord.toUpperCase()}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={handleBulkReassign}
              disabled={isBulkUpdating || !bulkCoordinator}
              className="px-4 py-1.5 bg-accent-purple hover:bg-purple-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-extrabold text-xs rounded-lg shadow-sm transition-all cursor-pointer"
            >
              {isBulkUpdating ? 'Updating...' : 'Apply Re-assignment'}
            </button>
            <button
              type="button"
              onClick={() => setSelectedLeadIds([])}
              className="text-xs text-purple-400 hover:text-purple-300 font-extrabold px-2 py-1.5 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-850 rounded-2xl border border-slate-750 overflow-hidden shadow-lg text-left">
        {isInlineEdit && (
          <div className="bg-emerald-950/40 border-b border-slate-750 p-2.5 px-4 text-[11px] font-bold text-slate-300 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent-emerald animate-pulse" />
              <span>Spreadsheet Grid Edit Mode Active: Double-click or type directly in Remarks, Coordinator, and Position cells. Changes save instantly on Enter or Tab.</span>
            </div>
            <span className="text-[10px] bg-slate-800 border border-slate-750 px-1.5 py-0.5 rounded text-accent-emerald uppercase tracking-wide font-black">Google Sheets format</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-900/50 border-b border-slate-750 text-left select-none">
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider w-10 text-center">
                  <input
                    type="checkbox"
                    checked={filteredLeads.length > 0 && filteredLeads.map(l => l.id).every(id => selectedLeadIds.includes(id))}
                    onChange={() => {
                      const visibleIds = filteredLeads.map(l => l.id);
                      const isAllSelected = visibleIds.length > 0 && visibleIds.every(id => selectedLeadIds.includes(id));
                      if (isAllSelected) {
                        setSelectedLeadIds(prev => prev.filter(id => !visibleIds.includes(id)));
                      } else {
                        setSelectedLeadIds(prev => Array.from(new Set([...prev, ...visibleIds])));
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-700 text-accent-purple focus:ring-accent-purple cursor-pointer bg-slate-950"
                    title="Select / deselect all visible rows"
                  />
                </th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider w-20 text-center whitespace-nowrap">Serial No</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[170px]">Applicant Candidate</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Pipeline Stage</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Country</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[150px]">Position Opening</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[210px]">Docs Received Status</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-center">Importance</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[130px]">Coordinator (Telecaller)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[170px]">Remarks 1 (First Call)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[170px]">Remarks 2 (Follow-up)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[170px]">Remarks 3 (Final Status)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-750/60">
              {filteredLeads.length > 0 ? (
                filteredLeads.map((lead) => {
                  const isSavingThis = savingId === lead.id;
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => !isInlineEdit && onSelectLead(lead)}
                      className={`transition-colors text-xs text-left ${
                        isInlineEdit 
                          ? 'hover:bg-slate-800/10' 
                          : 'hover:bg-slate-800/20 cursor-pointer group'
                      }`}
                    >
                      {/* Selection Checkbox */}
                      <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedLeadIds.includes(lead.id)}
                          onChange={() => {
                            if (selectedLeadIds.includes(lead.id)) {
                              setSelectedLeadIds(prev => prev.filter(id => id !== lead.id));
                            } else {
                              setSelectedLeadIds(prev => [...prev, lead.id]);
                            }
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-700 text-accent-purple focus:ring-accent-purple cursor-pointer bg-slate-950"
                        />
                      </td>

                      {/* 1. Serial No */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className="font-mono font-black text-[11px] text-slate-300 bg-slate-800 px-2.5 py-1.5 rounded-md border border-slate-750 shadow-3xs inline-block whitespace-nowrap min-w-[85px]">
                          {lead.serialNo || '—'}
                        </span>
                      </td>

                      {/* 2. Candidate Demographics */}
                      <td className="px-4 py-3 max-w-[200px]">
                        <div>
                          <div className={`font-extrabold text-slate-100 uppercase truncate ${!isInlineEdit && 'group-hover:text-accent-emerald transition-colors'} flex items-center gap-1.5 font-display`}>
                            <span>{lead.name}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInlineUpdate(lead.id, { reminderEnabled: !lead.reminderEnabled });
                              }}
                              className={`p-1 rounded-full transition-all shrink-0 ${
                                lead.reminderEnabled 
                                  ? 'text-accent-purple bg-purple-950/40 hover:bg-purple-900/40 scale-110' 
                                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-850'
                              }`}
                              title={lead.reminderEnabled ? "Active Follow-up Reminder ON (Click to Turn Off)" : "Turn On Follow-up Reminder"}
                            >
                              <Bell className={`h-3 w-3 ${lead.reminderEnabled ? 'fill-accent-purple animate-bounce' : ''}`} />
                            </button>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">{lead.phone}</div>
                          <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            {lead.gender === 'FEMALE' || lead.gender === 'F' ? 'Female' : 'Male'}, Age {lead.age || '24'} ({lead.origin || 'No State'})
                          </div>
                          {lead.tags && lead.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {lead.tags.map((tag, tIdx) => (
                                <span key={tIdx} className="bg-slate-800 text-slate-300 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-slate-700">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                          {(lead.project || lead.source) && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {lead.project && (
                                <span className="bg-purple-950/40 text-accent-purple text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-purple-900/30">
                                  🎯 {lead.project}
                                </span>
                              )}
                              {lead.source && (
                                <span className="bg-slate-800 text-slate-300 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-slate-700">
                                  📣 {lead.source}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 10. Pipeline Stage select box */}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={lead.stage}
                          onChange={(e) => onUpdateStage(lead.id, e.target.value as LeadStage)}
                          className={`text-[10px] font-bold rounded px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer ${getStageHeader(lead.stage)}`}
                        >
                          <option value="new">New Inbound</option>
                          <option value="contacted">Initial Contact</option>
                          <option value="negotiating">In Discussion</option>
                          <option value="proposal">Office Visited</option>
                          <option value="won">Closed Won</option>
                          <option value="lost">Closed Lost</option>
                        </select>
                      </td>

                      {/* 3. Target Country */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-[10px] font-extrabold text-slate-300 bg-slate-800 px-2 py-1 rounded border border-slate-700 uppercase flex items-center gap-1.5 w-fit">
                          {lead.country && getCountryFlagUrl(lead.country) ? (
                            <img 
                              src={getCountryFlagUrl(lead.country)} 
                              alt="" 
                              className="w-4 h-3 object-cover rounded-2xs inline-block shadow-2xs"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span>🌐</span>
                          )}
                          {lead.country || 'Pending'}
                        </span>
                      </td>

                      {/* 4. Position & Exp (Editable in Inline Edit!) */}
                      <td className="px-4 py-3" onClick={(e) => isInlineEdit && e.stopPropagation()}>
                        {isInlineEdit && !isSubAgent ? (
                          <input
                            type="text"
                            defaultValue={lead.position || ''}
                            placeholder="Type Position..."
                            onBlur={(e) => handleInlineUpdate(lead.id, { position: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleInlineUpdate(lead.id, { position: (e.target as HTMLInputElement).value });
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-full text-xs px-2 py-1 rounded bg-slate-900 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-900 transition-all text-slate-100 font-bold uppercase"
                          />
                        ) : (
                          <div>
                            <div className="font-bold text-slate-100 truncate" title={lead.position}>
                              {lead.position || 'Open openings'}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 italic" title={lead.experience}>
                              {lead.experience || 'Fresh criteria'}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Docs Received Status Checklist Column */}
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col gap-1 text-[10px] font-bold text-slate-400">
                          <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Passport copy received">
                            <input
                              type="checkbox"
                              checked={!!lead.docPassportCopy}
                              onChange={(e) => handleInlineUpdate(lead.id, { docPassportCopy: e.target.checked })}
                              className="h-3 w-3 rounded border-slate-700 text-accent-purple focus:ring-accent-purple bg-slate-950 cursor-pointer"
                            />
                            <span className={lead.docPassportCopy ? "text-accent-emerald font-extrabold" : ""}>Passport copy</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Resume received">
                            <input
                              type="checkbox"
                              checked={!!lead.docResume}
                              onChange={(e) => handleInlineUpdate(lead.id, { docResume: e.target.checked })}
                              className="h-3 w-3 rounded border-slate-700 text-accent-purple focus:ring-accent-purple bg-slate-950 cursor-pointer"
                            />
                            <span className={lead.docResume ? "text-accent-emerald font-extrabold" : ""}>Resume</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Office visited or not">
                            <input
                              type="checkbox"
                              checked={!!lead.docOfficeVisited}
                              onChange={(e) => handleInlineUpdate(lead.id, { docOfficeVisited: e.target.checked })}
                              className="h-3 w-3 rounded border-slate-700 text-accent-purple focus:ring-accent-purple bg-slate-950 cursor-pointer"
                            />
                            <span className={lead.docOfficeVisited ? "text-accent-emerald font-extrabold" : ""}>Office visited</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Other docs received">
                            <input
                              type="checkbox"
                              checked={!!lead.docOthers}
                              onChange={(e) => handleInlineUpdate(lead.id, { docOthers: e.target.checked })}
                              className="h-3 w-3 rounded border-slate-700 text-accent-purple focus:ring-accent-purple bg-slate-950 cursor-pointer"
                            />
                            <span className={lead.docOthers ? "text-accent-emerald font-extrabold" : ""}>Others</span>
                          </label>
                        </div>
                      </td>

                      {/* 5. Star Importance Rating (Interactive in Inline edit!) */}
                      <td className="px-4 py-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star 
                              key={i} 
                              onClick={() => {
                                if (!isSubAgent) {
                                  handleInlineUpdate(lead.id, { importance: i + 1 });
                                }
                              }}
                              className={`h-3.5 w-3.5 transition-all ${
                                isInlineEdit && !isSubAgent 
                                  ? 'cursor-pointer hover:scale-125 hover:text-amber-500 text-slate-500' 
                                  : 'text-slate-750'
                              } ${
                                i < (lead.importance || 3) 
                                  ? 'text-amber-500 fill-amber-500' 
                                  : 'text-slate-700'
                              }`} 
                            />
                          ))}
                        </div>
                      </td>

                      {/* 6. Assigned Telecaller (Editable dropdown in Inline edit!) */}
                      <td className="px-4 py-3" onClick={(e) => isInlineEdit && e.stopPropagation()}>
                        {isInlineEdit && !isSubAgent ? (
                          <select
                            value={lead.assignedTo || ''}
                            onChange={(e) => handleInlineUpdate(lead.id, { assignedTo: e.target.value })}
                            className="text-[10px] font-extrabold rounded px-2 py-1 focus:outline-none border border-slate-700 bg-slate-900 text-slate-300 focus:ring-accent-purple cursor-pointer w-full"
                          >
                            <option value="">Unassigned</option>
                            {coordinators && coordinators.length > 0 ? (
                              coordinators.map(coord => (
                                <option key={coord.id} value={coord.username}>{coord.displayName}</option>
                              ))
                            ) : (
                              COORDINATORS.map(coord => (
                                <option key={coord} value={coord}>{coord}</option>
                              ))
                            )}
                          </select>
                        ) : (
                          <div>
                            {lead.assignedTo ? (
                              <span className="text-[10px] font-extrabold text-accent-purple bg-purple-950/40 px-2 py-0.5 rounded border border-purple-900/30">
                                👤 {lead.assignedTo}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-500 italic">Unassigned</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 7. Remarks 1 (Editable in Inline Edit!) */}
                      <td className="px-4 py-3" onClick={(e) => isInlineEdit && e.stopPropagation()}>
                        {isInlineEdit ? (
                          <input
                            type="text"
                            defaultValue={lead.remarks1 || ''}
                            placeholder="Update call remarks 1..."
                            onBlur={(e) => handleInlineUpdate(lead.id, { remarks1: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleInlineUpdate(lead.id, { remarks1: (e.target as HTMLInputElement).value });
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-full text-xs px-2 py-1 rounded bg-slate-900 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-900 text-slate-100 font-mono italic"
                          />
                        ) : (
                          <span className="text-slate-300 font-mono italic truncate max-w-[150px] block" title={lead.remarks1}>
                            {lead.remarks1 || '—'}
                          </span>
                        )}
                      </td>

                      {/* 8. Remarks 2 (Editable in Inline Edit!) */}
                      <td className="px-4 py-3" onClick={(e) => isInlineEdit && e.stopPropagation()}>
                        {isInlineEdit ? (
                          <input
                            type="text"
                            defaultValue={lead.remarks2 || ''}
                            placeholder="Update call remarks 2..."
                            onBlur={(e) => handleInlineUpdate(lead.id, { remarks2: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleInlineUpdate(lead.id, { remarks2: (e.target as HTMLInputElement).value });
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-full text-xs px-2 py-1 rounded bg-slate-900 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-900 text-slate-100 font-mono italic"
                          />
                        ) : (
                          <span className="text-slate-300 font-mono italic truncate max-w-[150px] block" title={lead.remarks2}>
                            {lead.remarks2 || '—'}
                          </span>
                        )}
                      </td>

                      {/* 9. Remarks 3 (Editable in Inline Edit!) */}
                      <td className="px-4 py-3" onClick={(e) => isInlineEdit && e.stopPropagation()}>
                        {isInlineEdit ? (
                          <input
                            type="text"
                            defaultValue={lead.remarks3 || ''}
                            placeholder="Update call remarks 3..."
                            onBlur={(e) => handleInlineUpdate(lead.id, { remarks3: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleInlineUpdate(lead.id, { remarks3: (e.target as HTMLInputElement).value });
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-full text-xs px-2 py-1 rounded bg-slate-900 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-900 text-slate-100 font-mono italic"
                          />
                        ) : (
                          <span className="text-slate-300 font-mono italic truncate max-w-[150px] block" title={lead.remarks3}>
                            {lead.remarks3 || '—'}
                          </span>
                        )}
                      </td>

                      {/* 11. Quick actions */}
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1 items-center">
                          {isSavingThis && (
                            <RefreshCw className="h-3 w-3 text-accent-emerald animate-spin mr-1 shrink-0" />
                          )}
                          
                          <button
                            type="button"
                            onClick={() => onSelectLead(lead)}
                            className="p-1 px-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Open Full Candidate Profiler & Tasks"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                          
                          {/* Hide/Disable delete action for Telecaller Sub-agents strictly! */}
                          {!isSubAgent ? (
                            <button
                              type="button"
                              onClick={() => onDeleteLead(lead.id)}
                              className="p-1 px-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                              title="Delete Lead"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              disabled
                              type="button"
                              className="p-1 px-1.5 text-slate-700 cursor-not-allowed"
                              title="Delete Privileges Locked"
                            >
                              <Trash2 className="h-4 w-4 opacity-30" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={13} className="text-center py-12 text-slate-500 font-bold bg-slate-900/10">
                    No placement candidates match selected options. Verify active spreadsheet categories or sub-agent bucket filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
