// d3 eklemelerinin birim sınamaları (sahte sürücü): pencere yerleştirme, basılı tutma, yapıştırarak yazma, üzerine gelme.
import { describe, expect, it } from 'vitest';
import { createPcControl, fitRect, layoutRect, TUNING, type ControlCall } from './control';
import { createFakeInput } from './input-fake';
import { VK } from './keys';
import { createFakeUia, element, scene, win } from './pc-testkit';
import type { ClipboardPort } from './types';

const NOTEPAD = win(11, 'Adsız - Not Defteri', 'notepad', 'Not Defteri');
const CHROME = win(22, 'Haberler - Google Chrome', 'chrome', 'Google Chrome');
const AREA = { left: 0, top: 0, right: 1920, bottom: 1040 };

describe('pencere yerleşimi (saf işlevler)', () => {
  it('yarılar, çeyrekler, orta ve tam alan çalışma alanını boşluksuz böler', () => {
    expect(layoutRect(AREA, 'left')).toEqual({ left: 0, top: 0, right: 960, bottom: 1040 });
    expect(layoutRect(AREA, 'right')).toEqual({ left: 960, top: 0, right: 1920, bottom: 1040 });
    expect(layoutRect(AREA, 'top').bottom).toBe(layoutRect(AREA, 'bottom').top);
    expect(layoutRect(AREA, 'bottom_right')).toEqual({ left: 960, top: 520, right: 1920, bottom: 1040 });
    expect(layoutRect(AREA, 'full')).toEqual(AREA);
    const center = layoutRect(AREA, 'center');
    expect(center.right - center.left).toBe(1344);
    expect(center.left).toBe(288);
  });

  it('ikinci ekranın (negatif koordinat, farklı boyut) alanında da doğru', () => {
    const second = { left: -2560, top: -200, right: 0, bottom: 1200 };
    expect(layoutRect(second, 'left')).toEqual({ left: -2560, top: -200, right: -1280, bottom: 1200 });
    expect(layoutRect(second, 'right').right).toBe(0);
  });

  it('istenen dikdörtgen alana sığdırılır: taşmaz, çok küçülmez, alandan büyük olamaz', () => {
    expect(fitRect({ left: 1800, top: 900, right: 2600, bottom: 1500 }, AREA)).toEqual({ left: 1120, top: 440, right: 1920, bottom: 1040 });
    expect(fitRect({ left: 10, top: 10, right: 20, bottom: 20 }, AREA)).toEqual({ left: 10, top: 10, right: 250, bottom: 170 });
    expect(fitRect({ left: -500, top: -500, right: 5000, bottom: 5000 }, AREA)).toEqual(AREA);
  });
});

describe('control.arrange', () => {
  it('pencereyi sol yarıya oturtur, sonucu pencerenin gerçek yeriyle doğrular; fare ve klavye kullanmaz', async () => {
    const s = scene([NOTEPAD, CHROME]);
    const result = await s.control.arrange({ window: 'not defteri', layout: 'left' }, s.call);
    expect(result).toMatchObject({ ok: true, verified: true, rect: { left: 0, top: 0, right: 960, bottom: 1040 }, beside: null });
    expect(s.kinds()).toEqual(['place']);
    expect(s.activity.map((event) => `${event.state}:${event.action}`)).toEqual(['start:window', 'end:window']);
  });

  it('yan yana: ikinci pencere karşı yarıya oturur; aynı pencere iki kez verilemez', async () => {
    const s = scene([NOTEPAD, CHROME]);
    const result = await s.control.arrange({ window: 'chrome', layout: 'left', beside: 'not defteri' }, s.call);
    expect(result.ok && result.beside).toMatchObject({ rect: { left: 960, right: 1920 }, verified: true });
    expect(s.input.windows.get(CHROME.hwnd)!.rect.right).toBe(960);
    expect(s.input.windows.get(NOTEPAD.hwnd)!.rect.left).toBe(960);

    expect(await s.control.arrange({ window: 'chrome', layout: 'left', beside: 'chrome' }, s.call)).toMatchObject({ ok: false, reason: 'same_window' });
    // Yan yana yalnız yarılarla anlamlıdır.
    expect(await s.control.arrange({ window: 'chrome', layout: 'center', beside: 'not defteri' }, s.call)).toMatchObject({ ok: false, reason: 'bad_input' });
  });

  it('büyütülmüş ya da simge durumundaki pencere önce geri yüklenir', async () => {
    const maximized = win(11, 'Adsız - Not Defteri', 'notepad', 'Not Defteri', { maximized: true });
    const s = scene([maximized]);
    const result = await s.control.arrange({ layout: 'right' }, s.call);
    expect(result.ok).toBe(true);
    expect(s.kinds()).toEqual(['show', 'place']);
  });

  it('konum ve boyut: verilmeyen değer korunur, alan dışına taşan değer sığdırılır; başka ekrana taşır', async () => {
    const s = scene([NOTEPAD]);
    const moved = await s.control.arrange({ box: { x: 50, y: 60 } }, s.call);
    // Boyut (1000×700) korunur.
    expect(moved).toMatchObject({ ok: true, rect: { left: 50, top: 60, right: 1050, bottom: 760 } });
    const sized = await s.control.arrange({ box: { width: 5000, height: 300 } }, s.call);
    expect(sized.ok && sized.rect).toEqual({ left: 0, top: 60, right: 1920, bottom: 360 });
    const other = { left: 1920, top: 0, right: 4480, bottom: 1400 };
    const second = await s.control.arrange({ area: other, layout: 'top_left' }, s.call);
    expect(second.ok && second.rect).toEqual({ left: 1920, top: 0, right: 3200, bottom: 700 });
  });

  it('yerinden oynamayan pencere için "yerleştirdim" denmez; ekran bulunamazsa durur', async () => {
    const s = scene([NOTEPAD]);
    s.input.state.placeWorks = false;
    expect(await s.control.arrange({ layout: 'left' }, s.call)).toMatchObject({ ok: false, reason: 'not_placed' });
    s.input.state.placeWorks = true;
    s.input.state.monitor = null;
    expect(await s.control.arrange({ layout: 'left' }, s.call)).toMatchObject({ ok: false, reason: 'no_screen' });
  });

  it('hassas pencere, Fuber AI penceresi ve Durdur kilidi yerleştirmeyi de engeller', async () => {
    const bank = win(33, 'Akbank İnternet Şubesi', 'chrome', 'Google Chrome');
    const own = win(44, 'Fuber AI 2', 'fuber ai 2', 'Fuber AI 2', { own: true });
    const s = scene([NOTEPAD, bank, own]);
    expect(await s.control.arrange({ window: 'akbank', layout: 'left' }, s.call)).toMatchObject({ ok: false, reason: 'sensitive' });
    expect(await s.control.arrange({ window: '44', layout: 'left' }, s.call)).toMatchObject({ ok: false, reason: 'own_window' });
    s.control.halt('panic');
    expect(await s.control.arrange({ layout: 'left' }, s.call)).toMatchObject({ ok: false, reason: 'panic' });
    expect(s.control.haltedBy()).toBe('panic');
    expect(s.kinds()).toEqual([]);
  });
});

describe('control.keys: basılı tutma', () => {
  it('tuşları basar, süre boyunca tutar, ters sırayla bırakır', async () => {
    const s = scene([NOTEPAD]);
    const result = await s.control.keys({ keys: 'ctrl+shift+a', holdMs: 300 }, s.call);
    expect(result).toMatchObject({ ok: true, sent: ['ctrl+shift+a'], heldMs: 300 });
    const keys = s.input.events.filter((event) => event.type === 'keys').map((event) => (event.type === 'keys' ? event.keys : []));
    expect(keys[0]).toEqual([
      { vk: VK.CONTROL, down: true },
      { vk: VK.SHIFT, down: true },
      { vk: 0x41, down: true },
    ]);
    expect(keys[1]).toEqual([
      { vk: 0x41, down: false },
      { vk: VK.SHIFT, down: false },
      { vk: VK.CONTROL, down: false },
    ]);
  });

  it('kullanıcı araya girerse tuşlar HEMEN bırakılır (basılı kalan tuş olmaz)', async () => {
    const s = scene([NOTEPAD]);
    let sleeps = 0;
    s.whileSleeping = () => {
      sleeps += 1;
      // Tutma sürerken kullanıcı fareyi oynatır.
      if (s.input.events.some((event) => event.type === 'keys') && sleeps > 6) s.input.state.cursor = { x: 900, y: 500 };
    };
    const result = await s.control.keys({ keys: 'shift', holdMs: 2000 }, s.call);
    expect(result).toMatchObject({ ok: false, reason: 'user_interrupt' });
    const last = s.input.events.filter((event) => event.type === 'keys').at(-1);
    expect(last && last.type === 'keys' && last.keys).toEqual([{ vk: VK.SHIFT, down: false }]);
  });

  it('kendi bastığımız ctrl (sol/sağ kodlarıyla görünür) kullanıcı girdisi sayılmaz', async () => {
    const s = scene([NOTEPAD]);
    s.input.onEvent = (event) => {
      if (event.type !== 'keys') return;
      // Gerçek sistemde basılı ctrl, GetAsyncKeyState'te sol ctrl olarak da görünür.
      for (const key of event.keys) {
        if (key.vk !== VK.CONTROL) continue;
        if (key.down) for (const vk of [VK.CONTROL, VK.LCONTROL]) s.input.state.down.add(vk);
        else for (const vk of [VK.CONTROL, VK.LCONTROL]) s.input.state.down.delete(vk);
      }
    };
    expect(await s.control.keys({ keys: 'ctrl', holdMs: 400 }, s.call)).toMatchObject({ ok: true, heldMs: 400 });
  });

  it('yalnız tek kısayolla ve tekrarsız; pencere değiştiren kısayol tutulmaz; süre üst sınırla kesilir', async () => {
    const s = scene([NOTEPAD]);
    expect(await s.control.keys({ keys: 'ctrl+a ctrl+c', holdMs: 300 }, s.call)).toMatchObject({ ok: false, reason: 'bad_hold' });
    expect(await s.control.keys({ keys: 'shift', holdMs: 300, repeat: 2 }, s.call)).toMatchObject({ ok: false, reason: 'bad_hold' });
    expect(await s.control.keys({ keys: 'alt+tab', holdMs: 300 }, s.call)).toMatchObject({ ok: false, reason: 'bad_hold' });
    expect(s.kinds()).toEqual([]);
    const long = await s.control.keys({ keys: 'shift', holdMs: 60_000 }, s.call);
    expect(long).toMatchObject({ ok: true, heldMs: TUNING.maxHoldMs });
  });
});

/** Panolu sahne: yapıştırma tuşu sahte pencereye panodaki metni "yazar". */
function clipboardScene(initial = 'kullanıcının kopyaladığı') {
  const input = createFakeInput();
  const uia = createFakeUia(input);
  uia.state.windows = [NOTEPAD];
  input.windows.set(NOTEPAD.hwnd, { minimized: false, maximized: false, rect: NOTEPAD.rect });
  input.state.foreground = NOTEPAD.hwnd;
  const writes: string[] = [];
  const board = { text: initial, nonText: false };
  const clipboard: ClipboardPort = {
    readText: () => board.text,
    writeText(text) {
      board.text = text;
      writes.push(text);
    },
    hasNonText: () => board.nonText,
  };
  input.onEvent = (event) => {
    if (event.type !== 'keys' || event.hwnd === null) return;
    const pasted = event.keys.some((key) => key.vk === 0x56 && key.down) && event.keys.some((key) => key.vk === VK.CONTROL && key.down);
    if (pasted) input.typed.set(event.hwnd, (input.typed.get(event.hwnd) ?? '') + board.text.replace(/\r\n/g, '\n'));
  };
  const abort = new AbortController();
  const call: ControlCall = { signal: abort.signal, approve: async () => false };
  const control = createPcControl({ input, uia, clipboard, sleep: async (ms) => input.advance(ms) });
  return { input, uia, board, writes, control, call };
}

describe('control.type: yapıştırarak yazma', () => {
  it('uzun metin panodan yapıştırılır, alanda doğrulanır ve pano ESKİ haline döner', async () => {
    const s = clipboardScene();
    const text = `Türkçe uzun metin: çğıöşü ÇĞİÖŞÜ.\n${'satır '.repeat(120)}`;
    const result = await s.control.type({ text }, s.call);
    expect(result).toMatchObject({ ok: true, method: 'paste', typed: text.length, verified: true });
    expect(s.input.events.filter((event) => event.type === 'text')).toHaveLength(0);
    expect(s.board.text).toBe('kullanıcının kopyaladığı');
    // Pano Windows satır sonlarıyla doldurulur.
    expect(s.writes[0]).toContain('\r\n');
  });

  it('kısa metin tuş tuş yazılır; pano hiç ellenmez', async () => {
    const s = clipboardScene();
    const result = await s.control.type({ text: 'kısa çğıöşü' }, s.call);
    expect(result).toMatchObject({ ok: true, method: 'keys', verified: true });
    expect(s.writes).toEqual([]);
  });

  it('panoda görüntü/dosya varken uzun metin tuş tuş yazılır; açıkça yapıştırma istenirse reddedilir', async () => {
    const s = clipboardScene();
    s.board.nonText = true;
    const text = 'a'.repeat(TUNING.pasteOver + 50);
    expect(await s.control.type({ text }, s.call)).toMatchObject({ ok: true, method: 'keys' });
    expect(await s.control.type({ text: 'x', method: 'paste' }, s.call)).toMatchObject({ ok: false, reason: 'clipboard_busy' });
    expect(s.writes).toEqual([]);
  });

  it('parola alanına yapıştırılmaz ve pano değişmez; pano yoksa yapıştırma dürüstçe reddedilir', async () => {
    const s = clipboardScene();
    s.uia.state.focused = { password: true };
    expect(await s.control.type({ text: 'gizli', method: 'paste' }, s.call)).toMatchObject({ ok: false, reason: 'password' });
    expect(s.writes).toEqual([]);

    const plain = scene([NOTEPAD]);
    expect(await plain.control.type({ text: 'x', method: 'paste' }, plain.call)).toMatchObject({ ok: false, reason: 'no_clipboard' });
    // Pano yokken uzun metin de tuş tuş gider (sınır: 4000).
    expect(await plain.control.type({ text: 'b'.repeat(600) }, plain.call)).toMatchObject({ ok: true, method: 'keys' });
    expect(await plain.control.type({ text: 'b'.repeat(4001) }, plain.call)).toMatchObject({ ok: false, reason: 'bad_input' });
  });

  it('yapıştırma sırasında odak kayarsa tuş gönderilmez ve pano yine geri konur', async () => {
    const s = clipboardScene();
    const original = s.board.text;
    let armed = false;
    const realWrite = s.control;
    void realWrite;
    // Panoya yazıldıktan hemen sonra başka pencere öne geçer.
    const other = win(22, 'Başka', 'chrome', 'Google Chrome');
    s.uia.state.windows.push(other);
    s.input.windows.set(other.hwnd, { minimized: false, maximized: false, rect: other.rect });
    const board = s.board;
    Object.defineProperty(board, 'text', {
      get: () => (board as unknown as { value: string }).value,
      set(value: string) {
        (board as unknown as { value: string }).value = value;
        if (armed) s.input.state.foreground = other.hwnd;
      },
      configurable: true,
    });
    board.text = original;
    armed = true;
    const result = await s.control.type({ text: 'x'.repeat(10), method: 'paste' }, s.call);
    armed = false;
    expect(result).toMatchObject({ ok: false, reason: 'focus_lost' });
    expect(s.input.events.filter((event) => event.type === 'keys')).toHaveLength(0);
    expect(board.text).toBe(original);
  });
});

describe('control.click: üzerine gelme ve tür', () => {
  it('hover: imleç öğeye gider, düğmeye basılmaz, erişilebilirlik deseni çağrılmaz; onay da istenmez', async () => {
    const s = scene([NOTEPAD]);
    s.uia.state.elements.set(NOTEPAD.hwnd, [element(1, 'Sil')]);
    const result = await s.control.click({ name: 'sil', hover: true }, s.call);
    expect(result).toMatchObject({ ok: true, method: 'hover', label: 'Sil' });
    expect(s.kinds().filter((kind) => kind === 'button')).toEqual([]);
    expect(s.kinds()).toContain('move');
    expect(s.uia.invoked).toEqual([]);
    expect(s.approvals).toEqual([]);
    expect(s.input.state.cursor).toEqual({ x: 350, y: 320 });
  });

  it('role yardımcıya iletilir (aynı adlı düğme ve menü ayrışır)', async () => {
    const s = scene([NOTEPAD]);
    const seen: Array<string | undefined> = [];
    const find = s.uia.find.bind(s.uia);
    s.uia.find = async (hwnd, query) => {
      seen.push(query.role);
      return find(hwnd, query);
    };
    s.uia.state.elements.set(NOTEPAD.hwnd, [element(1, 'Dosya', 'MenuItem', { patterns: ['expand'] })]);
    const result = await s.control.click({ name: 'dosya', role: 'MenuItem' }, s.call);
    expect(result).toMatchObject({ ok: true, method: 'uia', role: 'MenuItem' });
    expect(seen).toEqual(['MenuItem']);
  });
});
