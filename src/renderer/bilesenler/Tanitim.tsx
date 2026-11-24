// ── Kokpit tanıtım turu ──────────────────────────────────────────────────────────────────────────────────────────────
// Kurulumdan sonra ve yükseltmede bir kez (tanıtım işareti bu sürüm değilken: shared/tanitim.ts; main.tsx açar — yükseltme sihirbazı
// bekleyen profilde sihirbazdan SONRA), Ayarlar → Görünüm → "Tanıtımı yeniden izle" ile yeniden. 0.10 E4 (P6): Kokpit (balon selamlamanın
// altında), sohbetin yazı alanı, Hafıza, [Claude Code], "Ada ekranın üstünde" — İş 4, Geliştirici 5 durak (shared/tanitim.ts). Son durağın
// birincil düğmesi somut bir ilk görev ("Yarın sabah için bir hatırlatıcı kur": yazı alanına yazar) ya da hesap girişi.
// Her durakta öğe vurgulanır (sayfanın geri kalanı perdeyle kararır), yanında 1–2 cümlelik kart: İleri / Geç. Esc geçer, ← / → gezinir.
// Bitince ya da geçilince işaret bu sürüme yazılır (kayıt çağıranda). Tur kalıcıdır (modal): alttaki sayfa tıklanmaz.
// Kart hedefin sağında durur; sağda yer yoksa (geniş gündem bandı) altında, o da yoksa üstünde — hedefi hiç örtmez, pencereden taşmaz.
// Hedef henüz çizilmediyse (kokpit verisi gelmeden gündem bandı) belirene dek DOM izlenir (en çok 3 sn), sonra kart yerine kayar.
// Son durakta sayfa içi ada kopyası (kurulum/AdaKopyasi) pencerenin çentiğinden iner. Az harekette kayma ve canlandırma yok.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from './Ikon';
import { yaziciyaYaz } from '../yazici-olay';
import { AdaKopyasi } from '../kurulum/AdaKopyasi';
import { CagirmaIpucu } from '../kurulum/Adimlar';
import { motorEylemiYap, useMotorSinyali } from '../motor-sinyali';
import { ILK_GOREV_METNI, sonDurakEylemi, sonDurakNotu, tanitimDuraklari, type TanitimDuragi } from '../../shared/tanitim';
import { yalnizYerelSecili } from '../../shared/motor-durumu';
import type { Ayarlar, Mod } from '../../shared/tipler';
import './tanitim.css';

const KART_EN = 340;
const ADA_KART_EN = 432; // son durak: kısayol ipucu ve ilk görev düğmesi tek satıra sığsın
const PAY = 12; // pencere kenarından en az uzaklık
const VURGU_PAY = 4; // vurgu hedefin dört yanından bu kadar taşar
const ARA = 18; // kart ile vurgu arası

type Kutu = { sol: number; ust: number; en: number; boy: number };
const hedefSecici = (d: TanitimDuragi) => d.hedef ?? `[data-tur="${d.id}"]`;
const sinir = (v: number, en: number, alan: number) => Math.max(PAY, Math.min(v, alan - en - PAY));

/** Kartın yeri: hedefin sağı → altı → üstü (hedefi örtmeden); hiçbiri sığmıyorsa pencerenin ortası. `alt`: önce altı (kokpit balonu
 *  selamlamanın altında; sağı sohbet sütununu örterdi). */
function kartYeri(r: DOMRect, en: number, boy: number, yer?: 'alt'): { sol: number; ust: number } {
  const w = innerWidth, h = innerHeight;
  if (yer === 'alt' && r.bottom + ARA + boy <= h - PAY) return { sol: sinir(r.left + 24, en, w), ust: r.bottom + ARA };
  if (r.right + ARA + en <= w - PAY) return { sol: r.right + ARA, ust: sinir(r.top + r.height / 2 - boy / 2, boy, h) };
  if (r.bottom + ARA + boy <= h - PAY) return { sol: sinir(r.left + 24, en, w), ust: r.bottom + ARA };
  if (r.top - ARA - boy >= PAY) return { sol: sinir(r.left + 24, en, w), ust: r.top - ARA - boy };
  return { sol: sinir((w - en) / 2, en, w), ust: sinir((h - boy) / 2, boy, h) };
}

export function Tanitim({ bitti, kisayol, mod }: { bitti: () => void; kisayol: string; mod: Mod }) {
  const [n, setN] = useState(0);
  // Son durağın eylemi ve "Hey Fuber" ipucu ayarlardan (C-29: uyandırma kapalıyken yalnız kısayol).
  const [ayar, setAyar] = useState<Ayarlar | null>(null);
  const { gorunum, motor } = useMotorSinyali();
  useEffect(() => {
    void cagir<Ayarlar>('ayarlar:al').then(setAyar).catch(() => undefined);
    return dinle('ayarlar:degisti', (a: Ayarlar) => setAyar(a));
  }, []);
  const [hedef, setHedef] = useState<Kutu | null>(null);
  const [kart, setKart] = useState<{ sol: number; ust: number } | null>(null);
  const [adaX, setAdaX] = useState<number | null>(null);
  const duraklar = tanitimDuraklari(mod);
  const kartRef = useRef<HTMLDivElement>(null);
  const ileriRef = useRef<HTMLButtonElement>(null);
  const durak = duraklar[Math.min(n, duraklar.length - 1)];
  const son = n >= duraklar.length - 1;
  const kartEn = durak.id === 'ada' ? ADA_KART_EN : KART_EN;

  // Konum: hedef öğe ya da son durakta pencerenin çentiği. Pencere/hedef boyutu ya da tema değişince yeniden.
  useLayoutEffect(() => {
    let bitti_ = false;
    let gozlenen: Element | null = null;
    const boyGozu = new ResizeObserver(() => olc());
    const olc = (): boolean => {
      if (bitti_) return true;
      const kh = kartRef.current?.offsetHeight ?? 200;
      if (durak.id === 'ada') {
        const c = document.querySelector('.pano__ust .centik')?.getBoundingClientRect();
        const x = c ? c.left + c.width / 2 : innerWidth / 2;
        setHedef(null);
        setAdaX(x);
        setKart({ sol: sinir(x - ADA_KART_EN / 2, ADA_KART_EN, innerWidth), ust: sinir(176, kh, innerHeight) });
        return true;
      }
      const el = document.querySelector(hedefSecici(durak));
      const r = el?.getBoundingClientRect();
      if (!el || !r || r.width < 1 || r.height < 1) {
        setHedef(null);
        setKart({ sol: sinir((innerWidth - kartEn) / 2, kartEn, innerWidth), ust: sinir((innerHeight - kh) / 2, kh, innerHeight) });
        return false;
      }
      if (gozlenen !== el) { if (gozlenen) boyGozu.unobserve(gozlenen); boyGozu.observe(el); gozlenen = el; }
      setHedef({ sol: r.left - VURGU_PAY, ust: r.top - VURGU_PAY, en: r.width + 2 * VURGU_PAY, boy: r.height + 2 * VURGU_PAY });
      setKart(kartYeri(new DOMRect(r.left - VURGU_PAY, r.top - VURGU_PAY, r.width + 2 * VURGU_PAY, r.height + 2 * VURGU_PAY), kartEn, kh, durak.yer));
      return true;
    };
    const bulundu = olc();
    // Hedef henüz yok (kokpit verisi yükleniyor): belirene dek DOM izlenir, en çok 3 sn.
    let dom: MutationObserver | null = null;
    let zaman: ReturnType<typeof setTimeout> | null = null;
    if (!bulundu) {
      dom = new MutationObserver(() => { if (olc()) { dom?.disconnect(); dom = null; } });
      dom.observe(document.body, { childList: true, subtree: true });
      zaman = setTimeout(() => { dom?.disconnect(); dom = null; }, 3000);
    }
    const yeniden = () => void olc();
    addEventListener('resize', yeniden);
    // Tema değişince yerleşim kayabilir (camda ray kenar payı alır): iki kare sonra yeniden ölç (görünüm geçişi bitmiş olsun).
    const tema = new MutationObserver(() => requestAnimationFrame(() => requestAnimationFrame(yeniden)));
    tema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    return () => {
      bitti_ = true;
      removeEventListener('resize', yeniden); tema.disconnect(); boyGozu.disconnect(); dom?.disconnect();
      if (zaman) clearTimeout(zaman);
    };
  }, [n, durak.id, kartEn]);

  // Her durakta odak birincil düğmede (Enter ilerletir); kart yerleşmeden (gizliyken) odak alınamaz. Klavye: Esc geç, → ileri, ← geri.
  const yerlesti = kart !== null;
  useEffect(() => { if (yerlesti) ileriRef.current?.focus({ preventScroll: true }); }, [n, yerlesti]);
  const ileri = () => (son ? bitti() : setN((x) => x + 1));
  // Son durak (G8 Step 7, C-28): yapay zekâ hazırsa somut bir ilk görev (yazı alanına yazılır, gönderilmez); değilse Fuber hesabı girişi;
  // hesap onay bekliyor / erişim kapalı / hak doldu ise R10 metni (sakin not) — kapalı ve dolduda "Hesabı gör". Gizli modda HER ZAMAN yalnız
  // "Bitir" (hatırlatıcı bu kipte kapalı; bulut hesabı anılmaz). Motor durumu YALNIZ motorGorunumu'dan (I1, R19): shared/tanitim.ts.
  const gizli = Boolean(ayar?.yerel.gizliMod);
  const sonDurak = { gorunum, gizliMod: gizli, hesapAktif: ayar?.hesap?.durum === 'aktif', yalnizYerel: yalnizYerelSecili(motor) };
  const eylem = ayar ? sonDurakEylemi(sonDurak) : null;
  const sonNot = ayar ? sonDurakNotu(sonDurak) : null;
  const sonEylem = () => {
    bitti();
    if (eylem?.tur === 'hatirlatici') requestAnimationFrame(() => yaziciyaYaz(ILK_GOREV_METNI));
    else if (eylem?.tur === 'hesap') void cagir('ana:goster', 'ayarlar#motor').catch(() => undefined);
    else if (eylem?.tur === 'yeniden-dene') motorEylemiYap({ eylem: 'yeniden-dene' }); // hesabın hâli sunucuya yeniden sorulur
  };
  const ileriRefFn = useRef(ileri);
  ileriRefFn.current = ileri;
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); bitti(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); ileriRefFn.current(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setN((x) => Math.max(0, x - 1)); }
    };
    addEventListener('keydown', tus);
    return () => removeEventListener('keydown', tus);
  }, [bitti]);

  return (
    <div className="tanitim" role="dialog" aria-modal="true" aria-labelledby="tanitim-baslik" data-durak={durak.id}>
      {hedef
        ? <div className="tanitim__delik" style={{ left: hedef.sol, top: hedef.ust, width: hedef.en, height: hedef.boy }} />
        : <div className="tanitim__perde" />}
      {durak.id === 'ada' && adaX !== null && <div className="tanitim__ada" style={{ left: adaX }}><AdaKopyasi /></div>}
      <div ref={kartRef} className="tanitim__kart" style={{ width: kartEn, ...(kart ? { left: kart.sol, top: kart.ust } : { visibility: 'hidden' }) }}>
        <div className="tanitim__ust">
          <span className="tanitim__sayac">{n + 1} / {duraklar.length}</span>
          <span className="tanitim__cubuk" aria-hidden="true">{duraklar.map((d, i) => <i key={d.id} data-on={i <= n ? '' : undefined} />)}</span>
        </div>
        <div className="tanitim__govde" key={durak.id}>
          <div className="tanitim__baslik" id="tanitim-baslik">{durak.baslik}</div>
          <p className="tanitim__metin">{durak.metin}</p>
          {son && sonNot && <p className="tanitim__metin" data-tur-notu="">{sonNot}</p>}
          {durak.id === 'ada' && (
            <div className="tanitim__ipucu"><span className="tanitim__ipucu-bas">Sen çağırmak istersen:</span><CagirmaIpucu kisayol={kisayol} uyandirma={ayar?.ses.uyandirma ?? true} /></div>
          )}
        </div>
        <div className="tanitim__alt">
          {!son && <button type="button" className="dgm dgm--hayalet dgm--k" onClick={bitti}>Geç</button>}
          <span style={{ flex: 1 }} />
          {n > 0 && <button type="button" className="dgm dgm--koyu dgm--k dgm--simge" aria-label="Geri" title="Geri" onClick={() => setN((x) => x - 1)}><Ikon ad="geri" olcu={15} /></button>}
          {son && eylem && <button type="button" className="dgm dgm--hayalet dgm--k" onClick={bitti} data-tur-bitir="">Bitir</button>}
          <button ref={ileriRef} type="button" className="dgm dgm--beyaz dgm--k" onClick={son && eylem ? sonEylem : ileri} data-tur-eylem={son && eylem ? eylem.tur : undefined}>{son ? eylem?.etiket ?? 'Bitir' : 'İleri'}</button>
        </div>
      </div>
    </div>
  );
}
