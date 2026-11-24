import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app.css';
import './setup.css';
import { SurfaceInfo } from '../shared/SurfaceInfo';
import { Wizard } from './Wizard';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Wizard />
    {/* Tanı düğümü: hiç çizilmez; köprünün bu girişte de çalıştığını duman sınaması buradan okur. */}
    <div hidden>
      <SurfaceInfo surface="kurulum" />
    </div>
  </StrictMode>,
);
