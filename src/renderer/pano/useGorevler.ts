// ── Görevler kartının verisi (0.11 G10) ───────────────────────────────────────────────────────────────────────────────────────────
// Görevlerin listesi ana süreçten (`isler:liste`, G9) gelir ve değişince `isler:durum` olayı tüm listeyi yeniden verir (başladı, kontrol etti,
// adım başladı/bitti, durdu, bitti). Telefon bu kanalları hiç görmez. Kokpit listeyi tutar (kartın görünüp görünmeyeceğini o karar verir);
// kartın saniyelik yazıları ("12 sn önce", "2 dk 10 sn kaldı") ayrı bir saatle tazelenir (useSimdi) — kokpitin tamamı her saniye çizilmez.
import { useEffect, useRef, useState } from 'react';
import { cagir, dinle } from '../api';
import type { IsOzet } from '../../shared/isler';
import { gorevBosGorulduYazilsin, gorevKartiHali, gorevKartiOgeleri, pencereGorunurMu } from '../../shared/isler-gorunum';
import type { PencereDurumu } from '../../shared/pencere';
import type { Ayarlar } from '../../shared/tipler';

/** Görevlerin listesi; ilk yanıta dek null (kart o zamana dek hiç çizilmez: yanıp sönme olmasın). */
export function useGorevListesi(): IsOzet[] | null {
  const [liste, setListe] = useState<IsOzet[] | null>(null);
  useEffect(() => {
    let canli = true;
    // Olay ilk yanıttan ÖNCE gelirse (daha yeni) eski yanıt onu ezmesin.
    let olayGeldi = false;
    void cagir<IsOzet[]>('isler:liste').then((l) => { if (canli && !olayGeldi && Array.isArray(l)) setListe(l); }).catch(() => { if (canli && !olayGeldi) setListe([]); });
    const k = dinle('isler:durum', (l: IsOzet[]) => { if (canli && Array.isArray(l)) { olayGeldi = true; setListe(l); } });
    return () => { canli = false; k(); };
  }, []);
  return liste;
}

/**
 * Şimdiki an: `saniyeli` iken saniyede bir (süren görevin kalan süresi ve "son kontrol N sn önce" akıcı kalsın), değilken dakikada bir (bugünün sınırı,
 * "2 sa önce"). Pencere gizliyken (tepside) çizim durur.
 */
export function useSimdi(saniyeli: boolean): Date {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const tazele = () => { if (!document.hidden) setT(new Date()); };
    tazele();
    const z = setInterval(tazele, saniyeli ? 1000 : 60_000);
    document.addEventListener('visibilitychange', tazele);
    return () => { clearInterval(z); document.removeEventListener('visibilitychange', tazele); };
  }, [saniyeli]);
  return t;
}

/**
 * Pencere ekranda mı: ana sürecin bildirdiği hâl ('pencere:durum'.gorunur: gösterilmiş ve simge durumunda değil) VE belge gizli değil. Tepsiden `--gizli`
 * ile açılıp hiç gösterilmemiş pencerenin sayfası çizilir ve `document.hidden` demeyebilir — gerçeği yalnız ana süreç bilir (shared/isler-gorunum.ts).
 * Ana süreç yanıt vermezse (hata) görünür sayılır: bayrak sonsuza dek bekletilmez.
 */
function usePencereGorunur(): boolean {
  const [belgeGizli, setBelgeGizli] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [ana, setAna] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let canli = true;
    const durum = (d: PencereDurumu | null | undefined) => { if (canli && typeof d?.gorunur === 'boolean') setAna(d.gorunur); };
    void cagir<PencereDurumu>('pencere:durum').then(durum).catch(() => { if (canli) setAna(true); });
    const k = dinle('pencere:durum', durum);
    const f = () => setBelgeGizli(document.hidden);
    f();
    document.addEventListener('visibilitychange', f);
    return () => { canli = false; k(); document.removeEventListener('visibilitychange', f); };
  }, []);
  return pencereGorunurMu(belgeGizli, ana);
}

/**
 * Kokpitin Görevler kartının bütün durumu tek yerde (0.11 G10 düzeltme turu 1, K9): görev listesi (isler:liste + isler:durum), kartın hâli
 * (`liste`: görev var → ızgarada kart; `bos`: ilk kullanımda bir kez tek satır; `yok`: görünmez) ve "bir kez" bayrağı. Bayrak YALNIZ satır gerçekten
 * çizilip pencere görünürken yazılır (`hazir`: kokpit verisi geldi, satır çizildi) — veri gelmeden ya da `--gizli` ile hiç gösterilmemiş pencerede
 * harcanmaz (shared/isler-gorunum.ts gorevBosGorulduYazilsin). `aracsiz`: Gizli ya da yalnız bu bilgisayardaki yapay zekâ — görev başlatılamaz.
 */
export function useGorevKarti(o: { hazir: boolean; aracsiz: boolean }): { liste: IsOzet[]; hali: 'liste' | 'bos' | 'yok'; adet: number; bugun: number } {
  const ham = useGorevListesi();
  const bos = useGorevBosIpucu();
  const gorunur = usePencereGorunur();
  const ogeler = gorevKartiOgeleri(ham ?? [], new Date());
  const hali = ham === null ? 'yok' : gorevKartiHali({ hepsi: ogeler.hepsi, ilkKullanim: bos.ilkKullanim === true, aracsiz: o.aracsiz });
  const yazildi = useRef(false);
  useEffect(() => {
    if (!gorevBosGorulduYazilsin({ hali, hazir: o.hazir, gorunur, yazildi: yazildi.current })) return;
    yazildi.current = true;
    bos.goruldu();
  }, [hali, o.hazir, gorunur]); // eslint-disable-line react-hooks/exhaustive-deps
  return { liste: ham ?? [], hali, adet: ogeler.hepsi.length, bugun: ogeler.bugun.length };
}

/**
 * "Fuber’e bir işi takip ettirebilirsin" satırı ilk kullanımda BİR KEZ gösterilir: ayar `kokpit.gorevlerBosGorundu` (arayüz yazar). Dönen
 * `ilkKullanim` bu açılışın görüntüsüdür (satır göründüğü an ayar yazılır ama bu açılışta satır kalkmaz — sonraki açılışlarda görünmez); `goruldu()`
 * satır ekrana geldiğinde çağrılır. Ayar okunana dek null (karar verilmedi).
 */
export function useGorevBosIpucu(): { ilkKullanim: boolean | null; goruldu: () => void } {
  const [ilkKullanim, setIlk] = useState<boolean | null>(null);
  useEffect(() => {
    let canli = true;
    void cagir<Ayarlar>('ayarlar:al').then((a) => { if (canli) setIlk(a?.kokpit?.gorevlerBosGorundu !== true); }).catch(() => { if (canli) setIlk(false); });
    return () => { canli = false; };
  }, []);
  const goruldu = () => { void cagir('ayarlar:kaydet', { kokpit: { gorevlerBosGorundu: true } }).catch(() => undefined); };
  return { ilkKullanim, goruldu };
}
