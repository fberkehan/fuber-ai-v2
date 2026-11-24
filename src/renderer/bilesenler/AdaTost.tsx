// ── Adanın uygulama içi karşılığı (K4): uygulama öndeyken adaya gidecek hatırlatıcı, mesaj ve onay ──────────────────────────
// Uygulama öndeyken (ana pencere odaklı ve görünür) ada hiç görünmez; ana süreç (main/ada.ts → main.ts) adanın yerine bu pencereye
// `ana:ada-tost` { kanal, veri } yollar. Görev 20b düzeltme turu 2: bu olaylar artık ayrı bir tost yığını değil, bütün uygulama içi
// bildirimlerin TEK katmanına (TostAlani.tsx: çentiğin altından iner, sayfa alanı değişmez) tost olarak girer (renderer/tostlar.ts).
// Hatırlatıcı kapatılana dek kalır (kaybolmasın; ayrıca ana sohbette). Onay yanıtlanınca ya da iptal olunca kalkar, "Yanıtla" onun
// sohbetini açar (ada da, uygulama arkaya geçince hâlâ bekliyorsa, onu gösterir). Fuber'in mesajı ve sözü görünür olduktan 12 sn
// sonra kalkar (imleç üstündeyken süre durur). Fuber'in sözü sesliyse (eşlikçi, seslenme yanıtı) burada da okunur.
import { useEffect, useRef } from 'react';
import { dinle } from '../api';
import { tostEkle, tostlariSuz } from '../tostlar';
import { fuberSoyle } from '../fuber-sesi';
import { ccEkrandaMi } from '../claudecode/gorunurluk';
import { odakZiliCal } from '../ada/odak-zil';
import type { OnayIstegi, SohbetOlayi } from '../../shared/tipler';

const SURE_MS = 12_000;
/** Hap önizlemesi gibi: markdown işaretleri ve atıflar düşer (ada ile aynı). */
export const duz = (m: string) => m.replace(/\[(H|M|D|N|G|R)-\d+[^\]]*\]/g, '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();
/** Fuber'in sözünün başlığı: adadakiyle aynı (useAsistan.ts 'asistan:soyle'). */
const sozBasligi = (tur: string) => (tur === 'espri' ? 'Fuber 😄' : tur === 'hatirlatma' ? 'Fuber hatırlatıyor' : tur === 'sohbet' || tur === 'onay' || tur === 'yanit' ? 'Fuber' : 'Fuber araya giriyor');

/** Sesli söz: Fuber'in tek sesiyle (Görev 21; sesli yanıt kapalıysa ana süreç konuşma açmaz); kulak kendi sesini duymaz (fuber-sesi.ts). */
function soyle(metin: string): void {
  if (metin.trim()) fuberSoyle(metin, 'bildirim');
}

/** Ana süreçten gelen ada olaylarını tost kuyruğuna çevirir (TostAlani çağırır). */
export function useAdaTostlari(): void {
  // Aynı onay ikinci kez gelirse (ör. ada kapatılınca kuyruktan yeniden yönlendirildi, ada önden çekilirken üstündeydi) yeni tost
  // açılmaz — tostu kapatılmış olsa da; iptal olunca unutulur.
  const gosterilen = useRef(new Set<string>());
  useEffect(() => {
    const k = [
      dinle('ana:ada-tost', (o: { kanal: string; veri: any }) => {
        const v = o.veri ?? {};
        if (o.kanal === 'asistan:bildir') {
          // Görev 28: kullanıcının şu an baktığı Claude Code oturumunun bildirimi tekrarlanmaz (izin kartı ve hâl sayfada canlı).
          if (ccEkrandaMi(v.yol)) return;
          const hatirlatma = v.tur === 'hatirlatma';
          tostEkle({ tur: hatirlatma ? 'hatirlatma' : 'mesaj', baslik: hatirlatma ? `Hatırlatma · ${v.baslik}` : String(v.baslik ?? 'Fuber'), metin: duz(String(v.metin ?? '')), sure: hatirlatma ? null : SURE_MS, ...(typeof v.yol === 'string' ? { yol: v.yol } : {}) });
        } else if (o.kanal === 'asistan:soyle') {
          const hatirlatma = v.tur === 'hatirlatma';
          tostEkle({ tur: hatirlatma ? 'hatirlatma' : 'soz', baslik: sozBasligi(String(v.tur ?? '')), metin: duz(String(v.metin ?? '')), sure: hatirlatma ? null : SURE_MS });
          if (v.sesli) soyle(String(v.metin ?? ''));
        } else if (o.kanal === 'ada:odak-bitti') {
          // 0.14 son inceleme I4: Odak kullanıcının kendi zamanlayıcısıdır — uygulama öndeyken düşmez; tost + zil (çentiğin zili ile aynı WAV).
          tostEkle({ tur: 'mesaj', baslik: 'Odak', metin: String(v.metin ?? 'Odak bitti'), sure: SURE_MS });
          void odakZiliCal();
        } else if (o.kanal === 'asistan:onay') {
          const istek = v.istek as OnayIstegi;
          if (gosterilen.current.has(istek.id)) return;
          gosterilen.current.add(istek.id);
          tostEkle({ tur: 'onay', baslik: 'Onayın gerekiyor', metin: duz(istek.baslik), sohbetId: v.sohbetId, onayId: istek.id, sure: null });
        }
      }),
      // Onay başka yerde yanıtlandı, iptal oldu ya da turu bitti: tostu da kalkar.
      dinle('sohbet:olay', (o: SohbetOlayi) => {
        if (o.tur === 'onay_iptal') { gosterilen.current.delete(o.id); tostlariSuz((t) => t.onayId === o.id); }
        else if (o.tur === 'bitti' || (o.tur === 'hata' && !o.mesgul)) tostlariSuz((t) => t.tur === 'onay' && t.sohbetId === o.sohbetId);
      }),
    ];
    return () => k.forEach((f) => f());
  }, []);
}
