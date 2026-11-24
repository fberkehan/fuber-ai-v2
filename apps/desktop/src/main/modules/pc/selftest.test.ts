// Fare ve klavye sınamasının birim sınaması: SAHTE sürücü ve sahte pencere okuyucusu üzerinde bir "Not Defteri benzetimi".
// Gerçek girdi üretilmez. Burada kanıtlanan: adımların sırası, her adımdaki ön pencere bekçisi, kesilince girdi üretmeyi
// bırakması, yalnız kendi sekmesini kapatması ve geçici dosyayı silmesi.
import { describe, expect, it } from 'vitest';
import { createPcControl } from './control';
import { createFakeInput, type FakeInput } from './input-fake';
import { VK } from './keys';
import { createFakeUia, element, win, type FakeUia } from './pc-testkit';
import { runSelftest, SELFTEST_PASTED, SELFTEST_STEPS, SELFTEST_TYPED, type SelftestDeps } from './selftest';
import type { ClipboardPort, SelftestStep } from './types';

const MARKER = 'Fuber-sinama-abc123';
const HWND = 700;

interface Sim {
  input: FakeInput;
  uia: FakeUia;
  deps: SelftestDeps;
  files: Map<string, string>;
  board: { text: string; nonText: boolean };
  launched: string[];
  steps: SelftestStep[];
  options: {
    /** Dosya kullanıcının açık Not Defteri penceresinde sekme olarak açılsın. */
    asTab: boolean;
    /** Sekmeli (Windows 11) Not Defteri. */
    tabbed: boolean;
    /** Kapatırken kaydetme sorusu çıksın. */
    savePrompt: boolean;
    /** Pencere hiç açılmasın. */
    neverOpens: boolean;
    menuName: string | null;
  };
  /** Belgenin o anki metni. */
  text(): string;
  abort: AbortController;
}

function sim(overrides: Partial<Sim['options']> = {}): Sim {
  const options: Sim['options'] = { asTab: false, tabbed: true, savePrompt: false, neverOpens: false, menuName: 'Görünüm', ...overrides };
  const input = createFakeInput();
  const uia = createFakeUia(input);
  const files = new Map<string, string>();
  const launched: string[] = [];
  const steps: SelftestStep[] = [];
  const board = { text: 'kullanıcının panosu', nonText: false };
  const clipboard: ClipboardPort = {
    readText: () => board.text,
    writeText: (text) => void (board.text = text),
    hasNonText: () => board.nonText,
  };
  // Kullanıcının kendi penceresi (öndeki): sınama ona dokunmamalı.
  const user = win(100, 'Önemli notlar - Not Defteri', 'notepad', 'Not Defteri', { pid: 4242 });
  uia.state.windows = [user];
  input.windows.set(user.hwnd, { minimized: false, maximized: false, rect: user.rect });
  input.state.foreground = user.hwnd;
  input.state.cursor = { x: 5, y: 5 };

  input.state.closeWorks = !options.savePrompt;
  let selected = false;
  let promptOpen = false;
  const title = () => `${MARKER}.txt - Not Defteri`;
  const hwnd = options.asTab ? user.hwnd : HWND;
  const closeTab = () => {
    if (options.asTab) {
      uia.state.windows = uia.state.windows.map((window) => (window.hwnd === hwnd ? { ...window, title: user.title } : window));
    } else {
      uia.state.windows = uia.state.windows.filter((window) => window.hwnd !== hwnd);
      input.windows.delete(hwnd);
      if (input.state.foreground === hwnd) input.state.foreground = user.hwnd;
    }
  };
  const tryClose = () => {
    if (options.savePrompt && !promptOpen) {
      promptOpen = true;
      uia.state.elements.set(hwnd, [...(uia.state.elements.get(hwnd) ?? []), element(90, 'Kaydetme', 'Button')]);
      return;
    }
    closeTab();
  };
  // Not Defteri benzetimi: tuşlara ve kapatma isteğine tepki verir.
  input.onEvent = (event) => {
    if (event.type === 'close' && event.hwnd === hwnd) {
      // Kaydetme sorusu çıkacaksa pencere kapanmaz (sahte sürücü de silmez: `closeWorks`).
      tryClose();
      return;
    }
    if (event.type === 'text' && event.hwnd === hwnd && selected) {
      input.typed.set(hwnd, event.text);
      selected = false;
      return;
    }
    if (event.type !== 'keys' || event.hwnd !== hwnd) return;
    const down = (vk: number) => event.keys.some((key) => key.vk === vk && key.down);
    const ctrl = down(VK.CONTROL);
    if (ctrl && down(0x41)) selected = true;
    else if (ctrl && down(0x56)) {
      const pasted = board.text.replace(/\r\n/g, '\n');
      input.typed.set(hwnd, selected ? pasted : (input.typed.get(hwnd) ?? '') + pasted);
      selected = false;
    } else if (ctrl && down(0x57)) tryClose();
    else if (down(VK.DELETE) && selected) {
      input.typed.set(hwnd, '');
      selected = false;
    }
  };
  // "Kaydetme" düğmesi erişilebilirlik deseniyle seçilince sekme kapanır.
  const invoke = uia.invoke.bind(uia);
  uia.invoke = async (ref) => {
    const result = await invoke(ref);
    if (ref === 90) closeTab();
    return result;
  };

  const control = createPcControl({ input, uia, clipboard, sleep: async (ms) => input.advance(ms) });
  const abort = new AbortController();
  const deps: SelftestDeps = {
    control,
    uia,
    input,
    sleep: async (ms) => input.advance(ms),
    signal: abort.signal,
    token: () => 'abc123',
    openTimeoutMs: 2000,
    async createFile(name) {
      const file = `C:\\Temp\\${name}`;
      files.set(file, '');
      return file;
    },
    async removeFile(file) {
      files.delete(file);
    },
    async launchNotepad(file) {
      launched.push(file);
      if (options.neverOpens) return { ok: true, error: null };
      const elements = [
        ...(options.menuName ? [element(1, options.menuName, 'MenuItem', { patterns: ['expand'] })] : []),
        ...(options.tabbed ? [element(2, `${MARKER}.txt`, 'TabItem', { patterns: ['select'] })] : []),
        // Yazı alanı: türüyle bulunur (öğe bekleme adımı) ve fareyle tıklanır (deseni yoktur).
        element(3, 'Metin düzenleyici', 'Document', { patterns: [] }),
      ];
      if (options.asTab) {
        uia.state.windows = uia.state.windows.map((window) => (window.hwnd === hwnd ? { ...window, title: title() } : window));
      } else {
        const window = win(hwnd, title(), 'notepad', 'Not Defteri', { pid: 4242 });
        uia.state.windows = [...uia.state.windows, window];
        input.windows.set(hwnd, { minimized: false, maximized: false, rect: window.rect });
      }
      uia.state.elements.set(hwnd, elements);
      input.typed.set(hwnd, '');
      return { ok: true, error: null };
    },
    onStep: (step) => void steps.push(step),
  };
  return { input, uia, deps, files, board, launched, steps, options, text: () => input.typed.get(hwnd) ?? '', abort };
}

const statuses = (steps: SelftestStep[]) => Object.fromEntries(steps.map((step) => [step.id, step.status]));

describe('fare ve klavye sınaması (sahte Not Defteri)', () => {
  it('bütün adımlar geçer: açar, öne getirir, tıklar, Türkçe yazar, seçer, yapıştırır, menüye adıyla tıklar, taşır, kaydetmeden kapatır, temizler', async () => {
    const s = sim();
    const report = await runSelftest(s.deps);
    expect(report.steps.map((step) => step.id)).toEqual([...SELFTEST_STEPS]);
    expect(statuses(report.steps)).toEqual(Object.fromEntries(SELFTEST_STEPS.map((id) => [id, 'ok'])));
    expect(report).toMatchObject({ ok: true, stopped: null });
    // Adımlar arayüze tek tek bildirildi.
    expect(s.steps).toHaveLength(SELFTEST_STEPS.length);
    // Türkçe cümle birebir gitti (tuş tuş), sonra seçimin üzerine yapıştırıldı.
    const typed = s.input.events.filter((event) => event.type === 'text').map((event) => (event.type === 'text' ? event.text : '')).join('');
    expect(typed).toBe(SELFTEST_TYPED);
    expect(report.steps.find((step) => step.id === 'paste')!.detail).toContain('seçme de doğrulandı');
    // Menü erişilebilirlik deseniyle açıldı ve aynı yoldan kapatıldı (fare oynamadan).
    expect(s.uia.invoked.filter((ref) => ref === 1)).toHaveLength(2);
    // Kapanış: belge boşaltıldı, yalnız sekme kapatıldı (ctrl+w); pencere kapatma isteği gönderilmedi.
    expect(s.text()).toBe('');
    expect(s.input.events.some((event) => event.type === 'close')).toBe(false);
    // Pano eski haline döndü, geçici dosya silindi.
    expect(s.board.text).toBe('kullanıcının panosu');
    expect(s.files.size).toBe(0);
    expect(s.launched).toEqual([`C:\\Temp\\${MARKER}.txt`]);
  });

  it('her girdi sınama penceresine gider: kullanıcının öndeki penceresine tek olay düşmez', async () => {
    const s = sim();
    await runSelftest(s.deps);
    const foreign = s.input.events.filter((event) => (event.type === 'text' || event.type === 'keys') && event.hwnd !== HWND);
    expect(foreign).toEqual([]);
    const touched = new Set(s.input.events.flatMap((event) => ('hwnd' in event && event.type !== 'text' && event.type !== 'keys' ? [event.hwnd] : [])));
    expect([...touched]).toEqual([HWND]);
  });

  it('dosya kullanıcının açık Not Defteri’nde SEKME olarak açılırsa: yalnız o sekme kapanır, pencere eski yerine konur', async () => {
    const s = sim({ asTab: true });
    const before = { ...s.input.windows.get(100)!.rect };
    const report = await runSelftest(s.deps);
    expect(report.ok).toBe(true);
    expect(report.steps.find((step) => step.id === 'open')!.detail).toContain('yeni sekme');
    expect(report.steps.find((step) => step.id === 'close')!.detail).toContain('eski yerine kondu');
    // Kullanıcının penceresi duruyor, yeri aynı, kapatma isteği yok.
    expect(s.input.windows.has(100)).toBe(true);
    expect(s.input.windows.get(100)!.rect).toEqual(before);
    expect(s.input.events.some((event) => event.type === 'close')).toBe(false);
    expect(s.uia.state.windows.find((window) => window.hwnd === 100)!.title).toBe('Önemli notlar - Not Defteri');
  });

  it('sekmesiz (eski) Not Defteri: kendi penceresine kibar kapatma isteği gönderir; kaydetme sorusunu “Kaydetme” ile yanıtlar', async () => {
    const s = sim({ tabbed: false, savePrompt: true });
    const report = await runSelftest(s.deps);
    expect(statuses(report.steps).close).toBe('ok');
    expect(report.steps.find((step) => step.id === 'close')!.detail).toContain('kaydetme');
    expect(s.input.events.filter((event) => event.type === 'close')).toEqual([{ type: 'close', hwnd: HWND }]);
    expect(s.uia.invoked).toContain(90);
    expect(s.input.windows.has(HWND)).toBe(false);
  });

  it('Not Defteri açılmazsa: hiçbir girdi üretilmez, kalan adımlar atlanır, dosya yine silinir', async () => {
    const s = sim({ neverOpens: true });
    const report = await runSelftest(s.deps);
    expect(report.ok).toBe(false);
    expect(statuses(report.steps)).toMatchObject({ prepare: 'ok', open: 'fail', focus: 'skipped', type: 'skipped', close: 'skipped', cleanup: 'ok' });
    expect(s.input.events).toEqual([]);
    expect(s.files.size).toBe(0);
  });

  it('kullanıcı fareye dokunursa: o adımda durur, sonraki adımlar girdi üretmez', async () => {
    const s = sim();
    // Yazma sürerken kullanıcı fareyi oynatır.
    const original = s.input.onEvent!;
    let moved = false;
    s.input.onEvent = (event, index) => {
      original(event, index);
      if (!moved && event.type === 'text') {
        moved = true;
        s.input.state.cursor = { x: 1500, y: 900 };
      }
    };
    const report = await runSelftest(s.deps);
    expect(report).toMatchObject({ ok: false, stopped: 'user' });
    expect(statuses(report.steps)).toMatchObject({ type: 'fail', select: 'skipped', paste: 'skipped', uia: 'skipped', move: 'skipped' });
    const after = s.input.events.slice(s.input.events.findIndex((event) => event.type === 'text') + 1);
    // Kesildikten sonra tek tuş, tek tıklama, tek taşıma yok.
    expect(after.filter((event) => ['text', 'keys', 'button', 'move', 'place'].includes(event.type))).toEqual([]);
    // Sekme açık kaldı: dürüstçe söylenir.
    expect(report.steps.find((step) => step.id === 'close')!.status).toBe('warn');
    expect(report.steps.find((step) => step.id === 'close')!.detail).toContain('AÇIK KALDI');
  });

  it('araya başka bir pencere girerse (beklenmedik pencere önde): girdi adımları durur', async () => {
    const s = sim();
    const original = s.input.onEvent!;
    s.input.onEvent = (event, index) => {
      original(event, index);
      // Seçme tuşundan hemen sonra bir güncelleme penceresi öne geçer.
      if (event.type === 'keys' && event.keys.some((key) => key.vk === 0x41)) {
        const popup = win(900, 'Windows Update', 'systemsettings', 'Ayarlar');
        s.uia.state.windows = [...s.uia.state.windows, popup];
        s.input.windows.set(900, { minimized: false, maximized: false, rect: popup.rect });
        s.input.state.foreground = 900;
      }
    };
    const report = await runSelftest(s.deps);
    expect(report.stopped).toBe('foreign');
    expect(statuses(report.steps)).toMatchObject({ select: 'ok', paste: 'skipped', uia: 'skipped', move: 'skipped' });
    // Öne geçen pencereye hiçbir olay gitmedi.
    expect(s.input.events.filter((event) => 'hwnd' in event && event.hwnd === 900)).toEqual([]);
  });

  it('sekme başlığı değişirse (kullanıcı başka sekmeye geçti) durur: yabancı sekmeye yazmaz', async () => {
    const s = sim();
    const original = s.input.onEvent!;
    let switched = false;
    s.input.onEvent = (event, index) => {
      original(event, index);
      if (!switched && event.type === 'button' && !event.down) {
        switched = true;
        s.uia.state.windows = s.uia.state.windows.map((window) => (window.hwnd === HWND ? { ...window, title: 'Vergi notlarım - Not Defteri' } : window));
      }
    };
    const report = await runSelftest(s.deps);
    expect(report.stopped).toBe('foreign');
    expect(statuses(report.steps)).toMatchObject({ click: 'ok', type: 'skipped' });
    expect(s.input.events.filter((event) => event.type === 'text')).toEqual([]);
  });

  it('Durdur (acil dur) sınamayı keser; panoda görüntü varsa yapıştırma atlanır, menü bulunamazsa uyarı verir', async () => {
    const stopped = sim();
    stopped.deps.control.halt('panic');
    const first = await runSelftest(stopped.deps);
    expect(first.ok).toBe(false);
    expect(first.steps[0]).toMatchObject({ id: 'prepare', status: 'fail' });
    expect(stopped.input.events).toEqual([]);
    expect(stopped.launched).toEqual([]);

    const s = sim({ menuName: null });
    s.board.nonText = true;
    const report = await runSelftest(s.deps);
    expect(statuses(report.steps)).toMatchObject({ paste: 'skipped', uia: 'warn', move: 'ok', close: 'ok' });
    // Atlanan adım sınamayı "kaldı" yapar: eksik kanıt geçmiş sayılmaz.
    expect(report.ok).toBe(false);
    expect(SELFTEST_PASTED.length).toBeGreaterThan(10);
  });
});
