// İş modu dili (Ruling O, Görev 20a): src/shared/is-dili.ts — İş yüzeylerinde geçmemesi gereken teknik sözcükler. Önizleme betikleri de
// bu düzenli ifadeyi kullanır; burada neyi yakaladığı ve neyi (sade karşılıkları) bıraktığı sınanır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IS_YASAK, isDiliIhlali, isDiliSozcukleri, isYasakDeseni } from '../src/shared/is-dili.ts';

test('yakalar: API, anahtar, model, token, sağlayıcı ve model adları, adres', () => {
  for (const m of [
    'Claude API anahtarı kayıtlı değil', 'Kendi anahtarımı bağla', 'ana modele gider', 'token yemesin', 'OpenAI', 'Anthropic',
    'OpenRouter', 'Claude Opus', 'Fuber gateway', 'Haiku', 'GPT-5.5', 'Yerel (Bonsai)', 'Whisper large-v3-turbo', 'Vosk tanıyıcısı',
    'gateway köprümüz', 'api.ornek.example', 'yerel model',
    // 0.10 Görev 2 (D2): iç yol haritası ve geliştirme dili İş'te yok — geri dönmesin.
    'Faz 1’de', 'Faz 1’de', 'Faz1', 'Önizleme — ödeme alınmaz', 'Geliştirici moduna geç', 'Stripe ile açılır', 'taslak fiyat',
    'kullanım payı (taslak)', 'satış sürümünde', 'Fatura önizlemesi',
    // 0.10 Görev 3 (P2 sözlüğü): "beyin" mecazı (3B beyin kalktı), "motor" (yalnız Geliştirici), donanım/sürüm kodu, Electron kısayol yazımı,
    // iç terimler (Proaktif, ajan, döküm) ve Pano'nun teknik açıklamaları (IP, lisans kısaltması, koordinat) İş'te yok.
    'Fuber bulut beyni', 'Yerel beyin', 'Fuber’in beyni bağlanınca', 'bir beyne ihtiyacım var', 'hangi beynin', 'bu bilgisayardaki beyin',
    'Yapay zekâ motoru durdu', 'NVIDIA yok', 'Windows 11 (22H2 ve üstü)', 'CommandOrControl+Shift+Space',
    'Proaktif Fuber', 'Ajanlar — Not tutucu', 'Her ajanın son çalışması', 'dinleme → döküm → not', 'IP adresinden aranmaz', 'CC BY 4.0',
    'yaklaşık koordinatı', 'IP: 10.0.0.4', 'konum (IP) üzerinden', 'beyninde',
  ]) assert.match(m, IS_YASAK, m);
});

test('bırakır: sade karşılıklar ve olumsuz biçim', () => {
  for (const m of [
    'Fuber köprüsü', 'anahtarsız çalışır', 'Bu ay 42 yanıt', 'Telefon eşle', 'Yalnız gündelik sohbet', 'kapitalist', 'tokat',
    // 0.10 Görev 2: yeni sade metinler (R16: "Fuber’i bağla" → Fuber hesabı); "taslak" yalnız fiyat/pay bağlamında yasak.
    'Fuber’i bağla', 'Fuber henüz bağlı değil', 'Fuber hesabına giriş yap', 'Planlar yakında', 'e-posta taslağını düzenle', 'Gösterimi bitir',
    'Fuber’in yapay zekâsı', 'Hesabın onay bekliyor. Onaylanınca Fuber hemen açılır.',
    // 0.10 Görev 3: sözlüğün İş karşılıkları; "ajanda", "beyaz" ve "Bey" hitabı sözcük sınırıyla ayrılır.
    'bu bilgisayardaki yapay zekâ', 'Gün kaydı', 'ajanda', 'Ctrl+Shift+Boşluk', 'beyaz tema', 'Deniz Bey’e', 'Fuber kendiliğinden yazsın',
    'Not tutma ve raporlar', 'yazıya dökülen konuşma', 'Takip edilecekler', 'Gizli moddayken alınan notlar', 'ipucu',
    // Düzeltme turu 1 (R30): JS'te \b yalnız ASCII ve i bayrağı "ip"i de tutar — Türkçe harfle biten sözcükler ("geçip": ç sözcük
    // karakteri sayılmıyordu) ve küçük "ip" yakalanmaz; "koordinatör" ve "beynelmilel" de değil.
    'geçip', 'seçip', 'içip', 'eğip', 'pişip', 'Kaydı seçip sil', 'bir ip ucu', 'koordinatör', 'Proje koordinatörü', 'beynelmilel',
  ]) assert.doesNotMatch(m, IS_YASAK, m);
  // Önizleme betikleri ve isDiliIhlali deseni `source` + kendi bayraklarıyla yeniden kurar: aynı sonuç.
  for (const m of ['geçip gitti', 'Proje koordinatörü', 'beynelmilel hukuk']) assert.equal(isDiliIhlali(m), null, m);
  assert.deepEqual(isDiliSozcukleri('IP adresi; geçip seçip'), ['ip']);
  assert.equal(new RegExp(IS_YASAK.source, 'gi').test('içip'), false);
  // Kip değiştiricisini tanımayan eski motorun yedek deseni: Türkçe harf sınırı aynı, yalnız küçük "ip" de sayılır (bilinen sınır).
  const yedek = isYasakDeseni(false);
  for (const m of ['geçip', 'seçip', 'koordinatör', 'beynelmilel']) assert.doesNotMatch(m, yedek, m);
  for (const m of ['IP adresinden aranmaz', 'konum (IP) üzerinden', 'Yerel beyin']) assert.match(m, yedek, m);
});

// Görev 21 düzeltme turu 5 (N3): Raporlar (Hafıza → Raporlar) mod kapısı olmadan iki modda da görünür — ekran metinleri (JSX metni ve
// tek tırnaklı yazılar) İş dilinde olmalı ("Model çalışıyor…" değil).
test('Raporlar ekran metinleri İş dilinde (mod kapısı yok)', async () => {
  const { readFileSync } = await import('node:fs');
  const kaynak = readFileSync(new URL('../src/renderer/bilesenler/Raporlar.tsx', import.meta.url), 'utf8').replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
  const metinler = [...kaynak.matchAll(/>([^<>{}]*\p{L}[^<>{}]*)</gu)].map((m) => m[1]).concat([...kaynak.matchAll(/'([^'\n]*\s[^'\n]*)'/g)].map((m) => m[1]));
  assert.ok(metinler.some((m) => /10–60 sn/.test(m)), 'bekleme yazısı bulunamadı');
  for (const m of metinler) assert.equal(isDiliIhlali(m), null, m);
});

test('ihlal metni: ilk eşleşme ve çevresi; yoksa null', () => {
  assert.equal(isDiliIhlali('Her şey yolunda.'), null);
  assert.match(isDiliIhlali('Bağlantı gateway köprümüz üzerinden, uçtan uca şifreli.') ?? '', /gateway köprümüz/);
  assert.deepEqual(isDiliSozcukleri('OpenAI, OpenRouter ve tekrar OpenAI'), ['openai', 'openrouter']);
});
