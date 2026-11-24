// ── Canlı dökümün öğeleri (Görev 28, K17): mesaj, akan metin, araç kartları, alt ajan, yapılacaklar, izin/sonuç/sistem satırları ────
// Her öğe React.memo: döküm modeli değişmeyen öğeyi aynı nesne verir → yalnız değişen çizilir. Kartın açık/kapalı hâli ve "Tamamını
// göster" sanal listede kart sökülüp yeniden takılsa da kalır (useKalici → dökümün haritası).
import { createContext, memo, useContext, useState, type ReactNode } from 'react';
import { Ikon } from '../bilesenler/Ikon';
import { Markdown } from '../bilesenler/Ortak';
import { FarkGorunumu } from './FarkGorunumu';
import { aracFarki, farkSayilari, numaraliSatirlar } from './fark';
import { goreliYol, satirKatla, sureMetni, aracAdiTr, aracSimgesi, mcpParcalari, sonucEtiketi } from './yardimci';
import { ccAjanTipiAdi, ccAltAjanIsi } from '../../shared/is-izi';
import { ekleriAyikla } from '../../shared/ek-kural';
import '../bilesenler/ek-cip.css';
import { IsSeridi, KatliSatir } from '../is-izi/IsSeridi';
import { katliOzet, type KatliGrup } from './katla';
import { isSirasi, useIsIzi, useSaniye } from '../is-izi/depo';
import { IzinBaglam, IzinCumlesi, IzinKararlari, SoruKarti } from './IzinKarti';
import { bekleyenTorunVar, type DokumOgesi, type AracOgesi, type AltAjanOgesi, type YapilacakOgesi, type IzinOgesi, type SonucOgesi } from './dokum-modeli';

// ── Kalıcı aç/kapa ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export const AcikBaglam = createContext<Map<string, boolean> | null>(null);
export function useKalici(anahtar: string, varsayilan: boolean): [boolean, (v: boolean) => void] {
  const harita = useContext(AcikBaglam);
  const [v, setV] = useState(() => harita?.get(anahtar) ?? varsayilan);
  return [v, (x: boolean) => { harita?.set(anahtar, x); setV(x); }];
}
/** Kullanıcının açık/kapalı seçimi; seçmediyse undefined (çağıran duruma göre karar verir: ör. yardımcı yalnız sürerken açık). */
export function useKaliciSecim(anahtar: string): [boolean | undefined, (v: boolean) => void] {
  const harita = useContext(AcikBaglam);
  const [v, setV] = useState<boolean | undefined>(() => harita?.get(anahtar));
  return [v, (x: boolean) => { harita?.set(anahtar, x); setV(x); }];
}

/** 11 Kas: art arda biten yardımcılar ya da araç kartları tek katlı satır ("✓ 3 yardımcı · 15 adım · 16 sn"); tıklayınca kartlar açılır (katla.ts). */
export const KatliGrupKarti = memo(function KatliGrupKarti({ g, cwd }: { g: KatliGrup; cwd: string }) {
  const [acik, setAcik] = useKalici(g.anahtar, false);
  const o = katliOzet(g);
  return (
    <div className="cc-katli" data-cesit={g.cesit} data-sayi={g.ogeler.length}>
      <KatliSatir metin={o.metin} tamam={o.tamam} acik={acik} degistir={setAcik} data-cc-katli={g.cesit}>
        {g.ogeler.map((x) => <OgeCiz key={x.anahtar} o={x} cwd={cwd} />)}
      </KatliSatir>
    </div>
  );
});

// ── Araç adları ve simgeleri (Türkçe; yardimci.ts) ─────────────────────────────────────────────────────────────────────────────
export const aracAdi = aracAdiTr;
export const mcpAdi = mcpParcalari;
export { aracSimgesi };

const metinAl = (g: Record<string, unknown>, k: string) => (typeof g[k] === 'string' ? (g[k] as string) : '');

function DurumSimgesi({ durum }: { durum: AracOgesi['durum'] }) {
  if (durum === 'calisiyor') return <span className="donen" role="img" aria-label="Çalışıyor" />;
  if (durum === 'hata') return <span className="cc-durum-simge" data-ton="hata" role="img" aria-label="Hata"><Ikon ad="uyari" olcu={15} /></span>;
  if (durum === 'kesildi') return <span className="cc-durum-simge" data-ton="notr" role="img" aria-label="Kesildi"><Ikon ad="dur" olcu={15} /></span>;
  return <span className="cc-durum-simge" data-ton="tamam" role="img" aria-label="Bitti"><Ikon ad="tamam" olcu={15} /></span>;
}

/** Katlanan eş aralıklı çıktı (komut çıktısı, arama sonucu, web metni). */
function Cikti({ metin, anahtar, enCok = 12, hata, numarali }: { metin: string; anahtar: string; enCok?: number; hata?: boolean; numarali?: boolean }) {
  const [acik, setAcik] = useKalici(`${anahtar}:cikti`, false);
  if (numarali) {
    const satirlar = numaraliSatirlar(metin);
    if (satirlar.length) {
      const gorunen = acik ? satirlar : satirlar.slice(0, enCok);
      return (
        <div className="cc-kod cc-kod--numarali">
          {gorunen.map((s, i) => <div key={i} className="cc-kod__satir"><span className="cc-kod__no">{s.no}</span><span className="cc-kod__metin">{s.metin || ' '}</span></div>)}
          {satirlar.length > enCok && <button type="button" className="cc-katla" aria-expanded={acik} onClick={() => setAcik(!acik)}>{acik ? 'Daha az göster' : `Tamamını göster · ${satirlar.length - enCok} satır daha`}</button>}
        </div>
      );
    }
  }
  const k = satirKatla(metin, enCok, acik);
  return (
    <div className="cc-kod" data-hata={hata ? '' : undefined}>
      <pre>{k.gorunen || ' '}</pre>
      {(k.gizli > 0 || (acik && k.toplam > enCok)) && <button type="button" className="cc-katla" aria-expanded={acik} onClick={() => setAcik(!acik)}>{acik ? 'Daha az göster' : `Tamamını göster · ${k.gizli} satır daha`}</button>}
    </div>
  );
}

function Alanlar({ girdi }: { girdi: Record<string, unknown> }) {
  const satirlar = Object.entries(girdi).slice(0, 12);
  if (!satirlar.length) return null;
  return (
    <dl className="cc-alanlar">
      {satirlar.map(([k, v]) => (
        <div key={k} className="cc-alanlar__satir"><dt>{k}</dt><dd>{typeof v === 'string' ? v : JSON.stringify(v, null, 1)}</dd></div>
      ))}
    </dl>
  );
}

// ── Araç kartı ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const KARAR_ROZETI: Record<NonNullable<AracOgesi['izinKarari']>, { metin: string; ton: string }> = {
  izin: { metin: 'izin verildi', ton: 'tamam' }, hep: { metin: 'oturumda hep izinli', ton: 'tamam' }, ret: { metin: 'reddedildi', ton: 'hata' }, iptal: { metin: 'izin kapandı', ton: 'notr' },
};

/**
 * Araç kartı. Düzeltme turu 1: bu aracın izin isteği bekliyorsa (IzinBaglam) kart "İzin gerekiyor" hâlindedir — dönen gösterge yok,
 * kart açık kalır, aynı gövdenin (fark, komut + klasör…) altında Türkçe izin cümlesi ve karar düğmeleri. AskUserQuestion bekliyorsa
 * kartın yerinde seçenek kartı. İzin bir kez (burada) çizilir; yazma kutusunun üstünde ikinci kopya yok.
 */
export const AracKarti = memo(function AracKarti({ o, cwd, ic }: { o: AracOgesi; cwd: string; ic?: boolean }) {
  const izinBaglam = useContext(IzinBaglam);
  const izin = izinBaglam?.bekleyen.get(o.id);
  const varsayilanAcik = !ic && (o.tip === 'duzenleme' || o.tip === 'kabuk' || o.durum === 'hata');
  const [acikIc, setAcik] = useKalici(o.anahtar, varsayilanAcik);
  const acik = Boolean(izin) || acikIc;
  const [farkAcik, setFarkAcik] = useKalici(`${o.anahtar}:fark`, false);
  if (izin && izinBaglam && izin.tip === 'soru' && izin.sorular?.length) {
    return <SoruKarti istek={izin} yanitla={(y) => izinBaglam.yanitla(izin.istekId, y)} />;
  }
  const mcp = mcpParcalari(o.ad);
  const fark = o.tip === 'duzenleme' ? aracFarki(o.ad, o.girdi, o.cikti) : null;
  const sayi = fark ? farkSayilari(fark.satirlar) : null;
  const yol = metinAl(o.girdi, 'file_path') || metinAl(o.girdi, 'notebook_path') || metinAl(o.girdi, 'path');
  const ozet = o.tip === 'okuma' || o.tip === 'duzenleme' ? goreliYol(yol || o.ozet, cwd) : mcp ? mcp.arac : o.ozet;
  const sure = o.bitis && o.bitis - o.zaman >= 1000 ? sureMetni(o.bitis - o.zaman) : '';
  let meta: ReactNode = null;
  if (sayi) meta = <span className="cc-arac__sayi"><b data-ton="ekle">+{sayi.eklenen}</b><b data-ton="sil">−{sayi.silinen}</b></span>;
  else if (o.tip === 'okuma' && o.cikti && o.durum === 'tamam') { const n = numaraliSatirlar(o.cikti).length; if (n) meta = <span>{n} satır</span>; }
  else if (o.tip === 'arama' && o.cikti && o.durum === 'tamam') { const n = o.cikti.split('\n').filter((x) => x.trim()).length; meta = <span>{n} sonuç</span>; }
  const karar = !izin && o.izinKarari ? KARAR_ROZETI[o.izinKarari] : null;

  let govde: ReactNode = null;
  if (acik) {
    if (o.tip === 'duzenleme') {
      govde = (
        <>
          {fark ? <FarkGorunumu satirlar={fark.satirlar} acik={farkAcik} acikDegistir={setFarkAcik} etiket={`${ozet} farkı`} /> : <Alanlar girdi={o.girdi} />}
          {o.durum === 'hata' && o.cikti && <Cikti metin={o.cikti} anahtar={o.anahtar} hata />}
        </>
      );
    } else if (o.tip === 'kabuk') {
      const komut = metinAl(o.girdi, 'command');
      const aciklama = metinAl(o.girdi, 'description');
      govde = (
        <>
          {aciklama && <div className="cc-arac__not">{aciklama}</div>}
          {komut && <div className="cc-komut"><span aria-hidden="true">$</span><code>{komut}</code></div>}
          {izin ? <div className="cc-izin__yol"><Ikon ad="klasor" olcu={14} /><span>{cwd}</span></div>
            : o.cikti ? <Cikti metin={o.cikti} anahtar={o.anahtar} hata={o.durum === 'hata'} /> : o.durum === 'calisiyor' ? <div className="cc-arac__not">Çalışıyor…</div> : <div className="cc-arac__not">Çıktı yok.</div>}
        </>
      );
    } else if (o.tip === 'okuma') {
      govde = o.cikti ? <Cikti metin={o.cikti} anahtar={o.anahtar} numarali hata={o.durum === 'hata'} /> : <div className="cc-arac__not">{izin ? 'Okumak için izin bekliyor.' : o.durum === 'calisiyor' ? 'Okunuyor…' : 'İçerik yok.'}</div>;
    } else if (o.tip === 'plan') {
      govde = <div className="cc-arac__md"><Markdown metin={metinAl(o.girdi, 'plan') || o.cikti || ''} /></div>;
    } else {
      govde = (
        <>
          {(o.tip === 'mcp' || o.tip === 'diger' || (izin && o.tip === 'web')) && <Alanlar girdi={o.girdi} />}
          {o.tip === 'arama' && <div className="cc-arac__not">{`Desen: ${metinAl(o.girdi, 'pattern')}`}{metinAl(o.girdi, 'path') ? ` · ${goreliYol(metinAl(o.girdi, 'path'), cwd) || '.'}` : ''}</div>}
          {o.cikti ? <Cikti metin={o.cikti} anahtar={o.anahtar} enCok={o.tip === 'arama' ? 10 : 8} hata={o.durum === 'hata'} /> : izin ? null : <div className="cc-arac__not">{o.durum === 'calisiyor' ? 'Çalışıyor…' : 'Çıktı yok.'}</div>}
        </>
      );
    }
  }
  return (
    <div className="cc-arac" data-tip={o.tip} data-durum={izin ? 'izin' : o.durum} data-ic={ic ? '' : undefined} data-arac={o.id} data-istek={izin?.istekId} data-izin-kart={izin ? '' : undefined} tabIndex={izin ? -1 : undefined}>
      <button type="button" className="cc-arac__bas" aria-expanded={acik} onClick={() => { if (!izin) setAcik(!acik); }} title={yol || o.ozet} aria-disabled={izin ? true : undefined}>
        <span className="cc-arac__simge"><Ikon ad={aracSimgesi(o.tip)} olcu={15} /></span>
        <span className="cc-arac__ad">{aracAdiTr(o.ad)}</span>
        <span className="cc-arac__ozet">{ozet}</span>
        <span className="cc-arac__sag">
          {meta}
          {karar && <span className="cc-arac__karar" data-ton={karar.ton}>{karar.metin}</span>}
          {sure && !izin && <span>{sure}</span>}
          {izin ? <span className="cc-izin-rozet">İzin gerekiyor</span> : <DurumSimgesi durum={o.durum} />}
          {!izin && <Ikon ad="ileri" olcu={14} className="cc-arac__ok" />}
        </span>
      </button>
      {govde && (
        <div className="cc-arac__govde">
          {izin && <IzinCumlesi istek={izin} oturumId={izinBaglam?.oturumId} />}
          {govde}
          {o.girdiKisaltildi && <div className="cc-arac__not">Girdi uzun olduğu için kısaltıldı.</div>}
          {izin && izinBaglam && <IzinKararlari istek={izin} yanitla={(y) => izinBaglam.yanitla(izin.istekId, y)} />}
        </div>
      )}
    </div>
  );
});

// ── Alt ajan ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const COCUK_SINIRI = 5;
export const AltAjanKarti = memo(function AltAjanKarti({ o, cwd }: { o: AltAjanOgesi; cwd: string }) {
  const izinBaglam = useContext(IzinBaglam);
  // Düzeltme 2 (N1): içindeki bir adım izin bekliyorsa ajan açık ve bütün adımları görünür (elle kapatılmış olsa da).
  const izinIcinde = Boolean(izinBaglam?.bekleyen.size) && bekleyenTorunVar(o, (id) => Boolean(izinBaglam?.bekleyen.has(id)));
  // 11 Kas ("biten agentlar chatte çok büyük yer kaplıyor"): kullanıcı seçmediyse yardımcı yalnız sürerken açıktır; bitince şeridine iner.
  const [secimIc, setAcik] = useKaliciSecim(o.anahtar);
  const acikIc = secimIc ?? o.durum === 'calisiyor';
  const [hepsiIc, setHepsi] = useKalici(`${o.anahtar}:hepsi`, false);
  const acik = izinIcinde || acikIc;
  const hepsi = izinIcinde || hepsiIc;
  const adim = o.cocuklar.filter((c) => c.tur === 'arac' || c.tur === 'alt-ajan').length;
  const gorunen = hepsi ? o.cocuklar : o.cocuklar.slice(-COCUK_SINIRI);
  const gizli = o.cocuklar.length - gorunen.length;
  // İş izi (11 Kas): başlık satırı bütün yüzeylerin AYNI şerididir (IsSeridi): durum işareti, "Yardımcı N" + tür çipi (genel amaçlıda yok; "general-purpose"
  // görünmez), işin adı, canlı fiil (çapraz solma), adım sayısı ve süre. Paralel yardımcılar kendi tonunda (sıra ana sürecin iş listesinden).
  const oturumId = izinBaglam?.oturumId ?? '';
  useIsIzi(); // iş listesi değişince sıra (depo: iş listeden düşse de kalır) yeniden okunur
  const sira = isSirasi(`cc:${oturumId}:${o.id}`);
  const is = ccAltAjanIsi({
    id: o.id, aciklama: o.aciklama, ajanTipi: o.ajanTipi, durum: o.durum, baslangic: o.zaman, ...(o.bitis ? { bitis: o.bitis } : {}), izinde: izinIcinde,
    cocuklar: o.cocuklar.filter((c): c is AracOgesi => c.tur === 'arac').map((c) => ({ id: c.id, tip: c.tip, ad: c.ad, ozet: c.ozet, durum: c.durum })),
  }, { id: oturumId, proje: cwd.split(/[\\/]/).filter(Boolean).pop() ?? '' }, sira ?? 0);
  const simdi = useSaniye(o.durum === 'calisiyor');
  const tip = ccAjanTipiAdi(o.ajanTipi);
  const gorunenIs = sira === undefined ? { ...is, sira: undefined } : is;
  return (
    <div className="cc-arac cc-ajan" data-tip="alt-ajan" data-durum={o.durum} data-izin-icinde={izinIcinde ? '' : undefined}>
      <IsSeridi is={gorunenIs} simdi={simdi} cesit="cc" kim={sira === undefined ? 'Yardımcı' : `Yardımcı ${sira + 1}`} anaSinif="cc-arac__bas" acik={acik}
        ipucu={izinIcinde ? 'İçindeki bir adım izin bekliyor' : acik ? 'Adımları gizle' : 'Adımları göster'}
        tikla={() => { if (!izinIcinde) setAcik(!acik); }}
        kimEk={tip ? <i className="cc-cip">{tip}</i> : null}
        sagEk={<span className="cc-arac__sag"><span>{adim} adım</span>{izinIcinde && <span className="cc-izin-rozet">İzin gerekiyor</span>}<Ikon ad="ileri" olcu={14} className="cc-arac__ok" /></span>} />
      {acik && (
        <div className="cc-arac__govde cc-ajan__govde">
          {o.istem && <div className="cc-ajan__istem">{o.istem.length > 320 ? `${o.istem.slice(0, 320)}…` : o.istem}</div>}
          {gizli > 0 && <button type="button" className="cc-katla" onClick={() => setHepsi(true)}>Önceki {gizli} adımı göster</button>}
          <div className="cc-ajan__cocuklar">
            {gorunen.map((c) => <OgeCiz key={c.anahtar} o={c} cwd={cwd} ic />)}
            {!o.cocuklar.length && o.durum === 'calisiyor' && <div className="cc-arac__not">Başlıyor…</div>}
          </div>
          {o.cikti && <div className="cc-ajan__rapor"><span className="ust-etiket">Rapor</span><Markdown metin={o.cikti} /></div>}
        </div>
      )}
    </div>
  );
});

// ── Yapılacaklar ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function YapilacakListesi({ maddeler }: { maddeler: YapilacakOgesi['maddeler'] }) {
  return (
    <ul className="cc-yapilacak__liste">
      {maddeler.map((m, i) => (
        <li key={m.kimlik ?? i} data-durum={m.durum}>
          <span className="cc-yapilacak__isaret" aria-hidden="true">{m.durum === 'tamam' ? <Ikon ad="tamam" olcu={13} kalinlik={2} /> : null}</span>
          <span className="cc-yapilacak__metin">{m.durum === 'suruyor' ? (m.etkinMetin ?? m.icerik) : m.icerik}</span>
          <span className="gorunmez">{m.durum === 'tamam' ? ' (tamam)' : m.durum === 'suruyor' ? ' (sürüyor)' : ''}</span>
        </li>
      ))}
    </ul>
  );
}

export const YapilacakKarti = memo(function YapilacakKarti({ o }: { o: YapilacakOgesi }) {
  const [acik, setAcik] = useKalici(o.anahtar, !o.eski);
  const tamam = o.maddeler.filter((m) => m.durum === 'tamam').length;
  const acikMi = o.eski ? acik : true;
  const bas = (
    <>
      <span className="cc-arac__simge"><Ikon ad="liste" olcu={15} /></span>
      <b>{o.eski ? 'Yapılacaklar (önceki)' : 'Yapılacaklar'}</b>
      <span className="cc-yapilacak__sayi">{tamam}/{o.maddeler.length} tamam</span>
      <span className="ilerleme cc-yapilacak__cubuk" aria-hidden="true"><i style={{ width: `${o.maddeler.length ? (tamam / o.maddeler.length) * 100 : 0}%` }} /></span>
      {o.eski && <Ikon ad="ileri" olcu={14} className="cc-arac__ok" />}
    </>
  );
  return (
    <div className="cc-yapilacak" data-eski={o.eski ? '' : undefined}>
      {o.eski
        ? <button type="button" className="cc-yapilacak__bas" aria-expanded={acikMi} onClick={() => setAcik(!acik)}>{bas}</button>
        : <div className="cc-yapilacak__bas">{bas}</div>}
      {acikMi && <YapilacakListesi maddeler={o.maddeler} />}
    </div>
  );
});

// ── Satırlar ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const KARAR: Record<NonNullable<IzinOgesi['karar']>, string> = { izin: 'İzin verildi', hep: 'Bu oturumda hep izin verildi', ret: 'Reddedildi', iptal: 'İzin isteği kapandı' };
const IzinSatiri = memo(function IzinSatiri({ o, cwd }: { o: IzinOgesi; cwd: string }) {
  const ton = !o.karar ? 'izin' : o.karar === 'ret' ? 'hata' : o.karar === 'iptal' ? 'notr' : 'tamam';
  const ozet = o.istek.tip === 'duzenleme' || o.istek.tip === 'okuma' ? goreliYol(o.istek.ozet, cwd) : o.istek.ozet;
  const ne = o.istek.tip === 'soru' ? `Soru: ${ozet}` : `${aracAdiTr(o.istek.arac)}: ${ozet}`;
  return (
    <div className="cc-satir" data-ton={ton}>
      <Ikon ad={!o.karar ? 'kalkan' : o.karar === 'ret' ? 'kapat' : o.karar === 'iptal' ? 'eksi' : 'tamam'} olcu={14} />
      <span><b>{o.karar ? KARAR[o.karar] : 'İzin bekleniyor'}</b> · {ne}</span>
    </div>
  );
});

const SonucSatiri = memo(function SonucSatiri({ o }: { o: SonucOgesi }) {
  const s = o.sonuc;
  // Başlık ve ayrıntı saf yardımcıdan: arkada iş sürerken "Bitti" yazmaz, tahmini dolar yalnız API anahtarıyla çalışanda görünür.
  const e = sonucEtiketi(s, o.arkaPlan);
  const parcalar = e.parcalar;
  if (!s.basarili && !s.kesildi) {
    return (
      <div className="cc-sonuc" data-ton="hata" role="status">
        <span className="cc-sonuc__cizgi" aria-hidden="true" />
        <span className="cc-sonuc__metin"><Ikon ad="uyari" olcu={14} /><b>Hata</b>{s.hata && !s.hataGorundu ? ` · ${s.hata}` : ''}</span>
        <span className="cc-sonuc__cizgi" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="cc-sonuc" data-ton={e.ton} role="status">
      <span className="cc-sonuc__cizgi" aria-hidden="true" />
      <span className="cc-sonuc__metin"><Ikon ad={s.kesildi ? 'dur' : e.ton === 'calisiyor' ? 'saat' : 'tamam'} olcu={14} /><b>{e.baslik}</b>{parcalar ? ` · ${parcalar}` : ''}</span>
      <span className="cc-sonuc__cizgi" aria-hidden="true" />
    </div>
  );
});

// ── Öğe ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const OgeCiz = memo(function OgeCiz({ o, cwd, ic }: { o: DokumOgesi; cwd: string; ic?: boolean }) {
  switch (o.tur) {
    case 'kullanici': {
      // Belge/video ekleri (<ek …>…</ek> blokları; yazma kutusu ekler) balonda uzun metin değil, çip olur.
      const ay = ekleriAyikla(o.metin);
      return (
        <div className="cc-ben">
          <div className="cc-ben__balon">{ay.metin}{ay.ekler.map((e, i) => <span key={i} className="ek-cip cc-ben__ek" data-tur={e.tur}><Ikon ad={e.tur === 'video' ? 'oynat' : 'dosya'} olcu={13} /><span className="ek-cip__ad">{e.ad}</span></span>)}{o.gorselSayisi > 0 && <span className="cc-cip cc-ben__gorsel"><Ikon ad="kamera" olcu={13} />{o.gorselSayisi} görsel</span>}</div>
        </div>
      );
    }
    case 'metin':
      return <div className={`cc-yanit${ic ? ' cc-yanit--ic' : ''}`} data-akiyor={o.akiyor ? '' : undefined}><Markdown metin={o.metin} className="md cc-md" /></div>;
    case 'dusunme':
      return <div className="cc-dusunme"><span className="dusunce__isik" aria-hidden="true" /><span>Düşünüyor…</span></div>;
    case 'arac': return <AracKarti o={o} cwd={cwd} ic={ic} />;
    case 'alt-ajan': return <AltAjanKarti o={o} cwd={cwd} />;
    case 'yapilacaklar': return <YapilacakKarti o={o} />;
    case 'izin': return <IzinSatiri o={o} cwd={cwd} />;
    case 'sonuc': return <SonucSatiri o={o} />;
    case 'sistem':
      // 5 Kas: koşum bildirimi (arka plan işi bitti…) tek satır; ayrıntısı açılır (kullanıcı balonu değil).
      if (o.ayrinti) return (
        <details className="cc-satir cc-satir--ayrinti" data-ton="notr" data-cc-bildirim="">
          <summary><Ikon ad="isik" olcu={14} /><span>{o.metin}</span></summary>
          <pre className="cc-satir__ayrinti">{o.ayrinti}</pre>
        </details>
      );
      return (
        <div className="cc-satir" data-ton={o.seviye === 'hata' ? 'hata' : o.seviye === 'uyari' ? 'izin' : 'notr'} role={o.seviye === 'hata' ? 'alert' : undefined}>
          <Ikon ad={o.seviye === 'bilgi' ? 'isik' : 'uyari'} olcu={14} /><span>{o.metin}</span>
        </div>
      );
    case 'not': return <div className="cc-not">{o.metin}</div>;
    default: return null;
  }
});

/** Sanal liste için tahmini yükseklik (ölçülene dek). */
export function tahminiBoy(o: DokumOgesi): number {
  const satir = (s: string, en = 88) => s.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / en)), 0);
  switch (o.tur) {
    case 'kullanici': { const ay = ekleriAyikla(o.metin); return 44 + satir(ay.metin, 70) * 22 + (ay.ekler.length ? 34 : 0); }
    case 'metin': return 14 + satir(o.metin) * 23;
    case 'arac': {
      if (o.tip === 'duzenleme') return 120 + Math.min(14, satir(String(o.girdi.new_string ?? o.girdi.content ?? ''))) * 19;
      if (o.tip === 'kabuk') return 110 + Math.min(12, satir(o.cikti ?? '')) * 18;
      return 50;
    }
    case 'alt-ajan': return 110 + Math.min(COCUK_SINIRI, o.cocuklar.length) * 52;
    case 'yapilacaklar': return o.eski ? 52 : 60 + o.maddeler.length * 28;
    default: return 44;
  }
}
