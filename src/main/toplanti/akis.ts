// ── Toplantı: konuşan başına SÜREKLİ gerçek zamanlı Scribe akışı (14 Kas 2026; Electron'suz — tests/scribe.test.ts, scripts/dev/sahte-elevenlabs.mjs) ──────────────
// 14 Kas: toplantıda yazıya çevirme çok uzun sürüyordu (sesli sohbet uygulamaları çok daha hızlı çeviriyor). Eski yol her konuşma parçasını (2–4 sn) toplu
// çeviriye yolluyordu: metin ancak parça bitince, istek dönünce görünüyordu. Burada her konuşan (Karşı taraf, Siz) için TEK bağlantı açık durur ve ses
// konuştukça 16 kHz PCM olarak akar; kısmi metin ~yüzlerce ms içinde, kesin metin commit'ten sonra gelir (ElevenLabs belgesi: scribe_v2_realtime, commit_strategy=manual).
//  · Segment = iki commit arası ses (toplantıda bir satır). `ses()` sesi akıtır ve segment numarasını döner; `commit()` segmenti kapatır; olaylar numarayla gelir
//    (`kismi(metin, no)`, `kesin(metin, no)`): üst katman numarayı satıra bağlar. Segmentin sesi kesin metin gelene dek tutulur (en çok ~40 sn): bağlantı koparsa yeni
//    bağlantıya AYNEN yeniden oynatılır, kesin metin yine gelir (aradaki ses kaybolmaz; üst katman bir şey görmez).
//  · Belirteç (sunucudan, tek kullanımlık; sunucu 120 sn rezerve eder ve konuşulan süreyi bildirmemizi bekler): bağlantı gönderilen ses `rotasyonSn`'ye (varsayılan
//    sureSn − 25) yaklaşınca YENİSİ önceden açılır ve segment sınırında devralır; eskisi bekleyen commit'lerini alır, süresi bildirilir, kapanır. Bağlantı yaşı da sınırlıdır
//    (9 dk). Ses yalnız konuşurken gittiği için (VAD) bir belirteç duvar saatinde dakikalarca yeter; boşta bağlantı canlı tutulur (kısa sessiz parça), kopsa bile eski
//    yerine HEMEN yenisi açılmaz (belirteç ve günlük sayaç harcanmasın): sonraki konuşmanın ilk sesiyle açılır, o ses tamponlanır.
//  · Kalıcı arıza (belirteç alınamıyor, bağlantı üst üste kuruluyor ama düşüyor, kredi/tavan): `dustu` bekleyen segmentlerin sesini verir — üst katman toplu yola
//    (ya da yerel tanıyıcıya) geçer; metin kaybolmaz. 402 / günlük tavan nedeniyle ayrı söylenir.
//  · Gizli / "Yalnız bu bilgisayar": bu sınıf hiç kurulmaz (üst katman Gizli'yi her karede sorar; açılırsa `kapat()`).
import { ELEVEN } from '../../shared/ses-kimligi.ts';
import { dikteSiniriMi, type DikteSiniriTuru } from '../../shared/masaustu-hesap.ts';
import type { Ws, WsYapici } from '../ses/elevenlabs.ts';

export type AkisNedeni = DikteSiniriTuru | 'belirtec' | 'baglanti';
export interface AkisBelirteci { token: string; sureSn?: number }
export interface AkisDusumu {
  neden: AkisNedeni;
  /** Cevabı gelmemiş segmentler (sırayla): `kesinlesmis` commit'i gitmiş (satır bitti), değilse hâlâ açık satır. */
  bekleyenler: { no: number; pcm: Uint8Array; kesinlesmis: boolean }[];
}
export interface AkisZamanlari {
  acilmaMs: number;
  /** Boşta bağlantıyı canlı tutan kısa sessiz parçanın aralığı. */
  canliTutmaMs: number;
  /** commit'e bu kadar yanıt gelmezse bağlantı ölü sayılır (segment yeniden oynatılır). */
  commitYanitMs: number;
  yenidenDenemeMs: number[];
  /** Bağlantı en çok bu kadar yaşar (ms); sonraki segment sınırında devredilir. */
  yasMs: number;
  /** Bir segmentin tutulan sesi (bayt): aşarsa baştan atılır. */
  segmentSiniri: number;
}
export const AKIS_ZAMANLARI: Readonly<AkisZamanlari> = {
  acilmaMs: 5000, canliTutmaMs: 8000, commitYanitMs: 7000, yenidenDenemeMs: [250, 700, 1800], yasMs: 9 * 60_000, segmentSiniri: 40 * 16_000 * 2,
};
export interface AkisAyari {
  /** ElevenLabs adresi (üretimde sabit; testte sahte sunucu). */
  taban: string;
  /** Yeni bağlantı için tek kullanımlık belirteç. null: alınamıyor; fırlatabilir (402 / günlük tavan: DikteSiniri). Konuşan başına çağrılır. */
  belirtecAl(): Promise<AkisBelirteci | null>;
  /** Bağlantı kapandı: ElevenLabs'e giden sesin süresi (sunucu rezervin farkını iade eder). Hiç fırlatmaz. */
  sureBildir?(belirtec: string, saniye: number): void;
  kismi(metin: string, no: number): void;
  kesin(metin: string, no: number): void;
  /** Kalıcı arıza: bundan sonra bu akış ses almaz. */
  dustu(d: AkisDusumu): void;
  /** Dil: verilmezse Scribe sezer (toplantıda diller karışır). */
  dil?: string;
  ornekHizi?: number;
  gunluk?(m: string): void;
  simdi?(): number;
  zamanlar?: Partial<AkisZamanlari>;
}

interface Segment { no: number; parcalar: Uint8Array[]; bayt: number; gonderilen: number; commit: boolean; commitGitti: boolean; kirpildi: boolean }
interface Baglanti {
  id: number; ws: Ws | null; acik: boolean; kapali: boolean; belirtec: string; sureSn: number; gidenBayt: number; acildi: number; sonGonderim: number;
  /** Cevabı gelmemiş segmentler, numara sırasıyla; yalnız sonuncusu commit'siz (açık) olabilir. */
  segmentler: Segment[];
  emekli: boolean;
  yanitSaati: ReturnType<typeof setTimeout> | null;
  acilmaSaati: ReturnType<typeof setTimeout> | null;
  ilkMesaj: boolean;
}

const ERR = /error|exceeded|throttled|limited|overflow|exhausted|unaccepted|insufficient|invalid/;

export class ScribeAkisi {
  private readonly a: AkisAyari;
  private readonly z: AkisZamanlari;
  private readonly Yapici: WsYapici;
  private readonly hz: number;
  private aktif: Baglanti | null = null;
  private hazir: Baglanti | null = null;
  private emekliler = new Set<Baglanti>();
  /** Açık segment (ses alan, commit'siz). */
  private acikSeg: Segment | null = null;
  /** Bağlantısı koptu, yenisi kurulana dek sahipsiz kalan segmentler. */
  private sahipsiz: Segment[] = [];
  private segNo = 0;
  private baglantiNo = 0;
  private bitti = false;
  private oldu = false;
  private deneme = 0;
  private yenidenSaati: ReturnType<typeof setTimeout> | null = null;
  private canliSaati: ReturnType<typeof setInterval> | null = null;
  private hazirlaniyor = false;
  /** Tanı / test: kurulan bağlantı, yeniden bağlanma ve belirteç sayısı. */
  readonly istatistik = { baglanti: 0, yenidenBaglanma: 0, rotasyon: 0, belirtec: 0 };

  constructor(a: AkisAyari, Yapici: WsYapici = (globalThis as unknown as { WebSocket: WsYapici }).WebSocket) {
    this.a = a;
    this.z = { ...AKIS_ZAMANLARI, ...a.zamanlar };
    this.Yapici = Yapici;
    this.hz = a.ornekHizi ?? 16000;
    this.canliSaati = setInterval(() => this.canliTut(), Math.max(200, Math.min(this.z.canliTutmaMs / 2, 2000)));
    this.canliSaati.unref?.();
  }

  private simdi(): number { return this.a.simdi?.() ?? Date.now(); }
  /** Bu akış artık ses almaz (kalıcı arıza ya da kapatıldı). */
  get kapaliMi(): boolean { return this.bitti || this.oldu; }
  /** Açık (kesinleşmemiş ya da cevabı beklenen) segment sayısı. */
  get bekleyen(): number { return this.tumSegmentler().length; }
  private tumSegmentler(): Segment[] {
    const l: Segment[] = [];
    for (const b of [this.aktif, this.hazir, ...this.emekliler]) if (b) for (const s of b.segmentler) if (!l.includes(s)) l.push(s);
    for (const s of this.sahipsiz) if (!l.includes(s)) l.push(s);
    return l.sort((x, y) => x.no - y.no);
  }
  private acikSegment(): Segment | null { return this.acikSeg && !this.acikSeg.commit ? this.acikSeg : null; }

  /** Açılışta bağlantıyı önceden kurar (ilk söz beklemesin). Belirteç hemen alınır. */
  baslat(): void { if (!this.kapaliMi && !this.aktif) this.baglan('aktif'); }

  /** Konuşma sesi (16 kHz PCM16). Segment numarasını döner (akış kapalıysa 0 — üst katman toplu yola geçmiştir). */
  ses(pcm: Uint8Array): number {
    if (this.kapaliMi || !pcm?.length) return 0;
    let s = this.acikSegment();
    if (!s) s = this.segmentAc();
    s.parcalar.push(pcm);
    s.bayt += pcm.length;
    while (s.bayt > this.z.segmentSiniri && s.parcalar.length > 1) { const at = s.parcalar.shift()!; s.bayt -= at.length; s.gonderilen = Math.max(0, s.gonderilen - 1); s.kirpildi = true; }
    this.gonder(s);
    return s.no;
  }

  /** Açık segmenti kapatır (commit): kesin metin `kesin(metin, no)` ile gelir. Ses yoksa 0. */
  commit(): number {
    const s = this.acikSegment();
    if (!s || this.kapaliMi) return 0;
    s.commit = true;
    this.acikSeg = null;
    this.gonder(s);
    return s.no;
  }

  private segmentAc(): Segment {
    // Yeni segment sınırı: bağlantı yaşlandıysa (ses ya da yaş) hazır bağlantıya devredilir.
    this.rotasyonDene();
    if (!this.aktif || this.aktif.kapali) this.baglan('aktif');
    const b = this.aktif!;
    const s: Segment = { no: ++this.segNo, parcalar: [], bayt: 0, gonderilen: 0, commit: false, commitGitti: false, kirpildi: false };
    b.segmentler.push(s);
    this.acikSeg = s;
    this.hazirlikDene();
    return s;
  }

  // ── Rotasyon (belirteç ömrü) ──
  private gidenSn(b: Baglanti): number { return b.gidenBayt / (this.hz * 2); }
  private rotasyonSn(b: Baglanti): number { return Math.max(20, b.sureSn - 25); }
  private yaslandi(b: Baglanti): boolean { return this.gidenSn(b) >= this.rotasyonSn(b) || this.simdi() - b.acildi >= this.z.yasMs; }
  private hazirlikDene(): void {
    const b = this.aktif;
    if (!b || this.hazir || this.hazirlaniyor || this.kapaliMi) return;
    if (this.gidenSn(b) >= this.rotasyonSn(b) * 0.6 || this.simdi() - b.acildi >= this.z.yasMs * 0.8) { this.hazirlaniyor = true; this.baglan('hazir'); }
  }
  private rotasyonDene(): void {
    const b = this.aktif;
    if (!b || !this.yaslandi(b)) return;
    const h = this.hazir;
    if (!h || h.kapali) { if (!this.hazir) this.hazirlikDene(); return; }
    // Eski bağlantı bekleyen commit'lerini alır ve kapanır; yeni segmentler yenisine gider. Açık segment yok (sınır).
    this.hazir = null;
    this.aktif = h;
    this.istatistik.rotasyon++;
    b.emekli = true;
    this.emekliler.add(b);
    this.emekliBitir(b);
  }
  private emekliBitir(b: Baglanti): void {
    if (b.segmentler.length === 0) { this.emekliler.delete(b); this.baglantiKapat(b); }
  }

  // ── Bağlantı ──
  private baglan(rol: 'aktif' | 'hazir' | 'emekli'): Baglanti {
    const b: Baglanti = { id: ++this.baglantiNo, ws: null, acik: false, kapali: false, belirtec: '', sureSn: 120, gidenBayt: 0, acildi: this.simdi(), sonGonderim: this.simdi(), segmentler: [], emekli: false, yanitSaati: null, acilmaSaati: null, ilkMesaj: false };
    if (rol === 'aktif') this.aktif = b; else if (rol === 'hazir') this.hazir = b; else { b.emekli = true; this.emekliler.add(b); }
    this.istatistik.baglanti++;
    void this.belirtecleAc(b);
    return b;
  }

  private async belirtecleAc(b: Baglanti): Promise<void> {
    let t: AkisBelirteci | null = null;
    try { t = await this.a.belirtecAl(); this.istatistik.belirtec++; } catch (e) {
      if (b.kapali) return;
      if (dikteSiniriMi(e)) { this.kaliciDus(e.tur); return; }
      this.a.gunluk?.(`[toplantı] akış belirteci: ${(e as Error)?.message ?? e}`);
    }
    if (b.kapali) { if (t) this.a.sureBildir?.(t.token, 0); return; }
    if (!t) { this.baglantiDustu(b, 'belirtec'); return; }
    b.belirtec = t.token;
    if (t.sureSn) b.sureSn = t.sureSn;
    b.acildi = this.simdi();
    try {
      const u = new URL(`${this.a.taban.replace(/^http/, 'ws').replace(/\/$/, '')}/v1/speech-to-text/realtime`);
      u.searchParams.set('model_id', ELEVEN.sttModel);
      u.searchParams.set('audio_format', `pcm_${this.hz}`);
      if (this.a.dil) u.searchParams.set('language_code', this.a.dil);
      u.searchParams.set('commit_strategy', 'manual');
      u.searchParams.set('token', t.token);
      b.ws = new this.Yapici(u.toString());
    } catch { this.baglantiDustu(b, 'baglanti'); return; }
    const ws = b.ws;
    b.acilmaSaati = setTimeout(() => { if (!b.acik) this.baglantiDustu(b, 'baglanti'); }, this.z.acilmaMs);
    ws.onopen = () => {
      if (b.kapali) return;
      if (b.acilmaSaati) clearTimeout(b.acilmaSaati);
      b.acilmaSaati = null;
      b.acik = true;
      b.sonGonderim = this.simdi();
      for (const s of b.segmentler) this.gonder(s, b);
    };
    ws.onmessage = (e) => this.mesaj(b, e.data);
    ws.onerror = () => this.baglantiDustu(b, 'baglanti');
    ws.onclose = () => this.baglantiDustu(b, 'baglanti');
  }

  private bagliSegment(s: Segment): Baglanti | null {
    for (const b of [this.aktif, this.hazir, ...this.emekliler]) if (b && b.segmentler.includes(s)) return b;
    return null;
  }

  /** Segmentin gönderilmemiş sesini (ve istenmişse commit'ini) bağlantıya yazar. Bağlantı açık değilse hiçbir şey yapmaz: açılınca hepsi gider. */
  private gonder(s: Segment, b: Baglanti | null = this.bagliSegment(s)): void {
    if (!b || !b.acik || b.kapali) return;
    try {
      while (s.gonderilen < s.parcalar.length) {
        const p = s.parcalar[s.gonderilen++];
        b.ws!.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.from(p).toString('base64'), commit: false, sample_rate: this.hz }));
        b.gidenBayt += p.length;
      }
      b.sonGonderim = this.simdi();
      if (s.commit && !s.commitGitti) {
        s.commitGitti = true;
        // Kısa sessiz son parça (20 ms) + commit (audio_base_64 zorunlu alan; belge: "commit: transcription'ı bu parçadan sonra kesinleştir").
        b.ws!.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.alloc(Math.round(this.hz * 0.02) * 2).toString('base64'), commit: true, sample_rate: this.hz }));
        this.yanitBekle(b);
      }
    } catch { this.baglantiDustu(b, 'baglanti'); }
  }

  private yanitBekle(b: Baglanti): void {
    if (b.yanitSaati) return;
    b.yanitSaati = setTimeout(() => {
      b.yanitSaati = null;
      if (b.segmentler.some((x) => x.commitGitti)) { this.a.gunluk?.('[toplantı] akış commit yanıtı gelmedi; bağlantı yenileniyor'); this.baglantiDustu(b, 'baglanti'); }
    }, this.z.commitYanitMs);
    b.yanitSaati.unref?.();
  }

  private mesaj(b: Baglanti, ham: unknown): void {
    if (b.kapali) return;
    let m: { message_type?: string; text?: string };
    try { m = JSON.parse(String(ham)); } catch { return; }
    const t = m.message_type;
    if (t === 'session_started') { b.ilkMesaj = true; this.deneme = 0; return; }
    if (t === 'partial_transcript') {
      b.ilkMesaj = true;
      this.deneme = 0;
      const s = b.segmentler[0];
      const metin = String(m.text ?? '');
      if (s && metin.trim()) this.a.kismi(metin, s.no);
    } else if (t === 'committed_transcript' || t === 'committed_transcript_with_timestamps') {
      b.ilkMesaj = true;
      this.deneme = 0;
      this.cevapla(b, String(m.text ?? '').trim());
    } else if (t && ERR.test(t)) {
      // Konuşma yok (çok kısa ses): boş kesin metin, hata değil.
      if (t === 'insufficient_audio_activity' && b.segmentler.some((x) => x.commitGitti)) { this.cevapla(b, ''); return; }
      // Sunucunun serbest metni alınmaz (belirteci yankılayabilir): yalnız tür günlüğe.
      this.a.gunluk?.(`[toplantı] akış: ${t}`);
      this.baglantiDustu(b, 'baglanti', t === 'session_time_limit_exceeded');
    }
  }

  /** commit'e gelen cevap: cevabı bekleyen EN ESKİ commit'li segmente aittir. */
  private cevapla(b: Baglanti, metin: string): void {
    const i = b.segmentler.findIndex((x) => x.commitGitti);
    if (i < 0) { if (metin && b.segmentler[0]) this.a.kismi(metin, b.segmentler[0].no); return; }
    const [s] = b.segmentler.splice(i, 1);
    if (b.yanitSaati) { clearTimeout(b.yanitSaati); b.yanitSaati = null; }
    if (b.segmentler.some((x) => x.commitGitti)) this.yanitBekle(b);
    this.a.kesin(metin, s.no);
    if (b.emekli) this.emekliBitir(b);
  }

  // ── Kopma: aynı sesle yeni bağlantı ──
  private baglantiKapat(b: Baglanti): void {
    if (b.kapali) return;
    b.kapali = true;
    if (b.acilmaSaati) clearTimeout(b.acilmaSaati);
    if (b.yanitSaati) clearTimeout(b.yanitSaati);
    b.acilmaSaati = b.yanitSaati = null;
    const ws = b.ws;
    b.ws = null;
    try { ws?.close(); } catch { /* kapalı */ }
    if (b.belirtec) { const sn = this.gidenSn(b); this.a.sureBildir?.(b.belirtec, sn); b.belirtec = ''; }
  }

  private baglantiDustu(b: Baglanti, neden: AkisNedeni, sureDoldu = false): void {
    if (b.kapali) return;
    this.baglantiKapat(b);
    if (this.bitti || this.oldu) return;
    if (b === this.hazir) { this.hazir = null; this.hazirlaniyor = false; return; }
    const aktifti = b === this.aktif;
    if (aktifti) this.aktif = null;
    this.emekliler.delete(b);
    const bekleyenler = b.segmentler;
    if (!bekleyenler.length) return; // boşta kopma: bir sonraki konuşmanın sesiyle yeniden açılır
    if (!sureDoldu && ++this.deneme > this.z.yenidenDenemeMs.length) { this.kaliciDus(neden === 'belirtec' ? 'belirtec' : 'baglanti', bekleyenler); return; }
    this.istatistik.yenidenBaglanma++;
    // Cevabı gelmemiş segmentler yeni bağlantıya baştan yüklenir (ses tutuluyordu); kesin metin yine gelir. Yeni bağlantı HEP ayrıdır: canlı bir bağlantının
    // araya girmiş sesinden önce eski segment gönderilirse commit cevapları sıra değiştirirdi.
    for (const s of bekleyenler) { s.gonderilen = 0; s.commitGitti = false; }
    this.sahipsiz.push(...bekleyenler);
    const devral = () => {
      this.yenidenSaati = null;
      if (this.kapaliMi) return;
      const l = this.sahipsiz.splice(0);
      if (!l.length) return;
      const h = this.baglan(this.aktif && !this.aktif.kapali ? 'emekli' : 'aktif');
      h.segmentler = l.sort((x, y) => x.no - y.no);
      for (const s of h.segmentler) this.gonder(s, h);
    };
    const bekle = sureDoldu ? 0 : this.z.yenidenDenemeMs[this.deneme - 1] ?? 0;
    if (bekle) { this.yenidenSaati = setTimeout(devral, bekle); this.yenidenSaati.unref?.(); } else devral();
  }

  private kaliciDus(neden: AkisNedeni, ek: Segment[] = []): void {
    if (this.oldu || this.bitti) return;
    this.oldu = true;
    const hepsi = [...new Set([...this.tumSegmentler(), ...ek])].sort((x, y) => x.no - y.no);
    this.sahipsiz = [];
    const bekleyenler = hepsi.map((s) => ({ no: s.no, pcm: birlestir(s.parcalar), kesinlesmis: s.commit }));
    this.temizle();
    this.a.dustu({ neden, bekleyenler });
  }

  private canliTut(): void {
    const b = this.aktif;
    if (!b || !b.acik || b.kapali) return;
    if (this.simdi() - b.sonGonderim < this.z.canliTutmaMs) return;
    try {
      b.ws!.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.alloc(Math.round(this.hz * 0.04) * 2).toString('base64'), commit: false, sample_rate: this.hz }));
      b.sonGonderim = this.simdi();
    } catch { this.baglantiDustu(b, 'baglanti'); }
  }

  private temizle(): void {
    if (this.yenidenSaati) clearTimeout(this.yenidenSaati);
    this.yenidenSaati = null;
    if (this.canliSaati) clearInterval(this.canliSaati);
    this.canliSaati = null;
    for (const b of [this.aktif, this.hazir, ...this.emekliler]) if (b) this.baglantiKapat(b);
    this.aktif = this.hazir = null;
    this.emekliler.clear();
    this.sahipsiz = [];
    this.acikSeg = null;
  }

  /** Toplantı bitti: açık segment kesinleştirilir, bekleyen cevaplar en çok `ms` beklenir, sonra her şey kapanır (süreler bildirilir). */
  async bitir(ms = 4000): Promise<void> {
    if (this.kapaliMi) return;
    this.commit();
    const son = this.simdi() + ms;
    while (this.bekleyen > 0 && !this.oldu && this.simdi() < son) await new Promise((c) => setTimeout(c, 25));
    this.kapat();
  }

  /** Hemen kapat (Gizli açıldı, vazgeçildi, uygulama kapanıyor): bağlantılar kesilir, süreler bildirilir, cevap beklenmez. */
  kapat(): void {
    if (this.bitti) return;
    this.bitti = true;
    this.temizle();
  }
}

function birlestir(l: Uint8Array[]): Uint8Array {
  const o = new Uint8Array(l.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of l) { o.set(p, k); k += p.length; }
  return o;
}
