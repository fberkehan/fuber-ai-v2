// 0.12 H3c (spec §1 adım 5, Hedefler §5): "Nerede çalışsın?" — Bulut (önerilen) · Yalnız bu bilgisayar · Gizli. Kurulumun adımı ve Ayarlar →
// Gizlilik aynı kuralı okur (shared/nerede.ts). "Yalnız bu bilgisayar" Gizli DEĞİLDİR: yapay zekâ yereldir, hesap ve eşitleme sürer; Gizli'de
// hiçbir hesap işlemi ağa çıkmaz. Y1 (H3b yeniden incelemesi): Nerede'nin ön seçimi taslaktan değil — o anki GERÇEK Gizli hâli + kullanıcının bu
// kurulumdaki son AÇIK seçimi; hesap adımında Gizli'den çıkıldıysa Nerede "Fuber" ile gelir (Gizli yeniden açılmaz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  NEREDE_SECENEKLERI, gizliKapanincaSecim, neredeAciklamasi, neredeHali, neredeOnSecimi, neredeYamasi, sesBuBilgisayarda, neredeYerelMi, BAGLANTI_DENENMEZ, type Nerede,
} from '../src/shared/nerede.ts';
import { taslakBaslangici } from '../src/shared/kurulum-taslak.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';

const oku = (y: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', y), 'utf8');

test('üç seçenek, etiketler birebir: "Bulut (önerilen)", "Yalnız bu bilgisayar", "Gizli"; açıklamalar İş dilinde, tek cümle', () => {
  assert.deepEqual(NEREDE_SECENEKLERI.map((s) => s.deger), ['fuber', 'yerel', 'gizli']);
  assert.deepEqual(NEREDE_SECENEKLERI.map((s) => s.etiket), ['Bulut (önerilen)', 'Yalnız bu bilgisayar', 'Gizli']);
  assert.deepEqual(NEREDE_SECENEKLERI.map((s) => s.baslik), ['Bulut', 'Yalnız bu bilgisayar', 'Gizli']);
  for (const mod of ['is', 'gelistirici'] as const) {
    for (const s of NEREDE_SECENEKLERI) {
      const a = neredeAciklamasi(s.deger, mod);
      assert.ok(a.length > 0 && a.length <= 72, `kısa (520 px'te en çok iki satır): ${s.deger}: ${a}`);
      assert.equal((a.match(/[.!?](\s|$)/g) ?? []).length <= 1, true, `tek cümle: ${a}`);
      assert.doesNotMatch(a, /'/, a);
      if (mod === 'is') assert.equal(isDiliIhlali(a), null, a);
    }
  }
  // Fark tek cümlede: Yalnız bu bilgisayar'da hesap ve eşitleme sürer (gizlilik sözü yok); Gizli'de hesap ağa çıkmaz.
  const y = neredeAciklamasi('yerel', 'is');
  // Ö1 (düzeltme turu 1): ses de bu bilgisayarda.
  assert.equal(y, 'Yanıtlar ve ses bu bilgisayarda üretilir; hesap ve eşitleme açık kalır.');
  assert.doesNotMatch(y, /gizli|bu bilgisayarda kalır|bulutsuz/i);
  assert.equal(neredeAciklamasi('gizli', 'is'), 'Yanıtlar burada üretilir; bulut yapay zekâ kapalı.');
});

test('neredeHali: Gizli önce; yalnızYerel → "Yalnız bu bilgisayar"; ikisi de kapalı → Fuber', () => {
  assert.equal(neredeHali({ gizliMod: true, yalnizYerel: true }), 'gizli');
  assert.equal(neredeHali({ gizliMod: false, yalnizYerel: true }), 'yerel');
  assert.equal(neredeHali({}), 'fuber');
});

test('Y1: ön seçim = açık seçim varsa o, yoksa GERÇEK hâl; hesap adımında Gizli\'den çıkılınca Nerede "Fuber" ile gelir', () => {
  // Yeniden açılan kurulum, Gizli açık: taslakta açık seçim YOK (null); ön seçim gerçek hâlden "Gizli".
  const t = taslakBaslangici({ yerel: { gizliMod: true } }, 'yeniden');
  assert.equal(t.nerede, null, 'taslak Gizli\'yi kopyalamaz');
  assert.equal(neredeOnSecimi({ secim: t.nerede, gizliMod: true, yalnizYerel: false, hesapsiz: false }), 'gizli');
  // Hesap adımında "Gizli moddan çık ve devam et": gerçek hâl değişir → ön seçim Fuber (Gizli yeniden açılmaz).
  assert.equal(neredeOnSecimi({ secim: t.nerede, gizliMod: false, yalnizYerel: false, hesapsiz: false }), 'fuber');
  // Bu kurulumda daha önce AÇIKÇA Gizli seçilmişti (Nerede'den ileri geçildi), sonra hesap adımında Gizli'den çıkıldı: açık seçim düşer.
  assert.equal(gizliKapanincaSecim('gizli', true, false), null);
  assert.equal(neredeOnSecimi({ secim: gizliKapanincaSecim('gizli', true, false), gizliMod: false, yalnizYerel: false, hesapsiz: false }), 'fuber');
  // Öteki açık seçimler ve Gizli açılırken hiçbir şey düşmez; kullanıcı yine Gizli'yi seçebilir (açık seçim).
  for (const s of ['fuber', 'yerel', null] as (Nerede | null)[]) assert.equal(gizliKapanincaSecim(s, true, false), s);
  assert.equal(gizliKapanincaSecim('gizli', false, true), 'gizli');
  assert.equal(gizliKapanincaSecim('gizli', true, true), 'gizli');
  assert.equal(neredeOnSecimi({ secim: 'gizli', gizliMod: false, yalnizYerel: false, hesapsiz: false }), 'gizli');
  // Yeni kurulum: Bulut (önerilen); hesapsız geçişte yapay zekâ bu bilgisayarda olmalı → "Yalnız bu bilgisayar".
  assert.equal(taslakBaslangici({}, 'ilk').nerede, null);
  assert.equal(neredeOnSecimi({ secim: null, gizliMod: false, yalnizYerel: false, hesapsiz: false }), 'fuber');
  assert.equal(neredeOnSecimi({ secim: null, gizliMod: false, yalnizYerel: false, hesapsiz: true }), 'yerel');
  assert.equal(neredeOnSecimi({ secim: null, gizliMod: false, yalnizYerel: true, hesapsiz: false }), 'yerel');
  // Arayüz bu kuralı okur (taslaktan kopya değil): Kurulum2 gerçek Gizli kapanınca açık "Gizli" seçimini düşürür.
  const k = oku('src/renderer/kurulum2/Kurulum2.tsx');
  assert.match(k, /gizliKapanincaSecim\(/);
  assert.match(k, /neredeOnSecimi\(/);
  assert.doesNotMatch(oku('src/shared/kurulum-taslak.ts'), /nerede: a\.yerel\?\.gizliMod \? 'gizli'/);
});

test('neredeYamasi: yalnız değişen alanlar; Gizli ve "Yalnız bu bilgisayar" birbirini dışlar; kurulu yerel açılır', () => {
  assert.deepEqual(neredeYamasi('fuber', { gizliMod: true, yalnizYerel: false, etkin: true }, true), { gizliMod: false });
  assert.deepEqual(neredeYamasi('fuber', { gizliMod: false, yalnizYerel: true, etkin: true }, true), { yalnizYerel: false });
  assert.equal(neredeYamasi('fuber', { gizliMod: false, yalnizYerel: false, etkin: true }, true), null);
  assert.deepEqual(neredeYamasi('yerel', { gizliMod: false, yalnizYerel: false, etkin: false }, true), { yalnizYerel: true, etkin: true });
  assert.deepEqual(neredeYamasi('yerel', { gizliMod: true, yalnizYerel: false, etkin: true }, true), { gizliMod: false, yalnizYerel: true });
  assert.deepEqual(neredeYamasi('yerel', { gizliMod: false, yalnizYerel: false, etkin: false }, false), { yalnizYerel: true });
  assert.deepEqual(neredeYamasi('gizli', { gizliMod: false, yalnizYerel: true, etkin: true }, true), { gizliMod: true, yalnizYerel: false });
  assert.deepEqual(neredeYamasi('gizli', { gizliMod: false, yalnizYerel: false, etkin: false }, false), { gizliMod: true });
  assert.equal(neredeYamasi('gizli', { gizliMod: true, yalnizYerel: false, etkin: true }, true), null);
});

// ── H3c düzeltme turu 2 (yeniden inceleme 1) ──
test('K1-a (düzeltme turu 2): Ayarlar → "Bu bilgisayardaki yapay zekâ" anahtarını kapatmak "Yalnız bu bilgisayar"ı KAPATMAZ — kendiliğinden Fuber yok ("hazır değil" kartı iki seçimi sunar); Gizli F1 gereği kapanır', () => {
  const g = oku('src/renderer/ayarlar/Gizlilik.tsx');
  const satir = g.split('\n').find((l) => l.includes('etiket={buyukBasla(yerel)}')) ?? '';
  assert.ok(satir, 'anahtar satırı');
  assert.doesNotMatch(satir, /yalnizYerel: false/, 'seçim sessizce Fuber’e dönmez');
  assert.match(satir, /gizliMod: false/, 'Gizli kapanır (F1)');
});

test('Kü (düzeltme turu 2): "Yalnız bu bilgisayar" / Gizli seçiliyken Gizlilik’te İKİNCİ kurulum yolu yok — "Kur · N GB" düğmesi ve anahtarın kurması Nerede’ye bırakılır', () => {
  const g = oku('src/renderer/ayarlar/Gizlilik.tsx');
  assert.match(g, /const neredeYerel = neredeYerelMi\(y\);/);
  assert.match(g, /!kurulu && neredeYerel \? null/, '"Kur · N GB" çizilmez');
  assert.match(g, /devreDisi=\{!kurulu && neredeYerel\}/, 'anahtar kurulum başlatmaz');
});

test('Kü (düzeltme turu 2): "Bağlantıyı dene" yalnız/Gizli’de buluta istek göndermez — ana süreç reddeder, düğme kapalı ve kısa neden', () => {
  assert.equal(neredeYerelMi({ gizliMod: true }), true);
  assert.equal(neredeYerelMi({ yalnizYerel: true }), true);
  assert.equal(neredeYerelMi({ yalnizYerel: false, gizliMod: false }), false);
  assert.equal(neredeYerelMi(null), false);
  assert.match(BAGLANTI_DENENMEZ, /buluttaki yapay zekâ kapalı/);
  assert.doesNotMatch(BAGLANTI_DENENMEZ, /'/);
  const ipc = oku('src/main/ipc.ts');
  const sina = ipc.slice(ipc.indexOf("h('motor:sina'"), ipc.indexOf("h('motor:modeller'"));
  assert.match(sina, /if \(neredeYerelMi\(ayarlar\(\)\.yerel\)\) return \{ tamam: false, hata: BAGLANTI_DENENMEZ \};/);
  assert.ok(sina.indexOf('neredeYerelMi(') < sina.indexOf('.sohbet('), 'istekten ÖNCE');
  // 0.13 T15: "Bağlantıyı dene" düğmesinin olduğu motor anahtar kartı (MotorKarti) kalktı; ana süreç kapısı yine yerinde.
  assert.doesNotMatch(oku('src/renderer/bilesenler/Formlar.tsx'), /MotorKarti/);
});

// ── H3c takip turu ──
test('Takip 4: satır içi boyut onayı odak yönetir (açılınca "İndir"e, Esc/Vazgeç’te tetikleyiciye) ve Ayarlar’daki gibi "İstediğin an durdurabilirsin" der', () => {
  const y = oku('src/renderer/bilesenler/YerelYenidenIndir.tsx');
  assert.match(y, /onaylaRef\.current\?\.focus\(/);
  assert.match(y, /e\.key === 'Escape'/);
  assert.match(y, /tetikRef\.current\?\.focus\(/);
});

test('Takip 7: devre dışı "Bu bilgisayardaki yapay zekâ" anahtarı kısa nedenini yazar', () => {
  const g = oku('src/renderer/ayarlar/Gizlilik.tsx');
  assert.match(g, /ek=\{!kurulu && neredeYerel \? YEREL_ANAHTAR_NEDENI : undefined\}/);
  assert.match(g, /const YEREL_ANAHTAR_NEDENI = ' Sürümü yukarıdaki “Nerede çalışsın”dan kurarsın\.';/);
});
