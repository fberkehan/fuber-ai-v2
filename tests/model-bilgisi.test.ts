// Model bilgisi (saf): sağlayıcı yanıtlarından seçici satırlarına dönüşüm (OpenRouter /models, Anthropic Models API, OpenAI /models),
// yerleşik "yaklaşık" tablo, biçimler (bağlam, fiyat), arama/sıralama ve yerel modelin bu bilgisayara uygunluğu (eşikler).
// Örnek yanıtlar tests/veri/*.json — elle yazılmış, gerçekçi kayıtlar (ağ yok).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openRouterDonustur, anthropicDonustur, openaiDonustur, yerlesikListe, yerlesikBilgi, modelAdi, adGuzellestir, baglamMetni, fiyatMetni, gbMetni, yerelUygunluk, onerilenYerel, modelAra, modelleriSirala, modelleriSuz, listeyiTamamla, yerelMakinesi, listeHatasiMetni, enIyiYerel, type ModelBilgisi, type YerelGereksinim } from '../src/shared/model-bilgisi.ts';
import { ekranKartiBellegi } from '../src/shared/sistem-kontrol.ts';

const oku = (ad: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'veri', ad), 'utf8'));
const bul = (l: ModelBilgisi[], id: string) => { const m = l.find((x) => x.id === id); assert.ok(m, `${id} yok`); return m; };

// ── OpenRouter ──
test('OpenRouter: /models yanıtı satırlara dönüşür (bağlam, $/1M fiyat, yetenekler, üretici)', () => {
  const l = openRouterDonustur(oku('openrouter-modeller.json'));
  const opus = bul(l, 'anthropic/claude-opus-5.5');
  assert.deepEqual(
    { ad: opus.ad, uretici: opus.uretici, saglayici: opus.saglayici, baglam: opus.baglam, giris: opus.girisFiyat, cikis: opus.cikisFiyat, yetenekler: opus.yetenekler },
    { ad: 'Claude Opus 5.5', uretici: 'Anthropic', saglayici: 'openrouter', baglam: 1_000_000, giris: 4, cikis: 20, yetenekler: ['gorsel', 'arac', 'akil'] },
  );
  // Kayan nokta gürültüsü yok: "0.00000015" × 1e6 = 0,15 (0,15000000000000002 değil).
  assert.equal(bul(l, 'openai/gpt-4o-mini').girisFiyat, 0.15);
  assert.equal(bul(l, 'openai/gpt-4o-mini').cikisFiyat, 0.6);
  assert.equal(bul(l, 'qwen/qwen3-235b-a22b-2507').girisFiyat, 0.08);
  // Akıl yürütme yok, araç var; görsel yok.
  assert.deepEqual(bul(l, 'meta-llama/llama-3.3-70b-instruct:free').yetenekler, ['arac']);
  // Görsel girer ama araç yok.
  assert.deepEqual(bul(l, 'google/gemma-3-27b-it:free').yetenekler, ['gorsel']);
});

test('OpenRouter: ücretsiz model 0, bilinmeyen fiyat (-1) boş, görsel üreten model ve bozuk kayıt atlanır', () => {
  const l = openRouterDonustur(oku('openrouter-modeller.json'));
  const bedava = bul(l, 'deepseek/deepseek-r1:free');
  assert.equal(bedava.girisFiyat, 0);
  assert.equal(bedava.cikisFiyat, 0);
  const oto = bul(l, 'openrouter/auto');
  assert.equal(oto.girisFiyat, undefined);
  assert.equal(oto.cikisFiyat, undefined);
  assert.equal(oto.uretici, 'OpenRouter'); // adında "Üretici:" öneki yok → kimliğin önekinden
  assert.ok(!l.some((m) => m.id === 'google/imagen-4'), 'yalnız görsel üreten model sohbet listesinde olmamalı');
  assert.equal(l.length, 29); // 31 kayıt − görsel üreten − kimliksiz
  assert.ok(l.every((m) => m.saglayici === 'openrouter' && m.id && m.ad));
});

test('OpenRouter: dizi ya da {data} kabul eder; modality yalnız metin olarak geldiğinde de görseli anlar; saçma girdi boş liste', () => {
  const l = openRouterDonustur([{ id: 'a/b', name: 'A: B', architecture: { modality: 'text+image->text' }, pricing: { prompt: '0.000001', completion: '0.000002' } }]);
  assert.deepEqual(l[0].yetenekler, ['gorsel']);
  assert.equal(l[0].girisFiyat, 1);
  assert.deepEqual(openRouterDonustur(null), []);
  assert.deepEqual(openRouterDonustur({ data: 'bozuk' }), []);
});

// ── Anthropic ──
test('Anthropic: Models API bağlamı ve yetenekleri canlı, fiyat yerleşik tablodan (yaklaşık); emekli model atlanır', () => {
  const l = anthropicDonustur(oku('anthropic-modeller.json'));
  assert.ok(!l.some((m) => m.id === 'claude-3-5-haiku-20241022'), 'emekli model listede olmamalı');
  const opus = bul(l, 'claude-opus-5-5');
  assert.deepEqual({ ad: opus.ad, baglam: opus.baglam, giris: opus.girisFiyat, cikis: opus.cikisFiyat, yaklasik: opus.yaklasik, yetenekler: opus.yetenekler },
    { ad: 'Claude Opus 5.5', baglam: 1_000_000, giris: 4, cikis: 20, yaklasik: true, yetenekler: ['gorsel', 'arac', 'akil'] });
  assert.equal(bul(l, 'claude-haiku-5-5').girisFiyat, 0.1);
  assert.match(bul(l, 'claude-haiku-5-5').fiyatNotu ?? '', /100 bin token’a kadar/); // kademeli fiyatın koşulu (ipucu)
  assert.equal(bul(l, 'claude-opus-5-5').fiyatNotu, undefined);
  assert.equal(bul(l, 'claude-haiku-4-5').baglam, 200_000);
  // Tabloda olmayan yeni model: yalnız adla (fiyat "—"), bağlam API'den.
  const yeni = bul(l, 'claude-sonnet-6');
  assert.equal(yeni.ad, 'Claude Sonnet 6');
  assert.equal(yeni.girisFiyat, undefined);
  assert.equal(yeni.baglam, 2_000_000);
  assert.equal(yeni.yaklasik, undefined);
});

// ── OpenAI ──
test('OpenAI: /models kimliklerinden yalnız sohbet modelleri; bilgi yerleşik tablodan; tarihli sürüm fiyatı miras almaz', () => {
  const l = openaiDonustur(oku('openai-modeller.json'));
  assert.deepEqual(l.map((m) => m.id), ['gpt-5.5', 'gpt-5.5-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4o', 'gpt-4o-2024-08-06', 'gpt-4o-mini', 'o3', 'o4-mini', 'chatgpt-4o-latest']);
  const g5 = bul(l, 'gpt-5');
  assert.deepEqual({ ad: g5.ad, baglam: g5.baglam, giris: g5.girisFiyat, cikis: g5.cikisFiyat, yaklasik: g5.yaklasik }, { ad: 'GPT-5', baglam: 400_000, giris: 1.25, cikis: 10, yaklasik: true });
  // Tarihli anlık sürüm: adında tarih, yetenekleri ana modelden; fiyat ve bağlam "—" (farklı olabilir, uydurulmaz).
  const tarihli = bul(l, 'gpt-4o-2024-08-06');
  assert.equal(tarihli.ad, 'GPT-4o (2024-08-06)');
  assert.equal(tarihli.girisFiyat, undefined);
  assert.equal(tarihli.cikisFiyat, undefined);
  assert.equal(tarihli.baglam, undefined);
  assert.equal(tarihli.yaklasik, undefined);
  assert.deepEqual(tarihli.yetenekler, ['gorsel', 'arac']);
  assert.equal(yerlesikBilgi('openai', 'gpt-4o-2024-08-06')?.girisFiyat, undefined);
  // Emin olunmayan model: yalnız ad, fiyat ve bağlam yok.
  const g55 = bul(l, 'gpt-5.5');
  assert.equal(g55.ad, 'GPT-5.5');
  assert.equal(g55.girisFiyat, undefined);
  assert.equal(g55.baglam, undefined);
  assert.deepEqual(openaiDonustur(['gpt-4o', 'whisper-1']).map((m) => m.id), ['gpt-4o']); // düz kimlik dizisi de olur
});

test('Ad güzelleştirme: Claude/GPT kimlikleri okunur ada döner; bilinmeyen kimlik olduğu gibi', () => {
  assert.equal(adGuzellestir('claude-opus-4-1-20250805'), 'Claude Opus 4.1');
  assert.equal(adGuzellestir('claude-sonnet-5-5'), 'Claude Sonnet 5.5');
  assert.equal(adGuzellestir('anthropic/claude-haiku-5.5'), 'Claude Haiku 5.5');
  assert.equal(adGuzellestir('claude-3-5-haiku-20241022'), 'Claude Haiku 3.5');
  assert.equal(adGuzellestir('gpt-5.5-mini'), 'GPT-5.5 mini');
  assert.equal(adGuzellestir('o3'), 'o3');
  assert.equal(adGuzellestir('ozel/deneme:free'), 'deneme');
  assert.equal(modelAdi('anthropic', 'claude-opus-5-5'), 'Claude Opus 5.5');
  assert.equal(modelAdi('openrouter', 'ozel/deneme:free'), 'ozel/deneme:free'); // kimlik serbest yazıldıysa kimlik görünür
});

// ── Biçimler ──
test('Bağlam: "200 bin", "1 milyon", "1,5 milyon"; bilinmeyen "—"', () => {
  assert.equal(baglamMetni(200_000), '200 bin');
  assert.equal(baglamMetni(128_000), '128 bin');
  assert.equal(baglamMetni(1_000_000), '1 milyon');
  assert.equal(baglamMetni(1_047_576), '1 milyon');
  assert.equal(baglamMetni(1_500_000), '1,5 milyon');
  assert.equal(baglamMetni(8_192), '8 bin');
  assert.equal(baglamMetni(undefined), '—');
  assert.equal(baglamMetni(0), '—');
});

test('Fiyat ($/1M token): tam sayı yalın, kesirli iki basamak, çok küçük üç basamak; 0 "Ücretsiz", bilinmeyen "—"', () => {
  assert.equal(fiyatMetni(4), '4');
  assert.equal(fiyatMetni(2.5), '2,50');
  assert.equal(fiyatMetni(0.15), '0,15');
  assert.equal(fiyatMetni(0.05), '0,05');
  assert.equal(fiyatMetni(0.0375), '0,038');
  assert.equal(fiyatMetni(0), 'Ücretsiz');
  assert.equal(fiyatMetni(undefined), '—');
  assert.equal(gbMetni(7.206), '7,2 GB');
  assert.equal(gbMetni(16), '16 GB');
});

// ── Arama, süzme, sıralama ──
test('Arama: harf katlamalı, çok sözcükte hepsi eşleşmeli (ad, kimlik, üretici); ad başı eşleşmesi öne', () => {
  const l = openRouterDonustur(oku('openrouter-modeller.json'));
  assert.deepEqual(modelAra(l, 'opus').map((m) => m.id), ['anthropic/claude-opus-5.5']);
  assert.ok(modelAra(l, 'GOOGLE flash').every((m) => m.id === 'google/gemini-3-flash'));
  assert.ok(modelAra(l, 'free').length >= 5);
  // Üretici de aranır: "meta llama" NVIDIA'nın Llama türevini (kimliğinde "llama" var, üreticisi NVIDIA) getirmez.
  assert.deepEqual(modelAra(l, 'meta llama').map((m) => m.id), ['meta-llama/llama-4-maverick', 'meta-llama/llama-3.3-70b-instruct:free']);
  // Ad başı eşleşmesi kimlik içi eşleşmeden önce: "grok" adı "Grok" ile başlayanlar, sırası korunarak.
  assert.deepEqual(modelAra(l, 'grok').map((m) => m.id), ['x-ai/grok-4', 'x-ai/grok-4-fast']);
  const sonnet = modelAra(l, 'sonnet');
  assert.equal(sonnet[0].id, 'anthropic/claude-sonnet-5.5');
  assert.equal(modelAra(l, '').length, l.length);
});

test('Süzme: görsel, araç, akıl yürütme, ücretsiz', () => {
  const l = openRouterDonustur(oku('openrouter-modeller.json'));
  assert.ok(modelleriSuz(l, { ucretsiz: true }).every((m) => m.girisFiyat === 0 && m.cikisFiyat === 0));
  assert.ok(modelleriSuz(l, { gorsel: true, akil: true }).every((m) => m.yetenekler.includes('gorsel') && m.yetenekler.includes('akil')));
  assert.equal(modelleriSuz(l, {}).length, l.length);
});

test('Sıralama: önerilen önce; fiyat ucuzdan (bilinmeyen sonda); bağlam büyükten; ad alfabetik (Türkçe)', () => {
  const l = openRouterDonustur(oku('openrouter-modeller.json'));
  const oneri = ['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5'];
  assert.deepEqual(modelleriSirala(l, 'onerilen', oneri).slice(0, 2).map((m) => m.id), oneri);
  const fiyat = modelleriSirala(l, 'fiyat', []);
  assert.equal(fiyat[0].girisFiyat, 0);
  assert.equal(fiyat.at(-1)!.id, 'openrouter/auto');
  const baglam = modelleriSirala(l, 'baglam', []);
  assert.equal(baglam[0].baglam, 2_000_000);
  const ad = modelleriSirala(l, 'ad', []).map((m) => m.ad);
  assert.deepEqual(ad, [...ad].sort((a, b) => a.localeCompare(b, 'tr')));
});

test('Liste tamamlanır: geçerli seçim ve önerilen kimlikler listede yoksa (serbest kimlik, alınamayan liste) eklenir', () => {
  const l = listeyiTamamla([], 'openrouter', ['ozel/deneme:free', 'anthropic/claude-opus-5.5']);
  assert.deepEqual(l.map((m) => m.id), ['ozel/deneme:free', 'anthropic/claude-opus-5.5']);
  assert.equal(l[1].girisFiyat, 4);
  const var_ = openRouterDonustur(oku('openrouter-modeller.json'));
  assert.equal(listeyiTamamla(var_, 'openrouter', ['anthropic/claude-opus-5.5']).length, var_.length); // zaten var: eklenmez
});

// ── Yerel uygunluk (eşikler) ──
const B27: YerelGereksinim = { boyutGB: 7.21, ramGB: 16, vramGB: 9 };
// 9B: 4 GB'lık kartta masaüstü payıyla sığmıyor (inceleme): 5 GB.
const B9: YerelGereksinim = { boyutGB: 2.56, ramGB: 8, vramGB: 5 };
const B4: YerelGereksinim = { boyutGB: 1.21, ramGB: 6 };

test('Uygunluk: ekran kartı belleği yeterse "Rahat çalışır" (sistem belleğinden bağımsız); eşik dahil', () => {
  assert.equal(yerelUygunluk(B27, { ramGB: 32, nvidia: true, vramGB: 16 }).durum, 'rahat');
  assert.equal(yerelUygunluk(B27, { ramGB: 8, nvidia: true, vramGB: 12 }).durum, 'rahat');
  assert.equal(yerelUygunluk(B27, { ramGB: 16, nvidia: true, vramGB: 9 }).durum, 'rahat');
  assert.match(yerelUygunluk(B27, { ramGB: 16, nvidia: true, vramGB: 9 }).neden, /ekran kartında/i);
});

test('Uygunluk: ekran kartı yok ya da belleği az, sistem belleği yeter → "Zorlanır" (işlemcide yavaş)', () => {
  const az = yerelUygunluk(B27, { ramGB: 16, nvidia: true, vramGB: 8.9 });
  assert.equal(az.durum, 'zorlanir');
  assert.match(az.neden, /8,9 GB/);
  const yok = yerelUygunluk(B27, { ramGB: 16, nvidia: false });
  assert.equal(yok.durum, 'zorlanir');
  assert.equal(yok.neden, 'Uygun ekran kartı yok; işlemcide yavaş çalışır');
  assert.equal(yerelUygunluk(B9, { ramGB: 8, nvidia: false }).durum, 'zorlanir');
  assert.equal(yerelUygunluk(B9, { ramGB: 8, nvidia: true, vramGB: 4 }).durum, 'zorlanir'); // 4 GB'lık kart 9B'ye yetmez
  assert.equal(yerelUygunluk(B9, { ramGB: 8, nvidia: true, vramGB: 5 }).durum, 'rahat');
  // NVIDIA var ama belleği okunamadı: iyimser değil.
  assert.equal(yerelUygunluk(B27, { ramGB: 32, nvidia: true }).durum, 'zorlanir');
});

test('Uygunluk: bellek gereksinimin altında ve ekran kartı yetmiyor → "Çalışmaz"; eşiğin hemen altı', () => {
  const r = yerelUygunluk(B27, { ramGB: 15.9, nvidia: false });
  assert.equal(r.durum, 'calismaz');
  assert.match(r.neden, /16 GB bellek ya da 9 GB ekran kartı/);
  assert.equal(yerelUygunluk(B27, { ramGB: 8, nvidia: true, vramGB: 6 }).durum, 'calismaz');
  assert.equal(yerelUygunluk(B4, { ramGB: 4, nvidia: false }).durum, 'calismaz');
  assert.match(yerelUygunluk(B4, { ramGB: 4, nvidia: false }).neden, /6 GB bellek gerekir/);
});

test('Uygunluk: ekran kartı istemeyen hafif model bellek yeterse işlemcide de "Rahat çalışır"', () => {
  assert.equal(yerelUygunluk(B4, { ramGB: 8, nvidia: false }).durum, 'rahat');
  assert.equal(yerelUygunluk(B4, { ramGB: 6, nvidia: false }).durum, 'rahat');
  assert.match(yerelUygunluk(B4, { ramGB: 6, nvidia: false }).neden, /işlemcide/i);
});

test('Uygunluk: kurulu değilken diskte yer yoksa "Çalışmaz"; kuruluysa disk sorulmaz; ölçülemeyen disk engel değil', () => {
  const d = yerelUygunluk(B27, { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 8 });
  assert.equal(d.durum, 'calismaz');
  assert.match(d.neden, /diskte 8,2 GB/i);
  assert.equal(yerelUygunluk(B27, { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 8.21 }).durum, 'rahat');
  assert.equal(yerelUygunluk(B27, { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 2 }, { kurulu: true }).durum, 'rahat');
  assert.equal(yerelUygunluk(B27, { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: Number.NaN }).durum, 'rahat');
});

const YEREL_LISTE: ModelBilgisi[] = [
  { id: 'bonsai2-27b', ad: '27B', saglayici: 'yerel', yetenekler: [], yerel: B27 },
  { id: 'bonsai2-9b', ad: '9B', saglayici: 'yerel', yetenekler: [], yerel: B9 },
  { id: 'bonsai2-4b', ad: '4B', saglayici: 'yerel', yetenekler: [], yerel: B4 },
];

test('Önerilen yerel model: rahat çalışan en büyüğü; hiçbiri rahat değilse zorlanan en hafifi; hiçbiri uymuyorsa yok', () => {
  const l = YEREL_LISTE;
  assert.equal(onerilenYerel(l, { ramGB: 32, nvidia: true, vramGB: 16 }), 'bonsai2-27b');
  assert.equal(onerilenYerel(l, { ramGB: 8, nvidia: true, vramGB: 6 }), 'bonsai2-9b');
  assert.equal(onerilenYerel(l, { ramGB: 8, nvidia: true, vramGB: 4 }), 'bonsai2-4b'); // 4 GB'lık kart: 9B zorlanır, 4B rahat
  assert.equal(onerilenYerel(l, { ramGB: 16, nvidia: false }), 'bonsai2-4b');
  assert.equal(onerilenYerel(l.slice(0, 2), { ramGB: 8, nvidia: false }), 'bonsai2-9b'); // 9B zorlanır, 27B çalışmaz
  assert.equal(onerilenYerel(l.slice(0, 1), { ramGB: 4, nvidia: false }), undefined); // arayüz "Önerilen" göstermez
  assert.equal(onerilenYerel(l, { ramGB: 4, nvidia: false }), undefined);
});

test('Önerilen yerel model diski de sayar: kurulu olmayan büyük model diske sığmıyorsa önerilmez; kurulu olan sayılır', () => {
  const dar = { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 5 };
  assert.equal(onerilenYerel(YEREL_LISTE, dar), 'bonsai2-9b'); // 27B için 8,2 GB gerekir
  assert.equal(onerilenYerel(YEREL_LISTE, dar, (id) => id === 'bonsai2-27b'), 'bonsai2-27b'); // zaten inmiş: disk sorulmaz
  assert.equal(onerilenYerel(YEREL_LISTE, { ...dar, bosDiskGB: 1 }), undefined); // hiçbiri sığmıyor
});

// Kurulum sihirbazı (Görev 15): Sistem satırı ve "Ekstra gizlilik" adımı bu bilgisayarın en iyi yerel seçeneğini tek özetle okur.
test('En iyi yerel seçenek: önerilen modelin uygunluğu; hiçbiri uymuyorsa en hafifin nedeni (kurulamaz); liste boşsa yok', () => {
  const guclu = enIyiYerel(YEREL_LISTE, { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 400 });
  assert.deepEqual(guclu, { id: 'bonsai2-27b', durum: 'rahat', neden: 'Ekran kartında hızlı çalışır' });
  const kartsiz = enIyiYerel(YEREL_LISTE, { ramGB: 16, nvidia: false, bosDiskGB: 400 });
  assert.deepEqual(kartsiz, { id: 'bonsai2-4b', durum: 'rahat', neden: 'Ekran kartı gerekmez; işlemcide de rahat çalışır' });
  // Yalnız zorlanan var: önerilen o (en hafif zorlanan), durum zorlanir.
  assert.deepEqual(enIyiYerel(YEREL_LISTE.slice(0, 2), { ramGB: 8, nvidia: false }), { id: 'bonsai2-9b', durum: 'zorlanir', neden: 'Uygun ekran kartı yok; işlemcide yavaş çalışır' });
  // Hiçbiri uymuyor: kurulacak model yok (id yok), neden en hafif modelinki (en az istenen).
  assert.deepEqual(enIyiYerel(YEREL_LISTE, { ramGB: 4, nvidia: false }), { durum: 'calismaz', neden: 'En az 6 GB bellek gerekir' });
  assert.deepEqual(enIyiYerel(YEREL_LISTE, { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 1 }), { durum: 'calismaz', neden: 'Diskte 2,2 GB boş yer gerekir' });
  // Kurulu model diske bakılmadan sayılır.
  assert.equal(enIyiYerel(YEREL_LISTE, { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 1 }, (id) => id === 'bonsai2-9b')?.id, 'bonsai2-9b');
  assert.equal(enIyiYerel([], { ramGB: 32, nvidia: true, vramGB: 16 }), undefined);
});

test('Uygunluk girdisi (yerelMakinesi): ekran kartı yalnız yerel beyin kullanabiliyorsa sayılır', () => {
  const kartli = { ramGB: 16, nvidia: true, vramGB: 16, bosDiskGB: 200 };
  // "Yalnız işlemci" seçili: kart sayılmaz, neden metni bunu söyler (yanlışlıkla "Ekran kartında hızlı" denmez).
  const islemci = yerelMakinesi(kartli, { gpu: 'cpu', calistiriciKurulu: true, cuda: true });
  assert.deepEqual({ nvidia: islemci.nvidia, kapali: islemci.ekranKartiKapali, vram: islemci.vramGB }, { nvidia: false, kapali: 'islemci', vram: 16 });
  assert.equal(yerelUygunluk(B27, islemci).neden, '“Yalnız işlemci” seçili; işlemcide yavaş çalışır');
  // Çalıştırıcı işlemci sürümüyle kurulu (CUDA yok): kart kullanılamaz.
  const cudasiz = yerelMakinesi(kartli, { gpu: 'otomatik', calistiriciKurulu: true, cuda: false });
  assert.equal(cudasiz.nvidia, false);
  assert.equal(yerelUygunluk(B27, cudasiz).neden, 'Ekran kartı sürümü kurulu değil; işlemcide yavaş çalışır');
  assert.equal(yerelUygunluk(B4, cudasiz).durum, 'rahat');
  // CUDA sürümü kurulu ya da henüz hiçbir şey kurulu değil (kurulum ekran kartı sürümünü indirir): kart sayılır.
  assert.equal(yerelUygunluk(B27, yerelMakinesi(kartli, { gpu: 'otomatik', calistiriciKurulu: true, cuda: true })).durum, 'rahat');
  assert.equal(yerelUygunluk(B27, yerelMakinesi(kartli, { gpu: 'otomatik', calistiriciKurulu: false, cuda: false })).durum, 'rahat');
  // NVIDIA yok: ayardan bağımsız "Uygun ekran kartı yok" (0.10 Görev 3: neden İş'te de görünür, marka adı yok).
  const kartsiz = yerelMakinesi({ ramGB: 16, nvidia: false }, { gpu: 'cpu', calistiriciKurulu: true, cuda: false });
  assert.equal(kartsiz.ekranKartiKapali, undefined);
  assert.equal(yerelUygunluk(B27, kartsiz).neden, 'Uygun ekran kartı yok; işlemcide yavaş çalışır');
});

test('Liste hatası: sağlayıcı hatası türüne göre kısa Türkçe ileti (ham İngilizce metin yok)', () => {
  assert.equal(listeHatasiMetni({ status: 401, message: 'invalid x-api-key' }), 'Anahtar geçersiz ya da yetkisiz.');
  assert.equal(listeHatasiMetni({ status: 403 }), 'Anahtar geçersiz ya da yetkisiz.');
  assert.equal(listeHatasiMetni({ kod: 'anahtar', message: 'Fuber gateway anahtarı reddedildi' }), 'Anahtar geçersiz ya da yetkisiz.');
  assert.equal(listeHatasiMetni({ status: 402 }), 'Kredi yetersiz.');
  assert.equal(listeHatasiMetni({ status: 429 }), 'Hız sınırına takıldı; biraz sonra yeniden dene.');
  assert.equal(listeHatasiMetni({ status: 404 }), 'Liste adresi bulunamadı; taban adresini denetle.');
  assert.equal(listeHatasiMetni({ status: 503 }), 'Sağlayıcı şu an yanıt vermiyor.');
  assert.equal(listeHatasiMetni({ name: 'APIConnectionError', message: 'Connection error.' }), 'Bağlantı kurulamadı.');
  assert.equal(listeHatasiMetni(new TypeError('fetch failed')), 'Bağlantı kurulamadı.');
  assert.equal(listeHatasiMetni({ kod: 'baglanti' }), 'Bağlantı kurulamadı.');
  assert.equal(listeHatasiMetni(new Error('beklenmeyen')), 'Liste alınamadı.');
  assert.equal(listeHatasiMetni(null), 'Liste alınamadı.');
});

test('Ekran kartı belleği: nvidia-smi çıktısı (MiB, satır başına bir kart) → en büyük kartın GB değeri', () => {
  assert.equal(ekranKartiBellegi('16376\n'), 16);
  assert.equal(ekranKartiBellegi('8192\r\n4096\r\n'), 8);
  assert.equal(ekranKartiBellegi('6144'), 6);
  assert.equal(ekranKartiBellegi(''), undefined);
  assert.equal(ekranKartiBellegi('[N/A]\n'), undefined);
});
