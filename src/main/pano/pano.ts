// ── Pano (Görev 24, K14): Electron bağlantısı — ayarlar, saat dilimi, net.fetch, önbellek dosyası, 'pano:degisti' yayını ────────
// Motor ilk 'pano:al' çağrısında kurulur (açılışı yavaşlatmaz; kokpit görünmüyorsa hiç ağa çıkılmaz). Gizli mod açıkken (F1 K1) hiç ağa
// çıkılmaz: son önbellek gösterilir. Ağ yalnız ana süreçten,
// Electron'un net.fetch'iyle (sistemin vekil sunucusu ayarlarına uyar). Önizleme/test (yalnız FUBER_DEMO): FUBER_PANO_SAHTE bütün
// kaynakları yerel sahte sunucuya çevirir; FUBER_DEMO'da o yoksa HİÇ istek yapılmaz (önizleme betikleri ağa çıkmaz).
// FUBER_PANO_SAAT_DILIMI (yalnız FUBER_DEMO): saat dilimini sabitler (önizleme makineden bağımsız olsun).
import { app, net } from 'electron';
import path from 'node:path';
import { ayarlar, ayarDinle } from '../ayarlar.js';
import { yayinla } from '../olaylar.js';
import { yollar } from '../yollar.js';
import { PanoOnbellek } from './onbellek.js';
import { PanoMotoru, GERCEK_TABANLAR, sahteTabanlar } from './pano-motoru.js';
import { PANO_VARSAYILAN, type PanoAyari, type PanoDurumu } from '../../shared/pano.js';
import { DAGITIM } from '../../shared/dagitim.js';

let motor: PanoMotoru | null = null;

export function panoAyari(): PanoAyari {
  return { ...PANO_VARSAYILAN, ...(ayarlar().pano ?? {}) };
}

function kur(): PanoMotoru {
  if (motor) return motor;
  const demo = Boolean(process.env.FUBER_DEMO);
  const sahte = demo ? process.env.FUBER_PANO_SAHTE : undefined;
  const agYok = demo && !sahte;
  motor = new PanoMotoru({
    // F1 (son inceleme K1): Gizli mod açıkken pano ağa çıkmaz (konum MET Norway'e, haber kaynaklarına ve ECB/TCMB'ye istek yok).
    gizli: () => ayarlar().yerel?.gizliMod === true,
    ayar: panoAyari,
    saatDilimi: () => (demo && process.env.FUBER_PANO_SAAT_DILIMI) || Intl.DateTimeFormat().resolvedOptions().timeZone,
    dil: () => app.getLocale(),
    getir: agYok ? null : (url, init) => net.fetch(url, init),
    tabanlar: agYok ? null : sahte ? sahteTabanlar(sahte) : GERCEK_TABANLAR,
    // MET Norway: tanımlayıcı User-Agent + iletişim (projenin web adresi; kullanıcının e-postası GÖNDERİLMEZ).
    ua: `FuberAI/${app.getVersion()} (open source; +${DAGITIM.depo})`,
    onbellek: new PanoOnbellek(path.join(yollar.veri(), 'pano-onbellek.json')),
    degisti: (d) => yayinla('pano:degisti', d),
  });
  // Şehir ya da bir kaynak değişince yeni durum hemen yayınlanır (yeni şehrin havası, açılan kaynak istenir; kapanan istenmez). Gizli mod
  // açılıp kapanınca da (K1): kapanınca bayat kaynaklar hemen tazelenir, açılınca kartlar "Gizli mod" işaretini alır.
  const imzasi = () => JSON.stringify([panoAyari(), ayarlar().yerel?.gizliMod === true]);
  let imza = imzasi();
  ayarDinle(() => {
    const yeni = imzasi();
    if (yeni === imza) return;
    imza = yeni;
    yayinla('pano:degisti', motor!.durum());
  });
  return motor;
}

/** Anlık durum (önbellekten; bayat kaynaklar arka planda tazelenir). */
export function panoDurumu(): PanoDurumu { return kur().durum(); }
/** "Şimdi yenile": açık kaynaklar tazelenir, bitince döner. */
export function panoYenile(): Promise<PanoDurumu> { return kur().yenile(); }
