// ── Sohbet ───────────────────────────────────────────────────────────────────────────────────────────────────
// Kokpitin sağındaki panel ve Sohbetler sayfası aynı bileşeni kullanır. Akan yanıt (metin + düşünce + araç
// kartları + onay kartları) "canlı" balonda büyür; tur bitince kayıtlı mesajlar yeniden okunur (tek gerçek kaynak:
// veritabanı). Mesaj: Enter gönderir, Shift+Enter alt satır; görsel yapıştır/ekle; mikrofonla yazdır.
// Görev 21 (K9): dikte konuşurken yazıya çevrilir (Scribe ara metni canlı; yoksa Whisper) ve sesle yazılan mesajın yanıtı model yazarken
// Fuber'in tek sesiyle cümle cümle okunur (renderer/fuber-sesi.ts); Durdur ve Sustur sesi anında keser.
// 0.14 T30 (Nusa dili; 11 Kas gözler): Fuber iletisinin başında yanıtı yazan kipin gözleri (24 px siyah daire, durağan; sohbet-avatar.ts), eski
// iletide ve Sade modda Fuber işareti. Sohbetler sayfasında kök ekranın tek vurgusunu taşır (kipin vurgu rengi); kokpitin panelinde kokpitin
// vurgusu miras kalır (ekranKoku=false). Boş sohbette gözler ve tek satır (ui/Bos). Tavan notunun "Devam et"i ortak Dugme hapı (mantık T13).
import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { cagir, dinle, zamanGoreli } from '../api';
import { dinlemeAc, dikteYokSatiri, dikteYeniden, ornekAkit, type DinlemeOturumu } from '../ses-yakala';
import { fuberKonus, type FuberKonusmasi } from '../fuber-sesi';
import { SesliYanit } from '../../shared/sesli-yanit';
import { modKip, type KipKimligi } from '../../shared/karakterler';
import { Ikon } from './Ikon';
import { Markdown } from './Ortak';
import { UrunIsareti } from './UrunIsareti';
import { useGorunenKarakterAdi, useKarakterGorunur } from '../karakter-gorunum';
import { useMod } from '../mod';
import { Bos, Dugme, vurguStili } from '../ui';
import { Gozler } from '../ui/goz/Gozler';
import { avatarSec } from './sohbet-avatar';
import type { Ayarlar, AracBlok, GorunenMesaj, GorunenBlok, OnayIstegi, SohbetOlayi } from '../../shared/tipler';
import { MESGUL_MESAJI } from '../../shared/mesgul';
import { geciciHataGosterilsinMi } from '../../shared/sohbet-hata';
import { sonSayac } from '../../shared/son-sayac';
import { SohbetSeridi, useSohbetSeridi } from './SohbetSeridi';
import { YAZICIYA_YAZ } from '../yazici-olay';
import { MOTOR_YER_TUTUCU, YALNIZ_YEREL_YER_TUTUCU } from '../../shared/motor-durumu';
import { sohbetBosWebSatiri } from '../../shared/bulut-kapisi';
import { istemOnerilir, oneriListesi, SOHBET_BOS_ONERILERI } from '../../shared/kokpit-istemleri';
import { DEVAM_METNI, TAVAN_NOTU_KAYNAGI } from '../../shared/sohbet-gorunum';
import { AracAdimlari } from './AracAdimlari';
import { YapayZekaKarti } from './YapayZekaKarti';
import { GorevOnayKarti } from './GorevOnayKarti';
import { CalisanSurecler } from './CalisanSurecler';
import { IsSohbetSeridi } from '../is-izi/SuAn';
import { FiilGecisi } from '../is-izi/IsSeridi';
import { useIsIzi, useSaniye } from '../is-izi/depo';
import { aracSatiri } from '../../shared/arac-satiri';
import { isSuresi } from '../../shared/is-izi';
import type { Mod } from '../../shared/tipler';

/** Canlı balonun süren adımı insan diliyle ("Web'de 'kafe fiyatları' arıyor"); süren adım yoksa boş. */
function canliAracFiili(bloklar: GorunenBlok[], mod: Mod): string {
  const b = [...bloklar].reverse().find((x): x is AracBlok => x.tur === 'arac' && x.durum === 'calisiyor');
  return b ? aracSatiri(b.ad, b.girdi, { durum: b.durum, ozet: b.ozet, etiket: b.etiket }, mod).metin : '';
}

/** İş izi (11 Kas): canlı balonun alt satırı — "devam ediyor…" yerine canlı fiil (çapraz solma) ve tur iş sayıldıysa süresi. */
function CanliFiil({ sohbetId, metin }: { sohbetId: number | null; metin: string }) {
  const is = useIsIzi().find((x) => x.kaynak === 'sohbet' && x.sohbetId === sohbetId);
  const simdi = useSaniye(Boolean(is));
  return (
    <div className="dusunce" data-canli-fiil="">
      <span className="dusunce__isik" />
      <FiilGecisi metin={metin} className="dusunce__metin" />
      {is && <span className="dusunce__sure">{isSuresi(simdi - is.baslangic)}</span>}
    </div>
  );
}
import './ek-cip.css';
import { ekSinifla, ekBoyutMetni, EK_SECICI_KABUL, GORSEL_MEDYA, GORSEL_AZAMI_BAYT, AZAMI_GORSEL, AZAMI_EK, BELGE_UZ, type MetinEki } from '../../shared/ek-kural';

export interface Canli { bloklar: (GorunenBlok)[]; dusunce: string; onaylar: OnayIstegi[] }

/** Taslak (henüz kaydı olmayan yeni sohbet; Görev 20b, K11): ilk mesaj gönderilirken `olustur` kaydı açar, `olustu` sayfaya bildirir. */
export interface YeniSohbet { olustur: () => Promise<number>; olustu: (id: number) => void }

/** Bir sohbetin canlı durumu: kayıtlı mesajlar + akan yanıt + onaylar. Masaüstü Sohbet ve Fuber Cep aynı kancayı kullanır.
 *  `sohbetId` null ve `yeni` verilmişse taslaktır: boş sohbet kaydı açılmaz, ilk gönderimde oluşur ve akış kesilmeden sürer. */
export function useSohbetAkisi(sohbetId: number | null, yeni?: YeniSohbet) {
  const [mesajlar, setMesajlar] = useState<GorunenMesaj[]>([]);
  const [canli, setCanli] = useState<Canli | null>(null);
  /** Süren yanıtın karakter adı: 'basladi' olayından (tur başında kilitlenir; kip tur sürerken değişse de balon eski adla biter). */
  const [canliKarakter, setCanliKarakter] = useState('');
  /** Süren yanıtın kipi (avatar): 'basladi' olayından, adla birlikte kilitlenir. */
  const [canliKip, setCanliKip] = useState<KipKimligi | undefined>(undefined);
  const [calisiyor, setCalisiyor] = useState(false);
  const [hata, setHata] = useState('');
  const [yuklendi, setYuklendi] = useState(false);
  // Olay süzgeci ve yükleme bu kimliği okur: taslaktan oluşan sohbetin olayları, sayfa yeni kimliği vermeden de alınır.
  const idRef = useRef<number | null>(sohbetId);
  const olusan = useRef<number | null>(null);
  const yeniRef = useRef(yeni);
  yeniRef.current = yeni;
  /** Sesle yazılan mesajın yanıtı Fuber'in sesiyle okunur (tur sürerken cümle cümle). I5: araçtan önce yazılan metin söylenmez
   *  (shared/sesli-yanit.ts — konuşma o adımda kesilip yeniden açılır). */
  const konusma = useRef<{ s: SesliYanit<FuberKonusmasi>; sohbetId: number } | null>(null);
  const [konusuyor, setKonusuyor] = useState(false);
  /** Süren turun kipi ('basladi' olayından; tur başında kilitlenir): araç sonrası yeniden açılan konuşma da turun karakteriyle söyler. */
  const turKipi = useRef<KipKimligi | undefined>(undefined);
  const sustur = useCallback(() => { const k = konusma.current; konusma.current = null; k?.s.kes(); setKonusuyor(false); }, []);
  // Başka sohbete geçildi ya da bileşen söküldü: ses susar (taslaktan az önce oluşan sohbete geçiş susturmaz: aynı sohbet).
  useEffect(() => { if (konusma.current && konusma.current.sohbetId !== sohbetId) sustur(); }, [sohbetId, sustur]);
  useEffect(() => () => sustur(), [sustur]);

  const yukle = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    const l = await cagir<GorunenMesaj[]>('sohbet:mesajlar', id);
    if (idRef.current !== id) return; // bu arada başka sohbete geçildi
    setMesajlar(l);
    setYuklendi(true);
    void cagir('sohbet:okundu', id);
  }, []);

  useEffect(() => {
    // Taslaktan az önce oluşan sohbete geçiş: akan yanıt sürüyor, durum sıfırlanmaz.
    if (sohbetId !== null && sohbetId === olusan.current) { olusan.current = null; return; }
    olusan.current = null;
    idRef.current = sohbetId;
    setCanli(null); setCanliKarakter(''); setHata(''); setCanliKip(undefined); setYuklendi(false); setCalisiyor(false);
    if (!sohbetId) { setMesajlar([]); return; }
    void yukle();
    void cagir<boolean>('sohbet:mesgul', sohbetId).then((m) => { if (idRef.current === sohbetId) setCalisiyor(m); });
  }, [sohbetId, yukle]);

  useEffect(() => dinle('sohbet:olay', (o: SohbetOlayi) => {
    if (!idRef.current || o.sohbetId !== idRef.current) return;
    const ses = konusma.current?.sohbetId === o.sohbetId ? konusma.current.s : null;
    if (ses) {
      if (o.tur === 'metin') ses.metin(o.parca);
      else if (o.tur === 'arac_oncesi' || o.tur === 'arac') ses.aracOncesi();
      else if (o.tur === 'bitti') ses.bitir();
      else if (o.tur === 'hata' && !o.mesgul) sustur();
    }
    switch (o.tur) {
      case 'basladi':
        setMesajlar((m) => [...m, o.kullaniciMesaji]);
        setCalisiyor(true); setHata('');
        setCanliKarakter(o.karakter ?? '');
        setCanliKip(o.kip);
        turKipi.current = o.kip;
        ses?.baslat();
        setCanli({ bloklar: [], dusunce: '', onaylar: [] });
        break;
      case 'dusunce':
        setCalisiyor(true);
        setCanli((c) => ({ ...(c ?? { bloklar: [], onaylar: [] }), dusunce: ((c?.dusunce ?? '') + o.metin).slice(-600) }));
        break;
      case 'metin':
        setCalisiyor(true);
        setCanli((c) => {
          const b = [...(c?.bloklar ?? [])];
          const son = b[b.length - 1];
          if (son?.tur === 'metin') b[b.length - 1] = { tur: 'metin', metin: son.metin + o.parca };
          else b.push({ tur: 'metin', metin: o.parca });
          return { bloklar: b, dusunce: '', onaylar: c?.onaylar ?? [] };
        });
        break;
      case 'arac':
        setCalisiyor(true);
        setCanli((c) => {
          const b = [...(c?.bloklar ?? [])];
          const i = b.findIndex((x) => x.tur === 'arac' && x.id === o.blok.id);
          if (i >= 0) b[i] = o.blok; else b.push(o.blok);
          return { bloklar: b, dusunce: c?.dusunce ?? '', onaylar: c?.onaylar ?? [] };
        });
        break;
      case 'kart':
        // 0.11 G6: kart_goster başarılı — araç satırının yerine yapay zekânın kartı gelir (kayıtlı görünümle aynı sıra).
        setCalisiyor(true);
        setCanli((c) => {
          const b = [...(c?.bloklar ?? [])];
          const i = b.findIndex((x) => x.tur === 'arac' && x.id === o.aracId);
          if (i >= 0) b[i] = { tur: 'kart', kart: o.kart }; else b.push({ tur: 'kart', kart: o.kart });
          return { bloklar: b, dusunce: c?.dusunce ?? '', onaylar: c?.onaylar ?? [] };
        });
        break;
      case 'onay':
        setCanli((c) => ({ bloklar: c?.bloklar ?? [], dusunce: c?.dusunce ?? '', onaylar: [...(c?.onaylar ?? []), o.istek] }));
        break;
      case 'onay_iptal':
        setCanli((c) => (c ? { ...c, onaylar: c.onaylar.filter((x) => x.id !== o.id) } : c));
        break;
      case 'bitti':
        setCalisiyor(false); setCanli(null); void yukle();
        break;
      case 'hata':
        // Meşgul uyarısı sürmekte olan turu silmesin (canlı balon ve "düşünüyor" kalır).
        if (o.mesgul) { setHata(o.mesaj); break; }
        setCalisiyor(false); setCanli(null); setHata(o.mesaj); void yukle();
        break;
      case 'yeni_mesaj':
        void yukle();
        break;
    }
  }), [sohbetId, yukle, sustur]);

  /** false: mesaj alınmadı (sohbette başka yanıt sürüyor ya da taslak açılamadı) — Yazıcı metni geri koyar. */
  const gonder = async (metin: string, gorseller?: { medya: string; veri: string }[], kaynak?: 'kullanici' | 'ses', ekler?: MetinEki[]): Promise<boolean> => {
    if (!metin.trim() && !gorseller?.length && !ekler?.length) return false;
    let id = idRef.current;
    setCalisiyor(true); setHata('');
    sustur(); // yeni mesaj: önceki yanıtın sesi susar
    turKipi.current = undefined; // yeni tur: 'basladi' gelene dek ana süreç şu anki kipe bakar
    if (!id) {
      // K11: taslak sohbet ilk mesajda kaydolur (boş "Yeni sohbet" birikmez).
      const y = yeniRef.current;
      if (!y) { setCalisiyor(false); return false; }
      try { id = await y.olustur(); } catch (e) { setCalisiyor(false); setHata((e as Error).message || 'Sohbet açılamadı.'); return false; }
      idRef.current = id; olusan.current = id;
      y.olustu(id);
    }
    // Sesle yazıldı: yanıt Fuber'in sesiyle okunur (sesli yanıt kapalıysa ana süreç konuşma açmaz). Konuşma şimdi açılır: bağlantı
    // model düşünürken ısınır.
    if (kaynak === 'ses') {
      const ac = () => {
        const k = fuberKonus('sohbet', turKipi.current, setHata); // sessiz düşüş yok (0.13): ses düşerse ya da başka ses çalarsa tek satır, yanıtın altında
        void k.basladi.then(() => { if (konusma.current?.s.konusma === k) setKonusuyor(true); });
        void k.sonuc.then(() => { if (konusma.current?.s.konusma === k) { konusma.current = null; setKonusuyor(false); } });
        return k;
      };
      konusma.current = { s: new SesliYanit(ac, { tembel: true }), sohbetId: id }; // ilk konuşma 'basladi'da, turun kilitli kipiyle açılır
    }
    // Sohbette sesle YAZDIRILAN mesaj 'dikte' gider (düzeltme 3; shared/sohbet-girdisi.ts): yanıtı sesle okunur ama tur sesli tur gibi
    // kısıtlanmaz (tam araçlar, normal düşünme gücü). Adanın sesli sorusu 'ses' kalır.
    const alindi = await cagir<boolean>('sohbet:gonder', id, metin.trim(), gorseller, kaynak === 'ses' ? 'dikte' : kaynak, undefined, ekler?.length ? ekler : undefined).catch(() => false);
    if (!alindi) {
      sustur();
      setHata(MESGUL_MESAJI);
      // İyimser "çalışıyor" geri alınır; gerçekten süren tur varsa onun olayları yeniden işaretler.
      setCalisiyor(await cagir<boolean>('sohbet:mesgul', id).catch(() => false));
    }
    return alindi;
  };

  const onayVer = async (id: string, karar: 'bir_kez' | 'bu_gorev' | 'reddet') => {
    await cagir('onay:yanitla', id, karar);
    setCanli((c) => (c ? { ...c, onaylar: c.onaylar.filter((x) => x.id !== id) } : c));
  };
  const durdur = () => { sustur(); if (idRef.current) void cagir('sohbet:durdur', idRef.current); };

  return { mesajlar, canli, canliKarakter, canliKip, calisiyor, hata, yuklendi, gonder, onayVer, durdur, konusuyor, sustur };
}

export function Sohbet({ sohbetId, baslik, ustEk, solEk, ust, sikisik, yeni, odak, bosIcerik, bosPanelBildirir, ekranKoku = true }: {
  sohbetId: number | null; baslik?: string; ustEk?: React.ReactNode; solEk?: React.ReactNode; sikisik?: boolean;
  /** 0.14 T30: sohbet ekranın kökü mü (Sohbetler sayfası: kipin karakter vurgusu). Kokpitin panelinde false: ekranın tek vurgusu kokpitin. */
  ekranKoku?: boolean;
  /** 0.11 G7: verilirse sohbetin başlık şeridinin YERİNE geçer (kokpitte sohbet seçici: renderer/pano/SohbetSecici.tsx). Şeridin kendi
   *  iç boşluğunu ve sürükleme bölgesini seçici taşır. */
  ust?: React.ReactNode;
  /** Taslak sohbet (K11): kayıt ilk mesajda açılır. */
  yeni?: YeniSohbet;
  /** Değişince yazı alanı odaklanır (Ctrl+N, "Yeni"). */
  odak?: number;
  /** Görev 24 düzeltme turu 1: sohbet boşken (mesaj yok, yanıt sürmüyor) listenin başında gösterilecek içerik — Kokpit'in "Bugünün
   *  özeti" paneli. Verilirse varsayılan hazır öneriler yerine o çizilir ve motor dursa da görünür (panel kendi davranışını bilir). */
  bosIcerik?: React.ReactNode;
  /** 0.10 Görev 2 (A-1, A-3; Ruling BO'nun yerine): boş panel (Kokpit'in "Bugünün özeti") motorun TEK bildirimini kendi kartında
   *  gösterir — sohbet boşken motor şeridi hiç çizilmez (aynı bildirim iki kez görünmesin). Düzeltme turu 1: mesajlar ve panel verisi
   *  yüklenene dek de (yer tutucu) çizilmez — açılışta bir kare görünüp kaybolan şerit ve kayma yok. İlk mesajdan sonra şerit görünür. */
  bosPanelBildirir?: boolean;
}) {
  const { mesajlar, canli, canliKarakter, canliKip: canliKipKilitli, calisiyor, hata, yuklendi, gonder: gonderAkis, onayVer, durdur, konusuyor, sustur } = useSohbetAkisi(sohbetId, yeni);
  // Motor şeridi (Görev 14, §4.4; 0.10 Görev 2; 0.11 G8: ödeme şeridi kalktı): yazı alanının üstünde; yalnız çalışan bağlantı koptuysa kırmızı.
  // Ruling K: hiç motor yoksa (bulut yok VE hazır yerel model yok) sohbetten gönderim kapalı (ada gibi); yazılan silinmez.
  const { serit, gonderimKapali, gizli, aracsiz, karakter } = useSohbetSeridi();
  // Ayardaki modun kipi: ekran vurgusu, boş durumun karakteri ve kilidi bilinmeyen süren yanıtın avatarı (adla aynı kural).
  const mod = useMod();
  const kipSimdi = modKip(mod ?? 'is');
  const canliKip = canliKipKilitli ?? kipSimdi;
  // Boş sohbetin hazır önerileri (shared/kokpit-istemleri.ts, tek kaynak): Gizli açıkken araç isteyen istemler önerilmez (Gizli turda araç yok).
  const webKapali = sohbetBosWebSatiri(aracsiz);
  const oneriler = oneriListesi(SOHBET_BOS_ONERILERI, aracsiz); // G8 K3: Gizli YA DA yalnız yerel — ikisinde de araç yok
  const liste = useRef<HTMLDivElement>(null);
  const altta = useRef(true);
  // Boş sohbette (panel ya da öneriler) liste başta kalır: en alta kaydırma yalnız mesaj varken. Panel mesajlar yüklendikten sonra
  // (dolu sohbette bir kare görünüp kaybolmasın).
  const bos = !mesajlar.length && !canli;
  const bosRef = useRef(bos);
  bosRef.current = bos;
  // Boş panelden ilk mesaja geçiş (G24 küçüğü): panel kaydırılmışken (altta=false) çipten/karttan gönderilen ilk mesajın yanıtı da
  // izlenmeliydi — boştan doluya geçince liste en alta bağlanır.
  const oncekiBos = useRef(bos);

  useEffect(() => {
    const l = liste.current;
    if (oncekiBos.current && !bos) altta.current = true;
    oncekiBos.current = bos;
    if (l && altta.current && !bos) l.scrollTop = l.scrollHeight;
  }, [mesajlar, canli, bos]);
  // Liste kısalınca (pencere boyu, yazı alanı büyüdü, motor şeridi belirdi) en alttaysa altta kalsın: son mesajın sonu görünür
  // (Görev 20b düzeltme turu 2; kısalma kaydırma olayı vermez).
  useEffect(() => {
    const l = liste.current;
    if (!l || typeof ResizeObserver === 'undefined') return;
    const r = new ResizeObserver(() => { if (altta.current && !bosRef.current) l.scrollTop = l.scrollHeight; });
    r.observe(l);
    return () => r.disconnect();
  }, []);

  const gonder: typeof gonderAkis = (...a) => { altta.current = true; return gonderAkis(...a); };

  return (
    <div className={`sohbet${sikisik ? '' : ' sohbet--genis'}`} data-vurgu={ekranKoku ? 'sohbet' : undefined} style={ekranKoku ? (vurguStili('sohbet', kipSimdi) as CSSProperties) : undefined}>
      {ust ?? ((baslik || ustEk || solEk) && (
        <div className="sohbet__ust surukle">
          {solEk && <span className="surukleme" style={{ display: 'flex' }}>{solEk}</span>}
          <span className="t-ara" style={{ fontSize: 15, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{baslik}</span>
          <span style={{ marginLeft: 'auto' }} className="surukleme">{ustEk}</span>
        </div>
      ))}
      <div className="sohbet__liste" ref={liste} onScroll={(e) => { const l = e.currentTarget; altta.current = l.scrollHeight - l.scrollTop - l.clientHeight < 60; }}>
        {bos && yuklendi && bosIcerik}
        {/* Hazır öneriler yalnız gönderilebilirken (motor durunca gönderilemeyecek bir şey önerilmez). 0.11 G7: öneriler ortak kaynaktan;
            dar kokpit panelinde uzun öneri taşmasın diye düğme satır kırar (.sohbet__oneri). */}
        {bos && !bosIcerik && !gonderimKapali && (
          <div className="sohbet__oneriler" data-sohbet-onerileri={gizli ? 'gizli' : aracsiz ? 'yerel' : ''}>
            <Bos karakter={kipSimdi} baslik="Fuber’e bir şey sor ya da söyle." />
            {oneriler.map((o) => <button key={o.etiket} type="button" className="hap sohbet__oneri" onClick={() => { if (istemOnerilir(o.istem, aracsiz)) void gonder(o.istem.metin); }}>{o.etiket}</button>)}
            {/* 0.14 T14 (B24): Gizli ya da Yalnız bu bilgisayar'da web araması kapalıdır; boş durumda tek satır söyler (BULUT_KAPALI_METNI.web). */}
            {webKapali && <span className="soluk" data-web-kapali="" style={{ fontSize: 13 }}>{webKapali}</span>}
          </div>
        )}
        {mesajlar.map((m) => <Mesaj key={`${m.id}-${m.rol}`} m={m} sikisik={sikisik} />)}
        {/* 0.14 T13 (R24): tur adım sınırında durduysa (son ileti tavan notu, tur sürmüyor) "Devam et" yeni tur açar; görünen metin DEVAM_METNI, ajan
            döngüsü bağlama son 5 adımı ekler (ajan/zincir.ts devamMi). T30: ortak Dugme hapı (yalnız görünüm; mantık değişmez). */}
        {!calisiyor && !canli && !gonderimKapali && mesajlar.at(-1)?.rol === 'not' && mesajlar.at(-1)?.kaynak === TAVAN_NOTU_KAYNAGI && (
          <div className="mesaj mesaj--not" data-tavan-devam="">
            <Dugme tur="birincil" boyut="k" onClick={() => void gonder(DEVAM_METNI)}>Devam et</Dugme>
          </div>
        )}
        {canli && (
          <div className="mesaj mesaj--assistant">
            {/* Sayfaya dönünce turun 'basladi' olayı kaçmıştır: kilit bilinmez, ayardaki modun karakteri gösterilir ("Fuber" denmez). */}
            <FuberBasi karakter={canliKarakter || karakter} kip={canliKip} suruyor={calisiyor} />
            {(canli.bloklar.length > 0 || (calisiyor && !canli.onaylar.length)) && (
              <div className="mesaj__govde">
                <Bloklar bloklar={canli.bloklar} />
                {calisiyor && !canli.onaylar.length && (
                  <CanliFiil sohbetId={sohbetId} metin={canli.dusunce ? canli.dusunce.split('\n').filter(Boolean).pop() ?? '' : canliAracFiili(canli.bloklar, mod ?? 'is') || (canli.bloklar.length ? 'Düşünüyor…' : 'düşünüyor…')} />
                )}
              </div>
            )}
            {canli.onaylar.map((o) => <OnayKarti key={o.id} o={o} karar={onayVer} />)}
          </div>
        )}
        {calisiyor && !canli && <div className="dusunce"><span className="dusunce__isik" /><span>düşünüyor…</span></div>}
        {geciciHataGosterilsinMi(hata, mesajlar) && <div className="mesaj mesaj--not" data-gecici-hata=""><div className="balon" style={{ color: 'var(--yazi-hata)' }}>⚠ {hata}</div></div>}
      </div>
      {serit && !(bosPanelBildirir && bos && bosIcerik) && <SohbetSeridi serit={serit} />}
      {/* Analiz 11 Kas bulgu 4: arka plan süreçleri (dev sunucusu, izleyici) — canlı çıktı ve Durdur. Süreç yoksa hiçbir şey çizilmez. */}
      {/* İş izi (11 Kas): bu sohbetten verilen işlerin yardımcıları (Claude Code oturumu ve alt ajanları) — şerit şerit, canlı fiil ve süreyle. */}
      <IsSohbetSeridi sohbetId={sohbetId} />
      <CalisanSurecler />
      <Yazici calisiyor={calisiyor} gonder={gonder} durdur={durdur} motorDurdu={gonderimKapali} motorKirmizi={serit?.seviye === 'kirmizi'} odak={odak} konusuyor={konusuyor} sustur={sustur}
        yerTutucu={!gizli && (serit?.tur === 'hazirlaniyor' || serit?.tur === 'yerel-hazir-degil') ? YALNIZ_YEREL_YER_TUTUCU : MOTOR_YER_TUTUCU} />
    </div>
  );
}

/** Fuber mesajının başı: avatar + ad (+ kendiliğinden yazdıysa hap) + zaman. `karakter`: yanıtı yazan karakterin adı (0.13); eski iletide yok → "Fuber".
 *  `kip` (0.14 T30): yanıtı yazan kipin gözleri 24 px (kip yoksa ya da Sade'de Fuber işareti); `suruyor`: canlı balonda ifade 'konusuyor'. */
function FuberBasi({ zaman, proaktif, karakter: kayitliAd, kip, suruyor }: { zaman?: string; proaktif?: boolean; karakter?: string; kip?: KipKimligi; suruyor?: boolean }) {
  // 0.14 T6b (Sade mod): kayıtlı karakter adı yalnız Göster'de görünür; Sade'de her ileti "Fuber".
  const karakter = useGorunenKarakterAdi(kayitliAd);
  const a = avatarSec({ kip, karakterGorunur: useKarakterGorunur(), suruyor });
  return (
    <div className="mesaj__ust">
      {a.tur === 'goz'
        ? <span className="mesaj__avatar mesaj__avatar--goz" data-avatar={a.kip} aria-hidden="true"><Gozler kip={a.kip} ifade={a.ifade} boyut={a.boyut} /></span>
        : <span className="mesaj__avatar" data-avatar="fuber" aria-hidden="true"><UrunIsareti olcu={12} /></span>}
      {/* 11 Kas: ad iki modda da "Fuber" (kayıtlı eski ileti başka bir ad taşısa da; shared/karakter-gorunum.ts gorunenKarakterAdi). */}
      <span className="mesaj__ad">{a.tur === 'goz' ? (karakter || 'Fuber') : 'Fuber'}</span>
      {proaktif && <span className="hap" style={{ height: 18, fontSize: 12, padding: '0 7px' }}>kendiliğinden</span>}
      {zaman && <span>{zamanGoreli(zaman)}</span>}
    </div>
  );
}

function Mesaj({ m, sikisik }: { m: GorunenMesaj; sikisik?: boolean }) {
  if (m.rol === 'not') return <div className="mesaj mesaj--not"><div className="balon">{m.bloklar.map((b) => (b.tur === 'metin' ? b.metin : '')).join(' ')}</div></div>;
  if (m.rol === 'user') {
    return (
      <div className="mesaj mesaj--user">
        {m.bloklar.filter((b) => b.tur === 'gorsel').map((b, i) => <img key={i} className="mesaj__gorsel" alt="" src={`data:${(b as { medya: string }).medya};base64,${(b as { veri: string }).veri}`} />)}
        {m.bloklar.some((b) => b.tur === 'metin') && <div className="balon">{m.bloklar.map((b) => (b.tur === 'metin' ? b.metin : '')).filter(Boolean).join('\n')}</div>}
        {m.bloklar.some((b) => b.tur === 'ek') && (
          <div className="mesaj__ekler">
            {m.bloklar.map((b, i) => (b.tur === 'ek' ? <span key={i} className="ek-cip" data-tur={b.turu}><Ikon ad={b.turu === 'video' ? 'oynat' : 'dosya'} olcu={13} /><span className="ek-cip__ad">{b.ad}</span></span> : null))}
          </div>
        )}
        {!sikisik && <div className="mesaj__ust">{m.kaynak === 'ses' ? '🎙 ' : m.kaynak === 'mobil' ? '📱 telefondan · ' : ''}{zamanGoreli(m.zaman)}</div>}
      </div>
    );
  }
  return (
    <div className="mesaj mesaj--assistant">
      <FuberBasi zaman={m.zaman} proaktif={m.kaynak === 'proaktif'} karakter={m.karakter} kip={m.kip} />
      <div className="mesaj__govde"><Bloklar bloklar={m.bloklar} /></div>
    </div>
  );
}

/** Mesajın blokları: metin (Markdown), araç adımları (ardışık adımlar tek kartta: tek satır ya da "N adım"), yapay zekânın kartı, görsel. */
export function Bloklar({ bloklar }: { bloklar: GorunenBlok[] }) {
  const ogeler: React.ReactNode[] = [];
  for (let i = 0; i < bloklar.length; i++) {
    const b = bloklar[i];
    if (b.tur === 'arac') {
      const adimlar: AracBlok[] = [b];
      for (let s = bloklar[i + 1]; s?.tur === 'arac'; s = bloklar[i + 1]) { adimlar.push(s); i++; }
      ogeler.push(<AracAdimlari key={`arac-${adimlar[0].id}`} bloklar={adimlar} />);
    }
    else if (b.tur === 'metin') ogeler.push(<div key={i} className="balon"><Markdown metin={b.metin} /></div>);
    else if (b.tur === 'kart') ogeler.push(<YapayZekaKarti key={i} kart={b.kart} />);
    else if (b.tur === 'gorsel') ogeler.push(<img key={i} alt="" src={`data:${b.medya};base64,${b.veri}`} />);
  }
  return <>{ogeler}</>;
}

export function OnayKarti({ o, karar }: { o: OnayIstegi; karar: (id: string, k: 'bir_kez' | 'bu_gorev' | 'reddet') => void }) {
  // 0.11 G10: Görev başlatma onayı (tur 'gorev', planın insan dili `gorev`te) kendi kartıdır: Ne yapacak · Nasıl kontrol eder · Ne zaman biter ·
  // İzinler · Adım sınırı, "Başlat" / "Vazgeç". Plan bilgisi yoksa (eski olay) genel kart başlık + açıklama + önizlemeyle çizer. Ada da bu kartı kullanır.
  if (o.tur === 'gorev' && o.gorev) return <GorevOnayKarti o={o} karar={karar} />;
  return (
    <div className="onay" data-tehlike={o.tehlike} role="group" aria-label={`Onay gerekiyor: ${o.baslik}`}>
      <div className="onay__etiket">{o.tehlike === 'yuksek' ? 'Dikkat · onayın gerekiyor' : 'Onayın gerekiyor'}</div>
      <div className="onay__baslik"><Ikon ad="kalkan" olcu={16} />{o.baslik}</div>
      <div className="soluk" style={{ fontSize: 13 }}>{o.aciklama}</div>
      {o.onizleme && <div className="onay__onizleme">{o.onizleme}</div>}
      <div className="onay__dugmeler">
        {o.secenekler.includes('bir_kez') && <button className="dgm dgm--beyaz dgm--k" onClick={() => karar(o.id, 'bir_kez')}><Ikon ad="tamam" olcu={14} />Onayla</button>}
        {o.secenekler.includes('bu_gorev') && <button className="dgm dgm--koyu dgm--k" onClick={() => karar(o.id, 'bu_gorev')}>Bu görev boyunca izin ver</button>}
        <button className="dgm dgm--hayalet dgm--k" onClick={() => karar(o.id, 'reddet')}>Reddet</button>
      </div>
    </div>
  );
}

/** Süren dikte: ses ana sürece akarken (Scribe ara metni canlı) kullanıcı mikrofona yeniden basınca biter. */
interface Dikte { bitir: () => void; iptal: () => void }

/** Sohbet kutusunun belge/video eki (analiz 11 Kas bulgu 8–9): hazırlanırken çip ilerlemeyi gösterir; hazır olunca metni (ve videonun kareleri) gider. */
interface DosyaEki { kimlik: string; ad: string; tur: 'belge' | 'video'; boyut: number; durum: 'hazirlaniyor' | 'hazir'; yuzde?: number; adim?: string; ek?: MetinEki; kareler?: { medya: string; veri: string }[] }
const SECICI_KABUL = EK_SECICI_KABUL;
let ekSayaci = 0;

/** Görseli izinli türe ve boyuta getirir: PNG/JPEG/GIF/WebP ve ≤ 5 MB olduğu gibi; BMP/SVG ya da büyük görsel tarayıcıda yeniden kodlanır
 *  (en çok 2560 px; PNG, büyükse JPEG). Hâlâ büyükse ya da çözülemiyorsa tek satırlık hata. */
async function gorselHazirla(f: File, cevir: boolean): Promise<{ medya: string; veri: string } | { hata: string }> {
  const oku = (b: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(b); });
  const dogrudan = GORSEL_MEDYA.includes(f.type) && f.size <= GORSEL_AZAMI_BAYT && !cevir;
  if (dogrudan) { const s = await oku(f); return { medya: f.type, veri: s.slice(s.indexOf(',') + 1) }; }
  try {
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('çözülemedi')); i.src = url; });
      const k = Math.min(1, 2560 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round((img.naturalWidth || 800) * k)); c.height = Math.max(1, Math.round((img.naturalHeight || 600) * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      for (const [medya, kalite] of [['image/png', undefined], ['image/jpeg', 0.85], ['image/jpeg', 0.7]] as const) {
        const s = c.toDataURL(medya, kalite);
        const veri = s.slice(s.indexOf(',') + 1);
        if (veri.length * 0.75 <= GORSEL_AZAMI_BAYT) return { medya, veri };
      }
    } finally { URL.revokeObjectURL(url); }
  } catch { return { hata: `${f.name}: görsel açılamadı.` }; }
  return { hata: `${f.name} çok büyük (${ekBoyutMetni(f.size)}); küçültülse de 5 MB'ı aşıyor.` };
}

function Yazici({ calisiyor, gonder, durdur, motorDurdu, motorKirmizi, odak, konusuyor, sustur, yerTutucu = MOTOR_YER_TUTUCU }: { calisiyor: boolean; gonder: (m: string, g?: { medya: string; veri: string }[], k?: 'kullanici' | 'ses', e?: MetinEki[]) => Promise<boolean>; durdur: () => void; motorDurdu?: boolean; motorKirmizi?: boolean; odak?: number; konusuyor?: boolean; sustur?: () => void; yerTutucu?: string }) {
  const [metin, setMetin] = useState('');
  const [ekler, setEkler] = useState<{ medya: string; veri: string }[]>([]);
  const [dosyaEkleri, setDosyaEkleri] = useState<DosyaEki[]>([]);
  const [suruklenen, setSuruklenen] = useState(false);
  /** En güncel ek listeleri (art arda bırakılan dosyalar sınırı doğru saysın). */
  const ekRef = useRef({ gorsel: 0, dosya: [] as DosyaEki[] });
  ekRef.current = { gorsel: ekler.length, dosya: dosyaEkleri };
  /** Okunmakta olan (henüz listeye girmemiş) görseller: sınır sayımına dahil. */
  const bekleyenGorsel = useRef(0);
  const [kayit, setKayit] = useState(false);
  const [bilgi, setBilgi] = useState('');
  const [bilgiSayaci] = useState(sonSayac);
  const [yenidenSatiri, setYenidenSatiri] = useState('');
  /** Dikte sürerken Scribe'ın canlı ara metni (yazı alanının üstünde). */
  const [canli, setCanli] = useState('');
  const alan = useRef<HTMLTextAreaElement>(null);
  const dosya = useRef<HTMLInputElement>(null);
  const dikteRef = useRef<Dikte | null>(null);
  /** Yazı alanındaki metin sesle yazıldı: gönderilince yanıtı sesli okunur. */
  const sesle = useRef(false);
  const sokuldu = useRef(false);
  // A6 (son düzeltme): "Mikrofonu tamamen kapat" (sol menü / Ayarlar → Ses) sohbetin dikte düğmesini de kapatır — ada'daki G11
  // düzeltmesinin aynısı: düğme gizlenir, süren kayıt hemen kesilir (yazıya çevrilmez). Eskiden düğme görünür kalıp ham "Permission
  // denied" ile düşüyor, süren dikte susturmadan sonra da kaydediyordu (ana süreç yalnız YENİ izin isteklerini engelliyor).
  const [mikrofonKapali, setMikrofonKapali] = useState(false);
  const mikrofonKapaliRef = useRef(false);
  mikrofonKapaliRef.current = mikrofonKapali;
  useEffect(() => {
    const uygula = (a: { ses?: { mikrofonKapali?: boolean } } | null | undefined) => {
      const kapali = Boolean(a?.ses?.mikrofonKapali);
      mikrofonKapaliRef.current = kapali;
      setMikrofonKapali(kapali);
      if (kapali && dikteRef.current) { dikteRef.current.iptal(); bilgiVer('Mikrofon kapatıldı; kayıt durdu, yazıya çevrilmedi.'); }
    };
    void cagir<Ayarlar>('ayarlar:al').then(uygula).catch(() => undefined);
    return dinle('ayarlar:degisti', uygula);
  }, []);
  // 0.10 E4 (tanıtım turunun son durağı, G8 Step 7): "Yarın sabah için bir hatırlatıcı kur" ilk görevi yazı alanına YAZAR (gönderilmez;
  // kullanıcı Enter'a basar). Yazılmış bir taslak varsa ezilmez.
  useEffect(() => {
    const yaz = (e: Event) => {
      const m = (e as CustomEvent<string>).detail;
      if (typeof m !== 'string' || !m.trim()) return;
      setMetin((x) => (x.trim() ? x : m));
      requestAnimationFrame(() => alan.current?.focus());
    };
    addEventListener(YAZICIYA_YAZ, yaz);
    return () => removeEventListener(YAZICIYA_YAZ, yaz);
  }, []);

  // Sayfa değişince (bileşen sökülünce) dikte ve mikrofon kapanır; yoksa mikrofon açık kalıyordu.
  useEffect(() => {
    sokuldu.current = false;
    return () => { sokuldu.current = true; dikteRef.current?.iptal(); bilgiSayaci.iptal(); };
  }, []);

  useEffect(() => {
    const a = alan.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = `${Math.min(200, a.scrollHeight)}px`;
  }, [metin]);

  // Yeni sohbet (Ctrl+N / "Yeni"): yazı alanı odaklanır; motor durduysa alan kapalıdır, odak verilmez.
  useEffect(() => { if (odak) alan.current?.focus({ preventScroll: true }); }, [odak]);

  // Video ekinin ilerlemesi (ana süreç → yalnız bu pencere): çipteki çubuk ve adım yazısı.
  useEffect(() => dinle('ek:ilerleme', (i: { kimlik?: string; yuzde?: number; metin?: string }) => {
    if (!i?.kimlik) return;
    setDosyaEkleri((l) => l.map((d) => (d.kimlik === i.kimlik && d.durum === 'hazirlaniyor' ? { ...d, yuzde: i.yuzde, adim: i.metin } : d)));
  }), []);

  /** Seçilen, bırakılan ya da yapıştırılan dosyalar (analiz 11 Kas bulgu 8–12): tür ve boyut denetimi, sınır aşımı ve ret tek satırla söylenir —
   *  hiçbir ek sessizce düşmez ya da başkasının yerine geçmez. */
  const dosyalariAl = (liste: Iterable<File>) => {
    const hatalar: string[] = [];
    let gorsel = ekRef.current.gorsel + bekleyenGorsel.current;
    const dosya = [...ekRef.current.dosya];
    for (const f of liste) {
      const k = ekSinifla(f.name, f.type, f.size);
      if ('hata' in k) { hatalar.push(k.hata); continue; }
      const videoVar = dosya.some((d) => d.tur === 'video');
      if (k.tur === 'gorsel') {
        if (videoVar) { hatalar.push('Video eklenmiş mesaja görsel eklenmez: video kareleri görsel sınırını kullanıyor.'); continue; }
        if (gorsel >= AZAMI_GORSEL) { hatalar.push(`Bir mesaja en çok ${AZAMI_GORSEL} görsel eklenir; ${f.name} eklenmedi.`); continue; }
        gorsel++;
        bekleyenGorsel.current++;
        void gorselHazirla(f, Boolean(k.cevir)).then((g) => {
          bekleyenGorsel.current = Math.max(0, bekleyenGorsel.current - 1);
          if ('hata' in g) { bilgiVer(g.hata, 8000); return; }
          setEkler((e) => [...e, g]); // sınır kabulde sayıldı (bekleyenler dahil): burada düşürme yok
        });
        continue;
      }
      if (dosya.length >= AZAMI_EK) { hatalar.push(`Bir mesaja en çok ${AZAMI_EK} dosya eklenir; ${f.name} eklenmedi.`); continue; }
      if (k.tur === 'video' && (videoVar || gorsel > 0)) { hatalar.push(videoVar ? 'Bir mesaja bir video eklenir.' : 'Görsel eklenmiş mesaja video eklenmez: video 4 kare olarak gider; önce görselleri kaldır.'); continue; }
      const d: DosyaEki = { kimlik: `ek-${Date.now()}-${++ekSayaci}`, ad: f.name, tur: k.tur, boyut: f.size, durum: 'hazirlaniyor', yuzde: 0, adim: k.tur === 'video' ? 'Video bu bilgisayarda işleniyor…' : 'Okunuyor…' };
      dosya.push(d);
      setDosyaEkleri((l) => [...l, d]);
      const bitir = (r: { hata: string } | (MetinEki & { kareler?: { medya: string; veri: string }[] })) => {
        if ('hata' in r) { setDosyaEkleri((l) => l.filter((x) => x.kimlik !== d.kimlik)); if (!(r as { iptal?: boolean }).iptal) bilgiVer(r.hata, 10_000); return; }
        const { kareler, ...ek } = r as MetinEki & { kareler?: { medya: string; veri: string }[] };
        setDosyaEkleri((l) => l.map((x) => (x.kimlik === d.kimlik ? { ...x, durum: 'hazir', yuzde: 100, adim: undefined, ek: { ad: ek.ad, tur: ek.tur, metin: ek.metin, ...(ek.kisaltildi ? { kisaltildi: true } : {}), ...(ek.toplam ? { toplam: ek.toplam } : {}), ...(ek.kareSayisi ? { kareSayisi: ek.kareSayisi } : {}) }, ...(kareler?.length ? { kareler } : {}) } : x)));
      };
      const kopru = window.fuber;
      const is = k.tur === 'video' ? kopru.videoHazirla?.(f, d.kimlik) : kopru.ekHazirla?.(f);
      if (!is) { bitir({ hata: 'Dosya eki bu pencerede kullanılamıyor.' }); continue; }
      void is.then(bitir, (e: unknown) => bitir({ hata: `${f.name} okunamadı: ${(e as Error)?.message ?? e}` }));
    }
    if (hatalar.length) bilgiVer(hatalar.length > 1 ? `${hatalar[0]} (+${hatalar.length - 1} dosya daha eklenmedi)` : hatalar[0], 10_000);
    else { bilgiSayaci.iptal(); setBilgi(''); } // eski ret satırı yeni (kabul edilen) ekin yanında kalmasın
  };
  const hazirlaniyor = dosyaEkleri.some((d) => d.durum === 'hazirlaniyor');

  const yolla = () => {
    if (motorDurdu || calisiyor || (!metin.trim() && !ekler.length && !dosyaEkleri.length)) return;
    if (hazirlaniyor) { bilgiVer('Ek hazırlanıyor; bitince gönder.'); return; }
    const m = metin, e = ekler, d = dosyaEkleri;
    const metinEkleri = d.map((x) => x.ek).filter((x): x is MetinEki => Boolean(x));
    const tumGorseller = [...e, ...d.flatMap((x) => x.kareler ?? [])];
    const kaynak = sesle.current ? 'ses' : undefined;
    sesle.current = false;
    void gonder(m, tumGorseller.length ? tumGorseller : undefined, kaynak, metinEkleri.length ? metinEkleri : undefined).then((alindi) => {
      // Alınmadıysa (sohbet meşgul) yazılan ve ekler kaybolmasın.
      if (!alindi) { setMetin((x) => x || m); setEkler((x) => (x.length ? x : e)); setDosyaEkleri((x) => (x.length ? x : d)); sesle.current = kaynak === 'ses'; }
    });
    setMetin(''); setEkler([]); setDosyaEkleri([]);
  };

  /** `sure`: uzun satırlar (kurulum boyutu) okunabilsin diye uzatılabilir. Tek sayaç: eski süre yeni uyarıyı erken silmez. */
  const bilgiVer = (m: string, sure = 5000) => { setBilgi(m); bilgiSayaci.kur(() => setBilgi(''), sure); };
  /** Dikte yolu yok (0.13 T10): tek satır; kurulum boyutu/yüzdesi okunabilsin diye uzun kalır. Düşmüş yerel kurulumda (İş kipi) tek "Yeniden dene" görünür. */
  const yokSoyle = (d: { satir: string; yenidenDene?: true }) => { bilgiVer(d.satir, d.yenidenDene ? 20_000 : 12_000); setYenidenSatiri(d.yenidenDene ? d.satir : ''); };
  const yenidenDene = () => { void dikteYeniden().then(yokSoyle); };

  const mikrofon = async () => {
    if (dikteRef.current) { dikteRef.current.bitir(); return; }
    if (mikrofonKapali) return; // düğme zaten gizli (A6)
    sustur?.(); // kullanıcı konuşacak: Fuber'in sesi susar
    let oturum: DinlemeOturumu | null = null;
    try {
      // Önce yazıya çevirecek bir yol var mı (yoksa mikrofon hiç açılmaz; Vosk'a dönülmez, tek satır söylenir — yerel kipte Whisper kurulumu da başlar).
      oturum = await dinlemeAc((m) => { if (!sokuldu.current) setCanli(m); }).catch(() => null);
      if (!oturum) { yokSoyle(await dikteYokSatiri()); return; }
      const akis = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      // İzin beklenirken bileşen söküldü ya da mikrofon tamamen kapatıldı: kayıt hiç başlamaz.
      if (sokuldu.current || mikrofonKapaliRef.current) { akis.getTracks().forEach((t) => t.stop()); oturum.iptal(); return; }
      const o = oturum;
      const ctx = new AudioContext();
      const akitmayiKes = ornekAkit(ctx, ctx.createMediaStreamSource(akis), (x, hz) => o.besle(x, hz));
      const kapat = () => { akitmayiKes(); akis.getTracks().forEach((t) => t.stop()); void ctx.close(); dikteRef.current = null; if (!sokuldu.current) { setKayit(false); setCanli(''); } };
      dikteRef.current = {
        bitir: () => {
          kapat();
          bilgiSayaci.iptal(); setBilgi('yazıya çevriliyor…');
          void o.bitir().catch(() => ({ metin: null })).then((r: { metin: string | null; uyari?: string }) => {
            if (sokuldu.current) return;
            setBilgi('');
            const yazi = r.metin;
            if (yazi) { setMetin((m) => (m ? `${m} ${yazi}` : yazi)); sesle.current = true; alan.current?.focus({ preventScroll: true }); }
            // Yazıya çevirme düştü (anahtar/bağlantı; düzeltme 6): sessiz kalmaz — tek satır.
            if (r.uyari) bilgiVer(r.uyari);
          });
        },
        iptal: () => { kapat(); o.iptal(); }, // mikrofon kapatıldı / sayfa değişti: ses yazıya çevrilmez
      };
      setKayit(true);
    } catch (e) {
      oturum?.iptal();
      // İzin reddi / mikrofon yok: getUserMedia fırlatır. Ham ileti ("Permission denied") gösterilmez (A6).
      const ad = (e as Error)?.name;
      bilgiVer(ad === 'NotAllowedError' || ad === 'SecurityError'
        ? 'Mikrofon izni yok ya da mikrofon kapalı (sol menüdeki mikrofon düğmesi).'
        : ad === 'NotFoundError' || ad === 'OverconstrainedError' ? 'Bu bilgisayarda kullanılabilir bir mikrofon bulunamadı.'
        : ad === 'NotReadableError' ? 'Mikrofon başka bir uygulamada kullanılıyor; birazdan yeniden dene.'
        : 'Mikrofon açılamadı; birazdan yeniden dene.');
    }
  };

  return (
    // Motor yok (Ruling K): yazı alanı, ek, sesle yazma ve gönder kapalı (ada gibi); yazılmış taslak silinmez, motor gelince açılır.
    // 0.10 Görev 2 (A-3): kırmızı kenar yalnız çalışan bağlantı koptuysa ('durdu'); hiç bağlanmamışken sakin ('kapali').
    <div className="yazici" data-motor={motorDurdu ? (motorKirmizi ? 'durdu' : 'kapali') : undefined} data-suruklenen={suruklenen ? '' : undefined}
      onDragOver={(e) => { if (!motorDurdu && e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!suruklenen) setSuruklenen(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSuruklenen(false); }}
      onDrop={(e) => { setSuruklenen(false); if (motorDurdu || !e.dataTransfer.files.length) return; e.preventDefault(); dosyalariAl([...e.dataTransfer.files]); }}>
      {(canli || bilgi) && <div className="cok-soluk" data-dikte-canli={canli ? '' : undefined} style={{ fontSize: 12, padding: '0 6px 6px' }}>{canli ? `“${canli}”` : bilgi}{!canli && bilgi && bilgi === yenidenSatiri && <> <button type="button" className="dgm dgm--beyaz dgm--k" onClick={yenidenDene}>Yeniden dene</button></>}</div>}
      <div className="yazici__kutu">
        {!!ekler.length && (
          <div className="yazici__ekler">
            {/* × : görünen 22 px daire, tıklama alanı 32 px (Görev 20b, K8). */}
            {ekler.map((e, i) => <div key={i} className="yazici__ek"><img src={`data:${e.medya};base64,${e.veri}`} alt={`Ek ${i + 1}`} /><button type="button" aria-label="Eki kaldır" title="Eki kaldır" onClick={() => setEkler((x) => x.filter((_, j) => j !== i))}><span aria-hidden="true">×</span></button></div>)}
          </div>
        )}
        {!!dosyaEkleri.length && (
          <div className="yazici__dosyalar" aria-label="Eklenen dosyalar">
            {dosyaEkleri.map((d) => (
              <div key={d.kimlik} className="ek-cip ek-cip--yazici" data-tur={d.tur} data-durum={d.durum} title={d.ek?.kisaltildi ? `${d.ad}: uzun; ilk kısmı gönderilecek` : d.ad}>
                <Ikon ad={d.tur === 'video' ? 'oynat' : 'dosya'} olcu={13} />
                <span className="ek-cip__ad">{d.ad}</span>
                <span className="ek-cip__bilgi">{d.durum === 'hazirlaniyor' ? (d.adim ?? 'Hazırlanıyor…') : d.tur === 'video' ? `${d.kareler?.length ?? 0} kare${/Konuşma yazısı yok/.test(d.ek?.metin ?? '') ? ' · yazı yok' : ' + yazı'}` : `${ekBoyutMetni(d.boyut)}${d.ek?.kisaltildi ? ' · kısaltıldı' : ''}`}</span>
                {d.durum === 'hazirlaniyor' && <span className="ek-cip__cubuk" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(0.03, (d.yuzde ?? 0) / 100)})` }} /></span>}
                <button type="button" aria-label="Eki kaldır" title="Eki kaldır" onClick={() => {
                  // İnceleme I2: işlenmekte olan videonun çipi kaldırılınca iş de durur (sıradaysa başlamaz, gizli pencere kapanır).
                  if (d.tur === 'video' && d.durum === 'hazirlaniyor') void window.fuber.videoIptal?.(d.kimlik);
                  setDosyaEkleri((x) => x.filter((y) => y.kimlik !== d.kimlik));
                }}><span aria-hidden="true">×</span></button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={alan} rows={1} value={metin} disabled={motorDurdu} aria-label="Fuber'e yaz"
          placeholder={motorDurdu ? yerTutucu : 'Fuber’e yaz… (Enter gönderir)'}
          onChange={(e) => { setMetin(e.target.value); if (!e.target.value.trim()) sesle.current = false; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); yolla(); } }}
          onPaste={(e) => {
            // Görsel ya da dosya yapıştırılınca ek olur (metin varsa metin de yazılır); yapıştırılan dosya da aynı denetimden geçer.
            const dosyalar = [...e.clipboardData.files];
            if (!dosyalar.length) { for (const it of e.clipboardData.items) if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) dosyalar.push(f); } }
            if (!dosyalar.length) return;
            if (!e.clipboardData.getData('text/plain')) e.preventDefault();
            dosyalariAl(dosyalar);
          }}
        />
        <div className="yazici__alt">
          <input ref={dosya} type="file" accept={SECICI_KABUL} multiple hidden data-ek-secici="" onChange={(e) => { dosyalariAl([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <button className="dgm dgm--hayalet dgm--k dgm--simge" title="Dosya ekle: görsel, PDF, Office, metin, kod ya da video (sürükleyip bırakabilirsin)" aria-label="Dosya ekle" disabled={motorDurdu} onClick={() => dosya.current?.click()}><Ikon ad="ek" olcu={16} /></button>
          {/* A6: mikrofon tamamen kapalıyken "Sesle yaz" yok. B5: motor düşerse süren kayıt yine durdurulabilir (yalnız yeni kayıt kapalı). */}
          {!mikrofonKapali && <button className="dgm dgm--hayalet dgm--k dgm--simge mikrofon" data-acik={Boolean(kayit)} title={kayit ? 'Kaydı bitir' : 'Sesle yaz'} disabled={Boolean(motorDurdu) && !kayit} onClick={() => void mikrofon()}><Ikon ad="mikrofon" olcu={16} /></button>}
          <span style={{ flex: 1 }} />
          {/* Yanıt okunurken (tur bitmiş olsa da): Sustur — ses anında susar, yazı kalır. */}
          {konusuyor && !calisiyor && <button className="dgm dgm--koyu dgm--k" data-sustur="" onClick={sustur}><Ikon ad="dur" olcu={14} />Sustur</button>}
          {calisiyor
            ? <button className="dgm dgm--koyu dgm--k" onClick={durdur}><Ikon ad="dur" olcu={14} />Durdur</button>
            : <button className="dgm dgm--beyaz dgm--k dgm--simge" data-gonder="" disabled={motorDurdu || hazirlaniyor || (!metin.trim() && !ekler.length && !dosyaEkleri.length)} onClick={yolla} title={hazirlaniyor ? 'Ek hazırlanıyor' : 'Gönder'}><Ikon ad="gonder" olcu={16} /></button>}
        </div>
      </div>
    </div>
  );
}
