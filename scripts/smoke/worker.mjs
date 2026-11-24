// utilityProcess içinde koşar: MessagePort'tan Int16 ses çerçevesi alır, ters yönde PCM yollar.
// Sayfa aynı çerçeveleri üç biçimde gönderir; hangisinin işçiye ulaştığı ölçülür.
const FRAME_SAMPLES = 320; // 16 kHz, 20 ms

process.parentPort.on('message', (event) => {
  if (event.data?.type !== 'port') return;
  const port = event.ports[0];
  const modes = {};
  const startedAt = performance.now();

  port.on('message', (message) => {
    const data = message.data;
    if (data?.type === 'frame') {
      const stat = (modes[data.mode] ??= { frames: 0, samples: 0, checksum: 0, receivedAs: '' });
      stat.receivedAs = Object.prototype.toString.call(data.pcm);
      const pcm = data.pcm instanceof ArrayBuffer ? new Int16Array(data.pcm) : new Int16Array(data.pcm.buffer, data.pcm.byteOffset, data.pcm.length);
      stat.frames++;
      stat.samples += pcm.length;
      for (let i = 0; i < pcm.length; i++) stat.checksum = (stat.checksum + pcm[i]) | 0;
    } else if (data?.type === 'end') {
      // MessagePortMain aktarım listesinde yalnız port kabul eder; ArrayBuffer aktarılamaz, kopyalanır.
      let transferFromWorker;
      try {
        const probe = new Int16Array(4);
        port.postMessage({ type: 'probe', pcm: probe.buffer }, [probe.buffer]);
        transferFromWorker = 'destekleniyor';
      } catch (error) {
        transferFromWorker = `desteklenmiyor: ${error.message}`;
      }
      // Ters yön: işçiden pencereye PCM (TTS çıktısının yolu), kopyalanarak.
      const reply = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < reply.length; i++) reply[i] = (i * 7) % 2000;
      port.postMessage({ type: 'pcm', pcm: reply, modes });
      process.parentPort.postMessage({
        type: 'result',
        result: { modes, transferFromWorker, elapsedMs: Math.round(performance.now() - startedAt) },
      });
    }
  });
  port.start();
});

process.parentPort.postMessage({ type: 'ready' });
