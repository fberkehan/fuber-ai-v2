// ── Tost alanı: uygulama içi bütün bildirimler tek yerde, çentiğin altından iner (Görev 20b düzeltme turu 2) ─────────────────
// Ürün kararı: titreme/zıplama yok — tostlar sayfa alanını HİÇ değiştirmez (turu 1'in alt şeridi sayfayı her tostta ~77 px
// kısaltıyor, yazarken sohbet kutusu zıplıyordu). Katman panonun üst ortasında, çentiğin hemen altında (Çentik dili: bildirim
// çentikten iner); en çok 520 px geniş, EN ÇOK 2 tost (çentikle sayfaların ilk denetimi arasındaki şeride sığar — Kokpit, Sohbetler,
// Hafıza, Ayarlar, Beyin, Bağlantılar'da hiçbir düğmenin/yazı alanının üstüne binmez: scripts/dev/ozellik-denetimi.mjs ölçer).
// Kalanı öncelik sırasıyla bekler (son görünen tostta "+N"; shared/tost-kuyrugu.ts). Tek satır: uzun metin "…" ile biter, üstüne
// gelince/odaklanınca tamamı açılır (o an imleç zaten tostta). Kaynaklar: "Geri al" (geri-al.ts; art arda silinenler tek tostta,
// tek süre), bilgi/hata (tostlar.ts), adanın uygulama içi karşılığı (AdaTost.tsx: hatırlatıcı, Fuber'in sözü, onay).
// Tostlar sürükleme şeridinin (pencere başlığı, sayfa başlıkları) üstünde de tıklanabilir: -webkit-app-region: no-drag.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ikon } from './Ikon';
import { useAdaTostlari } from './AdaTost';
import { silmeler, useSilmeler } from '../geri-al';
import { tostDuraklat, tostGorunenler, tostKaldir, tostlariAc, useTostlar, type Tost } from '../tostlar';
import { cagir } from '../api';
import { GERI_AL_MS, geriAlGruplari, type GeriAlGrubu } from '../../shared/ertelenmis';
import { tostYerlesimi, type TostTuru } from '../../shared/tost-kuyrugu';
import './tostlar.css';

const SIMGE: Record<TostTuru, string> = { bilgi: 'tamam', hata: 'uyari', hatirlatma: 'zil', mesaj: 'isik', soz: 'isik', onay: 'kalkan' };

type Oge = { anahtar: string; tur: TostTuru | 'geri-al'; sira: number; g?: GeriAlGrubu; t?: Tost };

export function TostAlani() {
  useAdaTostlari();
  useSilmeler();
  const tostlar = useTostlar();
  // B8: çentiğe katlanmış kalıcı tostlar (hatırlatıcı, onay) yerleşime girmez; çentikte "+N" hapında sayılır.
  const katlilar = tostlar.filter((t) => t.katli);
  const ogeler: Oge[] = [
    ...geriAlGruplari(silmeler.bekleyenler()).map((g, i): Oge => ({ anahtar: `g:${g.grup}`, tur: 'geri-al', sira: i, g })),
    ...tostlar.filter((t) => !t.katli).map((t): Oge => ({ anahtar: `t:${t.id}`, tur: t.tur, sira: t.sira, t })),
  ];
  const { gorunen, sirada } = tostYerlesimi(ogeler);
  // Süre yalnız görünen tostlarda işler (sırada bekleyeninki geçmez).
  const gorunenIdler = gorunen.flatMap((o) => (o.t ? [o.t.id] : []));
  const imza = gorunenIdler.join(',');
  useEffect(() => { tostGorunenler(gorunenIdler); }, [imza]); // eslint-disable-line react-hooks/exhaustive-deps
  // B8: sırada bekleyen (görünmeyen) "Geri al" grubunun süresi görünene dek işlemez — üçüncü grup görülmeden silinmesin. Ana süreç
  // pencere odağı gidince süreleri sürdürür; sıradaki grup yine durdurulur (görününce GeriAlTostu sürdürür).
  const siradakiGruplar = sirada.flatMap((o) => (o.g ? [o.g] : []));
  const gizliImza = siradakiGruplar.map((g) => `${g.grup}:${g.durakli ? 1 : 0}`).join(',');
  useEffect(() => { for (const g of siradakiGruplar) if (!g.durakli) silmeler.duraklat(g.grup, true); }, [gizliImza]); // eslint-disable-line react-hooks/exhaustive-deps
  // Katlanan tostların hapı çentiğin İÇİNDE (sayfanın üstünü örtmez, tost yuvası harcamaz).
  const [centik, setCentik] = useState<Element | null>(null);
  useEffect(() => { setCentik(document.querySelector('.pano__ust .centik')); }, []);
  const hap = katlilar.length > 0 && (
    <button
      type="button" className="tost-katli" data-tost-katli={katlilar.length} onClick={tostlariAc}
      title={`${katlilar.length} bildirim katlandı · göstermek için tıkla`} aria-label={`${katlilar.length} katlanmış bildirim: göster`}
    >
      <Ikon ad={katlilar.some((t) => t.tur === 'onay') ? 'kalkan' : 'zil'} olcu={12} />+{katlilar.length}
    </button>
  );
  return (
    <>
      {centik && hap ? createPortal(hap, centik) : null}
      {/* B8: her tost sabit 38 px'lik yuvada; üstüne gelince/odakta açılan tost (en çok 3 satır) yuvadan taşar ve öteki tostun ÜSTÜNE
          biner — ikinci tostu denetimlerin üstüne itmez. Birinci aşağı, ikinci yukarı açılır: açılan tost iki tostluk şeritten çıkmaz. */}
      <div className="tostlar" role="region" aria-label="Bildirimler" aria-live="polite" data-sirada={sirada.length || undefined}>
        {gorunen.map((o, i) => {
          const fazla = i === gorunen.length - 1 ? sirada.length : 0;
          return <div className="tost-yuva" key={o.anahtar}>{o.g ? <GeriAlTostu g={o.g} fazla={fazla} /> : <MesajTostu t={o.t!} fazla={fazla} />}</div>;
        })}
      </div>
    </>
  );
}

/** Sırada bekleyen tostların sayısı: son görünen tostta küçük çip (yükseklik eklemez). */
function Fazla({ n }: { n: number }) {
  if (!n) return null;
  return <span className="tost__fazla" title={`${n} bildirim daha sırada`} aria-label={`${n} bildirim daha sırada`}>+{n}</span>;
}

function GeriAlTostu({ g, fazla }: { g: GeriAlGrubu; fazla: number }) {
  // Kalan süre çizgisi CSS animasyonuyla akar. Grup tek süre paylaşır (ana süreç): yeni silme katılınca bitiş değişir, çizgi kalan
  // oranından yeniden kurulur. Duraklatma ana süreçteki gruba özgü; çizgi aynadan durur (öteki tostlar akmaya devam eder).
  const kalan = useMemo(() => Math.max(0, Math.min(GERI_AL_MS, g.bitis - Date.now())), [g.bitis]);
  const ustunde = useRef(false);
  const odakta = useRef(false);
  const son = useRef(0);
  const istek = () => { son.current = Date.now(); silmeler.duraklat(g.grup, ustunde.current || odakta.current); };
  // Üstündeyken kalkarsa ("Geri al", Ctrl+Z, başka grup öne geçti) fare ayrılma olayı gelmez: süre sürsün.
  useEffect(() => () => { if (ustunde.current || odakta.current) silmeler.duraklat(g.grup, false); }, [g.grup]);
  // B8: sıradayken durdurulmuş grup görünür oldu: süresi şimdi işlemeye başlar (imleç üstünde değilse).
  useEffect(() => { if (g.durakli && !ustunde.current && !odakta.current) silmeler.duraklat(g.grup, false); }, [g.grup]); // eslint-disable-line react-hooks/exhaustive-deps
  const tek = g.anahtarlar.length === 1;
  return (
    <div
      className="tost" data-tur="geri-al" role="status" data-geri-al={g.anahtarlar.join(' ')} data-durakli={g.durakli ? '' : undefined}
      onMouseEnter={() => { ustunde.current = true; istek(); }}
      // Pencere odağı gidip gelince ana süreç süreyi sürdürmüş olabilir: imleç hâlâ üstündeyse yeniden durdurulur.
      onMouseMove={() => { if (!g.durakli && Date.now() - son.current > 400) istek(); }}
      onMouseLeave={() => { ustunde.current = false; istek(); }}
      onFocus={() => { odakta.current = true; istek(); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { odakta.current = false; istek(); } }}
    >
      <span className="tost__simge" data-tur="geri-al"><Ikon ad="cop" olcu={16} /></span>
      <div className="tost__icerik" title={g.etiket}><span className="tost__metin">{g.etiket}</span></div>
      <Fazla n={fazla} />
      <button
        type="button" className="dgm dgm--koyu dgm--k" aria-keyshortcuts="Control+Z"
        title={tek ? 'Geri al (Ctrl+Z)' : 'Hepsini geri al · Ctrl+Z sonuncusunu geri alır'}
        onClick={() => silmeler.geriAl(g.anahtarlar)}
      >Geri al</button>
      <i key={g.bitis} className="geri-al__sure" aria-hidden="true" style={{ animationDuration: `${kalan}ms`, '--baslangic': (kalan / GERI_AL_MS).toFixed(3) } as React.CSSProperties} />
    </div>
  );
}

function MesajTostu({ t, fazla }: { t: Tost; fazla: number }) {
  const ustunde = useRef(false);
  const odakta = useRef(false);
  const durdur = () => tostDuraklat(t.id, ustunde.current || odakta.current);
  const tam = [t.baslik, t.metin].filter(Boolean).join(' — ');
  const uyari = t.tur === 'hatirlatma' || t.tur === 'onay' || t.tur === 'hata';
  return (
    <div
      className="tost" data-tur={t.tur} role={uyari ? 'alert' : 'status'}
      onMouseEnter={() => { ustunde.current = true; durdur(); }} onMouseLeave={() => { ustunde.current = false; durdur(); }}
      onFocus={() => { odakta.current = true; durdur(); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { odakta.current = false; durdur(); } }}
    >
      <span className="tost__simge" data-tur={t.tur}><Ikon ad={SIMGE[t.tur]} olcu={16} /></span>
      <div className="tost__icerik" title={tam}>
        {t.baslik && <b className="tost__baslik">{t.baslik}</b>}
        {t.metin && <span className="tost__metin">{t.metin}</span>}
      </div>
      <Fazla n={fazla} />
      {/* Görev 28: yolu olan mesaj (Claude Code izin/bitti) — "Aç" o sayfaya/oturuma götürür. */}
      {t.yol && t.tur !== 'onay' && (
        <button type="button" className="dgm dgm--koyu dgm--k" data-tost-ac="" onClick={() => { void cagir('ana:goster', t.yol); tostKaldir(t.id); }}>Aç</button>
      )}
      {t.tur === 'onay' && t.sohbetId != null && (
        <button type="button" className="dgm dgm--beyaz dgm--k" onClick={() => { void cagir('ana:goster', `sohbetler/${t.sohbetId}`); tostKaldir(t.id); }}>Yanıtla</button>
      )}
      <button type="button" className="tost__kapat" aria-label="Kapat" title="Kapat" onClick={() => tostKaldir(t.id)}><Ikon ad="kapat" olcu={14} /></button>
    </div>
  );
}
