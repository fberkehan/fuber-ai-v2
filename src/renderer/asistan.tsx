// ── Ada (asistan penceresinin girişi) ─────────────────────────────────────────────────────────────────────────
// Ekranın üst ortasından inen çentik: "Hey Fuber" ya da kısayolla (Ctrl+Shift+Space) belirir; sen başka bir şeyle
// çalışırken soruyu dinler, ana sohbete yazar ve yanıtı burada akıtır (sesle sorduysan sesli de okur). Onay isteyen işler,
// hatırlatıcılar ve Fuber'in kendiliğinden mesajları da burada görünür. Görünüm: ada/Ada.tsx; durum ve olaylar:
// ada/useAsistan.ts; pencere (üst orta, saydam, tıklama geçiren, tam ekran kapısı): src/main/ada.ts.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tasarim.css';
import { birakmayiEngelle } from './api';
import { temayiBagla } from './tema';
import { Ada } from './ada/Ada';

temayiBagla({ gecis: false }); // ada çoğu zaman gizli: tema anında değişir (şeklin rengi kendisi yumuşar)
birakmayiEngelle();
createRoot(document.getElementById('kok')!).render(<StrictMode><Ada /></StrictMode>);
