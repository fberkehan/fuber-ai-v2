// I5 (son inceleme): Fuber kendi akıl yürütmesini anlatmaz — özellikle sesli turda. G26 gerçek motorla gördü: düşük düşünme gücünde araçtan
// önce "Kullanıcı yeni bir oturum açmamı istedi; …" yazıyor, G21 bu araç öncesi cümleyi sesli okuyordu. Kural istemde (kişilik + sesli tur
// talimatı) ve ses yolunun YAPISINDA (araçtan önce yazılan metin söylenmez); akış metne bakılarak süzülmez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ARAC_ANLATIM_KURALI, SESLI_TUR_TALIMATI, KENDI_ANLATIM_RE } from '../src/main/ajan/anlatim-kurali.ts';
import { SesliYanit, type KonusmaUcu } from '../src/shared/sesli-yanit.ts';

const kaynak = (y: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', y), 'utf8');

test('kişilik kuralı: araçtan önce hiçbir şey yazma, sonra kullanıcıya hitap eden tek cümle, kendi akıl yürütmesi asla', () => {
  assert.match(ARAC_ANLATIM_KURALI, /Araç çağırmadan ÖNCE hiçbir şey yazma/);
  assert.match(ARAC_ANLATIM_KURALI, /kullanıcıya doğrudan hitap eden TEK cümle/);
  assert.match(ARAC_ANLATIM_KURALI, /Kendi akıl yürütmeni ASLA anlatma/);
  assert.match(ARAC_ANLATIM_KURALI, /"Kullanıcı … istedi"/);
  assert.match(ARAC_ANLATIM_KURALI, /Yapmadığın bir şeyi yapmış gibi ASLA anlatma/, 'dürüstlük kuralı korunur');
  // Kişilik metni kuralı bu sabitten alır; eski davet ("ne yaptığını tek cümleyle söyle") kalmadı.
  const k = kaynak('src/main/ajan/kisilik.ts');
  assert.match(k, /\$\{ARAC_ANLATIM_KURALI\}/);
  assert.doesNotMatch(k, /ne yaptığını tek cümleyle söyle/);
});

test('sesli tur talimatı da aynı kuralı söyler; dongu.ts sesli turda bunu verir', () => {
  assert.match(SESLI_TUR_TALIMATI, /^Bu mesaj SESLİ asistandan geldi/);
  assert.match(SESLI_TUR_TALIMATI, /Araç gerekiyorsa önce HİÇBİR ŞEY yazma/);
  assert.match(SESLI_TUR_TALIMATI, /Kendi akıl yürütmeni asla yazma ya da söyleme/);
  assert.match(SESLI_TUR_TALIMATI, /1-3 kısa cümle/);
  const d = kaynak('src/main/ajan/dongu.ts');
  assert.match(d, /girdi\.sesli \? SESLI_TUR_TALIMATI : ''/);
  // Ana süreç modelin araç bloğuna geçtiğini bildirir (ses yolu araç öncesi metni söylemez).
  assert.match(d, /o\.tur === 'arac_hazirlaniyor' && adimMetni\.trim\(\) && !aracOncesiGitti\) \{ aracOncesiGitti = true; sohbetOlayi\(\{ tur: 'arac_oncesi', sohbetId \}\)/);
});

test('KENDI_ANLATIM_RE (yalnız test denetimi): G26\'nın anlatımını ve benzerlerini yakalar, normal yanıtı yakalamaz', () => {
  for (const s of [
    'Kullanıcı yeni bir oturum açmamı istedi; mavi-kus projesinde açıyorum.',
    'Kullanıcının istediği hatırlatıcıyı kuruyorum.',
    'Şimdi takvime bakmalıyım.',
    'Önce hafızayı kontrol etmeliyim.',
    'The user wants a reminder.',
  ]) assert.match(s, KENDI_ANLATIM_RE, s);
  for (const s of [
    'Yarın 09:00\'a kurdum.',
    'Deniz Bey, yarın saat onda Ahmet Bey ile toplantın var.',
    'Mavi Kuş projesinde yeni oturumu açtım; iş Claude Code sayfasında sürüyor.',
    'Kullanıcı adını ve parolanı ben girmem; oturumu sen aç.',
    'Önce kahve, sonra toplantı: planın böyle.',
  ]) assert.doesNotMatch(s, KENDI_ANLATIM_RE, s);
});

// ── Ses yolu: araçtan önce yazılan metin söylenmez (shared/sesli-yanit.ts) ──
class Sahte implements KonusmaUcu {
  metin = ''; bitti = false; kesildi = false; sesVar?: boolean;
  constructor(ses?: boolean) { this.sesVar = ses; }
  ekle(m: string) { if (!this.kesildi) this.metin += m; }
  bitir() { this.bitti = true; }
  kes() { this.kesildi = true; }
}

test('SesliYanit: araçsız yanıt tek konuşmada, kesilmeden söylenir (gecikme yok)', () => {
  const acilan: Sahte[] = [];
  const s = new SesliYanit(() => { const k = new Sahte(); acilan.push(k); return k; });
  s.metin('Yarın saat onda '); s.metin('toplantın var.');
  s.bitir();
  assert.equal(acilan.length, 1);
  assert.equal(acilan[0].metin, 'Yarın saat onda toplantın var.');
  assert.equal(acilan[0].kesildi, false);
  assert.equal(acilan[0].bitti, true);
});

test('SesliYanit: model araca geçince (arac_oncesi) o adımın sesi kesilir; araçtan sonraki yanıt yeni konuşmada söylenir', () => {
  const acilan: Sahte[] = [];
  const s = new SesliYanit(() => { const k = new Sahte(); acilan.push(k); return k; });
  s.metin('Kullanıcı yeni bir oturum açmamı istedi; ');
  s.aracOncesi(); // ana süreç: arac_oncesi
  s.aracOncesi(); // aynı adımın araç kartı: ikinci kez kesmez
  s.metin('Mavi Kuş’ta oturumu açtım.');
  s.bitir();
  assert.equal(acilan.length, 2);
  assert.equal(acilan[0].kesildi, true, 'araç öncesi konuşma kesildi');
  assert.equal(acilan[0].bitti, false);
  assert.equal(acilan[1].metin, 'Mavi Kuş’ta oturumu açtım.');
  assert.equal(acilan[1].bitti, true);
  assert.equal(s.konusma, acilan[1]);
});

test('SesliYanit: araç öncesi metin yoksa (kural uygulanmış) araç kartı konuşmayı kesmez; ses yoksa yeniden açılmaz; kesme her şeyi susturur', () => {
  const acilan: Sahte[] = [];
  const s = new SesliYanit(() => { const k = new Sahte(); acilan.push(k); return k; });
  s.aracOncesi(); // araç ilk adımda, öncesinde metin yok
  s.metin('Kurdum.');
  s.bitir();
  assert.equal(acilan.length, 1);
  assert.equal(acilan[0].metin, 'Kurdum.');
  const yok: Sahte[] = [];
  const t = new SesliYanit(() => { const k = new Sahte(false); yok.push(k); return k; });
  t.metin('Bakıyorum.'); t.aracOncesi();
  assert.equal(yok.length, 1, 'yalnız yazı: yeni konuşma açılmaz');
  const u = new SesliYanit(() => new Sahte());
  u.metin('Bir'); u.kes();
  assert.equal(u.konusma.kesildi, true);
});

test('ada ve sohbet ses yolu araç öncesi metni SesliYanit ile işler (eski "araç öncesi cümleyi söyle" kalktı)', () => {
  const ada = kaynak('src/renderer/ada/useAsistan.ts');
  assert.match(ada, /o\.tur === 'arac_oncesi'\) \{[\s\S]{0,400}yanitSesi\.current\?\.aracOncesi\(\)/);
  assert.match(ada, /yanitSesi\.current\?\.metin\(parca\)/);
  assert.doesNotMatch(ada, /konusmaRef\.current\?\.ekle\('\\n\\n'\)/);
  const sohbet = kaynak('src/renderer/bilesenler/Sohbet.tsx');
  assert.match(sohbet, /o\.tur === 'arac_oncesi' \|\| o\.tur === 'arac'\) ses\.aracOncesi\(\)/);
  assert.doesNotMatch(sohbet, /ses\.ekle\('\\n\\n'\)/);
});
