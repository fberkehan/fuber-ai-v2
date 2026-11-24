// ── Arka plan süreç yöneticisi (analiz 11 Kas bulgu 4; yalnız Developer mode) ───────────────────────────────────────────────────────
// Sohbetin `komut_calistir` aracı her süreci 120 sn sonra ağacıyla öldürüyordu: dev sunucusu ya da izleyici hiç ayakta kalmıyordu. `arka_plan: true`
// ile başlatılan komut burada yaşar: SÜRE SINIRI YOK (ön plan komutunun 120 sn'si yalnız komutuCalistir'de), çıktısı halka arabellekte (son ~64 KB /
// 400 satır), kimlikle izlenir. "Çalışan süreçler" listesi (renderer/bilesenler/CalisanSurecler.tsx) canlı çıktıyı ve Durdur'u gösterir; model
// `surec_cikti` / `surec_durdur` araçlarıyla okur ve durdurur. Uygulama kapanırken (before-quit ve process 'exit') hepsi ağacıyla kapanır.
// Onay kuralları ÇAĞIRANDA (araclar/komut.ts): arka plan modu her seferinde onay ister. Bu dosya Electron'a bağlı değil (birim testli).
import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { agacOldur } from '../claudecode/yurutucu.js';
import type { SurecOzeti } from '../../shared/surec.js';
export type { SurecOzeti } from '../../shared/surec.js';

interface Kayit extends Omit<SurecOzeti, 'durum'> { durum: 'calisiyor' | 'bitti' | 'durduruldu' | 'hata'; durduruluyor?: boolean; c?: ChildProcess; tampon: string; satirlar: string[]; yarim: string }

/** Aynı anda en çok bu kadar arka plan süreci (fazlası reddedilir: önce birini durdur). */
export const AZAMI_ARKA_SUREC = 8;
/** Biten süreçlerin kaydı (listede en çok bu kadar; eskisi düşer). */
const BITEN_SINIRI = 6;
const SATIR_SINIRI = 400;
const SATIR_UZUNLUGU = 1_000;

const kayitlar = new Map<string, Kayit>();
let sayac = 0;
let dinleyici: (l: SurecOzeti[]) => void = () => undefined;
let bildirimSaati: ReturnType<typeof setTimeout> | null = null;
let cikisKancasi = false;

/** Liste değişince (başladı, çıktı, bitti) çağrılır: ana süreç arayüze 'surec:degisti' olarak yayar. Çıktı bildirimi ~250 ms'de bir toplanır. */
export function surecDinle(f: (l: SurecOzeti[]) => void): void { dinleyici = f; }
function bildir(hemen = false): void {
  if (hemen) { if (bildirimSaati) { clearTimeout(bildirimSaati); bildirimSaati = null; } try { dinleyici(surecListesi()); } catch { /* dinleyici */ } return; }
  if (bildirimSaati) return;
  bildirimSaati = setTimeout(() => { bildirimSaati = null; try { dinleyici(surecListesi()); } catch { /* dinleyici */ } }, 250);
}

const ozet = (k: Kayit): SurecOzeti => ({
  kimlik: k.kimlik, komut: k.komut, klasor: k.klasor, ...(k.pid !== undefined && k.durum === 'calisiyor' ? { pid: k.pid } : {}), durum: k.durum === 'calisiyor' && k.durduruluyor ? 'durduruluyor' : k.durum, kod: k.kod,
  baslangic: k.baslangic, ...(k.bitis ? { bitis: k.bitis } : {}), ...(k.hata ? { hata: k.hata } : {}), sonSatir: k.sonSatir, ...(k.sohbetId !== undefined ? { sohbetId: k.sohbetId } : {}),
});

export function surecListesi(): SurecOzeti[] { return [...kayitlar.values()].map(ozet); }
export const calisanSurecSayisi = (): number => [...kayitlar.values()].filter((k) => k.durum === 'calisiyor').length;

function bitenleriBuda(): void {
  const biten = [...kayitlar.values()].filter((k) => k.durum !== 'calisiyor');
  for (const k of biten.slice(0, Math.max(0, biten.length - BITEN_SINIRI))) kayitlar.delete(k.kimlik);
}

/** ANSI ve denetim karakterleri silinir; \r ile üzerine yazılan satırın son hâli kalır (ilerleme çubuğu). */
function temizle(s: string): string {
  /* eslint-disable no-control-regex */
  return s.replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b[ -/]*[0-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  /* eslint-enable no-control-regex */
}

function ekle(k: Kayit, parca: string): void {
  if (!parca) return;
  const metin = (k.yarim + parca).replace(/\r\n/g, '\n');
  const parcalar = metin.split('\n');
  k.yarim = parcalar.pop() ?? '';
  if (k.yarim.length > SATIR_UZUNLUGU * 4) { parcalar.push(k.yarim); k.yarim = ''; }
  for (const p of parcalar) {
    const t = temizle(p.slice(p.lastIndexOf('\r') + 1)).slice(0, SATIR_UZUNLUGU);
    k.satirlar.push(t);
  }
  if (k.satirlar.length > SATIR_SINIRI) k.satirlar.splice(0, k.satirlar.length - SATIR_SINIRI);
  const son = [...k.satirlar].reverse().find((s) => s.trim()) ?? temizle(k.yarim).trim();
  k.sonSatir = son.trim().slice(0, 200);
  bildir();
}

/**
 * Komutu arka planda başlatır (onay ve sınıf denetimi ÇAĞIRANDA). `exe`/`args`/`env` komut.ts'in kabuğu ve süzülmüş ortamıdır. Süre sınırı yoktur;
 * süreç kendisi çıkana, Durdur'a ya da uygulama kapanana dek yaşar.
 */
export function arkaPlandaBaslat(o: { komut: string; klasor: string; exe: string; args: string[]; env: Record<string, string>; sohbetId?: number }): SurecOzeti | { kimlik?: undefined; hata: string } {
  if (calisanSurecSayisi() >= AZAMI_ARKA_SUREC) return { hata: `Aynı anda en çok ${AZAMI_ARKA_SUREC} arka plan süreci çalışır; önce birini durdur (surec_durdur ya da "Çalışan süreçler").` };
  const kimlik = `s${++sayac}`;
  const k: Kayit = { kimlik, komut: o.komut, klasor: o.klasor, durum: 'calisiyor', kod: null, baslangic: Date.now(), sonSatir: '', tampon: '', satirlar: [], yarim: '', ...(o.sohbetId !== undefined ? { sohbetId: o.sohbetId } : {}) };
  let c: ChildProcess;
  try {
    c = spawn(o.exe, o.args, { cwd: o.klasor, env: o.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) {
    return { hata: `Komut başlatılamadı: ${(e as Error).message}` };
  }
  k.c = c;
  k.pid = c.pid;
  kayitlar.set(kimlik, k);
  if (!cikisKancasi) { cikisKancasi = true; process.on('exit', () => tumSurecleriDurdur(true)); }
  const dOut = new StringDecoder('utf8');
  const dErr = new StringDecoder('utf8');
  c.stdout?.on('data', (p: Buffer) => ekle(k, dOut.write(p)));
  c.stderr?.on('data', (p: Buffer) => ekle(k, dErr.write(p)));
  c.on('error', (e) => {
    if (k.durum !== 'calisiyor') return;
    k.durum = 'hata'; k.hata = e.message; k.bitis = Date.now(); k.c = undefined;
    bitenleriBuda(); bildir(true);
  });
  c.once('exit', (kod) => {
    ekle(k, dOut.end()); ekle(k, dErr.end());
    if (k.yarim) { ekle(k, '\n'); }
    k.kod = kod;
    if (k.durum === 'calisiyor') k.durum = k.durduruluyor ? 'durduruldu' : 'bitti';
    k.bitis = Date.now();
    k.c = undefined;
    bitenleriBuda();
    bildir(true);
  });
  bildir(true);
  return ozet(k);
}

/** Son `satir` satır (en çok 200) ve özet; kimlik yoksa null. */
export function surecCiktisi(kimlik: unknown, satir = 60): { surec: SurecOzeti; satirlar: string[] } | null {
  const k = typeof kimlik === 'string' ? kayitlar.get(kimlik) : undefined;
  if (!k) return null;
  const n = Math.max(1, Math.min(200, Number.isFinite(satir) ? Math.floor(satir) : 60));
  const l = [...k.satirlar, ...(k.yarim ? [temizle(k.yarim)] : [])];
  return { surec: ozet(k), satirlar: l.slice(-n) };
}

/** Süreci ağacıyla durdurur. Biten ya da bilinmeyen süreç: { tamam: false }. */
export function surecDurdur(kimlik: unknown): { tamam: boolean; hata?: string } {
  const k = typeof kimlik === 'string' ? kayitlar.get(kimlik) : undefined;
  if (!k) return { tamam: false, hata: 'Böyle bir süreç yok.' };
  if (k.durum !== 'calisiyor') return { tamam: true };
  // İnceleme M1: süreç çıkana dek "durduruluyor" (sayılır, kapanışta yeniden öldürülür); 'exit' gelince "durduruldu".
  k.durduruluyor = true;
  if (k.pid !== undefined) agacOldur(k.pid);
  bildir(true);
  return { tamam: true };
}

/** Uygulama kapanıyor: süren bütün arka plan süreçleri ağacıyla kapanır (`esZamanli`: process 'exit' içinde). */
export function tumSurecleriDurdur(esZamanli = false): number {
  let n = 0;
  for (const k of kayitlar.values()) {
    if (k.durum !== 'calisiyor') continue; // "durduruluyor" dahil (taskkill ilk seferde başaramadıysa yeniden)
    k.durduruluyor = true;
    if (k.pid !== undefined) { agacOldur(k.pid, esZamanli); n++; }
  }
  if (n && !esZamanli) bildir(true);
  return n;
}

/** Sınama kancası: kayıtları unut (süreçlere dokunmaz). */
export function _surecleriSifirla(): void { kayitlar.clear(); sayac = 0; }
