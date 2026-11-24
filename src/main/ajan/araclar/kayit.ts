// ── Araç kaydı ───────────────────────────────────────────────────────────────────────────────────────────────
// Risk düzeyleri:
//   serbest  — okuma, hafıza, hatırlatıcı, kokpit: doğrudan çalışır.
//   onay     — başkasına giden her şey (e-posta, WhatsApp) ve izinli klasör dışı dosya: HER SEFERİNDE sorulur.
//   kontrol  — fare/klavye/ekran: görev başına bir kez sorulur ("bu görev için izin ver"). Fuber Tarayıcı'da (0.14 T15) tıklama/yazma/seçme/tuş
//              taslaktır, onaysız; yalnız sayfadan algılanan GÖNDERİM (form gönderme, satın alma, silme) ve her indirme HER SEFERİNDE sorulur.
// Girdi ÖNCE şemaya göre doğrulanır (akışla gelen araç girdisi kesik olabilir); geçmezse araç çalışmaz, modele
// hata döner.
import type { AracTanim } from '../../motor/tipler.js';
import type { OnayKarari } from '../../olaylar.js';
import type { OnayIstegi } from '../../../shared/tipler.js';

export interface AracSonucu {
  icerik: string;
  gorseller?: { medya: string; veri: string }[];
  ozet?: string; // arayüzdeki araç kartında görünen kısa sonuç
  /** Kartın "aç" hedefi (ana pencere yolu, ör. 'claude#cc-<oturum>'; Görev 28 düzeltme 1). */
  yol?: string;
  hata?: boolean;
  /** Bu turun kalanında modele açılacak yeni araçlar (ör. mcp_kullan). */
  yeniAraclar?: Arac[];
}

export interface AracBaglami {
  sohbetId: number;
  sinyal: AbortSignal;
  /** `tur`/`gorev` (0.11 G9): Görev başlatma onayı (is_baslat; shared/tipler.ts OnayIstegi). */
  onay: (istek: { baslik: string; aciklama: string; onizleme?: string; tehlike: 'dusuk' | 'orta' | 'yuksek'; gorevBoyu?: boolean } & Pick<OnayIstegi, 'tur' | 'gorev'>) => Promise<OnayKarari>;
  gorevIzinleri: Set<string>;
  /** Tur telefondan geldi (B3): gizlilik araçları yalnız daraltır (gun_kaydi_duraklat yalnız duraklatır/uzatır). */
  uzak?: boolean;
  /** Tur kendiliğinden (proaktif) başladı: kullanıcı masada olmayabilir (düzeltme turu 2: hafıza silmesi onay ister). */
  proaktif?: boolean;
}

export interface Arac {
  tanim: AracTanim;
  risk: 'serbest' | 'onay' | 'kontrol';
  grup: string; // 'hafiza' | 'plan' | 'kokpit' | 'eposta' | 'whatsapp' | 'tarayici' | 'bilgisayar' | 'dosya' | 'mcp'
  /** 0.11 G9: yalnız bilgisayarın başında (telefondan gelen turda sunulmaz; araç kendisi de reddeder). */
  yalnizMasada?: boolean;
  /** 0.14 T13: MCP aracının servisi (grup 'mcp'). Araç listesi 256'yı aşarsa servis bütün olarak dışarıda kalır ve adıyla `mcp_kullan` notuna yazılır
   *  (ajan/zincir.ts araclariSirala). `katalog`: Fuber kataloğundan bağlı servis — her turda listede (ilgililik süzgeci yok) ve Developer'ın kendi
   *  sunucularından önce sıralanır. Yoksa servis adı araç adından (`mcp__<servis>__<araç>`) çıkarılır. */
  mcp?: { servis: string; katalog?: boolean };
  /** 0.14 T16: girdinin doğrulandığı şema, sağlayıcıya giden `tanim.sema`dan farklıysa (MCP aracı: sağlayıcıya tür dizisi, anyOf/oneOf/allOf'suz
   *  düzleşmiş şema gider; doğrulama servisin özgün şemasıyla yapılır — düzleştirmede seçilmeyen tür reddedilmesin). Yoksa `tanim.sema`. */
  dogrulamaSemasi?: Record<string, unknown>;
  etiket: (girdi: Record<string, unknown>) => string;
  calistir: (girdi: Record<string, unknown>, b: AracBaglami) => Promise<AracSonucu>;
}

const araclar = new Map<string, Arac>();
const saglayicilar: (() => Arac[])[] = []; // dinamik araçlar (MCP)

export function aracKaydet(...a: Arac[]): void { for (const x of a) araclar.set(x.tanim.ad, x); }
export function dinamikAracKaynagi(f: () => Arac[]): void { saglayicilar.push(f); }

export function tumAraclar(): Arac[] {
  const out = [...araclar.values()];
  for (const f of saglayicilar) { try { out.push(...f()); } catch { /* kaynak hazır değil */ } }
  return out;
}
export function aracBul(ad: string): Arac | undefined {
  return araclar.get(ad) ?? tumAraclar().find((a) => a.tanim.ad === ad);
}

// ── Basit JSON Schema doğrulayıcı (type/required/enum/items/properties) ────────────────────────────────────
type Sema = { type?: string | string[]; properties?: Record<string, Sema>; required?: string[]; enum?: unknown[]; items?: Sema };

export function dogrula(sema: Sema, deger: unknown, yol = 'girdi'): string | null {
  if (deger === undefined || deger === null) return null;
  const tipler = Array.isArray(sema.type) ? sema.type : sema.type ? [sema.type] : [];
  if (tipler.length) {
    const ok = tipler.some((t) =>
      t === 'string' ? typeof deger === 'string'
      : t === 'number' ? typeof deger === 'number' && Number.isFinite(deger)
      : t === 'integer' ? Number.isInteger(deger)
      : t === 'boolean' ? typeof deger === 'boolean'
      : t === 'array' ? Array.isArray(deger)
      : t === 'object' ? typeof deger === 'object' && !Array.isArray(deger)
      : true);
    if (!ok) return `${yol} ${tipler.join('|')} olmalı`;
  }
  if (sema.enum && !sema.enum.includes(deger)) return `${yol} şunlardan biri olmalı: ${sema.enum.join(', ')}`;
  if (Array.isArray(deger) && sema.items) {
    for (let i = 0; i < deger.length; i++) { const h = dogrula(sema.items, deger[i], `${yol}[${i}]`); if (h) return h; }
  }
  if (typeof deger === 'object' && !Array.isArray(deger)) {
    const o = deger as Record<string, unknown>;
    if ('__gecersiz_json' in o) return `${yol} geçerli JSON değil`;
    for (const r of sema.required ?? []) if (o[r] === undefined || o[r] === null || o[r] === '') return `${yol}.${r} zorunlu`;
    for (const [k, s] of Object.entries(sema.properties ?? {})) { const h = dogrula(s, o[k], `${yol}.${k}`); if (h) return h; }
  }
  return null;
}

/** Kısa yardımcı: nesne şeması. */
export function sema(properties: Record<string, Sema & { description?: string }>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false };
}

export const metinKisalt = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
