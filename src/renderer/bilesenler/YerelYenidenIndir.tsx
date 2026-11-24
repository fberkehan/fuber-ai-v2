// ── "Hazır değil" kartının iki AÇIK seçimi (0.12 H3c düzeltme turu 2; Ruling P14) ────────────────────────────────────────────────────
// "Yalnız bu bilgisayar" seçili ama bu bilgisayardaki yapay zekâ ne hazır ne hazırlanıyor: kokpit kartı (uzun ve kısa), sohbet şeridi ve ada
// AYNI düğmeleri çizer. Birincil düğme hangi sürümün ve ne kadarın ineceğini söyler ("Hafif sürümü indir · 1,9 GB"; kurulu sürüm "aç"ılır,
// inmez) — seçim shared/yerel-katalog.ts yerelYenidenIndirSecimi (Ayarlar'ın kartlarıyla aynı karar). 1 GB üstünde Ayarlar'daki kurulumla
// aynı boyutlu onay kartın içinde açılır; ana süreç yine de uymayanı reddeder (Ö2; o zaman Ayarlar → Nerede çalışsın açılır, neden orada).
// İkinci düğme "Fuber’le devam et" (açık seçim; kendiliğinden Fuber'e geçilmez).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cagir, dinle } from '../api';
import { useYerelKatalog } from './NeredeSecimi';
import { motorEylemiYap } from '../motor-sinyali';
import { yerelYenidenIndirSecimi, type YenidenIndirSecimi } from '../../shared/yerel-katalog';
import type { MotorBildirimi } from '../../shared/motor-durumu';
import type { Ayarlar } from '../../shared/tipler';
import './yerel-yeniden-indir.css';

const ayarlaraGit = () => void cagir('ana:goster', 'ayarlar#gizli-mod').catch(() => undefined);

/** Seçimin hesabı ve eylemleri. `etkin`: kart gerçekten "hazır değil" (yoksa bilgisayar ölçülmez). */
export function useYerelYenidenIndir(etkin: boolean) {
  const [a, setA] = useState<Ayarlar | null>(null);
  useEffect(() => {
    if (!etkin) return;
    void cagir<Ayarlar>('ayarlar:al').then(setA).catch(() => undefined);
    return dinle('ayarlar:degisti', (x: Ayarlar) => setA(x));
  }, [etkin]);
  const sade = a ? a.mod !== 'gelistirici' : true;
  const kd = useYerelKatalog({ istek: etkin, bekle: etkin, sade, islemciZorla: a?.yerel.gpu === 'cpu' });
  const [onay, setOnay] = useState(false);
  const istenen = a ? a.yerel.bekleyenKurulum?.model ?? (kd.d?.modeller.find((m) => m.kurulu && m.ad === a.yerel.model) ? a.yerel.model : null) : null;
  // Takip turu: kurulu sürüm ancak çalıştırıcı da varsa "aç"ılır; yoksa onarım (indirme) yolu.
  const secim: YenidenIndirSecimi | null = a && kd.katalog ? yerelYenidenIndirSecimi(kd.katalog, { istenen, sade, bosDiskGB: kd.bosDiskGB, calistiriciKurulu: Boolean(kd.d?.kurulu.calistirici) }) : null;
  const indir = async () => {
    setOnay(false);
    if (!secim) { ayarlaraGit(); return; }
    const t0 = Date.now();
    const r = await cagir<{ tamam: boolean; hata?: string; durduruldu?: boolean }>('yerel:kur', secim.model, { ac: true, secim: 'yerel' })
      .catch((e: Error) => ({ tamam: false, hata: e.message, durduruldu: false }));
    // Hemen reddedildiyse (uymuyor, disk) neden Ayarlar → Nerede çalışsın'da görünür.
    if (!r.tamam && !r.durduruldu && Date.now() - t0 < 5000) ayarlaraGit();
  };
  const tikla = () => {
    if (!secim) { ayarlaraGit(); return; }
    // Kurulu sürüm (yerel yalnız kapatılmıştı): inmez, açılır.
    if (secim.kurulu) { void cagir('ayarlar:kaydet', { yerel: { etkin: true, model: secim.model } }).catch(() => undefined); return; }
    if (secim.onay) { setOnay(true); return; }
    void indir();
  };
  return { secim, onay: onay && secim ? secim : null, tikla, indir: () => void indir(), vazgec: () => setOnay(false) };
}

/** Kartın düğmeleri (ya da boyutlu onay). Çağıranın esnek satırına yerleşir; veri öznitelikleri üç yüzeyde aynı. */
export function YerelYenidenIndirDugmeleri({ b, sonra }: { b: MotorBildirimi; sonra?: () => void }) {
  const y = useYerelYenidenIndir(b.eylem === 'yerel-kur');
  // Takip turu: Ayarlar'daki onay gibi odak — açılınca "İndir"de; Vazgeç / Esc onu açan düğmeye döner.
  const onaylaRef = useRef<HTMLButtonElement>(null);
  const tetikRef = useRef<HTMLButtonElement>(null);
  const geriOdak = useRef(false);
  const acik = Boolean(y.onay);
  useEffect(() => {
    if (acik) onaylaRef.current?.focus({ preventScroll: true });
    else if (geriOdak.current) { geriOdak.current = false; tetikRef.current?.focus({ preventScroll: true }); }
  }, [acik]);
  const vazgec = () => { geriOdak.current = true; y.vazgec(); };
  if (y.onay) {
    return (
      <span className="yerel-onay" role="group" aria-label={y.onay.onayBaslik} onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); vazgec(); } }}>
        <span className="yerel-onay__metin" role="status" data-yerel-onay=""><b>{y.onay.onayBaslik}</b> {y.onay.onayMetni}</span>
        <button type="button" className="dgm dgm--k dgm--hayalet" onClick={vazgec} data-yerel-vazgec="">Vazgeç</button>
        <button ref={onaylaRef} type="button" className="dgm dgm--k dgm--beyaz" onClick={() => { y.indir(); sonra?.(); }} data-yerel-onayla="">{y.onay.onayDugmesi}</button>
      </span>
    );
  }
  return (
    <>
      <button ref={tetikRef} type="button" className="dgm dgm--k dgm--beyaz" data-motor-eylem="yerel-kur" data-eylem="yerel-kur" onClick={() => { y.tikla(); if (y.secim && !y.secim.onay) sonra?.(); }}>
        {y.secim?.etiket ?? b.dugme}
      </button>
      {b.ikincil && (
        <button type="button" className="dgm dgm--k dgm--hayalet" data-motor-eylem={b.ikincil.eylem} data-eylem={b.ikincil.eylem} onClick={() => { motorEylemiYap(b.ikincil!); sonra?.(); }}>
          {b.ikincil.etiket}
        </button>
      )}
    </>
  );
}
