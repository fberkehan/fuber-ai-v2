// ── Kurulum v2 › Nerede çalışsın (0.12 H3c): Fuber · Yalnız bu bilgisayar · Gizli ve yerel sürüm kararları ─────────────────────────────────
// Kurallar saf modüllerde: seçenekler ve ayar yaması shared/nerede.ts, kartlar ve uygunluk shared/yerel-katalog.ts (GERÇEK donanım:
// sistem:kontrol; ~10 sn'de ölçülemezse "bakamadım" — ölçülmemiş şey söylenmez, hiçbir şey indirilmez). Adımdan İLERİ çıkarken `uygula`:
//  · Fuber: Gizli ve "Yalnız bu bilgisayar" kapanır; bu kurulumun başlattığı indirme durur (yerelin açık/kapalısı korunur).
//  · Yalnız bu bilgisayar / Gizli: seçili sürüm (uymayan seçilemez: katalogSecimi) kuruluysa ona geçilir ve yerel açılır; değilse ARKA PLANDA
//    iner (yerel:kur, { ac: true, gizli, secim }) — kurulum beklemez; bitince yerel ana süreçte açılır (Gizli seçildiyse Gizli de açık kalır).
//    İkisinde de hazır olana dek sohbet bekler, buluta gitmez (tek-motor.ts; düzeltme turu 1, P14 K1; Gizli'de F1 kuralları AYNEN).
//    Düzeltme turu 1 (Kü7): indirilecekse seçim ana süreçte istenen kurulumun kaydıyla TEK yazımda kaydedilir (`secim`; N-4). Kü3: istek
//    yutulmaz — ana süreç uymayanı reddederse (Ö2) seçim Fuber'e döner ve Hazırsın söyler; indirme hatası Hazırsın'da sakin bir satır +
//    "Yeniden dene"; önceden istenmiş başka bir indirme sürerken açıkça seçilen sürüm sessizce yok sayılmaz (Hazırsın söyler).
//  · Hiçbir sürüm hazırlanamıyorsa (ölçüldü ve hiçbiri uymuyor ya da ölçülemedi) seçim Fuber'e döner ve Hazırsın bunu sakin bir cümleyle
//    söyler (gizliGeriAlindi / yerelGeriAlindi: 'yetmiyor' ölçüldü, 'hazir-degil' ölçülemedi). Düzeltme turu 2: "Yalnız bu bilgisayar"da
//    ölçülemeyen bilgisayar (boş disk dahil) 'olculemedi' — Hazırsın "Bu bilgisayarı ölçemedim" der, "yetmiyor" demez (katalogYetmezligi).
// Motorun hâli yalnız renderer/motor-sinyali.ts'ten.
import { useRef, useState } from 'react';
import { cagir } from '../api';
import { yerelKurulu as yerelKuruluMu, type YerelDurum } from '../bilesenler/YerelKurulum';
import { inenModel, useYerelKatalog, type KatalogDurumu } from '../bilesenler/NeredeSecimi';
import { neredeYamasi, type Nerede } from '../../shared/nerede';
import { katalogSecimi, katalogYetmezligi } from '../../shared/yerel-katalog';
import type { Ayarlar, YerelModelAdi } from '../../shared/tipler';

export type GeriAlma = 'yetmiyor' | 'hazir-degil' | 'olculemedi' | null;
type GizliGeriAlma = Exclude<GeriAlma, 'olculemedi'>;

export interface YerelKarar {
  kd: KatalogDurumu;
  /** Ölçüldü ve hiçbir sürüm uymuyor (kurulu olan da yok): nedeni — Yalnız bu bilgisayar ve Gizli kapalı. */
  uygunDegil: string | null;
  /** İndirme yüzdesi (sürüyorsa). */
  iniyor: number | null;
  /** Bir yerel yapay zekâ kurulu (çalıştırıcı + model). */
  kurulu: boolean;
  /** Ölçüm bekleniyor ("Bilgisayarına bakıyorum…"; Devam kapalı, en çok ~10 sn) — yalnız yerel/Gizli seçiliyken. */
  bekliyor: boolean;
  /** Bu kurulum bir indirme başlattı. */
  baslatildi: boolean;
  gizliGeriAlindi: GizliGeriAlma;
  yerelGeriAlindi: GeriAlma;
  /** Seçili gelecek sürüm: açık seçim uyuyorsa o, değilse kurulu ya da Önerilen (katalogSecimi). */
  model: (acik: YerelModelAdi | null) => YerelModelAdi | null;
  /** Nerede adımından İLERİ çıkarken: uygulanan seçim (hazırlanamıyorsa 'fuber'). */
  uygula: (g: { nerede: Nerede; model: YerelModelAdi | null }) => Nerede;
  /** Kü3: bu kurulumun başlattığı indirme hatayla bitti (ham ileti; İş'te sade metne çevrilir); yoksa null. */
  kurHata: string | null;
  /** Kü3: hatalı indirmeyi aynı seçimle yeniden başlatır. */
  yenidenDene: () => void;
  /** Kü3: önceden istenmiş başka bir sürüm inerken açıkça başka bir sürüm seçildi (o sürüm sürer; Hazırsın söyler). */
  oncekiSurer: { inen: YerelModelAdi; istenen: YerelModelAdi } | null;
}

/** İnen başka bir indirme bitene dek bekler (durdurulan indirmenin işi kapanınca yeni istek reddedilmesin). */
async function inmeyiBekle(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const d = await cagir<YerelDurum>('yerel:durum').catch(() => null);
    if (!d?.inen) return;
    await new Promise((c) => setTimeout(c, 150));
  }
}

export function useYerelKarar(o: {
  ayar: Ayarlar; kaydet: (d: Partial<Ayarlar>) => void; etkin: boolean; adimda: boolean; yerelSecili: boolean;
  /** Ana süreç isteği reddetti (Ö2): seçim Fuber'e döndü — taslak da dönsün. */
  secimDondu?: (n: Nerede) => void;
}): YerelKarar {
  const { ayar, kaydet } = o;
  const kd = useYerelKatalog({ istek: o.etkin, bekle: o.adimda, sade: ayar.mod !== 'gelistirici', islemciZorla: ayar.yerel.gpu === 'cpu' });
  const yd = kd.d;
  const [baslatildi, setBaslatildi] = useState(false);
  const [gizliGeriAlindi, setGizliGeriAlindi] = useState<GizliGeriAlma>(null);
  const [yerelGeriAlindi, setYerelGeriAlindi] = useState<GeriAlma>(null);
  const [kurHata, setKurHata] = useState<string | null>(null);
  const [oncekiSurer, setOncekiSurer] = useState<{ inen: YerelModelAdi; istenen: YerelModelAdi } | null>(null);
  const sonIstek = useRef<{ m: YerelModelAdi; nerede: 'gizli' | 'yerel' } | null>(null);
  const inen = inenModel(yd);
  const kurulu = yerelKuruluMu(yd);
  const katalog = kd.katalog;
  const uygunDegil = kd.olcum === 'hazir' && katalog && !katalog.kartlar.some((k) => k.uygun) ? katalog.neden : null;
  // Açık seçim yoksa: inen sürüm (önceden istenmiş indirme), yoksa kurulu sürüm, yoksa Önerilen.
  const model = (acik: YerelModelAdi | null) => (katalog ? katalogSecimi(katalog, acik ?? inen?.ad ?? (yd?.modeller.find((m) => m.kurulu && m.ad === ayar.yerel.model) ? ayar.yerel.model : null)) : null);

  const yamala = (y: ReturnType<typeof neredeYamasi>, ek: Partial<Ayarlar['yerel']> = {}) => {
    if (y || Object.keys(ek).length) kaydet({ yerel: { ...ayar.yerel, ...(y ?? {}), ...ek } });
  };
  const bekleyenGizli = (v: boolean) => {
    if (ayar.yerel.bekleyenKurulum && Boolean(ayar.yerel.bekleyenKurulum.gizliMod) !== v) void cagir('yerel:bekleyen-gizli', v).catch(() => undefined);
  };
  const durdur = () => { setBaslatildi(false); void cagir('yerel:durdur').catch(() => undefined); };
  /** Arka planda indirme; seçim ana süreçte kayıtla tek yazımda (Kü7). Sonuç yutulmaz (Kü3). */
  const kur = async (m: YerelModelAdi, nerede: 'gizli' | 'yerel', onceDurdur: boolean) => {
    sonIstek.current = { m, nerede };
    setKurHata(null);
    if (onceDurdur) { await cagir('yerel:durdur').catch(() => undefined); await inmeyiBekle(); }
    const r = await cagir<{ tamam: boolean; hata?: string; durduruldu?: boolean; uymuyor?: boolean }>('yerel:kur', m, { ac: true, gizli: nerede === 'gizli', secim: nerede })
      .catch((e: Error) => ({ tamam: false, hata: e.message, durduruldu: false, uymuyor: false }));
    if (r.tamam || r.durduruldu) return;
    if (r.uymuyor) {
      // Ö2: ana süreç bu bilgisayara uymayan sürümü reddetti — hiçbir şey kaydedilmedi; seçim Fuber'e döner, Hazırsın söyler.
      setBaslatildi(false);
      // Düzeltme turu 2: ret nedeni ölçülemeyen diskse "yetmiyor" denmez.
      const neden = katalogYetmezligi(null, r.hata);
      if (nerede === 'gizli') setGizliGeriAlindi(neden === 'olculemedi' ? 'hazir-degil' : neden); else setYerelGeriAlindi(neden);
      o.secimDondu?.('fuber');
      return;
    }
    setKurHata(r.hata || 'kurulamadı');
  };
  const yenidenDene = () => {
    const s = sonIstek.current;
    if (!s) return;
    setBaslatildi(true);
    void kur(s.m, s.nerede, false);
  };

  const uygula = ({ nerede, model: acik }: { nerede: Nerede; model: YerelModelAdi | null }): Nerede => {
    setGizliGeriAlindi(null); setYerelGeriAlindi(null); setOncekiSurer(null); setKurHata(null);
    const gizli = nerede === 'gizli';
    const geriAl = (neden: 'yetmiyor' | 'hazir-degil' | 'olculemedi'): Nerede => {
      if (gizli) setGizliGeriAlindi(neden === 'olculemedi' ? 'hazir-degil' : neden); else setYerelGeriAlindi(neden === 'hazir-degil' ? 'olculemedi' : neden);
      yamala(neredeYamasi('fuber', ayar.yerel, kurulu));
      bekleyenGizli(false);
      if (baslatildi && inen) durdur();
      return 'fuber';
    };
    if (nerede === 'fuber') {
      yamala(neredeYamasi('fuber', ayar.yerel, kurulu));
      bekleyenGizli(false);
      // Yalnız BU kurulumun başlattığı indirme durur (önceden istenmiş bir kuruluma dokunulmaz).
      if (baslatildi && inen) durdur();
      return 'fuber';
    }
    const m = model(acik);
    if (!m || !katalog) return geriAl(kd.olcum === 'hazir' ? katalogYetmezligi(katalog) : 'hazir-degil');
    const kart = katalog.kartlar.find((k) => k.ad === m)!;
    // Takip turu: model dosyası kurulu ama çalıştırıcı yoksa kısayol değil — indirme yolu eksik parçaları onarır.
    if (kart.kurulu && yd?.kurulu.calistirici) {
      // Kurulu sürüm: hemen ona geçilir ve yerel açılır (indirme yok; bu kurulumun başlattığı başka indirme gereksiz).
      yamala(neredeYamasi(nerede, ayar.yerel, true), { ...(ayar.yerel.model !== m ? { model: m } : {}), ...(ayar.yerel.etkin ? {} : { etkin: true }) });
      bekleyenGizli(gizli);
      if (baslatildi && inen && inen.ad !== m) durdur();
      return nerede;
    }
    // İndirilecek: ikisinde de hazır olana dek sohbet bekler (buluta gitmez); indirme ARKA PLANDA.
    if (inen?.ad === m) { yamala(neredeYamasi(nerede, ayar.yerel, kurulu)); bekleyenGizli(gizli); return nerede; } // istenmiş kayıt zaten var
    if (inen && !baslatildi) {
      // Başka (önceden istenmiş) bir indirme sürüyor: ona dokunulmaz — ama açık seçim sessizce yok sayılmaz, Hazırsın söyler (Kü3).
      yamala(neredeYamasi(nerede, ayar.yerel, kurulu)); bekleyenGizli(gizli);
      setOncekiSurer({ inen: inen.ad, istenen: m });
      return nerede;
    }
    setBaslatildi(true);
    void kur(m, nerede, Boolean(inen));
    return nerede;
  };

  return {
    kd, uygunDegil, iniyor: inen?.yuzde ?? null, kurulu,
    bekliyor: o.adimda && o.yerelSecili && kd.olcum === 'bekliyor',
    baslatildi, gizliGeriAlindi, yerelGeriAlindi, model, uygula, kurHata, yenidenDene, oncekiSurer,
  };
}
