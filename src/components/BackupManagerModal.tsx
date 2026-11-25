import React, { useState, useEffect } from 'react';
import { 
  Download, 
  Upload, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Calendar, 
  Database, 
  FileSpreadsheet, 
  X, 
  ShieldCheck, 
  HardDrive,
  Play,
  Cloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CloudBackupSnapshotMeta } from '../types.ts';

interface BackupItem {
  fileName: string;
  filePath: string;
  type: 'db_json' | 'xlsx';
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  timestamp: number;
  isMondayScheduled?: boolean;
}

interface BackupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreSuccess?: () => void;
}

export const BackupManagerModal: React.FC<BackupManagerModalProps> = ({
  isOpen,
  onClose,
  onRestoreSuccess
}) => {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [cloudSnapshots, setCloudSnapshots] = useState<CloudBackupSnapshotMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoringCloudId, setRestoringCloudId] = useState<string | null>(null);
  const [confirmFileRestore, setConfirmFileRestore] = useState(false);
  const [confirmCloudSnapshotId, setConfirmCloudSnapshotId] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [selectedFileForRestore, setSelectedFileForRestore] = useState<File | null>(null);
  const [parsedRestoreInfo, setParsedRestoreInfo] = useState<any | null>(null);

  const getSessionUser = () => {
    try {
      const saved = localStorage.getItem('cgp_crm_session');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return null;
  };
  const sessionUser = getSessionUser();
  const queryParams = sessionUser 
    ? `?agentId=${encodeURIComponent(sessionUser.username || 'admin')}&role=${encodeURIComponent(sessionUser.role || 'admin')}${sessionUser.token ? `&token=${encodeURIComponent(sessionUser.token)}` : ''}` 
    : '?agentId=admin&role=admin';

  const handleDownloadFile = async (url: string, fallbackFileName: string) => {
    try {
      setDownloadingFile(fallbackFileName);
      setStatusMessage({ type: 'info', text: `Preparing download for ${fallbackFileName}... Please wait.` });

      const res = await fetch(url, {
        headers: {
          'x-user-role': sessionUser?.role || 'admin',
          'x-agent-id': sessionUser?.username || 'admin'
        }
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Download failed with HTTP status ${res.status}`);
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      let finalName = fallbackFileName;
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

      setStatusMessage({ type: 'success', text: `Downloaded ${finalName} successfully!` });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      console.error('File download error:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Download failed. Please check your connection and try again.' });
    } finally {
      setDownloadingFile(null);
    }
  };

  const fetchBackupsList = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/backup/list${queryParams}`, {
        headers: {
          'x-user-role': sessionUser?.role || 'user',
          'x-agent-id': sessionUser?.username || 'System'
        }
      });
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
        setCloudSnapshots(data.cloudSnapshots || []);
      }
    } catch (err) {
      console.error('Failed to load backups:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchBackupsList();
      setStatusMessage(null);
      setSelectedFileForRestore(null);
      setParsedRestoreInfo(null);
      setConfirmFileRestore(false);
      setConfirmCloudSnapshotId(null);
    }
  }, [isOpen]);

  const handleTriggerManualBackup = async () => {
    setTriggering(true);
    setStatusMessage({ type: 'info', text: 'Executing full snapshot of DB (.JSON) and Master Spreadsheet (.XLSX)...' });
    try {
      const res = await fetch(`/api/backup/trigger${queryParams}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': sessionUser?.role || 'user',
          'x-agent-id': sessionUser?.username || 'System'
        },
        body: JSON.stringify({ isMonday: false })
      });
      if (res.ok) {
        setStatusMessage({ type: 'success', text: 'Full Database & Excel backup created and verified successfully!' });
        await fetchBackupsList();
      } else {
        const errData = await res.json();
        setStatusMessage({ type: 'error', text: errData.error || 'Failed to create backup snapshot.' });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: 'Error generating automated backup snapshot.' });
    } finally {
      setTriggering(false);
    }
  };

  const handleFileSelectForRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setStatusMessage({ type: 'error', text: 'Please select a valid CRM JSON Database backup file (.json).' });
      return;
    }

    setSelectedFileForRestore(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        if (!parsed.data || !Array.isArray(parsed.data.leads)) {
          setStatusMessage({ type: 'error', text: 'Invalid CRM backup file format. Expected a structured JSON database backup.' });
          setParsedRestoreInfo(null);
          return;
        }
        setParsedRestoreInfo(parsed);
        setConfirmFileRestore(false);
        setStatusMessage({ 
          type: 'info', 
          text: `Backup verified: Contains ${parsed.data.leads.length} candidates, ${parsed.data.coordinators?.length || 0} coordinators, ${parsed.data.jobs?.length || 0} jobs.` 
        });
      } catch (err) {
        setStatusMessage({ type: 'error', text: 'Could not parse JSON file. File may be corrupted.' });
        setParsedRestoreInfo(null);
        setConfirmFileRestore(false);
      }
    };
    reader.readAsText(file);
  };

  const handleExecuteRestore = async () => {
    if (!parsedRestoreInfo) return;
    if (!confirmFileRestore) {
      setConfirmFileRestore(true);
      return;
    }

    setConfirmFileRestore(false);
    setRestoring(true);
    setStatusMessage({ type: 'info', text: 'Creating Pre-Restore Safety Snapshot & restoring database records to Cloud Firestore...' });

    try {
      const res = await fetch(`/api/backup/restore${queryParams}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': sessionUser?.role || 'user',
          'x-agent-id': sessionUser?.username || 'System'
        },
        body: JSON.stringify(parsedRestoreInfo)
      });

      if (res.ok) {
        const data = await res.json();
        setStatusMessage({ 
          type: 'success', 
          text: `${data.message || 'Database restored successfully!'} A Pre-Restore Safety Snapshot was saved automatically.` 
        });
        setSelectedFileForRestore(null);
        setParsedRestoreInfo(null);
        await fetchBackupsList();
        if (onRestoreSuccess) {
          onRestoreSuccess();
        }
      } else {
        const errData = await res.json();
        setStatusMessage({ type: 'error', text: errData.error || 'Database restoration failed.' });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: 'Network or server error during restore operation.' });
    } finally {
      setRestoring(false);
    }
  };

  const handleExecuteCloudRestore = async (snapshotId: string) => {
    if (confirmCloudSnapshotId !== snapshotId) {
      setConfirmCloudSnapshotId(snapshotId);
      return;
    }

    setConfirmCloudSnapshotId(null);
    setRestoringCloudId(snapshotId);
    setStatusMessage({ type: 'info', text: 'Creating Pre-Restore Safety Snapshot and restoring from durable Firestore cloud snapshot...' });

    try {
      const res = await fetch(`/api/backup/cloud-restore/${encodeURIComponent(snapshotId)}${queryParams}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': sessionUser?.role || 'user',
          'x-agent-id': sessionUser?.username || 'System'
        }
      });

      if (res.ok) {
        const data = await res.json();
        setStatusMessage({
          type: 'success',
          text: `${data.message || 'Database restored from cloud snapshot!'} Pre-Restore Safety Snapshot was saved first.`
        });
        await fetchBackupsList();
        if (onRestoreSuccess) {
          onRestoreSuccess();
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setStatusMessage({ type: 'error', text: errData.error || 'Cloud snapshot restoration failed.' });
      }
    } catch (err) {
      setStatusMessage({ type: 'error', text: 'Network or server error while restoring cloud snapshot.' });
    } finally {
      setRestoringCloudId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-slate-900 dark:text-slate-100"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-850/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                Automated Database & XLSX Backup Center
                <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                  ⚡ Auto-Monday Active
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automatic scheduled full backups run every Monday at 00:00 midnight without delay or required permissions.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-800 dark:hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1 text-sm">
          {/* Status banner */}
          {statusMessage && (
            <div className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
              statusMessage.type === 'success' 
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' 
                : statusMessage.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                : 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800'
            }`}>
              {statusMessage.type === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
              {statusMessage.type === 'error' && <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />}
              {statusMessage.type === 'info' && <RefreshCw className="h-4 w-4 shrink-0 text-cyan-500 animate-spin" />}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Quick Actions Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* 1. Download Master XLSX */}
            <a
              href={`/api/backup/full-xlsx${queryParams}`}
              onClick={(e) => {
                e.preventDefault();
                handleDownloadFile(`/api/backup/full-xlsx${queryParams}`, `CGP_CRM_MASTER_BACKUP_${new Date().toISOString().split('T')[0]}.xlsx`);
              }}
              className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-gradient-to-br from-emerald-50/50 to-teal-50/20 dark:from-emerald-950/20 dark:to-teal-950/10 hover:border-emerald-400 transition flex flex-col justify-between group cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                {downloadingFile?.includes('.xlsx') ? (
                  <RefreshCw className="h-4 w-4 text-emerald-500 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 text-emerald-500 group-hover:translate-y-0.5 transition" />
                )}
              </div>
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200">Download Master XLSX</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">8-sheet Excel workbook with 100% CRM data.</p>
              </div>
            </a>

            {/* 2. Download Restorable DB JSON */}
            <a
              href={`/api/backup/full-db${queryParams}`}
              onClick={(e) => {
                e.preventDefault();
                handleDownloadFile(`/api/backup/full-db${queryParams}`, `CGP_CRM_DATABASE_BACKUP_${new Date().toISOString().split('T')[0]}.json`);
              }}
              className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/40 bg-gradient-to-br from-indigo-50/50 to-blue-50/20 dark:from-indigo-950/20 dark:to-blue-950/10 hover:border-indigo-400 transition flex flex-col justify-between group cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <Database className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                {downloadingFile?.includes('.json') ? (
                  <RefreshCw className="h-4 w-4 text-indigo-500 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 text-indigo-500 group-hover:translate-y-0.5 transition" />
                )}
              </div>
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200">Download DB Backup (.JSON)</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">100% restorable complete schema snapshot.</p>
              </div>
            </a>

            {/* 3. Instant Snapshot Generator */}
            <button
              onClick={handleTriggerManualBackup}
              disabled={triggering}
              className="p-4 rounded-xl border border-cyan-200 dark:border-cyan-900/40 bg-gradient-to-br from-cyan-50/50 to-sky-50/20 dark:from-cyan-950/20 dark:to-sky-950/10 hover:border-cyan-400 transition flex flex-col justify-between text-left group cursor-pointer disabled:opacity-50"
            >
              <div className="flex items-center justify-between mb-2">
                <Play className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                <RefreshCw className={`h-4 w-4 text-cyan-500 ${triggering ? 'animate-spin' : 'group-hover:rotate-45 transition'}`} />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200">Take Snapshot Now</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Generate DB & Excel backup copies immediately.</p>
              </div>
            </button>
          </div>

          {/* Database Restore Panel */}
          <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-amber-500" />
                <h3 className="font-black text-slate-900 dark:text-slate-100">Restore Database from Backup File</h3>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Supports .JSON backups
              </span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Upload a previously downloaded <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[11px]">.json</code> database backup to restore all candidates, coordinators, jobs, updates, and wallet balances back into the live system and Cloud Firestore.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <label className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-750 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition">
                <Upload className="h-4 w-4 text-cyan-500" />
                <span>{selectedFileForRestore ? selectedFileForRestore.name : 'Select DB Backup (.JSON)...'}</span>
                <input 
                  type="file" 
                  accept=".json" 
                  className="hidden" 
                  onChange={handleFileSelectForRestore} 
                />
              </label>

              {parsedRestoreInfo && !confirmFileRestore && (
                <button
                  onClick={handleExecuteRestore}
                  disabled={restoring}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-extrabold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-md disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${restoring ? 'animate-spin' : ''}`} />
                  <span>{restoring ? 'Restoring Live DB...' : `Execute Full Restore (${parsedRestoreInfo.data?.leads?.length || 0} Leads)`}</span>
                </button>
              )}

              {parsedRestoreInfo && confirmFileRestore && (
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={handleExecuteRestore}
                    disabled={restoring}
                    className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md disabled:opacity-50"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>Confirm Overwrite & Restore</span>
                  </button>
                  <button
                    onClick={() => setConfirmFileRestore(false)}
                    disabled={restoring}
                    className="px-3 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Durable Cloud Snapshots (Firestore lead_backups) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="h-4 w-4 text-emerald-500" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Durable Cloud Snapshots ({cloudSnapshots.length}) — Survives Publish & Restarts
                </h3>
              </div>
            </div>

            {loading ? (
              <div className="py-6 text-center text-xs text-slate-400">Loading cloud snapshots...</div>
            ) : cloudSnapshots.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-850/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                No durable cloud snapshots stored yet. Click "Take Snapshot Now" to save a chunked Firestore backup.
              </div>
            ) : (
              <div className="border border-emerald-200 dark:border-emerald-900/40 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-emerald-50/70 dark:bg-emerald-950/30 text-slate-600 dark:text-slate-300 font-bold border-b border-emerald-200/70 dark:border-emerald-900/40">
                    <tr>
                      <th className="px-3.5 py-2.5">Snapshot & Origin</th>
                      <th className="px-3.5 py-2.5">Candidates</th>
                      <th className="px-3.5 py-2.5">Size</th>
                      <th className="px-3.5 py-2.5">Saved At</th>
                      <th className="px-3.5 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {cloudSnapshots.map((snap) => (
                      <tr key={snap.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                        <td className="px-3.5 py-2 font-medium flex items-center gap-2">
                          <Cloud className="h-4 w-4 text-emerald-500 shrink-0" />
                          <div className="min-w-0">
                            <span className="font-mono text-[11px] block truncate max-w-[180px]">{snap.id}</span>
                            <span className={`inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              snap.source === 'pre_restore_safety'
                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                                : snap.isMondayScheduled
                                ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                                : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            }`}>
                              {snap.source === 'pre_restore_safety' ? 'Pre-Restore Safety' : snap.isMondayScheduled ? 'Monday Cron' : 'Cloud Snapshot'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3.5 py-2 font-mono text-[11px] font-bold">{snap.totalLeads}</td>
                        <td className="px-3.5 py-2 font-mono text-[11px] text-slate-500">{snap.sizeFormatted}</td>
                        <td className="px-3.5 py-2 text-slate-500 text-[11px]">
                          {new Date(snap.timestamp).toLocaleString()}
                        </td>
                        <td className="px-3.5 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <a
                              href={`/api/backup/cloud-download/${encodeURIComponent(snap.id)}${queryParams}`}
                              onClick={(e) => {
                                e.preventDefault();
                                handleDownloadFile(`/api/backup/cloud-download/${encodeURIComponent(snap.id)}${queryParams}`, `${snap.id}.json`);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold transition cursor-pointer"
                            >
                              {downloadingFile === `${snap.id}.json` ? (
                                <RefreshCw className="h-3 w-3 animate-spin text-emerald-500" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                              JSON
                            </a>
                            {confirmCloudSnapshotId === snap.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleExecuteCloudRestore(snap.id)}
                                  disabled={restoringCloudId === snap.id}
                                  className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-extrabold cursor-pointer disabled:opacity-50"
                                >
                                  {restoringCloudId === snap.id ? 'Restoring...' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmCloudSnapshotId(null)}
                                  className="px-1.5 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleExecuteCloudRestore(snap.id)}
                                disabled={restoringCloudId === snap.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                              >
                                <RefreshCw className={`h-3 w-3 ${restoringCloudId === snap.id ? 'animate-spin' : ''}`} />
                                Restore
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Stored Scheduled & Manual Backups Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-cyan-500" />
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Archived Automatic & Scheduled Backups ({backups.length})
                </h3>
              </div>
              <button 
                onClick={fetchBackupsList}
                className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" /> Refresh List
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading backup repository...</div>
            ) : backups.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-850/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                No backup archives found yet. Automatic backups run every Monday at 00:00. You can also click "Take Snapshot Now".
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100/70 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-750">
                    <tr>
                      <th className="px-3.5 py-2.5">File Name & Type</th>
                      <th className="px-3.5 py-2.5">Schedule Type</th>
                      <th className="px-3.5 py-2.5">File Size</th>
                      <th className="px-3.5 py-2.5">Created Date</th>
                      <th className="px-3.5 py-2.5 text-right">Download</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {backups.map((b) => (
                      <tr key={b.fileName} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                        <td className="px-3.5 py-2 font-medium flex items-center gap-2">
                          {b.type === 'xlsx' ? (
                            <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : (
                            <Database className="h-4 w-4 text-indigo-500 shrink-0" />
                          )}
                          <span className="truncate max-w-xs">{b.fileName}</span>
                        </td>
                        <td className="px-3.5 py-2">
                          {b.isMondayScheduled ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                              Monday Cron
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                              Snapshot
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2 font-mono text-[11px] text-slate-500">{b.sizeFormatted}</td>
                        <td className="px-3.5 py-2 text-slate-500 text-[11px]">
                          {new Date(b.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3.5 py-2 text-right">
                          <a
                            href={`/api/backup/download-file?file=${encodeURIComponent(b.fileName)}${queryParams ? queryParams.replace('?', '&') : ''}`}
                            onClick={(e) => {
                              e.preventDefault();
                              handleDownloadFile(`/api/backup/download-file?file=${encodeURIComponent(b.fileName)}${queryParams ? queryParams.replace('?', '&') : ''}`, b.fileName);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold transition cursor-pointer"
                          >
                            {downloadingFile === b.fileName ? (
                              <RefreshCw className="h-3 w-3 animate-spin text-emerald-500" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            Download
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/50 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Clock className="h-4 w-4 text-emerald-500" />
            <span>Next automatic backup: <strong>Every Monday at 00:00 UTC</strong></span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};
