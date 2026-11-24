// ── Toplantı modu: AudioWorklet işlemcisi (12 Kas 2026) ─────────────────────────────────────────────────────────────────────────────────────
// Ses iş parçacığında koşar: 128 örneklik çerçeveleri 2048'lik bloklarda toplar ve kendi bağlantı noktasından gönderir (tampon aktarılır, kopya yok).
// Bağlantı noktası arayüzde işçiye devredilir (renderer/toplanti/yakalama.ts): örnekler ana iş parçacığına uğramadan VAD'a gider. Çıkış hep sessizdir.
// Düz JS: Vite bunu derlemeden varlık olarak kopyalar (AudioWorklet modülü ayrı yüklenir; CSP 'self').
class ToplantiYakalamaIslemcisi extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blok = new Float32Array(2048);
    this.dolu = 0;
    this.calisiyor = true;
    this.port.onmessage = (e) => { if (e.data && e.data.tur === 'dur') this.calisiyor = false; };
  }

  process(girdiler) {
    if (!this.calisiyor) return false;
    const kanal = girdiler[0] && girdiler[0][0];
    if (!kanal) return true;
    let i = 0;
    while (i < kanal.length) {
      const n = Math.min(kanal.length - i, this.blok.length - this.dolu);
      this.blok.set(kanal.subarray(i, i + n), this.dolu);
      this.dolu += n;
      i += n;
      if (this.dolu === this.blok.length) {
        const giden = this.blok;
        this.port.postMessage(giden, [giden.buffer]);
        this.blok = new Float32Array(2048);
        this.dolu = 0;
      }
    }
    return true;
  }
}

registerProcessor('toplanti-yakalama', ToplantiYakalamaIslemcisi);
