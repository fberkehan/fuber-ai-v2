// ── İzin ve soru (Görev 28, K17; düzeltme turu 1) ────────────────────────────────────────────────────────────────────────────────
// Bekleyen izin isteği KENDİ ARAÇ KARTININ içinde yanıtlanır (Kartlar.tsx AracKarti: "İzin gerekiyor" rozeti + aynı fark/komut +
// IzinKararlari); AskUserQuestion "Soru" kartının yerinde SoruKarti olarak çizilir. Yalnız dökümde kartı olmayan istekler yazma
// kutusunun üstünde IzinKarti olarak kalır (motor araç kimliğini bildirmediyse ya da araç görünmüyorsa).
// Cümle Türkçe (izinBasligi; Claude Code'un kendi başlığı yalnız ipucunda). "Reddet" (isteğe bağlı neden) · "Bu oturumda hep izin ver"
// (yalnız oturum kapsamı; Claude Code sunduysa) · "İzin ver". Klavye: düğmeler sekmeyle sırayla gezilir; "İzin ver" ASLA kendiliğinden
// odak almaz (yazarken kaçan Enter onaylamasın) — Claude Code "tek tuşla onaylanmasın" dediyse odak "Reddet"e (yalnız odak bir yazı
// alanında değilken).
import { createContext, useEffect, useRef, useState } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { FarkGorunumu } from './FarkGorunumu';
import { aracFarki } from './fark';
import { goreliYol, izinBasligi, aracAdiTr, aracSimgesi } from './yardimci';
import { yaziAlaniMi } from '../../shared/uygulama-kisayol';
import type { CcIzinIstegi, CcSoru } from '../../shared/cc-olay';

export interface IzinYaniti { karar: 'izin' | 'hep' | 'ret'; neden?: string; cevaplar?: Record<string, string | string[]>; serbest?: string[] }
export type Yanitla = (y: IzinYaniti) => Promise<{ tamam: boolean; hata?: string }>;

/** Dökümdeki araç kartlarının bekleyen izinleri (araç kimliği → istek) ve yanıtlama. */
export interface IzinBaglamDegeri {
  oturumId: string; cwd: string;
  bekleyen: ReadonlyMap<string, CcIzinIstegi>;
  yanitla: (istekId: string, y: IzinYaniti) => Promise<{ tamam: boolean; hata?: string }>;
}
export const IzinBaglam = createContext<IzinBaglamDegeri | null>(null);

const metin = (g: Record<string, unknown>, k: string) => (typeof g[k] === 'string' ? (g[k] as string) : '');

/** Write'ın hedefi oturumun klasöründe var mı ("yeni dosya" / "üzerine yazma"); bilinmeyen → null. */
function useDosyaVar(oturumId: string | undefined, istek: CcIzinIstegi): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  const yol = metin(istek.girdi, 'file_path');
  useEffect(() => {
    if (istek.arac !== 'Write' || !oturumId || !yol) return;
    let iptal = false;
    void cagir<boolean>('claudecode:dosya-var', oturumId, yol).then((x) => { if (!iptal) setV(Boolean(x)); }).catch(() => undefined);
    return () => { iptal = true; };
  }, [istek.istekId, oturumId, yol]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

/** Türkçe izin cümlesi; Claude Code'un kendi (çoğu zaman İngilizce) başlığı ipucunda. */
export function IzinCumlesi({ istek, oturumId }: { istek: CcIzinIstegi; oturumId?: string }) {
  const dosyaVar = useDosyaVar(oturumId, istek);
  return <div className="cc-izin__cumle" title={istek.baslik || undefined} data-izin-cumle="">{izinBasligi(istek, dosyaVar)}</div>;
}

/** Kartsız istek için önizleme (kartlı istekte aynı içerik araç kartının gövdesidir). */
export function IzinOnizleme({ istek, cwd }: { istek: CcIzinIstegi; cwd: string }) {
  const g = istek.girdi;
  if (istek.tip === 'duzenleme') {
    const f = aracFarki(istek.arac, g);
    const yol = metin(g, 'file_path') || metin(g, 'notebook_path');
    return (
      <>
        {yol && <div className="cc-izin__yol"><Ikon ad="dosya" olcu={14} /><span>{goreliYol(yol, cwd)}</span>{f?.yeniDosya && <i className="cc-cip">yeni dosya</i>}</div>}
        {f && <FarkGorunumu satirlar={f.satirlar} enCok={10} etiket="Önerilen değişiklik" />}
      </>
    );
  }
  if (istek.tip === 'kabuk') {
    const komut = metin(g, 'command');
    return (
      <>
        {metin(g, 'description') && <div className="cc-izin__aciklama">{metin(g, 'description')}</div>}
        <div className="cc-komut cc-komut--izin"><span aria-hidden="true">$</span><code>{komut || istek.ozet}</code></div>
        <div className="cc-izin__yol"><Ikon ad="klasor" olcu={14} /><span>{cwd}</span></div>
      </>
    );
  }
  if (istek.tip === 'web') return <div className="cc-izin__yol"><Ikon ad="kure" olcu={14} /><span>{metin(g, 'url') || metin(g, 'query') || istek.ozet}</span></div>;
  const alanlar = Object.entries(g).slice(0, 8);
  return alanlar.length ? (
    <dl className="cc-alanlar cc-alanlar--izin">
      {alanlar.map(([k, v]) => <div key={k} className="cc-alanlar__satir"><dt>{k}</dt><dd>{typeof v === 'string' ? v : JSON.stringify(v)}</dd></div>)}
    </dl>
  ) : null;
}

/** Karar satırı: Reddet (+ neden) · Bu oturumda hep izin ver · İzin ver. Hem araç kartının içinde hem kartsız istekte. */
export function IzinKararlari({ istek, yanitla }: { istek: CcIzinIstegi; yanitla: Yanitla }) {
  const [neden, setNeden] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState('');
  const reddet = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // "Tek tuşla onaylanmasın": odak Reddet'e (yazı alanındaysa dokunulmaz). "İzin ver" hiçbir koşulda odak almaz.
    if (istek.hayirdaAc && !yaziAlaniMi(document.activeElement as HTMLElement | null)) reddet.current?.focus({ preventScroll: true });
  }, [istek.istekId, istek.hayirdaAc]);
  const gonder = async (y: IzinYaniti) => {
    setMesgul(true);
    setHata('');
    const r = await yanitla(y).catch((e) => ({ tamam: false, hata: (e as Error).message }));
    if (!r.tamam) { setHata(r.hata ?? 'Yanıt iletilemedi.'); setMesgul(false); }
  };
  return (
    <div className="cc-izin__kararlar" data-izin-kararlari={istek.istekId}>
      {istek.neden && <div className="cc-izin__aciklama"><b>Neden soruyor:</b> {istek.neden}</div>}
      {istek.kisaltildi && <div className="cc-izin__aciklama">Girdi uzun olduğu için önizleme kısaltıldı.</div>}
      {neden !== null && (
        <label className="cc-izin__neden">
          <span>Reddetme nedeni (Claude Code’a iletilir; isteğe bağlı)</span>
          <input className="girdi" value={neden} onChange={(e) => setNeden(e.target.value)} placeholder="ör. Bu dosyaya dokunma; önce testleri yaz"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void gonder({ karar: 'ret', neden: neden.trim() || undefined }); } }} />
        </label>
      )}
      {hata && <div className="cc-izin__hata" role="alert">{hata}</div>}
      <div className="onay__dugmeler cc-izin__dugmeler">
        <button ref={reddet} type="button" className="dgm dgm--koyu dgm--k" disabled={mesgul} data-izin="ret" onClick={() => void gonder({ karar: 'ret', ...(neden?.trim() ? { neden: neden.trim() } : {}) })}>
          <Ikon ad="kapat" olcu={14} />Reddet
        </button>
        {neden === null && <button type="button" className="dgm dgm--hayalet dgm--k" disabled={mesgul} onClick={() => setNeden('')}>Neden ekle</button>}
        <span className="cc-bosluk" />
        {istek.herZamanSunulur && (
          <button type="button" className="dgm dgm--koyu dgm--k" disabled={mesgul} data-izin="hep" onClick={() => void gonder({ karar: 'hep' })} title="Yalnız bu oturum için: aynı istek bir daha sorulmaz">
            Bu oturumda hep izin ver
          </button>
        )}
        <button type="button" className="dgm dgm--beyaz dgm--k" disabled={mesgul} data-izin="izin" onClick={() => void gonder({ karar: 'izin' })}>
          <Ikon ad="tamam" olcu={14} />İzin ver
        </button>
      </div>
    </div>
  );
}

/** Dökümde kartı OLMAYAN istek: yazma kutusunun üstünde tek başına kart. */
export function IzinKarti({ istek, cwd, oturumId, yanitla }: { istek: CcIzinIstegi; cwd: string; oturumId?: string; yanitla: Yanitla }) {
  if (istek.tip === 'soru' && istek.sorular?.length) return <SoruKarti istek={istek} yanitla={yanitla} />;
  return (
    <section className="cc-izin onay" aria-label={`İzin isteği: ${aracAdiTr(istek.arac)}`} data-istek={istek.istekId} data-izin-kart="">
      <div className="cc-izin__ust">
        <div className="onay__baslik">
          <Ikon ad={aracSimgesi(istek.tip)} olcu={16} />
          <span>{aracAdiTr(istek.arac)}{istek.tip !== 'kabuk' && istek.tip !== 'duzenleme' ? <span className="cc-izin__ozet"> · {istek.ozet}</span> : null}</span>
          {istek.ajan && <i className="cc-cip">alt ajan</i>}
        </div>
        <span className="onay__etiket">İzin gerekiyor</span>
      </div>
      <IzinCumlesi istek={istek} oturumId={oturumId} />
      <IzinOnizleme istek={istek} cwd={cwd} />
      <IzinKararlari istek={istek} yanitla={yanitla} />
    </section>
  );
}

/** Seçimler istek başına saklanır: sanal listede kart sökülüp yeniden takılsa da yazılan/seçilen kaybolmaz. */
const soruDurumlari = new Map<string, { secim: Record<string, string[]>; serbest: Record<string, string>; diger: string[] }>();

export function SoruKarti({ istek, yanitla }: { istek: CcIzinIstegi; yanitla: Yanitla }) {
  const sorular: CcSoru[] = istek.sorular ?? [];
  const ilk = soruDurumlari.get(istek.istekId);
  const [secim, setSecimIc] = useState<Record<string, string[]>>(ilk?.secim ?? {});
  const [serbest, setSerbestIc] = useState<Record<string, string>>(ilk?.serbest ?? {});
  const [diger, setDigerIc] = useState<Set<string>>(new Set(ilk?.diger ?? []));
  const [mesgul, setMesgul] = useState(false);
  const [hata, setHata] = useState('');
  useEffect(() => { soruDurumlari.set(istek.istekId, { secim, serbest, diger: [...diger] }); }, [istek.istekId, secim, serbest, diger]);
  useEffect(() => { while (soruDurumlari.size > 20) soruDurumlari.delete(soruDurumlari.keys().next().value as string); }, []);
  const setSecim = setSecimIc, setSerbest = setSerbestIc, setDiger = setDigerIc;
  const yanitli = (s: CcSoru) => (diger.has(s.soru) ? Boolean(serbest[s.soru]?.trim()) : (secim[s.soru]?.length ?? 0) > 0);
  const hazir = sorular.every(yanitli);
  const sec = (s: CcSoru, etiket: string) => {
    setDiger((d) => { if (!d.has(s.soru) || s.cokluSecim) return d; const y = new Set(d); y.delete(s.soru); return y; });
    setSecim((x) => {
      const eski = x[s.soru] ?? [];
      const yeni = s.cokluSecim ? (eski.includes(etiket) ? eski.filter((e) => e !== etiket) : [...eski, etiket]) : [etiket];
      return { ...x, [s.soru]: yeni };
    });
  };
  const digerSec = (s: CcSoru) => {
    setDiger((d) => { const y = new Set(d); if (y.has(s.soru)) y.delete(s.soru); else y.add(s.soru); return y; });
    if (!s.cokluSecim) setSecim((x) => ({ ...x, [s.soru]: [] }));
  };
  const gonder = async (karar: 'izin' | 'ret') => {
    setMesgul(true);
    setHata('');
    const cevaplar: Record<string, string | string[]> = {};
    for (const s of sorular) cevaplar[s.soru] = diger.has(s.soru) ? serbest[s.soru]?.trim() ?? '' : s.cokluSecim ? secim[s.soru] ?? [] : secim[s.soru]?.[0] ?? '';
    const r = await yanitla(karar === 'ret' ? { karar: 'ret' } : { karar: 'izin', cevaplar, serbest: [...diger] }).catch((e) => ({ tamam: false, hata: (e as Error).message }));
    if (!r.tamam) { setHata(r.hata ?? 'Yanıt iletilemedi.'); setMesgul(false); }
  };
  return (
    <section className="cc-izin cc-soru onay" aria-label="Claude Code soruyor" data-istek={istek.istekId} data-izin-kart="" tabIndex={-1}>
      <div className="cc-izin__ust"><div className="onay__baslik"><Ikon ad="sohbet" olcu={16} /><span>Soru</span></div><span className="onay__etiket">Claude Code soruyor</span></div>
      {sorular.map((s, i) => (
        <fieldset key={i} className="cc-soru__soru">
          <legend>{s.baslik && <i className="cc-cip">{s.baslik}</i>}<b>{s.soru}</b>{s.cokluSecim && <span className="cc-soru__ipucu">Birden çok seçebilirsin</span>}</legend>
          <div className="cc-soru__secenekler" data-yalin={s.secenekler.every((o) => !o.aciklama) ? '' : undefined} role={s.cokluSecim ? 'group' : 'radiogroup'} aria-label={s.soru}>
            {s.secenekler.map((o) => {
              const secili = (secim[s.soru] ?? []).includes(o.etiket) && !(diger.has(s.soru) && !s.cokluSecim);
              return (
                <button key={o.etiket} type="button" className="cc-soru__secenek" data-yalin={o.aciklama ? undefined : ''} role={s.cokluSecim ? 'checkbox' : 'radio'} aria-checked={secili} onClick={() => sec(s, o.etiket)} disabled={mesgul}>
                  <span className="cc-soru__isaret" data-coklu={s.cokluSecim ? '' : undefined} aria-hidden="true">{secili && <Ikon ad="tamam" olcu={12} kalinlik={2.2} />}</span>
                  <span className="cc-soru__metin"><b>{o.etiket}</b>{o.aciklama && <span>{o.aciklama}</span>}</span>
                </button>
              );
            })}
            <button type="button" className="cc-soru__secenek" data-yalin="" role={s.cokluSecim ? 'checkbox' : 'radio'} aria-checked={diger.has(s.soru)} onClick={() => digerSec(s)} disabled={mesgul} title="Kendi yanıtını yaz">
              <span className="cc-soru__isaret" data-coklu={s.cokluSecim ? '' : undefined} aria-hidden="true">{diger.has(s.soru) && <Ikon ad="tamam" olcu={12} kalinlik={2.2} />}</span>
              <span className="cc-soru__metin"><b>Diğer…</b></span>
            </button>
          </div>
          {diger.has(s.soru) && (
            <input className="girdi cc-soru__serbest" value={serbest[s.soru] ?? ''} aria-label={`${s.soru}: kendi yanıtın`} placeholder="Kendi yanıtını yaz" onChange={(e) => setSerbest((x) => ({ ...x, [s.soru]: e.target.value }))} disabled={mesgul} />
          )}
        </fieldset>
      ))}
      {hata && <div className="cc-izin__hata" role="alert">{hata}</div>}
      <div className="onay__dugmeler cc-izin__dugmeler">
        <button type="button" className="dgm dgm--koyu dgm--k" disabled={mesgul} onClick={() => void gonder('ret')}><Ikon ad="kapat" olcu={14} />Yanıtlamadan geç</button>
        <span className="cc-bosluk" />
        <button type="button" className="dgm dgm--beyaz dgm--k" data-yanitla="" disabled={mesgul || !hazir} onClick={() => void gonder('izin')}><Ikon ad="gonder" olcu={14} />Yanıtla</button>
      </div>
    </section>
  );
}
