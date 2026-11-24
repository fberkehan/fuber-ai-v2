// ── Kısayolun okunur yazımı (saf) ─────────────────────────────────────────────────────────────────────────────────
// Electron hızlandırıcısı → ekranda okunur metin: "CommandOrControl+Shift+Space" → Windows'ta "Ctrl+Shift+Boşluk", Mac'te
// "⌘+Shift+Boşluk". Görev 19 denetimi: sol menüdeki asistan düğmesinin ipucu sabit "Ctrl+Shift+Space" yazıyordu; kısayol
// Ayarlar'dan değişince yanlış kalıyordu. Kurulum sihirbazı ve tanıtım turu da bunu kullanır (K15: kendi kopyaları kalktı).
// 0.10 Görev 3 (D-6): Electron yazımı ("CommandOrControl", "Space", "Escape") arayüzde görünmez — tuş adları Türkçe/okunur; değiştirici
// tuşlar (Alt, Shift), harf, rakam ve F tuşları aynen. Kayıt hep Electron biçiminde kalır (G10'un tuş yakalayıcısı da bunu gösterir).
const TUS_ADI: Readonly<Record<string, (mac: boolean) => string>> = {
  commandorcontrol: (mac) => (mac ? '⌘' : 'Ctrl'), cmdorctrl: (mac) => (mac ? '⌘' : 'Ctrl'),
  control: () => 'Ctrl', ctrl: () => 'Ctrl', command: () => '⌘', cmd: () => '⌘',
  space: () => 'Boşluk', escape: () => 'Esc', esc: () => 'Esc', return: () => 'Enter', enter: () => 'Enter',
};

/** Electron hızlandırıcısının okunur gösterimi ("CommandOrControl+Shift+Space" → "Ctrl+Shift+Boşluk"; `mac`: ⌘). Boşsa ''. */
export function kisayolGosterimi(electron: string | null | undefined, mac = false): string {
  const t = (electron ?? '').trim();
  if (!t) return '';
  return t.split('+').map((p) => p.trim()).map((p) => TUS_ADI[p.toLowerCase()]?.(mac) ?? p).join('+');
}

/** Gösterimden Electron hızlandırıcısına (Ayarlar'daki kısayol alanı gösterimi yazar): "Boşluk" → "Space", "⌘" → "Command"; Ctrl, Esc,
 *  Enter ve öteki tuşlar Electron'da da geçerli olduğu için aynen. */
export function kisayolElectron(gosterim: string): string {
  return gosterim.split('+').map((p) => p.trim()).map((p) => (p.toLocaleLowerCase('tr') === 'boşluk' ? 'Space' : p === '⌘' ? 'Command' : p)).join('+');
}

/** Eski ad (tepsi, ada, Ayarlar, sihirbaz): kisayolGosterimi ile aynı. */
export const kisayolOkunur = kisayolGosterimi;

/** Adın yanında kısayolu: "Asistan (Ctrl+Shift+Boşluk)"; kısayol yoksa yalnız ad (K15: "Asistan ()" görünmez). */
export function kisayolluAd(ad: string, k: string | null | undefined, mac = false): string {
  const t = kisayolGosterimi(k, mac);
  return t ? `${ad} (${t})` : ad;
}
