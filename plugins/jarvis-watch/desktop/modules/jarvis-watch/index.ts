/**
 * Galaxy Watch eklentisi: saatten gelen nabız, pil ve takılı mı bilgisini (`bio.sample`, `bio.status`) toplar ve "Saat"
 * sayfasına verir. Köprü (QR + PIN eşleşme, şifreli TCP) jarvis-quest eklentisinin `xr` modülündedir; bu modül yalnız
 * onun `xr.message` ve `xr.changed` olaylarını dinler. Saat uygulaması: plugins/jarvis-watch/device/watch-android.
 */
import { defineModule } from '@fuber/shared';
import { BioTracker } from './bio';

import './types';

let tracker: BioTracker | null = null;
let offs: Array<() => void> = [];

export default defineModule({
  id: 'jarvis-watch',
  version: '1.0.0',
  nameKey: 'module.jarvis-watch.name',
  descriptionKey: 'module.jarvis-watch.description',
  permissions: [],
  // Sol rayda "Saat" sayfası (renderer: pages/saat). Modül kapalıyken sayfa görünmez.
  page: { id: 'saat', icon: 'Watch', order: 75 },
  windowEvents: ['saat.bio'],

  ipc: () => ({
    'saat.bio': () => (tracker ?? new BioTracker()).snapshot(),
  }),

  setup(ctx) {
    const bio = new BioTracker();
    tracker = bio;
    const publish = () => ctx.bus.emit('saat.bio', { bio: bio.snapshot() });
    offs = [
      ctx.bus.on('xr.changed', ({ watch }) => {
        bio.setConnected(!!watch);
        publish();
      }),
      ctx.bus.on('xr.message', ({ kind, msg }) => {
        if (kind !== 'watch') return;
        if (msg.t === 'bio.sample') bio.onSample(msg);
        else if (msg.t === 'bio.status') bio.onStatus(msg);
        else return;
        publish();
      }),
    ];
  },

  teardown() {
    for (const off of offs) off();
    offs = [];
    tracker = null;
  },
});
