// ── Fuber Geliştirici Paketi'nin uygulama bağlantısı (Görev 29; Electron tarafı) ────────────────────────────────────────────────────
// Motor Electron'dan bağımsızdır (eklenti-kurucu.ts); burada bağlanır:
//  • İlerleme 'claudecode:eklenti' olayıyla pencerelere (telefona GİTMEZ: kopru-protokol.ts TELEFONA_GITMEZ). Kanalların hepsi telefondan
//    KAPALI (UZAKTAN_KAPALI): eklenti kurmak/kaldırmak bilgisayarda komut çalıştırmaktır.
//  • Paket bitince (ya da Claude Code beklenirken) ada / tost / Windows bildirimi; tıklayınca Claude Code → Eklentiler.
//  • Kullanıcı becerisi silinmez, Geri Dönüşüm Kutusu'na taşınır (shell.trashItem).
//  • Fuber'in başlattığı her Claude Code sürecinde (uygulama içi oturum, terminal, eklenti komutları) Graphify'ın sorgu günlüğü kapalı:
//    GRAPHIFY_QUERY_LOG_DISABLE=1 (kullanıcı kendisi bir değer vermişse dokunulmaz).
//  • Açılışta yarıda kalan / Claude Code bekleyen paket kaldığı yerden sürer (uygulama açılışını yormasın diye 8 sn sonra).
//  • Uygulama kapanırken ('will-quit') süren kurulum komutları süreç ağaçlarıyla durdurulur (yetim claude / uv / graphify kalmaz);
//    yarıda kalan öğe sonraki açılışta kuyruktan sürer.
//  • Görev 7 (0.10) + K8: Graphify'ın kancası bozuk mu (kanca settings.json'da, çağıracağı graphify yok) — durum her okunduğunda yalnız
//    okuyarak denetlenir (eklenti-kurucu.ts graphifyDenetle); Eklentiler'de Graphify satırı yalnız o zaman hata hâli gösterir.
import os from 'node:os';
import path from 'node:path';
import { app, shell } from 'electron';
import { EklentiKurucu } from './eklenti-kurucu.js';
import { claudeDizini } from './indeks.js';
import { yollar } from '../yollar.js';
import { yayinla } from '../olaylar.js';
import { adaGonder } from '../ada.js';
import { ayarlar, ayarDinle } from '../ayarlar.js';

let ornek: EklentiKurucu | null = null;

/**
 * Graphify kancasının çağıracağı `graphify`nin arandığı klasörler: YALNIZ uv'nin komut klasörleri (uv'nin sırası: UV_TOOL_BIN_DIR,
 * XDG_BIN_HOME, XDG_DATA_HOME/../bin, ~/.local/bin) — kancanın mutlak yolu varsa o ayrıca. PATH'in tamamı taranmaz (düzeltme turu 1:
 * ana süreçte eşzamanlı stat yükü yok). Önizlemede/testte (FUBER_DEMO) yalnız geçici evin ~/.local/bin'i.
 */
export function graphifyKomutDizinleri(): string[] {
  const ev = path.join(os.homedir(), '.local', 'bin');
  if (process.env.FUBER_DEMO) return [ev];
  const e = process.env;
  return [...new Set([e.UV_TOOL_BIN_DIR, e.XDG_BIN_HOME, e.XDG_DATA_HOME ? path.join(e.XDG_DATA_HOME, '..', 'bin') : '', ev].filter((x): x is string => Boolean(x && x.trim())))];
}

export function eklentiKurucu(): EklentiKurucu {
  if (ornek) return ornek;
  if (!process.env.GRAPHIFY_QUERY_LOG_DISABLE) process.env.GRAPHIFY_QUERY_LOG_DISABLE = '1';
  ornek = new EklentiKurucu({
    veriDizini: path.join(yollar.veri(), 'claudecode'),
    araclarDizini: path.join(yollar.veri(), 'araclar'),
    claudeDizini,
    olay: (d) => yayinla('claudecode:eklenti', d),
    bildir: (baslik, metin) => adaGonder('asistan:bildir', { tur: 'mesaj', baslik, metin, yol: 'claude#eklentiler' }, 'fuber'),
    cop: (y) => shell.trashItem(y),
    // İş modunda (K2) hiçbir kurulum başlamaz ya da sürmez, bildirim yok; Geliştirici'ye dönünce kuyruk sürer.
    etkin: () => ayarlar().mod === 'gelistirici',
    graphifyKomutDizinleri,
  });
  return ornek;
}

/** Uygulama açılışı (ipc.ts): ortam varsayılanı + bekleyen paket sürer (Geliştirici modunda; mod Geliştirici'ye dönünce de). */
let kapanisBagli = false;
export function eklentileriBaslat(): void {
  const k = eklentiKurucu();
  if (!kapanisBagli) { kapanisBagli = true; app.on('will-quit', () => k.kapat()); }
  const z = setTimeout(() => k.surdur(), 8000);
  z.unref?.();
  let mod = ayarlar().mod;
  ayarDinle((a) => { if (a.mod !== mod) { mod = a.mod; if (mod === 'gelistirici') k.surdur(); } });
}
