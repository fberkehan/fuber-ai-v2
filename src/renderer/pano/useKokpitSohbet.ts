// ── Kokpit sohbet panelinin durumu (0.11 G7) ──────────────────────────────────────────────────────────────────────────────────────
// Panel eskiden yalnız ana sohbeti gösteriyordu (Kokpit.tsx `sohbet:ana`). Şimdi: ana sohbet + `sohbet:liste` + son seçim (ayar
// `kokpit.sonSohbet`) ve seçim. Açılışta hangi sohbetin gösterileceği saf kuraldan (shared/kokpit-sohbet.ts kokpitSohbeti); sonra seçimi
// kullanıcı yönetir: açılır listeden sohbet seç, "Yeni sohbet" (taslak: kayıt ilk mesajda açılır — Sohbetler sayfasıyla aynı yol,
// `sohbet:yeni`), ana sohbete dön. Taslak boş bırakılırsa hiçbir iz kalmaz. Yeni kanal yok: sohbet:ana / sohbet:liste / sohbet:yeni /
// ayarlar:al / ayarlar:kaydet. `yeniIstegi`: Ctrl+N (renderer/main.tsx) sayaç artırır → taslak açılır ve yazı alanı odaklanır.
// Düzeltme turu 1: (Ö1) açık sohbet okunuyor sayılır — liste her yazıldığında açık sohbetin okunmamışı 0'lanır ve bir sohbet seçilince iyimser
// olarak sıfırlanır (`sohbet:okundu`nun olayı yok; yoksa "Ana sohbette N yeni mesaj" çipi okunmuş mesaj için geri gelirdi); (K5) liste BAŞARIYLA
// geldi ve seçili sohbet yoksa (arşivlendi/silindi) ana'ya düşülür ve ayar güncellenir; (K10) sıra dışı gelen eski liste yanıtı uygulanmaz.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cagir, dinle } from '../api';
import type { YeniSohbet } from '../bilesenler/Sohbet';
import { acikOkunmusSay, gecerliSecim, kokpitSohbeti, kokpitSohbetleri, siraliIstekler, type KokpitSecimi } from '../../shared/kokpit-sohbet';
import type { Ayarlar, SohbetOzet } from '../../shared/tipler';

export interface KokpitSohbetDurumu {
  /** Ana sohbetin kimliği (gelene dek null). */
  anaId: number | null;
  /** Arşivde olmayan sohbetler (`sohbet:liste`: ana önce, ardından en yeni önce); açık sohbetin okunmamışı 0. */
  liste: SohbetOzet[];
  /** Panelin seçimi: kimlik, 'yeni' (taslak) ya da null (açılış kararı henüz verilmedi). */
  secim: KokpitSecimi;
  /** `<Sohbet sohbetId>`: taslakta ve belirlenmemişken null. */
  sohbetId: number | null;
  /** Taslak sohbetin kaydı: ilk mesajda açılır (Sohbet'e `yeni` olarak verilir); taslak değilken undefined. */
  yeni: YeniSohbet | undefined;
  /** Sayaç: değişince yazı alanı odaklanır (Sohbet `odak`). */
  odak: number;
  sec: (id: number) => void;
  taslakAc: () => void;
  listeyiYenile: () => Promise<void>;
}

export function useKokpitSohbet(yeniIstegi = 0): KokpitSohbetDurumu {
  const [anaId, setAnaId] = useState<number | null>(null);
  const [liste, setListe] = useState<SohbetOzet[]>([]);
  const [secim, setSecim] = useState<KokpitSecimi>(null);
  const [odak, setOdak] = useState(0);
  // Geç gelen yanıtlar güncel seçimi ve ana kimliğini okur (kancaların kapanışı eski kalır).
  const secimRef = useRef<KokpitSecimi>(null);
  secimRef.current = secim;
  const anaRef = useRef<number | null>(null);
  // K10: her liste isteği sıra numarası alır; kendinden YENİ bir istek zaten uygulandıysa yanıt atılır (shared/kokpit-sohbet.ts siraliIstekler).
  const [sira] = useState(siraliIstekler);

  const kaydet = useCallback((id: number) => { void cagir('ayarlar:kaydet', { kokpit: { sonSohbet: id } }).catch(() => undefined); }, []);

  /** Alınan listeyi yazar (sıra dışıysa atar): açık sohbet okunmuş sayılır. `seciliyiDogrula`: istek verildiği andaki seçim hâlâ aynıysa ve
   *  seçili sohbet yoksa ana'ya düşülür (seçim bu arada değiştiyse — ör. taslaktan az önce kayda dönüştü — doğrulama sonraki tazelemeye kalır). */
  const listeyiUygula = useCallback((no: number, l: SohbetOzet[], seciliyiDogrula: boolean) => {
    if (!sira.uygula(no)) return;
    let gecerli = secimRef.current;
    if (seciliyiDogrula && anaRef.current !== null) {
      const yeniSecim = gecerliSecim(gecerli, { anaId: anaRef.current, liste: l });
      if (yeniSecim !== gecerli && typeof yeniSecim === 'number') { gecerli = yeniSecim; setSecim(yeniSecim); kaydet(yeniSecim); }
    }
    // 0.11 G10: görev sohbetleri kokpit paneline girmez (seçici, "son 8", başlangıç ekranının "Son sohbetler"i, okunmamış çipi): Sohbetler sayfasında durur.
    setListe(acikOkunmusSay(kokpitSohbetleri(l), typeof gecerli === 'number' ? gecerli : null));
  }, [kaydet, sira]);

  const listeyiYenile = useCallback(() => {
    const no = sira.al();
    const once = secimRef.current;
    return cagir<SohbetOzet[]>('sohbet:liste').then((l) => { listeyiUygula(no, l, secimRef.current === once); }, () => undefined);
  }, [listeyiUygula, sira]);

  useEffect(() => {
    let canli = true;
    const no = sira.al();
    void Promise.all([
      cagir<number>('sohbet:ana'),
      cagir<SohbetOzet[]>('sohbet:liste').catch(() => [] as SohbetOzet[]),
      cagir<Ayarlar>('ayarlar:al').catch(() => null),
    ]).then(([ana, l, a]) => {
      if (!canli) return;
      anaRef.current = ana;
      setAnaId(ana);
      const son = a?.kokpit?.sonSohbet;
      // Ctrl+N açılıştan önce taslağı açtıysa o korunur (karar yalnız henüz seçim yokken verilir).
      const karar = secimRef.current ?? kokpitSohbeti({ anaId: ana, sonSecilen: typeof son === 'number' ? son : null, anaOkunmamis: l.find((x) => x.id === ana)?.okunmamis ?? 0, liste: l });
      secimRef.current = karar;
      setSecim(karar);
      listeyiUygula(no, l, false);
      // Ilk yükleme yanıtı, ondan sonra başlatılan (olay güdümlü) bir tazelemeden SONRA döndüyse yukarıdaki liste atılır ve o tazelemenin listesi karar
      // verilmeden önce yazılmıştır (seçilen sohbetin okunmamışı bayat): karar verildiği anda koşulsuz sıfırlanır.
      setListe((x) => acikOkunmusSay(x, typeof karar === 'number' ? karar : null));
    }).catch(() => undefined);
    // Liste; yeni mesaj, tur başı/sonu ve başlık değişince tazelenir (Sohbetler sayfasıyla aynı olaylar).
    const k = dinle('sohbet:olay', (o: { tur: string }) => { if (o.tur === 'bitti' || o.tur === 'yeni_mesaj' || o.tur === 'basladi') void listeyiYenile(); });
    return () => { canli = false; k(); };
  }, [listeyiYenile, listeyiUygula, sira]);

  // Seçilen sohbet açılınca okunur: liste iyimser olarak sıfırlanır (bir sonraki tazelemeyi beklemez).
  const sec = useCallback((id: number) => {
    secimRef.current = id;
    setSecim(id);
    setListe((l) => acikOkunmusSay(l, id));
    kaydet(id);
  }, [kaydet]);
  const taslakAc = useCallback(() => { secimRef.current = 'yeni'; setSecim('yeni'); setOdak((n) => n + 1); }, []);

  // Ctrl+N (kokpitteyken): taslak panelde satır içi açılır. İlk çizimdeki değer "istek yok" sayılır (sayfaya sonradan dönülünce eski
  // istek yeniden açmasın).
  const gorulen = useRef(yeniIstegi);
  useEffect(() => { if (yeniIstegi !== gorulen.current) { gorulen.current = yeniIstegi; taslakAc(); } }, [yeniIstegi, taslakAc]);

  // Taslak ilk mesajda kayda dönüşür: panel yeni kimliğe geçer, ayara yazılır ve liste hemen yeni satırı (varsayılan başlıkla) içerir —
  // gerçek liste yanıtı gelene dek başlık "Sohbet" gibi nötr bir şey değil, kayıttaki gerçek varsayılan olur.
  const yeni = useMemo<YeniSohbet | undefined>(() => (secim === 'yeni'
    ? {
      olustur: () => cagir<number>('sohbet:yeni'),
      olustu: (id) => {
        secimRef.current = id;
        setSecim(id);
        kaydet(id);
        setListe((l) => (l.some((x) => x.id === id) ? l : [{ id, baslik: 'Yeni sohbet', tur: 'normal', guncelleme: new Date().toISOString(), okunmamis: 0 }, ...l]));
        void listeyiYenile();
      },
    }
    : undefined), [secim, kaydet, listeyiYenile]);

  return { anaId, liste, secim, sohbetId: typeof secim === 'number' ? secim : null, yeni, odak, sec, taslakAc, listeyiYenile };
}
