// ── Claude Code olay normalleştirici (Görev 27, K17) — saf; birim testli: tests/cc-olay.test.ts ─────────────────────────────
// Agent SDK'nın iletilerini (system/init, stream_event, assistant, user, result…) ve Claude Code'un JSONL dökümünün satırlarını
// arayüzün çizeceği SADE kayıtlara çevirir: metin parçası/metin, düşünme göstergesi, araç başladı/bitti, alt ajan, yapılacaklar,
// izin isteği, sonuç. Girdi `unknown` olarak alınır ve alan alan doğrulanır: Claude Code sürümü değişince tanınmayan ileti ya da
// alan sessizce atlanır (çökme yok). Uzun girdi/çıktılar kısaltılır (IPC ve bellek). Bu dosya SDK'yı içe AKTARMAZ (arayüz de kullanır).

import { ccHataAciklamasi } from './cc-hata.ts';

/** Arayüzde seçilebilen izin modları (K17): Her şeyi sor · Düzenlemelere izin ver · Plan · Tam yetki. */
export type CcMod = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export const CC_MODLARI: readonly CcMod[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
export const ccModMu = (m: unknown): m is CcMod => typeof m === 'string' && (CC_MODLARI as readonly string[]).includes(m);
/** Claude Code oturum kimliği (JSONL dosya adı) ve model adı biçimleri (doğrulama; yol kaçışı/argüman sızması yok). */
export const CC_KIMLIK_RE = /^[0-9a-zA-Z_-]{6,80}$/;
export const CC_MODEL_RE = /^[\w.:@/[\]][\w.:@/[\]-]{0,119}$/; // '-' ile başlamaz (bayrak gibi görünmesin)
/**
 * Oturum açılmadan önce (taslakta) model seçicisinin listesi: Claude Code'un takma adları. Gerçek liste oturumdan gelince (supportedModels)
 * saklanır ve bunun yerine geçer; bu yedek boş liste olmasın diye (0.13 T12 — taslakta model seçilemiyordu).
 */
export const CC_VARSAYILAN_MODELLER: readonly { deger: string; ad: string; aciklama: string }[] = [
  { deger: 'opus', ad: 'Opus', aciklama: 'En yetenekli model; zor ve uzun işler' },
  { deger: 'sonnet', ad: 'Sonnet', aciklama: 'Hız ve yetenek dengesi; günlük işler' },
  { deger: 'haiku', ad: 'Haiku', aciklama: 'En hızlı ve hafif; basit işler' },
];
/** Düşünme gücü (SDK Options.effort / EffortLevel — sdk.d.ts'ten doğrulandı). */
export const CC_EFOR_SEVIYELERI = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type CcEfor = (typeof CC_EFOR_SEVIYELERI)[number];
export const ccEforMu = (e: unknown): e is CcEfor => typeof e === 'string' && (CC_EFOR_SEVIYELERI as readonly string[]).includes(e);

// ── Model adları (analiz 11 Kas bulgu 2): Claude Code her turun system/init iletisinde ÇÖZÜLMÜŞ tam kimliği bildirir
// (ör. claude-sonnet-4-5-20250929); seçici ise takma adla (sonnet) seçer. Seçim init'le ezilmez; tam kimlik takma ada eşlenir, dostça adla gösterilir.
const AILE_ADI: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };
/** Model kimliği → takma ad (opus / sonnet / haiku / fable); tanınmazsa null. `claude-3-5-haiku-…`, `opus[1m]` da tanınır. */
export function ccModelTakmaAdi(id: string | null | undefined): string | null {
  const m = /(?:^|[-_/.])(opus|sonnet|haiku|fable)(?=$|[-_.[\]@:/])/i.exec(String(id ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}
/** Tam kimlikteki sürüm (claude-sonnet-4-5-20250929 → "4.5"; claude-3-5-haiku-20241022 → "3.5"); yoksa ''. */
function modelSurumu(id: string): string {
  const a = /(?:opus|sonnet|haiku|fable)-(\d{1,2})(?:-(\d{1,2}))?(?=$|-\d{6,}|[-[@])/i.exec(id);
  if (a) return a[2] ? `${a[1]}.${a[2]}` : a[1];
  const b = /claude-(\d{1,2})(?:-(\d{1,2}))?-(?:opus|sonnet|haiku)/i.exec(id);
  return b ? (b[2] ? `${b[1]}.${b[2]}` : b[1]) : '';
}
/**
 * Seçicide ve denetçide görünen ad: listede (supportedModels) dostça adı varsa o; tam kimlikse "Sonnet 4.5"; takma adsa "Sonnet";
 * 'default' ya da boş → "Varsayılan". Tanınmayan kimlik olduğu gibi (kısaltılmış) döner.
 */
export function ccModelGorunenAdi(id: string | null | undefined, liste: readonly { deger: string; ad: string }[] = []): string {
  const d = String(id ?? '').trim();
  if (!d || d === 'default') return 'Varsayılan';
  const l = liste.find((m) => m.deger === d);
  if (l && l.ad && l.ad !== l.deger) return l.ad;
  const takma = ccModelTakmaAdi(d);
  if (!takma) return kisalt(d, 40);
  const surum = d.toLowerCase() === takma ? '' : modelSurumu(d);
  const ek = /\[1m\]/i.test(d) ? ' (1M)' : '';
  return `${AILE_ADI[takma]}${surum ? ` ${surum}` : ''}${ek}`;
}
/**
 * Seçicinin seçili değeri: kullanıcının seçimi listede varsa o; değilse (eski kayıt ya da tam kimlik) listedeki takma adına eşlenir; o da yoksa
 * kendisi (seçici ona dostça adlı bir seçenek ekler). Boş ya da 'default' → '' (Varsayılan).
 */
export function ccSeciliModel(secim: string | null | undefined, liste: readonly { deger: string }[]): string {
  const d = String(secim ?? '').trim();
  if (!d || d === 'default') return '';
  if (liste.some((m) => m.deger === d)) return d;
  const takma = ccModelTakmaAdi(d);
  if (takma && liste.some((m) => m.deger === takma)) return takma;
  return d;
}
/**
 * `total_cost_usd` Claude Code'un API fiyatıyla HESAPLADIĞI tahmindir; Claude üyeliğiyle (OAuth) çalışan kişiden para çıkmaz. Dolar yalnız
 * kimlik bilgisi bir API anahtarından geldiğinde gösterilir (init iletisi apiKeySource); 'none' (üyelik ya da üçüncü taraf bulut), eski
 * değerler ve bilinmeyen (alan yok) → gösterilmez.
 */
export const ccParaGosterilir = (apiKaynak: unknown): boolean => apiKaynak === 'ANTHROPIC_API_KEY' || apiKaynak === 'apiKeyHelper' || apiKaynak === '/login managed key';
/** Kısıtlayıcılık sırası (küçük = daha kısıtlı): Plan < Her şeyi sor < Düzenlemelere izin ver < Tam yetki. Telefon yalnız daraltır. */
export const CC_MOD_SIRASI: Record<CcMod, number> = { plan: 0, default: 1, acceptEdits: 2, bypassPermissions: 3 };

/** Uygulama içi oturumun hâli: sırada (eşzamanlı sınır dolu) · çalışıyor · izin bekliyor · boşta · hata (sürdürülebilir) · kapandı. */
export type CcDurum = 'sirada' | 'calisiyor' | 'izin' | 'bosta' | 'hata' | 'kapandi';
/** Oturumu kim başlattı: Claude Code sayfası, Fuber sohbeti (claude_code_gorev) ya da telefon (claudecode:ac). */
export type CcKaynak = 'sayfa' | 'sohbet' | 'telefon';
export type CcAracTipi = 'okuma' | 'duzenleme' | 'kabuk' | 'arama' | 'alt-ajan' | 'yapilacaklar' | 'web' | 'mcp' | 'soru' | 'plan' | 'diger';

export interface CcBelirtec { girdi: number; cikti: number; onbellekOkuma: number; onbellekYazma: number }
/** Yapılacak maddesi: TodoWrite listesi ya da Task* araçlarının görevi (`kimlik` = görev kimliği). */
export interface CcYapilacak { icerik: string; durum: 'bekliyor' | 'suruyor' | 'tamam'; etkinMetin?: string; kimlik?: string }
export interface CcSoru { soru: string; baslik?: string; secenekler: { etiket: string; aciklama?: string }[]; cokluSecim: boolean }

export type CcIzinIstegi = {
  tur: 'izin-istegi'; istekId: string; arac: string; tip: CcAracTipi; girdi: Record<string, unknown>; ozet: string;
  /** Claude Code'un kendi izin cümlesi / kısa adı / alt yazısı / nedeni (varsa; ham metin — arayüz kaçışlar). */
  baslik?: string; adi?: string; aciklama?: string; neden?: string;
  /** AskUserQuestion: seçenek kartı. */
  sorular?: CcSoru[];
  /** "Bu oturumda hep izin ver" sunulabilir mi (Claude Code öneri verdi ve kalıcı kural yasaklanmadı). */
  herZamanSunulur: boolean;
  /** Tek tuşla onaylanmasın (Claude Code istedi): kart "Reddet"te açılır. */
  hayirdaAc?: boolean;
  ajan?: string; aracKimligi?: string; kisaltildi?: boolean;
};

export type CcSonuc = {
  tur: 'sonuc'; basarili: boolean; kesildi: boolean; sureMs: number; turSayisi: number; maliyetUsd: number; belirtec: CcBelirtec;
  hata?: string; metin?: string;
  /** `hata` aynı turda dökümde zaten bir hata satırı olarak gösterildi (asistan hata iletisi): sonuç çizgisi cümleyi yinelemez. */
  hataGorundu?: boolean;
  /** `maliyetUsd` gösterilebilir mi: yalnız API anahtarıyla çalışan oturumda (ccParaGosterilir); üyelikte ya da bilinmiyorsa false/yok. */
  paraGoster?: boolean;
};

export type CcOlay =
  | { tur: 'baslangic'; kimlik: string; model: string; mod: string; surum: string; cwd: string; araclar: string[]; komutlar: string[]; yetenekler: string[]; apiKaynak?: string }
  | { tur: 'kullanici'; id: string; metin: string; gorselSayisi: number }
  | { tur: 'metin-parca'; blok: string; metin: string; ust: string | null }
  | { tur: 'metin'; blok: string; metin: string; ust: string | null }
  | { tur: 'dusunme'; blok: string; durum: 'basladi' | 'bitti'; ust: string | null }
  | { tur: 'arac-basladi'; id: string; ad: string; tip: CcAracTipi; girdi: Record<string, unknown>; ozet: string; ust: string | null; kisaltildi?: boolean }
  | { tur: 'arac-bitti'; id: string; hata: boolean; cikti: string; kisaltildi: boolean; ust: string | null }
  | { tur: 'alt-ajan'; id: string; aciklama: string; ajanTipi?: string; istem: string; ust: string | null }
  | { tur: 'yapilacaklar'; id: string; maddeler: CcYapilacak[]; ust: string | null }
  | CcIzinIstegi
  | { tur: 'izin-yanitlandi'; istekId: string; karar: 'izin' | 'hep' | 'ret' | 'iptal' }
  | CcSonuc
  | { tur: 'mod'; mod: string }
  | { tur: 'model'; model: string }
  /** `ayrinti` (5 Kas): koşum bildiriminin açılır ayrıntısı (görev sonucu, çıktı dosyası); tek satır `metin` her zaman görünür. */
  | { tur: 'sistem'; seviye: 'bilgi' | 'uyari' | 'hata'; metin: string; ayrinti?: string }
  | { tur: 'durum'; ozet: CcOturumOzeti }
  /** Arka planda süren iş sayısı (alt ajan, kabuk, izleyici…): tur bitse de sürer; değişince bir kez bildirilir. */
  | { tur: 'arka-plan'; sayi: number }
  /** İşlerin listesi (analiz 11 Kas bulgu 5): ad, hâl, süre, son araç, çıktı dosyası. Dökümde tutulmaz; her değişimde tam liste. */
  | { tur: 'arka-isler'; isler: CcArkaIs[] }
  /** Oturum kaydı silindi ("Oturumu unut" ya da kapalı oturum sınırı): arayüz listeden kaldırır. */
  | { tur: 'unutuldu' };

/** Claude Code'un bir işi (Bash `run_in_background`, alt ajan, izleyici…): task_started / task_progress / task_updated / task_notification /
 *  tool_progress iletilerinden. `arkaPlanda` false: ön planda (turu bekleten) iş — "Arka plana al" (Query.backgroundTasks) sunulur. */
export interface CcArkaIs {
  id: string; aciklama: string; tip: 'kabuk' | 'ajan' | 'izleyici' | 'diger';
  durum: 'suruyor' | 'bitti' | 'basarisiz' | 'durduruldu';
  arkaPlanda: boolean; aracId?: string; baslangic: number; sureSn?: number; sonArac?: string; ozet?: string;
  /** Claude Code'un çıktı dosyası (Bash arka plan sonucu "Output is being written to: …" ya da task_notification output_file). */
  ciktiDosyasi?: string; bitis?: number;
}

/** `claudecode:olay` yükü. `sira` oturum başına artar (sıralama ve tekrar ayıklama). */
export interface CcOlayZarfi { oturum: string; sira: number; zaman: number; olay: CcOlay }

/** Listede ve telefonda (salt okur `claudecode:oturumlar`) görünen özet: döküm İÇERMEZ. */
export interface CcOturumOzeti {
  id: string;
  /** Claude Code'un oturum kimliği (ilk system/init'ten sonra; sürdürülen oturumda baştan). */
  kimlik?: string;
  cwd: string; proje: string; baslik: string;
  durum: CcDurum; mod: CcMod;
  /** Kullanıcının seçtiği model (takma ad ya da kimlik; yoksa Claude Code'un varsayılanı). Init iletisi bunu EZMEZ (bulgu 2). */
  model?: string;
  /** Claude Code'un son system/init iletisinde bildirdiği çözülmüş model kimliği: yalnız gösterim (denetçi, ipucu). */
  etkinModel?: string;
  /** Düşünme gücü (canlı oturumda da değişir: applyFlagSettings). */
  efor?: CcEfor;
  kaynak: CcKaynak;
  /** İş izi (11 Kas): oturum Fuber sohbetinden verildiyse o sohbet — sohbet bu oturumu ve alt ajanlarını yardımcı şeridi olarak gösterir. */
  sohbetId?: number;
  bekleyenIzin: number; kuyruk: number; siraNo?: number;
  /** Arka planda süren iş sayısı (tur bitmiş olsa da): >0 iken oturum "Bitti" değil "Arka planda" görünür. Süreç kapanınca 0. */
  arkaPlan: number;
  /** Yalnız API anahtarıyla çalışan oturumda dolu (üyelikte ya da kaynak bilinmiyorsa YOK): tahmini dolar gösterilmesin diye. */
  maliyetUsd?: number; belirtec?: CcBelirtec; sureMs?: number; turSayisi?: number;
  degisenDosyaSayisi: number;
  surum?: string; yetenekler: string[];
  hata?: string;
  olusturma: number; sonEtkinlik: number;
}

/** Süren iş ya da kullanıcıdan karar bekleyen oturum var mı: Business mode'da Claude Code sayfası bunlar varken açık kalır (renderer/main.tsx; yoksa izin kartındaki "Aç"
 *  sayfayı açamaz, oturum izinde sonsuza dek bekler). Biten oturum sayılmaz: bildirimi yeter. */
export const ccCanliVar = (l: readonly Pick<CcOturumOzeti, 'durum' | 'bekleyenIzin' | 'kuyruk' | 'arkaPlan'>[]): boolean =>
  l.some((o) => o.bekleyenIzin > 0 || o.kuyruk > 0 || o.arkaPlan > 0 || o.durum === 'calisiyor' || o.durum === 'izin' || o.durum === 'sirada');

export interface CcOturumAyrintisi extends CcOturumOzeti {
  olaylar: CcOlayZarfi[];
  bekleyenIzinler: CcIzinIstegi[];
  kuyrukMesajlari: { id: string; metin: string; gorselSayisi: number }[];
  degisenDosyalar: string[];
  yapilacaklar: CcYapilacak[];
  /** İşler (biten en çok 8; sonra eskisi düşer). */
  arkaIsler?: CcArkaIs[];
}

// ── Kısaltma ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const GIRDI_SINIRI = 20_000;
export const CIKTI_SINIRI = 8_000;
export const kisalt = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s);

type S = Record<string, unknown>;
const nesne = (x: unknown): x is S => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const metinMi = (x: unknown): x is string => typeof x === 'string';
const sayi = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

/** Girdiyi derin kopyalar; GIRDI_SINIRI'nı aşan metinler kısaltılır (Write içeriği, uzun Bash). */
export function girdiKisalt(g: unknown, sinir = GIRDI_SINIRI): { girdi: Record<string, unknown>; kisaltildi: boolean } {
  let kisaltildi = false;
  const kopya = (x: unknown, derinlik: number): unknown => {
    if (metinMi(x)) { if (x.length > sinir) { kisaltildi = true; return kisalt(x, sinir); } return x; }
    if (Array.isArray(x)) { if (derinlik > 6) return []; const l = x.slice(0, 200); if (x.length > 200) kisaltildi = true; return l.map((y) => kopya(y, derinlik + 1)); }
    if (nesne(x)) { if (derinlik > 6) return {}; const o: S = {}; for (const [k, v] of Object.entries(x)) o[k] = kopya(v, derinlik + 1); return o; }
    return x;
  };
  const sonuc = kopya(nesne(g) ? g : {}, 0) as Record<string, unknown>;
  return { girdi: sonuc, kisaltildi };
}

// ── Araç sınıfı ve tek satırlık özet ─────────────────────────────────────────────────────────────────────────────────────
export function aracTipi(ad: string): CcAracTipi {
  if (ad.startsWith('mcp__')) return 'mcp';
  switch (ad) {
    case 'Read': case 'NotebookRead': case 'LS': return 'okuma';
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return 'duzenleme';
    case 'Bash': case 'PowerShell': case 'BashOutput': case 'KillShell': case 'KillBash': return 'kabuk';
    case 'Grep': case 'Glob': return 'arama';
    case 'Task': case 'Agent': return 'alt-ajan';
    // TodoWrite ve Claude Code 2.1'in görev araçları (sdk-tools.d.ts: TaskCreate/TaskUpdate/TaskList/TaskGet) aynı listeye.
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': case 'TaskList': case 'TaskGet': return 'yapilacaklar';
    case 'WebFetch': case 'WebSearch': return 'web';
    case 'AskUserQuestion': return 'soru';
    case 'ExitPlanMode': return 'plan';
    default: return 'diger';
  }
}

const tekSatir = (s: string, n = 140) => kisalt(s.replace(/\s+/g, ' ').trim(), n);
const dosyaAdi = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function aracOzeti(ad: string, girdi: Record<string, unknown>): string {
  const g = (k: string) => (metinMi(girdi[k]) ? (girdi[k] as string) : '');
  const tip = aracTipi(ad);
  if (tip === 'okuma' || tip === 'duzenleme') return g('file_path') || g('notebook_path') || g('path') || ad;
  if (tip === 'kabuk') return tekSatir(g('command') || g('bash_id') || g('shell_id') || ad);
  if (ad === 'Grep') return `“${tekSatir(g('pattern'), 80)}”${g('path') ? ` · ${dosyaAdi(g('path'))}` : ''}`;
  if (ad === 'Glob') return tekSatir(g('pattern') || ad);
  if (ad === 'WebFetch') return tekSatir(g('url') || ad);
  if (ad === 'WebSearch') return `“${tekSatir(g('query'), 100)}”`;
  if (tip === 'alt-ajan') return tekSatir(g('description') || g('prompt') || ad);
  if (tip === 'yapilacaklar') return Array.isArray(girdi.todos) ? `${girdi.todos.length} madde` : tekSatir(g('subject') || g('taskId') || ad);
  if (tip === 'soru') { const q = Array.isArray(girdi.questions) && nesne(girdi.questions[0]) ? girdi.questions[0].question : ''; return tekSatir(metinMi(q) ? q : 'Soru'); }
  if (tip === 'plan') return 'Plan hazır';
  if (tip === 'mcp') { const m = /^mcp__(.+?)__(.+)$/.exec(ad); return m ? `${m[1].replace(/_/g, ' ')} · ${m[2].replace(/_/g, ' ')}` : ad; }
  const ilk = Object.values(girdi).find(metinMi);
  return ilk ? tekSatir(ilk) : ad;
}

function yapilacaklarOku(todos: unknown): CcYapilacak[] {
  if (!Array.isArray(todos)) return [];
  return todos.filter(nesne).slice(0, 100).map((t) => ({
    icerik: tekSatir(metinMi(t.content) ? t.content : '', 300),
    durum: t.status === 'completed' ? 'tamam' : t.status === 'in_progress' ? 'suruyor' : 'bekliyor',
    ...(metinMi(t.activeForm) ? { etkinMetin: tekSatir(t.activeForm, 300) } : {}),
  }));
}

export function sorulariOku(girdi: Record<string, unknown>): CcSoru[] {
  const qs = Array.isArray(girdi.questions) ? girdi.questions.filter(nesne) : [];
  return qs.slice(0, 10).map((q) => ({
    soru: metinMi(q.question) ? q.question : '',
    ...(metinMi(q.header) ? { baslik: q.header } : {}),
    secenekler: (Array.isArray(q.options) ? q.options.filter(nesne) : []).slice(0, 20).map((o) => ({
      etiket: metinMi(o.label) ? o.label : '',
      ...(metinMi(o.description) ? { aciklama: o.description } : {}),
    })),
    cokluSecim: q.multiSelect === true,
  }));
}

/**
 * AskUserQuestion yanıtları sorulan sorulara uymalı: her soru (tam metniyle) yanıtlanmış, fazladan anahtar yok; seçenek yanıtı
 * seçeneklerden biri (çoklu seçimde bir ya da daha çok seçenek — Claude Code'a virgülle birleştirilir). Claude Code her soruya
 * kendiliğinden bir "Diğer" (serbest metin) seçeneği ekler: `serbest` listesindeki sorular boş olmayan serbest metin alır.
 */
export function soruCevaplariniDogrula(sorular: CcSoru[], cevaplar: unknown, serbest: unknown = []): { tamam: true; answers: Record<string, string> } | { tamam: false; hata: string } {
  if (!nesne(cevaplar)) return { tamam: false, hata: 'Yanıt verilmedi.' };
  const serbestler = new Set(Array.isArray(serbest) ? serbest.filter(metinMi) : []);
  const beklenen = new Set(sorular.map((s) => s.soru));
  const fazla = Object.keys(cevaplar).filter((k) => !beklenen.has(k));
  if (fazla.length) return { tamam: false, hata: `Sorulmayan soruya yanıt: ${kisalt(fazla[0], 80)}` };
  const answers: Record<string, string> = {};
  for (const s of sorular) {
    const c = cevaplar[s.soru];
    if (c === undefined) return { tamam: false, hata: `Yanıtlanmamış soru: ${kisalt(s.soru, 80)}` };
    if (serbestler.has(s.soru)) {
      if (!metinMi(c) || !c.trim()) return { tamam: false, hata: `Boş yanıt: ${kisalt(s.soru, 80)}` };
      answers[s.soru] = kisalt(c.trim(), 4000);
      continue;
    }
    const etiketler = new Set(s.secenekler.map((o) => o.etiket));
    const secilen = Array.isArray(c) ? c.filter(metinMi).map((x) => x.trim()) : metinMi(c) ? (s.cokluSecim ? c.split(',').map((x) => x.trim()) : [c.trim()]) : [];
    if (!secilen.length || secilen.some((x) => !x)) return { tamam: false, hata: `Boş yanıt: ${kisalt(s.soru, 80)}` };
    if (!s.cokluSecim && secilen.length !== 1) return { tamam: false, hata: `Tek seçim bekleniyor: ${kisalt(s.soru, 80)}` };
    const gecersiz = secilen.find((x) => !etiketler.has(x));
    if (gecersiz !== undefined) return { tamam: false, hata: `Seçeneklerde yok: ${kisalt(gecersiz, 80)}` };
    answers[s.soru] = [...new Set(secilen)].join(', ');
  }
  return { tamam: true, answers };
}

// ── Kullanıcı metni (döküm) ─────────────────────────────────────────────────────────────────────────────────────────────
/** JSONL'deki kullanıcı metninden sistem hatırlatmaları ve komut çıktıları atılır; yerel komut adı (/compact) kalır. */
export function istemTemizle(t: string): string {
  let s = t.replace(/<(system-reminder|local-command-stdout|local-command-stderr|command-message|command-args|bash-stdout|bash-stderr)>[\s\S]*?<\/\1>/g, '').trim();
  const komut = /<command-name>([\s\S]*?)<\/command-name>/.exec(s);
  if (komut) s = komut[1].trim();
  if (/^Caveat: The messages below/i.test(s) || /^\[Request interrupted/i.test(s)) return '';
  return s;
}

// ── Koşum bildirimleri (5 Kas; tests/cc-harnes-bildirimi.test.ts) ──────────────────────────────────────────────────────────
// "<task-notification> <task-id>… <status>completed</status> <summary>Agent … finished</summary>" sohbette kullanıcının KENDİ yazdığı balon gibi
// görünüyordu. Claude Code arka plan işi bitince (ve kancalar vb.) bunları kullanıcı rolüyle yazar. İletinin TAMAMI kebap adlı etiketlerle sarılıysa
// (kullanıcının yazdığı metnin içinde alıntı değilse) bu bir koşum iletisidir: kullanıcı balonu değil, tek satırlık 'sistem' olayı + açılır ayrıntı.
/** istemTemizle'nin kendisi işlediği etiketler (komut adı kalır, çıktılar atılır): koşum bildirimi sayılmaz. */
const ISTEM_ETIKETLERI = new Set(['system-reminder', 'local-command-stdout', 'local-command-stderr', 'local-command-caveat', 'command-message', 'command-args', 'command-name', 'bash-stdout', 'bash-stderr', 'bash-input']);
const ETIKETSIZ = (s: string) => s.replace(/<\/?[a-zA-Z][\w-]*>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const alanAl = (ic: string, ad: string) => { const m = new RegExp(`<${ad}>([\\s\\S]*?)</${ad}>`).exec(ic); return m ? m[1].trim() : ''; };
const GOREV_DURUM_METNI: Record<string, string> = { completed: 'bitti', failed: 'başarısız', error: 'başarısız', killed: 'durduruldu', stopped: 'durduruldu', cancelled: 'durduruldu', running: 'sürüyor' };
/** Koşumun bildirimden sonra eklediği kuyruk satırları ("Full transcript available at: …"). */
const KUYRUK_SATIRI = /^(Full transcript available at|Read the output file|The output file)/i;

/** İnceleme m6: yalnız bilinen koşum etiketleri (ve -hook / -notification ile bitenler); kullanıcının kendi `<my-notes>` etiketi balon kalır. */
const HARNES_ETIKETLERI = new Set(['task-notification', 'user-prompt-submit-hook', 'session-start-hook', 'background-task-notification', 'agent-notification']);
const harnesEtiketiMi = (e: string): boolean => HARNES_ETIKETLERI.has(e) || /-(hook|notification)$/.test(e);
export interface HarnesBildirimi { metin: string; ayrinti: string }
/** Kullanıcı rolüyle gelen metin bir koşum bildirimi mi: evetse her bildirim için tek satır + ayrıntı; değilse (kullanıcının metni) null. */
export function harnesBildirimleri(ham: string): HarnesBildirimi[] | null {
  const s = ham.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  const blokRe = /<([a-z]+(?:-[a-z]+)+)>([\s\S]*?)<\/\1>/g;
  if (!/^<[a-z]+(?:-[a-z]+)+>/.test(s)) return null;
  const out: HarnesBildirimi[] = [];
  const kuyruk: string[] = [];
  let son = 0;
  for (let m = blokRe.exec(s); m; m = blokRe.exec(s)) {
    const arada = s.slice(son, m.index).trim();
    if (arada && !arada.split('\n').every((l) => !l.trim() || KUYRUK_SATIRI.test(l.trim()))) return null;
    if (arada) kuyruk.push(arada);
    son = m.index + m[0].length;
    const [, etiket, ic] = m;
    if (ISTEM_ETIKETLERI.has(etiket) || !harnesEtiketiMi(etiket)) return null;
    if (etiket === 'task-notification') {
      const ozet = ETIKETSIZ(alanAl(ic, 'summary'));
      const durum = alanAl(ic, 'status').toLowerCase();
      const fiil = GOREV_DURUM_METNI[durum] ?? (durum ? 'güncellendi' : 'bitti');
      const sonuc = ETIKETSIZ(alanAl(ic, 'result'));
      const dosya = alanAl(ic, 'output-file');
      out.push({
        metin: `Arka plan işi ${fiil}${ozet ? `: ${tekSatir(ozet, 160)}` : '.'}`,
        ayrinti: kisalt([sonuc, dosya ? `Çıktı dosyası: ${dosya}` : ''].filter(Boolean).join('\n\n'), 4000),
      });
    } else {
      const ic2 = ETIKETSIZ(ic);
      out.push({ metin: `Claude Code bildirimi${ic2 ? `: ${tekSatir(ic2, 160)}` : '.'}`, ayrinti: kisalt(ic2, 4000) });
    }
  }
  const kalan = s.slice(son).trim();
  if (kalan && !kalan.split('\n').every((l) => !l.trim() || KUYRUK_SATIRI.test(l.trim()))) return null;
  if (kalan) kuyruk.push(kalan);
  if (!out.length) return null;
  if (kuyruk.length) { const k = out[out.length - 1]; k.ayrinti = kisalt([k.ayrinti, ...kuyruk].filter(Boolean).join('\n\n'), 4000); }
  return out;
}

// ── Normalleştirme bağlamı ──────────────────────────────────────────────────────────────────────────────────────────────
interface AkisMesaji { id: string; metinSayisi: number; bloklar: Map<number, { tur: string; blok: string }>; dusunmeVar: boolean }
export interface CcNormalBaglam {
  /** parent_tool_use_id (ana iş parçacığı '') → akmakta olan mesaj. */
  akis: Map<string, AkisMesaji>;
  /** Tam asistan iletilerinde mesaj kimliği başına görülen metin bloğu sayısı (akıştaki sırayla eşleşir). */
  asistanMetin: Map<string, number>;
  /** Akışta düşünme bloğu görülen mesajlar (tam iletideki düşünme ikinci kez bildirilmesin). */
  dusunmeGorulen: Set<string>;
  /** tool_use kimliği → araç adı ve tipi (sonuçlar için). */
  araclar: Map<string, { ad: string; tip: CcAracTipi; girdi?: Record<string, unknown> }>;
  /** Task* araçlarının görev listesi (görev kimliği → madde), eklenme sırasıyla. */
  gorevler: Map<string, CcYapilacak>;
  /** Arka planda süren görevlerin kimlikleri: seviye sinyali (background_tasks_changed) kümeyi DEĞİŞTİRİR, kenar olayları ekler/çıkarır. */
  arkaPlan: Set<string>;
  /** Son bildirilen arka plan sayısı (değişmeyen sayı yeniden bildirilmez). */
  arkaPlanSon: number;
  /** init iletisindeki apiKeySource (sonuç iletisinin paraGoster'i bundan çıkar; init görülmediyse bilinmiyor → gösterilmez). */
  apiKaynak?: string;
  /** İşler (görev kimliği → iş), eklenme sırasıyla; Bash araç kimliği → çıktı dosyası (task_started'dan önce ya da sonra gelebilir). */
  isler: Map<string, CcArkaIs>;
  aracCiktilari: Map<string, string>;
  /** Bu turda asistan hata iletisi (Claude Code'un sentetik hata mesajı) gösterildi; sonuç satırı cümleyi yinelemesin. */
  turHatasi?: boolean;
}
export const yeniBaglam = (): CcNormalBaglam => ({
  akis: new Map(), asistanMetin: new Map(), dusunmeGorulen: new Set(), araclar: new Map(), gorevler: new Map(), arkaPlan: new Set(), arkaPlanSon: 0,
  isler: new Map(), aracCiktilari: new Map(),
});

/** Küme sayısı son bildirilenden farklıysa tek 'arka-plan' olayı. */
function arkaPlanOlayi(b: CcNormalBaglam): CcOlay[] {
  const n = b.arkaPlan.size;
  if (n === b.arkaPlanSon) return [];
  b.arkaPlanSon = n;
  return [{ tur: 'arka-plan', sayi: n }];
}
/** Süreç bitti/yeniden açılıyor: arka plan işleri onunla birlikte öldü; küme sıfırlanır (seviye sinyali süreç başında hiç gelmez). */
export function arkaPlanSifirla(b: CcNormalBaglam): CcOlay[] {
  b.arkaPlan.clear();
  // Süren işler "durduruldu" olur: liste görünür kalır, iş sessizce kaybolmaz.
  let degisti = false;
  for (const i of b.isler.values()) if (i.durum === 'suruyor') { i.durum = 'durduruldu'; i.bitis = Date.now(); i.ozet = i.ozet || 'Claude Code kapandı; iş onunla durdu.'; degisti = true; }
  return [...arkaPlanOlayi(b), ...(degisti ? [islerOlayi(b)] : [])];
}

// ── İşler listesi (bulgu 5) ─────────────────────────────────────────────────────────────────────────────────────────────
const ISLER_SINIRI = 30;
const BITEN_SINIRI = 8;
const IS_TIPI = (t: unknown): CcArkaIs['tip'] => (t === 'local_bash' ? 'kabuk' : t === 'local_agent' || t === 'remote_agent' ? 'ajan' : t === 'monitor' || t === 'local_monitor' ? 'izleyici' : 'diger');
/** Liste olayı (kopya); biten işler en çok BITEN_SINIRI, toplam ISLER_SINIRI (eskisi düşer). */
export function islerOlayi(b: CcNormalBaglam): CcOlay {
  const biten = [...b.isler.values()].filter((i) => i.durum !== 'suruyor');
  for (const i of biten.slice(0, Math.max(0, biten.length - BITEN_SINIRI))) b.isler.delete(i.id);
  while (b.isler.size > ISLER_SINIRI) b.isler.delete(b.isler.keys().next().value as string);
  return { tur: 'arka-isler', isler: [...b.isler.values()].map((i) => ({ ...i })) };
}
/** Bash arka plan sonucundaki çıktı dosyası ("Output is being written to: C:\…\x.output"). */
export function ciktiDosyasiBul(metin: string): string | undefined {
  // İnceleme M4: yalnız Claude Code'un KENDİ arka plan cümlesi (sonucun ilk satırı) — ön planda `cat` edilen bir dosyadaki benzer satır değil.
  // Ağ yolu (\\sunucu\pay, \\?\…, //sunucu) kabul edilmez: tıklanınca SMB bağlantısı açılmasın.
  const m = /^\s*Command running in background with ID: [^\r\n]*?Output is being written to:\s*([^\r\n]+?)\s*(?:$|[\r\n])/i.exec(metin);
  const yol = m ? m[1].trim().replace(/[.,;]+$/, '') : undefined;
  return yol && !/^[\\/]{2}/.test(yol) ? yol : undefined;
}
function isBul(b: CcNormalBaglam, m: S): CcArkaIs | undefined {
  if (metinMi(m.task_id) && b.isler.has(m.task_id)) return b.isler.get(m.task_id);
  if (metinMi(m.tool_use_id)) for (const i of b.isler.values()) if (i.aracId === m.tool_use_id) return i;
  return undefined;
}

const GOREV_DURUMU: Record<string, CcYapilacak['durum']> = { pending: 'bekliyor', in_progress: 'suruyor', completed: 'tamam' };
const gorevListesi = (b: CcNormalBaglam) => [...b.gorevler.values()].map((g) => ({ ...g }));

/** TaskUpdate (araç çağrısında; iyimser — TodoWrite gibi): durum/başlık/etkin metin; 'deleted' siler. */
function gorevGuncelle(b: CcNormalBaglam, g: Record<string, unknown>): boolean {
  const kimlik = metinMi(g.taskId) ? g.taskId : '';
  if (!kimlik) return false;
  if (g.status === 'deleted') return b.gorevler.delete(kimlik);
  const eski = b.gorevler.get(kimlik);
  if (!eski && !metinMi(g.subject)) return false;
  const yeni: CcYapilacak = { ...(eski ?? { icerik: '', durum: 'bekliyor' }), kimlik };
  if (metinMi(g.subject)) yeni.icerik = tekSatir(g.subject, 300);
  if (metinMi(g.activeForm)) yeni.etkinMetin = tekSatir(g.activeForm, 300);
  if (metinMi(g.status) && GOREV_DURUMU[g.status]) yeni.durum = GOREV_DURUMU[g.status];
  b.gorevler.set(kimlik, yeni);
  return true;
}

/** TaskCreate / TaskList sonucu: yapısal çıktı (tool_use_result) varsa ondan; yoksa metindeki "#<kimlik>". */
function gorevSonucu(b: CcNormalBaglam, arac: { ad: string; girdi?: Record<string, unknown> }, aracId: string, yapisal: unknown, metin: string): boolean {
  const y = nesne(yapisal) ? yapisal : {};
  if (arac.ad === 'TaskCreate') {
    const t = nesne(y.task) ? y.task : {};
    const kimlik = metinMi(t.id) ? t.id : /#\s?([\w-]+)/.exec(metin)?.[1] ?? `cc-${aracId}`;
    const g = arac.girdi ?? {};
    const konu = metinMi(t.subject) ? t.subject : metinMi(g.subject) ? g.subject : '';
    b.gorevler.set(kimlik, { icerik: tekSatir(konu, 300), durum: 'bekliyor', kimlik, ...(metinMi(g.activeForm) ? { etkinMetin: tekSatir(g.activeForm, 300) } : {}) });
    return true;
  }
  if (arac.ad === 'TaskList' && Array.isArray(y.tasks)) {
    const eski = b.gorevler;
    b.gorevler = new Map();
    for (const t of y.tasks.filter(nesne).slice(0, 200)) {
      if (!metinMi(t.id)) continue;
      const onceki = eski.get(t.id);
      b.gorevler.set(t.id, {
        icerik: tekSatir(metinMi(t.subject) ? t.subject : onceki?.icerik ?? '', 300), durum: (metinMi(t.status) && GOREV_DURUMU[t.status]) || onceki?.durum || 'bekliyor', kimlik: t.id,
        ...(onceki?.etkinMetin ? { etkinMetin: onceki.etkinMetin } : {}),
      });
    }
    return true;
  }
  return false;
}

/** Bağlam haritaları sınırsız büyümesin (uzun oturum). */
function buda(b: CcNormalBaglam): void {
  const sinirla = <K, V>(m: Map<K, V>, n: number) => { while (m.size > n) m.delete(m.keys().next().value as K); };
  sinirla(b.asistanMetin, 400);
  sinirla(b.araclar, 2000);
  sinirla(b.gorevler, 300);
  while (b.dusunmeGorulen.size > 400) b.dusunmeGorulen.delete(b.dusunmeGorulen.values().next().value as string);
}

const ASISTAN_HATASI: Record<string, string> = {
  authentication_failed: 'Claude Code’da oturum açık değil ya da süresi dolmuş: Claude Code sayfasından “Oturum aç”.',
  oauth_org_not_allowed: 'Bu hesabın kuruluşu Claude Code’a izin vermiyor.',
  account_on_hold: 'Claude hesabı askıda.',
  verification_required: 'Claude hesabı doğrulama bekliyor.',
  billing_error: 'Claude hesabında ödeme sorunu var.',
  rate_limit: 'Claude kullanım sınırına ulaşıldı; biraz sonra yeniden dene.',
  overloaded: 'Claude şu an çok yoğun; yeniden deneniyor.',
  model_not_found: 'Seçilen model bulunamadı.',
  max_output_tokens: 'Yanıt en uzun çıktı sınırına ulaştı.',
};

function icerikMetni(c: unknown): string {
  if (metinMi(c)) return c;
  if (!Array.isArray(c)) return '';
  return c.map((p) => (nesne(p) ? (p.type === 'text' && metinMi(p.text) ? p.text : p.type === 'image' ? '[görsel]' : '') : '')).filter(Boolean).join('\n');
}

function aracBasladi(b: CcNormalBaglam, blok: S, ust: string | null): CcOlay[] {
  const id = metinMi(blok.id) ? blok.id : '';
  const ad = metinMi(blok.name) ? blok.name : '';
  if (!id || !ad) return [];
  const tip = aracTipi(ad);
  const { girdi, kisaltildi } = girdiKisalt(blok.input);
  b.araclar.set(id, { ad, tip, ...(tip === 'yapilacaklar' ? { girdi } : {}) });
  if (tip === 'yapilacaklar') {
    if (ad === 'TodoWrite') return [{ tur: 'yapilacaklar', id, maddeler: yapilacaklarOku(girdi.todos), ust }];
    if (ad === 'TaskUpdate' && gorevGuncelle(b, girdi)) return [{ tur: 'yapilacaklar', id, maddeler: gorevListesi(b), ust }];
    return []; // TaskCreate / TaskList: kimlik ve liste sonuçta gelir; TaskGet listeyi değiştirmez
  }
  if (tip === 'alt-ajan') {
    return [{
      tur: 'alt-ajan', id, aciklama: tekSatir(metinMi(girdi.description) ? girdi.description : 'Alt ajan', 200), istem: kisalt(metinMi(girdi.prompt) ? girdi.prompt : '', 2000), ust,
      ...(metinMi(girdi.subagent_type) ? { ajanTipi: girdi.subagent_type } : {}),
    }];
  }
  return [{ tur: 'arac-basladi', id, ad, tip, girdi, ozet: aracOzeti(ad, girdi), ust, ...(kisaltildi ? { kisaltildi } : {}) }];
}

function aracBitti(b: CcNormalBaglam, blok: S, ust: string | null, yapisal?: unknown): CcOlay[] {
  const id = metinMi(blok.tool_use_id) ? blok.tool_use_id : '';
  if (!id) return [];
  const arac = b.araclar.get(id);
  const ham = icerikMetni(blok.content);
  if (arac?.tip === 'yapilacaklar') {
    // Liste zaten gösterildi ("başarıyla güncellendi" gürültüsü kart olmaz); TaskCreate/TaskList sonucu listeyi kurar.
    if (blok.is_error !== true && gorevSonucu(b, arac, id, yapisal, ham)) return [{ tur: 'yapilacaklar', id, maddeler: gorevListesi(b), ust }];
    return [];
  }
  const out: CcOlay[] = [{ tur: 'arac-bitti', id, hata: blok.is_error === true, cikti: kisalt(ham, CIKTI_SINIRI), kisaltildi: ham.length > CIKTI_SINIRI, ust }];
  // Bash/PowerShell arka plana alındı: sonuç metni çıktı dosyasını söyler; işin satırına bağlanır (canlı çıktı kuyruğu bundan okunur).
  const dosya = arac?.tip === 'kabuk' ? ciktiDosyasiBul(ham) : undefined;
  if (dosya) {
    b.aracCiktilari.set(id, dosya);
    while (b.aracCiktilari.size > 200) b.aracCiktilari.delete(b.aracCiktilari.keys().next().value as string);
    const is = [...b.isler.values()].find((x) => x.aracId === id);
    if (is) { is.ciktiDosyasi = dosya; is.arkaPlanda = true; out.push(islerOlayi(b)); }
  }
  return out;
}

/** Bir asistan mesajının içerik blokları (canlı akış ve döküm aynı yoldan). */
function asistanBloklari(b: CcNormalBaglam, mesajId: string, icerik: unknown, ust: string | null): CcOlay[] {
  const out: CcOlay[] = [];
  if (metinMi(icerik)) icerik = [{ type: 'text', text: icerik }];
  if (!Array.isArray(icerik)) return out;
  let d = 0;
  for (const blok of icerik) {
    if (!nesne(blok)) continue;
    if (blok.type === 'text' && metinMi(blok.text)) {
      const n = b.asistanMetin.get(mesajId) ?? 0;
      b.asistanMetin.set(mesajId, n + 1);
      if (blok.text.trim()) out.push({ tur: 'metin', blok: `${mesajId}#${n}`, metin: blok.text, ust });
    } else if (blok.type === 'thinking' || blok.type === 'redacted_thinking') {
      if (!b.dusunmeGorulen.has(mesajId)) out.push({ tur: 'dusunme', blok: `${mesajId}#d${d}`, durum: 'bitti', ust });
      d++;
    } else if (blok.type === 'tool_use' || blok.type === 'server_tool_use' || blok.type === 'mcp_tool_use') {
      out.push(...aracBasladi(b, blok, ust));
    } else if (metinMi(blok.type) && blok.type.endsWith('_tool_result') && metinMi(blok.tool_use_id)) {
      out.push(...aracBitti(b, blok, ust));
    }
  }
  return out;
}

function kullaniciBloklari(b: CcNormalBaglam, icerik: unknown, ust: string | null, metinleriAl: boolean, id: string, yapisal?: unknown): CcOlay[] {
  const out: CcOlay[] = [];
  if (metinMi(icerik)) {
    if (!metinleriAl) return out;
    const h = harnesBildirimleri(icerik);
    if (h) return h.map((x): CcOlay => ({ tur: 'sistem', seviye: 'bilgi', metin: x.metin, ...(x.ayrinti ? { ayrinti: x.ayrinti } : {}) }));
    const t = istemTemizle(icerik);
    if (t) out.push({ tur: 'kullanici', id, metin: t, gorselSayisi: 0 });
    return out;
  }
  if (!Array.isArray(icerik)) return out;
  const metinler: string[] = [];
  let gorsel = 0;
  // Yapısal araç çıktısı (tool_use_result / JSONL'de toolUseResult) iletinin TEK araç sonucuna aittir.
  const tekSonuc = icerik.filter((x) => nesne(x) && x.type === 'tool_result').length === 1;
  for (const blok of icerik) {
    if (!nesne(blok)) continue;
    if (blok.type === 'tool_result') out.push(...aracBitti(b, blok, ust, tekSonuc ? yapisal : undefined));
    else if (metinleriAl && blok.type === 'text' && metinMi(blok.text)) metinler.push(blok.text);
    else if (metinleriAl && blok.type === 'image') gorsel++;
  }
  const birlesik = metinler.join('\n');
  const h = !gorsel && birlesik ? harnesBildirimleri(birlesik) : null;
  if (h) { out.unshift(...h.map((x): CcOlay => ({ tur: 'sistem', seviye: 'bilgi', metin: x.metin, ...(x.ayrinti ? { ayrinti: x.ayrinti } : {}) }))); return out; }
  const t = istemTemizle(birlesik);
  if (t || gorsel) out.unshift({ tur: 'kullanici', id, metin: t, gorselSayisi: gorsel });
  return out;
}

function akisOlayi(b: CcNormalBaglam, ev: S, ust: string | null): CcOlay[] {
  const anahtar = ust ?? '';
  if (ev.type === 'message_start') {
    const m = nesne(ev.message) ? ev.message : {};
    const id = metinMi(m.id) ? m.id : `akis-${b.akis.size}-${Date.now()}`;
    b.akis.set(anahtar, { id, metinSayisi: 0, bloklar: new Map(), dusunmeVar: false });
    return [];
  }
  const a = b.akis.get(anahtar);
  if (!a) return [];
  const indeks = typeof ev.index === 'number' ? ev.index : -1;
  if (ev.type === 'content_block_start' && nesne(ev.content_block)) {
    const t = ev.content_block.type;
    if (t === 'text') { a.bloklar.set(indeks, { tur: 'text', blok: `${a.id}#${a.metinSayisi++}` }); return []; }
    if (t === 'thinking' || t === 'redacted_thinking') {
      const blok = `${a.id}#d${[...a.bloklar.values()].filter((x) => x.tur === 'thinking').length}`;
      a.bloklar.set(indeks, { tur: 'thinking', blok });
      a.dusunmeVar = true;
      b.dusunmeGorulen.add(a.id);
      return [{ tur: 'dusunme', blok, durum: 'basladi', ust }];
    }
    a.bloklar.set(indeks, { tur: String(t), blok: '' });
    return [];
  }
  if (ev.type === 'content_block_delta' && nesne(ev.delta)) {
    const k = a.bloklar.get(indeks);
    if (k?.tur === 'text' && ev.delta.type === 'text_delta' && metinMi(ev.delta.text) && ev.delta.text) return [{ tur: 'metin-parca', blok: k.blok, metin: ev.delta.text, ust }];
    return [];
  }
  if (ev.type === 'content_block_stop') {
    const k = a.bloklar.get(indeks);
    if (k?.tur === 'thinking') return [{ tur: 'dusunme', blok: k.blok, durum: 'bitti', ust }];
    return [];
  }
  if (ev.type === 'message_stop') b.akis.delete(anahtar);
  return [];
}

export interface NormalSecenek {
  /** Bu turda kullanıcı "Durdur" dedi: sonuç "kesildi" sayılır (Claude Code sürümüne göre alt tür değişebilir). */
  kesmeIstendi?: boolean;
}

/**
 * Tek bir SDK iletisini sade kayıtlara çevirir. Bilinmeyen tür/alan → []. `b` oturum başına bir kez `yeniBaglam()` ile kurulur.
 */
export function ccNormallestir(m: unknown, b: CcNormalBaglam, s: NormalSecenek = {}): CcOlay[] {
  if (!nesne(m) || !metinMi(m.type)) return [];
  const ust = metinMi(m.parent_tool_use_id) ? m.parent_tool_use_id : null;
  try {
    switch (m.type) {
      case 'system': return sistemIletisi(m, b);
      case 'stream_event': return nesne(m.event) ? akisOlayi(b, m.event, ust) : [];
      case 'assistant': {
        const msg = nesne(m.message) ? m.message : {};
        const id = metinMi(msg.id) ? msg.id : metinMi(m.uuid) ? m.uuid : `asistan-${b.asistanMetin.size}`;
        // 13 Kas: Claude Code hatayı sentetik bir asistan iletisi olarak da yazar ("Credit balance is too low", "API Error: 401 {json}"):
        // ham metin dökümde GÖRÜNMEZ, yerine tek cümle + eylem (cc-hata.ts) gelir.
        if (metinMi(m.error) && (m.error !== 'unknown' || msg.model === '<synthetic>')) {
          const a = ccHataAciklamasi(icerikMetni(msg.content), m.error);
          b.turHatasi = true;
          buda(b);
          return [{ tur: 'sistem', seviye: m.error === 'overloaded' || a.sinif === 'yogun' ? 'uyari' : 'hata', metin: a.metin }];
        }
        const out = asistanBloklari(b, id, msg.content, ust);
        buda(b);
        return out;
      }
      case 'user': {
        const msg = nesne(m.message) ? m.message : {};
        // Canlı akışta kullanıcı metnini Fuber kendisi yazar (gönderirken); yalnız yeniden oynatılan (isReplay) iletiler metin taşır.
        return kullaniciBloklari(b, msg.content, ust, m.isReplay === true && m.isSynthetic !== true, metinMi(m.uuid) ? m.uuid : '', m.tool_use_result);
      }
      case 'result': return [sonucIletisi(m, s, b)];
      case 'tool_progress': {
        // Canlı süre (bulgu 5): işin (görev ya da araç kimliğiyle) geçen süresi; tanınmayan araç sessizce atlanır.
        const i = isBul(b, m);
        if (!i || i.durum !== 'suruyor') return [];
        const sn = Math.floor(sayi(m.elapsed_time_seconds));
        if (sn === i.sureSn) return [];
        i.sureSn = sn;
        return [islerOlayi(b)];
      }
      default: return [];
    }
  } catch {
    return [];
  }
}

/** Arka plan görevi sayılır mı: ön planda (turu bekleten) ve ortam/izleyici (ambient, skip_transcript) görevler sayılmaz. */
const arkaPlanGorevi = (g: S) => metinMi(g.task_id) && g.task_id !== '' && g.ambient !== true && g.skip_transcript !== true;

function sistemIletisi(m: S, b: CcNormalBaglam): CcOlay[] {
  switch (m.subtype) {
    case 'init': {
      const dizi = (x: unknown) => (Array.isArray(x) ? x.filter(metinMi) : []);
      b.apiKaynak = metinMi(m.apiKeySource) ? m.apiKeySource : undefined;
      return [{
        tur: 'baslangic', kimlik: metinMi(m.session_id) ? m.session_id : '', model: metinMi(m.model) ? m.model : '', mod: metinMi(m.permissionMode) ? m.permissionMode : '',
        surum: metinMi(m.claude_code_version) ? m.claude_code_version : '', cwd: metinMi(m.cwd) ? m.cwd : '', araclar: dizi(m.tools), komutlar: dizi(m.slash_commands), yetenekler: dizi(m.capabilities),
        ...(b.apiKaynak !== undefined ? { apiKaynak: b.apiKaynak } : {}),
      }];
    }
    // Arka plan işi (0.13 T12): sdk.d.ts SDKTaskStartedMessage / SDKTaskNotificationMessage / SDKTaskUpdatedMessage / SDKBackgroundTasksChangedMessage.
    // Tur bitince "Bitti" yazıp arkada ajan çalıştırmak yanıltıcıydı; sayı tur sonucundan bağımsız izlenir.
    case 'task_started': {
      if (m.is_backgrounded === true && arkaPlanGorevi(m)) b.arkaPlan.add(m.task_id as string);
      const out = arkaPlanOlayi(b);
      if (!arkaPlanGorevi(m)) return out;
      const id = m.task_id as string;
      const aracId = metinMi(m.tool_use_id) ? m.tool_use_id : undefined;
      const eski = b.isler.get(id);
      const dosya = aracId ? b.aracCiktilari.get(aracId) : undefined;
      // Aynı işin ikinci bildirimi (değişen bir şey yoksa) yeniden yayınlanmaz.
      if (eski && eski.durum === 'suruyor' && eski.arkaPlanda === (m.is_backgrounded === true || eski.arkaPlanda) && (!aracId || eski.aracId === aracId)) return out;
      b.isler.set(id, {
        ...(eski ?? {}), id, aciklama: tekSatir(metinMi(m.description) && m.description.trim() ? m.description : metinMi(m.workflow_name) ? m.workflow_name : 'Görev', 200),
        tip: IS_TIPI(m.task_type), durum: 'suruyor', arkaPlanda: m.is_backgrounded === true || Boolean(dosya), baslangic: eski?.baslangic ?? Date.now(),
        ...(aracId ? { aracId } : {}), ...(dosya ? { ciktiDosyasi: dosya } : {}),
      });
      return [...out, islerOlayi(b)];
    }
    case 'task_progress': {
      const i = isBul(b, m);
      if (!i) return [];
      const u = nesne(m.usage) ? m.usage : {};
      if (sayi(u.duration_ms)) i.sureSn = Math.floor(sayi(u.duration_ms) / 1000);
      if (metinMi(m.last_tool_name)) i.sonArac = tekSatir(m.last_tool_name, 60);
      if (metinMi(m.summary) && m.summary.trim()) i.ozet = tekSatir(m.summary, 200);
      return [islerOlayi(b)];
    }
    case 'task_notification': {
      if (metinMi(m.task_id)) b.arkaPlan.delete(m.task_id);
      const out = arkaPlanOlayi(b);
      const i = isBul(b, m);
      if (!i) return out;
      i.durum = m.status === 'failed' ? 'basarisiz' : m.status === 'stopped' ? 'durduruldu' : 'bitti';
      i.bitis = Date.now();
      if (metinMi(m.output_file) && m.output_file.trim()) i.ciktiDosyasi = m.output_file.trim();
      if (metinMi(m.summary) && m.summary.trim()) i.ozet = tekSatir(m.summary, 200);
      const u = nesne(m.usage) ? m.usage : {};
      if (sayi(u.duration_ms)) i.sureSn = Math.floor(sayi(u.duration_ms) / 1000);
      return [...out, islerOlayi(b)];
    }
    case 'task_updated': {
      const yama = nesne(m.patch) ? m.patch : {};
      if (metinMi(m.task_id) && (yama.status === 'completed' || yama.status === 'failed' || yama.status === 'killed')) b.arkaPlan.delete(m.task_id);
      // Ön planda başlayan iş arka plana alındı (Ctrl+B karşılığı): artık arka plan sayısına girer.
      else if (metinMi(m.task_id) && yama.is_backgrounded === true && b.isler.has(m.task_id)) b.arkaPlan.add(m.task_id);
      const out = arkaPlanOlayi(b);
      const i = isBul(b, m);
      if (!i) return out;
      if (yama.is_backgrounded === true) i.arkaPlanda = true;
      if (metinMi(yama.description) && yama.description.trim()) i.aciklama = tekSatir(yama.description, 200);
      if (yama.status === 'completed' || yama.status === 'failed' || yama.status === 'killed') {
        i.durum = yama.status === 'failed' ? 'basarisiz' : yama.status === 'killed' ? 'durduruldu' : 'bitti';
        i.bitis = Date.now();
        if (metinMi(yama.error) && yama.error.trim()) i.ozet = tekSatir(yama.error, 200);
      }
      return [...out, islerOlayi(b)];
    }
    case 'background_tasks_changed': {
      // Seviye sinyali: kümeyi değiştirir (kaçan bir bitiş bildirimi sayıyı takılı bırakmaz).
      if (!Array.isArray(m.tasks)) return [];
      const liste = m.tasks.filter(nesne).filter(arkaPlanGorevi).slice(0, 200);
      b.arkaPlan = new Set(liste.map((g) => g.task_id as string));
      let degisti = false;
      for (const g of liste) {
        const i = b.isler.get(g.task_id as string);
        if (i) { if (!i.arkaPlanda) { i.arkaPlanda = true; degisti = true; } continue; }
        // task_started kaçtıysa (ya da sonra geldiyse) satır seviye sinyalinden kurulur; task_started gelince adı/aracı tamamlanır.
        b.isler.set(g.task_id as string, { id: g.task_id as string, aciklama: tekSatir(metinMi(g.description) && g.description.trim() ? g.description : 'Görev', 200), tip: IS_TIPI(g.task_type), durum: 'suruyor', arkaPlanda: true, baslangic: Date.now() });
        degisti = true;
      }
      return [...arkaPlanOlayi(b), ...(degisti ? [islerOlayi(b)] : [])];
    }
    case 'status': {
      const out: CcOlay[] = [];
      if (metinMi(m.permissionMode)) out.push({ tur: 'mod', mod: m.permissionMode });
      if (m.status === 'compacting') out.push({ tur: 'sistem', seviye: 'bilgi', metin: 'Bağlam sıkıştırılıyor…' });
      if (m.compact_result === 'failed') out.push({ tur: 'sistem', seviye: 'uyari', metin: `Bağlam sıkıştırılamadı${metinMi(m.compact_error) ? `: ${tekSatir(m.compact_error, 200)}` : ''}.` });
      return out;
    }
    case 'compact_boundary': return [{ tur: 'sistem', seviye: 'bilgi', metin: 'Bağlam sıkıştırıldı.' }];
    case 'api_retry': return [{ tur: 'sistem', seviye: 'uyari', metin: `Claude’a ulaşılamadı; yeniden deneniyor (${sayi(m.attempt)}/${sayi(m.max_retries)}).` }];
    case 'permission_denied': return [{ tur: 'sistem', seviye: 'uyari', metin: `${metinMi(m.tool_name) ? m.tool_name : 'Araç'} kendiliğinden reddedildi${metinMi(m.decision_reason) ? `: ${tekSatir(m.decision_reason, 200)}` : ''}.` }];
    case 'local_command_output': return metinMi(m.content) && m.content.trim() ? [{ tur: 'metin', blok: metinMi(m.uuid) ? m.uuid : `yerel-${Date.now()}`, metin: m.content, ust: null }] : [];
    case 'notification': return metinMi(m.text) && m.text.trim() ? [{ tur: 'sistem', seviye: m.priority === 'high' || m.priority === 'immediate' ? 'uyari' : 'bilgi', metin: tekSatir(m.text, 300) }] : [];
    default: return [];
  }
}

function sonucIletisi(m: S, s: NormalSecenek, b: CcNormalBaglam): CcSonuc {
  const u = nesne(m.usage) ? m.usage : {};
  const kesildi = Boolean(s.kesmeIstendi) || (metinMi(m.terminal_reason) && m.terminal_reason.startsWith('aborted'));
  const hataZatenGorundu = b.turHatasi === true;
  b.turHatasi = false;
  const hataMi = m.is_error === true || (metinMi(m.subtype) && m.subtype.startsWith('error'));
  const hatalar = Array.isArray(m.errors) ? m.errors.filter(metinMi).map((x) => x.trim()).filter(Boolean) : [];
  const hataMetni = hatalar.length ? hatalar.join('; ') : m.subtype === 'success' && metinMi(m.result) ? m.result : metinMi(m.subtype) ? m.subtype : '';
  return {
    tur: 'sonuc', basarili: !hataMi && !kesildi, kesildi, sureMs: sayi(m.duration_ms), turSayisi: sayi(m.num_turns), maliyetUsd: sayi(m.total_cost_usd), paraGoster: ccParaGosterilir(b.apiKaynak),
    belirtec: { girdi: sayi(u.input_tokens), cikti: sayi(u.output_tokens), onbellekOkuma: sayi(u.cache_read_input_tokens), onbellekYazma: sayi(u.cache_creation_input_tokens) },
    ...(hataMi && !kesildi && hataMetni ? { hata: kisalt(ccHataAciklamasi(hataMetni).metin, 1000), ...(hataZatenGorundu ? { hataGorundu: true } : {}) } : {}),
    ...(m.subtype === 'success' && metinMi(m.result) && m.result ? { metin: kisalt(m.result, 4000) } : {}),
  };
}

// ── İzin isteği (canUseTool) ────────────────────────────────────────────────────────────────────────────────────────────
export interface IzinSecenekleri {
  suggestions?: unknown[]; title?: string; displayName?: string; description?: string; decisionReason?: string;
  suppressAlwaysAllowRule?: boolean; defaultToNo?: boolean; agentID?: string; toolUseID?: string;
}
export function izinIstegiOlayi(istekId: string, arac: string, ham: unknown, o: IzinSecenekleri = {}): CcIzinIstegi {
  const { girdi, kisaltildi } = girdiKisalt(ham);
  const tip = aracTipi(arac);
  return {
    tur: 'izin-istegi', istekId, arac, tip, girdi, ozet: aracOzeti(arac, girdi),
    ...(metinMi(o.title) && o.title ? { baslik: tekSatir(o.title, 300) } : {}),
    ...(metinMi(o.displayName) && o.displayName ? { adi: tekSatir(o.displayName, 80) } : {}),
    ...(metinMi(o.description) && o.description ? { aciklama: tekSatir(o.description, 400) } : {}),
    ...(metinMi(o.decisionReason) && o.decisionReason ? { neden: tekSatir(o.decisionReason.replace(/\u001b\[[0-9;]*m/g, ''), 400) } : {}),
    ...(tip === 'soru' ? { sorular: sorulariOku(girdi) } : {}),
    herZamanSunulur: tip !== 'soru' && !o.suppressAlwaysAllowRule && Array.isArray(o.suggestions) && o.suggestions.length > 0,
    ...(o.defaultToNo ? { hayirdaAc: true } : {}),
    ...(metinMi(o.agentID) ? { ajan: o.agentID } : {}),
    ...(metinMi(o.toolUseID) ? { aracKimligi: o.toolUseID } : {}),
    ...(kisaltildi ? { kisaltildi } : {}),
  };
}

// ── Döküm (JSONL satırı) ────────────────────────────────────────────────────────────────────────────────────────────────
/** Claude Code'un JSONL dökümündeki bir satır (user/assistant/system) → kayıtlar. Meta, yan zincir ve özet satırları atlanır. */
export function dokumSatiriOlaylari(j: unknown, b: CcNormalBaglam): CcOlay[] {
  if (!nesne(j)) return [];
  if (j.isMeta || j.isSidechain || j.isVisibleInTranscriptOnly) return [];
  if (j.isCompactSummary) return [{ tur: 'sistem', seviye: 'bilgi', metin: 'Önceki konuşma özetlendi.' }];
  const msg = nesne(j.message) ? j.message : null;
  try {
    if (j.type === 'assistant' && msg) {
      // Geçmiş dökümde de ham API hatası ("Credit balance is too low", "API Error: 401 {…}") gösterilmez: tek cümle + eylem.
      if (j.isApiErrorMessage === true || (metinMi(j.error) && msg.model === '<synthetic>')) {
        const a = ccHataAciklamasi(icerikMetni(msg.content), j.error);
        return [{ tur: 'sistem', seviye: a.sinif === 'yogun' ? 'uyari' : 'hata', metin: a.metin }];
      }
      const id = metinMi(msg.id) ? msg.id : metinMi(j.uuid) ? j.uuid : `asistan-${b.asistanMetin.size}`;
      const out = asistanBloklari(b, id, msg.content, null);
      buda(b);
      return out;
    }
    if (j.type === 'user' && msg) return kullaniciBloklari(b, msg.content, null, true, metinMi(j.uuid) ? j.uuid : '', j.toolUseResult ?? j.tool_use_result);
    if (j.type === 'system' && j.subtype === 'compact_boundary') return [{ tur: 'sistem', seviye: 'bilgi', metin: 'Bağlam sıkıştırıldı.' }];
  } catch { /* bozuk satır */ }
  return [];
}

// ── Sohbete bitiş özeti ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Metnin ilk cümlesi (Markdown işaretleri ve kod blokları atılır; en çok 200 karakter). */
export function ilkCumle(metin: string): string {
  const duz = metin.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/[*_#>]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  if (!duz) return '';
  const m = /^(.+?[.!?…])(\s|$)/.exec(duz);
  return kisalt(m ? m[1] : duz, 200);
}

// ── Sohbetten oturuma bağlantı (Görev 28 düzeltme 1) ─────────────────────────────────────────────────────────────────────────
/** Sohbet özetinin sonundaki Markdown bağlantısı: "#cc-<id>" — arayüz (Ortak.tsx Markdown) bunu Claude Code sayfasına çevirir. */
/** Görev 28 düzeltme 2 (N3): `~<kimlik>` Claude Code oturum kimliğidir — uygulama yeniden açılınca uygulama içi oturum gitmişse aynı
 *  kimlikli geçmiş (JSONL) oturuma düşülür. */
const kimlikEki = (kimlik?: string | null) => (kimlik && /^[\w-]{1,80}$/.test(kimlik) ? `~${kimlik}` : '');
export const ccOturumBaglantisi = (oturum: string, kimlik?: string | null) => `[Oturumu aç](#cc-${oturum}${kimlikEki(kimlik)})`;
/** Bağlantının href'i → ana pencere yolu ('claude#cc-<id>[~<kimlik>]'); başka bağlantı → null. */
export function ccBaglantiYolu(href: string | null | undefined): string | null {
  const m = /^#cc-([\w-]{1,80})(~[\w-]{1,80})?$/.exec(href ?? '');
  return m ? `claude#cc-${m[1]}${m[2] ?? ''}` : null;
}
/** claude_code_gorev aracının sonuç kartındaki "Oturumu aç" hedefi. */
export const ccOturumYolu = (oturum: string, kimlik?: string | null) => `claude#cc-${oturum}${kimlikEki(kimlik)}`;
/**
 * Görev 28 düzeltme 3: sohbette saklanan claude_code_gorev kartının yolu başladığı an yalnız 'claude#cc-<id>' (Claude Code kimliği
 * henüz yok); ilk tur bitince kimlikle tamamlanır — uygulama yeniden açılınca kart da geçmiş oturuma düşebilsin. Değişen yoksa null.
 */
export function bloklardaYolGuncelle<B extends { tur: string; yol?: string }>(bloklar: readonly B[], oturum: string, kimlik: string): B[] | null {
  const eski = ccOturumYolu(oturum), yeni = ccOturumYolu(oturum, kimlik);
  if (eski === yeni) return null;
  let degisti = false;
  const sonuc = bloklar.map((b) => { if (b.tur !== 'arac_sonuc' || b.yol !== eski) return b; degisti = true; return { ...b, yol: yeni }; });
  return degisti ? sonuc : null;
}

/** 'cc-<id>[~<kimlik>]' çapası → { id, kimlik }. */
export function ccCipaCoz(cipa: string | null | undefined): { id: string; kimlik?: string } | null {
  const m = /^#?cc-([\w-]{1,80})(?:~([\w-]{1,80}))?$/.exec(cipa ?? '');
  return m ? { id: m[1], ...(m[2] ? { kimlik: m[2] } : {}) } : null;
}

// ── Telefonun "Komutu ver / Bilgisayarda sürdür" sonucu (Daha.tsx; düzeltme A: dürüst, kısa) ───────────────────────────────────
export const CC_MASADA_ACIK = 'Bu oturum bilgisayarda açık; komutu bilgisayardan ver.';
export const CC_KAPALI_OTURUM = 'Bu oturum kapandı ve sürdürülemiyor; yeni bir oturum başlat.';
/** `claudecode:ac` yanıtı → telefon ekranındaki metin. Komut iletilmediyse kutudaki metin KORUNUR (kutuyuTemizle: false). */
export function ccAcSonucu(r: { tamam: boolean; hata?: string; kod?: string; oturum?: { durum?: string; siraNo?: number } }, komutVar: boolean): { metin: string; hata: boolean; kutuyuTemizle: boolean } {
  if (r.tamam) {
    if (!komutVar) return { metin: 'Oturum bilgisayarında hazır; Claude Code sayfasından sürdürülebilir.', hata: false, kutuyuTemizle: false };
    const sira = r.oturum?.durum === 'sirada' && r.oturum.siraNo ? ` (sırada: ${r.oturum.siraNo}.)` : '';
    return { metin: `Claude Code bilgisayarında işe başladı${sira}. İzin isterse bilgisayarın başında onaylanır.`, hata: false, kutuyuTemizle: true };
  }
  if (r.kod === 'masada-acik') return { metin: CC_MASADA_ACIK, hata: true, kutuyuTemizle: false };
  if (r.kod === 'kapali-oturum') return { metin: CC_KAPALI_OTURUM, hata: true, kutuyuTemizle: false };
  if (r.kod === 'baska-yerde') return { metin: 'Bu oturum bilgisayarda başka bir yerde açık; oradan sürdür ya da bilgisayarda çatalla.', hata: true, kutuyuTemizle: false };
  if (r.kod === 'bilinmeyen-klasor') return { metin: 'Telefondan yalnız bilinen bir proje klasöründe oturum açılır.', hata: true, kutuyuTemizle: false };
  return { metin: r.hata ?? 'Açılamadı', hata: true, kutuyuTemizle: false };
}

type BitisGirdisi ={ proje: string; degisenDosya: number; sonMetin: string; sonuc?: Pick<CcSonuc, 'basarili' | 'kesildi' | 'hata'>; arkaPlan?: number };

/** Ada/tost bildirimi: başlık durumu ve projeyi, metin ayrıntıyı taşır (tekrar yok). */
export function ccBitisBildirimi(o: BitisGirdisi): { baslik: string; metin: string } {
  const dosya = o.degisenDosya ? `${o.degisenDosya} dosya değişti` : 'dosya değişmedi';
  const cumle = ilkCumle(o.sonMetin);
  if (o.sonuc?.kesildi) return { baslik: `Claude Code durduruldu · ${o.proje}`, metin: `${dosya}.` };
  if (o.sonuc && !o.sonuc.basarili) return { baslik: `Claude Code hata verdi · ${o.proje}`, metin: kisalt(o.sonuc.hata ?? 'bilinmeyen hata', 200) };
  // Arkada iş sürerken iş "bitti" değil, yalnız bu tur bitti (31 Eki).
  if (o.arkaPlan && o.arkaPlan > 0) return { baslik: `Claude Code turu bitirdi · ${o.proje}`, metin: `${dosya}.${cumle ? ` “${cumle}”` : ''} Arka planda ${o.arkaPlan} iş sürüyor.` };
  return { baslik: `Claude Code bitirdi · ${o.proje}`, metin: `${dosya}.${cumle ? ` “${cumle}”` : ''}` };
}

/** Sohbete yazılan tek satırlık özet (değişen dosya sayısı, son yanıtın ilk cümlesi). */
export function ccBitisOzeti(o: BitisGirdisi): string {
  const b = ccBitisBildirimi(o);
  return `${b.baslik}: ${b.metin}`;
}
