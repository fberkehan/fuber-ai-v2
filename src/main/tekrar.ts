// ── Tekrarlayan hatırlatıcının sonraki zamanı (saf modül: Electron'suz, testlerde doğrudan çalışır) ───────────
// Aylık tekrar ayın son gününe KIRPILIR ama asıl gün korunur: 31 Oca → 28/29 Şub → 31 Mar. Eskiden setMonth taşıyordu
// (31 Oca + 1 ay = 3 Mar); kırpılmış zamandan hesaplansa da 31'ler kalıcı olarak 28'e kayardı → asıl gün ayrıca saklanır.

/** Yerel saatle bir ay ileri; gün `gun` (hedef ayda yoksa ayın son günü). Saat/dakika korunur. */
export function ayIleri(d: Date, gun: number): void {
  const hedef = d.getMonth() + 1; // 12 → gelecek yılın Ocak'ı (Date taşır)
  const sonGun = new Date(d.getFullYear(), hedef + 1, 0).getDate();
  d.setDate(1); // önce 1'e: 31'inden Şubat'a geçerken taşma olmasın
  d.setMonth(hedef);
  d.setDate(Math.min(gun, sonGun));
}

/** Bir sonraki zaman (ISO) ya da tekrar yoksa null. Uygulama kapalıyken kaçanlar atlanır (sonuç `simdi`den sonradır).
 *  capaGun: aylık tekrarda asıl gün (1-31); verilmezse zamanın kendi günü. */
export function sonrakiZaman(zaman: string, tekrar: string, capaGun?: number | null, simdi = Date.now()): string | null {
  const d = new Date(zaman);
  if (Number.isNaN(d.getTime())) return null;
  const gun = capaGun && capaGun >= 1 && capaGun <= 31 ? capaGun : d.getDate();
  const ileri = (): boolean => {
    if (tekrar === 'gunluk') d.setDate(d.getDate() + 1);
    else if (tekrar === 'haftalik') d.setDate(d.getDate() + 7);
    else if (tekrar === 'aylik') ayIleri(d, gun);
    else if (tekrar === 'hafta_ici') { do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
    else return false;
    return true;
  };
  if (!ileri()) return null;
  while (d.getTime() < simdi) ileri();
  return d.toISOString();
}
