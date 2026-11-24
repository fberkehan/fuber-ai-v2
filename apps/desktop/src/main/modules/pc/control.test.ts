// Bilgisayarı kullanma motoru: SAHTE girdi sürücüsü ve SAHTE pencere okuyucusuyla. Hiçbir sınama gerçek tuş basmaz.
import { describe, expect, it } from 'vitest';
import { TUNING } from './control';
import { VK } from './keys';
import { element, scene, win } from './pc-testkit';

const NOTEPAD = win(11, 'Adsız - Not Defteri', 'notepad', 'Not Defteri');
const CHROME = win(22, 'Rize hava durumu - Google Chrome', 'chrome', 'Google Chrome');
const WHATSAPP = win(33, 'WhatsApp', 'whatsapp', 'WhatsApp');
const TERMINAL = win(44, 'PowerShell', 'windowsterminal', 'Windows Terminal');
const TURKISH = 'Rize hava durumu: ığüşöç İĞÜŞÖÇ çok güzel 🙂';

describe('pc_type: metin yazma', () => {
  it('Türkçe metni öndeki pencereye küçük parçalarla yazar ve alandan doğrular', async () => {
    const s = scene([NOTEPAD, CHROME]);
    const result = await s.control.type({ text: TURKISH }, s.call);
    expect(result).toMatchObject({ ok: true, typed: TURKISH.length, verified: true, entered: false });
    expect(s.text()).toBe(TURKISH);
    // Hepsi hedef pencereye gitti; parçalar en çok 3 kod birimi (vekil çift bölünmez).
    const texts = s.input.events.filter((event) => event.type === 'text');
    expect(texts.every((event) => event.type === 'text' && event.hwnd === NOTEPAD.hwnd && event.text.length <= TUNING.typeChunk + 1)).toBe(true);
    expect(texts.some((event) => event.type === 'text' && event.text.includes('🙂'))).toBe(true);
    // Katman için görsel olaylar (`fx`: hedef alan, yazma ilerlemesi) arada yayınlanır; yaşam döngüsü yine başla → bitir.
    expect(s.activity.map((event) => event.state).filter((state) => state !== 'fx')).toEqual(['start', 'end']);
    expect(s.activity.some((event) => event.fx?.kind === 'typing' && event.fx.chars === TURKISH.length)).toBe(true);
  });

  it('adı verilen pencere önde değilse önce öne getirir; getiremezse TEK TUŞ basmaz', async () => {
    const s = scene([NOTEPAD, CHROME]);
    const ok = await s.control.type({ text: 'merhaba', window: 'chrome' }, s.call);
    expect(ok).toMatchObject({ ok: true, window: { hwnd: CHROME.hwnd } });
    expect(s.input.events[0]).toEqual({ type: 'activate', hwnd: CHROME.hwnd });
    expect(s.input.typed.get(CHROME.hwnd)).toBe('merhaba');
    expect(s.input.typed.get(NOTEPAD.hwnd)).toBeUndefined();

    const stuck = scene([NOTEPAD, CHROME]);
    stuck.input.state.activateWorks = false;
    const refused = await stuck.control.type({ text: 'merhaba', window: 'chrome' }, stuck.call);
    expect(refused).toMatchObject({ ok: false, reason: 'focus_failed' });
    // Öne getirme bir kez yeniden istenir (Windows ilkini yutabilir); yine olmazsa tek tuş basılmaz.
    expect(stuck.kinds()).toEqual(['activate', 'activate']);
  });

  it('parola alanına, kart alanına ve türü okunamayan giriş sayfasına yazmaz', async () => {
    const password = scene([CHROME]);
    password.uia.state.focused = { password: true, value: null };
    expect(await password.control.type({ text: 'gizli' }, password.call)).toMatchObject({ ok: false, reason: 'password' });
    expect(password.kinds()).toEqual([]);

    const named = scene([CHROME]);
    named.uia.state.focused = { name: 'Şifre' };
    expect(await named.control.type({ text: 'gizli' }, named.call)).toMatchObject({ ok: false, reason: 'password' });

    const card = scene([CHROME]);
    card.uia.state.focused = { name: 'Kart numarası' };
    expect(await card.control.type({ text: '4111' }, card.call)).toMatchObject({ ok: false, reason: 'card' });

    const login = scene([win(22, 'Giriş yap - Örnek', 'chrome', 'Google Chrome')]);
    login.uia.state.focused = { role: 'Pane', name: '' };
    expect(await login.control.type({ text: 'ad' }, login.call)).toMatchObject({ ok: false, reason: 'unknown_field' });

    const blind = scene([NOTEPAD]);
    blind.uia.state.focusedFails = true;
    expect(await blind.control.type({ text: 'ad' }, blind.call)).toMatchObject({ ok: false, reason: 'unknown_field' });
    expect([...password.kinds(), ...named.kinds(), ...card.kinds(), ...login.kinds(), ...blind.kinds()]).toEqual([]);
  });

  it('parola yöneticisi, banka ve kendi penceremizde çalışmaz', async () => {
    for (const window of [
      win(1, 'Kasa', 'bitwarden', 'Bitwarden'),
      win(2, 'Garanti BBVA İnternet Şubesi - Google Chrome', 'chrome', 'Google Chrome'),
      win(3, 'Windows Güvenliği', 'credentialuibroker', 'Credential UI'),
    ]) {
      const s = scene([window]);
      expect(await s.control.type({ text: 'x' }, s.call)).toMatchObject({ ok: false, reason: 'sensitive' });
      expect(await s.control.click({ name: 'Tamam' }, s.call)).toMatchObject({ ok: false, reason: 'sensitive' });
      expect(await s.control.keys({ keys: 'enter' }, s.call)).toMatchObject({ ok: false, reason: 'sensitive' });
      expect(s.kinds()).toEqual([]);
    }
    const own = scene([win(5, 'Fuber AI 2', 'fuber ai 2', 'Fuber AI 2', { own: true })]);
    expect(await own.control.type({ text: 'x', window: 'fuber' }, own.call)).toMatchObject({ ok: false, reason: 'own_window' });
    // Ad verilmezse kendi penceremiz atlanır: başka pencere yoksa hedef de yoktur.
    expect(await own.control.type({ text: 'x' }, own.call)).toMatchObject({ ok: false, reason: 'no_target' });
  });

  it('kullanıcı fareyi oynatınca O ADIMDA durur; ardından gelen eylem de bir süre başlamaz', async () => {
    const s = scene([NOTEPAD]);
    s.input.onEvent = (_event, index) => {
      if (index === 2) s.input.state.cursor = { x: 900, y: 120 };
    };
    const long = 'bu cümlenin tamamı yazılmamalı; kullanıcı fareyi aldığı an durulur ve metnin gerisi gönderilmez';
    const result = await s.control.type({ text: long }, s.call);
    expect(result).toMatchObject({ ok: false, reason: 'user_interrupt', partial: 3 * TUNING.typeChunk });
    expect(s.text()).toBe(long.slice(0, 3 * TUNING.typeChunk));
    expect(s.activity.map((event) => event.state).filter((state) => state !== 'fx')).toEqual(['start', 'interrupted', 'end']);

    s.input.onEvent = null;
    const next = await s.control.keys({ keys: 'enter' }, s.call);
    expect(next).toMatchObject({ ok: false, reason: 'user_interrupt' });
    expect(s.kinds().filter((kind) => kind === 'keys')).toEqual([]);

    // Kesme süresi dolunca (ve kullanıcı durunca) yeniden çalışır.
    s.input.advance(TUNING.haltUserMs + 1);
    expect((await s.control.keys({ keys: 'enter' }, s.call)).ok).toBe(true);
  });

  it('kullanıcı bir tuşa basınca ya da yabancı girdi gelince durur', async () => {
    const key = scene([NOTEPAD]);
    key.input.onEvent = (_event, index) => {
      if (index === 1) key.input.state.down.add(0x41);
    };
    expect(await key.control.type({ text: 'uzun bir metin: kullanıcı tuşa basınca yarıda kalmalı' }, key.call)).toMatchObject({ ok: false, reason: 'user_interrupt', partial: 2 * TUNING.typeChunk });

    // Tekerlek gibi konumu değiştirmeyen girdi: sistemin son girdi anı bizim girdimizden belirgin sonra.
    const wheel = scene([NOTEPAD]);
    let chunks = 0;
    wheel.whileSleeping = () => {
      chunks += 1;
      if (chunks === 8) {
        wheel.input.advance(TUNING.inputToleranceMs + 30);
        wheel.input.userInput();
      }
    };
    const turning = 'tekerlek döndü ve durmalı; '.repeat(8);
    const result = await wheel.control.type({ text: turning }, wheel.call);
    expect(result).toMatchObject({ ok: false, reason: 'user_interrupt' });
    expect(wheel.text().length).toBeLessThan(turning.length);
  });

  it('odak başka pencereye geçerse ya da acil dur gelirse yazmayı bırakır', async () => {
    const focus = scene([NOTEPAD, CHROME]);
    focus.input.onEvent = (_event, index) => {
      if (index === 1) focus.input.state.foreground = CHROME.hwnd;
    };
    expect(await focus.control.type({ text: 'yanlış pencereye gitmesin: odak değişince kalan metin gönderilmez' }, focus.call)).toMatchObject({ ok: false, reason: 'focus_lost' });
    expect(focus.input.typed.get(CHROME.hwnd)).toBeUndefined();

    const panic = scene([NOTEPAD]);
    panic.input.onEvent = (_event, index) => {
      if (index === 1) panic.abort.abort();
    };
    expect(await panic.control.type({ text: 'acil dur sınaması: durdurulunca metnin gerisi yazılmaz' }, panic.call)).toMatchObject({ ok: false, reason: 'aborted', partial: 2 * TUNING.typeChunk });

    const halted = scene([NOTEPAD]);
    halted.control.halt('panic');
    expect(await halted.control.type({ text: 'x' }, halted.call)).toMatchObject({ ok: false, reason: 'panic' });
    expect(await halted.control.scroll({ direction: 'down' }, halted.call)).toMatchObject({ ok: false, reason: 'panic' });
    expect(halted.kinds()).toEqual([]);
  });

  it('kullanıcı klavyeyi/fareyi kullanırken başlamaz; eli boşalınca başlar', async () => {
    const busy = scene([NOTEPAD]);
    busy.input.userInput();
    busy.whileSleeping = () => busy.input.userInput();
    expect(await busy.control.type({ text: 'x' }, busy.call)).toMatchObject({ ok: false, reason: 'user_busy' });
    expect(busy.kinds()).toEqual([]);

    const held = scene([NOTEPAD]);
    held.input.state.down.add(VK.CONTROL);
    expect(await held.control.type({ text: 'x' }, held.call)).toMatchObject({ ok: false, reason: 'user_busy' });

    const calm = scene([NOTEPAD]);
    calm.input.userInput();
    expect((await calm.control.type({ text: 'tamam' }, calm.call)).ok).toBe(true);
  });

  it('Enter "gönder / çalıştır" anlamına gelen pencerede onaysız basılmaz', async () => {
    const denied = scene([WHATSAPP]);
    expect(await denied.control.type({ text: 'selam', enter: true }, denied.call)).toMatchObject({ ok: false, reason: 'denied' });
    expect(denied.approvals).toEqual([{ kind: 'send', detail: 'WhatsApp' }]);
    expect(denied.kinds()).toEqual([]);

    // Enter istenmediyse onay da istenmez: yazmak taslaktır.
    const draft = scene([WHATSAPP]);
    expect(await draft.control.type({ text: 'selam' }, draft.call)).toMatchObject({ ok: true, entered: false });
    expect(draft.approvals).toEqual([]);

    const approved = scene([WHATSAPP]);
    approved.answers.push(true);
    expect(await approved.control.type({ text: 'selam', enter: true }, approved.call)).toMatchObject({ ok: true, entered: true });
    expect(approved.input.events.at(-1)).toMatchObject({ type: 'keys', keys: [{ vk: VK.RETURN, down: true }, { vk: VK.RETURN, down: false }] });

    // Terminalde satır sonu = komutu çalıştırmak.
    const terminal = scene([TERMINAL]);
    expect(await terminal.control.type({ text: 'del *.*\n' }, terminal.call)).toMatchObject({ ok: false, reason: 'denied' });
    expect(terminal.approvals[0]?.kind).toBe('run');
    expect(terminal.kinds()).toEqual([]);
  });

  it('alan değişmediyse "yazdım" demez; alan başka şey gösteriyorsa Enter basmaz', async () => {
    const dead = scene([NOTEPAD]);
    dead.uia.state.focused = { value: 'salt okunur' };
    expect(await dead.control.type({ text: 'yeni' }, dead.call)).toMatchObject({ ok: false, reason: 'no_effect' });

    const odd = scene([CHROME]);
    let reads = 0;
    Object.defineProperty(odd.uia.state, 'focused', { get: () => ({ value: reads++ === 0 ? '' : '(555) 123' }) });
    const result = await odd.control.type({ text: '555123', enter: true }, odd.call);
    expect(result).toMatchObject({ ok: true, verified: false, entered: false });
    expect(odd.kinds()).not.toContain('keys');

    // Alan okunamıyorsa doğrulanmamış sayılır ama yazılır.
    const blind = scene([NOTEPAD]);
    blind.uia.state.focused = { value: null };
    expect(await blind.control.type({ text: 'abc' }, blind.call)).toMatchObject({ ok: true, verified: null });
  });

  it('kilitli oturumda ve pencere bilgisi okunamazken hiçbir şey yapmaz', async () => {
    const locked = scene([NOTEPAD]);
    locked.uia.state.locked = true;
    expect(await locked.control.type({ text: 'x' }, locked.call)).toMatchObject({ ok: false, reason: 'locked' });
    const down = scene([NOTEPAD]);
    down.uia.state.fails = true;
    expect(await down.control.type({ text: 'x' }, down.call)).toMatchObject({ ok: false, reason: 'uia_down' });
    expect([...locked.kinds(), ...down.kinds()]).toEqual([]);
  });
});

describe('pc_keys: kısayollar', () => {
  it('kısayolu tek atomik dizide basar: değiştiriciler aşağı, tuş, değiştiriciler yukarı', async () => {
    const s = scene([CHROME]);
    const result = await s.control.keys({ keys: 'Ctrl + Shift + T' }, s.call);
    expect(result).toMatchObject({ ok: true, sent: ['ctrl+shift+t'], focusMoved: false });
    expect(s.input.events).toEqual([
      {
        type: 'keys',
        hwnd: CHROME.hwnd,
        keys: [
          { vk: VK.CONTROL, down: true },
          { vk: VK.SHIFT, down: true },
          { vk: 0x54, down: true },
          { vk: 0x54, down: false },
          { vk: VK.SHIFT, down: false },
          { vk: VK.CONTROL, down: false },
        ],
      },
    ]);
  });

  it('pencere/sekme kapatan ve silen kısayollar onay ister; engelli kısayol hiç basılmaz', async () => {
    for (const keys of ['ctrl+w', 'alt+f4', 'ctrl+shift+w', 'delete', 'shift+delete', 'win+r']) {
      const s = scene([CHROME]);
      expect(await s.control.keys({ keys }, s.call), keys).toMatchObject({ ok: false, reason: 'denied' });
      expect(s.approvals, keys).toHaveLength(1);
      expect(s.kinds(), keys).toEqual([]);
    }
    for (const keys of ['win+l', 'ctrl+alt+delete', 'ctrl+alt+q']) {
      const s = scene([CHROME]);
      expect(await s.control.keys({ keys }, s.call), keys).toMatchObject({ ok: false, reason: 'blocked_keys' });
      expect(s.approvals).toEqual([]);
    }
    const approved = scene([CHROME]);
    approved.answers.push(true);
    expect((await approved.control.keys({ keys: 'ctrl+w' }, approved.call)).ok).toBe(true);
    expect(approved.kinds()).toEqual(['keys']);
  });

  it('Enter: sıradan pencerede serbest, ileti/terminal/iletişim kutusunda onaylı', async () => {
    const plain = scene([NOTEPAD]);
    expect((await plain.control.keys({ keys: 'enter' }, plain.call)).ok).toBe(true);
    expect(plain.approvals).toEqual([]);
    for (const window of [WHATSAPP, TERMINAL, win(55, 'Dosyayı Sil', 'explorer', 'Windows Gezgini', { className: '#32770' })]) {
      const s = scene([window]);
      expect(await s.control.keys({ keys: 'enter' }, s.call)).toMatchObject({ ok: false, reason: 'denied' });
      expect(s.kinds()).toEqual([]);
    }
  });

  it('pencere değiştiren kısayol sonda olmalı; ondan sonra odak denetlenmez; bilinmeyen tuş basılmaz', async () => {
    const s = scene([NOTEPAD, CHROME]);
    expect(await s.control.keys({ keys: 'alt+tab enter' }, s.call)).toMatchObject({ ok: false, reason: 'focus_keys_last' });
    expect(await s.control.keys({ keys: 'ctrl+banana' }, s.call)).toMatchObject({ ok: false, reason: 'bad_keys', detail: 'banana' });
    expect(s.kinds()).toEqual([]);
    const result = await s.control.keys({ keys: 'alt+tab' }, s.call);
    expect(result).toMatchObject({ ok: true, window: null, focusMoved: true });
  });

  it('düz harf ve yapıştırma parola alanına basılmaz; tekrar sayısı sınırlıdır', async () => {
    const s = scene([CHROME]);
    s.uia.state.focused = { password: true, value: null };
    expect(await s.control.keys({ keys: 'a' }, s.call)).toMatchObject({ ok: false, reason: 'password' });
    expect(await s.control.keys({ keys: 'ctrl+v' }, s.call)).toMatchObject({ ok: false, reason: 'password' });
    expect(s.kinds()).toEqual([]);
    // Gezinme tuşları parola alanında da serbest (Tab ile sonraki alana geçmek).
    expect((await s.control.keys({ keys: 'tab', repeat: 3 }, s.call)).ok).toBe(true);
    expect(s.kinds()).toEqual(['keys', 'keys', 'keys']);
    const many = scene([NOTEPAD]);
    const result = await many.control.keys({ keys: 'down', repeat: 500 }, many.call);
    expect(result.ok && result.sent.length).toBe(TUNING.maxRepeat);
  });
});

describe('pc_click, pc_drag, pc_scroll', () => {
  it('adıyla bulunan düğmeyi fare OLMADAN etkinleştirir', async () => {
    const s = scene([CHROME]);
    s.uia.state.elements.set(CHROME.hwnd, [element(7, 'Ara'), element(8, 'Görseller', 'Hyperlink', { score: 90 })]);
    const result = await s.control.click({ name: 'ara' }, s.call);
    expect(result).toMatchObject({ ok: true, method: 'uia', label: 'Ara', matches: 1 });
    expect(s.uia.invoked).toEqual([7]);
    expect(s.kinds()).toEqual([]);
    expect(await s.control.click({ name: 'olmayan' }, s.call)).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('gönder / sil / kapat adlı öğeler ve iletişim kutusundaki "Evet" onay ister', async () => {
    for (const name of ['Gönder', 'Sil', 'Sekmeyi kapat', 'Satın al', 'Delete', 'Close']) {
      const s = scene([CHROME]);
      s.uia.state.elements.set(CHROME.hwnd, [element(1, name)]);
      expect(await s.control.click({ name }, s.call), name).toMatchObject({ ok: false, reason: 'denied' });
      expect(s.approvals, name).toEqual([{ kind: 'click', detail: name }]);
      expect(s.uia.invoked).toEqual([]);
    }
    const dialog = win(66, 'Onay', 'explorer', 'Windows Gezgini', { className: '#32770' });
    const s = scene([dialog]);
    s.uia.state.elements.set(dialog.hwnd, [element(1, 'Evet')]);
    expect(await s.control.click({ name: 'evet' }, s.call)).toMatchObject({ ok: false, reason: 'denied' });
    s.answers.push(true);
    expect((await s.control.click({ name: 'evet' }, s.call)).ok).toBe(true);
    expect(s.uia.invoked).toEqual([1]);
  });

  it('desen yoksa imleci hedefe götürüp tıklar; noktada başka pencere varsa tıklamaz', async () => {
    const s = scene([CHROME]);
    s.uia.state.elements.set(CHROME.hwnd, [element(3, 'Menü', 'Custom', { patterns: [], point: { x: 350, y: 320 } })]);
    const result = await s.control.click({ name: 'menü' }, s.call);
    expect(result).toMatchObject({ ok: true, method: 'mouse' });
    const moves = s.input.events.filter((event) => event.type === 'move');
    expect(moves.length).toBeGreaterThan(3);
    expect(moves.at(-1)).toMatchObject({ x: 350, y: 320 });
    expect(s.input.events.filter((event) => event.type === 'button')).toEqual([
      { type: 'button', button: 'left', down: true, x: 350, y: 320 },
      { type: 'button', button: 'left', down: false, x: 350, y: 320 },
    ]);

    const covered = scene([CHROME, NOTEPAD]);
    covered.uia.state.elements.set(CHROME.hwnd, [element(3, 'Menü', 'Custom', { patterns: [], point: { x: 5000, y: 5000 } })]);
    expect(await covered.control.click({ name: 'menü' }, covered.call)).toMatchObject({ ok: false, reason: 'covered' });
    expect(covered.kinds()).not.toContain('button');

    const hidden = scene([CHROME]);
    hidden.uia.state.elements.set(CHROME.hwnd, [element(3, 'Alt bilgi', 'Custom', { patterns: [], onscreen: false })]);
    expect(await hidden.control.click({ name: 'alt bilgi' }, hidden.call)).toMatchObject({ ok: false, reason: 'offscreen' });
  });

  it('imleç yoldayken kullanıcı fareyi alırsa tıklamaz', async () => {
    const s = scene([CHROME]);
    s.uia.state.elements.set(CHROME.hwnd, [element(3, 'Menü', 'Custom', { patterns: [] })]);
    s.input.onEvent = (event, index) => {
      if (event.type === 'move' && index === 2) s.input.state.cursor = { x: 10, y: 10 };
    };
    expect(await s.control.click({ name: 'menü' }, s.call)).toMatchObject({ ok: false, reason: 'user_interrupt' });
    expect(s.kinds()).not.toContain('button');
  });

  it('koordinatla tıklama: pencere dışı reddedilir; tarayıcının sekme şeridi ve orta tık onay ister', async () => {
    const s = scene([CHROME]);
    expect(await s.control.click({ point: { x: 5, y: 5 } }, s.call)).toMatchObject({ ok: false, reason: 'outside_window' });
    // Sekmenin kapatma düğmesi.
    s.uia.state.at = { role: 'Button', name: 'Kapat', parentRole: 'TabItem', parentName: 'Gmail' };
    expect(await s.control.click({ point: { x: 400, y: 120 } }, s.call)).toMatchObject({ ok: false, reason: 'denied' });
    // Adı okunamayan nokta, tarayıcının üst şeridinde.
    s.uia.state.at = { role: 'Pane', name: '', parentName: '' };
    expect(await s.control.click({ point: { x: 400, y: 130 } }, s.call)).toMatchObject({ ok: false, reason: 'denied' });
    // Sayfanın içinde sıradan bir bağlantı: serbest.
    s.uia.state.at = { role: 'Hyperlink', name: 'Haberler' };
    expect(await s.control.click({ point: { x: 400, y: 500 } }, s.call)).toMatchObject({ ok: true, method: 'mouse', label: 'Haberler' });
    // Orta tık tarayıcıda sekme kapatır.
    expect(await s.control.click({ point: { x: 400, y: 500 }, button: 'middle' }, s.call)).toMatchObject({ ok: false, reason: 'denied' });
    expect(s.input.events.filter((event) => event.type === 'button')).toHaveLength(2);
  });

  it('sürükleme: düğme kesilse de bırakılır', async () => {
    const s = scene([NOTEPAD]);
    const ok = await s.control.drag({ from: { x: 200, y: 200 }, to: { x: 600, y: 500 } }, s.call);
    expect(ok.ok).toBe(true);
    const buttons = s.input.events.filter((event) => event.type === 'button');
    expect(buttons).toEqual([
      { type: 'button', button: 'left', down: true, x: 200, y: 200 },
      { type: 'button', button: 'left', down: false, x: 600, y: 500 },
    ]);

    const cut = scene([NOTEPAD]);
    let pressed = false;
    cut.input.onEvent = (event) => {
      if (event.type === 'button' && event.down) pressed = true;
      else if (pressed && event.type === 'move') cut.input.state.down.add(0x1b);
    };
    expect(await cut.control.drag({ from: { x: 200, y: 200 }, to: { x: 900, y: 700 } }, cut.call)).toMatchObject({ ok: false, reason: 'user_interrupt' });
    const released = cut.input.events.filter((event) => event.type === 'button');
    expect(released.map((event) => event.type === 'button' && event.down)).toEqual([true, false]);
  });

  it('kaydırma: tekerlek hedef pencerenin üstünde döner; imleç dışarıdaysa ortaya gider', async () => {
    const s = scene([CHROME]);
    const inside = await s.control.scroll({ direction: 'down' }, s.call);
    expect(inside).toMatchObject({ ok: true });
    expect(s.kinds().every((kind) => kind === 'wheel')).toBe(true);
    const wheels = s.input.events.filter((event) => event.type === 'wheel');
    expect(wheels.length).toBe(inside.ok ? inside.notches : -1);
    expect(wheels.every((event) => event.type === 'wheel' && event.notches === -1 && event.x === 600 && event.y === 400)).toBe(true);

    const outside = scene([CHROME]);
    outside.input.state.cursor = { x: 5, y: 5 };
    const up = await outside.control.scroll({ direction: 'up', pages: 0.5 }, outside.call);
    expect(up.ok).toBe(true);
    expect(outside.input.events.filter((event) => event.type === 'move').at(-1)).toMatchObject({ x: 600, y: 450 });
    expect(outside.input.events.filter((event) => event.type === 'wheel').every((event) => event.type === 'wheel' && event.notches === 1)).toBe(true);
  });
});

describe('pencere eylemleri ve medya tuşları', () => {
  it('öne getirme, küçültme, kapatma (onaylı) ve "kaydedilsin mi" sorusunda kalan pencere', async () => {
    const s = scene([NOTEPAD, CHROME]);
    expect(await s.control.focus({ window: 'krom' }, s.call)).toMatchObject({ ok: true, window: { hwnd: CHROME.hwnd } });
    expect(await s.control.focus({ window: 'olmayan uygulama' }, s.call)).toMatchObject({ ok: false, reason: 'no_window' });
    expect(await s.control.windowAction({ window: 'not defteri', action: 'minimize' }, s.call)).toMatchObject({ ok: true, verified: true });

    expect(await s.control.windowAction({ window: 'chrome', action: 'close' }, s.call)).toMatchObject({ ok: false, reason: 'denied' });
    expect(s.kinds()).not.toContain('close');
    s.answers.push(true);
    expect(await s.control.windowAction({ window: 'chrome', action: 'close' }, s.call)).toMatchObject({ ok: true, verified: true });

    const pending = scene([NOTEPAD]);
    pending.input.state.closeWorks = false;
    pending.answers.push(true);
    expect(await pending.control.windowAction({ action: 'close' }, pending.call)).toMatchObject({ ok: true, verified: false });
  });

  it('ses ve medya tuşları hedef pencere istemez', async () => {
    const s = scene([]);
    expect(await s.control.media({ action: 'volume_down', steps: 3 }, s.call)).toMatchObject({ ok: true, steps: 3 });
    expect(await s.control.media({ action: 'play_pause', steps: 9 }, s.call)).toMatchObject({ ok: true, steps: 1 });
    const keys = s.input.events.flatMap((event) => (event.type === 'keys' ? event.keys.filter((key) => key.down).map((key) => key.vk) : []));
    expect(keys).toEqual([VK.VOLUME_DOWN, VK.VOLUME_DOWN, VK.VOLUME_DOWN, VK.MEDIA_PLAY_PAUSE]);
  });
});
