// Sahte ElevenLabs sunucusu: seslendirme bağlayıcısının hata yolları geliştiricinin kotasından harcamadan sınanır.
// Gerçek sunucunun uçlarını ve hata gövdelerini taklit eder (`POST /v1/text-to-speech/{ses}/stream`).
//
// `state.mode` isteğin nasıl yanıtlanacağını belirler:
//   ok          200, metnin uzunluğuyla orantılı ham PCM (24 kHz, 440 Hz ton), parça parça
//   401         geçersiz anahtar
//   402         plan bu sese izin vermiyor (ücretsiz planda kütüphane sesi)
//   429         eşzamanlı istek sınırı
//   quota       karakter kotası doldu (gerçek sunucu bunu 401 ile bildirir)
//   500         sunucu hatası
//   hang        yanıt hiç başlamaz (ilk parça zaman aşımı)
//   midbreak    ses başlar, 300 ms sonra bağlantı kopar
//   stall       ses başlar, sonra akış durur (bağlantı açık kalır)
//   langreject  `language_code` gönderilmişse 400, gönderilmemişse ok
import http from 'node:http';

const RATE = 24_000;

function tone(ms) {
  const samples = Math.round((ms * RATE) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    // Giriş ve çıkışta kısa rampa: gerçek ses gibi sıfırdan başlar.
    const ramp = Math.min(1, i / 240, (samples - i) / 240);
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 0.25 * ramp * 32767), i * 2);
  }
  return buffer;
}

const errorBody = (status, message) => JSON.stringify({ detail: { status, message } });

export async function startFakeElevenLabs() {
  const state = {
    mode: 'ok',
    /** `ok` kipinde ilk bayttan önceki bekleme (ms). */
    delayMs: 0,
    /** Karakter başına üretilen ses (ms). */
    msPerChar: 60,
    requests: [],
    warmups: 0,
  };
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'POST') {
      state.warmups++;
      // Gerçek sunucu HEAD'e gövdesiz 405 döner ve bağlantıyı açık tutar (ısıtma bunu kullanır).
      if (req.method === 'HEAD') res.writeHead(405, { 'content-length': '0' }).end();
      else res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        // Bozuk gövde: boş istek sayılır.
      }
      const voice = url.pathname.split('/')[3] ?? '';
      const mode = state.mode;
      state.requests.push({
        voice,
        text: body.text ?? '',
        model: body.model_id ?? null,
        language: body.language_code ?? null,
        format: url.searchParams.get('output_format'),
        hasKey: typeof req.headers['xi-api-key'] === 'string' && req.headers['xi-api-key'].length > 0,
        mode,
        at: Date.now(),
      });
      const fail = (status, code, message) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(errorBody(code, message));
      };
      if (mode === '401') return fail(401, 'invalid_api_key', 'Invalid API key');
      if (mode === '402') return fail(402, 'payment_required', 'Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.');
      if (mode === '429') return fail(429, 'too_many_concurrent_requests', 'Too many concurrent requests.');
      if (mode === 'quota') return fail(401, 'quota_exceeded', 'This request exceeds your quota.');
      if (mode === '500') return fail(500, 'internal_error', 'Internal server error');
      if (mode === 'langreject' && body.language_code) return fail(400, 'unsupported_language', 'language_code is not supported by this model');
      if (mode === 'hang') return;

      const audio = tone(Math.max(300, String(body.text ?? '').length * state.msPerChar));
      const send = () => {
        res.writeHead(200, { 'content-type': 'audio/pcm' });
        if (mode === 'midbreak' || mode === 'stall') {
          // Tek sayıda bayt da gönderilir: bağlayıcı yarım örneği taşımalı.
          res.write(audio.subarray(0, Math.round(RATE * 0.3) * 2 + 1));
          if (mode === 'midbreak') setTimeout(() => req.socket.destroy(), 50);
          return;
        }
        let offset = 0;
        const pump = () => {
          if (res.destroyed) return;
          if (offset >= audio.length) return void res.end();
          // Parça boyu bilerek tek sayı: örnek sınırına denk gelmeyen parçalar sınanır.
          const end = Math.min(audio.length, offset + 4801);
          res.write(audio.subarray(offset, end));
          offset = end;
          setTimeout(pump, 5);
        };
        pump();
      };
      if (state.delayMs > 0) setTimeout(send, state.delayMs);
      else send();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
