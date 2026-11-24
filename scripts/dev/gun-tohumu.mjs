// Özellik denetiminin gün kaydı tohumu — SAATTEN BAĞIMSIZ (0.11 G12a, madde 1; birim testli: tests/ozellik-denetimi-saat.test.ts).
// Eskiden tohum "şimdiden 90/55/30 dakika önce" diye kuruluyordu: gece 00:00–01:32 arasında bu zamanlar DÜNE düşüyor, "Bugün" sekmesi
// boş ve "Dün" sekmesi dolu oluyor, Notlar ve "Kayıtları sil" denetimleri (bugünün ≥ 3 notu / ≥ 3 döküm satırı) yalnız o saatlerde
// düşüyordu. Artık her kayıt, tohum kurulduğu andan itibaren AYNI YEREL GÜNÜN içinde kalır: gün yeterince ilerlemişse tam "dk dakika
// önce" (gerçekçi göreli saatler), değilse gün başı ile şimdi arasına orantılı sıkıştırılır (sıra korunur, hiçbiri gelecekte değil).
// Denetimin hiçbir kontrolü gevşetilmedi: aynı sayılar (3 not, 3 döküm, dünün raporu, 2 açık + 1 kapanmış mesele) her saatte geçerli.
import { gunAnahtari } from '../../src/main/gunkaydi/donem.ts';

const DK = 60_000;

/**
 * `simdi`den `dk` dakika ÖNCE — ama `simdi`nin yerel gününden taşmadan. Gün başından `simdi`ye kadar en az `tavan` dakika geçmişse
 * tam `dk` dakika önce; daha azı geçmişse `dk`, `gün başına uzaklık / tavan` oranında küçültülür (`dk` ≤ `tavan` olmalı; değilse
 * oran en büyüğe göre alınır). Sonuç her zaman [gün başı, simdi] aralığındadır ve `dk` arttıkça eskir (sıra korunur).
 */
export function gunIciOnce(simdi, dk, tavan = dk) {
  const gunBasi = new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate()).getTime();
  const gecen = Math.max(0, (simdi.getTime() - gunBasi) / DK);
  const olcek = Math.min(1, gecen / Math.max(tavan, dk));
  return new Date(simdi.getTime() - dk * olcek * DK);
}

/** Düşünme motorunun denetim tohumu (saf): bugünün notları ve dökümü; gün anahtarları (bugün/dün/yarın) yerel güne göre. */
export function gunKaydiTohumu(simdi = new Date()) {
  const gunKaydir = (n) => gunAnahtari(new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate() + n));
  const once = (dk) => gunIciOnce(simdi, dk, 92);
  const zamanli = (dk) => { const t = once(dk); return { zaman: t.toISOString(), gun: gunAnahtari(t) }; };
  const notlar = [
    [90, 'Mert Android 1.4 RC’yi yükledi; ödeme ekranı hatası düzeldi.', 'onemli', 'Mavi Kuş', ['Mert'], 0],
    [55, 'Yatırımcı sunumunda haftalık aktif kafe metriği ilk slayta konacak.', 'onemli', 'Yatırım', [], 0],
    [30, 'Öğle yemeğinde kahve makinesinin yine bozulduğu konuşuldu.', 'onemsiz', 'Ofis', [], 1],
  ].map(([dk, metin, onem, konu, kisiler, eglenceli]) => ({ ...zamanli(dk), metin, onem, konu, kisiler, eglenceli }));
  const dokum = [
    [92, 'Mert: APK yüklendi, ödeme ekranındaki hata da düzeldi.'],
    [56, 'İlk slayta haftalık aktif kafe sayısını koyalım.'],
    [31, 'Kahve makinesi yine çalışmıyor.'],
  ].map(([dk, metin]) => ({ ...zamanli(dk), metin }));
  return { bugun: gunKaydir(0), dun: gunKaydir(-1), yarin: gunKaydir(1), notlar, dokum };
}
