// 0.14 son inceleme I7 — Developer'ın MCP sunucularının başlık (Authorization) ve ortam (env) değerleri sır yuvasında (safeStorage; sirYaz
// 'mcp-sunucu:<id>'): ayarlar.json'da, ayarlar:al'da, ayarlar:degisti'de, telefon köprüsünde ve Claude Code içe aktarma listesinde yalnız yer tutucu.
// Açılış göçü düz değeri yalnız sır yazımı başarılıysa siler; tekrar çalışınca bir şey yapmaz. Bağlantı çözülmüş değerlerle kurulur (sahte stdio MCP
// sunucusu, scripts/dev/mcp-test-sunucu.mjs: ortamdaki MCP_GUNLUK dosyasına yazar). Gerçek değerler bu dosyada sahte, ağ yok.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';

const KOK = path.resolve(import.meta.dirname, '..');
const BASLIK = 'Bearer sahte-mcp-belirteci-0001';
const ORTAM_SIRRI = 'sahte-ortam-degeri-0002';
const { klasor } = anaSurecSahnesi('mcp-sir', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
  // 0.14 öncesi profil: değerler ayarlar.json'da düz.
  mcp: [
    { id: 'eski-http', ad: 'Eski HTTP', aciklama: '', tur: 'http', url: 'https://mcp.ornek.example/mcp', basliklar: { Authorization: BASLIK }, etkin: false },
    { id: 'eski-stdio', ad: 'Eski Stdio', aciklama: '', tur: 'stdio', komut: 'node', argumanlar: [], ortam: { GIZLI: ORTAM_SIRRI }, etkin: false },
  ],
});
const g = globalThis as Record<string, unknown>;
process.env.FUBER_DEMO = '1';
await ipcKurBos();
const { ayarlar, ayarlariKaydet, sirOku } = await import('../src/main/ayarlar.ts');
const { yollar } = await import('../src/main/yollar.ts');
const M = await import('../src/main/entegrasyon/mcp.ts');
const ipc = <T>(kanal: string, ...a: unknown[]) => Promise.resolve(ipcIsleyicileri().get(kanal)!({}, ...a)) as Promise<T>;
const dosya = () => fs.readFileSync(yollar.ayarlar(), 'utf8');
const bak = () => (fs.existsSync(`${yollar.ayarlar()}.bak`) ? fs.readFileSync(`${yollar.ayarlar()}.bak`, 'utf8') : '');
const duzYok = (metin: string, ne: string) => { for (const s of [BASLIK, ORTAM_SIRRI]) assert.ok(!metin.includes(s), `${ne}: düz değer var`); };

test('göç: sır yazılamazsa (DPAPI yok) düz değer YERİNDE kalır, bağlantı bilgisi kaybolmaz; tekrar denenebilir', () => {
  g.__sifreleme = false;
  try {
    const r = M.mcpSirlariniTasi();
    assert.deepEqual(r, { tasinan: 0, kalan: 2 });
    assert.equal(ayarlar().mcp.find((x) => x.id === 'eski-http')!.basliklar!.Authorization, BASLIK, 'düz değer silinmedi');
    assert.equal(ayarlar().mcp.find((x) => x.id === 'eski-stdio')!.ortam!.GIZLI, ORTAM_SIRRI);
  } finally { g.__sifreleme = true; }
});

test('göç: sır yuvasına taşınır, ayarlar.json ve .bak yalnız yer tutucu taşır; ikinci çalıştırma bir şey yapmaz (idempotent)', () => {
  const r = M.mcpSirlariniTasi();
  assert.deepEqual(r, { tasinan: 2, kalan: 0 });
  const h = ayarlar().mcp.find((x) => x.id === 'eski-http')!;
  assert.deepEqual(h.basliklar, { Authorization: M.MCP_SIR_YER_TUTUCU }, 'ad kalır, değer yer tutucu');
  assert.deepEqual(ayarlar().mcp.find((x) => x.id === 'eski-stdio')!.ortam, { GIZLI: M.MCP_SIR_YER_TUTUCU });
  duzYok(dosya(), 'ayarlar.json');
  duzYok(bak(), 'ayarlar.json.bak');
  assert.deepEqual(JSON.parse(sirOku('mcp-sunucu:eski-http')!), { basliklar: { Authorization: BASLIK } }, 'değer sır yuvasında');
  assert.deepEqual(JSON.parse(sirOku('mcp-sunucu:eski-stdio')!), { ortam: { GIZLI: ORTAM_SIRRI } });
  const once = dosya();
  assert.deepEqual(M.mcpSirlariniTasi(), { tasinan: 0, kalan: 0 });
  assert.equal(dosya(), once, 'ikinci çalıştırma dosyayı değiştirmez');
});

test('kayıt: arayüzün yer tutuculu kopyasıyla kaydetmek (anahtar, her sohbete) değeri korur; yeni değer sır yuvasına, ayarlara yer tutucu', () => {
  const s = ayarlar().mcp.find((x) => x.id === 'eski-http')!;
  M.mcpKaydet({ ...s, etkin: true });
  assert.equal(JSON.parse(sirOku('mcp-sunucu:eski-http')!).basliklar.Authorization, BASLIK, 'yer tutucu eski değeri korudu');
  const yeni = M.mcpKaydet({ ad: 'Yeni', aciklama: '', tur: 'http', url: 'https://yeni.ornek.example/mcp', basliklar: { 'X-Anahtar': 'sahte-yeni-0003' }, etkin: false });
  assert.deepEqual(yeni.basliklar, { 'X-Anahtar': M.MCP_SIR_YER_TUTUCU }, 'dönen kayıt (arayüze) yer tutuculu');
  assert.ok(!dosya().includes('sahte-yeni-0003'));
  assert.equal(JSON.parse(sirOku(`mcp-sunucu:${yeni.id}`)!).basliklar['X-Anahtar'], 'sahte-yeni-0003');
  // Anahtarı listeden çıkarılan değer düşer.
  M.mcpKaydet({ ...ayarlar().mcp.find((x) => x.id === yeni.id)!, basliklar: {} });
  assert.equal(sirOku(`mcp-sunucu:${yeni.id}`), undefined);
  // Silince sır da gider.
  M.mcpSil(yeni.id);
  assert.equal(ayarlar().mcp.some((x) => x.id === yeni.id), false);
});

test('kayıt: sır yazılamazsa kayıt değişmez ve hata açık (düz değer ayarlara yazılmaz)', () => {
  g.__sifreleme = false;
  try {
    assert.throws(() => M.mcpKaydet({ ad: 'Sirsiz', aciklama: '', tur: 'http', url: 'https://s.ornek.example/mcp', basliklar: { Authorization: 'sahte-sirsiz-0004' }, etkin: false }), /güvenli olarak saklanamadı/);
  } finally { g.__sifreleme = true; }
  assert.equal(ayarlar().mcp.some((x) => x.ad === 'Sirsiz'), false);
  assert.ok(!dosya().includes('sahte-sirsiz-0004'));
});

test('ayarlar:kaydet\'teki mcp kopyası (bayat ya da düz değerli) ayarlara yazılmaz', async () => {
  const bayat = structuredClone(ayarlar().mcp).map((x) => ({ ...x, basliklar: x.basliklar ? { Authorization: 'sahte-bayat-0005' } : undefined }));
  await ipc('ayarlar:kaydet', { mcp: bayat });
  assert.ok(!dosya().includes('sahte-bayat-0005'));
  assert.equal(JSON.parse(sirOku('mcp-sunucu:eski-http')!).basliklar.Authorization, BASLIK);
});

test('Claude Code içe aktarma: liste yer tutuculu döner; kaydedince değer ana süreçte ~/.claude.json\'dan okunup sır yuvasına gider', async () => {
  const ev = process.env.USERPROFILE!;
  fs.writeFileSync(path.join(ev, '.claude.json'), JSON.stringify({ mcpServers: { cc: { type: 'stdio', command: 'node', args: [], env: { CC_GIZLI: 'sahte-cc-0006' } } } }));
  try {
    const aday = await ipc<Array<Record<string, unknown>>>('mcp:claude-code');
    assert.ok(!JSON.stringify(aday).includes('sahte-cc-0006'), 'arayüze düz değer gitmez');
    assert.deepEqual(aday[0].ortam, { CC_GIZLI: M.MCP_SIR_YER_TUTUCU });
    const k = M.mcpKaydet({ ...(aday[0] as never), etkin: false });
    assert.equal(JSON.parse(sirOku(`mcp-sunucu:${k.id}`)!).ortam.CC_GIZLI, 'sahte-cc-0006');
    M.mcpSil(k.id);
  } finally { fs.rmSync(path.join(ev, '.claude.json'), { force: true }); }
});

test('bağlantı ana süreçte çözülmüş değerle kurulur: stdio sunucusu ortamdaki (sır yuvasındaki) değeri görür', async () => {
  const gunluk = path.join(klasor, 'mcp-gunluk.jsonl');
  const s = M.mcpKaydet({ ad: 'Proje', aciklama: 'proje takip', tur: 'stdio', komut: process.execPath, argumanlar: [path.join(KOK, 'scripts', 'dev', 'mcp-test-sunucu.mjs')],
    ortam: { MCP_GUNLUK: gunluk }, etkin: true, her: true });
  assert.deepEqual(s.ortam, { MCP_GUNLUK: M.MCP_SIR_YER_TUTUCU });
  const araclar = await M.mcpAraclari('proje');
  const a = araclar.find((x) => x.tanim.ad.endsWith('proje_durumu'));
  assert.ok(a, araclar.map((x) => x.tanim.ad).join(','));
  await a!.calistir({ proje: 'mavi kuş' }, { sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set(), onay: async () => 'bir_kez' } as never);
  assert.ok(fs.existsSync(gunluk), 'sunucu ortam değişkenini (çözülmüş) gördü');
  ayarlariKaydet((x) => { x.mod = 'is'; }); // açık bağlantı kapanır
  M.mcpSil(s.id);
});

// ── Son inceleme tur 2 (kaygı 3 kararı): gizli değerler okunamıyorsa sunucuya HİÇ bağlanılmaz, kayıt reddedilir, satırda açık hata ──────────────────
test('Tur 2: gizli değerler okunamıyorsa (DPAPI yok / kayıt yok) sunucuya bağlanılmaz — eksik kimlikle de; satırda açık hata; kayıt reddedilir', async () => {
  ayarlariKaydet((x) => { x.mod = 'gelistirici'; });
  const gunluk = path.join(klasor, 'okunamadi-gunluk.jsonl');
  const s = M.mcpKaydet({ ad: 'Okunamaz', aciklama: 'proje takip', tur: 'stdio', komut: process.execPath, argumanlar: [path.join(KOK, 'scripts', 'dev', 'mcp-test-sunucu.mjs')],
    ortam: { MCP_GUNLUK: gunluk }, etkin: true, her: false });
  g.__sifreleme = false; // Windows şifrelemesi kullanılamıyor: kayıtlı değer çözülemez
  try {
    const r = await M.mcpSina(ayarlar().mcp.find((x) => x.id === s.id)!);
    assert.equal(r.tamam, false);
    assert.match(r.hata ?? '', /gizli değerleri okunamadı/i);
    assert.match(r.hata ?? '', /sil ve yeniden ekle/i);
    assert.match(r.hata ?? '', /Claude Code/);
    assert.equal(fs.existsSync(gunluk), false, 'sunucu süreci hiç başlamadı');
    assert.equal(ayarlar().mcp.find((x) => x.id === s.id)!.sirOkunamadi, true, 'satırın hata bayrağı');
    // Okunamazken yer tutuculu kayıt (anahtar, her sohbete) gizli değerlerin üstüne yazmaz: reddedilir.
    assert.throws(() => M.mcpKaydet({ ...ayarlar().mcp.find((x) => x.id === s.id)!, her: true }), /okunamadı/);
    assert.equal(ayarlar().mcp.find((x) => x.id === s.id)!.her, false, 'kayıt değişmedi');
  } finally { g.__sifreleme = true; }
  // Okunabilir olunca açılış denetimi bayrağı kaldırır.
  M.mcpSirDurumunuDenetle();
  assert.equal(ayarlar().mcp.find((x) => x.id === s.id)!.sirOkunamadi, undefined);
  // Kayıt yok (sır yuvasından silinmiş) da çözülemez: bağlanılmaz, açılış denetimi bayrağı koyar.
  const { sirYaz } = await import('../src/main/ayarlar.ts');
  sirYaz(`mcp-sunucu:${s.id}`, null);
  M.mcpSirDurumunuDenetle();
  assert.equal(ayarlar().mcp.find((x) => x.id === s.id)!.sirOkunamadi, true);
  assert.equal((await M.mcpSina(ayarlar().mcp.find((x) => x.id === s.id)!)).tamam, false);
  assert.equal(fs.existsSync(gunluk), false);
  // Arayüz satırda bayrağı açık cümleyle gösterir.
  assert.match(fs.readFileSync(path.join(KOK, 'src', 'renderer', 'sayfalar', 'Baglantilar.tsx'), 'utf8'), /s\.sirOkunamadi && [\s\S]{0,200}MCP_SIR_OKUNAMADI_METNI/);
  // Sil ve yeniden ekle: düzelir.
  M.mcpSil(s.id);
  assert.equal(ayarlar().mcp.some((x) => x.id === s.id), false);
  ayarlariKaydet((x) => { x.mod = 'is'; });
});

test('Tur 2 (Minor): Claude Code içe aktarma yedeği ad + aynı komut/adresle eşleşir; aynı adlı başka sunucu o değerleri miras almaz', () => {
  const ev = process.env.USERPROFILE!;
  fs.writeFileSync(path.join(ev, '.claude.json'), JSON.stringify({ mcpServers: { ikiz: { type: 'stdio', command: 'cc-komutu', args: [], env: { K: 'sahte-ikiz-0007' } } } }));
  try {
    const k = M.mcpKaydet({ ad: 'ikiz', aciklama: '', tur: 'stdio', komut: 'baska-komut', argumanlar: [], ortam: { K: M.MCP_SIR_YER_TUTUCU }, etkin: false });
    assert.equal(sirOku(`mcp-sunucu:${k.id}`), undefined, 'farklı komutlu aynı adlı sunucu değeri almadı');
    M.mcpSil(k.id);
  } finally { fs.rmSync(path.join(ev, '.claude.json'), { force: true }); }
});
