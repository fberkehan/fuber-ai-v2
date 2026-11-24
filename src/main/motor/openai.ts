// ── OpenAI ve OpenRouter (resmi OpenAI SDK, Chat Completions) ───────────────────────────────────────────────
// OpenRouter OpenAI uyumlu uç verir; aynı istemci farklı taban URL ile. Araç sonucu Chat Completions'ta görsel
// taşıyamaz: ekran görüntüleri araç sonuçlarının hemen ardından ayrı bir kullanıcı mesajı olarak eklenir.
// Model seçicinin listesi (modelBilgileri): OpenRouter'ın /models kayıtları SDK'dan olduğu gibi gelir (context_length, pricing,
// architecture, supported_parameters — SDK tipinde yok ama yanıtta durur) → openRouterDonustur; OpenAI yalnız kimlik verir.
import OpenAI from 'openai';
import type { Saglayici, Istek, Yanit, Blok, Mesaj, Durma } from './tipler.js';
import { MotorHatasi } from './tipler.js';
import type { Mod, SaglayiciAdi } from '../../shared/tipler.js';
import { openRouterDonustur, openaiDonustur } from '../../shared/model-bilgisi.js';
import { motorHataMetni } from '../../shared/motor-hata-metni.js';
import { anahtarYokMetni } from '../../shared/abonelik.js';
import { DAGITIM } from '../../shared/dagitim.js';

type CMesaj = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function cevirMesajlar(sistem: string, mesajlar: Mesaj[]): CMesaj[] {
  const out: CMesaj[] = [{ role: 'system', content: sistem }];
  for (const m of mesajlar) {
    if (m.rol === 'assistant') {
      const metin = m.bloklar.filter((b) => b.tur === 'metin').map((b) => (b as { metin: string }).metin).join('');
      const cagrilar = m.bloklar.filter((b): b is Extract<Blok, { tur: 'arac_cagri' }> => b.tur === 'arac_cagri');
      out.push({
        role: 'assistant',
        content: metin || null,
        tool_calls: cagrilar.length
          ? cagrilar.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.ad, arguments: JSON.stringify(c.girdi) } }))
          : undefined,
      });
      continue;
    }
    const sonuclar = m.bloklar.filter((b): b is Extract<Blok, { tur: 'arac_sonuc' }> => b.tur === 'arac_sonuc');
    const gorselEk: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    for (const s of sonuclar) {
      out.push({ role: 'tool', tool_call_id: s.id, content: (s.hata ? 'HATA: ' : '') + (s.icerik || '(boş)') });
      for (const g of (s.gorseller ?? []).filter((x) => x.veri)) gorselEk.push({ type: 'image_url', image_url: { url: `data:${g.medya};base64,${g.veri}` } });
    }
    const parcalar: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
    for (const b of m.bloklar) {
      if (b.tur === 'metin' && b.metin) parcalar.push({ type: 'text', text: b.metin });
      else if (b.tur === 'gorsel') parcalar.push({ type: 'image_url', image_url: { url: `data:${b.medya};base64,${b.veri}` } });
    }
    if (gorselEk.length) parcalar.unshift({ type: 'text', text: 'Araç sonuçlarındaki görseller:' }, ...gorselEk);
    if (parcalar.length) out.push({ role: 'user', content: parcalar });
  }
  return out;
}

/** `mod`: kullanım biçimi (anahtar yok iletisi moda göre: İş'te anahtar dili yok, Geliştirici'de bugünkü Ayarlar yolu). */
export function openaiSaglayici(ad: Extract<SaglayiciAdi, 'openai' | 'openrouter'>, anahtar: () => string | undefined, taban: () => string, mod: () => Mod = () => 'gelistirici'): Saglayici {
  let istemci: OpenAI | null = null;
  let imza = '';
  const al = () => {
    const k = anahtar();
    if (!k) throw new MotorHatasi(anahtarYokMetni(ad === 'openai' ? 'OpenAI' : 'OpenRouter', mod()), 'anahtar');
    const t = taban();
    if (!istemci || imza !== k + t) {
      istemci = new OpenAI({
        apiKey: k,
        baseURL: t,
        // F1 düzeltme turu 1 (K-3): SDK'nın iç yeniden denemesi KAPALI — yeniden denemeyi yalnız motor/secici.ts yapar, yolu yeniden
        // denetleyerek (beklerken Gizli mod açıldıysa ikinci istek buluta gitmez).
        maxRetries: 0,
        defaultHeaders: ad === 'openrouter' ? { 'X-Title': DAGITIM.urunAdi } : undefined,
      });
      imza = k + t;
    }
    return istemci;
  };

  return {
    ad,
    async modeller() {
      const c = al();
      const out: string[] = [];
      for await (const m of c.models.list()) out.push(m.id);
      return out.sort();
    },
    async modelBilgileri() {
      const c = al();
      const ham: unknown[] = [];
      for await (const m of c.models.list()) ham.push(m);
      return ad === 'openrouter' ? openRouterDonustur(ham) : openaiDonustur(ham);
    },
    async sohbet(istek: Istek): Promise<Yanit> {
      const c = al();
      const sistem = istek.sistemSabit + (istek.sistemYari ? `\n\n${istek.sistemYari}` : '');
      const akilYurutme = /^(o\d|gpt-5)/.test(istek.model.replace(/^openai\//, ''));
      try {
        const akis = await c.chat.completions.create(
          {
            model: istek.model,
            messages: cevirMesajlar(sistem, istek.mesajlar),
            tools: istek.araclar.length
              ? istek.araclar.map((a) => ({ type: 'function' as const, function: { name: a.ad, description: a.aciklama, parameters: a.sema } }))
              : undefined,
            stream: true,
            stream_options: { include_usage: true },
            ...(akilYurutme
              ? { max_completion_tokens: istek.maxToken ?? 32000, reasoning_effort: (istek.efor === 'max' || istek.efor === 'xhigh' ? 'high' : istek.efor ?? 'medium') as 'low' | 'medium' | 'high' }
              : { max_tokens: istek.maxToken ?? 8000 }),
          },
          { signal: istek.sinyal },
        );
        let metin = '';
        const cagrilar = new Map<number, { id: string; ad: string; arg: string }>();
        let bitis = '';
        let kullanim = { giris: 0, cikis: 0, onbellekOkuma: 0, onbellekYazma: 0 };
        let model = istek.model;
        for await (const p of akis) {
          model = p.model || model;
          if (p.usage) {
            kullanim = {
              giris: p.usage.prompt_tokens,
              cikis: p.usage.completion_tokens,
              onbellekOkuma: p.usage.prompt_tokens_details?.cached_tokens ?? 0,
              onbellekYazma: 0,
            };
          }
          const s = p.choices?.[0];
          if (!s) continue;
          if (s.delta?.content) { metin += s.delta.content; istek.akis?.({ tur: 'metin', parca: s.delta.content }); }
          for (const tc of s.delta?.tool_calls ?? []) {
            const k = cagrilar.get(tc.index) ?? { id: '', ad: '', arg: '' };
            if (tc.id) k.id = tc.id;
            if (tc.function?.name) { k.ad += tc.function.name; istek.akis?.({ tur: 'arac_hazirlaniyor', ad: k.ad, id: k.id }); }
            if (tc.function?.arguments) k.arg += tc.function.arguments;
            cagrilar.set(tc.index, k);
          }
          if (s.finish_reason) bitis = s.finish_reason;
        }
        // SDK'nın akışı kesilince (Durdur) hata vermeden biter: yarım yanıt tamamlanmış gibi kaydediliyor, "Durduruldu" hiç
        // görünmüyordu (Görev 19 denetimi). Claude yoluyla aynı davranış: kesme hatası (ajan döngüsü "Durduruldu." yazar).
        if (istek.sinyal?.aborted) throw Object.assign(new Error('Durduruldu.'), { name: 'AbortError' });
        const bloklar: Blok[] = [];
        if (metin) bloklar.push({ tur: 'metin', metin });
        for (const [, k] of [...cagrilar.entries()].sort((a, b) => a[0] - b[0])) {
          let girdi: Record<string, unknown> = {};
          try { girdi = k.arg ? JSON.parse(k.arg) : {}; } catch { girdi = { __gecersiz_json: k.arg }; }
          bloklar.push({ tur: 'arac_cagri', id: k.id || `cagri_${Math.random().toString(36).slice(2, 10)}`, ad: k.ad, girdi });
        }
        const durma: Durma = cagrilar.size ? 'arac' : bitis === 'length' ? 'limit' : bitis === 'content_filter' ? 'ret' : 'bitti';
        return { bloklar, ham: { saglayici: ad, model, icerik: null }, durma, kullanim, model };
      } catch (e) {
        throw cevir(e, ad);
      }
    },
  };
}

function cevir(e: unknown, ad: string): Error {
  const etiket = ad === 'openai' ? 'OpenAI' : 'OpenRouter';
  // Kesme önce: APIUserAbortError bir APIError'dır; genel dala düşüp "hata undefined" notu olmasın.
  if (e instanceof OpenAI.APIUserAbortError || (e instanceof Error && e.name === 'AbortError')) return e as Error;
  if (e instanceof OpenAI.AuthenticationError) return new MotorHatasi(`${etiket} bağlantısı reddedildi.`, 'anahtar');
  if (e instanceof OpenAI.RateLimitError) return new MotorHatasi(`${etiket} hız/kota sınırı.`, 'limit', true);
  if (e instanceof OpenAI.BadRequestError) return new MotorHatasi(motorHataMetni(etiket, e.message), 'istek');
  if (e instanceof OpenAI.APIConnectionError) return new MotorHatasi(`${etiket} sunucusuna bağlanılamadı.`, 'baglanti', true);
  if (e instanceof OpenAI.APIError) return new MotorHatasi(motorHataMetni(etiket, e.message), 'bilinmiyor', (e.status ?? 0) >= 500, e.status);
  return e instanceof Error ? e : new Error(String(e));
}
