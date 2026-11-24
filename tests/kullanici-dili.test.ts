// Kullanıcıya görünen dil temizliği (0.13 T15, Spec H): Etkinlik'te "Parçalar" ve bölge adları (Akıl, Bekçi, Eşlikçi, Raporcu, Not tutucu,
// Kulak, Göz, El, Uyanma) yok; Ayarlar'da kullanıcı API anahtarı girdisi yok; motor seçici kullanıcının kayıtlı anahtarını OKUMAZ
// (kayıtlı sırlar diskte kalır, yalnız artık kullanılmaz). 0.14 (ürün kararı) istisnası: YALNIZ Developer mode'da Anthropic
// (Claude) anahtarı ve sağlayıcı seçimi — Business davranışı aynen korunur (aşağıdaki testler ve tests/claude-anahtari.test.ts). İç kimlikler (src/shared/beyin.ts: el, goz, kulak…) değişmez — bu test yalnız
// kullanıcıya görünen dizgeleri tarar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import {
  BOLGELER, BAGLAR, bolgeMetni, bolgeKapaliNedeni, durumOzeti, olayMetni, type BeyinOlayi, type BolgeId, type KapaliGirdisi,
} from '../src/shared/beyin.ts';
import * as etkinlik from '../src/shared/etkinlik.ts';
import { KATEGORILER } from '../src/renderer/ayarlar/dizin.ts';
import { DEVELOPER_KAPSAMI } from '../src/shared/kurulum-taslak.ts';


const kaynak = (y: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', y), 'utf8');

/** Eski bölge adları: kullanıcıya görünen hiçbir dizgede bölge adı olarak geçmez. "Not tutucu" iki sözcük; "El" ve "Göz" yalnız tam sözcük. */
const ESKI_AD = /(?<![\p{L}\p{N}])(?:Akıl|Bekçi|Eşlikçi|Raporcu|Not tutucu|Kulak|Göz|El|Uyanma)(?![\p{L}\p{N}])/u;
/** Küçük harfli biçimler de ("eşlikçi", "raporcu"…): bu sözcüklerin başka anlamı yok. */
const ESKI_AD_KUCUK = /(?<![\p{L}\p{N}])(?:eşlikçi|raporcu|bekçi|not tutucu)(?:nin|nın|ya|ye|yı|yi|ler|lar|[’'])?(?![\p{L}\p{N}])/iu;

// Kaynaktan blok ve satır yorumları atılır (kullanıcı görmez).
const yorumsuz = (y: string) => kaynak(y).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Bir kaynak dosyadaki dizge değişmezleri (yorumlar atılır): '…', "…", `…` içi. */
function dizgeler(y: string): string[] {
  const ham = yorumsuz(y);
  return [...ham.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

/** src altındaki bütün kaynaklar (kök: depo kökü). */
function kaynaklar(kok: string): string[] {
  const tam = path.resolve(import.meta.dirname, '..', kok);
  return fs.readdirSync(tam, { withFileTypes: true }).flatMap((e) => {
    const y = `${kok}/${e.name}`;
    if (e.isDirectory()) return kaynaklar(y);
    return /\.tsx?$/.test(e.name) ? [y] : [];
  });
}
/** Dosyanın kullanıcıya görünebilecek metinleri: dizge değişmezleri ve JSX yazısı (`>…<` arası; `{…}` parçalı cümleler de bütün kalır). */
const metinler = (y: string): string[] => [...dizgeler(y), ...[...yorumsuz(y).matchAll(/>([^<>]+)</g)].map((m) => m[1])];

test('0.13 son düzeltme 3: Ayarlar → Genel\'in Developer kartı kurulumdaki kapsamı söyler (aynı kaynak: Claude Code, MCP, yerel model ayrıntısı)', () => {
  assert.deepEqual(DEVELOPER_KAPSAMI.map(([, m]) => m), ['Business mode’daki her şey', 'Claude Code sayfası', 'Kullanım ayrıntısı ve araçlar']);
  const genel = yorumsuz('src/renderer/ayarlar/Genel.tsx');
  assert.match(genel, /DEVELOPER_KAPSAMI/);
  assert.match(genel, /Claude Code, MCP ve yerel model ayrıntıları/);
  assert.doesNotMatch(genel, /motoru ve düşünme gücünü seçersin|Motor ve düşünme gücü seçimi/, 'motor seçimi de kalktı');
  assert.match(yorumsuz('src/renderer/kurulum2/adimlar/Kip.tsx'), /maddeler: DEVELOPER_KAPSAMI/);
});

test("Etkinlik'te Parçalar yok: bölüm, hap ve parça listesi kalktı; akış tek sütun", () => {
  const tsx = yorumsuz('src/renderer/sayfalar/Etkinlik.tsx');
  assert.doesNotMatch(tsx, /Parçalar|parcaListesi|etk-parca|etk-hap|Çalışan parçalar/);
  assert.doesNotMatch(yorumsuz('src/renderer/sayfalar/etkinlik.css'), /etk-parca|etk-hap/);
  assert.equal('parcaListesi' in etkinlik, false, 'shared/etkinlik.ts parça listesi vermez');
  assert.equal(typeof etkinlik.akisSatirlari, 'function', 'akış satırları saf işlevden');
});

test('bölge adları (BOLGELER.ad) eski adlardan biri değil; her bölgenin metni ve her olay satırı eski ad taşımaz', () => {
  const eski = new Set(['Akıl', 'Bekçi', 'Eşlikçi', 'Raporcu', 'Not tutucu', 'Kulak', 'Göz', 'El', 'Uyanma']);
  for (const b of BOLGELER) {
    assert.ok(!eski.has(b.ad), `${b.id}: ${b.ad}`);
    for (const mod of ['is', 'gelistirici'] as const) {
      const m = bolgeMetni(b, mod);
      assert.doesNotMatch(`${b.ad} ${m.ne} ${m.nasil}`, ESKI_AD, `${b.id}/${mod}`);
      assert.doesNotMatch(`${b.ad} ${m.ne} ${m.nasil}`, ESKI_AD_KUCUK, `${b.id}/${mod}`);
    }
  }
  assert.equal(new Set(BOLGELER.map((b) => b.ad)).size, BOLGELER.length, 'adlar birbirinden ayrı');
  // Bağların kısa adları ve Akış satırları.
  for (const [, , ne] of BAGLAR) assert.doesNotMatch(ne, ESKI_AD);
  const ev = (o: Partial<BeyinOlayi>): BeyinOlayi => ({ id: 1, zaman: '', tur: 'basla', bolge: 'ajan', ...o } as BeyinOlayi);
  const kimlikler = BOLGELER.map((b) => b.id);
  for (const mod of ['is', 'gelistirici'] as const) {
    for (const a of kimlikler) {
      for (const o of [
        ev({ tur: 'basla', bolge: a, metin: 'çalışıyor' }), ev({ tur: 'bitti', bolge: a, hata: true }), ev({ tur: 'motor', faz: 'istek', bolge: a, motor: 'fuber' }),
        ev({ tur: 'motor', faz: 'yanit', bolge: a, motor: 'fuber', sure: 900 }), ev({ tur: 'sinyal', bolge: a, hedef: a === 'ajan' ? 'ses' : 'ajan' }),
        ev({ tur: 'sinyal', bolge: 'ajan', hedef: a, metin: 'sonuç' }),
      ]) {
        const s = olayMetni(o, mod);
        if (s) assert.doesNotMatch(`${s.ust} ${s.alt ?? ''}`, ESKI_AD, `${mod} ${JSON.stringify(o)}`);
      }
    }
  }
  assert.doesNotMatch(Object.values(durumOzeti('bos', [], true)).join(' '), ESKI_AD);
  assert.doesNotMatch(Object.values(durumOzeti('dusunuyor', BOLGELER.map((b) => b.ad))).join(' '), ESKI_AD);
  // Kapalı nedenleri de bölge adı vermez ("Eşlikçi kapalı (Ayarlar → Gün kaydı)" gibi).
  const tam: KapaliGirdisi = { mod: 'is', mikrofonKapali: false, uyandirma: false, seslendirme: false, gunKaydi: false, eslikciKapali: true, bilgisayar: false, tarayici: false, iletisimVar: false, kopruCalisiyor: false, motor: 'hazir', claudeCodeEtkin: false, claudeBulundu: false };
  for (const b of kimlikler as BolgeId[]) assert.doesNotMatch(bolgeKapaliNedeni(b, tam) ?? '', ESKI_AD, b);
  assert.doesNotMatch(bolgeKapaliNedeni('eslikci', { ...tam, gunKaydi: true }) ?? '', ESKI_AD_KUCUK);
});
