// Cümle bölücü (Görev 21, K9): model yanıtı akarken tamamlanan her cümle hemen konuşulur. Türkçe kısaltmalar, sayılar, sıra sayıları,
// alan adları ve kod blokları cümleyi bölmez; akış hangi noktada kesilirse kesilsin sonuç aynıdır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CumleBolucu, seslendirmeMetni } from '../src/shared/cumle-bolucu.ts';

/** Metni verilen boyda parçalar hâlinde akıtır (model belirteçleri gibi); bütün parçaları döndürür. */
function akit(metin: string, boy = 3, ayar?: ConstructorParameters<typeof CumleBolucu>[0]): string[] {
  const b = new CumleBolucu(ayar);
  const out: string[] = [];
  for (let i = 0; i < metin.length; i += boy) out.push(...b.ekle(metin.slice(i, i + boy)));
  return [...out, ...b.bitir()];
}
const tumBoylar = (metin: string, ayar?: ConstructorParameters<typeof CumleBolucu>[0]) => [1, 2, 5, 17, 1000].map((n) => akit(metin, n, ayar));

test('basit cümleler: nokta, soru, ünlem ayrı parçalar; akışın kesildiği yer sonucu değiştirmez', () => {
  const m = 'Tamam, hemen bakıyorum. Yarın saat onda toplantın var! Hatırlatayım mı?';
  for (const r of tumBoylar(m, { ilkEnAz: 999 })) assert.deepEqual(r, ['Tamam, hemen bakıyorum.', 'Yarın saat onda toplantın var!', 'Hatırlatayım mı?']);
});

test('kısaltmalar cümleyi bölmez: Dr., Prof., Av., Sn., Ltd. Şti., A.Ş., T.C., baş harf', () => {
  const m = 'Dr. Ahmet Yılmaz ile Prof. Ayşe Kaya yarın geliyor. Av. Mehmet Bey ve Sn. Demir de orada. ABC Ltd. Şti. ile XYZ A.Ş. anlaştı. M. Kemal Caddesi’ndeyiz.';
  for (const r of tumBoylar(m, { ilkEnAz: 999 })) {
    assert.deepEqual(r, [
      'Dr. Ahmet Yılmaz ile Prof. Ayşe Kaya yarın geliyor.',
      'Av. Mehmet Bey ve Sn. Demir de orada.',
      'ABC Ltd. Şti. ile XYZ A.Ş. anlaştı.',
      'M. Kemal Caddesi’ndeyiz.',
    ]);
  }
});

test('vb./vs. küçük harften önce bölmez, büyük harften önce cümle sonudur', () => {
  const m = 'Kalem, defter vb. şeyler lazım. Kitap, dergi vs. Sonra bakarız.';
  for (const r of tumBoylar(m, { ilkEnAz: 999 })) assert.deepEqual(r, ['Kalem, defter vb. şeyler lazım.', 'Kitap, dergi vs.', 'Sonra bakarız.']);
});

test('sayılar: ondalık, binlik, saat, tarih bölmez; sıra sayısı ("3. kez") bölmez; yıl sonu cümle sonudur', () => {
  const m = 'Fiyat 3.5 milyon, yani 3.500.000 TL. Toplantı 12.30’da, tarih 25.10.2026. Bu 3. kez oluyor ve 25. yılımız. Şirket 2025. Sonra büyüdük.';
  for (const r of tumBoylar(m, { ilkEnAz: 999 })) {
    assert.deepEqual(r, [
      'Fiyat 3.5 milyon, yani 3.500.000 TL.',
      'Toplantı 12.30’da, tarih 25.10.2026.',
      'Bu 3. kez oluyor ve 25. yılımız.',
      'Şirket 2025.',
      'Sonra büyüdük.',
    ]);
  }
});

test('alan adı, e-posta ve devam eden üç nokta bölmez; cümle sonundaki üç nokta böler', () => {
  const m = 'Siteni ornek.example üzerinden aç, ya da info@ornek.example adresine yaz. Hmm… bakalım ne olacak. Bekliyorum... Sonra konuşuruz.';
  for (const r of tumBoylar(m, { ilkEnAz: 999 })) {
    assert.deepEqual(r, ['Siteni ornek.example üzerinden aç, ya da info@ornek.example adresine yaz.', 'Hmm… bakalım ne olacak.', 'Bekliyorum...', 'Sonra konuşuruz.']);
  }
});

test('kapanan tırnak ve parantez cümleye dahil', () => {
  const m = 'Ona “Yarın gel.” dedim. (Gelecek mi bilmiyorum.) Göreceğiz.';
  for (const r of tumBoylar(m, { ilkEnAz: 999 })) assert.deepEqual(r, ['Ona “Yarın gel.”', 'dedim.', '(Gelecek mi bilmiyorum.)', 'Göreceğiz.']);
});

test('satır sonu sınırdır: liste maddeleri ve başlıklar tek tek, işaretsiz okunur', () => {
  const m = '## Bugün\n- Saat 10’da toplantı\n- Öğlen **Ahmet** ile yemek\n1. Sunumu bitir\n\nBaşka bir şey var mı?';
  for (const r of tumBoylar(m)) assert.deepEqual(r, ['Bugün', 'Saat 10’da toplantı', 'Öğlen Ahmet ile yemek', 'Sunumu bitir', 'Başka bir şey var mı?']);
});

test('kod blokları okunmaz ve içindeki işaretler cümle bölmez', () => {
  const m = 'Şöyle yazabilirsin:\n```js\nconst a = x ? y : z; // neden? çünkü.\nif (a) { b(); }\n```\nBu kadar. Kolay mı?';
  for (const r of tumBoylar(m)) assert.deepEqual(r, ['Şöyle yazabilirsin:', 'Bu kadar.', 'Kolay mı?']);
});

test('açık (henüz kapanmamış) kod bloğunun içinden parça çıkmaz; kapanınca devam eder', () => {
  const b = new CumleBolucu();
  assert.deepEqual(b.ekle('Örnek:\n```\nkod. Daha kod? '), ['Örnek:']);
  assert.deepEqual(b.ekle('Hâlâ kod.\n'), []);
  assert.deepEqual(b.ekle('```\nBitti. '), []);
  assert.deepEqual(b.ekle('Sonra'), ['Bitti.']);
  assert.deepEqual(b.bitir(), ['Sonra']);
});

test('ilk parça erken: konuşmanın ilk parçası virgülde de kesilir (en az ilkEnAz harf); sonrakiler cümle cümle', () => {
  const r = akit('Tabii, hemen bakıyorum ve sana söylüyorum, birazdan dönerim. Sonra bir şey daha, şöyle ki bu da var.', 4);
  assert.deepEqual(r, ['Tabii, hemen bakıyorum ve sana söylüyorum,', 'birazdan dönerim.', 'Sonra bir şey daha, şöyle ki bu da var.']);
});

test('uzun cümle son yumuşak sınırda bölünür (enUzun)', () => {
  const uzun = `${'Bu çok uzun bir cümle, '.repeat(14)}sonunda bitiyor.`;
  const r = akit(uzun, 7, { ilkEnAz: 999, enUzun: 120 });
  assert.ok(r.length >= 3, JSON.stringify(r));
  for (const p of r) assert.ok(p.length <= 125, `${p.length}: ${p}`);
  assert.equal(r.join(' ').replace(/\s+/g, ' '), uzun.replace(/\s+/g, ' ').trim());
});

test('akış noktada ya da boşlukta biterse karar sonraki harfe kadar bekler', () => {
  const b = new CumleBolucu({ ilkEnAz: 999 });
  assert.deepEqual(b.ekle('Bu 3.'), []);
  assert.deepEqual(b.ekle(' '), []);
  assert.deepEqual(b.ekle('kez oldu. Yarın'), ['Bu 3. kez oldu.']);
  assert.deepEqual(b.ekle(' Dr.'), []);
  assert.deepEqual(b.ekle(' Ahmet gelir.'), []); // nokta tamponun sonunda: devamı beklenir
  assert.deepEqual(b.bitir(), ['Yarın Dr. Ahmet gelir.']);
});

test('zorla(): uzun ilk cümle süre dolunca yumuşak sınırdan ya da sözcük sınırından kesilir; kısa tampon kesilmez', () => {
  const b = new CumleBolucu({ ilkEnAz: 999 });
  assert.deepEqual(b.ekle('Merhaba'), []);
  assert.deepEqual(b.zorla(), []);
  assert.deepEqual(b.ekle(' Deniz, bugün takviminde üç toplantı ve iki görev var ve'), []);
  assert.deepEqual(b.zorla(), ['Merhaba Deniz,']);
  assert.deepEqual(b.ekle(' sonra'), []);
  assert.deepEqual(b.zorla(), ['bugün takviminde üç toplantı ve iki görev var ve']);
  assert.deepEqual(b.bitir(), ['sonra']);
});

test('seslendirmeMetni: atıf, bağlantı, emoji, vurgu, satır içi kod temizlenir', () => {
  assert.equal(seslendirmeMetni('Toplantı **yarın** [H-12] saat 10’da 🎉 — ayrıntı [burada](https://x.y/z) ve `npm test` çalıştır. https://ornek.example'), 'Toplantı yarın saat 10’da — ayrıntı burada ve npm test çalıştır.');
  assert.equal(seslendirmeMetni('> alıntı\n# Başlık\n| a | b |'), 'alıntı\nBaşlık\na b');
});

test('yalnız işaret/boşluk olan parça konuşulmaz', () => {
  assert.deepEqual(akit('— … \n\n ** ** \nTamam.'), ['Tamam.']);
});

// ── Düzeltme 4: araçtan önceki cümle bütün ve araçtan ÖNCE söylenir ──
test('araç adımı: cümle sonu + satır sonu kesin sınırdır (sonraki harf beklenmez) — "Tamam, takvimine hemen bakıyorum." bütün', () => {
  const b = new CumleBolucu();
  assert.deepEqual(b.ekle('Tamam, takvimine hemen bakıyorum.'), [], 'sonraki harf belli değil');
  // Ada/sohbet araç adımı başlarken "\n\n" ekler: cümle hemen ve BÜTÜN olarak çıkar.
  assert.deepEqual(b.ekle('\n\n'), ['Tamam, takvimine hemen bakıyorum.']);
  assert.deepEqual(b.ekle('Yarın saat onda toplantın var.'), []);
  assert.deepEqual(b.bitir(), ['Yarın saat onda toplantın var.']);
  // Kısaltmayla biten satır da satır sonunda kesilir (liste maddesi "… vb.").
  assert.deepEqual(akit('Kalem, defter vb.\nSonra bakarız.', 2, { ilkEnAz: 999 }), ['Kalem, defter vb.', 'Sonra bakarız.']);
});

test('zorla(): tampon tamamlanmış bir cümleyle bitiyorsa cümle ortasından değil BÜTÜN olarak kesilir; kısaltma/unvan sonu tamam sayılmaz', () => {
  const b = new CumleBolucu();
  assert.deepEqual(b.ekle('Tamam, takvimine hemen bakıyorum.'), []);
  assert.deepEqual(b.zorla(), ['Tamam, takvimine hemen bakıyorum.'], 'eskiden "Tamam, takvimine hemen" | "bakıyorum." bölünüyordu');
  assert.equal(b.bekleyen, '');
  const c = new CumleBolucu({ ilkEnAz: 999 });
  assert.deepEqual(c.ekle('Yarın sabah görüşeceğin kişi Dr.'), []);
  assert.deepEqual(c.zorla(), ['Yarın sabah görüşeceğin kişi'], '"Dr." cümle sonu değil: sözcük sınırından kesilir');
  const d = new CumleBolucu({ ilkEnAz: 999 });
  assert.deepEqual(d.ekle('Bu yıl hedefimiz büyümek!  '), []);
  assert.deepEqual(d.zorla(), ['Bu yıl hedefimiz büyümek!']);
});

test('ufak kurallar: "Kendin gör." cümle sonu, "Öğr. Gör." unvan; "18°C." sonu; "Bkz." bölmez; alan adı sonu; alt çizgili ad okunur', () => {
  for (const r of tumBoylar('Kendin gör. Sonra konuşuruz. Öğr. Gör. Ayşe Kaya geldi.', { ilkEnAz: 999 })) {
    assert.deepEqual(r, ['Kendin gör.', 'Sonra konuşuruz.', 'Öğr. Gör. Ayşe Kaya geldi.']);
  }
  for (const r of tumBoylar('Hava bugün 18°C. Yarın serinliyor. Bkz. Ek 2 ve tabloya bak. Adres fuber.org. Sonra bakarız.', { ilkEnAz: 999 })) {
    assert.deepEqual(r, ['Hava bugün 18°C.', 'Yarın serinliyor.', 'Bkz. Ek 2 ve tabloya bak.', 'Adres fuber.org.', 'Sonra bakarız.']);
  }
  assert.equal(seslendirmeMetni('`hafiza_ara` aracı ve dosya_adi_yeni ile __kalın__ yazı'), 'hafiza ara aracı ve dosya adi yeni ile kalın yazı');
});
