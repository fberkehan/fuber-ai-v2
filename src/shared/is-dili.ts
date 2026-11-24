// ── İş modu dili: kullanıcıya görünen İş metninde geçmemesi gereken teknik sözcükler (saf; birim testli: tests/is-dili.test.ts) ──
// K2 (Görev 10) ve Ruling O (Görev 20a): İş modunda API, anahtar, model, token, sağlayıcı adları (OpenAI, Anthropic, OpenRouter, Claude,
// gateway), model aileleri (Opus, Sonnet, Haiku, GPT, Bonsai) ve konuşma tanıyıcılarının adları (Whisper, Vosk)
// görünmez. Sade karşılıklar (tek sözlük: shared/terimler.ts TERIM): "Fuber’in yapay zekâsı", "bu bilgisayardaki yapay zekâ", "Fuber
// köprüsü". Önizleme betikleri (ayarlar-onizle, abonelik-onizle, etkinlik-onizle, pano-onizle, ada-onizle, tarayici-onizle,
// ozellik-denetimi) ve birim testleri İş yüzeylerini bununla tarar. "anahtarsız" (anahtar istemeyen) gibi olumsuz biçim yasak değildir;
// bir sunucu adresi yasaktır.
// Görev 21: ses sağlayıcılarının adları (ElevenLabs, Piper, Scribe) da İş metninde yok — "Fuber'in sesi", "yedek ses".
// 0.10 Görev 2 (Karar D2): iç yol haritası ve geliştirme dili de yasak — "Faz 1", "önizleme", "Geliştirici moduna (geç)", "Stripe",
// "taslak fiyat", "(taslak)", "satış sürümü". Sade karşılıklar: "yakında", "gösterim", "Planlar yakında; bu sürümde ödeme alınmaz."
// 0.10 Görev 3 (P2; A-4, C-5, A-58, A-60, D-6): "beyin" mecazı (ünlü düşmesiyle: beyni, beyne, beynin…; "beyaz" ve "Bey" değil), "motor"
// (yalnız Geliştirici), NVIDIA, Windows sürüm kodu (22H2), Electron kısayol yazımı (CommandOrControl), "Proaktif", "ajan(lar)" ("ajanda"
// değil), "döküm", "IP", lisans kısaltması ("CC BY") ve "koordinat" da İş'te yok.
// Düzeltme turu 1 (R30): JS'te `\b` yalnız ASCII harfleri sayar ve `i` bayrağı "IP"yi "ip" de yapar — "geçip", "seçip", "eğip" (ç, ğ, ş
// sözcük karakteri değil) yakalanıyordu. "IP" büyük-küçük harfe DUYARLI ve Türkçe harflerle sınırlı; "koordinatör" ve "beynelmilel" serbest.
// Duyarlılık desen içi kip değiştiriciyle `(?-i:…)`: deseni `source` + kendi bayraklarıyla yeniden kuranlar (isDiliIhlali,
// isDiliSozcukleri, önizleme betikleri) aynı sonucu alır. Bu sözdizimini tanımayan eski motorda (telefonun eski WebView'ı) yedek desen:
// "IP" yine Türkçe harflerle sınırlı (ileri bakışsız: eski motorda geriye bakış da olmayabilir), yalnız büyük-küçük ayrımı yapılmaz.
const HARF = 'A-Za-zÇĞİÖŞÜÂÎÛçğıöşüâîû';
const ORTAK = String.raw`\bAPI\b|\btoken|\bmodel|anahtar(?!s[ıi]z)|OpenAI|Anthropic|OpenRouter|Claude|gateway|\bOpus\b|\bSonnet\b|\bHaiku\b|\bGPT|Bonsai|Whisper|\bVosk\b|ElevenLabs|\bPiper\b|\bScribe\b|Faz\s?\d|önizleme|Geliştirici moduna|Stripe|taslak fiyat|\(taslak\)|satış sürüm|bey(?:in|n(?!elmilel)[aeıiuü])|\bmotor|NVIDIA|22H2|CommandOrControl|Proaktif|\bajan(?:lar)?\b|döküm|CC BY|koordinat(?!ör)`;
/** `kipDegistirici: false` yalnız birim testi için (eski motorun yedek desenini sınar). */
export function isYasakDeseni(kipDegistirici = true): RegExp {
  if (kipDegistirici) try { return new RegExp(`${ORTAK}|(?-i:(?<![${HARF}])IP(?![${HARF}]))`, 'i'); } catch { /* eski motor: yedek desen */ }
  return new RegExp(`${ORTAK}|(?:^|[^${HARF}])IP(?![${HARF}])`, 'i');
}
export const IS_YASAK: RegExp = isYasakDeseni();

/** Metindeki ilk yasak sözcük ve çevresi (rapor için); yoksa null. */
export function isDiliIhlali(metin: string): string | null {
  const m = new RegExp(`.{0,40}(?:${IS_YASAK.source}).{0,40}`, 'i').exec(metin.replace(/\s+/g, ' '));
  return m ? m[0].trim() : null;
}

/** B7 (son düzeltme): sohbet/ada araç kartının özeti. İş modunda başarısız ya da reddedilen adımın ham hatası ("page.goto: net::ERR_…",
 *  şema hatası, sağlayıcı iletisi) görünmez: sade cümle; Geliştirici'de bugünkü ayrıntı. Başarılı adımın özeti değişmez. */
export const ARAC_HATA_IS = 'Bu adım tamamlanamadı.';
export const ARAC_RED_IS = 'Onay verilmedi; bu adım yapılmadı.';
export function aracKartiOzeti(durum: 'calisiyor' | 'tamam' | 'hata' | 'reddedildi', ham: string | undefined, mod: 'is' | 'gelistirici'): string | undefined {
  if (mod === 'gelistirici' || durum === 'tamam' || durum === 'calisiyor') return ham;
  return durum === 'reddedildi' ? ARAC_RED_IS : ARAC_HATA_IS;
}

/** Metindeki bütün yasak sözcükler (tekrarsız, küçük harf; sözcükler İngilizce kökenli: "OpenAI" → "openai", Türkçe "ı" değil). */
export function isDiliSozcukleri(metin: string): string[] {
  return [...new Set((metin.match(new RegExp(IS_YASAK.source, 'gi')) ?? []).map((s) => s.toLowerCase()))];
}
