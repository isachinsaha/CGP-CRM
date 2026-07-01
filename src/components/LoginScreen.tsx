import React, { useState, useEffect } from 'react';
import { Lock, User, Eye, EyeOff, ShieldCheck, PhoneCall, KeyRound, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import CGPLogo from './CGPLogo.tsx';

interface LoginScreenProps {
  onLoginSuccess: (user: { id: string; username: string; displayName: string; role: 'admin' | 'agent' }) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [demoCredsOpen, setDemoCredsOpen] = useState(true);
  const [seedCoords, setSeedCoords] = useState<any[]>([]);

  // Fetch current coordinators list to show as helper login guides
  useEffect(() => {
    fetch('/api/coordinators')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSeedCoords(data);
        }
      })
      .catch(err => console.error('Failed to pre-fetch demo accounts:', err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg('Please input both Username and Password.');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Save to local storage for persistence
        localStorage.setItem('cgp_crm_session', JSON.stringify(data.user));
        onLoginSuccess(data.user);
      } else {
        setErrorMsg(data.error || 'Authentication failed. Please verify credentials.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Server connection lost. Please verify your server is running.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectDemo = (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
    setErrorMsg('');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 px-6 lg:px-8 font-sans selection:bg-accent-purple selection:text-white">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        {/* Logo Container */}
        <div className="inline-flex h-28 w-28 select-none animate-in zoom-in-95 duration-300" id="cgp-login-logo-container">
          <CGPLogo size={112} rounded="rounded-3xl" />
        </div>
        
        <h2 className="mt-4 text-2xl font-black text-slate-50 tracking-tight font-display uppercase">
          CGP HR Solutions
        </h2>
        <p className="mt-1 text-[10px] text-accent-purple font-extrabold tracking-widest uppercase">
          ABROAD RECRUITING TELE-CALLING HUB
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900/90 py-8 px-8 rounded-3xl border border-slate-800 shadow-2xl space-y-6 backdrop-blur-md">
          <div className="border-b border-slate-800 pb-4 text-center">
            <h3 className="text-xs font-black text-slate-100 tracking-wider uppercase flex items-center justify-center gap-1.5 font-display">
              <KeyRound className="h-4 w-4 text-accent-purple" />
              Secure Staff Authentication
            </h3>
            <p className="text-[11px] text-slate-400 font-semibold mt-1">
              Enter your designated ID & Password below to access candidate buckets
            </p>
          </div>

          {errorMsg && (
            <div className="bg-red-950/40 border border-red-900/50 p-3.5 rounded-2xl flex items-start gap-2.5 text-xs text-red-200 font-bold animate-shake">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-extrabold uppercase text-[10px] tracking-wider text-red-300">Login Attempt Denied</p>
                <p className="font-medium mt-0.5 text-[11px] leading-relaxed text-red-200/90">{errorMsg}</p>
              </div>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            {/* Username Input */}
            <div>
              <label htmlFor="username" className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5 font-display">
                Username / Agent ID
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <User className="h-4 w-4" />
                </div>
                <input
                  id="username"
                  type="text"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin or joyce"
                  className="block w-full pl-10 pr-4 py-2.5 text-xs font-bold text-slate-100 placeholder-slate-500 bg-slate-850 hover:bg-slate-800/80 focus:bg-slate-800 border border-slate-750 focus:border-accent-purple rounded-xl focus:outline-none focus:ring-1 focus:ring-accent-purple/20 transition-all font-mono"
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label htmlFor="password" className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5 font-display">
                Security Password
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="block w-full pl-10 pr-10 py-2.5 text-xs font-bold text-slate-100 placeholder-slate-500 bg-slate-850 hover:bg-slate-800/80 focus:bg-slate-800 border border-slate-750 focus:border-accent-purple rounded-xl focus:outline-none focus:ring-1 focus:ring-accent-purple/20 transition-all font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-350 transition-all cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Sign-in Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center py-3 px-4 border border-transparent rounded-xl text-xs font-black text-white bg-accent-purple hover:bg-accent-purple/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-purple shadow-sm transition-all hover:shadow-lg hover:shadow-accent-purple/10 cursor-pointer disabled:opacity-50 mt-2 uppercase tracking-widest"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4.5 w-4.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verifying Credentials...</span>
                </div>
              ) : (
                'Access Dashboard'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
