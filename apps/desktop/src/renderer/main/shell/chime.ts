// Açılış çanı (v1 `renderer/acilis/acilis-sesi.ts`'ten): WebAudio ile sentezlenen kısa, yumuşak, üç notalı yükselen
// arpej (Re5 · Fa#5 · La5). Ses dosyası, lisans ve ağ yok. Notalar ve zarf `@fuber/shared` › `CHIME_NOTES`, `CHIME`.
//
// Kural (`chimeDecision`): YALNIZ paketli üretimde ve ayar açıkken çalar; sınamada ve geliştirmede ASLA ses bağlamı
// bile kurulmaz. Karar ve çalma sayısı `window.__fuberChime` içinde durur (e2e sınamada çalmadığını buradan okur).
import { CHIME, CHIME_NOTES, chimeDecision, type ChimeDecision, type ChimeInput } from '@fuber/shared';

declare global {
  interface Window {
    __fuberChime?: { decision: ChimeDecision | null; played: number };
  }
}

const record = (): { decision: ChimeDecision | null; played: number } => (window.__fuberChime ??= { decision: null, played: 0 });
let decided = false;

/** Çanı çalar; bütün notalar sönünce çözülür. Ses çıkışı yoksa sessizce biter (açılış asla bozulmaz). */
async function play(): Promise<void> {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ latencyHint: 'interactive' });
  } catch {
    return;
  }
  record().played += 1;
  try {
    if (ctx.state === 'suspended') await Promise.race([ctx.resume().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 250))]);
    const t0 = ctx.currentTime + CHIME.lead;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = CHIME.lowpassHz;
    filter.Q.value = CHIME.lowpassQ;
    filter.connect(ctx.destination);
    let wave: PeriodicWave | null = null;
    try {
      wave = ctx.createPeriodicWave(new Float32Array(CHIME.harmonics.length), new Float32Array(CHIME.harmonics));
    } catch {
      wave = null;
    }
    const end = Math.max(...CHIME_NOTES.map((note) => note.start + note.duration));
    for (const note of CHIME_NOTES) {
      const start = t0 + note.start;
      const stop = start + note.duration;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(note.peak, start + CHIME.attack);
      gain.gain.exponentialRampToValueAtTime(CHIME.floor, stop);
      gain.connect(filter);
      const osc = ctx.createOscillator();
      if (wave) osc.setPeriodicWave(wave);
      else osc.type = 'sine';
      osc.frequency.value = note.frequency;
      osc.connect(gain);
      osc.start(start);
      osc.stop(stop);
    }
    await new Promise((resolve) => setTimeout(resolve, (end + CHIME.lead + 0.2) * 1000));
  } catch {
    // ses çıkışı yok ya da bozuk: açılış sessiz sürer
  } finally {
    void ctx.close().catch(() => {});
  }
}

/** Süreç başına bir kez karar verir; yalnız `play` kararında çalar. Kararı döndürür. */
export function startupChime(input: ChimeInput): ChimeDecision {
  const state = record();
  if (decided && state.decision) return state.decision;
  decided = true;
  const decision = chimeDecision(input);
  state.decision = decision;
  if (decision === 'play') void play();
  return decision;
}
