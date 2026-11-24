// ── Yapay zekâ sağlayıcısı seçimi (0.14; ürün kararı) ──────────────────────────────────────────────────────────
// 0.13 T15 ("kullanıcı API anahtarı yok") tersine döner: kullanıcı Anthropic (Claude) anahtarını kaydedip sağlayıcıyı "Fuber" (varsayılan,
// bugünkü davranış) ya da "Claude (Anthropic)" seçebilir. Claude yalnız İKİSİ birden doğruyken kullanılır: motorSecimi === 'anthropic' && anahtar kayıtlı.
// 5 Kas (Business kullanıcıları da kendi API anahtarını kullanabilir): kural artık iki modda aynı. Business'ta arayüz tek satırdır (anahtarı
// kaydet = kullan; Sil = Fuber'e dön), Developer'da sağlayıcı seçimi ve rol başına modeller de görünür.
// Gizli mod ve "Yalnız bu bilgisayar" buluta hiç gitmez: o kural motor/secici.ts'in yol denetiminde (tekMotorYolu) ve bu seçimden önce gelir.
// Saf modül: ana süreç (secici, ayar-kaydi, ipc) ve arayüz (Ayarlar → Yapay zekâ sağlayıcısı) aynı kuralı okur.
import type { Efor, ModelRolu } from './tipler.ts';
import { VARSAYILAN_MODEL } from './modeller.ts';

// Açık kaynak hazırlığı (11 Kas): üçüncü seçenek 'openai' — kullanıcının KENDİ OpenAI uyumlu sağlayıcısı (OpenAI, OpenRouter, ya da bu bilgisayardaki
// Ollama / LM Studio gibi bir sunucu): taban adresi + model ayarda (openaiUyumlu), anahtar sır deposunda ('api:openai'). Fuber hesabı gerekmez.
// Gizli / "Yalnız bu bilgisayar" yine buluta gitmez (yol denetimi seçimden önce; P14) — bu bilgisayardaki bir sunucu da Gizli'de kullanılmaz.
export type MotorSecimi = 'anthropic' | 'openai';
export const MOTOR_SECIMLERI: readonly MotorSecimi[] = ['anthropic', 'openai'];
/** Kendi OpenAI uyumlu sağlayıcının ayarı (sır YOK). `yardimciModel` boşsa arka plan işleri de `model`le. */
export interface OpenaiUyumluAyar { tabanUrl: string; model: string; yardimciModel?: string }
/** Hazır taban adresleri (arayüzün kısayolları; kullanıcı başka adres de yazabilir). */
export const OPENAI_UYUMLU_HAZIR: readonly { ad: string; tabanUrl: string }[] = [
  { ad: 'OpenAI', tabanUrl: 'https://api.openai.com/v1' },
  { ad: 'OpenRouter', tabanUrl: 'https://openrouter.ai/api/v1' },
  { ad: 'Ollama (bu bilgisayar)', tabanUrl: 'http://127.0.0.1:11434/v1' },
  { ad: 'LM Studio (bu bilgisayar)', tabanUrl: 'http://127.0.0.1:1234/v1' },
];
export interface ClaudeRolSecimi { model: string; efor?: Efor }

export const EFORLAR: readonly Efor[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const CLAUDE_VARSAYILAN_EFOR: Record<ModelRolu, Efor> = { ana: 'medium', yardimci: 'low' };
export const CLAUDE_MODELLER_VARSAYILAN: Record<ModelRolu, ClaudeRolSecimi> = {
  ana: { model: VARSAYILAN_MODEL.anthropic.ana, efor: CLAUDE_VARSAYILAN_EFOR.ana },
  yardimci: { model: VARSAYILAN_MODEL.anthropic.yardimci, efor: CLAUDE_VARSAYILAN_EFOR.yardimci },
};

/** Sağlayıcı seçimi girdisi (Ayarlar'ın ilgili alanları; arayüz ve ana süreç aynı nesneyi verir). */
export interface MotorSecimiGirdisi {
  mod: string;
  motorSecimi?: unknown;
  claudeAnahtariVar?: boolean;
  /** Açık kaynak hazırlığı: 'api:openai' kayıtlı mı (yalnız ana süreç hesaplar). */
  openaiAnahtariVar?: boolean;
  openaiUyumlu?: Partial<OpenaiUyumluAyar>;
}

/** Claude (Anthropic) şu an etkin mi: Claude seçili + anahtar kayıtlı (iki modda da; 5 Kas). */
export function claudeSecili(a: MotorSecimiGirdisi): boolean {
  return a.motorSecimi === 'anthropic' && a.claudeAnahtariVar === true;
}

/** Taban adresi bu bilgisayarın kendisi mi (anahtarsız yerel sunucu: Ollama, LM Studio). */
export function yerelTabanMi(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  try { const u = new URL(v.trim()); return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch { return false; }
}

/** OpenAI uyumlu taban adresi: https (bu bilgisayarda http de olur), kullanıcı adı/parola ve parça yok, en çok 300 karakter. */
export function openaiTabanGecerli(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 300) return false;
  let u: URL;
  try { u = new URL(v.trim()); } catch { return false; }
  if (u.username || u.password || u.hash) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && yerelTabanMi(v));
}

/** OpenAI uyumlu model adı (ör. gpt-5.5, openai/gpt-5.5, llama3.2:3b, qwen/qwen3-coder@preset). */
export function openaiModelGecerli(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/.test(v);
}

/** OpenAI uyumlu anahtarın biçimi (gevşek; sağlayıcıdan sağlayıcıya değişir): boşluksuz, 8-512 basılabilir ASCII. Anahtar hiçbir yere yazılmaz. */
export function openaiAnahtariGecerli(v: unknown): v is string {
  return typeof v === 'string' && /^[!-~]{8,512}$/.test(v);
}

/** Ayarın temiz kopyası: geçersizse undefined (kayıt düşer). */
export function openaiUyumluSuz(v: unknown): OpenaiUyumluAyar | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const taban = typeof o.tabanUrl === 'string' ? o.tabanUrl.trim().replace(/\/+$/, '') : '';
  if (!openaiTabanGecerli(taban) || !openaiModelGecerli(o.model)) return undefined;
  return { tabanUrl: taban, model: o.model, ...(openaiModelGecerli(o.yardimciModel) ? { yardimciModel: o.yardimciModel } : {}) };
}

/** Kendi OpenAI uyumlu sağlayıcın şu an etkin mi: seçili + geçerli ayar + (anahtar kayıtlı ya da taban bu bilgisayarda). */
export function openaiUyumluSecili(a: MotorSecimiGirdisi): boolean {
  if (a.motorSecimi !== 'openai') return false;
  const o = openaiUyumluSuz(a.openaiUyumlu);
  return Boolean(o) && (a.openaiAnahtariVar === true || yerelTabanMi(o!.tabanUrl));
}

/** Rolün OpenAI uyumlu modeli (yardımcı boşsa ana model). Ayar geçersizse undefined. */
export function openaiRolModeli(a: MotorSecimiGirdisi, rol: ModelRolu): string | undefined {
  const o = openaiUyumluSuz(a.openaiUyumlu);
  if (!o) return undefined;
  return rol === 'yardimci' ? o.yardimciModel ?? o.model : o.model;
}

/** Arayüzde görünen etkin sağlayıcı adı (Ayarlar özeti). */
export function etkinSaglayiciAdi(a: MotorSecimiGirdisi): string {
  if (claudeSecili(a)) return 'Claude (Anthropic)';
  if (openaiUyumluSecili(a)) return 'Kendi sağlayıcın (OpenAI uyumlu)';
  return 'Fuber';
}

/** Anthropic anahtarının biçimi (gevşek): kırpılmış, `sk-ant-` ile başlar, boşluk yok, makul uzunluk. Anahtarın kendisi hiçbir yere yazılmaz. */
export function claudeAnahtariGecerli(v: unknown): v is string {
  return typeof v === 'string' && /^sk-ant-[A-Za-z0-9_-]{16,256}$/.test(v);
}

/** Claude model kimliği (ör. claude-opus-5-5, claude-haiku-5-5-20261001). */
export function claudeModelGecerli(v: unknown): v is string {
  return typeof v === 'string' && /^claude-[a-z0-9][a-z0-9.-]{1,80}$/.test(v);
}

/** Rol seçiminin temiz kopyası (yalnız bilinen roller, geçerli model ve efor); geçersiz rol düşer. Hiç geçerli rol yoksa undefined. */
export function claudeModelleriSuz(v: unknown): Partial<Record<ModelRolu, ClaudeRolSecimi>> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const c: Partial<Record<ModelRolu, ClaudeRolSecimi>> = {};
  for (const rol of ['ana', 'yardimci'] as ModelRolu[]) {
    const r = (v as Record<string, unknown>)[rol] as { model?: unknown; efor?: unknown } | undefined;
    if (!r || typeof r !== 'object' || !claudeModelGecerli(r.model)) continue;
    c[rol] = { model: r.model, ...(EFORLAR.includes(r.efor as Efor) ? { efor: r.efor as Efor } : {}) };
  }
  return Object.keys(c).length ? c : undefined;
}

/** Rolün Claude seçimi (kayıt eksik/bozuksa varsayılan). */
export function claudeRolSecimi(a: { claudeModeller?: Partial<Record<ModelRolu, Partial<ClaudeRolSecimi>>> }, rol: ModelRolu): ClaudeRolSecimi {
  const r = a.claudeModeller?.[rol];
  return {
    model: claudeModelGecerli(r?.model) ? r.model : CLAUDE_MODELLER_VARSAYILAN[rol].model,
    efor: EFORLAR.includes(r?.efor as Efor) ? (r!.efor as Efor) : CLAUDE_VARSAYILAN_EFOR[rol],
  };
}
