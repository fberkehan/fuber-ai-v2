// GERÇEK Claude Code ile sınama. Varsayılan olarak ATLANIR (geliştiricinin abonelik kotasından harcar); yalnız sınama sınırı
// gerçek CLI'yi açıkça seçince koşar:
//
//   FUBER2_CLAUDE_CLI=real npx vitest run apps/desktop/src/main/modules/projects/claude/manager.real.test.ts
//
// Yalnız kendi oluşturduğu geçici deneme klasöründe (Türkçe harfli yol), en ucuz modelle, kısa görevlerle çalışır:
// toplam 6 kullanıcı iletisi. Kanıt satırları konsola yazılır (oturum içeriği kısaltılarak).
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { locateClaudeCli } from '../../../core/claude-cli/locate';
import { testing } from '../../../testing';
import { createHarness, waitFor, type Harness } from './testkit';

const real = testing.claudeCli === 'auto' ? locateClaudeCli() : null;
const MARKER = 'MAVİ-KAPLUMBAĞA-42';
const note = (line: string) => console.log(`  [gerçek CLI] ${line}`);

describe.skipIf(!real)('gerçek Claude Code (kota harcar; elle koşulur)', () => {
  let h: Harness;
  afterAll(async () => {
    await h?.cleanup();
  }, 60_000);

  it('başlat → dosya yazdır (izin onayı) → ikinci ileti → araya gir → durdur → kapat ve sürdür', async () => {
    h = createHarness({ cli: () => ({ command: real!, prefixArgs: [] }), deps: { settleMs: 1500, interruptGraceMs: 8000, closeGraceMs: 2500, shutdownMs: 5000 } });
    fs.writeFileSync(path.join(h.dir, 'CLAUDE.md'), `# Deneme projesi\n\nBu projenin gizli sözcüğü: ${MARKER}. Gizli sözcük sorulursa aynen bunu söyle.\n`);
    note(`deneme klasörü: ${h.dir}`);

    // 1) Başlat: proje CLAUDE.md'si okunuyor mu + dosya yazma izni.
    const started = await h.manager.start({
      cwd: h.dir,
      model: 'haiku',
      prompt: 'İki iş: (1) Bu projenin gizli sözcüğünü söyle. (2) Write aracıyla bu klasörde not.txt adlı dosya oluştur; içeriği tam olarak şu tek satır olsun: merhaba fuber',
    });
    expect(started.ok).toBe(true);
    const id = started.session!.id;
    const permission = await waitFor(() => h.permissions[0], 'izin isteği', 120_000);
    note(`izin isteği: ${permission.request.tool} · ${path.basename(permission.request.summary)} · "hep izin ver" sunuluyor: ${permission.request.canAlways}`);
    expect(permission.request.kind).toBe('edit');
    expect(h.status(id)).toBe('permission');
    expect(fs.existsSync(path.join(h.dir, 'not.txt'))).toBe(false);
    expect(h.manager.answerPermission(id, permission.request.requestId, { decision: 'allow' })).toEqual({ ok: true });
    await h.waitStatus(id, 'done', 120_000);
    expect(fs.readFileSync(path.join(h.dir, 'not.txt'), 'utf8').trim()).toBe('merhaba fuber');
    expect(h.text(id)).toContain(MARKER);
    const init = h.of('init', id)[0]!;
    const detail = h.manager.detail(id)!;
    note(`init: sürüm ${init.version}, model ${init.model}, kip ${init.mode}, apiKeySource ${init.apiKeySource}`);
    note(`kullanıcının ayarları oturumda: ${init.skills.length} beceri, ${init.mcpServers.length} MCP sunucusu, ${init.commands.length} eğik çizgi komutu, ${init.tools.length} araç; el sıkışmada ${detail.commands.length} komut`);
    note(`proje CLAUDE.md'si okundu: yanıtta gizli sözcük var; dosya yazıldı: not.txt; değişen dosya: ${detail.changedFiles}`);
    // v1'in kök nedeni: boş sistem istemi ve yüklenmeyen ayar kaynakları. Burada ikisi de CLI'nin kendisiyle aynı.
    expect(init.commands.length).toBeGreaterThan(5);
    expect(init.tools).toEqual(expect.arrayContaining(['Read', 'Edit', 'Bash']));
    expect(detail.changedFilesList).toEqual([path.join(h.dir, 'not.txt')]);
    await waitFor(() => h.turnEnds.length === 1, 'ilk bitiş bildirimi', 30_000);
    const sessionId = detail.sessionId!;

    // 2) İkinci ileti aynı oturuma: bağlam sürüyor mu.
    expect(await h.manager.send(id, { text: 'Az önce oluşturduğun dosyanın adını yalnız dosya adı olarak yaz.' })).toEqual({ ok: true });
    await waitFor(() => h.of('result', id).length === 2, 'ikinci sonuç', 120_000);
    await h.waitStatus(id, 'done', 30_000);
    const second = h.of('text', id).at(-1)!.text;
    note(`ikinci ileti yanıtı: ${second.slice(0, 80).replace(/\s+/g, ' ')}`);
    expect(second).toContain('not.txt');
    expect(h.manager.summary(id)!.sessionId).toBe(sessionId);

    // 3) Araya girme: tur sürerken yazılan ileti hemen gider; iki ileti de işlenir, bitiş bir kez bildirilir.
    const endsBefore = h.turnEnds.length;
    await h.manager.send(id, { text: "1'den 40'a kadar say; her sayıyı ayrı satıra yaz, başka bir şey yazma." });
    await h.waitStatus(id, 'running', 60_000);
    await waitFor(() => h.of('text_delta', id).length > 0 && h.text(id).includes('3'), 'sayma başladı', 60_000);
    expect(await h.manager.send(id, { text: 'Saymayı bitirdikten sonra en sona tek başına GÖKKUŞAĞI yaz.' })).toEqual({ ok: true });
    expect(h.manager.detail(id)!.queue).toHaveLength(0);
    await waitFor(() => h.text(id).includes('GÖKKUŞAĞI') && h.status(id) === 'done', 'araya giren ileti işlendi', 180_000);
    await waitFor(() => h.turnEnds.length > endsBefore, 'bitiş bildirimi', 30_000);
    const resultsAfter = h.of('result', id).length;
    note(`araya girme: ileti tur sürerken yazıldı; sonuç sayısı ${resultsAfter} (2 ileti ${resultsAfter - 2} turda işlendi); bitiş bildirimi ${h.turnEnds.length - endsBefore} kez`);
    expect(h.turnEnds.length - endsBefore).toBe(1);

    // 4) Durdur.
    await h.manager.send(id, { text: "1'den 300'e kadar say; her sayıyı ayrı satıra, yanına Türkçe okunuşuyla yaz." });
    await h.waitStatus(id, 'running', 60_000);
    const before = h.of('text_delta', id).length;
    await waitFor(() => h.of('text_delta', id).length > before + 3, 'uzun yanıt akıyor', 60_000);
    const pid = h.manager.pids()[0];
    expect(await h.manager.interrupt(id)).toEqual({ ok: true });
    await h.waitStatus(id, 'stopped', 30_000);
    note(`durdur: tur kesildi (son sonuç interrupted=${h.of('result', id).at(-1)!.interrupted}); süreç ${h.manager.pids()[0] === pid ? 'aynı, açık' : 'kapandı'}`);
    expect(h.of('result', id).at(-1)!.interrupted).toBe(true);

    // 5) Kapat ve sürdür: yeni süreç --resume ile aynı oturumu açar.
    await h.manager.close(id);
    expect(h.status(id)).toBe('closed');
    expect(h.manager.pids()).toHaveLength(0);
    await h.manager.send(id, { text: 'Tek sözcükle yanıtla: bu projenin gizli sözcüğü neydi?' });
    await h.waitStatus(id, 'done', 120_000);
    const resumed = h.of('text', id).at(-1)!.text;
    note(`kapat → sürdür: oturum kimliği aynı (${h.manager.summary(id)!.sessionId === sessionId}); yanıt: ${resumed.slice(0, 60).replace(/\s+/g, ' ')}`);
    expect(h.manager.summary(id)!.sessionId).toBe(sessionId);
    expect(resumed).toContain(MARKER);
    const usage = h.manager.summary(id)!.usage!;
    note(`toplam: ${h.of('user', id).length} kullanıcı iletisi, ${h.manager.summary(id)!.turns} tur, çıktı belirteci ${usage.output}, tahmini dolar gösterimi: ${h.manager.summary(id)!.costUsd === undefined ? 'yok (abonelik)' : 'var'}`);
  }, 900_000);

  it("durdur: cancel_queued alanlı durdurma isteğini gerçek CLI kabul eder; süreç açık kalır", async () => {
    await h?.cleanup();
    h = createHarness({ cli: () => ({ command: real!, prefixArgs: [] }), deps: { settleMs: 1500, interruptGraceMs: 8000, closeGraceMs: 2500, shutdownMs: 5000 } });
    const started = await h.manager.start({ cwd: h.dir, model: "haiku", prompt: "1'den 300'e kadar say; her sayıyı ayrı satıra, yanına Türkçe okunuşuyla yaz." });
    const id = started.session!.id;
    await h.waitStatus(id, "running", 60_000);
    await waitFor(() => h.of("text_delta", id).length > 3, "yanıt akıyor", 60_000);
    const pid = h.manager.pids()[0];
    const at = Date.now();
    expect(await h.manager.interrupt(id)).toEqual({ ok: true });
    await h.waitStatus(id, "stopped", 30_000);
    note(`durdur (cancel_queued): ${Date.now() - at} ms içinde "durduruldu"; uyarı satırı: ${h.of("system", id).filter((event) => event.level === "warn").length}; süreç ${h.manager.pids()[0] === pid ? "aynı, açık" : "kapandı"}`);
    expect(h.of("system", id).filter((event) => event.level === "warn")).toHaveLength(0);
    expect(h.manager.pids()[0]).toBe(pid);
  }, 300_000);
});
