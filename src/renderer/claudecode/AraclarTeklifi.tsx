// ── Oturum ortasında İş → Geliştirici geçişinde "Önerilen araçlar" teklifi (Görev 29; G23 incelemesi, bulgu 5; 0.10 Görev 7, B-35) ─────
// Kurulum sürümü yalnız açılışta okunduğundan geçiş yeniden başlatmaya dek fark edilmiyordu (taze İş kurulumu bu adımı hiç görmezdi).
// Kabuk (main.tsx) geçişi görünce teklifi açar (araclar-teklifi-durumu.ts). I8 (son inceleme): teklif Ayarlar → Genel'de mod anahtarının
// ALTINDA, satır içinde çizilir (ayarlar/Genel.tsx) — eskiden pencerenin üstünde sabit kart başlığı örtüyordu. "Göster" yalnız bu adımlı
// sihirbazı açar; "Şimdi değil" adımı görüldü sayar (kuyruğa dokunmadan; Claude Code → Eklentiler'den her zaman kurulur) ve bekleyen tek
// yükseltme buysa kurulum sürümünü yazar. Açılınca durumu yeniden okur: adım bu arada (yeniden açılan sihirbazda) görüldüyse kapanır.
// B-35: dar pencerede mod kartları alt alta dizilince teklif görünür alanın dışında kalıyordu → çıkınca kendini görünür alana getirir
// (scrollIntoView, block: 'nearest'; anında — azaltılmış harekette de aynı). K8: metin sade; tek bir aracı adıyla öne çıkarmaz.
import { useEffect, useRef, useState } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { ozelYukseltmeBitirirMi } from '../../shared/kurulum-adimlari';
import { araclarTeklifi, useAraclarTeklifi } from './araclar-teklifi-durumu';
import { varsayilanSecim, type EklentiDurumu } from '../../shared/cc-eklentiler';
import type { Ayarlar } from '../../shared/tipler';
import './eklentiler.css';

/** Açıksa teklif satırı (mod anahtarının altında); değilse hiçbir şey. */
export function AraclarTeklifi() {
  const acik = useAraclarTeklifi();
  const [hazir, setHazir] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!acik) { setHazir(false); return; }
    void cagir<EklentiDurumu>('claudecode:eklenti-durum').then((d) => { if (d.paket.adimGoruldu) araclarTeklifi.kapat(); else setHazir(true); }).catch(() => araclarTeklifi.kapat());
  }, [acik]);
  // Çıkınca görünür alana (yalnız gerekiyorsa kaydırır: zaten görünüyorsa yerinden oynamaz). Mod akordeonu açılırken yüksekliği değişebilir:
  // açılış hareketi bitince bir kez daha.
  useEffect(() => {
    if (!acik || !hazir) return;
    const getir = () => ref.current?.scrollIntoView({ block: 'nearest' });
    getir();
    const z = setTimeout(getir, 420);
    return () => clearTimeout(z);
  }, [acik, hazir]);
  // "Şimdi değil" = değişiklik yok: adım yalnız "görüldü" olur; boş seçim GÖNDERİLMEZ (bitmemiş kuyruk öğelerini düşürürdü).
  const simdiDegil = async () => {
    await cagir('claudecode:paket-baslat', { yalnizGoruldu: true }).catch(() => undefined);
    const a = await cagir<Ayarlar>('ayarlar:al').catch(() => null);
    if (a && ozelYukseltmeBitirirMi(a.mod, a.kurulumSurumu ?? 0, ['gelistirici-araclari'])) await cagir('kurulum:yukseltme-bitti').catch(() => undefined);
    araclarTeklifi.kapat();
  };
  if (!acik || !hazir) return null;
  const sayi = varsayilanSecim(window.fuber?.platform).length;
  return (
    <div ref={ref} className="araclar-teklif" role="region" aria-label="Önerilen araçlar" data-araclar-teklif="">
      <span className="ccd__simge"><Ikon ad="kod" olcu={18} /></span>
      <div className="araclar-teklif__metin">
        <b>Claude Code için önerilen {sayi} aracı kurayım mı?</b>
        <span>Arka planda kurulur.</span>
      </div>
      <div className="araclar-teklif__dugmeler">
        <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => araclarTeklifi.goster()} data-araclar-goster="">Göster<Ikon ad="ileri" olcu={14} /></button>
        <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => void simdiDegil()} data-araclar-sonra="" title="Sonra Claude Code → Eklentiler’den kurabilirsin.">Şimdi değil</button>
      </div>
    </div>
  );
}
