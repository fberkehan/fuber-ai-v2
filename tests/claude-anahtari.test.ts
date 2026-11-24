// 0.14 — kullanıcının Anthropic (Claude) anahtarı ve seçilebilir sağlayıcı (ürün kararı). 5 Kas (Business kullanıcıları da kendi
// API anahtarını kullanabilir): kural iki modda aynı; Business'ta arayüz tek satır ("Kendi Claude anahtarım": kaydet = kullan, Sil = Fuber).
// Sınanan: sir:yaz kabul/ret matrisi (mod × anahtar adı × biçim) · ayarlar:kaydet süzgeci (geçersiz değer, Business'ta Claude seçilemez) ·
// telefon süzgeci yeni alanları düşürür · Ayarlar dizini (yalnız Developer) · motor yönlendirmesi: Business → Fuber, Developer + Claude + anahtar
// → Anthropic (seçilen model/eforla, kayıtlı anahtarla; bu bilgisayardaki sahte Anthropic sunucusu), anahtar yoksa geri düşme, Gizli / "Yalnız bu
// bilgisayar" asla buluta gitmez · Fuber hesabı girişi/çıkışı seçimi ezmez · Business'a geçiş anında Fuber'e döner, anahtar diskte kalır.
// Anahtar hiçbir yanıtta / ayar nesnesinde görünmez. Gerçek ağa hiçbir şey gitmez (ana-surec.ts ağ bekçisi).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';
import { sirYazmaReddi, ANAHTAR_REDDI, CLAUDE_BICIM_REDDI } from '../src/main/sir-izni.ts';
import { ayarKaydiniSuz } from '../src/main/ayar-kaydi.ts';
import { claudeSecili, claudeRolSecimi, claudeAnahtariGecerli, etkinSaglayiciAdi } from '../src/shared/motor-secimi.ts';
import { KATEGORILER } from '../src/renderer/ayarlar/dizin.ts';
import { dizinKur } from '../src/shared/ayar-arama.ts';

// Biçimce geçerli ama SAHTE anahtar (gerçek anahtar değildir; hiçbir yere gönderilmez — yalnız bu dosyanın 127.0.0.1 sunucusuna).
const SAHTE = 'sk-ant-' + 'api03-SAHTE_test_anahtari_0123456789abcdef';

// ── Saf kurallar ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('sir:yaz matrisi: iki modda yalnız geçerli Anthropic anahtarı kabul edilir (5 Kas: Business da); öbür motor anahtarları hep reddedilir; silmek hep serbest', () => {
  assert.equal(sirYazmaReddi('api:anthropic', SAHTE, 'is'), null, 'Business: Claude anahtarı yazılır');
  assert.equal(sirYazmaReddi('api:anthropic', 'sk-proj-' + 'x0123456789abcdef', 'is'), CLAUDE_BICIM_REDDI);
// Açık kaynak hazırlığı (11 Kas): kendi OpenAI uyumlu sağlayıcının anahtarı ('api:openai') da yazılır — tests/hesapsiz-kullanim.test.ts.
  for (const s of ['anthropic', 'openai', 'openrouter', 'fuber', 'elevenlabs']) {
    if (s !== 'anthropic' && s !== 'openai') assert.equal(sirYazmaReddi(`api:${s}`, SAHTE, 'is'), ANAHTAR_REDDI, `is/${s}`);
    assert.equal(sirYazmaReddi(`api:${s}`, null, 'is'), null);
    assert.equal(sirYazmaReddi(`api:${s}`, '', 'gelistirici'), null);
  }
  assert.equal(sirYazmaReddi('api:anthropic', SAHTE, 'gelistirici'), null);
  for (const s of ['openrouter', 'fuber', 'elevenlabs']) assert.equal(sirYazmaReddi(`api:${s}`, SAHTE, 'gelistirici'), ANAHTAR_REDDI, `gelistirici/${s}`);
  assert.equal(sirYazmaReddi('api:openai', SAHTE, 'gelistirici'), null);
  for (const kotu of ['sk-proj-' + 'abcdefabcdefabcdefabcdef', 'sk-ant-' + 'kisa', `sk-ant-${'a'.repeat(300)}`, 'sk-ant-' + 'api03-ara bosluk-0123456789', ' sk-ant-' + 'api03-0123456789abcdefgh', 'xyz']) {
    assert.equal(sirYazmaReddi('api:anthropic', kotu, 'gelistirici'), CLAUDE_BICIM_REDDI, kotu.slice(0, 20));
    assert.ok(!CLAUDE_BICIM_REDDI.includes(kotu), 'ret metni anahtarı içermez');
  }
  assert.equal(claudeAnahtariGecerli(SAHTE), true);
  // Ses/köprü sırları bu kuraldan etkilenmez.
  assert.equal(sirYazmaReddi('kopru:kayit', 'x', 'is'), null);
});

test('claudeSecili: Claude seçili + anahtar (iki modda; 5 Kas); rol seçimi varsayılanları shared/modeller.ts', () => {
  assert.equal(claudeSecili({ mod: 'gelistirici', motorSecimi: 'anthropic', claudeAnahtariVar: true }), true);
  assert.equal(claudeSecili({ mod: 'is', motorSecimi: 'anthropic', claudeAnahtariVar: true }), true);
  assert.equal(claudeSecili({ mod: 'is', motorSecimi: 'anthropic', claudeAnahtariVar: false }), false);
  assert.equal(claudeSecili({ mod: 'gelistirici', motorSecimi: 'fuber', claudeAnahtariVar: true }), false);
  assert.equal(claudeSecili({ mod: 'gelistirici', motorSecimi: 'anthropic', claudeAnahtariVar: false }), false);
  assert.equal(etkinSaglayiciAdi({ mod: 'is', motorSecimi: 'anthropic', claudeAnahtariVar: true }), 'Claude (Anthropic)');
  assert.equal(etkinSaglayiciAdi({ mod: 'is', motorSecimi: 'fuber', claudeAnahtariVar: true }), 'Fuber');
  assert.deepEqual(claudeRolSecimi({}, 'ana'), { model: 'claude-opus-5-5', efor: 'medium' });
  assert.deepEqual(claudeRolSecimi({}, 'yardimci'), { model: 'claude-haiku-5-5', efor: 'low' });
  assert.deepEqual(claudeRolSecimi({ claudeModeller: { ana: { model: 'gpt-5', efor: 'cok' as never } } as never }, 'ana'), { model: 'claude-opus-5-5', efor: 'medium' }, 'bozuk kayıt varsayılana');
});

// ── Ana süreç: gerçek ayar/sır deposu + IPC + motor seçici + sahte Anthropic ve Fuber hesap sunucuları ─────────────────────────────────
interface Istek { anahtar: string; model: string; efor?: string; yol: string }
const anthropicIstekleri: Istek[] = [];
const sse = (olay: string, veri: unknown) => `event: ${olay}\ndata: ${JSON.stringify(veri)}\n\n`;
const anthropic = http.createServer((q, r) => {
  let govde = '';
  q.on('data', (c) => { govde += c; });
  q.on('end', () => {
    const b = govde ? JSON.parse(govde) as { model?: string; output_config?: { effort?: string } } : {};
    anthropicIstekleri.push({ anahtar: String(q.headers['x-api-key'] ?? ''), model: String(b.model ?? ''), efor: b.output_config?.effort, yol: String(q.url) });
    if (!String(q.url).startsWith('/v1/messages')) { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null })); return; }
    r.writeHead(200, { 'content-type': 'text/event-stream' });
    r.end([
      sse('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } }),
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hazır' } }),
      sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }),
      sse('message_stop', { type: 'message_stop' }),
    ].join(''));
  });
});
await new Promise<void>((c) => anthropic.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => anthropic.close(() => c())));

const { klasor } = anaSurecSahnesi('claude-anahtari', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false, motorCalisti: true,
});
(globalThis as Record<string, unknown>).__sifreleme = true;
// Claude SDK'sı adresi ortamdan okur (paketsiz): YALNIZ bu dosyanın sahte sunucusu. Genel fetch yalnız 127.0.0.1'e (ağ bekçisi).
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(anthropic.address() as { port: number }).port}`;
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;
await ipcKurBos();
const { ayarlar, ayarlariKaydet, sirOku, sirYaz, kullaniciMotorAnahtari } = await import('../src/main/ayarlar.ts');
const { hazirMi, hazirMotorlar, secim, yardimciMetin, GIZLI_MOD_HAZIR_DEGIL } = await import('../src/main/motor/secici.ts');

const ipc = (k: string, ...a: unknown[]) => ipcIsleyicileri().get(k)!({}, ...a);
const sirYazIpc = async (ad: string, deger: string | null) => ipc('sir:yaz', ad, deger);
const kaydet = (d: unknown) => ipc('ayarlar:kaydet', d) as ReturnType<typeof ayarlar>;
const anahtarYok = (x: unknown) => assert.ok(!JSON.stringify(x).includes('SAHTE_test_anahtari'), 'anahtar ayar/yanıt nesnesinde görünmez');

test('Business (5 Kas): Claude anahtarı kaydedilir ve seçilince kullanılır (anahtar görünmez); Gizli/"Yalnız bu bilgisayar" buluta gitmez; Sil → Fuber', async () => {
  await assert.rejects(sirYazIpc('api:openrouter', SAHTE), (e: Error) => e.message === ANAHTAR_REDDI);
  await assert.rejects(sirYazIpc('api:anthropic', 'sk-proj-' + 'yanlis-0123456789abcdef'), (e: Error) => e.message === CLAUDE_BICIM_REDDI);
  assert.equal(hazirMi('anthropic'), false);
  anahtarYok(await sirYazIpc('api:anthropic', SAHTE));
  assert.equal(ayarlar().claudeAnahtariVar, true);
  assert.equal(hazirMi('anthropic'), false, 'yalnız kayıt: seçilmeden kullanılmaz');
  const y = kaydet({ motorSecimi: 'anthropic' }); // arayüz: Business'ta "kaydet" ikisini birden yapar
  anahtarYok(y);
  assert.equal(y.motorSecimi, 'anthropic');
  assert.equal(ayarlar().mod, 'is');
  assert.equal(hazirMi('anthropic'), true);
  assert.equal(secim('ana').saglayici, 'anthropic');
  assert.ok(!fs.readFileSync(path.join(klasor, 'ayarlar.json'), 'utf8').includes('SAHTE_test_anahtari'), 'ayar dosyası anahtarı taşımaz');
  anthropicIstekleri.length = 0;
  assert.equal(await yardimciMetin('Kısa yanıt ver.', 'Sadece "hazır" yaz.', 'test'), 'hazır');
  assert.equal(anthropicIstekleri.filter((x) => x.yol.startsWith('/v1/messages'))[0]?.anahtar, SAHTE, 'Business: kullanıcının anahtarıyla');
  // P14: Gizli ve "Yalnız bu bilgisayar" kullanıcının kendi anahtarıyla da buluta gitmez.
  for (const yerel of [{ gizliMod: true }, { yalnizYerel: true }]) {
    ayarlariKaydet((a) => { Object.assign(a.yerel, yerel); });
    anthropicIstekleri.length = 0;
    await assert.rejects(yardimciMetin('s', 'k', 'test'));
    assert.equal((await ipc('motor:sina', 'anthropic') as { tamam: boolean }).tamam, false);
    assert.deepEqual(anthropicIstekleri, [], JSON.stringify(yerel));
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; a.yerel.yalnizYerel = false; });
  }
  // Sil = Fuber'e dönüş (arayüz motorSecimi'ni de 'fuber' yapar); anahtar çözülmez.
  await sirYazIpc('api:anthropic', null);
  kaydet({ motorSecimi: 'fuber' });
  assert.equal(ayarlar().claudeAnahtariVar, false);
  assert.equal(hazirMi('anthropic'), false);
  assert.equal(kullaniciMotorAnahtari('anthropic'), undefined);
});

test('Gizli mod ve "Yalnız bu bilgisayar": Claude seçili olsa da hiçbir istek Anthropic\'e gitmez', async () => {
  for (const yerel of [{ gizliMod: true }, { yalnizYerel: true }]) {
    ayarlariKaydet((a) => { Object.assign(a.yerel, yerel); });
    anthropicIstekleri.length = 0;
    await assert.rejects(yardimciMetin('s', 'k', 'test'));
    if (yerel.gizliMod) await assert.rejects(yardimciMetin('s', 'k', 'test'), (e: Error) => e.message === GIZLI_MOD_HAZIR_DEGIL);
    const d = await ipc('motor:sina', 'anthropic') as { tamam: boolean };
    assert.equal(d.tamam, false);
    assert.deepEqual(anthropicIstekleri, [], JSON.stringify(yerel));
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; a.yerel.yalnizYerel = false; });
  }
});
