// ── Video eki: saf yardımcılar (analiz 11 Kas bulgu 9; tests/video-ek.test.ts) ─────────────────────────────────────────────────────
// main/video-isle.ts gizli bir pencerede <video>/canvas ile N kare ve WebAudio ile 16 kHz mono PCM çıkarır; burada PCM WAV parçalarına bölünür
// (Whisper isteği 60 sn sınırlı; parça başına ~60 sn ses) ve modele giden ek metni kurulur.

/** 16 kHz mono 16 bit PCM'i en çok `parcaSn` saniyelik WAV parçalarına böler (her parça kendi başlığıyla). */
export function pcmWavParcalari(pcm: Buffer, o: { hz?: number; parcaSn?: number; azamiSn?: number } = {}): { bas: number; wav: Buffer }[] {
  const hz = o.hz ?? 16_000;
  // İnceleme I2: `azamiSn` verilirse ses o sürede kesilir (10 dk'lık sınır yazıya dökmeyi de bağlar).
  if (o.azamiSn !== undefined) pcm = pcm.subarray(0, Math.max(0, Math.floor(o.azamiSn * hz)) * 2);
  const parcaBayt = Math.max(2, Math.floor((o.parcaSn ?? 60) * hz) * 2);
  const out: { bas: number; wav: Buffer }[] = [];
  for (let i = 0; i < pcm.length - 1; i += parcaBayt) {
    const veri = pcm.subarray(i, Math.min(pcm.length, i + parcaBayt));
    const b = Buffer.alloc(44);
    b.write('RIFF', 0); b.writeUInt32LE(36 + veri.length, 4); b.write('WAVE', 8);
    b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(hz, 24); b.writeUInt32LE(hz * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
    b.write('data', 36); b.writeUInt32LE(veri.length, 40);
    out.push({ bas: i / 2 / hz, wav: Buffer.concat([b, veri]) });
  }
  return out;
}

/** Saniye → "1:05" (saatlik videoda "1:02:03"). */
export function zamanDamgasi(sn: number): string {
  const t = Math.max(0, Math.floor(sn));
  const s = t % 60, d = Math.floor(t / 60) % 60, sa = Math.floor(t / 3600);
  return sa ? `${sa}:${String(d).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${d}:${String(s).padStart(2, '0')}`;
}
const sureMetni = (sn: number) => (sn < 60 ? `${Math.round(sn)} sn` : `${Math.floor(sn / 60)} dk ${Math.round(sn % 60)} sn`);

export interface VideoOzeti {
  ad: string; sureSn: number; genislik?: number; yukseklik?: number;
  kareZamanlari: number[];
  /** Konuşma yazısı parçaları (bas: saniye). null: yazıya dökülmedi (`sesNotu` nedeni söyler). */
  yazi: { bas: number; metin: string }[] | null;
  sesNotu?: string;
}

/** Modele giden ek metni: videonun adı/süresi/boyutu, karelerin zamanları (görsel olarak ekli) ve konuşma yazısı ya da neden yok. */
export function videoEkMetni(v: VideoOzeti): string {
  const boyut = v.genislik && v.yukseklik ? ` · ${v.genislik}×${v.yukseklik}` : '';
  const satirlar = [`Video: ${v.ad} · ${sureMetni(v.sureSn)}${boyut}`];
  if (v.kareZamanlari.length) satirlar.push(`Kareler: ${v.kareZamanlari.length} kare (${v.kareZamanlari.map(zamanDamgasi).join(', ')}) bu mesaja görsel olarak ekli.`);
  const yazi = (v.yazi ?? []).filter((p) => p.metin.trim());
  if (yazi.length) satirlar.push('Konuşma yazısı (bu bilgisayarda yazıya döküldü):', ...yazi.map((p) => `[${zamanDamgasi(p.bas)}] ${p.metin.trim()}`));
  else satirlar.push(`Konuşma yazısı yok: ${v.sesNotu ?? 'videoda konuşma bulunamadı.'}`);
  return satirlar.join('\n');
}
