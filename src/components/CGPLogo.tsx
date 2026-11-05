import React from 'react';

interface CGPLogoProps {
  className?: string;
  size?: number | string;
  rounded?: string;
}

export default function CGPLogo({ className = '', size = '100%', rounded = 'rounded-2xl' }: CGPLogoProps) {
  return (
    <div 
      className={`flex items-center justify-center bg-white p-1 border border-slate-200/80 shadow-md ${rounded} ${className} overflow-hidden`} 
      style={{ width: size, height: size }} 
      id="cgp-professional-logo"
    >
      <svg 
        viewBox="0 0 100 100" 
        className="w-full h-full select-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="cgpGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#1e3a8a" />
          </linearGradient>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#cgpGrad)" />
        <circle cx="50" cy="50" r="44" fill="none" stroke="url(#goldGrad)" strokeWidth="2.5" />
        <path d="M 28 50 A 22 22 0 1 1 72 50 A 22 22 0 1 1 28 50" fill="none" stroke="#38bdf8" strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
        <path d="M 50 20 L 50 80 M 20 50 L 80 50" stroke="#38bdf8" strokeWidth="1" opacity="0.3" />
        {/* Central CGP monogram and wings */}
        <path d="M 35 44 C 35 38 42 34 50 34 C 58 34 65 38 65 44 C 65 48 60 52 50 56 C 40 52 35 48 35 44 Z" fill="url(#goldGrad)" opacity="0.85" />
        <text x="50" y="55" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="18" letterSpacing="1">CGP</text>
        <text x="50" y="69" textAnchor="middle" fill="#38bdf8" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="800" fontSize="7" letterSpacing="1.5">OVERSEAS</text>
        <circle cx="50" cy="28" r="2.5" fill="#f59e0b" />
      </svg>
    </div>
  );
}
