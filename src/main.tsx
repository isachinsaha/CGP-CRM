import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import './index.css';

// Safely prevent harmless browser fetch cancellations from bubbling as fatal app crashes
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = String(reason?.message || reason || '').toLowerCase();
    if (
      reason?.name === 'AbortError' ||
      msg.includes('abort') ||
      msg.includes('superseded by newer') ||
      msg.includes('failed to fetch')
    ) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallbackTitle="Career Growth Placement CRM">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

