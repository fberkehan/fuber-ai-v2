// ── Süreç ağacı (0.14 T28b; saf, birim testli: tests/surec-agaci.test.ts) ─────────────────────────────────────────────────────────────
// Windows'ta ParentProcessId, çocuğu açan sürecin kimliğidir ve o süreç öldükten sonra kimlik yeniden kullanılabilir. Yalnız kimliğe bakan bir ağaç
// yürüyüşü, ölmüş bir başlatıcıdan açılmış yabancı bir uygulamayı (T28b: Discord) kendi süreçlerimizin çocuğu sayar. Kural: çocuk ebeveyninden önce
// oluşmuş olamaz. `olusma`: oluşma anı (ms, herhangi bir sabit başlangıçtan); bilinmiyorsa null (o kenarda yalnız kimliğe bakılır).

/** Görünür boştaki çentik ölçülebilir mi: Windows bildirim durumu 2 (meşgul/tam ekran), 3 (Direct3D tam ekran), 4 (sunu) ya da sayfa gizliyse HAYIR. */
export const tamEkranYaDaGizli = (bildirimDurumu, gorunurluk) => [2, 3, 4].includes(bildirimDurumu) || gorunurluk === 'hidden';

/** `liste`: { pid, ppid, olusma, … }; dönen: kökten inen süreçler (kök dahil), liste sırasıyla. */
export function soyAgaci(liste, kokPid) {
  const olusma = new Map(liste.map((p) => [p.pid, p.olusma]));
  const kume = new Set([kokPid]);
  for (let degisti = true; degisti;) {
    degisti = false;
    for (const p of liste) {
      if (kume.has(p.pid) || !kume.has(p.ppid)) continue;
      const eb = olusma.get(p.ppid);
      if (eb != null && p.olusma != null && p.olusma < eb) continue; // kimliği yeniden kullanılmış ebeveyn: yabancı süreç
      kume.add(p.pid);
      degisti = true;
    }
  }
  return liste.filter((p) => kume.has(p.pid));
}
