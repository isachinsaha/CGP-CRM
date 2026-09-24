import React, { useState, useEffect } from 'react';
import { 
  Image, 
  Music, 
  Video as VideoIcon, 
  FileText, 
  Search, 
  Upload, 
  Trash2, 
  Copy, 
  Check, 
  ExternalLink, 
  RefreshCw,
  Sparkles,
  AlertCircle,
  AlertTriangle
} from 'lucide-react';
import { MediaItem } from '../types';

interface MediaLibraryProps {
  currentUser?: { username: string; displayName?: string } | null;
  onSelect?: (url: string, item?: MediaItem) => void;
  isModal?: boolean;
}

export default function MediaLibrary({ currentUser, onSelect, isModal = false }: MediaLibraryProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Tab and Search States
  const [activeTab, setActiveTab] = useState<'image' | 'audio' | 'video' | 'file'>('image');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Upload States
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  
  // Notification & Copy states
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const fetchMedia = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/media');
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
      } else {
        throw new Error(data.error || 'Failed to fetch media');
      }
    } catch (err: any) {
      console.error('Error fetching media:', err);
      setError(err.message || 'Failed to load media library');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, []);

  // Handle drag events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  // Convert file to base64
  const toBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // Upload file logic
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    
    // Determine type
    let itemType: 'image' | 'audio' | 'video' | 'file' = 'file';
    if (file.type.startsWith('image/')) itemType = 'image';
    else if (file.type.startsWith('audio/')) itemType = 'audio';
    else if (file.type.startsWith('video/')) itemType = 'video';

    setUploading(true);
    setUploadSuccess(false);
    setError(null);

    try {
      // 1. Convert to base64
      const base64 = await toBase64(file);

      // 2. Upload to temporary server uploads
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          base64Data: base64
        })
      });
      const uploadData = await uploadRes.json();
      
      if (!uploadRes.ok || !uploadData.success) {
        throw new Error(uploadData.error || 'Server rejected file upload');
      }

      // 3. Register inside shared media list
      const mediaRes = await fetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          url: uploadData.url,
          type: itemType,
          size: file.size,
          uploadedBy: currentUser?.username || 'Coordinator'
        })
      });
      const mediaData = await mediaRes.json();

      if (!mediaRes.ok || !mediaData.success) {
        throw new Error(mediaData.error || 'Failed to save media record');
      }

      // 4. Refresh items list & show success
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 3000);
      
      // Auto switch tab to the uploaded file type
      setActiveTab(itemType);
      
      await fetchMedia();
    } catch (err: any) {
      console.error('Upload failed:', err);
      setError(err.message || 'Failed to upload creative file');
    } finally {
      setUploading(false);
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await handleFileUpload(e.target.files[0]);
    }
  };

  // Delete media item
  const handleDelete = async (itemId: string) => {
    if (!window.confirm('Are you sure you want to delete this creative? It will be removed for all coordinators.')) {
      return;
    }

    try {
      setError(null);
      const res = await fetch(`/api/media/${itemId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setItems(prev => prev.filter(item => item.id !== itemId));
        if (previewItem?.id === itemId) setPreviewItem(null);
      } else {
        throw new Error(data.error || 'Failed to delete');
      }
    } catch (err: any) {
      console.error('Deletion error:', err);
      setError(err.message || 'Failed to delete creative item');
    }
  };

  // Copy URL to Clipboard
  const handleCopy = (item: MediaItem, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Resolve absolute URL
    const fullUrl = item.url.startsWith('http') 
      ? item.url 
      : `${window.location.origin}${item.url}`;

    navigator.clipboard.writeText(fullUrl);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Group counts
  const imageCount = items.filter(i => i.type === 'image').length;
  const audioCount = items.filter(i => i.type === 'audio').length;
  const videoCount = items.filter(i => i.type === 'video').length;
  const fileCount = items.filter(i => i.type === 'file').length;

  // Filter items based on activeTab and searchQuery
  const filteredItems = items.filter(item => {
    const matchesTab = item.type === activeTab;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (item.uploadedBy || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = 1;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  return (
    <div className={`flex flex-col flex-1 bg-slate-50 dark:bg-[#0c1317] min-h-0 text-slate-800 dark:text-[#e9edef] ${isModal ? '' : 'p-4 sm:p-6'}`}>
      
      {/* 1. Dashboard Info Eyebrow */}
      {!isModal && (
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-[#00a884]" /> Creative Media Library
            </h1>
            <p className="text-slate-500 dark:text-[#8696a0] text-sm mt-1">
              Upload job vacancy flyers, hiring creatives, and voice notes. Shared instantly across all coordinators and admins.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start md:self-center">
            <span className="text-xs bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-full font-semibold">
              📦 Total: {items.length} files
            </span>
          </div>
        </div>
      )}

      {/* 2. Top Controls Panel */}
      <div className="bg-white dark:bg-[#111b21] rounded-2xl shadow-sm dark:shadow-none border border-slate-200/60 dark:border-slate-800/80 p-4 mb-6 flex flex-col gap-4">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400 dark:text-[#8696a0]" />
            <input 
              type="text"
              placeholder="Search by name, uploaded by..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-[#202c33] border border-slate-200 dark:border-transparent focus:outline-none focus:ring-2 focus:ring-[#00a884] dark:focus:ring-[#00a884] text-sm text-slate-900 dark:text-white"
            />
          </div>

          {/* Standard Input File trigger */}
          <div>
            <label className="flex items-center gap-2 bg-[#00a884] hover:bg-[#008f72] text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-xs cursor-pointer transition-all hover:shadow-md active:scale-95">
              <Upload className="h-4 w-4" />
              <span>Upload New Creative</span>
              <input 
                type="file" 
                onChange={handleFileChange} 
                className="hidden" 
                accept="image/*,audio/*,video/*,application/*"
              />
            </label>
          </div>
        </div>

        {/* Drag & Drop Zone */}
        <div 
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-5 text-center transition-all ${
            dragActive 
              ? 'border-[#00a884] bg-[#00a884]/5 dark:bg-[#00a884]/10 scale-[0.99]' 
              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-[#202c33]/25'
          }`}
        >
          <p className="text-sm text-slate-500 dark:text-[#8696a0] flex items-center justify-center gap-2">
            {uploading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-[#00a884]" />
                <span className="font-medium text-[#00a884]">Uploading file... Please wait...</span>
              </>
            ) : dragActive ? (
              <span className="font-semibold text-[#00a884]">Drop file now to upload!</span>
            ) : (
              <span>Drag & drop any creative file here, or click upload button above</span>
            )}
          </p>
        </div>

        {/* Alerts / Feedback */}
        {error && (
          <div className="flex items-center gap-2.5 text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 px-4 py-3 rounded-xl border border-rose-100 dark:border-transparent text-sm">
            <AlertCircle className="h-4.5 w-4.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {uploadSuccess && (
          <div className="flex items-center gap-2.5 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 rounded-xl border border-emerald-100 dark:border-transparent text-sm">
            <Check className="h-4.5 w-4.5 shrink-0" />
            <span className="font-semibold">Creative uploaded and synced successfully! Access granted to all coordinators.</span>
          </div>
        )}
      </div>

      {/* 3. Category Tabs (AiSensy Style) */}
      <div className="flex border-b border-slate-200 dark:border-slate-800/80 mb-6 overflow-x-auto gap-2">
        <button 
          onClick={() => setActiveTab('image')}
          className={`flex items-center gap-2 px-5 py-3.5 border-b-2 font-bold text-sm tracking-wide transition-all whitespace-nowrap ${
            activeTab === 'image' 
              ? 'border-[#00a884] text-[#00a884]' 
              : 'border-transparent text-slate-500 dark:text-[#8696a0] hover:text-slate-800 dark:hover:text-white'
          }`}
        >
          <Image className="h-4.5 w-4.5" />
          <span>Image ({imageCount})</span>
        </button>
        <button 
          onClick={() => setActiveTab('audio')}
          className={`flex items-center gap-2 px-5 py-3.5 border-b-2 font-bold text-sm tracking-wide transition-all whitespace-nowrap ${
            activeTab === 'audio' 
              ? 'border-[#00a884] text-[#00a884]' 
              : 'border-transparent text-slate-500 dark:text-[#8696a0] hover:text-slate-800 dark:hover:text-white'
          }`}
        >
          <Music className="h-4.5 w-4.5" />
          <span>Audio ({audioCount})</span>
        </button>
        <button 
          onClick={() => setActiveTab('video')}
          className={`flex items-center gap-2 px-5 py-3.5 border-b-2 font-bold text-sm tracking-wide transition-all whitespace-nowrap ${
            activeTab === 'video' 
              ? 'border-[#00a884] text-[#00a884]' 
              : 'border-transparent text-slate-500 dark:text-[#8696a0] hover:text-slate-800 dark:hover:text-white'
          }`}
        >
          <VideoIcon className="h-4.5 w-4.5" />
          <span>Video ({videoCount})</span>
        </button>
        <button 
          onClick={() => setActiveTab('file')}
          className={`flex items-center gap-2 px-5 py-3.5 border-b-2 font-bold text-sm tracking-wide transition-all whitespace-nowrap ${
            activeTab === 'file' 
              ? 'border-[#00a884] text-[#00a884]' 
              : 'border-transparent text-slate-500 dark:text-[#8696a0] hover:text-slate-800 dark:hover:text-white'
          }`}
        >
          <FileText className="h-4.5 w-4.5" />
          <span>Document ({fileCount})</span>
        </button>
      </div>

      {/* 4. Creative Files Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-[#8696a0] gap-3">
            <RefreshCw className="h-8 w-8 animate-spin text-[#00a884]" />
            <p className="text-sm">Fetching shared creative assets...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-[#111b21] rounded-2xl border border-slate-200/60 dark:border-slate-800/80 p-8">
            <div className="h-12 w-12 rounded-full bg-slate-50 dark:bg-[#202c33] flex items-center justify-center mx-auto mb-4">
              <Image className="h-6 w-6 text-slate-400 dark:text-[#8696a0]" />
            </div>
            <h3 className="text-base font-bold text-slate-800 dark:text-white">No creatives found</h3>
            <p className="text-slate-500 dark:text-[#8696a0] text-sm mt-1 max-w-sm mx-auto">
              There are no assets in the "{activeTab}" tab. Drag and drop a flyer or voice note to add it!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredItems.map(item => {
              return (
                <div 
                  key={item.id}
                  onClick={() => onSelect ? onSelect(item.url, item) : setPreviewItem(item)}
                  className={`group relative flex flex-col bg-white dark:bg-[#111b21] rounded-xl overflow-hidden border border-slate-200/60 dark:border-slate-800/80 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md cursor-pointer ${
                    onSelect ? 'hover:ring-2 hover:ring-[#00a884]' : ''
                  }`}
                >
                  
                  {/* Thumbnail Container */}
                  <div className="relative aspect-square bg-slate-50 dark:bg-[#202c33] flex items-center justify-center overflow-hidden border-b border-slate-100 dark:border-slate-800/50">
                    {item.type === 'image' && !imageErrors[item.id] ? (
                      <img 
                        src={item.url} 
                        alt={item.name} 
                        referrerPolicy="no-referrer"
                        onError={() => {
                          setImageErrors(prev => ({ ...prev, [item.id]: true }));
                        }}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    ) : item.type === 'image' ? (
                      <div className="flex flex-col items-center justify-center p-4 text-center h-full w-full bg-slate-100 dark:bg-[#202c33] select-none">
                        <AlertTriangle className="h-8 w-8 text-amber-500 animate-pulse mb-1" />
                        <span className="text-[10px] font-black text-rose-500 uppercase tracking-wider leading-tight">File Missing on Server</span>
                        <span className="text-[9px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">Please delete and re-upload</span>
                      </div>
                    ) : item.type === 'audio' ? (
                      <Music className="h-12 w-12 text-[#00a884]" />
                    ) : item.type === 'video' ? (
                      <VideoIcon className="h-12 w-12 text-[#00a884]" />
                    ) : (
                      <FileText className="h-12 w-12 text-blue-500" />
                    )}

                    {/* Image Hover Quick Actions Overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button 
                        onClick={(e) => handleCopy(item, e)}
                        className="p-1.5 rounded-lg bg-white/90 text-slate-800 hover:bg-white transition-all shadow-sm"
                        title="Copy direct link"
                      >
                        {copiedId === item.id ? (
                          <Check className="h-4 w-4 text-emerald-600 font-bold" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                      
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.id);
                        }}
                        className="p-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all shadow-sm"
                        title="Delete creative"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Metadata Info Panel */}
                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-800 dark:text-[#e9edef] line-clamp-2 leading-snug break-all" title={item.name}>
                        {item.name}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-[#8696a0] mt-1 truncate">
                        👤 {item.uploadedBy || 'Coordinator'}
                      </p>
                    </div>
                    
                    <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/40 flex items-center justify-between text-[10px] text-slate-400 dark:text-[#8696a0]">
                      <span>{formatBytes(item.size)}</span>
                      <span>
                        {new Date(item.uploadedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric'
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Interactive onSelect prompt */}
                  {onSelect && (
                    <div className="bg-[#00a884]/10 dark:bg-[#00a884]/25 text-[#00a884] py-1 text-center font-bold text-[10px] tracking-wider uppercase border-t border-[#00a884]/20 group-hover:bg-[#00a884] group-hover:text-white transition-colors">
                      Click to Select
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Fullscreen Creative Zoom Lightbox Preview */}
      {previewItem && (
        <div 
          className="fixed inset-0 bg-black/85 z-[999] flex items-center justify-center p-4"
          onClick={() => setPreviewItem(null)}
        >
          <div 
            className="bg-white dark:bg-[#111b21] rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Lightbox Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white line-clamp-1">{previewItem.name}</h3>
                <p className="text-xs text-slate-500 dark:text-[#8696a0] mt-0.5">
                  Uploaded by {previewItem.uploadedBy} on {new Date(previewItem.uploadedAt).toLocaleString()}
                </p>
              </div>
              <button 
                onClick={() => setPreviewItem(null)}
                className="text-slate-400 dark:text-[#8696a0] hover:text-slate-600 dark:hover:text-white font-black text-xl px-2 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Lightbox Body View */}
            <div className="flex-1 bg-slate-50 dark:bg-[#0c1317] p-6 flex items-center justify-center overflow-auto max-h-[60vh]">
              {previewItem.type === 'image' && !imageErrors[previewItem.id] ? (
                <img 
                  src={previewItem.url} 
                  alt={previewItem.name}
                  referrerPolicy="no-referrer"
                  onError={() => {
                    setImageErrors(prev => ({ ...prev, [previewItem.id]: true }));
                  }}
                  className="max-h-full max-w-full object-contain rounded-lg"
                />
              ) : previewItem.type === 'image' ? (
                <div className="text-center p-8 bg-white dark:bg-[#111b21] rounded-xl shadow-xs border border-slate-200/60 dark:border-slate-800/80 w-full max-w-md">
                  <AlertTriangle className="h-16 w-16 text-amber-500 mx-auto mb-4 animate-pulse" />
                  <p className="font-extrabold text-sm text-rose-500 uppercase tracking-wider mb-2">Creative File Missing</p>
                  <p className="text-xs text-slate-500 dark:text-[#8696a0] leading-relaxed mb-4">
                    The physical file could not be found or fetched from the server. This can occur for files uploaded before the latest redundant multipart cloud backup upgrade.
                  </p>
                  <p className="text-xs text-emerald-500 font-bold">
                    To fix this, please close this dialog, click the trash icon on the thumbnail to delete it, and upload the flyer again!
                  </p>
                </div>
              ) : previewItem.type === 'audio' ? (
                <div className="text-center p-8 bg-white dark:bg-[#111b21] rounded-xl shadow-xs border border-slate-200/60 dark:border-slate-800/80 w-full max-w-md">
                  <Music className="h-16 w-16 text-[#00a884] mx-auto mb-4" />
                  <audio src={previewItem.url} controls className="w-full" />
                </div>
              ) : previewItem.type === 'video' ? (
                <video src={previewItem.url} controls className="max-h-full max-w-full rounded-lg" />
              ) : (
                <div className="text-center p-8 bg-white dark:bg-[#111b21] rounded-xl shadow-xs border border-slate-200/60 dark:border-slate-800/80 w-full max-w-md">
                  <FileText className="h-16 w-16 text-blue-500 mx-auto mb-4" />
                  <p className="font-semibold mb-4 text-slate-800 dark:text-[#e9edef]">{previewItem.name}</p>
                  <a 
                    href={previewItem.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#00a884] hover:bg-[#008f72] text-white font-bold px-4 py-2 rounded-xl text-sm"
                  >
                    Open Document <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              )}
            </div>

            {/* Lightbox Footer Actions */}
            <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800/80 flex justify-between gap-3 bg-slate-50/50 dark:bg-[#202c33]/25">
              <button 
                onClick={() => handleDelete(previewItem.id)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-rose-200 dark:border-transparent text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 font-semibold text-sm transition-all"
              >
                <Trash2 className="h-4 w-4" />
                Delete Creative
              </button>

              <div className="flex gap-2">
                <button 
                  onClick={(e) => handleCopy(previewItem, e)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-[#e9edef] font-semibold text-sm transition-all"
                >
                  {copiedId === previewItem.id ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-600" />
                      Copied Link!
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy Direct URL
                    </>
                  )}
                </button>

                {onSelect ? (
                  <button 
                    onClick={() => {
                      onSelect(previewItem.url, previewItem);
                      setPreviewItem(null);
                    }}
                    className="flex items-center gap-2 bg-[#00a884] hover:bg-[#008f72] text-white font-bold px-4 py-2.5 rounded-xl text-sm"
                  >
                    Use Creative
                  </button>
                ) : (
                  <button 
                    onClick={() => setPreviewItem(null)}
                    className="flex items-center gap-2 bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-bold px-5 py-2.5 rounded-xl text-sm"
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
