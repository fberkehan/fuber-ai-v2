// ── Claude (resmi Anthropic SDK) ─────────────────────────────────────────────────────────────────────────────
// Varsayılan ana model claude-opus-5-5 (efor varsayılanı medium; düşünme kapatılamaz), yardımcı claude-haiku-5-5.
// Akış + araçlar (eager_input_streaming) + uyarlamalı düşünme (özet gösterimi) + istem önbelleği (sistemin iki
// kırılımı) + sunucu tarafı geri düşme (fallbacks: "default"; ret halinde aynı çağrıda yedek model). Zorunlu
// tool_choice YOK (Opus 5.5/Sonnet 5.5'te 400). Araç girdisi akış sırasında kesik gelebilir: max_tokens/refusal
// durumunda araç çalıştırılmaz, girdi şemaya göre agent döngüsünde doğrulanır.
import Anthropic from '@anthropic-ai/sdk';
import type { Saglayici, Istek, Yanit, Blok, Mesaj, Durma } from './tipler.js';
import { MotorHatasi } from './tipler.js';
import { anthropicDonustur } from '../../shared/model-bilgisi.js';
import { anahtarYokMetni } from '../../shared/abonelik.js';
import { motorHataMetni } from '../../shared/motor-hata-metni.js';
import type { Mod } from '../../shared/tipler.js';
import { anthropicTabani, paketliSurecMi } from '../../shared/ortam-kapisi.js';

type BetaParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaBlokParam = Anthropic.Beta.Messages.BetaContentBlockParam;

function kullaniciIcerigi(bloklar: Blok[]): BetaBlokParam[] {
  const out: BetaBlokParam[] = [];
  for (const b of bloklar) {
    if (b.tur === 'metin' && b.metin) out.push({ type: 'text', text: b.metin });
    else if (b.tur === 'gorsel') out.push({ type: 'image', source: { type: 'base64', media_type: b.medya as 'image/png', data: b.veri } });
    else if (b.tur === 'arac_sonuc') {
      const icerik: Anthropic.Beta.Messages.BetaToolResultBlockParam['content'] = [{ type: 'text', text: b.icerik || '(boş)' }];
      for (const g of (b.gorseller ?? []).filter((x) => x.veri)) icerik.push({ type: 'image', source: { type: 'base64', media_type: g.medya as 'image/png', data: g.veri } });
      out.push({ type: 'tool_result', tool_use_id: b.id, content: icerik, is_error: b.hata || undefined });
    }
  }
  return out.length ? out : [{ type: 'text', text: '…' }];
}

function asistanIcerigi(m: Mesaj, model: string): BetaBlokParam[] {
  // Sürmekte olan turda aynı modelin kendi içeriği (düşünme blokları dahil) AYNEN geri gider.
  if (m.ham && m.ham.saglayici === 'anthropic' && m.ham.model === model) return m.ham.icerik as BetaBlokParam[];
  const out: BetaBlokParam[] = [];
  for (const b of m.bloklar) {
    if (b.tur === 'metin' && b.metin) out.push({ type: 'text', text: b.metin });
    else if (b.tur === 'arac_cagri') out.push({ type: 'tool_use', id: b.id, name: b.ad, input: b.girdi });
  }
  return out.length ? out : [{ type: 'text', text: '…' }];
}

export function anthropicMesajlari(mesajlar: Mesaj[], model: string): BetaParam[] {
  return mesajlar.map((m) => (m.rol === 'user' ? { role: 'user', content: kullaniciIcerigi(m.bloklar) } : { role: 'assistant', content: asistanIcerigi(m, model) }));
}

/** `mod`: kullanım biçimi (anahtar yok iletisi moda göre: İş'te anahtar dili yok, Geliştirici'de bugünkü Ayarlar yolu). */
export function anthropicSaglayici(anahtar: () => string | undefined, mod: () => Mod = () => 'gelistirici'): Saglayici {
  let istemci: Anthropic | null = null;
  let sonAnahtar = '';
  const al = () => {
    const k = anahtar();
    if (!k) throw new MotorHatasi(anahtarYokMetni('Claude', mod()), 'anahtar');
    // F1 düzeltme turu 1 (K-3): SDK'nın iç yeniden denemesi KAPALI — yeniden denemeyi yalnız motor/secici.ts yapar ve her denemeden önce
    // yolu yeniden denetler (beklerken Gizli mod açıldıysa ikinci istek buluta gitmez). SDK kendi içinde denerse bu denetim atlanırdı.
    // 0.12 H6 (Ruling P12): kurulu uygulamada adres AÇIKÇA verilir — ANTHROPIC_BASE_URL yalnız loopback ise (testlerin sahte sunucusu), değilse
    // api.anthropic.com; anahtar ve konuşma ortamdaki başka bir adrese gitmez. Paketsizde undefined: SDK ortamı kendisi okur. process.env'e
    // dokunulmaz (Claude Code kullanıcının ayarını olduğu gibi alır). Karar: shared/ortam-kapisi.ts anthropicTabani.
    if (!istemci || k !== sonAnahtar) { istemci = new Anthropic({ apiKey: k, maxRetries: 0, baseURL: anthropicTabani(process.env, paketliSurecMi()) }); sonAnahtar = k; }
    return istemci;
  };
  let geriDusmeKapali = false; // hesap bu betayı kabul etmezse bir kez kapatılır

  return {
    ad: 'anthropic',
    async modeller() {
      const c = al();
      const out: string[] = [];
      for await (const m of c.models.list()) out.push(m.id);
      return out;
    },
    /** Models API: ad, bağlam (max_input_tokens) ve yetenekler canlı; fiyat yerleşik tablodan (shared/model-bilgisi.ts). */
    async modelBilgileri() {
      const c = al();
      const ham: unknown[] = [];
      for await (const m of c.models.list()) ham.push(m);
      return anthropicDonustur(ham);
    },
    async sohbet(istek: Istek): Promise<Yanit> {
      const c = al();
      const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: 'text', text: istek.sistemSabit, cache_control: { type: 'ephemeral' } }];
      if (istek.sistemYari) system.push({ type: 'text', text: istek.sistemYari, cache_control: { type: 'ephemeral' } });
      const tools: Anthropic.Beta.Messages.BetaToolUnion[] = istek.araclar.map((a) => ({
        name: a.ad,
        description: a.aciklama,
        input_schema: a.sema as Anthropic.Beta.Messages.BetaTool.InputSchema,
        eager_input_streaming: true,
      }));
      if (istek.webArama) tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 } as Anthropic.Beta.Messages.BetaToolUnion);

      const temel = {
        model: istek.model,
        max_tokens: istek.maxToken ?? (istek.arkaPlan ? 8000 : 32000),
        system,
        messages: anthropicMesajlari(istek.mesajlar, istek.model),
        tools: tools.length ? tools : undefined,
        thinking: istek.model.includes('haiku-4') ? undefined : ({ type: 'adaptive', display: istek.arkaPlan ? 'omitted' : 'summarized' } as const),
        output_config: istek.efor ? { effort: istek.efor } : undefined,
      };
      const geriDusme = !geriDusmeKapali && /opus-5|sonnet-5-5|fable-5/.test(istek.model);

      const calistir = async (gd: boolean) => {
        const params = gd
          ? ({ ...temel, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as Anthropic.Beta.Messages.MessageCreateParamsStreaming)
          : (temel as Anthropic.Beta.Messages.MessageCreateParamsStreaming);
        const akis = c.beta.messages.stream(params, { signal: istek.sinyal });
        akis.on('streamEvent', (e) => {
          if (!istek.akis) return;
          if (e.type === 'content_block_delta') {
            if (e.delta.type === 'text_delta') istek.akis({ tur: 'metin', parca: e.delta.text });
            else if (e.delta.type === 'thinking_delta') istek.akis({ tur: 'dusunce', parca: e.delta.thinking });
          } else if (e.type === 'content_block_start' && e.content_block.type === 'tool_use') {
            istek.akis({ tur: 'arac_hazirlaniyor', ad: e.content_block.name, id: e.content_block.id });
          }
        });
        return akis.finalMessage();
      };

      let mesaj: Anthropic.Beta.Messages.BetaMessage;
      try {
        try {
          mesaj = await calistir(geriDusme);
        } catch (e) {
          // Hesap geri düşme betasını tanımıyorsa (400) bir kez betasız dene ve bir daha deneme.
          if (geriDusme && e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) {
            geriDusmeKapali = true;
            mesaj = await calistir(false);
          } else throw e;
        }
      } catch (e) {
        throw cevir(e);
      }

      const bloklar: Blok[] = [];
      let dusunce = '';
      for (const b of mesaj.content) {
        if (b.type === 'text') bloklar.push({ tur: 'metin', metin: b.text });
        else if (b.type === 'tool_use') bloklar.push({ tur: 'arac_cagri', id: b.id, ad: b.name, girdi: (b.input ?? {}) as Record<string, unknown> });
        else if (b.type === 'thinking') dusunce += b.thinking;
      }
      const sr = mesaj.stop_reason;
      const durma: Durma = sr === 'tool_use' ? 'arac' : sr === 'max_tokens' ? 'limit' : sr === 'refusal' ? 'ret' : sr === 'pause_turn' ? 'duraklat' : 'bitti';
      return {
        bloklar,
        ham: { saglayici: 'anthropic', model: istek.model, icerik: mesaj.content },
        durma,
        model: mesaj.model,
        dusunce: dusunce || undefined,
        kullanim: {
          giris: mesaj.usage.input_tokens,
          cikis: mesaj.usage.output_tokens,
          onbellekOkuma: mesaj.usage.cache_read_input_tokens ?? 0,
          onbellekYazma: mesaj.usage.cache_creation_input_tokens ?? 0,
        },
      };
    },
  };
}

function cevir(e: unknown): Error {
  // Kesme önce: APIUserAbortError bir APIError'dır; aşağıdaki genel dal onu "Claude hatası undefined" yapıyordu.
  if (e instanceof Anthropic.APIUserAbortError || (e instanceof Error && e.name === 'AbortError')) return e as Error;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new MotorHatasi('Claude bağlantısı reddedildi.', 'anahtar');
  if (e instanceof Anthropic.RateLimitError) return new MotorHatasi('Claude hız sınırına takıldı; birazdan tekrar deneyeceğim.', 'limit', true);
  if (e instanceof Anthropic.BadRequestError) return new MotorHatasi(motorHataMetni('Claude', e.message), 'istek');
  if (e instanceof Anthropic.APIConnectionError) return new MotorHatasi('Claude sunucusuna bağlanılamadı (internet?).', 'baglanti', true);
  if (e instanceof Anthropic.APIError) return new MotorHatasi(motorHataMetni('Claude', e.message), (e.status ?? 0) >= 500 ? 'baglanti' : 'bilinmiyor', (e.status ?? 0) >= 500, e.status);
  return e instanceof Error ? e : new Error(String(e));
}
