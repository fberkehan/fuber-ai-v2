// ── Model seçici: yan sayfa (arama, sağlayıcı sekmeleri, yetenek süzgeçleri, sıralama, sanal liste) + ayar satırındaki kart ──────────
// OpenRouter gibi sağlayıcılar eklenince açılır listeler yetersiz kalıyordu ve model seçiminde RAM gibi bilgiler yoktu;
// daha kullanışlı bir seçici gerekiyordu. Açılır liste yerine sağdan gelen bir sayfa: üstte arama, altında sağlayıcı
// sekmeleri (Anthropic, OpenAI, OpenRouter, Fuber, Yerel — sayılarıyla), yetenek süzgeçleri ve sıralama; satırlarda ad, kimlik,
// bağlam, giriş/çıkış fiyatı ($ / 1M token), yetenek rozetleri ve "Önerilen". Yerel sekme YALNIZ BİLGİDİR (Karar I): disk, bellek,
// ekran kartı gereksinimi, bu bilgisayara uygunluk ("Rahat çalışır / Zorlanır / Çalışmaz"; shared/model-bilgisi.ts → yerelUygunluk,
// sistem:kontrol + yerel:durum verisiyle), kurulum durumu ve "Yerel beyin ayarları" — kurulum ve seçim Gizlilik ve yerel beyin'de.
// Yüzlerce satır (OpenRouter) sanal listeyle çizilir: yalnız görünen satırlar + birkaç pay DOM'da; arama ertelenmiş değerle süzer.
// Klavye: arama kutusu odakta kalır (combobox + listbox, aria-activedescendant): ↑/↓, PageUp/PageDown gezinir, Enter seçer; Esc önce
// aramayı temizler, sonra kapatır; Ctrl+Tab / Ctrl+Shift+Tab ve Ctrl+1…5 sekme değiştirir; sekmeler ←/→ ile; Tab sayfanın içinde
// döner. Klavyeyle açılınca canlandırma yok (sık tekrarlanan eylem); fareyle açılınca 220 ms sağdan.
// Anahtarı olmayan sağlayıcının sekmesi bilgi için açık, satırlar seçilmez ("Motorlara git"). Liste ana süreçten (motor:model-bilgileri)
// gelir; oturum boyunca 10 dk önbellekte (ana süreç de önbelleğe alır). Renkler yalnız belirteçlerden; mavi yalnız "Önerilen" rozeti.
import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as TusOlayi, type MouseEvent as FareOlayi, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cagir, dinle } from '../api';
import { Ikon } from './Ikon';
import { VARSAYILAN_MODEL } from '../../shared/modeller';
import {
  KAYNAK_ADI, ONERILEN_MODELLER, UYGUNLUK_ADI, YETENEK_ACIKLAMA, YETENEK_ADI, baglamMetni, fiyatMetni, gbMetni, listeyiTamamla,
  modelAra, modelleriSirala, modelleriSuz, onerilenYerel, yerelMakinesi, yerelUygunluk, yerlesikBilgi, yerlesikListe, modelAdi,
  type Makine, type ModelBilgisi, type ModelKaynagi, type ModelListesi, type ModelSirasi, type ModelSuzgeci, type Uygunluk, type Yetenek,
} from '../../shared/model-bilgisi';
import type { SistemBilgisi } from '../../shared/sistem-kontrol';
import type { Ayarlar, ModelRolu, SaglayiciAdi, YerelModelAdi } from '../../shared/tipler';
import { neredeYerelMi } from '../../shared/nerede';
import './model-secici.css';

const TUM_SEKMELER: readonly ModelKaynagi[] = ['anthropic', 'openai', 'openrouter', 'yerel'];
const SATIR_BOYU = 60;
const YEREL_SATIR_BOYU = 88;
const TASMA = 6; // görünen alanın üstünde/altında çizilen satır payı
const ONBELLEK_SURESI = 10 * 60_000;
const YETENEK_SIMGE: Record<Yetenek, string> = { gorsel: 'kamera', arac: 'arac', akil: 'hafiza' };
const YETENEK_KISA: Record<Yetenek, string> = { gorsel: 'Görsel', arac: 'Araç', akil: 'Akıl' };
const SIRALAR: [ModelSirasi, string][] = [['onerilen', 'Önerilen'], ['ad', 'Ad'], ['fiyat', 'Fiyat'], ['baglam', 'Bağlam']];
const SUZGECLER: [keyof ModelSuzgeci, string, string][] = [
  ['gorsel', 'Görsel', YETENEK_ACIKLAMA.gorsel], ['arac', 'Araç', YETENEK_ACIKLAMA.arac], ['akil', 'Akıl yürütme', YETENEK_ACIKLAMA.akil], ['ucretsiz', 'Ücretsiz', 'Giriş ve çıkış fiyatı 0'],
];
const MONOGRAM: Record<ModelKaynagi, string> = { anthropic: 'A', openai: 'O', openrouter: 'OR', yerel: 'Y' };
const UYGUN_NOKTA: Record<Uygunluk, string> = { rahat: 'yesil', zorlanir: 'turuncu', calismaz: 'kirmizi' };

// ── Liste önbelleği (oturum; sağlayıcı + anahtar durumu başına) ──────────────────────────────────────────────────────────
// Hatalı liste (yerleşik tablo + hata notu) yalnız o an gösterilir, YENİDEN KULLANILMAZ: seçici bir dahaki açılışta yeniden ister. Bilgi
// notlu liste (Gizli / "Yalnız bu bilgisayar": liste bilerek alınmadı) de öyle — Gizli kapanınca canlı liste hemen gelsin (0.12 cila).
// Anahtar yazılınca/silinince (ipc.ts sir:yaz → 'motor:anahtar-degisti') o sağlayıcının kaydı atılır: düzeltilen anahtar canlı
// listeyi hemen getirir.
const onbellek = new Map<string, { zaman: number; liste: ModelListesi }>();
const bekleyen = new Map<string, Promise<ModelListesi>>();
const dinleyiciler = new Set<() => void>();
const onbellekAnahtari = (s: ModelKaynagi, anahtarVar: boolean) => `${s}|${s === 'yerel' || anahtarVar ? 1 : 0}`;
/** O anki duruma bağlı liste (hata ya da bilgi notlu yerleşik tablo): önbellekten yeniden kullanılmaz. */
const geciciListe = (l: ModelListesi): boolean => Boolean(l.hata || l.bilgi);
let anahtarDinleniyor = false;
let sonNeredeYerel: boolean | null = null;
function anahtarDegisinceUnut() {
  if (anahtarDinleniyor) return;
  anahtarDinleniyor = true;
  dinle('motor:anahtar-degisti', (v: { saglayici?: string }) => {
    for (const k of [...onbellek.keys()]) if (k.startsWith(`${v?.saglayici}|`)) onbellek.delete(k);
    dinleyiciler.forEach((f) => f());
  });
  // 0.12 cila: Gizli / "Yalnız bu bilgisayar" açılınca ya da kapanınca sağlayıcı listeleri önbellekten atılır — açılınca seçici o anki
  // kuralı (liste alınmaz, bilgi satırı) göstersin, eski canlı listeyi değil; kapanınca canlı liste yeniden istensin.
  dinle('ayarlar:degisti', (a: Ayarlar) => {
    const yerel = neredeYerelMi(a?.yerel);
    if (sonNeredeYerel !== null && yerel !== sonNeredeYerel) {
      for (const k of [...onbellek.keys()]) if (!k.startsWith('yerel|')) onbellek.delete(k);
      dinleyiciler.forEach((f) => f());
    }
    sonNeredeYerel = yerel;
  });
  void cagir<Ayarlar>('ayarlar:al').then((a) => { if (sonNeredeYerel === null) sonNeredeYerel = neredeYerelMi(a?.yerel); }).catch(() => undefined);
}

function onbellekten(s: ModelKaynagi, anahtarVar: boolean): ModelListesi | null {
  const k = onbellek.get(onbellekAnahtari(s, anahtarVar));
  return k && Date.now() - k.zaman < ONBELLEK_SURESI ? k.liste : null;
}
/** Sağlayıcının listesi (önbellekte sağlam bir liste yoksa ana süreçten; aynı anda tek istek). */
export function listeyiYukle(s: ModelKaynagi, anahtarVar: boolean): Promise<ModelListesi> {
  anahtarDegisinceUnut();
  const hazir = onbellekten(s, anahtarVar);
  if (hazir && !geciciListe(hazir)) return Promise.resolve(hazir);
  const k = onbellekAnahtari(s, anahtarVar);
  let p = bekleyen.get(k);
  if (!p) {
    p = cagir<ModelListesi>('motor:model-bilgileri', s).then(
      (l) => { onbellek.set(k, { zaman: Date.now(), liste: l }); bekleyen.delete(k); dinleyiciler.forEach((f) => f()); return l; },
      (e) => { bekleyen.delete(k); throw e; },
    );
    bekleyen.set(k, p);
  }
  return p;
}
/** Önbellekteki listeler; `yukle` verilenler yoksa istenir. Bir liste gelince bütün kullananlar yeniden çizilir. */
function useListeler(kaynaklar: readonly ModelKaynagi[], anahtarlar: Record<SaglayiciAdi, boolean>, yukle: boolean) {
  const [surum, yenile] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { anahtarDegisinceUnut(); dinleyiciler.add(yenile); return () => { dinleyiciler.delete(yenile); }; }, []);
  const imza = kaynaklar.map((s) => onbellekAnahtari(s, s === 'yerel' || anahtarlar[s])).join(',');
  // Açılışta hepsi (hatalı kayıt da yeniden istenir); sonra yalnız önbellekten atılanlar (anahtar değişti) — hatalı liste döngüye girmez.
  useEffect(() => {
    if (yukle) for (const s of kaynaklar) void listeyiYukle(s, s === 'yerel' || anahtarlar[s]).catch(() => undefined);
  }, [imza, yukle]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (yukle) for (const s of kaynaklar) if (!onbellekten(s, s === 'yerel' || anahtarlar[s])) void listeyiYukle(s, s === 'yerel' || anahtarlar[s]).catch(() => undefined);
  }, [surum]); // eslint-disable-line react-hooks/exhaustive-deps
  // Aynı nesne, liste değişmedikçe: kaydırmada (her olayda yeniden çizim) süzme ve sıralama yeniden hesaplanmasın.
  return useMemo(
    () => Object.fromEntries(kaynaklar.map((s) => [s, onbellekten(s, s === 'yerel' || anahtarlar[s])])) as Partial<Record<ModelKaynagi, ModelListesi | null>>,
    [imza, surum], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

/** Seçili modelin bilgisi: önbellekteki listeden (seçici bir kez açıldıysa canlı), yoksa yerleşik tablodan ya da yalnız adla.
 *  Liste burada İSTENMEZ (ayar sayfası açılınca ağa çıkılmaz); seçici açılınca gelir ve kart kendiliğinden güncellenir. */
export function useModelBilgisi(s: SaglayiciAdi, id: string, anahtarVar: boolean): ModelBilgisi {
  const l = useListeler([s], { anthropic: anahtarVar, openai: anahtarVar, openrouter: anahtarVar }, false)[s];
  return l?.modeller.find((m) => m.id === id) ?? yerlesikBilgi(s, id) ?? { id, ad: modelAdi(s, id), saglayici: s, yetenekler: [] };
}

/** Bu bilgisayarın HAM bilgisi: bellek, NVIDIA kartı ve belleği, boş disk (sistem:kontrol; salt okur). Uygunluk için yerel beynin
 *  durumuyla birleştirilir: shared/model-bilgisi.ts → yerelMakinesi (ekran kartı yalnız kullanılabiliyorsa sayılır). */
export function useMakine(): Makine | null {
  const [m, setM] = useState<Makine | null>(null);
  useEffect(() => {
    let iptal = false;
    void cagir<Omit<SistemBilgisi, 'mikrofon'>>('sistem:kontrol')
      .then((b) => { if (!iptal) setM({ ramGB: b.ramGB, nvidia: b.nvidia, vramGB: b.vramGB, bosDiskGB: b.bosDiskGB }); })
      .catch(() => undefined);
    return () => { iptal = true; };
  }, []);
  return m;
}

/** yerel:durum'un seçicide kullanılan kısmı: çalıştırıcı kurulu mu, CUDA sürümü mü, hangi modeller inmiş, indirme. */
export interface YerelDurumOzeti {
  kurulu: { calistirici: boolean; model: boolean };
  cuda: boolean;
  indirme?: { yuzde: number; adim?: string; hata?: string };
  modeller: { ad: YerelModelAdi; kurulu: boolean }[];
}
function useYerelDurumu(etkin: boolean): YerelDurumOzeti | null {
  const [d, setD] = useState<YerelDurumOzeti | null>(null);
  useEffect(() => {
    if (!etkin) return;
    void cagir<YerelDurumOzeti>('yerel:durum').then(setD).catch(() => null);
    return dinle('yerel:durum', (v: YerelDurumOzeti) => setD(v));
  }, [etkin]);
  return d;
}

/** "32 GB bellek · NVIDIA ekran kartı 16 GB · 412 GB boş disk" (uygunluk girdisinden; kullanılmayan kartın nedeniyle). */
/** Ekran kartı kısmı ("NVIDIA ekran kartı 16 GB", "… (“Yalnız işlemci” seçili)", "NVIDIA ekran kartı yok"). */
export function ekranKartiMetni(m: Makine): string {
  const vram = m.vramGB !== undefined ? ` ${gbMetni(m.vramGB)}` : '';
  return m.ekranKartiKapali === 'islemci' ? `NVIDIA ekran kartı${vram} (“Yalnız işlemci” seçili)`
    : m.ekranKartiKapali === 'cuda' ? `NVIDIA ekran kartı${vram} (ekran kartı sürümü kurulu değil)`
    : m.nvidia ? `NVIDIA ekran kartı${vram}` : 'NVIDIA ekran kartı yok';
}

export function makineMetni(m: Makine): string {
  const disk = m.bosDiskGB !== undefined && Number.isFinite(m.bosDiskGB) ? ` · ${gbMetni(m.bosDiskGB)} boş disk` : '';
  return `${gbMetni(m.ramGB)} bellek · ${ekranKartiMetni(m)}${disk}`;
}

/** Kartın alt satırı: "Anthropic · 1 milyon bağlam · 4 $ / 20 $ · 1M token (yaklaşık)". */
export function modelOzeti(m: ModelBilgisi): string {
  const p: string[] = [KAYNAK_ADI[m.saglayici]];
  if (m.uretici && m.saglayici === 'openrouter') p.push(m.uretici);
  if (m.baglam) p.push(`${baglamMetni(m.baglam)} bağlam`);
  if (m.girisFiyat !== undefined && m.cikisFiyat !== undefined) {
    p.push(m.girisFiyat === 0 && m.cikisFiyat === 0 ? 'Ücretsiz' : `${fiyatMetni(m.girisFiyat)} $ / ${fiyatMetni(m.cikisFiyat)} $ · 1M token${m.yaklasik ? ' (yaklaşık)' : ''}`);
  }
  return p.join(' · ');
}

// ── Ayar satırındaki kart (tetik) ─────────────────────────────────────────────────────────────────────────────────────
export interface ModelKartiOzellikleri {
  /** Rol adı (ekran okuyucu: "Ana model: Claude Opus 5.5, değiştir"). */
  baslik: string;
  bilgi: ModelBilgisi;
  onerilen?: boolean;
  acik?: boolean;
  /** `klavye`: Enter/Boşluk ile açıldı (seçici canlandırmasız açılır). */
  ac: (klavye: boolean) => void;
  ref?: Ref<HTMLButtonElement>;
  /** Kilitli (0.11 G8: "Yalnız bu bilgisayardaki yapay zekâ" açıkken roller yerelde çalışır): görünür ama değiştirilemez; `neden` ipucu. */
  devreDisi?: boolean;
  neden?: string;
}
export function ModelKarti({ baslik, bilgi, onerilen, acik, ac, ref, devreDisi, neden }: ModelKartiOzellikleri) {
  return (
    <button
      ref={ref} type="button" className="mkart" aria-haspopup="dialog" aria-expanded={acik} data-model={bilgi.id} data-saglayici={bilgi.saglayici}
      aria-label={devreDisi ? `${baslik}: ${bilgi.ad}. ${neden ?? 'Değiştirilemez'}` : `${baslik}: ${bilgi.ad}. Değiştir`} disabled={devreDisi} title={devreDisi ? neden : undefined}
      onClick={(e) => ac(e.detail === 0)}
    >
      <span className="mkart__isaret" aria-hidden="true">{MONOGRAM[bilgi.saglayici]}</span>
      <span className="mkart__metin">
        <span className="mkart__ust"><b className="mkart__ad">{bilgi.ad}</b>{onerilen && <span className="msec__oneri">Önerilen</span>}</span>
        <span className="mkart__alt">{modelOzeti(bilgi)}</span>
      </span>
      {!devreDisi && <span className="mkart__degistir">Değiştir<Ikon ad="ileri" olcu={15} /></span>}
    </button>
  );
}

// ── Yan sayfa ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type Satir = { tur: 'model'; m: ModelBilgisi } | { tur: 'ozel'; id: string };

export interface ModelSeciciOzellikleri {
  /** "Ana model seç" başlığı ve altındaki bir cümle. */
  baslik: string;
  aciklama?: string;
  /** Önerilen = VARSAYILAN_MODEL[sağlayıcı][rol]. */
  rol: ModelRolu;
  secim: { saglayici: SaglayiciAdi; model: string };
  anahtarlar: Record<SaglayiciAdi, boolean>;
  sec: (s: SaglayiciAdi, model: string) => void;
  /** Yerel sekme (Karar I: yalnız bilgi): gereksinim, bu bilgisayara uygunluk, kurulum durumu ve "Yerel beyin ayarları". Burada model
   *  SEÇİLMEZ — kurulum ve yerel modelin seçimi Gizlilik ve yerel beyin'de, durumu görünür biçimde (çalışan yerel beyin sessizce
   *  durmasın). `model`: yerel beynin şu anki modeli ("Seçili" rozeti); `gpu`: işlemci ayarı (uygunlukta kart sayılır mı). */
  yerel?: { model: YerelModelAdi; gpu: 'otomatik' | 'cpu'; ayarlaraGit?: () => void };
  /** Anahtarı olmayan sağlayıcı: Ayarlar → Yapay zekâ → Motorlar. */
  motorlaraGit?: () => void;
  kapat: () => void;
  /** Klavyeyle açıldı: canlandırma yok. */
  klavyeyle?: boolean;
}

export function ModelSecici(p: ModelSeciciOzellikleri) {
  const taban = useId();
  const listeId = `${taban}-liste`;
  const panelId = `${taban}-panel`;
  const sekmeId = (s: ModelKaynagi) => `${taban}-sekme-${s}`;
  const baslikId = `${taban}-baslik`;
  const yerelVar = Boolean(p.yerel);
  const sekmeler = useMemo(() => TUM_SEKMELER.filter((s) => s !== 'yerel' || yerelVar), [yerelVar]);
  const [sekme, setSekme] = useState<ModelKaynagi>(p.secim.saglayici);
  const [sorgu, setSorgu] = useState('');
  const ertelenen = useDeferredValue(sorgu);
  const [suzgec, setSuzgec] = useState<ModelSuzgeci>({});
  const [sira, setSira] = useState<ModelSirasi>('onerilen');
  const [aktif, setAktif] = useState(0);
  const [kaydirma, setKaydirma] = useState(0);
  const [gorunurBoy, setGorunurBoy] = useState(520);
  const kutu = useRef<HTMLDivElement>(null);
  const ara = useRef<HTMLInputElement>(null);
  const sayfa = useRef<HTMLElement>(null);
  const makine = useMakine();
  const yerelDurum = useYerelDurumu(Boolean(p.yerel));
  const listeler = useListeler(sekmeler, p.anahtarlar, true);

  const anahtarVar = (s: ModelKaynagi) => s === 'yerel' || p.anahtarlar[s];
  const bilgiSekmesi = sekme === 'yerel'; // yalnız bilgi: satır seçilmez (Karar I)
  const secilebilir = !bilgiSekmesi && anahtarVar(sekme);
  const boy = bilgiSekmesi ? YEREL_SATIR_BOYU : SATIR_BOYU;
  const seciliId = bilgiSekmesi ? undefined : p.secim.saglayici === sekme ? p.secim.model : undefined;
  // Uygunluk girdisi: ekran kartı yalnız yerel beyin kullanabiliyorsa sayılır ("Yalnız işlemci" ya da CUDA'sız kurulum değilse).
  const yerelMakine = useMemo(
    () => (makine && yerelDurum && p.yerel ? yerelMakinesi(makine, { gpu: p.yerel.gpu, calistiriciKurulu: yerelDurum.kurulu.calistirici, cuda: yerelDurum.cuda }) : null),
    [makine, yerelDurum, p.yerel?.gpu], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const kuruluMu = useCallback((id: string) => Boolean(yerelDurum?.modeller?.find((x) => x.ad === id)?.kurulu), [yerelDurum]);

  /** Sekmenin tam listesi: sağlayıcının listesi (yoksa yerleşik) + rolün önerileni + geçerli seçim (listede yoksa). */
  const tamListe = useCallback((s: ModelKaynagi): ModelBilgisi[] => {
    const l = listeler[s]?.modeller ?? (s === 'yerel' ? [] : yerlesikListe(s));
    if (s === 'yerel') return l;
    return listeyiTamamla(l, s, [VARSAYILAN_MODEL[s][p.rol], ...(p.secim.saglayici === s ? [p.secim.model] : [])]);
  }, [listeler, p.rol, p.secim]);

  // Bilgisayar bilgisi gelmeden ya da hiçbir model uymuyorsa "Önerilen" yok (varsayılan model önerilmez).
  const yerelOnerilen = useMemo(() => (yerelMakine ? onerilenYerel(tamListe('yerel'), yerelMakine, kuruluMu) : undefined), [yerelMakine, tamListe, kuruluMu]);
  const oneriler = useCallback((s: ModelKaynagi): string[] => (s === 'yerel' ? [] : [...new Set([VARSAYILAN_MODEL[s][p.rol], ...ONERILEN_MODELLER[s]])]), [p.rol]);
  const onerilenMi = (m: ModelBilgisi) => (m.saglayici === 'yerel' ? m.id === yerelOnerilen : m.id === VARSAYILAN_MODEL[m.saglayici as SaglayiciAdi]?.[p.rol]);

  // Bütün sekmelerin sonuçları (sekme sayıları aramayla birlikte değişir: başka sekmede eşleşme olduğu görünür).
  const sonuclar = useMemo(() => {
    const out: Partial<Record<ModelKaynagi, ModelBilgisi[]>> = {};
    for (const s of sekmeler) {
      const tam = tamListe(s);
      if (s === 'yerel') { out[s] = modelAra(tam, ertelenen); continue; }
      const bulunan = modelAra(modelleriSuz(tam, suzgec), ertelenen);
      out[s] = ertelenen.trim() && sira === 'onerilen' ? bulunan : modelleriSirala(bulunan, sira, oneriler(s));
    }
    return out;
  }, [sekmeler, tamListe, ertelenen, suzgec, sira, oneriler]);

  const yazilan = ertelenen.trim();
  // Serbest kimlik satırı: tek parça, kimliğe benzeyen (/, :, ., - içeren) ya da hiçbir modelle eşleşmeyen yazı ("sonnet" yazınca çıkmaz).
  const ozelVar = sekme !== 'yerel' && anahtarVar(sekme) && /^\S{3,}$/.test(yazilan) && !tamListe(sekme).some((m) => m.id === yazilan)
    && (/[/:.-]/.test(yazilan) || !(sonuclar[sekme]?.length));
  const satirlar = useMemo<Satir[]>(
    () => [...(sonuclar[sekme] ?? []).map((m) => ({ tur: 'model' as const, m })), ...(ozelVar ? [{ tur: 'ozel' as const, id: yazilan }] : [])],
    [sonuclar, sekme, ozelVar, yazilan],
  );
  const yukleniyor = !listeler[sekme];
  const satirId = (i: number) => `${taban}-s${i}`;

  const gorunurYap = (i: number) => {
    const k = kutu.current;
    if (!k) return;
    const ust = i * boy;
    if (ust < k.scrollTop) k.scrollTop = ust;
    else if (ust + boy > k.scrollTop + k.clientHeight) k.scrollTop = ust + boy - k.clientHeight;
  };
  const kaydir = (adim: number) => {
    if (!satirlar.length || bilgiSekmesi) return;
    const i = Math.max(0, Math.min(satirlar.length - 1, aktif + adim));
    setAktif(i);
    gorunurYap(i);
  };

  // Sekme, süzgeç, sıra ya da arama değişince (ve liste gelince): arama boşsa geçerli seçim ortada etkin, değilse ilk satır.
  const listeImzasi = listeler[sekme] ? 1 : 0;
  useLayoutEffect(() => {
    const k = kutu.current;
    const i = yazilan ? 0 : Math.max(0, satirlar.findIndex((r) => r.tur === 'model' && r.m.id === seciliId));
    setAktif(i);
    if (k) { k.scrollTop = yazilan ? 0 : Math.max(0, i * boy - (k.clientHeight - boy) / 2); setKaydirma(k.scrollTop); }
  }, [sekme, yazilan, suzgec, sira, listeImzasi]); // eslint-disable-line react-hooks/exhaustive-deps

  // Görünen yükseklik (sanal liste penceresi).
  useLayoutEffect(() => {
    const k = kutu.current;
    if (!k) return;
    setGorunurBoy(k.clientHeight);
    const g = new ResizeObserver(() => setGorunurBoy(k.clientHeight));
    g.observe(k);
    return () => g.disconnect();
  }, []);

  // Açılışta odak aramada (sayfa kaymadan).
  useEffect(() => { ara.current?.focus({ preventScroll: true }); }, []);
  // Odak bir yolla sayfanın dışına düşerse (gövdeye) Esc yine kapatsın; içerideyken sayfanın kendi işleyicisi yakalar. Yakalama
  // evresinde ve yayılmayı keserek: yalnız seçici kapanır — altındaki pencere düzeyindeki Esc'ler (yeniden açılan kurulum sihirbazının
  // "Vazgeç"i) aynı tuşla tetiklenmez.
  const kapatRef = useRef(p.kapat);
  kapatRef.current = p.kapat;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || sayfa.current?.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      kapatRef.current();
    };
    addEventListener('keydown', esc, true);
    return () => removeEventListener('keydown', esc, true);
  }, []);

  const sec = (i: number) => {
    const r = satirlar[i];
    if (!r || !secilebilir) return; // Yerel sekme yalnız bilgi; anahtarsız sağlayıcı seçilmez
    p.sec(sekme as SaglayiciAdi, r.tur === 'ozel' ? r.id : r.m.id);
    p.kapat();
  };
  const sekmeyeGec = (s: ModelKaynagi, odakla = false) => {
    setSekme(s);
    if (odakla) requestAnimationFrame(() => sayfa.current?.querySelector<HTMLElement>(`[role="tab"][data-sekme="${s}"]`)?.focus());
  };
  const sekmeKaydir = (adim: number, odakla = false) => {
    const i = sekmeler.indexOf(sekme);
    sekmeyeGec(sekmeler[(i + adim + sekmeler.length) % sekmeler.length], odakla);
  };

  /** Tab sayfanın içinde döner (kalıcı iletişim kutusu). */
  const tuzak = (e: TusOlayi) => {
    const l = [...(sayfa.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])].filter((x) => x.tabIndex >= 0 && x.offsetParent !== null);
    if (!l.length) return;
    const ilk = l[0], son = l[l.length - 1];
    if (e.shiftKey && document.activeElement === ilk) { e.preventDefault(); son.focus(); }
    else if (!e.shiftKey && document.activeElement === son) { e.preventDefault(); ilk.focus(); }
  };
  const tus = (e: TusOlayi) => {
    const kisayol = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (sorgu) { setSorgu(''); ara.current?.focus(); } else p.kapat();
      return;
    }
    if (kisayol && e.key === 'Tab') { e.preventDefault(); sekmeKaydir(e.shiftKey ? -1 : 1); return; }
    if (kisayol && /^[1-9]$/.test(e.key) && sekmeler[Number(e.key) - 1]) { e.preventDefault(); sekmeyeGec(sekmeler[Number(e.key) - 1]); return; }
    if (kisayol && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); ara.current?.focus(); ara.current?.select(); return; }
    if (e.key === 'Tab') { tuzak(e); return; }
    if (e.target !== ara.current) {
      // Sekmede ya da süzgeçteyken harf/rakam yazınca aramaya geçer (yazılan harf arama kutusuna düşer).
      if (!kisayol && !e.altKey && /^[\p{L}\p{N}]$/u.test(e.key)) ara.current?.focus();
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); kaydir(1); break;
      case 'ArrowUp': e.preventDefault(); kaydir(-1); break;
      case 'PageDown': e.preventDefault(); kaydir(Math.max(1, Math.floor(gorunurBoy / boy) - 1)); break;
      case 'PageUp': e.preventDefault(); kaydir(-Math.max(1, Math.floor(gorunurBoy / boy) - 1)); break;
      case 'Enter': e.preventDefault(); sec(aktif); break;
      default:
    }
  };
  const sekmeTus = (e: TusOlayi) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); sekmeKaydir(e.key === 'ArrowRight' ? 1 : -1, true); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); sekmeyeGec(sekmeler[e.key === 'Home' ? 0 : sekmeler.length - 1], true); }
  };
  const siraTus = (e: TusOlayi) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = SIRALAR.findIndex(([k]) => k === sira);
    const yeni = SIRALAR[(i + (e.key === 'ArrowRight' ? 1 : -1) + SIRALAR.length) % SIRALAR.length][0];
    setSira(yeni);
    requestAnimationFrame(() => sayfa.current?.querySelector<HTMLElement>(`[data-sira="${yeni}"]`)?.focus());
  };

  // Sanal pencere: görünen satırlar + pay; etkin satır her zaman çizilir (aria-activedescendant boşa düşmesin).
  const bas = Math.max(0, Math.floor(kaydirma / boy) - TASMA);
  const son = Math.min(satirlar.length, Math.ceil((kaydirma + gorunurBoy) / boy) + TASMA);
  const cizilen = Array.from({ length: Math.max(0, son - bas) }, (_, k) => bas + k);
  if (!bilgiSekmesi && aktif >= 0 && aktif < satirlar.length && (aktif < bas || aktif >= son)) cizilen.push(aktif);

  const l = listeler[sekme];
  // Tarih yalnız kaynağı tarihli olanda (Anthropic'in 6 Eki 2026 liste fiyatları); OpenAI tablosu tarihsiz.
  const kaynakNotu = bilgiSekmesi
    ? 'Gereksinimler bağlam belleği dahil, yaklaşık; uygunluk bu bilgisayarın belleği ve ekran kartıyla hesaplanır.'
    : !l ? 'Liste yükleniyor…'
    : l.kaynak === 'canli'
      ? ({ openrouter: 'Canlı liste: bağlam ve fiyatlar OpenRouter’dan.', anthropic: 'Canlı liste; fiyatlar yaklaşık (yerleşik tablo, Ekim 2026).', openai: 'Canlı liste; bağlam ve fiyatlar yaklaşık (yerleşik tablo).', fuber: 'Canlı liste; Fuber gateway kredi ile ücretlendirir.' } as const)[sekme]
      : sekme === 'anthropic' ? 'Bilinen modeller; bağlam ve fiyatlar yaklaşık (yerleşik tablo, Ekim 2026).' : 'Bilinen modeller; bağlam ve fiyatlar yaklaşık (yerleşik tablo).';
  // Etkin satır yalnız çizilmiş bir seçeneğe işaret eder: iskelet (liste yükleniyor) ve bilgi sekmesinde yok.
  const listeKutusu = !bilgiSekmesi;
  const etkinId = listeKutusu && !yukleniyor && aktif >= 0 && aktif < satirlar.length ? satirId(aktif) : undefined;
  const sayiMetni = (s: ModelKaynagi) => (listeler[s] ? String(sonuclar[s]?.length ?? 0) : '…');

  const satirCiz = (i: number) => {
    const r = satirlar[i];
    const stil = { top: i * boy, height: boy };
    const ortak = {
      id: satirId(i), role: 'option' as const, 'aria-setsize': satirlar.length, 'aria-posinset': i + 1, 'aria-disabled': !secilebilir || undefined,
      'data-aktif': i === aktif ? '' : undefined, style: stil,
      onPointerMove: () => { if (i !== aktif) setAktif(i); }, onMouseDown: (e: FareOlayi) => e.preventDefault(), onClick: () => sec(i),
    };
    if (r.tur === 'ozel') {
      return (
        <div key="__ozel" {...ortak} aria-selected={false} className="msec__satir msec__satir--ozel" data-id={r.id}>
          <div className="msec__model">
            <div className="msec__ad-satiri"><Ikon ad="arti" olcu={15} /><span className="msec__ad">“{r.id}” kimliğini kullan</span></div>
            <div className="msec__alt-satir"><span className="msec__kimlik">Listede yok; {KAYNAK_ADI[sekme]} kimliği olduğu gibi kullanılır.</span></div>
          </div>
        </div>
      );
    }
    const m = r.m;
    const secili = m.id === seciliId;
    if (bilgiSekmesi) {
      // Yalnız bilgi (Karar I): seçilmez, üstüne gelince vurgulanmaz; kurulum durumu ve yerel beynin şu anki modeli yazar.
      const kurulu = kuruluMu(m.id);
      const u = m.yerel && yerelMakine ? yerelUygunluk(m.yerel, yerelMakine, { kurulu }) : null;
      const kullanilan = m.id === p.yerel?.model;
      return (
        <div
          key={m.id} role="listitem" style={stil} className="msec__satir msec__satir--yerel msec__satir--bilgi" data-id={m.id} data-uygunluk={u?.durum} data-kurulu={kurulu ? '' : undefined}
          onMouseDown={(e: FareOlayi) => e.preventDefault()} // odak aramada kalsın (Esc ve kısayollar çalışsın)
        >
          <div className="msec__model">
            <div className="msec__ad-satiri">
              <span className="msec__ad">{m.ad}</span>
              {onerilenMi(m) && <span className="msec__oneri">Önerilen</span>}
              {kullanilan && <span className="msec__rozet msec__rozet--notr">Kullanılan yerel model</span>}
            </div>
            <div className="msec__kurulum" data-kurulu={kurulu ? '' : undefined}>
              {!yerelDurum ? 'Kurulum denetleniyor…'
                : kurulu ? <><Ikon ad="tamam" olcu={13} />Kurulu</>
                : <><Ikon ad="ice" olcu={13} />İndirilmesi gerekir ({m.yerel ? gbMetni(m.yerel.boyutGB) : '—'})</>}
              {m.aciklama && <span className="msec__kurulum-aciklama"> · {m.aciklama}</span>}
            </div>
          </div>
          <span className="msec__sayi">{m.yerel ? gbMetni(m.yerel.boyutGB) : '—'}</span>
          <span className="msec__sayi">{m.yerel ? gbMetni(m.yerel.ramGB) : '—'}</span>
          <span className="msec__sayi">{m.yerel?.vramGB !== undefined ? gbMetni(m.yerel.vramGB) : 'Gerekmez'}</span>
          <span className="msec__uygun" data-durum={u?.durum}>
            {u ? <><b><i className={`nokta nokta--${UYGUN_NOKTA[u.durum]}`} aria-hidden="true" />{UYGUNLUK_ADI[u.durum]}</b><small>{u.neden}</small></> : <small>Denetleniyor…</small>}
          </span>
        </div>
      );
    }
    const ucretsiz = m.girisFiyat === 0 && m.cikisFiyat === 0;
    return (
      <div key={m.id} {...ortak} aria-selected={secili} className="msec__satir" data-id={m.id} data-secili={secili ? '' : undefined}>
        <div className="msec__model">
          <div className="msec__ad-satiri">
            <span className="msec__ad">{m.ad}</span>
            {onerilenMi(m) && <span className="msec__oneri">Önerilen</span>}
            {ucretsiz && <span className="msec__rozet">Ücretsiz</span>}
          </div>
          <div className="msec__alt-satir">
            {/* Adı kimliğin kendisi olan (elle yazılmış) modelde kimlik ikinci kez yazılmaz. */}
            {m.ad === m.id
              ? <span className="msec__kimlik msec__kimlik--not">Elle yazılmış kimlik; ayrıntı bilinmiyor</span>
              : <span className="msec__kimlik" title={m.id}>{m.id}</span>}
            {m.yetenekler.map((y) => (
              <span key={y} className="msec__yetenek" title={`${YETENEK_ADI[y]}: ${YETENEK_ACIKLAMA[y]}`}><Ikon ad={YETENEK_SIMGE[y]} olcu={13} />{YETENEK_KISA[y]}</span>
            ))}
          </div>
        </div>
        <span className="msec__sayi">{baglamMetni(m.baglam)}</span>
        <span className="msec__sayi" data-ucretsiz={m.girisFiyat === 0 ? '' : undefined} title={m.fiyatNotu}>{fiyatMetni(m.girisFiyat)}{m.fiyatNotu && <sup className="msec__fiyat-notu" aria-hidden="true">*</sup>}</span>
        <span className="msec__sayi" data-ucretsiz={m.cikisFiyat === 0 ? '' : undefined} title={m.fiyatNotu}>{fiyatMetni(m.cikisFiyat)}{m.fiyatNotu && <sup className="msec__fiyat-notu" aria-hidden="true">*</sup>}</span>
        <span className="msec__isaret" aria-hidden="true">{secili && <Ikon ad="tamam" olcu={16} />}</span>
      </div>
    );
  };

  return createPortal(
    <div className="msec" data-klavye={p.klavyeyle ? '' : undefined}>
      {/* Tıklama (basış değil): perde basışta kalkarsa bırakış alttaki ayara tıklama olarak düşerdi. */}
      <div className="msec__perde" onClick={p.kapat} />
      <section ref={sayfa} className="msec__sayfa" role="dialog" aria-modal="true" aria-labelledby={baslikId} onKeyDown={tus}>
        <header className="msec__bas">
          <div className="msec__bas-metin">
            <h2 id={baslikId} className="msec__baslik">{p.baslik}</h2>
            {p.aciklama && <p className="msec__giris">{p.aciklama}</p>}
          </div>
          <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge msec__kapat" aria-label="Kapat" title="Kapat (Esc)" onClick={p.kapat}><Ikon ad="kapat" olcu={17} /></button>
        </header>

        <div className="msec__ara">
          <Ikon ad="ara" olcu={17} />
          <input
            ref={ara} value={sorgu} onChange={(e) => setSorgu(e.target.value)} placeholder="Ara: model adı, şirket ya da kimlik" spellCheck={false}
            role="combobox" aria-expanded={listeKutusu} aria-controls={listeKutusu ? listeId : undefined} aria-autocomplete="list" aria-activedescendant={etkinId} aria-label={`${p.baslik}: ara`}
          />
          {sorgu && <button type="button" className="msec__temizle" aria-label="Aramayı temizle" onClick={() => { setSorgu(''); ara.current?.focus(); }}><Ikon ad="kapat" olcu={15} /></button>}
        </div>

        <div className="msec__sekmeler" role="tablist" aria-label="Sağlayıcı">
          {sekmeler.map((s, i) => (
            <button
              key={s} id={sekmeId(s)} type="button" role="tab" data-sekme={s} aria-selected={s === sekme} aria-controls={panelId} tabIndex={s === sekme ? 0 : -1}
              title={`${KAYNAK_ADI[s]} (Ctrl+${i + 1})`} onClick={() => sekmeyeGec(s)} onKeyDown={sekmeTus}
            >
              <span>{KAYNAK_ADI[s]}</span>
              {anahtarVar(s) ? <span className="msec__sekme-sayi">{sayiMetni(s)}</span> : <span className="msec__sekme-kilit"><Ikon ad="kilit" olcu={13} />anahtar yok</span>}
            </button>
          ))}
        </div>

        {/* Sekme paneli: süzgeçler, bilgi şeridi, sütun başlıkları ve liste (sekmeler aria-controls ile buraya bağlı). */}
        <div className="msec__panel" role="tabpanel" id={panelId} aria-labelledby={sekmeId(sekme)}>
        {!bilgiSekmesi ? (
          <div className="msec__arac">
            <div className="msec__cipler" role="group" aria-label="Süz">
              {SUZGECLER.map(([k, ad, aciklama]) => (
                <button key={k} type="button" className="msec__cip" data-suzgec={k} aria-pressed={Boolean(suzgec[k])} title={aciklama} onClick={() => setSuzgec((x) => ({ ...x, [k]: !x[k] }))}>
                  {k !== 'ucretsiz' && <Ikon ad={YETENEK_SIMGE[k as Yetenek]} olcu={14} />}{ad}
                </button>
              ))}
            </div>
            <div className="sekmeler msec__sira" role="radiogroup" aria-label="Sırala">
              {SIRALAR.map(([k, ad]) => (
                <button key={k} type="button" role="radio" data-sira={k} aria-checked={sira === k} tabIndex={sira === k ? 0 : -1} onClick={() => setSira(k)} onKeyDown={siraTus}>{ad}</button>
              ))}
            </div>
          </div>
        ) : null}

        {bilgiSekmesi ? (
          <div className="msec__not" data-not="yerel">
            <Ikon ad="kilit" olcu={16} />
            <div className="msec__not-metin">
              <b>Yerel model bu bilgisayarda çalışır</b>
              <span>Yerel model seçilince gündelik sohbet, notlar ve sınıflandırma bu bilgisayarda yapılır. Bu rolün modeli bulutta kalır. Yerel modeli Gizlilik bölümünde kurar ve seçersin: orada indirme ve geçiş durumu görünür.</span>
              <span className="msec__makine" data-makine="">{yerelMakine ? `Bu bilgisayar: ${makineMetni(yerelMakine)}` : 'Bu bilgisayar denetleniyor…'}</span>
            </div>
            {p.yerel?.ayarlaraGit && <button type="button" className="dgm dgm--koyu dgm--k" onClick={p.yerel.ayarlaraGit}>Yerel model ayarları</button>}
          </div>
        ) : !anahtarVar(sekme) ? (
          <div className="msec__not" data-not="anahtar">
            <Ikon ad="kilit" olcu={16} />
            <div className="msec__not-metin">
              <b>{KAYNAK_ADI[sekme]} bağlı değil</b>
              <span>Bu liste bilgi içindir; buradan model seçilmez.</span>
            </div>
            {p.motorlaraGit && <button type="button" className="dgm dgm--koyu dgm--k" onClick={p.motorlaraGit}>Motorlara git</button>}
          </div>
        ) : l?.bilgi ? (
          // Gizli / "Yalnız bu bilgisayar": liste bilerek sağlayıcıdan alınmadı (anahtar buluta gitmez) — hata değil, kilit simgeli sakin satır.
          <div className="msec__not msec__not--satir" data-not="yerel-liste" role="note">
            <Ikon ad="kilit" olcu={14} />
            <span className="msec__not-satir">{l.bilgi}</span>
          </div>
        ) : l?.hata ? (
          <div className="msec__not" data-not="hata">
            <Ikon ad="uyari" olcu={16} />
            <div className="msec__not-metin"><b>Liste alınamadı</b><span>{l.hata} Bilinen modeller gösteriliyor; kimliği arama kutusuna yazarak da seçebilirsin.</span></div>
          </div>
        ) : null}

        <div className={`msec__baslik-satiri${bilgiSekmesi ? ' msec__baslik-satiri--yerel' : ''}`} aria-hidden="true">
          {bilgiSekmesi
            ? <><span>Model</span><span>Disk</span><span>Bellek</span><span>Ekran kartı</span><span>Bu bilgisayarda</span></>
            : <><span>Model</span><span>Bağlam</span><span>Giriş $/1M</span><span>Çıkış $/1M</span><span /></>}
        </div>

        <div
          ref={kutu} className="msec__liste" id={listeId} role={listeKutusu ? 'listbox' : 'list'} aria-label={`${KAYNAK_ADI[sekme]} modelleri`} data-sekme={sekme}
          aria-busy={yukleniyor || undefined} onScroll={(e) => setKaydirma(e.currentTarget.scrollTop)}
        >
          {yukleniyor ? (
            <div className="msec__iskelet" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="msec__iskelet-satir" style={{ height: boy }}><i /><i /></div>)}</div>
          ) : satirlar.length ? (
            <div className="msec__ic" style={{ height: satirlar.length * boy }}>{cizilen.map(satirCiz)}</div>
          ) : (
            <div className="msec__bos" role="presentation">{yazilan ? `“${yazilan}” ile eşleşen model yok.` : 'Bu süzgeçlerle eşleşen model yok.'}</div>
          )}
        </div>
        </div>

        <footer className="msec__alt">
          <span className="msec__kaynak">{kaynakNotu}</span>
          <span className="msec__ipuclari" aria-hidden="true">{!bilgiSekmesi && <><kbd>↑↓</kbd> gez <kbd>Enter</kbd> seç </>}<kbd>Ctrl+Tab</kbd> sağlayıcı <kbd>Esc</kbd> kapat</span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
