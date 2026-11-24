// Ortak küçük bileşenler: FUBER logosu, zihin (beyin videosu), markdown, anahtar, boş durum. (0.12: eski FHarf — yazıdan kesilmiş F — kalktı;
// avatarlar ve küçük işaretler mini logo: UrunIsareti.)
import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { LOGO_VB, LOGO_YOLLAR } from '../../shared/logo';
import { cagir, kaynak } from '../api';
import { ccBaglantiYolu } from '../../shared/cc-olay';
import { atiflariNoktala } from '../../shared/gorunen-metin';

/** FUBER yazısı: yazı rengini alır (koyu temada beyaz, açık temada mürekkep; çentik `color: var(--ink)` verir). */
export function Logo({ yukseklik = 15 }: { yukseklik?: number }) {
  return (
    <svg viewBox={LOGO_VB} style={{ height: yukseklik, width: 'auto', display: 'block' }} role="img" aria-label="FUBER">
      {LOGO_YOLLAR.map((d) => <path key={d.slice(0, 24)} fill="currentColor" d={d} />)}
    </svg>
  );
}

/** Kullanıcı "hareketi azalt" demişse true; ayar değişince güncellenir. */
export function useAzHareket(): boolean {
  const [az, setAz] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const g = () => setAz(m.matches);
    g();
    m.addEventListener('change', g);
    return () => m.removeEventListener('change', g);
  }, []);
  return az;
}

// 11 Kas (tasarımcı bulgu 3): telefondaki 3B beyin videosu (Zihin, medya/zihin.mp4) kalktı; yerinde sakin Fuber işareti (cep.tsx).

marked.setOptions({ gfm: true, breaks: true });

/** Markdown → güvenli HTML; [H-12 · 2026-10-18] gibi atıflar küçük hap olur. Bağlantılar dış tarayıcıda açılır. */
export function Markdown({ metin, className = 'md' }: { metin: string; className?: string }) {
  const html = useMemo(() => {
    const ham = marked.parse(metin, { async: false }) as string;
    const temiz = DOMPurify.sanitize(ham, { ADD_ATTR: ['target'] });
    // H hafıza, M mesaj, D belge, N gün kaydı notu, G ham döküm satırı, R rapor. 11 Kas (iş izi işi, bulgu 7): kimlik görünmez — küçük üst simge noktası,
    // üstüne gelince "Hafızadan · 2026-10-18" (shared/gorunen-metin.ts atiflariNoktala).
    return atiflariNoktala(temiz);
  }, [metin]);
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (!a) return;
        // "Oturumu aç" (#cc-<id>; Claude Code sohbet özeti): uygulama içinde o oturuma — telefonda (Fuber Cep) yok sayılır.
        const yol = ccBaglantiYolu(a.getAttribute('href'));
        if (yol) { e.preventDefault(); if (window.fuber?.platform !== 'cep') void cagir('ana:goster', yol); return; }
        if (a.href) { e.preventDefault(); void cagir('sistem:ac', a.href); }
      }}
    />
  );
}

export function Anahtar({ acik, degistir, etiket, devreDisi }: { acik: boolean; degistir: (v: boolean) => void; etiket?: string; devreDisi?: boolean }) {
  return <button type="button" className="anahtar" role="switch" aria-checked={acik} aria-label={etiket} disabled={devreDisi} onClick={() => degistir(!acik)} />;
}

export function Bos({ metin }: { metin: string }) {
  return <div className="kk__bos">{metin}</div>;
}
