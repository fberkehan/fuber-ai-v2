// Ayarlar → Gizlilik: bu bilgisayarda çalışan dil modeli (llama.cpp + Bonsai; İş'te "bu bilgisayardaki yapay zekâ", Geliştirici'de
// "yerel model" — 0.10 Görev 3, shared/terimler.ts) ve yerel ses (Piper).
// Sistemde yerel bir model kurulur: sınıflandırma, espri ve gündelik sohbetler yerelde; yalnız önemli
// ve kodlama işleri Claude'da. Kur (indir + doğrula), aç/kapa, görev seçimi, seslenme algılama ve "Dene"
// (düşünme + ses süresi). Değişiklikler anında kaydedilir. İş modunda (K2) teknik ayrıntılar (model kartları, görev dağılımı,
// işlemci, hızlı ses) görünmez: kur/aç-kapa, durum, seslenme ve deneme kalır (Bonsai 27B önerilen varsayılan).
// Model kartlarında (Görev 13) disk, bellek ve ekran kartı gereksinimi, bu bilgisayara uygunluk ("Rahat çalışır / Zorlanır /
// Çalışmaz", shared/model-bilgisi.ts → yerelUygunluk; ekran kartı yalnız kullanılabiliyorsa sayılır: yerelMakinesi) ve kurulum
// durumu ("Kurulu" / "İndirilmesi gerekir"); "önerilen" bu bilgisayarda rahat çalışan en büyük model (hiçbiri uymuyorsa yok).
// Model seçimi çalışan yerel beyni SESSİZCE DURDURMAZ (Karar I): kurulu karta basınca geçilir; kurulu olmayan karta basınca — yerel
// beyin kuruluysa — önce o model iner, şimdiki model çalışmaya devam eder, geçiş doğrulanmış kurulumdan sonra (ipc.ts yerel:kur).
// Henüz hiçbir şey kurulu değilse kart "Kur" düğmesinin hangi modeli kuracağını seçer. İndirme güvenliği (düzeltme 2) ve kartlar
// kurulum sihirbazıyla ortak: bilesenler/YerelKurulum.tsx ("Çalışmaz" reddi, 1 GB üstü onay, durdurma, hata iletisi).
// "Kaldır" (Görev 20b, K2): indirme onayıyla aynı kalıpta boyutlu onay; ana süreç süren indirmeyi durdurup bekler, süreçleri kapatır,
// sonra siler (EBUSY'siz).
// Görev 21 (K10): yerel beyin yanıt yolunda "ön eleme" yapmaz; yalnız Gizli modda (bulutsuz) tek motordur — "Gizli mod" anahtarı burada.
// "Yerelde yapılacak işler" ve "Hızlı yanıtın sesi" kalktı (tek motor, tek ses). Yerel beyni kaldırmak yedek sesi götürmez.
// 0.12 H3c (spec Hedefler §5): "Nerede çalışsın" TEK yerde, burada — Fuber (önerilen) · Yalnız bu bilgisayar · Gizli; kurulumun Nerede adımıyla
// AYNI bileşen (bilesenler/NeredeSecimi.tsx). Eski "Gizli mod" anahtarı ve Yapay zekâ'daki "Yalnız bu bilgisayardaki yapay zekâ" anahtarı bu
// tek seçime katıldı (satırın kimliği çapalar için 'gizli-mod' kaldı). Seçim anında kaydedilir; kurulu olmayan sürüm seçilirse önce boyut ve boş
// diskle onay, sonra ARKA PLANDA iner (bitince yerel açılır; Gizli seçildiyse Gizli hazır olana dek sohbet bekler — F1 kuralları AYNEN).
// Geliştirici'nin ayrıntılı model listesi (disk, bellek, ekran kartı) yalnız Fuber seçiliyken görünür: seçim açıkken sürümü kartlar seçer
// (iki seçici yan yana olmaz).
import { useEffect, useRef, useState } from 'react';
import { NeredeSecimi, inenModel, useYerelKatalog } from '../bilesenler/NeredeSecimi';
import { HapDugme } from '../ui/fintech';
import { neredeHali, neredeYamasi, neredeYerelMi, type Nerede } from '../../shared/nerede';
import { YEREL_OZET_NOTU } from '../../shared/ic-talimat';
import { katalogSecimi } from '../../shared/yerel-katalog';
import { yalnizYerelAnahtari } from '../../shared/tek-motor';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../bilesenler/Ortak';
import { IndirmeDurumu, IndirmeOnayKutusu, YerelBekleyenBildirim, YerelModelKarti, gb, useYerelDurum, useYerelKurulum, yerelKurulu, type YerelModel } from '../bilesenler/YerelKurulum';
import { gbMetni } from '../../shared/model-bilgisi';
import { bulutMotorSayisi } from '../../shared/abonelik';
import type { YerelAyari, YerelModelAdi } from '../../shared/tipler';
import { ILK_KURULUM_PAYI, yerelKaldirmaBoyutu, kaldirmaHataMetni } from '../../shared/yerel-boyut';
import { useAyarlar, type IcerikHaritasi } from './baglam';
import { fuberSoyle, type FuberKonusmasi } from '../fuber-sesi';
import { AyarBolgesi, Satir, useAyarTanimi } from './Ortak';
import { TERIM, buyukBasla, yerelAdi } from '../../shared/terimler';
import { gizliAnahtari } from '../../shared/kurulum-yerel';
import { GM } from '../../shared/gizlilik-metni';
import { sec as hitapSec } from '../../shared/kurulum-metin';
import { useMotorSinyali } from '../motor-sinyali';

/** Takip turu: "Bu bilgisayardaki yapay zekâ" anahtarı Nerede yerelken ve kurulu değilken devre dışı — kurulum tek yerde. */
const YEREL_ANAHTAR_NEDENI = ' Sürümü yukarıdaki “Nerede çalışsın”dan kurarsın.';

function useYerelKaydet() {
  const { a, kaydet } = useAyarlar();
  const y = a.yerel;
  return { y, yk: (v: Partial<YerelAyari>) => kaydet({ yerel: { ...y, ...v } }) };
}

/** Ayarlar → Gizlilik → "Nerede çalışsın" (TEK yer; kurulumla aynı bileşen). */
function NeredeSatiri({ gizliNotu }: { gizliNotu: string }) {
  const { mod } = useAyarlar();
  const kapsam = useAyarTanimi('gizli-mod')?.aciklama ?? '';
  const { y, yk } = useYerelKaydet();
  const is = mod !== 'gelistirici';
  const kd = useYerelKatalog({ istek: true, bekle: true, sade: is, islemciZorla: y?.gpu === 'cpu' });
  const d = kd.d;
  const kurulu = yerelKurulu(d);
  const ad = (m: YerelModel) => (is ? kd.katalog?.kartlar.find((x) => x.ad === m.ad)?.baslik ?? buyukBasla(TERIM.yzYerel) : m.etiket);
  // Onay bekleyen seçim (kurulu olmayan sürüm: önce boyutlu onay): onaylanınca kaydedilir, vazgeçilince eski hâl.
  const [bekleyen, setBekleyen] = useState<{ nerede: Nerede; model: YerelModelAdi } | null>(null);
  const hal = neredeHali(y);
  const deger = bekleyen?.nerede ?? hal;
  // Düzeltme turu 1 (Kü7): onaylanan seçim (Gizli / Yalnız bu bilgisayar) ana süreçte istenen kurulumun kaydıyla AYNI yazımda kaydedilir
  // (yerel:kur `secim`; N-4) — arada "Gizli açık ama hazır değil" anı yok. Kayıtlı hâl seçime yetişince ya da istek reddedilince bekleyen düşer.
  const k = useYerelKurulum({
    y, ad, sade: is, ac: () => true, gizli: () => (bekleyen?.nerede ?? hal) === 'gizli',
    secim: () => { const n = bekleyen?.nerede ?? hal; return n === 'fuber' ? undefined : n; },
    sonuc: (r) => { if (!r.tamam) setBekleyen(null); },
  });
  useEffect(() => { if (bekleyen && !k.onay && hal === bekleyen.nerede) setBekleyen(null); }, [hal, bekleyen, k.onay]);
  if (!y) return null;
  const inen = inenModel(d);
  const kuruluModel = d?.modeller.find((m) => m.kurulu && m.ad === y.model) ? y.model : null;
  const model = bekleyen?.model ?? (deger !== 'fuber' && inen ? inen.ad : kd.katalog ? katalogSecimi(kd.katalog, kuruluModel) : null);
  const uygunDegil = kd.olcum === 'hazir' && kd.katalog && !kd.katalog.kartlar.some((x) => x.uygun) ? kd.katalog.neden : null;
  const modeli = (m: YerelModelAdi) => d?.modeller.find((x) => x.ad === m);
  // 0.13 G: seçili modelin kurulu dosyası kayıttan eski: "Yeniden indir" yenisini getirir (ana süreç indirme bitene dek eskisini çalıştırır).
  const eski = !inen && model && modeli(model)?.eskiSurum ? modeli(model) : undefined;
  const sec = (n: Nerede) => {
    k.setOnay(null); k.setMesaj(null); setBekleyen(null);
    if (n === 'fuber') {
      const yama = neredeYamasi('fuber', y, kurulu);
      if (yama) yk(yama);
      if (y.bekleyenKurulum?.gizliMod) void cagir('yerel:bekleyen-gizli', false).catch(() => undefined);
      return;
    }
    const m = kd.katalog ? katalogSecimi(kd.katalog, kuruluModel) : null;
    const mm = m ? modeli(m) : undefined;
    if (!m || !mm) { k.setMesaj(kd.olcum === 'bekliyor' ? 'Bilgisayarına bakıyorum; birazdan yeniden dene.' : 'Bu bilgisayar için uygun bir sürüm bulunamadı.'); return; }
    // Takip turu: model dosyası kurulu ama çalıştırıcı yoksa geçiş değil, onarım (yerel:kur eksik parçaları indirir).
    if (mm.kurulu && d?.kurulu.calistirici) { yk({ ...(neredeYamasi(n, y, true) ?? {}), model: m, etkin: true }); return; }
    if (inen?.ad === m) {
      const yama = neredeYamasi(n, y, kurulu);
      if (yama) yk(yama);
      if (y.bekleyenKurulum && Boolean(y.bekleyenKurulum.gizliMod) !== (n === 'gizli')) void cagir('yerel:bekleyen-gizli', n === 'gizli').catch(() => undefined);
      return;
    }
    setBekleyen({ nerede: n, model: m });
    k.indirmeIste(mm, Boolean(d?.kurulu.calistirici));
  };
  const modelSec = (m: YerelModelAdi) => {
    const mm = modeli(m);
    if (!mm || deger === 'fuber') return;
    k.setMesaj(null);
    if (mm.kurulu && d?.kurulu.calistirici) { setBekleyen(null); k.setOnay(null); yk({ model: m, ...(y.etkin ? {} : { etkin: true }) }); return; }
    if (bekleyen) setBekleyen({ ...bekleyen, model: m });
    k.indirmeIste(mm, Boolean(d?.kurulu.calistirici));
  };
  const hazir = Boolean(y.etkin && kurulu);
  const yalniz = yalnizYerelAnahtari({ yalnizYerel: hal === 'yerel', yerelHazir: d ? hazir : null, kurulu });
  // Ö4 (düzeltme turu 1): satırın notu DÜZ bir durum satırı ve yalnız bir şey söylediğinde — inerken ilerleme TEK yerde (sürüm kartı + satırı,
  // "İndirmeyi durdur" yanında); seçili ama hazır değil ve inmiyorsa sakin uyarı (tek-motor.ts YALNIZ_YEREL_UYARI: buluttaki yapay zekâ kapalı).
  const not = inen && !hazir ? '' : hal === 'gizli' ? gizliNotu.trim() : hal === 'yerel' ? (yalniz.not || yalniz.uyari) : '';
  // T34b (T32 N3): kurulumla aynı söz (shared/gizlilik-metni.ts GM; Ayarlar "sen" konuşur).
  const inisNotu = hitapSec(false, deger === 'gizli' ? GM.inisGizli : GM.inisYerel);
  return (
    <div className="ns-ayar" data-nerede-ayar={hal}>
      <NeredeSecimi
        deger={deger} sec={sec} mod={is ? 'is' : 'gelistirici'} onerilen="fuber" yerelKapali={kurulu ? null : uygunDegil}
        kd={kd} model={model} modelSec={modelSec} inisNotu={inisNotu}
        bakamadimMetni="Bu bilgisayara bakamadım; uygunluğu bilinmeden sürüm önerilmez. Ayarlar’ı yeniden açınca yeniden bakarım."
        durdur={<HapDugme tur="ikincil" boy="k" simge={<Ikon ad="kapat" olcu={13} />} onClick={() => void cagir('yerel:durdur').catch(() => undefined)} data-nerede-durdur="">İndirmeyi durdur</HapDugme>}
        ek={<>
          {eski && !k.onay && (
            <div className="ns-eylem">
              <HapDugme tur="ikincil" boy="k" simge={<Ikon ad="yenile" olcu={13} />} onClick={() => { k.setMesaj(null); k.indirmeIste(eski, true); }} data-yeniden-indir="">Yeniden indir</HapDugme>
            </div>
          )}
          {k.onay && (
            <IndirmeOnayKutusu
              onay={k.onay} ad={ad(k.onay.model)} bosDisk={k.bosDisk}
              ek={(bekleyen?.nerede ?? hal) === 'gizli' ? ' Bitince Gizli mod hazır olur; o zamana dek sohbet bekler.' : ` Bitince ${yerelAdi(is)} açılır.`}
              vazgec={() => { k.setOnay(null); setBekleyen(null); }} indir={() => void k.baslat(k.onay!.model, k.onay!.gecis)}
            />
          )}
          {k.mesaj && <p className="yb__mesaj" role="status" data-nerede-mesaj="">{k.mesaj}</p>}
        </>}
      />
      {not && <p className="ns-durum" role="note" data-yalniz-yerel-notu={hal === 'yerel' && yalniz.uyari ? 'uyari' : 'acik'} data-nerede-notu="">{not}</p>}
      {/* Ö4: üç seçeneğin farkı ve Gizli'nin bütün kapsamı açılırda (satırın açıklaması tek cümle). */}
      {/* Düzeltme turu 1 (I-2): yalnız/Gizli seçiliyken ayrıntıda araç isteyen özetlerin kapalı olduğu da söylenir (Kendiliğinden yazma'da da). */}
      {(kapsam || hal !== 'fuber') && (
        <details className="ns-ayrinti" data-nerede-ayrinti="">
          <summary>Ayrıntılar</summary>
          {kapsam && <p>{kapsam}</p>}
          {hal !== 'fuber' && <div className="ns-ayrinti__not" data-yerel-ozet-notu="">{YEREL_OZET_NOTU}</div>}
        </details>
      )}
    </div>
  );
}

function YerelGrubu() {
  const { mod } = useAyarlar();
  const { y, yk } = useYerelKaydet();
  const motor = useMotorSinyali();
  const is = mod !== 'gelistirici';
  const ad = (m: YerelModel) => (is ? buyukBasla(TERIM.yzYerel) : m.etiket);
  const yerel = yerelAdi(is);
  // İlk kurulum bitince yerel beyin açılır — ana süreç açar ve isteği kaydeder (yarıda kalırsa bildirim); geçişte açık/kapalı olduğu
  // gibi kalır.
  const k = useYerelKurulum({ y, ad, ac: (gecis) => !gecis, sade: is });
  const { d, onay, setOnay, mesaj, setMesaj, indirmeIste, kurulu, kuruluyor, onerilen } = k;
  // "Kaldır" onayı (Görev 20b, K2): indirme onayıyla aynı kalıp — boyut yazılır, Vazgeç / "Kaldır · N GB".
  const [kaldirOnay, setKaldirOnay] = useState(false);
  const [kaldiriyor, setKaldiriyor] = useState(false);
  const kaldirDugmesi = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (kaldirOnay) kaldirDugmesi.current?.focus({ preventScroll: true }); }, [kaldirOnay]);
  if (!y) return null;
  const calisiyor = Boolean(y.etkin && kurulu);
  // Düzeltme turu 2: Gizli / "Yalnız bu bilgisayar" seçiliyken sürüm ve kurulum TEK yerde — Nerede çalışsın'ın kartları (ikinci "Kur" yok).
  const neredeYerel = neredeYerelMi(y);
  const gizli = gizliAnahtari({ mod: is ? 'is' : 'gelistirici', gizliMod: Boolean(y.gizliMod), kurulu, etkin: y.etkin, hazirlaniyor: motor.gorunum === 'hazirlaniyor', yarim: Boolean(motor.motor.yarim) });
  const secili = d?.modeller.find((m) => m.ad === y.model);
  const modelSec = (m: YerelModel) => {
    // Kurulu → geç. Hiçbir şey kurulu değil → kart "Kur"un hangi modeli kuracağını seçer (çalışan beyin yok). Aksi → önce indir.
    if (m.kurulu || !d?.kurulu.calistirici) { setOnay(null); setMesaj(null); yk({ model: m.ad }); return; }
    indirmeIste(m, true);
  };
  const kur = () => { if (secili) indirmeIste(secili, false); };
  /** Onaydan sonra: süren indirme durdurulur ve beklenir, süreçler kapanır, dosyalar silinir (ana süreç; EBUSY'siz). */
  const kaldir = async () => {
    setKaldirOnay(false); setMesaj(null); setKaldiriyor(true);
    try { await cagir('yerel:kaldir'); } catch (e) { setMesaj(kaldirmaHataMetni((e as Error).message, is)); } finally { setKaldiriyor(false); }
  };
  const kaldirilacak = d ? yerelKaldirmaBoyutu(d) : 0;
  const durumMetni = !d ? 'Denetleniyor…' : !kurulu ? 'Kurulu değil' : !y.etkin ? 'Kapalı' : d.sunucu.calisiyor ? 'Çalışıyor' : d.sunucu.aciliyor ? 'Açılıyor…' : d.sunucu.hata ? 'Hata' : 'Hazır';
  const hal = !d || !kurulu ? 'yok' : d.sunucu.hata ? 'hata' : y.etkin && d.sunucu.calisiyor ? 'acik' : 'bekliyor';

  return (
    <>
      {/* Yarıda kalan / hata veren istenmiş kurulum (Görev 15): akışta; ilerleme bu sayfada zaten aşağıda (kokpitte kartın içinde). */}
      <YerelBekleyenBildirim iniyorGoster={false} />
      {/* 0.12 H3c: "Nerede çalışsın" — TEK yer (kurulumla aynı bileşen). Satırın kimliği 'gizli-mod' (motor bildirimlerinin çapası). F1 (Ö1):
          Gizli'nin gerçek hâli ve hazırlanırken Hazırsın'ın cümlesi satırın notunda (shared/kurulum-yerel.ts gizliAnahtari). */}
      {/* Ö4 (düzeltme turu 1): açıklama TEK cümle; üç seçeneğin farkı ve Gizli'nin kapsamı satırın "Ayrıntılar" açılırında. */}
      <Satir id="gizli-mod" dikey aciklama="Yanıtların nerede üretileceğini seç; hafızan her seçimde bu bilgisayarda saklanır.">
        <NeredeSatiri gizliNotu={gizli.not} />
      </Satir>
      {/* Takip turu: anahtar devre dışıyken (Nerede yerel, kurulu değil) nedeni kısa söylenir. */}
      <Satir id="yerel-beyin" ust ek={!kurulu && neredeYerel ? YEREL_ANAHTAR_NEDENI : undefined}>
        <span className="yb__ac">
          <span className={`hap yb__hal yb__hal--${hal}`}>{durumMetni}</span>
          {/* Düzeltme turu 2 (K1-a, P14): kapatmak "Yalnız bu bilgisayar"ı KAPATMAZ — kendiliğinden Fuber yok; kokpitte "hazır değil" kartı iki
              açık seçimi sunar. Gizli F1 gereği kapanır. Kurulu değilken Nerede yerelse anahtar kurulum başlatmaz (kurulum Nerede'nin kartlarında). */}
          <Anahtar acik={y.etkin && kurulu} etiket={buyukBasla(yerel)} devreDisi={!kurulu && neredeYerel} degistir={(v) => (kurulu ? yk({ etkin: v, ...(v ? {} : { gizliMod: false }) }) : kur())} />
        </span>
      </Satir>
      {/* Geliştirici'nin ayrıntılı model listesi yalnız Fuber seçiliyken (Nerede açıkken sürümü Nerede'nin kartları seçer). */}
      {!is && d && !y.gizliMod && !y.yalnizYerel && (
        <AyarBolgesi id="yerel-model" className="yb__modeller">
          {d.modeller.map((m) => (
            <YerelModelKarti
              key={m.ad} m={m} u={k.uygunluk(m)} onerilen={m.ad === onerilen} secili={y.model === m.ad} iniyor={d.inen === m.ad && kuruluyor} ilkKurulum={!d.kurulu.calistirici} indirilecek={k.indirilecek(m)} kilitli={kuruluyor}
              sec={() => modelSec(m)}
            />
          ))}
        </AyarBolgesi>
      )}
      {!is && d?.kurulu.calistirici && d.modeller.some((m) => !m.kurulu) && (
        <p className="t-kucuk yb__not">
          {calisiyor
            ? 'Kurulu olmayan bir modele basınca önce indirilir; şimdiki model indirme bitene dek çalışmaya devam eder, sonra yenisine geçilir.'
            : 'Kurulu olmayan bir modele basınca önce indirilir, sonra o modele geçilir.'}
        </p>
      )}
      {onay && (
        <IndirmeOnayKutusu
          onay={onay} ad={ad(onay.model)} bosDisk={k.bosDisk} ek={onay.gecis && calisiyor ? ' İndirme bitene dek şimdiki model çalışmaya devam eder.' : ''}
          vazgec={() => setOnay(null)} indir={() => void k.baslat(onay.model, onay.gecis)}
        />
      )}
      {kaldirOnay && d && (
        <div className="yb__onay ic-kutu" role="group" aria-label="Kaldırma onayı" data-kaldir-onay="">
          <div className="yb__onay-metin">
            <b>{buyukBasla(yerel)} kaldırılsın mı?</b>
            <span>
              Bu bilgisayardan yaklaşık {gbMetni(kaldirilacak / 1e9)} silinir{is ? '' : ' (modeller ve çalıştırıcı)'}. Fuber’in yedek sesi kalır.
              {kuruluyor ? ' Süren indirme önce durdurulur.' : ''}{y.gizliMod ? ' Gizli mod da kapanır.' : ''}
              {/* H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" kendiliğinden Fuber'e dönmez — bunu önceden söyler. */}
              {!y.gizliMod && y.yalnizYerel ? ' “Yalnız bu bilgisayar” seçili kalır: yeniden kurana ya da bulutu seçene dek yanıt verilmez.' : ''} Ayarların kalır; istediğin an yeniden kurabilirsin.
            </span>
          </div>
          <div className="yb__onay-dugmeler">
            {/* Silme geri alınamaz: odak "Vazgeç"te (yanlışlıkla Enter silmesin). */}
            <button ref={kaldirDugmesi} type="button" className="dgm dgm--hayalet dgm--k" onClick={() => setKaldirOnay(false)}>Vazgeç</button>
            <button type="button" className="dgm dgm--tehlike dgm--k" onClick={() => void kaldir()}><Ikon ad="cop" olcu={14} />Kaldır · {gbMetni(kaldirilacak / 1e9)}</button>
          </div>
        </div>
      )}
      {mesaj && <p className="yb__mesaj" role="status">{mesaj}</p>}
      {/* Ö4: "Yalnız bu bilgisayar" / Gizli seçiliyken ilerleme Nerede satırında (kart + satır + "İndirmeyi durdur"); burada yalnız hata. */}
      {d?.indirme && (!neredeYerel || d.indirme.hata) && <IndirmeDurumu indirme={d.indirme} kuruluyor={kuruluyor} sade={is} />}
      {d && (
        <div className="yb__eylem">
          {kaldiriyor || d.kaldiriliyor ? (
            <button type="button" className="dgm dgm--hayalet dgm--k" disabled><span className="donen" />Kaldırılıyor…</button>
          ) : !kurulu && neredeYerel ? null : !kurulu ? (
            // Ö4 + düzeltme turu 2: "Yalnız bu bilgisayar" / Gizli için kurulum, ilerleme ve "İndirmeyi durdur" Nerede satırında — ikinci bir
            // "Kur · N GB" / "Kuruluyor…" yok (Nerede'nin seçtiğinden farklı bir sürüm kurdurmaz).
            <button type="button" className="dgm dgm--beyaz dgm--k" onClick={kur} disabled={kuruluyor || !secili}><Ikon ad="ice" olcu={14} />{kuruluyor ? 'Kuruluyor…' : `Kur · ${secili ? gb(secili.boyut + (d.kurulu.calistirici ? 0 : ILK_KURULUM_PAYI)) : ''}`}</button>
          ) : (
            <>
              <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void cagir('yerel:yeniden-baslat')}><Ikon ad="yenile" olcu={14} />Yeniden başlat</button>
              <button type="button" className="dgm dgm--hayalet dgm--k" aria-expanded={kaldirOnay} onClick={() => { setOnay(null); setKaldirOnay(true); }}><Ikon ad="cop" olcu={14} />Kaldır</button>
            </>
          )}
          {!is && <span className="t-kucuk">{d.gpu ? `Ekran kartı: NVIDIA${d.cuda ? ' (CUDA)' : ''}` : d.gpu === false ? 'Ekran kartı yok: işlemcide çalışır (yavaş)' : ''}{d.sunucu.hata ? ` · ${d.sunucu.hata}` : ''}</span>}
        </div>
      )}
    </>
  );
}

function HizliGrubu() {
  const { a, mod } = useAyarlar();
  const { y, yk } = useYerelKaydet();
  const d = useYerelDurum();
  const is = mod !== 'gelistirici';
  const yerel = yerelAdi(is);
  const [dene, setDene] = useState('Fuber buralarda mısın?');
  const [sonuc, setSonuc] = useState<{ yanit?: string; dusunmeMs?: number; sesMs?: number; hata?: string } | null>(null);
  const [deniyor, setDeniyor] = useState(false);
  /** Yanıt ortak çalardan söylenir (düzeltme 2): tek ses yolu, Sustur ve "yeni konuşma eskisini susturur" kuralı geçerli. */
  const konusma = useRef<FuberKonusmasi | null>(null);
  useEffect(() => () => konusma.current?.kes(), []);
  if (!y) return null;
  const kurulu = yerelKurulu(d);
  // Yerel beyin yalnız tek motorken yanıt verir (Gizli, "Yalnız bu bilgisayar" — 0.12 H3c: iki modda — ya da hiç bulut yok); bulut yolunda
  // "Dene" sunucuyu açmaz (düzeltme 7).
  // E3 artığı (0.10 Görev 2): hesap kuralı literal tekrar edilmez — ana süreçle aynı tek kural (shared/abonelik.ts bulutMotorSayisi).
  const bulutVar = bulutMotorSayisi(a.saglayicilar, a.hesap) > 0;
  const yalnizYerel = y.yalnizYerel === true;
  const denenebilir = kurulu && y.etkin && (Boolean(y.gizliMod) || yalnizYerel || !bulutVar);
  const calistir = async () => {
    setDeniyor(true); setSonuc(null);
    konusma.current?.kes();
    try {
      const r = await cagir<{ yanit?: string; dusunmeMs?: number; hata?: string }>('yerel:dene', dene);
      setSonuc(r);
      if (r.yanit) {
        const t0 = performance.now();
        const k = fuberSoyle(r.yanit, 'onizleme');
        konusma.current = k;
        void k.basladi.then(() => { if (konusma.current === k) setSonuc((s) => (s ? { ...s, sesMs: Math.round(performance.now() - t0) } : s)); });
      }
    } finally { setDeniyor(false); }
  };
  return (
    <>
      <Satir id="hitap-algila"><Anahtar acik={y.hitapAlgila} etiket="Seslenmeyi anla" degistir={(v) => yk({ hitapAlgila: v })} /></Satir>
      <Satir id="yerel-islemci">
        <div className="sekmeler" role="radiogroup" aria-label="İşlemci">
          {([['otomatik', 'Otomatik'], ['cpu', 'Yalnız işlemci']] as const).map(([k, ad]) => <button key={k} type="button" role="radio" aria-checked={y.gpu === k} onClick={() => yk({ gpu: k })}>{ad}</button>)}
        </div>
      </Satir>
      <AyarBolgesi id="yerel-dene" className="yb__dene-kutu">
        <div className="ayar__metin"><b>Dene</b><span>{!kurulu || !y.etkin ? `Denemek için önce ${yerel}${is ? 'yı' : 'i'} kur ve aç.` : denenebilir ? `Bir cümle yaz; ${yerel}${is ? 'nın' : 'in'} yanıtını ve süresini gör, Fuber’in sesiyle dinle.` : `${buyukBasla(yerel)} yalnız “Yalnız bu bilgisayar” ya da Gizli seçiliyken yanıt verir; denemek için Nerede çalışsın’dan birini seç.`}</span></div>
        <div className="yb__dene">
          <input value={dene} onChange={(e) => setDene(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && denenebilir && !deniyor) void calistir(); }} aria-label="Deneme cümlesi" />
          <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void calistir()} disabled={deniyor || !denenebilir}><Ikon ad="oynat" olcu={14} />{deniyor ? 'Düşünüyor…' : 'Dene'}</button>
        </div>
        {sonuc && (
          <div className={`ic-kutu yb__sonuc${sonuc.hata ? ' yb__sonuc--hata' : ''}`}>
            {sonuc.hata ? sonuc.hata : <>
              <p>“{sonuc.yanit}”</p>
              <span className="t-kucuk">Düşünme {sonuc.dusunmeMs} ms{sonuc.sesMs !== undefined ? ` · ilk ses ${sonuc.sesMs} ms` : ''}</span>
            </>}
          </div>
        )}
      </AyarBolgesi>
    </>
  );
}

export const GIZLILIK: IcerikHaritasi = { yerel: YerelGrubu, hizli: HizliGrubu };
