// Görev 26 / Ruling CF — gerçek ikili dumanı için modül kancası: uygulamanın KENDİ motoru (main/claudecode/oturum-yoneticisi.ts) Agent
// SDK'yı içe aktarınca, aynı SDK'yı saran korumalı modüle (sdk-sarmal.mjs) yönlendirilir. Başka hiçbir içe aktarma değişmez.
export async function resolve(belirtec, baglam, sonraki) {
  if (belirtec === '@anthropic-ai/claude-agent-sdk' && /\/src\/main\/claudecode\/oturum-yoneticisi\.ts$/.test(baglam.parentURL ?? '')) {
    return { url: new URL('./sdk-sarmal.mjs', import.meta.url).href, shortCircuit: true };
  }
  return sonraki(belirtec, baglam);
}
