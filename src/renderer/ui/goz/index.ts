// Gözler (11 Kas, "Pamuk"): eski hayvan karakterlerinin yerine. Masaüstü ve Yönetim bu klasörden içe aktarır (kopya yok, R19).
// Geometri: geometri.ts · hareket: beyin.ts · bileşen: Gozler.tsx · Sade: SadeIsaret.tsx · mod geçişi: ModGecisi.tsx · renk: vurgu.ts
export { Gozler, gozOlcusu, type GozlerOzellikleri } from './Gozler';
export { GorunenGoz } from './GorunenGoz';
export { ModGecisi, MOD_GECISI_MS, MOD_GECISI_AZ_MS, type ModGecisiOzellikleri } from './ModGecisi';
export { SadeIsaret, sadeHal, type SadeHal, type SadeIsaretOzellikleri } from './SadeIsaret';
export { KIP_VURGUSU, kipVurgusu } from './vurgu';
export { defterEtkinligi, type UykuDefteri } from './beyin';
