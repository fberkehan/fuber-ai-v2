// Görev 27 (K17): uygulama içi Claude Code oturumları — GERÇEK Agent SDK (@anthropic-ai/claude-agent-sdk 0.3.310) + SAHTE Claude Code
// (scripts/dev/sahte-claude.mjs; SDK'nın stdio denetim protokolünü konuşur). Gerçek claude.exe ASLA çalışmaz (FUBER_CLAUDE_KOMUT
// zorunlu; yoksa yurutucu.ts yüksek sesle düşer — son test). ~/.claude yerine geçici FUBER_CLAUDE_DIZIN; proje klasörü geçici.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cc-oturum-'));
process.env.FUBER_CLAUDE_DIZIN = path.join(tmp, '.claude');
process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]);
process.env.SAHTE_CC_PID_DOSYASI = path.join(tmp, 'pid.txt');
delete process.env.FUBER_SAHTE_CLAUDE_KAYIT;
const proje = path.join(tmp, 'proje');
fs.mkdirSync(proje, { recursive: true });

const { CcYonetici } = await import('../src/main/claudecode/oturum-yoneticisi.ts');
const { ccKomutu, yasiyorMu, etkinAjanMetni, ajanOnbellekSil } = await import('../src/main/claudecode/yurutucu.ts');
const { baskaYerdeAcik } = await import('../src/main/claudecode/dokum.ts');
const { CC_VARSAYILAN_MODELLER } = await import('../src/shared/cc-olay.ts');
type Zarf = import('../src/shared/cc-olay.ts').CcOlayZarfi;
type Olay = import('../src/shared/cc-olay.ts').CcOlay;
type Mod = import('../src/shared/cc-olay.ts').CcMod;
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
  fs.rmSync(tmp, { recursive: true, force: true });
});

function kur(ayar: { tamYetki: boolean; varsayilanMod: Mod } = { tamYetki: false, varsayilanMod: 'acceptEdits' }, ek: Record<string, unknown> = {}) {
  const zarflar: Zarf[] = [];
  const bitenler: { id: string; sonMetin: string; degisen: string[]; sohbetId?: number; kesildi: boolean }[] = [];
  const hatalar: { id: string; hata: string; sohbetId?: number }[] = [];
  const izinler: string[] = [];
  const y = new CcYonetici({
    komut: ccKomutu, ayar: () => ayar, olay: (z) => zarflar.push(z),
    turBitti: (o, b) => bitenler.push({ id: o.id, sonMetin: b.sonMetin, degisen: b.degisenDosyalar, sohbetId: b.sohbetId, kesildi: b.sonuc.kesildi }),
    hataOldu: (o, h, sohbetId) => hatalar.push({ id: o.id, hata: h, sohbetId }),
    izinBekliyor: (o) => izinler.push(o.id),
    kapanisSuresiMs: 1500, kapatmaBeklemeMs: 1500, kesmeBeklemeMs: 4000, ...ek,
  });
  acik.push(y);
  const olaylar = (id: string, tur?: Olay['tur']) => zarflar.filter((z) => z.oturum === id && (!tur || z.olay.tur === tur)).map((z) => z.olay);
  const sonDurum = (id: string) => y.oturumlar().find((o) => o.id === id)?.durum;
  /** `n`. olay (1'den) gelene dek bekler. */
  const bekleOlay = async <T extends Olay['tur']>(id: string, tur: T, n = 1, ms = 10_000) => {
    await bekleKosul(() => olaylar(id, tur).length >= n, ms, `${tur} #${n}`);
    return olaylar(id, tur)[n - 1] as Extract<Olay, { tur: T }>;
  };
  return { y, zarflar, olaylar, sonDurum, bekleOlay, bitenler, hatalar, izinler, ayar };
}

async function baslat(t: ReturnType<typeof kur>, istem: string, ek: Record<string, unknown> = {}) {
  const r = await t.y.baslat({ cwd: proje, istem, ...ek });
  assert.ok(r.tamam, r.hata);
  return r.oturum!.id;
}

test('akış: metin parçaları sırayla gelir, tam metinle eşleşir; sonuç süre/maliyet/belirteç taşır', async () => {
  const t = kur();
  const id = await baslat(t, 'merhaba dünya');
  const sonuc = await t.bekleOlay(id, 'sonuc');
  const tum = t.olaylar(id);
  assert.equal(tum[0].tur, 'kullanici', 'gönderilen mesaj önce yankılanır');
  const bas = t.olaylar(id, 'baslangic')[0] as Extract<Olay, { tur: 'baslangic' }>;
  assert.equal(bas.surum, '2.1.310-sahte');
  assert.equal(bas.mod, 'acceptEdits', 'yeni profil varsayılanı Düzenlemelere izin ver');
  assert.ok(bas.yetenekler.includes('interrupt_receipt_v1'));
  const parcalar = t.olaylar(id, 'metin-parca') as Extract<Olay, { tur: 'metin-parca' }>[];
  const metin = t.olaylar(id, 'metin')[0] as Extract<Olay, { tur: 'metin' }>;
  assert.ok(parcalar.length >= 1, `parça sayısı ${parcalar.length}`); // ~50 ms'de bir toplu yayın
  assert.ok(parcalar.every((p) => p.blok === metin.blok), 'parçalar tam metinle aynı bloğa ait');
  assert.equal(parcalar.map((p) => p.metin).join(''), metin.metin);
  assert.match(metin.metin, /^Merhaba! Sahte Claude Code yanıtı: merhaba dünya/);
  assert.ok(tum.indexOf(parcalar.at(-1)!) < tum.indexOf(metin) && tum.indexOf(metin) < tum.indexOf(sonuc), 'sıra: parçalar → metin → sonuç');
  assert.equal(sonuc.basarili, true);
  assert.equal(sonuc.kesildi, false);
  assert.ok(sonuc.maliyetUsd > 0 && sonuc.belirtec.girdi === 120 && sonuc.belirtec.onbellekOkuma === 50 && sonuc.turSayisi === 1);
  await bekleKosul(() => t.sonDurum(id) === 'bosta', 3000, 'boşta');
  const o = t.y.oturumlar().find((x) => x.id === id)!;
  assert.ok(o.kimlik && /^[0-9a-f-]{36}$/.test(o.kimlik), 'Claude Code oturum kimliği system/init\'ten');
  assert.equal(t.bitenler.length, 1, 'iş bitti kancası (sohbete özet / ada) bir kez');
  assert.match(t.bitenler[0].sonMetin, /Merhaba!/);
  // Ayrıntı (sayfa yeniden açılınca): parçalar tam metinle değiştirilmiş, durum olayları dökümde yok.
  const ayr = t.y.oturum(id)!;
  assert.equal(ayr.olaylar.filter((z) => z.olay.tur === 'metin-parca').length, 0);
  assert.equal(ayr.olaylar.filter((z) => z.olay.tur === 'durum').length, 0);
  assert.ok(ayr.olaylar.some((z) => z.olay.tur === 'metin'));
});

test('izin: "İzin ver" → araç çalışır; kart girdisi, özet ve "hep" seçeneği; ada kancası', async () => {
  const t = kur();
  const id = await baslat(t, '#izin');
  const istek = await t.bekleOlay(id, 'izin-istegi');
  assert.equal(istek.arac, 'Bash');
  assert.equal(istek.tip, 'kabuk');
  assert.equal(istek.ozet, 'echo merhaba');
  assert.equal(istek.girdi.command, 'echo merhaba');
  assert.equal(istek.herZamanSunulur, true);
  assert.equal(istek.baslik, 'Claude Bash kullanmak istiyor');
  assert.equal(t.sonDurum(id), 'izin');
  assert.equal(t.y.oturumlar().find((o) => o.id === id)!.bekleyenIzin, 1);
  assert.deepEqual(t.izinler, [id], 'izin bekleyince ada kancası');
  assert.equal(t.y.oturum(id)!.bekleyenIzinler[0].istekId, istek.istekId);
  assert.equal(t.y.izinYanitla(id, istek.istekId, { karar: 'izin' }).tamam, true);
  assert.equal(t.y.izinYanitla(id, istek.istekId, { karar: 'izin' }).kod, 'yok', 'ikinci yanıt reddedilir');
  const bitti = await t.bekleOlay(id, 'arac-bitti');
  assert.equal(bitti.hata, false);
  assert.equal(bitti.cikti, 'merhaba');
  const sonuc = await t.bekleOlay(id, 'sonuc');
  assert.equal(sonuc.basarili, true);
  assert.deepEqual(t.olaylar(id, 'izin-yanitlandi').map((o) => (o as { karar: string }).karar), ['izin']);
  // Tek seferlik izin kural bırakmaz: ikinci istek yine sorulur.
  assert.equal((await t.y.gonder(id, { metin: '#izin' })).tamam, true);
  const ikinci = await t.bekleOlay(id, 'izin-istegi', 2);
  t.y.izinYanitla(id, ikinci.istekId, { karar: 'ret' });
  await t.bekleOlay(id, 'sonuc', 2);
});

test('izin: "Reddet" → araç hata döner, neden Claude\'a iletilir', async () => {
  const t = kur();
  const id = await baslat(t, '#izin');
  const istek = await t.bekleOlay(id, 'izin-istegi');
  t.y.izinYanitla(id, istek.istekId, { karar: 'ret', neden: 'Bu klasörde komut çalıştırma' });
  const bitti = await t.bekleOlay(id, 'arac-bitti');
  assert.equal(bitti.hata, true);
  assert.match(bitti.cikti, /Bu klasörde komut çalıştırma/);
  const metin = await t.bekleOlay(id, 'metin');
  assert.match(metin.metin, /İzin verilmedi/);
  assert.equal((await t.bekleOlay(id, 'sonuc')).basarili, true);
});

test('izin: "Bu oturumda hep izin ver" → aynı istek bu oturumda bir daha sorulmaz (yalnız oturum kapsamı)', async () => {
  const t = kur();
  const id = await baslat(t, '#izin');
  const istek = await t.bekleOlay(id, 'izin-istegi');
  t.y.izinYanitla(id, istek.istekId, { karar: 'hep' });
  await t.bekleOlay(id, 'sonuc');
  assert.deepEqual(t.olaylar(id, 'izin-yanitlandi').map((o) => (o as { karar: string }).karar), ['hep']);
  await t.y.gonder(id, { metin: '#izin' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.equal(t.olaylar(id, 'izin-istegi').length, 1, 'ikinci turda izin sorulmadı (sahte yalnız destination "session" kuralını öğrenir)');
  const bitenler = t.olaylar(id, 'arac-bitti') as Extract<Olay, { tur: 'arac-bitti' }>[];
  assert.deepEqual(bitenler.map((b) => b.hata), [false, false]);
});

test('AskUserQuestion: seçenek kartı; yanıt updatedInput {questions, answers} ile gider', async () => {
  const t = kur({ tamYetki: true, varsayilanMod: 'bypassPermissions' });
  const id = await baslat(t, '#soru');
  const istek = await t.bekleOlay(id, 'izin-istegi');
  assert.equal(istek.tip, 'soru');
  assert.equal(istek.herZamanSunulur, false, 'soruda "hep" yok');
  assert.deepEqual(istek.sorular?.[0].secenekler.map((s) => s.etiket), ['Mavi', 'Kırmızı']);
  assert.equal(istek.sorular?.[0].baslik, 'Renk');
  t.y.izinYanitla(id, istek.istekId, { karar: 'izin', cevaplar: { 'Hangi renk?': 'Kırmızı' } });
  const metin = await t.bekleOlay(id, 'metin');
  assert.equal(metin.metin, 'Seçimin: Kırmızı');
});

test('kesme: interrupt() yavaş turu keser; sonuç "kesildi"; oturum aynı süreçle sürer', async () => {
  const t = kur();
  const id = await baslat(t, '#yavas:20');
  await t.bekleOlay(id, 'metin-parca', 3);
  assert.equal(t.sonDurum(id), 'calisiyor');
  const pid = t.y.surecler()[0];
  const t0 = Date.now();
  assert.equal((await t.y.kes(id)).tamam, true);
  const sonuc = await t.bekleOlay(id, 'sonuc', 1, 5000);
  assert.ok(Date.now() - t0 < 4000, `kesme ${Date.now() - t0} ms sürdü`);
  assert.equal(sonuc.kesildi, true);
  assert.equal(sonuc.basarili, false);
  assert.equal(sonuc.hata, undefined, 'kesilen tur hata sayılmaz');
  await bekleKosul(() => t.sonDurum(id) === 'bosta', 3000);
  await t.y.gonder(id, { metin: 'yine merhaba' });
  const s2 = await t.bekleOlay(id, 'sonuc', 2);
  assert.equal(s2.basarili, true);
  assert.deepEqual(t.y.surecler(), [pid], 'aynı süreç');
});

test('kesme: çalışırken yazılan mesaj kuyruğa girer (görünür); Durdur kuyruğu da boşaltır', async () => {
  const t = kur();
  const id = await baslat(t, '#yavas:20');
  await t.bekleOlay(id, 'metin-parca', 2);
  await t.y.gonder(id, { metin: 'sonra bunu yap' });
  const o = t.y.oturumlar().find((x) => x.id === id)!;
  assert.equal(o.kuyruk, 1);
  assert.equal(t.y.oturum(id)!.kuyrukMesajlari[0].metin, 'sonra bunu yap');
  await t.y.kes(id);
  await t.bekleOlay(id, 'sonuc');
  await uyu(300);
  assert.equal(t.olaylar(id, 'sonuc').length, 1, 'kuyruktaki mesaj gönderilmedi');
  assert.equal(t.y.oturumlar().find((x) => x.id === id)!.kuyruk, 0);
  // "birak": kuyruk durur, kesilen turdan sonra gönderilir.
  await t.y.gonder(id, { metin: '#yavas:20' });
  await t.bekleOlay(id, 'metin-parca', 8);
  await t.y.gonder(id, { metin: '#durum' });
  await t.y.kes(id, { kuyruk: 'birak' });
  const s3 = await t.bekleOlay(id, 'sonuc', 3);
  assert.equal(s3.basarili, true);
  assert.match((t.olaylar(id, 'metin').at(-1) as { metin: string }).metin, /^mod=/);
});

test('mod ve model: oturum içinde değişir (setPermissionMode/setModel); Tam yetki yalnız ayar açıkken', async () => {
  const t = kur();
  const id = await baslat(t, '#durum');
  await t.bekleOlay(id, 'sonuc');
  assert.match((t.olaylar(id, 'metin')[0] as { metin: string }).metin, /^mod=acceptEdits model=claude-sahte-varsayilan/);
  assert.deepEqual(await t.y.modDegistir(id, 'plan'), { tamam: true });
  assert.equal(t.y.oturumlar().find((o) => o.id === id)!.mod, 'plan');
  const engel = await t.y.modDegistir(id, 'bypassPermissions');
  assert.equal(engel.kod, 'tam-yetki-kapali');
  assert.equal((await t.y.modDegistir(id, 'auto')).kod, 'gecersiz');
  assert.deepEqual(await t.y.modelDegistir(id, 'claude-sahte-hizli'), { tamam: true });
  await t.y.gonder(id, { metin: '#durum' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.match((t.olaylar(id, 'metin')[1] as { metin: string }).metin, /^mod=plan model=claude-sahte-hizli/);
  const bas = t.olaylar(id, 'baslangic') as Extract<Olay, { tur: 'baslangic' }>[];
  assert.equal(bas.at(-1)!.mod, 'plan', 'system/init yeni modu bildiriyor');
  assert.ok(t.olaylar(id, 'mod').some((o) => (o as { mod: string }).mod === 'plan'));
  // Komut paleti ve model listesi (initialize yanıtı; sürüme göre boş olabilir).
  const k = await t.y.komutlar(id);
  assert.equal(k.canli, true);
  assert.deepEqual(k.komutlar.map((c) => c.ad), ['compact', 'clear', 'sahte-beceri']);
  assert.equal(k.komutlar[0].yerlesik, true);
  assert.deepEqual(k.modeller.map((m) => m.deger), ['default', 'claude-sahte-hizli']);
});

test('mod: Tam yetki ayarı açıkken seçilir; ayar kapanınca oturum Düzenlemelere izin ver\'e iner', async () => {
  const t = kur({ tamYetki: true, varsayilanMod: 'acceptEdits' });
  const id = await baslat(t, '#durum', { mod: 'bypassPermissions' });
  await t.bekleOlay(id, 'sonuc');
  assert.match((t.olaylar(id, 'metin')[0] as { metin: string }).metin, /^mod=bypassPermissions/);
  // Tam yetkide düzenleme sorulmaz.
  await t.y.gonder(id, { metin: '#duzenle' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.equal(t.olaylar(id, 'izin-istegi').length, 0);
  assert.equal(t.y.oturumlar().find((o) => o.id === id)!.degisenDosyaSayisi, 1, 'bu oturumda değişen dosya');
  t.ayar.tamYetki = false;
  await t.y.tamYetkiKapandi();
  await t.y.gonder(id, { metin: '#durum' });
  await t.bekleOlay(id, 'sonuc', 3);
  assert.match((t.olaylar(id, 'metin').at(-1) as { metin: string }).metin, /^mod=acceptEdits/);
  // Ayar kapalıyken istenen Tam yetki başlangıçta da verilmez.
  const id2 = await baslat(t, '#durum', { mod: 'bypassPermissions' });
  await t.bekleOlay(id2, 'sonuc');
  assert.match((t.olaylar(id2, 'metin')[0] as { metin: string }).metin, /^mod=acceptEdits/);
});

test('mod: Her şeyi sor (default) → düzenleme izin ister; araç kartları, alt ajan (iç içe) ve yapılacaklar', async () => {
  const t = kur({ tamYetki: false, varsayilanMod: 'default' });
  const id = await baslat(t, '#duzenle');
  const istek = await t.bekleOlay(id, 'izin-istegi');
  assert.equal(istek.tip, 'duzenleme');
  assert.equal(istek.girdi.new_string, 'yeni satır');
  t.y.izinYanitla(id, istek.istekId, { karar: 'izin' });
  await t.bekleOlay(id, 'sonuc');
  await t.y.gonder(id, { metin: '#alt' });
  await t.bekleOlay(id, 'sonuc', 2);
  const alt = await t.bekleOlay(id, 'alt-ajan');
  assert.equal(alt.aciklama, 'Dosyaları tara');
  assert.equal(alt.ajanTipi, 'general-purpose');
  const ic = (t.olaylar(id, 'arac-basladi') as Extract<Olay, { tur: 'arac-basladi' }>[]).find((a) => a.ad === 'Read')!;
  assert.equal(ic.ust, alt.id, 'alt ajanın aracı iç içe (parent_tool_use_id)');
  const altBitti = (t.olaylar(id, 'arac-bitti') as Extract<Olay, { tur: 'arac-bitti' }>[]).find((b) => b.id === alt.id)!;
  assert.match(altBitti.cikti, /Alt ajan raporu/);
  await t.y.gonder(id, { metin: '#yapilacak' });
  await t.bekleOlay(id, 'sonuc', 3);
  const y = await t.bekleOlay(id, 'yapilacaklar');
  assert.deepEqual(y.maddeler.map((m) => m.durum), ['tamam', 'suruyor']);
  assert.equal(t.olaylar(id, 'arac-bitti').some((b) => (b as { id: string }).id === y.id), false, 'TodoWrite sonucu kart olmaz');
  assert.deepEqual(t.y.oturum(id)!.yapilacaklar.map((m) => m.icerik), ['Testleri yaz', 'Belgeyi güncelle']);
});

test('eşzamanlı sınır: en çok 4 çalışan oturum; fazlası sırada (sıra numarasıyla), yer açılınca başlar', async () => {
  const t = kur();
  const idler: string[] = [];
  for (let i = 0; i < 6; i++) idler.push(await baslat(t, '#yavas:30'));
  await bekleKosul(() => idler.filter((id) => t.sonDurum(id) === 'calisiyor').length === 4, 10_000, '4 çalışan');
  await uyu(300);
  const durumlar = idler.map((id) => t.sonDurum(id));
  assert.deepEqual(durumlar, ['calisiyor', 'calisiyor', 'calisiyor', 'calisiyor', 'sirada', 'sirada']);
  assert.deepEqual(idler.slice(4).map((id) => t.y.oturumlar().find((o) => o.id === id)!.siraNo), [1, 2]);
  assert.equal(t.y.surecler().length, 4, 'sıradakiler için süreç açılmadı');
  await t.y.kes(idler[1]);
  await bekleKosul(() => t.sonDurum(idler[4]) === 'calisiyor', 8000, '5. başladı');
  assert.equal(t.sonDurum(idler[5]), 'sirada');
  assert.equal(t.y.oturumlar().find((o) => o.id === idler[5])!.siraNo, 1);
  assert.equal(idler.filter((id) => t.sonDurum(id) === 'calisiyor').length, 4);
  await t.y.hepsiniKapat();
  assert.deepEqual(t.y.surecler(), []);
});

test('çökme: süreç beklenmedik biçimde biterse "hata" hâli (neden görünür); sonraki mesaj resume ile sürdürür', async () => {
  const t = kur();
  const id = await baslat(t, 'ilk tur');
  await t.bekleOlay(id, 'sonuc');
  const kimlik = t.y.oturumlar().find((o) => o.id === id)!.kimlik!;
  await t.y.gonder(id, { metin: '#cok' });
  await bekleKosul(() => t.sonDurum(id) === 'hata', 8000, 'hata hâli');
  const o = t.y.oturumlar().find((x) => x.id === id)!;
  assert.match(o.hata!, /çıkış kodu 3/);
  assert.match(o.hata!, /sahte çöküş/);
  assert.ok(t.olaylar(id, 'sistem').some((s) => (s as { seviye: string }).seviye === 'hata'));
  assert.deepEqual(t.y.surecler(), []);
  await t.y.gonder(id, { metin: '#durum' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.match((t.olaylar(id, 'metin').at(-1) as { metin: string }).metin, new RegExp(`oturum=${kimlik}$`), 'aynı oturum (resume)');
  assert.equal(t.sonDurum(id) === 'bosta' || t.sonDurum(id) === 'calisiyor', true);
});

test('sürdür ve çatalla: resume aynı kimlikle, forkSession yeni kimlikle; başka yerde açık oturum doğrudan sürdürülmez', async () => {
  const t = kur(undefined, { baskaYerdeMi: async (k: string) => ({ acik: k === 'cccc3333-0000-4000-8000-000000000003' }) });
  const eski = 'aaaa1111-0000-4000-8000-000000000001';
  const id = await baslat(t, '#durum', { surdur: eski });
  await t.bekleOlay(id, 'sonuc');
  assert.match((t.olaylar(id, 'metin')[0] as { metin: string }).metin, new RegExp(`oturum=${eski}$`));
  // Aynı oturum uygulamada zaten açık: yenisi açılmaz.
  const tekrar = await t.y.baslat({ cwd: proje, surdur: eski });
  assert.equal(tekrar.oturum?.id, id);
  const id2 = await baslat(t, '#durum', { surdur: eski, catalla: true });
  await t.bekleOlay(id2, 'sonuc');
  const catalKimlik = /oturum=(\S+)$/.exec((t.olaylar(id2, 'metin')[0] as { metin: string }).metin)![1];
  assert.notEqual(catalKimlik, eski);
  assert.equal(t.y.oturumlar().find((o) => o.id === id2)!.kimlik, catalKimlik);
  const engel = await t.y.baslat({ cwd: proje, surdur: 'cccc3333-0000-4000-8000-000000000003', istem: 'devam' });
  assert.equal(engel.kod, 'baska-yerde');
  assert.equal(t.y.oturumlar().length, 2, 'engellenen oturum kaydedilmedi');
  const catal = await t.y.baslat({ cwd: proje, surdur: 'cccc3333-0000-4000-8000-000000000003', catalla: true, istem: '#durum' });
  assert.equal(catal.tamam, true, 'çatallamak serbest');
  assert.equal((await t.y.baslat({ cwd: path.join(tmp, 'yok'), istem: 'x' })).kod, 'klasor-yok');
});

test('kapanış: önce interrupt, sonra kapat; inatçı süreç ağacıyla öldürülür — YETİM SÜREÇ KALMAZ (PID denetimi)', async () => {
  fs.rmSync(process.env.SAHTE_CC_PID_DOSYASI!, { force: true });
  const t = kur();
  const calisan = await baslat(t, '#yavas:30');
  const bosta = await baslat(t, 'merhaba');
  const inatci = await baslat(t, '#inat');
  await t.bekleOlay(calisan, 'metin-parca', 2);
  await t.bekleOlay(bosta, 'sonuc');
  await t.bekleOlay(inatci, 'metin-parca', 2);
  const pidler = t.y.surecler();
  assert.equal(pidler.length, 3);
  // Sahte her açılışta kendi PID'ini dosyaya yazar (önceki testin son sürecinin satırı da düşebilir): izlenenler onların içinde.
  const dosyadan = fs.readFileSync(process.env.SAHTE_CC_PID_DOSYASI!, 'utf8').trim().split(/\s+/).map(Number);
  assert.ok(pidler.every((p) => dosyadan.includes(p)), `izlenen PID'ler sahte süreçlerin kendi PID'leri: ${pidler} ⊄ ${dosyadan}`);
  // 0.14 T35: zamanlama bağımlılığı kalktı (yük altında kararsızdı; tek başına 38/38). hepsiniKapat ağaç öldürmeyi (taskkill /T /F) zaman uyumsuz
  // başlatır ve en çok 3 sn bekler; yüklü makinede taskkill bundan geç bitebilir. Sözleşme "yetim süreç kalmaz"dır, "3 sn'de ölür" değil:
  // her PID'in ölmesi geniş bir tavanla beklenir (kalırsa yine düşer). Süre sınırı yalnız asılı kalmayı yakalar (tasarım bütçesi ≈ 7,5 sn).
  const t0 = Date.now();
  await t.y.hepsiniKapat();
  const sure = Date.now() - t0;
  assert.ok(sure < 30_000, `kapanış asılı kaldı: ${sure} ms`);
  await bekleKosul(() => pidler.every((p) => !yasiyorMu(p)), 30_000, `yetim süreç: ${pidler.filter((p) => yasiyorMu(p)).join(', ')}`).catch(() => undefined);
  for (const p of pidler) assert.equal(yasiyorMu(p), false, `PID ${p} hâlâ yaşıyor`);
  assert.equal((t.olaylar(calisan, 'sonuc')[0] as { kesildi: boolean } | undefined)?.kesildi, true, 'çalışan tur interrupt ile kesildi');
  assert.equal((await t.y.baslat({ cwd: proje, istem: 'x' })).kod, 'kapaniyor');
});

test('TEST KAPISI: sahte verilmemişse gerçek claude.exe çalıştırılmaz — yüksek sesle düşer, süreç açılmaz', async () => {
  const eski = process.env.FUBER_CLAUDE_KOMUT;
  delete process.env.FUBER_CLAUDE_KOMUT;
  try {
    assert.throws(() => ccKomutu(), /TEST GÜVENLİĞİ/);
    const t = kur();
    const id = await baslat(t, 'merhaba');
    await bekleKosul(() => t.sonDurum(id) === 'hata', 3000);
    assert.match(t.y.oturumlar()[0].hata!, /TEST GÜVENLİĞİ/);
    assert.deepEqual(t.y.surecler(), []);
  } finally {
    process.env.FUBER_CLAUDE_KOMUT = eski;
  }
});

// ═══════════════════════ Düzeltme turu 1 ═══════════════════════
const metinSon = (t: ReturnType<typeof kur>, id: string) => (t.olaylar(id, 'metin').at(-1) as { metin: string } | undefined)?.metin ?? '';

// 1 (kritik, Ruling CA): göçmüş bir profilde Tam yetki açık + varsayılan Tam yetki; telefondan başlayan oturum yine de onay bekler.
test('düzeltme 1: telefondan (kaynak telefon ya da uzak sohbet turu) başlayan oturum en çok acceptEdits — Tam yetki asla; komut masada izin bekler', async () => {
  const t = kur({ tamYetki: true, varsayilanMod: 'bypassPermissions' });
  const id = await baslat(t, '#durum', { kaynak: 'telefon', mod: 'bypassPermissions' });
  await t.bekleOlay(id, 'sonuc');
  assert.match(metinSon(t, id), /^mod=acceptEdits /);
  assert.equal(t.y.ozetAl(id)!.mod, 'acceptEdits');
  await t.y.gonder(id, { metin: '#izin' }); // masadan
  const istek = await t.bekleOlay(id, 'izin-istegi');
  assert.equal(istek.arac, 'Bash', 'komut izinsiz çalışmadı');
  t.y.izinYanitla(id, istek.istekId, { karar: 'ret' });
  await t.bekleOlay(id, 'sonuc', 2);
  // Telefondan gelen sohbet turu (uzak) da aynı; masadaki aynı istek Tam yetkili açılır (kıyas).
  const uzak = await baslat(t, '#durum', { kaynak: 'sohbet', sohbetId: 3, uzak: true });
  await t.bekleOlay(uzak, 'sonuc');
  assert.match(metinSon(t, uzak), /^mod=acceptEdits /);
  const masa = await baslat(t, '#durum');
  await t.bekleOlay(masa, 'sonuc');
  assert.match(metinSon(t, masa), /^mod=bypassPermissions /);
});

// 2: telefonun claudecode:ac'ı açık oturuma mesaj göndermez (gonder telefona kapalı; ac onun yerine geçemez).
test('düzeltme 2 + A: telefondan açık oturuma komut GİTMEZ ve sessizce "başarılı" denmez — kod masada-acik; komutsuz açma özet döner', async () => {
  const t = kur();
  const kimlik = 'aaaa2222-0000-4000-8000-000000000002';
  const id = await baslat(t, '#durum', { surdur: kimlik });
  await t.bekleOlay(id, 'sonuc');
  const r = await t.y.baslat({ cwd: proje, surdur: kimlik, istem: '#izin', kaynak: 'telefon' });
  assert.equal(r.tamam, false, 'komut gitmedi ama başarılı dendi');
  assert.equal(r.kod, 'masada-acik');
  assert.equal(r.hata, 'Bu oturum bilgisayarda açık; komutu bilgisayardan ver.');
  assert.equal(r.oturum?.id, id);
  const komutsuz = await t.y.baslat({ cwd: proje, surdur: kimlik, kaynak: 'telefon' });
  assert.deepEqual([komutsuz.tamam, komutsuz.oturum?.id], [true, id]);
  await uyu(400);
  assert.equal(t.olaylar(id, 'kullanici').length, 1, 'telefonun komutu gönderilmedi');
  assert.equal(t.olaylar(id, 'izin-istegi').length, 0);
});

// 3: PID çıkışta unutulur (yeniden kullanılan PID'ye taskkill gitmez).
test('düzeltme 3: süreç çıkınca PID unutulur (çökme ve kapat); yalnız yaşayan bizim süreçler sayılır', async () => {
  const t = kur();
  const id = await baslat(t, '#cok');
  await bekleKosul(() => t.sonDurum(id) === 'hata', 8000);
  await bekleKosul(() => t.y.pid(id) === undefined, 3000, 'çöken sürecin PID\'i unutuldu');
  const id2 = await baslat(t, 'merhaba');
  await t.bekleOlay(id2, 'sonuc');
  assert.equal(typeof t.y.pid(id2), 'number');
  await t.y.kapat(id2);
  assert.equal(t.y.pid(id2), undefined);
  assert.deepEqual(t.y.surecler(), []);
});

// 4: çatalın KAYNAĞI bizim sayılmaz; uygulamada kapatılıp terminalde sürdürülen oturum uygulamada doğrudan yeniden açılmaz.
test('düzeltme 4: "başka yerde" — çatal kaynağı bizim değil; kapatılıp terminalde sürdürülen oturum yeniden açılmaz; agents --json sessionId', async () => {
  const projeDiz = path.join(process.env.FUBER_CLAUDE_DIZIN!, 'projects', 'C--proje');
  fs.mkdirSync(projeDiz, { recursive: true });
  const dosya = (k: string) => path.join(projeDiz, `${k}.jsonl`);
  const ESKI = 'eeee0001-0000-4000-8000-000000000001';
  const TERMINALDE = 'eeee0002-0000-4000-8000-000000000002';
  const AJAN = 'eeee0003-0000-4000-8000-000000000003';
  const once = (Date.now() - 3600_000) / 1000;
  for (const k of [ESKI, TERMINALDE, AJAN]) { fs.writeFileSync(dosya(k), '{}\n'); fs.utimesSync(dosya(k), once, once); }
  fs.utimesSync(dosya(TERMINALDE), new Date(), new Date()); // şu an terminalde yazılıyor
  ajanOnbellekSil();
  const t = kur(undefined, { baskaYerdeMi: (k: string, b: Parameters<typeof baskaYerdeAcik>[1]) => baskaYerdeAcik(k, b, etkinAjanMetni) });
  // Terminalde açık oturumu çatallamak serbest; çatal yaşarken kaynağı DOĞRUDAN sürdürmek yine yasak.
  const catal = await baslat(t, '#durum', { surdur: TERMINALDE, catalla: true });
  await t.bekleOlay(catal, 'sonuc');
  assert.equal((await t.y.baslat({ cwd: proje, surdur: TERMINALDE, istem: 'x' })).kod, 'baska-yerde', 'çatalın kaynağı bizim sayıldı');
  // Uygulamada aç → kapat → (kendi kapanış yazımımız sayılmaz) → yeniden açılabilir.
  const id = await baslat(t, '#durum', { surdur: ESKI });
  await t.bekleOlay(id, 'sonuc');
  await t.y.kapat(id);
  fs.utimesSync(dosya(ESKI), new Date(), new Date()); // kapanırken bizim yazdığımız
  const yeniden = await t.y.baslat({ cwd: proje, surdur: ESKI });
  assert.equal(yeniden.tamam, true, yeniden.hata);
  assert.equal(yeniden.oturum?.id, id, 'aynı kayıt yeniden açıldı (çift kayıt yok)');
  // Sonra terminalde sürdürüldü (kapanıştan sonra yazım): uygulamadan mesaj → sürdürülmez.
  const sonra = new Date(Date.now() + 10_000);
  fs.utimesSync(dosya(ESKI), sonra, sonra);
  const g = await t.y.gonder(id, { metin: '#durum' });
  assert.equal(g.kod, 'baska-yerde', 'kapatılıp terminalde sürdürülen oturum uygulamada açıldı');
  assert.equal((await t.y.baslat({ cwd: proje, surdur: ESKI, istem: 'x' })).kod, 'baska-yerde');
  // `claude agents --json` (2.1.310 biçimi) listesindeki bizim olmayan süreç.
  process.env.SAHTE_CC_AJANLAR = JSON.stringify([{ id: 'x', cwd: proje, kind: 'interactive', startedAt: 1, sessionId: AJAN, name: 'n', state: 'running', pid: 999_993, status: 'idle', waitingFor: null }]);
  ajanOnbellekSil();
  try {
    assert.equal((await t.y.baslat({ cwd: proje, surdur: AJAN, istem: 'x' })).kod, 'baska-yerde');
  } finally {
    delete process.env.SAHTE_CC_AJANLAR;
    ajanOnbellekSil();
  }
});

// 5: 5 000 parçalı yanıt dökümden kullanıcı mesajını ve kartları itmez; yayın ~50 ms'de bir toplu.
test('düzeltme 5: 5 000 parçalı yanıt + araç kartları — döküm kullanıcı mesajını ve kartları korur, parçalar blok başına tek kayıt; yayın toplu', async () => {
  const t = kur();
  const id = await baslat(t, '#cokparca:5000');
  const sonuc = await t.bekleOlay(id, 'sonuc', 1, 30_000);
  assert.equal(sonuc.basarili, true);
  const yayin = t.olaylar(id, 'metin-parca') as Extract<Olay, { tur: 'metin-parca' }>[];
  const tam = (t.olaylar(id, 'metin')[0] as { metin: string }).metin;
  assert.ok(yayin.length >= 1 && yayin.length < 150, `parça yayını ${yayin.length} (toplu olmalı)`);
  assert.equal(yayin.map((p) => p.metin).join(''), tam, 'toplu parçalar tam metni veriyor');
  assert.equal(tam.split(' ').filter(Boolean).length, 5000);
  const d = t.y.oturum(id)!.olaylar.map((z) => z.olay.tur);
  assert.deepEqual(d.filter((x) => x !== 'baslangic'), ['kullanici', 'arac-basladi', 'arac-bitti', 'metin', 'arac-basladi', 'arac-bitti', 'sonuc']);
});

// 6: kapalı oturum sınırı, "unut", kuyrukta görsel sınırı.
test('düzeltme 6: kapalı oturum kayıtları sınırlı (en eskiler unutulur), "unut" kaydı siler; kuyruktaki görseller sınırlı', async () => {
  const t = kur(undefined, { azamiKapali: 2 });
  const idler: string[] = [];
  for (let i = 0; i < 4; i++) { idler.push((await t.y.baslat({ cwd: proje }))!.oturum!.id); await uyu(5); }
  for (const id of idler) { await t.y.kapat(id); await uyu(5); }
  assert.deepEqual(t.y.oturumlar().map((o) => o.id).sort(), idler.slice(2).sort(), 'yalnız son 2 kapalı kayıt kaldı');
  assert.deepEqual(idler.slice(0, 2).map((id) => t.olaylar(id, 'unutuldu').length), [1, 1]);
  assert.equal((await t.y.unut(idler[3])).tamam, true);
  assert.equal(t.y.ozetAl(idler[3]), null);
  assert.equal(t.olaylar(idler[3], 'unutuldu').length, 1);
  const calisan = await baslat(t, '#yavas:20');
  await t.bekleOlay(calisan, 'metin-parca');
  const gorsel = (n: number) => Array.from({ length: n }, () => ({ medya: 'image/png', veri: 'iVBORw0KGgo=' }));
  assert.equal((await t.y.gonder(calisan, { metin: 'bir', gorseller: gorsel(10) })).tamam, true);
  assert.equal((await t.y.gonder(calisan, { metin: 'iki', gorseller: gorsel(10) })).tamam, true);
  const fazla = await t.y.gonder(calisan, { metin: 'üç', gorseller: gorsel(1) });
  assert.equal(fazla.kod, 'buyuk', 'kuyrukta en çok 20 görsel');
  await t.y.kes(calisan);
});

// 8: Tam yetki kapanınca mod değiştirilemeyen süreç Tam yetkide SÜRMEZ (kapatılır; sonraki tur acceptEdits).
test('düzeltme 8: Tam yetki kapandı ve setPermissionMode başarısız → süreç kapatılır; sonraki tur acceptEdits', async () => {
  const t = kur({ tamYetki: true, varsayilanMod: 'bypassPermissions' });
  const id = await baslat(t, '#modreddet');
  await t.bekleOlay(id, 'sonuc');
  assert.equal(typeof t.y.pid(id), 'number');
  t.ayar.tamYetki = false;
  await t.y.tamYetkiKapandi();
  assert.equal(t.y.pid(id), undefined, 'Tam yetkideki süreç kapatıldı');
  assert.equal(t.y.ozetAl(id)!.mod, 'acceptEdits');
  await t.y.gonder(id, { metin: '#durum' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.match(metinSon(t, id), /^mod=acceptEdits /);
});

// 9: AskUserQuestion yanıtı sorulan sorulara uymalı; uymazsa istek bekler.
test('düzeltme 9: soru yanıtı doğrulanır (eksik, fazla, geçersiz seçenek reddedilir; istek bekler) — "Diğer" serbest metin ve çoklu seçim geçer', async () => {
  const t = kur();
  const id = await baslat(t, '#soru2');
  const istek = await t.bekleOlay(id, 'izin-istegi');
  const dene = (cevaplar: Record<string, string | string[]>, serbest?: string[]) => t.y.izinYanitla(id, istek.istekId, { karar: 'izin', cevaplar, ...(serbest ? { serbest } : {}) });
  assert.equal(dene({ 'Hangi dil?': 'TypeScript' }).kod, 'gecersiz-cevap', 'eksik soru');
  assert.equal(dene({ 'Hangi dil?': 'Rust', 'Hangi özellikler?': ['Test'] }).kod, 'gecersiz-cevap', 'geçersiz seçenek');
  assert.equal(dene({ 'Hangi dil?': 'Python', 'Hangi özellikler?': 'Test', 'Uydurma?': 'x' }).kod, 'gecersiz-cevap', 'fazla anahtar');
  assert.equal(t.sonDurum(id), 'izin', 'istek hâlâ bekliyor');
  assert.equal(dene({ 'Hangi dil?': 'Rust', 'Hangi özellikler?': ['Test', 'CI'] }, ['Hangi dil?']).tamam, true);
  await t.bekleOlay(id, 'sonuc');
  assert.equal(metinSon(t, id), 'Yanıtlar: {"Hangi dil?":"Rust","Hangi özellikler?":"Test, CI"}');
});

// 10: sohbetten verilen iş: özet BİR KEZ; çökme ve zorla durdurma da sohbete gider.
test('düzeltme 10: sohbet özeti iş başına bir kez; çökme ve zorla durdurma (Kapat) sohbete bildirilir', async () => {
  const t = kur();
  const id = await baslat(t, 'birinci', { kaynak: 'sohbet', sohbetId: 7 });
  await t.bekleOlay(id, 'sonuc');
  await t.y.gonder(id, { metin: 'ikinci' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.deepEqual(t.bitenler.filter((b) => b.id === id).map((b) => b.sohbetId), [7, undefined], 'yalnız işin bitişi sohbete');
  const cok = await baslat(t, '#cok', { kaynak: 'sohbet', sohbetId: 8 });
  await bekleKosul(() => t.hatalar.some((h) => h.id === cok), 8000);
  assert.equal(t.hatalar.find((h) => h.id === cok)!.sohbetId, 8, 'çökme sohbete');
  const uzun = await baslat(t, '#yavas:20', { kaynak: 'sohbet', sohbetId: 9 });
  await t.bekleOlay(uzun, 'metin-parca');
  await t.y.kapat(uzun);
  const b = t.bitenler.find((x) => x.id === uzun);
  assert.deepEqual(b && [b.sohbetId, b.kesildi], [9, true], 'zorla durdurma sohbete (kesildi)');
});

// 11: baslat model ve oturum kimliğini doğrular.
test('düzeltme 11: baslat — geçersiz model ve oturum kimliği reddedilir (bayrak gibi değer, yol kaçışı)', async () => {
  const t = kur();
  for (const model of ['--dangerously-skip-permissions', 'a b', 'x;y']) assert.equal((await t.y.baslat({ cwd: proje, istem: 'x', model })).kod, 'gecersiz', model);
  for (const surdur of ['../../x', 'abc', 'a b c d e f g']) assert.equal((await t.y.baslat({ cwd: proje, istem: 'x', surdur })).kod, 'gecersiz', surdur);
  assert.equal(t.y.oturumlar().length, 0);
  const id = await baslat(t, '#durum', { model: 'claude-sahte-hizli' });
  await t.bekleOlay(id, 'sonuc');
  assert.match(metinSon(t, id), /model=claude-sahte-hizli/);
});

// 13: Task* araçları yapılacaklar listesine.
test('düzeltme 13: TaskCreate/TaskUpdate/TaskList yapılacaklar listesini kurar (kart olmaz)', async () => {
  const t = kur();
  const id = await baslat(t, '#gorev');
  await t.bekleOlay(id, 'sonuc');
  assert.deepEqual(t.y.oturum(id)!.yapilacaklar, [
    { icerik: 'Testleri yaz', durum: 'suruyor', kimlik: '1', etkinMetin: 'Testler yazılıyor' },
    { icerik: 'Belgeyi güncelle', durum: 'tamam', kimlik: '2' },
  ]);
  assert.equal(t.olaylar(id, 'arac-basladi').length, 0, 'görev araçları kart değil');
});

// 14: reddedilen düzenleme "değişen dosya" sayılmaz.
test('düzeltme 14: değişen dosya sayısı yalnız başarıyla biten düzenlemeler (reddedilen sayılmaz)', async () => {
  const t = kur({ tamYetki: false, varsayilanMod: 'default' });
  const id = await baslat(t, '#duzenle');
  const r1 = await t.bekleOlay(id, 'izin-istegi');
  t.y.izinYanitla(id, r1.istekId, { karar: 'ret' });
  await t.bekleOlay(id, 'sonuc');
  assert.equal(t.y.ozetAl(id)!.degisenDosyaSayisi, 0, 'reddedilen düzenleme sayıldı');
  await t.y.gonder(id, { metin: '#duzenle' });
  const r2 = await t.bekleOlay(id, 'izin-istegi', 2);
  t.y.izinYanitla(id, r2.istekId, { karar: 'izin' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.equal(t.y.ozetAl(id)!.degisenDosyaSayisi, 1);
});

// ═══════════════════════ Düzeltme turu 2 ═══════════════════════
// C: kendi kapanışımızdan hemen sonra "başka yerde" yanlış alarmı yok (agents önbelleği temizlenir; bizim PID'lerimiz hariç tutulur).
test('düzeltme C: kendi kapattığımız oturum hemen yeniden açılır — bayat `claude agents` önbelleği ve bizim eski PID\'imiz "başka yerde" saymaz', async () => {
  ajanOnbellekSil();
  const t = kur(undefined, { baskaYerdeMi: (k: string, b: Parameters<typeof baskaYerdeAcik>[1]) => baskaYerdeAcik(k, b, etkinAjanMetni) });
  const K = 'cccc0c0c-0000-4000-8000-00000000000c';
  const id = await baslat(t, '#durum', { surdur: K });
  await t.bekleOlay(id, 'sonuc');
  const pid = t.y.pid(id)!;
  // Bizim süreç çalışırken `claude agents` onu listeler (gerçek 2.1.310 davranışı); liste 15 sn önbelleğe girer.
  const liste = JSON.stringify([{ id: 'a', cwd: proje, kind: 'background', startedAt: 1, sessionId: K, name: 'n', state: 'running', pid, status: 'idle', waitingFor: null }]);
  try {
    process.env.SAHTE_CC_AJANLAR = liste;
    ajanOnbellekSil(); // (başlatırken boş liste önbelleğe girmişti) — şimdi bizim süreç listedeyken önbelleğe al
    assert.match(await etkinAjanMetni(), new RegExp(K));
    // 1) Kapatıyoruz; claude artık listelemiyor — önbellek temizlenmezse bayat liste "başka yerde" derdi.
    await t.y.kapat(id);
    delete process.env.SAHTE_CC_AJANLAR;
    const r1 = await t.y.baslat({ cwd: proje, surdur: K });
    assert.equal(r1.tamam, true, `bayat önbellek: ${r1.kod}`);
    // 2) Liste bizim ESKİ (çıkmış) PID'imizle hâlâ görünse de bizimdir.
    await t.y.gonder(id, { metin: '#durum' });
    await t.bekleOlay(id, 'sonuc', 2);
    const pid2 = t.y.pid(id)!;
    process.env.SAHTE_CC_AJANLAR = JSON.stringify([{ id: 'a', sessionId: K, pid, kind: 'background' }, { id: 'b', sessionId: K, pid: pid2, kind: 'background' }]);
    ajanOnbellekSil();
    await t.y.kapat(id);
    const r2 = await t.y.baslat({ cwd: proje, surdur: K });
    assert.equal(r2.tamam, true, `bizim eski PID'imiz başka yerde sayıldı: ${r2.kod}`);
  } finally {
    delete process.env.SAHTE_CC_AJANLAR;
    ajanOnbellekSil();
  }
});

// D: Tam yetkiye geçişte yeniden açma sürerken gelen masa mesajı yeni süreci ESKİ modda açmamalı.
test('düzeltme D: Tam yetki yeniden açması sürerken gönderilen mesaj Tam yetkiyle çalışır (eski modda değil)', async () => {
  const t = kur({ tamYetki: false, varsayilanMod: 'acceptEdits' });
  const id = await baslat(t, '#durum');
  await t.bekleOlay(id, 'sonuc');
  t.ayar.tamYetki = true;
  const gecis = t.y.modDegistir(id, 'bypassPermissions'); // süreç kapanıyor (bekletilmeden)
  const g = await t.y.gonder(id, { metin: '#durum' });   // kapanış sürerken masadan mesaj
  assert.equal(g.tamam, true);
  assert.deepEqual(await gecis, { tamam: true });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.match(metinSon(t, id), /^mod=bypassPermissions /, 'yeni süreç eski modda açıldı');
});

// #10 boşluğu: kuyruktaki (başlamamış) sohbet işi Durdur/Kapat ile atılınca o sohbete bir kez "durduruldu"; sonraki masa turu eski
// sohbete yazmaz.
test('düzeltme #10: kuyruktaki sohbet işi Durdur/Kapat ile atılınca sohbete bir kez "durduruldu"; sonraki masa turu eski sohbete yazmaz', async () => {
  const t = kur(undefined, { azamiEsZamanli: 1 });
  const dolu = await baslat(t, '#yavas:20');
  await t.bekleOlay(dolu, 'metin-parca');
  const sohbetIsi = await baslat(t, '#durum', { kaynak: 'sohbet', sohbetId: 5 });
  assert.equal(t.sonDurum(sohbetIsi), 'sirada');
  await t.y.kes(sohbetIsi);
  const b = t.bitenler.filter((x) => x.id === sohbetIsi);
  assert.deepEqual(b.map((x) => [x.sohbetId, x.kesildi]), [[5, true]], 'kuyruktaki sohbet işi durduruldu bildirimi');
  await t.y.kes(dolu);
  await t.y.gonder(sohbetIsi, { metin: '#durum' }); // masadan
  await t.bekleOlay(sohbetIsi, 'sonuc');
  assert.deepEqual(t.bitenler.filter((x) => x.id === sohbetIsi).map((x) => x.sohbetId), [5, undefined], 'masa turu eski sohbete yazdı');
  // Kapat ile de.
  const dolu2 = await baslat(t, '#yavas:20');
  await t.bekleOlay(dolu2, 'metin-parca');
  const is2 = await baslat(t, '#durum', { kaynak: 'sohbet', sohbetId: 6 });
  await t.y.kapat(is2);
  assert.deepEqual(t.bitenler.filter((x) => x.id === is2).map((x) => [x.sohbetId, x.kesildi]), [[6, true]]);
  await t.y.kes(dolu2);
});

// İsteğe bağlı: Tam yetki izni olmadan açılmış BOŞTAKİ oturum Tam yetkiye geçince kendiliğinden yeniden açılır.
test('isteğe bağlı: Tam yetki sonradan açılınca boştaki oturum Tam yetkiye geçer (süreç kapatılır, sonraki tur izinle açılır)', async () => {
  const t = kur({ tamYetki: false, varsayilanMod: 'acceptEdits' });
  const id = await baslat(t, '#durum');
  await t.bekleOlay(id, 'sonuc');
  t.ayar.tamYetki = true;
  assert.deepEqual(await t.y.modDegistir(id, 'bypassPermissions'), { tamam: true });
  await t.y.gonder(id, { metin: '#durum' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.match(metinSon(t, id), /^mod=bypassPermissions /);
});


// ── 0.13 T12: taslakta model/düşünme gücü, saklı model listesi, arka plan işi, ortam ───────────────────────────────────────────
test('taslakta seçilen model oturuma geçer (varsayılan listenin değeri: opus); düşünme gücü doğrulanır ve sürece gider', async () => {
  const t = kur();
  const id = await baslat(t, '#durum', { model: CC_VARSAYILAN_MODELLER[0].deger, efor: 'high' });
  await t.bekleOlay(id, 'sonuc');
  assert.match(metinSon(t, id), /model=opus /, 'taslakta seçilen model Claude Code\'a --model olarak gitti');
  assert.match(metinSon(t, id), /efor=high /, 'düşünme gücü --effort olarak gitti');
  assert.equal(t.y.oturumlar().find((o) => o.id === id)!.model, 'opus');
  // Seçilmediyse bayrak yok.
  const b = await baslat(t, '#durum');
  await t.bekleOlay(b, 'sonuc');
  assert.match(metinSon(t, b), /efor=- /);
  for (const efor of ['--dangerously-skip-permissions', 'dev', 5, {}]) assert.equal((await t.y.baslat({ cwd: proje, istem: 'x', efor: efor as string })).kod, 'gecersiz', String(efor));
});

test('liste oturumdan gelince saklanır; oturum yokken saklı liste, o da yoksa opus / sonnet / haiku döner', async () => {
  let saklanan: { deger: string; ad: string; aciklama: string }[] | null = null;
  const t = kur(undefined, { modellerYaz: (l: typeof saklanan) => { saklanan = l; }, modellerOku: () => saklanan });
  assert.deepEqual(t.y.modeller().map((m) => m.deger), ['opus', 'sonnet', 'haiku'], 'hiç oturum yokken varsayılan');
  const id = await baslat(t, '#durum');
  await t.bekleOlay(id, 'sonuc');
  const k = await t.y.komutlar(id);
  assert.deepEqual(k.modeller.map((m) => m.deger), ['default', 'claude-sahte-hizli']);
  assert.deepEqual(saklanan!.map((m) => m.deger), ['default', 'claude-sahte-hizli'], 'oturumdan gelen liste kalıcı kayda yazıldı');
  assert.deepEqual(t.y.modeller().map((m) => m.deger), ['default', 'claude-sahte-hizli']);
  // Uygulama yeniden açılınca (yeni yönetici, oturum yok) saklı liste okunur.
  const y2 = kur(undefined, { modellerOku: () => saklanan });
  assert.deepEqual(y2.y.modeller().map((m) => m.deger), ['default', 'claude-sahte-hizli']);
  // Bozuk kayıt (geçersiz değer, boş) yedeğe düşer; kötü model adı listeye girmez.
  const bozuk = kur(undefined, { modellerOku: () => [{ deger: '--x', ad: 'Kötü', aciklama: '' }, { deger: '', ad: '', aciklama: '' }] });
  assert.deepEqual(bozuk.y.modeller().map((m) => m.deger), ['opus', 'sonnet', 'haiku']);
  // Boş liste dönen oturum saklı listeyi EZMEZ.
  assert.equal(saklanan!.length, 2);
});

test('arka plan işi: sayı özete girer, tur bitse de sürer; son iş bitince 0; süreç kapanınca sıfırlanır', async () => {
  const t = kur();
  const id = await baslat(t, '#arkaplan');
  const sonuc = await t.bekleOlay(id, 'sonuc');
  assert.equal(sonuc.basarili, true);
  await bekleKosul(() => t.sonDurum(id) === 'bosta', 3000, 'boşta');
  const ozet = () => t.y.oturumlar().find((o) => o.id === id)!;
  assert.equal(ozet().arkaPlan, 1, 'tur bitti ama arka plan ajanı sürüyor');
  assert.deepEqual(t.olaylar(id, 'arka-plan'), [{ tur: 'arka-plan', sayi: 1 }]);
  const siraOf = (tur: string) => t.zarflar.find((z) => z.oturum === id && z.olay.tur === tur)!.sira;
  assert.ok(siraOf('arka-plan') < siraOf('sonuc'), 'sayı sonuçtan ÖNCE gelir (kart doğru etiketle doğar)');
  assert.equal(t.y.oturum(id)!.arkaPlan, 1);
  // Sonraki turda iş biter.
  await t.y.gonder(id, { metin: '#arkabit' });
  await t.bekleOlay(id, 'sonuc', 2);
  assert.equal(ozet().arkaPlan, 0, 'son iş bitince Bitti\'ye döner');
  // Yeniden başlat; süreç kapanınca (Kapat) sayı sıfırlanır — süreç öldü, iş de öldü.
  await t.y.gonder(id, { metin: '#arkaplan' });
  await t.bekleOlay(id, 'sonuc', 3);
  assert.equal(ozet().arkaPlan, 1);
  await t.y.kapat(id);
  assert.equal(ozet().arkaPlan, 0, 'oturum kapanınca sayı sıfırlanır');
  assert.equal((t.olaylar(id, 'arka-plan').at(-1) as { sayi: number }).sayi, 0, 'arayüze de sıfır bildirildi');
});

test('ortama FUBER_SIR_ geçmez: Fuber\'in kendi sırları Claude Code sürecinde yok; öteki değişkenler geçer', async () => {
  process.env.FUBER_SIR_ELEVENLABS = 'gizli-deger';
  process.env.fuber_sir_kucuk = 'gizli-deger';
  try {
    const t = kur();
    const id = await baslat(t, '#ortam');
    await t.bekleOlay(id, 'sonuc');
    assert.equal(metinSon(t, id), 'sir=0');
  } finally { delete process.env.FUBER_SIR_ELEVENLABS; delete process.env.fuber_sir_kucuk; }
});

test('src/main/claudecode motor/ ya da hesap kimliği içe aktarmaz: Fuber\'in beyni, hesabı ve sırları Claude Code yöneticisine girmez', () => {
  const klasor = path.join(kok, 'src/main/claudecode');
  // yonetim.ts uygulama bağlantısıdır (ayar, bildirim, sohbet kancaları orada verilir); motor dosyaları bağımsız kalır.
  const dosyalar = fs.readdirSync(klasor).filter((d) => d.endsWith('.ts') && d !== 'yonetim.ts');
  assert.ok(dosyalar.includes('oturum-yoneticisi.ts'));
  const yasak = /from\s+['"](?:\.\.\/(?:motor\/|hesap|masaustu-hesap|abonelik|sohbet|beyin|veri\/)|(?:\.\.\/){2}shared\/(?:masaustu-hesap|hesap-)[\w-]*)/;
  for (const d of dosyalar) {
    const kaynak = fs.readFileSync(path.join(klasor, d), 'utf8');
    for (const satir of kaynak.split(/\r?\n/)) if (/^\s*(?:import|export)\b.*\bfrom\b/.test(satir)) assert.doesNotMatch(satir, yasak, `${d}: ${satir.trim()}`);
  }
});

test('oturum özeti belirteç taşır (Denetçi "—" göstermesin) ve tur bitince birikir', async () => {
  const t = kur();
  const id = await baslat(t, 'merhaba');
  await t.bekleOlay(id, 'sonuc');
  await bekleKosul(() => t.sonDurum(id) === 'bosta', 3000, 'boşta');
  const o = t.y.oturumlar().find((x) => x.id === id)!;
  assert.deepEqual(o.belirtec, { girdi: 120, cikti: 34, onbellekOkuma: 50, onbellekYazma: 10 });
  assert.deepEqual(t.y.oturum(id)!.belirtec, o.belirtec, 'ayrıntı da aynı özeti taşır');
});

test('süreç sınırı: boştaki oturum budanır ama arka planda işi süren oturumun süreci KAPATILMAZ', async () => {
  // En çok 2 canlı süreç; üçüncü oturum açılınca en eski BOŞTAKİ kapatılır. A en eski ama arkada ajanı var → B kapanır.
  const t = kur(undefined, { azamiEsZamanli: 1, azamiCanliSurec: 2 });
  const a = await baslat(t, '#arkaplan');
  await t.bekleOlay(a, 'sonuc');
  await bekleKosul(() => t.sonDurum(a) === 'bosta', 3000, 'A boşta');
  const b = await baslat(t, '#durum');
  await t.bekleOlay(b, 'sonuc');
  await bekleKosul(() => t.sonDurum(b) === 'bosta', 3000, 'B boşta');
  const pidA = t.y.pid(a)!, pidB = t.y.pid(b)!;
  assert.ok(pidA && pidB && t.y.surecler().length === 2);
  const c = await baslat(t, '#durum');
  await t.bekleOlay(c, 'sonuc');
  await bekleKosul(() => t.y.pid(b) === undefined, 5000, 'B süreci kapandı');
  assert.equal(t.y.pid(a), pidA, 'arka plan işi süren A\'nın süreci yaşıyor');
  assert.equal(t.y.oturumlar().find((x) => x.id === a)!.arkaPlan, 1, 'A hâlâ "Arka planda"');
  assert.equal(t.y.oturumlar().find((x) => x.id === b)!.arkaPlan, 0);
  // A'nın işi bitince (sonraki turda) sayı 0; artık budanabilir.
  await t.y.gonder(a, { metin: '#arkabit' });
  await t.bekleOlay(a, 'sonuc', 2);
  assert.equal(t.y.oturumlar().find((x) => x.id === a)!.arkaPlan, 0);
});
