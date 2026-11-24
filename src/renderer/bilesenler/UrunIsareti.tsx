// Fuber AI ürün işareti — 0.12: mini logo (shared/urun-isareti.ts MINI_*; uygulama ikonuyla aynı kaynak). Masaüstü arayüzünün
// belirteçleriyle (--gumus-1/2: koyuda gümüş, açıkta grafit) fintech MiniLogo'su: rayın logosu, Fuber Tarayıcı'nın başlangıç düğmesi, açılış
// örtüsü, sohbet avatarı, adanın Fuber bildirimi. Küçük boyda çizgi optik olarak kalınlaşır (miniKalinlik). fintech.css'i yüklemez (doğrudan
// Isaret.tsx'ten içe aktarılır).
import { MiniLogo } from '../ui/fintech/Isaret';

const GUMUS: readonly [string, string] = ['var(--gumus-1)', 'var(--gumus-2)'];

export function UrunIsareti({ olcu = 18, etiket, renk }: { olcu?: number; etiket?: string; renk?: string }) {
  return <MiniLogo olcu={olcu} etiket={etiket} gecis={GUMUS} renk={renk} />;
}
