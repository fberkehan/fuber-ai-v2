import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app.css';
import '../hud/island.css';
import './main.css';
import { App } from './shell/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
