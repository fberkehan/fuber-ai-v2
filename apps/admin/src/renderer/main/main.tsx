// Sözlük ekleri ilk çizimden önce kaydedilir.
import './lib/messages';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { LiveProvider } from './app/live-store';
import { PolicyProvider } from './app/policy-store';
import '../app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PolicyProvider>
      <LiveProvider>
        <App />
      </LiveProvider>
    </PolicyProvider>
  </StrictMode>,
);
