// ── Yerel model kurulumu: ortak mantık ve parçalar (Ayarlar → Gizlilik + kurulum sihirbazının "Ekstra gizlilik" adımı) ──
// 0.10 Görev 3 (P2): İş'te adı "bu bilgisayardaki yapay zekâ", Geliştirici'de "yerel model" (shared/terimler.ts).
// Yerel model ilk kurulum ekranında "kişisel ekstra gizlilik ister misiniz" sorusuyla kurulabilir. İki yer AYNI kuralları
// kullanır (Görev 13 düzeltme 2): bu bilgisayarda "Çalışmaz" olan model indirilmez (neden yazılır); 1 GB üstü her indirme boyut ve boş
// diskle onay ister; "İndirmeyi durdur" yarım dosyayı silerek durdurur; ana sürecin hatası (disk doldu, başka indirme sürüyor) iletiyle
// görünür. İndirme ana süreçte sürer (main/yerel/kurulum.ts): sihirbaz kapansa da biter. "Bitince aç" kararı da ana süreçte
// (`yerel:kur(model, { ac: true })`, düzeltme 1): uygulama indirme sürerken kapanırsa istek kaydı kalır ve uygulamada "yarıda kaldı —
// Sürdür / Vazgeç" bildirimi çıkar (YerelBekleyenBildirim); sihirbazdan sonraki hatalar da orada görünür.
// Uygunluk: shared/model-bilgisi.ts → yerelUygunluk (ekran kartı yalnız kullanılabiliyorsa sayılır: yerelMakinesi); önerilen bu
// bilgisayarda rahat çalışan en büyük model (hiçbiri uymuyorsa yok). `sade` (İş modu, K2): model adı, teknik adım adları ve teknik
// hata metni (dosya adı, SHA, adres) yazılmaz — shared/yerel-bekleyen.ts → yerelHataSade.
import { useEffect, useRef, useState } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from './Ikon';
import { useMakine } from './ModelSecici';
import { UYGUNLUK_ADI, enIyiYerel, gbMetni, onerilenYerel, yerelMakinesi, yerelUygunluk, type Makine, type ModelBilgisi, type Uygunluk } from '../../shared/model-bilgisi';
import { MODEL_SUNULMUYOR, bekleyenBildirimi, bitinceAcilirMi, indirmeDuyurusu, yerelHataSade } from '../../shared/yerel-bekleyen';
import { CALISTIRICI_PAYI, ILK_KURULUM_PAYI } from '../../shared/yerel-boyut';
import type { Ayarlar, YerelAyari, YerelModelAdi } from '../../shared/tipler';
import { TERIM, buyukBasla, yerelAdi } from '../../shared/terimler';
import { gizliGeriAlindiMetni } from '../../shared/kurulum-yerel';
import '../ayarlar/yerel-beyin.css';

/** `yerel:durum` (main/yerel/durum.ts). */
export interface YerelDurum {
  etkin: boolean;
  kurulu: { calistirici: boolean; model: boolean; ses: boolean };
  sunucu: { calisiyor: boolean; aciliyor: boolean; hata?: string };
  indirme?: { yuzde: number; adim: string; hata?: string };
  inen?: YerelModelAdi;
  /** Görev 20b: "Kaldır" sürüyor (süren indirme durdurulup beklenir, süreçler kapanır, klasör silinir). */
  kaldiriliyor?: boolean;
  gpu: boolean | null;
  cuda: boolean;
  modeller: { ad: YerelModelAdi; etiket: string; aciklama: string; ozet?: string; dosya?: string; boyut: number; ramGB: number; vramGB?: number; kurulu: boolean; listedenKalkti?: boolean; eskiSurum?: boolean }[];
}
export type YerelModel = YerelDurum['modeller'][number];
export interface IndirmeOnayi { model: YerelModel; bayt: number; gecis: boolean }

const UYGUN_NOKTA: Record<Uygunluk, string> = { rahat: 'yesil', zorlanir: 'turuncu', calismaz: 'kirmizi' };
/** Çalıştırıcı + Piper payı tek yerde (shared/yerel-boyut.ts: indirme ve "Kaldır" onayı aynı sayıyı yazar). */
export { CALISTIRICI_PAYI };
/** Bu boyutun üstündeki indirme onay ister (boyut ve boş disk yazılır). */
const ONAY_ESIGI = 1e9;
export const gb = (b: number) => `${(b / 1e9).toFixed(1).replace('.', ',')} GB`;
export const gereksinim = (m: YerelModel) => ({ boyutGB: m.boyut / 1e9, ramGB: m.ramGB, ...(m.vramGB !== undefined ? { vramGB: m.vramGB } : {}), ...(m.listedenKalkti ? { listedenKalkti: true } : {}) });
/** yerel:durum modelleri → uygunluk hesabının satırları (katalog sırası; öneri boyuta göre sıralar). */
export const yerelBilgileri = (d: Pick<YerelDurum, 'modeller'> | null): ModelBilgisi[] =>
  (d?.modeller ?? []).map((m) => ({ id: m.ad, ad: m.etiket, saglayici: 'yerel', yetenekler: [], yerel: gereksinim(m) }));

/** Bu bilgisayarın en iyi yerel seçeneği (Sistem adımının "Yerel beyin" satırı): ham bilgisayar bilgisi + yerel beynin durumu. */
export function yerelOzeti(b: Makine, d: YerelDurum, gpu: 'otomatik' | 'cpu') {
  const ym = yerelMakinesi(b, { gpu, calistiriciKurulu: d.kurulu.calistirici, cuda: d.cuda });
  return enIyiYerel(yerelBilgileri(d), ym, (id) => Boolean(d.modeller.find((m) => m.ad === id)?.kurulu));
}

// B6 (G15, son düzeltme): kokpitin başındaki "yarıda kaldı" kartı üç IPC (ayarlar, yerel:durum, makine) dönene dek çizilmiyor, sonra
// belirip kokpiti bir kez aşağı itiyordu. Ayarlar ve yerel durum modülde önbelleklenir (modül yüklenince istenir, kalıcı dinleyicilerle
// güncel): kart ilk karede doğru çizilir. Makine bilgisi yalnız "Sürdür"e basınca gerekir, çizimi beklemez.
let sonYerelDurum: YerelDurum | null = null;
let sonAyarlar: Ayarlar | null = null;
if (typeof window !== 'undefined' && window.fuber) {
  dinle('yerel:durum', (v: YerelDurum) => { sonYerelDurum = v; });
  dinle('ayarlar:degisti', (a: Ayarlar) => { sonAyarlar = a; });
  void cagir<YerelDurum>('yerel:durum').then((v) => { sonYerelDurum ??= v; }).catch(() => undefined);
  void cagir<Ayarlar>('ayarlar:al').then((a) => { sonAyarlar ??= a; }).catch(() => undefined);
}

/** Bir yerel yapay zekâ kurulu mu (çalıştırıcı + model). 0.11 G8 düzeltme turu 1: bu kural dört yerde kopyalanmıştı (Gizlilik, ModelYeri, kurulum sayfası, kurulum kancası); TEK yer. */
export const yerelKurulu = (d: Pick<YerelDurum, 'kurulu'> | null | undefined): boolean => Boolean(d?.kurulu.calistirici && d.kurulu.model);

/** `yerel:durum` ilk değer + canlı değişiklikler. */
export function useYerelDurum(): YerelDurum | null {
  const [d, setD] = useState<YerelDurum | null>(sonYerelDurum);
  useEffect(() => {
    void cagir<YerelDurum>('yerel:durum').then((v) => { sonYerelDurum = v; setD(v); }).catch(() => null);
    return dinle('yerel:durum', (v: YerelDurum) => setD(v));
  }, []);
  return d;
}

/**
 * Kurulum mantığı. `y`: yerel beyin ayarı (gpu: uygunlukta kart sayılır mı); `ad`: kartın/onayın adı (İş modunda "Yerel beyin");
 * `baslarken(m, gecis)`: indirme gerçekten başlarken (onaydan sonra; onayda "Vazgeç" hiçbir şey yazmaz); `ac(gecis)`: doğrulanmış
 * kurulumdan sonra yerel beyin açılsın mı — ana süreç açar ve isteği kaydeder (yarıda kalırsa bildirim). `gecis`: çalıştırıcı zaten
 * kurulu, inen modele geçilecek. `sade`: hata iletileri teknik sözcüksüz (İş modu).
 */
export function useYerelKurulum({ y, ad, baslarken, ac, gizli, secim, sonuc, sade = false }: {
  /** Ayar henüz gelmediyse undefined (uygunluk "Otomatik" işlemciyle hesaplanır). */
  y: YerelAyari | null | undefined; ad: (m: YerelModel) => string; baslarken?: (m: YerelModel, gecis: boolean) => void; ac: (gecis: boolean) => boolean; sade?: boolean;
  /** 0.12 H3c (Ayarlar → Nerede çalışsın): bitince Gizli mod da açık kalsın mı (yerel:kur `gizli`); verilmezse ana süreç önceki seçimi korur. */
  gizli?: () => boolean | undefined;
  /** H3c düzeltme turu 1 (Kü7): "Nerede çalışsın" seçimi — ana süreç istenen kurulumun kaydıyla AYNI yazımda kaydeder (yerel:kur `secim`). */
  secim?: () => 'gizli' | 'yerel' | undefined;
  /** yerel:kur sonucu (reddedildi, durdu, bitti). */
  sonuc?: (r: { tamam: boolean; hata?: string; durduruldu?: boolean }) => void;
}) {
  const d = useYerelDurum();
  const makine = useMakine();
  const [onay, setOnay] = useState<IndirmeOnayi | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const bilgiler = yerelBilgileri(d);
  const ym = makine && d ? yerelMakinesi(makine, { gpu: y?.gpu ?? 'otomatik', calistiriciKurulu: d.kurulu.calistirici, cuda: d.cuda }) : null;
  const kuruluMu = (id: string) => Boolean(d?.modeller.find((m) => m.ad === id)?.kurulu);
  const uygunluk = (m: YerelModel) => (ym ? yerelUygunluk(gereksinim(m), ym, { kurulu: m.kurulu }) : null);
  const bosDisk = makine?.bosDiskGB !== undefined && Number.isFinite(makine.bosDiskGB) ? makine.bosDiskGB : undefined;

  const ileti = (h: string) => (sade ? yerelHataSade(h) : h);
  /** İndirmeyi başlatır (onaydan sonra). Açma ana süreçte (bileşen bu arada kapanmış olabilir: sihirbaz bitti); burada yalnız ileti. */
  const baslat = async (m: YerelModel, gecis: boolean) => {
    setOnay(null); setMesaj(null);
    baslarken?.(m, gecis);
    try {
      const g = gizli?.();
      const s = secim?.();
      const r = await cagir<{ tamam: boolean; hata?: string; durduruldu?: boolean }>('yerel:kur', m.ad, { ac: ac(gecis), ...(typeof g === 'boolean' ? { gizli: g } : {}), ...(s ? { secim: s } : {}) });
      if (!r.tamam && !r.durduruldu && r.hata) setMesaj(ileti(r.hata));
      sonuc?.(r);
    } catch (e) { setMesaj(ileti((e as Error).message)); sonuc?.({ tamam: false, hata: (e as Error).message }); } // ör. telefondan: kanal kapalı
  };
  /** Kurulu olmayan model için indirme isteği: bu bilgisayarda çalışmıyorsa nedeniyle durur; 1 GB üstü onay ister. */
  const indirmeIste = (m: YerelModel, gecis: boolean) => {
    setMesaj(null);
    const u = uygunluk(m);
    if (u?.durum === 'calismaz') { setMesaj(`${ad(m)} bu bilgisayarda çalışmaz, indirilmedi: ${u.neden}.`); setOnay(null); return; }
    const bayt = m.boyut + (d?.kurulu.calistirici ? 0 : ILK_KURULUM_PAYI);
    if (bayt > ONAY_ESIGI) { setOnay({ model: m, bayt, gecis }); return; }
    void baslat(m, gecis);
  };
  return {
    d, makine, ym, uygunluk, bosDisk, onay, setOnay, mesaj, setMesaj, baslat, indirmeIste,
    /** Bilgisayar bilgisi gelmeden ya da hiçbir model uymuyorsa yok. */
    onerilen: ym ? onerilenYerel(bilgiler, ym, kuruluMu) : undefined,
    /** Bu bilgisayarın en iyi seçeneği (hiçbiri uymuyorsa id yok, en hafifin nedeni). */
    enIyi: ym ? enIyiYerel(bilgiler, ym, kuruluMu) : undefined,
    kurulu: yerelKurulu(d),
    kuruluyor: Boolean(d?.indirme && !d.indirme.hata && d.indirme.yuzde < 100),
    /** İndirilecek bayt (ilk kurulumda çalıştırıcı + ses payıyla). */
    indirilecek: (m: YerelModel) => m.boyut + (d?.kurulu.calistirici ? 0 : ILK_KURULUM_PAYI),
  };
}

/** Model kartı: ad, açıklama, disk/bellek/ekran kartı gereksinimi, kurulum durumu ve bu bilgisayara uygunluk. `sec` yoksa yalnız
 *  bilgi kartıdır (seçilecek bir şey yok: İş modunda tek seçenek). `sade`: model adı yerine "Yerel beyin". `ilkKurulum`: henüz hiçbir
 *  şey kurulu değil — inen kartta "bitince bu modele geçilir" denmez (geçilecek bir model yok). */
export function YerelModelKarti({ m, u, onerilen, secili, iniyor, ilkKurulum, indirilecek, kilitli, sade, sec }: {
  m: YerelModel; u: { durum: Uygunluk; neden: string } | null; onerilen?: boolean; secili?: boolean; iniyor?: boolean; ilkKurulum?: boolean;
  /** İndirilecek toplam bayt (ilk kurulumda çalıştırıcı + ses payıyla): "Kur · X GB" düğmesiyle aynı boyut yazılır. */
  indirilecek?: number; kilitli?: boolean; sade?: boolean; sec?: () => void;
}) {
  const ekPay = indirilecek !== undefined && indirilecek > m.boyut + 1e6;
  const icerik = (
    <>
      <b>{sade ? buyukBasla(TERIM.yzYerel) : m.etiket}{onerilen && <span className="yb__oneri">önerilen</span>}</b>
      <span>{m.aciklama}</span>
      <small>{gb(m.boyut)} disk · {gbMetni(m.ramGB)} bellek · {m.vramGB !== undefined ? `ekran kartı ${gbMetni(m.vramGB)}` : 'ekran kartı gerekmez'}</small>
      <span className="yb__kurulum" data-kurulu={m.kurulu ? '' : undefined} data-kurulum-durum={m.kurulu ? 'kurulu' : iniyor ? 'iniyor' : 'gerekir'}>
        {m.kurulu ? <><Ikon ad="tamam" olcu={13} />Kurulu</>
          : iniyor ? <><Ikon ad="ice" olcu={13} />{sade || ilkKurulum ? 'İndiriliyor' : 'İndiriliyor; bitince bu modele geçilir'}</>
          : <><Ikon ad="ice" olcu={13} />{ekPay ? `İndirilmesi gerekir (${gb(indirilecek!)}, kurulum dosyalarıyla)` : `İndirilmesi gerekir (${gb(m.boyut)})`}</>}
      </span>
      {u && <span className="yb__uygun" data-durum={u.durum}><i className={`nokta nokta--${UYGUN_NOKTA[u.durum]}`} aria-hidden="true" /><b>{UYGUNLUK_ADI[u.durum]}</b><em>{u.neden}</em></span>}
    </>
  );
  const ortak = { className: 'yb__model', 'data-model': m.ad, 'data-uygunluk': u?.durum, 'data-kurulu': m.kurulu ? '' : undefined };
  if (!sec) return <div {...ortak} data-sabit="">{icerik}</div>;
  return <button type="button" {...ortak} aria-pressed={Boolean(secili)} onClick={sec} disabled={kilitli}>{icerik}</button>;
}

/** 1 GB üstü indirme onayı: boyut ve boş disk; odak "İndir"de. `ek`: aradaki cümle (ör. şimdiki model çalışmaya devam eder). */
export function IndirmeOnayKutusu({ onay, ad, bosDisk, ek = '', vazgec, indir }: {
  onay: IndirmeOnayi; ad: string; bosDisk?: number; ek?: string; vazgec: () => void; indir: () => void;
}) {
  const dugme = useRef<HTMLButtonElement>(null);
  useEffect(() => { dugme.current?.focus({ preventScroll: true }); }, [onay]);
  return (
    <div className="yb__onay ic-kutu" role="group" aria-label="İndirme onayı" data-onay={onay.model.ad}>
      <div className="yb__onay-metin">
        <b>{ad} indirilsin mi?</b>
        <span>Yaklaşık {gbMetni(onay.bayt / 1e9)} indirilecek{bosDisk !== undefined ? `; diskte ${gbMetni(bosDisk)} boş` : ''}.{ek} İstediğin an durdurabilirsin.</span>
      </div>
      <div className="yb__onay-dugmeler">
        <button type="button" className="dgm dgm--hayalet dgm--k" onClick={vazgec}>Vazgeç</button>
        <button ref={dugme} type="button" className="dgm dgm--beyaz dgm--k" onClick={indir}><Ikon ad="ice" olcu={14} />İndir · {gbMetni(onay.bayt / 1e9)}</button>
      </div>
    </div>
  );
}

/** İlerleme çubuğu + adım + "İndirmeyi durdur". `sade` (İş modu): teknik adım adı (çalıştırıcı, model adı) ve teknik hata yazılmaz.
 *  B6: görünen metin canlı bölge DEĞİL (300 ms'de bir yenilenir); ekran okuyucu yalnız %10 adımlarını ve durum değişimini duyar. */
export function IndirmeDurumu({ indirme, kuruluyor, sade }: { indirme: NonNullable<YerelDurum['indirme']>; kuruluyor: boolean; sade?: boolean }) {
  const metin = indirme.hata ? (sade ? `Kurulum durdu: ${yerelHataSade(indirme.hata)}` : `${indirme.adim}: ${indirme.hata}`)
    : sade ? (indirme.yuzde >= 100 ? `${buyukBasla(TERIM.yzYerel)} kuruldu` : `${buyukBasla(TERIM.yzYerel)} indiriliyor · %${indirme.yuzde}`)
    : `${indirme.adim} · %${indirme.yuzde}`;
  return (
    <div className="yb__indirme" data-indirme="">
      <span className="yb__duyuru" role="status" aria-live="polite" data-indirme-duyurusu="">{indirmeDuyurusu(indirme, Boolean(sade))}</span>
      <div className="yb__cubuk" role="progressbar" aria-label={`${buyukBasla(yerelAdi(Boolean(sade)))} indirmesi`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indirme.yuzde}><i style={{ width: `${indirme.yuzde}%` }} /></div>
      <div className="yb__indirme-satir">
        <span className={indirme.hata ? 'yb__hata' : ''} aria-hidden="true">{metin}</span>
        {kuruluyor && <button type="button" className="dgm dgm--hayalet dgm--k yb__durdur" onClick={() => void cagir('yerel:durdur')}><Ikon ad="kapat" olcu={14} />İndirmeyi durdur</button>}
      </div>
    </div>
  );
}

/**
 * F1 (son inceleme Ö1): Gizli mod kendiliğinden kapandı (bu bilgisayardaki yapay zekâ hazır değilken bekleyen kurulumdan vazgeçildi ya da
 * kurulum kalıcı hatayla bitti; main/yerel/gizli-geri-al.ts). Kokpitin başında TEK sakin cümle (shared/kurulum-yerel.ts
 * gizliGeriAlindiMetni) + "Tamam" (yerel:gizli-notu-kapat). Gizli yeniden açılınca görünmez (ana süreç notu da siler).
 */
export function GizliGeriAlindiNotu() {
  const [a, setA] = useState<Ayarlar | null>(sonAyarlar);
  useEffect(() => {
    void cagir<Ayarlar>('ayarlar:al').then((x) => { sonAyarlar = x; setA(x); }).catch(() => null);
    return dinle('ayarlar:degisti', (x: Ayarlar) => setA(x));
  }, []);
  const neden = a?.yerel?.gizliGeriAlindi;
  if (!a || !neden || a.yerel.gizliMod) return null;
  return (
    <div className="yb-bekleyen" role="status" aria-live="polite" data-gizli-geri-alindi={neden}>
      <span className="yb-bekleyen__simge"><Ikon ad="kilit" olcu={17} /></span>
      <div className="yb-bekleyen__metin"><span>{gizliGeriAlindiMetni(neden, a.mod === 'gelistirici' ? 'gelistirici' : 'is')}</span></div>
      <div className="yb-bekleyen__dugmeler">
        <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => void cagir('yerel:gizli-notu-kapat').catch(() => undefined)} data-gizli-notu-kapat="">Tamam</button>
      </div>
    </div>
  );
}

/**
 * İstenmiş yerel beyin kurulumunun kartı (kural: shared/yerel-bekleyen.ts → bekleyenBildirimi). Sayfanın AKIŞINDA çizilir — kokpitin
 * başında ve Ayarlar → Gizlilik'te; hiçbir sayfanın denetimlerinin üstüne binmez (düzeltme 2).
 *  - iniyor (yalnız `iniyorGoster`; kokpit): istenen indirme arka planda sürüyor — ilerleme + "İndirmeyi durdur".
 *  - yarim: uygulama indirme sürerken kapandı — "Sürdür / Vazgeç". hata: sihirbazdan sonra kurulum hata verdi — "Yeniden dene / Vazgeç".
 * "Sürdür" / "Yeniden dene" sihirbaz ve Ayarlar'la AYNI yoldan gider (useYerelKurulum.indirmeIste): bu bilgisayarda çalışmayan (ör. diske
 * sığmayan) model indirilmez, 1 GB üstü onay ister; bitince yerel beyni ana süreç açar. Ana süreç ayrıca diske bakar. "Vazgeç" kaydı ve
 * yarım dosyaları siler. İş modunda model adı ve teknik hata metni yok.
 */
export function YerelBekleyenBildirim({ iniyorGoster = true }: { iniyorGoster?: boolean }) {
  const [a, setA] = useState<Ayarlar | null>(sonAyarlar);
  useEffect(() => {
    void cagir<Ayarlar>('ayarlar:al').then((x) => { sonAyarlar = x; setA(x); }).catch(() => null);
    return dinle('ayarlar:degisti', (x: Ayarlar) => setA(x));
  }, []);
  const sade = a ? a.mod !== 'gelistirici' : true;
  const yerel = yerelAdi(sade);
  const adi = (m: YerelModel) => (sade ? buyukBasla(TERIM.yzYerel) : m.etiket);
  const k = useYerelKurulum({ y: a?.yerel, ad: adi, ac: () => true, sade });
  const { d, onay, setOnay, mesaj, setMesaj } = k;
  const b = bekleyenBildirimi(a?.yerel?.bekleyenKurulum, d);
  if (!a || !d || !b || (b.tur === 'iniyor' && !iniyorGoster)) return null;
  const m = d.modeller.find((x) => x.ad === b.model);
  const ad = m ? adi(m) : buyukBasla(yerel);
  const surdur = () => { if (m) k.indirmeIste(m, d.kurulu.calistirici); };
  const vazgec = () => { setOnay(null); setMesaj(null); void cagir('yerel:bekleyen-vazgec'); };
  const baslik = b.tur === 'iniyor' ? `${ad} indiriliyor` : b.tur === 'hata' ? `${ad} kurulamadı` : `${ad} indirmesi yarıda kaldı`;
  // B6: "bitince açılır" yalnız gerçekten açılacaksa (ana süreçle aynı kural): indirme başlarken açık olan yerel beyni kullanıcı sonradan
  // elle kapattıysa kurulum biter ama yerel beyin açılmaz — metin bunu söyler.
  const istek = a.yerel?.bekleyenKurulum;
  const acilir = istek ? bitinceAcilirMi(istek, Boolean(a.yerel?.etkin)) : true;
  const bitince = acilir ? `bitince ${yerel} açılır` : `bitince kurulu olur; ${yerel}${sade ? 'yı' : 'i'} sen kapattığın için kapalı kalır`;
  const metin = b.tur === 'iniyor' ? `Arka planda sürer; ${acilir ? `bitince ${yerel} kendiliğinden açılır` : `bitince kurulu olur; ${yerel} kapalı kalır`}.`
    : b.tur === 'hata' ? (sade ? yerelHataSade(b.hata) : b.hata)
    // 0.13 G: yarıda kalan model bu arada listeden kalktı: "Sürdür" kapalı, kart nedenini söyler.
    : !m ? (sade ? yerelHataSade(MODEL_SUNULMUYOR) : MODEL_SUNULMUYOR)
    : `Uygulama kapanınca indirme durdu. Sürdürürsen bitmiş parçalar yeniden inmez; ${bitince}.`;
  return (
    // B6: canlı bölge yalnız "yarıda kaldı" / "kurulamadı" kartında; inerken duyuruyu IndirmeDurumu'nun seyrek duyurusu yapar.
    <div className="yb-bekleyen" role={b.tur === 'iniyor' ? 'group' : 'status'} aria-live={b.tur === 'iniyor' ? undefined : 'polite'} aria-label={b.tur === 'iniyor' ? baslik : undefined} data-yerel-bekleyen={b.tur}>
      <span className="yb-bekleyen__simge" data-tur={b.tur}><Ikon ad={b.tur === 'hata' ? 'uyari' : 'ice'} olcu={17} /></span>
      <div className="yb-bekleyen__metin">
        <b>{baslik}</b>
        <span>{metin}</span>
      </div>
      {b.tur !== 'iniyor' && !onay && (
        <div className="yb-bekleyen__dugmeler">
          <button type="button" className="dgm dgm--hayalet dgm--k" onClick={vazgec} data-bekleyen-vazgec="">Vazgeç</button>
          <button type="button" className="dgm dgm--beyaz dgm--k" disabled={!m} onClick={surdur} data-bekleyen-surdur="">
            <Ikon ad={b.tur === 'hata' ? 'yenile' : 'ice'} olcu={14} />{b.tur === 'hata' ? 'Yeniden dene' : 'Sürdür'}
          </button>
        </div>
      )}
      {b.tur === 'iniyor' && d.indirme && <div className="yb-bekleyen__alt"><IndirmeDurumu indirme={d.indirme} kuruluyor sade={sade} /></div>}
      {onay && (
        <div className="yb-bekleyen__alt">
          <IndirmeOnayKutusu onay={onay} ad={adi(onay.model)} bosDisk={k.bosDisk} ek={acilir ? ` Bitince ${yerel} açılır.` : ` Bitince kurulu olur; ${yerel} kapalı kalır (sen kapatmıştın).`} vazgec={() => setOnay(null)} indir={() => void k.baslat(onay.model, onay.gecis)} />
        </div>
      )}
      {mesaj && <p className="yb__mesaj yb-bekleyen__alt" role="status" data-bekleyen-mesaj="">{mesaj}</p>}
    </div>
  );
}
