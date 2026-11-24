// Çentik simetri bekçisi (0.14 T28 düzeltme turu 2; centik-videolari.mjs, tests/centik-simetri.test.ts): gri ham kare (satır satır, piksel başına bir bayt).
// Her satırda şeklin en sol ve en sağ pikseli bulunur. Şekil pikseli, o satırın zemininden (iki dış sütunun koyusu) en az `esik` gri düzeyi koyu olan pikseldir.
// Simetrik şekilde sol kenar + sağ kenar toplamı her satırda aynıdır (eksenin iki katı). Ölçüt: her satırın toplamı, toplamların en sık değerinden (tepe) en çok
// ±1 aygıt pikseli uzaktır. Yalnız bir yanda 2 px'lik basamak toplamı 2 kaydırır ve düşer. Kenar yumuşatması toplamı ±1 oynatabilir; bu geçer.
export function simetriOlc(g, en, boy, { esik = 30 } = {}) {
  const satirlar = [];
  for (let y = 0; y < boy; y++) {
    const sinir = Math.min(g[y * en + 1], g[y * en + en - 2]) - esik;
    let sol = -1, sag = -1;
    for (let x = 0; x < en; x++) if (g[y * en + x] < sinir) { sol = x; break; }
    if (sol < 0) continue;
    for (let x = en - 1; x >= sol; x--) if (g[y * en + x] < sinir) { sag = x; break; }
    satirlar.push({ y, sol, sag, toplam: sol + sag });
  }
  if (!satirlar.length) return { satir: 0, tepe: null, sapma: null, gecti: false, enKotu: [] };
  const sayim = new Map();
  for (const s of satirlar) sayim.set(s.toplam, (sayim.get(s.toplam) ?? 0) + 1);
  const tepe = [...sayim.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const sapma = Math.max(...satirlar.map((s) => Math.abs(s.toplam - tepe)));
  const enKotu = [...satirlar].sort((a, b) => Math.abs(b.toplam - tepe) - Math.abs(a.toplam - tepe)).slice(0, 3).map((s) => `${s.y}:${s.sol}+${s.sag}=${s.toplam}`);
  return { satir: satirlar.length, tepe, sapma, gecti: sapma <= 1, enKotu, dagilim: Object.fromEntries([...sayim.entries()].sort((a, b) => a[0] - b[0])) };
}
