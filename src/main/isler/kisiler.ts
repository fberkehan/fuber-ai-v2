// ── Görev planındaki kişiler → somut WhatsApp hesabı (0.11 G9 düzeltme turu 1, Ö1; tests/isler-izin.test.ts) ──────────────────────────
// İnceleme: izin yazılan ADA bağlıydı; mesaj ise o adı taşıyan EN SON yazışana gidiyordu (görünen ad gönderenin kendi seçtiği pushName). Artık
// görev başlarken (onay kartından ÖNCE) izindeki kişi ve WhatsApp gözcüsünün hedefi gönderimle aynı kuralla tek bir jid'e çözülür; kart
// numaranın sonunu gösterir; adım yalnız o jid'e onaysız yazar, gözcü yalnız ondan gelen mesajla tetiklenir. Ad bulunamazsa ya da birden çok
// kişiye uyuyorsa plan reddedilir ve model numarayı sorar/kullanır.
import { whatsappKisiCoz } from '../entegrasyon/whatsapp-kapisi.js';
import { numaraSonu, type IsPlani } from '../../shared/isler.js';

function coz(ad: string, ne: string): string | { hata: string } {
  const r = whatsappKisiCoz(ad);
  if (r.adaylar.length > 1) {
    const liste = r.adaylar.slice(0, 5).map((a) => `${a.ad} (${numaraSonu(a.jid)})`).join(', ');
    return { hata: `WhatsApp’ta “${ad}” adına uyan birden çok kişi var (${liste}); ${ne} için kişinin numarasını kullan (ör. 905000000001)` };
  }
  if (!r.jid || !r.adaylar.length) return { hata: `WhatsApp’ta “${ad}” bulunamadı; ${ne} için kişinin numarasını kullan (ör. 905000000001)` };
  return r.jid;
}

/** Plandaki WhatsApp kişilerini (izinler ve gözcü hedefi) jid'e çözer; çözülemeyen ya da belirsiz ad hata döner (modele gider). */
export function planKisileriniCoz(plan: IsPlani): { plan: IsPlani } | { hata: string } {
  const izinler: IsPlani['izinler'] = [];
  for (const i of plan.izinler) {
    if (i.tur !== 'whatsapp_gonder') { izinler.push(i); continue; }
    const j = coz(i.kisi, 'WhatsApp izni');
    if (typeof j !== 'string') return j;
    izinler.push({ tur: 'whatsapp_gonder', kisi: i.kisi, jid: j });
  }
  let gozcu = plan.gozcu;
  if (gozcu.tur === 'whatsapp' && gozcu.hedef) {
    const j = coz(gozcu.hedef, 'WhatsApp gözcüsü');
    if (typeof j !== 'string') return j;
    gozcu = { ...gozcu, jid: j };
  }
  return { plan: { ...plan, gozcu, izinler } };
}
