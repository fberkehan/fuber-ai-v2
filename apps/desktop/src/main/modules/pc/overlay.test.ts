import { describe, expect, it } from 'vitest';
import {
  createPcOverlay,
  formatAccelerator,
  nearestDisplay,
  physicalToDip,
  toOverlayPoint,
  toOverlayRect,
  type OverlayBounds,
  type OverlayDisplay,
  type OverlayHost,
  type OverlayTimers,
} from './overlay';
import type { PcActivity, PcOverlayFrame } from './types';

// Sahte saat: zamanlayıcılar elle ilerletilir (gerçek bekleme yok).
function clock(): OverlayTimers & { advance(ms: number): void } {
  let now = 0;
  let next = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn, ms) {
      const id = next++;
      queue.set(id, { at: now + ms, fn });
      return id;
    },
    clear(handle) {
      queue.delete(handle as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...queue.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

type FakeDisplay = OverlayDisplay & { physical: OverlayBounds };

/** Birincil %100 (1920×1080) + sağında %150 ekran (fiziksel 2880×1620 = DIP 1920×1080). */
const TWO: FakeDisplay[] = [
  { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 }, scaleFactor: 1, physical: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1040 }, scaleFactor: 1.5, physical: { x: 1920, y: 0, width: 2880, height: 1620 } },
];

interface FakeSurface {
  displayId: number;
  frames: PcOverlayFrame[];
  shown: number;
  hidden: number;
  destroyed: boolean;
  visible: boolean;
}

function fakeHost(displays: FakeDisplay[] = TWO, cursor = 1) {
  const surfaces: FakeSurface[] = [];
  let displaysChanged: (() => void) | null = null;
  let list = displays;
  const host: OverlayHost = {
    displays: () => list,
    toDip: (point) => physicalToDip(list, point),
    nearest: (point) => nearestDisplay(list, point),
    cursorDisplay: () => list.find((display) => display.id === cursor) ?? list[0]!,
    open(display) {
      const surface: FakeSurface = { displayId: display.id, frames: [], shown: 0, hidden: 0, destroyed: false, visible: false };
      surfaces.push(surface);
      return {
        send: (frame) => void surface.frames.push(frame),
        show: () => {
          surface.shown += 1;
          surface.visible = true;
        },
        hide: () => {
          surface.hidden += 1;
          surface.visible = false;
        },
        setBounds: () => undefined,
        destroy: () => {
          surface.destroyed = true;
        },
      };
    },
    onDisplaysChanged(listener) {
      displaysChanged = listener;
      return () => (displaysChanged = null);
    },
  };
  return {
    host,
    surfaces,
    of: (id: number) => surfaces.filter((surface) => surface.displayId === id && !surface.destroyed).at(-1)!,
    setDisplays(next: FakeDisplay[]) {
      list = next;
      displaysChanged?.();
    },
  };
}

function setup(options: { displays?: FakeDisplay[]; reducedMotion?: boolean | 'system' } = {}) {
  const timers = clock();
  const fake = fakeHost(options.displays);
  const overlay = createPcOverlay({
    host: fake.host,
    reducedMotion: () => options.reducedMotion ?? false,
    assistantName: () => 'Jarvis',
    stopKeys: () => 'Ctrl+Alt+Q',
    timers,
  });
  const last = (id: number) => fake.of(id).frames.at(-1)!;
  return { ...fake, overlay, timers, last };
}

const act = (patch: Partial<PcActivity> = {}): PcActivity => ({
  active: true,
  action: 'click',
  app: 'Not Defteri',
  interrupted: null,
  point: null,
  at: '2026-11-17T10:00:00.000Z' as PcActivity['at'],
  ...patch,
});
const done = act({ active: false, action: null, app: null });

describe('fiziksel piksel → katmanın DIP koordinatı (çoklu ekran, %150)', () => {
  it('birincil ekranda %100: nokta olduğu gibi', () => {
    const { host } = fakeHost();
    expect(toOverlayPoint(host, { x: 400, y: 300 })).toEqual({ display: TWO[0], point: { x: 400, y: 300 } });
  });

  it('%150 ölçekli ikinci ekranın ortası: o ekranın penceresine göre (960, 540)', () => {
    const { host } = fakeHost();
    const placed = toOverlayPoint(host, { x: 1920 + 1440, y: 810 });
    expect(placed.display.id).toBe(2);
    expect(placed.point).toEqual({ x: 960, y: 540 });
  });

  it('dikdörtgen: ekran merkezden seçilir, köşeler ölçekle küçülür', () => {
    const { host } = fakeHost();
    const placed = toOverlayRect(host, { left: 1920 + 300, top: 150, right: 1920 + 900, bottom: 300 });
    expect(placed.display.id).toBe(2);
    expect(placed.rect).toEqual({ left: 200, top: 100, right: 600, bottom: 200 });
  });

  it('ekran dışındaki nokta en yakın ekrana düşer', () => {
    const { host } = fakeHost();
    expect(toOverlayPoint(host, { x: -50, y: 500 }).display.id).toBe(1);
    expect(nearestDisplay(TWO, { x: 5000, y: 200 }).id).toBe(2);
  });

  it('kısayol okunur biçimde', () => {
    expect(formatAccelerator('CommandOrControl+Alt+Q')).toBe('Ctrl+Alt+Q');
    expect(formatAccelerator('')).toBe('');
  });
});

describe('ekran katmanı durum makinesi', () => {
  it('boşta pencere yok; ilk etkinlikte her ekrana bir pencere, odak çalmadan gösterilir', () => {
    const { overlay, surfaces } = setup();
    expect(surfaces).toHaveLength(0);
    overlay.handle(act({ step: '“Ara” alanına tıklıyorum' }));
    expect(surfaces.map((surface) => surface.displayId)).toEqual([1, 2]);
    expect(surfaces.every((surface) => surface.shown === 1)).toBe(true);
  });

  it('fx yoksa yalnız kenar + şerit: imleç yok, şerit imlecin bulunduğu ekranda', () => {
    const { overlay, last } = setup();
    overlay.handle(act({ action: 'files', step: 'Dosyayı kopyalıyorum' }));
    expect(last(1)).toMatchObject({ visible: true, state: 'working', focus: true, pointer: null, fx: null, step: 'Dosyayı kopyalıyorum', name: 'Jarvis', stopKeys: 'Ctrl+Alt+Q' });
    expect(last(2)).toMatchObject({ visible: true, focus: false, pointer: null });
    expect(last(1).work).toEqual({ x: 0, y: 0, width: 1920, height: 1032 });
  });

  it('hareket ve tıklama yalnız hedef ekranın penceresine gider; şerit oraya taşınır', () => {
    const { overlay, last } = setup();
    overlay.handle(act({ fx: { kind: 'move', to: { x: 1920 + 300, y: 300 }, ms: 210 } }));
    expect(last(2)).toMatchObject({ focus: true, pointer: { x: 200, y: 200 }, fx: { kind: 'move', to: { x: 200, y: 200 }, ms: 210, from: null } });
    expect(last(1)).toMatchObject({ focus: false, pointer: null, fx: null });
    overlay.handle(act({ fx: { kind: 'click', at: { x: 1920 + 300, y: 300 }, button: 'right', double: true } }));
    expect(last(2).fx).toEqual({ kind: 'click', at: { x: 200, y: 200 }, button: 'right', double: true });
  });

  it('hareketin başlangıcı aynı ekrandaysa iletilir (gerçek imleçle üst üste)', () => {
    const { overlay, last } = setup();
    const fx = { kind: 'move' as const, to: { x: 800, y: 600 }, ms: 260, from: { x: 100, y: 100 } };
    overlay.handle(act({ fx }));
    expect(last(1).fx).toEqual({ kind: 'move', to: { x: 800, y: 600 }, ms: 260, from: { x: 100, y: 100 } });
  });

  it('eski yayıncı: fx yok ama point var → hareket türetilir; aynı nokta ikinci kez hareket sayılmaz', () => {
    const { overlay, last } = setup();
    overlay.handle(act({ point: { x: 500, y: 400 } }));
    expect(last(1).fx).toMatchObject({ kind: 'move', to: { x: 500, y: 400 } });
    overlay.handle(act({ point: { x: 500, y: 400 }, step: 'tıklıyorum' }));
    expect(last(1).fx).toBeNull();
    expect(last(1).pointer).toEqual({ x: 500, y: 400 });
  });

  it('yazma: hedef alan ve ilerleme; konumsuz yazma bildirimi etkin ekrana gider', () => {
    const { overlay, last } = setup();
    overlay.handle(act({ action: 'type', fx: { kind: 'target', rect: { left: 100, top: 200, right: 500, bottom: 240 }, mode: 'type' } }));
    expect(last(1).fx).toEqual({ kind: 'target', rect: { left: 100, top: 200, right: 500, bottom: 240 }, mode: 'type' });
    overlay.handle(act({ action: 'type', fx: { kind: 'typing', chars: 14, total: 40 } }));
    expect(last(1).fx).toEqual({ kind: 'typing', chars: 14, total: 40 });
    expect(last(2).fx).toBeNull();
  });

  it('adım ve ilerleme: verilmeyen alan öncekini korur, null siler', () => {
    const { overlay, last } = setup();
    overlay.handle(act({ step: 'Birinci', progress: { index: 1, total: 3 } }));
    overlay.handle(act({ fx: { kind: 'move', to: { x: 10, y: 10 }, ms: 60 } }));
    expect(last(1)).toMatchObject({ step: 'Birinci', progress: { index: 1, total: 3 } });
    overlay.handle(act({ step: null, progress: null }));
    expect(last(1)).toMatchObject({ step: null, progress: null });
  });

  it('kare sırası her yayında artar (sayfa tekrar gelen kareyi yeniden oynatmaz)', () => {
    const { overlay, of } = setup();
    overlay.handle(act());
    overlay.handle(act());
    const seqs = of(1).frames.map((frame) => frame.seq);
    expect(seqs[1]).toBeGreaterThan(seqs[0]!);
  });

  it('bitti → 2,5 sn oyalanma → söner (visible:false) → 450 ms sonra gizlenir; arada gelen etkinlik iptal eder', () => {
    const { overlay, last, of, timers } = setup();
    overlay.handle(act());
    overlay.handle(done);
    timers.advance(2000);
    expect(last(1).visible).toBe(true);
    overlay.handle(act({ step: 'devam' }));
    timers.advance(5000);
    expect(last(1).visible).toBe(true);
    overlay.handle(done);
    timers.advance(2500);
    expect(last(1).visible).toBe(false);
    expect(of(1).hidden).toBe(0);
    timers.advance(450);
    expect(of(1).hidden).toBe(1);
    expect(of(2).hidden).toBe(1);
  });

  it('onay bekleniyor: durum "waiting"; bekçi süresi işlemez', () => {
    const { overlay, last, timers } = setup();
    overlay.handle(act({ waiting: 'approval', step: 'Pencereyi kapatmak için onay' }));
    expect(last(1).state).toBe('waiting');
    timers.advance(120_000);
    expect(last(1).visible).toBe(true);
    overlay.handle(act({ waiting: null }));
    expect(last(1).state).toBe('working');
  });

  it('kullanıcı fareye dokundu: "interrupted" 2,6 sn, sonra söner; geç gelen "bitti" bunu bozmaz', () => {
    const { overlay, last, of, timers } = setup();
    overlay.handle(act({ fx: { kind: 'move', to: { x: 300, y: 300 }, ms: 200 } }));
    overlay.handle(act({ active: false, interrupted: 'user' }));
    expect(last(1)).toMatchObject({ visible: true, state: 'interrupted' });
    overlay.handle(done);
    timers.advance(2599);
    expect(last(1).visible).toBe(true);
    timers.advance(1);
    expect(last(1).visible).toBe(false);
    timers.advance(450);
    expect(of(1).hidden).toBe(1);
  });

  it('acil dur: "stopped"', () => {
    const { overlay, last } = setup();
    overlay.handle(act());
    overlay.handle(act({ active: false, interrupted: 'panic' }));
    expect(last(1).state).toBe('stopped');
  });

  it('bitti hiç gelmezse bekçi 30 sn sonra söndürür', () => {
    const { overlay, last, timers } = setup();
    overlay.handle(act());
    timers.advance(30_000);
    expect(last(1).visible).toBe(false);
  });

  it('sönüp gizlendikten sonra yeni oturum imleci sıfırdan başlatır ve pencereleri yeniden gösterir', () => {
    const { overlay, last, of, timers } = setup();
    overlay.handle(act({ fx: { kind: 'move', to: { x: 300, y: 300 }, ms: 200 } }));
    overlay.handle(done);
    timers.advance(3000);
    overlay.handle(act({ action: 'files' }));
    expect(last(1).pointer).toBeNull();
    expect(of(1).shown).toBe(2);
  });

  it('dosya/komut eyleminde imleç gizlenir, işaretçi eylemine dönünce yeniden görünür', () => {
    const { overlay, last } = setup();
    overlay.handle(act({ fx: { kind: 'move', to: { x: 300, y: 300 }, ms: 200 } }));
    overlay.handle(act({ action: 'command', step: 'Komut' }));
    expect(last(1).pointer).toBeNull();
    overlay.handle(act({ action: 'click' }));
    expect(last(1).pointer).toEqual({ x: 300, y: 300 });
  });

  it('hareket azaltma: ayar "on" → reducedMotion, "system" → sayfa sorar', () => {
    expect((() => {
      const { overlay, last } = setup({ reducedMotion: true });
      overlay.handle(act());
      return last(1);
    })()).toMatchObject({ reducedMotion: true, systemMotion: false });
    const { overlay, last } = setup({ reducedMotion: 'system' });
    overlay.handle(act());
    expect(last(1)).toMatchObject({ reducedMotion: false, systemMotion: true });
  });

  it('ekran çıkarılınca o ekranın penceresi yok edilir; kapanışta hepsi yok edilir', () => {
    const { overlay, surfaces, setDisplays } = setup();
    overlay.handle(act());
    setDisplays([TWO[0]!]);
    expect(surfaces.find((surface) => surface.displayId === 2)!.destroyed).toBe(true);
    overlay.dispose();
    expect(surfaces.every((surface) => surface.destroyed)).toBe(true);
    overlay.handle(act());
    expect(surfaces).toHaveLength(2);
  });
});
