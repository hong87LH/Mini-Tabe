// Intercept fetch assignment to prevent "Cannot set property fetch of #<Window>" in Electron nodeIntegration environments
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    enumerable: true,
    get: () => originalFetch,
    set: () => {} // Silently ignore re-assignment
  });
}

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
