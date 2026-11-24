// ── Pano kartları (Görev 24, K14 → 0.11 G5): gündem bandı + doldurucular (hava, haberler, döviz, öneriler, hızlı işler) ─────────────
// 27 Eki: ana sayfadaki kutucuklar (hava durumu, haberler, hatırlatıcılar) tutarsız görünüyor, metinler bazen
// taşıyordu; araç kartları da öyle. 0.11 G5: her kart kütüphanenin Kart'ıdır (src/renderer/ui) — macOS widget'ı
// gibi sakin başlık solda, tek eylem sağda ("Tümü", "Şehrini seç"), tek büyük birincil değer, soluk ve küçük ikincil yazı, cömert iç
// boşluk; kartın içinde kaydırma çubuğu YOK: kart sığanı gösterir (sigdir.ts ölçer), fazlası başlıktaki "Tümü" levhasında (TumuLevhasi).
// Veri gelince yerleşim KAYMAZ (kartın kutusu ızgaradan; iskelet son içeriğin yerinde); çevrimdışında son veri yaşıyla ("Çevrimdışı · 3 sa
// önce"); F1: Gizli modda pano ağa çıkmaz — kart önbelleği "Gizli mod · …" yaşıyla, önbellek yoksa "Gizli modda güncellenmiyor" der.
// KK-1: Fuber'e iş veren bütün istemler shared/kokpit-istemleri.ts'ten (Gizli'de araç isteyen önerilmez). Bütün metinler İş dilinde.
import { BUGUN_EN_COK, KONU_EN_COK, bantHaberleri } from '../../shared/kokpit-tekil';
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Bos, Dugme, Iskelet, Kart, Liste, MetinKirp, Satir, Sayi } from '../ui';
import { HavaSimgesi } from './HavaSimgesi';
import { useDakika } from './usePano';
import { satirSayisi, sayiPlani, useGenislik, useSigdir } from './sigdir';
import { TumuLevhasi, useTumu } from './TumuLevhasi';
import { gundemOgeleri, geceGelenler, gunIlerlemesi, haftaNumarasi, type Gundem, type GundemOgesi } from '../../shared/gundem';
import { havaMetni, havaSimgesi, gunesSaatleri, yasMetni, PARA_ADI, type Haber, type HavaVerisi, type KurSatiri, type PanoDurumu, type PanoKaynak, type PanoKonumu, type PiyasaVerisi } from '../../shared/pano';
import { altlikSigar } from '../../shared/pano-duzen';
import { acikYapilacaklar } from '../../shared/yapilacaklar';
import { iyelikEki } from '../../shared/sayi-okuma';
import { ACIK_GUN_ONERILERI, ARAC_KITI, IPUCU_ONERILERI, altlikOnerisi, istemDugmeleri, istemOnerilir, oneriListesi, toplantiEpostasi, type Istem, type IstemOnerisi } from '../../shared/kokpit-istemleri';
import type { Boy } from '../../shared/izgara';
import type { Ayarlar, KartTipi, KokpitVerisi } from '../../shared/tipler';
import './pano.css';

type Sor = (istem: Istem) => void;
type Git = (sayfa: string, id?: number) => void;
/** Izgara hücresinin öznitelikleri (konum, önem, görünüm geçişi, parıltı): Kokpit verir, kart Kart'ın köküne geçirir. */
export type Hucre = Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'>;
const ac = (link: string) => void cagir('tarayici:goster', link);

/** 0.10 Görev 2 (A-38): motor yokken (gönderim kapalı) Fuber'e iş veren düğmelerin ipucu — ne zaman çalışacağı ("Fuber hesabına giriş
 *  yapınca çalışır"); tıklama Kokpit'in `sor`unda Fuber hesabı penceresini açar. Motor varken undefined (ipucu yok). Kokpit sağlar. */
export const MotorIpucu = createContext<string | undefined>(undefined);
/** Gizli mod açık mı (hazır ya da hazırlanırken; Kokpit sağlar). YALNIZ Gizli'nin KENDİ sözleri içindir (ör. "Takvimin bugün açık" kartının nötr
 *  cümlesi: "Gizli modda …"). Bu bağlamı Gizli dışı bir durumla doldurma — araç isteyen istemleri süzmek için `AracsizMod` var. */
export const GizliMod = createContext(false);
/** F1 düzeltme turu 2 (KK-1) + 0.11 G8 (K3): bu turlarda araç yok mu (Gizli YA DA "Yalnız bu bilgisayardaki yapay zekâ"; Kokpit sağlar:
 *  shared/kokpit-istemleri.ts aracsizMi). Kartlar istemlerini ortak kuraldan süzer: araç isteyen istem önerilmez, yerine araçsız olanlar gelir. */
export const AracsizMod = createContext(false);
/** Motor gerektiren düğmenin ek öznitelikleri (ipucu + işaret) — Dugme'ye doğrudan, Satir'a `ipucu` + data-motor-gerekli olarak. */
export function useMotorGerekli(): { title?: string; 'data-motor-gerekli'?: '' } {
  const ipucu = useContext(MotorIpucu);
  return ipucu ? { title: ipucu, 'data-motor-gerekli': '' } : {};
}
/** Satir için: tıklanan satır motor gerektiriyorsa ipucu ve işaret. */
export function satirMotoru(mg: { title?: string; 'data-motor-gerekli'?: '' }): { ipucu?: string; 'data-motor-gerekli'?: string } {
  return mg.title ? { ipucu: mg.title, 'data-motor-gerekli': '' } : {};
}
export const saat = (iso: string | number | Date) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

/** Kaynağın yaşı: "12 dk önce"; çevrimdışında "Çevrimdışı · 3 sa önce"; Gizli modda (F1 K1: pano ağa çıkmaz) "Gizli mod · 3 sa önce". */
function yas(k: PanoKaynak<unknown>): string {
  if (!k.zaman) return '';
  const y = yasMetni(k.zaman);
  return k.gizli ? `Gizli mod · ${y}` : k.cevrimdisi ? `Çevrimdışı · ${y}` : y;
}
/** F1 (K1): Gizli modda önbelleği olmayan kaynak kartının sakin cümlesi. */
const GIZLI_GUNCELLENMIYOR = 'Gizli modda güncellenmiyor';

/** Kartın dipnotu (kaynak, yaş, durum): tek satır, soluk; uzunsa … ile biter (tamamı title'da). */
function Dipnot({ metin, gizli }: { metin: string; gizli?: boolean }) {
  if (!metin) return null;
  return <div className="pano-dipnot" data-pano-gizli={gizli ? '' : undefined}><MetinKirp metin={metin} satir={1} /></div>;
}

// ── Gündem bandı ────────────────────────────────────────────────────────────────────────────────────────────────────
const GUNDEM_TUR: Record<GundemOgesi['tur'], string> = { hatirlatici: 'Hatırlatıcı', gorev: 'Yapılacak', toplanti: 'Toplantı', mesele: 'Takip edilecek' };

function ogeZamani(o: GundemOgesi, kip: 'bugun' | 'siradaki'): string {
  // 11 Kas (bulgu 13): Bugün bandında "20 sa önce" değil — bugün geldiyse saati, dün geldiyse "Dün".
  if (o.tur === 'toplanti') return o.zaman ? (new Date(o.zaman).toDateString() === new Date().toDateString() ? saat(o.zaman) : 'Dün') : 'e-posta';
  if (o.gecikti) return 'Gecikti';
  if (o.tur === 'mesele') return kip === 'bugun' ? 'Bugün' : new Date(`${o.zaman}T12:00:00`).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' });
  if (!o.zaman) return '';
  return kip === 'bugun' ? saat(o.zaman) : `${new Date(o.zaman).toLocaleDateString('tr-TR', { weekday: 'short' })} ${saat(o.zaman)}`;
}

/** Bandın bir yarısının başlığı: kart başlığıyla aynı yazı ve yer; sağda sakin not (gün, yaş). */
function BolumBasi({ baslik, sayi, not }: { baslik: string; sayi?: number; not?: ReactNode }) {
  return (
    <header className="gundem__bas">
      <h3 className="gundem__bolum-adi">{baslik}</h3>
      {sayi ? <span className="gundem__sayi"><Sayi deger={sayi} /></span> : null}
      {not ? <span className="gundem__not ui-kirp" data-kirp="1">{not}</span> : null}
    </header>
  );
}

/** Bant en çok bu kadar kayıt gösterir; sığmazsa ölçüm azaltır (önce alt yazılar, sonra kayıtlar). Fazlası kendi kartlarında. */
// (shared/kokpit-tekil.ts: kartlar bandın gösterdiğini yinelemesin diye aynı sayılar orada.)

export function GundemBandi({ v, pano, sor, ...hucre }: { v: KokpitVerisi; pano: PanoDurumu; sor: Sor } & Hucre) {
  let g: Gundem;
  try { g = gundemOgeleri(v); } catch { g = { kip: 'bos', ogeler: [], toplam: 0 }; }
  // 0.13 T15 (Spec I, "Gece ne değişti"): sessiz saatlerde (Ayarlar → Kendiliğinden yazma) gelen e-posta ve mesaj sayısı. WhatsApp'ta yalnız
  // sohbetin son mesajının zamanı bilinir: okunmamışı olan her sohbet bir kez sayılır.
  const [sessiz, setSessiz] = useState<{ bas: string; bit: string } | null>(null);
  useEffect(() => { void cagir<Ayarlar>('ayarlar:al').then((a) => setSessiz({ bas: a.proaktif.sessizBaslangic, bit: a.proaktif.sessizBitis })).catch(() => undefined); }, []);
  const gece = sessiz
    ? geceGelenler(Date.now(), sessiz, [...v.epostalar.map((e) => ({ zaman: e.tarih })), ...v.whatsapp.filter((w) => w.okunmamis > 0).map((w) => ({ zaman: w.zaman }))])
    : 0;
  const gunAdi = new Date().toLocaleDateString('tr-TR', { weekday: 'long' });
  const not = g.kip === 'siradaki'
    ? <><span className="gundem__not-on">Bugün bekleyen yok · </span>önümüzdeki 7 gün</>
    : gece > 0 ? <><span className="gundem__not-on">Gece {gece} yeni ileti · </span>{gunAdi}</> : gunAdi;
  return (
    <Kart {...hucre} aria-label={hucre['aria-label'] ?? 'Gündem'}>
      <div className="gundem" data-gundem-kip={g.kip}>
        <section className="gundem__bolum gundem__bugun" aria-label={g.kip === 'siradaki' ? 'Sıradaki' : 'Bugün'}>
          <BolumBasi baslik={g.kip === 'siradaki' ? 'Sıradaki' : 'Bugün'} sayi={g.toplam} not={not} />
          {g.kip === 'bos' ? <AcikGun pano={pano} sor={sor} /> : <BugunListesi g={g} sor={sor} />}
        </section>
        <section className="gundem__bolum gundem__sag" aria-label="Gündemde">
          <GundemSag v={v} pano={pano} />
        </section>
      </div>
    </Kart>
  );
}

function BugunListesi({ g, sor }: { g: Gundem; sor: Sor }) {
  const ref = useRef<HTMLDivElement>(null);
  const mg = useMotorGerekli();
  const aracsiz = useContext(AracsizMod);
  const T = Math.min(g.ogeler.length, BUGUN_EN_COK);
  // Adım 0: kayıtlar alt yazılarıyla (tür · ayrıntı); 1: alt yazısız; sonra birer kayıt eksilir.
  const adim = useSigdir(ref, T, g.ogeler.map((o) => o.id).join(','), true);
  const altli = adim === 0;
  const n = satirSayisi(adim, T, 1);
  const kip = g.kip === 'siradaki' ? 'siradaki' : 'bugun';
  return (
    <div ref={ref} className="gundem__govde">
      <Liste>
        {g.ogeler.slice(0, n).map((o) => {
          // Toplantı e-postası tıklanınca Fuber okuyup özetler (araç ister: Gizli'de satır tıklanmaz — KK-1).
          const istem = o.tur === 'toplanti' ? toplantiEpostasi(o.kayit) : null;
          const tik = istem && istemOnerilir(istem, aracsiz) ? () => sor(istem) : undefined;
          // 11 Kas (tasarımcı bulgu 6): Bugün bandı tek "Bugün" listesi — bandda görünen hatırlatıcı ve yapılacak kartlarda yinelenmez, bu yüzden
          // burada da tamamlanır (kartlardaki ✓ ile aynı IPC). İşaretlenen yapılacak bugün kartta üstü çizili görünür.
          const tamam = o.tur === 'gorev' ? () => void cagir('plan:gorev', o.kayit, { durum: 'tamam' })
            : o.tur === 'hatirlatici' ? () => void cagir('plan:hatirlatici', o.kayit, { durum: 'tamam' }) : null;
          return (
            <Satir key={o.id} sol={ogeZamani(o, kip)} baslik={o.baslik} alt={altli ? [GUNDEM_TUR[o.tur], o.alt].filter(Boolean).join(' · ') : undefined}
              sag={tamam ? <Dugme tur="hayalet" boyut="k" simge="tamam" aria-label={`Tamamlandı: ${o.baslik}`} data-gundem-tamam="" onClick={tamam} /> : undefined}
              tikla={tik} data-gecikti={o.gecikti ? '' : undefined} data-gundem-oge={o.tur} {...(tik ? satirMotoru(mg) : {})} />
          );
        })}
      </Liste>
      {g.toplam > n && <p className="gundem__daha">+{g.toplam - n} daha · kartlarda</p>}
    </div>
  );
}

/** Takvim boşken bandın sol yarısı boş kalmaz: günün ilerleyişi, güneş, hafta ve tek dokunuşla plan kurma. */
function AcikGun({ pano, sor }: { pano: PanoDurumu; sor: Sor }) {
  const simdi = new Date(useDakika()); // dakikada bir: günün ilerleyişi kendi bileşeninde ilerler
  const ilerleme = Math.round(gunIlerlemesi(simdi.getTime()) * 100);
  const g = gunesSaatleri(simdi, pano.konum.enlem, pano.konum.boylam);
  const mg = useMotorGerekli();
  // KK-1: araçsız turda (Gizli ya da yalnız yerel) üç çip de araç ister (plan, hatırlatıcı, iş) — gizlenir, yerlerinde tek nötr cümle kalır
  // (shared/kokpit-istemleri.ts). G8 düzeltme turu 2: cümle GERÇEK Gizli'ye göre — yalnız yerelde "Gizli modda …" denmez.
  const { gorunen, not } = istemDugmeleri(ACIK_GUN_ONERILERI, useContext(AracsizMod), useContext(GizliMod));
  return (
    <div className="acik-gun">
      <p className="acik-gun__baslik">Takvimin bugün açık</p>
      <p className="acik-gun__alt">Bekleyen hatırlatıcı, toplantı ya da iş yok.{gorunen.length ? ' Birkaç saniyede planlayabilirsin.' : ''}</p>
      <div className="acik-gun__cipler">
        {gorunen.map((o) => <Dugme key={o.etiket} tur="ikincil" boyut="k" simge={o.simge} {...mg} onClick={() => sor(o.istem)}>{o.etiket}</Dugme>)}
        {not && <span className="acik-gun__not">{not}</span>}
      </div>
      <div className="acik-gun__alt-blok">
        <div className="acik-gun__cizgi" role="img" aria-label={`Günün yüzde ${ilerleme}’${iyelikEki(ilerleme)} geride`}>
          <span style={{ width: `${ilerleme}%` }} />
        </div>
        <div className="acik-gun__bilgi">
          <span>Günün %{ilerleme}’{iyelikEki(ilerleme)} geride</span>
          <span className="acik-gun__hafta">{haftaNumarasi(simdi.getTime())}. hafta</span>
          {g.batis && <span>Gün batımı {saat(g.batis)}</span>}
        </div>
      </div>
    </div>
  );
}

function GundemSag({ v, pano }: { v: KokpitVerisi; pano: PanoDurumu }) {
  const k = pano.gundem;
  const h = pano.haberler;
  const konular = k.durum === 'hazir' ? (k.veri ?? []) : [];
  const haberler = h.durum === 'hazir' ? (h.veri ?? []) : [];
  const ref = useRef<HTMLDivElement>(null);
  const kayitlar = konular.length ? konular.length : haberler.length;
  const T = Math.min(kayitlar, KONU_EN_COK);
  const adim = useSigdir(ref, Math.max(0, T - 1), `${konular.map((t) => t.ad).join(',')}|${haberler.slice(0, 3).map((x) => x.id).join(',')}`, true);
  const n = satirSayisi(adim, T);
  if (konular.length) {
    return (
      <>
        <BolumBasi baslik="Gündemde" not={yas(k)} />
        <div ref={ref} className="gundem__govde">
          <Liste>
            {konular.slice(0, n).map((t) => (
              <Satir key={t.ad} baslik={t.ad} alt={t.ornek.baslik} sag={t.kaynakSayisi > 1 ? `${t.kaynakSayisi} kaynak` : `${t.haberSayisi} haber`}
                tikla={() => ac(t.ornek.link)} data-gundem-konu={t.ad} />
            ))}
          </Liste>
        </div>
      </>
    );
  }
  if (k.durum === 'yukleniyor') {
    return (<><BolumBasi baslik="Gündemde" /><div className="gundem__govde" aria-busy="true"><Iskelet satir={KONU_EN_COK} alt /></div></>);
  }
  // Konu çıkmadıysa (kaynak kapalı / bağlantı yok) haber başlıkları; o da yoksa haftanın görünümü — bant hiçbir zaman boş kalmaz.
  if (haberler.length) {
    return (
      <>
        <BolumBasi baslik="Son haberler" not={yas(h)} />
        <div ref={ref} className="gundem__govde">
          <Liste>
            {haberler.slice(0, n).map((x) => <Satir key={x.id} baslik={x.baslik} alt={[x.kaynak, x.zaman ? yasMetni(x.zaman) : ''].filter(Boolean).join(' · ')} tikla={() => ac(x.link)} />)}
          </Liste>
        </div>
      </>
    );
  }
  return <HaftaSeridi v={v} />;
}

/** Bu hafta: 7 gün, her günde bekleyen hatırlatıcı/iş sayısı (yerel veri; ağ yok). */
/** 11 Kas (tasarımcı bulgu 13): tek harf ("P S Ç P C C P") Pazartesi, Perşembe ve Pazar'ı ayırt etmiyordu. */
const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
function HaftaSeridi({ v }: { v: KokpitVerisi }) {
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  const pzt = new Date(bugun); pzt.setDate(bugun.getDate() - ((bugun.getDay() + 6) % 7));
  const gunler = Array.from({ length: 7 }, (_, i) => { const d = new Date(pzt); d.setDate(pzt.getDate() + i); return d; });
  const anahtar = (d: Date | string) => new Date(d).toLocaleDateString('sv-SE');
  const sayac = new Map<string, number>();
  for (const h of v.hatirlaticilar) if (h.durum === 'bekliyor') sayac.set(anahtar(h.zaman), (sayac.get(anahtar(h.zaman)) ?? 0) + 1);
  for (const g of v.gorevler) if (g.sonTarih) sayac.set(anahtar(g.sonTarih), (sayac.get(anahtar(g.sonTarih)) ?? 0) + 1);
  const toplam = gunler.reduce((n, d) => n + (sayac.get(anahtar(d)) ?? 0), 0);
  return (
    <>
      <BolumBasi baslik="Bu hafta" not={toplam ? `${toplam} kayıt` : `${haftaNumarasi()}. hafta`} />
      <ol className="hafta">
        {gunler.map((d) => {
          const n = sayac.get(anahtar(d)) ?? 0;
          const bu = anahtar(d) === anahtar(bugun);
          return (
            <li key={d.toISOString()} className="hafta__gun" data-bugun={bu || undefined} aria-label={`${d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}: ${n ? `${n} kayıt` : 'kayıt yok'}`}>
              <span className="hafta__ad">{d.toLocaleDateString('tr-TR', { weekday: 'short' })}</span>
              <span className="hafta__no">{d.getDate()}</span>
              <span className="hafta__isaret">{Array.from({ length: Math.min(3, n) }, (_, i) => <i key={i} />)}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ── Hava ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Başlık şehrin adıdır (macOS Hava widget'ı gibi); konum tahminse (saat dilimi listede yok) başlığın eylemi "Şehrini seç". */
function sehirEylemi(k: PanoKonumu) {
  if (k.kaynak !== 'tahmin') return undefined;
  return <Dugme tur="hayalet" boyut="k" title="Şehrin otomatik bulunamadı; Ayarlar → Pano’dan seç" data-sehir-sec="" onClick={() => void cagir('ana:goster', 'ayarlar#pano-sehir')}>Şehrini seç</Dugme>;
}
const gunAdi = (gun: string, uzun = false) => new Date(`${gun}T12:00:00`).toLocaleDateString('tr-TR', uzun ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short' });

export function HavaKarti({ pano, ...hucre }: { pano: PanoDurumu } & Hucre) {
  const k = pano.konum;
  const h = pano.hava;
  return (
    <Kart {...hucre} baslik={k.sehir} eylem={sehirEylemi(k)}>
      {h.durum === 'yukleniyor' ? <HavaIskeleti />
        : h.durum !== 'hazir' || !h.veri ? <YerelHava k={k} kapali={h.durum === 'kapali'} gizli={h.gizli} />
          : <HavaGovde h={h} v={h.veri} k={k} />}
    </Kart>
  );
}

function HavaIskeleti() {
  return (
    <div className="hava" data-pano="hava" aria-busy="true">
      <div className="hava__ust">
        <div className="hava__sol"><div className="iskelet hava__derece-iskelet" /><div className="iskelet iskelet--ince" style={{ width: '64%' }} /><div className="iskelet iskelet--ince" style={{ width: '82%' }} /></div>
        <div className="iskelet hava__simge-iskelet" />
      </div>
      <ol className="hava__saatlik" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <li key={i} className="hava__saat"><div className="iskelet iskelet--ince" style={{ width: 26 }} /><div className="iskelet hava__kucuk-iskelet" /><div className="iskelet iskelet--ince" style={{ width: 22 }} /></li>)}</ol>
      <Dipnot metin="MET Norway" />
    </div>
  );
}

function HavaGovde({ h, v, k }: { h: PanoKaynak<HavaVerisi>; v: HavaVerisi; k: PanoKonumu }) {
  const ref = useRef<HTMLDivElement>(null);
  const G = v.gunluk.length;
  // Sığma adımları (kartın boyuna göre): 0 → saatlik + bütün günler + güneş satırı; 1 → güneşsiz; 2… → günler birer birer azalır;
  // G + 2 → saatlik kalkar, yerine (daha kısa) güneş satırı döner — 0.14 T30 düzeltme turu 1: orta boy kartta (≈ 260 px) saatlik sığmayınca
  // şimdiki durumla kaynak satırı arası boş kalıyordu; G + 3 → küçük widget (şehir, sıcaklık, durum, en yüksek/en düşük).
  const adim = useSigdir(ref, G + 3, `${v.guncelleme}|${G}`);
  const gunesVar = adim === 0 || adim === G + 2;
  const gunSayisi = Math.max(0, G - Math.max(0, adim - 1));
  const saatlikVar = adim < G + 2;
  const g = gunesSaatleri(new Date(), k.enlem, k.boylam);
  const enAz = Math.min(...v.gunluk.map((x) => x.enDusuk)), enCok = Math.max(...v.gunluk.map((x) => x.enYuksek));
  const aralik = Math.max(1, enCok - enAz);
  return (
    <div ref={ref} className="hava" data-pano="hava">
      <div className="hava__ust">
        <div className="hava__sol">
          <div className="ui-deger"><Sayi deger={v.simdi.sicaklik} birim="°" /></div>
          <div className="hava__durum"><MetinKirp metin={havaMetni(v.simdi.simge)} satir={1} /></div>
          <p className="hava__uclar"><span>En yüksek <Sayi deger={v.bugun.enYuksek} birim="°" /></span><span>En düşük <Sayi deger={v.bugun.enDusuk} birim="°" /></span></p>
        </div>
        <span className="hava__simge"><HavaSimgesi tur={havaSimgesi(v.simdi.simge)} olcu={44} /></span>
      </div>
      {saatlikVar && (
        <ol className="hava__saatlik" aria-label="Sonraki saatler">
          {v.saatlik.slice(0, 6).map((s) => (
            <li key={s.zaman} className="hava__saat">
              <span className="hava__saat-ad">{saat(s.zaman)}</span>
              <HavaSimgesi tur={havaSimgesi(s.simge)} olcu={20} />
              <span className="hava__saat-derece"><Sayi deger={s.sicaklik} birim="°" /></span>
            </li>
          ))}
        </ol>
      )}
      {gunSayisi > 0 && (
        <ol className="hava__gunluk" aria-label="Önümüzdeki günler">
          {v.gunluk.slice(0, gunSayisi).map((d) => (
            <li key={d.gun} className="hava__gun" title={gunAdi(d.gun, true)}>
              <span className="hava__gun-ad">{gunAdi(d.gun)}</span>
              <HavaSimgesi tur={havaSimgesi(d.simge)} olcu={20} />
              <span className="hava__gun-d"><Sayi deger={d.enDusuk} birim="°" /></span>
              <span className="hava__cubuk" aria-hidden="true"><i style={{ left: `${((d.enDusuk - enAz) / aralik) * 100}%`, right: `${100 - ((d.enYuksek - enAz) / aralik) * 100}%` }} /></span>
              <span className="hava__gun-y"><Sayi deger={d.enYuksek} birim="°" /></span>
            </li>
          ))}
        </ol>
      )}
      {gunesVar && (g.dogus || g.batis || v.simdi.ruzgar !== undefined) && (
        <div className="hava__gunes">
          {g.dogus && <span><Ikon ad="gunes" olcu={14} />Gün doğumu {saat(g.dogus)}</span>}
          {g.batis && <span><Ikon ad="ay" olcu={14} />Gün batımı {saat(g.batis)}</span>}
          {v.simdi.ruzgar !== undefined && <span>Rüzgâr {Math.round(v.simdi.ruzgar * 3.6)} km/sa</span>}
        </div>
      )}
      <Dipnot metin={`MET Norway · ${yas(h)}`} gizli={h.gizli} />
    </div>
  );
}

/** Hava verisi yokken (önbellek boş: ağ yok, kapalı ya da Gizli mod): yerel saat, tarih, gün ışığı — dakikada bir kendi kendine ilerler. */
function YerelHava({ k, kapali, gizli = false }: { k: PanoKonumu; kapali: boolean; gizli?: boolean }) {
  const simdi = new Date(useDakika());
  const g = gunesSaatleri(simdi, k.enlem, k.boylam);
  const ref = useRef<HTMLDivElement>(null);
  // 0 → gün ışığı çizelgesi + doğuş/batış; 1 → çizelgesiz; 2 → yalnız saat, tarih ve not.
  const adim = useSigdir(ref, 2, `${k.sehirId}|${kapali}|${gizli}`);
  let isik: { oran: number; sure: string; kalan: string } | null = null;
  if (g.dogus && g.batis && g.batis > g.dogus) {
    const top = g.batis.getTime() - g.dogus.getTime();
    const oran = Math.min(1, Math.max(0, (simdi.getTime() - g.dogus.getTime()) / top));
    const sa = (ms: number) => `${Math.floor(ms / 3600_000)} sa ${Math.round((ms % 3600_000) / 60_000)} dk`;
    const kalan = simdi < g.dogus ? `doğuşa ${sa(g.dogus.getTime() - simdi.getTime())}` : simdi < g.batis ? `batışa ${sa(g.batis.getTime() - simdi.getTime())}` : 'güneş battı';
    isik = { oran, sure: sa(top), kalan };
  }
  const gunduz = Boolean(g.dogus && g.batis && simdi > g.dogus && simdi < g.batis);
  const saatYazisi = saat(simdi);
  return (
    <div ref={ref} className="hava hava--yerel" data-pano="hava">
      <div className="hava__ust">
        <div className="hava__sol">
          <div className="ui-deger"><span className="ui-sayi" style={{ '--hane': saatYazisi.length } as CSSProperties}>{saatYazisi}</span></div>
          <div className="hava__durum"><MetinKirp metin={simdi.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })} satir={1} /></div>
        </div>
        <span className="hava__simge"><HavaSimgesi tur={gunduz ? 'acik-gun' : 'acik-gece'} olcu={44} /></span>
      </div>
      {adim === 0 && isik && (
        <div className="hava__isik" aria-label={`Gün ışığı ${isik.sure}, ${isik.kalan}`}>
          <div className="hava__isik-ust"><span>Gün ışığı {isik.sure}</span><span>{isik.kalan}</span></div>
          <div className="hava__isik-cubuk"><i className="hava__isik-dolu" style={{ width: `${isik.oran * 100}%` }} /><i className="hava__isik-nokta" style={{ left: `${isik.oran * 100}%` }} /></div>
        </div>
      )}
      {adim < 2 && (g.dogus || g.batis) && (
        <div className="hava__gunes">
          {g.dogus && <span><Ikon ad="gunes" olcu={14} />Gün doğumu {saat(g.dogus)}</span>}
          {g.batis && <span><Ikon ad="ay" olcu={14} />Gün batımı {saat(g.batis)}</span>}
        </div>
      )}
      <Dipnot metin={kapali ? 'Hava durumu kapalı · Ayarlar → Pano' : gizli ? `Hava durumu ${GIZLI_GUNCELLENMIYOR}` : 'Hava durumu bağlantı gelince yenilenir'} gizli={gizli} />
    </div>
  );
}

// ── Haberler ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Kartta en çok bu kadar başlık (spec §5: 3–5; widget sakin kalsın — gerisi "Tümü"de). İki sütunda 4: ızgara dengeli. */
const HABER_KART_EN_COK = 5;
const HABER_IKI_SUTUN_EN_COK = 4;
/** İki sütunun mümkün olduğu iç genişlik (px): iki sütun × 240 + 28 aralık. Sütun sayısı planın adımından (data-iki-sutun), CSS'ten değil. */
const HABER_IKI_SUTUN_PX = 508;
const haberAlt = (x: Haber) => [x.kaynak, x.zaman ? yasMetni(x.zaman) : ''].filter(Boolean).join(' · ');

/** Haber kartının sığma planı (Apple Haberler widget'ları gibi): en zengini manşet — ilk başlık büyük yazıyla, altında dört başlık; sonra
 *  tek sütunda 5, 4 … başlık (her sayıda önce iki satır, sonra tek satır). Geniş kartta tek sütunda dört başlık sığmazsa (geniş ama kısa)
 *  iki sütun: çift sayı (4, 2) — son satırda tek başına kalan hücre olmasın. Kartta en çok 5 başlık; gerisi "Tümü"de. */
const haberPlani = (toplam: number, genis: boolean) => sayiPlani(genis
  ? { manset: HABER_KART_EN_COK, tek: [HABER_KART_EN_COK, 4], cift: [HABER_IKI_SUTUN_EN_COK, 2, 1] }
  : { manset: HABER_KART_EN_COK, tek: [HABER_KART_EN_COK, 4, 3, 2, 1] }, toplam);

export function HaberlerKarti({ pano, ...hucre }: { pano: PanoDurumu } & Hucre) {
  const h = pano.haberler;
  const hepsi = h.durum === 'hazir' ? (h.veri ?? []) : [];
  // 11 Kas (tasarımcı bulgu 6): Gündemde'nin gösterdiği haberler kartta yinelenmez; "Tümü" levhası yine bütün haberleri listeler.
  const bantta = bantHaberleri(pano.gundem.durum === 'hazir' ? (pano.gundem.veri ?? []) : [], hepsi);
  const liste = hepsi.filter((x) => !bantta.has(x.id));
  const ref = useRef<HTMLDivElement>(null);
  const genis = useGenislik(ref) >= HABER_IKI_SUTUN_PX;
  // Başlık sayısı korunur (iki satır, sığmazsa tek satır, sonra bir eksik) — kısa kartta da birden çok haber; en çok 5 (iki sütunda 4).
  const plan = haberPlani(liste.length, genis);
  const adim = useSigdir(ref, plan.length - 1, `${genis}|${liste.slice(0, HABER_KART_EN_COK).map((x) => x.id).join(',')}`);
  const { n, iki, manset, ikiSutun } = plan[Math.min(adim, plan.length - 1)];
  const t = useTumu(hepsi.length, hepsi.length - n);
  const satir = (x: Haber, ikiSatir = true) => <Satir key={x.id} baslik={x.baslik} satir={ikiSatir ? 2 : 1} alt={haberAlt(x)} tikla={() => ac(x.link)} />;
  const durum = h.gizli || h.cevrimdisi ? yas(h) : '';
  return (
    <Kart {...hucre} baslik="Haberler" eylem={t.eylem}>
      <div ref={ref} className="haberler" data-pano="haberler" data-iki-sutun={ikiSutun ? '' : undefined} data-manset={manset ? '' : undefined} data-pano-gizli={h.gizli && !liste.length ? '' : undefined}>
        {liste.length ? <Liste>{liste.slice(0, n).map((x) => satir(x, iki))}</Liste>
          : h.gizli ? <Bos baslik={GIZLI_GUNCELLENMIYOR} metin="Gizli mod kapanınca haberler yenilenir." />
            : <div aria-busy="true"><Iskelet satir={3} alt baslikSatiri={2} /></div>}
      </div>
      {liste.length > 0 && <Dipnot metin={durum} gizli={h.gizli} />}
      {t.acik && <TumuLevhasi baslik="Haberler" alt={yas(h) || undefined} kapat={t.kapat}><Liste>{hepsi.map((x) => satir(x))}</Liste></TumuLevhasi>}
    </Kart>
  );
}

// ── Döviz ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function Cizgi({ degerler }: { degerler: number[] }) {
  if (degerler.length < 2) return null;
  const en = Math.min(...degerler), ek = Math.max(...degerler);
  const a = ek - en || 1;
  const n = degerler.length - 1;
  const nokta = degerler.map((d, i) => `${((i / n) * 56).toFixed(1)},${(17 - ((d - en) / a) * 14).toFixed(1)}`);
  const son = nokta.at(-1)!.split(',');
  return (
    <svg className="kur__cizgi" viewBox="0 0 60 20" aria-hidden="true">
      <polyline points={nokta.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={son[0]} cy={son[1]} r="1.9" fill="currentColor" />
    </svg>
  );
}
const basamak = (x: number) => (x >= 10 ? 2 : 4);
/** Yerel para birimiyle ("₺42,62"); bilinmeyen kodda düz sayı. */
function paraBicim(x: number, kod: string): string {
  const s = { minimumFractionDigits: basamak(x), maximumFractionDigits: basamak(x) };
  try { return x.toLocaleString('tr-TR', { style: 'currency', currency: kod, ...s }); } catch { return x.toLocaleString('tr-TR', s); }
}
const kaynakAdi = (v: PiyasaVerisi) => (v.kaynak === 'ecb' ? 'Avrupa Merkez Bankası' : 'TCMB');

function KurSatiri({ k, v }: { k: KurSatiri; v: PiyasaVerisi }) {
  const yon = k.degisim === undefined ? undefined : k.degisim > 0.005 ? 'artis' : k.degisim < -0.005 ? 'dusus' : 'sabit';
  return (
    <Satir
      baslik={k.kod}
      alt={PARA_ADI[k.kod] ?? k.kod}
      ipucu={`1 ${k.kod} = ${paraBicim(k.deger, v.yerel)}${k.degisim !== undefined ? ` · ${k.degisim >= 0 ? 'artış' : 'düşüş'} %${Math.abs(k.degisim).toLocaleString('tr-TR', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : ''} · son 30 iş günü`}
      data-kur={k.kod}
      sag={(
        <span className="kur">
          <Cizgi degerler={k.gecmis} />
          <span className="kur__sayilar">
            <span className="kur__deger">{paraBicim(k.deger, v.yerel)}</span>
            {k.degisim !== undefined && (
              <span className="kur__degisim" data-yon={yon}>
                <span aria-hidden="true">{yon === 'artis' ? '▲' : yon === 'dusus' ? '▼' : '•'}</span>
                <span className="ui-gizli">{yon === 'artis' ? 'artış' : yon === 'dusus' ? 'düşüş' : 'değişmedi'}</span>{' '}
                <Sayi deger={Math.abs(k.degisim)} birim="%" ondalik={2} />
              </span>
            )}
          </span>
        </span>
      )}
    />
  );
}

export function PiyasaKarti({ pano, ...hucre }: { pano: PanoDurumu } & Hucre) {
  const p = pano.piyasa;
  const v = p.durum === 'hazir' ? p.veri : undefined;
  const kurlar = v?.kurlar ?? [];
  const ref = useRef<HTMLDivElement>(null);
  const adim = useSigdir(ref, Math.max(0, kurlar.length - 1), `${v?.tarih ?? ''}|${kurlar.map((k) => k.kod).join(',')}`);
  const n = satirSayisi(adim, kurlar.length);
  const t = useTumu(kurlar.length, kurlar.length - n);
  const tarih = v ? new Date(`${v.tarih}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '';
  // Atıf her zaman (ECB: kaynak gösterilmeli) + kurların tarihi; çevrimdışında / Gizli'de kısa durum.
  const dipnot = v ? [kaynakAdi(v), tarih, p.gizli ? GIZLI_GUNCELLENMIYOR : p.cevrimdisi ? 'çevrimdışı' : ''].filter(Boolean).join(' · ') : '';
  return (
    <Kart {...hucre} baslik="Döviz" eylem={t.eylem}>
      <div ref={ref} className="piyasa" data-pano="piyasa" data-pano-gizli={p.gizli && !v ? '' : undefined}>
        {v ? <Liste>{kurlar.slice(0, n).map((k) => <KurSatiri key={k.kod} k={k} v={v} />)}</Liste>
          : p.gizli ? <Bos baslik={GIZLI_GUNCELLENMIYOR} metin="Gizli mod kapanınca kurlar yenilenir." />
            : <div aria-busy="true"><Iskelet satir={3} alt /></div>}
      </div>
      {v && <Dipnot metin={dipnot} gizli={p.gizli} />}
      {t.acik && v && <TumuLevhasi baslik="Döviz" alt={dipnot} kapat={t.kapat}><Liste>{kurlar.map((k) => <KurSatiri key={k.kod} k={k} v={v} />)}</Liste></TumuLevhasi>}
    </Kart>
  );
}

// ── Öneri listeleri (Fuber'e sorabilirsin, Hızlı işler) ─────────────────────────────────────────────────────────────
interface Oneri { simge: string; etiket: string; ipucu?: string; yap: () => void; motor?: boolean }

/** Tıklanır öneri satırları: sol simge, ad, (yer varsa) kısa açıklama. Kart sığanı gösterir: önce açıklamalar, sonra satırlar kalkar;
 *  kalanı başlıktaki "Tümü" levhasında. Satırlar kartın gövdesini doldurur (uzun kartta boş alan kalmaz). */
function OneriKarti({ baslik, liste, aciklama, ikiSatir, sinif, hucre }: { baslik: string; liste: Oneri[]; aciklama: boolean; ikiSatir?: boolean; sinif: string; hucre: Hucre }) {
  const mg = useMotorGerekli();
  const ref = useRef<HTMLDivElement>(null);
  const once = aciklama ? 1 : 0;
  const adim = useSigdir(ref, once + Math.max(0, liste.length - 1), liste.map((o) => o.etiket).join('|'));
  const altli = aciklama && adim === 0;
  const n = satirSayisi(adim, liste.length, once);
  const t = useTumu(liste.length, liste.length - n);
  const satir = (o: Oneri, alt: boolean) => (
    <Satir key={o.etiket} sol={<Ikon ad={o.simge} olcu={16} />} baslik={o.etiket} satir={ikiSatir ? 2 : 1} alt={alt ? o.ipucu : undefined}
      tikla={() => { t.kapat(); o.yap(); }} {...(o.motor ? satirMotoru(mg) : {})} />
  );
  return (
    <Kart {...hucre} baslik={baslik} eylem={t.eylem}>
      <div ref={ref} className={`oneri-listesi ${sinif}`}>
        <Liste>{liste.slice(0, n).map((o) => satir(o, altli))}</Liste>
      </div>
      {t.acik && <TumuLevhasi baslik={baslik} kapat={t.kapat}><Liste>{liste.map((o) => satir(o, true))}</Liste></TumuLevhasi>}
    </Kart>
  );
}

/** "Fuber’e sorabilirsin": bağlama göre birkaç istem + sayfaya götürenler (e-posta bağla, hafıza). */
export function IpuclariKarti({ v, sor, git, ...hucre }: { v: KokpitVerisi; sor: Sor; git: Git } & Hucre) {
  const aracsiz = useContext(AracsizMod);
  const liste: Oneri[] = [];
  if (!v.epostalar.length) liste.push({ simge: 'posta', etiket: 'E-postanı bağla', ipucu: 'Önemlileri sana ben söylerim', yap: () => git('baglantilar') });
  // KK-1: istemler ortak kaynaktan; araçsız turda araç isteyenlerin yerine araçsız yapılabilenler (shared/kokpit-istemleri.ts).
  for (const o of oneriListesi(IPUCU_ONERILERI, aracsiz)) liste.push({ simge: o.simge, etiket: o.etiket, ipucu: o.ipucu, motor: true, yap: () => sor(o.istem) });
  if (v.epostalar.length) liste.push({ simge: 'hafiza', etiket: 'Hakkımda öğrendiklerin', ipucu: 'Hafızandakiler', yap: () => git('hafiza') });
  // 0.14 T30 düzeltme turu 1: açıklama satırı (ipucu) sığdıkça görünür; sığmazsa sığma planının ilk adımında o düşer.
  return <OneriKarti baslik="Fuber’e sorabilirsin" liste={liste.slice(0, 5)} aciklama sinif="ipuclari" hucre={hucre} />;
}

/** Hızlı işler (eski "Araç kiti"): eylemler ortak kaynaktan (shared/kokpit-istemleri.ts ARAC_KITI) + "Dosya öğret". KK-1: araçsız turda (Gizli ya da
 *  yalnız yerel) araç isteyenlerin yerine araçsız yapılabilenler (yazı, özet, çeviri, birlikte düşünme). */
export function HizliIsler({ sor, ...hucre }: { sor: Sor } & Hucre) {
  const eylemler: IstemOnerisi[] = oneriListesi(ARAC_KITI, useContext(AracsizMod));
  const liste: Oneri[] = [
    ...eylemler.map((o) => ({ simge: o.simge, etiket: o.etiket, ipucu: o.ipucu, motor: true, yap: () => sor(o.istem) })),
    { simge: 'ice', etiket: 'Dosya öğret', ipucu: 'Belgeyi hafızaya al', yap: () => void cagir('iceaktar:dosya-sec') },
  ];
  // Kutucukta ad iki satıra inebilir ("Hakkımda ne biliyorsun" dar kutucukta kesilmesin).
  return <OneriKarti baslik="Hızlı işler" liste={liste} aciklama ikiSatir sinif="hizli" hucre={hucre} />;
}

// ── Liste kartlarının alt şeridi ──────────────────────────────────────────────────────────────────────────────────────
/** Hatırlatıcılar / Yapılacaklar / Son e-postalar / öneriler: kayıt az, kart uzunsa dipte özet + tek eylem (kart yarısı boş durmasın).
 *  Sığmıyorsa hiç: `olcumlu` kartlarda (0.11 G5 liste kartları) kartın sığma ölçümü karar verir — şerit önce denenir, sığmazsa ilk o
 *  bırakılır (`gizle`); öteki kartlarda (Yapılacaklar) altlikSigar tahmini. */
export function KartAltligi({ tip, v, boy, sor, gizle, olcumlu }: { tip: KartTipi; v: KokpitVerisi; boy: Boy; sor: Sor; gizle?: boolean; olcumlu?: boolean }) {
  const mg = useMotorGerekli();
  const aracsiz = useContext(AracsizMod);
  if (gizle || (!olcumlu && !altlikVar(tip, v, boy))) return null;
  const okunmamis = v.epostalar.filter((e) => !e.okundu).length;
  // Tek eylem ortak kaynaktan (shared/kokpit-istemleri.ts); hepsi araç ister — KK-1: araçsız turda düğme gizlenir, özet kalır.
  const o = altlikOnerisi(tip, okunmamis);
  const dugme = o && istemOnerilir(o.istem, aracsiz)
    ? <Dugme tur="ikincil" boyut="k" simge={o.simge} {...mg} onClick={() => sor(o.istem)}>{o.etiket}</Dugme>
    : null;
  if (tip === 'hatirlatici') {
    const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
    const pzt = new Date(bugun); pzt.setDate(bugun.getDate() - ((bugun.getDay() + 6) % 7));
    const gunler = Array.from({ length: 7 }, (_, i) => { const d = new Date(pzt); d.setDate(pzt.getDate() + i); return d; });
    const anahtar = (d: Date | string) => new Date(d).toLocaleDateString('sv-SE');
    const dolu = new Set(v.hatirlaticilar.filter((h) => h.durum === 'bekliyor').map((h) => anahtar(h.zaman)));
    return (
      <div className="kk__altlik">
        <span className="mini-hafta" aria-label="Bu haftanın hatırlatıcıları">
          {gunler.map((d) => <span key={d.toISOString()} data-bugun={anahtar(d) === anahtar(bugun) || undefined}>{GUN_KISA[d.getDay()]}<i data-var={dolu.has(anahtar(d)) || undefined} /></span>)}
        </span>
        {dugme}
      </div>
    );
  }
  let ozet = '';
  if (tip === 'dikkat' || tip === 'oneriler') {
    const n = v.oneriler.filter((x) => (tip === 'dikkat' ? x.tur === 'dikkat' : x.tur !== 'dikkat')).length;
    ozet = tip === 'dikkat' ? `${n} konu bekliyor` : `${n} öneri`;
  } else if (tip === 'plan') {
    // Sayı tek kaynaktan (K3): kartın ve "Tümü"nün listesi; kısaltılmış `gorevler` (12) değil.
    const acik = acikYapilacaklar(v);
    const gecikmis = acik.filter((x) => x.sonTarih && Date.parse(x.sonTarih) < Date.now()).length;
    ozet = `${acik.length} açık iş${gecikmis ? ` · ${gecikmis} gecikmiş` : ''}`;
  } else if (tip === 'eposta') {
    ozet = okunmamis ? `${okunmamis} okunmamış` : 'Hepsi okundu';
  } else return null;
  return (
    <div className="kk__altlik">
      <span className="kk__altlik-ozet"><MetinKirp as="span" metin={ozet} satir={1} /></span>
      {dugme}
    </div>
  );
}
/** Bu kart tipinin alt şeridi var mı (özet + tek eylem). */
export const ALTLIKLI_TIPLER: readonly KartTipi[] = ['hatirlatici', 'dikkat', 'oneriler', 'plan', 'eposta'];
/** Alt şerit bu kartta çizilir mi (tahmin: kayıtlardan sonra ≥ 44 px kalıyorsa). */
export function altlikVar(tip: KartTipi, v: KokpitVerisi, boy: Boy): boolean {
  try { return altlikSigar(tip, v, boy); } catch { return false; }
}
