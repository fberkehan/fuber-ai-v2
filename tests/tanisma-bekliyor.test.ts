// 0.12 cila düzeltme turu 1 (inceleme I-3): kurulum akışı yapay zekânın hazır olmasını beklemez — "Yalnız bu bilgisayar" seçen yeni
// kullanıcıda model kurulum bittiğinde hâlâ iner (yol 'yok') ve tanışma atlanıyor, bir daha denenmiyordu. Artık kurulum:tamamla yol yoksa
// `tanisma:bekliyor` işaretini yazar; zamanlayıcı (tik → bekleyenTanisma) yol hazır, ana sohbet boş (kullanıcı henüz yazmadı) ve meşgul
// değilken tanışmayı BİR kez yapar; işaret 48 saatte düşer, kullanıcı bu arada yazdıysa da düşer.
// GERÇEK ipc.ts kurulum:tamamla + zamanlayici.ts + ajan döngüsü; yerel model sahte (FUBER_YEREL_TABAN), bulut yok, ağ yok.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';

const yerelIstekler: { sistem: string; son: string }[] = [];
const metniAl = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join(' ') : '');
const yerelSunucu = http.createServer(async (q, r) => {
  let h = '';
  for await (const d of q) h += d;
  const l = (JSON.parse(h || '{}').messages ?? []) as { role: string; content: unknown }[];
  const sistem = l[0]?.role === 'system' ? metniAl(l[0].content) : '';
  const son = metniAl(l.at(-1)?.content);
  yerelIstekler.push({ sistem, son });
  const content = /hafıza yazıcısısın/.test(sistem) ? '{"islemler":[]}' : /"selamlama"/.test(sistem) ? '{"selamlama":"Merhaba","odak":"","kartlar":[]}'
    : /başlık/.test(sistem) ? 'Tanışma' : 'Merhaba Deniz! Seni tanımak isterim: bu aralar en çok hangi işle uğraşıyorsun?';
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise<void>((c) => yerelSunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => yerelSunucu.close(() => c())));
const YEREL_TABAN = `http://127.0.0.1:${(yerelSunucu.address() as { port: number }).port}`;

anaSurecSahnesi('tanisma-bekliyor', {
  kurulumTamam: false, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0',
  // Sessiz saat aralığı boş (00:00–00:00): öbür testler günün saatinden bağımsız; sessiz saat testi kendi aralığını kurar.
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false, sessizBaslangic: '00:00', sessizBitis: '00:00' }, baslangictaAc: false,
  // "Yalnız bu bilgisayar" seçili, yerel kurulu değil, istenmiş kurulumun kaydı var: kurulum bittiğinde yol 'yok' (model iniyor).
  yerel: { gpu: 'cpu', yalnizYerel: true, etkin: false, model: 'bonsai2-4b', bekleyenKurulum: { model: 'bonsai2-4b', zaman: new Date().toISOString() } },
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
delete process.env.FUBER_YEREL_TABAN;
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;

const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { tekMotorYolu } = await import('../src/main/motor/yerel.ts');
const zamanlayici = await import('../src/main/zamanlayici.ts') as Record<string, unknown>;
const bekleyenTanisma = zamanlayici.bekleyenTanisma as ((simdi?: number) => boolean) | undefined;
const { anaSohbet, mesajlar, mesajEkle, gorunenMesajlar } = await import('../src/main/sohbet.ts');
const { mesgulMu, turSonrasiniBitir } = await import('../src/main/ajan/dongu.ts');
const { hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { meta, metaYaz } = await import('../src/main/vt.ts');
const { TANISMA_TALIMATI_YEREL } = await import('../src/shared/ic-talimat.ts');
after(() => { delete process.env.FUBER_YEREL_TABAN; });

const ISARET = 'tanisma:bekliyor';
const bekle = async <T>(f: () => T | undefined | false, ms = 8000): Promise<T> => {
  const bas = Date.now();
  for (;;) { const v = f(); if (v) return v; if (Date.now() - bas > ms) throw new Error('beklenen olmadı'); await new Promise((c) => setTimeout(c, 25)); }
};
const tanismalar = () => yerelIstekler.filter((i) => i.son.includes('KURULUM BİTTİ')).length;
const yereliHazirla = () => { process.env.FUBER_YEREL_TABAN = YEREL_TABAN; ayarlariKaydet((a) => { a.yerel.etkin = true; delete a.yerel.bekleyenKurulum; }); };
const yereliIndir = () => { delete process.env.FUBER_YEREL_TABAN; ayarlariKaydet((a) => { a.yerel.etkin = false; a.yerel.bekleyenKurulum = { model: 'bonsai2-4b', zaman: new Date().toISOString() }; }); };

test('kurulum biterken yapay zekâ iniyor (yol yok): tanışma atlanmaz, BEKLER — işaret yazılır, model çağrısı yok', async () => {
  assert.equal(tekMotorYolu(), 'yok');
  await ipcIsleyicileri().get('kurulum:tamamla')!({}, { kullaniciAdi: 'Deniz', hitap: 'Deniz', claudeHafiza: false });
  assert.ok(meta(ISARET), 'tanisma:bekliyor yazıldı');
  assert.equal(tanismalar(), 0);
});

test('yapay zekâ hazır değilken zamanlayıcı bekler (işaret kalır); hazır olunca tanışma BİR kez yapılır ve yanıt ana sohbette görünür', async () => {
  assert.equal(typeof bekleyenTanisma, 'function', 'zamanlayici.ts bekleyenTanisma');
  assert.equal(bekleyenTanisma!(), false);
  assert.ok(meta(ISARET), 'hâlâ bekliyor');
  yereliHazirla();
  assert.equal(tekMotorYolu(), 'yerel');
  assert.equal(bekleyenTanisma!(), true);
  const ana = anaSohbet();
  const t = await bekle(() => yerelIstekler.find((i) => i.son.includes('KURULUM BİTTİ')));
  await bekle(() => !mesgulMu(ana));
  assert.ok(t.son.trimEnd().endsWith(TANISMA_TALIMATI_YEREL), 'yerelde araçsız kısa talimat');
  assert.ok(gorunenMesajlar(ana).some((m) => m.rol === 'assistant' && JSON.stringify(m.bloklar).includes('Seni tanımak isterim')));
  assert.equal(meta(ISARET), undefined, 'işaret düştü');
  assert.equal(bekleyenTanisma!(), false, 'ikinci kez yapılmaz');
  assert.equal(tanismalar(), 1);
  await turSonrasiniBitir(6000);
  await hafizaYaziminiBekle();
});

test('48 saatten eski işaret düşer — eski kurulumun tanışması günler sonra çıkmaz', () => {
  metaYaz(ISARET, new Date(Date.now() - 49 * 3600_000).toISOString());
  const once = tanismalar();
  assert.equal(bekleyenTanisma!(), false);
  assert.equal(meta(ISARET), undefined);
  assert.equal(tanismalar(), once);
});

test('sessiz saatte bekleyen tanışma yapılmaz, işaret kalır — gece inen model tanışmayı gece getirmez', () => {
  yereliHazirla();
  const saat = (dk: number) => { const t = new Date(Date.now() + dk * 60_000); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
  ayarlariKaydet((a) => { a.proaktif.sessizBaslangic = saat(-60); a.proaktif.sessizBitis = saat(60); });
  metaYaz(ISARET, new Date().toISOString());
  const once = tanismalar();
  assert.equal(bekleyenTanisma!(), false);
  assert.ok(meta(ISARET), 'işaret kalır (sessiz saat bitince yapılır)');
  assert.equal(tanismalar(), once);
  ayarlariKaydet((a) => { a.proaktif.sessizBaslangic = '00:00'; a.proaktif.sessizBitis = '00:00'; });
});

test('kullanıcı bu arada ana sohbette yazdıysa tanışma yapılmaz, işaret düşer', () => {
  metaYaz(ISARET, new Date().toISOString());
  mesajEkle(anaSohbet(), { rol: 'user', bloklar: [{ tur: 'metin', metin: 'Merhaba' }], kaynak: 'kullanici' });
  const once = tanismalar();
  assert.equal(bekleyenTanisma!(), false);
  assert.equal(meta(ISARET), undefined);
  assert.equal(tanismalar(), once);
  assert.ok(mesajlar(anaSohbet()).length > 0);
});

test('kurulum biterken yapay zekâ hazırsa tanışma hemen yapılır, işaret yazılmaz', async () => {
  yereliIndir();
  yereliHazirla();
  const once = tanismalar();
  await ipcIsleyicileri().get('kurulum:tamamla')!({}, { kullaniciAdi: 'Deniz', hitap: 'Deniz', claudeHafiza: false });
  await bekle(() => tanismalar() > once);
  await bekle(() => !mesgulMu(anaSohbet()));
  assert.equal(meta(ISARET), undefined);
  await turSonrasiniBitir(6000);
  await hafizaYaziminiBekle();
});
