// ═══════════════════════════════════════════════════════════════════════════
// EMERGENCY FIX: Prevent "r.finally is not a function" crash
//
// Something in the codebase calls .finally() on a fetch Response object.
// Response does NOT have .finally() — only Promise does.
// This polyfill makes it safe until the actual .finally() call is found
// and fixed. REMOVE THIS once the source is identified.
// ═══════════════════════════════════════════════════════════════════════════
if (typeof Response !== 'undefined' && !Response.prototype.finally) {
  (Response.prototype as any).finally = function (callback: () => void) {
    try { callback(); } catch (e) { console.warn('[finally polyfill]', e); }
    return this;
  };
}

import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(<App />);
