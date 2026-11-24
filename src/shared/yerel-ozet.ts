// ── "Yalnız bu bilgisayar"da modelsiz sabah/akşam özeti (11 Kas analizi #9, §6.2.5; saf, birim testli: tests/yerel-ozet.test.ts) ─────────────
// Yerel modelde araç yok ve 9B model boş listeyle bile toplantı uyduruyordu; yerelde özet yerel veriden ŞABLONLA yazılır: bugünün (akşamda yarının)
// hatırlatıcıları, açık yapılacaklar, akşamda bugün tamamlananlar. Söylenecek bir şey yoksa null (mesaj yok).

export interface YerelOzetVerisi {
  hitap: string;
  hatirlaticilar: { zaman: string; baslik: string }[];
  acik: { baslik: string; sonTarih?: string }[];
  biten: { baslik: string }[];
}

const saat = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const gun = (iso: string) => new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });

export function yerelOzetMetni(is: 'sabah' | 'aksam', v: YerelOzetVerisi): string | null {
  const hitap = v.hitap ? ` ${v.hitap}` : '';
  const hat = [...v.hatirlaticilar].sort((a, b) => a.zaman.localeCompare(b.zaman)).map((h) => `- ${saat(h.zaman)} ${h.baslik}`);
  const acik = v.acik.slice(0, 6).map((g) => `- ${g.baslik}${g.sonTarih ? ` (son ${gun(g.sonTarih)})` : ''}`);
  if (is === 'sabah') {
    if (!hat.length && !acik.length) return null;
    return [`Günaydın${hitap}!`, ...(hat.length ? ['Bugün:', ...hat] : []), ...(acik.length ? ['Son tarihi yaklaşan yapılacaklar:', ...acik] : [])].join('\n');
  }
  const biten = v.biten.slice(0, 8).map((g) => `- ${g.baslik}`);
  if (!biten.length && !hat.length) return null;
  return [`Günün özeti${hitap}:`, ...(biten.length ? ['Bugün tamamlananlar:', ...biten] : []), ...(hat.length ? ['Yarın:', ...hat] : [])].join('\n');
}
