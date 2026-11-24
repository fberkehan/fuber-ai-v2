// Sahte ElevenLabs sunucusu (yalnız test; 127.0.0.1): akışlı TTS, akışsız TTS (eski yol, "önce" ölçümü), ses listesi ve gerçek
// zamanlı Scribe (WebSocket). Gerçek ElevenLabs'e hiçbir istek gitmez; anahtar sahte bir dizedir. Uç ve alan adları resmî belgeyle
// aynı (src/main/ses/elevenlabs.ts başındaki notlar). Bağımlılık yok: WebSocket çerçeveleri elle (RFC 6455, yalnız gereken kadarı).
//
//   const s = await sahteElevenLabs({ ttfbMs: 120, parcaMs: 40, parcaBayt: 4410 });
//   s.adres → 'http://127.0.0.1:PORT'   s.istekler → [{ yol, sesId, govde, zaman, ilkParca, bitis, kesildi }]
//   s.hataKur({ kacinci: 2, kez: 2, tur: '500' | '429' | 'kopuk' | 'sessiz' })   s.kapat()
// Ses: her ses kimliği kendi frekansında sinüs (aynı ses = aynı frekans); süre metin uzunluğuyla orantılı (harf başına `harfMs`).
// Scribe: `scribe: { kismi: ['yarın', 'yarın saat on'], kesin: 'yarın saat onda toplantı', commitMs: 60 }` (`kesin` işlev de olabilir: oturuma göre metin).
// 0.13: Scribe'a YALNIZ tek kullanımlık belirteçle bağlanılır (`?token=`; xi-api-key kabul edilmez): `s.belirtecVer('b1')`; kullanılan belirteç silinir,
// ikinci kullanım auth_error. Arıza: `s.ayar.scribe.ariza = { tur: 'kopma' | 'sessiz' | 'mesaj' | 'kapanis', parca?: n, mesaj?: 'session_time_limit_exceeded' }`
// (`parca` yoksa commit anında; kopma: soket düşer, sessiz: yanıt yok, mesaj: hata iletisi + kopma, kapanis: düzgün kapanış, kesin metin yok).
// `s.ayar.scribe.ret = true`: el sıkışma reddi (401).
// 14 Kas (toplantı): AKIŞLI kip — `s.ayar.scribe.akisli = { kelimeHizi: 2.6, kelimeler: { karsi: [...], siz: [...] } | (konusan) => [...], gecikmeMs: 180, commitMs: 220, herBelirtec: true }`.
// Gerçek tanıyıcı gibi davranır: gelen sesin KONUŞMA süresine (20 ms çerçevelerde enerji; sessizlik sayılmaz) göre sözcük açar: her ses parçasından `gecikmeMs` sonra
// o ana dek duyulan sözcüklerle `partial_transcript`, commit'ten `commitMs` sonra o sözcüklerle `committed_transcript`; sözcük kuyruğu konuşan başına kalıcıdır (bağlantı
// yenilense de kaldığı yerden sürer). Konuşan belirteç önekinden okunur (`belirtecVer`/`herBelirtec`: 'karsi-…', 'siz-…'). `s.akisDurumu()` konuşan başına tüketilen sözcüğü verir.
import http from 'node:http';
import crypto from 'node:crypto';

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const govdeOku = (q) => new Promise((coz) => { const p = []; q.on('data', (d) => p.push(d)); q.on('end', () => coz(Buffer.concat(p).toString())); });

/** Ses kimliğinden frekans (Hz): sahte "ses rengi". */
export const sesFrekansi = (sesId) => 180 + (crypto.createHash('sha1').update(String(sesId)).digest()[0] % 160) * 2;

function sinus(sesId, ornek, hz, baslangic = 0) {
  const f = sesFrekansi(sesId);
  const b = Buffer.alloc(ornek * 2);
  for (let i = 0; i < ornek; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * f * (baslangic + i)) / hz) * 9000), i * 2);
  return b;
}

// ── En küçük WebSocket sunucu çerçeveleri ──
function wsCerceve(veri, kod = 0x1) {
  const g = Buffer.from(veri);
  const bas = g.length < 126 ? Buffer.from([0x80 | kod, g.length]) : g.length < 65536 ? Buffer.from([0x80 | kod, 126, g.length >> 8, g.length & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | kod; b[1] = 127; b.writeBigUInt64BE(BigInt(g.length), 2); return b; })();
  return Buffer.concat([bas, g]);
}
function wsOkuyucu(geri) {
  let t = Buffer.alloc(0);
  return (d) => {
    t = Buffer.concat([t, d]);
    for (;;) {
      if (t.length < 2) return;
      const kod = t[0] & 0x0f, maskeli = (t[1] & 0x80) !== 0;
      let boy = t[1] & 0x7f, o = 2;
      if (boy === 126) { if (t.length < 4) return; boy = t.readUInt16BE(2); o = 4; } else if (boy === 127) { if (t.length < 10) return; boy = Number(t.readBigUInt64BE(2)); o = 10; }
      const m = maskeli ? t.subarray(o, o + 4) : null;
      if (maskeli) o += 4;
      if (t.length < o + boy) return;
      const g = Buffer.from(t.subarray(o, o + boy));
      if (m) for (let i = 0; i < g.length; i++) g[i] ^= m[i % 4];
      t = t.subarray(o + boy);
      geri(kod, g);
    }
  };
}

export async function sahteElevenLabs(o = {}) {
  const ayar = { anahtar: 'sahte-eleven-anahtari', ttfbMs: 120, parcaMs: 40, parcaBayt: 4410, harfMs: 55, hz: 22050, tamUretimCarpani: 1, sesler: null, scribe: { kismi: ['yarın'], kesin: 'yarın saat onda toplantım var', commitMs: 60 }, ...o };
  const istekler = [];
  const scribeOturumlari = [];
  const belirtecler = new Set();
  const wsSoketleri = new Set();
  let hata = null; // { kacinci, kez, tur }
  let ttsSayac = 0;
  const akisKalici = { karsi: { tuketilen: 0 }, siz: { tuketilen: 0 } };

  const sunucu = http.createServer(async (q, r) => {
    const u = new URL(q.url, 'http://x');
    const yetki = q.headers['xi-api-key'] === ayar.anahtar;
    if (u.pathname === '/v2/voices' || u.pathname === '/v1/voices') {
      istekler.push({ yol: u.pathname, zaman: Date.now() });
      if (!yetki) { r.writeHead(401, { 'content-type': 'application/json' }); return r.end('{"detail":{"status":"invalid_api_key"}}'); }
      r.writeHead(200, { 'content-type': 'application/json' });
      return r.end(JSON.stringify({ voices: ayar.sesler ?? [{ voice_id: 'hesap-ses-1', name: 'Benim Sesim', category: 'cloned', labels: { gender: 'male', accent: 'turkish' } }, { voice_id: 'hesap-ses-2', name: 'Ofis - Sakin', category: 'generated', labels: { gender: 'female' } }], has_more: false, next_page_token: null }));
    }
    const m = u.pathname.match(/^\/v1\/text-to-speech\/([^/]+)(\/stream)?$/);
    if (!m || q.method !== 'POST') { r.writeHead(404); return r.end(); }
    const sesId = decodeURIComponent(m[1]);
    const akisli = Boolean(m[2]);
    const govde = JSON.parse((await govdeOku(q)) || '{}');
    const sira = ++ttsSayac;
    const kayit = { yol: u.pathname, akisli, sesId, govde, bicim: u.searchParams.get('output_format'), zaman: Date.now(), ilkParca: 0, bitis: 0, kesildi: false, sira };
    istekler.push(kayit);
    let kapandi = false;
    r.on('close', () => { if (!r.writableEnded) { kapandi = true; kayit.kesildi = true; } });
    if (!yetki) { r.writeHead(401, { 'content-type': 'application/json' }); return r.end('{"detail":{"status":"invalid_api_key"}}'); }
    const h = hata && sira >= hata.kacinci && sira < hata.kacinci + hata.kez ? hata.tur : null;
    if (h === '500' || h === '429') { await bekle(30); r.writeHead(Number(h), { 'content-type': 'application/json' }); return r.end('{"detail":"sahte hata"}'); }
    if (h === 'sessiz') { await new Promise((c) => { if (kapandi) c(); else r.on('close', c); }); return; } // hiç yanıt yok: istemcinin zaman aşımı sınanır
    const metin = String(govde.text ?? '');
    const sure = Math.max(300, metin.length * ayar.harfMs); // ms
    const toplamOrnek = Math.round((sure / 1000) * ayar.hz);
    const parcaOrnek = ayar.parcaBayt / 2;
    if (!akisli) {
      // Eski yol: ses TAMAMEN üretildikten sonra tek yanıt (ttfb + bütün parçaların üretim süresi).
      await bekle(ayar.ttfbMs + Math.ceil(toplamOrnek / parcaOrnek) * ayar.parcaMs * ayar.tamUretimCarpani);
      if (kapandi) return;
      r.writeHead(200, { 'content-type': 'audio/mpeg' });
      kayit.ilkParca = Date.now();
      r.end(sinus(sesId, toplamOrnek, ayar.hz));
      kayit.bitis = Date.now();
      return;
    }
    await bekle(ayar.ttfbMs);
    if (kapandi) return;
    r.writeHead(200, { 'content-type': 'audio/pcm', 'transfer-encoding': 'chunked' });
    for (let i = 0; i < toplamOrnek && !kapandi; i += parcaOrnek) {
      if (h === 'kopuk' && i >= parcaOrnek * 2) { r.socket?.destroy(); return; }
      r.write(sinus(sesId, Math.min(parcaOrnek, toplamOrnek - i), ayar.hz, i));
      if (!kayit.ilkParca) kayit.ilkParca = Date.now();
      await bekle(ayar.parcaMs);
    }
    if (!kapandi) { r.end(); kayit.bitis = Date.now(); }
  });

  // ── Scribe gerçek zamanlı (WebSocket) ──
  sunucu.on('upgrade', (q, soket) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname !== '/v1/speech-to-text/realtime') { soket.destroy(); return; }
    const oturum = { sorgu: Object.fromEntries(u.searchParams), anahtar: q.headers['xi-api-key'], belirtec: u.searchParams.get('token'), parcalar: 0, bayt: 0, commit: 0, mesajlar: [], kapandi: false };
    scribeOturumlari.push(oturum);
    oturum.soket = soket;
    if (ayar.scribe.ret) { soket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); soket.destroy(); return; }
    // Yükseltilmiş soketler closeAllConnections'a girmez: kapat() bunları ayrıca kapatır (yoksa sunucu kapanışı asılı kalır).
    wsSoketleri.add(soket);
    soket.on('close', () => wsSoketleri.delete(soket));
    const k = crypto.createHash('sha1').update(`${q.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    soket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${k}\r\n\r\n`);
    const yolla = (v) => { if (!oturum.kapandi) soket.write(wsCerceve(JSON.stringify(v))); };
    const herBelirtec = Boolean(ayar.scribe.akisli?.herBelirtec) && !oturum.belirtec?.startsWith('red');
    if (!belirtecler.delete(oturum.belirtec) && !herBelirtec) {
      // Gerçek sunucu gibi: hata + kapanış çerçevesi, istemcinin kapanış yanıtından sonra (en geç 500 ms) bağlantıyı kapatır.
      yolla({ message_type: 'auth_error', error: 'Invalid token' });
      soket.write(wsCerceve(Buffer.alloc(0), 0x8));
      oturum.kapandi = true;
      soket.on('data', () => soket.destroy());
      setTimeout(() => soket.destroy(), 500).unref();
      return;
    }
    yolla({ message_type: 'session_started', session_id: crypto.randomUUID(), config: { sample_rate: Number(oturum.sorgu.audio_format?.split('_')[1] ?? 16000), audio_format: oturum.sorgu.audio_format, language_code: oturum.sorgu.language_code, model_id: oturum.sorgu.model_id, commit_strategy: oturum.sorgu.commit_strategy } });
    let kismiNo = 0;
    oturum.konusan = /^(karsi|siz)/.exec(oturum.belirtec ?? '')?.[1] ?? 'karsi';
    oturum.acilis = Date.now();
    const ak = ayar.scribe.akisli;
    let konusSn = 0; // son commit'ten beri duyulan KONUŞMA süresi (sn)
    soket.on('data', wsOkuyucu(async (kod, g) => {
      if (kod === 0x8) { oturum.kapandi = true; soket.end(); return; }
      if (kod === 0x9) { soket.write(wsCerceve(g, 0xA)); return; }
      if (kod !== 0x1) return;
      let mj; try { mj = JSON.parse(g.toString()); } catch { return; }
      oturum.mesajlar.push({ message_type: mj.message_type, commit: mj.commit, sample_rate: mj.sample_rate, boy: mj.audio_base_64 ? Buffer.from(mj.audio_base_64, 'base64').length : 0 });
      if (mj.message_type !== 'input_audio_chunk') return;
      oturum.parcalar++;
      const ses = Buffer.from(mj.audio_base_64 ?? '', 'base64');
      oturum.bayt += ses.length;
      if (!mj.commit) { oturum.sonSes = Date.now(); oturum.ilkSes ??= oturum.sonSes; }
      if (ak) {
        // Akışlı kip: enerjiden konuşma süresi → açılan sözcükler (kısmi), commit → kesin.
        for (let i = 0; i + 640 <= ses.length; i += 640) { let t = 0; for (let j = 0; j < 320; j++) { const v = ses.readInt16LE(i + j * 2); t += v * v; } if (Math.sqrt(t / 320) > 150) konusSn += 0.02; }
        const liste = typeof ak.kelimeler === 'function' ? ak.kelimeler(oturum.konusan) : ak.kelimeler[oturum.konusan] ?? [];
        const kal = akisKalici[oturum.konusan];
        const n = Math.min(Math.floor(konusSn * (ak.kelimeHizi ?? 2.6)), Math.max(0, liste.length - kal.tuketilen));
        if (!mj.commit && n > 0) {
          const metin = liste.slice(kal.tuketilen, kal.tuketilen + n).join(' ');
          setTimeout(() => { yolla({ message_type: 'partial_transcript', text: metin }); (oturum.cikanlar ??= []).push({ tur: 'kismi', metin, t: Date.now() }); }, ak.gecikmeMs ?? 180);
        }
        if (mj.commit && !ayar.scribe.ariza) {
          oturum.commit++; oturum.commitZaman = Date.now();
          const sn = konusSn; konusSn = 0;
          // Sözcükler cevap GERÇEKTEN gittiğinde tüketilir: bağlantı cevaptan önce düşerse aynı ses yeni bağlantıda yeniden oynatılınca aynı metin çıkar.
          setTimeout(() => {
            if (oturum.kapandi) return;
            const k = Math.min(Math.floor(sn * (ak.kelimeHizi ?? 2.6)), Math.max(0, liste.length - kal.tuketilen));
            const metin = liste.slice(kal.tuketilen, kal.tuketilen + k).join(' ');
            kal.tuketilen += k;
            yolla({ message_type: 'committed_transcript', text: metin });
            (oturum.cikanlar ??= []).push({ tur: 'kesin', metin, t: Date.now() });
          }, ak.commitMs ?? 220);
          return;
        }
      } else if (oturum.parcalar % 3 === 0 && ayar.scribe.kismi[kismiNo]) yolla({ message_type: 'partial_transcript', text: ayar.scribe.kismi[kismiNo++] });
      const ariza = ayar.scribe.ariza;
      if (ariza && (ariza.parca === undefined ? mj.commit : oturum.parcalar === ariza.parca)) {
        if (ariza.tur === 'sessiz') return;
        if (ariza.tur === 'kapanis') { soket.write(wsCerceve(Buffer.alloc(0), 0x8)); oturum.kapandi = true; soket.end(); return; }
        if (ariza.tur === 'mesaj') yolla({ message_type: ariza.mesaj, error: 'sahte arıza' });
        soket.destroy();
        return;
      }
      if (mj.commit) {
        oturum.commit++;
        oturum.commitZaman = Date.now();
        await bekle(ayar.scribe.commitMs);
        yolla({ message_type: 'committed_transcript', text: typeof ayar.scribe.kesin === 'function' ? ayar.scribe.kesin(oturum) : ayar.scribe.kesin });
      }
    }));
    soket.on('close', () => { oturum.kapandi = true; });
    soket.on('error', () => { oturum.kapandi = true; });
  });

  await new Promise((c) => sunucu.listen(0, '127.0.0.1', c));
  const adres = `http://127.0.0.1:${sunucu.address().port}`;
  return {
    adres, istekler, scribeOturumlari, ayar,
    belirtecVer: (...b) => { for (const x of b) belirtecler.add(x); },
    hataKur: (h) => { hata = h ? { kacinci: h.kacinci ?? ttsSayac + 1, kez: h.kez ?? 1, tur: h.tur } : null; },
    ttsSayisi: () => ttsSayac,
    acikWsSayisi: () => wsSoketleri.size,
    akisDurumu: () => ({ karsi: akisKalici.karsi.tuketilen, siz: akisKalici.siz.tuketilen }),
    akisSifirla: () => { akisKalici.karsi.tuketilen = 0; akisKalici.siz.tuketilen = 0; },
    /** Açık Scribe soketlerinden birini (konuşana göre) düşürür: kopma sınaması. */
    soketDusur: (konusan) => { for (const o of [...scribeOturumlari].reverse()) if (!o.kapandi && (!konusan || o.konusan === konusan)) { o.soket?.destroy(); return true; } return false; },
    kapat: () => new Promise((c) => { for (const s of wsSoketleri) s.destroy(); wsSoketleri.clear(); sunucu.closeAllConnections?.(); sunucu.close(() => c()); }),
  };
}
