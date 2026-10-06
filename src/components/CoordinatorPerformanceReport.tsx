import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
  Cell
} from 'recharts';
import { 
  BarChart3, RefreshCw, Download, FileSpreadsheet, Printer, Users, HelpCircle, 
  Search, ArrowUpRight, ArrowDownRight, Clock, Check, AlertTriangle, ArrowRight,
  TrendingUp, Award, Zap, ShieldAlert, ChevronDown, ChevronRight, User, ExternalLink, Filter, Map, Layers
} from 'lucide-react';
import { Lead, Coordinator } from '../types';
import { getCountryFlagUrl, formatCandidateName, getEffectiveIntake } from '../utils';

const CustomTrendTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const dataPoint = payload[0].payload;
    return (
      <div className="bg-blue-600 text-white px-4 py-2.5 rounded-xl shadow-xl text-center relative border-none select-none z-50">
        <p className="text-xl font-black font-mono leading-none">{dataPoint.count}</p>
        <p className="text-[10px] font-bold text-blue-100 uppercase tracking-wider mt-1">{dataPoint.monthLabel}</p>
        <div className="absolute -bottom-1 w-2.5 h-2.5 bg-blue-600 rotate-45 left-1/2 -translate-x-1/2" />
      </div>
    );
  }
  return null;
};

interface CoordinatorPerformanceReportProps {
  leads: Lead[];
  coordinators: Coordinator[];
  onSelectLead: (lead: Lead) => void;
  onRefreshData: () => void;
  userRole: 'admin' | 'agent';
  currentAgentId: string;
}

export default function CoordinatorPerformanceReport({
  leads,
  coordinators,
  onSelectLead,
  onRefreshData,
  userRole,
  currentAgentId
}: CoordinatorPerformanceReportProps) {
  // Report Data & Filters
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    return new Date().toISOString().slice(0, 7); // Default current month YYYY-MM
  });
  const [selectedCoord, setSelectedCoordinator] = useState<string>('all');
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [selectedCountry, setSelectedCountry] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [attributionMode, setAttributionMode] = useState<'ownership' | 'activity'>('ownership');

  // Trend Chart State for Google Business Profile style line graph comparison
  const [trendStage, setTrendStage] = useState<string>('assigned');
  const [comparisonChartType, setComparisonChartType] = useState<'stacked' | 'grouped'>('stacked');

  // Client-side lead history backfiller to reconstruct stage and coordinator histories from timeline logs
  const processedLeads = useMemo(() => {
    const mapLabelToKey = (label: string): string => {
      const l = label.toLowerCase().trim();
      if (l.includes('new inbound') || l === 'new') return 'new';
      if (l.includes('in discussion') || l.includes('negotiating') || l === 'discussion') return 'in_discussion';
      if (l.includes('strong opportunity') || l.includes('rotations') || l === 'strong') return 'strong_opportunity';
      if (l.includes('office visited') || l.includes('interview') || l.includes('proposal')) return 'office_visited';
      if (l.includes('won') || l.includes('closed won')) return 'won';
      if (l.includes('cold') || l.includes('cold leads')) return 'cold_leads';
      if (l.includes('lost') || l.includes('closed lost')) return 'lost';
      return l;
    };

    return leads.map(l => {
      const lead = {
        ...l,
        stageHistory: l.stageHistory ? [...l.stageHistory] : [],
        coordinatorHistory: l.coordinatorHistory ? [...l.coordinatorHistory] : []
      };

      // If histories are empty and we have timeline logs, reconstruct them
      if (lead.stageHistory.length === 0 && lead.timeline && lead.timeline.length > 0) {
        const sortedTimeline = [...lead.timeline].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
        let currentStage = 'new';
        let currentCoordinator = lead.assignedTo || 'unassigned';

        lead.stageHistory.push({
          candidateId: lead.id,
          previousStage: 'none',
          newStage: 'new',
          changedBy: 'System (Backfill)',
          coordinatorId: currentCoordinator,
          changedAt: lead.createdAt || lead.entryDate || new Date().toISOString(),
          project: lead.project,
          country: lead.country
        });

        sortedTimeline.forEach((t: any) => {
          const text = (t.text || '').toLowerCase();
          const timestamp = t.timestamp || new Date().toISOString();
          const actor = t.actor || 'System';

          if (t.type === 'status' || text.includes('pipeline stage changed') || text.includes('pipeline stage auto-moved')) {
            let fromStage = '';
            let toStage = '';

            if (text.includes('changed from') && text.includes('to')) {
              const parts = text.split('changed from');
              if (parts[1]) {
                const subParts = parts[1].split('to');
                fromStage = subParts[0].replace(/['"“”]/g, '').trim();
                toStage = subParts[1].replace(/['"“”]/g, '').trim();
              }
            } else if (text.includes('auto-moved to')) {
              const parts = text.split('auto-moved to');
              if (parts[1]) {
                toStage = parts[1].split('due to')[0].replace(/['"“”]/g, '').trim();
              }
            }

            const newStageKey = toStage ? mapLabelToKey(toStage) : '';
            const prevStageKey = fromStage ? mapLabelToKey(fromStage) : currentStage;

            if (newStageKey) {
              lead.stageHistory.push({
                candidateId: lead.id,
                previousStage: prevStageKey,
                newStage: newStageKey,
                changedBy: actor,
                coordinatorId: currentCoordinator,
                changedAt: timestamp,
                project: lead.project,
                country: lead.country
              });
              currentStage = newStageKey;
            }
          }

          if (t.type === 'assignment' || text.includes('assigned coordinator changed')) {
            let fromCoord = '';
            let toCoord = '';
            if (text.includes('changed from') && text.includes('to')) {
              const parts = text.split('changed from');
              if (parts[1]) {
                const subParts = parts[1].split('to');
                fromCoord = subParts[0].replace(/['"“”]/g, '').trim();
                toCoord = subParts[1].split('via')[0].replace(/['"“”]/g, '').trim();
              }
            }

            if (toCoord) {
              lead.coordinatorHistory.push({
                candidateId: lead.id,
                previousCoordinator: fromCoord || 'unassigned',
                newCoordinator: toCoord,
                changedBy: actor,
                changedAt: timestamp
              });
              currentCoordinator = toCoord;
            }
          }
        });

        lead.stageHistory.sort((a: any, b: any) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
        lead.coordinatorHistory.sort((a: any, b: any) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
      }

      // Ensure baseline starting snapshot exists if history is still empty
      if (lead.stageHistory.length === 0) {
        lead.stageHistory.push({
          candidateId: lead.id,
          previousStage: 'none',
          newStage: lead.stage || 'new',
          changedBy: 'System (Initial)',
          coordinatorId: lead.assignedTo || 'unassigned',
          changedAt: lead.createdAt || lead.entryDate || new Date().toISOString(),
          project: lead.project,
          country: lead.country
        });
      }

      if (lead.coordinatorHistory.length === 0) {
        lead.coordinatorHistory.push({
          candidateId: lead.id,
          previousCoordinator: 'unassigned',
          newCoordinator: lead.assignedTo || 'unassigned',
          changedBy: 'System (Initial)',
          changedAt: lead.assignDate || lead.createdAt || lead.entryDate || new Date().toISOString()
        });
      }

      return lead;
    });
  }, [leads]);

  // Calculate moving 6-month array ending in the selected month
  const trendMonths = useMemo(() => {
    if (!selectedMonth) return [];
    const [year, month] = selectedMonth.split('-').map(Number);
    const list = [];
    for (let i = 5; i >= 0; i--) {
      let m = month - i;
      let y = year;
      if (m <= 0) {
        m += 12;
        y -= 1;
      }
      list.push(`${y}-${String(m).padStart(2, '0')}`);
    }
    return list;
  }, [selectedMonth]);

  const selectedCoordDisplayName = useMemo(() => {
    if (selectedCoord === 'all') return 'All Coordinators';
    const found = coordinators.find(c => c.username.toLowerCase() === selectedCoord.toLowerCase());
    return found ? found.displayName : selectedCoord.toUpperCase();
  }, [selectedCoord, coordinators]);

  // Format month YYYY-MM into readable label like "Jun 2026"
  const formatMonthLabel = (monthStr: string) => {
    const [y, m] = monthStr.split('-');
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  // Compile 6-month historical counts for selected stage and coordinator
  const trendData = useMemo(() => {
    if (!data || !processedLeads || trendMonths.length === 0) return [];

    const getMonthStr = (dateVal: any): string => {
      if (!dateVal) return '';
      try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) {
          if (typeof dateVal === 'string' && /^\d{4}-\d{2}/.test(dateVal)) {
            return dateVal.slice(0, 7);
          }
          return '';
        }
        return d.toISOString().slice(0, 7);
      } catch {
        return '';
      }
    };

    const stdStage = (st: string): string => {
      if (!st) return 'new';
      const s = st.toLowerCase().trim();
      if (s === 'negotiating') return 'in_discussion';
      if (s === 'rotations') return 'cold_leads'; // Maps correctly to cold_leads (Cold Leads)
      if (s === 'proposal') return 'office_visited';
      return s;
    };

    return trendMonths.map(monthStr => {
      let count = 0;
      const monthEndBoundary = `${monthStr}-31T23:59:59.999Z`;

      processedLeads.forEach(lead => {
        // Soft delete ignore
        if (lead.isDeleted) return;

        // Exclude un-intaken leads from the performance reports to align with board counts
        if (!getEffectiveIntake(lead)) return;

        // Apply filters
        if (selectedProject !== 'all' && String(lead.project || '').trim().toLowerCase() !== selectedProject.trim().toLowerCase()) return;
        if (selectedCountry !== 'all' && String(lead.country || '').trim().toLowerCase() !== selectedCountry.trim().toLowerCase()) return;
        if (selectedSource !== 'all' && String(lead.source || '').trim().toLowerCase() !== selectedSource.trim().toLowerCase()) return;

        const leadCreatedDate = lead.createdAt || lead.entryDate || '';
        const createdMonth = getMonthStr(leadCreatedDate);
        if (createdMonth && createdMonth > monthStr) {
          // This lead did not exist in this trend month!
          return;
        }

        // Determine owner at end of this month
        let owner = 'unassigned';
        const pastAssignments = (lead.coordinatorHistory || []).filter((e: any) => e.changedAt <= monthEndBoundary);
        if (pastAssignments.length > 0) {
          owner = pastAssignments[pastAssignments.length - 1].newCoordinator;
        } else {
          const assignMonth = getMonthStr(lead.assignDate || leadCreatedDate);
          if (assignMonth && assignMonth <= monthStr) {
            owner = lead.assignedTo || 'unassigned';
          } else {
            owner = 'unassigned';
          }
        }

        const isMatchCoord = (username: string) => {
          if (!username) return false;
          if (selectedCoord === 'all') {
            return username.toLowerCase() !== 'unassigned';
          }
          return username.toLowerCase() === selectedCoord.toLowerCase();
        };

        if (!isMatchCoord(owner)) return;

        if (trendStage === 'assigned') {
          // Count assigned if they were owned at the end of the month
          count++;
        } else {
          // Find stage at end of this month
          let stageAtEndOfMonth = 'new';
          const pastStages = (lead.stageHistory || []).filter((e: any) => e.changedAt <= monthEndBoundary);
          if (pastStages.length > 0) {
            stageAtEndOfMonth = stdStage(pastStages[pastStages.length - 1].newStage);
          } else {
            stageAtEndOfMonth = stdStage(lead.stage || 'new');
          }

          if (stageAtEndOfMonth === trendStage) {
            count++;
          }
        }
      });

      return {
        monthStr,
        monthLabel: formatMonthLabel(monthStr),
        count
      };
    });
  }, [trendMonths, processedLeads, selectedCoord, selectedProject, selectedCountry, selectedSource, trendStage, data]);
  // Drill-down State
  const [drillDownFilter, setDrillDownFilter] = useState<{
    stage?: string;
    coordinator?: string;
    project?: string;
    country?: string;
    source?: string;
    ageingBucket?: string;
    title: string;
  } | null>(null);

  const [drillSearch, setDrillSearch] = useState('');
  const [drillSortField, setDrillSortField] = useState<string>('name');
  const [drillSortOrder, setDrillSortOrder] = useState<'asc' | 'desc'>('asc');

  // Extract unique projects, countries, and sources for filters
  const uniqueProjects = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => { if (l.project) set.add(l.project.trim()); });
    return Array.from(set).sort();
  }, [leads]);

  const uniqueCountries = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => { if (l.country) set.add(l.country.trim()); });
    return Array.from(set).sort();
  }, [leads]);

  const uniqueSources = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => { if (l.source) set.add(l.source.trim()); });
    return Array.from(set).sort();
  }, [leads]);

  // Fetch Report Data from backend
  const fetchReportData = async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({
        month: selectedMonth,
        coordinator: selectedCoord,
        project: selectedProject,
        country: selectedCountry,
        source: selectedSource,
        attributionMode
      });
      const res = await fetch(`/api/reports/coordinator-performance?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const payload = await res.json();
      setData(payload);
    } catch (err: any) {
      console.error('[Performance Report] Fetch failed:', err);
      setError('Failed to compute operational stats. Verify backend connection.');
    } finally {
      setIsLoading(false);
    }
  };

  // Full reload when report filters change
  useEffect(() => {
    fetchReportData(false);
  }, [selectedMonth, selectedCoord, selectedProject, selectedCountry, selectedSource, attributionMode]);

  // Silent update in the background when the leads database list updates (prevents screen blinking)
  useEffect(() => {
    fetchReportData(true);
  }, [leads]);

  // Close drill down on escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrillDownFilter(null);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // Filter candidates for Lead-level drill-down list
  const drilledLeads = useMemo(() => {
    if (!drillDownFilter) return [];
    
    return processedLeads.filter(l => {
      // Soft delete ignore
      if (l.isDeleted) return false;

      // Exclude un-intaken leads from the performance reports to align with board counts
      if (!getEffectiveIntake(l)) return false;

      // Basic coordinator match
      if (drillDownFilter.coordinator) {
        if (!l.assignedTo || l.assignedTo.toLowerCase() !== drillDownFilter.coordinator.toLowerCase()) return false;
      } else if (selectedCoord !== 'all') {
        if (!l.assignedTo || l.assignedTo.toLowerCase() !== selectedCoord.toLowerCase()) return false;
      }

      // Stage match
      if (drillDownFilter.stage) {
        const leadS = l.stage ? l.stage.toLowerCase().trim() : 'new';
        const targetS = drillDownFilter.stage.toLowerCase().trim();
        const matchesStage = leadS === targetS || 
          (targetS === 'in_discussion' && leadS === 'negotiating') ||
          (targetS === 'cold_leads' && leadS === 'rotations') ||
          (targetS === 'office_visited' && leadS === 'proposal');
        if (!matchesStage) return false;
      }

      // Project match
      if (drillDownFilter.project && String(l.project || 'General').trim().toLowerCase() !== drillDownFilter.project.trim().toLowerCase()) return false;
      if (selectedProject !== 'all' && !drillDownFilter.project && String(l.project || 'General').trim().toLowerCase() !== selectedProject.trim().toLowerCase()) return false;

      // Country match
      if (drillDownFilter.country && String(l.country || 'Unknown').trim().toLowerCase() !== drillDownFilter.country.trim().toLowerCase()) return false;
      if (selectedCountry !== 'all' && !drillDownFilter.country && String(l.country || 'Unknown').trim().toLowerCase() !== selectedCountry.trim().toLowerCase()) return false;

      // Source match
      if (drillDownFilter.source && String(l.source || 'Organic').trim().toLowerCase() !== drillDownFilter.source.trim().toLowerCase()) return false;
      if (selectedSource !== 'all' && !drillDownFilter.source && String(l.source || 'Organic').trim().toLowerCase() !== selectedSource.trim().toLowerCase()) return false;

      // Ageing match
      if (drillDownFilter.ageingBucket) {
        const date = l.createdAt || l.entryDate || new Date().toISOString();
        const diffDays = Math.ceil(Math.abs(Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
        const bucket = drillDownFilter.ageingBucket;
        if (bucket === '0-7' && diffDays > 7) return false;
        if (bucket === '8-15' && (diffDays <= 7 || diffDays > 15)) return false;
        if (bucket === '16-30' && (diffDays <= 15 || diffDays > 30)) return false;
        if (bucket === '31-60' && (diffDays <= 30 || diffDays > 60)) return false;
        if (bucket === '60+' && diffDays <= 60) return false;
      }

      return true;
    });
  }, [processedLeads, drillDownFilter, selectedCoord, selectedProject, selectedCountry, selectedSource]);

  // Apply search & sort to drilled down leads
  const processedDrilledLeads = useMemo(() => {
    let result = [...drilledLeads];

    if (drillSearch.trim()) {
      const q = drillSearch.toLowerCase().trim();
      result = result.filter(l => 
        (l.name || '').toLowerCase().includes(q) ||
        (l.phone || '').toLowerCase().includes(q) ||
        (l.position || '').toLowerCase().includes(q) ||
        (l.country || '').toLowerCase().includes(q) ||
        (l.project || '').toLowerCase().includes(q) ||
        (l.source || '').toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      let aVal: any = '';
      let bVal: any = '';

      if (drillSortField === 'name') {
        aVal = a.name || '';
        bVal = b.name || '';
      } else if (drillSortField === 'entryDate') {
        aVal = a.entryDate || a.createdAt || '';
        bVal = b.entryDate || b.createdAt || '';
      } else if (drillSortField === 'country') {
        aVal = a.country || '';
        bVal = b.country || '';
      } else if (drillSortField === 'project') {
        aVal = a.project || '';
        bVal = b.project || '';
      } else if (drillSortField === 'stage') {
        aVal = a.stage || '';
        bVal = b.stage || '';
      } else if (drillSortField === 'coordinator') {
        aVal = a.assignedTo || '';
        bVal = b.assignedTo || '';
      }

      if (typeof aVal === 'string') {
        return drillSortOrder === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return drillSortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [drilledLeads, drillSearch, drillSortField, drillSortOrder]);

  // Export drill down leads to CSV
  const handleExportDrillDownCSV = () => {
    if (processedDrilledLeads.length === 0) return;
    
    const headers = [
      'Serial No', 'Name', 'Phone', 'Country', 'Project', 'Position', 
      'Stage', 'Coordinator', 'Created Date', 'Last Remark', 'Source'
    ];

    const rows = processedDrilledLeads.map(l => [
      l.serialNo || '',
      l.name || '',
      l.phone || '',
      l.country || '',
      l.project || '',
      l.position || '',
      l.stage || '',
      l.assignedTo || 'Unassigned',
      l.createdAt || l.entryDate || '',
      (l.remarks1 || l.notes || '').replace(/,/g, ' '),
      l.source || 'Organic'
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${val}"`).join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Drilldown_Report_${drillDownFilter?.title.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper to trigger Print
  const handlePrint = () => {
    window.print();
  };

  // Helper to export full CSV of performance summary
  const handleExportFullReport = () => {
    if (!data) return;

    let csv = `COORDINATOR PERFORMANCE REPORT - ${selectedMonth}\n`;
    csv += `Filter Project: ${selectedProject}, Country: ${selectedCountry}, Source: ${selectedSource}, Attribution Mode: ${attributionMode}\n\n`;
    
    csv += `EXECUTIVE SUMMARY\n`;
    csv += `Metric,Current Month,Previous Month,Absolute Change,Percentage Change\n`;
    csv += `Total Leads Assigned,${data.kpis.leadsAssigned.current},${data.kpis.leadsAssigned.previous},${data.kpis.leadsAssigned.absChange},${data.kpis.leadsAssigned.pctChange}%\n`;
    csv += `Total Leads Touched,${data.kpis.leadsTouched.current},${data.kpis.leadsTouched.previous},${data.kpis.leadsTouched.absChange},${data.kpis.leadsTouched.pctChange}%\n`;
    csv += `Active Pipeline,${data.kpis.activePipeline.current},${data.kpis.activePipeline.previous},${data.kpis.activePipeline.absChange},${data.kpis.activePipeline.pctChange}%\n`;
    csv += `Strong Opportunities,${data.kpis.strongOpportunities.current},${data.kpis.strongOpportunities.previous},${data.kpis.strongOpportunities.absChange},${data.kpis.strongOpportunities.pctChange}%\n`;
    csv += `Won Leads,${data.kpis.won.current},${data.kpis.won.previous},${data.kpis.won.absChange},${data.kpis.won.pctChange}%\n`;
    csv += `Cold Leads,${data.kpis.cold.current},${data.kpis.cold.previous},${data.kpis.cold.absChange},${data.kpis.cold.pctChange}%\n`;
    csv += `Lost Leads,${data.kpis.lost.current},${data.kpis.lost.previous},${data.kpis.lost.absChange},${data.kpis.lost.pctChange}%\n\n`;

    csv += `COORDINATOR BREAKDOWN\n`;
    csv += `Coordinator,Leads Assigned,Leads Touched,Touch Rate,In Discussion,Strong Opportunity,Interview,Won,Cold,Lost,Won Rate,Stage Progression Rate,MoM Change\n`;
    data.coordinatorRows.forEach((row: any) => {
      csv += `"${row.coordinator}",${row.leadsAssigned},${row.leadsTouched},"${row.touchRate}",${row.inDiscussion},${row.strongOpportunity},${row.interview},${row.won},${row.cold},${row.lost},"${row.wonRate}","${row.stageProgressionRate}","${row.moMChange}"\n`;
    });

    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csv);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Coordinator_Performance_Report_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 text-slate-100 select-text print:bg-white print:text-black">
      
      {/* 2. TOP FILTER BAR */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex flex-col gap-4 text-left relative z-20">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800/80 pb-4 gap-4">
          <div>
            <h1 className="text-xl font-black text-slate-100 uppercase tracking-wide flex items-center gap-2">
              <Award className="h-6 w-6 text-indigo-400" />
              Coordinator Performance
            </h1>
            <p className="text-xs text-slate-400 font-bold mt-1 tracking-wide">
              Analyze coordinator activity, pipeline movement and monthly performance.
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={onRefreshData}
              className="p-2 bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-700 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold"
              title="Refresh Data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
              <span>{isLoading ? 'Loading...' : 'Refresh'}</span>
            </button>
            <button
              onClick={handleExportFullReport}
              className="p-2 bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600 hover:text-white border border-indigo-500/20 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-black uppercase tracking-wider shadow-sm"
              title="Export Full CSV"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export Report</span>
            </button>
            <button
              onClick={handlePrint}
              className="p-2 bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-700 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold"
              title="Print Page"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print</span>
            </button>
          </div>
        </div>

        {/* Filters Controls Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          
          {/* Month Selector */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Reporting Period</label>
            <input 
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full text-xs font-extrabold px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
            />
          </div>

          {/* Coordinator filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Coordinator</label>
            <select
              value={selectedCoord}
              onChange={(e) => {
                setSelectedCoordinator(e.target.value);
                setDrillDownFilter(null);
              }}
              className="w-full text-xs font-extrabold px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Coordinators</option>
              {coordinators.filter(c => c.role === 'agent').map(coord => (
                <option key={coord.id} value={coord.username}>{coord.displayName}</option>
              ))}
            </select>
          </div>

          {/* Project filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Hiring Project</label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full text-xs font-extrabold px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Projects</option>
              {uniqueProjects.map(proj => (
                <option key={proj} value={proj}>{proj}</option>
              ))}
            </select>
          </div>

          {/* Country filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Target Country</label>
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="w-full text-xs font-extrabold px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Countries</option>
              {uniqueCountries.map(ctry => (
                <option key={ctry} value={ctry}>{ctry}</option>
              ))}
            </select>
          </div>

          {/* Source filter */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Lead Source</label>
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="w-full text-xs font-extrabold px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">All Sources</option>
              {uniqueSources.map(src => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          </div>

          {/* Attribution Mode segmented control */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase text-slate-500 tracking-widest">Attribution Mode</label>
            <div className="grid grid-cols-2 gap-1 bg-slate-950 border border-slate-800 p-1 rounded-xl shadow-inner">
              <button
                type="button"
                onClick={() => setAttributionMode('ownership')}
                className={`py-1 text-[9.5px] font-black uppercase rounded-lg transition-all ${
                  attributionMode === 'ownership' 
                    ? 'bg-indigo-600 text-white font-bold shadow-md' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Attribute to final owner of the month"
              >
                Owner
              </button>
              <button
                type="button"
                onClick={() => setAttributionMode('activity')}
                className={`py-1 text-[9.5px] font-black uppercase rounded-lg transition-all ${
                  attributionMode === 'activity' 
                    ? 'bg-indigo-600 text-white font-bold shadow-md' 
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Attribute to whoever did physical logs/replies"
              >
                Activity
              </button>
            </div>
          </div>

        </div>
      </div>

      {isLoading && !data ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-16 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="h-10 w-10 text-indigo-500 animate-spin" />
          <p className="text-sm font-bold text-slate-350">Crunching operational logs and history events...</p>
        </div>
      ) : error ? (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-3xl p-8 flex items-center justify-center gap-3.5 text-rose-400 text-sm font-bold">
          <ShieldAlert className="h-5 w-5 shrink-0 animate-bounce" />
          <span>{error}</span>
        </div>
      ) : data ? (
        <>
          {/* DATA QUALITY INDICATOR */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
            <div className="flex items-center gap-2.5">
              <div className="bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-lg border border-emerald-500/20 text-xs font-black">
                {data.dataQuality.score}%
              </div>
              <div>
                <p className="text-xs font-extrabold text-slate-200 flex items-center gap-1.5">
                  CRM Ledger Health Index
                  {data.dataQuality.score < 90 && (
                    <span className="text-[10px] text-amber-500 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 inline" />
                      Attention needed
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-slate-500 font-bold mt-0.5 font-sans">
                  Missing assignees: {data.dataQuality.missingCoordinator} · Missing stages: {data.dataQuality.missingStage} · Duplicate phones: {data.dataQuality.duplicateRecords}
                </p>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 font-bold sm:text-right font-sans">
              Historical comparisons active from: <span className="text-indigo-400 font-bold font-mono">{data.dataQuality.coverageDate}</span>
              <p className="text-[9px] text-slate-500 mt-0.5">Silently backfilled from chronological timeline events.</p>
            </div>
          </div>

          {/* 3. EXECUTIVE SUMMARY CARD GRID */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            
            {[
              { 
                label: 'Leads Assigned', 
                kpi: data.kpis.leadsAssigned, 
                desc: 'Assigned in reporting month',
                positiveIsGood: true,
                warningValue: false
              },
              { 
                label: 'Leads Touched', 
                kpi: data.kpis.leadsTouched, 
                desc: 'With recorded activity',
                positiveIsGood: true,
                warningValue: false
              },
              { 
                label: 'Active Pipeline', 
                kpi: data.kpis.activePipeline, 
                desc: 'Total active open files',
                positiveIsGood: true,
                warningValue: false
              },
              { 
                label: 'Strong Opportunities', 
                kpi: data.kpis.strongOpportunities, 
                desc: 'Strong/Rotations pipeline',
                positiveIsGood: true,
                warningValue: false
              },
              { 
                label: 'Interviews Scheduled', 
                kpi: data.kpis.interviews, 
                desc: 'Office visited/Interview stage',
                positiveIsGood: true,
                warningValue: false
              },
              { 
                label: 'Closed Won', 
                kpi: data.kpis.won, 
                desc: 'Visa confirmed/Won files',
                positiveIsGood: true,
                warningValue: false
              },
              { 
                label: 'Cold Leads', 
                kpi: data.kpis.cold, 
                desc: 'Marked as cold files',
                positiveIsGood: false,
                warningValue: true
              },
              { 
                label: 'Closed Lost', 
                kpi: data.kpis.lost, 
                desc: 'Marked as lost files',
                positiveIsGood: false,
                warningValue: false
              }
            ].map((item, idx) => {
              const { label, kpi, desc, positiveIsGood, warningValue } = item;
              const abs = kpi.absChange;
              const pct = kpi.pctChange;
              
              const isPositiveChange = abs > 0;
              const isNoChange = abs === 0;

              let badgeColor = '';
              let badgeText = '';

              if (isNoChange) {
                badgeColor = 'bg-slate-800 text-slate-400 border-slate-700/60';
                badgeText = 'Flat';
              } else if (warningValue) {
                badgeColor = 'bg-amber-500/10 text-amber-500 border-amber-500/20';
                badgeText = isPositiveChange ? `↑ +${abs}` : `↓ ${abs}`;
              } else if (positiveIsGood) {
                badgeColor = isPositiveChange 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/20';
                badgeText = isPositiveChange ? `↑ +${abs}` : `↓ ${abs}`;
              } else {
                badgeColor = isPositiveChange 
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' 
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                badgeText = isPositiveChange ? `↑ +${abs}` : `↓ ${abs}`;
              }

              // Drilldown parameters based on KPI
              const getStageFromLabel = (lbl: string) => {
                const standardized = lbl.toLowerCase();
                if (standardized.includes('strong')) return 'strong_opportunity';
                if (standardized.includes('interview')) return 'office_visited';
                if (standardized.includes('won')) return 'won';
                if (standardized.includes('cold')) return 'cold_leads';
                if (standardized.includes('lost')) return 'lost';
                return undefined;
              };

              const stageValue = getStageFromLabel(label);

              return (
                <div 
                  key={idx}
                  onClick={() => {
                    setDrillDownFilter({
                      stage: stageValue,
                      title: `${selectedCoord.toUpperCase()} - ${label.toUpperCase()}`
                    });
                  }}
                  className="bg-slate-900 border border-slate-800/80 hover:border-slate-700/80 rounded-3xl p-4.5 text-left relative overflow-hidden transition-all shadow-md group cursor-pointer"
                >
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider font-mono">{label}</span>
                    <span className={`text-[10px] font-black font-mono border rounded-lg px-1.5 py-0.5 ${badgeColor}`}>
                      {badgeText} ({pct >= 0 ? `+${pct}%` : `${pct}%`})
                    </span>
                  </div>
                  
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-slate-100 group-hover:text-indigo-400 transition-colors">
                      {kpi.current}
                    </span>
                    <span className="text-[10px] text-slate-550 font-bold">
                      prev: {kpi.previous}
                    </span>
                  </div>

                  <p className="text-[10px] text-slate-450 font-medium font-sans mt-1">
                    {desc}
                  </p>
                </div>
              );
            })}

          </div>

          {/* MONTH-OVER-MONTH PERFORMANCE TRENDS CHART */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl text-left space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-4 gap-4">
              <div>
                <span className="text-[10px] font-black uppercase text-indigo-400 tracking-wider font-mono">Performance Graph Comparison</span>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5 mt-0.5">
                  <BarChart3 className="h-4.5 w-4.5 text-indigo-400" />
                  Performance Monthly Trends
                </h3>
              </div>
              
              {/* Stage Sub-Tabs selectors exactly like the GBP image */}
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 flex-wrap gap-1">
                {[
                  { id: 'assigned', label: 'Overview (Total Assigned)' },
                  { id: 'new', label: 'New Inbound' },
                  { id: 'in_discussion', label: 'In Discussion' },
                  { id: 'strong_opportunity', label: 'Strong Opp' },
                  { id: 'office_visited', label: 'Interviews' },
                  { id: 'won', label: 'Won' },
                  { id: 'cold_leads', label: 'Cold' },
                  { id: 'lost', label: 'Lost' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTrendStage(tab.id)}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      trendStage === tab.id
                        ? 'bg-blue-600 text-white font-black shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Total metric and subtitle */}
            <div className="space-y-1 pl-2">
              <span className="text-4xl font-black text-slate-100 tracking-tight font-mono block">
                {trendData.length > 0 ? trendData[trendData.length - 1].count : 0}
              </span>
              <span className="text-xs font-bold text-slate-400 flex items-center gap-1.5 font-sans">
                Candidates in <span className="text-blue-400 font-extrabold">{trendStage === 'assigned' ? 'Assigned' : trendStage.replace('_', ' ').toUpperCase()}</span> stage during {trendData.length > 0 ? trendData[trendData.length - 1].monthLabel : ''}
              </span>
            </div>

            {/* Recharts Area/Line Chart */}
            <div className="h-[280px] w-full pt-4 select-none">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={trendData}
                  margin={{ top: 20, right: 30, left: 10, bottom: 5 }}
                >
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="monthLabel" 
                    stroke="#475569" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false}
                    dy={10}
                  />
                  <YAxis 
                    stroke="#475569" 
                    fontSize={10} 
                    tickLine={false} 
                    axisLine={false}
                    dx={-10}
                  />
                  <ChartTooltip 
                    content={<CustomTrendTooltip />}
                    cursor={{ stroke: '#2563eb', strokeWidth: 1, strokeDasharray: '3 3' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="count" 
                    stroke="#2563eb" 
                    strokeWidth={3} 
                    dot={{ stroke: '#2563eb', strokeWidth: 3, fill: '#0f172a', r: 5 }} 
                    activeDot={{ stroke: '#2563eb', strokeWidth: 3, fill: '#fff', r: 7 }}
                    animationDuration={600}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* COORDINATOR STAGE COMPARISON GRAPH */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl text-left space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-4 gap-4">
              <div>
                <span className="text-[10px] font-black uppercase text-indigo-400 tracking-wider font-mono">Stage Comparison Visualizer</span>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5 mt-0.5">
                  <BarChart3 className="h-4.5 w-4.5 text-indigo-400" />
                  {selectedCoord === 'all' ? 'Coordinator Stage Comparison Graph' : `${selectedCoord.toUpperCase()} - Stage Comparison`}
                </h3>
              </div>

              {selectedCoord === 'all' && (
                <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 gap-1">
                  <button
                    type="button"
                    onClick={() => setComparisonChartType('stacked')}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      comparisonChartType === 'stacked'
                        ? 'bg-blue-600 text-white font-black shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Stacked
                  </button>
                  <button
                    type="button"
                    onClick={() => setComparisonChartType('grouped')}
                    className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      comparisonChartType === 'grouped'
                        ? 'bg-blue-600 text-white font-black shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Grouped
                  </button>
                </div>
              )}
            </div>

            {/* Recharts Bar Chart */}
            <div className="h-[320px] w-full pt-4 select-none">
              <ResponsiveContainer width="100%" height="100%">
                {selectedCoord === 'all' ? (
                  <BarChart
                    data={data.coordinatorRows}
                    margin={{ top: 20, right: 30, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="coordinator"
                      stroke="#475569"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      dy={10}
                    />
                    <YAxis
                      stroke="#475569"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      dx={-10}
                    />
                    <ChartTooltip
                      content={({ active, payload, label }: any) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl shadow-2xl text-left text-xs min-w-[200px]">
                              <p className="font-black text-slate-100 uppercase tracking-wide border-b border-slate-800 pb-1.5 mb-2 flex items-center gap-1.5">
                                <User className="h-3.5 w-3.5 text-indigo-400" />
                                {label}
                              </p>
                              <div className="space-y-1 font-mono font-bold">
                                {payload.map((p: any, idx: number) => (
                                  <div key={idx} className="flex justify-between items-center gap-4">
                                    <span className="flex items-center gap-1.5 font-sans font-bold text-slate-400 text-[11px]">
                                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                                      {p.name}
                                    </span>
                                    <span className="text-slate-100">{p.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      height={36}
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                    />
                    <Bar
                      dataKey="newInbound"
                      name="New Inbound"
                      stackId={comparisonChartType === 'stacked' ? 'a' : undefined}
                      fill="#6366f1"
                      radius={comparisonChartType === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="inDiscussion"
                      name="In Discussion"
                      stackId={comparisonChartType === 'stacked' ? 'a' : undefined}
                      fill="#3b82f6"
                      radius={comparisonChartType === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="strongOpportunity"
                      name="Strong Opportunity"
                      stackId={comparisonChartType === 'stacked' ? 'a' : undefined}
                      fill="#10b981"
                      radius={comparisonChartType === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="interview"
                      name="Interview"
                      stackId={comparisonChartType === 'stacked' ? 'a' : undefined}
                      fill="#f59e0b"
                      radius={comparisonChartType === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="won"
                      name="Won"
                      stackId={comparisonChartType === 'stacked' ? 'a' : undefined}
                      fill="#059669"
                      radius={comparisonChartType === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="cold"
                      name="Cold"
                      stackId={comparisonChartType === 'stacked' ? 'a' : undefined}
                      fill="#f97316"
                      radius={comparisonChartType === 'stacked' ? [0, 0, 0, 0] : [4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="lost"
                      name="Lost"
                      stackId={comparisonChartType === 'stacked' ? 'a' : undefined}
                      fill="#ef4444"
                      radius={comparisonChartType === 'stacked' ? [4, 4, 0, 0] : [4, 4, 0, 0]}
                    />
                  </BarChart>
                ) : (
                  <BarChart
                    data={[
                      { stageName: 'New Inbound', count: data.currentStats.byStage.new || 0, color: '#6366f1' },
                      { stageName: 'In Discussion', count: data.currentStats.byStage.in_discussion || 0, color: '#3b82f6' },
                      { stageName: 'Strong Opportunity', count: data.currentStats.byStage.strong_opportunity || 0, color: '#10b981' },
                      { stageName: 'Interview Scheduled', count: data.currentStats.byStage.office_visited || 0, color: '#f59e0b' },
                      { stageName: 'Won', count: data.currentStats.byStage.won || 0, color: '#059669' },
                      { stageName: 'Cold Leads', count: data.currentStats.byStage.cold_leads || 0, color: '#f97316' },
                      { stageName: 'Lost', count: data.currentStats.byStage.lost || 0, color: '#ef4444' }
                    ]}
                    margin={{ top: 20, right: 30, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="stageName"
                      stroke="#475569"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      dy={10}
                    />
                    <YAxis
                      stroke="#475569"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      dx={-10}
                    />
                    <ChartTooltip
                      content={({ active, payload }: any) => {
                        if (active && payload && payload.length) {
                          const dataPoint = payload[0].payload;
                          return (
                            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl shadow-2xl text-left text-xs">
                              <p className="font-extrabold text-slate-400 uppercase tracking-wide mb-1">{dataPoint.stageName}</p>
                              <p className="text-lg font-mono font-black text-slate-100">{dataPoint.count} candidates</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {[
                        { color: '#6366f1' },
                        { color: '#3b82f6' },
                        { color: '#10b981' },
                        { color: '#f59e0b' },
                        { color: '#059669' },
                        { color: '#f97316' },
                        { color: '#ef4444' }
                      ].map((item, index) => (
                        <Cell key={`cell-${index}`} fill={item.color} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* LOWER GRID: VISUAL MOVEMENT AND METRICS COMPARISON */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
            
            {/* 5. MONTH-OVER-MONTH VISUAL COMPARISON & STAGE DISTRIBUTION */}
            <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-6">
              <div>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="h-4.5 w-4.5 text-indigo-400" />
                  {selectedCoordDisplayName} — Month-over-Month Comparison
                </h3>
                <p className="text-[11px] text-slate-400 font-bold mt-0.5 tracking-wide">
                  Comparing {data.reportingPeriod} counts with {data.comparisonPeriod} metrics.
                </p>
              </div>

              <div className="space-y-4">
                {[
                  { label: 'Leads Assigned', key: 'assignedCount', curr: data.currentStats.assignedCount, prev: data.prevStats.assignedCount, color: 'bg-indigo-500' },
                  { label: 'Leads Touched', key: 'touchedCount', curr: data.currentStats.touchedCount, prev: data.prevStats.touchedCount, color: 'bg-purple-500' },
                  { label: 'In Discussion', key: 'in_discussion', curr: data.currentStats.byStage.in_discussion || 0, prev: data.prevStats.byStage.in_discussion || 0, color: 'bg-blue-500' },
                  { label: 'Strong Opportunity', key: 'strong_opportunity', curr: data.currentStats.byStage.strong_opportunity || 0, prev: data.prevStats.byStage.strong_opportunity || 0, color: 'bg-emerald-500' },
                  { label: 'Interview Scheduled', key: 'office_visited', curr: data.currentStats.byStage.office_visited || 0, prev: data.prevStats.byStage.office_visited || 0, color: 'bg-amber-500' },
                  { label: 'Won', key: 'won', curr: data.currentStats.byStage.won || 0, prev: data.prevStats.byStage.won || 0, color: 'bg-emerald-600' },
                  { label: 'Cold Leads', key: 'cold_leads', curr: data.currentStats.byStage.cold_leads || 0, prev: data.prevStats.byStage.cold_leads || 0, color: 'bg-orange-500' },
                  { label: 'Lost', key: 'lost', curr: data.currentStats.byStage.lost || 0, prev: data.prevStats.byStage.lost || 0, color: 'bg-rose-500' }
                ].map((item, idx) => {
                  const maxVal = Math.max(item.curr, item.prev, 10);
                  const currPct = Math.round((item.curr / maxVal) * 100);
                  const prevPct = Math.round((item.prev / maxVal) * 100);
                  const diff = item.curr - item.prev;

                  return (
                    <div 
                      key={idx} 
                      onClick={() => {
                        const getStageFromLabel = (lbl: string) => {
                          const standardized = lbl.toLowerCase();
                          if (standardized.includes('discussion')) return 'in_discussion';
                          if (standardized.includes('strong')) return 'strong_opportunity';
                          if (standardized.includes('interview')) return 'office_visited';
                          if (standardized.includes('won')) return 'won';
                          if (standardized.includes('cold')) return 'cold_leads';
                          if (standardized.includes('lost')) return 'lost';
                          return undefined;
                        };
                        setDrillDownFilter({
                          stage: getStageFromLabel(item.label),
                          title: `${selectedCoord.toUpperCase()} - ${item.label.toUpperCase()}`
                        });
                      }}
                      className="space-y-1.5 p-2 rounded-xl hover:bg-slate-850 transition-colors cursor-pointer group"
                    >
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-extrabold text-slate-350">{item.label}</span>
                        <div className="flex items-center gap-3 font-mono font-black">
                          <span className="text-slate-450 text-[10px]">Prev: {item.prev}</span>
                          <span className="text-slate-100 text-[11px] group-hover:text-indigo-400 transition-colors">Curr: {item.curr}</span>
                          <span className={`text-[10px] ${diff >= 0 ? (item.label.includes('Lost') || item.label.includes('Cold') ? 'text-rose-400' : 'text-emerald-400') : (item.label.includes('Lost') || item.label.includes('Cold') ? 'text-emerald-400' : 'text-rose-400')}`}>
                            {diff >= 0 ? `+${diff}` : diff}
                          </span>
                        </div>
                      </div>
                      
                      {/* MoM Dual Bar */}
                      <div className="space-y-1">
                        {/* Current month bar */}
                        <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden flex">
                          <div className={`h-full ${item.color}`} style={{ width: `${currPct}%` }} />
                        </div>
                        {/* Previous month dashed bar */}
                        <div className="h-1 w-full bg-slate-950/40 rounded-full overflow-hidden flex">
                          <div className="h-full bg-slate-600 opacity-40" style={{ width: `${prevPct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 7. STAGE MOVEMENT ANALYSIS THIS MONTH */}
            <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-6">
              <div>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="h-4.5 w-4.5 text-indigo-400" />
                  Stage Movement Analysis This Month
                </h3>
                <p className="text-[11px] text-slate-400 font-bold mt-0.5 tracking-wide">
                  See how files entered, progressed or exited during the selected month.
                </p>
              </div>

              <div className="space-y-5">
                {[
                  { 
                    stageKey: 'in_discussion', 
                    label: 'IN DISCUSSION', 
                    stats: data.currentStats.stageMovement.in_discussion,
                    detail: `Entered: ${data.currentStats.stageMovement.in_discussion.entered} · Moved to Strong Opp: ${data.currentStats.stageMovement.strong_opportunity.entered} · Still in Discussion: ${data.currentStats.byStage.in_discussion || 0}`
                  },
                  { 
                    stageKey: 'strong_opportunity', 
                    label: 'STRONG OPPORTUNITY', 
                    stats: data.currentStats.stageMovement.strong_opportunity,
                    detail: `Entered: ${data.currentStats.stageMovement.strong_opportunity.entered} · Moved to Interview: ${data.currentStats.stageMovement.office_visited.entered} · Still in Strong Opp: ${data.currentStats.byStage.strong_opportunity || 0}`
                  },
                  { 
                    stageKey: 'office_visited', 
                    label: 'OFFICE VISITED / INTERVIEW', 
                    stats: data.currentStats.stageMovement.office_visited,
                    detail: `Entered: ${data.currentStats.stageMovement.office_visited.entered} · Moved to Won: ${data.currentStats.stageMovement.won.entered} · Still in Interview: ${data.currentStats.byStage.office_visited || 0}`
                  }
                ].map((item, idx) => {
                  const { entered, movedForward, movedBack, exited, stillIn } = item.stats;
                  
                  return (
                    <div key={idx} className="bg-slate-950/40 p-4 rounded-2xl border border-slate-850/80 space-y-3 text-left">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black text-slate-200 tracking-wider">{item.label}</span>
                        <span className="text-[10px] font-mono text-indigo-400 font-bold bg-indigo-500/5 px-2 py-0.5 rounded-lg border border-indigo-500/10">
                          Active: {stillIn}
                        </span>
                      </div>

                      {/* Progression Indicators Grid */}
                      <div className="grid grid-cols-5 gap-1.5 text-center">
                        <div className="p-1.5 rounded-lg bg-indigo-950/20 border border-indigo-900/10">
                          <span className="text-[13px] font-black text-indigo-400 block font-mono">{entered}</span>
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block mt-0.5">Entered</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-emerald-950/20 border border-emerald-900/10">
                          <span className="text-[13px] font-black text-emerald-400 block font-mono">{movedForward}</span>
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block mt-0.5">Progressed</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-rose-950/20 border border-rose-900/10">
                          <span className="text-[13px] font-black text-rose-400 block font-mono">{movedBack}</span>
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block mt-0.5">Backtracked</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-800/80">
                          <span className="text-[13px] font-black text-slate-400 block font-mono">{exited}</span>
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block mt-0.5">Exited</span>
                        </div>
                        <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-800/80">
                          <span className="text-[13px] font-black text-slate-200 block font-mono">{stillIn}</span>
                          <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block mt-0.5">Retained</span>
                        </div>
                      </div>

                      <p className="text-[10px] text-slate-450 font-sans italic">
                        {item.detail}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* PIPELINE FUNNEL CONVERSION */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-6 text-left">
            <div>
              <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                <Filter className="h-4.5 w-4.5 text-indigo-400" />
                Pipeline Conversion Funnel
              </h3>
              <p className="text-[11px] text-slate-400 font-bold mt-0.5 tracking-wide">
                Track how candidates convert from New Inbound down to the final Closed Won milestone.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 relative">
              {[
                { 
                  stage: 'new', 
                  title: 'NEW INBOUND', 
                  count: data.currentStats.byStage.new, 
                  conv: '100% Base',
                  color: 'bg-indigo-600'
                },
                { 
                  stage: 'in_discussion', 
                  title: 'IN DISCUSSION', 
                  count: data.currentStats.byStage.in_discussion, 
                  conv: data.currentStats.byStage.new === 0 ? '0%' : `${Math.round((data.currentStats.byStage.in_discussion / (data.currentStats.byStage.new || 1)) * 100)}% Conversion`,
                  color: 'bg-blue-600'
                },
                { 
                  stage: 'strong_opportunity', 
                  title: 'STRONG OPP', 
                  count: data.currentStats.byStage.strong_opportunity, 
                  conv: data.currentStats.byStage.in_discussion === 0 ? '0%' : `${Math.round((data.currentStats.byStage.strong_opportunity / (data.currentStats.byStage.in_discussion || 1)) * 100)}% Conversion`,
                  color: 'bg-emerald-600'
                },
                { 
                  stage: 'office_visited', 
                  title: 'INTERVIEW', 
                  count: data.currentStats.byStage.office_visited, 
                  conv: data.currentStats.byStage.strong_opportunity === 0 ? '0%' : `${Math.round((data.currentStats.byStage.office_visited / (data.currentStats.byStage.strong_opportunity || 1)) * 100)}% Conversion`,
                  color: 'bg-amber-600'
                },
                { 
                  stage: 'won', 
                  title: 'CLOSED WON', 
                  count: data.currentStats.byStage.won, 
                  conv: data.currentStats.byStage.office_visited === 0 ? '0%' : `${Math.round((data.currentStats.byStage.won / (data.currentStats.byStage.office_visited || 1)) * 100)}% Conversion`,
                  color: 'bg-emerald-500'
                }
              ].map((item, idx) => {
                return (
                  <div key={idx} className="bg-slate-950 p-4.5 rounded-2xl border border-slate-850 text-center relative flex flex-col justify-between h-36">
                    <div className="space-y-1">
                      <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider font-mono block">
                        {item.title}
                      </span>
                      <span className="text-3xl font-black text-slate-100 block font-mono">
                        {item.count}
                      </span>
                    </div>

                    <div className="space-y-2 mt-auto">
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                        <div className={`h-full ${item.color}`} style={{ width: item.conv.includes('100%') ? '100%' : item.conv }} />
                      </div>
                      <span className="text-[10px] font-black font-mono text-indigo-400 uppercase tracking-wide block">
                        {item.conv}
                      </span>
                    </div>

                    {/* Arrow for steps (except last) */}
                    {idx < 4 && (
                      <div className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 bg-slate-900 border border-slate-800 p-1 rounded-full shadow-md text-slate-500">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* TOUCH ANALYSIS & LEAD AGEING */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-left">
            
            {/* 9. COORDINATOR TOUCH / ACTIVITY BREAKDOWN */}
            <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-6">
              <div>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="h-4.5 w-4.5 text-indigo-400" />
                  Coordinator activity / Touch breakdown
                </h3>
                <p className="text-[11px] text-slate-400 font-bold mt-0.5 tracking-wide">
                  Physical logs and interactions recorded in the database during this month.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                
                {[
                  { label: 'Remarks Added', count: data.currentStats.activityCounts.remarksAdded, desc: 'Call remarks updated on candidates' },
                  { label: 'Outbound Calls', count: data.currentStats.activityCounts.calls, desc: 'Calls marked as connected/disconnected' },
                  { label: 'WhatsApp Chats', count: data.currentStats.activityCounts.whatsappConversations, desc: 'WhatsApp text/flyers dispatched' },
                  { label: 'Stage Transitions', count: data.currentStats.activityCounts.stageChanges, desc: 'Pipeline phase updates executed' },
                  { label: 'Tasks Created', count: data.currentStats.activityCounts.followups, desc: 'Reminders and tasks registered' },
                  { label: 'Metadata Updates', count: data.currentStats.activityCounts.profileUpdates, desc: 'General profile and document revisions' }
                ].map((act, idx) => {
                  return (
                    <div key={idx} className="bg-slate-950/40 p-4.5 rounded-2xl border border-slate-850/80 text-left space-y-2">
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs font-extrabold text-slate-300">{act.label}</span>
                        <span className="text-xl font-black text-slate-100 font-mono">{act.count}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-tight">
                        {act.desc}
                      </p>
                    </div>
                  );
                })}

              </div>
            </div>

            {/* 10. LEAD AGEING BUCKETS */}
            <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-6">
              <div>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="h-4.5 w-4.5 text-indigo-400" />
                  Lead Ageing (Open / Active Pipeline)
                </h3>
                <p className="text-[11px] text-slate-400 font-bold mt-0.5 tracking-wide">
                  Identify stale or lagging files that have remained active with coordinators.
                </p>
              </div>

              <div className="space-y-4">
                {[
                  { bucket: '0-7', label: '0–7 Days', count: data.ageingBuckets['0-7'], color: 'bg-emerald-500' },
                  { bucket: '8-15', label: '8–15 Days', count: data.ageingBuckets['8-15'], color: 'bg-blue-500' },
                  { bucket: '16-30', label: '16–30 Days', count: data.ageingBuckets['16-30'], color: 'bg-indigo-500' },
                  { bucket: '31-60', label: '31–60 Days', count: data.ageingBuckets['31-60'], color: 'bg-amber-500' },
                  { bucket: '60+', label: '60+ Days (Lagging)', count: data.ageingBuckets['60+'], color: 'bg-rose-500' }
                ].map((item, idx) => {
                  const totalAgeingCount = Object.values(data.ageingBuckets).reduce((a: any, b: any) => a + b, 0) as number;
                  const pct = totalAgeingCount === 0 ? 0 : Math.round((item.count / totalAgeingCount) * 100);

                  return (
                    <div 
                      key={idx}
                      onClick={() => {
                        setDrillDownFilter({
                          ageingBucket: item.bucket,
                          title: `AGEING BUCKET: ${item.label.toUpperCase()}`
                        });
                      }}
                      className="space-y-1.5 p-1 rounded-lg hover:bg-slate-850 cursor-pointer transition-all group"
                    >
                      <div className="flex justify-between items-center text-xs font-bold">
                        <span className="text-slate-350">{item.label}</span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-slate-100 text-sm group-hover:text-indigo-400 transition-all">{item.count} leads</span>
                          <span className="text-slate-500 text-[10px]">({pct}%)</span>
                        </div>
                      </div>

                      <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden">
                        <div className={`h-full ${item.color}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* 4. COORDINATOR PERFORMANCE COMPARISON TABLE */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg text-left space-y-4">
            <div>
              <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="h-4.5 w-4.5 text-indigo-400" />
                Coordinator Operational Performance Table
              </h3>
              <p className="text-[11px] text-slate-400 font-bold mt-0.5 tracking-wide">
                Detailed comparison metric across all active consulting coordinators. Click a row to open detail views.
              </p>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/20">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 font-extrabold uppercase text-[10px] tracking-wider border-b border-slate-800 select-none">
                    <th className="p-3.5 pl-5">Coordinator</th>
                    <th className="p-3.5">Assigned</th>
                    <th className="p-3.5">Touched</th>
                    <th className="p-3.5">Touch Rate</th>
                    <th className="p-3.5 text-blue-400">Discussion</th>
                    <th className="p-3.5 text-emerald-400">Strong Opp</th>
                    <th className="p-3.5 text-amber-400">Interview</th>
                    <th className="p-3.5 text-emerald-500 font-black">Won</th>
                    <th className="p-3.5 text-orange-400">Cold</th>
                    <th className="p-3.5 text-rose-400">Lost</th>
                    <th className="p-3.5">Won Rate</th>
                    <th className="p-3.5">Progression Rate</th>
                    <th className="p-3.5 pr-5">MoM Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {data.coordinatorRows.map((row: any, idx: number) => {
                    return (
                      <tr 
                        key={idx}
                        onClick={() => {
                          setSelectedCoordinator(row.username);
                        }}
                        className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                      >
                        <td className="p-3.5 pl-5 font-black text-slate-100 text-xs flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 text-indigo-400">
                            <User className="h-3 w-3" />
                          </div>
                          {row.coordinator}
                        </td>
                        <td className="p-3.5 font-bold">{row.leadsAssigned}</td>
                        <td className="p-3.5 font-bold text-slate-300">{row.leadsTouched}</td>
                        <td className="p-3.5">
                          <span className="bg-indigo-500/10 text-indigo-400 font-mono font-bold px-1.5 py-0.5 rounded text-[10.5px]">
                            {row.touchRate}
                          </span>
                        </td>
                        <td className="p-3.5 font-semibold text-blue-400/90">{row.inDiscussion}</td>
                        <td className="p-3.5 font-semibold text-emerald-400/90">{row.strongOpportunity}</td>
                        <td className="p-3.5 font-semibold text-amber-400/90">{row.interview}</td>
                        <td className="p-3.5 font-extrabold text-emerald-400">{row.won}</td>
                        <td className="p-3.5 font-semibold text-orange-400/90">{row.cold}</td>
                        <td className="p-3.5 font-semibold text-rose-400/90">{row.lost}</td>
                        <td className="p-3.5 font-mono text-slate-350">{row.wonRate}</td>
                        <td className="p-3.5 font-mono text-slate-350">{row.stageProgressionRate}</td>
                        <td className="p-3.5 pr-5 font-mono text-slate-400 text-[10.5px]">{row.moMChange}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* PROJECT AND COUNTRY PERFORMANCE GRIDS (progressive disclosure) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-left">
            
            {/* Project wise Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="h-4.5 w-4.5 text-indigo-400" />
                  Project-wise Operational Metrics
                </h3>
                <p className="text-[11px] text-slate-400 font-bold mt-0.5 tracking-wide">
                  Operational funnel counts segmented per recruitment project.
                </p>
              </div>

              <div className="overflow-y-auto max-h-[300px] border border-slate-850 rounded-2xl bg-slate-950/20">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/80 text-slate-450 uppercase text-[9px] tracking-wider border-b border-slate-800 select-none">
                      <th className="p-2.5 pl-4">Project</th>
                      <th className="p-2.5">Leads</th>
                      <th className="p-2.5">Touched</th>
                      <th className="p-2.5">Won</th>
                      <th className="p-2.5">Cold</th>
                      <th className="p-2.5">Lost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 font-medium">
                    {data.projectPerformance.map((row: any, idx: number) => {
                      return (
                        <tr 
                          key={idx}
                          onClick={() => {
                            setDrillDownFilter({
                              project: row.project,
                              title: `PROJECT: ${row.project.toUpperCase()}`
                            });
                          }}
                          className="hover:bg-slate-850 transition-colors cursor-pointer"
                        >
                          <td className="p-2.5 pl-4 font-extrabold text-slate-200">{row.project}</td>
                          <td className="p-2.5 font-bold font-mono">{row.leads}</td>
                          <td className="p-2.5 text-slate-350">{row.touched}</td>
                          <td className="p-2.5 text-emerald-400 font-extrabold font-mono">{row.won}</td>
                          <td className="p-2.5 text-orange-400 font-mono">{row.cold}</td>
                          <td className="p-2.5 text-rose-400 font-mono">{row.lost}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Country wise Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                  <Map className="h-4.5 w-4.5 text-indigo-400" />
                  Country-wise Operational Funnel
                </h3>
                <p className="text-[11px] text-slate-400 font-bold mt-0.5 tracking-wide">
                  Pipeline distribution metrics segmented by destination countries. Click to filter.
                </p>
              </div>

              <div className="overflow-y-auto max-h-[300px] border border-slate-850 rounded-2xl bg-slate-950/20">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/80 text-slate-450 uppercase text-[9px] tracking-wider border-b border-slate-800 select-none">
                      <th className="p-2.5 pl-4">Country</th>
                      <th className="p-2.5">Leads</th>
                      <th className="p-2.5">Strong Opp</th>
                      <th className="p-2.5">Interview</th>
                      <th className="p-2.5">Won</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 font-medium">
                    {data.countryPerformance.map((row: any, idx: number) => {
                      return (
                        <tr 
                          key={idx}
                          onClick={() => {
                            setDrillDownFilter({
                              country: row.country,
                              title: `COUNTRY: ${row.country.toUpperCase()}`
                            });
                          }}
                          className="hover:bg-slate-850 transition-colors cursor-pointer"
                        >
                          <td className="p-2.5 pl-4 font-extrabold text-slate-200 flex items-center gap-2">
                            {getCountryFlagUrl(row.country) ? (
                              <img 
                                src={getCountryFlagUrl(row.country)} 
                                alt="" 
                                className="w-4 h-3 rounded object-cover shadow-xs border border-slate-800" 
                              />
                            ) : (
                              <span className="text-[10px]">🌐</span>
                            )}
                            {row.country}
                          </td>
                          <td className="p-2.5 font-bold font-mono">{row.leads}</td>
                          <td className="p-2.5 text-emerald-450 font-semibold">{row.strongOpportunities}</td>
                          <td className="p-2.5 text-amber-400 font-semibold">{row.interviews}</td>
                          <td className="p-2.5 text-emerald-400 font-extrabold font-mono">{row.won}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </>
      ) : null}

      {/* 14. DRILL-DOWN CANDIDATES LIST POPUP DRAWER */}
      {drillDownFilter && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden text-left">
            
            {/* Header */}
            <div className="bg-slate-950 p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase text-indigo-400 tracking-wider font-mono">Performance Drilldown list</span>
                <h2 className="text-base font-black text-slate-100 uppercase tracking-wide mt-0.5">
                  📂 {drillDownFilter.title} ({processedDrilledLeads.length} Candidates)
                </h2>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={handleExportDrillDownCSV}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-black uppercase bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={() => setDrillDownFilter(null)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 text-slate-350 hover:bg-slate-750 transition-all cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Sub-header Filter Search bar */}
            <div className="p-4 bg-slate-950/30 border-b border-slate-850 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search drill-down candidates..."
                  value={drillSearch}
                  onChange={(e) => setDrillSearch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-bold"
                />
              </div>
              
              {/* Reset search button */}
              {drillSearch && (
                <button
                  onClick={() => setDrillSearch('')}
                  className="text-xs font-bold text-slate-400 hover:text-slate-200"
                >
                  Clear Search
                </button>
              )}
            </div>

            {/* Candidate List Table */}
            <div className="flex-1 overflow-y-auto">
              {processedDrilledLeads.length > 0 ? (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/90 text-slate-400 uppercase text-[9px] font-extrabold tracking-wider border-b border-slate-850 select-none sticky top-0">
                      <th className="p-3.5 pl-5">Candidate</th>
                      <th className="p-3.5">Phone</th>
                      <th className="p-3.5">Country</th>
                      <th className="p-3.5">Project</th>
                      <th className="p-3.5">Position</th>
                      <th className="p-3.5">Current Stage</th>
                      <th className="p-3.5">Coordinator</th>
                      <th className="p-3.5">Created Date</th>
                      <th className="p-3.5 pr-5">Last Remark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 font-medium text-slate-300">
                    {processedDrilledLeads.map((item, idx) => {
                      const ageDays = Math.ceil(Math.abs(Date.now() - new Date(item.createdAt || item.entryDate || Date.now()).getTime()) / (1000 * 60 * 60 * 24));
                      
                      return (
                        <tr 
                          key={idx}
                          className="hover:bg-slate-800/40"
                        >
                          <td className="p-3.5 pl-5">
                            <button
                              onClick={() => {
                                onSelectLead(item);
                                setDrillDownFilter(null);
                              }}
                              className="font-black text-slate-100 hover:text-indigo-400 hover:underline text-left text-xs truncate flex items-center gap-1 cursor-pointer"
                            >
                              {item.name || 'Unnamed Candidate'}
                              <ExternalLink className="h-3 w-3 inline text-slate-500" />
                            </button>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                              ID: {item.serialNo || item.id.slice(0, 8)} · Age: {ageDays} days
                            </div>
                          </td>
                          <td className="p-3.5 font-mono text-xs">{item.phone}</td>
                          <td className="p-3.5">
                            <span className="flex items-center gap-1.5 font-bold text-slate-200">
                              {getCountryFlagUrl(item.country) && (
                                <img 
                                  src={getCountryFlagUrl(item.country)} 
                                  alt="" 
                                  className="w-4 h-3 rounded object-cover shadow-xs border border-slate-800" 
                                />
                              )}
                              {item.country || 'Not Set'}
                            </span>
                          </td>
                          <td className="p-3.5 text-slate-200 font-bold">{item.project || 'General'}</td>
                          <td className="p-3.5 text-slate-350">{item.position || 'Not Specified'}</td>
                          <td className="p-3.5">
                            <span className="bg-slate-850 px-2 py-0.5 rounded-lg border border-slate-800 text-[10px] uppercase font-bold text-slate-300">
                              {item.stage || 'new'}
                            </span>
                          </td>
                          <td className="p-3.5 font-bold text-indigo-400 uppercase text-[10px]">
                            @{item.assignedTo || 'unassigned'}
                          </td>
                          <td className="p-3.5 text-slate-450 font-mono text-[10.5px]">
                            {new Date(item.createdAt || item.entryDate || Date.now()).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}
                          </td>
                          <td className="p-3.5 pr-5 max-w-xs truncate text-slate-400 italic" title={item.remarks1 || item.notes || ''}>
                            {item.remarks1 || item.notes || 'No remarks logged.'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="py-24 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                  <HelpCircle className="h-12 w-12 opacity-25 text-slate-400" />
                  <p className="text-sm font-bold">No candidates found matching the selected filters.</p>
                </div>
              )}
            </div>

            {/* Footer summary info */}
            <div className="bg-slate-950 p-3.5 text-center text-[10.5px] text-slate-500 border-t border-slate-800 select-none">
              Press <span className="font-mono text-slate-400 bg-slate-900 px-1 py-0.5 rounded border border-slate-800">ESC</span> to return to the Coordinator Dashboard.
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
