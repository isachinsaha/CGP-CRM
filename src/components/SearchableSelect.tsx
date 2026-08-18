import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';

interface SearchableOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface SearchableSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  className?: string;
  dropdownClassName?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className = '',
  dropdownClassName = ''
}: SearchableSelectProps) {
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
      // Focus the input when opened
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const selectedOption = (options || []).find((opt) => opt && opt.value === value);

  // Filter options based on search term
  const term = (searchTerm || '').toLowerCase();
  const filteredOptions = (options || []).filter((opt) => {
    if (!opt) return false;
    const l = String(opt.label || '').toLowerCase();
    const v = String(opt.value || '').toLowerCase();
    return l.includes(term) || v.includes(term);
  });

  const isFullWidth = className.includes('w-full');

  return (
    <div className={`relative text-left ${isFullWidth ? 'w-full block' : 'inline-block'}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-1.5 min-w-0 ${className}`}
      >
        <span className="flex items-center gap-1.5 min-w-0 truncate">
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span className="truncate text-left font-extrabold">{selectedOption ? selectedOption.label : placeholder}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70 shrink-0" />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 mt-1 w-64 rounded-xl border border-slate-200 dark:border-slate-750 bg-white dark:bg-slate-900 p-2 shadow-2xl z-50 focus:outline-none ${dropdownClassName}`}
        >
          {/* Search Input */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search..."
              className="w-full rounded-xl bg-[#eef8f3] dark:bg-slate-800 border border-[#a8e0c9] dark:border-slate-700 py-1.5 pl-8 pr-3 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold"
            />
          </div>

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto space-y-0.5 custom-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs text-left transition-colors ${
                      isSelected
                        ? 'bg-[#e1f5eb] dark:bg-emerald-950 text-[#0d7d4d] dark:text-emerald-400 font-black border border-[#a8e0c9]/60 dark:border-emerald-900'
                        : 'text-[#0d7d4d] dark:text-slate-100 font-bold hover:bg-violet-600 hover:text-white dark:hover:bg-slate-800 dark:hover:text-emerald-300'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                      <span className="truncate">{opt.label}</span>
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-[#0d7d4d] dark:text-emerald-400 shrink-0" />}
                  </button>
                );
              })
            ) : (
              <div className="text-center py-4 text-xs text-slate-500 italic">
                No matches found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
