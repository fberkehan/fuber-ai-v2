// ── Yerel model kataloğunun sözleşmesi (0.13 G; saf) — barındırılan servisin kataloğu bu biçimdedir (bu sürümde yok), masaüstü okur ──

export type Calistirici = 'prism' | 'ana';

export interface KatalogKaydi {
  /** Bonsai'de eski YerelModelAdi ('bonsai2-27b'); yeni kayıtta dosya adından türer. */
  id: string;
  /** Hugging Face deposu: 'sahip/depo'. İndirme adresi depo + dosyadan kurulur. */
  hfRepo: string;
  /** Deponun kökündeki .gguf dosyası. */
  dosya: string;
  /** Developer mode kartındaki ad. */
  ad: string;
  /** Business mode kartındaki tek satır: model ya da marka adı içermez. */
  ozet: string;
  /** Bayt; Hugging Face'ten. */
  boyut: number;
  /** Dosyanın SHA-256'sı (Hugging Face `lfs.oid`); indirme bununla doğrulanır. */
  sha256: string;
  /** İşlemcide çalışması için toplam bellek. */
  ramGB: number;
  /** Ekran kartında hızlı çalışması için bellek. Yoksa model işlemcide de rahattır. */
  vramGB?: number;
  /** Lisansın adı; Hugging Face belirtmemişse boş. */
  lisans: string;
  /** Kapalı kayıt masaüstüne gelmez; indirilmiş model silinmez. */
  acik: boolean;
  /** Listedeki sıra, küçük önce. */
  sira: number;
  /** Yoksa masaüstü karar verir. */
  calistirici?: Calistirici;
}
