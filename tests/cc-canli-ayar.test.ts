// Analiz 11 Kas (geliştirici bulgu 1, 2, 5): canlı Claude Code oturumunda düşünme gücü (applyFlagSettings), model seçiminin init'in tam
// kimliğiyle ezilmemesi ve işler (Durdur = stopTask, Arka plana al = backgroundTasks, canlı çıktı kuyruğu). GERÇEK Agent SDK + SAHTE
// Claude Code (scripts/dev/sahte-claude.mjs); gerçek claude.exe ve ağ YOK.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cc-canli-'));
process.env.FUBER_CLAUDE_DIZIN = path.join(tmp, '.claude');
process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]);
delete process.env.FUBER_SAHTE_CLAUDE_KAYIT;
const proje = path.join(tmp, 'proje');
fs.mkdirSync(proje, { recursive: true });

const { CcYonetici } = await import('../src/main/claudecode/oturum-yoneticisi.ts');
const { ccKomutu } = await import('../src/main/claudecode/yurutucu.ts');
type Zarf = import('../src/shared/cc-olay.ts').CcOlayZarfi;
type Olay = import('../src/shared/cc-olay.ts').CcOlay;
type Yonetici = InstanceType<typeof CcYonetici>;

const uyu = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function bekleKosul(f: () => boolean, ms = 10_000, ne = 'koşul'): Promise<void> {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (f()) return; await uyu(15); }
  throw new Error(`zaman aşımı: ${ne}`);
}
const acik: Yonetici[] = [];
after(async () => {
  for (const y of acik) await y.hepsiniKapat();
  delete process.env.SAHTE_CC_TAM_KIMLIK; delete process.env.SAHTE_CC_EFOR_RET; delete process.env.SAHTE_CC_MODELLER;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function kur() {
  const zarflar: Zarf[] = [];
  const y = new CcYonetici({ komut: ccKomutu, ayar: () => ({ tamYetki: false, varsayilanMod: 'acceptEdits' }), olay: (z) => zarflar.push(z), kapanisSuresiMs: 1500, kapatmaBeklemeMs: 1500 });
  acik.push(y);
  const olaylar = (id: string, tur?: Olay['tur']) => zarflar.filter((z) => z.oturum === id && (!tur || z.olay.tur === tur)).map((z) => z.olay);
  const bekleOlay = async <T extends Olay['tur']>(id: string, tur: T, n = 1, ms = 10_000) => {
    await bekleKosul(() => olaylar(id, tur).length >= n, ms, `${tur} #${n}`);
    return olaylar(id, tur)[n - 1] as Extract<Olay, { tur: T }>;
  };
  const ozet = (id: string) => y.oturumlar().find((o) => o.id === id)!;
  const metinSon = (id: string) => (olaylar(id, 'metin').at(-1) as { metin: string }).metin;
  return { y, olaylar, bekleOlay, ozet, metinSon };
}

test('bulgu 1: düşünme gücü canlı oturumda applyFlagSettings ile değişir; özet yeni değeri taşır; null varsayılana döner', async () => {
  const t = kur();
  const r = await t.y.baslat({ cwd: proje, istem: '#durum', efor: 'high' });
  const id = r.oturum!.id;
  await t.bekleOlay(id, 'sonuc');
  assert.match(t.metinSon(id), /efor=high /);
  assert.equal(t.ozet(id).efor, 'high');
  assert.deepEqual(await t.y.eforDegistir(id, 'low'), { tamam: true });
  assert.equal(t.ozet(id).efor, 'low');
  await t.y.gonder(id, { metin: '#durum' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.match(t.metinSon(id), /efor=low /, 'aynı süreçte (yeniden açılmadan) yeni güç');
  assert.equal(t.y.pid(id) !== undefined, true, 'süreç kapanmadı');
  assert.deepEqual(await t.y.eforDegistir(id, null), { tamam: true });
  assert.equal(t.ozet(id).efor, undefined);
  await t.y.gonder(id, { metin: '#durum' });
  await t.bekleOlay(id, 'sonuc', 3);
  assert.match(t.metinSon(id), /efor=- /, 'null: modelin varsayılanı');
  assert.equal((await t.y.eforDegistir(id, 'cok')).kod, 'gecersiz');
});

test('bulgu 1: Claude Code applyFlagSettings tanımıyorsa değer kayda yazılır, kod "sonraki"; sonraki mesaj yeni süreçle o güçte', async () => {
  process.env.SAHTE_CC_EFOR_RET = '1';
  try {
    const t = kur();
    const id = (await t.y.baslat({ cwd: proje, istem: '#durum' })).oturum!.id;
    await t.bekleOlay(id, 'sonuc');
    await bekleKosul(() => t.ozet(id).durum === 'bosta', 3000, 'boşta');
    const r = await t.y.eforDegistir(id, 'max');
    assert.deepEqual(r, { tamam: true, kod: 'sonraki' });
    assert.equal(t.ozet(id).efor, 'max');
    await t.y.gonder(id, { metin: '#durum' });
    await t.bekleOlay(id, 'sonuc', 2);
    assert.match(t.metinSon(id), /efor=max /, 'yeni süreç --effort max ile açıldı');
  } finally { delete process.env.SAHTE_CC_EFOR_RET; }
});

test('bulgu 2: sahte tam kimlik döndürse de (gerçek CLI gibi) kullanıcının seçimi korunur; tam kimlik etkinModel\'de', async () => {
  process.env.SAHTE_CC_TAM_KIMLIK = '1';
  process.env.SAHTE_CC_MODELLER = JSON.stringify([{ value: 'default', displayName: 'Default (recommended)', description: 'Opus' }, { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.5' }, { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5' }]);
  try {
    const t = kur();
    const id = (await t.y.baslat({ cwd: proje, istem: '#durum' })).oturum!.id;
    await t.bekleOlay(id, 'sonuc');
    assert.equal(t.ozet(id).model, undefined, 'seçim yok: Varsayılan kalır (init tam kimliği seçime yazılmaz)');
    assert.equal(t.ozet(id).etkinModel, 'claude-opus-4-5-20251101');
    assert.deepEqual(await t.y.modelDegistir(id, 'sonnet'), { tamam: true });
    await t.y.gonder(id, { metin: '#durum' });
    await t.bekleOlay(id, 'sonuc', 2);
    assert.match(t.metinSon(id), /model=sonnet /);
    assert.equal(t.ozet(id).model, 'sonnet', 'tur sonrası seçici hâlâ Sonnet (ham kimliğe dönmez)');
    assert.equal(t.ozet(id).etkinModel, 'claude-sonnet-4-5-20250929');
    const bas = t.olaylar(id, 'baslangic').at(-1) as { model: string };
    assert.equal(bas.model, 'claude-sonnet-4-5-20250929', 'sahte gerçekten tam kimlik döndürdü');
    // Varsayılana dönüş de korunur.
    assert.deepEqual(await t.y.modelDegistir(id, null), { tamam: true });
    await t.y.gonder(id, { metin: '#durum' });
    await t.bekleOlay(id, 'sonuc', 3);
    assert.equal(t.ozet(id).model, undefined);
  } finally { delete process.env.SAHTE_CC_TAM_KIMLIK; delete process.env.SAHTE_CC_MODELLER; }
});

test('bulgu 5: arka plan Bash işi — ad, canlı süre, çıktı kuyruğu; Durdur stopTask ile durdurur', async () => {
  const t = kur();
  const id = (await t.y.baslat({ cwd: proje, istem: '#arkakabuk' })).oturum!.id;
  await t.bekleOlay(id, 'sonuc');
  await bekleKosul(() => (t.y.oturum(id)!.arkaIsler ?? []).some((i) => (i.sureSn ?? 0) >= 1), 8000, 'canlı süre');
  const is = t.y.oturum(id)!.arkaIsler!.find((i) => i.tip === 'kabuk')!;
  assert.equal(is.aciklama, 'Geliştirme sunucusu');
  assert.equal(is.durum, 'suruyor');
  assert.equal(is.arkaPlanda, true);
  assert.ok(is.ciktiDosyasi && is.ciktiDosyasi.endsWith('.output'));
  assert.equal(t.ozet(id).arkaPlan, 1);
  await bekleKosul(() => t.y.isCiktisi(id, is.id).satirlar.some((s) => /satır 2:/.test(s)), 6000, 'çıktı satırları');
  const c = t.y.isCiktisi(id, is.id, 3);
  assert.ok(c.satirlar.length <= 3 && c.boyut > 0);
  // Dökümde 'arka-isler' tutulmaz (anlık hâl).
  assert.equal(t.y.oturum(id)!.olaylar.filter((z) => z.olay.tur === 'arka-isler').length, 0);
  assert.deepEqual(await t.y.isDurdur(id, is.id), { tamam: true });
  await bekleKosul(() => t.y.oturum(id)!.arkaIsler!.find((i) => i.id === is.id)?.durum === 'durduruldu', 5000, 'durduruldu');
  await bekleKosul(() => t.ozet(id).arkaPlan === 0, 3000, 'sayı 0');
  assert.equal((await t.y.isDurdur(id, 'yok-boyle')).kod, 'yok');
  // Çıktı yolu süzgeci: beklenmeyen uzantı okunmaz.
  assert.ok(t.y.isCiktisi(id, 'yok').hata);
});

test('bulgu 5: ön plandaki iş "Arka plana al" (backgroundTasks) ile arkaya geçer, tur biter; iş sürer', async () => {
  const t = kur();
  const id = (await t.y.baslat({ cwd: proje, istem: '#onplan:20' })).oturum!.id;
  await bekleKosul(() => (t.y.oturum(id)?.arkaIsler ?? []).some((i) => i.durum === 'suruyor' && !i.arkaPlanda), 8000, 'ön plan işi');
  const is = t.y.oturum(id)!.arkaIsler!.find((i) => !i.arkaPlanda)!;
  assert.equal(t.ozet(id).durum, 'calisiyor');
  assert.deepEqual(await t.y.arkaPlanaAl(id, is.id), { tamam: true });
  const s = await t.bekleOlay(id, 'sonuc', 1, 8000);
  assert.equal(s.basarili, true);
  await bekleKosul(() => t.y.oturum(id)!.arkaIsler!.find((i) => i.id === is.id)?.arkaPlanda === true, 3000, 'arkada');
  assert.equal(t.ozet(id).arkaPlan, 1);
  assert.match(t.metinSon(id), /arka plana alındı/);
});

test('inceleme M5: canlıda uygulanamayan düşünme gücü arkada iş sürerken bekler; iş bitince süreç yeniden açılır, sonraki mesaj yeni güçte', async () => {
  process.env.SAHTE_CC_EFOR_RET = '1';
  try {
    const t = kur();
    const id = (await t.y.baslat({ cwd: proje, istem: '#arkaplan' })).oturum!.id;
    await t.bekleOlay(id, 'sonuc');
    await bekleKosul(() => t.ozet(id).durum === 'bosta' && t.ozet(id).arkaPlan === 1, 3000, 'boşta + arka plan');
    const pid = t.y.pid(id);
    assert.deepEqual(await t.y.eforDegistir(id, 'max'), { tamam: true, kod: 'sonraki' });
    assert.equal(t.y.pid(id), pid, 'arkada iş varken süreç kapatılmadı (iş ölmesin)');
    await t.y.gonder(id, { metin: '#arkabit' });
    await t.bekleOlay(id, 'sonuc', 2);
    await bekleKosul(() => t.y.pid(id) === undefined, 5000, 'iş bitince süreç kapandı');
    await t.y.gonder(id, { metin: '#durum' });
    await t.bekleOlay(id, 'sonuc', 3);
    assert.match(t.metinSon(id), /efor=max /, 'sonraki mesaj yeni güçle');
  } finally { delete process.env.SAHTE_CC_EFOR_RET; }
});

test('inceleme M3: araç kimliği olmayan iş tek başına arka plana alınmaz (backgroundTasks(undefined) bütün işleri arkaya alırdı)', async () => {
  const t = kur();
  const id = (await t.y.baslat({ cwd: proje, istem: '#arkaplan' })).oturum!.id;
  await t.bekleOlay(id, 'sonuc');
  await bekleKosul(() => (t.y.oturum(id)?.arkaIsler ?? []).length > 0, 3000, 'iş listesi');
  const is = t.y.oturum(id)!.arkaIsler![0];
  assert.equal(is.aracId, undefined);
  // Arkada olan iş için zaten tamam döner; ön planda sayıp deneyelim.
  is.arkaPlanda = false;
  const k = (t.y as unknown as { kayitlar: Map<string, { arkaIsler: { id: string; arkaPlanda: boolean }[] }> }).kayitlar.get(id)!;
  k.arkaIsler.find((x) => x.id === is.id)!.arkaPlanda = false;
  assert.equal((await t.y.arkaPlanaAl(id, is.id)).kod, 'desteklenmiyor');
});
