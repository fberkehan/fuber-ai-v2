// Analiz 11 Kas (geliştirici bulgu 2 ve 5): model adlarının eşlenmesi (init'in tam kimliği seçimi ezmez, dostça adla görünür) ve Claude Code
// işlerinin listesi (task_* / tool_progress / Bash arka plan çıktı dosyası). Saf normalleştirici; SDK yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccNormallestir, yeniBaglam, arkaPlanSifirla, ccModelTakmaAdi, ccModelGorunenAdi, ccSeciliModel, ciktiDosyasiBul, type CcOlay, type CcArkaIs } from '../src/shared/cc-olay.ts';

const liste = [{ deger: 'default', ad: 'Default (recommended)' }, { deger: 'sonnet', ad: 'Sonnet' }, { deger: 'haiku', ad: 'Haiku' }];

test('model: tam kimlik takma ada eşlenir; dostça ad', () => {
  assert.equal(ccModelTakmaAdi('claude-sonnet-4-5-20250929'), 'sonnet');
  assert.equal(ccModelTakmaAdi('claude-opus-4-5-20251101'), 'opus');
  assert.equal(ccModelTakmaAdi('claude-3-5-haiku-20241022'), 'haiku');
  assert.equal(ccModelTakmaAdi('opus[1m]'), 'opus');
  assert.equal(ccModelTakmaAdi('sonnet'), 'sonnet');
  assert.equal(ccModelTakmaAdi('gpt-5'), null);
  assert.equal(ccModelGorunenAdi('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(ccModelGorunenAdi('claude-opus-4-5-20251101'), 'Opus 4.5');
  assert.equal(ccModelGorunenAdi('claude-3-5-haiku-20241022'), 'Haiku 3.5');
  assert.equal(ccModelGorunenAdi('claude-opus-4-1'), 'Opus 4.1');
  assert.equal(ccModelGorunenAdi('opus'), 'Opus');
  assert.equal(ccModelGorunenAdi('sonnet', liste), 'Sonnet');
  assert.equal(ccModelGorunenAdi('default', liste), 'Varsayılan');
  assert.equal(ccModelGorunenAdi(undefined), 'Varsayılan');
  assert.equal(ccModelGorunenAdi('claude-sahte-hizli', [{ deger: 'claude-sahte-hizli', ad: 'Hızlı' }]), 'Hızlı');
  assert.equal(ccModelGorunenAdi('ozel-model'), 'ozel-model');
});

test('model: seçicinin seçili değeri — listede varsa kendisi, tam kimlik listedeki takma ada, yoksa kendisi', () => {
  assert.equal(ccSeciliModel('sonnet', liste), 'sonnet');
  assert.equal(ccSeciliModel('claude-sonnet-4-5-20250929', liste), 'sonnet');
  assert.equal(ccSeciliModel('claude-opus-4-5-20251101', liste), 'claude-opus-4-5-20251101', 'listede opus yok: kendisi (seçici dostça adla ekler)');
  assert.equal(ccSeciliModel(null, liste), '');
  assert.equal(ccSeciliModel('default', liste), '');
});

const kopya = (o: CcOlay[]) => o.filter((x): x is Extract<CcOlay, { tur: 'arka-isler' }> => x.tur === 'arka-isler').at(-1)?.isler ?? null;

test('işler: task_started (ön plan Bash) → tool_progress süresi → arka plana alınınca çıktı dosyası → bitti', () => {
  const b = yeniBaglam();
  const n = (m: unknown) => ccNormallestir(m, b);
  // Bash araç çağrısı (ön planda), sonra task_started.
  n({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm run dev' } }] } });
  let l = kopya(n({ type: 'system', subtype: 'task_started', task_id: 'b1', tool_use_id: 'tu1', description: 'npm run dev', task_type: 'local_bash', is_backgrounded: false }));
  assert.ok(l);
  assert.equal(l!.length, 1);
  assert.deepEqual({ ...l![0], baslangic: 0 }, { id: 'b1', aciklama: 'npm run dev', tip: 'kabuk', durum: 'suruyor', arkaPlanda: false, aracId: 'tu1', baslangic: 0 });
  // Ön plandaki iş arka plan sayısına girmez.
  assert.equal(b.arkaPlan.size, 0);
  l = kopya(n({ type: 'tool_progress', tool_use_id: 'tu1', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 7.4 }));
  assert.equal(l![0].sureSn, 7);
  assert.deepEqual(n({ type: 'tool_progress', tool_use_id: 'tu1', tool_name: 'Bash', parent_tool_use_id: null, elapsed_time_seconds: 7.9 }), [], 'aynı saniye yeniden yayınlanmaz');
  // Kullanıcı "Arka plana al" dedi: task_updated + araç sonucu (çıktı dosyası).
  n({ type: 'system', subtype: 'task_updated', task_id: 'b1', patch: { is_backgrounded: true } });
  assert.equal(b.arkaPlan.size, 1, 'arka plana alınan iş sayılır');
  const s = n({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Command running in background with ID: b1. Output is being written to: C:\\Temp\\claude\\tasks\\b1.output' }] } });
  l = kopya(s);
  assert.equal(l![0].ciktiDosyasi, 'C:\\Temp\\claude\\tasks\\b1.output');
  assert.equal(l![0].arkaPlanda, true);
  l = kopya(n({ type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'stopped', output_file: 'C:\\Temp\\claude\\tasks\\b1.output', summary: 'durduruldu' }));
  assert.equal(l![0].durum, 'durduruldu');
  assert.equal(b.arkaPlan.size, 0);
});

test('işler: arka planda başlayan alt ajan — task_progress son araç ve özet; ambient iş listeye girmez; çıktı dosyası task_started\'dan önce gelebilir', () => {
  const b = yeniBaglam();
  const n = (m: unknown) => ccNormallestir(m, b);
  assert.equal(kopya(n({ type: 'system', subtype: 'task_started', task_id: 'w', description: 'izleyici', ambient: true })), null, 'ambient iş yok');
  let l = kopya(n({ type: 'system', subtype: 'task_started', task_id: 'a1', description: 'Testleri incele', task_type: 'local_agent', is_backgrounded: true }));
  assert.equal(l![0].tip, 'ajan');
  l = kopya(n({ type: 'system', subtype: 'task_progress', task_id: 'a1', description: 'Testleri incele', usage: { total_tokens: 10, tool_uses: 2, duration_ms: 12_500 }, last_tool_name: 'Grep', summary: 'test klasörünü tarıyor' }));
  assert.equal(l![0].sonArac, 'Grep');
  assert.equal(l![0].ozet, 'test klasörünü tarıyor');
  assert.equal(l![0].sureSn, 12);
  // Bash sonucu (çıktı dosyası) task_started'dan önce.
  n({ type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 'tu9', name: 'Bash', input: { command: 'npm run watch', run_in_background: true } }] } });
  n({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu9', content: 'Command running in background with ID: b9. Output is being written to: /tmp/x/b9.output' }] } });
  l = kopya(n({ type: 'system', subtype: 'task_started', task_id: 'b9', tool_use_id: 'tu9', description: 'npm run watch', task_type: 'local_bash', is_backgrounded: true }));
  assert.equal(l!.find((i) => i.id === 'b9')!.ciktiDosyasi, '/tmp/x/b9.output');
  // Süreç öldü: süren işler "durduruldu", liste kalır.
  const s = arkaPlanSifirla(b);
  const son = kopya(s) as CcArkaIs[];
  assert.ok(son.every((i) => i.durum === 'durduruldu'));
  assert.equal(son.length, 2);
});

test('işler: seviye sinyali task_started kaçsa da satırı kurar; biten işler en çok 8 tutulur', () => {
  const b = yeniBaglam();
  const n = (m: unknown) => ccNormallestir(m, b);
  const l = kopya(n({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'x1', task_type: 'local_bash', description: 'vite' }] }));
  assert.equal(l![0].aciklama, 'vite');
  assert.equal(l![0].arkaPlanda, true);
  for (let i = 0; i < 12; i++) {
    n({ type: 'system', subtype: 'task_started', task_id: `t${i}`, description: `iş ${i}`, task_type: 'local_agent', is_backgrounded: true });
    n({ type: 'system', subtype: 'task_notification', task_id: `t${i}`, status: 'completed', output_file: '', summary: 'bitti' });
  }
  const son = kopya(n({ type: 'system', subtype: 'task_notification', task_id: 'x1', status: 'completed', output_file: '', summary: 'bitti' }))!;
  assert.ok(son.filter((i) => i.durum !== 'suruyor').length <= 8);
});

test('çıktı dosyası metinden', () => {
  assert.equal(ciktiDosyasiBul('Command running in background with ID: abc. Output is being written to: C:\\a b\\c.output\n'), 'C:\\a b\\c.output');
  assert.equal(ciktiDosyasiBul('merhaba'), undefined);
});

test('inceleme M4: çıktı dosyası yalnız Claude Code\'un kendi arka plan cümlesinden; ağ yolu ve metin içindeki benzer satır kabul edilmez', () => {
  assert.equal(ciktiDosyasiBul('dosyanın içeriği:\nOutput is being written to: C:\\x\\y.output'), undefined, 'ön planda cat edilen dosyadaki satır');
  assert.equal(ciktiDosyasiBul('Command running in background with ID: b1. Output is being written to: \\\\saldirgan\\pay\\x.output'), undefined, 'UNC');
  assert.equal(ciktiDosyasiBul('Command running in background with ID: b1. Output is being written to: //saldirgan/pay/x.output'), undefined);
  assert.equal(ciktiDosyasiBul('Command running in background with ID: b1. Output is being written to: C:\\T\\b1.output'), 'C:\\T\\b1.output');
});
