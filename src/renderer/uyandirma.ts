// ── Uyandırma kapısı (0.13 T8): "Hey Fuber" — cihazda anahtar sözcük algılama; ses bu makineden çıkmaz ─────────────────────────────────
// Motor sherpa-onnx WASM'ıdır ve bir işçide koşar (uyandirma-isci.ts); bu dosya motorun önündeki kapıdır: 16 kHz'e indirme, iki uyanma
// arasında 1500 ms kilit ve düşme yönetimi. Ölçüm ve seçilen ayar: shared/uyandirma-ayar.ts, scripts/dev/uyandirma/.
// DÜŞME (inceleme 1. tur): sessiz düşüş yok. Motor açılamaz, çöker ya da işçi yanıt vermezse 'dustu' bildirilir (kullanıcıya tek cümle), 30 sn
// sonra BİR kez yeniden denenir; yine düşerse 'vazgecti': ana süreç gün kaydı kapalıysa kulağı kapatır, mikrofon bırakılır (shared kulakKarari).
import { Ornekleyici } from '../shared/pcm.ts';
import type { UyandirmaDurumu } from '../shared/uyandirma-ayar.ts';

export { UYANMA_BOS_MS } from '../shared/konusma-sonu.ts';

const KILIT_MS = 1500;
const HZ = 16000;
const YENIDEN_DENEME_MS = 30_000;
/** Açılışta İLERLEMESİZ geçebilecek süre. Toplam süre değildir: yavaş diskte model saniyelerce okunabilir, okunan her parça süreyi yeniler (işçi
 *  'ilerleme' bildirir); yalnız takılan işçi düşer. Saat tabanlı nabız değil bayt: takılan okumada nabız atmaya devam eder, bu sayaç durur. */
const ACILIS_SESSIZLIK_MS = 45_000;
/** Nöbetçi: ses gittiği hâlde 2 sn'lik NOBET_TUR tur boyunca hiç yanıt yoksa işçi durmuş sayılır. Duvar saati değil tur sayılır: bilgisayar
 *  uykudan dönünce arada geçen süre "yanıt yok" sanılmasın. */
const NOBET_MS = 2_000;
const NOBET_TUR = 5;

export interface UyandirmaMotoru { besle(o: Float32Array): void; kapat(): void }
/** `dustu`: motor açıldıktan SONRA çöktü (WASM hatası, işçi durdu). Açılış hatası sözün reddiyle gelir. */
export type MotorAcici = (bulundu: (anahtar: string) => void, dustu: () => void) => Promise<UyandirmaMotoru>;
export interface UyandirmaBaglami { motorAc?: MotorAcici; simdi?: () => number; durum?: (d: UyandirmaDurumu) => void }
export interface Uyandirici { besle(o: Float32Array, hz: number): void; kapat(): void }

function kismiFloat(pcm: Uint8Array): Float32Array {
  const i = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1);
  const f = new Float32Array(i.length);
  for (let k = 0; k < i.length; k++) f[k] = i[k] / 32768;
  return f;
}

export function uyandiriciKur(baglam: UyandirmaBaglami, olay: () => void): Uyandirici {
  const simdi = baglam.simdi ?? Date.now;
  let motor: UyandirmaMotoru | null = null;
  let kapali = false;
  let denendi = false; // yeniden deneme hakkı tek: kullanıldıysa bir sonraki düşüş vazgeçmedir
  let yeniden: ReturnType<typeof setTimeout> | null = null;
  let dusur: () => void = () => undefined;
  let son = -Infinity;
  let ornekleyici: Ornekleyici | null = null;

  const bulundu = () => {
    if (kapali) return;
    const t = simdi();
    if (t - son < KILIT_MS) return;
    son = t;
    olay();
  };
  const dustu = () => {
    motor?.kapat();
    motor = null;
    if (denendi) { baglam.durum?.('vazgecti'); return; }
    denendi = true;
    baglam.durum?.('dustu');
    yeniden = setTimeout(ac, YENIDEN_DENEME_MS);
  };
  const ac = () => {
    yeniden = null;
    // Deneme başına tek düşme: eski işçinin geç gelen hatası yeniden açılan sağlam motoru düşürmesin; aynı işçi iki kez hata verirse de bir kez sayılır.
    let bitti = false;
    const buDustu = () => { if (bitti || kapali) return; bitti = true; dustu(); };
    dusur = buDustu;
    (baglam.motorAc ?? isciMotoru)(bulundu, buDustu).then((m) => {
      if (kapali || bitti) { m.kapat(); return; }
      motor = m;
      baglam.durum?.('calisiyor'); // ilk açılış dahil: ana süreçteki eski 'vazgecti' yeni pencerede bayat kalmasın
    }, buDustu);
  };
  ac();

  return {
    // Hiç atmaz: kulakta bu çağrıdan sonra gün kaydı satırları gelir; motor hatası onları atlatmamalı.
    besle(o, hz) {
      if (!motor) return;
      try {
        if (ornekleyici?.girisHz !== hz) ornekleyici = new Ornekleyici(hz, HZ);
        motor.besle(kismiFloat(ornekleyici.donustur(o)));
      } catch { dusur(); }
    },
    kapat() {
      kapali = true;
      if (yeniden) clearTimeout(yeniden);
      yeniden = null;
      motor?.kapat();
      motor = null;
    },
  };
}

/** Worker'ın kullandığımız yüzü (testte elle sürülür). */
export interface IsciBenzeri {
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(v: unknown, aktar?: Transferable[]): void;
  terminate(): void;
}

const gercekIsci = (): IsciBenzeri => new Worker(new URL('./uyandirma-isci.ts', import.meta.url)) as unknown as IsciBenzeri;

/** Tarayıcıdaki motor: işçi açılır, sesi aktarımla (kopyasız) alır. Takılan işçiyi açılışta ilerleme süresi, çalışırken nöbetçi yakalar. */
export function isciMotoru(bulundu: (anahtar: string) => void, dustu: () => void, isciAc: () => IsciBenzeri = gercekIsci): Promise<UyandirmaMotoru> {
  return new Promise((coz, red) => {
    const isci = isciAc();
    let acildi = false, bitmis = false;
    let gonderilen = 0, islenen = 0, oncekiIslenen = 0, sessizTur = 0;
    let nobet: ReturnType<typeof setInterval> | null = null;
    let acilis: ReturnType<typeof setTimeout> | null = null;
    const durdur = () => {
      bitmis = true;
      if (acilis) clearTimeout(acilis);
      if (nobet) clearInterval(nobet);
      nobet = null;
      isci.terminate();
    };
    const bitti = (neden?: string) => {
      if (bitmis) return;
      durdur();
      if (acildi) dustu(); else red(new Error(neden));
    };
    const ilerledi = () => {
      if (acilis) clearTimeout(acilis);
      acilis = setTimeout(() => bitti('işçi açılışta ilerlemiyor'), ACILIS_SESSIZLIK_MS);
    };
    ilerledi();
    const nobetTuru = () => {
      const bosta = islenen >= gonderilen; // soru yakalanırken ses gitmez: işçinin susması düşme değildir
      sessizTur = bosta || islenen !== oncekiIslenen ? 0 : sessizTur + 1;
      oncekiIslenen = islenen;
      if (sessizTur >= NOBET_TUR) bitti('işçi yanıt vermiyor');
    };
    const motor: UyandirmaMotoru = {
      besle: (o) => {
        if (bitmis) return;
        gonderilen++;
        isci.postMessage({ tur: 'ses', o }, [o.buffer]);
      },
      kapat: () => { if (!bitmis) durdur(); },
    };
    isci.onmessage = (e: MessageEvent<{ tur: string; anahtar?: string; hata?: string }>) => {
      if (e.data.tur === 'islendi') islenen++;
      else if (e.data.tur === 'ilerleme') { if (!acildi) ilerledi(); }
      else if (e.data.tur === 'hazir') {
        acildi = true;
        if (acilis) clearTimeout(acilis);
        nobet = setInterval(nobetTuru, NOBET_MS);
        coz(motor);
      } else if (e.data.tur === 'bulundu' && e.data.anahtar) bulundu(e.data.anahtar);
      else if (e.data.tur === 'hata') bitti(e.data.hata);
    };
    isci.onerror = (e) => bitti(e.message);
    isci.postMessage({ tur: 'ac' });
  });
}
