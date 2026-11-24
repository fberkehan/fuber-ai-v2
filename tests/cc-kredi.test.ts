// 0.13 T12: tahmini dolar — `total_cost_usd` API fiyatıyla hesaplanan TAHMİNDİR; Claude üyeliğiyle çalışan kişiye para harcanmış gibi
// görünmemeli. Ayrım init iletisindeki apiKeySource ile; bilinmiyorsa dolar gösterilmez. Hesap satırı: SDK accountInfo() — yalnız
// e-posta ve plan (kuruluş adı, belirteç ve kaynak ana süreçten çıkmaz). SAHTE Claude Code (scripts/dev/sahte-claude.mjs); gerçek claude ASLA açılmaz.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cc-kredi-'));
process.env.FUBER_CLAUDE_DIZIN = path.join(tmp, '.claude');
process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]);
delete process.env.FUBER_SAHTE_CLAUDE_KAYIT;
const proje = path.join(tmp, 'proje');
fs.mkdirSync(proje, { recursive: true });

const { CcYonetici } = await import('../src/main/claudecode/oturum-yoneticisi.ts');
const { ccKomutu } = await import('../src/main/claudecode/yurutucu.ts');
const { sonucEtiketi, maliyetSatiri } = await import('../src/renderer/claudecode/yardimci.ts');
type Zarf = import('../src/shared/cc-olay.ts').CcOlayZarfi;
type Sonuc = import('../src/shared/cc-olay.ts').CcSonuc;

const uyu = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function bekleKosul(f: () => boolean | Promise<boolean>, ms = 10_000, ne = 'koşul'): Promise<void> {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (await f()) return; await uyu(15); }
  throw new Error(`zaman aşımı: ${ne}`);
}

const acik: InstanceType<typeof CcYonetici>[] = [];
after(async () => {
  for (const y of acik) await y.hepsiniKapat();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Sahte Claude Code'u `apiKeySource` ile açar ('-' = alan hiç gelmez) ve ilk turu bitirir. */
async function calistir(apiKaynak: string, hesap?: object) {
  process.env.SAHTE_CC_API_KAYNAK = apiKaynak;
  if (hesap) process.env.SAHTE_CC_HESAP = JSON.stringify(hesap); else delete process.env.SAHTE_CC_HESAP;
  const zarflar: Zarf[] = [];
  const y = new CcYonetici({ komut: ccKomutu, ayar: () => ({ tamYetki: false, varsayilanMod: 'acceptEdits' as const }), olay: (z) => zarflar.push(z), kapanisSuresiMs: 1500, kapatmaBeklemeMs: 1500 });
  acik.push(y);
  const r = await y.baslat({ cwd: proje, istem: 'merhaba' });
  assert.ok(r.tamam, r.hata);
  const id = r.oturum!.id;
  await bekleKosul(() => zarflar.some((z) => z.oturum === id && z.olay.tur === 'sonuc'), 10_000, 'sonuç');
  await bekleKosul(() => y.oturumlar().find((o) => o.id === id)?.durum === 'bosta', 3000, 'boşta');
  const sonuc = zarflar.find((z) => z.oturum === id && z.olay.tur === 'sonuc')!.olay as Sonuc;
  return { y, id, sonuc, ozet: () => y.oturumlar().find((o) => o.id === id)! };
}

test('üyelikle çalışan oturumda sonuç kartı ve Denetçi dolar göstermez (apiKeySource none)', async () => {
  const { sonuc, ozet } = await calistir('none');
  assert.ok(sonuc.maliyetUsd > 0, 'tahmin tutarı Claude Code\'dan geldi');
  assert.equal(sonuc.paraGoster, false);
  assert.doesNotMatch(sonucEtiketi(sonuc, 0).parcalar, /\$|≈/, 'sonuç kartı');
  assert.equal(ozet().maliyetUsd, undefined, 'oturum özeti tutarı taşımaz (Denetçi satırı yok)');
  assert.equal(maliyetSatiri(ozet()), null, 'Denetçi');
});

test('apiKeySource bilinmiyorsa (alan yok ya da eski değer) dolar gösterilmez', async () => {
  for (const kaynak of ['-', 'oauth', 'user']) {
    const { sonuc, ozet } = await calistir(kaynak);
    assert.notEqual(sonuc.paraGoster, true, kaynak);
    assert.doesNotMatch(sonucEtiketi(sonuc, 0).parcalar, /\$|≈/, kaynak);
    assert.equal(maliyetSatiri(ozet()), null, kaynak);
  }
});

test('API anahtarıyla çalışanda "≈" tutar kalır (ANTHROPIC_API_KEY, apiKeyHelper, /login managed key)', async () => {
  for (const kaynak of ['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key']) {
    const { sonuc, ozet } = await calistir(kaynak);
    assert.equal(sonuc.paraGoster, true, kaynak);
    assert.match(sonucEtiketi(sonuc, 0).parcalar, /≈ \$0,0012/, kaynak);
    assert.match(maliyetSatiri(ozet()) ?? '', /^≈ \$0,0012$/, kaynak);
  }
});

test('hesap: SDK accountInfo → yalnız e-posta ve plan; oturum yokken null; kuruluş adı ve kaynak dışarı çıkmaz', async () => {
  const bos = new CcYonetici({ komut: ccKomutu, ayar: () => ({ tamYetki: false, varsayilanMod: 'acceptEdits' as const }) });
  acik.push(bos);
  assert.equal(await bos.hesap(), null, 'hiç oturum açılmadıysa hesap bilinmez (süreç AÇILMAZ)');
  const { y } = await calistir('none', { email: 'deniz@ornek.test', subscriptionType: 'max', organization: 'Gizli Kuruluş', tokenSource: 'claude.ai', apiKeySource: 'none' });
  let h: Awaited<ReturnType<typeof y.hesap>> = null;
  await bekleKosul(async () => { h = await y.hesap(); return h !== null; }, 5000, 'hesap');
  assert.deepEqual(h, { eposta: 'deniz@ornek.test', plan: 'max' });
  // Hesapsız (API anahtarı ya da bilgi yok): null.
  const { y: y2 } = await calistir('ANTHROPIC_API_KEY');
  await uyu(300);
  assert.equal(await y2.hesap(), null);
});
