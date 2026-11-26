import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'motion/react';
import { Lead, LeadStage, FitScore, Coordinator } from '../types.ts';
import { Search, Filter, Trash2, ExternalLink, RefreshCw, Star, ShieldAlert, AlertTriangle, Check, Plus, Lock, CheckSquare, Download, Sparkles, TrendingUp, X, UploadCloud, MessageSquare, FileText, Ban, LayoutGrid, Table } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getCountryFlagUrl, formatCandidateName, getEffectiveIntake, isCoordinatorMatch } from '../utils';
import { MultiSearchableSelect } from './MultiSearchableSelect';
import { LeadCard } from './LeadCard.tsx';
import { enqueueOutboxSave, isRetryableHttpStatus } from '../utils/syncOutbox.ts';

interface LeadListProps {
  leads: Lead[];
  onSelectLead: (lead: Lead) => void;
  onUpdateStage: (id: string, stage: LeadStage) => void;
  onDeleteLead: (id: string) => void;
  userRole: 'admin' | 'agent';
  currentAgentId: string;
  onRefreshData?: () => void;
  coordinators?: Coordinator[];

  // Server-side pagination & filter overrides
  totalLeadsCount?: number;
  totalPagesCount?: number;
  currentPageOverride?: number;
  onPageChange?: (page: number) => void;
  onFiltersChange?: (newFilters: any) => void;
  metaCountries?: string[];
  metaProjects?: string[];
  metaPositions?: string[];
  metaTags?: string[];
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
  coordinators = [],
  totalLeadsCount = 0,
  totalPagesCount = 1,
  currentPageOverride,
  onPageChange,
  onFiltersChange,
  metaCountries = [],
  metaProjects = [],
  metaPositions = [],
  metaTags = []
}: LeadListProps) {
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState<string[]>([]);
  const [coordinatorFilter, setCoordinatorFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [fitScoreFilter, setFitScoreFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [positionFilter, setPositionFilter] = useState<string[]>([]);
  const [genderFilter, setGenderFilter] = useState<string[]>([]);
  const [remarksFilter, setRemarksFilter] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<string[]>([]); // [] = All, multi values from 'Today', 'Yesterday', 'Last7Days', 'Last30Days', 'Custom'
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100; // Load 50-100 items at a time as requested!

  // Spreadsheet Quick Grid Inline Edit Mode Switch
  const [isInlineEdit, setIsInlineEdit] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [inlineRevMap, setInlineRevMap] = useState<Record<string, number>>({});

  // Bulk Actions states
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [bulkCoordinator, setBulkCoordinator] = useState('');
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

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
  const [isExporting, setIsExporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    loading?: boolean;
    success?: boolean;
    enrolledCount?: number;
    skippedCount?: number;
    skipped?: string[];
    error?: string;
  } | null>(null);

  // Sync currentPage from override if present
  useEffect(() => {
    if (currentPageOverride !== undefined && currentPageOverride !== currentPage) {
      setCurrentPage(currentPageOverride);
    }
  }, [currentPageOverride]);

  // Reset pagination to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, countryFilter, stageFilter, projectFilter, positionFilter, genderFilter, fitScoreFilter, tagFilter, dateFilter, coordinatorFilter, remarksFilter]);

  // Synchronize filter updates back to parent if server-side filtering is enabled with debounce
  const prevFiltersRef = React.useRef<string>('');
  useEffect(() => {
    if (!onFiltersChange) return;

    const serializeMulti = (arr: string[]) => (arr.length > 0 ? arr.join('||') : 'All');

    const currentPayload = {
      search: searchQuery,
      country: serializeMulti(countryFilter),
      coordinator: serializeMulti(coordinatorFilter),
      stage: serializeMulti(stageFilter),
      fitScore: serializeMulti(fitScoreFilter),
      tag: serializeMulti(tagFilter),
      project: serializeMulti(projectFilter),
      position: serializeMulti(positionFilter),
      dateFilter: serializeMulti(dateFilter),
      customStartDate,
      customEndDate,
      bucket: bucketToggle,
      gender: serializeMulti(genderFilter),
      remarksFilter: serializeMulti(remarksFilter)
    };

    const serialized = JSON.stringify(currentPayload);
    if (prevFiltersRef.current === serialized) return;

    const timer = setTimeout(() => {
      prevFiltersRef.current = serialized;
      onFiltersChange(currentPayload);
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, countryFilter, coordinatorFilter, stageFilter, fitScoreFilter, tagFilter, projectFilter, positionFilter, genderFilter, dateFilter, customStartDate, customEndDate, bucketToggle, remarksFilter, onFiltersChange]);

  // Synchronize page index back to parent
  const prevPageRef = React.useRef<number>(currentPage);
  useEffect(() => {
    if (onPageChange && prevPageRef.current !== currentPage) {
      prevPageRef.current = currentPage;
      onPageChange(currentPage);
    }
  }, [currentPage, onPageChange]);

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

    let name = getValue(['applicantname', 'name', 'candidate', 'candidatename']);
    if (!name) {
      const firstName = getValue(['firstname', 'first_name', 'first', 'givenname']);
      const lastName = getValue(['lastname', 'last_name', 'last', 'surname']);
      if (firstName || lastName) {
        name = `${firstName || ''} ${lastName || ''}`.trim();
      }
    }
    const phone = getValue(['phone', 'whatsappmobileno', 'mobileno', 'whatsapp', 'candidatemobileno']);
    const gender = getValue(['gender', 'sex']) || 'M';
    const ageVal = getValue(['age', 'years']);
    const age = ageVal !== undefined && ageVal !== null && ageVal !== '' ? (Number(ageVal) || '') : '';
    const origin = getValue(['origin', 'sourcecountry', 'citizenship']) || '';
    const country = getValue(['country', 'destination', 'targetcountry', 'countryinterest']) || 'Kuwait';
    const position = getValue(['position', 'job', 'positionopening', 'jobposition']) || 'General openings';
    const experience = getValue(['experience', 'workexperience']) || 'Fresh criteria';
    const qualification = getValue(['qualification', 'qualifications', 'education', 'degree']) || '';
    const assignedTo = getValue(['coordinator', 'assignedto', 'coordinatorassigned']) || '';
    const importance = Number(getValue(['importance', 'rating'])) || 3;
    const tags = getValue(['tags', 'skills', 'categories']);
    const source = getValue(['source', 'campaignsource']) || 'Bulk Import';
    const project = getValue(['project', 'hiringproject']) || 'General';

    return { name, phone, gender, age, origin, country, position, experience, qualification, assignedTo, importance, tags, source, project };
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

        const savedSession = (() => {
          try {
            const s = localStorage.getItem('cgp_crm_session');
            return s ? JSON.parse(s) : null;
          } catch {
            return null;
          }
        })();

        const response = await fetch('/api/leads/bulk', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-user-role': userRole,
            'x-agent-id': savedSession?.username || 'admin',
            ...(savedSession?.token ? { 'Authorization': `Bearer ${savedSession.token}` } : {})
          },
          body: JSON.stringify({ 
            leads: parsedLeads,
            userRole,
            agentId: savedSession?.username || 'admin'
          })
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

  // Helper to fetch 100% of matching leads across all pages if server-side pagination is active
  const fetchAllMatchingLeads = async (): Promise<Lead[]> => {
    try {
      const serializeMulti = (arr: string[]) => (arr.length > 0 ? arr.join('||') : 'All');
      const params = new URLSearchParams({
        all: 'true',
        search: searchQuery || '',
        country: serializeMulti(countryFilter),
        project: serializeMulti(projectFilter),
        position: serializeMulti(positionFilter),
        gender: serializeMulti(genderFilter),
        fitScore: serializeMulti(fitScoreFilter),
        tag: serializeMulti(tagFilter),
        coordinator: serializeMulti(coordinatorFilter),
        stage: serializeMulti(stageFilter),
        dateFilter: serializeMulti(dateFilter),
        customStartDate: customStartDate || '',
        customEndDate: customEndDate || '',
        remarksFilter: serializeMulti(remarksFilter),
        bucket: bucketToggle || 'all',
        userRole: userRole || 'agent',
        agentId: currentAgentId || ''
      });

      const res = await fetch(`/api/leads?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.leads)) {
          return data.leads;
        }
      }
    } catch (err) {
      console.error('Error fetching all leads for export:', err);
    }
    return filteredLeads;
  };

  // Export handlers
  const handleExportXLSX = async () => {
    setIsExporting(true);
    try {
      const leadsToExport = await fetchAllMatchingLeads();
      if (!leadsToExport || leadsToExport.length === 0) {
        alert('No candidate records found matching your filters to export.');
        return;
      }

      const dataToExport = leadsToExport.map((lead, idx) => ({
        'Serial': lead.serialNo || `INQ-${1000 + idx + 1}`,
        'Applicant Name': lead.name,
        'Phone': lead.phone,
        'Alternate Phone': lead.alternateNo || '',
        'Gender': lead.gender || 'M',
        'Age': lead.age || '',
        'Origin / City': lead.origin || '',
        'Country Interest': lead.country,
        'Job Position': lead.position || '',
        'Experience': lead.experience || '',
        'Qualification': lead.qualification || '',
        'Pipeline Stage': lead.stage,
        'Fit Score': (lead.fitScore || 'unqualified').toUpperCase(),
        'Coordinator Assigned': lead.assignedTo || 'Unassigned',
        'Passport Copy Received': lead.docPassportCopy ? 'YES' : 'NO',
        'Resume Received': lead.docResume ? 'YES' : 'NO',
        'Office Visited': lead.docOfficeVisited ? 'YES' : 'NO',
        'Interview Attended': lead.docInterviewAttended ? 'YES' : 'NO',
        'ECR Passport': lead.docEcrPassport ? 'YES' : 'NO',
        'Remarks 1 (First Call)': lead.remarks1 || '',
        'Remarks 2 (Follow-up)': lead.remarks2 || '',
        'Remarks 3 (Final Status)': lead.remarks3 || '',
        'Admin Remarks': lead.adminRemarks || '',
        'Project': lead.project || '',
        'Source': lead.source || '',
        'Created Date': lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : ''
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Candidates");
      XLSX.writeFile(workbook, `CRM_Candidates_Export_${leadsToExport.length}_Records_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error('Export XLSX failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const leadsToExport = await fetchAllMatchingLeads();
      if (!leadsToExport || leadsToExport.length === 0) {
        alert('No candidate records found matching your filters to export.');
        return;
      }

      const dataToExport = leadsToExport.map((lead, idx) => ({
        'Serial': lead.serialNo || `INQ-${1000 + idx + 1}`,
        'Applicant Name': lead.name,
        'Phone': lead.phone,
        'Alternate Phone': lead.alternateNo || '',
        'Gender': lead.gender || 'M',
        'Age': lead.age || '',
        'Origin / City': lead.origin || '',
        'Country Interest': lead.country,
        'Job Position': lead.position || '',
        'Experience': lead.experience || '',
        'Qualification': lead.qualification || '',
        'Pipeline Stage': lead.stage,
        'Fit Score': (lead.fitScore || 'unqualified').toUpperCase(),
        'Coordinator Assigned': lead.assignedTo || 'Unassigned',
        'Passport Copy Received': lead.docPassportCopy ? 'YES' : 'NO',
        'Resume Received': lead.docResume ? 'YES' : 'NO',
        'Office Visited': lead.docOfficeVisited ? 'YES' : 'NO',
        'Interview Attended': lead.docInterviewAttended ? 'YES' : 'NO',
        'ECR Passport': lead.docEcrPassport ? 'YES' : 'NO',
        'Remarks 1 (First Call)': lead.remarks1 || '',
        'Remarks 2 (Follow-up)': lead.remarks2 || '',
        'Remarks 3 (Final Status)': lead.remarks3 || '',
        'Admin Remarks': lead.adminRemarks || '',
        'Project': lead.project || '',
        'Source': lead.source || '',
        'Created Date': lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : ''
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const csvContent = XLSX.utils.sheet_to_csv(worksheet);
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `CRM_Candidates_Export_${leadsToExport.length}_Records_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Export CSV failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  // Whole Backup Master XLSX Download - Downloads 100% of the entire database with all sheets
  const handleDownloadWholeBackupXLSX = async () => {
    try {
      const sessionStr = localStorage.getItem('cgp_crm_session');
      let sessionUser: any = null;
      try { if (sessionStr) sessionUser = JSON.parse(sessionStr); } catch {}
      const role = sessionUser?.role || userRole || 'admin';
      const agent = sessionUser?.username || currentAgentId || 'admin';
      const url = `/api/backup/full-xlsx?role=${encodeURIComponent(role)}&agentId=${encodeURIComponent(agent)}${sessionUser?.token ? `&token=${encodeURIComponent(sessionUser.token)}` : ''}`;

      const res = await fetch(url, {
        headers: {
          'x-user-role': role,
          'x-agent-id': agent
        }
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Download failed with HTTP status ${res.status}`);
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      let finalName = `CGP_CRM_COMPLETE_MASTER_BACKUP_${new Date().toISOString().split('T')[0]}.xlsx`;
      if (contentDisposition && contentDisposition.includes('filename=')) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          finalName = match[1];
        }
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      console.error('Master XLSX download failed:', err);
      // Fallback
      window.location.href = `/api/backup/full-xlsx?role=admin&agentId=admin`;
    }
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
      let className = "text-slate-200 text-xs my-1 leading-relaxed font-sans";

      if (content.startsWith('### ')) {
        content = content.replace('### ', '');
        className = "text-sm font-black text-slate-100 mt-4 mb-2 uppercase tracking-wide flex items-center gap-1.5";
        return <h4 key={idx} className={className}><TrendingUp className="h-4 w-4 text-indigo-400 shrink-0" /> {content}</h4>;
      } else if (content.startsWith('## ')) {
        content = content.replace('## ', '');
        className = "text-base font-black text-slate-100 mt-5 mb-2.5 uppercase tracking-wide border-b pb-1 border-slate-700";
        return <h3 key={idx} className={className}>{content}</h3>;
      } else if (content.startsWith('# ')) {
        content = content.replace('# ', '');
        className = "text-lg font-black text-slate-100 mt-6 mb-3 uppercase tracking-wider";
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
    const list = metaCountries && metaCountries.length > 0
      ? metaCountries
      : Array.from(new Set(leads.map(l => l.country).filter(Boolean)));
    
    // Case-insensitive deduplicate
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
  }, [leads, metaCountries]);

  // Extract unique target projects dynamically for filtering options
  const targetProjectsList = useMemo(() => {
    const list = metaProjects && metaProjects.length > 0
      ? metaProjects
      : Array.from(new Set(leads.map(l => l.project).filter(Boolean)));
    
    // Case-insensitive deduplicate
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
  }, [leads, metaProjects]);

  // Extract unique target job positions dynamically for filtering options
  const targetPositionsList = useMemo(() => {
    const list = metaPositions && metaPositions.length > 0
      ? metaPositions
      : Array.from(new Set(leads.map(l => l.position).filter(Boolean)));
    
    // Case-insensitive deduplicate
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
  }, [leads, metaPositions]);

  // Extract unique candidate tags dynamically for filter options
  const availableTagsList = useMemo(() => {
    const list = metaTags && metaTags.length > 0
      ? metaTags
      : [];
    
    const rawTags = [...list];
    if (rawTags.length === 0) {
      leads.forEach(l => {
        if (l.tags && Array.isArray(l.tags)) {
          l.tags.forEach(t => {
            if (t && t.trim()) rawTags.push(t.trim());
          });
        }
      });
    }
    
    // Case-insensitive deduplicate
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
  }, [leads, metaTags]);

  // Searchable select options helper mappings
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
    if (coordinators && coordinators.length > 0) {
      coordinators.forEach(coord => {
        list.push({
          value: coord.username,
          label: `👤 ${coord.displayName.toUpperCase()}`
        });
      });
    } else {
      COORDINATORS.forEach(coord => {
        list.push({
          value: coord,
          label: `👤 ${coord.toUpperCase()}`
        });
      });
    }
    return list;
  }, [coordinators]);

  const stageOptions = useMemo(() => [
    { value: 'All', label: 'All Pipeline Stages' },
    { value: 'new', label: '1. New Inbound' },
    { value: 'negotiating', label: '2. In Discussion' },
    { value: 'strong_opportunity', label: '3. Strong Opportunity' },
    { value: 'office_visited', label: '4. Office Visited / Interview' },
    { value: 'won', label: '5. Won' },
    { value: 'cold_leads', label: '6. Cold Leads' },
    { value: 'lost', label: '7. Lost' },
  ], []);

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
    { value: 'Male', label: '👦 Male' },
    { value: 'Female', label: '👧 Female' }
  ], []);

  const dateOptions = useMemo(() => [
    { value: 'All', label: '📅 All Dates' },
    { value: 'Today', label: '📅 Today' },
    { value: 'Yesterday', label: '📅 Yesterday' },
    { value: 'Last7Days', label: '📅 Last 7 Days' },
    { value: 'Last30Days', label: '📅 Last 30 Days' },
    { value: 'Custom', label: '📅 Custom Range...' }
  ], []);

  const remarksOptions = useMemo(() => {
    let r1Count = 0;
    let r2Count = 0;
    let r3Count = 0;
    let r1OnlyCount = 0;
    let r2OnlyCount = 0;
    let r3OnlyCount = 0;
    let noneCount = 0;
    let allCount = 0;

    leads.forEach(lead => {
      const h1 = !!(lead.remarks1 && lead.remarks1.trim());
      const h2 = !!(lead.remarks2 && lead.remarks2.trim());
      const h3 = !!(lead.remarks3 && lead.remarks3.trim());

      if (h1) r1Count++;
      if (h2) r2Count++;
      if (h3) r3Count++;
      if (h1 && !h2 && !h3) r1OnlyCount++;
      if (h2 && !h1 && !h3) r2OnlyCount++;
      if (h3 && !h1 && !h2) r3OnlyCount++;
      if (!h1 && !h2 && !h3) noneCount++;
      if (h1 && h2 && h3) allCount++;
    });

    return [
      { value: 'All', label: `💬 Remarks: All (${leads.length})` },
      { value: 'remarks1', label: `💬 Has 1st Remarks (${r1Count})` },
      { value: 'remarks2', label: `💬 Has 2nd Remarks (${r2Count})` },
      { value: 'remarks3', label: `💬 Has 3rd Remarks (${r3Count})` },
      { value: 'remarks1Only', label: `💬 1st Remarks Only (${r1OnlyCount})` },
      { value: 'remarks2Only', label: `💬 2nd Remarks Only (${r2OnlyCount})` },
      { value: 'remarks3Only', label: `💬 3rd Remarks Only (${r3OnlyCount})` },
      { value: 'noRemarks', label: `💬 No Remarks (${noneCount})` },
      { value: 'allRemarks', label: `💬 Has All 3 Remarks (${allCount})` }
    ];
  }, [leads]);

  // Handle comprehensive search & multi-layer filters
  const filteredLeads = useMemo(() => {
    if (onFiltersChange) {
      return leads;
    }
    return leads.filter(lead => {
      // Filter out unassigned leads in stage 'new' (Requesting chats in WhatsApp menu)
      // OR leads that have not been intaken yet, unless actively searching
      if (!searchQuery && !getEffectiveIntake(lead)) {
        return false;
      }

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

      // 3. Country Applied multi-select filter
      const matchesCountry =
        countryFilter.length === 0 ||
        (!!lead.country && countryFilter.some(cf => lead.country!.trim().toLowerCase() === cf.trim().toLowerCase()));

      // 3.5 Hiring Project multi-select filter
      const matchesProject =
        projectFilter.length === 0 ||
        (!!lead.project && projectFilter.some(pf => lead.project!.trim().toLowerCase() === pf.trim().toLowerCase()));

      // 3.6 Target Job Position multi-select filter
      const matchesPosition =
        positionFilter.length === 0 ||
        (!!lead.position && positionFilter.some(pf => lead.position!.trim().toLowerCase() === pf.trim().toLowerCase()));

      // 4. Inbound Quality Fit score multi-select filter
      const matchesFit =
        fitScoreFilter.length === 0 ||
        (!!lead.fitScore && fitScoreFilter.some(ff => lead.fitScore!.trim().toLowerCase() === ff.trim().toLowerCase()));

      // 6. Dynamic Tags multi-select filter
      const matchesTag =
        tagFilter.length === 0 ||
        (!!lead.tags && tagFilter.some(tf => lead.tags!.some(t => t.trim().toLowerCase() === tf.trim().toLowerCase())));

      // 7. Date Wise Multi-Select Filter
      let matchesDate = true;
      if (dateFilter.length > 0) {
        const leadTime = new Date(lead.createdAt).getTime();
        const startOfDay = (d: Date) => {
          const res = new Date(d);
          res.setHours(0, 0, 0, 0);
          return res.getTime();
        };
        const endOfDay = (d: Date) => {
          const res = new Date(d);
          res.setHours(23, 59, 59, 999);
          return res.getTime();
        };

        const today = new Date();
        matchesDate = dateFilter.some(df => {
          if (df === 'Today') {
            return leadTime >= startOfDay(today) && leadTime <= endOfDay(today);
          } else if (df === 'Yesterday') {
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);
            return leadTime >= startOfDay(yesterday) && leadTime <= endOfDay(yesterday);
          } else if (df === 'Last7Days') {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(today.getDate() - 7);
            return leadTime >= startOfDay(sevenDaysAgo) && leadTime <= endOfDay(today);
          } else if (df === 'Last30Days') {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(today.getDate() - 30);
            return leadTime >= startOfDay(thirtyDaysAgo) && leadTime <= endOfDay(today);
          } else if (df === 'Custom') {
            const start = customStartDate ? startOfDay(new Date(customStartDate)) : 0;
            const end = customEndDate ? endOfDay(new Date(customEndDate)) : Infinity;
            return leadTime >= start && leadTime <= end;
          }
          return true;
        });
      }

      // 8. Coordinator Multi-Select Filter (only relevant for admin)
      const matchesCoordinator =
        userRole !== 'admin' ||
        coordinatorFilter.length === 0 ||
        coordinatorFilter.some(cf => isCoordinatorMatch(lead.assignedTo, cf, coordinators));

      // 8.5 Gender Multi-Select Filter
      let matchesGender = true;
      if (genderFilter.length > 0) {
        const g = String(lead.gender || '').toUpperCase().trim();
        matchesGender = genderFilter.some(gf => {
          const filterG = String(gf).toUpperCase().trim();
          if (filterG === 'MALE' || filterG === 'M') return g === 'M' || g === 'MALE';
          if (filterG === 'FEMALE' || filterG === 'F') return g === 'F' || g === 'FEMALE';
          return g === filterG;
        });
      }

      // 8.6 Remarks Multi-Select Filter
      let matchesRemarks = true;
      if (remarksFilter.length > 0) {
        const r1 = !!(lead.remarks1 && lead.remarks1.trim());
        const r2 = !!(lead.remarks2 && lead.remarks2.trim());
        const r3 = !!(lead.remarks3 && lead.remarks3.trim());

        matchesRemarks = remarksFilter.some(rf => {
          if (rf === 'remarks1') return r1;
          if (rf === 'remarks2') return r2;
          if (rf === 'remarks3') return r3;
          if (rf === 'remarks1Only') return r1 && !r2 && !r3;
          if (rf === 'remarks2Only') return r2 && !r1 && !r3;
          if (rf === 'remarks3Only') return r3 && !r1 && !r2;
          if (rf === 'noRemarks') return !r1 && !r2 && !r3;
          if (rf === 'allRemarks') return r1 && r2 && r3;
          return true;
        });
      }

      // 8.7 Pipeline Stage Multi-Select Filter
      let matchesStage = true;
      if (stageFilter.length > 0) {
        const s = lead.stage || 'new';
        matchesStage = stageFilter.some(sf => {
          if (sf === 'negotiating' || sf === 'in_discussion') {
            return s === 'negotiating' || s === 'in_discussion';
          }
          if (sf === 'office_visited' || sf === 'proposal') {
            return s === 'office_visited' || s === 'proposal';
          }
          if (sf === 'cold_leads' || sf === 'rotations') {
            return s === 'cold_leads' || s === 'rotations';
          }
          return s === sf;
        });
      }

      return matchesSearch && matchesCountry && matchesProject && matchesPosition && matchesFit && matchesTag && matchesDate && matchesCoordinator && matchesGender && matchesRemarks && matchesStage;
    });
  }, [leads, searchQuery, countryFilter, stageFilter, projectFilter, positionFilter, genderFilter, fitScoreFilter, tagFilter, dateFilter, customStartDate, customEndDate, userRole, currentAgentId, coordinatorFilter, remarksFilter, coordinators, onFiltersChange]);

  // Paginated leads for page-wise viewport listing
  const paginatedLeads = useMemo(() => {
    if (onPageChange) {
      return leads;
    }
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredLeads.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredLeads, currentPage, onPageChange, leads]);

  // Bulk Re-assignment API Caller (High-performance single atomic batch call)
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
      const res = await fetch('/api/leads/bulk-assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify({
          leadIds: selectedLeadIds,
          assignedTo: bulkCoordinator
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to re-assign selected leads');
      }

      const count = selectedLeadIds.length;
      setSelectedLeadIds([]);
      setBulkCoordinator('');
      onRefreshData();
      console.log(`[Bulk Re-assignment] Successfully assigned ${count} leads.`);
    } catch (err: any) {
      console.error('[Bulk Re-assignment] Error:', err);
      alert(err.message || 'Failed to re-assign selected leads. Please try again.');
    } finally {
      setIsBulkUpdating(false);
    }
  };

  // Bulk Delete Candidates API Caller (Removes leads from active views to lighten load)
  const handleBulkDelete = async () => {
    if (selectedLeadIds.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const res = await fetch('/api/leads/bulk-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId
        },
        body: JSON.stringify({ leadIds: selectedLeadIds })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to delete selected leads');
      }

      const count = selectedLeadIds.length;
      setSelectedLeadIds([]);
      setIsBulkDeleteConfirmOpen(false);
      if (onRefreshData) onRefreshData();
      console.log(`[Bulk Delete] Successfully soft-deleted ${count} leads.`);
    } catch (err: any) {
      console.error('[Bulk Delete] Error:', err);
      setInlineError(err.message || 'Failed to delete selected leads. Please try again.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // Inline updater directly communicates with the Express backend API
  const handleInlineUpdate = async (id: string, fields: Partial<Lead>, origLead?: Lead) => {
    setSavingId(id);
    setInlineError(null);
    const payload: any = { ...fields };
    const clearedRemarks: string[] = [];
    (['remarks1', 'remarks2', 'remarks3'] as const).forEach((key) => {
      if (fields[key] !== undefined && origLead) {
        const prevVal = String(origLead[key] || '').trim();
        const nextVal = String(fields[key] || '').trim();
        if (prevVal !== '' && nextVal === '') {
          clearedRemarks.push(key);
        }
      }
    });
    if (clearedRemarks.length > 0) {
      payload.clearedRemarks = clearedRemarks;
      payload.allowClearRemarks = true;
    }
    if (fields.assignedTo !== undefined && origLead) {
      const prevCoord = String(origLead.assignedTo || '').trim().toLowerCase();
      const nextCoord = String(fields.assignedTo || '').trim().toLowerCase();
      const hadRealCoord = prevCoord !== '' && prevCoord !== 'unassigned' && prevCoord !== 'all';
      const wantsUnassign = nextCoord === '' || nextCoord === 'unassigned' || nextCoord === 'all';
      if (hadRealCoord && wantsUnassign) {
        payload.allowUnassign = true;
      }
    }

    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole,
          'x-agent-id': currentAgentId,
          'x-source-view': 'spreadsheet'
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        if (onRefreshData) onRefreshData();
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.error('Spreadsheet inline update rejected:', errJson);
        if (isRetryableHttpStatus(res.status)) {
          enqueueOutboxSave({
            leadId: id,
            leadName: origLead?.name || 'Candidate',
            phone: origLead?.phone,
            payload,
            headers: { role: userRole, agentId: currentAgentId, sourceView: 'spreadsheet' },
            lastError: errJson.error || `HTTP ${res.status}`
          });
          setInlineError('Cloud save temporarily unavailable — cell edit queued in Pending Cloud Sync and will auto-retry.');
        } else {
          setInlineError(errJson.error || 'Could not save cell update to cloud database. Value reverted—please retry.');
          setInlineRevMap(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
        }
      }
    } catch (err: any) {
      console.error('Spreadsheet inline update failed', err);
      enqueueOutboxSave({
        leadId: id,
        leadName: origLead?.name || 'Candidate',
        phone: origLead?.phone,
        payload,
        headers: { role: userRole, agentId: currentAgentId, sourceView: 'spreadsheet' },
        lastError: err?.message || 'Network interruption'
      });
      setInlineError('Network hiccup while saving — cell edit queued in Pending Cloud Sync and will auto-retry.');
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
      case 'in_discussion':
      case 'negotiating': return 'bg-amber-950/40 text-amber-400 border border-amber-900/30';
      case 'strong_opportunity': return 'bg-sky-950/40 text-sky-400 border border-sky-900/30 font-bold';
      case 'office_visited':
      case 'proposal': return 'bg-purple-950/40 text-purple-400 border border-purple-900/30';
      case 'won': return 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30 font-bold';
      case 'cold_leads':
      case 'rotations': return 'bg-blue-950/40 text-blue-400 border border-blue-900/30';
      case 'lost': return 'bg-slate-800 text-slate-400 border border-slate-700';
      default: return 'bg-slate-800 text-slate-300 border border-slate-700';
    }
  };

  const isSubAgent = userRole === 'agent';

  return (
    <div className="space-y-4" id="cgp-spreadsheet-explorer">
      {inlineError && (
        <div className="bg-rose-950/90 border border-rose-500/60 text-rose-100 px-4 py-3 rounded-xl flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2 text-xs font-bold">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{inlineError}</span>
          </div>
          <button
            type="button"
            onClick={() => setInlineError(null)}
            className="text-xs font-black uppercase tracking-wider text-rose-200 hover:text-white px-2 py-0.5 rounded bg-rose-900/60 cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
      
      {/* Search, Buckets, and Filters Control Panel */}
      <div className="bg-slate-850 p-5 rounded-2xl border border-slate-750 shadow-lg space-y-4">
        
        {/* Row 1: Search & Action Buttons Header */}
        <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
          
          {/* Left: Search Box & Private seat indicator */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center flex-1">
            <div className="relative w-full sm:w-80 text-left">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search Name, Phone, Origin, Position..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-slate-400 dark:border-slate-800 focus:outline-none focus:ring-1 focus:ring-accent-purple bg-white dark:bg-slate-950 text-emerald-800 dark:text-emerald-300 placeholder-slate-400 dark:placeholder-slate-500 font-bold"
              />
            </div>

            {userRole === 'agent' && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-800 rounded-xl text-[10px] font-black tracking-wider uppercase select-none shadow-sm shrink-0">
                <span>🔒 CO-ORDINATOR PRIVATE SEAT ({filteredLeads.length} Contacts)</span>
              </div>
            )}
          </div>

          {/* Right: Quick Action Buttons & View Switcher flex row */}
          <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end shrink-0">
            {/* Table / Grid View Switcher */}
            <div className="flex items-center gap-0.5 bg-slate-900 border border-slate-750 p-1 rounded-lg shadow-inner shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-emerald-800 text-white border border-emerald-600/60 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Spreadsheet Table View"
              >
                <Table className="h-3 w-3" />
                <span>Table View</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-emerald-800 text-white border border-emerald-600/60 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Candidate Cards Grid View"
              >
                <LayoutGrid className="h-3 w-3" />
                <span>Grid View</span>
              </button>
            </div>

            {/* Interactive G-Sheet Mode Toggle (only for Table View) */}
            {viewMode === 'table' && (
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
            )}

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
              disabled={filteredLeads.length === 0 || isExporting}
              className="text-xs font-black px-3.5 py-1.5 bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-750 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-3xs"
              title="Export filtered directory to .CSV"
            >
              <Download className="h-3.5 w-3.5 text-slate-400" />
              <span>📄 Export CSV</span>
            </button>

            {/* Export Filtered XLSX Button */}
            <button
              type="button"
              onClick={handleExportXLSX}
              disabled={filteredLeads.length === 0 || isExporting}
              className="text-xs font-black px-3.5 py-1.5 bg-emerald-950/20 hover:bg-emerald-950/40 text-emerald-400 border border-emerald-900/30 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-3xs"
              title="Export filtered directory (all pages) to Microsoft Excel .XLSX"
            >
              <Download className="h-3.5 w-3.5 text-emerald-500" />
              <span>{isExporting ? '⏳ Exporting...' : '📊 Export XLSX'}</span>
            </button>

            {/* Whole Database Backup XLSX Button - 100% Complete Multi-Sheet Excel */}
            <button
              type="button"
              onClick={handleDownloadWholeBackupXLSX}
              className="text-xs font-black px-3.5 py-1.5 bg-gradient-to-r from-blue-900/40 to-indigo-900/40 hover:from-blue-900/60 hover:to-indigo-900/60 text-cyan-300 border border-cyan-500/40 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-md hover:shadow-cyan-900/30"
              title="Download Complete Whole CRM Database in multi-sheet XLSX (All candidates, chats, tasks, timeline, jobs, coordinators)"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400 animate-bounce" />
              <span className="font-extrabold tracking-wide">📦 Whole Backup (.XLSX)</span>
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

        {/* Divider line between Search & Actions Row and Filters Row */}
        <div className="border-t border-slate-700/60 dark:border-slate-800/80 my-1" />

        {/* Row 2: Directory Filters Grid section */}
        <div className="space-y-3 text-left">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-black text-black dark:text-slate-100 uppercase tracking-widest leading-none select-none">
              <Filter className="h-3.5 w-3.5 text-black dark:text-slate-100" /> DIRECTORY FILTERS ({onPageChange ? totalLeadsCount : filteredLeads.length} Matches):
            </div>
            
            {/* Reset All Filters button if any are active */}
            {(countryFilter.length > 0 || coordinatorFilter.length > 0 || stageFilter.length > 0 || projectFilter.length > 0 || positionFilter.length > 0 || tagFilter.length > 0 || fitScoreFilter.length > 0 || genderFilter.length > 0 || remarksFilter.length > 0 || dateFilter.length > 0) && (
              <button
                type="button"
                onClick={() => {
                  setCountryFilter([]);
                  setCoordinatorFilter([]);
                  setStageFilter([]);
                  setProjectFilter([]);
                  setPositionFilter([]);
                  setTagFilter([]);
                  setFitScoreFilter([]);
                  setGenderFilter([]);
                  setRemarksFilter([]);
                  setDateFilter([]);
                  setCustomStartDate('');
                  setCustomEndDate('');
                }}
                className="text-[10px] font-black text-red-500 dark:text-red-400 hover:text-red-600 uppercase tracking-widest flex items-center gap-1.5 bg-red-100/10 dark:bg-red-950/20 px-3 py-1.5 rounded-xl cursor-pointer transition-all border border-red-500/25 active:scale-95"
              >
                ✕ Clear All Filters
              </button>
            )}
          </div>

          {/* Filters Responsive Grid - 10 Multi-Select Filters total */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-10 gap-2 2xl:gap-2.5 w-full">
            
            {/* Country filter */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Country</label>
              <MultiSearchableSelect
                values={countryFilter}
                onChange={setCountryFilter}
                options={countryOptions}
                allLabel="All Countries"
                placeholder="Search countries..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white hover:bg-emerald-50/50 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer uppercase shadow-2xs"
              />
            </div>

            {/* Coordinator Filter - only in Admin View */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Coordinator</label>
              {userRole === 'admin' ? (
                <MultiSearchableSelect
                  values={coordinatorFilter}
                  onChange={setCoordinatorFilter}
                  options={coordinatorOptions}
                  allLabel="👤 All Coordinators"
                  placeholder="Search coordinators..."
                  badgeColor="bg-emerald-600"
                  activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                  activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                  className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/80 hover:bg-emerald-100/80 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/60 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer uppercase shadow-2xs"
                />
              ) : (
                <div className="w-full text-xs px-3.5 py-1.5 rounded-xl border border-dashed border-slate-700 bg-slate-900/10 text-slate-600 font-extrabold select-none truncate">
                  MY ASSIGNED
                </div>
              )}
            </div>

            {/* Pipeline Stage Filter */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Pipeline Stage</label>
              <MultiSearchableSelect
                values={stageFilter}
                onChange={setStageFilter}
                options={stageOptions}
                allLabel="All Stages"
                placeholder="Search stages..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white hover:bg-emerald-50/50 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer uppercase shadow-2xs"
              />
            </div>

            {/* Hiring Project filter */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Project</label>
              <MultiSearchableSelect
                values={projectFilter}
                onChange={setProjectFilter}
                options={projectOptions}
                allLabel="All Projects"
                placeholder="Search projects..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white hover:bg-emerald-50/50 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer uppercase shadow-2xs"
              />
            </div>

            {/* Target Job Position Filter */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Position</label>
              <MultiSearchableSelect
                values={positionFilter}
                onChange={setPositionFilter}
                options={positionOptions}
                allLabel="All Positions"
                placeholder="Search positions..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white hover:bg-emerald-50/50 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer uppercase shadow-2xs animate-fade-in"
              />
            </div>

            {/* Tags Filter Dropdown */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Tag</label>
              <MultiSearchableSelect
                values={tagFilter}
                onChange={setTagFilter}
                options={tagOptions}
                allLabel="All Tags"
                placeholder="Search tags..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white hover:bg-emerald-50/50 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer shadow-2xs"
              />
            </div>

            {/* Fit score filter */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Fit Score</label>
              <MultiSearchableSelect
                values={fitScoreFilter}
                onChange={setFitScoreFilter}
                options={fitScoreOptions}
                allLabel="All AI Quality Fit"
                placeholder="Search fit quality..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white hover:bg-emerald-50/50 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer shadow-2xs"
              />
            </div>

            {/* Gender Filter */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Gender</label>
              <MultiSearchableSelect
                values={genderFilter}
                onChange={setGenderFilter}
                options={genderOptions}
                allLabel="All Genders"
                placeholder="Filter genders..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white hover:bg-emerald-50/50 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer uppercase shadow-2xs"
              />
            </div>

            {/* Remarks wise Filter */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Remarks Status</label>
              <MultiSearchableSelect
                values={remarksFilter}
                onChange={setRemarksFilter}
                options={remarksOptions}
                allLabel={`💬 Remarks: All (${leads.length})`}
                placeholder="Search remarks..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                align="right"
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white hover:bg-emerald-50/50 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer shadow-2xs"
              />
            </div>

            {/* Date Wise Filter */}
            <div className="w-full">
              <label className="block text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Date Period</label>
              <MultiSearchableSelect
                values={dateFilter}
                onChange={setDateFilter}
                options={dateOptions}
                allLabel="📅 All Dates"
                placeholder="Search date periods..."
                badgeColor="bg-emerald-600"
                activeTextClass="text-[#0d7d4d] dark:text-emerald-200"
                activeBorderClass="border-emerald-500 ring-1 ring-emerald-500/40"
                align="right"
                className="w-full text-xs px-3 py-1.5 rounded-xl border border-emerald-200/90 dark:border-emerald-800/60 bg-white hover:bg-emerald-50/50 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[#0d7d4d] dark:text-emerald-300 font-extrabold focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer uppercase shadow-2xs"
              />
            </div>

          </div>

          {/* Date Picker Custom inputs rendered beautifully underneath filter grid */}
          {dateFilter.includes('Custom') && (
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 p-2.5 max-w-md rounded-2xl animate-in fade-in zoom-in-95 mt-2 shadow-inner">
              <span className="text-[10px] text-slate-400 font-black tracking-wide">FROM:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="text-xs font-extrabold text-emerald-800 dark:text-emerald-300 bg-transparent border-none focus:outline-none cursor-pointer [color-scheme:dark]"
                style={{ colorScheme: 'dark' }}
                title="Start Date"
              />
              <span className="text-[10px] text-slate-500 font-black font-mono">TO</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="text-xs font-extrabold text-emerald-800 dark:text-emerald-300 bg-transparent border-none focus:outline-none cursor-pointer [color-scheme:dark]"
                style={{ colorScheme: 'dark' }}
                title="End Date"
              />
            </div>
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
                          'Qualification': 'B.Sc Nursing',
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
                          'Qualification': '12th Pass',
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
              {isBulkUpdating ? 'Assigning...' : `Assign ${selectedLeadIds.length} Candidate${selectedLeadIds.length > 1 ? 's' : ''}`}
            </button>

            {/* Bulk Delete Button */}
            <button
              type="button"
              onClick={() => setIsBulkDeleteConfirmOpen(true)}
              disabled={isBulkDeleting}
              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-extrabold text-xs rounded-lg shadow-sm transition-all flex items-center gap-1.5 cursor-pointer ml-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isBulkDeleting ? 'Deleting...' : `Delete Selected (${selectedLeadIds.length})`}</span>
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

      {/* Bulk Delete Confirmation Modal */}
      {isBulkDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-rose-900/60 rounded-2xl max-w-md w-full p-6 text-left shadow-2xl relative overflow-hidden animate-in zoom-in-95">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-rose-500 via-rose-600 to-rose-700" />
            <div className="flex items-start gap-3.5 mb-4">
              <div className="p-2.5 bg-rose-950/60 border border-rose-800/80 rounded-xl text-rose-400 shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-100 uppercase tracking-wide">
                  Confirm Bulk Deletion
                </h3>
                <p className="text-xs text-slate-400 mt-1 font-bold">
                  Are you sure you want to delete <span className="text-rose-400 font-black">{selectedLeadIds.length}</span> selected candidate(s)?
                </p>
              </div>
            </div>

            <div className="bg-rose-950/25 border border-rose-900/40 rounded-xl p-3 text-[11px] text-rose-300/90 font-medium mb-5">
              This will remove the selected candidates from active views, pipelines, and spreadsheets to reduce CRM system load. Candidates are safely archived in soft-delete state and can be restored anytime by an administrator.
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsBulkDeleteConfirmOpen(false)}
                disabled={isBulkDeleting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
                className="px-5 py-2 rounded-xl text-xs font-black text-white bg-rose-600 hover:bg-rose-500 transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-rose-950/50"
              >
                {isBulkDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting Candidates...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Yes, Delete {selectedLeadIds.length} Candidate{selectedLeadIds.length > 1 ? 's' : ''}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-850 rounded-2xl border border-slate-750 overflow-hidden shadow-lg text-left">
        {viewMode === 'table' && isInlineEdit && (
          <div className="bg-emerald-950/40 border-b border-slate-750 p-2.5 px-4 text-[11px] font-bold text-slate-300 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent-emerald animate-pulse" />
              <span>Spreadsheet Grid Edit Mode Active: Double-click or type directly in Remarks, Coordinator, and Position cells. Changes save instantly on Enter or Tab.</span>
            </div>
            <span className="text-[10px] bg-slate-800 border border-slate-750 px-1.5 py-0.5 rounded text-accent-emerald uppercase tracking-wide font-black">Google Sheets format</span>
          </div>
        )}

        {viewMode === 'grid' ? (
          <div className="p-4 sm:p-5 space-y-4 bg-slate-950/35">
            {/* Grid View Header Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
              <label className="flex items-center gap-2 text-xs font-black text-slate-300 uppercase tracking-wider cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={paginatedLeads.length > 0 && paginatedLeads.map(l => l.id).every(id => selectedLeadIds.includes(id))}
                  onChange={() => {
                    const visibleIds = paginatedLeads.map(l => l.id);
                    const isAllSelected = visibleIds.length > 0 && visibleIds.every(id => selectedLeadIds.includes(id));
                    if (isAllSelected) {
                      setSelectedLeadIds(prev => prev.filter(id => !visibleIds.includes(id)));
                    } else {
                      setSelectedLeadIds(prev => Array.from(new Set([...prev, ...visibleIds])));
                    }
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-700 text-accent-purple focus:ring-accent-purple cursor-pointer bg-slate-950"
                />
                <span>Select All on Page ({paginatedLeads.length})</span>
              </label>

              <span className="text-[10px] uppercase font-black text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-3 py-1 rounded-full font-mono">
                Grid View • {paginatedLeads.length} Cards on Page
              </span>
            </div>

            {paginatedLeads.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 2xl:gap-4 py-1">
                {paginatedLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onSelectLead={onSelectLead}
                    onUpdateStage={onUpdateStage}
                    draggable={false}
                    showStageBadge={true}
                    isSelected={selectedLeadIds.includes(lead.id)}
                    onToggleSelect={(id) => {
                      setSelectedLeadIds(prev =>
                        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                      );
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 text-slate-500 font-bold bg-slate-900/20 border border-dashed border-slate-750 rounded-2xl">
                No placement candidates match selected options. Verify active spreadsheet categories or sub-agent bucket filters.
              </div>
            )}
          </div>
        ) : (
        <div className="overflow-x-auto max-h-[calc(100vh-19.5rem)] min-h-[22rem] 2xl:max-h-[38.75rem] overflow-y-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-900/50 border-b border-slate-750 text-left select-none">
                <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider w-10 text-center">
                  <input
                    type="checkbox"
                    checked={paginatedLeads.length > 0 && paginatedLeads.map(l => l.id).every(id => selectedLeadIds.includes(id))}
                    onChange={() => {
                      const visibleIds = paginatedLeads.map(l => l.id);
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
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[110px] text-center whitespace-nowrap">Entry Date</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[170px]">Applicant Candidate</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[110px]">Pipeline Stage</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">Country</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[150px]">Position Opening</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[130px]">Coordinator (Telecaller)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[170px]">Remarks 1 (First Call)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[170px]">Remarks 2 (Follow-up)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider min-w-[170px]">Remarks 3 (Final Status)</th>
                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-750/60">
              {paginatedLeads.length > 0 ? (
                paginatedLeads.map((lead) => {
                  const isSavingThis = savingId === lead.id;

                  return (
                    <motion.tr
                      key={lead.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.12 }}
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

                      {/* Entry Date */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <span className="font-mono font-bold text-[11px] text-slate-300 bg-slate-900/90 px-2.5 py-1.5 rounded-md border border-slate-750 shadow-3xs inline-block whitespace-nowrap">
                          📅 {lead.entryDate ? lead.entryDate : (lead.createdAt ? lead.createdAt.split('T')[0] : '—')}
                        </span>
                      </td>

                      {/* 2. Candidate Demographics */}
                      <td className="px-4 py-3 max-w-[200px]">
                        <div>
                          <div className={`font-extrabold text-emerald-800 dark:text-emerald-400 uppercase tracking-normal truncate ${!isInlineEdit && 'group-hover:text-accent-emerald transition-colors'} flex items-center gap-1.5 font-sans`}>
                            <span className="truncate">{formatCandidateName(lead.name)}</span>
                            {lead.isBlocked && (
                              <span 
                                className="shrink-0 text-[9px] font-black text-white bg-red-600 px-1.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs tracking-wider"
                                title={`BLOCKED: ${lead.blockedReason || 'Blocked candidate'}`}
                              >
                                <Ban className="h-2.5 w-2.5 stroke-[2.5]" />
                                BLOCKED
                              </span>
                            )}
                            {(() => {
                              const inboundCount = (lead.messages || []).filter(m => m && m.sender === 'lead' && m.status !== 'read').length;
                              if (inboundCount > 0) {
                                return (
                                  <span 
                                    className="shrink-0 text-[9.5px] font-black text-emerald-950 dark:text-emerald-300 bg-emerald-400 dark:bg-emerald-950/90 border border-emerald-500/50 dark:border-emerald-700/80 px-1.5 py-0.2 rounded-full flex items-center gap-0.5 shadow-2xs animate-pulse font-mono"
                                    title={`${inboundCount} unread WhatsApp message${inboundCount > 1 ? 's' : ''} received`}
                                  >
                                    <MessageSquare className="h-2.5 w-2.5 fill-current" />
                                    <span>{inboundCount}</span>
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </div>
                          <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono font-bold mt-0.5">{lead.phone}</div>

                          <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mt-0.5">
                            {(() => {
                              const g = String(lead.gender || '').toUpperCase().trim();
                              if (g === 'F' || g === 'FEMALE') return 'Female';
                              if (g === 'M' || g === 'MALE') return 'Male';
                              return 'Not Defined';
                            })()}, Age {lead.age || 'N/A'} ({lead.origin || 'No State'})
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
                          {(lead.project || lead.source || lead.docEcrPassport) && (
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
                              {lead.docEcrPassport && (
                                <span className="bg-rose-950/40 text-rose-500 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-rose-900/30">
                                  🛂 ECR Passport
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 10. Pipeline Stage select box */}
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={lead.stage === 'negotiating' ? 'in_discussion' : lead.stage === 'proposal' ? 'office_visited' : lead.stage === 'rotations' ? 'cold_leads' : lead.stage}
                          onChange={(e) => onUpdateStage(lead.id, e.target.value as LeadStage)}
                          className={`text-[9px] font-bold rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-slate-900 cursor-pointer w-[110px] truncate ${getStageHeader(lead.stage)}`}
                        >
                          <option value="new">1. NEW INBOUND</option>
                          <option value="in_discussion">2. IN DISCUSSION</option>
                          <option value="strong_opportunity">3. STRONG OPPORTUNITY</option>
                          <option value="office_visited">4. OFFICE VISITED/INTERVIEW ATTENDED</option>
                          <option value="won">5. WON</option>
                          <option value="cold_leads">6. COLD LEADS</option>
                          <option value="lost">7. LOST</option>
                        </select>
                      </td>

                      {/* 3. Target Country */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-[10px] font-extrabold text-slate-300 bg-slate-800 px-2 py-1 rounded border border-slate-700 uppercase flex items-center gap-1.5 w-fit" title={lead.country || 'Pending'}>
                          {lead.country && getCountryFlagUrl(lead.country) ? (
                            <img 
                              src={getCountryFlagUrl(lead.country)} 
                              alt="" 
                              className="w-4 h-3 object-cover rounded-2xs inline-block shadow-2xs shrink-0"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="shrink-0">🌐</span>
                          )}
                          <span className="truncate max-w-[100px] inline-block">{lead.country || 'Pending'}</span>
                        </span>
                      </td>

                      {/* 4. Position & Exp (Editable in Inline Edit!) */}
                      <td className="px-4 py-3" onClick={(e) => isInlineEdit && e.stopPropagation()}>
                        {isInlineEdit && !isSubAgent ? (
                          <input
                            key={`pos-${lead.id}-${lead.position || ''}-${inlineRevMap[lead.id] || 0}`}
                            type="text"
                            defaultValue={lead.position || ''}
                            placeholder="Type Position..."
                            onBlur={(e) => {
                              const nextVal = e.target.value;
                              if (nextVal.trim() === String(lead.position || '').trim()) return;
                              handleInlineUpdate(lead.id, { position: nextVal }, lead);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-full text-xs px-2 py-1 rounded bg-slate-900 border border-slate-700 focus:outline-none focus:ring-1 focus:ring-accent-purple focus:bg-slate-900 transition-all text-slate-100 font-bold uppercase"
                          />
                        ) : (
                          <div>
                            <div className="font-bold text-emerald-800 dark:text-slate-100 truncate" title={lead.position}>
                              {lead.position || 'Open openings'}
                            </div>
                            <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 italic" title={lead.experience}>
                              {lead.experience || 'Fresh criteria'}
                            </div>
                          </div>
                        )}
                      </td>


                      {/* 6. Assigned Telecaller (Editable dropdown in Inline edit!) */}
                      <td className="px-4 py-3" onClick={(e) => isInlineEdit && e.stopPropagation()}>
                        {isInlineEdit && !isSubAgent ? (
                          <select
                            value={(() => {
                              const raw = String(lead.assignedTo || '').trim();
                              if (!raw || raw.toLowerCase() === 'unassigned') return '';
                              const lower = raw.toLowerCase();
                              if (coordinators && coordinators.length > 0) {
                                const hit = coordinators.find(c => c.username.toLowerCase() === lower || (c.displayName && c.displayName.toLowerCase() === lower));
                                return hit ? hit.username : raw;
                              }
                              const hitFallback = COORDINATORS.find(c => c.toLowerCase() === lower);
                              return hitFallback || raw;
                            })()}
                            onChange={(e) => handleInlineUpdate(lead.id, { assignedTo: e.target.value }, lead)}
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
                            key={`r1-${lead.id}-${lead.remarks1 || ''}-${inlineRevMap[lead.id] || 0}`}
                            type="text"
                            defaultValue={lead.remarks1 || ''}
                            placeholder="Update call remarks 1..."
                            onBlur={(e) => {
                              const nextVal = e.target.value;
                              if (nextVal.trim() === String(lead.remarks1 || '').trim()) return;
                              handleInlineUpdate(lead.id, { remarks1: nextVal }, lead);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
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
                            key={`r2-${lead.id}-${lead.remarks2 || ''}-${inlineRevMap[lead.id] || 0}`}
                            type="text"
                            defaultValue={lead.remarks2 || ''}
                            placeholder="Update call remarks 2..."
                            onBlur={(e) => {
                              const nextVal = e.target.value;
                              if (nextVal.trim() === String(lead.remarks2 || '').trim()) return;
                              handleInlineUpdate(lead.id, { remarks2: nextVal }, lead);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
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
                            key={`r3-${lead.id}-${lead.remarks3 || ''}-${inlineRevMap[lead.id] || 0}`}
                            type="text"
                            defaultValue={lead.remarks3 || ''}
                            placeholder="Update call remarks 3..."
                            onBlur={(e) => {
                              const nextVal = e.target.value;
                              if (nextVal.trim() === String(lead.remarks3 || '').trim()) return;
                              handleInlineUpdate(lead.id, { remarks3: nextVal }, lead);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
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
                          
                          {lead.resumeUrl ? (
                            <a
                              href={lead.resumeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 px-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/50 rounded transition-colors cursor-pointer"
                              title={`View ${formatCandidateName(String(lead.name || 'Candidate'))}'s CV`}
                            >
                              <FileText className="h-4 w-4" />
                            </a>
                          ) : null}
                          
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
                    </motion.tr>
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
        )}

        {/* Pagination Controls */}
        {((onPageChange && totalPagesCount > 1) || (!onPageChange && filteredLeads.length > itemsPerPage)) && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-slate-750 bg-slate-900/50 rounded-b-xl select-none">
            <div className="text-xs text-slate-400 font-semibold">
              Showing <span className="text-slate-200 font-bold">{
                onPageChange 
                  ? (totalLeadsCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1)
                  : Math.min(filteredLeads.length, (currentPage - 1) * itemsPerPage + 1)
              }</span> to{' '}
              <span className="text-slate-200 font-bold">{
                onPageChange
                  ? Math.min(totalLeadsCount, currentPage * itemsPerPage)
                  : Math.min(filteredLeads.length, currentPage * itemsPerPage)
              }</span> of{' '}
              <span className="text-slate-200 font-bold">{
                onPageChange ? totalLeadsCount : filteredLeads.length
              }</span> candidates
            </div>
            
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                Previous
              </button>
              
              {Array.from({ length: onPageChange ? totalPagesCount : Math.ceil(filteredLeads.length / itemsPerPage) }).map((_, idx) => {
                const pageNum = idx + 1;
                const totalPages = onPageChange ? totalPagesCount : Math.ceil(filteredLeads.length / itemsPerPage);
                if (
                  pageNum === 1 ||
                  pageNum === totalPages ||
                  Math.abs(pageNum - currentPage) <= 1
                ) {
                  return (
                    <button
                      key={pageNum}
                      type="button"
                      onClick={() => setCurrentPage(pageNum)}
                      className={`h-7 w-7 rounded flex items-center justify-center text-xs font-bold border transition-all cursor-pointer ${
                        currentPage === pageNum
                          ? 'bg-accent-purple border-accent-purple text-white shadow-md shadow-accent-purple/20 scale-105'
                          : 'bg-slate-850 border-slate-750 text-slate-400 hover:bg-slate-750 hover:text-slate-200'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                }
                
                if (pageNum === 2 || pageNum === totalPages - 1) {
                  return (
                    <span key={pageNum} className="text-slate-500 font-bold px-1 select-none text-xs">
                      ...
                    </span>
                  );
                }
                
                return null;
              })}
              
              <button
                type="button"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, onPageChange ? totalPagesCount : Math.ceil(filteredLeads.length / itemsPerPage)))}
                disabled={currentPage === (onPageChange ? totalPagesCount : Math.ceil(filteredLeads.length / itemsPerPage))}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
