// 0.12 cila (H5 tur 2 kaygısı 3): "Yalnız bu bilgisayar" (ve Gizli) seçili, bu bilgisayardaki yapay zekâ HAZIR ama hiç bulut motoru YOKKEN
// (hesap onay bekliyor; anahtar yok) yardımcı model isteyen özellikler sessizce atlanıyordu: tanışma turu (ipc.ts kurulum:tamamla), içe
// aktarılan belgenin özeti (iceaktar.ts), e-posta önem sınıflaması (entegrasyon/eposta.ts), WhatsApp önem sınıflaması
// (entegrasyon/whatsapp.ts) "hazır BULUT motoru var mı" kapısına bakıyordu; gün kaydı ajanları (gunkaydi/model.ts ajanJson) ise yol yerel
// olsa da önce bulut seçimini okuyup "motor yok" diye düşüyordu. Kapı artık tek kuraldır (d683a7f'deki hafıza/kokpit düzeltmesinin kalıbı):
// tekMotorYolu() !== 'yok' — model çağrısı yine TEK seçiciden geçer (motor/secici.ts cagir/cagirSecimle), yol yerelse buluta hiçbir şey
// gitmez. Dış kaynaktan veri çekme (IMAP, WhatsApp) değişmez; yalnız model çağrısının yolu.
// Proaktif işler (zamanlayici.ts proaktifIs) aynı tek kurala bağlandı; SABAH/AKŞAM/MERAK araç istediği için (G1/F2, shared/ic-talimat.ts)
// yerel yolda BİLEREK çalışmaz — bu kural değişmedi (son test sabitler).
// GERÇEK ana süreç modülleri (Electron'suz sahne); motorlar bu bilgisayardaki sahte sunucular: yerel model (FUBER_YEREL_TABAN) ve bulut
// (Fuber ağ geçidi taklidi, yalnız "bulut motoru var ama Yalnız bu bilgisayar" bölümünde bağlanır — oraya 0 istek gitmeli).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';
import { fuberBicimi, openaiYaz } from './yardimci/openai-sahte.ts';
import { ozelGerekli, ozelModulleriYukle } from './yardimci/ozel.ts';

type Rol = 'hafiza' | 'kokpit' | 'baslik' | 'iceaktar' | 'eposta' | 'whatsapp' | 'gunkaydi' | 'tanisma' | 'sohbet';
interface Istek { rol: Rol; sistem: string; son: string }
const metniAl = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join(' ') : '');
const rolu = (sistem: string, son: string): Rol => (
  /hafıza yazıcısısın/.test(sistem) ? 'hafiza'
    : /"selamlama"/.test(sistem) ? 'kokpit'
      : /2-4 cümleyle Türkçe özetle/.test(sistem) ? 'iceaktar'
        : /önem açısından puanla/.test(sistem) ? 'eposta'
          : /WhatsApp mesajları/.test(sistem) ? 'whatsapp'
            : /GUNKAYDI_TEST/.test(sistem) ? 'gunkaydi'
              : /KURULUM BİTTİ/.test(son) ? 'tanisma'
                : /başlık/.test(sistem) ? 'baslik' : 'sohbet');
const yanit = (rol: Rol, son: string): string => {
  if (rol === 'hafiza') return '{"islemler":[]}';
  if (rol === 'kokpit') return '{"selamlama":"Merhaba Deniz","odak":"","kartlar":[]}';
  if (rol === 'iceaktar') return 'Proje toplantısının notları: teslim tarihi cuma, sorumlu Deniz.';
  if (rol === 'eposta') return JSON.stringify({ sonuclar: [...son.matchAll(/"id":(\d+)/g)].map((m, i) => ({ id: Number(m[1]), onem: i === 0 ? 5 : 1, neden: i === 0 ? 'Ödeme son tarihi yarın.' : 'Bülten.' })) });
  if (rol === 'whatsapp') return '{"acil":[{"ad":"Ayşe","neden":"Toplantı saatini soruyor."}]}';
  if (rol === 'gunkaydi') return '{"tamam":true}';
  if (rol === 'baslik') return 'Tanışma';
  if (rol === 'tanisma') return 'Merhaba Deniz! Seni tanımak isterim: bu aralar en çok hangi işle uğraşıyorsun?';
  return 'Merhaba Deniz.';
};
const govde = (q: http.IncomingMessage) => new Promise<Record<string, unknown>>((c) => { let h = ''; q.on('data', (d) => { h += d; }); q.on('end', () => c(h ? JSON.parse(h) : {})); });
const yaz = (r: http.ServerResponse, v: unknown) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(v)); };

const yerelIstekler: Istek[] = [];
const yerelSunucu = http.createServer(async (q, r) => {
  if (q.method !== 'POST' || q.url !== '/v1/chat/completions') { r.writeHead(404); r.end(); return; }
  const l = ((await govde(q)).messages ?? []) as { role: string; content: unknown }[];
  const sistem = l[0]?.role === 'system' ? metniAl(l[0].content) : '';
  const son = metniAl(l.at(-1)?.content);
  const i: Istek = { rol: rolu(sistem, son), sistem, son };
  yerelIstekler.push(i);
  yaz(r, { choices: [{ message: { content: yanit(i.rol, son) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
});
const bulutIstekler: string[] = [];
const bulutSunucu = http.createServer(async (q, r) => {
  bulutIstekler.push(`${q.method} ${q.url}`);
  await govde(q);
  openaiYaz(r, 'BULUT');
});
const dinle = async (s: http.Server) => { await new Promise<void>((c) => s.listen(0, '127.0.0.1', c)); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };
const yerelTaban = await dinle(yerelSunucu);
const bulutTaban = await dinle(bulutSunucu);
after(() => Promise.all([yerelSunucu, bulutSunucu].map((s) => new Promise<void>((c) => s.close(() => c())))));

const sahne = anaSurecSahnesi('yalniz-yerel-ozellikler', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, yerel: { gpu: 'cpu', yalnizYerel: true },
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
process.env.FUBER_YEREL_TABAN = yerelTaban;
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;

const { ayarlariKaydet, sirYaz } = await import('../src/main/ayarlar.ts');
const { tekMotorYolu } = await import('../src/main/motor/yerel.ts');
const { hazirMotorlar } = await import('../src/main/motor/secici.ts');
const { anaSohbet, gorunenMesajlar } = await import('../src/main/sohbet.ts');
const { mesgulMu, turSonrasiniBitir } = await import('../src/main/ajan/dongu.ts');
const { hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { dosyaOgret } = await import('../src/main/iceaktar.ts');
const { _test: eposta } = await import('../src/main/entegrasyon/eposta.ts');
// WhatsApp isteğe bağlı modülde (bu depoda yok). Genel yükleyici varsa modülü kapıya kaydeder; kanca yoksa WhatsApp sınamaları atlanır.
await ozelModulleriYukle();
const whatsapp = (await import('../src/main/entegrasyon/whatsapp-kapisi.ts')).whatsappTestKancasi();
const waSecenegi = ozelGerekli('whatsapp');
const { ajanJson } = await import('../src/main/gunkaydi/model.ts');
const { proaktifIs } = await import('../src/main/zamanlayici.ts');
const { oneriler } = await import('../src/main/planlama.ts');
const { veritabani, meta } = await import('../src/main/vt.ts');
const { TANISMA_TALIMATI_YEREL } = await import('../src/shared/ic-talimat.ts');
after(() => { delete process.env.FUBER_YEREL_TABAN; });

const bekle = async <T>(f: () => T | undefined | false, ms = 8000): Promise<T> => {
  const bas = Date.now();
  for (;;) { const v = f(); if (v) return v; if (Date.now() - bas > ms) throw new Error('beklenen olmadı'); await new Promise((c) => setTimeout(c, 25)); }
};
const yeniRoller = (once: number) => yerelIstekler.slice(once).map((i) => i.rol);

// ── Ortak sınamalar (iki bölümde de: bulut motoru yokken ve varken) ──────────────────────────────────────────────────────────
let belgeNo = 0;
async function iceAktarSina(): Promise<void> {
  const once = yerelIstekler.length;
  const dosya = path.join(sahne.klasor, `toplanti-notu-${++belgeNo}.txt`);
  fs.writeFileSync(dosya, `Toplantı notu ${belgeNo}: proje teslimi cuma; sorumlu Deniz. Müşteri sunumu salı günü yapılacak, bütçe onaylandı.`);
  dosyaOgret(dosya);
  const belge = await bekle(() => veritabani().prepare("SELECT durum, ozet FROM belgeler WHERE yol = ? AND durum = 'islendi'").get(dosya) as { durum: string; ozet: string | null } | undefined);
  await hafizaYaziminiBekle();
  assert.ok(yeniRoller(once).includes('iceaktar'), `belge özeti yerelde çıkarıldı: ${JSON.stringify(yeniRoller(once))}`);
  assert.match(belge.ozet ?? '', /Proje toplantısının notları/, 'özet belgeye yazıldı (atlanmadı)');
  // 11 Kas analizi #3: yerelde MODEL yazıcısı yok — küçük modelin çıkardığı kayıtlar olgu diye yazılmaz; belge yine aranır (belgeAra, turBaglami).
  assert.ok(!yeniRoller(once).includes('hafiza'), 'yerelde belge özeti model yazıcısına gitmez');
}

async function epostaSina(etiket: string): Promise<void> {
  const once = yerelIstekler.length;
  const vt = veritabani();
  const ekle = (konu: string) => Number(vt.prepare('INSERT INTO epostalar(hesap, mesaj_kimlik, kimden, konu, tarih, ozet) VALUES(?,?,?,?,?,?)')
    .run('h1', `${etiket}-${konu}`, 'muhasebe@ornek.com', konu, new Date().toISOString(), `${konu} hakkında`).lastInsertRowid);
  const a = ekle(`Fatura ${etiket}`), b = ekle(`Bülten ${etiket}`);
  await eposta.onemDegerlendir([
    { id: a, kimden: 'muhasebe@ornek.com', konu: `Fatura ${etiket}`, ozet: 'Ödeme yarın.' },
    { id: b, kimden: 'bulten@ornek.com', konu: `Bülten ${etiket}`, ozet: 'Haftalık haberler.' },
  ]);
  assert.ok(yeniRoller(once).includes('eposta'), `önem sınıflaması yerelde: ${JSON.stringify(yeniRoller(once))}`);
  const onem = vt.prepare('SELECT id, onem, degerlendirme FROM epostalar WHERE id IN (?, ?) ORDER BY id').all(a, b) as { onem: number; degerlendirme: string | null }[];
  assert.deepEqual(onem.map((e) => e.onem), [5, 1], 'puanlar yazıldı');
  assert.ok(oneriler(50).some((o) => o.tur === 'dikkat' && o.baslik === `E-posta: Fatura ${etiket}`), 'önemli e-posta kokpitte "dikkat" önerisi oldu');
}

async function whatsappSina(): Promise<void> {
  if (!whatsapp) { assert.ok(waSecenegi.skip, 'özel modül varken kanca da olmalı'); return; } // genel ağaç: WhatsApp yok
  const once = yerelIstekler.length;
  const vt = veritabani();
  vt.prepare("DELETE FROM oneriler WHERE baslik = 'WhatsApp: Ayşe'").run();
  await whatsapp.siniflandir([{ jid: '905000000000@s.whatsapp.net', ad: 'Ayşe', metin: 'Yarınki toplantı kaçta?' }]);
  assert.ok(yeniRoller(once).includes('whatsapp'), `WhatsApp sınıflaması yerelde: ${JSON.stringify(yeniRoller(once))}`);
  assert.ok(oneriler(50).some((o) => o.tur === 'dikkat' && o.baslik === 'WhatsApp: Ayşe'), 'acil mesaj kokpitte "dikkat" önerisi oldu');
}

async function gunKaydiSina(): Promise<void> {
  const once = yerelIstekler.length;
  const { veri } = await ajanJson<{ tamam?: boolean }>('GUNKAYDI_TEST: kısa karar ver.', 'Bugünün notları.', 'gunkaydi:test', 400);
  assert.deepEqual(veri, { tamam: true });
  assert.deepEqual(yeniRoller(once), ['gunkaydi'], 'gün kaydı ajanı yerelde (bulut seçimi okunmadan)');
}

// ── Bölüm 1: "Yalnız bu bilgisayar", bulut motoru YOK (hesap onay bekliyor) ──────────────────────────────────────────────────
test('ön koşul: "Yalnız bu bilgisayar" seçili, yerel hazır, bulut motoru yok → yol yerel', () => {
  assert.deepEqual(hazirMotorlar(), [], 'bulut motoru yok');
  assert.equal(tekMotorYolu(), 'yerel');
});

test('tanışma (kurulum:tamamla) yerel modele araçsız kısa talimatla gider ve yanıtı ana sohbette görünür', async () => {
  const once = yerelIstekler.length;
  const ana = anaSohbet();
  await ipcIsleyicileri().get('kurulum:tamamla')!({}, { kullaniciAdi: 'Deniz', hitap: 'Deniz', claudeHafiza: false });
  const tanisma = await bekle(() => yerelIstekler.slice(once).find((i) => i.rol === 'tanisma'));
  await bekle(() => !mesgulMu(ana));
  assert.ok(tanisma.son.trimEnd().endsWith(TANISMA_TALIMATI_YEREL), tanisma.son.slice(-300));
  assert.ok(gorunenMesajlar(ana).some((m) => m.rol === 'assistant' && JSON.stringify(m.bloklar).includes('Seni tanımak isterim')), 'tanışma yanıtı görünür');
  await turSonrasiniBitir(6000);
  await hafizaYaziminiBekle();
});

test('içe aktarılan belgenin özeti ve hafızası yerelde çıkarılır (bulut motoru yok diye atlanmaz)', async () => {
  await iceAktarSina();
});

test('e-posta önem sınıflaması yerelde yapılır (bulut motoru yok diye atlanmaz); önemli olan "dikkat" önerisi olur', async () => {
  await epostaSina('yalniz');
});

test('WhatsApp önem sınıflaması yerelde yapılır (bulut motoru yok diye atlanmaz)', async () => {
  await whatsappSina();
});

test('gün kaydı ajanı (ajanJson) yerelde çalışır — bulut seçimi okunup "motor yok" diye düşmez', async () => {
  await gunKaydiSina();
});

test('Gizli (bulut motoru yok, yerel hazır): e-posta sınıflaması ve gün kaydı ajanı da yerelde', async () => {
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; a.yerel.gizliMod = true; });
  try {
    assert.equal(tekMotorYolu(), 'yerel');
    await epostaSina('gizli');
    await gunKaydiSina();
  } finally { ayarlariKaydet((a) => { a.yerel.gizliMod = false; a.yerel.yalnizYerel = true; }); }
});

// 11 Kas analizi #9: "Yalnız bu bilgisayar"da sabah/akşam özeti MODELSİZ, şablonla gelir (zamanlayici.ts yerelOzet; gün anahtarı yazılır, deneme yok);
// merak sorusu yerelde sorulmaz. Hiçbiri yerel modele gitmez (G1/F2: küçük model araç isteyen talimatı aynen geri yazıyordu).
test('proaktif yerel yolda: SABAH/AKŞAM modelsiz şablon (yerel modele istek yok, gün anahtarı yazılır); MERAK çalışmaz', async () => {
  const once = yerelIstekler.length;
  for (const is of ['sabah', 'aksam', 'merak'] as const) await proaktifIs(is, `${is}:yalniz`, 'Fuber');
  assert.deepEqual(yeniRoller(once), []);
  for (const is of ['sabah', 'aksam']) {
    assert.ok(meta(`${is}:yalniz`), `${is}: şablon denendi, gün anahtarı yazıldı`);
    assert.equal(meta(`${is}:yalniz:deneme`), undefined, `${is}: model denemesi yok`);
  }
  assert.equal(meta('merak:yalniz'), undefined);
  assert.equal(meta('merak:yalniz:deneme'), undefined);
});

// ── Bölüm 2: bulut motoru VAR (Fuber ağ geçidi bağlı) ama "Yalnız bu bilgisayar" seçili — hepsi yerelde, buluta 0 istek ──────────
test('bulut motoru bağlıyken de "Yalnız bu bilgisayar"da içe aktarma, e-posta, WhatsApp ve gün kaydı yerelde; buluta HİÇBİR istek gitmez', async () => {
  ayarlariKaydet((a) => { a.motorSecimi = 'openai'; a.openaiUyumlu = { tabanUrl: `${bulutTaban}/v1`, model: 'sahte-model' }; });
  assert.deepEqual(hazirMotorlar(), ['openai'], 'bulut motoru hazır');
  assert.equal(tekMotorYolu(), 'yerel', 'yine de yol yerel (P14)');
  await iceAktarSina();
  await epostaSina('bulutlu');
  await whatsappSina();
  await gunKaydiSina();
  assert.deepEqual(bulutIstekler, [], 'buluta istek yok');
});

test('Gizli + bulut motoru bağlı: içe aktarma, e-posta, WhatsApp ve gün kaydı yine yerelde; buluta 0 istek (düzeltme turu 1, inceleme M-2)', async () => {
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; a.yerel.gizliMod = true; });
  try {
    assert.deepEqual(hazirMotorlar(), ['openai']);
    assert.equal(tekMotorYolu(), 'yerel');
    const b0 = bulutIstekler.length;
    await iceAktarSina();
    await epostaSina('gizli-bulutlu');
    await whatsappSina();
    await gunKaydiSina();
    assert.equal(bulutIstekler.length, b0, 'buluta istek yok');
  } finally { ayarlariKaydet((a) => { a.yerel.gizliMod = false; a.yerel.yalnizYerel = true; }); }
});

// ── Bölüm 3: POZİTİF KONTROL (inceleme M-2) — aynı kurulumda Fuber seçilince aynı çağrılar sahte BULUTA gider: yukarıdaki "buluta 0
// istek" iddiaları boş değil (sahte bulut gerçekten bağlı ve sayıyor). ──────────────────────────────────────────────────────────
test('pozitif kontrol: Fuber seçiliyken (yalnız/Gizli kapalı) içe aktarma, e-posta, WhatsApp ve gün kaydı sahte BULUTA gider, yerele gitmez', async () => {
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; a.yerel.gizliMod = false; });
  try {
    assert.equal(tekMotorYolu(), 'bulut');
    const yerelOnce = yerelIstekler.length;
    let once = bulutIstekler.length;
    const yol = path.join(sahne.klasor, 'bulut-pozitif.txt');
    fs.writeFileSync(yol, 'Bulut pozitif kontrol: proje teslimi cuma; sorumlu Deniz. Müşteri sunumu salı günü yapılacak.');
    dosyaOgret(yol);
    await bekle(() => (veritabani().prepare("SELECT 1 FROM belgeler WHERE yol = ? AND durum = 'islendi'").get(yol) ? true : undefined));
    await hafizaYaziminiBekle();
    assert.ok(bulutIstekler.length > once, 'içe aktarma özeti buluta gitti');
    once = bulutIstekler.length;
    const id = Number(veritabani().prepare('INSERT INTO epostalar(hesap, mesaj_kimlik, kimden, konu, tarih, ozet) VALUES(?,?,?,?,?,?)').run('h1', 'pozitif-1', 'a@ornek.com', 'Pozitif', new Date().toISOString(), 'özet').lastInsertRowid);
    await eposta.onemDegerlendir([{ id, kimden: 'a@ornek.com', konu: 'Pozitif', ozet: 'Ödeme yarın.' }]);
    assert.ok(bulutIstekler.length > once, 'e-posta sınıflaması buluta gitti');
    once = bulutIstekler.length;
    if (whatsapp) {
      await whatsapp.siniflandir([{ jid: '905000000002@s.whatsapp.net', ad: 'Ali', metin: 'Toplantı kaçta?' }]);
      assert.ok(bulutIstekler.length > once, 'WhatsApp sınıflaması buluta gitti');
      once = bulutIstekler.length;
    }
    await ajanJson('GUNKAYDI_TEST: kısa karar ver.', 'Bugünün notları.', 'gunkaydi:test', 400);
    assert.ok(bulutIstekler.length > once, 'gün kaydı ajanı buluta gitti');
    assert.equal(yerelIstekler.length, yerelOnce, 'Fuber seçiliyken yerel modele istek yok');
  } finally { ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; }); }
});
