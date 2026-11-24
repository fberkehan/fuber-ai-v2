// ── Claude Code yazma kutusu (Görev 28, K17) ─────────────────────────────────────────────────────────────────────────────────────
// Çok satır; Enter gönderir, Shift+Enter satır. "/" (metnin başında) komut paleti — Claude Code'un supportedCommands() listesi (motor
// kanalı 'claudecode:komutlar'); "@" dosya önerisi — 'claudecode:dosya-oner' (ana süreçte eşleştirme 60–200 ms sürebilir: sorgu ~120 ms
// gecikmeli, beklerken son sonuç görünür kalır, her tuşta istek YOK). Görsel, belge (PDF, Office, metin, kod) ve video yapıştır/sürükle/seç. Tur sürerken yazılan mesaj kuyruğa
// girer (görünür). Durdur = interrupt (Esc de: odak yazma kutusunda ya da dökümdeyken). Mod ve model seçicisi kutunun altında.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Secici, type SeciciSecenegi } from '../bilesenler/Secici';
import { tetikBul, tamamla, komutSuz, gecikmeliSorgu, MOD_ADLARI, dosyaAdi, klasorAdi, eforSecenekleri, type KomutBilgisi, type Tetik, taslakGeriKoy } from './yardimci';
import type { ModelBilgisi } from './depo';
import { ccEforMu, ccModelGorunenAdi, ccSeciliModel, type CcMod, type CcEfor } from '../../shared/cc-olay';
import { ekSinifla, ekBoyutMetni, ekliMesajMetni, EK_SECICI_KABUL, AZAMI_EK, type MetinEki } from '../../shared/ek-kural';
import '../bilesenler/ek-cip.css';

export interface CcGorsel { medya: string; veri: string }
/** Belge/video eki (sohbetteki gibi: ana süreçte metne ya da kare + yazıya çevrilir; metin mesaja `<ek>` bloğu olarak girer). */
interface DosyaEki { kimlik: string; ad: string; tur: 'belge' | 'video'; boyut: number; durum: 'hazirlaniyor' | 'hazir'; adim?: string; ek?: MetinEki; kareler?: CcGorsel[] }
let ekSayaci = 0;
const MEDYA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const GORSEL_SINIRI = 6 * 1024 * 1024;
const AZAMI_GORSEL = 10;
/** Oturum başına yazılmış ama gönderilmemiş metin (oturumlar arasında gezinirken kaybolmasın). */
const taslaklar = new Map<string, string>();
/** Taslak oturum gerçek oturuma dönüşünce ("/" paleti oturumu açtı) yazılan metin yeni anahtara taşınır. */
export function taslakTasi(eski: string, yeni: string): void {
  const m = taslaklar.get(eski);
  taslaklar.delete(eski);
  if (m) taslaklar.set(yeni, m);
}
export const taslakSil = (anahtar: string) => { taslaklar.delete(anahtar); ekTaslaklari.delete(anahtar); };
/** Taslak başına eklenmiş görseller (düzeltme turu 1: oturum değişince başka oturuma taşınmaz, dönünce yerinde). */
const ekTaslaklari = new Map<string, CcGorsel[]>();
export { ekTaslaklari as _ekTaslaklari };

const MOD_ACIKLAMA: Record<CcMod, string> = {
  default: 'Düzenlemeler ve değişiklik yapan komutlar için sorar; okumalar ve zararsız komutlar sormaz.',
  acceptEdits: 'Düzenlemeler kendiliğinden; değişiklik yapan komutlar için sorar.',
  plan: 'Yalnız okur ve plan çıkarır; düzenleme ve komut çalıştırma kapalı.',
  bypassPermissions: 'Hiç sormaz. Yalnız güvendiğin projelerde.',
};

export interface YaziciOzellikleri {
  /** Taslak anahtarı (oturum ya da "yeni:<klasör>"). */
  taslakAnahtari: string;
  oturumId: string | null;
  cwd: string | null;
  calisiyor: boolean;
  kuyruk: { metin: string; gorselSayisi: number }[];
  mod: CcMod; modDegistir: (m: CcMod) => void; tamYetkiAcik: boolean;
  /** Seçici değişince: dönen metin (ör. "sıradaki istekte geçerli") kutunun altında tek satır görünür. */
  model: string | null; modelDegistir: (m: string | null) => void | Promise<string | undefined>; modeller: ModelBilgisi[]; modellerIste: () => void;
  /** Claude Code'un bu turda bildirdiği çözülmüş model kimliği (yalnız gösterim: ipucu ve "Varsayılan"ın açıklaması). */
  etkinModel?: string | null;
  /** Düşünme gücü: taslakta, geçmişte ve CANLI oturumda (analiz 11 Kas bulgu 1: applyFlagSettings) seçilir. */
  efor?: CcEfor | null; eforDegistir?: (e: CcEfor | null) => void | Promise<string | undefined>;
  komutlarIste: () => Promise<{ komutlar: KomutBilgisi[]; hata?: string; not?: string }>;
  gonder: (metin: string, gorseller: CcGorsel[]) => Promise<boolean>;
  durdur: () => void;
  yerTutucu: string;
  devreDisi?: boolean;
  odakIstegi?: number;
  ust?: ReactNode;
}

export function Yazici(p: YaziciOzellikleri) {
  const alan = useRef<HTMLTextAreaElement>(null);
  const dosyaSec = useRef<HTMLInputElement>(null);
  const [metin, setMetinIc] = useState(() => taslaklar.get(p.taslakAnahtari) ?? '');
  const [ekler, setEklerIc] = useState<CcGorsel[]>(() => ekTaslaklari.get(p.taslakAnahtari) ?? []);
  /** Şu anki taslak anahtarı: geç biten görsel okuması başka taslağa düşmesin (atılır). */
  const anahtarRef = useRef(p.taslakAnahtari);
  anahtarRef.current = p.taslakAnahtari;
  const setEkler = (f: CcGorsel[] | ((e: CcGorsel[]) => CcGorsel[])) => {
    setEklerIc((eski) => {
      const yeni = typeof f === 'function' ? f(eski) : f;
      if (yeni.length) ekTaslaklari.set(anahtarRef.current, yeni); else ekTaslaklari.delete(anahtarRef.current);
      return yeni;
    });
  };
  const [imlec, setImlec] = useState(0);
  const [kapaliTetik, setKapaliTetik] = useState<string | null>(null);
  const [aktif, setAktif] = useState(0);
  const [komutlar, setKomutlar] = useState<KomutBilgisi[] | null>(null);
  const [komutHata, setKomutHata] = useState('');
  const [komutNotu, setKomutNotu] = useState('');
  const [dosyalar, setDosyalar] = useState<{ q: string; yollar: string[]; kisaltildi: boolean } | null>(null);
  const [dosyaBekliyor, setDosyaBekliyor] = useState(false);
  const [bilgi, setBilgi] = useState('');
  const [suruklenen, setSuruklenen] = useState(false);
  const [dosyaEkleri, setDosyaEkleri] = useState<DosyaEki[]>([]);
  const gonderiliyor = useRef(false);

  const setMetin = (m: string) => { setMetinIc(m); if (m) taslaklar.set(p.taslakAnahtari, m); else taslaklar.delete(p.taslakAnahtari); };
  useEffect(() => { setMetinIc(taslaklar.get(p.taslakAnahtari) ?? ''); setEklerIc(ekTaslaklari.get(p.taslakAnahtari) ?? []); setDosyaEkleri([]); setKomutlar(null); setDosyalar(null); }, [p.taslakAnahtari]);
  useEffect(() => { if (p.odakIstegi) alan.current?.focus({ preventScroll: true }); }, [p.odakIstegi]);
  // Kendiliğinden büyüyen yazı alanı (en çok ~8 satır; sonra kendi içinde kayar).
  useLayoutEffect(() => {
    const a = alan.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = `${Math.min(200, Math.max(24, a.scrollHeight))}px`;
  }, [metin]);

  const tetik: Tetik | null = useMemo(() => tetikBul(metin, imlec), [metin, imlec]);
  const tetikAnahtari = tetik ? `${tetik.tur}:${tetik.bas}` : null;
  const paletAcik = Boolean(tetik && tetikAnahtari !== kapaliTetik && !p.devreDisi);

  // "@" önerisi: gecikmeli; son sonuç beklerken görünür.
  const oneri = useMemo(() => gecikmeliSorgu(
    (q) => cagir<{ yollar: string[]; kisaltildi: boolean }>('claudecode:dosya-oner', { ...(p.oturumId ? { id: p.oturumId } : { cwd: p.cwd }), sorgu: q }),
    (q, r) => { setDosyalar({ q, yollar: r.yollar, kisaltildi: r.kisaltildi }); setDosyaBekliyor(false); },
    120,
  ), [p.oturumId, p.cwd]);
  useEffect(() => () => oneri.iptal(), [oneri]);
  useEffect(() => {
    if (!paletAcik || tetik?.tur !== 'dosya') return;
    if (!p.oturumId && !p.cwd) return;
    if (dosyalar?.q === tetik.sorgu) return;
    setDosyaBekliyor(true);
    oneri.iste(tetik.sorgu);
  }, [paletAcik, tetik?.tur, tetik?.sorgu, oneri]); // eslint-disable-line react-hooks/exhaustive-deps
  // "/" paleti: komutlar bir kez istenir (süreç yoksa motor açar).
  useEffect(() => {
    if (!paletAcik || tetik?.tur !== 'komut' || komutlar !== null) return;
    let iptal = false;
    setKomutlar([]);
    void p.komutlarIste().then((r) => { if (iptal) return; setKomutlar(r.komutlar); setKomutHata(r.hata ?? ''); setKomutNotu(r.not ?? ''); });
    return () => { iptal = true; };
  }, [paletAcik, tetik?.tur]); // eslint-disable-line react-hooks/exhaustive-deps

  const komutListesi = useMemo(() => (tetik?.tur === 'komut' ? komutSuz(komutlar ?? [], tetik.sorgu, 40) : []), [tetik, komutlar]);
  const dosyaListesi = tetik?.tur === 'dosya' ? dosyalar?.yollar ?? [] : [];
  const satirSayisi = tetik?.tur === 'komut' ? komutListesi.length : dosyaListesi.length;
  useEffect(() => { setAktif(0); }, [tetikAnahtari, tetik?.sorgu, satirSayisi]);
  useEffect(() => { document.getElementById(`cc-palet-${aktif}`)?.scrollIntoView({ block: 'nearest' }); }, [aktif]);

  const imleciAl = () => { const a = alan.current; if (a) setImlec(a.selectionStart ?? a.value.length); };
  const sec = (i: number) => {
    if (!tetik) return;
    const deger = tetik.tur === 'komut' ? komutListesi[i]?.ad : dosyaListesi[i];
    if (!deger) return;
    const r = tamamla(metin, tetik, deger);
    setMetin(r.metin);
    setImlec(r.imlec);
    requestAnimationFrame(() => { const a = alan.current; if (a) { a.focus({ preventScroll: true }); a.setSelectionRange(r.imlec, r.imlec); } });
  };

  const gorselOku = (f: File) => {
    const anahtar = anahtarRef.current;
    if (!MEDYA.has(f.type)) { setBilgi('Yalnız PNG, JPEG, GIF ya da WebP görsel eklenir.'); return; }
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const veri = s.slice(s.indexOf(',') + 1);
      if (veri.length > GORSEL_SINIRI) { setBilgi('Görsel çok büyük (en çok ~4,5 MB).'); return; }
      if (anahtarRef.current !== anahtar) return; // okuma bitmeden başka oturuma geçildi: görsel o oturuma eklenmez
      setEkler((e) => (e.length >= AZAMI_GORSEL ? e : [...e, { medya: f.type, veri }]));
    };
    r.readAsDataURL(f);
  };

  /** Seçilen, bırakılan ya da yapıştırılan dosyalar: görsel olduğu gibi; PDF, Office, metin, kod ve video ana süreçte okunup mesaja eklenir (sohbetle AYNI
   *  kural: shared/ek-kural.ts). Kural dışı dosya tek cümleyle söylenir; hiçbiri sessizce düşmez. */
  const dosyalariAl = (liste: Iterable<File>) => {
    const hatalar: string[] = [];
    let gorselSayisi = ekler.length;
    let dosyaSayisi = dosyaEkleri.length;
    for (const f of liste) {
      const k = ekSinifla(f.name, f.type, f.size);
      if ('hata' in k) { hatalar.push(k.hata); continue; }
      if (k.tur === 'gorsel') {
        if (k.cevir) { hatalar.push(`${f.name}: bu görsel biçimi burada okunmuyor; PNG ya da JPEG olarak kaydedip ekle.`); continue; }
        if (gorselSayisi >= AZAMI_GORSEL) { hatalar.push(`En çok ${AZAMI_GORSEL} görsel eklenir; ${f.name} eklenmedi.`); continue; }
        gorselSayisi++;
        gorselOku(f);
        continue;
      }
      if (dosyaSayisi >= AZAMI_EK) { hatalar.push(`Bir mesaja en çok ${AZAMI_EK} dosya eklenir; ${f.name} eklenmedi.`); continue; }
      if (k.tur === 'video' && (dosyaEkleri.some((d) => d.tur === 'video') || gorselSayisi + 4 > AZAMI_GORSEL)) { hatalar.push('Bir mesaja bir video eklenir ve kareleri görsel sınırına sayılır.'); continue; }
      dosyaSayisi++;
      const d: DosyaEki = { kimlik: `cc-ek-${Date.now()}-${++ekSayaci}`, ad: f.name, tur: k.tur, boyut: f.size, durum: 'hazirlaniyor', adim: k.tur === 'video' ? 'Video bu bilgisayarda işleniyor…' : 'Okunuyor…' };
      setDosyaEkleri((l) => [...l, d]);
      const bitir = (r: { hata: string } | (MetinEki & { kareler?: CcGorsel[] })) => {
        if ('hata' in r) { setDosyaEkleri((l) => l.filter((x) => x.kimlik !== d.kimlik)); if (!(r as { iptal?: boolean }).iptal) setBilgi(r.hata); return; }
        const { kareler, ...ek } = r;
        setDosyaEkleri((l) => l.map((x) => (x.kimlik === d.kimlik ? { ...x, durum: 'hazir', adim: undefined, ek: { ad: ek.ad, tur: ek.tur, metin: ek.metin, ...(ek.kisaltildi ? { kisaltildi: true } : {}), ...(ek.toplam ? { toplam: ek.toplam } : {}), ...(ek.kareSayisi ? { kareSayisi: ek.kareSayisi } : {}) }, ...(kareler?.length ? { kareler } : {}) } : x)));
      };
      const kopru = window.fuber;
      const is = k.tur === 'video' ? kopru.videoHazirla?.(f, d.kimlik) : kopru.ekHazirla?.(f);
      if (!is) { bitir({ hata: 'Dosya eki bu pencerede kullanılamıyor.' }); continue; }
      void is.then(bitir, (e: unknown) => bitir({ hata: `${f.name} okunamadı: ${(e as Error)?.message ?? e}` }));
    }
    if (hatalar.length) setBilgi(hatalar.length > 1 ? `${hatalar[0]} (+${hatalar.length - 1} dosya daha eklenmedi)` : hatalar[0]);
    else setBilgi('');
  };
  const hazirlaniyor = dosyaEkleri.some((d) => d.durum === 'hazirlaniyor');
  const dosyaKaldir = (kimlik: string) => {
    const d = dosyaEkleri.find((x) => x.kimlik === kimlik);
    if (d?.tur === 'video' && d.durum === 'hazirlaniyor') void window.fuber.videoIptal?.(kimlik);
    setDosyaEkleri((l) => l.filter((x) => x.kimlik !== kimlik));
  };

  const yolla = async () => {
    if (p.devreDisi || gonderiliyor.current) return;
    if (hazirlaniyor) { setBilgi('Ek hazırlanıyor; bitince gönder.'); return; }
    const d = dosyaEkleri;
    const ekMetinleri = d.map((x) => x.ek).filter((x): x is MetinEki => Boolean(x));
    const m = ekliMesajMetni(metin, ekMetinleri), e = [...ekler, ...d.flatMap((x) => x.kareler ?? [])].slice(0, AZAMI_GORSEL);
    if (!m.trim() && !e.length) return;
    const anahtar = p.taslakAnahtari; // düzeltme 2 (N6): gönderildiği taslak (yanıt gelene dek başka oturuma geçilebilir)
    gonderiliyor.current = true;
    setMetin(''); setEkler([]); setDosyaEkleri([]); setBilgi('');
    const metinOnce = metin;
    const tamam = await p.gonder(m, e).catch(() => false);
    gonderiliyor.current = false;
    if (!tamam && taslakGeriKoy(taslaklar, ekTaslaklari, anahtar, metinOnce, ekler, anahtarRef.current)) {
      setMetinIc((x) => x || metinOnce);
      setEklerIc((x) => (x.length ? x : ekler));
      setDosyaEkleri((x) => (x.length ? x : d));
    }
  };

  const tus = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (paletAcik && satirSayisi > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAktif((a) => (a + 1) % satirSayisi); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAktif((a) => (a - 1 + satirSayisi) % satirSayisi); return; }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); sec(aktif); return; }
    }
    if (paletAcik && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setKapaliTetik(tetikAnahtari); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void yolla(); }
  };

  const modSecenekleri: SeciciSecenegi<CcMod>[] = (['default', 'acceptEdits', 'plan', 'bypassPermissions'] as CcMod[]).map((m) => ({
    deger: m, etiket: MOD_ADLARI[m], aciklama: MOD_ACIKLAMA[m],
    ...(m === 'bypassPermissions' ? { rozet: p.tamYetkiAcik ? 'Dikkat' : 'Ayarlar’da kapalı', devreDisi: !p.tamYetkiAcik } : {}),
  }));
  // Analiz 11 Kas bulgu 2: seçili değer kullanıcının seçimidir (init'in tam kimliği değil); tam kimlik listedeki takma ada eşlenir, listede yoksa
  // dostça adla ("Sonnet 4.5") eklenir — ham kimlik seçicide görünmez (yalnız ipucunda).
  const varsayilanModel = p.modeller.find((m) => m.deger === 'default');
  const seciliModel = ccSeciliModel(p.model, p.modeller);
  const etkinAd = p.etkinModel ? ccModelGorunenAdi(p.etkinModel, p.modeller) : '';
  const modelSecenekleri: SeciciSecenegi<string>[] = [
    {
      deger: '', etiket: !varsayilanModel || /^default\b/i.test(varsayilanModel.ad) || varsayilanModel.ad === varsayilanModel.deger ? 'Varsayılan model' : varsayilanModel.ad,
      aciklama: !seciliModel && etkinAd ? `Şu an: ${etkinAd}` : varsayilanModel?.aciklama || 'Claude Code’un önerdiği model',
    },
    ...p.modeller.filter((m) => m.deger !== 'default').map((m) => ({ deger: m.deger, etiket: ccModelGorunenAdi(m.deger, p.modeller), aciklama: m.aciklama || m.deger })),
  ];
  if (seciliModel && !modelSecenekleri.some((s) => s.deger === seciliModel)) modelSecenekleri.push({ deger: seciliModel, etiket: ccModelGorunenAdi(seciliModel, p.modeller), aciklama: seciliModel });
  const notGoster = (r: void | Promise<string | undefined>) => { if (r instanceof Promise) void r.then((m) => { if (m) setBilgi(m); }).catch(() => undefined); };

  return (
    <div className="cc-yazici" data-suruklenen={suruklenen ? '' : undefined}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setSuruklenen(true); } }}
      onDragLeave={() => setSuruklenen(false)}
      onDrop={(e) => { setSuruklenen(false); if (!e.dataTransfer.files.length) return; e.preventDefault(); dosyalariAl([...e.dataTransfer.files]); }}
    >
      {p.ust}
      {p.kuyruk.length > 0 && (
        <div className="cc-kuyruk" aria-label="Sıradaki mesajlar">
          <span className="cc-kuyruk__etiket"><Ikon ad="saat" olcu={13} />Sırada · {p.kuyruk.length}</span>
          {p.kuyruk.slice(0, 3).map((m, i) => <span key={i} className="cc-kuyruk__mesaj" title={m.metin}>{m.metin || `${m.gorselSayisi} görsel`}</span>)}
          {p.kuyruk.length > 3 && <span className="cc-kuyruk__mesaj">+{p.kuyruk.length - 3}</span>}
          <span className="cc-kuyruk__not">bu tur bitince gider</span>
        </div>
      )}
      <div className="cc-yazici__kutu">
        {paletAcik && (
          <div className="cc-palet" role="listbox" id="cc-palet" aria-label={tetik?.tur === 'komut' ? 'Komutlar' : 'Dosyalar'}>
            <div className="cc-palet__bas">
              <span>{tetik?.tur === 'komut' ? 'Komutlar' : 'Dosyalar'}</span>
              <span className="cc-palet__ipucu">↑↓ seç · Enter ekle · Esc kapat</span>
            </div>
            <div className="cc-palet__liste">
              {tetik?.tur === 'komut' && komutListesi.map((k, i) => (
                <div key={k.ad} id={`cc-palet-${i}`} role="option" aria-selected={i === aktif} className="cc-palet__oge" data-aktif={i === aktif ? '' : undefined}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => sec(i)} onPointerMove={() => setAktif(i)}>
                  <span className="cc-palet__ad">/{k.ad}{k.ipucu && <i> {k.ipucu}</i>}</span>
                  <span className="cc-palet__aciklama">{k.aciklama}</span>
                  {!k.yerlesik && <span className="cc-cip">beceri</span>}
                </div>
              ))}
              {tetik?.tur === 'dosya' && dosyaListesi.map((y, i) => (
                <div key={y} id={`cc-palet-${i}`} role="option" aria-selected={i === aktif} className="cc-palet__oge" data-aktif={i === aktif ? '' : undefined}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => sec(i)} onPointerMove={() => setAktif(i)}>
                  <Ikon ad="dosya" olcu={14} />
                  <span className="cc-palet__ad">{dosyaAdi(y)}</span>
                  <span className="cc-palet__aciklama">{klasorAdi(y) || '.'}</span>
                </div>
              ))}
              {satirSayisi === 0 && (
                <div className="cc-palet__bos">
                  {tetik?.tur === 'komut'
                    ? (komutlar === null || (komutlar.length === 0 && !komutHata) ? 'Komutlar yükleniyor…' : komutHata ? `Komutlar alınamadı: ${komutHata}` : 'Eşleşen komut yok.')
                    : (!p.oturumId && !p.cwd) ? 'Önce bir proje klasörü seç.' : dosyaBekliyor || !dosyalar ? 'Dosyalar aranıyor…' : 'Eşleşen dosya yok.'}
                </div>
              )}
            </div>
            {tetik?.tur === 'dosya' && (dosyaBekliyor && dosyalar ? <div className="cc-palet__alt">Aranıyor…</div> : dosyalar?.kisaltildi ? <div className="cc-palet__alt">Proje çok büyük: liste kısmi.</div> : null)}
            {tetik?.tur === 'komut' && komutNotu && <div className="cc-palet__alt" data-komut-notu="">{komutNotu}</div>}
          </div>
        )}
        {dosyaEkleri.length > 0 && (
          <div className="yazici__dosyalar cc-yazici__ekler">
            {dosyaEkleri.map((d) => (
              <div key={d.kimlik} className="ek-cip ek-cip--yazici" data-tur={d.tur} data-durum={d.durum} title={d.ek?.kisaltildi ? `${d.ad}: uzun; ilk kısmı gönderilecek` : d.ad}>
                <Ikon ad={d.tur === 'video' ? 'oynat' : 'dosya'} olcu={13} />
                <span className="ek-cip__ad">{d.ad}</span>
                <span className="ek-cip__bilgi">{d.durum === 'hazirlaniyor' ? (d.adim ?? 'Hazırlanıyor…') : d.tur === 'video' ? `${d.kareler?.length ?? 0} kare${/Konuşma yazısı yok/.test(d.ek?.metin ?? '') ? ' · yazı yok' : ' + yazı'}` : `${ekBoyutMetni(d.boyut)}${d.ek?.kisaltildi ? ' · kısaltıldı' : ''}`}</span>
                <button type="button" aria-label={`${d.ad} ekini kaldır`} title="Eki kaldır" onClick={() => dosyaKaldir(d.kimlik)}><span aria-hidden="true">×</span></button>
              </div>
            ))}
          </div>
        )}
        {ekler.length > 0 && (
          <div className="yazici__ekler cc-yazici__ekler">
            {ekler.map((e, i) => <div key={i} className="yazici__ek"><img src={`data:${e.medya};base64,${e.veri}`} alt={`Ek ${i + 1}`} /><button type="button" aria-label="Eki kaldır" title="Eki kaldır" onClick={() => setEkler((x) => x.filter((_, j) => j !== i))}><span aria-hidden="true">×</span></button></div>)}
          </div>
        )}
        <textarea
          ref={alan} rows={1} value={metin} disabled={p.devreDisi} aria-label="Claude Code’a yaz" placeholder={p.yerTutucu}
          aria-autocomplete="list" aria-controls={paletAcik ? 'cc-palet' : undefined} aria-expanded={paletAcik}
          aria-activedescendant={paletAcik && satirSayisi ? `cc-palet-${aktif}` : undefined}
          onChange={(e) => { setMetin(e.target.value); setImlec(e.target.selectionStart ?? e.target.value.length); if (kapaliTetik) setKapaliTetik(null); }}
          onSelect={imleciAl} onClick={imleciAl} onKeyDown={tus}
          onPaste={(e) => {
            // Metin + dosya birlikte yapıştırılınca metin de yazılır (yalnız dosya varsa varsayılan yapıştırma durdurulur). Dosya (PDF, Office…) da görsel gibi eklenir.
            const metinVar = Boolean(e.clipboardData.getData('text/plain'));
            const dosyalar = [...e.clipboardData.files];
            if (!dosyalar.length) for (const it of e.clipboardData.items) if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) dosyalar.push(f); }
            if (!dosyalar.length) return;
            if (!metinVar) e.preventDefault();
            dosyalariAl(dosyalar);
          }}
          onBlur={() => setKapaliTetik(tetikAnahtari)}
          onFocus={() => setKapaliTetik(null)}
        />
        <div className="cc-yazici__alt">
          <input ref={dosyaSec} type="file" accept={EK_SECICI_KABUL} multiple hidden data-ek-secici="" onChange={(e) => { dosyalariAl([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" title="Dosya ekle: görsel, PDF, Office, metin, kod ya da video (sürükleyip bırakabilirsin)" aria-label="Dosya ekle" disabled={p.devreDisi} onClick={() => dosyaSec.current?.click()}><Ikon ad="ek" olcu={16} /></button>
          <Secici<CcMod> deger={p.mod} secenekler={modSecenekleri} degistir={p.modDegistir} etiket="İzin modu" className={`cc-secici${p.mod === 'bypassPermissions' ? ' cc-secici--tam' : ''}`} title={`İzin modu: ${MOD_ADLARI[p.mod]}`} />
          <Secici<string> deger={seciliModel} secenekler={modelSecenekleri} degistir={(v) => notGoster(p.modelDegistir(v || null))} etiket="Model" className="cc-secici cc-secici--model" acilinca={p.modellerIste} serbest
            title={p.etkinModel ? `Model: ${p.etkinModel}` : 'Model'} />
          {p.eforDegistir && <Secici<string> deger={p.efor ?? ''} secenekler={eforSecenekleri()} degistir={(v) => notGoster(p.eforDegistir!(ccEforMu(v) ? v : null))} etiket="Düşünme gücü" className="cc-secici cc-secici--efor" title="Düşünme gücü: Claude’un yanıttan önce ne kadar düşüneceği" />}
          <span className="cc-bosluk" />
          <span className="cc-yazici__ipucu">{bilgi || 'Enter gönder · Shift+Enter satır · / komut · @ dosya'}</span>
          {p.calisiyor && <button type="button" className="dgm dgm--koyu dgm--k cc-durdur" onClick={p.durdur} title="Durdur (Esc)" aria-keyshortcuts="Escape"><Ikon ad="dur" olcu={14} />Durdur</button>}
          <button type="button" className="dgm dgm--beyaz dgm--k dgm--simge" data-gonder="" disabled={p.devreDisi || (!metin.trim() && !ekler.length && !dosyaEkleri.length)} onClick={() => void yolla()} title={p.calisiyor ? 'Sıraya ekle (Enter)' : 'Gönder (Enter)'} aria-label={p.calisiyor ? 'Sıraya ekle' : 'Gönder'}>
            <Ikon ad="gonder" olcu={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
