// ── Sesli yanıtın akışı: araçtan ÖNCE yazılan metin söylenmez (I5, son inceleme; saf — birim testli: tests/anlatim-kurali.test.ts) ──
// G21 (düzeltme 4) araçtan önce yazılan cümleyi ("Tamam, takvimine bakıyorum.") araç sürerken BÜTÜN olarak seslendiriyordu; G26 gerçek
// motorla gördü: düşük düşünme gücünde o cümle modelin kendi akıl yürütmesi olabiliyor ("Kullanıcı yeni bir oturum açmamı istedi; …") ve
// sesli okunuyordu. Kural artık istemde (araçtan önce hiçbir şey yazma; ajan/anlatim-kurali.ts) VE ses yolunun YAPISINDA — metne bakan bir
// süzgeç yok (güvenilmez):
//  - Model bir adımda araç bloğuna geçince (ana süreç 'arac_oncesi'; olayı vermeyen motorda ilk araç kartı) o adımda yazılmış metnin sesi
//    HEMEN kesilir; araç çağrısı akışta metinden hemen sonra geldiği için çoğu zaman tek ses çıkmadan kesilir.
//  - Konuşma aynı kaynakla yeniden açılır (ses kimliği yeni konuşmada da aynı kuraldan: shared/ses-kimligi.ts sesSec); araçtan sonraki
//    yanıt cümle cümle söylenir. Metin ekranda kalır (yalnız ses yolu).
// 0.13 T6: ilk konuşma `tembel` açılabilir — arayüz `baslat()`ı turun 'basladi' olayında çağırır, o zaman turun kilitli kipi (basladi.kip) bellidir
// ve ses, karakterle AYNI kilidi kullanır (mesaj gönderilirken okunan kip ile ana sürecin turu kilitlediği an arasında yarış kalmaz).
// Adanın sesli yanıtı (ada/useAsistan.ts) ve sohbetin sesle sorulan yanıtı (bilesenler/Sohbet.tsx) bunu kullanır.

export interface KonusmaUcu { ekle(metin: string): void; bitir(): void; kes(): void; readonly sesVar?: boolean }

export class SesliYanit<K extends KonusmaUcu = KonusmaUcu> {
  private k: K | null;
  /** Bu adımda (son araçtan beri) söylenmek üzere metin verildi mi. */
  private adimMetni = false;
  /** Konuşma bu adımda araç öncesi diye kesildi; sıradaki araç kartı yeniden kesmesin. */
  private kesildi = false;
  private readonly ac: () => K;

  /** `tembel`: ilk konuşma hemen açılmaz; `baslat()` (ya da ilk metin) açar. */
  constructor(ac: () => K, o: { tembel?: boolean } = {}) { this.ac = ac; this.k = o.tembel ? null : ac(); }

  get konusma(): K | null { return this.k; }

  /** İlk konuşmayı açar (zaten açıksa bir şey yapmaz). */
  baslat(): void { if (!this.k) this.k = this.ac(); }

  metin(parca: string): void {
    if (!parca) return;
    this.baslat(); // 'basladi' hiç gelmediyse bile metin sessiz kalmaz (kip ana sürecin şu anki kipi olur)
    if (!this.adimMetni) this.kesildi = false;
    this.adimMetni = true;
    this.k!.ekle(parca);
  }

  /** Model araca geçti ('arac_oncesi') ya da araç kartı geldi: adımın metni araçtan önceydi — sesi kesilir, konuşma yeniden açılır. */
  aracOncesi(): void {
    if (!this.adimMetni) return;
    this.adimMetni = false;
    if (this.kesildi) return;
    this.kesildi = true;
    // Ses yoksa (yalnız yazı) kesip yeniden açmaya gerek yok.
    if (!this.k || this.k.sesVar === false) return;
    const eski = this.k;
    this.k = this.ac();
    eski.kes();
  }

  bitir(): void { this.k?.bitir(); }
  kes(): void { this.k?.kes(); }
}
