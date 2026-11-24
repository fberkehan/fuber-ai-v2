// ── Chrome bağlantısı durumu (main) — yalnız OKUR: Chrome profillerini ve kayıt anahtarını denetler, hiçbir şey yazmaz ────────────────
// Saf kural ve açıklama: shared/chrome-baglanti.ts. Burada yalnız disk ve kayıt defteri okuması; bağımlılıklar testte değiştirilir.
// Fuber kayıt defterine YAZMAZ: yerel mesajlaşma ana bilgisayarını Claude Code (`--chrome`) kendisi kaydeder.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  CHROME_ANA_BILGISAYAR, CHROME_EKLENTI_KIMLIGI, chromeDurumuHesapla, chromeProfilAdiMi, type ChromeBilgisi, type ChromeGirdisi,
} from '../shared/chrome-baglanti.ts';

export interface ChromeOkuyucu {
  /** Chrome "User Data" klasörü; yoksa null. */
  kullaniciVerisi: () => string | null;
  /** `HKCU\Software\Google\Chrome\NativeMessagingHosts\<ad>` varsayılan değeri (manifest yolu); anahtar yoksa null. */
  kayitDegeri: (ad: string) => Promise<string | null>;
  dosyaVar: (yol: string) => boolean;
  dosyaOku: (yol: string) => string | null;
  klasorler: (yol: string) => string[];
}

const varsayilanOkuyucu: ChromeOkuyucu = {
  kullaniciVerisi: () => {
    const kok = process.env.LOCALAPPDATA;
    if (!kok) return null;
    const y = path.join(kok, 'Google', 'Chrome', 'User Data');
    try { return fs.statSync(y).isDirectory() ? y : null; } catch { return null; }
  },
  kayitDegeri: (ad) => new Promise((coz) => {
    if (process.platform !== 'win32') { coz(null); return; }
    // reg.exe SİSTEM klasöründen çağrılır (PATH'teki sahte bir reg.exe'ye güvenme); yalnız okur.
    const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    execFile(reg, ['query', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${ad}`, '/ve'], { windowsHide: true, timeout: 5000 }, (hata, cikti) => {
      if (hata) { coz(null); return; }
      const m = /REG_SZ\s+(.+?)\s*$/m.exec(String(cikti));
      coz(m ? m[1] : null);
    });
  }),
  dosyaVar: (y) => { try { return fs.statSync(y).isFile(); } catch { return false; } },
  dosyaOku: (y) => { try { return fs.readFileSync(y, 'utf8'); } catch { return null; } },
  klasorler: (y) => { try { return fs.readdirSync(y, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } },
};

/** Ana bilgisayar kaydı: anahtar → manifest → manifestin `path`'i. Hangi halkada koptuğu "bozuk"; anahtar hiç yoksa "yok". */
export async function anaBilgisayarDurumu(o: ChromeOkuyucu = varsayilanOkuyucu): Promise<ChromeGirdisi['anaBilgisayar']> {
  const manifestYolu = await o.kayitDegeri(CHROME_ANA_BILGISAYAR);
  if (!manifestYolu) return 'yok';
  const ham = o.dosyaOku(manifestYolu);
  if (ham === null) return 'bozuk';
  try {
    const m = JSON.parse(ham) as { path?: unknown; name?: unknown; allowed_origins?: unknown };
    if (m.name !== CHROME_ANA_BILGISAYAR || typeof m.path !== 'string' || !m.path) return 'bozuk';
    if (!Array.isArray(m.allowed_origins) || !m.allowed_origins.includes(`chrome-extension://${CHROME_EKLENTI_KIMLIGI}/`)) return 'bozuk';
    return o.dosyaVar(m.path) ? 'tamam' : 'bozuk';
  } catch { return 'bozuk'; }
}

/** Claude eklentisinin klasörü olan Chrome profilleri (yalnız "Default" ve "Profile N"). */
export function eklentiProfilleri(o: ChromeOkuyucu = varsayilanOkuyucu): string[] {
  const kok = o.kullaniciVerisi();
  if (!kok) return [];
  return o.klasorler(kok).filter(chromeProfilAdiMi).filter((p) => o.klasorler(path.join(kok, p, 'Extensions')).includes(CHROME_EKLENTI_KIMLIGI)).sort();
}

export async function chromeBilgisi(o: ChromeOkuyucu = varsayilanOkuyucu): Promise<ChromeBilgisi> {
  const chromeVar = o.kullaniciVerisi() !== null;
  return chromeDurumuHesapla({ chromeVar, eklentiProfilleri: eklentiProfilleri(o), anaBilgisayar: chromeVar ? await anaBilgisayarDurumu(o) : 'yok' });
}

/** Oturum açılırken (eşzamanlı yol): eklenti diskte görünüyor mu. Kayıt defterine bakılmaz; ana bilgisayarı Claude Code `--chrome` ile kendisi kaydeder. */
export function chromeEklentisiKurulu(o: ChromeOkuyucu = varsayilanOkuyucu): boolean {
  return eklentiProfilleri(o).length > 0;
}
