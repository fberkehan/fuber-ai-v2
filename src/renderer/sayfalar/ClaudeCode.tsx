// ── Claude Code çalışma alanı (Görev 28, K17 — yalnız Geliştirici; terminal gerekmez) ──────────────────────────────────────────
// Uygulama bütün Claude Code oturumlarını yönetir; etkili bir arayüzle, hiç terminale
// ihtiyaç kalmadan her şey bu uygulamada yapılabilir. Üç bölme:
//  • Sol: Yeni oturum (Ctrl+N) · arama (Ctrl+K) · Çalışanlar (canlı hâl: Çalışıyor / İzin bekliyor / Bitti / Hata / Sırada) · projelere
//    göre geçmiş (JSONL dizini).
//  • Orta: canlı döküm (sanallaştırılmış; bütün araç kartları, fark görünümü) + izin/soru kartları + yazma kutusu ("/" komut paleti,
//    "@" dosya, resim, kuyruk, Durdur/Esc, mod ve model).
//  • Sağ: denetçi (klasör, dal, değişen dosyalar + git farkı, yapılacaklar, model/mod/maliyet/süre; Klasörü aç, Terminalde aç, Çatalla,
//    Durdur). Dar pencerede (gövde < 1120 px) denetçi bir düğmeyle açılan çekmece olur.
// Üst sekmeler: Oturumlar · Projeler (CLAUDE.md) · Eklentiler (Görev 29: claudecode/Eklentiler.tsx) · Ayarlar. Kaydırma yalnız döküm ve
// listelerde; sayfanın kendisi kaymaz. Ada/tost bildirimine tıklanınca 'ana:git' → 'claude#cc-<oturum>' o oturumu seçer;
// 'claude#eklentiler' (Geliştirici Paketi bildirimi) Eklentiler sekmesini açar.
// Motor ve kanallar: Görev 27 (main/claudecode/*, shared/cc-olay.ts). Fuber kodu kendisi yazmaz; işi Claude Code yapar.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cagir, dinle, zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Secici } from '../bilesenler/Secici';
import { ccDepo, islem, type CanliOturum } from '../claudecode/depo';
import { modelKur, ESKI_SAYFA_SINIRI, type DokumModeli } from '../claudecode/dokum-modeli';
import { Dokum } from '../claudecode/Dokum';
import { IzinKarti, IzinBaglam, type IzinYaniti, type IzinBaglamDegeri } from '../claudecode/IzinKarti';
import { Yazici, taslakSil, type CcGorsel } from '../claudecode/Yazici';
import { CanliDenetci, GecmisDenetci } from '../claudecode/Denetci';
import { ArkaIsler } from '../claudecode/ArkaIsler';
import { OturumListesi, type Secim } from '../claudecode/OturumListesi';
import { Projeler, type CcProje } from '../claudecode/Projeler';
import { CcAyarlar, type CcAuth } from '../claudecode/CcAyarlar';
import { Eklentiler } from '../claudecode/Eklentiler';
import { FarkGorunumu } from '../claudecode/FarkGorunumu';
import { KlasorGuveniKarti, klasorGuveniAl, type KlasorGuvenBilgisi } from '../claudecode/KlasorGuveni';
import { ccGorunenOturum } from '../claudecode/gorunurluk';
import { birlesikFarkCoz } from '../claudecode/fark';
import { halBilgisi, turSuruyor, sureMetni, kisaYol, goreliYol, hataSade, aracAdiTr, YERLESIK_KOMUTLAR, BECERI_NOTU, MOD_ADLARI, komutYedegi, baglantiHedefi, BAGLANTI_YOK, hesapMetni, modBeklemesiBitti, type GecmisOturum, type KomutBilgisi } from '../claudecode/yardimci';
import { ccCipaCoz, type CcMod, type CcEfor, type CcOturumOzeti } from '../../shared/cc-olay';
import { tostGoster } from '../tostlar';
import type { CcAyari } from '../../shared/cc-ayar';
import './claudecode.css';

type Sekme = 'oturumlar' | 'projeler' | 'eklentiler' | 'ayarlar';
/** Üst sekmeler (Eklentiler: Görev 29 — Fuber Geliştirici Paketi, kurulu eklentiler, beceriler, MCP, katalog). */
// Simge yalnız dar başlıkta görünür: orada seçili olmayan sekme yalnız simgesiyle durur (adı ekran okuyucuda ve ipucunda), seçili sekme
// adıyla — dört sekme başlığın ortasındaki tost şeridine (bilesenler/tostlar.css) taşmasın. Geniş başlıkta yalnız adlar.
export const CC_SEKMELERI: readonly { id: Sekme; ad: string; ikon: string; gorunur: boolean }[] = [
  { id: 'oturumlar', ad: 'Oturumlar', ikon: 'terminal', gorunur: true },
  { id: 'projeler', ad: 'Projeler', ikon: 'klasor', gorunur: true },
  { id: 'eklentiler', ad: 'Eklentiler', ikon: 'arac', gorunur: true },
  { id: 'ayarlar', ad: 'Ayarlar', ikon: 'ayarlar', gorunur: true },
];

interface Durum { claude: string | null; ayar: CcAyari; oturumSayisi: number }
type Uyari =
  | { tur: 'mod-bekliyor'; id: string; mod: CcMod; otomatik: boolean }
  | { tur: 'tam-yetki-kapali' }
  | { tur: 'baska-yerde'; metin: string; gorseller: CcGorsel[] }
  | { tur: 'hata'; metin: string };
interface GecmisDokum { kimlik: string; model: DokumModeli; once: number | null; yukleniyor: boolean; hata?: string; surum: number; sayfa?: number; sinirda?: boolean }
interface FarkSayfasi { dosya: string; fark?: string; kisaltildi?: boolean; hata?: string }

const ORNEKLER = ['Bu projeyi incele ve kısa bir özet çıkar', 'Testleri çalıştır, kırılanları düzelt', 'README’yi güncel duruma getir'];
const sec = (b: boolean, s: string) => (b ? s : '');

export function ClaudeCode() {
  const surum = useSyncExternalStore(ccDepo.abone, ccDepo.anlik);
  const [sekme, setSekme] = useState<Sekme>('oturumlar');
  const [secim, setSecimIc] = useState<Secim>(null);
  const [durum, setDurum] = useState<Durum | null>(null);
  const [auth, setAuth] = useState<CcAuth | null>(null);
  const [ara, setAra] = useState('');
  const [gecmis, setGecmis] = useState<GecmisOturum[] | null>(null);
  const [projeler, setProjeler] = useState<CcProje[] | null>(null);
  const [denetciAcik, setDenetciAcik] = useState(false);
  const [dar, setDar] = useState(false);
  const [fark, setFark] = useState<FarkSayfasi | null>(null);
  const [uyari, setUyari] = useState<Uyari | null>(null);
  const [gd, setGd] = useState<GecmisDokum | null>(null);
  const [odak, setOdak] = useState(0);
  const [taslakMod, setTaslakMod] = useState<CcMod | null>(null);
  const [taslakModel, setTaslakModel] = useState<string | null>(null);
  const [taslakEfor, setTaslakEfor] = useState<CcEfor | null>(null);
  // Klasör güveni (son dalga B, I1): kartı bekleyen klasör; `devam` karar verilince yinelenen başlatma (yoksa yalnız kart kapanır).
  const [guvenIstegi, setGuvenIstegi] = useState<{ guven: KlasorGuvenBilgisi; devam?: () => void } | null>(null);
  const [guvenDurum, setGuvenDurum] = useState<KlasorGuvenBilgisi | null>(null);
  const catalKaynagi = useRef(new Map<string, string>());
  const farkRef = useRef<HTMLDivElement>(null);
  const aramaRef = useRef<HTMLInputElement>(null);
  const govdeRef = useRef<HTMLDivElement>(null);
  const turBasi = useRef(new Map<string, number>());
  const mac = window.fuber?.platform === 'darwin';

  const setSecim = useCallback((s: Secim) => {
    setSecimIc(s); setUyari(null); setFark(null); setGuvenIstegi(null);
    // Geçmiş oturuma geçince taslağın mod/model seçimi taşınmaz (kayıtlı varsayılandan başlar).
    if (s?.tur === 'gecmis') { setTaslakMod(null); setTaslakModel(null); setTaslakEfor(null); }
  }, []);

  // ── Yükleme ──
  const durumYukle = useCallback(() => { void cagir<Durum>('claudecode:durum').then(setDurum).catch(() => undefined); }, []);
  const authYukle = useCallback(() => { setAuth(null); void cagir<CcAuth>('claudecode:auth-durum').then(setAuth).catch((e) => setAuth({ kurulu: false, girisYapildi: false, hata: (e as Error).message })); }, []);
  const projeYukle = useCallback(() => { void cagir<CcProje[]>('claudecode:projeler').then(setProjeler).catch(() => setProjeler((p) => p ?? [])); }, []);
  useEffect(() => {
    ccDepo.bagla();
    void ccDepo.yenile();
    durumYukle();
    authYukle();
    projeYukle();
    const k = dinle('ayarlar:degisti', () => durumYukle());
    return k;
  }, [durumYukle, authYukle, projeYukle]);
  useEffect(() => {
    const z = setTimeout(() => {
      void cagir<GecmisOturum[]>('claudecode:liste', ara).then(setGecmis).catch(() => setGecmis((g) => g ?? []));
    }, gecmis === null ? 0 : 220);
    return () => clearTimeout(z);
  }, [ara]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bildirimden / sohbetten gelen seçim: 'claude#cc-<oturum id>[~<Claude Code kimliği>]' (main.tsx hash'i yazar; sayfa açıkken
  // 'ana:git' doğrudan da gelir). Düzeltme 2 (N3): uygulama yeniden açıldıysa oturum gitmiş olabilir — aynı kimlikli canlı ya da
  // geçmiş (JSONL) oturum açılır; ikisi de yoksa kısa not (sessizce hiçbir şey olmaması yerine).
  useEffect(() => {
    let son = 0;
    const sec_ = (cipa: string | undefined) => {
      // Görev 29: Geliştirici Paketi bildirimi 'claude#eklentiler' → Eklentiler sekmesi.
      if (String(cipa ?? '').replace(/^#/, '') === 'eklentiler') { setSekme('eklentiler'); history.replaceState(null, '', location.pathname + location.search); return; }
      const b = ccCipaCoz(cipa);
      if (!b) return;
      setSekme('oturumlar');
      history.replaceState(null, '', location.pathname + location.search);
      const no = ++son;
      void (async () => {
        if (!ccDepo.yuklendi) await ccDepo.yenile();
        const canli = ccDepo.liste().map((x) => ({ id: x.ozet.id, kimlik: x.ozet.kimlik }));
        let h = baglantiHedefi(b, canli, [] as GecmisOturum[]);
        if (h.tur === 'yok' && b.kimlik) h = baglantiHedefi(b, canli, await cagir<GecmisOturum[]>('claudecode:liste', '').catch(() => [] as GecmisOturum[]));
        if (no !== son) return;
        if (h.tur === 'canli') setSecim({ tur: 'canli', id: h.id });
        else if (h.tur === 'gecmis') setSecim({ tur: 'gecmis', o: h.o });
        else tostGoster(BAGLANTI_YOK);
      })();
    };
    sec_(location.hash);
    const hash = () => sec_(location.hash);
    addEventListener('hashchange', hash);
    const k = dinle('ana:git', (g: string) => sec_(String(g ?? '').split('#')[1]));
    return () => { removeEventListener('hashchange', hash); k(); };
  }, [setSecim]);

  // ── Dar pencere: denetçi çekmece olur ──
  useEffect(() => {
    const el = govdeRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const r = new ResizeObserver(() => setDar(el.clientWidth < 1120));
    r.observe(el);
    return () => r.disconnect();
  }, [sekme]);

  // ── Seçili oturum ──
  void surum;
  const canlilar = ccDepo.liste();
  const k: CanliOturum | undefined = secim?.tur === 'canli' ? ccDepo.al(secim.id) : undefined;
  // Sekmeye dönünce de: kapanmış oturumun dökümü sayfadan çıkınca bırakılmış olabilir (bellek), yeniden yüklenir.
  useEffect(() => { if (secim?.tur === 'canli' && sekme === 'oturumlar') void ccDepo.yukle(secim.id); }, [secim, sekme]);
  // Ekrandaki oturumun ada bildirimi tost olarak tekrarlanmaz (claudecode/gorunurluk.ts).
  useEffect(() => {
    const id = sekme === 'oturumlar' && secim?.tur === 'canli' ? secim.id : null;
    ccGorunenOturum(id);
    ccDepo.gorunenAyarla(id); // bellek: kapanmış ve ekranda olmayan oturumların dökümü bırakılır
  }, [secim, sekme]);
  useEffect(() => () => { ccGorunenOturum(null); ccDepo.gorunenAyarla(null); }, []);
  // Seçili oturum unutuldu (ya da hiç yok): seçim boşalır.
  useEffect(() => { if (secim?.tur === 'canli' && ccDepo.yuklendi && !ccDepo.al(secim.id)) setSecim(null); }, [secim, surum, setSecim]);
  // Tur başlangıcı (süre göstergesi).
  for (const c of canlilar) {
    const s = turSuruyor(c.ozet);
    if (s && !turBasi.current.has(c.ozet.id)) turBasi.current.set(c.ozet.id, Date.now());
    if (!s) turBasi.current.delete(c.ozet.id);
  }
  // Tam yetkiye geçiş "tur bitince": oturum boşa düşünce yeniden denenir.
  // 0.15: geçiş gerçekleşince (özetteki mod hedefte) şerit hemen kalkar — ana sürecin eski süreci kapatıp yanıt vermesi beklenmez, aynı geçiş yinelenmez.
  useEffect(() => {
    if (uyari?.tur !== 'mod-bekliyor') return;
    const o = ccDepo.al(uyari.id)?.ozet;
    if (modBeklemesiBitti(uyari, o)) { setUyari(null); return; }
    if (!uyari.otomatik) return;
    if (!o || turSuruyor(o) || o.durum === 'sirada' || o.kuyruk > 0) return;
    void modDegistir(uyari.id, uyari.mod);
  }, [uyari, surum]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geçmiş oturum dökümü (JSONL sonundan, sayfalı).
  useEffect(() => {
    if (secim?.tur !== 'gecmis') { setGd(null); return; }
    const kimlik = secim.o.id;
    let iptal = false;
    setGd(null);
    void cagir<{ olaylar: { zaman: number; olay: never }[]; once: number | null; hata?: string }>('claudecode:dokum', kimlik, { adet: 80 }).then((s) => {
      if (iptal) return;
      setGd({ kimlik, model: modelKur(s.olaylar), once: s.once, yukleniyor: false, surum: 0, ...(s.hata ? { hata: s.hata } : {}) });
    }).catch((e) => { if (!iptal) setGd({ kimlik, model: modelKur([]), once: null, yukleniyor: false, surum: 0, hata: (e as Error).message }); });
    return () => { iptal = true; };
  }, [secim]);
  const gecmisDahaEski = async () => {
    if (!gd || gd.once === null || gd.yukleniyor) return;
    setGd({ ...gd, yukleniyor: true });
    const s = await cagir<{ olaylar: { zaman: number; olay: never }[]; once: number | null }>('claudecode:dokum', gd.kimlik, { once: gd.once, adet: 80 }).catch(() => null);
    if (!s) { setGd({ ...gd, yukleniyor: false }); return; }
    gd.model.oneEkle(modelKur(s.olaylar));
    const sayfa = (gd.sayfa ?? 0) + 1;
    const sinirda = sayfa >= ESKI_SAYFA_SINIRI && s.once !== null; // bellek sınırı: daha eskisi Claude Code'un kendi dökümünde
    setGd({ ...gd, once: sinirda ? null : s.once, yukleniyor: false, surum: gd.surum + 1, sayfa, sinirda });
  };

  // ── Eylemler ──
  const ayar = durum?.ayar;
  const ayarKaydet = async (d: Partial<CcAyari>) => {
    if (!ayar) return;
    const yeni = { ...ayar, ...d };
    await cagir('ayarlar:kaydet', { claudeCode: yeni });
    setDurum((x) => (x ? { ...x, ayar: yeni } : x));
  };
  const enYakinProje = () => (secim?.tur === 'canli' && k ? k.ozet.cwd : secim?.tur === 'gecmis' ? secim.o.cwd : secim?.tur === 'yeni' ? secim.cwd : projeler?.find((p) => p.var)?.cwd ?? null);
  const yeniOturum = useCallback((cwd?: string | null) => {
    setSekme('oturumlar');
    setSecim({ tur: 'yeni', cwd: cwd === undefined ? enYakinProje() : cwd });
    setTaslakMod(null); setTaslakModel(null); setTaslakEfor(null);
    setOdak((n) => n + 1);
  }, [secim, k, projeler]); // eslint-disable-line react-hooks/exhaustive-deps
  const klasorSec = async () => {
    const yol = await cagir<string | null>('claudecode:klasor-sec').catch(() => null);
    if (!yol) return;
    projeYukle();
    yeniOturum(yol);
  };
  const ozetAl = (o?: CcOturumOzeti) => { if (o) ccDepo.ozetYaz(o); return o; };

  async function modDegistir(id: string, mod: CcMod) {
    const r = await islem<{ tamam: boolean; kod?: string; hata?: string }>('claudecode:mod', id, mod);
    if (r.tamam) { setUyari((u) => (u?.tur === 'mod-bekliyor' || u?.tur === 'tam-yetki-kapali' ? null : u)); return; }
    if (r.kod === 'yeniden-baslat') setUyari((u) => ({ tur: 'mod-bekliyor', id, mod, otomatik: u?.tur === 'mod-bekliyor' ? u.otomatik : false }));
    else if (r.kod === 'tam-yetki-kapali') setUyari({ tur: 'tam-yetki-kapali' });
    else setUyari({ tur: 'hata', metin: r.hata ?? 'Mod değiştirilemedi.' });
  }
  // Analiz 11 Kas bulgu 1–3: model ve düşünme gücü canlı oturumda da değişir; tur sürerken değişimin ne zaman geçerli olduğu tek satırla söylenir.
  const modelDegistir = async (id: string, model: string | null): Promise<string | undefined> => {
    const suruyor = Boolean(ccDepo.al(id) && turSuruyor(ccDepo.al(id)!.ozet));
    const r = await islem<{ tamam: boolean; hata?: string }>('claudecode:model', id, model);
    if (!r.tamam) { setUyari({ tur: 'hata', metin: r.hata ?? 'Model değiştirilemedi.' }); return undefined; }
    return suruyor ? 'Tur sürüyor: yeni model sıradaki istekte geçerli olur.' : undefined;
  };
  const eforDegistir = async (id: string, efor: CcEfor | null): Promise<string | undefined> => {
    const suruyor = Boolean(ccDepo.al(id) && turSuruyor(ccDepo.al(id)!.ozet));
    const r = await islem<{ tamam: boolean; hata?: string; kod?: string }>('claudecode:efor', id, efor);
    if (!r.tamam) { setUyari({ tur: 'hata', metin: r.hata ?? 'Düşünme gücü değiştirilemedi.' }); return undefined; }
    // Claude Code canlı değişikliği tanımıyorsa (eski sürüm) değer sonraki mesajda yeni süreçle geçerli.
    if (r.kod === 'sonraki') return 'Bu Claude Code sürümü canlı değişikliği desteklemiyor: düşünme gücü sonraki mesajda (arkada iş sürüyorsa o bitince) geçerli olur.';
    return suruyor ? 'Tur sürüyor: yeni düşünme gücü sıradaki istekte geçerli olur.' : undefined;
  };
  const kes = (id: string) => { void cagir('claudecode:kes', id); };
  const izinYanitla = (id: string, istekId: string) => (y: IzinYaniti) => cagir<{ tamam: boolean; hata?: string }>('claudecode:izin-yanitla', id, istekId, y);

  const baslat = async (i: { cwd: string; istem?: string; gorseller?: CcGorsel[]; surdur?: string; catalla?: boolean; mod?: CcMod; model?: string | null; efor?: CcEfor | null; baslik?: string }) => {
    const r = await islem<{ tamam: boolean; hata?: string; kod?: string; oturum?: CcOturumOzeti; guven?: KlasorGuvenBilgisi }>('claudecode:baslat', {
      ...i, ...(i.gorseller?.length ? {} : { gorseller: undefined }), ...(i.model ? {} : { model: undefined }), ...(i.efor ? {} : { efor: undefined }),
    });
    if (r.tamam && r.oturum) { ozetAl(r.oturum); projeYukle(); }
    return r;
  };
  /** Klasör güveni (I1): motor kararsız klasörde süreç açmadı → kart; karar verilince aynı işlem yinelenir. */
  const guvenGerekti = (r: { kod?: string; guven?: KlasorGuvenBilgisi }, devam: () => void) => {
    if (r.kod !== 'klasor-guveni' || !r.guven) return false;
    setUyari(null);
    setGuvenIstegi({ guven: r.guven, devam });
    return true;
  };
  // Yeni oturum görünümünde klasör seçilince güven durumu okunur: kendi ayarı olup kararı verilmemişse kart HEMEN (yazmadan önce) çıkar.
  const yeniCwd = secim?.tur === 'yeni' ? secim.cwd : null;
  useEffect(() => {
    setGuvenDurum(null);
    if (!yeniCwd) return;
    let iptal = false;
    void klasorGuveniAl(yeniCwd).then((d) => {
      if (iptal || !d) return;
      setGuvenDurum(d);
      if (d.gerekli && !d.karar) setGuvenIstegi((g) => g ?? { guven: d });
    });
    return () => { iptal = true; };
  }, [yeniCwd]);

  /** Taslak (yeni oturum) gönderimi. */
  const taslakGonder = async (metin: string, gorseller: CcGorsel[]) => {
    if (secim?.tur !== 'yeni') return false;
    if (!secim.cwd) { setUyari({ tur: 'hata', metin: 'Önce bir proje klasörü seç.' }); return false; }
    const r = await baslat({ cwd: secim.cwd, istem: metin, gorseller, mod: taslakMod ?? ayar?.varsayilanMod, model: taslakModel, efor: taslakEfor });
    if (guvenGerekti(r, () => void taslakGonder(metin, gorseller))) return false;
    if (!r.tamam || !r.oturum) { setUyari({ tur: 'hata', metin: r.hata ?? 'Oturum başlatılamadı.' }); return false; }
    taslakSil(`yeni:${secim.cwd}`);
    setSecim({ tur: 'canli', id: r.oturum.id });
    setOdak((n) => n + 1);
    return true;
  };
  /** Geçmiş oturumda yazınca: uygulama içinde sürdürülür (başka yerde açıksa çatallama önerilir). */
  const gecmisGonder = async (metin: string, gorseller: CcGorsel[], catalla = false) => {
    if (secim?.tur !== 'gecmis') return false;
    const o = secim.o;
    const r = await baslat({ cwd: o.cwd, surdur: o.id, catalla, istem: metin, gorseller, mod: taslakMod ?? ayar?.varsayilanMod, model: taslakModel, efor: taslakEfor, baslik: catalla ? `${o.baslik} (çatal)` : o.baslik });
    if (guvenGerekti(r, () => void gecmisGonder(metin, gorseller, catalla))) return false;
    if (r.kod === 'baska-yerde') { setUyari({ tur: 'baska-yerde', metin, gorseller }); return false; }
    if (!r.tamam || !r.oturum) { setUyari({ tur: 'hata', metin: r.hata ?? 'Sürdürülemedi.' }); return false; }
    if (gd?.kimlik === o.id) ccDepo.oncesiBagla(r.oturum.id, gd.model, gd.once, o.id);
    taslakSil(`gecmis:${o.id}`);
    setSecim({ tur: 'canli', id: r.oturum.id });
    setOdak((n) => n + 1);
    return true;
  };
  const canliGonder = async (metin: string, gorseller: CcGorsel[]) => {
    if (!k) return false;
    const r = await islem<{ tamam: boolean; hata?: string; kod?: string }>('claudecode:gonder', k.ozet.id, { metin, ...(gorseller.length ? { gorseller } : {}) });
    if (!r.tamam) {
      setUyari(r.kod === 'baska-yerde' ? { tur: 'hata', metin: `${r.hata ?? 'Bu oturum başka bir yerde açık.'} Denetçiden “Çatalla” ile sürdürebilirsin.` } : { tur: 'hata', metin: r.hata ?? 'Gönderilemedi.' });
      return false;
    }
    setUyari(null);
    ccDepo.kuyrugaEkle(k.ozet.id, metin, gorseller.length);
    return true;
  };
  const catalla = async (kaynak: { cwd: string; kimlik: string; baslik: string }) => {
    const r = await baslat({ cwd: kaynak.cwd, surdur: kaynak.kimlik, catalla: true, mod: ayar?.varsayilanMod, baslik: `${kaynak.baslik} (çatal)` });
    if (guvenGerekti(r, () => void catalla(kaynak))) return;
    if (!r.tamam || !r.oturum) { setUyari({ tur: 'hata', metin: r.hata ?? 'Çatallanamadı.' }); return; }
    catalKaynagi.current.set(r.oturum.id, kaynak.baslik);
    if (secim?.tur === 'gecmis' && gd?.kimlik === kaynak.kimlik) ccDepo.oncesiBagla(r.oturum.id, gd.model, gd.once, kaynak.kimlik);
    setSecim({ tur: 'canli', id: r.oturum.id });
    setOdak((n) => n + 1);
  };
  /**
   * "/" paleti (düzeltme turu 1): canlı oturumda Claude Code'un supportedCommands() listesi. Taslak ve geçmiş oturumda süreç AÇILMAZ (süreç
   * yalnız gönderince başlar): son bilinen liste, yoksa yerleşik komutlar + "Beceri komutları ilk mesajdan sonra görünür" notu.
   */
  const komutlarIste = async (): Promise<{ komutlar: KomutBilgisi[]; hata?: string; not?: string }> => {
    // Düzeltme 2 (N4): kapanmış/çökmüş oturumda motor boş ya da hatalı döner — yedek liste ("yükleniyor"da kalınmaz).
    if (k) return komutYedegi(await ccDepo.komutlar(k.ozet.id), ccDepo.sonKomutlar);
    const bilinen = ccDepo.sonKomutlar;
    if (bilinen.length) return { komutlar: bilinen };
    return { komutlar: [...YERLESIK_KOMUTLAR], not: BECERI_NOTU };
  };
  const farkAc = async (dosya: string) => {
    if (!k) return;
    if (dar) setDenetciAcik(false); // dar pencerede çekmece farkın üstünü örtmesin
    setFark({ dosya });
    const r = await cagir<{ fark: string; kisaltildi: boolean; hata?: string }>('claudecode:fark', k.ozet.id, dosya).catch((e) => ({ fark: '', kisaltildi: false, hata: (e as Error).message }));
    setFark((f) => (f?.dosya === dosya ? { dosya, ...r } : f));
  };

  // Fark sayfası açılınca odak ona (klavyeyle kaydırılır); açıkken Esc nerede olursa olsun onu kapatır (palet/seçici kendi Esc'ini önce alır).
  useEffect(() => { if (fark) farkRef.current?.focus({ preventScroll: true }); }, [fark?.dosya]); // eslint-disable-line react-hooks/exhaustive-deps
  const farkAcik = Boolean(fark);
  useEffect(() => {
    if (!farkAcik) return;
    const tus = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && !document.querySelector('[aria-modal="true"]')) { e.preventDefault(); setFark(null); } };
    addEventListener('keydown', tus);
    return () => removeEventListener('keydown', tus);
  }, [farkAcik]);

  // ── Klavye: Ctrl+N yeni oturum, Ctrl+K oturum ara (uygulamanın Ctrl+N'i bu sayfada yeni OTURUM açar) ──
  const kisayol = useRef({ yeniOturum, sekme });
  kisayol.current = { yeniOturum, sekme };
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || e.shiftKey || e.repeat || document.querySelector('[aria-modal="true"]')) return;
      const ana = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!ana) return;
      const h = e.key.toLocaleLowerCase('tr-TR');
      if (e.code === 'KeyN' || h === 'n') { e.preventDefault(); kisayol.current.yeniOturum(); return; }
      if (e.code === 'KeyK' || h === 'k') {
        e.preventDefault();
        setSekme('oturumlar');
        requestAnimationFrame(() => { aramaRef.current?.focus(); aramaRef.current?.select(); });
      }
    };
    addEventListener('keydown', tus, true);
    return () => removeEventListener('keydown', tus, true);
  }, [mac]);
  /** Esc: fark sayfası açıksa kapatır; yoksa (odak yazma kutusunda ya da dökümdeyken) süren turu durdurur. */
  const ortaTus = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return; // IME ile yazarken Esc oluşturmayı iptal eder
    if (fark) { e.preventDefault(); setFark(null); return; }
    const t = e.target as HTMLElement;
    if (k && turSuruyor(k.ozet) && (t.closest('.cc-yazici') || t.closest('.cc-dokum'))) { e.preventDefault(); kes(k.ozet.id); }
  };

  // ── Çizim ──
  const gorunenSekmeler = CC_SEKMELERI.filter((s) => s.gorunur);
  const calisanSayisi = canlilar.filter((c) => turSuruyor(c.ozet)).length;
  const izinSayisi = canlilar.reduce((n, c) => n + c.ozet.bekleyenIzin, 0);
  const tamYetkiAcik = Boolean(ayar?.tamYetki);

  const uyariCiz = (): ReactNode => {
    if (!uyari) return null;
    if (uyari.tur === 'mod-bekliyor') {
      return (
        <div className="cc-serit" data-ton="izin" role="status">
          <Ikon ad="uyari" olcu={15} />
          <span><b>Tam yetkiye geçmek için Claude Code yeniden açılmalı.</b> {uyari.otomatik ? 'Bu tur bitince kendiliğinden geçilecek.' : 'Oturum şu an çalışıyor.'}</span>
          <span className="cc-bosluk" />
          {!uyari.otomatik && <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => setUyari({ ...uyari, otomatik: true })}>Tur bitince geç</button>}
          <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => { setUyari({ ...uyari, otomatik: true }); kes(uyari.id); }}>Durdur ve geç</button>
          <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => setUyari(null)}>Vazgeç</button>
        </div>
      );
    }
    if (uyari.tur === 'tam-yetki-kapali') {
      return (
        <div className="cc-serit" data-ton="hata" role="alert">
          <Ikon ad="kalkan" olcu={15} /><span><b>Tam yetki kapalı.</b> Ayarlar sekmesinden “Tam yetki”yi açınca seçilebilir.</span><span className="cc-bosluk" />
          <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => setSekme('ayarlar')}>Ayarlar’a git</button>
          <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" aria-label="Kapat" onClick={() => setUyari(null)}><Ikon ad="kapat" olcu={14} /></button>
        </div>
      );
    }
    if (uyari.tur === 'baska-yerde') {
      return (
        <div className="cc-serit" data-ton="izin" role="alert">
          <Ikon ad="uyari" olcu={15} /><span><b>Bu oturum başka bir yerde açık görünüyor</b> (terminal ya da başka bir uygulama); doğrudan sürdürülmez.</span><span className="cc-bosluk" />
          <button type="button" className="dgm dgm--beyaz dgm--k" onClick={() => { const u = uyari; setUyari(null); void gecmisGonder(u.metin, u.gorseller, true); }}><Ikon ad="catal" olcu={14} />Çatalla ve gönder</button>
          <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => setUyari(null)}>Vazgeç</button>
        </div>
      );
    }
    return (
      <div className="cc-serit" data-ton="hata" role="alert">
        <Ikon ad="uyari" olcu={15} /><span>{uyari.metin}</span><span className="cc-bosluk" />
        <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" aria-label="Kapat" onClick={() => setUyari(null)}><Ikon ad="kapat" olcu={14} /></button>
      </div>
    );
  };

  const yaziciOrtak = {
    tamYetkiAcik,
    // Taslakta da dolu: canlı oturumdan gelen, yoksa ana sürecin saklı listesi, yoksa opus / sonnet / haiku (0.13 T12).
    modeller: ccDepo.modelListesi(),
    durdur: () => { if (k) kes(k.ozet.id); },
    komutlarIste,
    ust: uyariCiz(),
    odakIstegi: odak,
  };

  const denetciGoster = (secim?.tur === 'canli' && k) || secim?.tur === 'gecmis';
  const denetci = !denetciGoster ? null : secim?.tur === 'canli' && k
    ? <CanliDenetci k={k} farkAc={(d) => void farkAc(d)} catalla={() => k.ozet.kimlik && void catalla({ cwd: k.ozet.cwd, kimlik: k.ozet.kimlik, baslik: k.ozet.baslik })} kapat={dar ? () => setDenetciAcik(false) : undefined} />
    : secim?.tur === 'gecmis'
      ? <GecmisDenetci o={secim.o} catalla={() => void catalla({ cwd: secim.o.cwd, kimlik: secim.o.id, baslik: secim.o.baslik })} kapat={dar ? () => setDenetciAcik(false) : undefined} />
      : null;

  const guvenKarari = (karar: 'guven' | 'guvenme') => {
    const g = guvenIstegi;
    setGuvenIstegi(null);
    if (g) setGuvenDurum((d) => (d && d.cwd === g.guven.cwd ? { ...d, karar } : d));
    g?.devam?.();
  };
  // Vazgeç: yeni oturumda kart kapanır ve boş duruma dönülür (aynı klasörde kart yeniden sorar); geçmişte yalnız kart kapanır.
  const guvenVazgec = () => { setGuvenIstegi(null); if (secim?.tur === 'yeni') setSecim(null); };

  let orta: ReactNode;
  if (guvenIstegi) orta = <KlasorGuveniKarti guven={guvenIstegi.guven} kararVerildi={guvenKarari} vazgec={guvenVazgec} />;
  else if (secim?.tur === 'canli' && k) orta = <CanliGorunum k={k} cwd={k.ozet.cwd} catalKaynagi={catalKaynagi.current.get(k.ozet.id)} denetciDugmesi={dar ? <DenetciDugmesi acik={denetciAcik} degistir={setDenetciAcik} /> : null}
    turBasi={turBasi.current.get(k.ozet.id)} izinYanitla={izinYanitla} dahaEskisi={() => void ccDepo.dahaEskisi(k.ozet.id)}
    yazici={<Yazici {...yaziciOrtak} taslakAnahtari={k.ozet.id} oturumId={k.ozet.id} cwd={k.ozet.cwd} calisiyor={turSuruyor(k.ozet) || k.ozet.durum === 'sirada'} kuyruk={k.kuyruk}
      mod={k.ozet.mod} modDegistir={(m) => void modDegistir(k.ozet.id, m)} model={k.ozet.model ?? null} etkinModel={k.ozet.etkinModel ?? null} modelDegistir={(m) => modelDegistir(k.ozet.id, m)} modellerIste={() => void ccDepo.komutlar(k.ozet.id)}
      efor={k.ozet.efor ?? null} eforDegistir={(e) => eforDegistir(k.ozet.id, e)}
      gonder={canliGonder} yerTutucu={turSuruyor(k.ozet) ? 'Yaz; bu tur bitince gönderilir…' : 'Claude Code’a ne yaptırayım?'} />} />;
  else if (secim?.tur === 'gecmis') orta = (
    <GecmisGorunum o={secim.o} gd={gd} dahaEskisi={() => void gecmisDahaEski()} denetciDugmesi={dar ? <DenetciDugmesi acik={denetciAcik} degistir={setDenetciAcik} /> : null}
      yazici={<Yazici {...yaziciOrtak} taslakAnahtari={`gecmis:${secim.o.id}`} oturumId={null} cwd={secim.o.cwd} calisiyor={false} kuyruk={[]}
        mod={taslakMod ?? ayar?.varsayilanMod ?? 'acceptEdits'} modDegistir={(m) => { if (m === 'bypassPermissions' && !tamYetkiAcik) { setUyari({ tur: 'tam-yetki-kapali' }); return; } setTaslakMod(m); }} model={taslakModel} modelDegistir={setTaslakModel} modellerIste={() => void ccDepo.modelleriYenile()} efor={taslakEfor} eforDegistir={setTaslakEfor}
        gonder={(m, g) => gecmisGonder(m, g)} yerTutucu="Yaz; bu konuşma uygulamada kaldığı yerden sürer…" />} />
  );
  else if (secim?.tur === 'yeni') orta = (
    <YeniOturum auth={auth} cwd={secim.cwd} guven={guvenDurum?.cwd && secim.cwd && guvenDurum.gerekli ? guvenDurum : null} projeler={projeler} cwdDegistir={(c) => setSecimIc({ tur: 'yeni', cwd: c })} klasorSec={() => void klasorSec()} ornekSec={(m) => { void taslakGonder(m, []); }}
      yazici={<Yazici {...yaziciOrtak} taslakAnahtari={`yeni:${secim.cwd ?? ''}`} oturumId={null} cwd={secim.cwd} calisiyor={false} kuyruk={[]}
        mod={taslakMod ?? ayar?.varsayilanMod ?? 'acceptEdits'} modDegistir={(m) => { if (m === 'bypassPermissions' && !tamYetkiAcik) { setUyari({ tur: 'tam-yetki-kapali' }); return; } setTaslakMod(m); }} model={taslakModel} modelDegistir={setTaslakModel} modellerIste={() => void ccDepo.modelleriYenile()} efor={taslakEfor} eforDegistir={setTaslakEfor}
        gonder={taslakGonder} devreDisi={!secim.cwd} yerTutucu={secim.cwd ? 'Ne yapılsın? ör. “giriş ekranındaki taşmayı düzelt”' : 'Önce bir proje klasörü seç'} />} />
  );
  else orta = <BosDurum durum={durum} auth={auth} projeler={projeler} yeniOturum={(c) => yeniOturum(c)} klasorSec={() => void klasorSec()} ayarlaraGit={() => setSekme('ayarlar')} mac={mac} canlilar={canlilar} sec={setSecim} gecmis={gecmis} />;

  return (
    <div className="cc" data-sekme={sekme}>
      <header className="cc__bas">
        {/* Başlık şeridinin ortası tost katmanına ayrılmıştır (bilesenler/tostlar.css: y 52…132, ortada en çok 520 px): orada düğme YOK.
            Solda başlık (yazı), sağda durum hapları ve sekmeler. */}
        <h1 className="cc__baslik">Claude Code</h1>
        <div className="cc__sag">
          <div className="cc__durum">
            {calisanSayisi > 0 && <span className="cc-hal cc-hal--hap" data-ton="calisiyor"><i aria-hidden="true" />{calisanSayisi} çalışıyor</span>}
            {durum && !durum.claude && <span className="cc-hal cc-hal--hap cc-hal--onemli" data-ton="hata"><i aria-hidden="true" />Claude Code bulunamadı</span>}
            {durum?.claude && auth?.girisYapildi === false && <span className="cc-hal cc-hal--hap cc-hal--onemli" data-ton="izin"><i aria-hidden="true" />Claude oturumu kapalı</span>}
          </div>
          <div className="sekmeler cc__sekmeler" role="tablist" aria-label="Claude Code bölümleri">
            {gorunenSekmeler.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={sekme === s.id} onClick={() => { setSekme(s.id); if (s.id === 'projeler') projeYukle(); }} data-sekme={s.id} title={s.ad}>
                <span className="cc__sekme-simge" aria-hidden="true"><Ikon ad={s.ikon} olcu={15} /></span><span className="cc__sekme-ad">{s.ad}</span>{s.id === 'oturumlar' && izinSayisi > 0 && <span className="cc-sekme-rozet" aria-label={`${izinSayisi} izin bekliyor`}>{izinSayisi}</span>}
              </button>
            ))}
          </div>
        </div>
      </header>

      {sekme === 'oturumlar' && (
        <div ref={govdeRef} className={`cc__govde${sec(dar, ' cc__govde--dar')}${sec(Boolean(denetci), ' cc__govde--denetcili')}`}>
          <OturumListesi canlilar={canlilar} gecmis={gecmis} secim={secim} sec={setSecim} ara={ara} setAra={setAra} aramaRef={aramaRef} yeniOturum={() => yeniOturum()} mac={mac} />
          <section className="cc-orta" aria-label="Oturum" onKeyDown={ortaTus}>
            {orta}
            {fark && (
              <div ref={farkRef} className="cc-fark-sayfa" role="dialog" aria-label={`Fark: ${fark.dosya}`} tabIndex={-1}>
                <div className="cc-fark-sayfa__bas">
                  <Ikon ad="dosya" olcu={15} /><b className="cc-yol">{fark.dosya}</b>
                  {fark.fark !== undefined && (() => { const d = birlesikFarkCoz(fark.fark); const e = d.reduce((n, x) => n + x.eklenen, 0), s = d.reduce((n, x) => n + x.silinen, 0); return <span className="cc-arac__sayi"><b data-ton="ekle">+{e}</b><b data-ton="sil">−{s}</b></span>; })()}
                  <span className="cc-bosluk" />
                  <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => setFark(null)} aria-label="Farkı kapat (Esc)"><Ikon ad="kapat" olcu={14} />Kapat</button>
                </div>
                <div className="cc-fark-sayfa__govde">
                  {fark.fark === undefined && !fark.hata && <p className="cc-denetci__bos">Fark okunuyor…</p>}
                  {fark.hata && <p className="cc-ileti cc-ileti--hata">{fark.hata}</p>}
                  {fark.fark !== undefined && !fark.hata && (() => {
                    const d = birlesikFarkCoz(fark.fark);
                    if (!d.length) return <p className="cc-denetci__bos">Bu dosyada git farkı yok (değişiklik kaydedilmiş ya da dosya izlenmiyor).</p>;
                    return d.map((x) => (
                      <div key={x.yol} className="cc-fark-sayfa__dosya">
                        {d.length > 1 && <div className="cc-fark-sayfa__ad">{x.yol}</div>}
                        {x.ikili ? <p className="cc-denetci__bos">İkili dosya: fark gösterilmez.</p> : <FarkGorunumu parcalar={x.parcalar} enCok={600} acikBaslangic etiket={`${x.yol} farkı`} />}
                      </div>
                    ));
                  })()}
                  {fark.kisaltildi && <p className="cc-denetci__bos">Fark çok uzun: ilk bölümü gösteriliyor.</p>}
                </div>
              </div>
            )}
          </section>
          {denetci && (!dar || denetciAcik) && (
            <aside className={`cc-denetci${sec(dar, ' cc-denetci--cekmece')}`} aria-label="Denetçi"
              onKeyDown={(e) => { if (dar && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); setDenetciAcik(false); } }}>{denetci}</aside>
          )}
        </div>
      )}
      {sekme === 'eklentiler' && <div className="cc__govde cc__govde--eklentiler"><Eklentiler /></div>}
      {sekme === 'projeler' && <div className="cc__govde cc__govde--projeler"><Projeler projeler={projeler} yenile={projeYukle} yeniOturum={(c) => yeniOturum(c)} klasorSec={() => void klasorSec()} /></div>}
      {sekme === 'ayarlar' && ayar && <div className="cc__govde cc__govde--ayarlar"><CcAyarlar ayar={ayar} kaydet={ayarKaydet} claude={durum?.claude ?? null} auth={auth} authYenile={authYukle} /></div>}
    </div>
  );
}

function DenetciDugmesi({ acik, degistir }: { acik: boolean; degistir: (v: boolean) => void }) {
  return (
    <button type="button" className="dgm dgm--koyu dgm--k" aria-pressed={acik} onClick={() => degistir(!acik)} title="Denetçi: dosyalar, fark, yapılacaklar, maliyet">
      <Ikon ad="panel" olcu={15} />Denetçi
    </button>
  );
}

/** Süren turun geçen süresi (saniyede bir; yalnız bu küçük bileşen yeniden çizilir). */
function GecenSure({ bas }: { bas?: number }) {
  const [, setN] = useState(0);
  useEffect(() => { const z = setInterval(() => setN((n) => n + 1), 1000); return () => clearInterval(z); }, []);
  return <span className="cc-gecen">{sureMetni(bas ? Date.now() - bas : 0)}</span>;
}

function CanliGorunum({ k, cwd, yazici, denetciDugmesi, izinYanitla, dahaEskisi, turBasi, catalKaynagi }: {
  k: CanliOturum; cwd: string; yazici: ReactNode; denetciDugmesi: ReactNode; izinYanitla: (id: string, istekId: string) => (y: IzinYaniti) => Promise<{ tamam: boolean; hata?: string }>;
  dahaEskisi: () => void; turBasi?: number; catalKaynagi?: string;
}) {
  const o = k.ozet;
  const h = halBilgisi(o);
  // Bekleyen izin dökümde satır olarak tekrarlanmaz (kartı yazma kutusunun üstünde); yanıtlanınca kararıyla dökümde kalır.
  // Çöken oturumun hata notu altta "Oturum durdu" kartında: dökümde ikinci kez yazılmaz.
  const ogeler = useMemo(() => [...(k.oncesi?.model.liste() ?? []), ...(k.dokum?.liste() ?? [])]
    .filter((x) => (x.tur !== 'izin' || x.karar) && !(o.durum === 'hata' && x.tur === 'sistem' && x.seviye === 'hata' && x.metin === o.hata)), [k.surum, k.oncesi, k.dokum, o.durum, o.hata]); // eslint-disable-line react-hooks/exhaustive-deps
  // Düzeltme turu 1: bekleyen izin KENDİ araç kartında (IzinBaglam); yazma kutusunun üstünde yalnız kartı olmayan istekler. Kartlı
  // istek için tek satırlık "İzin bekleniyor · Göster" hapı karta kaydırır.
  const kartsiz = k.dokum?.kartsizBekleyenler() ?? [];
  const kartli = (k.dokum?.bekleyenIzinler() ?? []).filter((i) => k.dokum?.kartliMi(i.aracKimligi));
  const izinDegeri = useMemo<IzinBaglamDegeri>(() => ({
    oturumId: o.id, cwd,
    bekleyen: new Map(kartli.map((i) => [i.aracKimligi!, i])),
    yanitla: (istekId, y) => izinYanitla(o.id, istekId)(y),
  }), [o.id, cwd, kartli.map((i) => i.istekId).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hedef, setHedef] = useState<{ anahtar: string; istekId: string; no: number } | null>(null);
  const [kartGorunur, setKartGorunur] = useState(false);
  const goster = () => {
    const i = kartli[0];
    const anahtar = i?.aracKimligi ? k.dokum?.ustDuzeyAnahtar(i.aracKimligi) : undefined;
    if (anahtar) setHedef((h) => ({ anahtar, istekId: i.istekId, no: (h?.no ?? 0) + 1 }));
  };
  const ust = (
    <>
      {k.oncesi && k.oncesi.once !== null && <button type="button" className="cc-katla cc-dokum__eski" onClick={dahaEskisi}><Ikon ad="yenile" olcu={13} />Daha eski konuşmayı yükle</button>}
      {k.oncesi?.sinirda && <div className="cc-not" data-eski-sinir="">{`Daha eskisi bellekte tutulmuyor (en çok ${ESKI_SAYFA_SINIRI} sayfa); tamamı Claude Code’un dökümünde.`}</div>}
      {(k.dokum?.atilan ?? 0) > 0 && <div className="cc-not">Daha eski {k.dokum!.atilan} öğe bellekte tutulmuyor; tamamı Claude Code’un dökümünde.</div>}
      {catalKaynagi && !k.oncesi && <div className="cc-not">“{catalKaynagi}” konuşmasından çatallandı; Claude Code önceki konuşmayı biliyor.</div>}
      {k.oncesi && <div className="cc-ayrac"><span>Uygulamada sürüyor</span></div>}
    </>
  );
  const alt = o.durum === 'calisiyor' ? (
    <div className="cc-calisiyor" role="status"><span className="dusunce__isik" aria-hidden="true" /><span className="cc-calisiyor__metin">Claude Code çalışıyor</span><GecenSure bas={turBasi} /></div>
  ) : o.durum === 'sirada' ? (
    <div className="cc-calisiyor" role="status" data-ton="sirada"><Ikon ad="saat" olcu={15} /><span>Sırada{o.siraNo ? ` (${o.siraNo}.)` : ''}: aynı anda en çok 4 oturum çalışır; yer açılınca başlar.</span></div>
  ) : o.durum === 'bosta' && o.arkaPlan > 0 && !k.arkaIsler.some((i) => i.durum === 'suruyor') ? (
    // Eski Claude Code (işin adı/kimliği gelmiyor): yalnız sayı. Yeni sürümde işler şeridi (ArkaIsler) adı, çıktıyı ve Durdur'u gösterir.
    // Tur bitti ama arkada ajan/kabuk sürüyor: iş bitmedi (31 Eki); son iş bitince bu satır kalkar.
    <div className="cc-calisiyor" role="status" data-ton="arka-plan"><span className="dusunce__isik" aria-hidden="true" /><span className="cc-calisiyor__metin">Arka planda {o.arkaPlan} iş sürüyor</span></div>
  ) : o.durum === 'hata' ? (
    <div className="cc-hata-kart" role="alert">
      <div className="cc-hata-kart__bas"><Ikon ad="uyari" olcu={16} /><b>Oturum durdu</b></div>
      <p>{o.hata ? hataSade(o.hata) : 'Claude Code beklenmedik biçimde kapandı.'}</p>
      {!(o.hata && /Claude Code bulunamadı/.test(o.hata)) && <span>Yeni bir mesaj yazınca Claude Code bu konuşmayı kaldığı yerden sürdürür.</span>}
    </div>
  ) : null;
  return (
    <div className="cc-oturum-gorunum">
      <header className="cc-oturum-bas">
        <div className="cc-oturum-bas__metin">
          <h2 title={o.baslik}>{o.baslik}</h2>
          <span className="cc-oturum-bas__alt">
            <span className="cc-hal" data-ton={h.ton}><i aria-hidden="true" />{h.etiket}</span>
            <span className="cc-oturum-bas__proje"><Ikon ad="klasor" olcu={12} />{o.proje}</span>
            {o.mod === 'bypassPermissions' && <span className="cc-tam-rozet">Tam yetki</span>}
            {o.turSayisi ? <span>{o.turSayisi} tur · {sureMetni(o.sureMs)}</span> : null}
          </span>
        </div>
        <div className="cc-oturum-bas__dugmeler">{denetciDugmesi}</div>
      </header>
      {!k.dokum ? (
        <div className="cc-dokum-yukleniyor"><span className="donen" aria-hidden="true" />Döküm yükleniyor…</div>
      ) : ogeler.length === 0 && !alt ? (
        <div className="cc-dokum-bos">
          <div className="cc-bos__simge"><Ikon ad="kod" olcu={24} /></div>
          <b>Oturum hazır</b>
          <span>Ne yapılacağını aşağıya yaz. “/” komutları, “@” proje dosyalarını açar; görsel yapıştırabilirsin.</span>
        </div>
      ) : (
        <IzinBaglam.Provider value={izinDegeri}>
          <Dokum key={o.id} kimlik={o.id} ogeler={ogeler} cwd={cwd} ust={ust} alt={alt} hedef={hedef} izinGorunur={setKartGorunur} />
        </IzinBaglam.Provider>
      )}
      {kartsiz.length > 0 && (
        <div className="cc-izinler" aria-label="Bekleyen izinler">
          {kartsiz.map((i) => <IzinKarti key={i.istekId} istek={i} cwd={cwd} oturumId={o.id} yanitla={izinYanitla(o.id, i.istekId)} />)}
        </div>
      )}
      {kartli.length > 0 && (kartGorunur ? (
        // Kart ekranda: hap gizli (ekranda ikinci kez söylenmez); ekran okuyucu için durum yine duyurulur.
        <div className="gorunmez" role="status" data-izin-durum="">İzin bekleniyor: {aracAdiTr(kartli[0].arac)}</div>
      ) : (
        <div className="cc-izin-hap" role="status" data-izin-hap="">
          <Ikon ad="kalkan" olcu={15} />
          <span><b>İzin bekleniyor</b> · {kartli.length > 1 ? `${kartli.length} istek` : `${aracAdiTr(kartli[0].arac)}: ${goreliYol(kartli[0].ozet, cwd)}`}</span>
          <button type="button" className="dgm dgm--koyu dgm--k" onClick={goster}>Göster</button>
        </div>
      ))}
      <ArkaIsler k={k} />
      {yazici}
    </div>
  );
}

function GecmisGorunum({ o, gd, yazici, denetciDugmesi, dahaEskisi }: { o: GecmisOturum; gd: GecmisDokum | null; yazici: ReactNode; denetciDugmesi: ReactNode; dahaEskisi: () => void }) {
  const ogeler = useMemo(() => gd?.model.liste() ?? [], [gd, gd?.surum]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cc-oturum-gorunum">
      <header className="cc-oturum-bas">
        <div className="cc-oturum-bas__metin">
          <h2 title={o.baslik}>{o.baslik}</h2>
          <span className="cc-oturum-bas__alt">
            <span className="cc-hal" data-ton="notr"><i aria-hidden="true" />Geçmiş</span>
            <span className="cc-oturum-bas__proje"><Ikon ad="klasor" olcu={12} />{o.proje}</span>
            {o.dal && <span className="cc-oturum-bas__proje"><Ikon ad="dal" olcu={12} />{o.dal}</span>}
            {o.sonZaman && <span>{zamanGoreli(o.sonZaman)}</span>}
          </span>
        </div>
        <div className="cc-oturum-bas__dugmeler">{denetciDugmesi}</div>
      </header>
      {!gd ? <div className="cc-dokum-yukleniyor"><span className="donen" aria-hidden="true" />Döküm okunuyor…</div>
        : gd.hata && !ogeler.length ? <div className="cc-dokum-bos"><div className="cc-bos__simge" data-ton="hata"><Ikon ad="uyari" olcu={24} /></div><b>Döküm okunamadı</b><span>{gd.hata}</span></div>
        : (
          <Dokum key={o.id} kimlik={o.id} ogeler={ogeler} cwd={o.cwd}
            ust={gd.once !== null ? <button type="button" className="cc-katla cc-dokum__eski" onClick={dahaEskisi} disabled={gd.yukleniyor}><Ikon ad="yenile" olcu={13} />{gd.yukleniyor ? 'Yükleniyor…' : 'Daha eskisi'}</button> : gd.sinirda ? <div className="cc-not" data-eski-sinir="">{`Daha eskisi bellekte tutulmuyor (en çok ${ESKI_SAYFA_SINIRI} sayfa); tamamı Claude Code’un dökümünde.`}</div> : <div className="cc-not">Konuşmanın başı</div>}
            alt={<div className="cc-ayrac"><span>Burada yazdığında konuşma uygulamada sürer</span></div>} />
        )}
      {yazici}
    </div>
  );
}

function YeniOturum({ auth, cwd, guven, projeler, cwdDegistir, klasorSec, yazici, ornekSec }: {
  auth: CcAuth | null; cwd: string | null; guven: KlasorGuvenBilgisi | null; projeler: CcProje[] | null; cwdDegistir: (c: string) => void; klasorSec: () => void; yazici: ReactNode; ornekSec: (m: string) => void;
}) {
  const secenekler = (projeler ?? []).filter((p) => p.var).map((p) => ({ deger: p.cwd, etiket: p.ad, aciklama: p.cwd }));
  if (cwd && !secenekler.some((s) => s.deger === cwd)) secenekler.unshift({ deger: cwd, etiket: cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd, aciklama: cwd });
  const p = projeler?.find((x) => x.cwd === cwd);
  return (
    <div className="cc-oturum-gorunum">
      <header className="cc-oturum-bas">
        <div className="cc-oturum-bas__metin">
          <h2>Yeni oturum</h2>
          <span className="cc-oturum-bas__alt">Claude Code seçtiğin klasörde çalışır; izin isterse burada onaylarsın.</span>
          <HesapSatiri auth={auth} />
        </div>
      </header>
      <div className="cc-yeni-govde">
        <div className="cc-yeni-kart">
          <span className="ust-etiket">Proje</span>
          <div className="cc-yeni-kart__satir">
            <Secici<string> deger={cwd ?? ''} secenekler={secenekler} degistir={cwdDegistir} etiket="Proje klasörü" yerTutucu="Proje seç" genislik="min(100%, 420px)" className="cc-secici cc-secici--proje" />
            <button type="button" className="dgm dgm--koyu dgm--k" onClick={klasorSec}><Ikon ad="klasor" olcu={14} />Klasör seç…</button>
          </div>
          {p && <span className="cc-yeni-kart__bilgi">{p.oturumSayisi} oturum{p.dal ? ` · ${p.dal}` : ''}{p.claudeMd ? ' · CLAUDE.md var' : ' · CLAUDE.md yok'}{p.sonEtkinlik ? ` · son: ${zamanGoreli(p.sonEtkinlik)}` : ''}</span>}
          {!cwd && <span className="cc-yeni-kart__bilgi">Önce bir proje seç ya da klasör aç.</span>}
          {guven?.karar && (
            <span className="cc-yeni-kart__bilgi" data-klasor-guveni-durum={guven.karar}>
              {guven.karar === 'guven' ? 'Klasörün kendi Claude Code ayarları yüklenecek (güvendin).' : 'Klasörün kendi Claude Code ayarları yüklenmeyecek (güvenmedin).'} Kararı Ayarlar sekmesinden silebilirsin.
            </span>
          )}
        </div>
        <div className="cc-yeni-kart">
          <span className="ust-etiket">Hızlı başla</span>
          <div className="cc-ornekler">
            {ORNEKLER.map((m) => <button key={m} type="button" className="cc-ornek" disabled={!cwd} onClick={() => ornekSec(m)}><Ikon ad="gonder" olcu={14} />{m}</button>)}
          </div>
        </div>
      </div>
      {yazici}
    </div>
  );
}

/** "Kendi Claude hesabınla çalışır" + e-posta/plan (SDK accountInfo; oturum açıldıktan sonra bilinir) ya da giriş yoksa `claude login` yönergesi. */
function HesapSatiri({ auth }: { auth: CcAuth | null }) {
  const [hesap, setHesap] = useState<{ eposta?: string; plan?: string } | null>(null);
  useEffect(() => { void cagir<{ eposta?: string; plan?: string } | null>('claudecode:hesap').then(setHesap).catch(() => undefined); }, [auth]);
  const m = hesapMetni(hesap, auth);
  return <span className="cc-hesap" data-giris-yok={m.giris ? '' : undefined}>{m.metin}</span>;
}

function BosDurum({ durum, auth, projeler, yeniOturum, klasorSec, ayarlaraGit, mac, canlilar, sec: secim, gecmis }: {
  durum: Durum | null; auth: CcAuth | null; projeler: CcProje[] | null; yeniOturum: (cwd: string | null) => void; klasorSec: () => void; ayarlaraGit: () => void; mac: boolean;
  canlilar: CanliOturum[]; sec: (s: Secim) => void; gecmis: GecmisOturum[] | null;
}) {
  const son = (projeler ?? []).filter((p) => p.var).slice(0, 6);
  const sonKonusmalar = [...(gecmis ?? [])].sort((a, b) => (b.sonZaman ?? '').localeCompare(a.sonZaman ?? '')).slice(0, 4);
  const tus = mac ? '⌘' : 'Ctrl+';
  const izinBekleyen = canlilar.filter((c) => c.ozet.durum === 'izin');
  if (durum && !durum.claude) {
    return (
      <div className="cc-bos">
        <div className="cc-bos__simge" data-ton="hata"><Ikon ad="uyari" olcu={26} /></div>
        <h2>Claude Code bu bilgisayarda bulunamadı</h2>
        <p>Uygulama içi oturumlar için Claude Code kurulu olmalı. Kurunca bu sayfa kendiliğinden kullanılabilir; geçmiş oturumların soldaki listede okunabilir.</p>
        <button type="button" className="dgm dgm--koyu" onClick={ayarlaraGit}><Ikon ad="ayarlar" olcu={16} />Claude Code durumu</button>
      </div>
    );
  }
  return (
    <div className="cc-bos cc-bos--dolu">
      <div className="cc-bos__ust">
        <div className="cc-bos__simge"><Ikon ad="kod" olcu={26} /></div>
        <div>
          <h2>Claude Code’la çalış</h2>
          <p>Bir proje seç, ne yapılacağını yaz. Araç adımlarını canlı izle, izinleri burada onayla; terminal gerekmez.</p>
          <HesapSatiri auth={auth} />
        </div>
        <div className="cc-bos__dugmeler">
          <button type="button" className="dgm dgm--beyaz" onClick={() => yeniOturum(son[0]?.cwd ?? null)}><Ikon ad="arti" olcu={16} />Yeni oturum</button>
          <button type="button" className="dgm dgm--koyu" onClick={klasorSec}><Ikon ad="klasor" olcu={16} />Klasör seç…</button>
        </div>
      </div>
      {izinBekleyen.length > 0 && (
        <div className="cc-serit" data-ton="izin">
          <Ikon ad="kalkan" olcu={15} /><span><b>{izinBekleyen.length} oturum onayını bekliyor.</b></span><span className="cc-bosluk" />
          <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => secim({ tur: 'canli', id: izinBekleyen[0].ozet.id })}>Göster</button>
        </div>
      )}
      <div className="cc-bos__bolum">
        <span className="ust-etiket">Son projeler</span>
        {son.length ? (
          <div className="cc-proje-izgara">
            {son.map((p) => (
              <button key={p.cwd} type="button" className="cc-proje-kart" onClick={() => yeniOturum(p.cwd)} title={p.cwd}>
                <span className="cc-proje-kart__ust"><Ikon ad="klasor" olcu={15} /><b>{p.ad}</b></span>
                <span className="cc-proje-kart__yol">{kisaYol(p.cwd)}</span>
                <span className="cc-proje-kart__alt">{p.oturumSayisi} oturum{p.dal ? ` · ${p.dal}` : ''}{p.sonEtkinlik ? ` · ${zamanGoreli(p.sonEtkinlik)}` : ''}</span>
              </button>
            ))}
          </div>
        ) : <p className="cc-denetci__bos">{projeler === null ? 'Projeler taranıyor…' : 'Henüz proje yok: “Klasör seç…” ile başla.'}</p>}
      </div>
      {sonKonusmalar.length > 0 && (
        <div className="cc-bos__bolum cc-bos__son">
          <span className="ust-etiket">Son konuşmalar</span>
          <div className="cc-son-liste">
            {sonKonusmalar.map((o) => (
              <button key={o.id} type="button" className="cc-son" onClick={() => secim({ tur: 'gecmis', o })} title={o.cwd}>
                <b>{o.baslik}</b>
                <span>{o.proje}{o.sonZaman ? ` · ${zamanGoreli(o.sonZaman)}` : ''} · {o.istemSayisi} istem</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="cc-bos__bolum cc-bos__ikili">
        <div className="cc-bilgi-kart">
          <span className="ust-etiket">Kısayollar</span>
          <ul className="cc-kisayollar">
            <li><kbd>{tus}N</kbd>Yeni oturum</li>
            <li><kbd>{tus}K</kbd>Oturum ara</li>
            <li><kbd>Esc</kbd>Süren turu durdur</li>
            <li><kbd>/</kbd>Komutlar · <kbd>@</kbd>Dosyalar</li>
          </ul>
        </div>
        <div className="cc-bilgi-kart">
          <span className="ust-etiket">Durum</span>
          <dl className="cc-durum-tablo">
            <dt>Claude Code</dt><dd><span className="cc-hal" data-ton={durum?.claude ? 'bitti' : 'notr'}><i aria-hidden="true" />{durum?.claude ? 'Kurulu' : 'Denetleniyor'}</span></dd>
            <dt>Claude oturumu</dt><dd><span className="cc-hal" data-ton={auth?.girisYapildi ? 'bitti' : auth ? 'izin' : 'notr'}><i aria-hidden="true" />{auth === null ? 'Denetleniyor' : auth.girisYapildi ? 'Açık' : 'Kapalı'}</span></dd>
            <dt>Yeni oturum modu</dt><dd><span className="cc-hal" data-ton={durum?.ayar.varsayilanMod === 'bypassPermissions' ? 'hata' : 'notr'}><i aria-hidden="true" />{durum ? MOD_ADLARI[durum.ayar.varsayilanMod] : '—'}</span></dd>
            <dt>Uygulamada</dt><dd><span className="cc-hal" data-ton={canlilar.some((c) => turSuruyor(c.ozet)) ? 'calisiyor' : 'notr'}><i aria-hidden="true" />{canlilar.length} oturum{canlilar.some((c) => turSuruyor(c.ozet)) ? ` · ${canlilar.filter((c) => turSuruyor(c.ozet)).length} çalışıyor` : ''}</span></dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

