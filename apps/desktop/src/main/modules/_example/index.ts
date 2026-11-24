/**
 * ÖRNEK MODÜL: derlemeye ve keşfe girmez (klasör adı alt çizgiyle başlar). Yeni modül yazarken kopyalayın:
 * klasörü `modules/<id>/` olarak adlandırmak yeter; `registry.gen.ts` kendiliğinden üretilir.
 *
 * Gösterdikleri: göç, araç, modüle özgü IPC kanalı ve olayı (tip genişletmesi), zamanlayıcı işleyicisi.
 */

import { defineModule, defineTool, newId, nowIso, type IsoDateTime } from '@fuber/shared';
import { z } from 'zod';

interface Note {
  id: string;
  text: string;
  at: IsoDateTime;
}

// Modüle özgü IPC ve olay: çekirdek sözleşmeye dokunmadan, modülün kendi klasöründe tanımlanır.
// Kanal ve olay adları modül kimliğiyle başlar. Aynı bildirim renderer tarafında da geçerlidir
// (sayfa bu dosyayı `import type` ile içe aktarırsa ya da aynı `declare module` bloğunu taşıyan
// bir `types.ts` dosyasını modül ve sayfa birlikte içe aktarırsa).
declare module '@fuber/shared' {
  interface Api {
    'example.listNotes': { req: { limit: number }; res: Note[] };
    'example.addNote': { req: { text: string }; res: Note };
  }
  interface BusEvents {
    'example.changed': { ids: string[] };
  }
  interface WindowEvents {
    'example.changed': { ids: string[] };
  }
}

export default defineModule({
  id: 'example',
  version: '1.0.0',
  nameKey: 'module.example.name',
  descriptionKey: 'module.example.description',
  permissions: [],
  // Pencerelere de aktarılacak kendi olayları.
  windowEvents: ['example.changed'],

  migrations: [
    {
      id: 1,
      name: 'notes tablosu',
      // Tablo adı modül önekiyle başlar (`ctx.db.prefix` = "example_").
      up: 'CREATE TABLE example_notes (id TEXT PRIMARY KEY, text TEXT NOT NULL, at TEXT NOT NULL)',
    },
  ],

  tools: [
    defineTool({
      name: 'example_add_note',
      description: 'Kısa bir not kaydeder. Kullanıcı "şunu not al" dediğinde kullan.',
      input: z.object({ text: z.string().min(1).describe('Notun metni') }),
      risk: 'write',
      async run({ text }, ctx) {
        const note: Note = { id: newId(), text, at: nowIso() };
        ctx.db.run('INSERT INTO example_notes (id, text, at) VALUES (?, ?, ?)', [note.id, note.text, note.at]);
        ctx.bus.emit('example.changed', { ids: [note.id] });
        // Araç başarılı döndüyse model "not aldım" diyebilir; `ok: false` ise diyemez.
        return { ok: true, text: 'Not kaydedildi.', data: note };
      },
    }),
  ],

  ipc: (ctx) => ({
    'example.listNotes': ({ limit }) =>
      ctx.db.all<Note>('SELECT id, text, at FROM example_notes ORDER BY at DESC LIMIT ?', [limit]),
    'example.addNote': ({ text }) => {
      const note: Note = { id: newId(), text, at: nowIso() };
      ctx.db.run('INSERT INTO example_notes (id, text, at) VALUES (?, ?, ?)', [note.id, note.text, note.at]);
      ctx.bus.emit('example.changed', { ids: [note.id] });
      return note;
    },
  }),

  setup(ctx) {
    // Zamanlayıcı işleyicisi: tür adı modül kimliğiyle başlar.
    ctx.scheduler.handle('example.tick', (task) => {
      ctx.log.info('zamanı geldi', task.payload);
    });
  },
});
