// ── "Nerede çalışsın?" — ortak bileşen (0.12 H3c; spec §1 adım 5, Hedefler §5) ──────────────────────────────────────────────────────────
// Kurulumun Nerede adımı (kurulum2/NeredeAdimi.tsx; seçim taslakta, adımdan ileri çıkarken uygulanır) ve Ayarlar → Gizlilik (TEK yer; seçim
// anında kaydedilir) AYNI bileşeni çizer: üç büyük seçenek — Fuber (önerilen) · Yalnız bu bilgisayar · Gizli — ve Yalnız bu bilgisayar /
// Gizli seçiliyken açılan model kartları (ui/fintech ModelKarti; veri shared/yerel-katalog.ts). Fuber seçiliyken model kartları görünmez.
// Kurallar shared/nerede.ts'te; bu bileşen yalnız çizer (IPC yalnız useYerelKatalog'da: sistem:kontrol + yerel:durum).
// Bilgisayar ölçülmediyse ("bakıyorum" / "bakamadım") hiçbir sürüm önerilmez ve seçilemez; ölçüldü ve hiçbiri uymuyorsa Yalnız bu bilgisayar ve
// Gizli kapalıdır ve nedeni yazar. Düzeltme turu 1 (Ö3): o an GERÇEKTEN seçili olan seçenek asla kapalı çizilmez (Ayarlar gerçek hâli gösterir;
// yalnız ona geçiş kapanır); inen sürüm diske yeniden ölçülmez (yerel-katalog.ts `inen`). Ö4: inerken tek ilerleme (kart + satır) ve
// "İndirmeyi durdur" satırın yanında (`durdur`).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cagir } from '../api';
import { useYerelDurum, type YerelDurum } from './YerelKurulum';
import { ModelKartlari, SecimGrubu, type SecimSecenegi } from '../ui/fintech';
import { NEREDE_SECENEKLERI, neredeAciklamasi, type Nerede } from '../../shared/nerede';
import './nerede-secimi.css';
import { KATALOG_BOS, SURE_NOTU, yerelKatalog, type YerelKatalog } from '../../shared/yerel-katalog';
import type { SistemBilgisi } from '../../shared/sistem-kontrol';
import type { Mod, YerelModelAdi } from '../../shared/tipler';

/** Bilgisayarın ölçümü en çok bu kadar beklenir; sonra "bakamadım" (kurulum "Devam"ı bekletmez). */
export const OLCUM_SURESI_MS = 10_000;

/** Bilgisayarın bilgisi (`sistem:kontrol`, bir kez; `etkin` ilk kez doğru olunca). 10 sn'de yanıt yoksa 'hata'. */
function useSistemBilgisi(etkin: boolean): SistemBilgisi | null | 'hata' {
  const [b, setB] = useState<SistemBilgisi | null | 'hata'>(null);
  const istendi = useRef(false);
  useEffect(() => {
    if (!etkin || istendi.current) return;
    istendi.current = true;
    const z = setTimeout(() => setB((x) => x ?? 'hata'), OLCUM_SURESI_MS);
    void cagir<SistemBilgisi>('sistem:kontrol').then((x) => { clearTimeout(z); setB(x); }, () => { clearTimeout(z); setB('hata'); });
  }, [etkin]);
  return b;
}

/** `etkin` ilk kez doğru olduktan `ms` sonra true (bir kez). */
function useSureDoldu(etkin: boolean, ms: number): boolean {
  const [doldu, setDoldu] = useState(false);
  const zaman = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (etkin && !zaman.current) zaman.current = setTimeout(() => setDoldu(true), ms); }, [etkin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (zaman.current) clearTimeout(zaman.current); }, []);
  return doldu;
}

export type Olcum = 'bekliyor' | 'hazir' | 'bakamadim';
export interface KatalogDurumu {
  /** Kartlar (yerel durum gelmeden null). */
  katalog: YerelKatalog | null;
  /** Ölçüm: bekliyor (en çok ~10 sn) · hazir · bakamadim (okunamadı ya da yanıt yok). */
  olcum: Olcum;
  d: YerelDurum | null;
  /** Ölçülen boş disk (GB; ölçülemediyse yok) — onay cümlesi için. */
  bosDiskGB?: number;
}

/** Katalog: GERÇEK donanım (sistem:kontrol) + yerel durum (yerel:durum: paket listesi, kurulu olanlar). `istek`: ölçümü başlat; `bekle`: sabır
 *  süresini başlat (kurulumda Nerede adımına gelince). */
export function useYerelKatalog(o: { istek: boolean; bekle: boolean; sade: boolean; islemciZorla: boolean }): KatalogDurumu {
  const sistem = useSistemBilgisi(o.istek);
  const d = useYerelDurum();
  const sureDoldu = useSureDoldu(o.bekle, OLCUM_SURESI_MS);
  const donanim = sistem === 'hata' || (sureDoldu && sistem === null) ? 'hata' as const : sistem;
  const katalog = d ? yerelKatalog({
    donanim: donanim && donanim !== 'hata' ? { ramGB: donanim.ramGB, nvidia: donanim.nvidia, ...(donanim.vramGB !== undefined ? { vramGB: donanim.vramGB } : {}), bosDiskGB: donanim.bosDiskGB } : donanim,
    modeller: d.modeller, calistiriciKurulu: d.kurulu.calistirici, cuda: d.cuda, islemciZorla: o.islemciZorla, sade: o.sade, inen: d.inen ?? null,
  }) : null;
  const olcum: Olcum = katalog && katalog.durum === 'olculdu' ? 'hazir' : donanim === 'hata' || (sureDoldu && !d) ? 'bakamadim' : 'bekliyor';
  const bosDiskGB = sistem && sistem !== 'hata' && Number.isFinite(sistem.bosDiskGB) ? sistem.bosDiskGB : undefined;
  return { katalog, olcum, d, ...(bosDiskGB !== undefined ? { bosDiskGB } : {}) };
}

/** İnen sürüm ve yüzdesi (yerel:durum). */
export function inenModel(d: YerelDurum | null): { ad: YerelModelAdi; yuzde: number } | null {
  return d?.inen && d.indirme && !d.indirme.hata && d.indirme.yuzde < 100 ? { ad: d.inen, yuzde: d.indirme.yuzde } : null;
}

export function NeredeSecimi({ deger, sec, mod, onerilen, yerelKapali, kd, model, modelSec, bakamadimMetni, inisNotu, fuberNotu, ek, durdur, bakiyorumMetni = 'Bilgisayarına bakıyorum…' }: {
  deger: Nerede; sec: (n: Nerede) => void; mod: Mod;
  /** "Önerilen" rozetini taşıyan seçenek (normalde Fuber; hesapsız geçişte Yalnız bu bilgisayar). */
  onerilen: Nerede;
  /** Ölçüldü ve hiçbir sürüm uymuyor: Yalnız bu bilgisayar ve Gizli kapalı, nedeni (yoksa null). */
  yerelKapali: string | null;
  kd: KatalogDurumu;
  /** Seçili sürüm (Yalnız bu bilgisayar / Gizli); null: seçilecek bir şey yok. */
  model: YerelModelAdi | null;
  modelSec: (m: YerelModelAdi) => void;
  bakamadimMetni: string;
  /** Seçili sürüm kurulu değilken "arka planda iner (≈ N dk); …" cümlesinin sonu (ör. "hazır olana dek sohbet bekler; yanıtlar buluta gitmez."); yoksa süre notu. */
  inisNotu?: string;
  /** Fuber seçiliyken kartların yerindeki sakin not. */
  fuberNotu?: ReactNode;
  /** Model kartlarının altına (Ayarlar: indirme onayı, ileti). */
  ek?: ReactNode;
  /** Ö4: seçili sürüm inerken satırın yanında (Ayarlar: "İndirmeyi durdur"). */
  durdur?: ReactNode;
  /** Bilgisayar ölçülürken satır (kurulum resmî hitapta "Bilgisayarınıza bakıyorum…"). */
  bakiyorumMetni?: string;
}) {
  const kucuk = (yerelKapali ?? '').replace(/^./, (c) => c.toLocaleLowerCase('tr-TR')).replace(/\.$/, '');
  // Kapalı seçenek önerilmez: bu bilgisayar yetmiyorsa "Önerilen" Fuber'e döner.
  const oneri: Nerede = yerelKapali ? 'fuber' : onerilen;
  const secenekler: SecimSecenegi<Nerede>[] = NEREDE_SECENEKLERI.map((s) => ({
    deger: s.deger, baslik: s.baslik, simge: s.simge, onerilen: s.deger === oneri, etiket: `${s.baslik}${s.deger === oneri ? ' (önerilen)' : ''}`,
    // Ö3: gerçekten seçili olan (Ayarlar: kayıtlı hâl) kapalı çizilmez — yalnız ona GEÇİŞ kapanır.
    kapali: s.deger !== 'fuber' && s.deger !== deger && Boolean(yerelKapali),
    aciklama: s.deger !== 'fuber' && s.deger !== deger && yerelKapali ? `Bu bilgisayarda kullanılamıyor: ${kucuk}.` : neredeAciklamasi(s.deger, mod),
  }));
  const { katalog, olcum } = kd;
  const inen = inenModel(kd.d);
  const kartlar = katalog?.kartlar ?? [];
  const secili = kartlar.find((k) => k.ad === model) ?? null;
  const uymayan = kartlar.find((k) => !k.uygun && k.neden && olcum === 'hazir') ?? null;
  const yavas = secili?.hiz === 'yavas' ? `${secili.baslik}: ${secili.uygunlukMetni}.` : null;
  const seciliSatir = !secili ? null
    : inen?.ad === secili.ad ? `${secili.baslik} iniyor · %${inen.yuzde}; arka planda sürer.`
    : secili.listedenKalkti ? `${secili.baslik} listeden kalktı; bu bilgisayarda kurulu kaldı, çalışmaya devam eder.`
    : secili.eskiSurum ? `${secili.baslik}: bu bilgisayarda eski dosya var, yenisi çıktı. Yeniden indirene dek eskisi çalışır.`
    : secili.kurulu ? `${secili.baslik} bu bilgisayarda kurulu; hemen çalışır.`
    : inisNotu ? `${secili.baslik} arka planda iner (${secili.sureMetni}); ${inisNotu}`
    : SURE_NOTU;
  return (
    <div className="ns" data-nerede-secimi={deger}>
      <SecimGrubu etiket="Nerede çalışsın" deger={deger} sec={sec} secenekler={secenekler} />
      {deger === 'fuber' ? (fuberNotu ?? null) : (
        <div className="ns-modeller" data-nerede-modeller={olcum} key="modeller">
          <span className="ft-etiket">{mod === 'gelistirici' ? 'Yerel model · bu bilgisayara göre' : 'Sürüm · bu bilgisayara göre'}</span>
          {kartlar.length > 0 && <ModelKartlari etiket={mod === 'gelistirici' ? 'Yerel model' : 'Sürüm'} kartlar={kartlar} deger={model} sec={modelSec} ilerleme={inen} />}
          <div className="ns-modeller__satirlar" role="status">
            {olcum === 'bekliyor' && <p className="ns-satir" data-bakiyor=""><span className="ft-donen ns-donen" aria-hidden="true" />{bakiyorumMetni}</p>}
            {olcum === 'bakamadim' && <p className="ns-satir" data-bakamadim="">{bakamadimMetni}</p>}
            {katalog?.bos && <p className="ns-satir" data-katalog-bos="">{KATALOG_BOS}</p>}
            {uymayan && <p className="ns-satir" data-model-neden={uymayan.ad}><b>{uymayan.baslik} uymuyor:</b> {uymayan.neden}</p>}
            {olcum !== 'bekliyor' && yavas && <p className="ns-satir" data-model-yavas="">{yavas}</p>}
            {olcum !== 'bekliyor' && seciliSatir && (inen?.ad === secili?.ad && durdur ? (
              // Ö4: inerken satır ve "İndirmeyi durdur" yan yana (dar sütunda alta iner); ilerlemenin tek göstergesi kartın çizgisi + bu satır.
              <div className="ns-satir ns-satir--eylem" data-model-secili={secili?.ad} data-iniyor=""><span>{seciliSatir}</span>{durdur}</div>
            ) : (
              <p className="ns-satir" data-model-secili={secili?.ad} data-iniyor={inen?.ad === secili?.ad ? '' : undefined}>{seciliSatir}</p>
            ))}
          </div>
          {ek}
        </div>
      )}
    </div>
  );
}
