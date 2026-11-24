// Kokpit araçları: yapay zekâ panoya kalıcı kart koyar, günceller, kaldırır, düzeni değiştirir, öneri bırakır.
// v1 karşılıkları: `kokpit_kart` → dashboard_card_add/update/remove · `kokpit_duzen` → dashboard_layout ·
// `oneri_ekle` → suggestion_add. Şemalar düzdür (isteğe bağlı alanlar): küçük model iç içe birleşimde bozuluyor.
//
// Model panoyu GÖRMEZ. Bu yüzden: (1) `dashboard_state` panoyu insan diliyle anlatır (kart, kimlik, boyut, yer);
// (2) kartlar adıyla bulunur ("hava", "hava durumu", "kur", "haberler"; Türkçe harf farkı gözetilmez);
// (3) taşıma ızgara koordinatı istemez (`dashboard_card_move`: top, bottom, left, right, before:<kart>, after:<kart>);
// (4) her değişiklik sonucu yeni sırayı kısa bir cümleyle geri söyler; (5) bilinmeyen ad, panodaki kartları sayar.
import {
  DASHBOARD_SIZES,
  DASHBOARD_TEMPLATES,
  dashboardGridMode,
  defineTool,
  packDashboard,
  t,
  type DashboardCustomContent,
  type DashboardSize,
  type DashboardTemplate,
  type ToolDef,
} from '@fuber/shared';
import { z } from 'zod';
import { DEFAULT_CUSTOM_SIZE, foldTitle, type DashboardEngine, type KnownCard } from './engine';
import type { DashboardNetwork } from './network';
import { MAX_CUSTOM_CARDS, type DashboardStore } from './store';

const SIZE_TR: Record<DashboardSize, string> = { small: 'küçük', medium: 'orta', wide: 'geniş', large: 'büyük' };

const size = z.enum(DASHBOARD_SIZES).describe('small: sayı ya da tek satır · medium: kısa liste · wide: geniş liste · large: uzun içerik');

/** Küçükten büyüğe (kapladığı alan). "Büyüt" / "küçült" bu sırada bir kademe oynar. */
const SIZE_ORDER: readonly DashboardSize[] = ['small', 'medium', 'wide', 'large'];

/** Açıklamalarda sayılan yerleşik kart adları (model hangi sözle arayacağını bilsin). */
const CARD_NAMES = 'hava (hava durumu), döviz (kur), haberler, sırada (hatırlatıcılar), yapılacaklar, süren işler, öneriler, claude code (oturumlar), bildirimler, kullanım';
const CARD_REF = `Kartın adı ya da kimliği. Yerleşik kartlar: ${CARD_NAMES}. Eklenmiş kartlar başlığıyla bulunur ("Lansmana kalan").`;

export type MovePosition = { kind: 'top' | 'bottom' | 'left' | 'right' } | { kind: 'before' | 'after'; card: string };

/**
 * Taşıma hedefini çözer: `top` / `bottom` / `left` / `right` / `before:<kart>` / `after:<kart>`. Modelin (ve Türkçe
 * konuşan kullanıcının) söyleyebileceği yakın biçimler de kabul edilir: "up", "en üst", "sol", "yanina:hava".
 */
export function parseMovePosition(raw: string): MovePosition | null {
  const cut = raw.search(/[:=]/);
  if (cut !== -1) {
    const head = foldTitle(raw.slice(0, cut));
    const card = raw.slice(cut + 1).trim();
    if (!card) return null;
    if (/^(before|once|onune|oncesine)$/.test(head)) return { kind: 'before', card };
    if (/^(after|sonra|sonrasina|ardina|arkasina|yanina|altina|next to|near|beside)$/.test(head)) return { kind: 'after', card };
    return null;
  }
  const text = foldTitle(raw);
  if (/^(top|up|start|first|en ust|ust|uste|en uste|yukari|bas|basa|en basa)$/.test(text)) return { kind: 'top' };
  if (/^(bottom|down|end|last|en alt|alt|alta|en alta|asagi|son|sona|en sona)$/.test(text)) return { kind: 'bottom' };
  if (/^(left|sol|sola|prev|previous|earlier|bir one|one)$/.test(text)) return { kind: 'left' };
  if (/^(right|sag|saga|next|later|bir sona|bir sonraya)$/.test(text)) return { kind: 'right' };
  return null;
}

const contentShape = {
  text: z.string().max(600).optional().describe('template=text için metin (en çok birkaç cümle)'),
  pairs: z
    .array(z.object({ label: z.string().min(1).max(40), value: z.string().min(1).max(80) }))
    .max(8)
    .optional()
    .describe('template=keyvalue için etiket-değer satırları'),
  items: z
    .array(z.object({ text: z.string().min(1).max(120), detail: z.string().max(120).optional(), done: z.boolean().optional() }))
    .max(10)
    .optional()
    .describe('template=list için maddeler'),
  value: z.string().max(24).optional().describe('template=metric için büyük yazılacak değer: "34,52", "12", "%68"'),
  unit: z.string().max(16).optional().describe('template=metric için birim: "TL", "gün", "kişi"'),
  label: z.string().max(80).optional().describe('metric, progress ve link için kısa açıklama satırı'),
  delta: z.string().max(24).optional().describe('template=metric için değişim: "+%2,1", "-3"'),
  trend: z.enum(['up', 'down', 'flat']).optional().describe('template=metric için değişimin yönü'),
  percent: z.number().min(0).max(100).optional().describe('template=progress için ilerleme, 0–100'),
  url: z.string().max(500).optional().describe('template=link için http(s) adresi'),
  description: z.string().max(160).optional().describe('template=link için bir cümle açıklama'),
};
type ContentInput = { [K in keyof typeof contentShape]?: z.infer<(typeof contentShape)[K]> };

/** Düz girdiden şablonun içeriğini kurar; eksik alan varsa modele ne gerektiğini söyleyen metin döner. */
export function buildContent(template: DashboardTemplate, input: ContentInput): DashboardCustomContent | string {
  switch (template) {
    case 'text':
      return input.text?.trim() ? { template, text: input.text.trim() } : 'template=text için text gerekli.';
    case 'keyvalue':
      return input.pairs?.length ? { template, pairs: input.pairs } : 'template=keyvalue için en az bir pairs satırı gerekli.';
    case 'list':
      return input.items?.length
        ? { template, items: input.items.map((item) => ({ text: item.text, ...(item.detail ? { detail: item.detail } : {}), ...(item.done !== undefined ? { done: item.done } : {}) })) }
        : 'template=list için en az bir items maddesi gerekli.';
    case 'metric':
      return input.value?.trim()
        ? {
            template,
            value: input.value.trim(),
            ...(input.unit ? { unit: input.unit } : {}),
            ...(input.label ? { label: input.label } : {}),
            ...(input.delta ? { delta: input.delta } : {}),
            ...(input.trend ? { trend: input.trend } : {}),
          }
        : 'template=metric için value gerekli.';
    case 'progress':
      return input.percent !== undefined
        ? { template, value: input.percent / 100, ...(input.label ? { label: input.label } : {}), ...(input.description ? { detail: input.description } : {}) }
        : 'template=progress için percent (0–100) gerekli.';
    case 'link': {
      const url = input.url?.trim() ?? '';
      if (!/^https?:\/\/[^\s]+$/i.test(url)) return 'template=link için http ya da https ile başlayan url gerekli.';
      return { template, url, ...(input.label ? { label: input.label } : {}), ...(input.description ? { description: input.description } : {}) };
    }
  }
}

/** Kayıtlı içeriği araç girdisi biçimine çevirir: kısmi güncellemede verilmeyen alanlar eski değerini korur. */
function contentInput(content: DashboardCustomContent): ContentInput {
  switch (content.template) {
    case 'text':
      return { text: content.text };
    case 'keyvalue':
      return { pairs: content.pairs };
    case 'list':
      return { items: content.items };
    case 'metric':
      return {
        value: content.value,
        ...(content.unit ? { unit: content.unit } : {}),
        ...(content.label ? { label: content.label } : {}),
        ...(content.delta ? { delta: content.delta } : {}),
        ...(content.trend ? { trend: content.trend } : {}),
      };
    case 'progress':
      return { percent: Math.round(content.value * 100), ...(content.label ? { label: content.label } : {}), ...(content.detail ? { description: content.detail } : {}) };
    case 'link':
      return { url: content.url, ...(content.label ? { label: content.label } : {}), ...(content.description ? { description: content.description } : {}) };
  }
}

export interface ToolDeps {
  /** Modül yüklendikten sonra geçerlidir (araçlar `setup`tan önce kaydedilir). */
  store: () => DashboardStore;
  engine: () => DashboardEngine;
  network: () => DashboardNetwork;
}

export function dashboardTools({ store, engine, network }: ToolDeps): ToolDef[] {
  /** Kartın konuşmadaki adı: hava kartının başlığı şehir adıdır, o yüzden "Hava (İstanbul)". */
  const nameOf = (card: Pick<KnownCard, 'title' | 'baseTitle'>): string => (foldTitle(card.baseTitle) !== foldTitle(card.title) ? `${card.baseTitle} (${card.title})` : card.title);
  const others = () =>
    engine()
      .known()
      .filter((card) => !card.band);
  /** O an çizilen kartlar, sırayla (bant hariç). */
  const shownCards = (): KnownCard[] => {
    const byId = new Map(others().map((card) => [card.id, card]));
    return engine()
      .snapshot()
      .cards.filter((card) => !card.band)
      .map((card) => byId.get(card.id))
      .filter((card): card is KnownCard => card !== undefined);
  };
  /** Her değişiklikten sonra modele geri söylenen kısa durum: "Sıra: hava, sırada, döviz, haberler." */
  const orderText = (): string => {
    const shown = shownCards();
    return t('dashboard.tool.order', { list: shown.map(nameOf).join(', ') || t('dashboard.tool.none') });
  };
  const withOrder = (text: string): string => `${text} ${orderText()}`;
  const notFound = (reference: string) => ({
    ok: false as const,
    text: t('dashboard.tool.notFound', {
      card: reference,
      list:
        others()
          .map((card) => `${nameOf(card)}${card.hidden ? ` (${t('dashboard.tool.hiddenMark')})` : ''}`)
          .join(', ') || t('dashboard.tool.none'),
    }),
  });
  /**
   * Panoyu insan diliyle anlatır. Yer, olağan pencere genişliğindeki (12 sütun) yerleşimden okunur: pencere daralıp
   * genişledikçe sütunlar değişir ama sıra ve "üstte / altta" ilişkisi aynı kalır.
   */
  const describeState = () => {
    const shown = shownCards();
    const mode = dashboardGridMode(1280);
    const places = new Map(
      packDashboard(
        shown.map((card) => ({ id: card.id, size: card.size, band: false })),
        mode,
      ).map((place) => [place.id, place]),
    );
    const rows = [...new Set([...places.values()].map((place) => place.row))].sort((a, b) => a - b);
    const where = (id: string): string => {
      const place = places.get(id);
      if (!place) return '';
      const rank = rows.indexOf(place.row) + 1;
      const center = (place.col - 1 + place.span / 2) / mode.columns;
      const side = place.span >= mode.columns ? t('dashboard.tool.where.full') : center < 0.34 ? t('dashboard.tool.where.left') : center > 0.66 ? t('dashboard.tool.where.right') : t('dashboard.tool.where.middle');
      const row = rank === 1 ? t('dashboard.tool.where.top') : rank === rows.length ? t('dashboard.tool.where.bottom') : t('dashboard.tool.where.row', { row: rank });
      return `${row} ${side}`;
    };
    const lines = shown.map((card, index) => `${index + 1}. ${nameOf(card)} (kimlik: ${card.id}, ${SIZE_TR[card.size]}, ${where(card.id)})`);
    const hidden = others().filter((card) => card.hidden);
    const empty = others().filter((card) => !card.hidden && !card.visible);
    const text = [
      shown.length ? t('dashboard.tool.state', { count: shown.length, list: lines.join('; ') }) : t('dashboard.tool.stateEmpty'),
      hidden.length ? t('dashboard.tool.stateHidden', { list: hidden.map(nameOf).join(', ') }) : '',
      empty.length ? t('dashboard.tool.stateNoData', { list: empty.map(nameOf).join(', ') }) : '',
    ]
      .filter(Boolean)
      .join(' ');
    return {
      text,
      data: {
        shown: shown.map((card, index) => ({ id: card.id, title: nameOf(card), size: card.size, order: index + 1, where: where(card.id) })),
        hidden: hidden.map((card) => ({ id: card.id, title: nameOf(card) })),
        noData: empty.map((card) => ({ id: card.id, title: nameOf(card) })),
      },
    };
  };

  return [
    defineTool({
      name: 'dashboard_state',
      group: 'dashboard',
      description:
        'Ana ekrandaki (Bugün sayfası, Kokpit) panonun ŞU ANKİ durumunu okur: hangi kartlar var, sıraları, boyutları ve yerleri ("en üst sıra solda"). ' +
        'Panoyu göremezsin; kullanıcı "panoda ne var", "ana ekranda hangi kartlar var", "hava kartı nerede" derse ya da bir kartı taşımadan önce emin değilsen bunu kullan. ' +
        'Hiçbir şeyi değiştirmez. Örnek: "ana ekranda neler var?" → dashboard_state.',
      input: z.object({}),
      risk: 'read',
      async run() {
        const state = describeState();
        return { ok: true, text: state.text, data: state.data };
      },
    }),

    defineTool({
      name: 'dashboard_card_move',
      group: 'dashboard',
      // Pano sözünde (araç sunulduğunda) model panoyu görsün: kartlar ve sıraları bağlama eklenir.
      contextHint: () => {
        const shown = shownCards();
        if (shown.length === 0) return null;
        return t('dashboard.tool.hint', { list: shown.map((card, index) => `${index + 1}. ${nameOf(card)} (${SIZE_TR[card.size]})`).join(', ') });
      },
      description:
        'Ana ekrandaki (Bugün sayfası, Kokpit) bir kartı TAŞIR ya da BÜYÜTÜR / KÜÇÜLTÜR. Kullanıcı "hava durumunu yukarı al", "dövizi en üste koy", ' +
        '"haberleri aşağı al", "havayı dövizin yanına koy", "yapılacakları büyüt", "hava kartını küçült", "şunu başka yere koy" derse kullan. ' +
        'Kartı ADIYLA ver; ızgara koordinatı gerekmez. Örnekler: "hava durumunu yukarı al" → card="hava", position="top" · ' +
        '"dövizi haberlerin yanına koy" → card="döviz", position="after:haberler" · "yapılacakları büyüt" → card="yapılacaklar", size="bigger" · ' +
        '"hava durumunu ana ekranda başka bir yere koy" (yer söylenmedi) → card="hava", position="top". Sonuç yeni sırayı söyler; kullanıcıya onu kısaca aktar.',
      input: z.object({
        card: z.string().min(1).describe(CARD_REF),
        position: z
          .string()
          .min(2)
          .max(80)
          .optional()
          .describe(
            'Kartın yeni yeri. top: en üste / en başa ("yukarı al", "en üste koy") · bottom: en alta / en sona ("aşağı al") · left: bir öne, sola · right: bir sona, sağa · ' +
              'before:<kart>: adı verilen kartın önüne · after:<kart>: adı verilen kartın yanına / ardına ("after:haberler"). Yalnız boyut değişecekse verme.',
          ),
        size: z
          .enum([...DASHBOARD_SIZES, 'bigger', 'smaller'])
          .optional()
          .describe('bigger: bir kademe büyüt ("büyüt") · smaller: bir kademe küçült ("küçült") · ya da doğrudan small (küçük), medium (orta), wide (geniş), large (büyük)'),
      }),
      risk: 'write',
      async run(input) {
        const target = engine().find(input.card);
        if (!target) return notFound(input.card);
        if (target.band) return { ok: false, text: t('dashboard.tool.bandFixed') };
        if (!input.position && !input.size) return { ok: false, text: t('dashboard.tool.needMove') };
        const title = nameOf(target);
        const parts: string[] = [];
        // Kaldırılmış kart taşınmak isteniyorsa önce geri gelir.
        if (target.hidden) {
          engine().restore(target.id, 'ai');
          parts.push(t('dashboard.tool.restored', { title }));
        }
        if (input.position) {
          const position = parseMovePosition(input.position);
          if (!position) return { ok: false, text: t('dashboard.tool.badPosition', { position: input.position }) };
          const ids = shownCards().map((card) => card.id);
          const rest = ids.filter((id) => id !== target.id);
          const from = ids.indexOf(target.id) === -1 ? rest.length : ids.indexOf(target.id);
          if (position.kind === 'before' || position.kind === 'after') {
            const anchor = engine().find(position.card);
            if (!anchor) return notFound(position.card);
            if (anchor.id === target.id || anchor.band) return { ok: false, text: t('dashboard.tool.badAnchor', { title: nameOf(anchor) }) };
            const index = rest.indexOf(anchor.id);
            if (index === -1) return { ok: false, text: t('dashboard.tool.anchorNotShown', { title: nameOf(anchor) }) };
            engine().move(target.id, position.kind === 'before' ? index : index + 1, 'ai');
            parts.push(t(`dashboard.tool.moved.${position.kind}`, { title, other: nameOf(anchor) }));
          } else {
            const at = position.kind === 'top' ? 0 : position.kind === 'bottom' ? rest.length : position.kind === 'left' ? Math.max(0, from - 1) : Math.min(rest.length, from + 1);
            engine().move(target.id, at, 'ai');
            parts.push(t(`dashboard.tool.moved.${position.kind}`, { title }));
          }
        }
        if (input.size) {
          const index = SIZE_ORDER.indexOf(target.size);
          const next = input.size === 'bigger' ? SIZE_ORDER[Math.min(SIZE_ORDER.length - 1, index + 1)]! : input.size === 'smaller' ? SIZE_ORDER[Math.max(0, index - 1)]! : input.size;
          if (next === target.size) parts.push(t(input.size === 'smaller' ? 'dashboard.tool.sizeMin' : input.size === 'bigger' ? 'dashboard.tool.sizeMax' : 'dashboard.tool.sizeSame', { title, size: SIZE_TR[next] }));
          else {
            engine().resize(target.id, next, 'ai');
            parts.push(t('dashboard.tool.resized', { title, size: SIZE_TR[next] }));
          }
        }
        if (!target.visible && !target.hidden) parts.push(t('dashboard.tool.notDrawn', { title }));
        return { ok: true, text: withOrder(parts.join(' ')), data: { id: target.id, order: shownCards().map((card) => card.id) } };
      },
    }),

    defineTool({
      name: 'dashboard_card_add',
      group: 'dashboard',
      description:
        'Ana ekrandaki (Bugün sayfası, Kokpit) panoya KALICI bir kart ekler. Kullanıcı bir bilgiyi ana ekranda sürekli görmek isterse kullan ' +
        '("panoya ekle", "ana ekrana koy", "ana sayfada dursun", "bunu takip et"). Bir kez göstermek için stage_show_card kullan. ' +
        'Hava, döviz, haber, hatırlatıcı ve yapılacak kartları zaten yerleşiktir; onları yeniden ekleme (kaldırılmışsa dashboard_layout action=restore). ' +
        'Örnek: "panoya lansmana 11 gün kaldığını yaz" → title="Lansmana kalan", template="metric", value="11", unit="gün".',
      input: z.object({
        title: z.string().min(1).max(60).describe('Kartın kısa başlığı: "Dolar hedefi", "Lansmana kalan"'),
        template: z
          .enum(DASHBOARD_TEMPLATES)
          .describe('text: kısa not · keyvalue: etiket-değer satırları · list: maddeler · metric: tek büyük sayı · progress: ilerleme çubuğu · link: bağlantı'),
        ...contentShape,
        size: size.optional(),
        position: z.enum(['start', 'end']).optional().describe('Verilmezse kart öndeki kartların hemen ardına gelir (önerilen). start: en başa · end: en sona'),
      }),
      risk: 'write',
      async run(input, ctx) {
        const content = buildContent(input.template, input);
        if (typeof content === 'string') return { ok: false, text: content };
        if (store().cards().length >= MAX_CUSTOM_CARDS) return { ok: false, text: t('dashboard.tool.tooMany', { count: MAX_CUSTOM_CARDS }) };
        const card = store().addCard({ title: input.title.trim(), content, size: input.size ?? DEFAULT_CUSTOM_SIZE[input.template], source: ctx.origin.channel === 'ui' ? 'user' : 'ai' });
        engine().place(card.id, input.position ?? 'lead', 'ai');
        return { ok: true, text: withOrder(t('dashboard.tool.added', { title: card.title })), data: { id: card.id, title: card.title, size: card.size } };
      },
    }),

    defineTool({
      name: 'dashboard_card_update',
      group: 'dashboard',
      description:
        'Ana ekrandaki bir kartın İÇERİĞİNİ günceller: başlık, değer, liste ya da boyut. Kendi eklediğin kartın değeri değişince (sayaç, ilerleme, liste) ' +
        'yeni kart eklemek yerine bunu kullan; verilmeyen alanlar olduğu gibi kalır. Hava kartının şehrini değiştirmek için card="hava" ve place ver. ' +
        'Kartı TAŞIMAK için dashboard_card_move kullan. Örnekler: "lansman sayacını 10 yap" → card="Lansmana kalan", value="10" · "havayı Ankara için göster" → card="hava", place="Ankara".',
      input: z.object({
        card: z.string().min(1).describe(CARD_REF),
        title: z.string().min(1).max(60).optional().describe('Kartın yeni başlığı'),
        template: z.enum(DASHBOARD_TEMPLATES).optional().describe('Şablonu değiştirmek için; verilmezse kartın şablonu korunur'),
        ...contentShape,
        size: size.optional(),
        place: z.string().min(2).max(60).optional().describe('Yalnız hava kartı: şehir ya da ilçe adı ("Ankara", "Kadıköy")'),
      }),
      risk: 'write',
      async run(input) {
        const target = engine().find(input.card);
        if (!target) return notFound(input.card);
        if (input.place !== undefined) {
          if (target.id !== 'weather') return { ok: false, text: t('dashboard.tool.placeOnlyWeather') };
          store().setConfig({ weatherPlace: input.place.trim() });
          network().forgetWeather();
          // Yeni yerin havası alınana kadar eski yer gösterilmez; alınamazsa kart çizilmez ve bunu söyleriz.
          await network().refreshNow(['weather']);
          const fill = network().weather();
          if (input.size) engine().resize(target.id, input.size, 'ai');
          else engine().publish('card', 'ai', target.id, true);
          return fill
            ? { ok: true, text: t('dashboard.tool.placeSet', { place: fill.data.place }), data: { id: target.id, place: fill.data.place } }
            : { ok: false, text: t('dashboard.tool.placeFailed', { place: input.place.trim() }) };
        }
        if (target.custom) {
          const current = store().card(target.id);
          if (!current) return notFound(input.card);
          const template = input.template ?? current.content.template;
          const touchesContent = input.template !== undefined || (Object.keys(contentShape) as Array<keyof typeof contentShape>).some((key) => input[key] !== undefined);
          let content: DashboardCustomContent | undefined;
          if (touchesContent) {
            // Şablon aynıysa verilmeyen alanlar korunur ("değeri 10 yap" birimi ve etiketi silmez).
            const given = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as ContentInput;
            const built = buildContent(template, template === current.content.template ? { ...contentInput(current.content), ...given } : input);
            if (typeof built === 'string') return { ok: false, text: built };
            content = built;
          }
          store().updateCard(target.id, { ...(input.title ? { title: input.title.trim() } : {}), ...(content ? { content } : {}) });
          if (input.size) engine().resize(target.id, input.size, 'ai');
          else engine().publish('card', 'ai', target.id, true);
          return { ok: true, text: t('dashboard.tool.updated', { title: input.title?.trim() ?? target.title }), data: { id: target.id } };
        }
        // Yerleşik kartın içeriği veriden gelir; yalnız boyutu değişir.
        if (!input.size) return { ok: false, text: t('dashboard.tool.builtinOnlySize', { title: target.title }) };
        if (target.band) return { ok: false, text: t('dashboard.tool.bandFixed') };
        engine().resize(target.id, input.size, 'ai');
        return { ok: true, text: t('dashboard.tool.resized', { title: target.title, size: SIZE_TR[input.size] }), data: { id: target.id, size: input.size } };
      },
    }),

    defineTool({
      name: 'dashboard_card_remove',
      group: 'dashboard',
      description:
        'Ana ekrandan (Bugün sayfası, Kokpit) bir kartı kaldırır ("hava kartını kaldır", "dövizi ana ekrandan çıkar", "şu kartı sil"). Yerleşik kart gizlenir ve ' +
        'dashboard_layout action=restore ile geri gelir; eklenmiş özel kart silinir. Örnek: "haberleri kaldır" → card="haberler".',
      input: z.object({ card: z.string().min(1).describe(CARD_REF) }),
      risk: 'write',
      async run({ card }) {
        const target = engine().find(card);
        if (!target) return notFound(card);
        if (target.band) return { ok: false, text: t('dashboard.tool.bandFixed') };
        if (target.hidden) return { ok: true, text: t('dashboard.tool.alreadyRemoved', { title: target.title }), data: { id: target.id } };
        const result = engine().remove(target.id, 'ai');
        return result.ok ? { ok: true, text: withOrder(t('dashboard.tool.removed', { title: nameOf(target) })), data: { id: target.id } } : notFound(card);
      },
    }),

    defineTool({
      name: 'dashboard_layout',
      group: 'dashboard',
      description:
        'Ana ekrandaki panonun düzenini toptan değiştirir. action: list (kartlar; dashboard_state ile aynı) · reorder (order içindeki kartları verilen sırayla en öne alır) · ' +
        'resize (card + size) · restore (kaldırılmış kartı geri getirir: "hava kartını geri getir") · reset (varsayılan düzene döner: "düzeni sıfırla"). ' +
        'TEK bir kartı taşımak ya da büyütmek için dashboard_card_move daha kolaydır. Örnekler: "önce haberler sonra döviz olsun" → action="reorder", order=["haberler","döviz"] · ' +
        '"kaldırdığım döviz kartını geri getir" → action="restore", card="döviz".',
      input: z.object({
        action: z.enum(['list', 'reorder', 'resize', 'restore', 'reset']).describe('list: oku · reorder: sırala · resize: boyutlandır · restore: geri getir · reset: sıfırla'),
        order: z.array(z.string().min(1)).max(24).optional().describe('action=reorder: kart adları ya da kimlikleri, istenen sırayla (ilk verilen en üste gelir)'),
        card: z.string().min(1).optional().describe(`action=resize ve restore için. ${CARD_REF}`),
        size: size.optional(),
      }),
      risk: 'write',
      async run(input) {
        const list = () =>
          engine()
            .known()
            .filter((card) => !card.band)
            .sort((a, b) => Number(b.visible) - Number(a.visible));
        switch (input.action) {
          case 'list': {
            const cards = list();
            const shown = shownCards();
            const rest = cards.filter((card) => !shown.some((item) => item.id === card.id));
            return {
              ok: true,
              text: describeState().text,
              data: { shown: shown.map(({ id, title, size: cardSize }) => ({ id, title, size: cardSize })), other: rest.map(({ id, title, hidden }) => ({ id, title, hidden })) },
            };
          }
          case 'reorder': {
            if (!input.order?.length) return { ok: false, text: t('dashboard.tool.needOrder') };
            const ids: string[] = [];
            const missing: string[] = [];
            for (const reference of input.order) {
              const target = engine().find(reference);
              if (target && !target.band) ids.push(target.id);
              else missing.push(reference);
            }
            if (ids.length === 0) return notFound(missing.join(', '));
            const snap = engine().reorder(ids, 'ai');
            return {
              ok: true,
              text: t('dashboard.tool.reordered', { list: shownCards().map(nameOf).join(', ') }) + (missing.length ? ` ${t('dashboard.tool.skipped', { list: missing.join(', ') })}` : ''),
              data: { order: snap.cards.filter((card) => !card.band).map((card) => card.id) },
            };
          }
          case 'resize': {
            if (!input.card || !input.size) return { ok: false, text: t('dashboard.tool.needCardSize') };
            const target = engine().find(input.card);
            if (!target) return notFound(input.card);
            if (target.band) return { ok: false, text: t('dashboard.tool.bandFixed') };
            engine().resize(target.id, input.size, 'ai');
            return { ok: true, text: t('dashboard.tool.resized', { title: target.title, size: SIZE_TR[input.size] }), data: { id: target.id, size: input.size } };
          }
          case 'restore': {
            if (!input.card) return { ok: false, text: t('dashboard.tool.needCard') };
            const target = engine().find(input.card);
            if (!target) return notFound(input.card);
            if (!target.hidden) return { ok: true, text: t('dashboard.tool.notHidden', { title: target.title }), data: { id: target.id } };
            engine().restore(target.id, 'ai');
            return { ok: true, text: withOrder(t('dashboard.tool.restored', { title: nameOf(target) })), data: { id: target.id } };
          }
          case 'reset':
            engine().reset('ai');
            return { ok: true, text: withOrder(t('dashboard.tool.reset')) };
        }
      },
    }),

    defineTool({
      name: 'suggestion_add',
      group: 'dashboard',
      description:
        'Panodaki "Öneriler" kartına kısa bir öneri bırakır. Kullanıcının istemediği ama fark ettiğin yararlı bir sonraki adımı önermek için kullan ' +
        '("yarınki toplantı için gündem çıkarayım mı?"). Kullanıcının açıkça istediği işi öneriye çevirme; onu yap.',
      input: z.object({
        text: z.string().min(3).max(120).describe('Önerinin kendisi, tek cümle'),
        detail: z.string().max(160).optional().describe('Neden önerdiğini anlatan kısa satır'),
        prompt: z.string().max(240).optional().describe('Kullanıcı öneriye dokununca sohbete yazılacak söz; verilmezse text'),
      }),
      risk: 'write',
      async run({ text, detail, prompt }) {
        const suggestion = store().addSuggestion({ text: text.trim(), detail: detail?.trim() || null, prompt: prompt?.trim() || null });
        engine().publish('card', 'ai', 'suggestions', true);
        return { ok: true, text: t('dashboard.tool.suggested', { text: suggestion.text }), data: { id: suggestion.id } };
      },
    }),
  ];
}
