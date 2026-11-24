import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HUD_SURFACES, type HudSurface } from '@fuber/shared';
import '../app.css';
import './hud.css';
import './island.css';
import { SurfaceInfo } from '../shared/SurfaceInfo';
import { Island } from './Island';
import { startPcOverlay } from './PcOverlay';
import { Stage } from './Stage';
import { Toasts } from './Toasts';

/** Ada, toast yığını ve sahne aynı demeti paylaşır; hangisi olduğunu adres belirler: `?surface=island`. */
function readSurface(): HudSurface {
  const value = new URLSearchParams(window.location.search).get('surface');
  return HUD_SURFACES.find((surface) => surface === value) ?? 'island';
}

const titles: Record<HudSurface, string> = { island: 'ada', toasts: 'toast yığını', stage: 'sahne' };
const surfaces = { island: Island, toasts: Toasts, stage: Stage } satisfies Record<HudSurface, () => unknown>;
const surface = readSurface();
const Surface = surfaces[surface];
// Bilgisayarı kullanırken ekran katmanı (`?surface=pc-overlay`): HUD yüzeyi değildir, kendi kökünü çizer (`PcOverlay.tsx`).
const pcOverlay = startPcOverlay();
if (!pcOverlay) document.documentElement.dataset.surface = surface;

if (!pcOverlay) createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Surface />
    {/* Tanı düğümü: hiç çizilmez ve boyuta girmez; köprünün bu girişte de çalıştığını duman sınaması buradan okur. */}
    <div hidden>
      <SurfaceInfo surface={titles[surface]} />
    </div>
  </StrictMode>,
);
