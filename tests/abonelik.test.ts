// Motor hâli, sohbet şeridi, motor hata metinleri ve Ayarlar → "Hesap ve kullanım" (src/shared/abonelik.ts, shared/hesap-kullanim.ts, ayar dizini).
// 0.11 G8 (spec §7): arayüzde plan kartı, ödeme, fatura ve gösterim denetimleri YOK — Ayarlar → "Hesap ve kullanım" hesabın durumunu ve kalan
// kullanımı gösterir (shared/hesap-kullanim.ts; dosyanın sonundaki testler); sohbet şeridi artık ödeme şeridi taşımaz.
// 0.11 G12a: ana sürecin kapalı `abonelik:islem` yolunun durum makinesi (taslak fiyatlar, deneme/ödeme/iptal geçişleri, aylık yenileme,
// ödeme sorunu, bozuk kayıt onarımı) ve YALNIZ ona ait testler silindi (tests/abonelik-denetimleri.test.ts dahil); "Hesap ve kullanım"ın
// kullandığı saf işlevlerin ve motor/şerit metinlerinin testleri kaldı. Silinen yolun yerine: dosyanın sonundaki "G12a" testi kanalın HİÇ
// kayıtlı olmadığını, durum makinesinin ve fiyatların kalmadığını denetler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as abonelik from '../src/shared/abonelik.ts';
import {
  sohbetSeridi, motorHali, motorEtiketi, motorHataMetni, anahtarYokMetni,
  IS_MOTOR_HATASI,
} from '../src/shared/abonelik.ts';
import { KATEGORILER } from '../src/renderer/ayarlar/dizin.ts';
import { dizinKur, ayarAra, gorunurMu, modaGore } from '../src/shared/ayar-arama.ts';
import type { HesapAyari } from '../src/shared/masaustu-hesap.ts';
import { IS_YASAK, isDiliIhlali } from '../src/shared/is-dili.ts';

const ANAHTAR_DILI = IS_YASAK;
const YOK = { bulut: 0, yerel: false };
const YEREL = { bulut: 0, yerel: true };
const BULUT = { bulut: 1, yerel: false };
const GIRIS = { etiket: 'Giriş yap', eylem: 'hesap' };

test('0.10 G2 (D2, R16): abonelik motor sağlamaz → "Denemeyi başlat"/"Abone ol"/"Kullanım biçimini değiştir" motor bildiriminden kalktı', () => {
  const m = abonelik as Record<string, unknown>;
  // I1 (R19): E4 sihirbazı motor durumunu yalnız motorGorunumu'dan alır; eski K3 açıklaması (İş ve Geliştirici) kalktı.
  for (const ad of ['motorDurduGorunumu', 'K3_ACIKLAMA_IS', 'K3_ACIKLAMA_GELISTIRICI', 'YEREL_SERIT_BASLIGI']) assert.equal(m[ad], undefined, `${ad} kalkmalıydı`);
  for (const mod of ['is', 'gelistirici'] as const) {
    const s = sohbetSeridi(mod, YOK, 'bagli-degil');
    assert.doesNotMatch(JSON.stringify(s), /Denemeyi başlat|Abone ol|Aboneliği yenile|Kullanım biçimi|plan-secimi/, mod);
  }
});

// 0.11 G8: ödeme şeridi ("Ödeme alınamadı" / "Fuber aboneliği durdu") kalktı — gösterilecek bir satın alma yok; eski bir kayıtta kalmış
// ödeme sorunu durumu (eski deneme sürümleri) sohbette hiçbir şerit çıkarmaz: şerit artık abonelik durumunu hiç okumaz.
test('G8: sohbet şeridi abonelik durumunu okumaz; hiçbir hâlde ödeme/abonelik şeridi ya da "Aboneliği yenile" düğmesi yok', () => {
  const hepsi = [];
  for (const mod of ['is', 'gelistirici'] as const) {
    for (const m of [YOK, YEREL, BULUT, { ...YOK, gizli: true }, { ...YEREL, gizli: true }]) {
      for (const g of ['hazir', 'yerel', 'bagli-degil', 'durdu', 'hesap-bekliyor', 'hesap-kapali', 'kredi-bitti', 'hazirlaniyor'] as const) {
        hepsi.push(sohbetSeridi(mod, m, g, g === 'hazir' ? undefined : 'aktif', Boolean((m as { gizli?: boolean }).gizli)));
      }
    }
  }
  assert.ok(hepsi.length > 40);
  for (const s of hepsi) {
    assert.notEqual(s?.tur, 'odeme');
    assert.doesNotMatch(JSON.stringify(s), /Ödeme|ödeme|Aboneliği yenile|Fuber aboneliği|hesap\/odeme/);
  }
});

test('motor hali (Ruling K): bulut > yalnız yerel > yok', () => {
  assert.equal(motorHali(YOK), 'yok');
  assert.equal(motorHali(YEREL), 'yerel');
  assert.equal(motorHali(BULUT), 'bulut');
  assert.equal(motorHali({ bulut: 2, yerel: true }), 'bulut');
});

test('Gizli mod hata metni (düzeltme turu 1): giriş yapmış kullanıcıya "giriş yap" denmez; hesabın hâli Gizli modda söz konusu değil', () => {
  const is = motorHataMetni('bulut-gerekli', 'is', 'aktif', true);
  assert.equal(is, 'Gizli mod açıkken bu iş yapılamaz: Gizli modda Fuber yalnız bu bilgisayardaki yapay zekâyla çalışır, o da yalnız gündelik sohbeti yanıtlar. Gizli modu Gizlilik ayarlarından kapatabilirsin.');
  assert.doesNotMatch(is, /giriş yap|beyin|motor/i);
  assert.equal(isDiliIhlali(is), null, is);
  for (const h of [undefined, null, 'aktif', 'bekliyor', 'kapali', 'kredi-bitti'] as const) assert.equal(motorHataMetni('bulut-gerekli', 'is', h, true), is, String(h));
  assert.match(motorHataMetni('bulut-gerekli', 'gelistirici', 'aktif', true), /^Gizli mod açık: bu iş araç ister/);
  assert.match(motorHataMetni('yok', 'is', 'aktif', true), /^Gizli modda Fuber yalnız bu bilgisayardaki yapay zekâyla çalışır; o şu an hazır değil\./);
  // İş'te sohbette aynen gösterilir (gorunenMotorHatasi genel cümleye çevirmez).
  assert.equal(abonelik.gorunenMotorHatasi('anahtar', is, 'is'), is);
});

test('sohbet şeridi Gizli modda: yerel hazırsa sakin not (düğmesiz), değilse kırmızı + "Gizlilik ayarları"', () => {
  const y = sohbetSeridi('is', { ...YEREL, gizli: true }, 'yerel', 'aktif', true)!;
  assert.deepEqual([y.seviye, y.dugmeler.length, y.gonderimKapali], ['notr', 0, false]);
  const d = sohbetSeridi('is', { ...YOK, gizli: true }, 'durdu', 'aktif', true)!;
  assert.deepEqual([d.seviye, d.baslik, d.gonderimKapali], ['kirmizi', 'Gizli modda yapay zekâ hazır değil', true]);
  assert.deepEqual(d.dugmeler, [{ etiket: 'Gizlilik ayarları', cipa: 'gizli-mod' }]);
});

// ════════════════════ 0.11 G8 (spec §7): abonelik yerine "Hesap ve kullanım" ════════════════════
// Çalışmayan bir satın alma yüzeyi bozuk görünür. Karar: plan kartı, ödeme, fatura ve
// gösterim denetimleri HİÇBİR sürümde (müşteri/geliştirme ayrımı yok) arayüzde değil. Ayarlar → Hesap ve kullanım: hesabın durumu, kalan
// kullanım (sayı; toplam biliniyorsa çubuk), "Kullanımın biterse Fuber ek kullanım tanımlar; …" — fiyat yok.
const hesap = (o: Partial<HesapAyari> = {}): HesapAyari => ({ eposta: 'deniz@ornek.com', cihazAdi: 'DENIZ-PC · 3f2a', durum: 'aktif', ...o });

test('G8 · eski Kullanım sayfası (Maliyet) plan payı göstermez (plan yok): metin ve arama sözcüklerinde plan/pay kalmadı', () => {
  const kul = KATEGORILER.find((x) => x.id === 'kullanim')!;
  assert.doesNotMatch(JSON.stringify(kul), /\bplan(ın)?\b|payının|Planın varsa|\bpay\b/i);
});
