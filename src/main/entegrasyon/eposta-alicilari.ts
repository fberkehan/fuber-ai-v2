// ── E-posta alıcıları: gönderimin GERÇEKTEN gideceği adresler (0.11 son inceleme C1; tests/isler-kurallar.test.ts, tests/isler-izin.test.ts) ──
// eposta_gonder `kime`yi ve `cc`yi olduğu gibi nodemailer'a verir (entegrasyon/eposta.ts gonder → sendMail({ to, cc })); nodemailer alıcıları
// kendi RFC ayrıştırıcısıyla (nodemailer/lib/addressparser) çıkarır, grupları açar ve zarfa yazar. Görevin e-posta izni (shared/isler.ts
// izinVarMi) AYNI ayrıştırıcının sonucuna bakar: eskiden bir düzenli ifade `a@x.com, "evil"@attacker.com` ya da `a@x.com, evil @attacker.com`
// içinde yalnız a@x.com'u görüyordu, nodemailer ikisine de gönderiyordu — izinli sanılıp onay kartı çıkmadan yabancıya gidiyordu.
// Kural (kuşkuda izin YOK, normal onay kartı çıkar): alan dize değilse, ayrıştırıcı hata verirse, bir giriş adres taşımıyorsa ya da grup
// sözdizimi ("Ad: a@x.com;") varsa sonuç null. Adresler küçük harfle döner (izin adresleri de küçük harftir: isPlaniDogrula).
import addressparser from 'nodemailer/lib/addressparser';

/** Bir alıcı alanının (to / cc / bcc) gönderimde gideceği adresler. Alan yoksa ya da boşsa []; izin verilemeyecek biçimdeyse null. */
export function alanAlicilari(deger: unknown): string[] | null {
  if (deger === undefined || deger === null) return [];
  if (typeof deger !== 'string') return null;
  let liste: ReturnType<typeof addressparser>;
  try { liste = addressparser(deger); } catch { return null; }
  const sonuc: string[] = [];
  for (const g of liste) {
    if (g.group !== undefined) return null; // grup: üyeleri nodemailer açar ve gönderir; görev izninde grup yok
    const adres = typeof g.address === 'string' ? g.address.trim() : '';
    if (!adres) return null; // adressiz parça (a@x.com, "evil"): ne olduğu belirsiz — izin değil
    sonuc.push(adres.toLowerCase());
  }
  return sonuc;
}

/** eposta_gonder girdisinin BÜTÜN alıcıları: kime + cc + bcc (araç bcc göndermez; model yine de yazdıysa o da denetlenir). Biri izin
 *  verilemeyecek biçimdeyse null. Görev adımı (main/isler/adim.ts) bunu modelin girdisinin üstüne yazar; izin yalnız buna bakar. */
export function epostaAlicilari(g: Record<string, unknown>): string[] | null {
  const alanlar = [g.kime, g.cc, g.bcc].map(alanAlicilari);
  return alanlar.some((a) => a === null) ? null : (alanlar as string[][]).flat();
}
