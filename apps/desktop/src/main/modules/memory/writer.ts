// Sahibi: T2. Arka plan hafıza yazıcısı: her tur bitince `memory` rolüyle kalıcı bilgiyi çıkarır,
// yinelenenleri birleştirir, çelişen eski bilgiyi "geçersiz" işaretler (silmez).
import { foldForSearch, SIMILAR_SKIP, stemSet, stemSetSimilarity, type Id, type MemoryItem, type ModuleContext, type RecordSource } from '@fuber/shared';
import { z } from 'zod';
import type { ProfileService } from './profile/service';
import { topicStems } from './profile/store';
import { PROFILE_CATEGORIES } from './profile/types';

export const ExtractionSchema = z.object({
  items: z.array(
    z.object({
      action: z.enum(['add', 'same', 'update', 'supersede']),
      /** `same` / `update` / `supersede` için var olan kaydın kimliği. */
      target_id: z.string().nullable(),
      kind: z.enum(['fact', 'episode', 'commitment']),
      text: z.string(),
      subject: z.string().nullable(),
      importance: z.number(),
    }),
  ),
  /** Kullanıcı profili için öğrenilenler (isteğe bağlı; eski çıktılar bu alanı taşımaz). */
  profile: z
    .array(
      z.object({
        category: z.enum(PROFILE_CATEGORIES),
        /** Konunun kısa adı (küçük harf, tireli): aynı konu = aynı anahtar. */
        key: z.string(),
        text: z.string(),
        /** Kullanıcı bunu açıkça söyledi mi (false: konuşmadan çıkarım). */
        explicit: z.boolean(),
      }),
    )
    .optional(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const WRITER_INSTRUCTIONS = `Bir kişisel asistanın hafıza yazıcısısın. Sana bir konuşma turu (kullanıcının sözü ve asistanın yanıtı) ve hafızada zaten olan ilgili kayıtlar verilecek. Görevin, kullanıcı hakkında haftalar sonra da işe yarayacak bilgileri kayda geçirmek.

Neyi kaydedersin
- fact: kalıcı bilgi. Kullanıcının kendisi, işleri, projeleri, tanıdıkları, tercihleri, önemli tarihler.
- commitment: kullanıcının yapacağını söylediği ya da asistandan istediği, henüz bitmemiş iş.
- episode: ileride hatırlanmaya değer bir olay ya da karar ("X projesinde Y'ye karar verdik").
Selamlaşma, anlık sorular, hava durumu, asistanın kendi yetenekleri ve asistanın tahminleri kaydedilmez. Yalnız kullanıcının söylediğine ya da araçların doğruladığına dayan.

Her kaydı tek başına anlaşılır, üçüncü kişi ağzından, kısa bir Türkçe cümle yaz ("Kullanıcının kızı Ada ilkokula gidiyor."). subject: kaydın ilgili olduğu kişi, kurum ya da proje adı; yoksa null. importance 0 ile 1 arası (kimlik, yakın çevre, iş ve süren yükümlülükler yüksek).

Var olan kayıtlarla karşılaştır
- Aynı bilgi zaten varsa action "same" ve target_id o kaydın kimliği.
- Var olan kaydı tamamlıyor ya da netleştiriyorsa "update", target_id o kayıt; text birleşik yeni hâl.
- Var olan kayıtla çelişiyorsa (adres değişti, karar değişti) "supersede", target_id eski kayıt; text yeni bilgi.
- Yeni bilgi ise "add", target_id null.
Kaydedilecek bir şey yoksa items boş dizi olsun.

Profil (profile dizisi; yoksa boş dizi)
Kullanıcıyı TANIMAYA yarayan, her konuşmada işe yarayacak şeyleri ayrıca profile dizisine yaz. category: identity (yaş, şehir, meslek) · circle (yakın çevre: aile, ortak, ekip) · work (işler, şirketler, projeler) · preference (tercihler) · style (üslup ve hitap: nasıl konuşulmasını ister) · routine (saatler, alışkanlıklar) · interest (ilgi alanları, takip ettiği konular) · dislike (sevmedikleri) · ongoing (süren meseleler) · rule (asistana koyduğu davranış kuralı: "böyle yap", "bir daha böyle yapma"). key: konunun kısa adı (küçük harf, tireli: "yanit-uzunlugu", "kahve", "kiz"); aynı konu her zaman aynı anahtar. text: üçüncü kişi ağzından tek kısa cümle; kuralda emir kipi ("Yanıtları kısa tut."). explicit: kullanıcı açıkça söylediyse true, sen çıkardıysan false. Anlık istekleri, hatırlatıcıları, sırları (parola, kart, kimlik numarası) ve asistanın kendi sözlerini yazma.`;

const normalize = (text: string) => foldForSearch(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Bu kadar kökten kısa metinlerde örtüşme oranı yanıltır ("Atlas" her şirket cümlesiyle 1,0 çıkar): birebir aynılık aranır. */
const MIN_STEMS_FOR_SIMILARITY = 3;

/**
 * Hafızada bu metne en çok benzeyen etkin kayıt ve benzerliği (kök kümesi örtüşmesi, 0–1); yoksa `null`.
 * Hatırlatıcıya bağlı kayıtlar (planlar modülünündür) aday değildir.
 */
export function nearestMemory(
  memory: Pick<ModuleContext['memory'], 'search'>,
  text: string,
  kind?: MemoryItem['kind'],
): NearMemory | null {
  const stems = stemSet(text);
  let best: NearMemory | null = null;
  for (const { item } of memory.search({ text, limit: 8, ...(kind ? { kinds: [kind] } : {}) })) {
    if (item.reminderId) continue;
    const other = stemSet(item.text);
    const exact = normalize(item.text) === normalize(text);
    const short = Math.min(stems.size, other.size) < MIN_STEMS_FOR_SIMILARITY;
    const similarity = exact ? 1 : short ? 0 : stemSetSimilarity(stems, other);
    let common = 0;
    for (const stem of stems) if (other.has(stem)) common++;
    const covered = exact ? 1 : short || stems.size === 0 ? 0 : common / stems.size;
    if (!best || similarity > best.similarity) best = { item, similarity, covered };
  }
  return best;
}

/**
 * Asistanın kendi hakkındaki sözü ("asistanın erişimi yok", "aracım yok", "Jarvis yapamaz"): hafızaya yazılmaz.
 * Fuber AI 1'in hafıza kuralından (`shared/hafiza-kurali.ts` › `ozKonusmaMi`): orada yerel yazıcı bu cümleleri kalıcı
 * "bilgi" diye kaydediyor, model sonra kendi yanlış beyanını hafızadan okuyup yineliyordu. Asistanın durumu hafızadan
 * değil öz-durum bloğundan bilinir.
 */
export function isSelfTalk(text: string): boolean {
  const s = foldForSearch(text);
  return (
    /\b(jarvis|fuber|asistan\w*|ben)\b[^.]{0,60}\b(erisim\w*|yetki\w*|arac\w*)\b[^.]{0,30}\b(yok|bulunmuyor|mevcut degil)/.test(s) ||
    /\berisim(im|i)? (yok|bulunmuyor|mevcut degil)|\barac(im|lar\w*)? (yok|erisim)/.test(s) ||
    /\b(jarvis|fuber|asistan\w*)\b[^.]{0,40}\b(yapamaz|gonderemez|kuramaz|erisemez|bakamaz|yazamaz|goremez|ekleyemez)\b/.test(s) ||
    /\b(jarvis|fuber|asistan\w*)\b[^.]{0,40}\b(yerel(de)?|bulut\w*|ekran kart\w*)\b[^.]{0,30}\bcalis/.test(s)
  );
}

/**
 * Yazıcının profil kaydı kullanıcının BU turdaki sözüne dayanıyor mu. Ölçüm (uçtan uca, çıkarım yerel 4B modelde):
 * model "Kullanıcıya 'efendim' diye hitap ediyorsun" cümlesini (sistem isteminden) rutin diye, `explicit: true` ile
 * yazdı. Kural: asistana hitap eden cümle (ikinci tekil kişi) reddedilir; kaydın konu köklerinin en az yarısı
 * kullanıcının sözünde geçmelidir.
 */
export function groundedInUser(text: string, userText: string): boolean {
  if (/\p{L}+(yorsun|ırsın|irsin|ursun|ürsün|arsın|ersin|malısın|melisin|acaksın|eceksin)(?!\p{L})/u.test(text.toLocaleLowerCase('tr'))) return false;
  const stems = topicStems(text);
  if (stems.size === 0) return false;
  const said = topicStems(userText);
  let common = 0;
  for (const stem of stems) if (said.has(stem)) common++;
  return common >= 1 && common / stems.size >= 0.5;
}

export interface NearMemory {
  item: MemoryItem;
  /** Kök kümelerinin örtüşmesi: ortak / küçük kümenin boyu (aynı konu mu). */
  similarity: number;
  /** Yeni metnin köklerinin ne kadarı kayıtta zaten var (yeni metin bir şey EKLİYOR mu). */
  covered: number;
}

export interface WriterDeps {
  ctx: Pick<ModuleContext, 'memory' | 'brain' | 'conversation' | 'log'>;
  /** Profil katmanı (varsa): çıkarımın `profile` dizisi buraya işlenir. */
  profile?: Pick<ProfileService, 'note'> | null;
}

/** Bir turu işler; yazılan/güncellenen kayıtları döndürür. */
export async function processTurn(
  deps: WriterDeps,
  turn: { sessionId: Id; userMessageId: Id; assistantMessageId: Id; channel: 'voice' | 'chat' },
): Promise<MemoryItem[]> {
  const { ctx } = deps;
  const messages = ctx.conversation.messages(turn.sessionId, { limit: 6 });
  const user = messages.find((message) => message.id === turn.userMessageId);
  const assistant = messages.find((message) => message.id === turn.assistantMessageId);
  if (!user || user.text.trim().length < 3) return [];

  const related = ctx.memory.search({ text: user.text, limit: 10 });
  const known = related.length
    ? related.map(({ item }) => `- id=${item.id} [${item.kind}${item.subject ? ` · ${item.subject}` : ''}] ${item.text}`).join('\n')
    : '(ilgili kayıt yok)';
  const input = [
    `Kullanıcı: ${user.text}`,
    assistant?.text ? `Asistan: ${assistant.text}` : '',
    assistant?.toolCalls.length
      ? `Araçlar: ${assistant.toolCalls.map((call) => `${call.name} ${call.ok ? 'başarılı' : 'başarısız'}: ${call.text}`).join(' | ')}`
      : '',
    '',
    'Hafızada olan ilgili kayıtlar:',
    known,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await ctx.brain.extract({ role: 'memory', instructions: WRITER_INSTRUCTIONS, input, schema: ExtractionSchema });
  if (!result) return [];
  if (deps.profile) {
    for (const entry of result.profile ?? []) {
      const text = entry.text.trim();
      if (!text || isSelfTalk(text) || !groundedInUser(text, user.text)) continue;
      try {
        // Yazıcının kaydı her zaman ÇIKARIMDIR (`explicit` alanına güvenilmez): kullanıcının açık sözü kodla ayrıca
        // yakalanır (`profile/learn.ts`) ve çıkarım onun üstüne yazamaz.
        deps.profile.note({ category: entry.category, key: entry.key, text, explicit: false, channel: turn.channel, sessionId: turn.sessionId, messageId: turn.userMessageId });
      } catch (error) {
        ctx.log.warn('profil çıkarımı yazılamadı', error);
      }
    }
  }
  return applyExtraction(ctx, result, { source: turn.channel, sessionId: turn.sessionId });
}

/** Çıkarımı hafızaya uygular. Model bir kimlik uydurduysa ya da metin zaten varsa yenisi açılmaz. */
export function applyExtraction(
  ctx: Pick<ModuleContext, 'memory' | 'log'>,
  extraction: Extraction,
  origin: { source: RecordSource; sessionId: Id | null },
): MemoryItem[] {
  const written: MemoryItem[] = [];
  for (const entry of extraction.items) {
    const text = entry.text.trim();
    if (!text || isSelfTalk(text)) continue;
    const importance = Math.min(1, Math.max(0, entry.importance));
    const target = entry.target_id ? ctx.memory.get(entry.target_id) : null;
    if (entry.action === 'same') continue;
    if (entry.action === 'update' && target) {
      const updated = ctx.memory.update(target.id, {
        text,
        ...(entry.subject ? { subject: entry.subject } : {}),
        importance: Math.max(target.importance, importance),
      });
      if (updated) written.push(updated);
      continue;
    }
    if (entry.action === 'supersede' && target) {
      written.push(
        ctx.memory.supersede(target.id, {
          kind: entry.kind,
          text,
          subject: entry.subject,
          source: origin.source,
          sessionId: origin.sessionId,
          importance,
          confidence: 0.8,
        }),
      );
      continue;
    }
    // Ekleme: aynı bilgi zaten varsa yineleme yapılmaz (model "same" demeyi unutsa da). Birebir aynı metin ya da
    // köklerinin onda dokuzu ortak olan kayıt aynı sayılır.
    const near = nearestMemory(ctx.memory, text);
    if (near && near.covered >= SIMILAR_SKIP) continue;
    written.push(
      ctx.memory.save({
        kind: entry.kind,
        text,
        subject: entry.subject,
        source: origin.source,
        sessionId: origin.sessionId,
        importance,
        confidence: 0.8,
      }),
    );
  }
  return written;
}
