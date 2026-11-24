// Profil araçları: konuşan beyin (Claude Code, bulut) kullanıcı hakkında öğrendiğini kendisi kaydeder,
// "beni nasıl tanıyorsun" sorusunda profili okur, "artık öyle değil / o kuralı kaldır" denince siler.
import { defineTool, relativeDay, t, type Id } from '@fuber/shared';
import { z } from 'zod';
import type { ProfileService } from './service';
import { categoryTitle, humanSummary, originLabel } from './summary';
import { PROFILE_CATEGORIES, type ProfileItem } from './types';

const categorySchema = z.enum(PROFILE_CATEGORIES);

const view = (item: ProfileItem) => ({
  id: item.id,
  category: item.category,
  key: item.key,
  text: item.text,
  confidence: Math.round(item.confidence * 100) / 100,
  learned: `${relativeDay(new Date(item.learnedAt))}, ${originLabel(item.origin)}`,
  ...(item.previousText ? { previously: item.previousText } : {}),
});

export function profileTools(service: () => ProfileService) {
  return [
    defineTool({
      name: 'profile_note',
      description:
        'Kullanıcı hakkında öğrendiğin KALICI bir şeyi profiline yazar: seni düzelttiğinde ("böyle yapma", "bunu böyle isterim", "daha kısa söyle" → category=rule), ' +
        'bir tercihini, alışkanlığını, yakınını, işini, ilgi alanını, sevmediğini ya da süren bir meselesini söylediğinde. Aynı konunun yeni bilgisi eskisinin yerini alır ' +
        '(eskisi geçmişte tarihli durur): aynı konuyu güncelliyorsan "Kullanıcı profili" bölümünde köşeli parantezde gördüğün anahtarı (key) AYNEN ver. ' +
        'Anlık istekleri, tek seferlik işleri, hatırlatıcıları ve sırları (parola, kart, kimlik numarası) YAZMA. Kaydı sessizce yap; kullanıcıya "profilinize yazdım" deme. ' +
        'Örnekler: "Bundan sonra bana rakamları yuvarlayarak söyle" → category=rule, key="sayi-bicimi", text="Rakamları yuvarlayarak söyle." · ' +
        '"Kızım Elif bu yıl üniversiteye başladı" → category=circle, key="kiz", text="Kızı Elif; 2026\'da üniversiteye başladı." · ' +
        '"Yapay zekâ haberlerini kaçırmak istemem" → category=interest, key="yapay-zeka", text="Yapay zekâ gelişmelerini yakından takip eder."',
      input: z.object({
        category: categorySchema.describe(
          'identity: kimlik (yaş, şehir, meslek) · circle: yakın çevre · work: işler, şirketler, projeler · preference: tercihler · style: üslup ve hitap · ' +
            'routine: rutinler ve saatler · interest: ilgi alanları, takip ettiği konular · dislike: sevmedikleri · ongoing: süren meseleler · rule: davranış kuralı (sana yaptığı düzeltme)',
        ),
        text: z.string().min(3).max(400).describe('Tek başına anlaşılır, üçüncü kişi ağzından kısa Türkçe cümle; kuralda emir kipi: "Yanıtları iki cümleyi geçirme."'),
        key: z.string().max(48).optional().describe('Konunun kısa adı (küçük harf, tireli): "yanit-uzunlugu", "hitap", "kahve", "kiz". Aynı konu = aynı anahtar.'),
        explicit: z.boolean().optional().describe('Kullanıcı bunu açıkça söylediyse true (varsayılan); sen çıkardıysan false.'),
      }),
      risk: 'write',
      async run({ category, text, key, explicit }, ctx) {
        const channel = ctx.origin.channel === 'voice' ? 'voice' : ctx.origin.channel === 'chat' ? 'chat' : 'system';
        const outcome = service().note({ category, text, key: key ?? null, explicit: explicit ?? true, channel, sessionId: (ctx.origin.sessionId as Id | undefined) ?? null });
        switch (outcome.kind) {
          case 'added':
            return { ok: true, text: t('profile.tool.noted', { category: categoryTitle(category) }), data: view(outcome.item) };
          case 'confirmed':
            return { ok: true, text: t('profile.tool.confirmed'), data: view(outcome.item) };
          case 'superseded':
            return { ok: true, text: t('profile.tool.superseded', { previous: outcome.previous.text }), data: view(outcome.item) };
          default:
            return {
              ok: false,
              text: t(outcome.reason === 'secret' ? 'profile.tool.secret' : outcome.reason === 'empty' ? 'profile.tool.empty' : 'profile.tool.keptUserWord'),
            };
        }
      },
    }),
    defineTool({
      name: 'profile_get',
      group: 'briefing',
      description:
        'Kullanıcıyı NASIL tanıdığını okur: profildeki bütün kayıtlar (kimlik, yakın çevre, işler, tercihler, üslup, rutinler, ilgi alanları, sevmedikleri, süren meseleler, ' +
        'davranış kuralları), her birinin ne zaman ve nasıl öğrenildiği. Kullanıcı "beni nasıl tanıyorsun", "hakkımda ne biliyorsun", "hangi kurallarımı biliyorsun", ' +
        '"benimle ilgili ne öğrendin" derse ya da bir kaydı silmeden/düzeltmeden önce kimliğini bulmak için kullan. Sonucu doğal bir dille, kısa anlat; liste okuma.',
      input: z.object({ category: categorySchema.optional().describe('Yalnız bu kategori') }),
      risk: 'read',
      async run({ category }) {
        const items = service().store.list(category ? { category } : {});
        if (items.length === 0) return { ok: true, text: t('profile.summary.empty'), data: [] };
        return { ok: true, text: humanSummary(service().store, new Date()), data: items.map(view) };
      },
    }),
    defineTool({
      name: 'profile_forget',
      description:
        'Profildeki bir kaydı KALICI olarak siler. Kullanıcı "o kuralı kaldır", "artık öyle değil, unut", "bunu hakkımda tutma" derse kullan; kimliği profile_get ile bul ' +
        '(tahmin etme). Yeni bir bilgiyle DEĞİŞTİRİLECEKSE silme: profile_note ile aynı anahtarla yaz. Silindiğini ancak bu araç başarılı dönerse söyle.',
      input: z.object({ id: z.string().describe('profile_get sonucundaki kayıt kimliği') }),
      risk: 'write',
      async run({ id }) {
        const item = service().store.get(id as Id);
        if (!item) return { ok: false, text: t('profile.tool.unknownId') };
        const removed = service().store.remove(id as Id);
        return removed ? { ok: true, text: t('profile.tool.removed', { text: item.text }) } : { ok: false, text: t('profile.tool.removeFailed') };
      },
    }),
  ];
}
