// Tek "Önerilen" rozeti (G8, denetim C-20): nötr, küçük hap — aynı anlam her yerde aynı biçimde (mavi değil; Çentik dilinde mavi yalnız
// küçük nokta). Biçimi kendi dosyasında (rozet.css): kurulum dışında da kullanılabilir.
import './rozet.css';

export function Rozet({ metin = 'Önerilen' }: { metin?: string }) {
  return <span className="rozet" data-rozet="">{metin}</span>;
}
