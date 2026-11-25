import React, { useState, useEffect } from 'react';
import { 
  Briefcase, 
  Clock, 
  Users, 
  Plus, 
  Trash2, 
  Edit3, 
  Coins, 
  CheckCircle, 
  X, 
  Loader2, 
  ChevronDown,
  ShieldCheck,
  AlertCircle,
  Megaphone,
  TrendingUp,
  TrendingDown,
  Wallet as WalletIcon,
  PiggyBank,
  RefreshCw,
  Shield,
  History,
  Database,
  Download,
  Trophy,
  Target,
  Flame,
  Upload,
  Image as ImageIcon,
  ZoomIn,
  Search,
  Archive,
  RotateCcw
} from 'lucide-react';
import { Job, ImportantUpdate, Wallet, WalletTransaction, MonthlyTargetProgress } from '../types';

interface ActiveJobsProps {
  currentUser: {
    id: string;
    username: string;
    displayName: string;
    role: 'admin' | 'agent';
  } | null;
  countries?: string[];
  view?: 'jobs' | 'wallet';
}

export default function ActiveJobs({ currentUser, countries, view }: ActiveJobsProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wallet Feature Sub-Tab State
  const [subTab, setSubTab] = useState<'jobs' | 'wallet'>(view || 'jobs');

  useEffect(() => {
    if (view) {
      setSubTab(view);
    }
  }, [view]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);
  const [activeWalletUsername, setActiveWalletUsername] = useState<string>('');
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletAmount, setWalletAmount] = useState<string>('');
  const [walletType, setWalletType] = useState<'credit' | 'debit'>('credit');
  const [walletReason, setWalletReason] = useState<string>('');
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletSuccess, setWalletSuccess] = useState<string | null>(null);
  const [walletSubmitting, setWalletSubmitting] = useState(false);
  const [reconcilingWallets, setReconcilingWallets] = useState(false);
  const [txFilter, setTxFilter] = useState<'all' | 'credit' | 'debit'>('all');

  const selectedWalletCredits = React.useMemo(() => {
    return (selectedWallet?.transactions || [])
      .filter(t => t.type === 'credit')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [selectedWallet]);

  const selectedWalletDebits = React.useMemo(() => {
    return (selectedWallet?.transactions || [])
      .filter(t => t.type === 'debit')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [selectedWallet]);

  const totalAgencyCredits = React.useMemo(() => {
    return wallets.reduce((sum, w) => {
      return sum + (w.transactions || []).filter(t => t.type === 'credit').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    }, 0);
  }, [wallets]);

  const totalAgencyDebits = React.useMemo(() => {
    return wallets.reduce((sum, w) => {
      return sum + (w.transactions || []).filter(t => t.type === 'debit').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    }, 0);
  }, [wallets]);

  const filteredTransactions = React.useMemo(() => {
    if (!selectedWallet?.transactions) return [];
    const list = selectedWallet.transactions.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    if (txFilter === 'credit') return list.filter(t => t.type === 'credit');
    if (txFilter === 'debit') return list.filter(t => t.type === 'debit');
    return list;
  }, [selectedWallet?.transactions, txFilter]);

  const getCoordRoleBadge = React.useCallback((username: string) => {
    const u = String(username || '').toLowerCase().trim();
    if (u === 'shreya') return { label: 'TL', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
    if (u === 'edenla' || u === 'eden') return { label: 'Manager', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' };
    if (u === 'priya') return { label: 'Manager', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' };
    if (u === 'bishwo') return { label: 'BDM', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
    if (u === 'sachinsaha' || u === 'sachin') return { label: 'Digital Marketer', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' };
    if (u === 'joyce' || u === 'maryada' || u === 'sarina') return { label: 'Telecaller', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
    return null;
  }, []);

  // Monthly Won Target & Tier Rates State (Coord Bishwo & Priya)
  const [monthlyProgress, setMonthlyProgress] = useState<MonthlyTargetProgress | null>(null);
  const [loadingMonthlyProgress, setLoadingMonthlyProgress] = useState(false);
  const [isTargetEditModalOpen, setIsTargetEditModalOpen] = useState(false);
  const [targetWonCountInput, setTargetWonCountInput] = useState<number>(15);
  const [tier1RateInput, setTier1RateInput] = useState<number>(300);
  const [tier2RateInput, setTier2RateInput] = useState<number>(150);
  const [savingTargetSettings, setSavingTargetSettings] = useState(false);
  const [isSettlingTargetPayout, setIsSettlingTargetPayout] = useState(false);
  const [showWonLeadsDrawer, setShowWonLeadsDrawer] = useState(false);

  const fetchMonthlyTargetProgress = React.useCallback(async (monthKey?: string) => {
    setLoadingMonthlyProgress(true);
    try {
      const url = monthKey ? `/api/monthly-target-progress?month=${encodeURIComponent(monthKey)}` : '/api/monthly-target-progress';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setMonthlyProgress(data);
        setTargetWonCountInput(data.targetWonCount);
        setTier1RateInput(data.tier1Rate);
        setTier2RateInput(data.tier2Rate);
      }
    } catch (err) {
      console.error('Failed to load monthly target progress:', err);
    } finally {
      setLoadingMonthlyProgress(false);
    }
  }, []);

  const handleSaveTargetSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTargetSettings(true);
    try {
      const res = await fetch('/api/monthly-target-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetWonCount: Number(targetWonCountInput) || 15,
          tier1Rate: Number(tier1RateInput) || 300,
          tier2Rate: Number(tier2RateInput) || 150,
          targetCoordinators: ['bishwo', 'priya']
        })
      });
      if (!res.ok) throw new Error('Failed to update target settings');
      setIsTargetEditModalOpen(false);
      setWalletSuccess('Monthly Target settings updated successfully!');
      await fetchMonthlyTargetProgress();
    } catch (err: any) {
      setWalletError(err.message || 'Error updating settings');
    } finally {
      setSavingTargetSettings(false);
    }
  };

  const handleSettleTargetPayout = async () => {
    if (!monthlyProgress) return;
    const confirmMsg = `Settle Month-End Payout for ${monthlyProgress.monthLabel}?\n\n` +
      `Total Won: ${monthlyProgress.wonCount} candidates\n` +
      `Rate Applied: INR ${monthlyProgress.applicableRate}/candidate (${monthlyProgress.isTargetAchieved ? 'Target Met' : 'Below Target'})\n` +
      `Each Coordinator (Bishwo & Priya) will receive: INR ${monthlyProgress.projectedPayoutPerCoord.toLocaleString()} CR.`;
    
    if (!window.confirm(confirmMsg)) return;

    setIsSettlingTargetPayout(true);
    try {
      const res = await fetch('/api/monthly-target-settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthKey: monthlyProgress.monthKey
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to settle payout');
      setWalletSuccess(data.message || 'Month-end payout settled successfully!');
      await fetchWalletData();
      await fetchMonthlyTargetProgress();
    } catch (err: any) {
      setWalletError(err.message || 'Error settling monthly payout');
    } finally {
      setIsSettlingTargetPayout(false);
    }
  };

  // Data Vault & Safe Storage State
  const [safetyStatus, setSafetyStatus] = useState<any>(null);
  const [isSnapshotsModalOpen, setIsSnapshotsModalOpen] = useState(false);
  const [snapshotsList, setSnapshotsList] = useState<any[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [newSnapshotReason, setNewSnapshotReason] = useState('');
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);

  const fetchSafetyStatus = React.useCallback(async () => {
    try {
      const res = await fetch('/api/wallets/safety-status');
      if (res.ok) {
        const data = await res.json();
        setSafetyStatus(data);
      }
    } catch {}
  }, []);

  const fetchSnapshotsList = async () => {
    setLoadingSnapshots(true);
    try {
      const res = await fetch('/api/wallets/snapshots', {
        headers: { 'x-user-role': currentUser?.role || 'admin' }
      });
      if (res.ok) {
        const data = await res.json();
        setSnapshotsList(data);
      }
    } catch {} finally {
      setLoadingSnapshots(false);
    }
  };

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSnapshotReason.trim()) return;
    setCreatingSnapshot(true);
    try {
      const res = await fetch('/api/wallets/snapshots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': currentUser?.role || 'admin'
        },
        body: JSON.stringify({
          reason: newSnapshotReason.trim(),
          createdBy: currentUser?.displayName || currentUser?.username || 'Admin'
        })
      });
      if (!res.ok) throw new Error('Failed to create snapshot');
      setNewSnapshotReason('');
      setWalletSuccess('Safe point-in-time snapshot created successfully in the Data Vault!');
      await fetchSnapshotsList();
      await fetchSafetyStatus();
    } catch (err: any) {
      setWalletError(err.message || 'Error creating snapshot');
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleRestoreSnapshot = async (snapshotId: string, reason: string) => {
    const confirmed = window.confirm(
      `Rollback to snapshot "${reason}"?\n\nA safeguard snapshot of current state will be preserved automatically.`
    );
    if (!confirmed) return;

    setLoadingSnapshots(true);
    try {
      const res = await fetch(`/api/wallets/snapshots/${snapshotId}/restore`, {
        method: 'POST',
        headers: { 'x-user-role': currentUser?.role || 'admin' }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to restore snapshot');
      setWalletSuccess(`Successfully restored state from snapshot ${snapshotId}!`);
      setIsSnapshotsModalOpen(false);
      await fetchWalletData();
      await fetchSafetyStatus();
    } catch (err: any) {
      setWalletError(err.message || 'Error restoring snapshot');
    } finally {
      setLoadingSnapshots(false);
    }
  };

  const handleReconcileWallets = async () => {
    setReconcilingWallets(true);
    setWalletError(null);
    setWalletSuccess(null);
    try {
      const res = await fetch('/api/wallets/reconcile', {
        method: 'POST',
        headers: {
          'x-user-role': currentUser?.role || 'admin'
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reconcile wallets');
      setWalletSuccess(`Successfully verified and reconciled coordinator incentive wallets! (${data.count} coordinator ledgers synchronized with zero data loss)`);
      await fetchWalletData();
      await fetchSafetyStatus();
      await fetchMonthlyTargetProgress();
    } catch (err: any) {
      setWalletError(err.message || 'Error reconciling wallets');
    } finally {
      setReconcilingWallets(false);
    }
  };

  const fetchWalletData = React.useCallback(async () => {
    setWalletLoading(true);
    setWalletError(null);
    try {
      if (currentUser?.role === 'admin') {
        const res = await fetch('/api/wallets');
        if (!res.ok) throw new Error('Failed to fetch coordinator wallets.');
        const data = await res.json();
        setWallets(data);
        
        if (data.length > 0) {
          setActiveWalletUsername(prev => {
            const current = prev || data[0].username;
            const found = data.find((w: Wallet) => w.username === current);
            setSelectedWallet(found || data[0]);
            return current;
          });
        }
      } else if (currentUser?.username) {
        const res = await fetch(`/api/wallets/${currentUser.username}`);
        if (!res.ok) throw new Error('Failed to fetch wallet.');
        const data = await res.json();
        setSelectedWallet(data);
        setActiveWalletUsername(currentUser.username);
      }
    } catch (err: any) {
      setWalletError(err.message);
    } finally {
      setWalletLoading(false);
    }
  }, [currentUser?.role, currentUser?.username]);

  useEffect(() => {
    if (subTab === 'wallet') {
      fetchWalletData();
      fetchSafetyStatus();
      fetchMonthlyTargetProgress();
    }
  }, [subTab, fetchWalletData, fetchSafetyStatus, fetchMonthlyTargetProgress]);

  // When activeWalletUsername changes and wallets are already loaded, update selectedWallet
  const handleSelectWalletUser = (username: string) => {
    setActiveWalletUsername(username);
    const found = wallets.find(w => w.username === username);
    if (found) {
      setSelectedWallet(found);
    }
  };

  const handleWalletAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWalletUsername) return;
    if (!walletAmount || Number(walletAmount) <= 0) {
      setWalletError('Please enter a valid positive amount.');
      return;
    }
    if (!walletReason.trim()) {
      setWalletError('Please provide a reason.');
      return;
    }

    setWalletSubmitting(true);
    setWalletError(null);
    setWalletSuccess(null);

    try {
      const res = await fetch(`/api/wallets/${activeWalletUsername}/transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': currentUser?.role || 'user'
        },
        body: JSON.stringify({
          type: walletType,
          amount: Number(walletAmount),
          reason: walletReason.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to apply wallet adjustment.');
      }

      setWalletSuccess(`Successfully adjusted balance! New balance: INR ${data.wallet.balance}`);
      setWalletAmount('');
      setWalletReason('');
      
      await fetchWalletData();
      
      setTimeout(() => setWalletSuccess(null), 4000);
    } catch (err: any) {
      setWalletError(err.message);
    } finally {
      setWalletSubmitting(false);
    }
  };

  const handleDeleteWalletTransaction = async (txId: string) => {
    if (!activeWalletUsername) return;
    if (!window.confirm('Are you sure you want to remove this transaction record?')) return;
    try {
      const res = await fetch(`/api/wallets/${activeWalletUsername}/transaction/${txId}`, {
        method: 'DELETE',
        headers: {
          'x-user-role': currentUser?.role || 'user'
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete transaction.');
      setWalletSuccess('Transaction successfully removed!');
      await fetchWalletData();
      setTimeout(() => setWalletSuccess(null), 3000);
    } catch (err: any) {
      setWalletError(err.message);
    }
  };

  // Simplified Active Job Creative + Service Charge states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  const [imageUrl, setImageUrl] = useState('');
  const [serviceCharge, setServiceCharge] = useState('');
  const [imageSizeBytes, setImageSizeBytes] = useState<number | undefined>(undefined);
  const [originalSizeBytes, setOriginalSizeBytes] = useState<number | undefined>(undefined);
  const [originalFilename, setOriginalFilename] = useState('');
  const [isUploadingCreative, setIsUploadingCreative] = useState(false);
  const [isDraggingCreative, setIsDraggingCreative] = useState(false);
  const [isSubmittingJob, setIsSubmittingJob] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const [jobSearchQuery, setJobSearchQuery] = useState('');
  const [jobStatusFilter, setJobStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [previewCreativeJob, setPreviewCreativeJob] = useState<Job | null>(null);

  // Recovery Archive (Zero-Data-Loss Soft-Delete Recovery)
  const [archivedJobs, setArchivedJobs] = useState<Job[]>([]);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [restoringJobId, setRestoringJobId] = useState<string | null>(null);

  // Important Updates states
  const [updates, setUpdates] = useState<ImportantUpdate[]>([]);
  const [isUpdateFormOpen, setIsUpdateFormOpen] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<ImportantUpdate | null>(null);
  const [updateText, setUpdateText] = useState('');
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deletingUpdateId, setDeletingUpdateId] = useState<string | null>(null);

  // Fetch all jobs
  const fetchJobs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) throw new Error('Failed to load active jobs.');
      const data = await res.json();
      const safeData = Array.isArray(data) ? data.filter(j => j && typeof j === 'object') : [];
      setJobs(safeData);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch important updates
  const fetchUpdates = async (retries = 1) => {
    try {
      const res = await fetch('/api/updates');
      if (res.ok) {
        const data = await res.json();
        setUpdates(Array.isArray(data) ? data : []);
      } else {
        throw new Error(`Server returned status ${res.status}`);
      }
    } catch (err) {
      console.warn(`Failed to load updates (retries left: ${retries}):`, err);
      if (retries > 0) {
        setTimeout(() => {
          fetchUpdates(retries - 1);
        }, 1000);
      } else {
        const defaultFallback: ImportantUpdate[] = [
          {
            id: 'fallback_1',
            text: "Today's interviews: Nesto Hypermarket screening starting at 3:00 PM. Zoom link: https://zoom.us/j/9876543210",
            createdAt: new Date().toISOString()
          },
          {
            id: 'fallback_2',
            text: "Guest Relations Dubai (Highend Fine Dine) second round interview via Google Meet: https://meet.google.com/abc-defg-hij on June 28 at 4:30 PM.",
            createdAt: new Date().toISOString()
          }
        ];
        setUpdates(defaultFallback);
      }
    }
  };

  useEffect(() => {
    fetchJobs();
    if (currentUser?.role === 'admin') {
      fetchUpdates();
    }
  }, [currentUser?.role]);

  // Format bytes helper
  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Upload image and convert to WebP on server
  const handleCreativeImageFile = async (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormError('Please select a valid image file (JPG, PNG, WEBP, etc.).');
      return;
    }

    setFormError(null);
    setIsUploadingCreative(true);

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/jobs/upload-creative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name || 'job_creative.png',
          fileType: file.type,
          base64Data
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.url) {
        throw new Error(data.error || 'Failed to upload and convert image to WebP.');
      }

      setImageUrl(data.url);
      setImageSizeBytes(data.sizeBytes);
      setOriginalSizeBytes(data.originalSizeBytes);
      setOriginalFilename(file.name || data.fileName);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to process creative image.');
    } finally {
      setIsUploadingCreative(false);
    }
  };

  // Handle open form for creating new job
  const handleOpenCreate = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setFormError(null);
    setEditingJob(null);
    setImageUrl('');
    setServiceCharge('');
    setImageSizeBytes(undefined);
    setOriginalSizeBytes(undefined);
    setOriginalFilename('');
    setIsActive(true);
    setIsFormOpen(true);
  };

  // Handle edit job
  const handleOpenEdit = (job: Job, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFormError(null);
    setEditingJob(job);
    setImageUrl(job.imageUrl || '');
    setServiceCharge(
      job.serviceCharge ||
      (job.processingFeeMale || job.processingFeeFemale
        ? [job.processingFeeMale ? `Male: ${job.processingFeeMale}` : '', job.processingFeeFemale ? `Female: ${job.processingFeeFemale}` : '']
            .filter(Boolean)
            .join(' | ')
        : '')
    );
    setImageSizeBytes(job.imageSizeBytes);
    setOriginalSizeBytes(undefined);
    setOriginalFilename(job.originalFilename || '');
    setIsActive(job.isActive !== false);
    setIsFormOpen(true);
  };

  // Handle submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploadingCreative) {
      setFormError('Please wait for the image WebP conversion to finish.');
      return;
    }
    if (!imageUrl.trim()) {
      setFormError('Please upload a job demand creative image.');
      return;
    }
    if (!serviceCharge.trim()) {
      setFormError('Please enter the Service Charge.');
      return;
    }

    setFormError(null);
    setIsSubmittingJob(true);

    const payload = {
      imageUrl: imageUrl.trim(),
      serviceCharge: serviceCharge.trim(),
      imageFormat: 'webp',
      imageSizeBytes,
      originalFilename,
      title: `Demand • ${serviceCharge.trim()}`.slice(0, 120),
      isActive
    };

    try {
      let res;
      if (editingJob) {
        res = await fetch(`/api/jobs/${editingJob.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save the job demand.');
      }

      setIsFormOpen(false);
      setEditingJob(null);
      setFormError(null);
      fetchJobs();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setIsSubmittingJob(false);
    }
  };

  // Handle delete job (initiates custom confirmation modal)
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingJobId(id);
  };

  // Fetch archived (soft-deleted) jobs for Admin recovery
  const fetchArchivedJobs = async () => {
    setLoadingArchived(true);
    try {
      const res = await fetch('/api/jobs/archived');
      if (!res.ok) throw new Error('Failed to load archived jobs.');
      const data = await res.json();
      setArchivedJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingArchived(false);
    }
  };

  // Restore a soft-deleted job from the archive
  const handleRestoreJob = async (jobId: string) => {
    setRestoringJobId(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/restore`, {
        method: 'POST'
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to restore job.');
      }
      await Promise.all([fetchJobs(), fetchArchivedJobs()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoringJobId(null);
    }
  };

  // Confirms soft-deletion (moves job to Recovery Archive, preserving WebP & metadata)
  const confirmDelete = async () => {
    if (!deletingJobId) return;
    try {
      const res = await fetch(`/api/jobs/${deletingJobId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to archive job.');
      }
      setDeletingJobId(null);
      fetchJobs();
    } catch (err) {
      setError((err as Error).message);
      setDeletingJobId(null);
    }
  };

  // Important Updates handlers
  const handleOpenCreateUpdate = () => {
    setUpdateError(null);
    setEditingUpdate(null);
    setUpdateText('');
    setIsUpdateFormOpen(true);
  };

  const handleOpenEditUpdate = (upd: ImportantUpdate) => {
    setUpdateError(null);
    setEditingUpdate(upd);
    setUpdateText(upd.text);
    setIsUpdateFormOpen(true);
  };

  const handleSubmitUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updateText.trim()) return;

    try {
      let res;
      if (editingUpdate) {
        res = await fetch(`/api/updates/${editingUpdate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: updateText.trim() })
        });
      } else {
        res = await fetch('/api/updates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: updateText.trim() })
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save the update.');
      }

      setIsUpdateFormOpen(false);
      setEditingUpdate(null);
      setUpdateText('');
      setUpdateError(null);
      fetchUpdates();
      
      // Dispatch custom event to notify global ImportantUpdatesBar to refresh instantly
      window.dispatchEvent(new CustomEvent('cgp-updates-changed'));
    } catch (err) {
      setUpdateError((err as Error).message);
    }
  };

  const handleDeleteUpdate = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingUpdateId(id);
  };

  const confirmDeleteUpdate = async () => {
    if (!deletingUpdateId) return;
    try {
      const res = await fetch(`/api/updates/${deletingUpdateId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to delete update.');
      }
      setDeletingUpdateId(null);
      fetchUpdates();
      
      // Dispatch custom event to notify global ImportantUpdatesBar to refresh instantly
      window.dispatchEvent(new CustomEvent('cgp-updates-changed'));
    } catch (err) {
      setUpdateError((err as Error).message);
      setDeletingUpdateId(null);
    }
  };


  // Filtered active jobs list (only active jobs shown to non-admins)
  const visibleJobs = React.useMemo(() => {
    if (!Array.isArray(jobs)) return [];
    const q = jobSearchQuery.trim().toLowerCase();
    return jobs.filter(job => {
      if (!job) return false;
      if (currentUser?.role !== 'admin' && job.isActive === false) return false;
      if (currentUser?.role === 'admin') {
        if (jobStatusFilter === 'active' && job.isActive === false) return false;
        if (jobStatusFilter === 'paused' && job.isActive !== false) return false;
      }
      if (q) {
        const haystack = [
          job.serviceCharge,
          job.title,
          job.country,
          job.requirement,
          job.processingFeeMale,
          job.processingFeeFemale
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, currentUser?.role, jobStatusFilter, jobSearchQuery]);

  const totalVisibleBaseCount = React.useMemo(() => {
    if (!Array.isArray(jobs)) return 0;
    return jobs.filter(j => j && (currentUser?.role === 'admin' || j.isActive !== false)).length;
  }, [jobs, currentUser?.role]);

  return (
    <div id="active-jobs-container" className="space-y-8 animate-fade-in pb-16">
      
      {/* Top Header Card */}
      <div className="bg-radial from-slate-900 to-slate-950 text-slate-100 rounded-3xl py-4.5 px-6 sm:px-8 shadow-xl relative overflow-hidden border border-slate-750">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl -ml-20 -mb-20 pointer-events-none" />
        
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4 z-10">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {subTab === 'wallet' ? 'Live Compensation Ledger' : 'Live Demand Requirement Hub'}
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight font-sans">
              {subTab === 'wallet' ? 'Incentive Wallet' : 'Overseas Vacancy Tracker'}
            </h1>
          </div>
          
          {subTab === 'jobs' && (
            <button 
              id="add-vacancy-btn"
              type="button"
              onClick={handleOpenCreate}
              className="self-start md:self-center px-5 py-3 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-zinc-950 font-black rounded-xl transition duration-150 shadow-lg shadow-emerald-500/25 inline-flex items-center gap-2 cursor-pointer text-xs select-none z-25 relative"
            >
              <Plus className="w-4 h-4" />
              Add Active Job
            </button>
          )}
        </div>
      </div>

      {/* Premium Sub-Tab Navigation Bar */}
      {!view && (
        <div className="flex bg-slate-900/60 p-1.5 rounded-2xl border border-slate-800 max-w-md text-left">
          <button
            type="button"
            onClick={() => setSubTab('jobs')}
            className={`flex-1 py-2.5 px-4 font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all rounded-xl cursor-pointer ${
              subTab === 'jobs'
                ? 'bg-emerald-500 text-zinc-950 font-black shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Briefcase className="w-4 h-4" />
            Active Vacancies
          </button>
          <button
            type="button"
            onClick={() => setSubTab('wallet')}
            className={`flex-1 py-2.5 px-4 font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all rounded-xl cursor-pointer ${
              subTab === 'wallet'
                ? 'bg-emerald-500 text-zinc-950 font-black shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <PiggyBank className="w-4 h-4" />
            Incentive Wallet
          </button>
        </div>
      )}

      {subTab === 'jobs' && (
        <>

      {/* Admin Important Updates Control Panel */}
      {currentUser?.role === 'admin' && (
        <div className="bg-slate-900 border border-slate-750/80 rounded-3xl p-6 shadow-xl space-y-4 text-left">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-base font-black text-slate-100 uppercase tracking-wider flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-red-500 animate-bounce" />
                Live Important Updates Control Panel
              </h2>
              <p className="text-xs text-slate-400 font-bold">
                Publish today's interviews, Zoom/GMeet links, and announcements in the running red bar below the tabs.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenCreateUpdate}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-xs rounded-xl transition duration-150 shadow-md shadow-red-600/10 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Live Update
            </button>
          </div>

          {updateError && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 p-3 rounded-xl flex items-center gap-2 text-xs font-bold">
              <AlertCircle className="w-4.5 h-4.5 flex-shrink-0" />
              <span>{updateError}</span>
            </div>
          )}

          {updates.length === 0 ? (
            <p className="text-xs text-slate-500 font-bold py-2 text-center">No live updates active. Add an update to display it on the main screen ticker.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[220px] overflow-y-auto pr-2">
              {updates.map((update) => (
                <div key={update.id} className="bg-slate-850 border border-slate-800 hover:border-slate-700 p-3.5 rounded-2xl flex items-start justify-between gap-3 shadow-3xs group transition duration-150">
                  <div className="space-y-1">
                    <span className="text-[9px] font-black text-slate-500 font-mono block">
                      PUBLISHED: {new Date(update.createdAt).toLocaleString()}
                    </span>
                    <p className="text-xs font-bold text-red-500 leading-relaxed break-words">
                      {update.text}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100 transition">
                    <button
                      type="button"
                      onClick={() => handleOpenEditUpdate(update)}
                      className="p-1.5 text-slate-400 hover:text-accent-purple hover:bg-slate-800 rounded-lg cursor-pointer transition"
                      title="Edit update text"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteUpdate(update.id, e)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-slate-800 rounded-lg cursor-pointer transition"
                      title="Remove update"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Active Job Creatives Gallery */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
          <p className="text-slate-500 text-sm font-medium animate-pulse">Loading active job creatives...</p>
        </div>
      ) : totalVisibleBaseCount === 0 ? (
        <div className="bg-slate-900 border border-slate-750 border-dashed rounded-3xl py-20 text-center max-w-xl mx-auto px-6">
          <ImageIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-100">No active job creatives yet</h3>
          <p className="text-slate-500 text-sm mt-2 max-w-md mx-auto">
            Upload client demand images and enter the Service Charge so coordinators can view and share active openings instantly.
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="mt-6 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-xl text-xs font-black inline-flex items-center gap-2 cursor-pointer"
          >
            <Upload className="w-4 h-4" /> Upload First Job Creative
          </button>
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Clean Filter & Search Toolbar */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-black text-slate-100 uppercase tracking-wider flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-emerald-400" />
                Active Demand Creatives
              </h2>
              <span className="text-xs font-mono font-bold text-slate-400 tabular-nums">
                ({visibleJobs.length})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={jobSearchQuery}
                  onChange={(e) => setJobSearchQuery(e.target.value)}
                  placeholder="Search service charge..."
                  className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {currentUser?.role === 'admin' && (
                <>
                  <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1 text-[11px] font-bold">
                    {(['all', 'active', 'paused'] as const).map((statusKey) => (
                      <button
                        key={statusKey}
                        type="button"
                        onClick={() => setJobStatusFilter(statusKey)}
                        className={`px-2.5 py-1 rounded-lg uppercase tracking-wider transition cursor-pointer ${
                          jobStatusFilter === statusKey
                            ? 'bg-emerald-500 text-zinc-950 font-black'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {statusKey}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsArchiveModalOpen(true);
                      fetchArchivedJobs();
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-emerald-400 text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 transition cursor-pointer"
                    title="View and restore archived job demands"
                  >
                    <Archive className="w-3.5 h-3.5 text-emerald-400" />
                    Recovery Archive
                  </button>
                </>
              )}
            </div>
          </div>

          {visibleJobs.length === 0 ? (
            <div className="bg-slate-900/50 border border-slate-800 border-dashed rounded-2xl py-14 text-center">
              <p className="text-sm font-bold text-slate-400">No job creatives match your current filter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visibleJobs.map((job) => {
                const displayServiceCharge =
                  job.serviceCharge ||
                  (job.processingFeeMale || job.processingFeeFemale
                    ? [
                        job.processingFeeMale ? `Male: ${job.processingFeeMale}` : '',
                        job.processingFeeFemale ? `Female: ${job.processingFeeFemale}` : ''
                      ]
                        .filter(Boolean)
                        .join(' • ')
                    : 'Not specified');

                return (
                  <div
                    key={job.id}
                    id={`job-card-${job.id}`}
                    className={`bg-slate-900 border rounded-2xl overflow-hidden flex flex-col transition-all duration-200 text-left ${
                      job.isActive === false
                        ? 'border-dashed border-slate-700 opacity-75'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Slim Card Top Bar (keeps status & actions off the image) */}
                    <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                          job.isActive !== false
                            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                            : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            job.isActive !== false ? 'bg-emerald-400' : 'bg-amber-400'
                          }`}
                        />
                        {job.isActive !== false ? 'Active' : 'Paused'}
                      </span>

                      {job.imageUrl && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setPreviewCreativeJob(job)}
                            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-emerald-400 transition cursor-pointer"
                            title="Enlarge Creative"
                          >
                            <ZoomIn className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={job.imageUrl}
                            download={`job_creative_${job.id}.webp`}
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-emerald-400 transition"
                            title="Download WebP Creative"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Edge-to-Edge Creative Showcase */}
                    <div className="relative bg-slate-950 border-b border-slate-800 group">
                      {job.imageUrl ? (
                        <div
                          onClick={() => setPreviewCreativeJob(job)}
                          className="relative w-full aspect-square flex items-center justify-center overflow-hidden cursor-zoom-in bg-slate-950"
                        >
                          <img
                            src={job.imageUrl}
                            alt={displayServiceCharge}
                            loading="lazy"
                            className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1.5 rounded-lg bg-slate-950/90 border border-slate-700 text-xs font-bold text-slate-100 flex items-center gap-1.5">
                              <ZoomIn className="w-3.5 h-3.5 text-emerald-400" />
                              Enlarge
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full aspect-square flex flex-col items-center justify-center p-5 text-center space-y-2 bg-slate-950/80">
                          <ImageIcon className="w-8 h-8 text-slate-600" />
                          {job.title && (
                            <p className="text-sm font-extrabold text-slate-200 line-clamp-2">{job.title}</p>
                          )}
                          {job.country && (
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{job.country}</p>
                          )}
                          {currentUser?.role === 'admin' && (
                            <button
                              type="button"
                              onClick={(e) => handleOpenEdit(job, e)}
                              className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold cursor-pointer transition"
                            >
                              Upload Creative Image
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Single Service Charge Heading Block */}
                    <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                      <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-1">
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
                          <Coins className="w-3.5 h-3.5" />
                          Service Charge
                        </span>
                        <h3 className="text-base font-black text-slate-100 leading-snug break-words tabular-nums">
                          {displayServiceCharge}
                        </h3>
                      </div>

                      {/* Card Footer: Timestamp, WebP metadata & Admin Controls */}
                      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-800/80 text-[11px]">
                        <div className="text-slate-500 font-mono truncate">
                          {new Date(job.createdAt).toLocaleDateString()}
                          {job.imageSizeBytes ? ` • ${formatBytes(job.imageSizeBytes)} WEBP` : ''}
                        </div>

                        {currentUser?.role === 'admin' ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  const res = await fetch(`/api/jobs/${job.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ isActive: job.isActive === false })
                                  });
                                  if (res.ok) fetchJobs();
                                } catch (err) {
                                  console.error('Failed to toggle job status', err);
                                }
                              }}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ${
                                job.isActive !== false ? 'bg-emerald-600' : 'bg-slate-700'
                              }`}
                              title={job.isActive !== false ? 'Pause demand' : 'Activate demand'}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                                  job.isActive !== false ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleOpenEdit(job, e)}
                              className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                              title="Edit Service Charge or Replace Creative"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDelete(job.id, e)}
                              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                              title="Delete Job Creative"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          job.imageUrl && (
                            <button
                              type="button"
                              onClick={() => setPreviewCreativeJob(job)}
                              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition"
                            >
                              <ZoomIn className="w-3.5 h-3.5 text-emerald-400" />
                              View
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      </>
    )}

    {/* Incentive Wallet View */}
    {subTab === 'wallet' && (
      <div className="space-y-6 text-left animate-fade-in">
        
        {/* MONTHLY TARGET ACHIEVEMENT HUB (Coord Bishwo & Priya) */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/50 border border-slate-750 p-6 shadow-2xl space-y-6">
          {/* Ambient background glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

          {/* Top Row: Header & Live Target Status */}
          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500/20 via-indigo-500/20 to-emerald-500/20 border border-indigo-500/30 text-amber-300 flex items-center justify-center shrink-0 shadow-lg">
                <Trophy className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 font-mono flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-indigo-400" /> Monthly Won Milestone
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[9px] font-black uppercase tracking-wider">
                    {monthlyProgress?.monthLabel || 'Current Month'}
                  </span>
                  {monthlyProgress?.isSettledForMonth && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                      <CheckCircle className="w-2.5 h-2.5 text-emerald-400" /> Month Settled
                    </span>
                  )}
                </div>
                <h3 className="text-base font-black text-slate-100 uppercase tracking-tight mt-0.5">
                  Agency Monthly Target & Executive Incentive
                </h3>
                <p className="text-xs text-slate-400 font-medium">
                  Exclusive milestone rewards for Coord <strong className="text-slate-200">Bishwo (BDM)</strong> & <strong className="text-slate-200">Priya (Manager)</strong>.
                </p>
              </div>
            </div>

            {/* Target Status Badge & Quick Actions */}
            <div className="flex items-center gap-2 flex-wrap self-end md:self-auto">
              {monthlyProgress?.isTargetAchieved ? (
                <div className="px-3.5 py-1.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 flex items-center gap-2 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-xs font-black uppercase tracking-wider">🎯 Target Achieved ({monthlyProgress?.wonCount} Won)</span>
                </div>
              ) : (
                <div className="px-3.5 py-1.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-xs font-black uppercase tracking-wider">
                    {monthlyProgress 
                      ? `${monthlyProgress.wonCount} / ${monthlyProgress.targetWonCount} Won (${monthlyProgress.targetWonCount - monthlyProgress.wonCount} to 2x tier)` 
                      : 'Tracking Progress...'}
                  </span>
                </div>
              )}

              {currentUser?.role === 'admin' && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsTargetEditModalOpen(true)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 font-black text-[11px] uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5"
                    title="Edit Monthly Target Count & Winning Amounts"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Edit Target</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSettleTargetPayout}
                    disabled={isSettlingTargetPayout || monthlyProgress?.isSettledForMonth}
                    className={`px-3 py-1.5 rounded-xl font-black text-[11px] uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5 ${
                      monthlyProgress?.isSettledForMonth
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 cursor-default'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                    }`}
                    title={monthlyProgress?.isSettledForMonth ? 'Payout already settled for this month' : 'Settle and credit month-end incentive to Bishwo and Priya'}
                  >
                    {isSettlingTargetPayout ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : monthlyProgress?.isSettledForMonth ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Coins className="w-3.5 h-3.5" />
                    )}
                    <span>{monthlyProgress?.isSettledForMonth ? 'Month Settled' : 'Settle Payout'}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Live Progress Bar Container */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-mono font-bold">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-amber-400 animate-pulse" />
                Live Target Achievement Pace
              </span>
              <span className="text-slate-200">
                <strong className="text-emerald-400 font-extrabold text-sm">{monthlyProgress?.wonCount || 0}</strong>
                <span className="text-slate-500"> / {monthlyProgress?.targetWonCount || 15} Won</span>
                <span className="ml-2 text-indigo-400 font-black">({monthlyProgress?.progressPercent || 0}%)</span>
              </span>
            </div>

            {/* The Track & Fill Bar */}
            <div className="relative h-6 w-full rounded-2xl bg-slate-950/80 border border-slate-800 p-1 shadow-inner overflow-hidden flex items-center">
              {/* Background Target Guideline */}
              <div 
                className="absolute top-0 bottom-0 border-r-2 border-dashed border-amber-400/60 z-10"
                style={{ left: '100%' }}
                title="Monthly Target Line"
              />
              
              {/* Filled Bar */}
              <div
                className={`h-full rounded-xl transition-all duration-700 ease-out flex items-center justify-end pr-2 text-[10px] font-black font-mono text-white shadow-lg ${
                  monthlyProgress?.isTargetAchieved
                    ? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 shadow-emerald-500/20'
                    : 'bg-gradient-to-r from-indigo-600 via-purple-600 to-amber-500'
                }`}
                style={{ width: `${Math.max(4, Math.min(100, monthlyProgress?.progressPercent || 0))}%` }}
              >
                {monthlyProgress && monthlyProgress.progressPercent >= 12 && (
                  <span className="drop-shadow-sm flex items-center gap-1">
                    {monthlyProgress.isTargetAchieved ? '🏆 100%' : `${monthlyProgress.progressPercent}%`}
                  </span>
                )}
              </div>
            </div>

            {/* Target Tier Indicator Footnote */}
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium px-1">
              <span>0 Won (Start of Month)</span>
              <span className={monthlyProgress?.isTargetAchieved ? 'text-emerald-400 font-bold' : 'text-amber-400 font-semibold'}>
                Target: {monthlyProgress?.targetWonCount || 15} Won • Tier 1 Rate: INR {monthlyProgress?.tier1Rate || 300}/candidate (INR {((monthlyProgress?.targetWonCount || 15) * (monthlyProgress?.tier1Rate || 300)).toLocaleString()})
              </span>
            </div>
          </div>

          {/* 4-Card Summary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-2">
            
            {/* Card 1: Live Month Won */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block">
                MONTH WON TOTAL
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-slate-100 font-mono">
                  {monthlyProgress?.wonCount || 0}
                </span>
                <span className="text-[11px] text-slate-400 font-semibold">candidates</span>
              </div>
              <p className="text-[10px] text-slate-500 font-medium">
                {monthlyProgress?.isTargetAchieved
                  ? `Target reached! Earning full INR ${monthlyProgress?.tier1Rate} per candidate.`
                  : `${(monthlyProgress?.targetWonCount || 15) - (monthlyProgress?.wonCount || 0)} more to unlock INR ${monthlyProgress?.tier1Rate} tier.`}
              </p>
            </div>

            {/* Card 2: Active Rate Tier */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block">
                APPLICABLE RATE TIER
              </span>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-black font-mono ${
                  monthlyProgress?.isTargetAchieved ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  INR {monthlyProgress?.applicableRate || 150}
                </span>
                <span className="text-[11px] text-slate-400 font-semibold">/ candidate</span>
              </div>
              <p className="text-[10px] text-slate-500 font-medium">
                {monthlyProgress?.isTargetAchieved
                  ? `Achieved ≥ 15: Full INR ${monthlyProgress?.tier1Rate || 300} rate active`
                  : `< 15 won: Sub-target INR ${monthlyProgress?.tier2Rate || 150} rate active`}
              </p>
            </div>

            {/* Card 3: Projected Payout per Coord */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-1">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block">
                MONTH-END PAYOUT (EACH)
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-emerald-400 font-mono">
                  INR {monthlyProgress?.projectedPayoutPerCoord?.toLocaleString() || 0}
                </span>
                <span className="text-[11px] text-slate-400 font-semibold">CR</span>
              </div>
              <p className="text-[10px] text-slate-500 font-medium">
                Both Bishwo & Priya each receive this amount at month end.
              </p>
            </div>

            {/* Card 4: Beneficiaries */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 space-y-1.5 flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-mono block">
                  ELIGIBLE BENEFICIARIES
                </span>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-black">
                    <span>Bishwo</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-200">BDM</span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-black">
                    <span>Priya</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-blue-500/20 text-blue-200">Manager</span>
                  </div>
                </div>
              </div>
              
              {/* Toggle Won Candidates List */}
              {(monthlyProgress?.wonLeads?.length || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setShowWonLeadsDrawer(prev => !prev)}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold underline transition self-start cursor-pointer flex items-center gap-1"
                >
                  <span>{showWonLeadsDrawer ? 'Hide won candidates' : `View ${monthlyProgress?.wonLeads?.length} won candidates`}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showWonLeadsDrawer ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
          </div>

          {/* Won Candidates Collapsible Drawer */}
          {showWonLeadsDrawer && (monthlyProgress?.wonLeads?.length || 0) > 0 && (
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-300 uppercase tracking-wider">
                  Won Candidates in {monthlyProgress?.monthLabel} ({monthlyProgress?.wonLeads?.length})
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  Target milestone: {monthlyProgress?.targetWonCount} won
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                {monthlyProgress?.wonLeads.map((wl, idx) => (
                  <div key={wl.id} className="p-2 rounded-xl bg-slate-900 border border-slate-800/80 text-xs flex items-center justify-between">
                    <div className="space-y-0.5 truncate pr-2">
                      <p className="font-bold text-slate-200 truncate">{idx + 1}. {wl.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">{wl.phone} • {wl.assignedTo}</p>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono font-bold shrink-0">
                      Won
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* DATA VAULT & PERMANENT SAFE STORAGE HUB */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-750 rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0 shadow-inner">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black uppercase text-slate-100 tracking-wide flex items-center gap-1.5">
                  Incentive Data Vault & Safe Storage
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Active & Protected
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Immutable write-ahead audit ledger & rolling point-in-time snapshots active. Live coordinator incentive management enabled.
              </p>
            </div>
          </div>

          {currentUser?.role === 'admin' && (
            <div className="flex items-center gap-2 flex-wrap self-end md:self-auto shrink-0">
              <button
                type="button"
                onClick={() => {
                  fetchSnapshotsList();
                  setIsSnapshotsModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 font-black text-[11px] uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5"
                title="View point-in-time snapshots and audit history"
              >
                <Database className="w-3.5 h-3.5 text-indigo-400" />
                <span>Snapshots Vault</span>
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* LEFT COLUMN: WALLETS LIST (For Admin only) */}
          {currentUser?.role === 'admin' ? (
            <div className="bg-slate-900 border border-slate-750 rounded-3xl p-5.5 shadow-xl space-y-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    Coordinators Ledgers
                  </h3>
                  <button
                    type="button"
                    onClick={handleReconcileWallets}
                    disabled={reconcilingWallets}
                    className="px-2.5 py-1 text-[11px] font-black uppercase tracking-wider rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Recalculate, restore and synchronize all coordinator incentive balances from closed won & milestone placements"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${reconcilingWallets ? 'animate-spin' : ''}`} />
                    <span>{reconcilingWallets ? 'Restoring...' : 'Restore & Sync'}</span>
                  </button>
                </div>
                <div className="space-y-1.5 bg-slate-950/70 border border-slate-800 rounded-2xl p-3 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-semibold">Net Active Ledgers:</span>
                    <span className="font-mono font-black text-emerald-400">
                      INR {wallets.reduce((acc, w) => acc + (Number(w.balance) || 0), 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-850 text-[10px]">
                    <span className="text-slate-500">Gross Credits Accrued:</span>
                    <span className="font-mono font-bold text-emerald-400/90">
                      +INR {totalAgencyCredits.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-500">Total Debits / Deductions:</span>
                    <span className="font-mono font-bold text-rose-400/90">
                      -INR {totalAgencyDebits.toLocaleString()}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 font-semibold">
                  Select a staff member's wallet below to inspect their audit timeline, view debits/credits, or post adjustments.
                </p>
              </div>

              {walletLoading && wallets.length === 0 ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                </div>
              ) : wallets.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6 font-bold">No coordinator wallets found.</p>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {wallets.map((w) => {
                    const isActive = activeWalletUsername === w.username;
                    const debitsCount = (w.transactions || []).filter(t => t.type === 'debit').length;
                    return (
                      <button
                        key={w.username}
                        type="button"
                        onClick={() => {
                          setActiveWalletUsername(w.username);
                          setSelectedWallet(w);
                          setWalletError(null);
                          setWalletSuccess(null);
                        }}
                        className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          isActive
                            ? 'bg-emerald-500/10 border-emerald-500 text-slate-100 shadow-md'
                            : 'bg-slate-850/50 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-xs font-extrabold uppercase">{w.displayName || w.username}</p>
                            {(() => {
                              const badge = getCoordRoleBadge(w.username);
                              if (!badge) return null;
                              return (
                                <span className={`px-1.5 py-0.2 text-[9px] font-black uppercase tracking-wider rounded-md border ${badge.color}`}>
                                  {badge.label}
                                </span>
                              );
                            })()}
                            {debitsCount > 0 && (
                              <span className="px-1.5 py-0.2 text-[9px] font-black uppercase tracking-wider rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30" title={`${debitsCount} debit(s) on file`}>
                                {debitsCount} DR
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-mono text-slate-500">@{w.username}</p>
                        </div>
                        <span className={`text-xs font-black font-mono px-2.5 py-1 rounded-lg ${
                          isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-900 text-slate-300'
                        }`}>
                          INR {w.balance?.toLocaleString()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            // For coordinators, display a beautiful overview card
            <div className="bg-slate-900 border border-slate-750 rounded-3xl p-5.5 shadow-xl flex flex-col justify-between min-h-[220px]">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider rounded-full">
                  <WalletIcon className="w-3 h-3" /> My Personal Ledger
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-black text-slate-100 uppercase tracking-tight">
                    {currentUser?.displayName || currentUser?.username}
                  </h3>
                  {(() => {
                    const badge = getCoordRoleBadge(currentUser?.username || '');
                    if (!badge) return null;
                    return (
                      <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-md border ${badge.color}`}>
                        {badge.label}
                      </span>
                    );
                  })()}
                </div>
                <p className="text-xs text-slate-400 font-semibold leading-relaxed">
                  Welcome to your live earnings ledger. Every lead that you convert or coordinate automatically accrues incentives here.
                </p>
              </div>
              
              <div className="mt-6 pt-4 border-t border-slate-800 space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">Current Net Balance</span>
                  <span className="text-2xl font-extrabold text-emerald-400 font-mono">
                    INR {selectedWallet?.balance?.toLocaleString() || 0}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-850 text-[10px]">
                  <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block font-semibold">Total Earned (CR)</span>
                    <span className="text-emerald-400 font-mono font-bold">+INR {selectedWalletCredits.toLocaleString()}</span>
                  </div>
                  <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block font-semibold">Total Debited (DR)</span>
                    <span className="text-rose-400 font-mono font-bold">-INR {selectedWalletDebits.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MIDDLE/RIGHT COLUMN: CURRENT WALLET TIMELINE & ADJUSTMENT (Colspan 2) */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* CURRENT WALLET BALANCE OVERVIEW (Admin view gets a smaller version of balance card inside) */}
            {currentUser?.role === 'admin' && selectedWallet && (
              <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/20 border border-slate-750 rounded-3xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">SELECTED COORDINATOR</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-black text-slate-100 uppercase">
                      {selectedWallet.displayName || selectedWallet.username}
                    </h3>
                    {(() => {
                      const badge = getCoordRoleBadge(selectedWallet.username);
                      if (!badge) return null;
                      return (
                        <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-md border ${badge.color}`}>
                          {badge.label}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-xs font-mono text-slate-400">Username: @{selectedWallet.username}</p>
                </div>
                
                <div className="text-left sm:text-right space-y-1.5">
                  <div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">NET WALLET BALANCE</p>
                    <p className="text-3xl font-extrabold text-emerald-400 font-mono tracking-tight mt-0.5">
                      INR {selectedWallet.balance?.toLocaleString() || 0}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs justify-start sm:justify-end">
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-mono font-bold text-[11px] border border-emerald-500/20">
                      Credits: +INR {selectedWalletCredits.toLocaleString()}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-400 font-mono font-bold text-[11px] border border-rose-500/20">
                      Debits: -INR {selectedWalletDebits.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* TRANSACTIONS AUDIT TIMELINE */}
            <div className="bg-slate-900 border border-slate-750 rounded-3xl p-5.5 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-slate-200 uppercase tracking-wider flex items-center gap-2">
                    <Clock className="w-4 h-4 text-emerald-400" />
                    Transaction Audit History Timeline
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 font-semibold">
                    Comprehensive ledger of credits (CR), debits (DR), and payment withdrawals.
                  </p>
                </div>

                {/* Filter tabs: All, Credits Only, Debits Only */}
                {selectedWallet && selectedWallet.transactions && selectedWallet.transactions.length > 0 && (
                  <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] shrink-0">
                    <button
                      type="button"
                      onClick={() => setTxFilter('all')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                        txFilter === 'all'
                          ? 'bg-slate-800 text-slate-100 shadow-xs'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All ({selectedWallet.transactions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTxFilter('credit')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                        txFilter === 'credit'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'text-slate-400 hover:text-emerald-400'
                      }`}
                    >
                      <TrendingUp className="w-3 h-3 text-emerald-400" />
                      Credits ({selectedWallet.transactions.filter(t => t.type === 'credit').length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTxFilter('debit')}
                      className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer flex items-center gap-1 ${
                        txFilter === 'debit'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : 'text-slate-400 hover:text-rose-400'
                      }`}
                    >
                      <TrendingDown className="w-3 h-3 text-rose-400" />
                      Debits ({selectedWallet.transactions.filter(t => t.type === 'debit').length})
                    </button>
                  </div>
                )}
              </div>

              {walletLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                </div>
              ) : !selectedWallet || !selectedWallet.transactions || selectedWallet.transactions.length === 0 ? (
                <div className="text-center py-12 border border-slate-800 border-dashed rounded-2xl bg-slate-850/20">
                  <PiggyBank className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 font-bold">No transactions recorded for this coordinator.</p>
                </div>
              ) : filteredTransactions.length === 0 ? (
                <div className="text-center py-8 border border-slate-800 border-dashed rounded-2xl bg-slate-850/20">
                  <p className="text-xs text-slate-500 font-bold">No {txFilter} transactions found.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {filteredTransactions.map((t: WalletTransaction) => {
                    const isCredit = t.type === 'credit';
                    return (
                      <div 
                        key={t.id} 
                        className={`p-3.5 rounded-2xl border flex items-center justify-between gap-4 transition ${
                          isCredit
                            ? 'bg-slate-850 border-slate-800/80 hover:border-slate-700'
                            : 'bg-rose-950/20 border-rose-800/40 hover:border-rose-700 shadow-xs'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                            isCredit ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          }`}>
                            {isCredit ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                          </div>
                          <div className="text-left space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                                isCredit 
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                  : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              }`}>
                                {isCredit ? 'CREDIT (CR)' : 'DEBIT (DR)'}
                              </span>
                              <p className="text-xs font-bold text-slate-200 leading-snug">{t.reason}</p>
                            </div>
                            <p className="text-[10px] text-slate-500 font-mono">
                              {new Date(t.timestamp).toLocaleString()}
                              {t.leadId && ` • Lead ID: ${t.leadId.substring(0,8)}`}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-sm font-black font-mono shrink-0 whitespace-nowrap px-2.5 py-1 rounded-lg border ${
                            isCredit 
                              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' 
                              : 'text-rose-300 bg-rose-500/20 border-rose-500/40 shadow-xs'
                          }`}>
                            {isCredit ? '+' : '-'} INR {Number(t.amount || 0).toLocaleString()}
                          </span>
                          {currentUser?.role === 'admin' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteWalletTransaction(t.id);
                              }}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                              title="Delete / cancel this transaction record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ADMIN ADJUSTMENT PANEL (Only shown for Admin) */}
            {currentUser?.role === 'admin' && selectedWallet && (
              <form onSubmit={handleWalletAdjustment} className="bg-slate-900 border border-slate-750 rounded-3xl p-5.5 shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black text-slate-200 uppercase tracking-wider flex items-center gap-2">
                      <WalletIcon className="w-4 h-4 text-emerald-400" />
                      Post Manual Wallet Transaction (Debit/Credit Adjustment)
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1 font-semibold">
                      Withdraw money (Debit) or manually reward/correct coordinator balance. This adds a live, permanent timeline log.
                    </p>
                  </div>

                  {selectedWallet.balance > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setWalletType('debit');
                        setWalletAmount(String(selectedWallet.balance));
                        setWalletReason(`Coordinator Incentive Payout / Processed Withdrawal: Full Balance Settled`);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-extrabold text-[11px] transition cursor-pointer flex items-center gap-1.5 shrink-0"
                    >
                      <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                      <span>Settle Full Balance (-INR {selectedWallet.balance.toLocaleString()})</span>
                    </button>
                  )}
                </div>

                {walletError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 p-3 rounded-xl flex items-center gap-2 text-xs font-bold">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{walletError}</span>
                  </div>
                )}

                {walletSuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl flex items-center gap-2 text-xs font-bold">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{walletSuccess}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Action Type</label>
                    <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setWalletType('credit')}
                        className={`py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                          walletType === 'credit'
                            ? 'bg-emerald-500 text-zinc-950 font-black'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Credit (CR)
                      </button>
                      <button
                        type="button"
                        onClick={() => setWalletType('debit')}
                        className={`py-1.5 rounded-lg text-xs font-extrabold transition-all cursor-pointer ${
                          walletType === 'debit'
                            ? 'bg-rose-600 text-slate-100 font-black'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Withdraw (DR)
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Amount (INR)</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={walletAmount}
                      onChange={(e) => setWalletAmount(e.target.value)}
                      placeholder="e.g. 2000"
                      className="w-full text-xs px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Timeline Note / Reason</label>
                    <input
                      type="text"
                      required
                      value={walletReason}
                      onChange={(e) => setWalletReason(e.target.value)}
                      placeholder="e.g. INR 2000 Withdraw on 10th"
                      className="w-full text-xs px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-semibold uppercase placeholder-slate-600"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={walletSubmitting}
                    className={`px-5 py-2.5 rounded-xl font-bold text-xs select-none shadow-md cursor-pointer transition ${
                      walletType === 'credit'
                        ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-600'
                        : 'bg-rose-600 text-white hover:bg-rose-700'
                    }`}
                  >
                    {walletSubmitting ? 'Posting...' : `Post Manual ${walletType === 'credit' ? 'Credit' : 'Debit/Withdraw'}`}
                  </button>
                </div>
              </form>
            )}

          </div>

        </div>

      </div>
    )}

      {/* Custom Delete Confirmation Modal */}
      {deletingJobId && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            {/* Background overlay */}
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity" 
              onClick={() => setDeletingJobId(null)}
            />

            {/* Trick to center modal */}
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            {/* Modal panel */}
            <div className="relative z-10 inline-block align-middle bg-slate-850 rounded-3xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full border border-slate-750">
              <div className="p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-rose-950/40 text-rose-400 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-slate-100">Move Job Creative to Recovery Archive</h3>
                  <p className="text-sm text-slate-400">
                    This hides the demand card from active view while keeping its WebP image and Service Charge safely backed up in the Recovery Archive. You can restore it anytime.
                  </p>
                </div>
                <div className="pt-4 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setDeletingJobId(null)}
                    className="px-4 py-2 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDelete}
                    className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold rounded-xl transition shadow-md shadow-rose-600/10 cursor-pointer"
                  >
                    Move to Archive
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Recovery Archive Modal */}
      {isArchiveModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-left">
          <div className="bg-slate-900 rounded-3xl shadow-2xl border border-slate-750 w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400">
                  <Archive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-100 text-sm uppercase tracking-wider">
                    Active Jobs Recovery Archive
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    All archived job creatives are protected from accidental deletion and can be restored anytime.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsArchiveModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg cursor-pointer transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              {loadingArchived ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-3">
                  <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                  <p className="text-xs text-slate-400 font-bold">Loading archived job creatives...</p>
                </div>
              ) : archivedJobs.length === 0 ? (
                <div className="text-center py-12 border border-slate-800 border-dashed rounded-2xl bg-slate-950/40">
                  <ShieldCheck className="w-10 h-10 text-emerald-400/70 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-200">No archived job creatives</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Any removed demand creative will appear here safely for 1-click restoration.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {archivedJobs.map((job) => {
                    const chargeLabel =
                      job.serviceCharge ||
                      [
                        job.processingFeeMale ? `Male: ${job.processingFeeMale}` : '',
                        job.processingFeeFemale ? `Female: ${job.processingFeeFemale}` : ''
                      ]
                        .filter(Boolean)
                        .join(' • ') ||
                      job.title ||
                      'Untitled Job';

                    return (
                      <div
                        key={job.id}
                        className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3 flex items-center gap-3"
                      >
                        <div className="w-16 h-16 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                          {job.imageUrl ? (
                            <img
                              src={job.imageUrl}
                              alt={chargeLabel}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <ImageIcon className="w-6 h-6 text-slate-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-xs font-black text-slate-100 truncate">{chargeLabel}</p>
                          <p className="text-[10px] font-mono text-slate-500 truncate">
                            Archived: {job.deletedAt ? new Date(job.deletedAt).toLocaleString() : new Date(job.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={restoringJobId === job.id}
                          onClick={() => handleRestoreJob(job.id)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-black inline-flex items-center gap-1.5 transition cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          {restoringJobId === job.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" />
                          )}
                          Restore
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1.5 text-[11px]">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Backed up in Firestore + Local Rolling Snapshots
              </span>
              <button
                type="button"
                onClick={() => setIsArchiveModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Streamlined Add/Edit Job Creative Modal (Image + Service Charge Only) */}
      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          aria-labelledby="modal-title"
          role="dialog"
          aria-modal="true"
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                if (file) {
                  e.preventDefault();
                  handleCreativeImageFile(file);
                  break;
                }
              }
            }
          }}
        >
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-black/65 backdrop-blur-xs transition-opacity"
              onClick={() => !isUploadingCreative && !isSubmittingJob && setIsFormOpen(false)}
            />

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            <div className="relative z-10 inline-block align-middle bg-slate-900 rounded-3xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border border-slate-750">
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
                <div className="space-y-1">
                  <h3 id="modal-title" className="text-lg font-bold text-slate-100">
                    {editingJob ? 'Edit Active Job Creative' : 'Upload Active Job Creative'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Upload or paste the client demand image (auto-converted to WebP) and set the Service Charge.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !isUploadingCreative && !isSubmittingJob && setIsFormOpen(false)}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                {formError && (
                  <div className="bg-rose-950/40 border border-rose-900/30 text-rose-400 p-3.5 rounded-xl flex items-center gap-2 text-xs font-bold">
                    <AlertCircle className="w-4.5 h-4.5 flex-shrink-0 text-rose-500" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* 1. Creative Image Upload Zone */}
                <div className="space-y-2">
                  <label className="block text-xs font-black text-slate-300 uppercase tracking-wider">
                    Demand Creative Image *
                  </label>

                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingCreative(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDraggingCreative(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingCreative(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleCreativeImageFile(file);
                    }}
                    className={`block relative rounded-2xl border-2 border-dashed transition-all cursor-pointer overflow-hidden ${
                      isDraggingCreative
                        ? 'border-emerald-400 bg-emerald-500/10'
                        : 'border-slate-700 hover:border-emerald-500/60 bg-slate-950/70'
                    }`}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isUploadingCreative}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCreativeImageFile(file);
                        e.target.value = '';
                      }}
                    />

                    {isUploadingCreative ? (
                      <div className="py-12 px-4 flex flex-col items-center justify-center gap-3 text-center">
                        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                        <p className="text-xs font-bold text-slate-200">
                          Optimizing & converting creative to WebP...
                        </p>
                      </div>
                    ) : imageUrl ? (
                      <div className="p-3 space-y-3">
                        <div className="relative bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center max-h-64">
                          <img
                            src={imageUrl}
                            alt="Uploaded job creative"
                            className="max-h-60 w-auto object-contain rounded-lg"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
                          <div className="flex items-center gap-2 text-emerald-400 font-mono font-bold truncate">
                            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">
                              WebP Ready
                              {imageSizeBytes ? ` • ${formatBytes(imageSizeBytes)}` : ''}
                              {originalSizeBytes && imageSizeBytes && originalSizeBytes > imageSizeBytes
                                ? ` (-${Math.round((1 - imageSizeBytes / originalSizeBytes) * 100)}%)`
                                : ''}
                            </span>
                          </div>
                          <span className="text-slate-300 font-bold underline shrink-0">
                            Click or Drop to Replace
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-10 px-6 flex flex-col items-center justify-center text-center gap-2.5">
                        <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                          <Upload className="w-5 h-5" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-slate-200">
                            Click to upload, drag & drop, or press Ctrl+V to paste
                          </p>
                          <p className="text-xs text-slate-500">
                            JPG, PNG, or any image — automatically compressed into lightweight WebP
                          </p>
                        </div>
                      </div>
                    )}
                  </label>
                </div>

                {/* 2. Single Service Charge Heading Input */}
                <div className="space-y-1.5">
                  <label htmlFor="job-service-charge" className="block text-xs font-black text-slate-300 uppercase tracking-wider">
                    Service Charge *
                  </label>
                  <input
                    id="job-service-charge"
                    type="text"
                    required
                    value={serviceCharge}
                    onChange={(e) => setServiceCharge(e.target.value)}
                    placeholder="e.g. INR 85,000 / Free Recruitment / 95k Male, 65k Female"
                    className="w-full px-3.5 py-3 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-950 text-slate-100 font-bold"
                  />
                </div>

                {/* Publish Active Toggle */}
                {currentUser?.role === 'admin' && (
                  <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl flex items-center justify-between">
                    <div className="space-y-0.5 text-left">
                      <span className="block text-xs font-black text-slate-200 uppercase tracking-wide">Active & Visible</span>
                      <span className="block text-[11px] text-slate-400">Show this creative in Active Jobs for all coordinators.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsActive(!isActive)}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        isActive ? 'bg-emerald-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          isActive ? 'translate-x-4.5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}

                <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-800">
                  <button
                    type="button"
                    disabled={isUploadingCreative || isSubmittingJob}
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUploadingCreative || isSubmittingJob || !imageUrl}
                    className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-zinc-950 text-xs font-black rounded-xl transition shadow-md shadow-emerald-500/10 cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {isSubmittingJob && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{editingJob ? 'Save Changes' : 'Publish Active Job'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen Creative Lightbox Viewer */}
      {previewCreativeJob && (
        <div
          className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewCreativeJob(null)}
        >
          <div
            className="bg-slate-900 border border-slate-750 rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4 bg-slate-950/70">
              <div className="min-w-0">
                <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest block">
                  Service Charge
                </span>
                <h3 className="text-base sm:text-lg font-black text-slate-100 truncate">
                  {previewCreativeJob.serviceCharge || previewCreativeJob.title || 'Job Demand Creative'}
                </h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previewCreativeJob.imageUrl && (
                  <a
                    href={previewCreativeJob.imageUrl}
                    download={`job_creative_${previewCreativeJob.id}.webp`}
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-black text-xs inline-flex items-center gap-1.5 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download WebP</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewCreativeJob(null)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 bg-slate-950 flex-1 flex items-center justify-center overflow-auto">
              {previewCreativeJob.imageUrl && (
                <img
                  src={previewCreativeJob.imageUrl}
                  alt={previewCreativeJob.serviceCharge || 'Job creative'}
                  className="max-w-full max-h-[75vh] object-contain rounded-xl"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Update Delete Confirmation Modal */}
      {deletingUpdateId && (
        <div className="fixed inset-0 z-[60] overflow-y-auto" aria-labelledby="update-modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity" 
              onClick={() => setDeletingUpdateId(null)}
            />
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-10 inline-block align-middle bg-slate-850 rounded-3xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full border border-slate-750">
              <div className="p-6 text-center space-y-4">
                <div className="w-12 h-12 bg-rose-950/40 text-rose-400 rounded-full flex items-center justify-center mx-auto">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-slate-100">Delete Live Update</h3>
                  <p className="text-sm text-slate-400">
                    Are you sure you want to permanently delete this update from the scrolling updates bar?
                  </p>
                </div>
                <div className="pt-4 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setDeletingUpdateId(null)}
                    className="px-4 py-2 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDeleteUpdate}
                    className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold rounded-xl transition shadow-md shadow-rose-600/10 cursor-pointer"
                  >
                    Delete Update
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-over Update Form Modal */}
      {isUpdateFormOpen && (
        <div className="fixed inset-0 z-[60] overflow-y-auto" aria-labelledby="update-form-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity" 
              onClick={() => setIsUpdateFormOpen(false)}
            />
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-10 inline-block align-middle bg-slate-850 rounded-3xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border border-slate-750">
              <div className="p-6 border-b border-slate-750 flex items-center justify-between bg-slate-900/30">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-slate-100">
                    {editingUpdate ? 'Edit Live Update' : 'Add Live Update'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    This will appear in red color scrolling across the screen. Keep it short and important!
                  </p>
                </div>
                <button 
                  type="button"
                  onClick={() => setIsUpdateFormOpen(false)}
                  className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmitUpdate} className="p-6 space-y-4">
                {updateError && (
                  <div className="bg-rose-950/40 border border-rose-900/30 text-rose-400 p-3.5 rounded-xl flex items-center gap-2 text-xs font-bold">
                    <AlertCircle className="w-4.5 h-4.5 flex-shrink-0 text-rose-500" />
                    <span>{updateError}</span>
                  </div>
                )}
                
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">Update Message / Interview Link Details</label>
                  <textarea
                    rows={4}
                    required
                    value={updateText}
                    onChange={(e) => setUpdateText(e.target.value)}
                    placeholder="e.g. Today's interviews: Nesto Hypermarket screening starting at 3:00 PM. Zoom link: https://zoom.us/j/9876543210"
                    className="w-full px-3 py-2.5 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-900/50 text-slate-100 font-bold leading-relaxed"
                  />
                </div>

                <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-750">
                  <button
                    type="button"
                    onClick={() => setIsUpdateFormOpen(false)}
                    className="px-4 py-2 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 hover:bg-slate-800 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-red-600 hover:bg-red-700 active:scale-95 text-white text-xs font-bold rounded-xl transition shadow-md shadow-red-600/10 cursor-pointer"
                  >
                    {editingUpdate ? 'Save Changes' : 'Publish Update'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* SNAPSHOTS VAULT & POINT-IN-TIME RESTORE MODAL */}
      {isSnapshotsModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-750 rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden animate-scale-up">
            <div className="p-6 border-b border-slate-750 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
                  <Database className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-100 uppercase tracking-tight flex items-center gap-2">
                    Point-in-Time Data Vault & Snapshots
                  </h3>
                  <p className="text-xs text-slate-400">
                    Safe, immutable checkpoints. Rollback or restore any verified state instantly.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSnapshotsModalOpen(false)}
                className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* CREATE MANUAL SNAPSHOT FORM */}
              <form onSubmit={handleCreateSnapshot} className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    Create New Safe Checkpoint
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">Immutable Backup</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={newSnapshotReason}
                    onChange={(e) => setNewSnapshotReason(e.target.value)}
                    placeholder="e.g. Pre-settlement checkpoint for October payouts"
                    className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-750 text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold"
                  />
                  <button
                    type="submit"
                    disabled={creatingSnapshot || !newSnapshotReason.trim()}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-zinc-950 font-black text-xs rounded-xl transition cursor-pointer shrink-0"
                  >
                    {creatingSnapshot ? 'Saving...' : 'Capture Snapshot'}
                  </button>
                </div>
              </form>

              {/* SNAPSHOTS LIST */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-300">Available Historical Snapshots</span>
                  <button
                    type="button"
                    onClick={fetchSnapshotsList}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-bold cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingSnapshots ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                {loadingSnapshots && snapshotsList.length === 0 ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                  </div>
                ) : snapshotsList.length === 0 ? (
                  <div className="text-center py-8 border border-slate-800 border-dashed rounded-2xl bg-slate-950/30">
                    <Database className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-500 font-bold">No snapshots recorded yet.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {snapshotsList.map((s) => {
                      return (
                        <div
                          key={s.id}
                          className="p-4 rounded-2xl border transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-950/40 border-slate-800 hover:border-slate-700"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-black text-slate-100">{s.reason}</span>
                              <span className="px-1.5 py-0.2 rounded-md bg-slate-850 text-slate-400 text-[9px] font-mono">
                                {s.totalWallets} wallets
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
                              <span>Net: INR {Number(s.netBalance || 0).toLocaleString()}</span>
                              <span className="text-emerald-400/80">Cr: +{Number(s.totalCredits || 0).toLocaleString()}</span>
                              <span className="text-rose-400/80">Dr: -{Number(s.totalDebits || 0).toLocaleString()}</span>
                              <span className="text-slate-500">• {new Date(s.timestamp).toLocaleString()}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRestoreSnapshot(s.id, s.reason)}
                            className="px-3 py-1.5 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 text-xs font-black uppercase tracking-wider transition cursor-pointer self-end sm:self-auto shrink-0 flex items-center gap-1.5"
                          >
                            <History className="w-3.5 h-3.5" />
                            <span>Rollback Here</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-950/80 border-t border-slate-750 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center gap-1 text-[11px]">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>All rollbacks save a pre-rollback checkpoint automatically.</span>
              </span>
              <button
                type="button"
                onClick={() => setIsSnapshotsModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MONTHLY TARGET SETTINGS MODAL */}
      {isTargetEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 text-left">
          <div className="bg-slate-850 rounded-3xl shadow-2xl border border-slate-750 w-full max-w-lg p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-750 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-500/20 border border-indigo-500/30 rounded-xl text-indigo-400">
                  <Target className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-100 text-sm uppercase">Configure Monthly Target</h3>
                  <p className="text-[10px] font-mono text-slate-400">ADMIN CONTROL • COORD BISHWO & PRIYA</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTargetEditModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-100 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTargetSettings} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-300 block">
                  Monthly Won Target (Candidates)
                </label>
                <input
                  type="number"
                  min="1"
                  value={targetWonCountInput}
                  onChange={(e) => setTargetWonCountInput(Number(e.target.value) || 1)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-750 rounded-xl text-sm font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. 15"
                  required
                />
                <p className="text-[10px] text-slate-400">Default is 15 won per month.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300 block">
                    Target Met Rate (INR / candidate)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={tier1RateInput}
                    onChange={(e) => setTier1RateInput(Number(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-750 rounded-xl text-sm font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                    placeholder="e.g. 300"
                    required
                  />
                  <p className="text-[10px] text-slate-400">
                    Applied when won &gt;= target. (15 won * 300 = INR 4,500)
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-300 block">
                    Below Target Rate (INR / candidate)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={tier2RateInput}
                    onChange={(e) => setTier2RateInput(Number(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-750 rounded-xl text-sm font-mono text-slate-100 focus:outline-none focus:border-amber-500"
                    placeholder="e.g. 150"
                    required
                  />
                  <p className="text-[10px] text-slate-400">
                    Applied when won &lt; target. (14 won * 150 = INR 2,100)
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-300 space-y-1">
                <p className="font-bold text-slate-200">Rule Summary:</p>
                <p>• <strong>15 Won (Target):</strong> Bishwo & Priya get <strong>INR {(15 * tier1RateInput).toLocaleString()}</strong> each.</p>
                <p>• <strong>16 Won:</strong> Bishwo & Priya get <strong>INR {(16 * tier1RateInput).toLocaleString()}</strong> each (INR {tier1RateInput}/candidate).</p>
                <p>• <strong>14 Won:</strong> Bishwo & Priya get <strong>INR {(14 * tier2RateInput).toLocaleString()}</strong> each (INR {tier2RateInput}/candidate).</p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-750">
                <button
                  type="button"
                  onClick={() => setIsTargetEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTargetSettings}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingTargetSettings && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Settings</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
