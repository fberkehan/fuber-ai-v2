// ── Açılış çanı: WebAudio ile sentezlenen kısa, yumuşak, üç notalık yükselen arpej (0.11 G11, spec §9) ─────────────────────────────
// Ses dosyası, lisans ve ağ YOK: üç sinüs-ağırlıklı nota (re majör üçlüsü: Re5 – Fa#5 – La5), her biri yumuşak atak (30 ms doğrusal) ve
// üstel sönümle; alçak geçiren süzgeçle ılık. Bildirim "pınk"ı değil, açılan bir kapının sesi: sakin, düşük düzeyli.
// Sınırlar (tests/acilis.test.ts): 2–3 nota; ilk notadan son sönüme ≤ 0,9 sn; en yüksek kazanç ≤ 0,15 (notalar tek osilatörlü ve
// PeriodicWave normalize olduğundan bir notanın genliği kendi kazanç tepesidir; üst üste binen zarfların her andaki toplamı da ≤ 0,15 —
// ölçüm: ≈ 0,10 (scripts/dev/acilis-onizle.mjs çanı OfflineAudioContext'te tamponlayıp tepe, süre ve tık denetler).

export interface AcilisNotasi {
  /** Hz. */
  frekans: number;
  /** Çanın başından (s). */
  baslangic: number;
  /** Notanın sönüp durduğu ana kadar (s). */
  sure: number;
  /** Kazanç tepesi (0–0,15). */
  tepe: number;
}

export const ACILIS_NOTALARI: readonly AcilisNotasi[] = [
  { frekans: 587.33, baslangic: 0, sure: 0.66, tepe: 0.092 }, // Re5
  { frekans: 739.99, baslangic: 0.12, sure: 0.62, tepe: 0.078 }, // Fa#5
  { frekans: 880, baslangic: 0.24, sure: 0.64, tepe: 0.066 }, // La5
];
/** Yumuşak atak (s): notanın sıfırdan tepeye çıkışı; tık sesi yok. */
export const ACILIS_ATAK = 0.03;
/** Sönümün bittiği kazanç (üstel rampa sıfıra inemez; bu değer duyulmaz). */
export const ACILIS_SESSIZ = 0.0001;
/** İlk notayı bağlamın şimdisinden bu kadar ileriye kurarız (geçmişe zamanlama yok). */
const ONCE = 0.03;
/** Alçak geçiren süzgeç (Hz): sert üst harmonikleri alır, çan ılık kalır. */
const SUZGEC_HZ = 2600;
/** Armonik serisi (sinüs): temel 1, 2. harmonik ve 3. harmonik hafifçe — "yumuşak çan" tınısı. */
const ARMONIKLER = [0, 1, 0.18, 0.04];

/** Çanı çalar; bütün notalar sönünce çözülür. Ses çıkışı yoksa/bozuksa SESSİZCE biter (açılış asla bozulmaz). */
export async function acilisSesiCal(ctx: AudioContext): Promise<void> {
  try {
    // Askıdaki bağlam (otomatik oynatma politikası) sürdürülür; takılırsa 250 ms'den sonra yine de zamanlanır.
    if (ctx.state === 'suspended') {
      let zaman: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([ctx.resume().catch(() => undefined), new Promise<void>((coz) => { zaman = setTimeout(coz, 250); })]);
      clearTimeout(zaman);
    }
    const t0 = ctx.currentTime + ONCE;
    const suzgec = ctx.createBiquadFilter();
    suzgec.type = 'lowpass';
    suzgec.frequency.value = SUZGEC_HZ;
    suzgec.Q.value = 0.4;
    suzgec.connect(ctx.destination);
    let dalga: PeriodicWave | null = null;
    try { dalga = ctx.createPeriodicWave(new Float32Array(ARMONIKLER.length), new Float32Array(ARMONIKLER)); } catch { dalga = null; }

    let kalan = ACILIS_NOTALARI.length;
    const son = Math.max(...ACILIS_NOTALARI.map((n) => n.baslangic + n.sure));
    await new Promise<void>((coz) => {
      let bitti = false;
      const bit = () => { if (bitti) return; bitti = true; clearTimeout(emniyet); coz(); };
      // onended gelmezse (askıdaki bağlam) çan süresi + pay sonra yine çözülür.
      const emniyet = setTimeout(bit, (son + 0.4) * 1000);
      for (const n of ACILIS_NOTALARI) {
        const bas = t0 + n.baslangic;
        const dur = bas + n.sure;
        const kazanc = ctx.createGain();
        kazanc.gain.setValueAtTime(0, bas);
        kazanc.gain.linearRampToValueAtTime(n.tepe, bas + ACILIS_ATAK);
        kazanc.gain.exponentialRampToValueAtTime(ACILIS_SESSIZ, dur);
        kazanc.connect(suzgec);
        const o = ctx.createOscillator();
        if (dalga) o.setPeriodicWave(dalga); else o.type = 'sine';
        o.frequency.value = n.frekans;
        o.connect(kazanc);
        o.onended = () => { o.disconnect(); kazanc.disconnect(); if (--kalan <= 0) bit(); };
        o.start(bas);
        o.stop(dur);
      }
    });
    suzgec.disconnect();
  } catch { /* ses çıkışı yok ya da bozuk: açılış sessiz sürer */ }
}

/** Yeni bir bağlamda çalar ve bitince bağlamı kapatır (çan bitene ve bağlam kapanana dek çözülmez; çağıran beklemek zorunda değil).
 *  Atlama (tıklama/tuş) çalan sesi KESMEZ: çan kendi hâlinde biter. Bağlam kurulamazsa SESSİZCE biter (açılış bozulmaz). */
export async function acilisSesiBaslat(): Promise<void> {
  let ctx: AudioContext;
  try { ctx = new AudioContext({ latencyHint: 'interactive' }); } catch { return; }
  try { await acilisSesiCal(ctx); } finally { try { await ctx.close(); } catch { /* zaten kapalı */ } }
}
