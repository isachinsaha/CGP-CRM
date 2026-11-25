import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X, CheckSquare, Square } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface MultiSearchableSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  allLabel?: string;
  className?: string;
  dropdownClassName?: string;
  badgeColor?: string;
  activeTextClass?: string;
  activeBorderClass?: string;
  align?: 'left' | 'right';
}

export function MultiSearchableSelect({
  values,
  onChange,
  options,
  placeholder = 'Select...',
  allLabel = 'All',
  className = '',
  dropdownClassName = '',
  badgeColor = 'bg-indigo-600',
  activeTextClass = 'text-indigo-300',
  activeBorderClass = 'border-indigo-500/80 ring-1 ring-indigo-500/30',
  align = 'left'
}: MultiSearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Reset search term when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
    } else {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // All option (if provided) and real options list (excluding 'All')
  const allOption = useMemo(() => {
    return (options || []).find(opt => opt && opt.value === 'All');
  }, [options]);

  const realOptions = useMemo(() => {
    return (options || []).filter(opt => opt && opt.value !== 'All');
  }, [options]);

  const term = (searchTerm || '').toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!term) return realOptions;
    return realOptions.filter(opt => {
      const l = String(opt.label || '').toLowerCase();
      const v = String(opt.value || '').toLowerCase();
      return l.includes(term) || v.includes(term);
    });
  }, [realOptions, term]);

  const isAllSelected = values.length === 0;

  const handleToggle = (val: string) => {
    if (val === 'All') {
      onChange([]);
      return;
    }
    if (values.includes(val)) {
      onChange(values.filter(v => v !== val));
    } else {
      onChange([...values, val]);
    }
  };

  const handleSelectAllFiltered = () => {
    const allFilteredVals = filteredOptions.map(o => o.value);
    const combined = Array.from(new Set([...values, ...allFilteredVals]));
    onChange(combined);
  };

  const handleClearAll = () => {
    onChange([]);
  };

  // Label text & icon on the button
  const selectedSingleOption = useMemo(() => {
    if (values.length === 1) {
      return realOptions.find(o => o.value === values[0]);
    }
    return undefined;
  }, [values, realOptions]);

  const buttonLabel = useMemo(() => {
    if (isAllSelected) {
      return allOption?.label || allLabel;
    }
    if (values.length === 1) {
      return selectedSingleOption ? selectedSingleOption.label : values[0];
    }
    return `${values.length} Selected`;
  }, [isAllSelected, values, selectedSingleOption, allOption, allLabel]);

  const triggerTooltip = useMemo(() => {
    if (isAllSelected) return allOption?.label || allLabel;
    const labels = values.map(v => realOptions.find(o => o.value === v)?.label || v);
    return labels.join(', ');
  }, [isAllSelected, values, realOptions, allOption, allLabel]);

  const isFullWidth = className.includes('w-full');

  return (
    <div className={`relative text-left ${isFullWidth ? 'w-full block' : 'inline-block'}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={triggerTooltip}
        className={`flex items-center justify-between gap-1.5 min-w-0 ${className} ${!isAllSelected ? activeBorderClass : ''}`}
      >
        <span className="flex items-center gap-1.5 min-w-0 truncate">
          {!isAllSelected && (
            <span className={`h-4 min-w-[16px] px-1 rounded-full ${badgeColor} text-[9px] font-black text-white flex items-center justify-center shrink-0`}>
              {values.length}
            </span>
          )}
          {isAllSelected && allOption?.icon && (
            <span className="shrink-0 flex items-center">{allOption.icon}</span>
          )}
          {!isAllSelected && values.length === 1 && selectedSingleOption?.icon && (
            <span className="shrink-0 flex items-center">{selectedSingleOption.icon}</span>
          )}
          <span className={`truncate text-left font-extrabold ${!isAllSelected ? activeTextClass : ''}`}>
            {buttonLabel}
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70 shrink-0 ml-1" />
      </button>

      {isOpen && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} mt-1 w-72 rounded-xl border border-slate-700/80 bg-slate-900 p-2.5 shadow-2xl z-50 focus:outline-none ${dropdownClassName}`}
        >
          {/* Search Input */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-indigo-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 py-1.5 pl-8 pr-7 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Quick Action Toolbar */}
          <div className="flex items-center justify-between pb-2 mb-1.5 border-b border-slate-800 text-[10px] font-mono px-1">
            <span className="text-slate-400 font-bold">
              {values.length === 0 ? 'All included' : `${values.length} of ${realOptions.length} active`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="text-indigo-400 hover:text-indigo-300 font-extrabold hover:underline cursor-pointer"
              >
                Select All
              </button>
              <span className="text-slate-600">•</span>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-rose-400 hover:text-rose-300 font-extrabold hover:underline cursor-pointer"
              >
                Reset (All)
              </button>
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-56 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {/* 'All' default option */}
            <button
              type="button"
              onClick={() => handleToggle('All')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold transition text-left cursor-pointer ${
                isAllSelected 
                  ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-500/30' 
                  : 'text-slate-300 hover:bg-slate-800/60'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                {isAllSelected ? (
                  <CheckSquare className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                )}
                {allOption?.icon && (
                  <span className="shrink-0 flex items-center">{allOption.icon}</span>
                )}
                <span className="truncate">{allOption?.label || allLabel}</span>
              </span>
              {isAllSelected && <span className="text-[9px] font-mono bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded font-black">ACTIVE</span>}
            </button>

            {filteredOptions.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-500 italic">
                No matching options found
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = values.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleToggle(opt.value)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold transition text-left cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-950/50 text-indigo-200 border border-indigo-500/30'
                        : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {isSelected ? (
                        <CheckSquare className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                      )}
                      {opt.icon && (
                        <span className="shrink-0 flex items-center">{opt.icon}</span>
                      )}
                      <span className="truncate">{opt.label}</span>
                    </span>
                    {opt.count !== undefined && (
                      <span className="text-[9px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded shrink-0">
                        {opt.count}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
