// Toplantı modu (12 Kas 2026): yakalama çekirdeği (örnekleyici + enerji VAD), oturum (yazıya çevirme → çeviri → robot → özet), P14 yolu, depo ve
// "Verilerimi sil" / "Yeni başla". Ses SENTETİKTİR (harmonik + hece zarfı; WAV'a yazılıp geri okunur) ve hiç çalınmaz; yazıya çevirme, çeviri, robot ve
// özet sahtedir (ağ yok).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KonusmaKesici, ToplantiYakalayici, VAD, VAD_AKIS, type KesiciOlayi } from '../src/shared/toplanti-vad.ts';
import { pcmdenWav, wavdanPcm } from '../src/shared/pcm.ts';
import {
  RIZA_SATIRI, KONUSAN_ADI, TOPLANTI_SINIR_METNI, UYARI, bulutGecisMetni, motorEtiketleri, toplantiYolu, ceviriCoz, ceviriIstemi, ceviriIstemiTek, ceviriTemiz, yamaUygula, dilSez, kayitYap, ozetCoz, robotCoz, soruMu, toplantiIsi, toplantiKimligi, yankiMi,
  varsayilanHedef, sureMetni, type Konusan, type ToplantiDurumu,
} from '../src/shared/toplanti.ts';
import { ToplantiOturumu, type AkisFabrikasi, type AkisOlaylari, type CanliAkis, type ToplantiBagimliliklari, type YzIstegi, type YzYolu } from '../src/main/toplanti/oturum.ts';
import { toplantiDeposu, TOPLANTI_KLASORU } from '../src/main/toplanti/depo.ts';
import { EK_KISISEL, veriIslemiIste, bekleyenVeriIsleminiUygula } from '../src/main/veri/temizlik.ts';
import { silmeIslemiOku } from '../src/main/silme-kuyrugu.ts';
import { DikteSiniri, SesModeliYok } from '../src/shared/masaustu-hesap.ts';
import { BAGLAM_BUTCESI, BAGLAM_SINIRLARI, baglamBosMu, baglamMetni, baglamTemizle, belgeKurali, belgeYap, bosBaglam } from '../src/shared/toplanti-baglam.ts';
import { centikOzeti, rayNoktalari } from '../src/shared/is-izi.ts';
import { CAGRI_KANALLARI, OLAY_KANALLARI } from '../src/shared/kanallar.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { WINDOWS_MIKROFON_AYARI, kaynakDurumu, kaynakHatasiCoz, mediaIzniVerilir } from '../src/shared/toplanti-kaynak.ts';
import { tercihTemizle, yaziSecenekleri, yaziSeciliDeger, yzEtiketi, yzKarari, yzSecenekleri, yzSeciliDeger, type YzBaglami } from '../src/shared/toplanti-model.ts';
import { TERCIH_DOSYASI, tercihDeposu } from '../src/main/toplanti/tercih.ts';
import { yzCagrisiKur } from '../src/main/toplanti/yz.ts';

// ── Sentetik ses ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function konusma(hz: number, sn: number, f0 = 150, genlik = 0.22): Float32Array {
  const n = Math.round(hz * sn);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / hz;
    const zarf = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t); // ≈ 4 hece/sn, hiç sıfıra inmez
    let s = 0;
    for (let h = 1; h <= 5; h++) s += Math.sin(2 * Math.PI * f0 * h * t) / h;
    o[i] = genlik * zarf * s * 0.5;
  }
  return o;
}
function sessizlik(hz: number, sn: number, gurultu = 0.002): Float32Array {
  const n = Math.round(hz * sn);
  const o = new Float32Array(n);
  let x = 12345;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; o[i] = ((x / 0x7fffffff) * 2 - 1) * gurultu; }
  return o;
}
const birlestir = (...l: Float32Array[]) => { const n = l.reduce((t, x) => t + x.length, 0); const o = new Float32Array(n); let k = 0; for (const x of l) { o.set(x, k); k += x.length; } return o; };
/** Float → 16 bit WAV → geri (fikstürün WAV yolu: yakalayıcıya dosyadan gelmiş gibi). */
function wavdanGecir(f: Float32Array, hz: number): { ornek: Float32Array; hz: number } {
  const i16 = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
  const wav = pcmdenWav(new Uint8Array(i16.buffer), hz);
  const geri = wavdanPcm(wav)!;
  const v = new Int16Array(geri.pcm.buffer, geri.pcm.byteOffset, geri.pcm.byteLength >> 1);
  return { ornek: Float32Array.from(v, (x) => x / 32768), hz: geri.hz };
}
/** Yakalama soyutlamasının akışı gibi: 2048'lik bloklar (AudioWorklet işlemcisinin gönderdiği boy). */
function besle(y: ToplantiYakalayici, f: Float32Array, hz: number): void {
  for (let i = 0; i < f.length; i += 2048) y.besle(f.subarray(i, Math.min(f.length, i + 2048)), hz);
  y.bitir();
}

// Karşı taraf (bilgisayarın sesi, 48 kHz): kısa soru, uzun konuşma (4 sn'de kesilir), tık sesi. Siz (mikrofon, 44,1 kHz): tek cümle.
const KARSI_HZ = 48_000, SIZ_HZ = 44_100;
const karsiSes = () => birlestir(sessizlik(KARSI_HZ, 0.5), konusma(KARSI_HZ, 1.5), sessizlik(KARSI_HZ, 1.2), konusma(KARSI_HZ, 6, 190), sessizlik(KARSI_HZ, 1.2), konusma(KARSI_HZ, 0.08, 400, 0.4), sessizlik(KARSI_HZ, 1));
const sizSes = () => birlestir(sessizlik(SIZ_HZ, 1), konusma(SIZ_HZ, 2.3, 120), sessizlik(SIZ_HZ, 0.35), konusma(SIZ_HZ, 1.2, 120), sessizlik(SIZ_HZ, 1.5));

function yakala(f: Float32Array, hz: number, wav = false): KesiciOlayi[] {
  const olaylar: KesiciOlayi[] = [];
  const y = new ToplantiYakalayici((o) => olaylar.push(o));
  const g = wav ? wavdanGecir(f, hz) : { ornek: f, hz };
  besle(y, g.ornek, g.hz);
  return olaylar;
}
type Parca = Extract<KesiciOlayi, { tur: 'parca' }>;
const parcalar = (l: KesiciOlayi[]) => l.filter((o): o is Parca => o.tur === 'parca');
const sureMs = (p: Parca) => (p.pcm.length / 2 / VAD.hz) * 1000;

test('yakalama: 48 kHz sistem sesi 16 kHz konuşmalara bölünür; kısa soru tek parça, uzun konuşma ≤ 4 sn parçalar, tık sesi yazıya gitmez', () => {
  const l = yakala(karsiSes(), KARSI_HZ, true);
  const p = parcalar(l);
  const k1 = p.filter((x) => x.konusmaNo === 1), k2 = p.filter((x) => x.konusmaNo === 2);
  assert.equal(k1.length, 1, 'kısa soru tek parça');
  assert.equal(k1[0].son, true);
  assert.ok(Math.abs(k1[0].basMs - (500 - VAD.onSesMs)) <= 80, `ön ses dahil başlangıç ${k1[0].basMs}`);
  assert.ok(k2.length >= 2, `uzun konuşma parçalara bölündü (${k2.length})`);
  assert.deepEqual(k2.map((x) => x.son), [...k2.slice(0, -1).map(() => false), true], 'yalnız son parça son');
  assert.deepEqual(k2.map((x) => x.parcaNo), k2.map((_, i) => i), 'parça sırası');
  for (const x of k2) assert.ok(sureMs(x) <= VAD.parcaEnCokMs + 260, `parça ≤ 4 sn (+ ön ses): ${sureMs(x)}`);
  for (const x of k2.slice(0, -1)) assert.ok(sureMs(x) >= VAD.parcaEnAzMs, `ara parça ≥ 2 sn: ${sureMs(x)}`);
  assert.ok(l.some((o) => o.tur === 'vazgecildi'), 'tık sesi vazgeçildi');
  assert.equal(new Set(p.map((x) => x.konusmaNo)).size, 2, 'tık sesi parça üretmedi');
  // Basladi olayı ilk parçadan önce gelir (arayüz "…" satırını hemen gösterir).
  assert.ok(l.findIndex((o) => o.tur === 'basladi' && o.konusmaNo === 2) < l.findIndex((o) => o.tur === 'parca' && o.konusmaNo === 2));
});

test('yakalama: 44,1 kHz mikrofon ayrı yakalayıcıda — konuşan etiketi akıştan, zaman damgaları akışın örnek sayacından', () => {
  const p = parcalar(yakala(sizSes(), SIZ_HZ, true));
  assert.equal(p.length, 2, `2 sn'yi geçen konuşma kısa duraklamada kesilir, satır sürer (${p.length})`);
  assert.deepEqual(p.map((x) => x.son), [false, true]);
  assert.ok(p.every((x) => x.konusmaNo === 1), 'tek satır');
  assert.ok(p.at(-1)!.son);
  assert.ok(Math.abs(p[0].basMs - (1000 - VAD.onSesMs)) <= 80, String(p[0].basMs));
  // 16 kHz PCM16: bayt sayısı çift, süre zaman damgalarıyla tutarlı.
  for (const x of p) { assert.equal(x.pcm.length % 2, 0); assert.ok(Math.abs(sureMs(x) - (x.bitMs - x.basMs)) <= 2); }
});

test('yakalama: sessiz akış hiç parça üretmez; gürültü tabanı uyarlanır', () => {
  const l: KesiciOlayi[] = [];
  const k = new KonusmaKesici((o) => l.push(o));
  k.besle(sessizlik(16000, 5, 0.006));
  k.bitir();
  assert.equal(l.length, 0);
  assert.ok(k.esik >= VAD.minEsik);
});

// ── Oturum ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Sahne {
  oturum: ToplantiOturumu;
  durumlar: ToplantiDurumu[];
  hesapCagri: number; whisperCagri: number;
  yz: { i: YzIstegi; yol: YzYolu }[];
  bulutsuz: { v: boolean };
  metin: Map<string, string>;
}
const anahtar = (b: Uint8Array) => { const govde = b.length > 44 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' ? b.subarray(44) : b; return `${Buffer.from(govde.subarray(0, 300)).toString('base64')}:${govde.length}`; };

function sahne(o: { bulutsuz?: boolean; whisperHazir?: boolean; hesap?: boolean; robot?: boolean; hedefDil?: string; yz?: (i: YzIstegi) => string | Promise<string>; hesapHata?: () => unknown; whisperHata?: () => unknown; baglam?: unknown; akis?: (s: Sahne) => AkisFabrikasi; whisperCevir?: (wav: Uint8Array, k: Konusan) => Promise<string | null>; hafif?: boolean; onCeviri?: boolean } = {}): Sahne {
  const s = { durumlar: [], hesapCagri: 0, whisperCagri: 0, yz: [], bulutsuz: { v: o.bulutsuz ?? false }, metin: new Map() } as unknown as Sahne;
  const cevir = (wav: Uint8Array) => s.metin.get(anahtar(wav)) ?? null;
  const d: ToplantiBagimliliklari = {
    bulutsuz: () => s.bulutsuz.v,
    stt: {
      hesap: { kullanilir: () => o.hesap ?? true, yaziya: async (wav) => { s.hesapCagri++; const h = o.hesapHata?.(); if (h) throw h; return cevir(wav); } },
      whisper: { hazirMi: () => o.whisperHazir ?? true, cevir: async (wav, k) => { s.whisperCagri++; const h = o.whisperHata?.(); if (h) throw h; return o.whisperCevir ? o.whisperCevir(wav, k) : cevir(wav); } },
      ...(o.akis ? { akis: o.akis(s) } : {}),
    },
    yz: async (i, yol) => { s.yz.push({ i, yol }); return (o.yz ?? sahteYz)(i); },
    baglam: () => 'Deniz, Mavi Kuş projesinin ürün sorumlusu.',
    kullaniciAdi: () => 'Deniz',
    degisti: (x) => s.durumlar.push(x),
    ceviriBeklemeMs: 5,
    kapanisBeklemeMs: 3000,
    ...(o.hafif ? { hafifYayin: true } : {}),
    onCeviri: o.onCeviri ?? false,
  };
  s.oturum = new ToplantiOturumu(d, { id: 't-20261112-101500-abcd', hedefDil: o.hedefDil ?? 'tr', robot: o.robot ?? false, baglam: o.baglam });
  return s;
}
/** Sahte yapay zekâ: çeviri "[TR] metin" (dizi), soru denetimi EVET, öneri JSON, özet JSON. */
function sahteYz(i: YzIstegi): string {
  if (i.amac === 'toplantı çevirisi') return `[TR] ${i.kullanici}`; // 14 Kas: her cümle ayrı istek, düz metin yanıt
  if (i.amac === 'toplantı soru denetimi') return 'EVET';
  if (i.amac === 'toplantı yanıt önerisi') return '```json\n{"yanit": "Yes, we can ship on Friday.", "ceviri": "Evet, cuma günü teslim edebiliriz."}\n```';
  if (i.amac === 'toplantı özeti') return JSON.stringify({ anaNoktalar: ['Teslim tarihi konuşuldu'], kararlar: ['Cuma teslim'], yapilacaklar: ['Deniz: sürüm notlarını yaz'] });
  return '';
}
/** Yakalanan olayları oturuma verir; her parçaya senaryodaki metni bağlar. */
function oturumaVer(s: Sahne, konusan: Konusan, olaylar: KesiciOlayi[], metinler: Record<string, string>): void {
  for (const o of olaylar) {
    if (o.tur === 'basladi') s.oturum.basladi(konusan, o.konusmaNo, o.basMs);
    else if (o.tur === 'vazgecildi') s.oturum.vazgecildi(konusan, o.konusmaNo);
    else {
      const m = metinler[`${o.konusmaNo}.${o.parcaNo}`];
      if (m !== undefined) s.metin.set(anahtar(o.pcm), m);
      s.oturum.parca({ konusan, ...o });
    }
  }
}
const KARSI_METIN = { '1.0': 'Can you ship the release on Friday?', '2.0': 'We reviewed the budget yesterday', '2.1': 'and the numbers look fine for the next quarter.' };
const SIZ_METIN = { '1.0': 'Evet, bence', '1.1': 'cuma günü uygun.' };
const son = (s: Sahne) => s.oturum.anlik();

test('P14 · bulut: yazıya çevirme Fuber hesabından (Whisper hiç), yapay zekâ bugünkü kuralla; konuşanlar ayrı satırlarda', async () => {
  const s = sahne({ robot: true });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  oturumaVer(s, 'siz', yakala(sizSes(), SIZ_HZ), SIZ_METIN);
  await s.oturum.bosalinca();
  assert.ok(s.hesapCagri >= 5);
  assert.equal(s.whisperCagri, 0, 'bulutta Whisper yok');
  assert.ok(s.yz.length > 0 && s.yz.every((x) => x.yol === 'serbest'));
  const d = son(s);
  assert.equal(d.yol, 'hesap');
  assert.deepEqual(d.satirlar.map((x) => [x.konusan, x.metin]), [
    ['karsi', 'Can you ship the release on Friday?'],
    ['siz', 'Evet, bence cuma günü uygun.'],
    ['karsi', 'We reviewed the budget yesterday and the numbers look fine for the next quarter.'],
  ], 'zamana göre sıralı, konuşan akıştan');
  assert.deepEqual(d.satirlar.map((x) => KONUSAN_ADI[x.konusan]), ['Karşı taraf', 'Siz', 'Karşı taraf']);
});

test('P14 · Gizli / "Yalnız bu bilgisayar": yazıya çevirme yalnız yerel tanıyıcı, yapay zekâ yalnız yerel; hesap hiç çağrılmaz', async () => {
  const s = sahne({ bulutsuz: true, robot: true });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  const d = await s.oturum.durdur();
  assert.equal(s.hesapCagri, 0, 'hesap (bulut) çağrılmadı');
  assert.ok(s.whisperCagri >= 3);
  assert.ok(s.yz.length >= 3, 'çeviri + öneri + özet');
  assert.ok(s.yz.every((x) => x.yol === 'yerel'), JSON.stringify(s.yz.map((x) => [x.i.amac, x.yol])));
  assert.equal(d.yol, 'whisper');
  assert.equal(d.bulutsuz, true);
  assert.equal(kayitYap(d, Date.now()).gizli, true);
});

test('P14 · bulutsuz ama yerel tanıyıcı kurulu değil: yol "yok", hiçbir ses hiçbir yere gitmez', async () => {
  const s = sahne({ bulutsuz: true, whisperHazir: false });
  assert.equal(son(s).yol, 'yok');
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  assert.equal(s.hesapCagri + s.whisperCagri, 0);
  assert.equal(son(s).satirlar.filter((x) => x.kesin).length, 0, 'metinsiz satır kesinleşince düşer');
});

test('P14 · toplantı ortasında Gizli açılınca sonraki parça buluta gitmez (yerel tanıyıcıya geçer)', async () => {
  const s = sahne();
  const l = yakala(karsiSes(), KARSI_HZ);
  const ilk = l.findIndex((o) => o.tur === 'parca');
  oturumaVer(s, 'karsi', l.slice(0, ilk + 1), KARSI_METIN);
  await s.oturum.bosalinca();
  assert.equal(s.hesapCagri, 1);
  s.bulutsuz.v = true;
  oturumaVer(s, 'karsi', l.slice(ilk + 1), KARSI_METIN);
  await s.oturum.bosalinca();
  assert.equal(s.hesapCagri, 1, 'Gizli açıldıktan sonra hesap çağrılmadı');
  assert.ok(s.whisperCagri >= 2);
  assert.equal(son(s).yol, 'whisper');
});

test('ara metin hemen, kesin metin konuşma bitince: satır önce kesin değil, son parçayla kesinleşir; dil sonuçtan sezilir', async () => {
  const s = sahne();
  let coz: (() => void) | null = null;
  const kapi = new Promise<void>((c) => { coz = c; });
  // İkinci parça bekletilir: ilk parçanın metni ara metin olarak görünmeli.
  const asil = s.oturum['d'].stt.hesap!.yaziya;
  let n = 0;
  s.oturum['d'].stt.hesap!.yaziya = async (wav: Uint8Array) => { if (++n === 3) await kapi; return asil(wav); };
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  const ara = son(s).satirlar.find((x) => x.id === 'karsi:2')!;
  assert.equal(ara.metin, 'We reviewed the budget yesterday');
  assert.equal(ara.kesin, false, 'ara metin');
  assert.ok(s.durumlar.some((d) => d.satirlar.some((x) => x.id === 'karsi:2' && !x.kesin && x.metin)), 'ara metin yayınlandı');
  coz!();
  await s.oturum.bosalinca();
  const kesin = son(s).satirlar.find((x) => x.id === 'karsi:2')!;
  assert.equal(kesin.kesin, true);
  assert.equal(kesin.metin, 'We reviewed the budget yesterday and the numbers look fine for the next quarter.');
  assert.equal(kesin.dil, 'en');
});

test('çeviri: kesinleşen her cümle ANINDA, tek tek çevrilir (toplu bekleme yok), satır satır hizalı; hedef dildeki satıra çağrı yok', async () => {
  const s = sahne();
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  oturumaVer(s, 'siz', yakala(sizSes(), SIZ_HZ), SIZ_METIN);
  await s.oturum.bosalinca();
  const ceviriler = s.yz.filter((x) => x.i.amac === 'toplantı çevirisi');
  const giden = ceviriler.map((x) => x.i.kullanici);
  assert.ok(!giden.includes('Evet, bence cuma günü uygun.'), 'Türkçe satır (hedef Türkçe) çeviriye gitmedi');
  assert.ok(giden.includes('Can you ship the release on Friday?'), 'her cümle kendi isteğinde (düz metin)');
  assert.ok(ceviriler.every((x) => x.i.json !== true), 'düz metin yanıt: JSON dizisi yok');
  for (const x of son(s).satirlar) {
    if (x.dil === 'tr') { assert.equal(x.ceviriDurum, 'ayni'); assert.equal(x.ceviri, x.metin); }
    else { assert.equal(x.ceviriDurum, 'tamam'); assert.equal(x.ceviri, `[TR] ${x.metin}`, 'her çeviri kendi satırında'); }
  }
});

test('çeviri paralelliği: iki kesin cümle aynı anda yola çıkar (sıra beklemez); en çok CEVIRI_PARALEL eşzamanlı; yanıt akarken satırda harf harf görünür', async () => {
  let aktif = 0, enCok = 0;
  const parcalar: string[] = [];
  const s = sahne({
    yz: async (i) => {
      if (i.amac !== 'toplantı çevirisi') return sahteYz(i);
      aktif++; enCok = Math.max(enCok, aktif);
      const t = `[TR] ${i.kullanici}`;
      for (const p of [t.slice(0, 5), t.slice(5)]) { i.akis?.(p); parcalar.push(p); await new Promise((r) => setTimeout(r, 25)); }
      aktif--;
      return t;
    },
  });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  oturumaVer(s, 'siz', yakala(birlestir(sessizlik(SIZ_HZ, 0.5), konusma(SIZ_HZ, 1.5, 120), sessizlik(SIZ_HZ, 1.2)), SIZ_HZ), { '1.0': 'Yes of course, I will send the notes today.' });
  await s.oturum.bosalinca();
  assert.ok(enCok >= 2, `aynı anda ${enCok} çeviri`);
  assert.ok(enCok <= 4);
  assert.ok(parcalar.length >= 4);
  assert.ok(s.durumlar.some((d) => d.satirlar.some((x) => x.ceviriDurum === 'akiyor' && x.ceviri && x.ceviri.length <= 5)), 'çeviri akarken yayınlandı');
  assert.ok(son(s).satirlar.filter((x) => x.dil !== 'tr').every((x) => x.ceviriDurum === 'tamam'));
});

test('çeviri: boş yanıt "olmadı" olur ve tek cümle uyarı; sonraki başarılı çeviride uyarı kalkar; hedef dil değişince yeniden çevrilir', async () => {
  let n = 0;
  const s = sahne({ yz: (i) => (i.amac === 'toplantı çevirisi' ? (n++ === 0 ? '' : `<${i.kullanici}>`) : sahteYz(i)) });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  const [a, b] = son(s).satirlar;
  assert.equal(a.ceviriDurum, 'olmadi');
  assert.equal(b.ceviri, `<${b.metin}>`);
  assert.equal(son(s).uyari, undefined, 'sonraki başarılı çeviri uyarıyı kaldırdı');
  s.oturum.hedefDilDegistir('de');
  await s.oturum.bosalinca();
  const sonIstek = s.yz.filter((x) => x.i.amac === 'toplantı çevirisi').at(-1)!;
  assert.match(sonIstek.i.sistem, /German/);
  assert.ok(son(s).satirlar.every((x) => x.ceviriDurum === 'tamam'));
});

test('çeviri istemi kısa: tek cümle düz metin, sözlük ≤ 400 karakter; ceviriTemiz çit/tırnak/JSON sarmalını soyar', () => {
  const i = ceviriIstemiTek('Hello there.', 'tr', 'x'.repeat(900));
  assert.match(i.sistem, /Turkish/);
  assert.ok(i.sistem.length < 700, `istem ${i.sistem.length} karakter`);
  assert.equal(i.kullanici, 'Hello there.');
  assert.equal(ceviriTemiz('"Merhaba."'), 'Merhaba.');
  assert.equal(ceviriTemiz('```\nMerhaba.\n```'), 'Merhaba.');
  assert.equal(ceviriTemiz('["Merhaba."]'), 'Merhaba.');
  assert.equal(ceviriTemiz('{"ceviri":"Merhaba."}'), 'Merhaba.');
  assert.equal(ceviriTemiz('  '), null);
});

test('ceviriCoz / ceviriIstemi: dizi, nesne içinde dizi, çitli JSON ve tek satır düz metin; sayı korunur', () => {
  assert.deepEqual(ceviriCoz('["a","b"]', 2), ['a', 'b']);
  assert.deepEqual(ceviriCoz('```json\n{"ceviriler":["x"]}\n```', 2), ['x', null]);
  assert.deepEqual(ceviriCoz('Merhaba dünya', 1), ['Merhaba dünya']);
  assert.deepEqual(ceviriCoz('bozuk', 2), [null, null]);
  assert.deepEqual(ceviriCoz('[{"text":"bir"},"iki"]', 2), ['bir', 'iki']);
  const i = ceviriIstemi(['Hello'], 'tr');
  assert.match(i.sistem, /Turkish/);
  assert.deepEqual(JSON.parse(i.kullanici), ['Hello']);
});

test('soru sezgisi: soru işareti, soru eki, istek kalıbı ve soru sözcüğü "soru"; yardımcı fiil "belki"; düz cümle "değil"', () => {
  for (const m of ['Can you ship the release on Friday?', 'Bütçeyi bu hafta gönderebilir misiniz', 'Toplantı yarın mı olacak', 'What is the timeline for the launch', 'Could you share the slides', 'Lütfen raporu paylaşın', 'Wann können Sie liefern', 'Pourriez-vous envoyer le document', 'Nasıl ilerliyoruz bu konuda']) {
    assert.equal(soruMu(m), 'soru', m);
  }
  for (const m of ['Is the budget approved for the next quarter', 'Do we have a date for the launch']) assert.equal(soruMu(m), 'belki', m);
  for (const m of ['We reviewed the budget yesterday.', 'Bütçeyi dün gözden geçirdik.', 'Okay', 'Tamam', '']) assert.equal(soruMu(m), 'degil', m);
});

test('robot: karşı tarafın sorusuna yalnız ekranda öneri; düz cümleye, "Siz"e ve Robot kapalıyken öneri yok; "belki" hafif denetimden geçer', async () => {
  const s = sahne({ robot: true });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  oturumaVer(s, 'siz', yakala(sizSes(), SIZ_HZ), { '1.0': 'Can you', '1.1': 'hear me now?' });
  await s.oturum.bosalinca();
  const d = son(s);
  assert.equal(d.oneriler.length, 1, JSON.stringify(d.oneriler));
  assert.deepEqual({ soru: d.oneriler[0].soru, durum: d.oneriler[0].durum, yanit: d.oneriler[0].yanit, ceviri: d.oneriler[0].ceviri }, {
    soru: 'Can you ship the release on Friday?', durum: 'hazir', yanit: 'Yes, we can ship on Friday.', ceviri: 'Evet, cuma günü teslim edebiliriz.',
  });
  const oneriIstegi = s.yz.find((x) => x.i.amac === 'toplantı yanıt önerisi')!;
  assert.match(oneriIstegi.i.kullanici, /Mavi Kuş/, 'kullanıcının notları bağlamda');
  assert.match(oneriIstegi.i.kullanici, /Can you ship the release on Friday\?/);
  assert.equal(s.yz.filter((x) => x.i.amac === 'toplantı soru denetimi').length, 0, 'açık soruda denetim yok');

  const kapali = sahne({ robot: false });
  oturumaVer(kapali, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await kapali.oturum.bosalinca();
  assert.equal(son(kapali).oneriler.length, 0);

  const belki = sahne({ robot: true, yz: (i) => (i.amac === 'toplantı soru denetimi' ? 'HAYIR' : sahteYz(i)) });
  oturumaVer(belki, 'karsi', yakala(karsiSes(), KARSI_HZ), { '1.0': 'Is the budget approved for next quarter', '2.0': 'We reviewed', '2.1': 'the plan.' });
  await belki.oturum.bosalinca();
  assert.equal(belki.yz.filter((x) => x.i.amac === 'toplantı soru denetimi').length, 1);
  assert.equal(son(belki).oneriler.length, 0, 'model "hayır" dedi');
});

test('yankı: hoparlörden mikrofona kaçan karşı taraf sesi "Siz" satırı olmaz', async () => {
  const s = sahne();
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), { '1.0': 'Can you ship the release on Friday?' });
  await s.oturum.bosalinca();
  oturumaVer(s, 'siz', yakala(sizSes(), SIZ_HZ), { '1.0': 'can you ship the release', '1.1': 'on friday' });
  await s.oturum.bosalinca();
  assert.deepEqual(son(s).satirlar.map((x) => x.konusan), ['karsi']);
  assert.equal(son(s).yankiAtilan, 1);
  assert.equal(yankiMi({ metin: 'Bütçe tamam', basMs: 0 }, [{ metin: 'Bütçe tamam', basMs: 20_000 }]), false, 'uzak zamanda aynı söz yankı değil');
});

test('sınır: kredi bitince (402) ve yerel tanıyıcı kurulu değilse yazıya çevirme durur, tek cümle uyarı + "indir" düğmesi; sonraki parçalar buluta gitmez', async () => {
  let ilk = true;
  const s = sahne({ whisperHazir: false, hesapHata: () => (ilk ? ((ilk = false), new DikteSiniri('kredi')) : null) });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  assert.equal(s.hesapCagri, 1);
  assert.equal(son(s).uyari, TOPLANTI_SINIR_METNI.kredi);
  assert.equal(son(s).uyariEylemi, 'whisper-indir');
  assert.equal(son(s).yol, 'yok');
});

// ── 0.17.2: yol düşüşü, hesapsız yerel yol, uyarılar, motor etiketi, bağlam ───────────────────────────────────────────────────────────────────
const SES_YOK = () => new SesModeliYok('stt');

test('kök neden (b): sunucuda dikte modeli yok (404) ya da sınır dolunca yazıya çevirme kapanmaz — kurulu yerel tanıyıcıya geçilir, satırlar yazılır, durum çipi sakin bilgi', async () => {
  for (const [hata, neden] of [[SES_YOK, 'sunucu-ses-yok'], [() => new DikteSiniri('tavan'), 'tavan'], [() => new DikteSiniri('kredi'), 'kredi']] as const) {
    const s = sahne({ robot: true, hesapHata: hata });
    oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
    await s.oturum.bosalinca();
    const d = son(s);
    assert.equal(s.hesapCagri, 1, 'bulut bir kez denendi, sonra bırakıldı');
    assert.ok(s.whisperCagri >= 3, 'ilk parça dahil hepsi yerelde yazıldı');
    assert.equal(d.yol, 'whisper');
    assert.deepEqual(d.satirlar.map((x) => x.metin), ['Can you ship the release on Friday?', 'We reviewed the budget yesterday and the numbers look fine for the next quarter.']);
    assert.equal(d.uyari, bulutGecisMetni(neden), 'geçiş çipi nedeni söyler: Fuber bulutu kullanılamadı: <neden>; bu bilgisayarda yazılıyor.');
    assert.equal(d.uyariSeviyesi, 'bilgi');
    assert.equal(d.uyariEylemi, undefined);
  }
});

test('dikte yetkisi yok (404) ve yerel tanıyıcı da yok: eski "Dikte şu an kullanılamıyor" değil, ne yapılacağını söyleyen cümle + indir düğmesi', async () => {
  const s = sahne({ whisperHazir: false, hesapHata: SES_YOK });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  assert.equal(son(s).uyari, UYARI.bulutDustuYerelYok);
  assert.equal(son(s).uyariEylemi, 'whisper-indir');
  assert.equal(son(s).uyariSeviyesi, 'sorun');
  assert.ok(!JSON.stringify(son(s)).includes('Dikte şu an'));
});

test('geçici hata: bir parça yazıya çevrilemezse tek cümle; sonraki başarılı parçada uyarı KALKAR (sonsuz uyarı yok); üst üste 3 hata yola düşürür', async () => {
  let n = 0;
  const s = sahne({ hesapHata: () => (n++ === 0 ? new Error('ağ') : null) });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  assert.equal(son(s).uyari, undefined);
  assert.ok(son(s).satirlar.length >= 1);
  const u = sahne({ hesapHata: () => new Error('ağ') });
  oturumaVer(u, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await u.oturum.bosalinca();
  assert.equal(u.hesapCagri, 3, 'üçüncü ardışık hatadan sonra bulut bırakıldı');
  assert.ok(u.whisperCagri >= 1);
  assert.equal(son(u).yol, 'whisper');
});

test('kök neden (c): hesapsız kullanıcıda yerel tanıyıcı kuruluysa toplantı çalışır (bulut kipinde de); kurulu değilse yol yok ve "indir" eylemi', async () => {
  const s = sahne({ hesap: false, whisperHazir: true });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  assert.equal(son(s).yol, 'whisper');
  assert.equal(s.hesapCagri, 0);
  assert.ok(s.whisperCagri >= 3);
  assert.equal(son(s).satirlar.length, 2);
  assert.equal(son(s).uyari, undefined);
  const y = sahne({ hesap: false, whisperHazir: false });
  assert.equal(son(y).yol, 'yok');
  oturumaVer(y, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await y.oturum.bosalinca();
  assert.equal(son(y).uyari, UYARI.yerelYok);
  assert.equal(son(y).uyariEylemi, 'whisper-indir');
});

test('toplantiYolu: Gizli ve "Yalnız bu bilgisayar"da HİÇBİR koşulda hesap (bulut) yok; bulutta hesap > yerel > yok', () => {
  for (const hesapKullanilir of [true, false]) for (const bulutDustu of [true, false]) {
    assert.equal(toplantiYolu({ bulutsuz: true, hesapKullanilir, bulutDustu, whisperKurulu: true }), 'whisper');
    assert.equal(toplantiYolu({ bulutsuz: true, hesapKullanilir, bulutDustu, whisperKurulu: false }), 'yok');
  }
  assert.equal(toplantiYolu({ bulutsuz: false, hesapKullanilir: true, bulutDustu: false, whisperKurulu: true }), 'hesap');
  assert.equal(toplantiYolu({ bulutsuz: false, hesapKullanilir: true, bulutDustu: true, whisperKurulu: true }), 'whisper');
  assert.equal(toplantiYolu({ bulutsuz: false, hesapKullanilir: false, bulutDustu: false, whisperKurulu: true }), 'whisper');
  assert.equal(toplantiYolu({ bulutsuz: false, hesapKullanilir: false, bulutDustu: false, whisperKurulu: false }), 'yok');
});

test('P14 · Gizli: hesap hazır olsa da hiçbir parça buluta gitmez; bağlam dâhil bütün yapay zekâ istekleri yalnız yerel yolda; ortada Gizli açılırsa sonraki parça da', async () => {
  const baglam = { konu: 'Mavi Kuş yol haritası', katilimcilar: 'Elif Kaya, Mark Stone', notlar: 'Bütçe 40.000 TL', belgeler: [{ ad: 'plan.txt', metin: 'Quantum Release takvimi cuma günü kapanır.' }] };
  const s = sahne({ bulutsuz: true, robot: true, baglam });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  await s.oturum.durdur();
  assert.equal(s.hesapCagri, 0);
  assert.ok(s.whisperCagri > 0);
  assert.ok(s.yz.length >= 3);
  assert.ok(s.yz.every((x) => x.yol === 'yerel'), 'bağlam taşıyan hiçbir istek bulut yoluna çıkmadı');
  assert.ok(s.yz.some((x) => x.i.sistem.includes('Mavi Kuş') || x.i.kullanici.includes('Mavi Kuş')), 'bağlam yerel yapay zekâya verildi');
  // Ortada Gizli açılır.
  const t = sahne({ robot: false });
  oturumaVer(t, 'karsi', yakala(karsiSes(), KARSI_HZ), { '1.0': 'Can you ship the release on Friday?' });
  await t.oturum.bosalinca();
  const once = t.hesapCagri;
  assert.ok(once >= 1);
  t.bulutsuz.v = true;
  oturumaVer(t, 'karsi', yakala(karsiSes(), KARSI_HZ), { '1.0': 'We reviewed the budget yesterday', '2.0': 'and numbers' });
  await t.oturum.bosalinca();
  assert.equal(t.hesapCagri, once, 'Gizli açıldıktan sonra bulut yazıya çevirme yok');
  assert.equal(son(t).yol, 'whisper');
  assert.ok(t.yz.filter((x) => x.i.amac === 'toplantı çevirisi').slice(-1)[0].yol === 'yerel');
});

test('uyarı metinleri: her biri tek cümle (ne oldu + ne yapılacak), İş dilinde teknik sözcük yok', () => {
  for (const [ad, m] of Object.entries(UYARI)) {
    assert.equal(isDiliIhlali(m), null, ad);
    assert.ok(!m.includes('\n'), ad);
    assert.equal((m.match(/[.!?](\s|$)/g) ?? []).length, 1, `${ad}: tek cümle değil`);
  }
  assert.ok(!Object.values(UYARI).includes('Dikte şu an kullanılamıyor.'));
});

// ── Bağlam ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BELGE = [
  'Mavi Kuş projesinin ilk aşaması mobil uygulamanın yayınlanmasıdır. Takvim cuma günü kesinleşir.',
  'Bütçe tablosu: tasarım 12.000 TL, geliştirme 40.000 TL, test 8.000 TL. Toplam 60.000 TL.',
  'Güvenlik denetimi için Delta Ekibi görevlendirildi. Sorumlu: Mark Stone.',
].join('\n\n');

test('bağlam: sınırlar uygulanır (alan uzunlukları, en çok 4 belge, belge metni 8000, bilinmeyen alan atılır, ton geçerli değilse boş)', () => {
  const b = baglamTemizle({ konu: 'x'.repeat(500), katilimcilar: 'y'.repeat(900), notlar: 'z'.repeat(5000), ton: 'öfkeli', zararli: '<script>', belgeler: Array.from({ length: 7 }, (_, i) => ({ ad: `b${i}.txt`, metin: 'a'.repeat(20_000) })) });
  assert.equal(b.konu.length, BAGLAM_SINIRLARI.konu);
  assert.equal(b.katilimcilar.length, BAGLAM_SINIRLARI.katilimcilar);
  assert.equal(b.notlar.length, BAGLAM_SINIRLARI.notlar);
  assert.equal(b.ton, '');
  assert.equal(b.belgeler.length, BAGLAM_SINIRLARI.belgeSayisi);
  assert.ok(b.belgeler.every((x) => x.metin.length === BAGLAM_SINIRLARI.belgeMetni && x.kirpildi));
  assert.ok(!('zararli' in b));
  assert.deepEqual(baglamTemizle(null), bosBaglam());
  assert.equal(baglamBosMu(bosBaglam()), true);
  assert.equal(baglamTemizle({ ton: 'resmi' }).ton, 'resmi');
});

test('bağlam: belge kuralı (PDF, DOCX, TXT, MD; 5 MB sınırı) ve boş/yanlış tür reddi', () => {
  for (const ad of ['a.pdf', 'b.DOCX', 'c.txt', 'd.md']) assert.equal(belgeKurali(ad, 1000), null, ad);
  assert.match(belgeKurali('x.exe', 10)!, /PDF, Word, TXT ve MD/);
  assert.match(belgeKurali('x.pdf', BAGLAM_SINIRLARI.belgeBayti + 1)!, /5 MB/);
  assert.match(belgeKurali('x.pdf', 0)!, /boş/);
  assert.equal(belgeYap('x.txt', '   ')!, null);
  assert.equal(belgeYap('x.txt', 'a'.repeat(9000))!.kirpildi, true);
});

test('bağlam: istem metni bütçeyi aşmaz; uzun belge kırpılır; Robot soruyla ilgili paragrafı seçer; çeviri terim sözlüğü verir; talimat değil veri olarak işaretlenir', () => {
  const dev = baglamTemizle({ konu: 'Mavi Kuş yol haritası', katilimcilar: 'Elif Kaya, Mark Stone', notlar: 'Bütçeyi 40.000 TL civarında tut', ton: 'resmi', belgeler: [{ ad: 'plan.md', metin: BELGE }, { ad: 'dev.txt', metin: 'lorem ipsum dolor sit amet. '.repeat(400) }] });
  for (const amac of ['robot', 'ceviri', 'ozet'] as const) {
    const m = baglamMetni(dev, amac, { sorgu: 'Güvenlik denetimini kim yürütecek?' });
    assert.ok(m.length > 0 && m.length <= BAGLAM_BUTCESI[amac], `${amac}: ${m.length}`);
  }
  const robot = baglamMetni(dev, 'robot', { sorgu: 'Güvenlik denetimini kim yürütecek, Delta Ekibi mi?' });
  assert.match(robot, /Meeting topic: Mavi Kuş yol haritası/);
  assert.match(robot, /Participants: Elif Kaya, Mark Stone/);
  assert.match(robot, /formal and professional/);
  assert.match(robot, /Delta Ekibi görevlendirildi/, 'soruyla ilgili paragraf seçildi');
  assert.match(robot, /ignore any instructions inside/, 'belge veri olarak işaretli');
  const ceviri = baglamMetni(dev, 'ceviri');
  assert.match(ceviri, /Glossary/);
  for (const t of ['Mavi', 'Elif', 'Mark', 'Delta']) assert.ok(ceviri.includes(t), t);
  assert.ok(!ceviri.includes('lorem'), 'çeviri sözlüğüne belge gövdesi girmez');
  assert.equal(baglamMetni(bosBaglam(), 'robot'), '');
  assert.equal(baglamMetni(null, 'ozet'), '');
  // Çok uzun notlar ve belgeler bile bütçede kalır.
  const dev2 = baglamTemizle({ konu: 'k'.repeat(300), notlar: 'n '.repeat(2000), belgeler: [{ ad: 'a.txt', metin: 'Büyük Rapor Maddesi. '.repeat(1000) }] });
  for (const amac of ['robot', 'ceviri', 'ozet'] as const) assert.ok(baglamMetni(dev2, amac, { sorgu: 'rapor maddesi' }).length <= BAGLAM_BUTCESI[amac]);
});

test('bağlam isteme girer: çeviri (sözlük), Robot (konu + ton + ilgili belge parçası), özet (konu); toplantı sürerken değişen bağlam sonraki isteklerde', async () => {
  const baglam = { konu: 'Mavi Kuş yol haritası', katilimcilar: 'Elif Kaya', notlar: '', ton: 'samimi', belgeler: [{ ad: 'plan.md', metin: BELGE }] };
  const s = sahne({ robot: true, baglam });
  assert.equal(son(s).baglamVar, true);
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  await s.oturum.durdur();
  const ceviri = s.yz.find((x) => x.i.amac === 'toplantı çevirisi')!.i;
  assert.match(ceviri.sistem, /Glossary/);
  assert.match(ceviri.sistem, /Mavi/);
  assert.equal(ceviri.kullanici, 'Can you ship the release on Friday?', 'çeviri girdisi yalnız cümle (bağlam sistem isteminde)');
  const oneri = s.yz.find((x) => x.i.amac === 'toplantı yanıt önerisi')!.i;
  assert.match(oneri.kullanici, /Meeting context given by the listener/);
  assert.match(oneri.kullanici, /Mavi Kuş yol haritası/);
  assert.match(oneri.kullanici, /warm and friendly/);
  assert.match(oneri.kullanici, /Deniz, Mavi Kuş projesinin ürün sorumlusu/, 'kullanıcının hafıza notları da yerinde');
  const ozet = s.yz.find((x) => x.i.amac === 'toplantı özeti')!.i;
  assert.match(ozet.kullanici, /Meeting context given by the listener/);
  assert.match(ozet.kullanici, /Transcript:/);
  // Bağlamsız toplantıda istem bugünkü gibi (bağlam bloğu yok).
  const bos = sahne({ robot: true });
  oturumaVer(bos, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await bos.oturum.bosalinca();
  await bos.oturum.durdur();
  assert.ok(bos.yz.every((x) => !x.i.sistem.includes('Glossary') && !x.i.kullanici.includes('Meeting context')));
  // Toplantı sürerken bağlam değişir.
  const t = sahne();
  oturumaVer(t, 'karsi', yakala(karsiSes(), KARSI_HZ), { '1.0': 'Can you ship the release on Friday?' });
  await t.oturum.bosalinca();
  t.oturum.baglamAyarla({ konu: 'Sonradan Eklenen Konu', belgeler: [] });
  assert.equal(son(t).baglamVar, true);
  oturumaVer(t, 'karsi', yakala(karsiSes(), KARSI_HZ), { '2.0': 'And the budget is fine for the next quarter.' });
  await t.oturum.bosalinca();
  const son1 = t.yz.filter((x) => x.i.amac === 'toplantı çevirisi').slice(-1)[0].i;
  assert.match(son1.sistem, /Sonradan/);
});

test('bağlam kayıtla saklanır (yerelde) ve silinince gider: kayıt yalnız bağlam doluyken taşır, depo sınırlara indirir, "Verilerimi sil" klasörle birlikte siler', async () => {
  const s = sahne({ baglam: { konu: 'Mavi Kuş', notlar: 'Not', belgeler: [{ ad: 'plan.md', metin: BELGE }] } });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  const d = await s.oturum.durdur();
  const k = kayitYap(d, d.bitis ?? Date.now(), s.oturum.baglamKaydi());
  assert.equal(k.baglam?.konu, 'Mavi Kuş');
  assert.equal(k.baglam?.belgeler[0].ad, 'plan.md');
  assert.equal('baglam' in kayitYap(d, 1, bosBaglam()), false, 'boş bağlam kayda yazılmaz');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-toplanti-baglam-'));
  try {
    const dp = toplantiDeposu(kok);
    const id = toplantiKimligi(new Date(2026, 10, 12, 10, 15, 0), 'ab12');
    dp.kaydet({ ...k, id });
    const oku = dp.al(id)!;
    assert.equal(oku.baglam?.belgeler[0].metin.length > 0, true);
    // Elle şişirilmiş kayıt okunurken sınırlara iner.
    const yol = path.join(kok, TOPLANTI_KLASORU, `${id}.json`);
    const j = JSON.parse(fs.readFileSync(yol, 'utf8'));
    j.baglam.notlar = 'x'.repeat(50_000);
    fs.writeFileSync(yol, JSON.stringify(j));
    assert.equal(dp.al(id)!.baglam!.notlar.length, BAGLAM_SINIRLARI.notlar);
    veriIslemiIste(kok, { tur: 'sil' });
    bekleyenVeriIsleminiUygula(kok, new Date(2026, 10, 12, 12, 0));
    assert.equal(fs.existsSync(path.join(kok, TOPLANTI_KLASORU)), false, '"Verilerimi sil" bağlamı da siler');
    assert.equal(dp.al(id), null);
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});

test('bitiş: özet (ana noktalar, kararlar, yapılacaklar) istenir, kayıt yalnız metinli satırları ve hazır önerileri taşır; iptal özetsiz', async () => {
  const s = sahne({ robot: true });
  oturumaVer(s, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await s.oturum.bosalinca();
  const d = await s.oturum.durdur();
  assert.equal(d.hal, 'bitti');
  assert.deepEqual(d.ozet, { anaNoktalar: ['Teslim tarihi konuşuldu'], kararlar: ['Cuma teslim'], yapilacaklar: ['Deniz: sürüm notlarını yaz'] });
  const k = kayitYap(d, d.bitis!);
  assert.equal(k.satirlar.length, 2);
  assert.equal(k.oneriler.length, 1);
  assert.equal(k.gizli, false);
  // Durduktan sonra gelen parça yok sayılır.
  s.oturum.parca({ konusan: 'karsi', konusmaNo: 9, parcaNo: 0, pcm: new Uint8Array(3200), son: true, basMs: 1, bitMs: 2 });
  assert.equal(son(s).satirlar.length, 2);

  const i = sahne();
  oturumaVer(i, 'karsi', yakala(karsiSes(), KARSI_HZ), KARSI_METIN);
  await i.oturum.bosalinca();
  const di = i.oturum.iptal();
  assert.equal(di.hal, 'durdu');
  assert.equal(di.ozet, null);
  assert.ok(!i.yz.some((x) => x.i.amac === 'toplantı özeti'));
});

test('ozetCoz / robotCoz: bozuk ve boş yanıt null; alan adları İngilizce de olabilir', () => {
  assert.equal(ozetCoz('olmadı'), null);
  assert.equal(ozetCoz('{"anaNoktalar":[],"kararlar":[],"yapilacaklar":[]}'), null);
  assert.deepEqual(ozetCoz('{"keyPoints":["a"],"decisions":[],"actionItems":["b"]}'), { anaNoktalar: ['a'], kararlar: [], yapilacaklar: ['b'] });
  assert.deepEqual(robotCoz('{"reply":"Sure."}'), { yanit: 'Sure.' });
  assert.equal(robotCoz(''), null);
});

test('dil sezgisi: yazı sistemi ve sık sözcüklerden; emin değilse null', () => {
  const c: [string, string | null][] = [
    ['Bütçeyi dün gözden geçirdik, rakamlar iyi görünüyor.', 'tr'], ['We reviewed the budget yesterday and it looks fine.', 'en'],
    ['Wir haben das Budget gestern geprüft und es ist gut.', 'de'], ['Nous avons vérifié le budget hier, merci.', 'fr'],
    ['Revisamos el presupuesto ayer y está bien.', 'es'], ['Мы проверили бюджет вчера.', 'ru'], ['راجعنا الميزانية أمس', 'ar'],
    ['昨日予算を確認しました', 'ja'], ['我们昨天检查了预算', 'zh'], ['어제 예산을 검토했습니다', 'ko'], ['OK', null], ['', null],
  ];
  for (const [m, d] of c) assert.equal(dilSez(m), d, m);
});

test('iş izi: toplantı sürerken çentik "Toplantı · dinliyor", rayda Toplantı simgesi nefes alır; bitince kayıt yok', () => {
  const k = toplantiIsi({ id: 't-1', hal: 'dinliyor', baslangic: 1 })!;
  assert.equal(centikOzeti([k]), 'Toplantı · dinliyor');
  assert.deepEqual(rayNoktalari([k]), { toplanti: 'canli' });
  assert.equal(k.surekli, undefined, 'çentikte sayılır');
  assert.equal(toplantiIsi({ id: 't-1', hal: 'bitti', baslangic: 1 }), null);
  assert.equal(toplantiIsi({ id: 't-1', hal: 'ozetleniyor', baslangic: 1 })!.ne, 'Toplantı · özetleniyor');
});

// ── Depo, silme, "Verilerimi sil" ve "Yeni başla" ─────────────────────────────────────────────────────────────────────────
const kayitOrnegi = (id: string, bas = '2026-11-12T10:15:00.000Z') => ({
  surum: 1 as const, id, baslangic: bas, bitis: bas, sureMs: 60_000, yol: 'hesap' as const, hedefDil: 'tr', gizli: false,
  satirlar: [{ konusan: 'karsi' as const, basMs: 0, metin: 'Can you ship on Friday?', dil: 'en', ceviri: 'Cuma teslim edebilir misiniz?' }], oneriler: [],
  ozet: { anaNoktalar: ['Cuma teslimi konuşuldu'], kararlar: [], yapilacaklar: ['Sürüm notlarını yaz'] },
});

test('depo: kaydet, listele (en yeni önce, başlık özetten), al, sil; geçersiz kimlik yol gezintisi yapamaz', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-toplanti-'));
  try {
    const d = toplantiDeposu(kok);
    assert.deepEqual(d.liste(), []);
    const a = toplantiKimligi(new Date(2026, 10, 12, 10, 15, 0), 'ab12');
    const b = toplantiKimligi(new Date(2026, 10, 12, 11, 0, 0), 'cd34');
    d.kaydet(kayitOrnegi(a));
    d.kaydet(kayitOrnegi(b, '2026-11-12T11:00:00.000Z'));
    assert.deepEqual(d.liste().map((x) => x.id), [b, a]);
    assert.equal(d.liste()[0].baslik, 'Cuma teslimi konuşuldu');
    assert.equal(d.al(a)?.satirlar[0].ceviri, 'Cuma teslim edebilir misiniz?');
    assert.equal(d.sil(a), true);
    assert.equal(d.al(a), null);
    assert.deepEqual(d.liste().map((x) => x.id), [b]);
    assert.throws(() => d.kaydet(kayitOrnegi('../../ayarlar')));
    assert.equal(d.al('../ayarlar'), null);
    assert.equal(d.sil('..\\fuber.db'), false);
    assert.ok(fs.existsSync(path.join(kok, TOPLANTI_KLASORU, `${b}.json`)));
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});

test('silme kuyruğu: toplantı silmesi Geri al\'lı ("toplanti" türü, yalnız geçerli kimlik)', () => {
  assert.deepEqual(silmeIslemiOku({ tur: 'toplanti', id: 't-20261112-101500-ab12' }), { tur: 'toplanti', id: 't-20261112-101500-ab12' });
  assert.equal(silmeIslemiOku({ tur: 'toplanti', id: '../x' }), null);
});

test('"Yeni başla" geçmiş toplantıları yedeğe taşır, "Verilerimi sil" siler', () => {
  assert.ok(EK_KISISEL.includes(TOPLANTI_KLASORU));
  for (const tur of ['yeni-basla', 'sil'] as const) {
    const kok = fs.mkdtempSync(path.join(os.tmpdir(), `fuber-toplanti-${tur}-`));
    try {
      const id = toplantiKimligi(new Date(2026, 10, 12, 10, 15, 0), 'ab12');
      toplantiDeposu(kok).kaydet(kayitOrnegi(id));
      veriIslemiIste(kok, { tur });
      const r = bekleyenVeriIsleminiUygula(kok, new Date(2026, 10, 12, 12, 0));
      assert.equal(r.yapildi, tur);
      assert.equal(fs.existsSync(path.join(kok, TOPLANTI_KLASORU)), false, `${tur}: kökte kalmadı`);
      assert.deepEqual(toplantiDeposu(kok).liste(), []);
      if (tur === 'yeni-basla') assert.ok(fs.existsSync(path.join(r.yedek!, TOPLANTI_KLASORU, `${id}.json`)), 'yedekte');
    } finally { fs.rmSync(kok, { recursive: true, force: true }); }
  }
});

// ══════════════ 13 Kas 0.17.3: kaynak hataları, tek kaynakla başlama, model / yazıya çevirme seçimi ══════════════
// Kök neden (kurulu paketli ölçüm, scripts/dev/toplanti-paketli.mjs): "Mikrofonu tamamen kapat" açıkken izin işleyicisi getDisplayMedia'yı (mediaTypes boş) da reddediyordu.
test('izin kararı: mikrofon kapalıyken yalnız Toplantı penceresindeki bilgisayar sesi (mediaTypes boş) geçer; mikrofon her zaman reddedilir; kapalı değilse hepsi geçer', () => {
  assert.equal(mediaIzniVerilir({ mikrofonKapali: false, mediaTypes: ['audio'], ekranSesiPenceresi: false }), true);
  assert.equal(mediaIzniVerilir({ mikrofonKapali: false, mediaTypes: [], ekranSesiPenceresi: false }), true);
  // Paketli ölçümde gerçek istekler: getDisplayMedia → mediaTypes [], getUserMedia(audio) → ['audio'].
  assert.equal(mediaIzniVerilir({ mikrofonKapali: true, mediaTypes: [], ekranSesiPenceresi: true }), true, 'bilgisayarın sesi mikrofon değildir');
  assert.equal(mediaIzniVerilir({ mikrofonKapali: true, mediaTypes: ['audio'], ekranSesiPenceresi: true }), false, 'mikrofon kapalı kalır');
  assert.equal(mediaIzniVerilir({ mikrofonKapali: true, mediaTypes: ['audio', 'video'], ekranSesiPenceresi: true }), false);
  assert.equal(mediaIzniVerilir({ mikrofonKapali: true, mediaTypes: [], ekranSesiPenceresi: false }), false, 'Toplantı başlamadan kimse bilgisayar sesi alamaz');
  assert.equal(mediaIzniVerilir({ mikrofonKapali: true, ekranSesiPenceresi: true }), true);
  const ana = fs.readFileSync(path.resolve(import.meta.dirname, '../src/main/main.ts'), 'utf8');
  assert.match(ana, /mediaIzniVerilir\(\{ mikrofonKapali: ayarlar\(\)\.ses\.mikrofonKapali/, 'izin işleyicisi ortak kararı kullanır');
});

test('kaynak hatası eşlemesi: gerçek neden tek cümle + eylem; ham hata adı/iletisi kullanıcıya sızmaz', () => {
  const g = (k: Konusan, ad: string, ileti = '', ctx = {}) => kaynakHatasiCoz(k, { ad, ileti }, ctx);
  // Mikrofon
  assert.deepEqual(g('siz', 'NotAllowedError', 'Permission denied', { mikrofonKapali: true }), { neden: 'ayar-kapali', metin: 'Mikrofon Fuber ayarlarında kapalı; yalnız karşı taraf yazılıyor.', eylem: 'mikrofon-ac' });
  assert.deepEqual(g('siz', 'NotAllowedError', 'Permission denied by system'), { neden: 'windows-izin', metin: 'Windows mikrofon izni kapalı; yalnız karşı taraf yazılıyor.', eylem: 'windows-mikrofon' });
  assert.equal(g('siz', 'NotAllowedError', 'Permission denied').neden, 'izin');
  assert.deepEqual(g('siz', 'NotFoundError', 'Requested device not found'), { neden: 'bulunamadi', metin: 'Mikrofon bulunamadı; yalnız karşı taraf yazılıyor.', eylem: 'yeniden' });
  assert.equal(g('siz', 'OverconstrainedError').neden, 'bulunamadi');
  assert.equal(g('siz', 'NotReadableError', 'Could not start audio source').neden, 'kullanimda');
  assert.equal(g('siz', 'AbortError').neden, 'kullanimda');
  assert.equal(g('siz', 'TypeError').neden, 'bilinmiyor');
  // Bilgisayarın sesi: hangi hata olursa olsun tek cümle + "Yeniden dene" eylemi (neden günlükte)
  for (const ad of ['NotAllowedError', 'NotSupportedError', 'NoAudioTrack', 'AbortError', 'Error']) {
    assert.deepEqual(g('karsi', ad), { neden: 'paylasilamadi', metin: 'Bilgisayar sesi paylaşılamadı; yalnız mikrofon yazılıyor.', eylem: 'yeniden' }, ad);
  }
  // İkisi birden yoksa cümle "yalnız … yazılıyor" demez
  assert.equal(g('karsi', 'NotAllowedError', '', { hicbiri: true }).metin, 'Bilgisayar sesi paylaşılamadı.');
  assert.equal(g('siz', 'NotAllowedError', '', { hicbiri: true, mikrofonKapali: true }).metin, 'Mikrofon Fuber ayarlarında kapalı.');
  // Teknik iz yok
  for (const k of ['karsi', 'siz'] as const) for (const ad of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', 'Garip']) {
    for (const ctx of [{}, { mikrofonKapali: true }, { hicbiri: true }]) {
      const m = g(k, ad, 'Permission denied by system', ctx).metin;
      assert.ok(!/Error|Permission|denied|Requested|NotAllowed/.test(m), m);
      assert.equal(isDiliIhlali(m), null, m);
    }
  }
  assert.equal(WINDOWS_MIKROFON_AYARI, 'ms-settings:privacy-microphone');
});

const yzG = (o: Partial<YzBaglami> = {}): YzBaglami => ({ bulutsuz: false, gelistirici: false, claudeSecili: false, yerelHazir: true, yerelAd: 'Gemma 4B', varsayilanEtiket: 'Fuber', ...o });

test('model seçenekleri: Business sade ad, Developer model adı; Fuber hesabında Claude satırı yok; yerel hazır değilse kapalı', () => {
  assert.deepEqual(yzSecenekleri(yzG()).map((x) => x.deger), ['varsayilan', 'yerel']);
  const biz = yzSecenekleri(yzG({ claudeSecili: true, claudeYardimci: 'claude-haiku-5-5', varsayilanEtiket: 'Kendi hesabın' }));
  assert.deepEqual(biz.map((x) => x.etiket), ['Kendi hesabın', 'Hızlı', 'En güçlü', 'Dengeli', 'Gelişmiş', 'Bu bilgisayar']);
  assert.ok(!biz.some((x) => /Claude|Haiku|Opus|Sonnet|claude/.test(x.etiket)), 'Business\'ta model adı yok');
  assert.ok(biz.every((x) => !x.aciklama || !/claude-/.test(x.aciklama)), 'Business\'ta kimlik yok');
  const dev = yzSecenekleri(yzG({ gelistirici: true, claudeSecili: true, claudeYardimci: 'claude-haiku-5-5', varsayilanEtiket: 'Claude Haiku 5.5' }));
  assert.ok(dev.some((x) => x.deger === 'claude-sonnet-5-5' && x.etiket === 'Claude Sonnet 5.5'));
  assert.equal(dev.filter((x) => x.deger === 'claude-haiku-5-5').length, 1, 'yardımcı model listede bir kez');
  assert.equal(dev.at(-1)!.etiket, 'Bu bilgisayar · Gemma 4B');
  const hazirDegil = yzSecenekleri(yzG({ yerelHazir: false })).find((x) => x.deger === 'yerel')!;
  assert.equal(hazirDegil.devreDisi, true);
  assert.equal(yzEtiketi('yerel', yzG({ yerelHazir: false })), 'Bu bilgisayar (hazır değil)');
});

test('P14: Gizli ve "Yalnız bu bilgisayar"da bulut seçeneği görünmez; seçim ne olursa olsun karar yerel', () => {
  const g = yzG({ bulutsuz: true, claudeSecili: true, gelistirici: true });
  assert.deepEqual(yzSecenekleri(g), [{ deger: 'yerel', etiket: 'Bu bilgisayar · Gemma 4B' }]);
  for (const t of ['varsayilan', 'yerel', 'claude-opus-5-5']) { assert.deepEqual(yzKarari(t, g), { tur: 'yerel' }, t); assert.equal(yzSeciliDeger(t, g), 'yerel'); }
  assert.equal(yzEtiketi('claude-opus-5-5', g), 'Bu bilgisayar · Gemma 4B');
  assert.deepEqual(yaziSecenekleri({ bulutsuz: true, gelistirici: false, hesapVar: true, whisperKurulu: false }), [{ deger: 'yerel', etiket: 'Bu bilgisayar', aciklama: 'İndirilmeli' }]);
  assert.ok(!yaziSecenekleri({ bulutsuz: true, gelistirici: true, hesapVar: true, whisperKurulu: true }).some((x) => x.deger === 'bulut'));
  assert.equal(yaziSeciliDeger('bulut', { bulutsuz: true, hesapVar: true }), 'yerel');
  // Yazıya çevirme yolu: Gizli'de tercih 'bulut' olsa da yalnız yerel
  assert.equal(toplantiYolu({ bulutsuz: true, hesapKullanilir: true, bulutDustu: false, whisperKurulu: true, tercih: 'bulut' }), 'whisper');
  assert.equal(toplantiYolu({ bulutsuz: true, hesapKullanilir: true, bulutDustu: false, whisperKurulu: false, tercih: 'bulut' }), 'yok');
});

test('model seçimi isteğe yansır: her istek seçimi o an okur (oturum sürerken değişiklik sonraki istekte); Gizli seçimi ezer', async () => {
  const cagrilar: string[] = [];
  const t = { yz: 'varsayilan', bulutsuz: false, claude: true };
  const yz = yzCagrisiKur({
    tercihYz: () => t.yz,
    baglam: () => yzG({ bulutsuz: t.bulutsuz, claudeSecili: t.claude }),
    yerel: async () => { cagrilar.push('yerel'); return ''; },
    model: async (_i, m) => { cagrilar.push(m); return ''; },
    varsayilan: async () => { cagrilar.push('varsayilan'); return ''; },
  });
  const i: YzIstegi = { sistem: 's', kullanici: 'k', amac: 'toplantı çevirisi', maxToken: 100 };
  await yz(i, 'serbest');
  t.yz = 'claude-opus-5-5';
  await yz(i, 'serbest');
  t.yz = 'claude-haiku-5-5';
  await yz(i, 'serbest');
  t.yz = 'yerel';
  await yz(i, 'serbest');
  t.claude = false; t.yz = 'claude-opus-5-5'; // Claude artık etkin değil: seçilen model kullanılmaz (buluta başka yoldan çıkmaz), varsayılana iner
  await yz(i, 'serbest');
  t.claude = true; t.bulutsuz = true; // Gizli açıldı: seçim ne olursa olsun yerel
  await yz(i, 'serbest');
  t.bulutsuz = false; t.yz = 'claude-opus-5-5';
  await yz(i, 'yerel'); // oturum Gizli'yi gördü: seçim hiç bakılmaz
  assert.deepEqual(cagrilar, ['varsayilan', 'claude-opus-5-5', 'claude-haiku-5-5', 'yerel', 'varsayilan', 'yerel', 'yerel']);
  // Gerçek bağlama: model yolu yalnız kullanıcının kendi Claude anahtarıyla ('bulut' sabit yol), yerel yol sabit 'yerel'
  const ana = fs.readFileSync(path.resolve(import.meta.dirname, '../src/main/toplanti.ts'), 'utf8');
  assert.match(ana, /cagirSecimle\(\{ saglayici: 'anthropic', model,/);
  assert.match(ana, /i\.amac, 'bulut'\)/);
  assert.match(ana, /'yerel', \{ tekDeneme: tekMi\(i\) \}/);
  assert.match(ana, /yz: sahte \? sahteYzSecimli : gercekYz/, 'önizleme de seçimi izler');
});

test('tercih deposu: kalıcı, geçersiz değer eskisini korur, bozuk dosya varsayılan, yazım atomik; etiket seçimi yansıtır', () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-tercih-'));
  try {
    const d = tercihDeposu(() => kok);
    assert.deepEqual(d.oku(), { yz: 'varsayilan', yazi: 'otomatik' });
    assert.deepEqual(d.yaz({ yz: 'claude-sonnet-5-5' }), { yz: 'claude-sonnet-5-5', yazi: 'otomatik' });
    assert.deepEqual(d.yaz({ yazi: 'yerel' }), { yz: 'claude-sonnet-5-5', yazi: 'yerel' });
    assert.deepEqual(d.yaz({ yz: 'gpt; rm -rf /', yazi: 'internet' }), { yz: 'claude-sonnet-5-5', yazi: 'yerel' }, 'geçersiz alan düşer');
    assert.deepEqual(d.yaz({ yz: 'yerel', bilinmeyen: 1 }), { yz: 'yerel', yazi: 'yerel' });
    // Yeni örnek (uygulama yeniden açıldı): diskten
    assert.deepEqual(tercihDeposu(() => kok).oku(), { yz: 'yerel', yazi: 'yerel' });
    assert.ok(fs.existsSync(path.join(kok, TERCIH_DOSYASI)));
    assert.deepEqual(fs.readdirSync(kok).filter((x) => x.endsWith('.tmp')), [], 'geçici dosya kalmaz');
    fs.writeFileSync(path.join(kok, TERCIH_DOSYASI), '{bozuk');
    assert.deepEqual(tercihDeposu(() => kok).oku(), { yz: 'varsayilan', yazi: 'otomatik' });
    // Seçimin üst şeritte görünen adı
    assert.equal(yzEtiketi('claude-sonnet-5-5', yzG({ claudeSecili: true, gelistirici: true })), 'Claude Sonnet 5.5');
    assert.equal(yzEtiketi('claude-sonnet-5-5', yzG({ claudeSecili: true })), 'Dengeli');
    assert.equal(yzEtiketi('claude-sonnet-5-5', yzG({ claudeSecili: false })), 'Fuber');
    assert.deepEqual(tercihTemizle(null), { yz: 'varsayilan', yazi: 'otomatik' });
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});

test('süren toplantıda seçim değişince oturum durumu yayınlar (etiketler tazelenir) ve sonraki istek yeni seçimi okur', async () => {
  const s = sahne({ robot: false });
  const once = s.durumlar.length;
  s.oturum.yenile();
  await Promise.resolve();
  assert.ok(s.durumlar.length > once, 'yenile durum yayınlar');
  // Arayüz: seçici iki üst şerit öğesinde de var; seçim denetçiden ana sürece kalıcı yazılır, seçili değer hazırlıktan gelir
  const ui = fs.readFileSync(path.resolve(import.meta.dirname, '../src/renderer/toplanti/Toplanti.tsx'), 'utf8');
  assert.match(ui, /data-motor="yazi"[\s\S]*?Secici[\s\S]*?tercihYaz\(\{ yazi:/);
  assert.match(ui, /data-motor="yz"[\s\S]*?Secici[\s\S]*?tercihYaz\(\{ yz: v \}\)/);
  assert.match(ui, /devreDisi=\{d\?\.hal === 'ozetleniyor'\}/, 'yalnız özetlenirken kilitli; dinlerken değişir');
  const den = fs.readFileSync(path.resolve(import.meta.dirname, '../src/renderer/toplanti/denetci.ts'), 'utf8');
  assert.match(den, /cagir<Hazirlik>\('toplanti:tercih-yaz', p\)/);
  assert.match(den, /dinle\('ayarlar:degisti'/, 'Gizli açılıp kapanınca seçenekler tazelenir');
});

// ══ 14 Kas: gerçek zamanlı akış (sesli sohbet uygulamalarındaki gibi akan yazı) ═══════════════════════════════════════════════════════════════════════
// Akış kipi VAD (parça yok, ses blokları), canlı akış (sahte bağlantı: ağ yok), yerel büyüyen pencere, hızlı çeviri, hafif yayın, uzun toplantı.
class SahteAkis implements CanliAkis {
  readonly ev: AkisOlaylari;
  kapali = false;
  basladi = false;
  no = 0;
  acik: number | null = null;
  sesler: { no: number; pcm: Uint8Array }[] = [];
  commitler: number[] = [];
  constructor(ev: AkisOlaylari) { this.ev = ev; }
  baslat(): void { this.basladi = true; }
  ses(pcm: Uint8Array): number { if (this.kapali) return 0; if (this.acik === null) this.acik = ++this.no; this.sesler.push({ no: this.acik, pcm }); return this.acik; }
  commit(): number { if (this.acik === null || this.kapali) return 0; const n = this.acik; this.acik = null; this.commitler.push(n); return n; }
  kapat(): void { this.kapali = true; }
  get kapaliMi(): boolean { return this.kapali; }
  get bayt(): number { return this.sesler.reduce((n, x) => n + x.pcm.length, 0); }
}
interface AkisSahnesi extends Sahne { akislar: Partial<Record<Konusan, SahteAkis>>; acilan: Konusan[]; kullanilir: { v: boolean } }
function akisSahne(o: Parameters<typeof sahne>[0] = {}): AkisSahnesi {
  const kayit = { akislar: {} as Partial<Record<Konusan, SahteAkis>>, acilan: [] as Konusan[], kullanilir: { v: true } };
  let ref: Sahne | null = null;
  const s = sahne({
    ...o,
    akis: (sh) => { ref = sh; return { kullanilir: () => kayit.kullanilir.v && !sh.bulutsuz.v, ac: (k, ev) => { kayit.acilan.push(k); return (kayit.akislar[k] = new SahteAkis(ev)); } }; },
  });
  void ref;
  return Object.assign(s, kayit) as AkisSahnesi;
}
const BLOK_BAYT = 1280 * 2; // 80 ms
const blok = () => new Uint8Array(BLOK_BAYT);
const yarimSn = () => new Uint8Array(16000); // 0,5 sn (200 ms altı ses yazıya çevrilmez)
const satirOf = (s: Sahne, id: string) => son(s).satirlar.find((x) => x.id === id);

test('VAD akış kipi: ses PARÇALANMAZ — konuşma başlar başlamaz (ön ses dahil) ~80 ms blokları akar; bitiş 450 ms sessizlikle; sessizlikte hiç ses yok', () => {
  const olaylar: KesiciOlayi[] = [];
  const y = new ToplantiYakalayici((o) => olaylar.push(o), VAD_AKIS);
  const f = birlestir(sessizlik(16000, 1), konusma(16000, 3.2, 150), sessizlik(16000, 2));
  for (let i = 0; i < f.length; i += 2048) y.besle(f.subarray(i, Math.min(f.length, i + 2048)), 16000);
  y.bitir();
  assert.equal(olaylar.filter((o) => o.tur === 'parca').length, 0, 'parça yok');
  assert.equal(olaylar[0].tur, 'basladi');
  assert.equal(olaylar[1].tur, 'ses', 'ilk blok başlangıçla birlikte (ön ses dahil)');
  const sesler = olaylar.filter((o): o is Extract<KesiciOlayi, { tur: 'ses' }> => o.tur === 'ses');
  const toplam = sesler.reduce((n, o) => n + o.pcm.length / 2, 0);
  // konuşma 3,2 sn + ön ses 0,24 sn + bitiş sessizliği 0,45 sn ≈ 3,9 sn (başka sessizlik gitmez)
  assert.ok(toplam / 16000 > 3.5 && toplam / 16000 < 4.4, `${(toplam / 16000).toFixed(2)} sn ses gitti`);
  assert.ok(sesler.slice(1, -1).every((o) => o.pcm.length / 2 / 16 >= 79 && o.pcm.length / 2 / 16 <= 85), 'bloklar ≈ 80 ms');
  // basMs'ler kesintisiz ardışık (sesin hiçbir parçası atlanmaz)
  for (let i = 1; i < sesler.length; i++) assert.ok(Math.abs(sesler[i].basMs - (sesler[i - 1].basMs + sesler[i - 1].pcm.length / 2 / 16)) <= 2, `blok ${i} boşluklu`);
  const bitti = olaylar.filter((o) => o.tur === 'bitti');
  assert.equal(bitti.length, 1);
  assert.equal(olaylar.at(-1)!.tur, 'bitti');
});

test('VAD akış kipi: kısa tık "vazgeçildi"; sürekli konuşma 12 sn\'de yeni satırla sürer (satır "bitti", yenisi hemen "başladı"); kesintisiz ses, boşluk yok', () => {
  const k = yakalaAkis(birlestir(sessizlik(16000, 0.5), konusma(16000, 0.08, 400, 0.4), sessizlik(16000, 1.5)));
  assert.equal(k.at(-1)!.tur, 'vazgecildi');
  assert.ok(!k.some((o) => o.tur === 'bitti'));
  const uzun = yakalaAkis(birlestir(sessizlik(16000, 0.5), konusma(16000, 27, 170), sessizlik(16000, 1.5)));
  const turler = uzun.filter((o) => o.tur !== 'ses').map((o) => `${o.tur}:${o.konusmaNo}`);
  assert.deepEqual(turler, ['basladi:1', 'bitti:1', 'basladi:2', 'bitti:2', 'basladi:3', 'bitti:3']);
  const sesler = uzun.filter((o): o is Extract<KesiciOlayi, { tur: 'ses' }> => o.tur === 'ses');
  const toplam = sesler.reduce((n, o) => n + o.pcm.length / 2, 0) / 16000;
  assert.ok(toplam > 27.5 && toplam < 28.6, `${toplam.toFixed(2)} sn`);
  for (let i = 1; i < sesler.length; i++) assert.ok(Math.abs(sesler[i].basMs - (sesler[i - 1].basMs + sesler[i - 1].pcm.length / 2 / 16)) <= 2, `blok ${i} boşluklu`);
});
function yakalaAkis(f: Float32Array): KesiciOlayi[] {
  const l: KesiciOlayi[] = [];
  const y = new ToplantiYakalayici((o) => l.push(o), VAD_AKIS);
  for (let i = 0; i < f.length; i += 2048) y.besle(f.subarray(i, Math.min(f.length, i + 2048)), 16000);
  y.bitir();
  return l;
}

test('akış: kısmi metin satırda CANLI (kesin değil), commit → kesin; toplu hesap çağrısı hiç yok; çeviri kesin metinden hemen sonra', async () => {
  const s = akisSahne();
  s.oturum.baslat();
  assert.deepEqual(s.acilan.sort(), ['karsi', 'siz'], 'iki konuşan için birer akış, toplantı başlarken');
  assert.ok(s.akislar.karsi!.basladi);
  s.oturum.basladi('karsi', 1, 1000);
  s.oturum.sesGeldi('karsi', 1, blok(), 1000);
  s.oturum.sesGeldi('karsi', 1, blok(), 1080);
  const a = s.akislar.karsi!;
  assert.equal(a.sesler.length, 2);
  a.ev.kismi('Can you', 1);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([satirOf(s, 'karsi:1')!.metin, satirOf(s, 'karsi:1')!.kesin], ['Can you', false]);
  a.ev.kismi('Can you ship the release', 1);
  assert.equal(satirOf(s, 'karsi:1')!.metin, 'Can you ship the release');
  s.oturum.konusmaBitti('karsi', 1, 3000);
  assert.deepEqual(a.commitler, [1]);
  assert.equal(satirOf(s, 'karsi:1')!.kesin, false, 'commit gitti ama kesin metin gelmedi: hâlâ kesin değil');
  a.ev.kesin('Can you ship the release on Friday?', 1);
  await s.oturum.bosalinca();
  const l = satirOf(s, 'karsi:1')!;
  assert.deepEqual([l.metin, l.kesin, l.dil, l.ceviri, l.ceviriDurum], ['Can you ship the release on Friday?', true, 'en', '[TR] Can you ship the release on Friday?', 'tamam']);
  assert.equal(s.hesapCagri + s.whisperCagri, 0, 'toplu yol ve yerel tanıyıcı hiç çağrılmadı');
  assert.equal(son(s).yol, 'hesap');
});

test('akış: iki kaynak iki ayrı akış — Karşı taraf ve Siz birbirine karışmaz; "Siz" satırı yankıysa kısmi metinde de görünmez, kesinleşince atılır', async () => {
  const s = akisSahne();
  s.oturum.baslat();
  s.oturum.sesGeldi('karsi', 1, blok(), 0);
  s.oturum.sesGeldi('siz', 1, blok(), 20);
  assert.equal(s.akislar.karsi!.sesler.length, 1);
  assert.equal(s.akislar.siz!.sesler.length, 1);
  s.akislar.karsi!.ev.kismi('We reviewed the budget yesterday and the numbers look fine', 1);
  s.akislar.siz!.ev.kismi('Evet bence cuma', 1);
  assert.equal(satirOf(s, 'siz:1')!.metin, 'Evet bence cuma');
  s.oturum.konusmaBitti('karsi', 1, 3000);
  s.oturum.konusmaBitti('siz', 1, 1500);
  s.akislar.karsi!.ev.kesin('We reviewed the budget yesterday and the numbers look fine.', 1);
  s.akislar.siz!.ev.kesin('Evet bence cuma günü uygun.', 1);
  await s.oturum.bosalinca();
  assert.deepEqual(son(s).satirlar.map((x) => [x.konusan, x.kesin]), [['karsi', true], ['siz', true]]);
  // Yankı: mikrofon karşı tarafın cümlesini yakaladı. Kısmi metin benzeyince satır görünmez, kesinleşince atılır.
  s.oturum.sesGeldi('karsi', 2, blok(), 6000);
  s.oturum.sesGeldi('siz', 2, blok(), 6010);
  s.akislar.karsi!.ev.kismi('Perfect let us meet again on Monday to review the feedback', 2);
  s.akislar.siz!.ev.kismi('Perfect let us meet again on Monday to review', 2);
  assert.equal(satirOf(s, 'siz:2'), undefined, 'yankı satırı kısmi metinde görünmez');
  s.oturum.konusmaBitti('karsi', 2, 9000);
  s.oturum.konusmaBitti('siz', 2, 9000);
  s.akislar.karsi!.ev.kesin('Perfect, let us meet again on Monday to review the feedback.', 2);
  s.akislar.siz!.ev.kesin('Perfect, let us meet again on Monday to review the feedback.', 2);
  await s.oturum.bosalinca();
  assert.equal(satirOf(s, 'siz:2'), undefined);
  assert.equal(son(s).yankiAtilan, 1);
});

test('akış düşerse: kesinleşmiş ama cevabı gelmemiş satırın SESİ toplu yola gider (metin kaybolmaz); sürmekte olan satır toplu yolda devam eder; Kredi/tavan: yerel tanıyıcıya geçilir, tek cümle', async () => {
  const s = akisSahne();
  s.oturum.baslat();
  s.oturum.sesGeldi('karsi', 1, blok(), 0);
  s.oturum.konusmaBitti('karsi', 1, 500);
  s.oturum.sesGeldi('karsi', 2, blok(), 900);
  const a = s.akislar.karsi!;
  const gidenAkis = a.sesler.length;
  const pcm1 = yarimSn();
  s.metin.set(anahtar(pcm1), 'Can you ship the release on Friday?');
  a.ev.dustu({ neden: 'baglanti', bekleyenler: [{ no: 1, pcm: pcm1, kesinlesmis: true }, { no: 2, pcm: blok(), kesinlesmis: false }] });
  await s.oturum.bosalinca();
  assert.equal(satirOf(s, 'karsi:1')!.metin, 'Can you ship the release on Friday?', 'bekleyen ses toplu yoldan çevrildi');
  assert.equal(satirOf(s, 'karsi:1')!.kesin, true);
  assert.ok(s.hesapCagri >= 1);
  // Sürmekte olan satır: sonraki sesler toplu yola (≤4 sn parça) biriktirilir.
  s.oturum.sesGeldi('karsi', 2, blok(), 980);
  assert.equal(satirOf(s, 'karsi:2')!.kesin, false);
  s.oturum.konusmaBitti('karsi', 2, 1500);
  await s.oturum.bosalinca();
  assert.equal(satirOf(s, 'karsi:2')?.kesin ?? true, true);
  assert.equal(a.sesler.length, gidenAkis, 'düşen akışa daha fazla ses gitmedi');
  // Tavan: bulut düştü, yerel tanıyıcı var → yerelde sürer, sakin bilgi.
  const t = akisSahne();
  t.oturum.baslat();
  t.oturum.sesGeldi('karsi', 1, blok(), 0);
  t.oturum.konusmaBitti('karsi', 1, 500);
  const w = yarimSn();
  t.metin.set(anahtar(w), 'Okay we start now.');
  t.akislar.karsi!.ev.dustu({ neden: 'tavan', bekleyenler: [{ no: 1, pcm: w, kesinlesmis: true }] });
  await t.oturum.bosalinca();
  assert.equal(t.hesapCagri, 0, 'tavan doluyken buluta (toplu da) gidilmez');
  assert.ok(t.whisperCagri >= 1);
  assert.equal(son(t).yol, 'whisper');
  assert.equal(son(t).uyari, bulutGecisMetni('tavan'));
  assert.ok(t.akislar.siz!.kapali, 'öbür konuşanın akışı da kapandı');
  assert.equal(satirOf(t, 'karsi:1')!.metin, 'Okay we start now.');
});

test('P14 · Gizli / "Yalnız bu bilgisayar": canlı akış HİÇ açılmaz, token istenmez, ses buluta gitmez; yerelde büyüyen pencere kullanılır', async () => {
  const s = akisSahne({ bulutsuz: true, whisperCevir: async (wav) => `yerel ${(wavdanPcm(wav)!.pcm.length / 32000).toFixed(1)}` });
  s.oturum.baslat();
  assert.deepEqual(s.acilan, [], 'akış kurulmadı');
  for (let i = 0; i < 20; i++) s.oturum.sesGeldi('karsi', 1, blok(), i * 80); // 1,6 sn
  await s.oturum.bosalinca();
  assert.ok(s.whisperCagri >= 1, 'konuşma sürerken kısmi pencere');
  assert.ok(satirOf(s, 'karsi:1')!.metin.startsWith('yerel'), 'kısmi metin satırda');
  assert.equal(satirOf(s, 'karsi:1')!.kesin, false);
  s.oturum.konusmaBitti('karsi', 1, 1800);
  await s.oturum.bosalinca();
  assert.equal(satirOf(s, 'karsi:1')!.kesin, true);
  assert.equal(s.hesapCagri, 0);
  assert.deepEqual(s.acilan, []);
  assert.equal(son(s).yol, 'whisper');
  assert.ok(s.yz.every((x) => x.yol === 'yerel'));
});

test('P14 · toplantı ortasında Gizli açılınca canlı akış o an kapanır; açık satırın sonraki sesi buluta gitmez, yerel tanıyıcıda sürer; buluttan gelen kısım kalır', async () => {
  const s = akisSahne({ whisperCevir: async () => 'devamı yerelde' });
  s.oturum.baslat();
  for (let i = 0; i < 5; i++) s.oturum.sesGeldi('karsi', 1, blok(), i * 80);
  const a = s.akislar.karsi!;
  a.ev.kismi('Bulutta başlayan cümle', 1);
  const gitti = a.sesler.length;
  s.bulutsuz.v = true; // kullanıcı Gizli'yi açtı
  for (let i = 5; i < 20; i++) s.oturum.sesGeldi('karsi', 1, blok(), i * 80);
  assert.equal(a.sesler.length, gitti, 'Gizli sonrası ses akışa gitmedi');
  assert.ok(a.kapali && s.akislar.siz!.kapali, 'iki akış da kapandı');
  s.oturum.konusmaBitti('karsi', 1, 1700);
  await s.oturum.bosalinca();
  assert.equal(satirOf(s, 'karsi:1')!.metin, 'Bulutta başlayan cümle devamı yerelde');
  assert.equal(s.hesapCagri, 0);
  // Gizli açıkken yeni satır akışa hiç dokunmaz.
  s.oturum.sesGeldi('karsi', 2, blok(), 3000);
  assert.equal(a.sesler.length, gitti);
});

test('yerel büyüyen pencere: kısmi metin ≈ 0,7 sn adımla yenilenir, kesin geçiş öncelikli; kısmi pencereler kuyrukta BİRİKMEZ (sunucu yavaşsa atlanır)', async () => {
  const sureler: number[] = [];
  let eszamanli = 0, enCok = 0;
  const s = akisSahne({ bulutsuz: true, whisperCevir: async (wav) => { eszamanli++; enCok = Math.max(enCok, eszamanli); const sn = wavdanPcm(wav)!.pcm.length / 32000; sureler.push(sn); await new Promise((r) => setTimeout(r, 30)); eszamanli--; return `metin ${sn.toFixed(1)}`; } });
  for (let i = 0; i < 40; i++) { s.oturum.sesGeldi('karsi', 1, blok(), i * 80); if (i % 4 === 3) await new Promise((r) => setTimeout(r, 12)); } // 3,2 sn ses
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(sureler.length >= 2 && sureler.length <= 5, `kısmi pencere sayısı ${sureler.length}`);
  assert.ok(sureler[0] >= 1.0, `ilk pencere ≥ 1 sn (${sureler[0]})`);
  assert.ok(sureler.every((x, i) => i === 0 || x > sureler[i - 1]), 'pencere büyür');
  assert.equal(enCok, 1, 'yerel sunucuya tek istek');
  s.oturum.konusmaBitti('karsi', 1, 3300);
  await s.oturum.bosalinca();
  assert.equal(satirOf(s, 'karsi:1')!.kesin, true);
  assert.equal(satirOf(s, 'karsi:1')!.metin, 'metin 3.2', 'son geçiş bütün sesi kapsar');
});

test('çeviri: kısmi metin uzayınca hafif ÖN ÇEVİRİ (soluk), kesin çeviri gelince yerini alır; satır başına en çok 2 çağrı; yerel yapay zekâda yok', async () => {
  const uzun = 'Thanks everyone for joining us today, let us start with the release timeline and the budget';
  const s = akisSahne({ onCeviri: true });
  s.oturum.baslat();
  s.oturum.sesGeldi('karsi', 1, blok(), 0);
  const a = s.akislar.karsi!;
  a.ev.kismi(uzun.split(' ').slice(0, 9).join(' '), 1);
  await new Promise((r) => setTimeout(r, 20));
  const on = satirOf(s, 'karsi:1')!;
  assert.equal(on.ceviriDurum, 'on');
  assert.ok(on.ceviri?.startsWith('[TR] Thanks'));
  a.ev.kismi(uzun.split(' ').slice(0, 11).join(' '), 1); // 2,5 sn dolmadı: yeni çağrı yok
  a.ev.kismi(uzun, 1);
  assert.equal(s.yz.filter((x) => x.i.amac === 'toplantı çevirisi').length, 1);
  s.oturum.konusmaBitti('karsi', 1, 3000);
  a.ev.kesin(`${uzun}.`, 1);
  await s.oturum.bosalinca();
  const l = satirOf(s, 'karsi:1')!;
  assert.equal(l.ceviriDurum, 'tamam');
  assert.equal(l.ceviri, `[TR] ${uzun}.`);
  const g = akisSahne({ onCeviri: true, bulutsuz: true, whisperCevir: async () => uzun });
  for (let i = 0; i < 20; i++) g.oturum.sesGeldi('karsi', 1, blok(), i * 80);
  await g.oturum.bosalinca();
  assert.equal(g.yz.filter((x) => x.i.amac === 'toplantı çevirisi').length, 0, 'yerel yapay zekâda ön çeviri yok (Whisper\'ı yavaşlatmasın)');
});

test('robot düşük öncelik: çeviri sürerken öneri bekler; çeviri robotun arkasında kalmaz', async () => {
  const sira: string[] = [];
  const s = akisSahne({
    robot: true,
    yz: async (i) => {
      sira.push(`${i.amac}:başla`);
      if (i.amac === 'toplantı çevirisi') await new Promise((r) => setTimeout(r, 120));
      sira.push(`${i.amac}:bitti`);
      return sahteYz(i);
    },
  });
  s.oturum.baslat();
  s.oturum.sesGeldi('karsi', 1, blok(), 0);
  s.oturum.konusmaBitti('karsi', 1, 500);
  s.akislar.karsi!.ev.kesin('Can you ship the release on Friday?', 1);
  await s.oturum.bosalinca();
  assert.ok(sira.indexOf('toplantı yanıt önerisi:başla') > sira.indexOf('toplantı çevirisi:bitti'), sira.join(' > '));
  assert.equal(son(s).oneriler.length, 1);
  assert.equal(son(s).oneriler[0].durum, 'hazir');
});

test('hafif yayın: her güncellemede yalnız DEĞİŞEN satırlar gider (yama); arayüz yamayı dökümüne uygular, değişmeyen satırların nesnesi aynı kalır', async () => {
  const s = akisSahne({ hafif: true });
  s.oturum.baslat();
  for (let i = 1; i <= 30; i++) {
    s.oturum.sesGeldi('karsi', i, blok(), i * 1000);
    s.akislar.karsi!.ev.kismi(`Satır numarası ${i} burada yazıyor`, s.akislar.karsi!.no);
    s.oturum.konusmaBitti('karsi', i, i * 1000 + 800);
    s.akislar.karsi!.ev.kesin(`Satır numarası ${i} burada yazıyor.`, s.akislar.karsi!.no);
    await new Promise((r) => setTimeout(r, 1));
  }
  await s.oturum.bosalinca();
  const hafifler = s.durumlar.filter((d) => d.yama);
  assert.ok(hafifler.length >= 20, `${hafifler.length} yayın`);
  assert.ok(hafifler.every((d) => d.satirlar.length === 0), 'hafif yayında satırlar boş');
  assert.ok(hafifler.every((d) => d.yama!.satirlar.length <= 4), `yama en çok ${Math.max(...hafifler.map((d) => d.yama!.satirlar.length))} satır`);
  // Arayüz tarafı: yamalar sırayla uygulanınca döküm, tam durumla aynı.
  let ui: ToplantiDurumu | null = null;
  const eskiNesne = new Map<string, unknown>();
  for (const d of s.durumlar) {
    ui = yamaUygula(ui, d);
    for (const x of ui.satirlar) eskiNesne.set(x.id, x);
  }
  assert.deepEqual(ui!.satirlar.map((x) => [x.id, x.metin, x.kesin, x.ceviri]), son(s).satirlar.map((x) => [x.id, x.metin, x.kesin, x.ceviri]));
  // Değişmeyen satırın nesnesi aynı kalır (React.memo yeniden çizmez).
  const once = ui!.satirlar;
  const sonraki = yamaUygula(ui, { ...ui!, satirlar: [], yama: { satirlar: [{ ...once[0], metin: once[0].metin }], silinen: [] } });
  assert.notEqual(sonraki.satirlar[0], once[0]);
  assert.equal(sonraki.satirlar[1], once[1]);
  assert.equal(sonraki.satirlar.length, once.length);
});

test('yamaUygula: silinen kimlik düşer; yeni satır doğru sıraya girer; başka toplantının durumu karışmaz; yama yoksa durum aynen', () => {
  const sat = (id: string, basMs: number, konusan: Konusan = 'karsi') => ({ id, konusan, basMs, metin: id, kesin: true, dil: null, ceviriDurum: 'yok' as const });
  const taban = { id: 't1', satirlar: [sat('karsi:1', 1000), sat('karsi:3', 5000)] } as unknown as ToplantiDurumu;
  const y = yamaUygula(taban, { id: 't1', satirlar: [], yama: { satirlar: [sat('karsi:2', 3000)], silinen: ['karsi:3'] } } as unknown as ToplantiDurumu);
  assert.deepEqual(y.satirlar.map((x) => x.id), ['karsi:1', 'karsi:2']);
  assert.equal(y.yama, undefined);
  const baska = yamaUygula(taban, { id: 't2', satirlar: [], yama: { satirlar: [sat('karsi:9', 1)], silinen: [] } } as unknown as ToplantiDurumu);
  assert.deepEqual(baska.satirlar.map((x) => x.id), ['karsi:9']);
  const tam = { id: 't1', satirlar: [sat('a', 1)] } as unknown as ToplantiDurumu;
  assert.equal(yamaUygula(taban, tam), tam);
});

test('2 saatlik toplantı: 1.440 satır (5 sn ortalama) sorunsuz — bellek sabit (ses tutulmaz, bekleyen iş kalmaz), yayın başına yama küçük, durdur özetler', async () => {
  const s = akisSahne({ hafif: true, yz: async (i) => (i.amac === 'toplantı çevirisi' ? `[TR] ${i.kullanici}` : sahteYz(i)) });
  s.oturum.baslat();
  const k = s.akislar.karsi!;
  const t0 = Date.now();
  for (let i = 1; i <= 1440; i++) {
    s.oturum.sesGeldi('karsi', i, blok(), i * 5000);
    k.ev.kismi(`Line ${i} partial text`, k.no);
    s.oturum.konusmaBitti('karsi', i, i * 5000 + 4000);
    k.ev.kesin(`Line ${i} final text is right here.`, k.no);
    if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await s.oturum.bosalinca();
  const sureMs = Date.now() - t0;
  assert.ok(sureMs < 15_000, `1.440 satır ${sureMs} ms`);
  const d = son(s);
  assert.equal(d.satirlar.length, 1440);
  assert.ok(d.satirlar.every((x) => x.kesin && x.ceviriDurum === 'tamam'));
  // Hâlâ bekleyen iş yok: akış eşleme tabloları boş, ses tutulmuyor (sahte akış yalnız KENDİ kaydını tutar).
  assert.equal(s.oturum['akisSatirlari'].karsi.size, 0);
  assert.equal(s.oturum['isler'].size, 0);
  assert.equal(s.oturum['ceviriSirasi'].length, 0);
  assert.ok(s.durumlar.filter((x) => x.yama).every((x) => x.yama!.satirlar.length <= 30), 'her yayın küçük (bütün döküm değil)');
  const ozetli = await s.oturum.durdur();
  assert.equal(ozetli.hal, 'bitti');
  assert.ok(ozetli.ozet);
  assert.ok(s.akislar.karsi!.kapali && s.akislar.siz!.kapali, 'durdurunca akışlar kapandı');
});

test('durdur: akışta commit\'i gitmiş satırın kesin metni beklenir; gelmezse elde kalan kısmi metinle kesinleşir (metin kaybolmaz); akışlar kapanır', async () => {
  const s = akisSahne();
  s.oturum.baslat();
  s.oturum.sesGeldi('karsi', 1, blok(), 0);
  s.akislar.karsi!.ev.kismi('Sadece kısmi metin geldi', 1);
  s.oturum.konusmaBitti('karsi', 1, 400);
  s.oturum['d'].kapanisBeklemeMs = 300;
  const r = await Promise.race([s.oturum.durdur(), new Promise<null>((c) => { setTimeout(() => c(null), 15_000).unref(); })]);
  assert.ok(r, 'durdur asılı kalmadı');
  assert.equal(r!.satirlar[0].metin, 'Sadece kısmi metin geldi');
  assert.equal(r!.satirlar[0].kesin, true);
  assert.ok(s.akislar.karsi!.kapali);
});

test('yerel kesme: kesintisiz uzun konuşmada pencere ≤ ~7 sn kalır — satır en sessiz blokta (kelime ortasında değil) kesilir, baştaki kısım kesinleşir, kalan devam satırında sürer; VAD bitişi devam satırını kapatır', async () => {
  const pencereler: number[] = [];
  const s = akisSahne({ bulutsuz: true, whisperCevir: async (wav) => { const sn = wavdanPcm(wav)!.pcm.length / 32000; pencereler.push(sn); return `pencere ${sn.toFixed(1)}`; } });
  // 14 sn "konuşma": 80 ms bloklar; 5,2 sn'de tek sessiz blok (cümle içi duraklama), gerisi gürültülü.
  const yuksek = () => { const b = new Uint8Array(BLOK_BAYT); const v = new Int16Array(b.buffer); for (let i = 0; i < v.length; i++) v[i] = i % 2 ? 6000 : -6000; return b; };
  const sessizBlok = () => new Uint8Array(BLOK_BAYT);
  const toplam = Math.round(14 / 0.08);
  for (let i = 0; i < toplam; i++) {
    s.oturum.sesGeldi('karsi', 7, i === Math.round(5.2 / 0.08) ? sessizBlok() : yuksek(), 10_000 + i * 80);
    if (i % 10 === 9) await new Promise((r) => setTimeout(r, 5));
  }
  s.oturum.konusmaBitti('karsi', 7, 10_000 + 14_000);
  await s.oturum.bosalinca();
  const satirlar = son(s).satirlar.filter((x) => x.konusan === 'karsi');
  assert.ok(satirlar.length >= 3, `satırlar: ${satirlar.map((x) => x.id).join(', ')}`);
  assert.deepEqual(satirlar.slice(0, 3).map((x) => x.id), ['karsi:7', 'karsi:7.1', 'karsi:7.2']);
  assert.ok(satirlar.every((x) => x.kesin), 'hepsi kesinleşti');
  assert.ok(Math.max(...pencereler) <= 7.01, `en uzun pencere ${Math.max(...pencereler)} sn`);
  // İlk satır sessiz bloğun hemen sonunda biter (≈ 5,2–5,3 sn), kelime ortası değil.
  assert.ok(Math.abs(Number(satirlar[0].metin.match(/[\d.]+/)![0]) - 5.3) < 0.3, satirlar[0].metin);
  assert.ok(satirlar[1].basMs > satirlar[0].basMs && satirlar[2].basMs > satirlar[1].basMs, 'satırlar zaman sırasında');
  assert.equal(s.oturum['devam'].size, 0, 'bitişte devam eşlemesi temizlendi');
});
