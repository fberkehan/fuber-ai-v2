// ── Sağlayıcıdan bağımsız mesaj/araç tipleri ─────────────────────────────────────────────────────────────────
// Dört motor (Claude, OpenAI, OpenRouter, Fuber gateway) aynı ara biçimi konuşur. Claude'un düşünme blokları
// yalnız `ham` içinde ve YALNIZ sürmekte olan araç döngüsünde aynen geri gönderilir (preserved thinking: geçmiş
// yalnız sona eklenerek büyür). Önceki turlar düşünmesiz, nötr bloklarla gider — sohbet kırpılsa da 400 almaz.
import type { Efor, SaglayiciAdi } from '../../shared/tipler.js';
import type { ModelBilgisi } from '../../shared/model-bilgisi.js';
import type { AracYolu } from '../../shared/sohbet-protokolu.js';

export type Blok =
  | { tur: 'metin'; metin: string }
  | { tur: 'gorsel'; medya: string; veri: string }
  | { tur: 'arac_cagri'; id: string; ad: string; girdi: Record<string, unknown> }
  | { tur: 'arac_sonuc'; id: string; ad?: string; icerik: string; gorseller?: { medya: string; veri: string }[]; hata?: boolean;
      /** Arayüzde sonuç kartından gidilecek sayfa (ör. claude_code_gorev → 'claude#cc-<oturum>'); modele GİTMEZ. */
      yol?: string };

export interface Ham { saglayici: SaglayiciAdi | 'yerel'; model: string; icerik: unknown }

export interface Mesaj {
  rol: 'user' | 'assistant';
  bloklar: Blok[];
  /** Yalnız sürmekte olan turda ve aynı model için dolu: sağlayıcının kendi içeriği (düşünme blokları dahil). */
  ham?: Ham;
}

export interface AracTanim {
  ad: string;
  aciklama: string;
  sema: Record<string, unknown>; // JSON Schema (object)
}

export type AkisOlayi =
  | { tur: 'metin'; parca: string }
  | { tur: 'dusunce'; parca: string }
  | { tur: 'arac_hazirlaniyor'; ad: string; id: string };

export interface Istek {
  model: string;
  /** Değişmeyen sistem metni (kişilik + kurallar): önbelleğin ilk kırılımı. */
  sistemSabit: string;
  /** Yavaş değişen sistem metni (çekirdek hafıza, araç notları): ikinci kırılım. */
  sistemYari?: string;
  mesajlar: Mesaj[];
  araclar: AracTanim[];
  maxToken?: number;
  efor?: Efor;
  akis?: (o: AkisOlayi) => void;
  sinyal?: AbortSignal;
  /** Claude sunucu tarafı web araması. */
  webArama?: boolean;
  /** Yanıt YALNIZ JSON olmalı (yerel motor dilbilgisiyle zorlar; diğerleri sistem metnine uyar). */
  jsonCikti?: boolean;
  /** Arka plan işleri (hafıza yazımı, kokpit planı): düşünce özeti istenmez, kısa tutulur. */
  arkaPlan?: boolean;
  /** İç yeniden deneme YOK (motor/secici.ts cagirSecimle): yeniden denemesi çağıranın elinde olan iş — içe aktarılan belgenin özeti (cila
   *  düzeltme turu 3, N-10: Fuber ağ geçidinin "boş yanıt"ı yenidenDenenebilir; faturalı çağrı belge başına üçe katlanmasın). */
  tekDeneme?: boolean;
}

export type Durma = 'bitti' | 'arac' | 'limit' | 'ret' | 'duraklat';

export interface Kullanim { giris: number; cikis: number; onbellekOkuma: number; onbellekYazma: number }

export interface Yanit {
  bloklar: Blok[];
  ham: Ham;
  durma: Durma;
  kullanim: Kullanim;
  model: string;
  dusunce?: string;
  /** 0.14: aracın hangi yoldan çağrıldığı (modelin yerel araç çağırması ya da sunucunun/istemcinin metin yedeği). YALNIZ bilgi ve ölçüm:
   *  hiçbir karar buna bağlanmaz (araçlar modelden bağımsızdır, ürün kararı). Fuber dışı sağlayıcılarda yok. */
  aracYolu?: AracYolu;
}

export interface Saglayici {
  ad: SaglayiciAdi;
  sohbet(istek: Istek): Promise<Yanit>;
  modeller(): Promise<string[]>;
  /** Model seçicinin ayrıntılı listesi (bağlam, fiyat, yetenek; main/motor/model-listesi.ts). Yoksa kimlikler + yerleşik tablo. */
  modelBilgileri?(): Promise<ModelBilgisi[]>;
}

export class MotorHatasi extends Error {
  constructor(message: string, readonly kod: 'anahtar' | 'limit' | 'baglanti' | 'istek' | 'bilinmiyor', readonly yenidenDenenebilir = false, readonly durum?: number) {
    super(message);
  }
}

export function metinBirlestir(bloklar: Blok[]): string {
  return bloklar.filter((b): b is Extract<Blok, { tur: 'metin' }> => b.tur === 'metin').map((b) => b.metin).join('');
}
