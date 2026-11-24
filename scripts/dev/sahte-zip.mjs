// Sahte uv arşivi ve yerel sunucusu (yalnız test/önizleme; 127.0.0.1, ağ YOK). Görev 29: SHA-256 eşleşme / uyuşmazlık ve yol geçişi yolları.
//   zipOlustur([{ ad: 'uv.exe', veri: Buffer }], { yontem: 8 }) → Buffer (en küçük zip: yerel başlıklar + merkezi dizin + son kayıt)
//   const s = await sahteUvSunucusu({ zip }); s.url → 'http://127.0.0.1:PORT/uv.zip'; s.sha256; s.istekler; s.bozukYap(); s.kapat()
import http from 'node:http';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

export function zipOlustur(dosyalar, { yontem = 8 } = {}) {
  const yereller = [];
  const merkez = [];
  let konum = 0;
  for (const { ad, veri } of dosyalar) {
    const ham = Buffer.isBuffer(veri) ? veri : Buffer.from(String(veri));
    const sik = yontem === 8 ? zlib.deflateRawSync(ham) : ham;
    const adB = Buffer.from(ad, 'utf8');
    const crc = zlib.crc32(ham) >>> 0;
    const y = Buffer.alloc(30);
    y.writeUInt32LE(0x04034b50, 0); y.writeUInt16LE(20, 4); y.writeUInt16LE(0x0800, 6); y.writeUInt16LE(yontem, 8);
    y.writeUInt32LE(crc, 14); y.writeUInt32LE(sik.length, 18); y.writeUInt32LE(ham.length, 22); y.writeUInt16LE(adB.length, 26);
    yereller.push(y, adB, sik);
    const m = Buffer.alloc(46);
    m.writeUInt32LE(0x02014b50, 0); m.writeUInt16LE(20, 4); m.writeUInt16LE(20, 6); m.writeUInt16LE(0x0800, 8); m.writeUInt16LE(yontem, 10);
    m.writeUInt32LE(crc, 16); m.writeUInt32LE(sik.length, 20); m.writeUInt32LE(ham.length, 24); m.writeUInt16LE(adB.length, 28); m.writeUInt32LE(konum, 42);
    merkez.push(m, adB);
    konum += 30 + adB.length + sik.length;
  }
  const md = Buffer.concat(merkez);
  const son = Buffer.alloc(22);
  son.writeUInt32LE(0x06054b50, 0); son.writeUInt16LE(dosyalar.length, 8); son.writeUInt16LE(dosyalar.length, 10);
  son.writeUInt32LE(md.length, 12); son.writeUInt32LE(konum, 16);
  return Buffer.concat([...yereller, md, son]);
}

export const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Sahte uv arşivi: uv.exe / uvx.exe / uvw.exe (içerik yalnız metin: hiçbir zaman ÇALIŞTIRILMAZ — testte uv FUBER_UV_KOMUT'la sahtedir). */
export const sahteUvZip = () => zipOlustur([
  { ad: 'uv.exe', veri: 'SAHTE uv 0.13.5 — çalıştırılmaz\n'.repeat(200) },
  { ad: 'uvx.exe', veri: 'SAHTE uvx\n' },
  { ad: 'uvw.exe', veri: 'SAHTE uvw\n' },
  { ad: 'LICENSE', veri: 'sahte lisans (çıkarılmaz)\n' },
]);

export async function sahteUvSunucusu({ zip = sahteUvZip(), gecikmeMs = 0, parcaMs = 0 } = {}) {
  let govde = zip;
  let uzunlukGizli = false;
  const istekler = [];
  const sunucu = http.createServer(async (q, r) => {
    const istek = { yol: q.url, zaman: Date.now(), gonderilen: 0, yarida: false };
    istekler.push(istek);
    if (q.url !== '/uv.zip') { r.writeHead(404); r.end(); return; }
    if (gecikmeMs) await new Promise((c) => setTimeout(c, gecikmeMs));
    r.on('close', () => { if (!r.writableFinished) istek.yarida = true; });
    if (uzunlukGizli) {
      // content-length yok: istemci sınırı akış sırasında uygulamalı (64 KB'lık parçalar, araya kısa bekleme).
      r.writeHead(200, { 'content-type': 'application/zip' });
      for (let i = 0; i < govde.length && !r.destroyed; i += 65_536) {
        const p = govde.subarray(i, i + 65_536);
        if (!r.write(p)) await new Promise((c) => { r.once('drain', c); r.once('close', c); });
        istek.gonderilen += p.length;
        await new Promise((c) => setTimeout(c, 2));
      }
      if (!r.destroyed) r.end();
      return;
    }
    r.writeHead(200, { 'content-type': 'application/zip', 'content-length': String(govde.length) });
    if (!parcaMs) { r.end(govde); return; }
    const adim = Math.max(1, Math.ceil(govde.length / 8));
    for (let i = 0; i < govde.length; i += adim) { r.write(govde.subarray(i, i + adim)); await new Promise((c) => setTimeout(c, parcaMs)); }
    r.end();
  });
  await new Promise((c) => sunucu.listen(0, '127.0.0.1', c));
  const adres = `http://127.0.0.1:${sunucu.address().port}`;
  return {
    adres, url: `${adres}/uv.zip`, sha256: sha256(zip), istekler,
    /** Sunulan dosya değişir (beklenen özet aynı kalır → uyuşmazlık). */
    bozukYap: () => { govde = Buffer.concat([zip.subarray(0, zip.length - 30), Buffer.alloc(30, 7)]); },
    /** Başka bir gövde sunar (ör. beklenenden büyük; `uzunlukYok`: content-length bildirmeden akıtır). */
    govdeYap: (b, { uzunlukYok = false } = {}) => { govde = b; uzunlukGizli = uzunlukYok; },
    duzelt: () => { govde = zip; uzunlukGizli = false; },
    kapat: () => new Promise((c) => { sunucu.closeAllConnections?.(); sunucu.close(() => c()); }),
  };
}
