// ── Claude Code oturum araması (saf): "geçen hafta ödeme ekranında çalıştığım sohbet" → en uygun oturumlar ──────
// Türkçe sadeleştirme (ı/i, ş/s…, ekler kabaca budanır) + kelime eşleşmesi: başlık ve proje adı 3 kat, istemler 1 kat;
// yakın tarihli oturumlar hafif öne çıkar. Çalışma anı içe aktarması yok (ana süreç + testler ortak kullanır).

export interface AranabilirOturum { id: string; baslik: string; proje: string; cwd: string; istemler: string[]; sonZaman?: string }

const DURAK = new Set(['ve', 'ile', 'bir', 'bu', 'şu', 'o', 'da', 'de', 'mi', 'mı', 'mu', 'mü', 'için', 'gibi', 'olan', 'oturum', 'oturumu',
  'sohbet', 'sohbeti', 'sohbetini', 'proje', 'projesi', 'projesinde', 'projede', 'claude', 'code', 'şunu', 'bunu', 'yap', 'yapalım', 'bul',
  'aç', 'devam', 'et', 'çalıştığım', 'çalıştığımız', 'konuştuğumuz', 'olduğu', 'hani', 'the', 'and', 'for']);

export function sadelestir(s: string): string {
  return s.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
    .replace(/[ıi]/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a');
}

/** Sorgu kelimeleri: durak sözcükler atılır, en az 3 harf, kabaca ek budanır (ilk 6 harf). */
export function sorguKelimeleri(sorgu: string): string[] {
  return [...new Set(sorgu.replace(/İ/g, 'i').toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((k) => k.length >= 3 && !DURAK.has(k))
    .map((k) => sadelestir(k).slice(0, 6)))];
}

export function ccAra<T extends AranabilirOturum>(liste: T[], sorgu: string, simdi = Date.now()): { oturum: T; puan: number; parca?: string }[] {
  const kel = sorguKelimeleri(sorgu);
  if (!kel.length) return liste.map((oturum) => ({ oturum, puan: 0 }));
  const sonuc: { oturum: T; puan: number; parca?: string }[] = [];
  for (const o of liste) {
    const baslik = sadelestir(`${o.baslik} ${o.proje} ${o.cwd}`);
    let puan = 0, eslesen = 0, parca: string | undefined;
    for (const k of kel) {
      let p = 0;
      if (baslik.includes(k)) p += 3;
      for (const i of o.istemler) {
        if (sadelestir(i).includes(k)) { p += 1; parca ??= i; if (p > 8) break; }
      }
      if (p) { eslesen++; puan += Math.min(p, 9); }
    }
    if (!eslesen) continue;
    puan *= eslesen / kel.length; // bütün kelimeleri karşılayan öne
    const gun = o.sonZaman ? (simdi - Date.parse(o.sonZaman)) / 86_400_000 : 365;
    puan *= 1 + 0.5 / (1 + Math.max(0, gun) / 7); // son haftalar hafif önde
    sonuc.push({ oturum: o, puan, parca });
  }
  return sonuc.sort((a, b) => b.puan - a.puan);
}
