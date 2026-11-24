// ── Kokpitin kullanıcı kartları (0.11 G5): zihin bandı, hatırlatıcılar, öneriler, e-posta, WhatsApp, sohbetler, projeler, hafıza, içe
// aktarma, özel kartlar — hepsi kütüphanenin Kart + Liste + Satir'ıyla, pano kartlarıyla aynı dilde (PanoKartlari.tsx): başlık solda,
// tek eylem sağda ("Tümü"), kartta kaydırma yok — sığmayan kayıtlar "Tümü" levhasında ya da kendi sayfasında (Sohbetler, Hafıza).
// Eski kartların bütün eylemleri yerinde: hatırlatıcı ✓, öneriyi konuşmak ve kapatmak, e-posta / WhatsApp / proje özeti (KK-1: araç
// ister — Gizli'de satır tıklanmaz), sohbete gitmek, "Klasörü aç". Kartın ölçüsüne göre önce alt şerit, sonra satırlar bırakılır (sigdir.ts).
import { useContext, useRef, useState, type ReactNode } from 'react';
import { cagir, zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { MotorHapi } from '../bilesenler/MotorHapi';
import { Bos, Dugme, Kart, Liste, MetinKirp, Rozet, Satir } from '../ui';
import { sayiBicim } from '../ui/bicim';
import { ALTLIKLI_TIPLER, AracsizMod, KartAltligi, saat, satirMotoru, useMotorGerekli, type Hucre } from './PanoKartlari';
import { gizliSayisi, listePlani, useSigdir } from './sigdir';
import { TumuDugmesi, TumuLevhasi, useTumu } from './TumuLevhasi';
import { Markdown } from '../bilesenler/Ortak';
import { silmeler } from '../geri-al';
import { epostaOzeti, istemOnerilir, konuyuKonusalim, projeDurumu, whatsappOzeti, type Istem } from '../../shared/kokpit-istemleri';
import { ZIHIN_ADI, type ZihinHali } from '../../shared/beyin';
import { gunOzeti } from '../../shared/gunozeti';
import { hafizaTurAdi } from '../../shared/hafiza-tur';
import type { Boy } from '../../shared/izgara';
import { yasMetni } from '../../shared/pano';
import type { Hatirlatici, KartTipi, KokpitDurumu, KokpitVerisi, Oneri } from '../../shared/tipler';

type Sor = (istem: Istem) => void;
type Git = (sayfa: string, id?: number) => void;
/** Geçmiş kaydın kısa yaşı ("12 dk önce", "3 sa önce"): sağ sütun dar kalır, başlık yer bulur. */
const kisaZaman = (iso: string) => yasMetni(iso) || zamanGoreli(iso);

// ── Ortak liste kartı ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface ListeKartiOzellikleri<T> {
  baslik: string;
  kayitlar: readonly T[];
  /** Bir kaydın satırı (anahtarlı). Kart ve "Tümü" levhası aynı satırı çizer: eylemler ikisinde de aynı. `iki`: başlık iki satıra
   *  kadar (yer varsa; levhada hep). */
  satir: (k: T, iki: boolean) => ReactNode;
  anahtar: string;
  hucre: Hucre;
  /** Başlıklar yer varken iki satır olabilir mi (hatırlatıcı, öneri: uzun cümle). */
  ikiSatir?: boolean;
  /** 0.14 T31: kaydın ikinci satırı (ayrıntı: görev özeti, gönderim rozeti) var mı. Plan ayrıntıyı bıraktıysa "Tümü" çıkar (gizliSayisi). */
  ayrintiVar?: (k: T) => boolean;
  /** "Tümü" levha yerine kendi sayfasını açar (Sohbetler, Hafıza, Takip edilecekler); `hep`: kayıt gizli olmasa da görünür. */
  sayfa?: { etiket: string; ac: () => void; hep?: boolean };
  /** Alt şerit (özet + tek eylem): yalnız sığdığında; sığma ölçümü önce onu bırakır. */
  altlik?: { tip: KartTipi; v: KokpitVerisi; boy: Boy; sor: Sor };
  bos?: ReactNode;
  sinif?: string;
}

export function ListeKarti<T>({ baslik, kayitlar, satir, anahtar, hucre, ikiSatir, ayrintiVar, sayfa, altlik, bos, sinif }: ListeKartiOzellikleri<T>) {
  const ref = useRef<HTMLDivElement>(null);
  // Alt şerit (varsa) ilk adımda denenir; sığmazsa ölçüm önce onu bırakır (eski satır boyu tahmini — altlikSigar — yerine).
  const altlikli = Boolean(altlik && ALTLIKLI_TIPLER.includes(altlik.tip) && kayitlar.length > 0);
  const plan = listePlani(kayitlar.length, { altlik: altlikli, ikiSatir, ikiEnAz: 2 });
  const adim = useSigdir(ref, plan.length - 1, anahtar);
  const secili = plan[Math.min(adim, plan.length - 1)];
  const { n, iki, altlik: altlikGorunur } = secili;
  const gizli = gizliSayisi(kayitlar, secili, { ikiSatir, ayrintiVar });
  const t = useTumu(kayitlar.length, sayfa ? 0 : gizli);
  const eylem = sayfa ? (sayfa.hep || gizli > 0 ? { etiket: sayfa.etiket, tikla: sayfa.ac } : undefined) : t.eylem;
  return (
    <Kart {...hucre} baslik={baslik} eylem={eylem}>
      <div ref={ref} className={`kk-liste${sinif ? ` ${sinif}` : ''}`}>
        <Liste bos={bos}>{kayitlar.slice(0, n).map((k) => satir(k, iki))}</Liste>
      </div>
      {altlik && <KartAltligi {...altlik} gizle={!altlikGorunur} olcumlu />}
      {t.acik && !sayfa && <TumuLevhasi baslik={baslik} alt={`${sayiBicim(kayitlar.length)} kayıt`} kapat={t.kapat}><Liste>{kayitlar.map((k) => satir(k, true))}</Liste></TumuLevhasi>}
    </Kart>
  );
}

/** Satır + yanında kendi düğmesi (öneriyi kapat): satır tıklanır, düğme yanında — iç içe düğme yok, komşusuna binmez. */
function EylemliSatir({ children, eylem }: { children: ReactNode; eylem: ReactNode }) {
  return <div className="eylemli-satir">{children}{eylem}</div>;
}

// ── Zihin bandı ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Sakin üst kart: tarih + selamlama + günün odağı | durum hapları (0.10 Görev 1, D1: 3B görsel yok; burada hiçbir şey hareket etmez).
 *  Dar kartta (≤ 900 px) haplar metnin altına iner (tasarim.css .zihin). Odak iki satırda kalır (tamamı title'da ve odakta). */
export function ZihinBandi({ d, zihin, ...hucre }: { d: KokpitDurumu; zihin: string } & Hucre) {
  const v = d.veri;
  // Planlayıcı odak yazmadıysa (ilk açılış, motor yok) veriden çıkan gerçek bekleyen sayıları: bant boş kalmaz.
  const odak = d.odak || gunOzeti(v);
  return (
    <Kart {...hucre} aria-label={hucre['aria-label'] ?? 'Günün özeti'}>
      <div className="zihin">
        <div className="zihin__metin">
          <div className="t-kucuk zihin__tarih">{new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {/* Selamlama en çok beş sözcük (planlayıcı kuralı): kırpılmaz, sığmazsa sözcükten bölünür. MetinKirp değil — iri yazının
              harf payını kırpma sanıp selamlamayı klavye durağı yapıyordu. */}
          {/* 11 Kas (bulgu 13): selam başlıktır — sondaki nokta düşer (planlayıcının "Günaydın, Deniz." ile yedeğin "İyi akşamlar, Deniz"i aynı kural). */}
          <div className="zihin__selam">{d.selamlama.replace(/[.!]+\s*$/, '')}</div>
          <div className="zihin__odak"><MetinKirp metin={odak} satir={2} /></div>
        </div>
        <div className="zihin__haplar">
          <MotorHapi />
          <span className="hap"><Ikon ad="hafiza" olcu={12} />{v.zihin.hafizaSayisi} hafıza</span>
          {zihin !== 'bos' && <span className="hap hap--mavi">{ZIHIN_ADI[zihin as ZihinHali] ?? zihin}</span>}
        </div>
      </div>
    </Kart>
  );
}

// ── Hatırlatıcılar ──────────────────────────────────────────────────────────────────────────────────────────────────
const TEKRAR: Record<string, string> = { gunluk: 'her gün', hafta_ici: 'hafta içi her gün', haftalik: 'her hafta', aylik: 'her ay' };
const gunBasi = (t: Date) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** "Bugün · 27 dakika sonra", "Yarın", "Çar 29 Eki" — saat solda yazdığı için burada yalnız gün ve yakınlık. */
function hatirlaticiGunu(iso: string): string {
  const z = new Date(iso);
  const fark = Math.round((gunBasi(z) - gunBasi(new Date())) / 86_400_000);
  if (fark === 0) return `Bugün · ${zamanGoreli(iso)}`;
  if (fark === 1) return 'Yarın';
  if (fark === -1) return 'Dün';
  return z.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function HatirlaticilarKarti({ v, boy, sor, baslik, ...hucre }: { v: KokpitVerisi; boy: Boy; sor: Sor; baslik?: string } & Hucre) {
  const satir = (h: Hatirlatici, iki: boolean) => {
    const tekrarli = h.tekrar !== 'yok';
    // Bildirilmiş (geçmiş) hatırlatıcı ✓ ile kapatılana ya da 12 saat dolana dek soluk kalır.
    return (
      <Satir key={h.id} sol={saat(h.zaman)} baslik={h.baslik} satir={iki ? 2 : 1} soluk={h.durum === 'gonderildi'}
        alt={[hatirlaticiGunu(h.zaman), tekrarli ? TEKRAR[h.tekrar] ?? h.tekrar.replace(/_/g, ' ') : ''].filter(Boolean).join(' · ')}
        data-hatirlatici={String(h.id)}
        sag={<Dugme tur="hayalet" boyut="k" simge="tamam" aria-label={tekrarli ? 'Bu seferlik tamam (sonraki zamana geçer)' : 'Tamamlandı'} onClick={() => void cagir('plan:hatirlatici', h.id, { durum: 'tamam' })} />} />
    );
  };
  return (
    <ListeKarti baslik={baslik ?? 'Hatırlatıcılar'} kayitlar={v.hatirlaticilar} satir={satir} hucre={hucre} sinif="hatirlaticilar"
      anahtar={v.hatirlaticilar.map((h) => `${h.id}${h.durum}`).join(',')} altlik={{ tip: 'hatirlatici', v, boy, sor }} ikiSatir />
  );
}

// ── Dikkat / Fuber'in önerileri ─────────────────────────────────────────────────────────────────────────────────────
export function OnerilerKarti({ tip, v, boy, sor, baslik, ...hucre }: { tip: 'dikkat' | 'oneriler'; v: KokpitVerisi; boy: Boy; sor: Sor; baslik?: string } & Hucre) {
  const liste = v.oneriler.filter((o) => (tip === 'dikkat' ? o.tur === 'dikkat' : o.tur !== 'dikkat'));
  // Öneriyi konuşmak araçsızdır (konusu istemin içinde): Gizli'de de tıklanır. Kapat ayrı düğme.
  const satir = (o: Oneri, iki: boolean) => (
    <EylemliSatir key={o.id} eylem={<Dugme tur="hayalet" boyut="k" simge="kapat" aria-label="Kapat" onClick={() => void cagir('plan:oneri-kapat', o.id)} />}>
      <Satir baslik={o.baslik} alt={o.icerik || undefined} satir={iki ? 2 : 1} tikla={() => sor(konuyuKonusalim(o.baslik, o.icerik))} />
    </EylemliSatir>
  );
  return (
    <ListeKarti baslik={baslik ?? (tip === 'dikkat' ? 'Dikkat etmen gerekenler' : 'Fuber’in önerileri')} kayitlar={liste} satir={satir} hucre={hucre}
      anahtar={liste.map((o) => o.id).join(',')} altlik={{ tip, v, boy, sor }} ikiSatir bos={<Bos baslik="Şimdilik her şey yolunda." />} />
  );
}

// ── Son e-postalar ──────────────────────────────────────────────────────────────────────────────────────────────────
export function EpostaKarti({ v, boy, sor, baslik, ...hucre }: { v: KokpitVerisi; boy: Boy; sor: Sor; baslik?: string } & Hucre) {
  const aracsiz = useContext(AracsizMod);
  const mg = useMotorGerekli();
  const satir = (e: KokpitVerisi['epostalar'][number]) => {
    // KK-1: e-postayı okumak araç ister — Gizli'de satır tıklanmaz.
    const istem = epostaOzeti(e.id);
    const tik = istemOnerilir(istem, aracsiz) ? () => sor(istem) : undefined;
    const kimden = e.kimden.replace(/<.*>/, '').trim();
    return (
      <Satir key={e.id} baslik={e.konu} alt={[kimden, e.ozet].filter(Boolean).join(' · ')} sag={e.tarih ? kisaZaman(e.tarih) : undefined}
        soluk={e.okundu} tikla={tik} data-okunmamis={e.okundu ? undefined : ''} {...(tik ? satirMotoru(mg) : {})} />
    );
  };
  return (
    <ListeKarti baslik={baslik ?? 'Son e-postalar'} kayitlar={v.epostalar} satir={satir} hucre={hucre}
      anahtar={v.epostalar.map((e) => `${e.id}${e.okundu ? '+' : ''}`).join(',')} altlik={{ tip: 'eposta', v, boy, sor }} bos={<Bos baslik="E-posta hesabı bağlı değil." />} />
  );
}

// ── WhatsApp ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function WhatsappKarti({ v, sor, baslik, ...hucre }: { v: KokpitVerisi; sor: Sor; baslik?: string } & Hucre) {
  const aracsiz = useContext(AracsizMod);
  const mg = useMotorGerekli();
  const satir = (w: KokpitVerisi['whatsapp'][number]) => {
    const istem = whatsappOzeti(w.ad);
    const tik = istemOnerilir(istem, aracsiz) ? () => sor(istem) : undefined;
    return (
      <Satir key={w.jid} baslik={w.ad} alt={w.sonMesaj || undefined} soluk={!w.okunmamis} tikla={tik} {...(tik ? satirMotoru(mg) : {})}
        sag={<span className="kk-sag">{w.okunmamis ? <Rozet ton="bilgi">{sayiBicim(w.okunmamis)}</Rozet> : null}<span>{kisaZaman(w.zaman)}</span></span>} />
    );
  };
  return (
    <ListeKarti baslik={baslik ?? 'WhatsApp'} kayitlar={v.whatsapp} satir={satir} hucre={hucre} anahtar={v.whatsapp.map((w) => `${w.jid}${w.okunmamis}`).join(',')}
      bos={<Bos baslik="WhatsApp bağlı değil." />} />
  );
}

// ── Geçmiş sohbetler ────────────────────────────────────────────────────────────────────────────────────────────────
export function SohbetlerKarti({ v, git, baslik, ...hucre }: { v: KokpitVerisi; git: Git; baslik?: string } & Hucre) {
  const liste = v.sohbetler.filter((s) => s.tur !== 'ana');
  return (
    <ListeKarti baslik={baslik ?? 'Geçmiş sohbetler'} kayitlar={liste} hucre={hucre} anahtar={liste.map((s) => s.id).join(',')}
      sayfa={{ etiket: 'Tümü', ac: () => git('sohbetler'), hep: true }}
      satir={(s) => <Satir key={s.id} baslik={s.baslik} alt={s.sonMesaj || undefined} sag={kisaZaman(s.guncelleme)} tikla={() => git('sohbetler', s.id)} />}
      bos={<Bos baslik="Ayrı konular için yeni sohbet açabilirsin." />} />
  );
}

// ── Projeler ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function ProjelerKarti({ v, sor, baslik, ...hucre }: { v: KokpitVerisi; sor: Sor; baslik?: string } & Hucre) {
  const aracsiz = useContext(AracsizMod);
  const mg = useMotorGerekli();
  return (
    <ListeKarti baslik={baslik ?? 'Projeler'} kayitlar={v.projeler} hucre={hucre} anahtar={v.projeler.map((p) => p.id).join(',')}
      satir={(p) => {
        const istem = projeDurumu(p.baslik);
        const tik = istemOnerilir(istem, aracsiz) ? () => sor(istem) : undefined;
        return <Satir key={p.id} baslik={p.baslik} alt={p.icerik || undefined} sag={kisaZaman(p.guncelleme)} tikla={tik} {...(tik ? satirMotoru(mg) : {})} />;
      }}
      bos={<Bos baslik="Projelerinden bahsettikçe burada belirecek." />} />
  );
}

// ── Son öğrendiklerim (hafıza) ──────────────────────────────────────────────────────────────────────────────────────
export function HafizaKarti({ v, git, baslik, ...hucre }: { v: KokpitVerisi; git: Git; baslik?: string } & Hucre) {
  // "Geri al" penceresindeki (Hafıza'da unutulan) kayıt burada da görünmez (Görev 20b, K2).
  const liste = v.hafiza.filter((h) => !silmeler.gizliMi(`hafiza:${h.id}`));
  return (
    <ListeKarti baslik={baslik ?? 'Son öğrendiklerim'} kayitlar={liste} hucre={hucre} anahtar={liste.map((h) => h.id).join(',')}
      sayfa={{ etiket: 'Tümü', ac: () => git('hafiza'), hep: true }}
      satir={(h) => <Satir key={h.id} baslik={h.baslik} alt={hafizaTurAdi(h.tur)} sag={kisaZaman(h.guncelleme)} data-hafiza-tur={hafizaTurAdi(h.tur)} />} />
  );
}

// ── Öğreniyor (içe aktarma) ─────────────────────────────────────────────────────────────────────────────────────────
export function IceAktarmaKarti({ v, baslik, ...hucre }: { v: KokpitVerisi; baslik?: string } & Hucre) {
  const a = v.iceAktarma;
  const metin = `${a.bekleyen ? `${a.bekleyen} dosya inceleniyor` : 'Bekleyen dosya yok'} · ${a.islenen} işlendi${a.ozetsiz ? ` · ${a.ozetsiz} özet sonra` : ''}${a.hata ? ` · ${a.hata} hata` : ''}`;
  return (
    <Kart {...hucre} baslik={baslik ?? 'Öğreniyor'}>
      <div className="ice-aktarma">
        <div className="ice-aktarma__durum"><MetinKirp metin={metin} satir={2} /></div>
        <Dugme tur="ikincil" boyut="k" simge="klasor" onClick={() => void cagir('iceaktar:klasor-ac')}>Klasörü aç</Dugme>
      </div>
    </Kart>
  );
}

// ── Özel kart (Fuber'in yazdığı) ────────────────────────────────────────────────────────────────────────────────────
/** Markdown → düz metin (kartta kırpılarak gösterilir; tamamı "Tümü" levhasında biçimiyle). */
const duzMetin = (md: string) => md.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();

/** Büyük rakamlar tek sırada (Apple widget'ı gibi): değer ve adı kendi sütununda, uzunsa … ile biter (tamamı title'da). */
function OzelMetrikler({ metrikler }: { metrikler: { ad: string; deger: string }[] }) {
  return (
    <div className="ozel-metrikler">
      {metrikler.map((m) => (
        <div key={m.ad} className="ozel-metrik">
          <div className="ozel-metrik__deger"><MetinKirp metin={m.deger} satir={1} /></div>
          <div className="ozel-metrik__ad"><MetinKirp metin={m.ad} satir={2} /></div>
        </div>
      ))}
    </div>
  );
}

export function OzelKart({ o, ...hucre }: { o: KokpitVerisi['ozelKartlar'][number] } & Hucre) {
  const ref = useRef<HTMLDivElement>(null);
  const liste = o.liste ?? [];
  const metin = o.icerik ? duzMetin(o.icerik) : '';
  // Adımlar: önce liste maddeleri azalır, sonra metnin satır sayısı (6 → 1).
  const METIN_SATIR = metin ? 6 : 0;
  const adim = useSigdir(ref, liste.length + Math.max(0, METIN_SATIR - 1), `${o.id}|${o.guncelleme}`);
  const maddeSayisi = Math.max(0, liste.length - adim);
  const metinSatiri = Math.max(1, METIN_SATIR - Math.max(0, adim - liste.length));
  const [acik, setAcik] = useState(false);
  const icerikVar = Boolean(metin || liste.length);
  return (
    <Kart {...hucre} baslik={o.baslik} eylem={icerikVar ? <TumuDugmesi etiket="Tümü" ac={() => setAcik(true)} /> : undefined}>
      <div ref={ref} className="ozel">
        {o.metrikler?.length ? <OzelMetrikler metrikler={o.metrikler.slice(0, 3)} /> : null}
        {metin && <div className="ozel__metin"><MetinKirp metin={metin} satir={metinSatiri} /></div>}
        {maddeSayisi > 0 && <Liste>{liste.slice(0, maddeSayisi).map((x, i) => <Satir key={i} baslik={x} />)}</Liste>}
      </div>
      <div className="pano-dipnot"><MetinKirp metin={`Güncellendi ${zamanGoreli(o.guncelleme)}`} satir={1} /></div>
      {acik && (
        <TumuLevhasi baslik={o.baslik} alt={`Güncellendi ${zamanGoreli(o.guncelleme)}`} kapat={() => setAcik(false)}>
          {o.metrikler?.length ? <OzelMetrikler metrikler={o.metrikler} /> : null}
          {o.icerik && <div className="tumu__metin"><Markdown metin={o.icerik} /></div>}
          {liste.length > 0 && <Liste>{liste.map((x, i) => <Satir key={i} baslik={x} satir={2} />)}</Liste>}
        </TumuLevhasi>
      )}
    </Kart>
  );
}
