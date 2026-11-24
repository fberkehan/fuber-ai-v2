// ── Dikte kapısı (0.13 T10): yazıya çevirme oturumu, konuşma duyulana dek AÇILMAZ ────────────────────────────────────────────────────────
// "Hey Fuber" yanlış uyanırsa (konuşma yok) hiçbir şey açılmaz: belirteç alınmaz, WebSocket kurulmaz, ses gitmez. Konuşma duyulunca (`baslat`) oturum açılır ve o ana
// dek bekleyen örnekler (konuşmanın ilk hecesi dahil) ona akıtılır. Elle açılan dinlemede (kullanıcı bastı) `baslat` hemen çağrılır. Yol yoksa ('yok') oturum null
// döner ve bekleyen örnekler atılır. Saf: oturumu açma işi dışarıdan gelir; testli (tests/dikte-sirasi.test.ts).
export interface Oturumcuk { besle(ornekler: Float32Array, hz: number): void; iptal(): void }

export interface DikteKapisi<O extends Oturumcuk> {
  /** Mikrofon örneği: oturum açıksa ona, açılmadıysa (henüz konuşma yok) bekletilir, yol yoksa atılır. */
  besle(ornekler: Float32Array, hz: number): void;
  /** Oturumu aç (bir kez; tekrarı yok sayılır). */
  baslat(): void;
  /** `baslat` hiç çağrılmadıysa undefined, yol yoksa null, açıldıysa oturum. */
  oturum(): Promise<O | null | undefined>;
  /** Vazgeçildi / konuşma olmadı: bekleyenler atılır, açıksa oturum iptal edilir. */
  iptal(): void;
}

export function dikteKapisi<O extends Oturumcuk>(ac: () => Promise<O | null>): DikteKapisi<O> {
  const bekleyen: [Float32Array, number][] = [];
  let acik: O | null = null;
  let yok = false;
  let vazgecildi = false;
  let sozu: Promise<O | null> | null = null;
  return {
    besle(ornekler, hz) {
      if (acik) acik.besle(ornekler, hz);
      else if (!yok && !vazgecildi) bekleyen.push([ornekler, hz]);
    },
    baslat() {
      if (sozu || vazgecildi) return;
      sozu = ac().catch(() => null).then((o) => {
        if (vazgecildi) { o?.iptal(); return null; }
        acik = o;
        yok = !o;
        for (const [x, hz] of bekleyen.splice(0)) o?.besle(x, hz);
        return o;
      });
    },
    oturum: () => (sozu ?? Promise.resolve(undefined)),
    iptal() {
      vazgecildi = true;
      bekleyen.length = 0;
      acik?.iptal();
      acik = null;
    },
  };
}
