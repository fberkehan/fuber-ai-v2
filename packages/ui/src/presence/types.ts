/**
 * Jarvis'in varlığı: ortak tipler. Tek görünüm vardır (Takımyıldız: yıldızlardan toplanan çekirdek + durum renkleri).
 */

/**
 * Varlığın hâlleri. Ses durum makinesinin (boşta, dinliyor, takip, düşünüyor, konuşuyor, mikrofon kapalı) üstüne
 * ekran yüzeylerinin gösterdiği hâller eklenir: uyanış, hata, bildirim, onay, arka plan işi, bilgisayarı kullanıyor,
 * durduruldu.
 */
export const PRESENCE_STATES = [
  'idle',
  'wake',
  'listening',
  'followup',
  'thinking',
  'speaking',
  'muted',
  'error',
  'notice',
  'approval',
  'job',
  'computer',
  'stopped',
] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

/** Ekran okuyucu için varsayılan adlar (asistanın adı çağıran yerden gelir). */
export const PRESENCE_LABELS: Record<PresenceState, string> = {
  idle: 'Asistan hazır',
  wake: 'Asistan uyandı',
  listening: 'Asistan dinliyor',
  followup: 'Asistan sizi dinliyor',
  thinking: 'Asistan düşünüyor',
  speaking: 'Asistan konuşuyor',
  muted: 'Mikrofon kapalı',
  error: 'Ses hattında sorun var',
  notice: 'Bildirim var',
  approval: 'Onayınız bekleniyor',
  job: 'Arka planda iş sürüyor',
  computer: 'Asistan bilgisayarı kullanıyor',
  stopped: 'Asistan durduruldu',
};

/** Sürekli sinyal izleyen hâller: bu hâllerde kare döngüsü durmaz (ses düzeyi her an değişebilir). */
export const isLiveState = (state: PresenceState): boolean =>
  state === 'listening' || state === 'followup' || state === 'speaking' || state === 'thinking' || state === 'computer';
