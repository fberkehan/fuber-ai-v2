// ── Toplantı sayfası (12 Kas 2026; Nusa dili) ──────────────────────────────────────────────────────────────────────────────────────────────
// PC'den gelen ses anlık algılanır; algılanan dilde ekrana yazılır ve istenen dile anlık çevrilir. Robot modu açıksa
// verilen konuda doğrudan AI yanıtı üretilip ekranda gösterilir. Ayrı bir ekrandır.
//  · Üst şerit: kayıt işareti + geçen süre, sezilen diller, çeviri dili, Robot anahtarı, Başlat/Durdur. Altında rıza satırı ve kredi notu.
//  · İki canlı sütun: özgün metin ve çevirisi, satır satır hizalı (aynı ızgara satırı). Konuşan çipi ("Karşı taraf" / "Siz"), saat, dil rozeti.
//  · Robot açıkken yan panel: karşı tarafın sorusuna yanıt önerisi — yalnız kullanıcı görür, sesli okunmaz, gönderilmez.
//  · Bitince özet (ana noktalar, kararlar, yapılacaklar; her yapılacak tek tıkla Yapılacaklar'a). Boştayken "Geçmiş toplantılar" (aç, sil — Geri al'lı).
// Boşta hiçbir şey çizmez: sayaç yalnız toplantı sürerken saniyede bir; kayıt işaretinin nabzı yalnız kayıtta (azaltılmış harekette yok).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cagir } from '../api';
import { Dugme } from '../ui';
import { vurguStili } from '../ui/vurgu';
import { Anahtar } from '../bilesenler/Ortak';
import { Secici } from '../bilesenler/Secici';
import { Ikon } from '../bilesenler/Ikon';
import { tostGoster } from '../tostlar';
import { silmeler, useSilmeler } from '../geri-al';
import { baglamAyarla, baslat, durdur, ayarla, geminiAnahtari, hazirla, kaynagiYenile, mikrofonuAc, temizle, tercihYaz, useToplanti, whisperIndir, windowsMikrofonAyari, type Hazirlik } from './denetci';
import {
  BULUT_NEDENI_METNI, DILLER, KONUSAN_ADI, KREDI_NOTU, KREDI_NOTU_YEREL, RIZA_SATIRI, ROBOT_NOTU, dilAdi, sureMetni,
  type RobotOnerisi, type ToplantiDurumu, type ToplantiKaydi, type ToplantiListeOgesi, type ToplantiOzeti, type ToplantiSatiri, type UyariEylemi, type UyariSeviyesi,
} from '../../shared/toplanti';
import {
  BAGLAM_BELGE_KABUL, BAGLAM_SINIRLARI, TON_SECENEKLERI, baglamOzeti, belgeKurali, belgeYap, type ToplantiBaglami, type YanitTonu,
} from '../../shared/toplanti-baglam';
import { BULUT_YZ_KAPALI } from '../../shared/gizlilik-metni';
import { GEMINI_ETIKET, GEMINI_UYARISI } from '../../shared/gemini-yazi';
import type { SecimSecenegi } from '../../shared/toplanti-model';
import './toplanti.css';

const boyutMetni = (mb: number): string => (mb >= 1000 ? `${(mb / 1000).toFixed(1).replace('.', ',')} GB` : `${mb} MB`);

/** Seçicinin gösterdiği değer: ana sürecin canlı etiketiyle uyumlu seçenek (yoksa kapalı "canlı" satır). */
function canliSecim(secenekler: SecimSecenegi[], deger: string, canli: string | undefined): { secenekler: SecimSecenegi[]; deger: string } {
  if (!canli || secenekler.find((o) => o.deger === deger)?.etiket === canli) return { secenekler, deger };
  const esles = secenekler.find((o) => o.etiket === canli);
  if (esles) return { secenekler, deger: esles.deger };
  return { secenekler: [{ deger: '__canli', etiket: canli, devreDisi: true }, ...secenekler], deger: '__canli' };
}

/**
 * Üst şerit: hangi yazıya çevirme, hangi yapay zekâ (Business'ta sade ad, Developer'da model adı) + Bağlam düğmesi. İki öğe de TIKLANINCA seçici açar (13 Kas 0.17.3):
 * seçim kalıcıdır ve toplantı sürerken de değişir (sonraki istekte devreye girer). Gizli / "Yalnız bu bilgisayar"da bulut satırı hiç yok (P14). Hazırlık yoksa düz yazı.
 */
function MotorSeridi({ yazi, yz, hazirlik, baglamAcik, baglamNotu, ac, devreDisi }: { yazi: string | undefined; yz: string | undefined; hazirlik: Hazirlik | null; baglamAcik: boolean; baglamNotu: string; ac: () => void; devreDisi: boolean }) {
  const sec = hazirlik?.secenekler;
  // Seçicinin tetiği ana sürecin O ANKİ gerçeğini yazar (bulut düştüyse "Bu bilgisayar", yol yoksa "Kapalı"): seçili seçenekle aynı adsa seçimi, başka seçeneğin adıysa onu,
  // hiçbiri değilse kapalı tek satırlık bir "canlı" seçeneği gösterir.
  const yzG = sec ? canliSecim(sec.yz, sec.yzDeger, yz) : null;
  const yaziG = sec ? canliSecim(sec.yazi, sec.yaziDeger, yazi) : null;
  const yzSecenek = yzG?.secenekler ?? [];
  const yaziSecenek = yaziG?.secenekler ?? [];
  return (
    <div className="tp-motor" aria-label="Kullanılan yazıya çevirme ve yapay zekâ">
      <div className="tp-motor__liste">
        {yazi && (
          <span className="tp-motor__oge" data-motor="yazi"><span className="tp-motor__ad">Yazıya çevirme:</span>{' '}
            {sec && yaziG ? <Secici className="tp-motor__secici" deger={yaziG.deger} secenekler={yaziSecenek} degistir={(v) => void tercihYaz({ yazi: v as 'bulut' | 'yerel' | 'gemini' })} etiket="Yazıya çevirme yolu" title={yazi} devreDisi={devreDisi} /> : yazi}
          </span>
        )}
        {yz && (
          <span className="tp-motor__oge" data-motor="yz"><span className="tp-motor__ad">Çeviri ve öneri:</span>{' '}
            {sec && yzG ? <Secici className="tp-motor__secici" deger={yzG.deger} secenekler={yzSecenek} degistir={(v) => void tercihYaz({ yz: v })} etiket="Çeviri ve öneri modeli" title={yz} devreDisi={devreDisi} /> : yz}
          </span>
        )}
      </div>
      <Dugme tur="hayalet" boyut="k" simge="dosya" aria-expanded={baglamAcik} aria-controls="tp-baglam" data-toplanti-eylem="baglam" onClick={ac}>{baglamNotu ? `Bağlam · ${baglamNotu}` : 'Bağlam'}</Dugme>
    </div>
  );
}

/** Durum çipi: sakin, tek cümle; gerektiğinde tek eylem düğmesi. "Bilgi" sorun değildir (iş sürüyor). */
function DurumCipi({ metin, seviye, eylem, eylemAdi, onEylem }: { metin: string; seviye: UyariSeviyesi; eylem?: UyariEylemi; eylemAdi?: string; onEylem?: () => void }) {
  return (
    <div className="tp-durumcip" data-seviye={seviye} role="status" data-eylem={eylem}>
      <Ikon ad={seviye === 'sorun' ? 'uyari' : 'tamam'} olcu={14} />
      <span className="tp-durumcip__metin">{metin}</span>
      {eylem && eylemAdi && onEylem && <Dugme tur="ikincil" boyut="k" onClick={onEylem}>{eylemAdi}</Dugme>}
    </div>
  );
}

/** "Ayrıntılar": açılır, küçük; kullanıcı sorun bildirirken ekran görüntüsünü paylaşabilsin (yazıya çevirme motoru, bağlantı, son hata, gelen parça/metin sayıları). Sır yok: hata arındırılmış gelir. */
function Ayrintilar({ d, hazirlik }: { d: ToplantiDurumu | null; hazirlik: Hazirlik | null }) {
  const t = d?.tani;
  const satirlar: [string, string][] = [
    ['Yazıya çevirme', t?.motor ?? hazirlik?.motorlar.yazi ?? '—'],
    ['Bağlantı', t?.baglanti ?? (hazirlik ? (hazirlik.whisper.kurulu ? 'yerel yazıya çevirme kurulu' : 'hazır değil') : '—')],
    ['Son hata', t?.sonHata || 'yok'],
    ['Gelen ses parçası', t ? String(t.gelenParca) : '0'],
    ['Metin dönen satır', t ? String(t.gelenMetin) : '0'],
    ['Yazıya çevrilemeyen', t ? String(t.basarisiz) : '0'],
  ];
  if (t?.bulutNedeni) satirlar.splice(1, 0, ['Bulut kullanılamıyor', BULUT_NEDENI_METNI[t.bulutNedeni]]);
  if (t?.yerel) satirlar.push(['Yerel', `${t.yerel.donanim === 'cuda' ? 'ekran kartı' : t.yerel.donanim === 'cpu' ? 'işlemci' : t.yerel.donanim} · ${t.yerel.model || 'model ?'} · ${t.yerel.derleme || '?'}${t.yerel.gecikmeMs !== null ? ` · ort. ${(t.yerel.gecikmeMs / 1000).toFixed(1)} sn/istek` : ''}`]);
  return (
    <details className="tp-tani" data-toplanti-tani="">
      <summary>Ayrıntılar</summary>
      <dl className="tp-tani__liste">
        {satirlar.map(([a, b]) => <div key={a} className="tp-tani__satir"><dt>{a}</dt><dd>{b}</dd></div>)}
      </dl>
    </details>
  );
}

/** Gemini (isteğe bağlı): kullanıcı KENDİ Google anahtarını girerse yazıya çevirme seçicisinde "Gemini" çıkar. Önce açık söz (ücretsiz katmanda Google sesi ürünlerini geliştirmek için kullanabilir), anahtar bu bilgisayarda şifreli tutulur ve geri gösterilmez. Gizli'de hiç görünmez. */
function GeminiKutusu({ var_, bulutsuz, gelistirici }: { var_: boolean; bulutsuz: boolean; gelistirici: boolean }) {
  const [anahtar, setAnahtar] = useState('');
  const [mesaj, setMesaj] = useState('');
  const [mesgul, setMesgul] = useState(false);
  if (bulutsuz || !gelistirici) return null; // anahtar girmek Geliştirici'ye özeldir (İş dilinde anahtar yok)
  const kaydet = async () => {
    setMesgul(true); setMesaj('');
    const r = await geminiAnahtari(anahtar.trim());
    setMesgul(false);
    if (r.hata) setMesaj(r.hata); else { setAnahtar(''); setMesaj(GEMINI_ETIKET.kaydedildi); }
  };
  const sil = async () => { setMesgul(true); const r = await geminiAnahtari(null); setMesgul(false); setMesaj(r.hata ?? GEMINI_ETIKET.silindi); };
  return (
    <details className="tp-tani tp-gemini" data-toplanti-gemini="">
      <summary>{GEMINI_ETIKET.baslik}{var_ ? GEMINI_ETIKET.kayitli : ''}</summary>
      <div className="tp-tani__liste">
        <p className="tp-not" data-gemini-uyari="">{GEMINI_UYARISI}</p>
        <div className="tp-gemini__sira">
          {!var_ && <input className="tp-baglam__girdi" type="password" value={anahtar} placeholder="AIza…" aria-label={GEMINI_ETIKET.alan} autoComplete="off" spellCheck={false} onChange={(e) => { setAnahtar(e.target.value); setMesaj(''); }} />}
          {!var_ && <Dugme tur="ikincil" boyut="k" disabled={mesgul || !anahtar.trim()} onClick={() => void kaydet()} data-gemini-kaydet="">{GEMINI_ETIKET.kaydet}</Dugme>}
          {var_ && <Dugme tur="hayalet" boyut="k" disabled={mesgul} onClick={() => void sil()} data-gemini-sil="">{GEMINI_ETIKET.sil}</Dugme>}
        </div>
        {mesaj && <p className="tp-not" role="status">{mesaj}</p>}
      </div>
    </details>
  );
}

const EYLEM_ADI: Record<UyariEylemi, string> = {
  'whisper-indir': 'Yerel yazıya çevirmeyi indir', 'karsi-yeniden': 'Yeniden dene', 'siz-yeniden': 'Yeniden dene', giris: 'Yapay zekâ',
  'windows-mikrofon': 'Windows ayarlarını aç', 'mikrofon-ac': 'Mikrofonu aç',
};

/** Bağlam: konu, katılımcılar, notlar, yanıt tonu, belgeler. Toplantıdan önce ve toplantı sürerken açılır; değişiklik sonraki isteklere girer. */
function BaglamPaneli({ baglam, bulutsuz, kapat }: { baglam: ToplantiBaglami; bulutsuz: boolean; kapat: () => void }) {
  const [hata, setHata] = useState<string | null>(null);
  const [okunuyor, setOkunuyor] = useState(0);
  const girdi = useRef<HTMLInputElement>(null);
  const yaz = (p: Partial<ToplantiBaglami>) => baglamAyarla({ ...baglam, ...p });
  const dosyalar = async (liste: FileList | null) => {
    if (!liste?.length) return;
    setHata(null);
    let yeni = baglam.belgeler;
    for (const f of [...liste]) {
      if (yeni.length >= BAGLAM_SINIRLARI.belgeSayisi) { setHata(`En çok ${BAGLAM_SINIRLARI.belgeSayisi} belge eklenebilir.`); break; }
      const ret = belgeKurali(f.name, f.size);
      if (ret) { setHata(ret); continue; }
      setOkunuyor((n) => n + 1);
      try {
        const r = await window.fuber.ekHazirla?.(f);
        if (!r) setHata('Belge eki bu pencerede kullanılamıyor.');
        else if ('hata' in r) setHata(r.hata);
        else {
          const b = belgeYap(f.name, r.metin, r.kisaltildi === true);
          if (b) yeni = [...yeni.filter((x) => x.ad !== b.ad), b]; else setHata(`${f.name} içinde okunabilir metin yok.`);
        }
      } catch (e) { setHata(`${f.name} okunamadı: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
      finally { setOkunuyor((n) => n - 1); }
    }
    baglamAyarla({ ...baglam, belgeler: yeni });
    if (girdi.current) girdi.current.value = '';
  };
  return (
    <section className="kart tp-baglam" id="tp-baglam" aria-label="Toplantı bağlamı">
      <div className="tp-baglam__bas">
        <span className="ust-etiket">Bağlam</span>
        <span className="tp-not">Yalnız bu toplantı için; çeviri, öneri ve özet isteklerine eklenir. Bu bilgisayarda saklanır.</span>
        <Dugme tur="hayalet" boyut="k" simge="kapat" aria-label="Bağlamı kapat" onClick={kapat} />
      </div>
      <div className="tp-baglam__izgara">
        <label className="tp-baglam__alan"><span>Toplantının konusu</span>
          <input className="tp-baglam__girdi" type="text" value={baglam.konu} maxLength={BAGLAM_SINIRLARI.konu} placeholder="Örnek: Mobil sürüm takvimi" onChange={(e) => yaz({ konu: e.target.value })} />
        </label>
        <label className="tp-baglam__alan"><span>Katılımcılar</span>
          <input className="tp-baglam__girdi" type="text" value={baglam.katilimcilar} maxLength={BAGLAM_SINIRLARI.katilimcilar} placeholder="Ad ve görev: Elif (tasarım), Mark (ürün)" onChange={(e) => yaz({ katilimcilar: e.target.value })} />
        </label>
        <label className="tp-baglam__alan tp-baglam__alan--genis"><span>Notların</span>
          <textarea className="tp-baglam__girdi" rows={3} value={baglam.notlar} maxLength={BAGLAM_SINIRLARI.notlar} placeholder="Bilmesi gerekenler: rakamlar, kararlar, söylemek istediklerin" onChange={(e) => yaz({ notlar: e.target.value })} />
        </label>
        <label className="tp-baglam__alan"><span>Yanıt tonu</span>
          <Secici deger={baglam.ton} secenekler={TON_SECENEKLERI.map((x) => ({ deger: x.deger, etiket: x.etiket }))} degistir={(v) => yaz({ ton: v as YanitTonu })} etiket="Yanıt tonu" genislik={170} />
        </label>
        <div className="tp-baglam__alan">
          <span>Belgeler</span>
          <div className="tp-baglam__belgeler">
            {baglam.belgeler.map((b) => (
              <span key={b.ad} className="tp-belge" title={b.kirpildi ? 'Uzun belge: yalnız baş kısmı kullanılır.' : undefined}>
                <Ikon ad="dosya" olcu={13} />{b.ad}{b.kirpildi ? ' · kısaltıldı' : ''}
                <button type="button" className="tp-belge__kaldir" aria-label={`Kaldır: ${b.ad}`} onClick={() => yaz({ belgeler: baglam.belgeler.filter((x) => x.ad !== b.ad) })}><Ikon ad="kapat" olcu={12} /></button>
              </span>
            ))}
            <input ref={girdi} type="file" accept={BAGLAM_BELGE_KABUL} multiple hidden data-toplanti-belge onChange={(e) => void dosyalar(e.target.files)} />
            <Dugme tur="ikincil" boyut="k" simge="arti" disabled={okunuyor > 0 || baglam.belgeler.length >= BAGLAM_SINIRLARI.belgeSayisi} onClick={() => girdi.current?.click()}>{okunuyor > 0 ? 'Okunuyor…' : 'Belge ekle'}</Dugme>
          </div>
          <span className="tp-not">PDF, Word, TXT ve MD; her biri en çok 5 MB, en çok {BAGLAM_SINIRLARI.belgeSayisi} belge. Uzun belgelerin yalnız soruyla ilgili kısımları kullanılır.</span>
          {hata && <span className="tp-baglam__hata" role="status">{hata}</span>}
        </div>
      </div>
      {bulutsuz && <p className="tp-not">Gizli ya da “Yalnız bu bilgisayar” seçiliyken {BULUT_YZ_KAPALI}; bağlam bu bilgisayardaki yapay zekâya verilir.</p>}
    </section>
  );
}

const yerel = (k: string, v?: string): string | null => { try { if (v !== undefined) localStorage.setItem(k, v); return localStorage.getItem(k); } catch { return null; } };
const tarihMetni = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Yalnız `acik` iken saniyede bir: geçen süre. */
function useSaniye(acik: boolean): number {
  const [s, setS] = useState(() => Date.now());
  useEffect(() => {
    if (!acik) return;
    setS(Date.now());
    const z = window.setInterval(() => setS(Date.now()), 1000);
    return () => clearInterval(z);
  }, [acik]);
  return s;
}

type GorunenSatir = Pick<ToplantiSatiri, 'konusan' | 'basMs' | 'metin' | 'dil' | 'ceviri'> & { id?: string; kesin?: boolean; ceviriDurum?: ToplantiSatiri['ceviriDurum']; hata?: boolean };

/** Dökümün tek satırı. Yalnız kendi nesnesi değişince yeniden çizilir (hafif yayın: değişmeyen satırların nesnesi aynı kalır). Kısmi metin soluk, kesin metin net: yalnız opacity değişir. */
const Satir = memo(function Satir({ s, eski }: { s: GorunenSatir; eski: boolean }) {
  const kesin = s.kesin !== false;
  const ceviri = s.ceviriDurum === 'ayni' ? s.metin : s.ceviri;
  return (
    <div className="tp-satir" data-satir={s.id} data-konusan={s.konusan} data-kesin={kesin ? undefined : ''} data-eski={eski ? '' : undefined}>
      <div className="tp-satir__ozgun">
        <div className="tp-satir__ust">
          <span className="tp-cip" data-konusan={s.konusan}>{KONUSAN_ADI[s.konusan]}</span>
          <span className="tp-satir__saat">{sureMetni(s.basMs)}</span>
          {s.dil && <span className="tp-dil" title={dilAdi(s.dil)}>{s.dil.toUpperCase()}</span>}
        </div>
        <p className="tp-satir__metin">{s.metin || (s.hata ? <span className="tp-hata-satir" data-satir-hata="">yazıya çevrilemedi</span> : <span className="tp-nokta" aria-label="Yazılıyor">…</span>)}</p>
      </div>
      <div className="tp-satir__ceviri" data-durum={s.ceviriDurum ?? (ceviri ? 'tamam' : 'yok')}>
        {s.hata ? <p className="tp-satir__sessiz">—</p> : ceviri ? <p className="tp-satir__metin">{ceviri}</p>
          : !kesin || s.ceviriDurum === 'bekliyor' ? <p className="tp-satir__sessiz">…</p>
            : s.ceviriDurum === 'olmadi' ? <p className="tp-satir__sessiz">Çevrilemedi</p> : <p className="tp-satir__sessiz">—</p>}
      </div>
    </div>
  );
});
/** Satır sayısı bunu aşınca eski satırlar tarayıcıya "görünmüyorsa çizme" denir (content-visibility): 2 saatlik toplantıda da akıcı. */
const CANLI_SATIR = 40;

function Dokum({ satirlar, hedefDil, canli }: { satirlar: readonly GorunenSatir[]; hedefDil: string; canli: boolean }) {
  const kutu = useRef<HTMLDivElement>(null);
  const altta = useRef(true);
  const takip = useRef<number | null>(null);
  const bizim = useRef(false);
  // Akıcı kaydırma: yeni metin ya da yeni satır gelince en alta YUMUŞAKÇA (kare başına kalan farkın bir kısmı) iner; hedefe varınca döngü biter — boştayken çizim yok.
  // Kullanıcı yukarı kaydırmışsa dokunulmaz.
  const kaydir = () => {
    const k = kutu.current;
    if (!k) { takip.current = null; return; }
    const fark = k.scrollHeight - k.clientHeight - k.scrollTop;
    bizim.current = true;
    if (fark < 1.5) { k.scrollTop = k.scrollHeight; takip.current = null; return; }
    k.scrollTop += Math.max(1.2, fark * 0.3);
    takip.current = requestAnimationFrame(kaydir);
  };
  useLayoutEffect(() => {
    if (canli && altta.current && takip.current === null) takip.current = requestAnimationFrame(kaydir);
  }, [satirlar, canli]);
  useEffect(() => () => { if (takip.current !== null) cancelAnimationFrame(takip.current); }, []);
  useLayoutEffect(() => { const k = kutu.current; if (k && !canli) k.scrollTop = 0; }, [canli]);
  return (
    <section className="kart tp-dokum" aria-label="Canlı yazı">
      <div className="tp-dokum__bas" aria-hidden="true">
        <span className="ust-etiket">Özgün</span>
        <span className="ust-etiket">Çeviri · {dilAdi(hedefDil)}</span>
      </div>
      <div className="tp-dokum__liste" ref={kutu} role="log" aria-live="off" onScroll={(e) => {
        if (bizim.current) { bizim.current = false; return; }
        const k = e.currentTarget; altta.current = k.scrollHeight - k.scrollTop - k.clientHeight < 40;
      }}>
        {satirlar.length === 0 && <p className="tp-bos">{canli ? 'Dinliyor… Konuşma başlayınca burada yazılır.' : 'Bu toplantıda yazıya geçen konuşma yok.'}</p>}
        {satirlar.map((s, i) => <Satir key={s.id ?? i} s={s} eski={satirlar.length - i > CANLI_SATIR} />)}
      </div>
    </section>
  );
}

function RobotPaneli({ oneriler, canli }: { oneriler: readonly RobotOnerisi[]; canli: boolean }) {
  const sirali = [...oneriler].reverse();
  return (
    <aside className="kart tp-robot" aria-label="Yanıt önerileri">
      <div className="tp-robot__bas"><Ikon ad="parilti" olcu={16} /><span className="ust-etiket">Yanıt önerileri</span></div>
      <p className="tp-robot__not">{ROBOT_NOTU}</p>
      <div className="tp-robot__liste">
        {!sirali.length && <p className="tp-bos">{canli ? 'Karşı taraf bir şey sorunca kısa bir yanıt önerisi burada belirir.' : 'Bu toplantıda öneri yok.'}</p>}
        {sirali.map((o) => (
          <article key={o.id} className="tp-oneri" data-durum={o.durum}>
            <p className="tp-oneri__soru">“{o.soru}”</p>
            {o.durum === 'hazirlaniyor' && <p className="tp-satir__sessiz">Öneri hazırlanıyor…</p>}
            {o.durum === 'olmadi' && <p className="tp-satir__sessiz">Öneri çıkarılamadı.</p>}
            {o.yanit && <p className="tp-oneri__yanit">{o.yanit}</p>}
            {o.ceviri && <p className="tp-oneri__ceviri">{o.ceviri}</p>}
          </article>
        ))}
      </div>
    </aside>
  );
}

function Ozet({ ozet, bekliyor }: { ozet: ToplantiOzeti | null; bekliyor?: boolean }) {
  const [eklenen, setEklenen] = useState<Set<string>>(new Set());
  const ekle = async (l: string[]) => {
    const yeni = l.filter((x) => !eklenen.has(x));
    let n = 0;
    for (const b of yeni) { if (await cagir('yapilacak:ekle', { baslik: b }).catch(() => null)) n++; }
    setEklenen((s) => new Set([...s, ...yeni]));
    tostGoster(n === 1 ? 'Yapılacaklar’a eklendi.' : n ? `${n} madde Yapılacaklar’a eklendi.` : 'Eklenemedi; yeniden dene.', n ? undefined : 'hata');
  };
  if (bekliyor) return <section className="kart tp-ozet" aria-label="Özet"><span className="ust-etiket">Özet</span><p className="tp-satir__sessiz">Özet hazırlanıyor…</p></section>;
  if (!ozet) return null;
  const bolum = (ad: string, l: string[]) => (l.length ? <div className="tp-ozet__bolum"><div className="tp-ozet__ad">{ad}</div><ul>{l.map((x) => <li key={x}>{x}</li>)}</ul></div> : null);
  return (
    <section className="kart tp-ozet" aria-label="Özet">
      <span className="ust-etiket">Özet</span>
      <div className="tp-ozet__izgara">
        {bolum('Ana noktalar', ozet.anaNoktalar)}
        {bolum('Kararlar', ozet.kararlar)}
        {ozet.yapilacaklar.length > 0 && (
          <div className="tp-ozet__bolum">
            <div className="tp-ozet__ad">Yapılacaklar</div>
            <ul className="tp-ozet__isler">
              {ozet.yapilacaklar.map((x) => (
                <li key={x}>
                  <span>{x}</span>
                  <Dugme tur="hayalet" boyut="k" simge={eklenen.has(x) ? 'tamam' : 'arti'} disabled={eklenen.has(x)} aria-label={`Yapılacaklar’a ekle: ${x}`} title="Yapılacaklar’a ekle" onClick={() => void ekle([x])} />
                </li>
              ))}
            </ul>
            {ozet.yapilacaklar.length > 1 && <Dugme tur="ikincil" boyut="k" simge="arti" disabled={ozet.yapilacaklar.every((x) => eklenen.has(x))} onClick={() => void ekle(ozet.yapilacaklar)}>Hepsini Yapılacaklar’a ekle</Dugme>}
          </div>
        )}
      </div>
    </section>
  );
}

function Gecmis({ ac }: { ac: (id: string) => void }) {
  const [liste, setListe] = useState<ToplantiListeOgesi[] | null>(null);
  const { gizli } = useSilmeler();
  useEffect(() => { void cagir<ToplantiListeOgesi[]>('toplanti:gecmis').then(setListe).catch(() => setListe([])); }, []);
  const gorunen = (liste ?? []).filter((x) => !gizli(`toplanti:${x.id}`));
  return (
    <section className="kart tp-gecmis" aria-label="Geçmiş toplantılar">
      <div className="tp-gecmis__bas"><span className="ust-etiket">Geçmiş toplantılar</span>{gorunen.length > 0 && <span className="tp-not">bu bilgisayarda · {gorunen.length}</span>}</div>
      {liste && !gorunen.length && <p className="tp-bos">Henüz saklanan toplantı yok. Toplantı bitince konuşma metni, çevirisi ve kısa özeti burada durur; yalnız bu bilgisayarda.</p>}
      <ul className="tp-gecmis__liste">
        {gorunen.map((x) => (
          <li key={x.id} className="tp-gecmis__oge">
            <button type="button" className="tp-gecmis__ac" onClick={() => ac(x.id)}>
              <span className="tp-gecmis__baslik">{x.baslik}</span>
              <span className="tp-gecmis__alt">{tarihMetni(x.baslangic)} · {sureMetni(x.sureMs)} · {x.satirSayisi} satır{x.gizli ? ' · Gizli' : ''}</span>
            </button>
            <Dugme tur="hayalet" boyut="k" simge="cop" aria-label={`Sil: ${x.baslik}`} onClick={() => silmeler.ertele({ tur: 'toplanti', id: x.id }, `“${x.baslik}” silindi`, `“${x.baslik}” silinemedi`)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function KayitAyrintisi({ id, kapat }: { id: string; kapat: () => void }) {
  const [k, setK] = useState<ToplantiKaydi | null | undefined>(undefined);
  const { gizli } = useSilmeler();
  useEffect(() => { void cagir<ToplantiKaydi | null>('toplanti:al', id).then(setK).catch(() => setK(null)); }, [id]);
  useEffect(() => { if (gizli(`toplanti:${id}`)) kapat(); }, [gizli, id, kapat]);
  if (k === undefined) return null;
  if (!k) return <section className="kart tp-gecmis"><p className="tp-bos">Bu toplantı bulunamadı.</p><Dugme tur="ikincil" boyut="k" onClick={kapat}>Geri</Dugme></section>;
  const baslik = k.ozet?.anaNoktalar[0] ?? 'Toplantı';
  return (
    <div className="tp-ayrinti">
      <div className="tp-ayrinti__bas">
        <Dugme tur="hayalet" boyut="k" simge="geri" onClick={kapat}>Geçmiş toplantılar</Dugme>
        <span className="tp-not">{tarihMetni(k.baslangic)} · {sureMetni(k.sureMs)}{k.gizli ? ' · Gizli' : ''}</span>
        <Dugme tur="hayalet" boyut="k" simge="cop" onClick={() => silmeler.ertele({ tur: 'toplanti', id: k.id }, `“${baslik}” silindi`, `“${baslik}” silinemedi`)}>Sil</Dugme>
      </div>
      <Ozet ozet={k.ozet} />
      <Dokum satirlar={k.satirlar} hedefDil={k.hedefDil} canli={false} />
    </div>
  );
}

export function Toplanti() {
  const t = useToplanti();
  const d = t.durum;
  const [hedefSecim, setHedefSecim] = useState<string>(() => yerel('toplanti.hedefDil') ?? '');
  const [robotSecim, setRobotSecim] = useState<boolean>(() => yerel('toplanti.robot') === '1');
  const [acik, setAcik] = useState<string | null>(null);
  const [baglamAcik, setBaglamAcik] = useState(false);
  useEffect(() => { void hazirla(); }, []);
  const canli = d?.hal === 'dinliyor';
  const suren = canli || d?.hal === 'ozetleniyor';
  const hedefDil = canli || suren ? d!.hedefDil : hedefSecim || t.hazirlik?.hedefDil || 'tr';
  const robot = suren ? d!.robot : robotSecim;
  const simdi = useSaniye(canli);
  const gecen = d ? (canli ? simdi : (d.bitis ?? simdi)) - d.baslangic : 0;
  const diller = useMemo(() => [...new Set((d?.satirlar ?? []).map((s) => s.dil).filter((x): x is string => Boolean(x)))].slice(-4), [d?.satirlar]);
  const bulutsuz = suren ? d!.bulutsuz : t.hazirlik?.bulutsuz === true;
  const yolYok = !suren && t.hazirlik?.yol === 'yok';

  const hedefDegistir = (v: string) => { setHedefSecim(v); yerel('toplanti.hedefDil', v); ayarla({ hedefDil: v }); };
  const robotDegistir = (v: boolean) => { setRobotSecim(v); yerel('toplanti.robot', v ? '1' : '0'); ayarla({ robot: v }); };
  const basla = () => { setAcik(null); void baslat({ hedefDil, robot }); };
  const motorlar = suren && d?.yaziMotoru ? { yazi: d.yaziMotoru, yz: d.yzMotoru } : t.hazirlik?.motorlar;
  const indirmeMetni = t.indirme ? (t.indirme.hata ? 'Yerel yazıya çevirme indirilemedi; yeniden dene.' : `Yerel yazıya çevirme indiriliyor · %${Math.round(t.indirme.yuzde)}`) : null;
  const boyutNotu = t.hazirlik?.whisper.boyutMB ? ` (yaklaşık ${boyutMetni(t.hazirlik.whisper.boyutMB)})` : '';
  const eylemYap = (e: UyariEylemi) => {
    if (e === 'whisper-indir') void whisperIndir();
    else if (e === 'karsi-yeniden') void kaynagiYenile('karsi');
    else if (e === 'siz-yeniden') void kaynagiYenile('siz');
    else if (e === 'windows-mikrofon') windowsMikrofonAyari();
    else if (e === 'mikrofon-ac') void mikrofonuAc();
    else void cagir('ana:goster', 'ayarlar#motor');
  };

  const gosterilen = d && (suren || d.hal === 'bitti' || d.hal === 'durdu') ? d : null;
  const dilSecenekleri = DILLER.map((x) => ({ deger: x.kod, etiket: x.ad }));

  return (
    <div className="toplanti" data-hal={d?.hal ?? 'bos'} style={vurguStili('gorevler') as CSSProperties}>
      <div className="sayfa toplanti__sayfa">
        <div className="sayfa__bas">
          <div>
            <div className="t-dev" style={{ fontSize: 40 }}>Toplantı</div>
            <div className="t-giris">Karşı tarafı ve sizi canlı yazıya döker, seçtiğiniz dile çevirir.</div>
          </div>
        </div>

        <section className="kart tp-kontrol" aria-label="Toplantı denetimleri">
          <div className="tp-kayit" data-kayit={canli ? '' : undefined} aria-live="polite">
            <span className="tp-kayit__nokta" aria-hidden="true" />
            <span className="tp-kayit__metin">{canli ? 'Canlı' : d?.hal === 'ozetleniyor' ? 'Özetleniyor' : gosterilen ? 'Bitti' : 'Hazır'}</span>
            {(suren || gosterilen) && <span className="tp-kayit__sure">{sureMetni(gecen)}</span>}
            {diller.map((x) => <span key={x} className="tp-dil" title={dilAdi(x)}>{x.toUpperCase()}</span>)}
          </div>
          <div className="tp-kontrol__sag">
            <label className="tp-alan"><span>Çeviri dili</span>
              <Secici deger={hedefDil} secenekler={dilSecenekleri} degistir={hedefDegistir} etiket="Çeviri dili" genislik={150} devreDisi={d?.hal === 'ozetleniyor'} />
            </label>
            <label className="tp-alan tp-alan--anahtar"><span>Robot</span><Anahtar acik={robot} degistir={robotDegistir} etiket="Robot: soru gelince yanıt önerisi" devreDisi={d?.hal === 'ozetleniyor'} /></label>
            {canli
              ? <Dugme tur="tehlike" simge="dur" onClick={() => void durdur()} data-toplanti-eylem="durdur">Durdur</Dugme>
              : <Dugme tur="birincil" simge="mikrofon" disabled={t.basliyor || d?.hal === 'ozetleniyor' || yolYok} onClick={basla} data-toplanti-eylem="baslat">{t.basliyor ? 'Başlıyor…' : 'Başlat'}</Dugme>}
          </div>
        </section>
        <div className="tp-notlar">
          <span className="tp-riza" data-canli={canli ? '' : undefined}><Ikon ad="uyari" olcu={14} />{RIZA_SATIRI}</span>
          <span className="tp-not">{bulutsuz ? KREDI_NOTU_YEREL : KREDI_NOTU}</span>
        </div>
        {/* Durum alanı: motor satırı, durum çipleri, bağlam ve (yol yoksa) engel kartı TEK satır-ızgara öğesidir (sayfa ızgarası sabit kalır). */}
        <div className="tp-durum">
          <MotorSeridi yazi={motorlar?.yazi} yz={motorlar?.yz} hazirlik={t.hazirlik} devreDisi={d?.hal === 'ozetleniyor'} baglamAcik={baglamAcik} baglamNotu={baglamOzeti(t.baglam)} ac={() => setBaglamAcik((a) => !a)} />
          {(t.hatalar.length > 0 || d?.uyari || indirmeMetni) && (
            <div className="tp-durumlar">
              {t.hatalar.map((h) => {
                const e = h.eylem;
                return <DurumCipi key={h.anahtar} metin={h.metin} seviye="sorun" eylem={e ?? undefined} eylemAdi={e ? EYLEM_ADI[e] : undefined} onEylem={() => e && eylemYap(e)} />;
              })}
              {d?.uyari && !(t.indirme && d.uyariEylemi === 'whisper-indir') && (
                <DurumCipi metin={d.uyari} seviye={d.uyariSeviyesi ?? 'sorun'} eylem={d.uyariEylemi} eylemAdi={d.uyariEylemi ? `${EYLEM_ADI[d.uyariEylemi]}${d.uyariEylemi === 'whisper-indir' ? boyutNotu : ''}` : undefined} onEylem={() => d.uyariEylemi && eylemYap(d.uyariEylemi)} />
              )}
              {indirmeMetni && <DurumCipi metin={indirmeMetni} seviye={t.indirme?.hata ? 'sorun' : 'bilgi'} eylem={t.indirme?.hata ? 'whisper-indir' : undefined} eylemAdi={t.indirme?.hata ? 'Yeniden dene' : undefined} onEylem={() => void whisperIndir()} />}
            </div>
          )}
          <Ayrintilar d={suren || gosterilen ? d : null} hazirlik={t.hazirlik} />
          <GeminiKutusu var_={t.hazirlik?.geminiVar === true} bulutsuz={bulutsuz} gelistirici={t.hazirlik?.gelistirici === true} />
          {baglamAcik && <BaglamPaneli baglam={t.baglam} bulutsuz={bulutsuz} kapat={() => setBaglamAcik(false)} />}
          {yolYok && (
            <section className="kart tp-engel" aria-label="Yazıya çevirme hazır değil">
              {bulutsuz ? (
                <p>Gizli ve “Yalnız bu bilgisayar” seçiliyken ses bu bilgisayarda yazıya çevrilir; bunun için yerel yazıya çevirme bir kez indirilmeli.</p>
              ) : (
                <p>Toplantı modu yazıya çevirmeyi bu bilgisayarda (yerel Whisper) ya da kendi Gemini anahtarınla yapar. Başlamak için yerel yazıya çevirmeyi indir.</p>
              )}
              <div className="tp-engel__eylemler">
                {!t.indirme && <Dugme tur="ikincil" boyut="k" simge="indir" data-toplanti-eylem="whisper-indir" onClick={() => void whisperIndir()}>{`Yerel yazıya çevirmeyi indir${boyutNotu}`}</Dugme>}
              </div>
            </section>
          )}
        </div>

        {gosterilen ? (
          <div className="tp-govde" data-robot={robot ? '' : undefined}>
            <div className="tp-govde__ana">
              {(d!.hal === 'ozetleniyor' || d!.ozet) && <Ozet ozet={d!.ozet} bekliyor={d!.hal === 'ozetleniyor'} />}
              <Dokum satirlar={gosterilen.satirlar} hedefDil={hedefDil} canli={canli} />
              {(d!.hal === 'bitti' || d!.hal === 'durdu') && (
                <div className="tp-bitis">
                  <span className="tp-not">{t.sonKayit ? 'Bu bilgisayarda saklandı; Geçmiş toplantılar’da.' : gosterilen.satirlar.length ? '' : 'Yazıya geçen konuşma olmadığı için saklanmadı.'}</span>
                  <Dugme tur="ikincil" boyut="k" onClick={temizle}>Kapat</Dugme>
                </div>
              )}
            </div>
            {robot && <RobotPaneli oneriler={gosterilen.oneriler} canli={canli} />}
          </div>
        ) : acik ? <KayitAyrintisi id={acik} kapat={() => setAcik(null)} /> : <Gecmis ac={setAcik} />}
        {gosterilen && (gosterilen.yankiAtilan > 0) && <p className="tp-not">Hoparlörden mikrofona kaçan {gosterilen.yankiAtilan} satır “Siz” diye yazılmadı. Kulaklık en temiz sonucu verir.</p>}
      </div>
    </div>
  );
}
