// Sahibi: T2. Hafıza modülü: hafıza araçları ve arka plan yazıcısı (KURGU §7); kullanıcı profili (`profile/`): her
// turda isteme giren, kategorili ve çelişkisi çözülmüş "kullanıcıyı nasıl tanıyorum" katmanı.
import { defineModule, defineTool, relativeDay, SIMILAR_MERGE, SIMILAR_SKIP, t, UserError, type Id, type MemoryItem, type RecordSource, type Unsubscribe } from '@fuber/shared';
import { z } from 'zod';
import type { BrainService } from '../../core/brain';
import { setActiveProfile } from './profile/access';
import { createProfileService, type ProfileService } from './profile/service';
import { createProfileStore, PROFILE_MIGRATIONS } from './profile/store';
import { profileTools } from './profile/tools';
import './profile/types';
import { nearestMemory, processTurn } from './writer';

const kindSchema = z.enum(['fact', 'episode', 'commitment']);
const subscriptions: Unsubscribe[] = [];
/** Yazıcı turları sırayla işler: aynı bilgi iki turda birden eklenmesin. */
let chain: Promise<unknown> = Promise.resolve();
/** Profil servisi (modül açıkken); araçlar ve IPC buradan okur. */
let profile: ProfileService | null = null;
let attachedBrain: Partial<BrainService> | null = null;
/** Onay kartının hangi araca ait olduğu (sonuç olayı yalnız kimlik taşır). */
const approvals = new Map<string, { toolName: string; summary: string }>();
const SELF_PART_ID = 'memory.profile';

function liveProfile(): ProfileService {
  if (!profile) throw new UserError(t('profile.error.notFound'));
  return profile;
}

const view = (item: MemoryItem) => ({
  id: item.id,
  kind: item.kind,
  text: item.text,
  subject: item.subject,
  learned: `${relativeDay(new Date(item.at))}, ${item.source}`,
});

const sourceOf = (channel: string): RecordSource => (channel === 'voice' ? 'voice' : channel === 'chat' ? 'chat' : 'system');

export default defineModule({
  id: 'memory',
  version: '1.0.0',
  nameKey: 'module.memory.name',
  descriptionKey: 'module.memory.description',
  permissions: [],
  page: { id: 'memory', icon: 'Brain', order: 30 },
  // Hafıza kayıtlarının tabloları çekirdek hafıza servisindedir (`memory_` öneki, 1 numaralı göç); modülün kendi
  // göçleri profil katmanınındır ve 101'den başlar (aynı ad alanında çakışmasın).
  migrations: PROFILE_MIGRATIONS,
  windowEvents: ['memory.profile.changed'],

  ipc: () => ({
    'memory.profile.get': () => liveProfile().overview(),
    'memory.profile.save': ({ id, category, text }) => {
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean.length < 2) throw new UserError(t('profile.error.emptyText'));
      const service = liveProfile();
      if (id) {
        const edited = service.store.edit(id, { category, text: clean });
        if (!edited) throw new UserError(t('profile.error.notFound'));
        service.notify('edited', [edited.id]);
        return edited;
      }
      const outcome = service.store.learn({ category, text: clean, origin: 'user', channel: 'ui', confidence: 1 });
      if (outcome.kind === 'skipped') throw new UserError(t(outcome.reason === 'secret' ? 'profile.tool.secret' : 'profile.error.emptyText'));
      service.notify('edited', [outcome.item.id]);
      return outcome.item;
    },
    'memory.profile.remove': ({ id }) => {
      const service = liveProfile();
      if (!service.store.remove(id)) throw new UserError(t('profile.error.notFound'));
      service.notify('removed', [id]);
      return { ok: true as const };
    },
    'memory.profile.setIntro': ({ enabled }) => liveProfile().setIntro(enabled),
  }),

  tools: [
    defineTool({
      name: 'memory_search',
      group: 'core',
      description:
        'Hafızada arar: kullanıcının daha önce söylediği bilgiler, kişiler, şirketler, tercihler, verilen sözler. ' +
        'İstemdeki "Hafızandan" bölümünde aradığın yoksa ya da kullanıcı "hatırlıyor musun" diye sorarsa kullan.',
      input: z.object({
        query: z.string().min(1).describe('Aranacak sözcükler; ekleri atıp kök biçimini ver: "Atlas şirket şehir"'),
        kinds: z.array(kindSchema).optional(),
      }),
      risk: 'read',
      async run({ query, kinds }, ctx) {
        const hits = ctx.memory.search({ text: query, limit: 8, ...(kinds ? { kinds } : {}) });
        if (hits.length === 0) return { ok: true, text: 'Hafızada bununla ilgili bir şey bulunamadı.', data: [] };
        return { ok: true, text: `${hits.length} kayıt bulundu.`, data: hits.map((hit) => view(hit.item)) };
      },
    }),
    defineTool({
      name: 'memory_save',
      group: 'core',
      description:
        'Kullanıcı hakkında kalıcı bir bilgiyi hafızaya yazar (kişi, şirket, proje, tercih, önemli tarih ya da verilen söz). ' +
        'Kullanıcı "bunu aklında tut" dediğinde ya da önemli bir bilgi verdiğinde kullan. Tek başına anlaşılır kısa bir cümle yaz.',
      input: z.object({
        text: z.string().min(3).describe('"Kullanıcının kızı Ada ilkokula gidiyor."'),
        kind: kindSchema.default('fact'),
        subject: z.string().optional().describe('İlgili kişi, şirket ya da proje adı'),
        importance: z.number().min(0).max(1).optional(),
      }),
      risk: 'write',
      async run({ text, kind, subject, importance }, ctx) {
        // Aynı bilgi zaten kayıtlıysa yenisi açılmaz; aynı konunun yeni söylenişi var olan kaydı günceller (eşikler
        // Fuber AI 1'in hafıza kuralından). Model aynı turu yinelediğinde hafıza kopyayla dolmasın.
        const near = nearestMemory(ctx.memory, text, kind);
        if (near && near.covered >= SIMILAR_SKIP) {
          return { ok: true, text: 'Bu bilgi hafızada zaten var; yeniden yazılmadı.', data: view(near.item) };
        }
        if (near && near.similarity >= SIMILAR_MERGE && (near.item.subject ?? null) === (subject ?? near.item.subject ?? null)) {
          const merged = ctx.memory.update(near.item.id, { text, ...(importance !== undefined ? { importance } : {}) });
          if (merged) return { ok: true, text: 'Hafızadaki kayıt yeni bilgiyle güncellendi.', data: view(merged) };
        }
        const item = ctx.memory.save({
          kind,
          text,
          subject: subject ?? null,
          source: sourceOf(ctx.origin.channel),
          confidence: 1,
          importance: importance ?? 0.7,
          sessionId: ctx.origin.sessionId ?? null,
        });
        return { ok: true, text: 'Hafızaya kaydedildi.', data: view(item) };
      },
    }),
    defineTool({
      name: 'memory_update',
      description: 'Hafızadaki bir kaydı düzeltir. Kimliği memory_search ile bul. Kullanıcı hafızadaki bir bilgiyi düzelttiğinde ("muhasebecim artık Ayşe Hanım") kullan.',
      input: z.object({
        id: z.string(),
        text: z.string().min(3).optional(),
        subject: z.string().nullable().optional(),
        importance: z.number().min(0).max(1).optional(),
      }),
      risk: 'write',
      async run({ id, text, subject, importance }, ctx) {
        const item = ctx.memory.update(id as Id, {
          ...(text ? { text } : {}),
          ...(subject !== undefined ? { subject } : {}),
          ...(importance !== undefined ? { importance } : {}),
        });
        if (!item) return { ok: false, text: 'Bu kimlikte bir hafıza kaydı yok; önce memory_search ile bul.' };
        return { ok: true, text: 'Kayıt güncellendi.', data: view(item) };
      },
    }),
    ...profileTools(liveProfile),
    defineTool({
      name: 'memory_forget',
      description:
        'Hafızadaki bir kaydı KALICI olarak siler. Kullanıcı "bunu unut" dediğinde kullan; kimliği memory_search ile bul. ' +
        'Silindiğini ancak bu araç başarılı dönerse söyle.',
      input: z.object({ id: z.string() }),
      risk: 'write',
      async run({ id }, ctx) {
        const item = ctx.memory.get(id as Id);
        if (!item) return { ok: false, text: 'Bu kimlikte bir hafıza kaydı yok; önce memory_search ile bul.' };
        const removed = ctx.memory.forget(id as Id);
        return removed ? { ok: true, text: `Silindi: "${item.text}"` } : { ok: false, text: 'Kayıt silinemedi.' };
      },
    }),
  ],

  setup(ctx) {
    const service = createProfileService({
      store: createProfileStore({ db: ctx.db }),
      presence: () => {
        try {
          return ctx.presence.get();
        } catch {
          return null;
        }
      },
      log: ctx.log,
      onChange: (reason, ids) => ctx.bus.emit('memory.profile.changed', { reason, ids }),
    });
    profile = service;
    setActiveProfile(service);
    // Beynin kancaları: profil özeti her kişilikli turda isteme girer; öz-tanımda "değiştirebildiklerim" arasındadır.
    const brain = ctx.brain as Partial<BrainService>;
    try {
      brain.attachUserContext?.((input) => service.context(input));
      brain.attachSelfPart?.(SELF_PART_ID, () => ({ canChange: [t('profile.self.canChange')] }));
      attachedBrain = brain;
    } catch (error) {
      ctx.log.debug(`profil kancası bağlanamadı: ${error instanceof Error ? error.message : String(error)}`);
    }

    subscriptions.push(
      ctx.bus.on('conversation.turn', (turn) => {
        // Açık sözler ve davranış işaretleri kodla, hemen öğrenilir (model gerekmez; her yolda çalışır).
        try {
          const messages = ctx.conversation.messages(turn.sessionId, { limit: 8 });
          const userIndex = messages.findIndex((message) => message.id === turn.userMessageId);
          const user = messages[userIndex];
          if (user && user.text.trim().length >= 3) {
            const assistant = messages.find((message) => message.id === turn.assistantMessageId);
            const before = messages.slice(0, userIndex).reverse().find((message) => message.role === 'assistant' && message.text.trim() !== '');
            service.learnFromTurn({
              channel: turn.channel,
              sessionId: turn.sessionId,
              messageId: turn.userMessageId,
              userText: user.text,
              previousReply: before?.text ?? null,
              tools: (assistant?.toolCalls ?? []).filter((call) => call.ok).map((call) => call.name),
            });
          }
        } catch (error) {
          ctx.log.warn('profil öğrenmesi başarısız', error);
        }
        chain = chain
          .then(() => processTurn({ ctx, profile: service }, turn))
          .then((written) => {
            if (written.length) ctx.log.info(`hafıza yazıcısı ${written.length} kayıt yazdı`);
          })
          .catch((error: unknown) => ctx.log.warn('hafıza yazıcısı başarısız', error));
      }),
      // Onay / ret: aynı işin yinelenen reddinden öğrenilir.
      ctx.bus.on('tool.approval.request', (request) => {
        approvals.set(request.id, { toolName: request.toolName, summary: request.summary });
        if (approvals.size > 50) approvals.delete(approvals.keys().next().value!);
      }),
      ctx.bus.on('tool.approval.resolve', ({ id, decision, by }) => {
        const request = approvals.get(id);
        approvals.delete(id);
        if (!request || by === 'timeout' || by === 'system') return;
        try {
          service.observeApproval(request.toolName, request.summary, decision === 'approved');
        } catch (error) {
          ctx.log.debug(`onay işareti yazılamadı: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
  },

  teardown() {
    for (const off of subscriptions.splice(0)) off();
    try {
      attachedBrain?.attachUserContext?.(null);
      attachedBrain?.attachSelfPart?.(SELF_PART_ID, null);
    } catch {
      // Beyin yer tutucusu: bağlanan bir şey yoktu.
    }
    attachedBrain = null;
    approvals.clear();
    setActiveProfile(null);
    profile = null;
  },
});
