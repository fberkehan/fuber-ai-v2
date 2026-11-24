// ── Yerel motor: bu bilgisayardaki llama-server (OpenAI uyumlu /v1/chat/completions) ────────────────────────────────────────────
// Görev 21 (K10, shared/tek-motor.ts): yerel beyin artık yanıt yolunda "ön eleme" yapmaz ve arka plan işlerini bulutla paylaşmaz. Yalnız
// Gizli modda (bulutsuz), Geliştirici'nin "Yalnız bu bilgisayardaki yapay zekâ" tercihinde (0.11 G8) ya da hiç bulut motoru yokken TEK motordur — sohbet de, başlık/kokpit/eşlikçi/not/rapor da orada; hata verirse
// buluta düşülmez (bir konuşmada iki farklı beyin olmaz). Aksi hâlde hiçbir işte kullanılmaz: sunucusu açılmaz, ekran kartı boş kalır.
import { ayarlar } from '../ayarlar.js';
import { yerelKuruluMu } from '../yerel/kurulum.js';
import { yerelTaban, yerelSunucuDurumu } from '../yerel/sunucu.js';
import { katalogBul } from '../yerel/katalog.js';
import { yerelMesajlariSigdir, YEREL_SOHBET_YANIT_TOKEN } from '../../shared/yerel-butce.js';
import { MotorHatasi, type Istek, type Yanit } from './tipler.js';
import { motorYolu, yalnizYerelEtkin, yalnizYerelTercihi, type MotorYolu, type TekMotorGirdisi } from '../../shared/tek-motor.js';
import type { SaglayiciAdi } from '../../shared/tipler.js';
import { openaiUyumluSecili } from '../../shared/motor-secimi.js';

export const yerelHazirMi = () => process.env.FUBER_YEREL_TABAN ? true : ayarlar().yerel.etkin && yerelKuruluMu();
/** Kaydı silinmiş eski ayarda fırlatmaz: kimlik döner (yanıtın `model` alanı, "Dene"). */
export const yerelModelEtiketi = () => process.env.FUBER_YEREL_TABAN ? 'yerel-test' : katalogBul(ayarlar().yerel.model)?.ad ?? ayarlar().yerel.model;

/** Bulut motoru bağlı ve açık mı (secici.ts hazirMi ile aynı kural; döngüsel içe aktarma olmasın diye burada). 0.10 E3: masaüstü Fuber
 *  hesabı aktifken Fuber motoru hazırdır (hesabın anahtarı ayrı yuvada; saglayicilar.fuber geliştiricinindir). */
const bulutVar = () => {
  const s = ayarlar().saglayicilar;
  // Açık kaynak hazırlığı: kendi OpenAI uyumlu sağlayıcın (seçili + hazır) da bulut sayılır — Gizli / "Yalnız bu bilgisayar" yine önce gelir (motorYolu).
  return (['anthropic', 'openai', 'openrouter'] as SaglayiciAdi[]).some((k) => s[k].etkin && s[k].anahtarVar) || openaiUyumluSecili(ayarlar());
};

/** Yol kuralının girdisi — TEK yerde okunur (tekMotorYolu, motor sinyali ve ajan turu aynı veriden). 0.11 G8: "Yalnız bu bilgisayardaki yapay zekâ"
 *  tercihi ve kullanım biçimi kurala girer (Gizli kapalıyken, yalnız Geliştirici'de). */
export const motorYoluGirdisi = (): TekMotorGirdisi => {
  const a = ayarlar();
  return { yerelHazir: yerelHazirMi(), gizliMod: a.yerel.gizliMod === true, bulutVar: bulutVar(), yalnizYerel: a.yerel.yalnizYerel === true, mod: a.mod };
};

/** Bütün model çağrılarının yolu: 'yerel' (tek motor), 'bulut' ya da 'yok'. */
export const tekMotorYolu = (): MotorYolu => motorYolu(motorYoluGirdisi());

/** Yol BİLİNÇLİ "yalnız yerel" tercihiyle mi yerel (Gizli değil)? Paylaşılan kural: shared/tek-motor.ts yalnizYerelEtkin (kopya yok). */
export const yalnizYerelTurMu = (): boolean => yalnizYerelEtkin(motorYoluGirdisi());
/** H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" SEÇİLİ mi (yerel hazır olmasa da; Gizli değil) — yol hiçbir zaman bulut değildir;
 *  hata metinleri "giriş yap" demez, kendi cümlesini söyler (shared/abonelik.ts YALNIZ_YEREL_YOK). */
export const yalnizYerelSeciliMi = (): boolean => yalnizYerelTercihi(motorYoluGirdisi());

/** Yerel beyin tek motor mu (Gizli mod ya da bulutsuz kurulum)? */
export const yerelTekMotorMu = (): boolean => tekMotorYolu() === 'yerel';

/** Yerel sunucu şu an açık mı (soğuk açılış gerekmez)? Test sahte sunucusunda hep açık. */
export const yerelSicakMi = (): boolean => yerelSunucuDurumu().calisiyor;

/** @deprecated Görev 21: amaç artık önemsiz (hepsi aynı yolda). Eski çağıranlar için: yerel tek motorsa true. */
export const yereldeMi = (_amac?: string): boolean => yerelTekMotorMu();

/** Yerel sunucu isteği yuvanın bağlamına sığmadı (llama-server HTTP 400 "exceeds the available context size"). 0.12 cila düzeltme turu 1
 *  (I-1): çağıran YUTMAZ — içe aktarılan belge boş özetle "işlendi" olmaz, "özet sonra" kalır (iceaktar.ts); e-posta/WhatsApp öbekleri
 *  zaten bütçeyle bölünür (shared/yerel-butce.ts). */
export const YEREL_BAGLAM_ASIMI = 'Bu bilgisayardaki yapay zekânın bağlamına sığmadı.';
/** Hata, yerel sunucunun bağlam aşımı mı (YEREL_BAGLAM_ASIMI): çağıran girdiyi yarıya indirip bir kez yeniden dener (düzeltme turu 2). */
export const yerelBaglamAsimiMi = (e: unknown): boolean => e instanceof MotorHatasi && e.message === YEREL_BAGLAM_ASIMI;
/** Sunucunun ret gövdesi bağlam aşımı mı (llama-server: `exceed_context_size_error`, "exceeds the available context size"). */
export const baglamAsimiMi = (durum: number, govde: string): boolean => durum === 400 && /exceed[s_ ]|context (size|length|window)|n_ctx/i.test(govde);

export async function yerelSohbet(istek: Istek & { jsonCikti?: boolean; sicaklik?: number }): Promise<Yanit> {
  const taban = await yerelTaban();
  if (!taban) throw new MotorHatasi('Bu bilgisayardaki yapay zekâ açılamadı.', 'baglanti');
  const sistem = istek.sistemSabit + (istek.sistemYari ? `\n\n${istek.sistemYari}` : '');
  // 0.14.1: yanıt payı çağıran vermediyse (sohbet turu) 1.024; geçmiş yuvaya sığacak kadar en yeniden alınır (son ileti hep kalır, kırpılmaz).
  const cikis = Math.min(istek.maxToken ?? YEREL_SOHBET_YANIT_TOKEN, 4000);
  const iletiler = istek.mesajlar.map((m) => ({
    role: m.rol as string,
    content: m.bloklar.map((b) => (b.tur === 'metin' ? b.metin : b.tur === 'arac_sonuc' ? b.icerik : '')).filter(Boolean).join('\n'),
  }));
  const mesajlar = [{ role: 'system', content: sistem }, ...yerelMesajlariSigdir(sistem, iletiler, cikis)];
  const r = await fetch(`${taban}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Durdur (sohbetin sinyali) da, 90 sn tavanı da isteği keser (eskiden sinyal verilince tavan düşüyordu).
    signal: istek.sinyal ? AbortSignal.any([istek.sinyal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
    body: JSON.stringify({
      messages: mesajlar,
      max_tokens: cikis,
      temperature: istek.sicaklik ?? (istek.jsonCikti ? 0.2 : 0.7),
      top_p: 0.9, top_k: 20,
      chat_template_kwargs: { enable_thinking: false },
      ...(istek.jsonCikti ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!r.ok) {
    const govde = await r.text();
    if (baglamAsimiMi(r.status, govde)) throw new MotorHatasi(YEREL_BAGLAM_ASIMI, 'istek');
    console.warn(`[yerel] HTTP ${r.status} ${govde.slice(0, 160)}`); // ayrıntı günlükte, sohbette tek cümle
    throw new MotorHatasi('Bu bilgisayardaki yapay zekâ yanıt veremedi. Yeniden dene.', 'istek', false, r.status);
  }
  const j = (await r.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
  // Bazı kalıplar <think></think> bırakabilir: temizle.
  const metin = (j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const model = yerelModelEtiketi();
  if (!metin) throw new MotorHatasi('Bu bilgisayardaki yapay zekâ boş yanıt verdi.', 'istek', true);
  istek.akis?.({ tur: 'metin', parca: metin });
  return {
    bloklar: [{ tur: 'metin', metin }],
    ham: { saglayici: 'yerel', model, icerik: null },
    durma: j.choices?.[0]?.finish_reason === 'length' ? 'limit' : 'bitti',
    kullanim: { giris: j.usage?.prompt_tokens ?? 0, cikis: j.usage?.completion_tokens ?? 0, onbellekOkuma: 0, onbellekYazma: 0 },
    model,
  };
}
