// ── Kullanım biçimi (mod, K2) başlangıcı — saf; birim testli: tests/kullanim-bicimi.test.ts ──────────────────────────────
// Denetleyici kararı G: kayıtlı `mod` yoksa (0.7.0'dan yükselen profil) bağlı bir yapay zekâ anahtarı ya da açık Claude Code bu
// profilin Geliştirici gibi kullanıldığını gösterir → 'gelistirici'; yoksa 'is'. Kayıtlı geçerli mod olduğu gibi kalır, bozuk değer
// 'is'. Profil dosyası hiç yoksa (yeni kurulum) 'is' (mod kurulum sihirbazında seçilir). Ana süreç (main/ayarlar.ts) HAM dosya
// değerini verir: derin birleştirme eksik alanı varsayılan 'is' ile doldurduğundan karar ondan önce verilir. Bir kez kaydedilince
// mod dosyaya yazılır, bu kural bir daha çalışmaz.
import type { Mod } from './tipler.ts';

export interface ProfilIzleri {
  /** ayarlar.json okunabildi (yeni kurulum değil). */
  profilVar: boolean;
  /** En az bir yapay zekâ sağlayıcısının anahtarı kayıtlı. */
  anahtarVar: boolean;
  /** Dosyada claudeCode.etkin === true. */
  claudeCodeEtkin: boolean;
}

export function baslangicModu(kayitli: unknown, iz: ProfilIzleri): Mod {
  if (kayitli === 'is' || kayitli === 'gelistirici') return kayitli;
  if (kayitli !== undefined) return 'is';
  if (!iz.profilVar) return 'is';
  return iz.anahtarVar || iz.claudeCodeEtkin ? 'gelistirici' : 'is';
}
