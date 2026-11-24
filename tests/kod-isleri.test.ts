// Görev 26 (gerçek motorla uçtan uca; K17/K18): İş modunda Fuber kendini "Claude Code oturumlarını bulur, işi oraya devrederim" diye
// tanıtıyordu — kişilikteki "Kod işleri" bölümü ve sohbetin Claude Code araçları moda bakmıyordu. Artık ikisi de yalnız Geliştirici'de.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kodIsleriBolumu, komutNotu } from '../src/main/ajan/kod-isleri.ts';
import { ccSohbetteAcik } from '../src/shared/cc-ayar.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';

const kaynak = (y: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', y), 'utf8');

const acik = { mod: 'gelistirici', etkin: true, kurulu: true };
test('kişiliğin "Kod işleri" bölümü yalnız Geliştirici modunda; İş modunda Claude Code adı modele hiç verilmez', () => {
  assert.equal(kodIsleriBolumu({ ...acik, mod: 'is' }, 'Deniz'), '');
  const g = kodIsleriBolumu(acik, 'Deniz');
  assert.match(g, /# KOD İŞLERİ \(kendin yap, büyük kod işini Claude Code'a ver\)/);
  assert.match(g, /claude_code_gorev/);
  assert.match(g, /Deniz'nın bilgisayarındaki Claude Code'a/);
  // kisilik.ts bölümü yalnız bu işlevden alır: kişiliğin düz metninde Claude / claude_code_ kalmadı.
  const k = kaynak('src/main/ajan/kisilik.ts');
  assert.match(k, /\$\{kodIsleriBolumu\(kod, kullanici\)\}/);
  assert.doesNotMatch(k.replace(/^(import|\s*\/\/).*$/gm, ''), /Claude|claude_code_/);
  assert.equal(isDiliIhlali(kodIsleriBolumu({ ...acik, mod: 'is' }, 'Deniz')), null);
});

// Son inceleme (G26 küçüğü): bölüm, araçlarla AYNI kapıdan (mod + yönetici açık + claude.exe kurulu) — araçsız "devret" sözü yok; metin
// uygulama içi oturumu anlatır (terminal değil).
test('"Kod işleri" bölümü araçlarla aynı kapıdan: yönetici kapalıyken ya da claude.exe yokken bölüm de yok; terminal anlatılmaz', () => {
  assert.equal(kodIsleriBolumu({ ...acik, etkin: false }, 'Deniz'), '', 'yönetici kapalı');
  assert.equal(kodIsleriBolumu({ ...acik, kurulu: false }, 'Deniz'), '', 'claude.exe yok');
  for (const [mod, etkin, kurulu] of [['is', true, true], ['gelistirici', true, true], ['gelistirici', false, true], ['gelistirici', true, false]] as const) {
    assert.equal(kodIsleriBolumu({ mod, etkin, kurulu }, 'D') !== '', ccSohbetteAcik(mod, etkin, kurulu), `${mod}/${etkin}/${kurulu}`);
  }
  assert.doesNotMatch(kodIsleriBolumu(acik, 'Deniz'), /Terminali açtıktan|terminali/i);
  assert.match(kodIsleriBolumu(acik, 'Deniz'), /Claude Code sayfasında/);
  // kisilik.ts kapının üç girdisini ayarlardan ve kurulu claude.exe'den verir.
  assert.match(kaynak('src/main/ajan/kisilik.ts'), /const kod = \{ mod: a\.mod, etkin: a\.claudeCode\.etkin, kurulu: a\.mod === 'gelistirici' && a\.claudeCode\.etkin && Boolean\(claudeYolu\(\)\) \};/);
});

// 0.14 T13 (model yalnız sohbet ediyor, Claude Code gibi her yere bağlanıp iş yapamıyordu): bölüm artık "devret" demez — küçük kod ve dosya
// işini Fuber kendi araçlarıyla yapar; yalnız büyük kod işi (çok dosyalı değişiklik, proje çapında iş) Claude Code oturumuna verilir.
test('bölüm "kendin yap, büyük kod işini Claude Code\'a ver" der; "devret" emri yok', () => {
  const g = kodIsleriBolumu(acik, 'Deniz');
  assert.match(g, /kendin yap, büyük kod işini Claude Code'a ver/);
  assert.doesNotMatch(g, /devr?e[dt]/i, '"devret" / "devrederim" yok');
  assert.doesNotMatch(g, /KENDİN yapma/, 'eski "kendin yapma" emri yok');
  assert.match(g, /KENDİN yap/);
  assert.match(g, /dosya_duzenle|dosya_yaz/, 'küçük iş için Fuber\'in kendi dosya araçları');
  assert.match(g, /komut_calistir/, 'küçük iş için komut');
  assert.match(g, /Büyük kod işini[^\n]*claude_code_gorev/, 'büyük iş Claude Code oturumuna');
  assert.equal(kodIsleriBolumu({ ...acik, mod: 'is' }, 'Deniz'), '', 'İş modunda bölüm yok (kapı aynı)');
});

// 0.14 T13 düzeltme turu 1 (Minor 2): ARAÇ NOTLARI'nın komut (PowerShell) satırı yalnız Developer mode'da modele gider — kodIsleriBolumu ile aynı desen;
// ajan döngüsü satırı bu işlevden alır (Business mode'da istemde yok: tests/arac-zinciri.test.ts).
// Düzeltme turu 2 (Minor 4): girdi turun KİLİTLİ kipi (karakter.kip), canlı ayar değil.
test('komut satırı yalnız Developer mode\'da (komutNotu, turun kilitli kipiyle); Business mode\'da boş', () => {
  assert.equal(komutNotu('business'), '');
  assert.match(komutNotu('developer'), /^- Komut: komut_calistir ile PowerShell komutu çalıştır/);
  assert.match(komutNotu('developer'), /onay ister/);
  const d = kaynak('src/main/ajan/dongu.ts');
  assert.match(d, /komutNotu\(kip\)/);
  assert.match(d, /aracNotlari\(disarida, karakter\.kip, Boolean\(girdi\.gorev\)\)/, 'kilitli kip (ayarlar().mod değil)');
});

test('sohbetin Claude Code araçları yalnız Geliştirici + etkin + kurulu iken', () => {
  assert.equal(ccSohbetteAcik('is', true, true), false);
  assert.equal(ccSohbetteAcik('gelistirici', true, true), true);
  assert.equal(ccSohbetteAcik('gelistirici', false, true), false);
  assert.equal(ccSohbetteAcik('gelistirici', true, false), false);
  assert.match(kaynak('src/main/ajan/dongu.ts'), /if \(grup === 'claudecode'\) return ccSohbetteAcik\(a\.mod, a\.claudeCode\.etkin, Boolean\(claudeYolu\(\)\)\);/);
});
