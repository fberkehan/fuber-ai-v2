// Sahte pano kaynakları (yalnız test; 127.0.0.1): MET Norway hava (locationforecast compact), TR haber akışları (RSS + Atom, biri gzip'li),
// ECB kurları. Uygulamada FUBER_PANO_SAHTE=<adres> (yalnız FUBER_DEMO ile geçerli; main/pano/pano.ts). Gerçek ağa hiç istek gitmez; haber
// başlıkları uydurmadır (gerçek kişi yok). Görev 26 uçtan uca testi kullanır; biçimler scripts/dev/pano-onizle.mjs'teki sunucuyla aynı.
//   const p = await sahtePano();   p.adres · p.istekler → [{ yol, ara, ua, zaman }] · p.kapat()
import http from 'node:http';
import zlib from 'node:zlib';
import { haberKaynaklari } from '../../src/shared/pano.ts';

const yuvarla = (x) => Math.round(x * 10) / 10;

function metJson() {
  const simdi = Date.now();
  const bas = new Date(simdi); bas.setUTCMinutes(0, 0, 0);
  const ts = [];
  const saatTR = (t) => (t.getUTCHours() + 3) % 24;
  const gunduz = (t) => saatTR(t) >= 7 && saatTR(t) < 18;
  const kod = (t, i) => {
    const k = ['partlycloudy', 'partlycloudy', 'cloudy', 'lightrain', 'rain', 'cloudy', 'fair', 'clearsky'][Math.floor(i / 5) % 8];
    return ['cloudy', 'lightrain', 'rain'].includes(k) ? k : `${k}_${gunduz(t) ? 'day' : 'night'}`;
  };
  for (let i = 0; i < 60; i++) {
    const t = new Date(bas.getTime() + i * 3600_000);
    const derece = 13 + 5 * Math.sin(((saatTR(t) - 9) / 24) * 2 * Math.PI) - Math.floor(i / 24);
    ts.push({ time: t.toISOString().replace('.000', ''), data: {
      instant: { details: { air_temperature: yuvarla(derece), wind_speed: 3.4, relative_humidity: 71 } },
      next_1_hours: { summary: { symbol_code: kod(t, i) }, details: { precipitation_amount: kod(t, i).includes('rain') ? 0.4 : 0 } },
      next_6_hours: { summary: { symbol_code: kod(t, i) }, details: { precipitation_amount: 1.2 } },
    } });
  }
  for (let i = 0; i < 16; i++) {
    const t = new Date(bas.getTime() + (60 + i * 6) * 3600_000);
    ts.push({ time: t.toISOString().replace('.000', ''), data: {
      instant: { details: { air_temperature: yuvarla(11 + 4 * Math.sin(i)), wind_speed: 4, relative_humidity: 66 } },
      next_6_hours: { summary: { symbol_code: ['clearsky_day', 'partlycloudy_day', 'rainshowers_day', 'cloudy'][i % 4] }, details: { precipitation_amount: 0.5 } },
    } });
  }
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [28.98, 41.01, 40] }, properties: { meta: { updated_at: new Date(simdi - 20 * 60_000).toISOString(), units: { air_temperature: 'celsius' } }, timeseries: ts } };
}

const BASLIKLAR = {
  trt: ['Merkez Bankası politika faizini sabit tuttu', 'Avrupa Birliği ile vize serbestisi görüşmelerinde yeni tur', 'İzmir’de metro hattının ikinci etabı hizmete girdi', 'Yapay Zekâ yasası komisyondan geçti', 'Karadeniz’de fırtına uyarısı: balıkçılar limanda', 'Kış lastiği uygulaması 1 Aralık’ta başlıyor'],
  'bbc-tr': ['Merkez Bankası kararının ardından piyasalarda ilk tepki', 'Yapay Zekâ yasası: hangi uygulamalar sınırlanacak?', 'Avrupa Birliği raporunda dikkat çeken başlıklar', 'Uzay teleskobundan yeni görüntüler'],
  'dw-tr': ['Avrupa Birliği bakanları Brüksel’de toplandı', 'Merkez Bankası &amp; enflasyon beklentileri: ekonomistler ne diyor?', 'Yapay Zekâ çağında gazetecilik'],
  ntv: ['Merkez Bankası Başkanı sunum yaptı', 'İstanbul’da trafik çilesi: yeni düzenleme', 'Akıllı telefon satışları rekor kırdı', 'Hafta sonu hava nasıl olacak?'],
  cumhuriyet: ['Emekli maaşlarında yeni düzenleme Meclis’te', 'Üniversitelerde yeni dönem kayıtları başladı', 'Antik kentte yeni mozaikler bulundu'],
};

function rssXml(id, port) {
  const kaynak = haberKaynaklari('TR').find((k) => k.id === id);
  const liste = BASLIKLAR[id] ?? ['Uydurma başlık'];
  const t0 = Date.now();
  if (id === 'dw-tr') {
    return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${kaynak?.ad}</title>${liste.map((b, i) => `<entry><title type="html">${b}</title><link rel="alternate" href="http://127.0.0.1:${port}/makale/${id}-${i}"/><updated>${new Date(t0 - (i * 23 + 7) * 60_000).toISOString()}</updated></entry>`).join('')}</feed>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${kaynak?.ad}</title>${liste.map((b, i) => `<item><title>${i % 2 ? `<![CDATA[${b}]]>` : b.replace(/&(?!amp;)/g, '&amp;')}</title><link>http://127.0.0.1:${port}/makale/${id}-${i}</link><pubDate>${new Date(t0 - (i * 31 + 4) * 60_000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
}

function ecbXml() {
  const gunler = [];
  const d = new Date(); d.setUTCHours(12, 0, 0, 0);
  let usd = 1.152, gbp = 0.861, chf = 0.932, tr = 47.9;
  const ham = [];
  for (let i = 0; ham.length < 31; i++) {
    const g = new Date(d.getTime() - i * 86_400_000);
    if (g.getUTCDay() === 0 || g.getUTCDay() === 6) continue;
    ham.push(g.toISOString().slice(0, 10));
  }
  ham.reverse();
  ham.forEach((tarih, i) => {
    usd += Math.sin(i * 1.7) * 0.003; gbp += Math.cos(i * 1.3) * 0.0015; chf += Math.sin(i * 0.9) * 0.001; tr += 0.04 + Math.sin(i) * 0.05;
    gunler.push(`<Cube time='${tarih}'><Cube currency='USD' rate='${usd.toFixed(4)}'/><Cube currency='JPY' rate='175.21'/><Cube currency='GBP' rate='${gbp.toFixed(5)}'/><Cube currency='CHF' rate='${chf.toFixed(4)}'/><Cube currency='TRY' rate='${tr.toFixed(4)}'/></Cube>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject><Cube>${gunler.reverse().join('')}</Cube></gesmes:Envelope>`;
}

export async function sahtePano() {
  const istekler = [];
  let port = 0;
  const sunucu = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    istekler.push({ yol: u.pathname, ara: u.search, ua: q.headers['user-agent'] ?? '', zaman: Date.now() });
    if (u.pathname.startsWith('/makale/')) { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end('<!doctype html><title>Uydurma makale</title><h1>Uydurma makale</h1>'); }
    if (u.pathname === '/hava') {
      r.writeHead(200, { 'content-type': 'application/json', expires: new Date(Date.now() + 30 * 60_000).toUTCString(), 'last-modified': new Date(Date.now() - 20 * 60_000).toUTCString() });
      return r.end(JSON.stringify(metJson()));
    }
    if (u.pathname.startsWith('/haber/')) {
      const id = decodeURIComponent(u.pathname.slice(7));
      if (id === 'trt') { r.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8', 'content-encoding': 'gzip' }); return r.end(zlib.gzipSync(rssXml(id, port))); }
      r.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' }); return r.end(rssXml(id, port));
    }
    if (u.pathname === '/kur/ecb') { r.writeHead(200, { 'content-type': 'text/xml' }); return r.end(ecbXml()); }
    r.writeHead(404); r.end();
  });
  await new Promise((c) => sunucu.listen(0, '127.0.0.1', c));
  port = sunucu.address().port;
  return {
    adres: `http://127.0.0.1:${port}`, istekler,
    kapat: () => new Promise((c) => { sunucu.closeAllConnections?.(); sunucu.close(() => c()); }),
  };
}
