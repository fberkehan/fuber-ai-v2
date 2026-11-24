// ── Toplantı modu: önizleme için sahte yazıya çevirme ve sahte yapay zekâ (YALNIZ FUBER_DEMO + FUBER_TOPLANTI_DENEME=1) ───────────────────────────────
// scripts/dev/toplanti-onizle.mjs gerçek yakalama hattını (AudioWorklet → işçi → VAD → IPC) Chromium'un sahte ses aygıtıyla sürer; yazıya çevirme ve yapay
// zekâ burada senaryodan gelir (ağ yok, kredi yok). Konuşan başına sıradaki cümle; çeviri "[hedef] …" değil, senaryonun Türkçe karşılığı.
import type { ToplantiStt, YzIstegi } from './oturum.ts';
import type { Konusan } from '../../shared/toplanti.ts';
import { SesModeliYok } from '../../shared/masaustu-hesap.ts';

const KARSI = [
  'Thanks everyone for joining, let us start with the release timeline.',
  'We reviewed the budget yesterday and the numbers look fine for the next quarter.',
  'Can you ship the mobile release on Friday?',
  'Great, and who will write the release notes?',
  'Perfect, let us meet again on Monday to review the feedback.',
];
const SIZ = [
  'Evet, bence cuma günü uygun.',
  'Sürüm notlarını ben yazarım, perşembe akşamı paylaşırım.',
  'Pazartesi saat onda olur.',
];
const CEVIRI: Record<string, string> = {
  [KARSI[0]]: 'Katıldığınız için herkese teşekkürler, sürüm takvimiyle başlayalım.',
  [KARSI[1]]: 'Bütçeyi dün gözden geçirdik, rakamlar gelecek çeyrek için iyi görünüyor.',
  [KARSI[2]]: 'Mobil sürümü cuma günü yayınlayabilir misiniz?',
  [KARSI[3]]: 'Harika, sürüm notlarını kim yazacak?',
  [KARSI[4]]: 'Mükemmel, geri bildirimleri incelemek için pazartesi yeniden buluşalım.',
};

/** Sahte yazıya çevirme: konuşan başına sıradaki cümle (her parça bir cümle). */
export function sahteStt(o: { hesapDusur?: boolean; hesapYok?: boolean; /** Yerel tanıyıcı hiç yanıt vermez (asılı istek): satırlar "yazıya çevrilemedi" olmalı. */ yerelAsili?: boolean } = {}): ToplantiStt {
  const n = { karsi: 0, siz: 0 };
  const cevir = async (_wav: Uint8Array, k: Konusan) => { await new Promise((r) => setTimeout(r, 120)); const l = k === 'karsi' ? KARSI : SIZ; return l[n[k]++ % l.length]; };
  // Senaryo "hesap-dustu": sunucuda dikte modeli yok (404) — toplantı kurulu yerel tanıyıcıya geçmeli.
  const hesap = o.hesapDusur ? async (): Promise<string | null> => { await new Promise((r) => setTimeout(r, 40)); throw new SesModeliYok('stt'); } : cevir;
  const yerel = o.yerelAsili ? () => new Promise<string | null>(() => undefined) : cevir;
  return {
    hesap: { kullanilir: () => !o.hesapYok, yaziya: hesap },
    whisper: { hazirMi: () => true, cevir: yerel, tani: () => ({ calisiyor: true, donanim: 'cpu', model: 'small-q5_1', derleme: 'cpu', gecikmeMs: o.yerelAsili ? null : 120, sonHata: '' }) },
    ...(o.hesapYok ? { bulutNeden: () => 'hesap-yok' as const } : {}),
  };
}

export async function sahteYz(i: YzIstegi): Promise<string> {
  await new Promise((r) => setTimeout(r, 150));
  if (i.amac === 'toplantı çevirisi') {
    // 14 Kas: her cümle ayrı istek, düz metin yanıt, harf harf akar (gerçek akış gibi: ~4 karakter / 10 ms).
    const c = CEVIRI[i.kullanici] ?? `Çeviri: ${i.kullanici}`;
    if (i.akis) for (let k = 0; k < c.length; k += 4) { i.akis(c.slice(k, k + 4)); await new Promise((r) => setTimeout(r, 10)); }
    return c;
  }
  if (i.amac === 'toplantı soru denetimi') return 'EVET';
  // Bağlam isteme girdiyse sahte yanıt bunu belli eder (önizleme: bağlam özete ve Robot'a ulaştı mı).
  const baglamli = /Meeting context given by the listener/.test(i.kullanici);
  const konu = /Meeting topic: ([^\n]+)/.exec(i.kullanici)?.[1];
  if (i.amac === 'toplantı yanıt önerisi') {
    const ek = baglamli && konu ? ` (${konu})` : '';
    if (/release notes/.test(i.kullanici.split('Question to answer').pop() ?? '')) return JSON.stringify({ yanit: 'I will write the release notes and share them on Thursday evening.', ceviri: `Sürüm notlarını ben yazarım, perşembe akşamı paylaşırım.${ek}` });
    return JSON.stringify({ yanit: 'Yes, Friday works for us; I will confirm the build on Thursday.', ceviri: `Evet, cuma bize uyar; derlemeyi perşembe teyit ederim.${ek}` });
  }
  if (i.amac === 'toplantı özeti') return JSON.stringify({ anaNoktalar: ['Mobil sürüm takvimi konuşuldu', 'Bütçe gelecek çeyrek için yeterli', ...(baglamli && konu ? [`Bağlam alındı: ${konu}`] : [])], kararlar: ['Mobil sürüm cuma yayınlanacak'], yapilacaklar: ['Sürüm notlarını yaz ve perşembe akşamı paylaş', 'Pazartesi 10:00 geri bildirim toplantısı'] });
  return '';
}
