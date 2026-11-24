// Fintech tasarım dili (0.12 H3a; spec "Tasarım dili: Apple fintech"): kurulum v2, Tekrar hoş geldin ve Fuber Yönetim (H4) aynı bileşenleri
// içe aktarır. Masaüstüne özgü IPC yok — her bileşen yalnız React, shared/ ve ortak simge setini (bilesenler/Ikon) kullanır.
import './fintech.css';

export { HapDugme, type HapDugmeOzellikleri } from './HapDugme';
export { SecimKarti, SecimGrubu, type SecimSecenegi } from './SecimKarti';
export { ModelKarti, ModelKartlari, modelKisaDurumu, type ModelKartiVerisi } from './ModelKarti';
export { Segment, CipGrubu } from './Segment';
export { Anahtar, Alan, Girdi, SaatSecici, saatEkle } from './Denetimler';
export { BuyukSayi } from './BuyukSayi';
export { IlerlemeCizgisi } from './IlerlemeCizgisi';
export { AdimGecisi } from './AdimGecisi';
export { Tepsi, Nesne, Levha } from './Onizleme';
export { MiniLogo, FT_GUMUS, FuberIsareti, FuberYazisi, IsaretAnimasyonu, type MiniLogoOzellikleri } from './Isaret';
export { YAY, YAY_SEK, yayEgrisi, yayKonumu, ONIZLEME_GECIKMESI_MS, GECIS_KAYMASI_PX } from './yay';
