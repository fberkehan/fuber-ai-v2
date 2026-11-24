// Görev 27: Claude Code olay normalleştirici (src/shared/cc-olay.ts) — saf; SDK iletisi ve JSONL döküm satırı → sade kayıt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ccNormallestir, yeniBaglam, izinIstegiOlayi, dokumSatiriOlaylari, aracTipi, aracOzeti, girdiKisalt, istemTemizle, ilkCumle, ccBitisOzeti, ccBitisBildirimi,
  GIRDI_SINIRI, CIKTI_SINIRI, ccModMu, soruCevaplariniDogrula, CC_KIMLIK_RE, CC_MODEL_RE, ccAcSonucu, CC_MASADA_ACIK, arkaPlanSifirla, ccParaGosterilir, type CcOlay,
} from '../src/shared/cc-olay.ts';

const akis = (event: unknown, ust: string | null = null) => ({ type: 'stream_event', event, parent_tool_use_id: ust, uuid: 'u', session_id: 's' });
const asistan = (id: string, content: unknown[], ust: string | null = null, ek: Record<string, unknown> = {}) => ({ type: 'assistant', message: { id, role: 'assistant', content }, parent_tool_use_id: ust, uuid: 'u', session_id: 's', ...ek });
const kullanici = (content: unknown, ust: string | null = null, ek: Record<string, unknown> = {}) => ({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: ust, uuid: 'k1', session_id: 's', ...ek });

test('system/init → baslangic (kimlik, model, mod, sürüm, araçlar, komutlar, yetenekler)', () => {
  const b = yeniBaglam();
  const o = ccNormallestir({ type: 'system', subtype: 'init', session_id: 'abc', model: 'claude-x', permissionMode: 'plan', claude_code_version: '2.1.310', cwd: 'C:\\p', tools: ['Read', 1], slash_commands: ['compact'], capabilities: ['interrupt_receipt_v1'], uuid: 'u' }, b);
  assert.deepEqual(o, [{ tur: 'baslangic', kimlik: 'abc', model: 'claude-x', mod: 'plan', surum: '2.1.310', cwd: 'C:\\p', araclar: ['Read'], komutlar: ['compact'], yetenekler: ['interrupt_receipt_v1'] }]);
  // Eski CLI (capabilities yok) çökmez.
  assert.deepEqual((ccNormallestir({ type: 'system', subtype: 'init', session_id: 'x' }, b)[0] as { yetenekler: string[] }).yetenekler, []);
});

test('stream_event: metin parçaları blok kimliğiyle; tam asistan iletisi aynı bloğu "metin" olarak kapatır', () => {
  const b = yeniBaglam();
  const olaylar: CcOlay[] = [
    ...ccNormallestir(akis({ type: 'message_start', message: { id: 'm1' } }), b),
    ...ccNormallestir(akis({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }), b),
    ...ccNormallestir(akis({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }), b),
    ...ccNormallestir(akis({ type: 'content_block_stop', index: 0 }), b),
    ...ccNormallestir(akis({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }), b),
    ...ccNormallestir(akis({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Mer' } }), b),
    ...ccNormallestir(akis({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'haba' } }), b),
    ...ccNormallestir(akis({ type: 'content_block_stop', index: 1 }), b),
    ...ccNormallestir(akis({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'Read' } }), b),
    ...ccNormallestir(akis({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"fi' } }), b),
    ...ccNormallestir(akis({ type: 'message_stop' }), b),
    // CLI blok başına bir asistan iletisi yayar (aynı message.id).
    ...ccNormallestir(asistan('m1', [{ type: 'thinking', thinking: 'hmm', signature: 'x' }]), b),
    ...ccNormallestir(asistan('m1', [{ type: 'text', text: 'Merhaba' }]), b),
    ...ccNormallestir(asistan('m1', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\p\\a.ts' } }]), b),
  ];
  assert.deepEqual(olaylar, [
    { tur: 'dusunme', blok: 'm1#d0', durum: 'basladi', ust: null },
    { tur: 'dusunme', blok: 'm1#d0', durum: 'bitti', ust: null },
    { tur: 'metin-parca', blok: 'm1#0', metin: 'Mer', ust: null },
    { tur: 'metin-parca', blok: 'm1#0', metin: 'haba', ust: null },
    // akışta görülen düşünme tam iletide ikinci kez bildirilmez
    { tur: 'metin', blok: 'm1#0', metin: 'Merhaba', ust: null },
    { tur: 'arac-basladi', id: 't1', ad: 'Read', tip: 'okuma', girdi: { file_path: 'C:\\p\\a.ts' }, ozet: 'C:\\p\\a.ts', ust: null },
  ]);
});

test('akışsız asistan iletisi: birden çok metin bloğu sırayla numaralanır; düşünme göstergesi; boş metin atlanır', () => {
  const b = yeniBaglam();
  const o = ccNormallestir(asistan('m2', [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'A' }, { type: 'text', text: '  ' }, { type: 'text', text: 'B' }]), b);
  assert.deepEqual(o, [
    { tur: 'dusunme', blok: 'm2#d0', durum: 'bitti', ust: null },
    { tur: 'metin', blok: 'm2#0', metin: 'A', ust: null },
    { tur: 'metin', blok: 'm2#2', metin: 'B', ust: null },
  ]);
});

test('alt ajan (Task/Agent) iç içe: ust = parent_tool_use_id; alt ajanın akışı ana akışı bozmaz', () => {
  const b = yeniBaglam();
  const o = [
    ...ccNormallestir(asistan('m3', [{ type: 'tool_use', id: 'task1', name: 'Agent', input: { description: 'Kodu tara', prompt: 'Her dosyaya bak', subagent_type: 'Explore' } }]), b),
    ...ccNormallestir(akis({ type: 'message_start', message: { id: 'alt1' } }, 'task1'), b),
    ...ccNormallestir(akis({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }, 'task1'), b),
    ...ccNormallestir(akis({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'iç' } }, 'task1'), b),
    ...ccNormallestir(asistan('alt1', [{ type: 'tool_use', id: 'r1', name: 'Grep', input: { pattern: 'TODO', path: 'C:\\p\\src' } }], 'task1'), b),
    ...ccNormallestir(kullanici([{ type: 'tool_result', tool_use_id: 'r1', content: 'yok' }], 'task1'), b),
    ...ccNormallestir(kullanici([{ type: 'tool_result', tool_use_id: 'task1', content: [{ type: 'text', text: 'Rapor' }, { type: 'image', source: {} }] }]), b),
  ];
  assert.deepEqual(o, [
    { tur: 'alt-ajan', id: 'task1', aciklama: 'Kodu tara', istem: 'Her dosyaya bak', ust: null, ajanTipi: 'Explore' },
    { tur: 'metin-parca', blok: 'alt1#0', metin: 'iç', ust: 'task1' },
    { tur: 'arac-basladi', id: 'r1', ad: 'Grep', tip: 'arama', girdi: { pattern: 'TODO', path: 'C:\\p\\src' }, ozet: '“TODO” · src', ust: 'task1' },
    { tur: 'arac-bitti', id: 'r1', hata: false, cikti: 'yok', kisaltildi: false, ust: 'task1' },
    { tur: 'arac-bitti', id: 'task1', hata: false, cikti: 'Rapor\n[görsel]', kisaltildi: false, ust: null },
  ]);
});

test('TodoWrite → yapılacaklar (durumlar Türkçe); sonucu kart olmaz', () => {
  const b = yeniBaglam();
  const o = [
    ...ccNormallestir(asistan('m4', [{ type: 'tool_use', id: 'td', name: 'TodoWrite', input: { todos: [{ content: 'A', status: 'pending', activeForm: 'A yapılıyor' }, { content: 'B', status: 'in_progress' }, { content: 'C', status: 'completed' }] } }]), b),
    ...ccNormallestir(kullanici([{ type: 'tool_result', tool_use_id: 'td', content: 'ok' }]), b),
  ];
  assert.deepEqual(o, [{ tur: 'yapilacaklar', id: 'td', ust: null, maddeler: [{ icerik: 'A', durum: 'bekliyor', etkinMetin: 'A yapılıyor' }, { icerik: 'B', durum: 'suruyor' }, { icerik: 'C', durum: 'tamam' }] }]);
});

// Düzeltme 13: Claude Code 2.1'in görev araçları (sdk-tools.d.ts TaskCreate/TaskUpdate/TaskList/TaskGet) yapılacaklar listesine.
test('TaskCreate/TaskUpdate/TaskList → yapılacaklar (kimlik yapısal çıktıdan ya da metindeki #n); kart olmaz; döküm satırında da', () => {
  const b = yeniBaglam();
  const sonuc = (id: string, content: string, yapisal?: unknown) => kullanici([{ type: 'tool_result', tool_use_id: id, content }], null, yapisal === undefined ? {} : { tool_use_result: yapisal });
  const o = [
    ...ccNormallestir(asistan('g1', [{ type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: 'Testleri yaz', description: 'd', activeForm: 'Testler yazılıyor' } }]), b),
    ...ccNormallestir(sonuc('c1', 'Task #1 created', { task: { id: '1', subject: 'Testleri yaz' } }), b),
    ...ccNormallestir(asistan('g2', [{ type: 'tool_use', id: 'c2', name: 'TaskCreate', input: { subject: 'Belge', description: 'd' } }]), b),
    ...ccNormallestir(sonuc('c2', 'Task #7 created successfully: Belge'), b), // yapısal çıktı yok → metindeki #7
    ...ccNormallestir(asistan('g3', [{ type: 'tool_use', id: 'u1', name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' } }]), b),
    ...ccNormallestir(sonuc('u1', 'ok', { success: true }), b),
    ...ccNormallestir(asistan('g4', [{ type: 'tool_use', id: 'u2', name: 'TaskUpdate', input: { taskId: '7', status: 'deleted' } }]), b),
    ...ccNormallestir(asistan('g5', [{ type: 'tool_use', id: 'g', name: 'TaskGet', input: { taskId: '1' } }]), b),
    ...ccNormallestir(sonuc('g', 'detay'), b),
  ];
  assert.ok(o.every((x) => x.tur === 'yapilacaklar'), `yalnız yapılacaklar: ${o.map((x) => x.tur)}`);
  assert.deepEqual((o.at(-1) as Extract<CcOlay, { tur: 'yapilacaklar' }>).maddeler, [{ icerik: 'Testleri yaz', durum: 'suruyor', kimlik: '1', etkinMetin: 'Testler yazılıyor' }]);
  const liste = ccNormallestir(asistan('g6', [{ type: 'tool_use', id: 'l', name: 'TaskList', input: {} }]), b);
  assert.deepEqual(liste, []);
  const l2 = ccNormallestir(sonuc('l', '...', { tasks: [{ id: '1', subject: 'Testleri yaz', status: 'completed', blockedBy: [] }, { id: '3', subject: 'Yeni', status: 'pending', blockedBy: [] }] }), b) as Extract<CcOlay, { tur: 'yapilacaklar' }>[];
  assert.deepEqual(l2[0].maddeler.map((m) => [m.kimlik, m.durum, m.etkinMetin]), [['1', 'tamam', 'Testler yazılıyor'], ['3', 'bekliyor', undefined]]);
  // JSONL dökümünde yapısal çıktı `toolUseResult` adıyla.
  const d = yeniBaglam();
  dokumSatiriOlaylari({ type: 'assistant', message: { id: 'x', content: [{ type: 'tool_use', id: 'c9', name: 'TaskCreate', input: { subject: 'Döküm görevi', description: '' } }] } }, d);
  const r = dokumSatiriOlaylari({ type: 'user', toolUseResult: { task: { id: '42', subject: 'Döküm görevi' } }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c9', content: 'ok' }] } }, d);
  assert.deepEqual((r[0] as Extract<CcOlay, { tur: 'yapilacaklar' }>).maddeler, [{ icerik: 'Döküm görevi', durum: 'bekliyor', kimlik: '42' }]);
});

// Düzeltme 9: AskUserQuestion yanıtı sorulan sorulara uymalı.
test('soru yanıtları: her soru yanıtlı, fazla anahtar yok, seçenekler geçerli (çoklu seçim virgülle), "Diğer" serbest metni', () => {
  const sorular = [
    { soru: 'Dil?', secenekler: [{ etiket: 'TS' }, { etiket: 'Py' }], cokluSecim: false },
    { soru: 'Özellik?', secenekler: [{ etiket: 'Test' }, { etiket: 'CI' }, { etiket: 'Belge' }], cokluSecim: true },
  ];
  assert.deepEqual(soruCevaplariniDogrula(sorular, { 'Dil?': 'TS', 'Özellik?': ['Test', 'CI'] }), { tamam: true, answers: { 'Dil?': 'TS', 'Özellik?': 'Test, CI' } });
  assert.deepEqual(soruCevaplariniDogrula(sorular, { 'Dil?': 'Py', 'Özellik?': 'Belge, Test' }), { tamam: true, answers: { 'Dil?': 'Py', 'Özellik?': 'Belge, Test' } });
  assert.match((soruCevaplariniDogrula(sorular, { 'Dil?': 'TS' }) as { hata: string }).hata, /Yanıtlanmamış soru: Özellik/);
  assert.match((soruCevaplariniDogrula(sorular, { 'Dil?': 'TS', 'Özellik?': 'CI', 'Başka?': 'x' }) as { hata: string }).hata, /Sorulmayan/);
  assert.match((soruCevaplariniDogrula(sorular, { 'Dil?': 'Rust', 'Özellik?': 'CI' }) as { hata: string }).hata, /Seçeneklerde yok: Rust/);
  assert.match((soruCevaplariniDogrula(sorular, { 'Dil?': ['TS', 'Py'], 'Özellik?': 'CI' }) as { hata: string }).hata, /Tek seçim/);
  assert.match((soruCevaplariniDogrula(sorular, { 'Dil?': 'TS', 'Özellik?': [] }) as { hata: string }).hata, /Boş yanıt/);
  assert.equal(soruCevaplariniDogrula(sorular, null).tamam, false);
  // "Diğer": serbest metin (boş olamaz).
  assert.deepEqual(soruCevaplariniDogrula(sorular, { 'Dil?': '  Rust  ', 'Özellik?': 'CI' }, ['Dil?']), { tamam: true, answers: { 'Dil?': 'Rust', 'Özellik?': 'CI' } });
  assert.equal(soruCevaplariniDogrula(sorular, { 'Dil?': ' ', 'Özellik?': 'CI' }, ['Dil?']).tamam, false);
});

// Düzeltme A: telefon ekranı açık oturuma komutun GİTMEDİĞİNİ dürüstçe söyler ve kutudaki metni korur.
test('telefonun "Komutu ver" sonucu: masada-acik dürüst ve kısa, kutu korunur; başarıda temizlenir', () => {
  assert.deepEqual(ccAcSonucu({ tamam: false, kod: 'masada-acik', hata: 'x' }, true), { metin: 'Bu oturum bilgisayarda açık; komutu bilgisayardan ver.', hata: true, kutuyuTemizle: false });
  assert.equal(CC_MASADA_ACIK, 'Bu oturum bilgisayarda açık; komutu bilgisayardan ver.');
  const ok = ccAcSonucu({ tamam: true, oturum: { durum: 'sirada', siraNo: 2 } }, true);
  assert.deepEqual([ok.hata, ok.kutuyuTemizle], [false, true]);
  assert.match(ok.metin, /işe başladı \(sırada: 2\.\)/);
  assert.deepEqual(ccAcSonucu({ tamam: true }, false), { metin: 'Oturum bilgisayarında hazır; Claude Code sayfasından sürdürülebilir.', hata: false, kutuyuTemizle: false });
  assert.equal(ccAcSonucu({ tamam: false, kod: 'baska-yerde' }, true).kutuyuTemizle, false);
  assert.match(ccAcSonucu({ tamam: false, kod: 'bilinmeyen-klasor' }, true).metin, /bilinen bir proje/);
  assert.equal(ccAcSonucu({ tamam: false, hata: 'Klasör yok' }, true).metin, 'Klasör yok');
  // Kapanmış (sürdürülemeyen) kayıt "masada açık" DEĞİL: kendi metni.
  assert.deepEqual(ccAcSonucu({ tamam: false, kod: 'kapali-oturum' }, true), { metin: 'Bu oturum kapandı ve sürdürülemiyor; yeni bir oturum başlat.', hata: true, kutuyuTemizle: false });
});

test('kimlik ve model biçimleri: yol kaçışı, boşluk ve bayrak gibi değerler geçmez', () => {
  for (const k of ['aaaa1111-0000-4000-8000-000000000001', 'abc_DEF-123']) assert.ok(CC_KIMLIK_RE.test(k), k);
  for (const k of ['../../etc', 'abc', 'a b c d e f', 'x'.repeat(81), '']) assert.ok(!CC_KIMLIK_RE.test(k), k);
  for (const m of ['claude-sonnet-5-5', 'opus', 'us.anthropic.claude-x@2026', 'claude-opus-4-8[1m]']) assert.ok(CC_MODEL_RE.test(m), m);
  for (const m of ['--dangerously-skip-permissions', '-x', 'a b', 'x;rm', '']) assert.ok(!CC_MODEL_RE.test(m), m);
});

test('araç sonucu: hata bayrağı, uzun çıktı kısaltılır; canlı akışta kullanıcı metni yankılanmaz (yalnız isReplay)', () => {
  const b = yeniBaglam();
  ccNormallestir(asistan('m5', [{ type: 'tool_use', id: 'bx', name: 'Bash', input: { command: 'npm test\n--watch' } }]), b);
  const uzun = 'x'.repeat(CIKTI_SINIRI + 50);
  const [r] = ccNormallestir(kullanici([{ type: 'tool_result', tool_use_id: 'bx', content: uzun, is_error: true }]), b) as Extract<CcOlay, { tur: 'arac-bitti' }>[];
  assert.equal(r.hata, true);
  assert.equal(r.kisaltildi, true);
  assert.equal(r.cikti.length, CIKTI_SINIRI);
  assert.deepEqual(ccNormallestir(kullanici('[Request interrupted by user]'), b), []);
  assert.deepEqual(ccNormallestir(kullanici('sentetik', null, { isReplay: true, isSynthetic: true }), b), []);
  assert.deepEqual(ccNormallestir(kullanici([{ type: 'text', text: 'merhaba' }, { type: 'image' }], null, { isReplay: true }), b), [{ tur: 'kullanici', id: 'k1', metin: 'merhaba', gorselSayisi: 1 }]);
});

test('result → sonuç: başarı, hata metni, kesilme (terminal_reason ya da kullanıcı isteği), belirteçler', () => {
  const b = yeniBaglam();
  const ortak = { duration_ms: 1200, num_turns: 3, total_cost_usd: 0.0123, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } };
  assert.deepEqual(ccNormallestir({ type: 'result', subtype: 'success', is_error: false, result: 'Bitti.', ...ortak }, b), [{
    tur: 'sonuc', basarili: true, kesildi: false, sureMs: 1200, turSayisi: 3, maliyetUsd: 0.0123, paraGoster: false, belirtec: { girdi: 10, cikti: 20, onbellekOkuma: 30, onbellekYazma: 40 }, metin: 'Bitti.',
  }]);
  const hata = ccNormallestir({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['  çok tur  ', ''], ...ortak }, b)[0] as Extract<CcOlay, { tur: 'sonuc' }>;
  assert.equal(hata.basarili, false);
  assert.match(hata.hata ?? '', /çok tur/);
  assert.doesNotMatch(hata.hata ?? '', /{/);
  const apiHatasi = ccNormallestir({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529', ...ortak }, b)[0] as Extract<CcOlay, { tur: 'sonuc' }>;
  assert.match(apiHatasi.hata ?? '', /çok yoğun/, 'ham "API Error: 529" yerine tek cümle + eylem');
  const kesik = ccNormallestir({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['aborted'], terminal_reason: 'aborted_tools', ...ortak }, b)[0] as Extract<CcOlay, { tur: 'sonuc' }>;
  assert.equal(kesik.kesildi, true);
  assert.equal(kesik.hata, undefined, 'kesilen tur hata göstermez');
  const istenen = ccNormallestir({ type: 'result', subtype: 'success', is_error: false, result: '', ...ortak }, b, { kesmeIstendi: true })[0] as Extract<CcOlay, { tur: 'sonuc' }>;
  assert.equal(istenen.kesildi, true);
  assert.equal(istenen.basarili, false);
  // Eksik alanlar sıfır (çökme sonucu).
  assert.deepEqual((ccNormallestir({ type: 'result', subtype: 'error_during_execution', is_error: true }, b)[0] as { belirtec: unknown }).belirtec, { girdi: 0, cikti: 0, onbellekOkuma: 0, onbellekYazma: 0 });
});

test('system iletileri: status (mod, sıkıştırma), compact_boundary, api_retry, permission_denied, yerel komut çıktısı; bilinmeyenler atlanır', () => {
  const b = yeniBaglam();
  assert.deepEqual(ccNormallestir({ type: 'system', subtype: 'status', status: 'compacting', permissionMode: 'acceptEdits' }, b), [{ tur: 'mod', mod: 'acceptEdits' }, { tur: 'sistem', seviye: 'bilgi', metin: 'Bağlam sıkıştırılıyor…' }]);
  assert.deepEqual(ccNormallestir({ type: 'system', subtype: 'compact_boundary', compact_metadata: {} }, b), [{ tur: 'sistem', seviye: 'bilgi', metin: 'Bağlam sıkıştırıldı.' }]);
  assert.match((ccNormallestir({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 5 }, b)[0] as { metin: string }).metin, /2\/5/);
  assert.match((ccNormallestir({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', decision_reason: 'kural' }, b)[0] as { metin: string }).metin, /Bash kendiliğinden reddedildi: kural/);
  assert.deepEqual(ccNormallestir({ type: 'system', subtype: 'local_command_output', content: 'Toplam: $0.01', uuid: 'lc' }, b), [{ tur: 'metin', blok: 'lc', metin: 'Toplam: $0.01', ust: null }]);
  for (const m of [{ type: 'system', subtype: 'hook_started' }, { type: 'keep_alive' }, { type: 'rate_limit_event' }, null, 42, 'x', { type: 'assistant' }, { type: 'stream_event', event: { type: 'content_block_delta' } }]) {
    assert.deepEqual(ccNormallestir(m, b), []);
  }
});

test('asistan hatası (authentication_failed) → Türkçe sistem iletisi', () => {
  const o = ccNormallestir(asistan('m6', [{ type: 'text', text: 'Invalid API key' }], null, { error: 'authentication_failed' }), yeniBaglam());
  assert.equal(o.at(-1)!.tur, 'sistem');
  assert.match((o.at(-1) as { metin: string }).metin, /Oturum aç/);
});

test('izin isteği: araç tipi/özet, "hep" seçeneği önerilerle; soru kartı; ANSI temizlenir; uzun girdi kısaltılır', () => {
  const i = izinIstegiOlayi('r1', 'Write', { file_path: 'C:\\p\\b.md', content: 'y'.repeat(GIRDI_SINIRI + 10) }, { suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }], decisionReason: '\u001b[31mdikkat\u001b[0m', defaultToNo: true, toolUseID: 't9', title: 'Claude yazmak istiyor' });
  assert.equal(i.tip, 'duzenleme');
  assert.equal(i.ozet, 'C:\\p\\b.md');
  assert.equal(i.herZamanSunulur, true);
  assert.equal(i.neden, 'dikkat');
  assert.equal(i.hayirdaAc, true);
  assert.equal(i.aracKimligi, 't9');
  assert.equal(i.kisaltildi, true);
  assert.equal((i.girdi.content as string).length, GIRDI_SINIRI);
  assert.equal(izinIstegiOlayi('r2', 'Bash', { command: 'ls' }, { suggestions: [{}], suppressAlwaysAllowRule: true }).herZamanSunulur, false, 'kalıcı kural yasaklı');
  assert.equal(izinIstegiOlayi('r3', 'Bash', { command: 'ls' }).herZamanSunulur, false, 'öneri yoksa "hep" yok');
  const s = izinIstegiOlayi('r4', 'AskUserQuestion', { questions: [{ question: 'Hangisi?', header: 'Seç', multiSelect: true, options: [{ label: 'A', description: 'a' }, { label: 'B' }] }] }, { suggestions: [{}] });
  assert.deepEqual(s.sorular, [{ soru: 'Hangisi?', baslik: 'Seç', cokluSecim: true, secenekler: [{ etiket: 'A', aciklama: 'a' }, { etiket: 'B' }] }]);
  assert.equal(s.herZamanSunulur, false);
});

test('araç tipleri ve tek satırlık özetler (MCP dahil)', () => {
  assert.deepEqual(['Read', 'Edit', 'MultiEdit', 'Write', 'Bash', 'PowerShell', 'Grep', 'Glob', 'Task', 'Agent', 'TodoWrite', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'ExitPlanMode', 'mcp__github__create_issue', 'Yeni'].map(aracTipi),
    ['okuma', 'duzenleme', 'duzenleme', 'duzenleme', 'kabuk', 'kabuk', 'arama', 'arama', 'alt-ajan', 'alt-ajan', 'yapilacaklar', 'web', 'web', 'soru', 'plan', 'mcp', 'diger']);
  assert.equal(aracOzeti('Bash', { command: 'git   status\n && ls' }), 'git status && ls');
  assert.equal(aracOzeti('WebSearch', { query: 'electron 44' }), '“electron 44”');
  assert.equal(aracOzeti('mcp__github__create_issue', { title: 'x' }), 'github · create issue');
  assert.equal(aracOzeti('Yeni', { a: 1, b: 'ilk metin' }), 'ilk metin');
  const { girdi, kisaltildi } = girdiKisalt({ a: [{ b: 'z'.repeat(30) }] }, 10);
  assert.equal(kisaltildi, true);
  assert.equal(((girdi.a as { b: string }[])[0].b).length, 10);
});

test('döküm satırları: kullanıcı istemi temizlenir; meta/yan zincir atlanır; araç kullanımı ve sonucu eşleşir', () => {
  const b = yeniBaglam();
  const satirlar = [
    { type: 'user', message: { role: 'user', content: 'Testleri düzelt <system-reminder>gizli</system-reminder>' }, uuid: 'u1' },
    { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
    { type: 'assistant', isSidechain: true, message: { id: 'sc', content: [{ type: 'text', text: 'yan' }] } },
    { type: 'assistant', message: { id: 'a1', content: [{ type: 'text', text: 'Bakıyorum.' }, { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: 'x.ts', old_string: 'a', new_string: 'b' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }] } },
    { type: 'user', message: { role: 'user', content: '<command-name>/compact</command-name><command-args></command-args>' }, uuid: 'u2' },
    { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'özet…' } },
    { type: 'ai-title', aiTitle: 'Başlık' },
  ];
  const o = satirlar.flatMap((s) => dokumSatiriOlaylari(s, b));
  assert.deepEqual(o.map((x) => x.tur), ['kullanici', 'metin', 'arac-basladi', 'arac-bitti', 'kullanici', 'sistem']);
  assert.equal((o[0] as { metin: string }).metin, 'Testleri düzelt');
  assert.equal((o[4] as { metin: string }).metin, '/compact');
  assert.deepEqual(dokumSatiriOlaylari('bozuk', b), []);
});

test('yardımcılar: istem temizleme, ilk cümle, bitiş özeti, mod doğrulama', () => {
  assert.equal(istemTemizle('Caveat: The messages below were generated'), '');
  assert.equal(ilkCumle('**Tamam.** İki dosyayı düzelttim. Testler geçti.'), 'Tamam.');
  assert.equal(ilkCumle('```ts\nkod\n```\nYaptım! Sonra'), 'Yaptım!');
  assert.equal(ilkCumle('nokta yok'), 'nokta yok');
  assert.equal(ccBitisOzeti({ proje: 'acme', degisenDosya: 2, sonMetin: 'Webhook imzası düzeltildi. Testler geçti.', sonuc: { basarili: true, kesildi: false } }), 'Claude Code bitirdi · acme: 2 dosya değişti. “Webhook imzası düzeltildi.”');
  assert.equal(ccBitisOzeti({ proje: 'p', degisenDosya: 0, sonMetin: '', sonuc: { basarili: false, kesildi: true } }), 'Claude Code durduruldu · p: dosya değişmedi.');
  assert.match(ccBitisOzeti({ proje: 'p', degisenDosya: 0, sonMetin: '', sonuc: { basarili: false, kesildi: false, hata: 'API' } }), /hata verdi · p: API/);
  // Bildirim: başlık durum + proje, metin ayrıntı — başlık metinde tekrarlanmaz.
  assert.deepEqual(ccBitisBildirimi({ proje: 'acme', degisenDosya: 1, sonMetin: 'Tamam. Bitti.', sonuc: { basarili: true, kesildi: false } }), { baslik: 'Claude Code bitirdi · acme', metin: '1 dosya değişti. “Tamam.”' });
  assert.deepEqual(['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto', 'dontAsk', 1].map(ccModMu), [true, true, true, true, false, false, false]);
});

// ── 0.13 T12: arka plan işi, tahmini maliyet ─────────────────────────────────────────────────────────────────────────────────
const sis = (subtype: string, ek: Record<string, unknown> = {}) => ({ type: 'system', subtype, uuid: 'u', session_id: 's', ...ek });
const arkaSayi = (o: CcOlay[]) => o.filter((x) => x.tur === 'arka-plan').map((x) => (x as { sayi: number }).sayi);

test('arka plan görevi başlayınca sayı artar, bitince düşer (task_started / task_notification)', () => {
  const b = yeniBaglam();
  assert.deepEqual(arkaSayi(ccNormallestir(sis('task_started', { task_id: 'a', description: 'ajan', is_backgrounded: true }), b)), [1]);
  assert.deepEqual(arkaSayi(ccNormallestir(sis('task_started', { task_id: 'b', description: 'kabuk', is_backgrounded: true }), b)), [2]);
  // Aynı görevin ikinci bildirimi sayıyı değiştirmez → olay yok.
  assert.deepEqual(ccNormallestir(sis('task_started', { task_id: 'b', description: 'kabuk', is_backgrounded: true }), b), []);
  assert.deepEqual(arkaSayi(ccNormallestir(sis('task_notification', { task_id: 'a', status: 'completed', output_file: '', summary: '' }), b)), [1]);
  assert.deepEqual(arkaSayi(ccNormallestir(sis('task_updated', { task_id: 'b', patch: { status: 'killed' } }), b)), [0]);
  // Ön plandaki görev (tur onu bekler) ve ortam/ambient görev arka plan işi sayılmaz (ön plandaki iş işler listesine girer: "Arka plana al").
  assert.deepEqual(arkaSayi(ccNormallestir(sis('task_started', { task_id: 'c', description: 'x', is_backgrounded: false }), b)), []);
  assert.deepEqual(ccNormallestir(sis('task_started', { task_id: 'd', description: 'x', is_backgrounded: true, ambient: true }), b), []);
  assert.deepEqual(ccNormallestir(sis('task_started', { task_id: 'e', description: 'x', is_backgrounded: true, skip_transcript: true }), b), []);
});

test('arka plan: background_tasks_changed seviye sinyalidir — kümeyi DEĞİŞTİRİR (kaçan kenar sayıyı takılı bırakmaz)', () => {
  const b = yeniBaglam();
  const gorev = (id: string, ek: object = {}) => ({ task_id: id, task_type: 'local_agent', description: id, ...ek });
  assert.deepEqual(arkaSayi(ccNormallestir(sis('background_tasks_changed', { tasks: [gorev('a'), gorev('b'), gorev('iz', { ambient: true })] }), b)), [2], 'ambient sayılmaz');
  // Bitiş bildirimi kaçtı; sonraki seviye sinyali kümeyi düzeltir.
  assert.deepEqual(arkaSayi(ccNormallestir(sis('background_tasks_changed', { tasks: [gorev('b')] }), b)), [1]);
  assert.deepEqual(arkaSayi(ccNormallestir(sis('background_tasks_changed', { tasks: [] }), b)), [0]);
  assert.deepEqual(ccNormallestir(sis('background_tasks_changed', { tasks: [] }), b), [], 'değişmeyen sayı yeniden bildirilmez');
  // Bozuk yük çökertmez, sayıyı da bozmaz.
  assert.deepEqual(ccNormallestir(sis('background_tasks_changed', { tasks: 'x' }), b), []);
});

test('arka plan: süreç yeniden açılınca küme sıfırlanır (arkaPlanSifirla)', () => {
  const b = yeniBaglam();
  ccNormallestir(sis('task_started', { task_id: 'a', description: 'x', is_backgrounded: true }), b);
  assert.deepEqual(arkaSayi(arkaPlanSifirla(b)), [0]);
  assert.deepEqual(arkaPlanSifirla(b), [], 'zaten sıfırsa olay yok');
});

test('maliyet: apiKeySource init\'ten gelir; yalnız API anahtarı kaynakları dolar gösterilir, bilinmiyorsa gösterilmez', () => {
  const init = (ek: object) => ({ type: 'system', subtype: 'init', session_id: 'x', ...ek });
  const b = yeniBaglam();
  assert.equal((ccNormallestir(init({ apiKeySource: 'none' }), b)[0] as { apiKaynak?: string }).apiKaynak, 'none');
  assert.deepEqual(['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key'].map(ccParaGosterilir), [true, true, true]);
  assert.deepEqual(['none', 'oauth', 'user', undefined, '', 5].map(ccParaGosterilir), [false, false, false, false, false, false]);
  const sonuc = (b2: ReturnType<typeof yeniBaglam>) => ccNormallestir({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 5.5, duration_ms: 1, num_turns: 1 }, b2)[0] as { paraGoster?: boolean; maliyetUsd: number };
  assert.equal(sonuc(b).paraGoster, false, 'üyelik (none)');
  const k = yeniBaglam();
  ccNormallestir(init({ apiKeySource: 'ANTHROPIC_API_KEY' }), k);
  assert.equal(sonuc(k).paraGoster, true, 'API anahtarı');
  assert.equal(sonuc(yeniBaglam()).paraGoster, false, 'init görülmedi → bilinmiyor → gösterilmez');
  assert.equal(sonuc(k).maliyetUsd, 5.5, 'tutar korunur; göstermek arayüzün kararı');
});

test('bitiş bildirimi: arka planda iş sürerken "bitirdi" demez', () => {
  const n = ccBitisBildirimi({ proje: 'acme', degisenDosya: 1, sonMetin: 'Tamam.', sonuc: { basarili: true, kesildi: false }, arkaPlan: 2 });
  assert.equal(n.baslik, 'Claude Code turu bitirdi · acme');
  assert.match(n.metin, /Arka planda 2 iş sürüyor/);
  assert.equal(ccBitisBildirimi({ proje: 'acme', degisenDosya: 1, sonMetin: 'Tamam.', sonuc: { basarili: true, kesildi: false }, arkaPlan: 0 }).baslik, 'Claude Code bitirdi · acme');
});
