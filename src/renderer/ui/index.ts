// Fuber arayüz kütüphanesi (0.11 G3) — kokpit kartları, sohbet kartları (kart_goster), yapılacaklar ve görevler YALNIZ bunlarla kurulur.
// Taşma kuralı kütüphanenin işidir: her metnin satır sınırı var ([data-kirp] bilinçli kırpma, tamamı title'da ve klavye odağında),
// esnek çocuklar min-width: 0, uzun sözcük bölünür, sayılar tabular. Renkler yalnız tasarim.css belirteçlerinden (ui.css); üç tema.
// Galeri (yalnız test derlemesi, #galeri): Galeri.tsx; ölçüm: scripts/dev/ui-onizle.mjs + scripts/dev/tasma.mjs.
import './ui.css';

export { Kart, KartBaslik, type Eylem, type KartOzellikleri, type KartBaslikOzellikleri } from './Kart';
export { Satir, type SatirOzellikleri } from './Satir';
export { Liste, type ListeOzellikleri } from './Liste';
export { MetinKirp, type MetinKirpOzellikleri } from './MetinKirp';
export { Rozet, type RozetTonu } from './Rozet';
export { Dugme, type DugmeTuru, type DugmeOzellikleri } from './Dugme';
export { Bos, type BosOzellikleri } from './Bos';
export { Iskelet, type IskeletOzellikleri } from './Iskelet';
export { Ilerleme, type IlerlemeOzellikleri } from './Ilerleme';
export { Sayi, type SayiOzellikleri } from './Sayi';
export { Isaret, type IsaretOzellikleri } from './Isaret';
export { Ayrac } from './Ayrac';
// 0.14 T29 (Nusa dili): hap sekmeler ve ekran vurgusu (ekran kökü: style={vurguStili(ekran, kip)}).
export { Sekmeler, type SekmelerOzellikleri } from './Sekme';
export { EKRANLAR, SAYFA_VURGUSU, vurguRengi, vurguStili, type EkranAdi } from './vurgu';
export { sayiBicim, sayiMetni, yuzdeBicim } from './bicim';
