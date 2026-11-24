// Kurulum v2 › Nerede çalışsın (0.12 H3c; spec §1 adım 5, Hedefler §5): Fuber (önerilen) · Yalnız bu bilgisayar · Gizli. Yalnız bu bilgisayar
// ve Gizli seçilince model kartları açılır (renderer/bilesenler/NeredeSecimi.tsx — Ayarlar → Gizlilik ile AYNI bileşen): bilgisayara uyan
// en iyisi "Önerilen" ve seçili, uymayan soluk ve nedeniyle, her kartta boyut ve indirme süresi. İndirme "Devam"da ARKA PLANDA başlar
// (kurulum2/yerel-karar.ts uygula). Seçim taslakta (açık seçim; ön seçim Y1 kuralıyla: Kurulum2.tsx neredeOnSecimi); bu adım yalnız çizer.
// Sağda canlı önizleme: bu bilgisayar ↔ Fuber bağlantısı (Yalnız bu bilgisayar'da yanıtlar burada, hesap ve eşitleme sürer; Gizli'de kesik ve
// kilitli), örnek yanıtın kaynağı ve seçili sürümün kartı (boyut, süre, uygunluk; inerken ilerleme).
import { Ikon } from '../bilesenler/Ikon';
import { NeredeSecimi, inenModel } from '../bilesenler/NeredeSecimi';
import { Nesne, Tepsi } from '../ui/fintech';
import { gizliKapsami } from '../../shared/kurulum-yerel';
import { buyukBasla, yerelAdi } from '../../shared/terimler';
import { SURE_NOTU } from '../../shared/yerel-katalog';
import { KM } from '../../shared/kurulum-metin';
import { GIZLI_YANIT_KAYNAGI } from '../../shared/gizlilik-metni';
import type { Nerede } from '../../shared/nerede';
import { useAdim } from './baglam';
import { Bas, Not, kademe } from './Ortak';

/** Ekranda gösterilen seçim: bilgisayar ölçüldü ve hiçbir sürüm uymuyorsa yerel seçenekler kapalıdır → Fuber. */
export const gosterilenNerede = (n: Nerede, uygunDegil: string | null): Nerede => (uygunDegil && n !== 'fuber' ? 'fuber' : n);

export function NeredeAdimi() {
  const { taslak: t, degistir, yerel: y, ayar, nerede, m } = useAdim();
  const deger = gosterilenNerede(nerede, y.uygunDegil);
  const model = y.model(t.model);
  // Düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" da buluta gitmez — iki seçimde de hazır olana dek sohbet bekler.
  const inisNotu = m(deger === 'gizli' ? KM.inisGizli : KM.inisYerel);
  return (
    <div className="k2-adim k2-nerede" data-nerede="">
      <Bas baslik="Nerede çalışayım?" giris={m(KM.neredeGiris)} />
      <div {...kademe(2)}>
        <NeredeSecimi
          deger={deger} sec={(n) => degistir({ nerede: n })} mod={ayar.mod} onerilen={t.akis.hesapsiz ? 'yerel' : 'fuber'} yerelKapali={y.uygunDegil}
          kd={y.kd} model={model} modelSec={(m) => degistir({ model: m })} inisNotu={inisNotu}
          bakamadimMetni={m(KM.bakamadim(deger === 'gizli' ? ' Gizli modu açmıyorum.' : t.akis.hesapsiz ? '' : ' Şimdilik Fuber’le sürdürürüm.'))} bakiyorumMetni={m(KM.bilgisayaraBakiyorum)}
          fuberNotu={<Not simge="kilit" data-fuber-notu="">{m(KM.neredeFuber)}</Not>}
        />
      </div>
    </div>
  );
}

export function NeredeOnizleme() {
  const { taslak: t, yerel: y, ayar, nerede, m } = useAdim();
  const n = gosterilenNerede(nerede, y.uygunDegil);
  const gizli = n === 'gizli', yerel = n === 'yerel';
  const kart = n === 'fuber' ? null : y.kd.katalog?.kartlar.find((k) => k.ad === y.model(t.model)) ?? null;
  const inen = inenModel(y.kd.d);
  const iniyor = kart && inen?.ad === kart.ad ? inen.yuzde : null;
  const bakamadim = y.kd.olcum === 'bakamadim';
  // 0.13.1: Fuber'de dip yok — "hafızan bu bilgisayarda" güvencesi adımda yalnız bir kez (NEREDE_FUBER_CUMLESI) söylenir.
  const dip = gizli ? gizliKapsami(ayar.mod).dip.split('; ')[0] + '.' : yerel ? SURE_NOTU : undefined;
  return (
    <Tepsi etiket="Nerede çalışsın önizlemesi" dip={dip} className="k2-nerede-tepsi">
      <Nesne className="k2-akis" data-onizleme-nerede={n}>
        <div className="k2-akis__dugumler">
          <span className="k2-akis__dugum"><span className="k2-akis__simge"><Ikon ad="ekran" olcu={22} /></span><b>Bu bilgisayar</b><span>{n === 'fuber' ? 'Hafıza · sohbetler' : 'Yanıtlar · hafıza'}</span></span>
          <span className={`k2-akis__hat${gizli ? ' k2-akis__hat--kesik' : ''}${yerel ? ' k2-akis__hat--ince' : ''}`} aria-hidden="true">{gizli && <span className="k2-akis__kilit"><Ikon ad="kilit" olcu={14} /></span>}</span>
          <span className={`k2-akis__dugum${n !== 'fuber' ? ' k2-akis__dugum--soluk' : ''}`}><span className="k2-akis__simge"><Ikon ad="kure" olcu={22} /></span><b>Fuber</b><span>{gizli ? 'Kullanılmıyor' : yerel ? 'Hesap · eşitleme' : 'Yanıtlar'}</span></span>
        </div>
      </Nesne>
      {/* Örnek soru ve yanıtın KAYNAĞI: Fuber'de yanıt Fuber'den gelir; Yalnız bu bilgisayar ve Gizli'de bu bilgisayarda üretilir. */}
      <Nesne className="k2-soru" data-onizleme-soru={n}>
        <span className="k2-soru__sen">{m(KM.neredeSoru)}</span>
        <span className="k2-soru__yanit">{m(KM.neredeYanit)}</span>
        <span className="k2-soru__kaynak"><Ikon ad={gizli ? 'kilit' : n === 'fuber' ? 'kure' : 'ekran'} olcu={14} />{gizli ? GIZLI_YANIT_KAYNAGI : yerel ? 'Yanıt bu bilgisayarda üretildi' : 'Yanıt Fuber’den geldi'}</span>
      </Nesne>
      {/* 0.13.1: Fuber'de üçüncü kart yok — "Fuber" ve "Bulutta" aynı şeye iki addı; Fuber düğümü ve soru kartı zaten söyler. Sürüm kartı yalnız
          bu bilgisayarda çalışan seçeneklerde (boyut, süre, indirme). */}
      {n !== 'fuber' && (
        <Nesne className="k2-model" data-onizleme-model={kart?.ad ?? 'bilgisayar'}>
          <span className="k2-model__simge" aria-hidden="true"><Ikon ad="isik" olcu={20} /></span>
          <span className="k2-model__yazi">
            <b>{kart ? kart.baslik : buyukBasla(yerelAdi(ayar.mod !== 'gelistirici'))}</b>
            <span className="ft-sayi">{kart ? `${kart.boyutMetni} · ${kart.sureMetni}` : (bakamadim ? 'Bu bilgisayar ölçülemedi' : m(KM.bilgisayaraBakiyorum))}</span>
            {kart && <span className="k2-model__uygun"><i className={`ft-nokta${kart.hiz === 'yavas' ? ' ft-nokta--kehribar' : ' ft-nokta--yesil'}`} aria-hidden="true" />{kart.uygunlukMetni}</span>}
          </span>
          <span className="ft-rozet" data-model-durum="">{!kart ? (bakamadim ? 'Bakılamadı' : 'Bakılıyor…') : kart.kurulu ? 'Kurulu' : iniyor !== null ? `İniyor · %${iniyor}` : 'Devam’da iner'}</span>
          {iniyor !== null && <span className="k2-model__cubuk" aria-hidden="true"><i style={{ transform: `scaleX(${iniyor / 100})` }} /></span>}
        </Nesne>
      )}
    </Tepsi>
  );
}
