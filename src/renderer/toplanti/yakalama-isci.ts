// ── Toplantı modu: yakalama işçisi (12 Kas 2026) ───────────────────────────────────────────────────────────────────────────────────────────
// Her ses akışının AudioWorklet bağlantı noktası buraya devredilir; örnekler 16 kHz'e indirilir ve enerji VAD'ından geçer (shared/toplanti-vad.ts —
// birim testli çekirdek). 14 Kas: AKIŞ kipi (VAD_AKIS) — ses parçalanmaz, ~80 ms'lik bloklar hâlinde gider; VAD yalnız başlangıç/bitiş söyler. Ana iş parçacığına VAD
// olayları gider (blokların PCM'i aktarılır). Yoklama yok: işçi yalnız gelen blokla çalışır.
import { ToplantiYakalayici, VAD_AKIS, type KesiciOlayi } from '../../shared/toplanti-vad';

type Konusan = 'karsi' | 'siz';
type Gelen =
  | { tur: 'baglan'; konusan: Konusan; port: MessagePort; hz: number }
  | { tur: 'ornek'; konusan: Konusan; ornek: Float32Array; hz: number }
  | { tur: 'bitir' };

const kapsam = self as unknown as { postMessage(m: unknown, aktar?: Transferable[]): void; onmessage: ((e: MessageEvent<Gelen>) => void) | null };
const yakalayicilar = new Map<Konusan, { y: ToplantiYakalayici; hz: number; port?: MessagePort }>();

function gonder(konusan: Konusan, o: KesiciOlayi): void {
  if (o.tur === 'parca' || o.tur === 'ses') kapsam.postMessage({ konusan, ...o }, [o.pcm.buffer]);
  else kapsam.postMessage({ konusan, ...o });
}

function yakalayici(konusan: Konusan, hz: number) {
  let k = yakalayicilar.get(konusan);
  if (!k) { k = { y: new ToplantiYakalayici((o) => gonder(konusan, o), VAD_AKIS), hz }; yakalayicilar.set(konusan, k); }
  return k;
}

kapsam.onmessage = (e) => {
  const m = e.data;
  if (m.tur === 'baglan') {
    const k = yakalayici(m.konusan, m.hz);
    k.port = m.port;
    m.port.onmessage = (p: MessageEvent<Float32Array>) => { if (p.data instanceof Float32Array) k.y.besle(p.data, k.hz); };
  } else if (m.tur === 'ornek') {
    yakalayici(m.konusan, m.hz).y.besle(m.ornek, m.hz);
  } else if (m.tur === 'bitir') {
    // Süren konuşmalar son parçalarıyla kapanır; ardından "kapandı" (arayüz Durdur'u ancak bundan sonra ana sürece iletir).
    for (const k of yakalayicilar.values()) { if (k.port) k.port.onmessage = null; k.y.bitir(); }
    yakalayicilar.clear();
    kapsam.postMessage({ tur: 'kapandi' }); // VAD'ın 'bitti' olayından ayrı (o konusan taşır)
  }
};
