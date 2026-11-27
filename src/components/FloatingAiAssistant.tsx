import React, { useState, useEffect, useRef } from 'react';
import { GripVertical } from 'lucide-react';

interface FloatingAiAssistantProps {
  onOpen: () => void;
}

interface FloatingPosition {
  left: number;
  top: number;
}

const STORAGE_KEY = 'cgp_ai_assistant_pos_v1';
const VIEWPORT_MARGIN = 12;

function clampPosition(left: number, top: number, width: number, height: number): FloatingPosition {
  if (typeof window === 'undefined') return { left, top };
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return {
    left: Math.min(Math.max(VIEWPORT_MARGIN, left), maxLeft),
    top: Math.min(Math.max(VIEWPORT_MARGIN, top), maxTop)
  };
}

export const FloatingAiAssistant: React.FC<FloatingAiAssistantProps> = ({ onOpen }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    moved: boolean;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    originLeft: 0,
    originTop: 0,
    moved: false
  });

  const [position, setPosition] = useState<FloatingPosition | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.left === 'number' && typeof parsed?.top === 'number') {
          return clampPosition(parsed.left, parsed.top, 84, 92);
        }
      }
    } catch {
      // Ignore malformed stored coordinates
    }
    return null;
  });

  const [isDragging, setIsDragging] = useState(false);

  // Keep button inside visible viewport when window resizes
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        if (!prev) return null;
        const rect = containerRef.current?.getBoundingClientRect();
        const width = rect?.width || 84;
        const height = rect?.height || 92;
        const clamped = clampPosition(prev.left, prev.top, width, height);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped));
        } catch {
          // Ignore storage quota errors
        }
        return clamped;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false
    };

    el.setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (state.pointerId !== e.pointerId) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) > 5) {
      state.moved = true;
    }

    if (state.moved) {
      const rect = containerRef.current?.getBoundingClientRect();
      const width = rect?.width || 84;
      const height = rect?.height || 92;
      setPosition(clampPosition(state.originLeft + dx, state.originTop + dy, width, height));
    }
  };

  const finishPointerDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (state.pointerId !== e.pointerId) return;

    const el = containerRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }

    const wasMoved = state.moved;
    state.pointerId = null;
    state.moved = false;
    setIsDragging(false);

    if (wasMoved) {
      setPosition((current) => {
        if (current) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
          } catch {
            // Ignore storage errors
          }
        }
        return current;
      });
    } else {
      onOpen();
    }
  };

  const positionStyle: React.CSSProperties = position
    ? { left: `${position.left}px`, top: `${position.top}px` }
    : { right: '20px', bottom: '24px' };

  return (
    <div
      ref={containerRef}
      style={positionStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      title="Open AI Assistant (Drag anywhere to reposition)"
      role="button"
      tabIndex={0}
      aria-label="Open AI Assistant"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`fixed z-40 flex flex-col items-center gap-1 touch-none select-none group ${
        isDragging ? 'cursor-grabbing scale-105' : 'cursor-grab hover:scale-105'
      } transition-transform duration-150`}
    >
      {/* Drag indicator handle on hover */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-slate-900/90 border border-slate-700 text-[9px] font-semibold text-slate-300 shadow">
        <GripVertical className="w-2.5 h-2.5 text-cyan-400" />
        <span>Move</span>
      </div>

      {/* Round AI Robot Avatar Button */}
      <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full p-0.5 bg-gradient-to-br from-cyan-400 via-indigo-500 to-emerald-400 shadow-[0_8px_28px_rgba(34,211,238,0.35)] group-hover:shadow-[0_10px_34px_rgba(99,102,241,0.55)] transition-shadow">
        <div className="w-full h-full rounded-full bg-white overflow-hidden flex items-center justify-center">
          <img
            src="/assets/aistudio/image_484c5e18.png"
            alt="AI Assistant"
            draggable={false}
            className="w-full h-full rounded-full object-cover scale-110 pointer-events-none select-none"
          />
        </div>

        {/* Live active status dot */}
        <span className="absolute top-0 right-0 flex h-3.5 w-3.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-slate-950"></span>
        </span>
      </div>

      {/* Compact AI Assistant label */}
      <span className="px-2 py-0.5 rounded-full bg-slate-900/95 border border-cyan-500/40 text-[9px] font-extrabold tracking-wider uppercase text-cyan-200 shadow-md whitespace-nowrap">
        AI Assistant
      </span>
    </div>
  );
};
