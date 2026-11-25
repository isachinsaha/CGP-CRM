import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import './index.css';

// Safely prevent harmless browser fetch cancellations from bubbling as fatal app crashes
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (
      reason?.name === 'AbortError' ||
      reason?.message?.includes('aborted') ||
      reason?.message?.includes('Failed to fetch')
    ) {
      event.preventDefault();
      console.warn('[App] Caught and handled background fetch cancellation:', reason?.message || reason);
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

