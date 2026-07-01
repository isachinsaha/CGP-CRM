import React from 'react';
// @ts-ignore
import cgpLogo from '../assets/images/cgp_logo_1782388689853.jpg';

interface CGPLogoProps {
  className?: string;
  size?: number | string;
  rounded?: string;
}

export default function CGPLogo({ className = '', size = '100%', rounded = 'rounded-2xl' }: CGPLogoProps) {
  return (
    <div 
      className={`flex items-center justify-center bg-white p-1 border border-slate-200/80 shadow-md ${rounded} ${className}`} 
      style={{ width: size, height: size }} 
      id="cgp-professional-logo"
    >
      <img
        src={cgpLogo}
        alt="CGP HR Solutions Logo"
        className="w-full h-full object-contain select-none rounded-xl"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

