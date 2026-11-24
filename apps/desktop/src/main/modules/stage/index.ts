// Sahibi: T2. Sahne modülü: kart ve kum havuzlu mini uygulama gösterme araçları.
import { defineModule, defineTool, type StageBlock, type StageCard } from '@fuber/shared';
import { z } from 'zod';
import { normalizeStageApp, STAGE_APP_LIMITS, validateStageApp } from '../../core/stage';

const cardInput = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  kind: z
    .enum(['list', 'table', 'text', 'key_value', 'progress'])
    .describe('list: maddeler · table: sütunlu veri · text: düz metin · key_value: etiket-değer · progress: adım adım ilerleme'),
  text: z.string().optional().describe('kind=text için metin; diğerlerinde isteğe bağlı açıklama'),
  items: z
    .array(z.object({ title: z.string(), detail: z.string().optional(), checked: z.boolean().optional() }))
    .optional()
    .describe('kind=list için maddeler'),
  columns: z.array(z.string()).optional().describe('kind=table için sütun başlıkları'),
  rows: z.array(z.array(z.string())).optional().describe('kind=table için satırlar'),
  pairs: z.array(z.object({ label: z.string(), value: z.string() })).optional().describe('kind=key_value için satırlar'),
  steps: z
    .array(z.object({ title: z.string(), done: z.boolean() }))
    .optional()
    .describe('kind=progress için adımlar'),
  ttl_seconds: z.number().int().min(5).max(3600).optional().describe('Bu kadar saniye sonra kendiliğinden kapansın'),
});

type CardInput = z.infer<typeof cardInput>;

function toCard(input: CardInput): StageCard | string {
  const body: StageBlock[] = [];
  switch (input.kind) {
    case 'text':
      if (!input.text?.trim()) return 'kind=text için text gerekli.';
      body.push({ type: 'text', text: input.text });
      break;
    case 'list':
      if (!input.items?.length) return 'kind=list için en az bir madde gerekli.';
      body.push({
        type: 'list',
        items: input.items.map((item) => ({
          title: item.title,
          ...(item.detail ? { detail: item.detail } : {}),
          ...(item.checked !== undefined ? { checked: item.checked } : {}),
        })),
      });
      break;
    case 'table': {
      if (!input.columns?.length || !input.rows?.length) return 'kind=table için columns ve rows gerekli.';
      const width = input.columns.length;
      body.push({ type: 'table', columns: input.columns, rows: input.rows.map((row) => row.slice(0, width)) });
      break;
    }
    case 'key_value':
      if (!input.pairs?.length) return 'kind=key_value için pairs gerekli.';
      body.push({ type: 'keyValue', rows: input.pairs });
      break;
    case 'progress': {
      if (!input.steps?.length) return 'kind=progress için steps gerekli.';
      // Sözleşmede ayrı ilerleme bloğu yok: tamamlanan adım işaretli liste ve yüzde satırıyla gösterilir.
      const done = input.steps.filter((step) => step.done).length;
      body.push({ type: 'keyValue', rows: [{ label: 'İlerleme', value: `%${Math.round((done / input.steps.length) * 100)}` }] });
      body.push({ type: 'list', items: input.steps.map((step) => ({ title: step.title, checked: step.done })) });
      break;
    }
  }
  if (input.kind !== 'text' && input.text?.trim()) body.unshift({ type: 'text', text: input.text });
  return {
    title: input.title,
    ...(input.subtitle ? { subtitle: input.subtitle } : {}),
    body,
    ...(input.ttl_seconds ? { ttlSeconds: input.ttl_seconds } : {}),
  };
}

export default defineModule({
  id: 'stage',
  version: '1.0.0',
  nameKey: 'module.stage.name',
  descriptionKey: 'module.stage.description',
  permissions: [],

  tools: [
    defineTool({
      name: 'stage_show_card',
      group: 'stage',
      description:
        'Ekranın sağındaki sahnede bir kart gösterir. Kullanıcı bir şeyi GÖRMEK istediğinde, üçten fazla kalem sayacaksan, ' +
        'tablo/liste/ilerleme gibi okunması sesle zor bilgide kullan; sesle yalnız tek cümlelik özet söyle.',
      input: cardInput,
      risk: 'read',
      async run(input, ctx) {
        const card = toCard(input);
        if (typeof card === 'string') return { ok: false, text: card };
        const item = ctx.stage.showCard('stage', card);
        return { ok: true, text: `Kart sahnede gösteriliyor: "${card.title}".`, data: { id: item.id } };
      },
    }),
    defineTool({
      name: 'stage_show_app',
      group: 'deep',
      description:
        'Sahnede küçük, etkileşimli bir mini uygulama açar: sayaç, geri sayım, hesap makinesi, basit oyun, grafik gibi. ' +
        'html, kendi kendine yeten tek bir HTML belgesidir: bütün CSS ve JavaScript satır içinde; dış adres, CDN, yazı tipi ' +
        'ya da ağ isteği YOK (kum havuzunda ağ kapalı, dış adres içeren belge reddedilir). Kum havuzunun diğer kısıtları: ' +
        'form gönderimi çalışmaz (düğmeye tıklama olayı kullan), eval ve new Function yasak, localStorage ve çerez yok ' +
        '(durumu değişkende tut), üst pencereye erişim yok. Koyu zemine uygun, sade ve ' +
        `okunaklı tasarla; ${STAGE_APP_LIMITS.maxHtmlBytes / 1000} KB'ı geçmesin. Kullanıcı sayaç, geri sayım, küçük hesaplayıcı gibi etkileşimli bir şey istediğinde kullan; yalnız bilgi göstermek için stage_show_card yeter.`,
      input: z.object({
        title: z.string().min(1),
        html: z.string().min(1),
        width: z.number().int().optional().describe(`CSS pikseli, ${STAGE_APP_LIMITS.width.min}–${STAGE_APP_LIMITS.width.max}`),
        height: z.number().int().optional().describe(`CSS pikseli, ${STAGE_APP_LIMITS.height.min}–${STAGE_APP_LIMITS.height.max}`),
      }),
      risk: 'read',
      async run({ title, html, width, height }, ctx) {
        const app = normalizeStageApp({ title, html, width: width ?? 0, height: height ?? 0 });
        const problem = validateStageApp(app);
        if (problem) return { ok: false, text: problem };
        const item = ctx.stage.showApp('stage', app);
        return { ok: true, text: `Mini uygulama sahnede açıldı: "${app.title}".`, data: { id: item.id } };
      },
    }),
    defineTool({
      name: 'stage_close',
      description: 'Sahnedeki bir kartı ya da mini uygulamayı kapatır; id verilmezse hepsini kapatır. "Kartı kapat", "ekranı temizle" denince kullan.',
      input: z.object({ id: z.string().optional() }),
      risk: 'read',
      async run({ id }, ctx) {
        ctx.stage.close(id);
        return { ok: true, text: id ? 'Sahnedeki öğe kapatıldı.' : 'Sahne temizlendi.' };
      },
    }),
  ],
});
