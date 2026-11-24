import { describe, expect, it, vi } from 'vitest';
import { computePosition } from './anchor';
import { createLayerStack, type LayerEntry } from './stack';

const entry = (id: string, kind: LayerEntry['kind'], extra: Partial<LayerEntry> = {}): LayerEntry => ({
  id,
  kind,
  modal: kind === 'dialog',
  dismissOnEscape: true,
  dismissOnOutside: true,
  ...extra,
});

describe('katman yığını', () => {
  it('iç içe açılan katman her zaman üstte: menü diyalogdan, ikinci diyalog menüden yüksek', () => {
    const stack = createLayerStack();
    stack.push(entry('dialog', 'dialog'));
    stack.push(entry('menu', 'menu'));
    stack.push(entry('confirm', 'dialog'));
    expect(stack.zIndex('dialog')).toBe('calc(var(--z-layer) + 0)');
    expect(stack.zIndex('menu')).toBe('calc(var(--z-layer) + 2)');
    expect(stack.zIndex('confirm')).toBe('calc(var(--z-layer) + 4)');
    expect(stack.isTop('confirm')).toBe(true);
    expect(stack.isTop('dialog')).toBe(false);
  });

  it('çocuk katman ebeveynden önce kaydolsa da (aynı anda bağlanma) ebeveyn altta kalır', () => {
    const stack = createLayerStack();
    stack.push(entry('menu', 'menu', { parent: 'dialog' }));
    stack.push(entry('dialog', 'dialog'));
    expect(stack.list().map((e) => e.id)).toEqual(['dialog', 'menu']);
    expect(stack.isTop('menu')).toBe(true);
  });

  it('tooltip ve toast yığına girmez, sabit düzeydedir', () => {
    const stack = createLayerStack();
    stack.push(entry('dialog', 'dialog'));
    stack.push(entry('tip', 'tooltip'));
    stack.push(entry('toasts', 'toast'));
    expect(stack.zIndex('tip')).toBe('var(--z-tooltip)');
    expect(stack.zIndex('toasts')).toBe('var(--z-toast)');
    expect(stack.isTop('dialog')).toBe(true);
  });

  it('Esc yalnız en üsttekini kapatır; kapatılamaz diyalog atlanmaz, Esc orada durur', () => {
    const stack = createLayerStack();
    const closeDialog = vi.fn();
    const closeMenu = vi.fn();
    stack.push(entry('dialog', 'dialog', { onDismiss: closeDialog }));
    const removeMenu = stack.push(entry('menu', 'menu', { onDismiss: closeMenu }));
    expect(stack.escape()).toBe(true);
    expect(closeMenu).toHaveBeenCalledWith('escape');
    expect(closeDialog).not.toHaveBeenCalled();
    removeMenu();
    stack.escape();
    expect(closeDialog).toHaveBeenCalledTimes(1);
  });

  it('Esc önce açık ipucunu kapatır, sonra alttaki diyaloğu', () => {
    const stack = createLayerStack();
    const closeDialog = vi.fn();
    const closeTip = vi.fn();
    stack.push(entry('dialog', 'dialog', { onDismiss: closeDialog }));
    stack.push(entry('tip', 'tooltip', { onDismiss: closeTip, dismissOnOutside: false }));
    stack.escape();
    expect(closeTip).toHaveBeenCalled();
    expect(closeDialog).not.toHaveBeenCalled();
  });

  it('dış basış: içeri basmak, tetikleyiciye basmak ve toast üstüne basmak kapatmaz', () => {
    const stack = createLayerStack();
    const close = vi.fn();
    stack.push(entry('toasts', 'toast', { contains: (t) => t === 'toast-node', dismissOnEscape: false }));
    stack.push(
      entry('menu', 'menu', {
        onDismiss: close,
        contains: (t) => t === 'menu-node',
        ignore: (t) => t === 'trigger',
      }),
    );
    expect(stack.pointerDownOutside('menu-node')).toBe(false);
    expect(stack.pointerDownOutside('trigger')).toBe(false);
    expect(stack.pointerDownOutside('toast-node')).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(stack.pointerDownOutside('page')).toBe(true);
    expect(close).toHaveBeenCalledWith('outside');
  });

  it('dış basış yalnız en üstteki katmanı kapatır (diyalog içindeki menü)', () => {
    const stack = createLayerStack();
    const closeDialog = vi.fn();
    const closeMenu = vi.fn();
    stack.push(entry('dialog', 'dialog', { onDismiss: closeDialog, contains: (t) => t === 'dialog-node' }));
    stack.push(entry('menu', 'menu', { onDismiss: closeMenu, contains: (t) => t === 'menu-node' }));
    stack.pointerDownOutside('dialog-node');
    expect(closeMenu).toHaveBeenCalled();
    expect(closeDialog).not.toHaveBeenCalled();
  });

  it('kapatılamaz katman dış basışla kapanmaz', () => {
    const stack = createLayerStack();
    const close = vi.fn();
    stack.push(entry('dialog', 'dialog', { onDismiss: close, dismissOnOutside: false, contains: () => false }));
    expect(stack.pointerDownOutside('page')).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('aynı kimlik yeniden eklenince tekrarlanmaz ve en üste çıkar; abonelere haber verilir', () => {
    const stack = createLayerStack();
    const listener = vi.fn();
    stack.subscribe(listener);
    stack.push(entry('a', 'dialog'));
    stack.push(entry('b', 'dialog'));
    stack.push(entry('a', 'dialog'));
    expect(stack.list().map((e) => e.id)).toEqual(['b', 'a']);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('konumlandırma', () => {
  const viewport = { width: 1000, height: 800 };
  const floating = { width: 200, height: 120 };

  it('altta yer varsa tetikleyicinin altına, sol kenarı hizalı açılır', () => {
    const pos = computePosition({ x: 100, y: 100, width: 80, height: 32 }, floating, viewport, 'bottom-start', 6);
    expect(pos).toMatchObject({ x: 100, y: 138, side: 'bottom' });
  });

  it('altta yer yoksa üste döner ve büyüme noktası alt kenara taşınır', () => {
    const pos = computePosition({ x: 100, y: 740, width: 80, height: 32 }, floating, viewport, 'bottom-start', 6);
    expect(pos.side).toBe('top');
    expect(pos.y).toBe(740 - 6 - 120);
    expect(pos.origin.endsWith('120px')).toBe(true);
  });

  it('pencere kenarına kenetlenir', () => {
    const pos = computePosition({ x: 960, y: 100, width: 30, height: 30 }, floating, viewport, 'bottom-start', 6);
    expect(pos.x).toBe(1000 - 8 - 200);
  });
});
