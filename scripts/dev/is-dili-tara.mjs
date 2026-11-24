// İş dili taraması — önizleme betiklerinin ortak yardımcısı (0.10 Görev 3): pano-onizle (Kokpit), ada-onizle (her ada hâli),
// tarayici-onizle (panel ve şerit). `IS_METNI` sayfada çalışır (page.evaluate(IS_METNI, [kökSeçici, hariçSeçici])): köklerin metni
// (her metin düğümü ayrı sözcük — bitişik öğeler birbirine yapışmaz; kapalı/gizli öğeler dahil), `haric` öğeleri çıkarılmış.
// P4: "Fuber’i bağla" sayfasının "Kendi hesabım" paneli `data-is-dili-istisna` taşır — İş taraması YALNIZ o öğenin içindeki "Claude" ve
// "OpenAI" sözcüklerini atlar; öteki her sözcük taranır. Denetim Node'da: isDiliIhlali(metin) === null (src/shared/is-dili.ts).
export const IS_METNI = ([kokSec, haric]) => {
  const parcalar = [];
  for (const kok of document.querySelectorAll(kokSec)) {
    const k = kok.cloneNode(true);
    for (const e of k.querySelectorAll(haric ? `style, script, ${haric}` : 'style, script')) e.remove();
    const w = document.createTreeWalker(k, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const istisna = n.parentElement?.closest('[data-is-dili-istisna]');
      // 5 Kas: Business'ın "Kendi Claude anahtarım" satırı da istisna (ürün kararı: Business'ta da kendi anahtarı); orada sağlayıcı adı ve "anahtar" zorunlu.
      parcalar.push(istisna ? n.textContent.replace(/\b(?:Claude|OpenAI|Anthropic)\b|[Aa]nahtar\S*/g, '') : n.textContent);
    }
  }
  return parcalar.join(' ').replace(/\s+/g, ' ').trim();
};
