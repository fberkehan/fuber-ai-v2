// Model kartı (fintech; 0.12 H3c): bu bilgisayarda çalışacak yapay zekânın sürümü — ad, boyut (GB) · tahmini indirme süresi, tek satır ve bu
// bilgisayara uygunluk (küçük durum noktası; renk yalnız noktada). Uyan en iyisi "Önerilen" rozetini taşır; uymayan SOLUK ve SEÇİLEMEZ
// (aria-disabled; nedeni title'da ve grubun altındaki satırda — NeredeSecimi). Seçilince seçim kartıyla aynı dil: kıl payı halka + iç parıltı +
// onay dairesi; basınca 0,98. İniyorsa altta ince ilerleme çizgisi. ModelKartlari radyo grubudur (←/→; uymayan atlanır). Veri saf katalogdan
// (shared/yerel-katalog.ts KatalogKarti) — bu dosya masaüstüne bağlı değil (IPC yok).
import type { CSSProperties } from 'react';
import { Ikon } from '../../bilesenler/Ikon';
import { radyoTusu } from './radyo';

export interface ModelKartiVerisi<T extends string = string> {
  ad: T;
  baslik: string;
  aciklama: string;
  boyutMetni: string;
  sureMetni: string;
  kurulu: boolean;
  uygun: boolean;
  hiz: 'hizli' | 'rahat' | 'yavas' | null;
  uygunlukMetni: string;
  neden: string | null;
  onerilen: boolean;
  ayrinti?: string;
  /** Yalnız Developer: Hugging Face'teki dosya adı. */
  dosya?: string;
}

const KISA = { hizli: 'Ekran kartında hızlı', rahat: 'Rahat çalışır', yavas: 'Yavaş çalışır' } as const;
/** Kartın kısa uygunluk satırı (uzun cümle grubun altında). */
export function modelKisaDurumu(m: Pick<ModelKartiVerisi, 'uygun' | 'kurulu' | 'hiz' | 'neden' | 'uygunlukMetni'>): string {
  // Uymayan kartın satırı "Uymuyor"; ölçülmemişse "Ölçülemedi" / "Bakılıyor…" (katalog yazar; uzun neden grubun altında).
  if (!m.uygun) return m.uygunlukMetni;
  if (m.kurulu) return 'Kurulu';
  return m.hiz ? KISA[m.hiz] : m.uygunlukMetni;
}
const nokta = (m: ModelKartiVerisi) => (!m.uygun ? '' : m.hiz === 'yavas' ? ' ft-nokta--kehribar' : ' ft-nokta--yesil');

export function ModelKarti<T extends string>({ m, secili, sec, odak, ilerleme }: {
  m: ModelKartiVerisi<T>; secili: boolean; sec: (ad: T) => void; odak: boolean;
  /** İniyorsa yüzde (0–100); değilse null. */
  ilerleme?: number | null;
}) {
  const baslik = [m.baslik, m.boyutMetni, m.uygun ? m.uygunlukMetni : m.neden ?? m.uygunlukMetni, m.ayrinti, m.dosya].filter(Boolean).join(' · ');
  return (
    <button
      type="button" role="radio" className="ft-model" data-model={m.ad} data-uygun={m.uygun ? '' : undefined} data-onerilen={m.onerilen ? '' : undefined}
      aria-checked={secili} aria-disabled={!m.uygun || undefined} tabIndex={odak ? 0 : -1} title={baslik}
      onClick={() => { if (m.uygun) sec(m.ad); }}
    >
      <span className="ft-model__ust">
        <span className="ft-model__ad">{m.baslik}</span>
        <span className="ft-model__isaret" aria-hidden="true">{m.uygun ? <Ikon ad="tamam" olcu={11} kalinlik={2.8} /> : <Ikon ad="kilit" olcu={11} />}</span>
      </span>
      <span className="ft-model__boyut ft-sayi">{m.boyutMetni}<span aria-hidden="true"> · </span>{m.sureMetni}</span>
      <span className="ft-model__aciklama">{m.aciklama}</span>
      {m.dosya && <span className="ft-model__dosya" data-model-dosya="">{m.dosya}</span>}
      <span className="ft-model__durum" data-model-durum="">
        {m.onerilen ? <span className="ft-rozet">Önerilen</span> : <><i className={`ft-nokta${nokta(m)}`} aria-hidden="true" />{modelKisaDurumu(m)}</>}
      </span>
      {typeof ilerleme === 'number' && (
        <span className="ft-model__cubuk" role="progressbar" aria-label={`${m.baslik} iniyor`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ilerleme}>
          <i style={{ '--ft-oran': ilerleme / 100 } as CSSProperties} />
        </span>
      )}
    </button>
  );
}

export function ModelKartlari<T extends string>({ etiket, kartlar, deger, sec, ilerleme }: {
  etiket: string; kartlar: readonly ModelKartiVerisi<T>[]; deger: T | null; sec: (ad: T) => void;
  /** İnen kart ve yüzdesi. */
  ilerleme?: { ad: T; yuzde: number } | null;
}) {
  const acik = kartlar.filter((k) => k.uygun).map((k) => k.ad);
  const odakta = deger && acik.includes(deger) ? deger : acik[0] ?? null;
  return (
    // 0.13 G: katalogun boyu değişkendir: en çok üç sütun, üç karttan sonra kutu içinde kaydırılır (kurulumun pencereye sığan düzeni bozulmaz).
    <div className="ft-modeller" role="radiogroup" aria-label={etiket} data-kaydirma={kartlar.length > 3 ? '' : undefined} style={{ '--n': Math.min(kartlar.length, 3) } as CSSProperties} onKeyDown={(e) => radyoTusu(e, acik, deger, sec)}>
      {kartlar.map((m) => <ModelKarti key={m.ad} m={m} secili={m.ad === deger} sec={sec} odak={m.ad === odakta} ilerleme={ilerleme?.ad === m.ad ? ilerleme.yuzde : null} />)}
    </div>
  );
}
