// `pc_do`: birkaç adımı TEK araç çağrısında sırayla yapar.
//
// Neden: her fare/klavye adımı ayrı bir model turuydu (adım başına birkaç saniye) ve model sonucu görmek için araya
// `screen_look` koyuyordu (4–7 sn). "WhatsApp'ta Ahmet'e mesaj at" beş altı tur + iki üç bakış = bir dakikaya yakın
// sürüyor, sesli tur bekçisi de turu kesiyordu. Burada adımlar art arda koşar; "öğe görünene dek bekle" adımı sabit
// beklemelerin ve ara bakışların yerini alır; sonunda ekranın özeti döner.
//
// Güvenlik değişmez: HER adım kendi aracının kapısından geçer (`ctx.tools.run`): izin, yetki düzeyi, onay kartı, kayıt
// ve "kullanıcı fareyi aldı → dur" kuralları tek tek uygulanır. İlk hatada durulur; o ana kadar yapılanlar, hatanın
// somut nedeni ve pencerede o an görünenler döner. Sonraki adımlar YAPILMAZ.
import { defineTool, t, type ToolContext, type ToolDef, type ToolResult } from '@fuber/shared';
import { z } from 'zod';
import { clip } from './read';

const ROLES = ['Button', 'MenuItem', 'TabItem', 'Edit', 'CheckBox', 'RadioButton', 'ComboBox', 'Hyperlink', 'ListItem', 'TreeItem', 'DataItem', 'Text'] as const;
const role = z.enum(ROLES).optional().describe('Öğenin türü: Edit (yazı alanı), Button, ListItem/DataItem (liste satırı), TabItem…');
const windowParam = z.string().optional().describe('Bu adımın penceresi; boşsa pc_do’nun window değeri, o da boşsa öndeki pencere');

const STEP = z.discriminatedUnion('do', [
  z.object({ do: z.literal('open'), app: z.string().min(1).describe('Açılacak uygulamanın adı; penceresi görünene dek beklenir') }),
  z.object({ do: z.literal('focus'), window: z.string().min(1).describe('Öne getirilecek pencere: başlık ya da uygulama adı') }),
  z.object({
    do: z.literal('click'),
    name: z.string().optional().describe('Öğenin görünen adı (bir kısmı yeter)'),
    role,
    window: windowParam,
    button: z.enum(['left', 'right', 'middle']).optional(),
    double: z.boolean().optional(),
  }),
  z.object({
    do: z.literal('type'),
    text: z.string().min(1).max(20_000),
    into: z.string().optional().describe('Yazılacak alanın adı ("ara", "mesaj"); verilirse alan önce bulunup tıklanır. Boşsa imlecin olduğu alan'),
    role,
    enter: z.boolean().optional().describe('Yazdıktan sonra Enter (ileti gönderen/komut çalıştıran pencerede onay ister)'),
    window: windowParam,
  }),
  z.object({ do: z.literal('keys'), keys: z.string().min(1).max(80).describe('Kısayol: "enter", "ctrl+f", "tab"'), repeat: z.number().int().min(1).max(20).optional(), window: windowParam }),
  z.object({
    do: z.literal('wait'),
    name: z.string().optional().describe('Görünmesi beklenen öğenin adı'),
    role,
    gone: z.boolean().optional().describe('true: öğenin KAYBOLMASI beklenir'),
    seconds: z.number().min(0.2).max(20).optional().describe('En çok bekleme (varsayılan 5). name ve role yoksa bu kadar beklenir (en çok 5)'),
    window: windowParam,
  }),
  z.object({ do: z.literal('scroll'), direction: z.enum(['down', 'up', 'left', 'right']), pages: z.number().min(0.2).max(10).optional(), window: windowParam }),
  z.object({ do: z.literal('read'), window: windowParam, max_chars: z.number().int().min(300).max(12_000).optional() }),
]);

export type DoStep = z.infer<typeof STEP>;

export const MAX_STEPS = 12;

export interface DoEnv {
  sleep(ms: number): Promise<void>;
  /** Toplu eylem sürerken tek tek araçlar sonuçlarına ekran özeti EKLEMEZ (özet sonda bir kez alınır). */
  batch: { depth: number };
  /** Adım başladı: adaya ve ekran katmanına "3/5 · …" olarak yansır. `null`: toplu eylem bitti. */
  onStep?(progress: { index: number; total: number; text: string } | null): void;
  /** Bir pencerenin (ya da öndeki pencerenin) özeti: sonuçta ve hata iletisinde kullanılır. */
  observe(window?: string): Promise<string>;
  /** `wait` adımı (öğe görünene/kaybolana dek). */
  waitFor(request: { name?: string; role?: string; window?: string; gone?: boolean; timeoutMs?: number }, ctx: ToolContext): Promise<ToolResult>;
}

/** Adımın adada/katmanda görünen kısa metni (pencere içeriği taşımaz; yazılan metnin yalnız uzunluğu). */
export function stepLabel(step: DoStep): string {
  switch (step.do) {
    case 'open':
      return t('pc.do.step.open', { app: clip(step.app, 40) });
    case 'focus':
      return t('pc.do.step.focus', { window: clip(step.window, 40) });
    case 'click':
      return t('pc.do.step.click', { name: clip(step.name?.trim() || step.role || '', 40) });
    case 'type':
      return step.into?.trim() ? t('pc.do.step.typeInto', { count: step.text.length, field: clip(step.into, 30) }) : t('pc.do.step.type', { count: step.text.length });
    case 'keys':
      return t('pc.do.step.keys', { keys: clip(step.keys, 30) });
    case 'wait':
      return step.name?.trim() || step.role ? t(step.gone ? 'pc.do.step.waitGone' : 'pc.do.step.wait', { name: clip(step.name?.trim() || step.role || '', 40) }) : t('pc.do.step.pause');
    case 'scroll':
      return t('pc.do.step.scroll');
    case 'read':
      return t('pc.do.step.read');
  }
}

const seconds = (ms: number): string => (ms / 1000).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function doTool(env: DoEnv): ToolDef {
  return defineTool({
    name: 'pc_do',
    // Yerel (küçük) modele sunulmaz: iç içe adım şeması onun araç çağrısını bozar; yerel model adımları tek tek atar.
    group: 'deep',
    description:
      'Bilgisayarda birkaç adımı TEK çağrıda sırayla yapar: open (uygulamayı aç) → focus → click → type → keys → wait (öğe görünene dek) → scroll → read. ' +
      'Çok adımlı işte tek tek pc_click/pc_type yerine BUNU kullan: çok daha hızlıdır. İlk hatada durur; yapılanları, nedeni ve pencerede görünen alan/düğme adlarını ' +
      'döndürür (ayrıca screen_look gerekmez). Yöntem ("X’te Y’ye mesaj at / Y’yi ara / aç"): open ya da focus → type into:"ara" (kişi adı) → wait name:kişi → ' +
      'click name:kişi → wait role:"Edit" → type into:"mesaj". GÖNDERME (enter ya da Gönder düğmesi) ayrı ve onaylıdır; kullanıcı metni açıkça söylemediyse önce ' +
      'ne göndereceğini söyle. Öğe adını bilmiyorsan önce yalnız open/focus çalıştır: sonuç penceredeki adları listeler.',
    input: z.object({
      steps: z.array(STEP).min(1).max(MAX_STEPS).describe('Sırayla yapılacak adımlar (en çok 12)'),
      window: z.string().optional().describe('Adımların ortak penceresi (başlık ya da uygulama adı); open/focus adımı bunu kendisi belirler'),
    }),
    risk: 'write',
    async run(input, ctx) {
      const total = input.steps.length;
      const lines: string[] = [];
      let current = input.window?.trim() || undefined;
      const started = Date.now();
      let failure: { index: number; text: string } | null = null;
      let lastRead = '';
      let stopped = false;
      const sub = (name: string, args: Record<string, unknown>) => ctx.tools.run(name, args, { origin: ctx.origin, signal: ctx.signal });

      env.batch.depth += 1;
      try {
        for (let index = 0; index < total; index++) {
          const step = input.steps[index]!;
          const label = stepLabel(step);
          ctx.report(`${index + 1}/${total} · ${label}`);
          env.onStep?.({ index: index + 1, total, text: label });
          if (ctx.signal.aborted) {
            failure = { index, text: t('pc.fail.aborted') };
            break;
          }
          const stepStarted = Date.now();
          const target = 'window' in step && step.window?.trim() ? step.window.trim() : current;
          const withWindow = target ? { window: target } : {};
          let result: ToolResult;
          switch (step.do) {
            case 'open':
              result = await sub('app_open', { name: step.app });
              // Açılan pencere sonraki adımların hedefidir (kimliğiyle: aynı uygulamanın başka penceresine kayılmasın).
              if (result.ok) current = typeof (result.data as { windowId?: unknown } | undefined)?.windowId === 'number' ? String((result.data as { windowId: number }).windowId) : step.app;
              break;
            case 'focus':
              result = await sub('pc_focus_window', { window: step.window });
              if (result.ok) current = step.window;
              break;
            case 'click':
              result = await sub('pc_click', {
                ...(step.name?.trim() ? { name: step.name.trim() } : {}),
                ...(step.role ? { role: step.role } : {}),
                ...(step.button ? { button: step.button } : {}),
                ...(step.double ? { double: true } : {}),
                ...withWindow,
              });
              break;
            case 'type':
              result = await sub('pc_type', {
                text: step.text,
                ...(step.into?.trim() ? { into: step.into.trim() } : {}),
                ...(step.role ? { role: step.role } : {}),
                ...(step.enter ? { enter: true } : {}),
                ...withWindow,
              });
              break;
            case 'keys':
              result = await sub('pc_keys', { keys: step.keys, ...(step.repeat ? { repeat: step.repeat } : {}), ...withWindow });
              break;
            case 'wait':
              if (!step.name?.trim() && !step.role) {
                await env.sleep(Math.round(Math.min(5, step.seconds ?? 1) * 1000));
                result = { ok: true, text: t('pc.do.paused') };
              } else {
                result = await env.waitFor(
                  {
                    ...(step.name?.trim() ? { name: step.name.trim() } : {}),
                    ...(step.role ? { role: step.role } : {}),
                    ...(step.gone ? { gone: true } : {}),
                    ...(step.seconds ? { timeoutMs: Math.round(step.seconds * 1000) } : {}),
                    ...withWindow,
                  },
                  ctx,
                );
              }
              break;
            case 'scroll':
              result = await sub('pc_scroll', { direction: step.direction, ...(step.pages ? { pages: step.pages } : {}), ...withWindow });
              break;
            case 'read':
              result = await sub('pc_read_window', { ...(step.max_chars ? { max_chars: step.max_chars } : {}), ...withWindow });
              if (result.ok) lastRead = result.text;
              break;
          }
          const took = seconds(Date.now() - stepStarted);
          if (!result.ok) {
            const reason = (result.data as { reason?: string } | undefined)?.reason;
            stopped = reason === 'user_interrupt' || reason === 'panic' || reason === 'aborted';
            failure = { index, text: result.text };
            lines.push(t('pc.do.line.fail', { index: index + 1, label, seconds: took }));
            break;
          }
          // `read` adımının metni sonda ayrıca verilir; satırda yalnız yapıldığı yazar.
          lines.push(t('pc.do.line.ok', { index: index + 1, label, seconds: took, detail: step.do === 'read' ? '' : ` ${clip(result.text.split('\n')[0] ?? '', 160)}` }));
        }
      } finally {
        env.batch.depth -= 1;
        env.onStep?.(null);
      }

      const totalSeconds = seconds(Date.now() - started);
      // Kullanıcı devraldıysa ekrana yeniden bakılmaz (o an kullanıcı çalışıyor); model "DURDUM" kuralına uyar.
      const scene = stopped ? '' : await env.observe(current);
      const body = lines.join('\n');
      if (failure) {
        const remaining = total - failure.index - 1;
        const text =
          `${t('pc.do.failed', { done: failure.index, total, seconds: totalSeconds })}\n${body}\n${t('pc.do.reason', { index: failure.index + 1 })} ${failure.text}` +
          (remaining > 0 ? `\n${t('pc.do.skipped', { count: remaining })}` : '') +
          (lastRead ? `\n${lastRead}` : '') +
          scene;
        const failedDo = input.steps[failure.index]?.do ?? '?';
        return {
          ok: false,
          text,
          data: { done: failure.index, total, failedStep: failure.index + 1, untrusted: true, logReason: `${failure.index + 1}/${total}. adım (${failedDo}): ${failure.text}` },
        };
      }
      return { ok: true, text: `${t('pc.do.done', { total, seconds: totalSeconds })}\n${body}${lastRead ? `\n${lastRead}` : ''}${scene}`, data: { done: total, total, untrusted: true } };
    },
  });
}
