// ── Kokpit: sürümün "yeni" kartı — 0.14’te yeni (0.14 T35; 0.13 T16; altyapı 0.11 G12b, spec §10) ─────────────────────────────────────
// 0.14 T35: Sade modda (karakterler kapalı) karakterleri anan satır gösterilmez (shared/yenilik.ts yenilikSatirlari; kanca useKarakterGorunur).
// Yükseltmede sihirbaz yok (0.12 spec Hedefler §3): yükselen profile BİR kez, kokpitte ızgaranın üstünde: sihirbaz değil, kısa ve kapatılabilir tek kart (en çok 5 satır, her biri tek cümle;
// metinler shared/yenilik.ts). Karar saf fonksiyondan (yeniKartAcilsinMi: yeni kurulumda hiç, kapatılınca bir daha yok, tanıtım turu açıkken
// ve yükseltme sihirbazı beklerken gelmez). "Tamam" işareti ana süreçte yazar (yenilik:kapat) — arayüz kopyası yazamaz. Kart G3 kütüphanesinden
// (Kart, Liste, Satir, Dugme): metinler satır sınırlı, renkler belirteçlerden, üç tema. Ayrı bir kutu değil ızgaranın dışında akış öğesidir; Kokpit
// görünen alan hesabında (olc) ızgaranın üstündekileri zaten düşer, bu yüzden durumu Kokpit'te (useYenilikKarti) durur: kapanınca yeniden ölçülür.
import { useCallback, useEffect, useState } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Dugme, Kart, Liste, Satir } from '../ui';
import { useKarakterGorunur } from '../karakter-gorunum';
import { YENILIK_BASLIGI, YENILIK_KAPAT_ETIKETI, yeniKartAcilsinMi, yenilikSatirlari } from '../../shared/yenilik';
import type { Ayarlar } from '../../shared/tipler';

/** Kartın görünüp görünmediği ve "Tamam": ayarlar bir kez okunur, değişince (ayarlar:degisti) tazelenir; kapatma hemen yansır, işaret ana süreçte yazılır. */
export function useYenilikKarti(turAcik: boolean): { goster: boolean; kapat: () => void; /** Ayarlar okundu (karar verildi): ondan önce aynı cümleyi söyleyecek öteki satırlar da bekler. */ hazir: boolean } {
  const [a, setA] = useState<Ayarlar | null>(null);
  const [kapandi, setKapandi] = useState(false);
  useEffect(() => {
    let iptal = false;
    void cagir<Ayarlar>('ayarlar:al').then((x) => { if (!iptal) setA(x); }).catch(() => undefined);
    const birak = dinle('ayarlar:degisti', (x: Ayarlar) => setA(x));
    return () => { iptal = true; birak(); };
  }, []);
  const kapat = useCallback(() => {
    setKapandi(true);
    void cagir('yenilik:kapat').catch(() => undefined); // yazılamazsa kart bir sonraki açılışta yine gelir (zararsız)
  }, []);
  const goster = Boolean(a) && !kapandi && yeniKartAcilsinMi(a!, { turAcik, demo: window.fuber?.demo === true });
  return { goster, kapat, hazir: a !== null };
}

export function YenilikKarti({ kapat }: { kapat: () => void }) {
  const satirlar = yenilikSatirlari(useKarakterGorunur());
  return (
    <Kart
      className="yenilik" data-yenilik="" baslik={YENILIK_BASLIGI}
      eylem={<Dugme tur="hayalet" boyut="k" data-yenilik-kapat="" onClick={kapat}>{YENILIK_KAPAT_ETIKETI}</Dugme>}
    >
      <Liste>
        {satirlar.map((s) => <Satir key={s.ikon} sol={<Ikon ad={s.ikon} olcu={16} />} baslik={s.metin} satir={2} data-yenilik-satir="" />)}
      </Liste>
    </Kart>
  );
}
