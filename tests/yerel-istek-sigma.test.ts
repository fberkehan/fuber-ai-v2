// 0.14.1 vakası (5 Kas): yerel modelle kısa bir selam bile gönderilemiyordu ("bağlam sığmadı"). Kök neden: Gizli / "Yalnız bu bilgisayar"
// turunda yerel modele bulut turunun TAM sistem metni (kişilik + EYLEMLER + 20 aracın notları + karakter ≈ 9.000 karakter), 1.800 tokenlik hafıza
// bağlamı ve 60.000 tokenlik geçmiş bütçesi gidiyordu; yerel sunucunun yuvası 4.096 token (shared/yerel-butce.ts). Burada:
//  · saf: katalogdaki HER model için (sunucu aynı bağlamla açılır) yoğun bir profille kurulan yerel istek yuvaya %10 payla sığar;
//  · gerçek ajan döngüsü (dongu.ts yanitla) + yuva sınırını UYGULAYAN sahte yerel sunucu (istem 2,5 karakter/token — uygulamanın kendi temkinli
//    tahmini — + max_tokens > 4.096 → llama-server'ın HTTP 400 gövdesi): uzun geçmişli, çekirdek hafızalı sohbette "merhaba" yanıt alır; istekte
//    araç da araç notu da yok.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';
import { YEREL_MODELLER } from '../src/main/yerel/paketler.ts';
import { VARSAYILAN_KARAKTERLER } from '../src/shared/karakterler.ts';
import { yerelSistemIstemi, yerelSistemYari } from '../src/shared/yerel-istem.ts';
import { yerelMesajlariSigdir, yerelTokenTahmini, YEREL_YUVA_TOKEN, YEREL_BAGLAM_TOPLAM, YEREL_YUVA_SAYISI, YEREL_SOHBET_YANIT_TOKEN } from '../src/shared/yerel-butce.ts';

const uzun = (n: number) => 'Bugün proje toplantısında fiyat, takvim ve ekip konuları konuşuldu. '.repeat(Math.ceil(n / 68)).slice(0, n);

test('saf: katalogdaki her model için yoğun profilli yerel istek yuvaya %10 payla sığar; son ileti hep kalır, geçmiş en yeniden alınır', () => {
  assert.equal(YEREL_BAGLAM_TOPLAM / YEREL_YUVA_SAYISI, YEREL_YUVA_TOKEN);
  for (const id of Object.keys(YEREL_MODELLER)) {
    for (const karakter of [...Object.values(VARSAYILAN_KARAKTERLER), { ...VARSAYILAN_KARAKTERLER.business, sade: true as const }]) {
      const k = { ...karakter, sistemIstemi: uzun(3000) };
      const sistem = `${yerelSistemIstemi({ asistanAdi: 'Fuber', kullaniciAdi: 'Deniz Yılmaz', hitap: 'Deniz Bey', karakter: k })}\n\n${yerelSistemYari(uzun(6000), uzun(4000))}`;
      const gecmis = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: uzun(900) }));
      const son = { role: 'user', content: `<baglam>\n${uzun(1200)}\n</baglam>\n\nmerhaba` };
      const l = yerelMesajlariSigdir(sistem, [...gecmis, son], YEREL_SOHBET_YANIT_TOKEN);
      assert.deepEqual(l.at(-1), son, `${id}: turun isteği kalır`);
      assert.equal(l[0].role, 'user', `${id}: geçmiş kullanıcıyla başlar`);
      assert.ok(l.length > 1, `${id}: sığan kadar geçmiş girer`);
      const toplam = yerelTokenTahmini(sistem) + l.reduce((t, m) => t + yerelTokenTahmini(m.content) + 8, 0) + 200 + YEREL_SOHBET_YANIT_TOKEN;
      assert.ok(toplam <= YEREL_YUVA_TOKEN * 0.92, `${id}/${karakter.ad}: ${toplam} token ≤ yuvanın %92'si`);
      assert.ok(!/hafiza_|tarayici_|kokpit_|ARAÇ NOTLARI/.test(sistem), 'yerel istemde araç adı yok');
    }
  }
});

// ── Gerçek tur ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const istekler: { govde: Record<string, unknown>; token: number }[] = [];
const govdeOku = (q: http.IncomingMessage) => new Promise<Record<string, unknown>>((c) => { let h = ''; q.on('data', (d) => { h += d; }); q.on('end', () => c(h ? JSON.parse(h) : {})); });
const sunucu = http.createServer(async (q, r) => {
  const g = await govdeOku(q);
  const l = (g.messages ?? []) as { content: string }[];
  const token = l.reduce((t, m) => t + Math.ceil(String(m.content).length / 2.5) + 8, 0) + Number(g.max_tokens ?? 0);
  istekler.push({ govde: g, token });
  if (token > YEREL_YUVA_TOKEN) {
    r.writeHead(400, { 'content-type': 'application/json' });
    r.end(JSON.stringify({ error: { code: 400, message: 'the request exceeds the available context size, try increasing it', type: 'exceed_context_size_error' } }));
    return;
  }
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content: 'Merhaba Deniz!' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => sunucu.close(() => c())));

anaSurecSahnesi('yerel-istek-sigma', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, motorCalisti: true,
});
delete process.env.FUBER_YEREL_TABAN;
await ipcKurBos();
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;
const { sohbetOlustur, mesajEkle, mesajlar } = await import('../src/main/sohbet.ts');
const { hafizaEkle } = await import('../src/main/hafiza/depo.ts');
const { yanitla, turSonrasiniBitir } = await import('../src/main/ajan/dongu.ts');
const { herOlayiDinle } = await import('../src/main/olaylar.ts');
const hatalar: string[] = [];
herOlayiDinle((_k, v) => { const o = v as { tur?: string; mesaj?: string }; if (o?.tur === 'hata') hatalar.push(String(o.mesaj)); });
for (let i = 0; i < 12; i++) hafizaEkle({ tur: 'kisi', baslik: `Kayıt ${i}`, icerik: uzun(300), sabit: true });

for (const [ad, ac, mod] of [
  ['Gizli (Developer mode)', (a: never) => { (a as { yerel: { gizliMod: boolean } }).yerel.gizliMod = true; }, 'gelistirici'],
  ['Yalnız bu bilgisayar (Business mode)', (a: never) => { (a as { yerel: { yalnizYerel: boolean; etkin: boolean } }).yerel.yalnizYerel = true; }, 'is'],
] as const) {
  test(`${ad}: uzun geçmişli sohbette "merhaba" yanıt alır; istek yuvaya sığar, araç ve araç notu yok`, async () => {
    process.env.FUBER_YEREL_TABAN = `http://127.0.0.1:${(sunucu.address() as { port: number }).port}`;
    ayarlariKaydet((a) => { a.mod = mod; ac(a as never); });
    try {
      const s = sohbetOlustur(ad, 'normal');
      for (let i = 0; i < 40; i++) mesajEkle(s, { rol: i % 2 ? 'assistant' : 'user', bloklar: [{ tur: 'metin', metin: uzun(1500) }] });
      const once = istekler.length;
      hatalar.length = 0;
      await yanitla(s, { metin: 'merhaba' });
      const tur = istekler.slice(once).filter((x) => ((x.govde.messages as { content: string }[]).at(-1)?.content ?? '').endsWith('merhaba'));
      assert.equal(tur.length, 1, 'tek sohbet çağrısı');
      assert.ok(tur[0].token <= YEREL_YUVA_TOKEN, `istek ${tur[0].token} token`);
      assert.equal(tur[0].govde.tools, undefined, 'araç yok');
      const sistem = String((tur[0].govde.messages as { content: string }[])[0].content);
      assert.ok(!sistem.includes('# ARAÇ NOTLARI') && !/hafiza_kaydet|tarayici_ac/.test(sistem), 'araç notu yok');
      assert.deepEqual(hatalar, [], 'hata yok');
      assert.equal(mesajlar(s).at(-1)?.metin, 'Merhaba Deniz!');
      await turSonrasiniBitir(2000);
    } finally { ayarlariKaydet((a) => { a.yerel.gizliMod = false; a.yerel.yalnizYerel = false; a.mod = 'gelistirici'; }); delete process.env.FUBER_YEREL_TABAN; }
  });
}

// Analiz 11 Kas bulgu 12: Gizli'de (bu bilgisayardaki model) görsel ve video karesi sessizce düşmez — "bu modelde resim okunmaz" notu sohbete
// düşer, modele yalnız metin (videoda konuşma yazısı) gider; uzun ek metni yerel sınırda AÇIKÇA kısaltılır ve istek yuvaya sığar.
test('Gizli: görsel + video eki — not düşer, istekte görsel yok, yalnız yazı; uzun ek kısaltılır ve yuvaya sığar', async () => {
  process.env.FUBER_YEREL_TABAN = `http://127.0.0.1:${(sunucu.address() as { port: number }).port}`;
  ayarlariKaydet((a) => { a.mod = 'gelistirici'; a.yerel.gizliMod = true; });
  try {
    const s = sohbetOlustur('gizli ek', 'normal');
    const once = istekler.length;
    hatalar.length = 0;
    const kare = { medya: 'image/jpeg', veri: Buffer.from('kare').toString('base64') };
    await yanitla(s, { metin: 'videoda ne var', gorseller: [kare, kare, kare, kare], ekler: [{ ad: 'toplanti.mp4', tur: 'video', metin: `Video: toplanti.mp4\nKonuşma yazısı (bu bilgisayarda yazıya döküldü):\n[0:00] ${uzun(20_000)}`, kareSayisi: 4 }] });
    const tur = istekler.slice(once).filter((x) => /videoda ne var/.test(JSON.stringify(x.govde.messages)));
    assert.equal(tur.length, 1, 'tek sohbet çağrısı');
    const son = (tur[0].govde.messages as { content: unknown }[]).at(-1)!;
    assert.equal(typeof son.content, 'string', 'yerel isteğe görsel parçası gitmez (düz metin)');
    assert.match(String(son.content), /<ek ad="toplanti.mp4" tur="video" kare="4">/);
    assert.match(String(son.content), /ek kısaltıldı: 3\.000 \//);
    assert.ok(tur[0].token <= YEREL_YUVA_TOKEN, `istek ${tur[0].token} token`);
    const notlar = mesajlar(s).filter((m) => m.rol === 'not').map((m) => m.metin);
    assert.ok(notlar.some((n) => /Bu modelde resim okunmaz: videonun kareleri gönderilmedi, yalnız konuşma yazısı gitti\./.test(n) && /ilk 3\.000 karakteri/.test(n)), JSON.stringify(notlar));
    assert.deepEqual(hatalar, [], 'hata yok');
    await turSonrasiniBitir(2000);
  } finally { ayarlariKaydet((a) => { a.yerel.gizliMod = false; }); delete process.env.FUBER_YEREL_TABAN; }
});
