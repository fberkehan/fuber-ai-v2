// ── Fuber Tarayıcı (penceremizin kendi arayüzü) ───────────────────────────────────────────────────────────────
// Araç çubuğu (geri / ileri / yenile, adres çubuğu, güvenli bağlantı simgesi, "Fuber'e sor"), "Fuber bu sayfada çalışıyor"
// şeridi ve başlangıç sayfası. Web sayfasının kendisi bu sayfada DEĞİL: ana süreç onu ayrı, preload'suz bir görünümde
// (WebContentsView) buradaki sayfa alanının üstüne koyar (src/main/tarayici.ts). Görünüm: tarayici/Tarayici.tsx.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tasarim.css';
import './tarayici/tarayici.css';
import { birakmayiEngelle } from './api';
import { temayiBagla } from './tema';
import { Tarayici } from './tarayici/Tarayici';
import { pencereIsaretleriniKur } from './pencere/PencereDugmeleri';

temayiBagla();
pencereIsaretleriniKur();
birakmayiEngelle();
createRoot(document.getElementById('kok')!).render(<StrictMode><Tarayici /></StrictMode>);
