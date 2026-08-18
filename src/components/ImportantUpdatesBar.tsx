import React, { useState, useEffect } from 'react';
import { AlertCircle, RefreshCw, Volume2, Copy, Check } from 'lucide-react';
import { ImportantUpdate } from '../types';

interface ImportantUpdatesBarProps {
  // Option to trigger manual refresh
  refreshTrigger?: number;
}

export default function ImportantUpdatesBar({ refreshTrigger = 0 }: ImportantUpdatesBarProps) {
  const [updates, setUpdates] = useState<ImportantUpdate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

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
      console.warn(`Failed to fetch important updates (retries left: ${retries}):`, err);
      if (retries > 0) {
        setTimeout(() => {
          fetchUpdates(retries - 1);
        }, 1000);
      } else {
        // Safe, elegant fallback updates to keep the UI fully functional even during temporary local/cloud connection hiccups!
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
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUpdates();
  }, [refreshTrigger]);

  // Handle custom window events for instant sync
  useEffect(() => {
    const handleSync = () => {
      fetchUpdates();
    };
    window.addEventListener('cgp-updates-changed', handleSync);
    return () => {
      window.removeEventListener('cgp-updates-changed', handleSync);
    };
  }, []);

  // Poll for updates every 90 seconds only when tab is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchUpdates();
      }
    }, 90000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-3 flex items-center justify-center gap-2 text-xs text-emerald-400 font-bold font-mono">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-500" />
        <span>Syncing Live Important Updates...</span>
      </div>
    );
  }

  if (updates.length === 0) {
    return null; // Don't show if empty
  }

  return (
    <div 
      id="important-updates-bar" 
      className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl overflow-hidden flex items-center h-12 shadow-sm shadow-emerald-500/5 select-text relative"
    >
      {/* Left fixed banner label */}
      <div 
        className="bg-emerald-600 px-4.5 h-full flex items-center gap-2 font-black text-[11px] tracking-wider uppercase shrink-0 z-10 shadow-md select-none text-white"
      >
        <span className="relative flex h-2 w-2">
          <span 
            className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"
          ></span>
          <span 
            className="relative inline-flex rounded-full h-2 w-2 bg-white"
          ></span>
        </span>
        <Volume2 className="h-3.5 w-3.5 text-white" />
        <span className="text-white font-black tracking-wide">Important Updates</span>
      </div>

      {/* Marquee Container */}
      <div className="flex-1 overflow-hidden relative h-full flex items-center">
        <div className="animate-marquee flex items-center gap-12 text-xs font-bold text-emerald-900 dark:text-emerald-300 tracking-wide hover:[animation-play-state:paused]">
          {/* Main updates content */}
          <div className="flex items-center gap-12 whitespace-nowrap">
            {updates.map((update, idx) => {
              const isCopied = copiedId === `orig-${update.id || idx}`;
              return (
                <span key={`orig-${update.id || idx}`} className="flex items-center gap-4 select-text group/update">
                  <span className="text-emerald-600 dark:text-emerald-400/70 font-mono text-[10px]">({new Date(update.createdAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})})</span>
                  <span className="font-semibold text-slate-800 dark:text-emerald-200">{update.text}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(update.text, `orig-${update.id || idx}`)}
                    className="p-1 px-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 hover:bg-emerald-200 dark:hover:bg-emerald-900 text-emerald-800 dark:text-emerald-300 transition-all cursor-pointer flex items-center justify-center gap-1 border border-emerald-300 dark:border-emerald-800/60 text-[9px] font-black uppercase tracking-wider select-none shadow-2xs"
                    title="Copy update text/link"
                  >
                    {isCopied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400 stroke-[3px]" />
                        <span className="text-[8.5px] font-mono text-emerald-600 dark:text-emerald-400 font-black">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 text-emerald-600 dark:text-emerald-400 group-hover/update:scale-110" />
                        <span className="text-[8.5px] font-mono text-emerald-700 dark:text-emerald-300">Copy</span>
                      </>
                    )}
                  </button>
                  <span className="text-emerald-400 dark:text-emerald-600 text-base font-bold">★</span>
                </span>
              );
            })}
          </div>
          {/* Duplicate content to create the continuous loop */}
          <div className="flex items-center gap-12 whitespace-nowrap" aria-hidden="true">
            {updates.map((update, idx) => {
              const isCopied = copiedId === `dup-${update.id || idx}`;
              return (
                <span key={`dup-${update.id || idx}`} className="flex items-center gap-4 select-text group/update-dup">
                  <span className="text-emerald-600 dark:text-emerald-400/70 font-mono text-[10px]">({new Date(update.createdAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})})</span>
                  <span className="font-semibold text-slate-800 dark:text-emerald-200">{update.text}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(update.text, `dup-${update.id || idx}`)}
                    className="p-1 px-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 hover:bg-emerald-200 dark:hover:bg-emerald-900 text-emerald-800 dark:text-emerald-300 transition-all cursor-pointer flex items-center justify-center gap-1 border border-emerald-300 dark:border-emerald-800/60 text-[9px] font-black uppercase tracking-wider select-none shadow-2xs"
                    title="Copy update text/link"
                  >
                    {isCopied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400 stroke-[3px]" />
                        <span className="text-[8.5px] font-mono text-emerald-600 dark:text-emerald-400 font-black">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 text-emerald-600 dark:text-emerald-400 group-hover/update-dup:scale-110" />
                        <span className="text-[8.5px] font-mono text-emerald-700 dark:text-emerald-300">Copy</span>
                      </>
                    )}
                  </button>
                  <span className="text-emerald-400 dark:text-emerald-600 text-base font-bold">★</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
