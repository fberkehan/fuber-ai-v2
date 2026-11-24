// v1'de gelen şikâyet: "asistan Chrome sekmelerimi kapatıyor/bozuyor". v1'deki kök neden ada penceresiydi (720×460
// saydam pencere); yine de bilgisayarı kullanma araçlarının KENDİSİ onay olmadan sekme/pencere kapatamamalı ve açık
// sekmenin üstüne yazamamalı. Bu dosya o güvenceyi sahte sürücüyle sınar: onay verilmeyen hiçbir senaryoda sürücüye
// sekme kapatabilecek bir olay gitmez.
import { describe, expect, it } from 'vitest';
import { glideDuration, glidePoint } from './control';
import type { InputEvent } from './input-fake';
import { VK } from './keys';
import { element, scene, win, type Scene } from './pc-testkit';

const CHROME = win(22, 'Gmail - Google Chrome', 'chrome', 'Google Chrome');
const EDGE = win(23, 'Haberler - Microsoft Edge', 'msedge', 'Microsoft Edge');

/** Sekme ya da pencere kapatabilecek olay: Ctrl+W, Ctrl+F4, Alt+F4, Ctrl+Shift+W, orta tık, pencere kapatma isteği. */
function couldCloseTab(event: InputEvent): boolean {
  if (event.type === 'close') return true;
  if (event.type === 'button') return event.button === 'middle';
  if (event.type !== 'keys') return false;
  const down = new Set(event.keys.filter((key) => key.down).map((key) => key.vk));
  const ctrl = down.has(VK.CONTROL);
  const alt = down.has(VK.MENU);
  return (ctrl && down.has(0x57)) || (ctrl && down.has(VK.F4)) || (alt && down.has(VK.F4)) || (ctrl && down.has(0x51));
}

async function attempts(s: Scene): Promise<void> {
  const c = s.control;
  await c.keys({ keys: 'ctrl+w' }, s.call);
  await c.keys({ keys: 'ctrl+f4' }, s.call);
  await c.keys({ keys: 'alt+f4' }, s.call);
  await c.keys({ keys: 'ctrl+shift+w' }, s.call);
  await c.keys({ keys: 'ctrl+q' }, s.call);
  await c.keys({ keys: 'ctrl+t ctrl+w' }, s.call);
  await c.keys({ keys: 'ctrl+w', repeat: 5 }, s.call);
  await c.windowAction({ action: 'close' }, s.call);
  await c.click({ name: 'kapat' }, s.call);
  await c.click({ name: 'sekmeyi kapat' }, s.call);
  await c.click({ name: 'close' }, s.call);
  await c.click({ name: 'gmail', button: 'middle' }, s.call);
  await c.click({ point: { x: 300, y: 115 } }, s.call);
  await c.click({ point: { x: 300, y: 115 }, button: 'middle' }, s.call);
}

describe('sekme güvencesi', () => {
  it('onay verilmedikçe hiçbir araç sekme ya da pencere kapatabilecek girdi üretmez', async () => {
    for (const browser of [CHROME, EDGE]) {
      const s = scene([browser]);
      s.uia.state.elements.set(browser.hwnd, [
        element(1, 'Kapat', 'Button'),
        element(2, 'Sekmeyi kapat', 'Button'),
        element(3, 'Close', 'Button'),
        element(4, 'Gmail', 'TabItem', { patterns: ['select'] }),
      ]);
      // Koordinat sekme şeridine düşüyor: adı okunan kapatma düğmesi.
      s.uia.state.at = { role: 'Button', name: 'Kapat', parentRole: 'TabItem', parentName: 'Gmail' };
      await attempts(s);
      expect(s.input.events.filter(couldCloseTab), browser.app).toEqual([]);
      expect(s.uia.invoked, browser.app).toEqual([]);
      // Her deneme kullanıcıya soruldu (ve sahnede yanıt "hayır").
      expect(s.approvals.length).toBeGreaterThanOrEqual(12);
    }
  });

  it('adı okunamayan sekme şeridi noktası da onaysız tıklanmaz (kapatma düğmesi olabilir)', async () => {
    const s = scene([CHROME]);
    s.uia.state.at = { known: false, role: '', name: '', parentRole: '', parentName: '' };
    await s.control.click({ point: { x: 640, y: 118 } }, s.call);
    s.uia.state.fails = false;
    expect(s.input.events.filter((event) => event.type === 'button')).toEqual([]);
    expect(s.approvals).toHaveLength(1);
  });

  it('sekmeler arasında geçmek ve yeni sekme açmak serbesttir; yazı yalnız odaktaki alana gider', async () => {
    const s = scene([CHROME]);
    s.uia.state.elements.set(CHROME.hwnd, [element(4, 'Takvim', 'TabItem', { patterns: ['select'] })]);
    expect((await s.control.click({ name: 'takvim' }, s.call)).ok).toBe(true);
    expect((await s.control.keys({ keys: 'ctrl+tab' }, s.call)).ok).toBe(true);
    expect((await s.control.keys({ keys: 'ctrl+t' }, s.call)).ok).toBe(true);
    expect((await s.control.type({ text: 'rize hava durumu' }, s.call)).ok).toBe(true);
    expect(s.approvals).toEqual([]);
    expect(s.input.events.filter(couldCloseTab)).toEqual([]);
    expect(s.uia.invoked).toEqual([4]);
  });
});

describe('imleç yolu (saf işlevler)', () => {
  it('süre uzaklıkla artar ve 60–320 ms arasında kalır', () => {
    expect(glideDuration(0)).toBe(60);
    expect(glideDuration(400)).toBe(140);
    expect(glideDuration(5000)).toBe(320);
    expect(glideDuration(100)).toBeLessThan(glideDuration(600));
  });

  it('yol baştan başlar, hedefte TAM biter, arada kavis yapar ve ışınlanmaz', () => {
    const from = { x: 100, y: 100 };
    const to = { x: 900, y: 500 };
    expect(glidePoint(from, to, 0)).toEqual(from);
    expect(glidePoint(from, to, 1)).toEqual(to);
    expect(glidePoint(from, to, 7)).toEqual(to);
    const middle = glidePoint(from, to, 0.5);
    // Orta nokta düz çizginin üstünde değil (dik yönde kayma).
    expect(middle).not.toEqual({ x: 500, y: 300 });
    let previous = from;
    let longest = 0;
    for (let step = 1; step <= 40; step++) {
      const point = glidePoint(from, to, step / 40);
      longest = Math.max(longest, Math.hypot(point.x - previous.x, point.y - previous.y));
      previous = point;
    }
    expect(longest).toBeLessThan(80);
    // Aynı noktaya gitmek yerinde kalmaktır.
    expect(glidePoint(from, from, 0.3)).toEqual(from);
  });

  it('yatay kaydırma tekerleğin yatay olayını kullanır', async () => {
    const s = scene([CHROME]);
    const result = await s.control.scroll({ direction: 'right', pages: 0.3 }, s.call);
    expect(result.ok).toBe(true);
    const wheels = s.input.events.filter((event) => event.type === 'wheel');
    expect(wheels.length).toBeGreaterThan(0);
    expect(wheels.every((event) => event.type === 'wheel' && event.horizontal && event.notches === 1)).toBe(true);
  });
});
