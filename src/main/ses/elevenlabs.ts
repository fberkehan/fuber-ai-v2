// ── ElevenLabs istemcisi (Görev 21, K9): akışlı TTS, gerçek zamanlı Scribe (STT) ─────────────────────────────────────
// Electron'a bağımlı değil (birim testli: tests/ses-akis.test.ts, tests/scribe.test.ts — sahte sunucu scripts/dev/sahte-elevenlabs.mjs).
// Resmî belge (25 Eki 2026'da okundu):
//  - TTS akışı: POST /v1/text-to-speech/{voice_id}/stream?output_format=… · başlık xi-api-key · gövde { text, model_id,
//    language_code, voice_settings{stability, similarity_boost, style, use_speaker_boost, speed}, previous_text, … } → ses baytları
//    üretildikçe gelir (elevenlabs.io/docs/api-reference/text-to-speech/stream). `optimize_streaming_latency` belgede "deprecated":
//    kullanılmaz. `language_code` multilingual_v2'de desteklenmez; flash_v2_5'te Türkçeyi zorlar — hesap reddederse (422) bir kez
//    onsuz denenir ve bir daha gönderilmez.
//  - Model: eleven_flash_v2_5 (~75 ms çıkarım, 32 dil; elevenlabs.io/docs/models). Çıktı pcm_22050 (tek kanal, 16 bit, little-endian):
//    çözücü beklemeden çalar. 44,1 kHz PCM Pro ister; 22,05 kHz her planda.
//  - Scribe gerçek zamanlı (31 Eki 2026'da yeniden okundu): WebSocket /v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000
//    &language_code=tr&commit_strategy=manual&token=… · 0.13: sunucunun verdiği tek kullanımlık belirteç sorguda gider (15 dk; anahtar sunucudan çıkmaz, masaüstünde
//    xi-api-key yok) · istemci { message_type: "input_audio_chunk", audio_base_64, commit, sample_rate } → sunucu session_started / partial_transcript{text} /
//    committed_transcript{text} / hata türleri (auth_error, quota_exceeded, session_time_limit_exceeded, invalid_request, …); `warning` hata değildir
//    (elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime). commit_strategy açık gönderilir: belgede varsayılan turn_prediction.
import { ELEVEN } from '../../shared/ses-kimligi.ts';

export type Getir = (url: string, init?: RequestInit) => Promise<Response>;

export interface ElevenBaglanti {
  taban: string;
  anahtar: string;
  /** Üretimde Electron net.fetch (Chromium ağ yığını: HTTP/2, bağlantı havuzu, ön bağlantı); testte genel fetch. */
  getir?: Getir;
}

export class ElevenHatasi extends Error {
  readonly durum: number;
  readonly yenidenDenenebilir: boolean;
  constructor(message: string, durum: number, yenidenDenenebilir: boolean) { super(message); this.durum = durum; this.yenidenDenenebilir = yenidenDenenebilir; }
}

/** Hesap language_code'u reddettiyse (422) bu oturumda bir daha gönderilmez. */
let dilKapali = false;
export const _dilSifirla = () => { dilKapali = false; };

export interface SeslendirmeIstegi {
  sesId: string;
  metin: string;
  dil: string;
  hiz?: number;
  /** Önceki cümle (tonlama sürekliliği; belge: previous_text). */
  onceki?: string;
  sinyal?: AbortSignal;
}

/** Cümleyi akışla seslendirir: PCM16 parçaları (çift bayt hizalı) geldikçe verilir. */
export async function* elevenSeslendir(b: ElevenBaglanti, i: SeslendirmeIstegi): AsyncGenerator<Uint8Array> {
  const getir = b.getir ?? fetch;
  const govde = (dil: boolean) => JSON.stringify({
    text: i.metin,
    model_id: ELEVEN.model,
    ...(dil ? { language_code: i.dil } : {}),
    // use_speaker_boost KAPALI (düzeltme 7): belge "biraz daha yüksek hesaplama yükü, dolayısıyla gecikme" diyor — ilk söz öncelikli.
    // apply_text_normalization gönderilmez (varsayılan 'auto'); Flash v2.5 sayıları zayıf okur (belge: normalization) — sayılar, saatler
    // ve tarihler bizde yazıya çevrilir (shared/sayi-okuma.ts, cümle bölücüde).
    voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: false, speed: i.hiz ?? 1 },
    ...(i.onceki ? { previous_text: i.onceki.slice(-400) } : {}),
  });
  const istek = (dil: boolean) => getir(`${b.taban.replace(/\/$/, '')}/v1/text-to-speech/${encodeURIComponent(i.sesId)}/stream?output_format=${ELEVEN.bicim}`, {
    method: 'POST',
    headers: { 'xi-api-key': b.anahtar, 'content-type': 'application/json' },
    body: govde(dil),
    signal: i.sinyal,
  });
  let r: Response;
  try {
    r = await istek(!dilKapali);
    if (r.status === 422 && !dilKapali) {
      const m = await r.text().catch(() => '');
      if (/language/i.test(m)) { dilKapali = true; r = await istek(false); } else throw new ElevenHatasi(`ElevenLabs 422: ${m.slice(0, 160)}`, 422, false);
    }
  } catch (e) {
    if (e instanceof ElevenHatasi) throw e;
    if ((e as Error)?.name === 'AbortError' || i.sinyal?.aborted) throw e;
    throw new ElevenHatasi(`ElevenLabs'e bağlanılamadı: ${(e as Error)?.message ?? e}`, 0, true);
  }
  if (!r.ok || !r.body) {
    const m = await r.text().catch(() => '');
    throw new ElevenHatasi(`ElevenLabs ${r.status}: ${m.slice(0, 160)}`, r.status, r.status === 429 || r.status >= 500);
  }
  const okuyucu = r.body.getReader();
  let artik: number | null = null; // tek bayt kaldıysa bir sonraki parçanın başına
  try {
    for (;;) {
      const { done, value } = await okuyucu.read();
      if (done) break;
      if (!value?.length) continue;
      let v = value;
      if (artik !== null) { const y = new Uint8Array(v.length + 1); y[0] = artik; y.set(v, 1); v = y; artik = null; }
      if (v.length % 2) { artik = v[v.length - 1]; v = v.subarray(0, v.length - 1); }
      if (v.length) yield v;
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' || i.sinyal?.aborted) throw e;
    throw new ElevenHatasi(`ElevenLabs akışı koptu: ${(e as Error)?.message ?? e}`, 0, false);
  } finally {
    okuyucu.releaseLock();
  }
}

// ── Scribe toplu (yalnız 2.1.1 telefon uyumu: telefonun webm kaydı; main/ses-uyum.ts) ─────────────────────────────────────────────
// Resmî belge (26 Eki 2026'da okundu; elevenlabs.io/docs/api-reference/speech-to-text/convert): POST /v1/speech-to-text · başlık
// xi-api-key · multipart/form-data { model_id: "scribe_v2" (zorunlu), file, language_code (ISO-639-1) } → { text, … }. "Bütün yaygın ses
// ve video biçimleri" kabul edilir (telefonun audio/webm kaydı çözülmeden gider); dosya ≥ 100 ms.
export const SCRIBE_TOPLU_MODEL = 'scribe_v2';
export async function elevenYaziya(b: ElevenBaglanti, ses: Uint8Array<ArrayBuffer>, mime: string, dil: string, sinyal?: AbortSignal): Promise<string | null> {
  const getir = b.getir ?? fetch;
  const form = new FormData();
  form.set('model_id', SCRIBE_TOPLU_MODEL);
  form.set('language_code', dil);
  form.set('file', new Blob([ses], { type: mime || 'audio/webm' }), `ses.${/wav/.test(mime) ? 'wav' : /mp4|m4a|aac/.test(mime) ? 'm4a' : 'webm'}`);
  let r: Response;
  try {
    r = await getir(`${b.taban.replace(/\/$/, '')}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': b.anahtar }, body: form, signal: sinyal ?? AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new ElevenHatasi(`ElevenLabs'e bağlanılamadı: ${(e as Error)?.message ?? e}`, 0, true);
  }
  if (!r.ok) throw new ElevenHatasi(`ElevenLabs ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`, r.status, r.status === 429 || r.status >= 500);
  const j = (await r.json().catch(() => ({}))) as { text?: unknown };
  const t = typeof j.text === 'string' ? j.text.trim() : '';
  return t || null;
}

// ── Scribe gerçek zamanlı (konuşmadan yazıya) ──────────────────────────────────────────────────────────────────────────────────
export interface ScribeOlaylari {
  /** Ara (değişebilir) metin: kullanıcı konuşurken canlı gösterilir. */
  kismi?: (metin: string) => void;
}
export interface ScribeAyari {
  /** ElevenLabs adresi (http(s)://…; WebSocket'e çevrilir). Üretimde sabit; testte sahte sunucu. */
  taban: string;
  /** Barındırılan servisin verdiği tek kullanımlık belirteç (kaldırılan barındırılan servis). Adreste gider: adres ve belirteç hiçbir iletiye ve günlüğe yazılmaz. */
  belirtec: string;
  dil: string; ornekHizi?: number; olaylar?: ScribeOlaylari; acilmaMs?: number;
}

export type Ws = { readyState: number; send(d: string): void; close(): void; onopen: ((e: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null; onclose: ((e: unknown) => void) | null };
export type WsYapici = new (url: string) => Ws;

/**
 * Bir sesli soru/dikte için tek Scribe oturumu: `ekle(pcm16)` konuşma sürerken sesi akıtır (bağlantı açılana dek tamponlanır),
 * `bitir()` son parçayı `commit: true` ile yollar ve kesinleşen metni bekler. Hata (yetki, kota, kopma) `bitir()`de fırlatılır. 0.13: kesin metin
 * gelmeden biten oturum da reddedilir; kısmi metin son söz sayılmaz (son kelimeleri eksik olabilir), çağıran aynı sesi toplu çevirir (main/ses/merkez.ts).
 */
export class ScribeOturumu {
  private ws: Ws | null = null;
  private acik = false;
  private bekleyen: Uint8Array[] = [];
  private kesin: string[] = [];
  private sonKismi = '';
  private hata: Error | null = null;
  private bitisCoz: ((m: string) => void) | null = null;
  private bitisRed: ((e: Error) => void) | null = null;
  private commitGitti = false;
  /** Kesin metin alındı: bundan sonraki kapanış kopma değildir. */
  private tamamlandi = false;
  private gidenBayt = 0;
  private acilmaSaati: ReturnType<typeof setTimeout> | null = null;
  private readonly hz: number;
  private readonly a: ScribeAyari;

  constructor(a: ScribeAyari, Yapici: WsYapici = (globalThis as unknown as { WebSocket: WsYapici }).WebSocket) {
    this.a = a;
    this.hz = a.ornekHizi ?? 16000;
    const u = new URL(`${a.taban.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/speech-to-text/realtime`);
    u.searchParams.set('model_id', ELEVEN.sttModel);
    u.searchParams.set('audio_format', `pcm_${this.hz}`);
    u.searchParams.set('language_code', a.dil);
    u.searchParams.set('commit_strategy', 'manual');
    u.searchParams.set('token', a.belirtec);
    let ws: Ws;
    // Yapıcının (WebSocket) hata iletisi adresi (belirteçle) taşıyabilir: alınmaz.
    try { ws = new Yapici(u.toString()); } catch { this.dus(new Error('Scribe bağlantısı açılamadı.')); return; }
    this.ws = ws;
    this.acilmaSaati = setTimeout(() => { if (!this.acik) this.dus(new Error('Scribe bağlantısı açılamadı (zaman aşımı).')); }, a.acilmaMs ?? 5000);
    ws.onopen = () => { this.acilmaSaatiniKapat(); this.acik = true; for (const p of this.bekleyen) this.yolla(p, false); this.bekleyen = []; if (this.bitisCoz && !this.commitGitti) this.commit(); };
    ws.onmessage = (e) => this.mesaj(e.data);
    ws.onerror = () => this.dus(new Error('Scribe bağlantı hatası.'));
    ws.onclose = () => { if (!this.tamamlandi) this.dus(new Error('Scribe bağlantısı kapandı.')); };
  }

  /** ElevenLabs'e gerçekten giden sesin süresi (saniye): sunucuya bildirilen budur; bağlantı açılmadıysa 0. */
  get saniye(): number { return this.gidenBayt / (this.hz * 2); }

  private acilmaSaatiniKapat(): void { if (this.acilmaSaati) clearTimeout(this.acilmaSaati); this.acilmaSaati = null; }

  private metin(): string { return this.kesin.join(' ').replace(/\s+/g, ' ').trim() || this.sonKismi.trim(); }

  private kapat(): void { try { this.ws?.close(); } catch { /* kapalı */ } }

  private dus(e: Error): void {
    if (this.hata || this.tamamlandi) return;
    this.hata = e;
    this.acilmaSaatiniKapat();
    this.bekleyen = [];
    this.bitisRed?.(e);
    this.bitisCoz = null; this.bitisRed = null;
    this.kapat();
  }

  /** Kesin metin (ya da konuşma yok): bekleyen `bitir()` çözülür, bağlantı kapanır. */
  private tamam(): void {
    const c = this.bitisCoz;
    if (!c) return;
    this.tamamlandi = true;
    this.bitisCoz = null; this.bitisRed = null;
    c(this.metin());
    this.kapat();
  }

  private mesaj(ham: unknown): void {
    let m: { message_type?: string; text?: string };
    try { m = JSON.parse(String(ham)); } catch { return; }
    const t = m.message_type;
    if (t === 'partial_transcript') { this.sonKismi = String(m.text ?? ''); const ara = [...this.kesin, this.sonKismi].join(' ').trim(); if (ara) this.a.olaylar?.kismi?.(ara); }
    else if (t === 'committed_transcript' || t === 'committed_transcript_with_timestamps') {
      const s = String(m.text ?? '').trim();
      if (s) this.kesin.push(s);
      this.sonKismi = '';
      if (this.commitGitti) this.tamam();
    } else if (t && /error|exceeded|throttled|limited|overflow|exhausted|unaccepted|insufficient|invalid/.test(t)) {
      // insufficient_audio_activity: konuşma bittiyse boş metin (hata değil); sürerken bağlantı kapanıyor demektir.
      if (t === 'insufficient_audio_activity' && this.bitisCoz) { this.tamam(); return; }
      // Sunucunun serbest metni alınmaz: günlüğe gider, belirteci yankılayabilir. Tür tanı için yeter.
      this.dus(new Error(`Scribe: ${t}`));
    }
  }

  private yolla(pcm: Uint8Array, commit: boolean): void {
    try {
      this.ws?.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.from(pcm).toString('base64'), commit, sample_rate: this.hz }));
    } catch { this.dus(new Error('Scribe bağlantısı koptu.')); return; }
    if (!commit) this.gidenBayt += pcm.length;
  }

  private commit(): void {
    this.commitGitti = true;
    // Kısa bir sessiz son parça (20 ms) + commit: kesinleşen metin gelir (belge: commit "Whether to commit the transcription after
    // this chunk"; audio_base_64 zorunlu alan — boş gönderilmez).
    this.yolla(new Uint8Array(Math.round(this.hz * 0.02) * 2), true);
  }

  ekle(pcm: Uint8Array): void {
    if (this.hata || this.commitGitti || !pcm.length) return;
    if (this.acik) this.yolla(pcm, false); else this.bekleyen.push(pcm);
  }

  /** Konuşma bitti: kesinleşen metni bekler. Bağlantı kopar ya da `ms` içinde yanıt gelmezse reddedilir. */
  bitir(ms = 4000): Promise<string> {
    if (this.hata) return Promise.reject(this.hata);
    return new Promise<string>((coz, red) => {
      const z = setTimeout(() => this.dus(new Error('Scribe yanıt vermedi.')), ms);
      this.bitisCoz = (m) => { clearTimeout(z); coz(m); };
      this.bitisRed = (e) => { clearTimeout(z); red(e); };
      if (this.acik && !this.commitGitti) this.commit();
    });
  }

  /** Vazgeçildi: ses kesilir, bağlantı kapanır. Bekleyen `bitir()` reddedilir (asılı kalmaz). */
  iptal(): void {
    this.commitGitti = true;
    this.dus(new Error('Scribe oturumu iptal edildi.'));
  }
}
