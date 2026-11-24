// 0.12 cila (H5 tur 2 kaygısı 2): "Yalnız bu bilgisayar" seçili ve bu bilgisayardaki yapay zekâ HAZIRLANIRKEN (iniyor ya da yarıda) yazılan
// ileti buluta gitmez, yanıt da gelmez; kayda bir not düşer. Eskiden bu not genel hata notu biçimindeydi ("⚠ Bu bilgisayardaki yapay
// zekâ iniyor — …") ve indirme durduktan/bittikten sonra da "Son sohbetler" önizlemesini işgal ediyordu. Artık:
//  · not sakin: ⚠ yok, kokpit satırının hazırlanma cümlesi (shared/abonelik.ts yalnizHazirlanmaMetni), kaynak 'hazirlik';
//  · önizleme bu notu atlar (shared/sohbet-gorunum.ts onizlemeDisiMi): sohbetin gerçek son iletisi görünür (yalnız notu olan yeni sohbette
//    önizleme boş kalır — hazırlanırken yazılan ileti, motor yokken her zamanki gibi kayda geçmez); hazır olunca yanıt görünür;
//  · sohbetteki geçici kırmızı satır kopyalanmaz (kalıcı not son mesaj);
//  · gerçek hata notları (⚠) değişmez.
// Düzeltme turu 1 (inceleme d): Gizli hazırlanırken de not sakin (kokpitin Gizli hazırlanma cümlesi; "hazır değil" değil) ve Beyin
// hazırlanmayı hata ("bir sorun oldu") saymaz.
// GERÇEK ajan döngüsü (ajan/dongu.ts yanitla) + sohbet deposu; yerel model hazır olunca sahte yerel sunucu (FUBER_YEREL_TABAN, 127.0.0.1).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';

const yerelSunucu = http.createServer(async (q, r) => {
  let h = '';
  for await (const d of q) h += d;
  const sistem = String((JSON.parse(h || '{}').messages ?? [])[0]?.content ?? '');
  const content = /hafıza yazıcısısın/.test(sistem) ? '{"islemler":[]}' : /"selamlama"/.test(sistem) ? '{"selamlama":"Merhaba","odak":"","kartlar":[]}' : /başlık/.test(sistem) ? 'Deneme' : 'Hazırım Deniz, buradayım.';
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise<void>((c) => yerelSunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => yerelSunucu.close(() => c())));

anaSurecSahnesi('hazirlanma-notu', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false,
  // Yerel kurulu değil, istenmiş kurulumun kaydı var (hatasız): "hazırlanıyor" — hiçbir şey inmediği için "yarıda kaldı" dalı.
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
const { yalnizHazirlik } = await import('../src/main/abonelik.ts');
const { yanitla, turSonrasiniBitir } = await import('../src/main/ajan/dongu.ts');
const { hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { sohbetOlustur, sohbetListesi, mesajlar, gorunenMesajlar, mesajEkle } = await import('../src/main/sohbet.ts');
const { herOlayiDinle } = await import('../src/main/olaylar.ts');
const abonelik = await import('../src/shared/abonelik.ts') as Record<string, unknown> & typeof import('../src/shared/abonelik.ts');
const { yalnizHazirlanmaMetni } = abonelik;
const { geciciHataGosterilsinMi } = await import('../src/shared/sohbet-hata.ts');
after(() => { delete process.env.FUBER_YEREL_TABAN; });

const hatalar: string[] = [];
const beyinBitenler: { hata: boolean; metin?: string }[] = [];
herOlayiDinle((kanal, veri) => {
  const v = veri as { tur?: string; mesaj?: unknown; bolge?: string; hata?: boolean; metin?: string };
  if (kanal === 'sohbet:olay' && v?.tur === 'hata') hatalar.push(String(v.mesaj));
  if (kanal === 'beyin:olay' && v?.tur === 'bitti' && v.bolge === 'ajan') beyinBitenler.push({ hata: Boolean(v.hata), metin: v.metin });
});
const onizleme = (id: number) => sohbetListesi().find((s) => s.id === id)?.sonMesaj;
const ILETI = 'Hazırlanırken yazıyorum; buluta gitmemeli.';

test('ön koşul: "Yalnız bu bilgisayar" seçili, yerel hazırlanıyor (yarıda) → yol yok', () => {
  assert.equal(tekMotorYolu(), 'yok');
  assert.equal(yalnizHazirlik(), 'yarim');
});

let sohbet = 0;
let yeniSohbet = 0;
const ONCEKI_YANIT = 'Sunum iyi geçti; iki soru not aldım.';
test('hazırlanırken yazılan ileti: kayda SAKİN not düşer — ⚠ yok, kokpitin hazırlanma cümlesi; geçici kırmızı satır kopyalanmaz', async () => {
  sohbet = sohbetOlustur();
  // Önceden konuşulmuş bir sohbet (yerel hazırken): son gerçek ileti Fuber'in yanıtı.
  mesajEkle(sohbet, { rol: 'user', bloklar: [{ tur: 'metin', metin: 'Dünkü sunum nasıldı?' }], kaynak: 'kullanici' });
  mesajEkle(sohbet, { rol: 'assistant', bloklar: [{ tur: 'metin', metin: ONCEKI_YANIT }] });
  const once = hatalar.length;
  assert.equal(await yanitla(sohbet, { metin: ILETI }), null, 'yanıt yok (buluta gitmez)');
  const son = mesajlar(sohbet).at(-1)!;
  const beklenen = yalnizHazirlanmaMetni('is', true);
  assert.equal(son.rol, 'not');
  assert.equal(son.metin, beklenen, 'not ⚠ öneksiz, hazırlanma cümlesi');
  assert.equal(son.kaynak, 'hazirlik');
  assert.doesNotMatch(son.metin, /⚠/);
  const hata = hatalar.slice(once).at(-1) ?? '';
  assert.equal(hata, beklenen, 'arayüze giden olay aynı cümle');
  assert.equal(geciciHataGosterilsinMi(hata, gorunenMesajlar(sohbet)), false, 'sohbette ikinci (kırmızı) satır çıkmaz');
  const b = beyinBitenler.at(-1);
  assert.deepEqual(b, { hata: false, metin: 'yapay zekâ hazırlanıyor' }, 'Beyin hazırlanmayı hata saymaz (düzeltme turu 1)');
});

test('önizleme notu atlar: "Son sohbetler"de sohbetin gerçek son iletisi görünür; yalnız notu olan yeni sohbette önizleme boş (not değil)', async () => {
  assert.equal(onizleme(sohbet), ONCEKI_YANIT);
  yeniSohbet = sohbetOlustur();
  await yanitla(yeniSohbet, { metin: ILETI });
  assert.equal(mesajlar(yeniSohbet).at(-1)?.kaynak, 'hazirlik');
  assert.equal(onizleme(yeniSohbet), undefined);
});

test('indirme bitince (yerel hazır): yanıt gelir ve önizleme yanıtı gösterir; eski not kayıtta sakin kalır', async () => {
  process.env.FUBER_YEREL_TABAN = `http://127.0.0.1:${(yerelSunucu.address() as { port: number }).port}`;
  ayarlariKaydet((a) => { a.yerel.etkin = true; delete a.yerel.bekleyenKurulum; });
  assert.equal(tekMotorYolu(), 'yerel');
  await yanitla(sohbet, { metin: 'Şimdi hazır mısın?' });
  await turSonrasiniBitir(6000);
  await hafizaYaziminiBekle();
  assert.equal(onizleme(sohbet), 'Hazırım Deniz, buradayım.');
  assert.equal(onizleme(yeniSohbet), undefined, 'not, indirme bittikten sonra da önizlemeye çıkmaz');
  assert.ok(mesajlar(sohbet).some((m) => m.rol === 'not' && m.kaynak === 'hazirlik' && !m.metin.includes('⚠')));
});

test('gerçek hata notları değişmez: motor yokken (Yalnız bu bilgisayar seçili değil) not ⚠ önekli ve önizlemede görünür', async () => {
  delete process.env.FUBER_YEREL_TABAN;
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; a.yerel.etkin = false; });
  assert.equal(tekMotorYolu(), 'yok');
  const s = sohbetOlustur();
  await yanitla(s, { metin: 'Merhaba' });
  const son = mesajlar(s).at(-1)!;
  assert.equal(son.rol, 'not');
  assert.match(son.metin, /^⚠ /);
  assert.notEqual(son.kaynak, 'hazirlik');
  assert.match(onizleme(s) ?? '', /^⚠ /);
});

test('Gizli hazırlanırken de not SAKİN (düzeltme turu 1, inceleme d): ⚠ yok, kokpitin Gizli hazırlanma cümlesi; önizlemeyi işgal etmez; Beyin hata saymaz', async () => {
  delete process.env.FUBER_YEREL_TABAN;
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; a.yerel.etkin = false; a.yerel.gizliMod = true; a.yerel.bekleyenKurulum = { model: 'bonsai2-4b', zaman: new Date().toISOString(), gizliMod: true }; });
  try {
    assert.equal(tekMotorYolu(), 'yok');
    const gizliMetni = abonelik.gizliHazirlanmaMetni as ((mod: 'is' | 'gelistirici', yarim: boolean) => string) | undefined;
    assert.equal(typeof gizliMetni, 'function', 'shared/abonelik.ts gizliHazirlanmaMetni');
    const beklenen = gizliMetni!('is', true);
    assert.equal(beklenen, 'Gizli mod hazırlanıyor — indirme yarıda kaldı; sürdürünce sohbet açılır.');
    const s = sohbetOlustur();
    mesajEkle(s, { rol: 'user', bloklar: [{ tur: 'metin', metin: 'Önceki soru' }], kaynak: 'kullanici', gizli: false });
    mesajEkle(s, { rol: 'assistant', bloklar: [{ tur: 'metin', metin: ONCEKI_YANIT }], gizli: false });
    const once = hatalar.length;
    assert.equal(await yanitla(s, { metin: 'Gizli hazırlanırken yazıyorum.' }), null);
    const son = mesajlar(s).at(-1)!;
    assert.equal(son.rol, 'not');
    assert.equal(son.metin, beklenen, 'not ⚠ öneksiz, "hazır değil" değil');
    assert.equal(son.kaynak, 'hazirlik');
    assert.equal(hatalar.slice(once).at(-1), beklenen, 'İş görünümü cümleyi aynen gösterir (gorunenMotorHatasi)');
    assert.equal(geciciHataGosterilsinMi(beklenen, gorunenMesajlar(s)), false);
    assert.equal(onizleme(s), ONCEKI_YANIT, 'önizleme notu atlar');
    assert.deepEqual(beyinBitenler.at(-1), { hata: false, metin: 'yapay zekâ hazırlanıyor' });
  } finally {
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; delete a.yerel.bekleyenKurulum; });
  }
});
