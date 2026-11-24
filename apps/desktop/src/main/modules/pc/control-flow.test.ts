// d4 ("hızlı, görünür, güvenilir"): öğe bekleme, türle hedefleme, "şu alana yaz", fare gerektirmeyen yolun sınırı,
// onay beklemesi ve fare titremesi. Hepsi sahte sürücü + sahte okuyucuyla; gerçek girdi üretilmez.
import { describe, expect, it } from 'vitest';
import { TUNING } from './control';
import { describeItems, observe } from './observe';
import { element, scene, win } from './pc-testkit';

const CHAT = win(33, 'Sohbet', 'sohbet', 'Sohbet Uygulaması');
const WHATSAPP = win(34, 'WhatsApp', 'whatsapp', 'WhatsApp');

describe('tıklama: fare gerektirmeyen yol yalnız gerçekten "tıklama" ise', () => {
  it('liste satırı SEÇİLMEZ, fareyle tıklanır (seçmek sohbeti açmaz); düğme desenle basılır', async () => {
    const s = scene([CHAT]);
    s.uia.state.elements.set(CHAT.hwnd, [
      element(1, 'Deneme Kişi', 'ListItem', { patterns: ['select'], point: { x: 400, y: 300 } }),
      element(2, 'Deneme Kişi (çağrı)', 'DataItem', { patterns: ['select'], score: 90 }),
      element(3, 'Yeni sohbet', 'Button', { patterns: ['invoke'] }),
      element(4, 'Sekme', 'TabItem', { patterns: ['select'] }),
    ]);
    const row = await s.control.click({ name: 'Deneme Kişi' }, s.call);
    expect(row).toMatchObject({ ok: true, method: 'mouse', role: 'ListItem' });
    expect(s.uia.invoked).toEqual([]);
    expect(s.kinds().filter((kind) => kind === 'button')).toHaveLength(2);

    const button = await s.control.click({ name: 'Yeni sohbet' }, s.call);
    expect(button).toMatchObject({ ok: true, method: 'uia' });
    expect(s.uia.invoked).toEqual([3]);
    // Sekme seçmek sekmeye tıklamaktır: desen yeter.
    expect(await s.control.click({ name: 'Sekme' }, s.call)).toMatchObject({ ok: true, method: 'uia' });
  });

  it('desenle tıklamada da katmana imleç yolculuğu, hedef vurgusu ve tıklama dalgası yayınlanır', async () => {
    const s = scene([CHAT]);
    s.uia.state.elements.set(CHAT.hwnd, [element(3, 'Yeni sohbet', 'Button', { patterns: ['invoke'] })]);
    await s.control.click({ name: 'Yeni sohbet' }, s.call);
    const kinds = s.activity.filter((event) => event.fx).map((event) => event.fx!.kind);
    expect(kinds).toEqual(['target', 'move', 'click']);
    expect(s.activity[0]).toMatchObject({ state: 'start', action: 'click', detail: 'Yeni sohbet' });
    // Gerçek imleç oynamadı.
    expect(s.kinds().includes('move')).toBe(false);
  });

  it('tür tek başına: o türden tek öğe varsa tıklanır; birden çoksa adlarıyla sorulur', async () => {
    const s = scene([CHAT]);
    s.uia.state.elements.set(CHAT.hwnd, [element(1, 'Ara', 'Edit', { patterns: [], score: 80 }), element(2, 'Gönder', 'Button')]);
    expect(await s.control.click({ role: 'Edit' }, s.call)).toMatchObject({ ok: true, label: 'Ara', method: 'mouse' });

    s.uia.state.elements.set(CHAT.hwnd, [element(1, 'Ara', 'Edit', { patterns: [], score: 80 }), element(3, 'Bir mesaj yazın', 'Edit', { patterns: [], score: 80 })]);
    const ambiguous = await s.control.click({ role: 'Edit' }, s.call);
    expect(ambiguous).toMatchObject({ ok: false, reason: 'ambiguous' });
    expect(ambiguous.ok ? '' : ambiguous.detail).toContain('Bir mesaj yazın');
    // Ne ad ne tür ne nokta: girdi eksik.
    expect(await s.control.click({}, s.call)).toMatchObject({ ok: false, reason: 'bad_input' });
  });
});

describe('öğe bekleme (sabit bekleme ve ara bakış yerine)', () => {
  it('öğe sonradan belirince döner; girdi üretmez', async () => {
    const s = scene([CHAT]);
    s.uia.state.onFind = (hwnd, count) => {
      if (count === 3) s.uia.state.elements.set(hwnd, [element(7, 'Bir mesaj yazın', 'Edit', { patterns: [] })]);
    };
    const result = await s.control.waitFor({ name: 'mesaj', role: 'Edit' }, s.call);
    expect(result).toMatchObject({ ok: true, label: 'Bir mesaj yazın', role: 'Edit' });
    expect(result.ok && result.waitedMs).toBe(2 * TUNING.waitPollMs);
    expect(s.kinds()).toEqual([]);
  });

  it('süre dolarsa dürüstçe "görünmedi" der; kaybolmayı da bekleyebilir; durdurulunca bırakır', async () => {
    const s = scene([CHAT]);
    const missing = await s.control.waitFor({ name: 'hiç gelmeyecek', timeoutMs: 600 }, s.call);
    expect(missing).toMatchObject({ ok: false, reason: 'timeout', detail: 'hiç gelmeyecek' });

    s.uia.state.elements.set(CHAT.hwnd, [element(8, 'Yükleniyor', 'Text', { patterns: [] })]);
    s.uia.state.onFind = (hwnd, count) => {
      if (count >= 8) s.uia.state.elements.set(hwnd, []);
    };
    expect(await s.control.waitFor({ name: 'yükleniyor', gone: true }, s.call)).toMatchObject({ ok: true });

    s.abort.abort();
    expect(await s.control.waitFor({ name: 'x' }, s.call)).toMatchObject({ ok: false, reason: 'aborted' });
    expect(await scene([CHAT]).control.waitFor({}, s.call)).toMatchObject({ ok: false });
  });
});

describe('"şu alana yaz": alan bulunur, tıklanır, yazılır (tek adım)', () => {
  it('alanı adıyla bulur, fareyle tıklar ve metni yazar; alan adını bildirir', async () => {
    const s = scene([CHAT]);
    s.uia.state.elements.set(CHAT.hwnd, [element(1, 'Ara', 'Edit', { patterns: [], point: { x: 320, y: 210 } })]);
    const result = await s.control.type({ text: 'Deneme Kişi', into: { name: 'ara' } }, s.call);
    expect(result).toMatchObject({ ok: true, typed: 11, field: 'Ara', approvalMs: 0 });
    expect(s.text()).toBe('Deneme Kişi');
    // Önce tıklama (basma + bırakma), sonra yazı.
    const order = s.kinds().filter((kind) => kind === 'button' || kind === 'text');
    expect(order.slice(0, 2)).toEqual(['button', 'button']);
    expect(order.at(-1)).toBe('text');
  });

  it('aynı adlı düğme varken yazı ALANINI seçer', async () => {
    const s = scene([CHAT]);
    s.uia.state.elements.set(CHAT.hwnd, [
      element(1, 'Ara', 'Button', { score: 120, point: { x: 900, y: 210 } }),
      element(2, 'Ara veya yeni sohbet başlatın', 'Edit', { patterns: [], score: 95, point: { x: 320, y: 210 } }),
    ]);
    const result = await s.control.type({ text: 'x', into: { name: 'ara' } }, s.call);
    expect(result).toMatchObject({ ok: true, field: 'Ara veya yeni sohbet başlatın' });
    expect(s.uia.invoked).toEqual([]);
    const press = s.input.events.find((event) => event.type === 'button');
    expect(press).toMatchObject({ x: 320, y: 210 });
  });

  it('alan yoksa yazmaz; parola alanına yazmaz', async () => {
    const s = scene([CHAT]);
    expect(await s.control.type({ text: 'x', into: { name: 'olmayan alan' } }, s.call)).toMatchObject({ ok: false, reason: 'not_found' });
    s.uia.state.elements.set(CHAT.hwnd, [element(1, 'Parola', 'Edit', { patterns: [], password: true })]);
    expect(await s.control.type({ text: 'gizli', into: { name: 'parola' } }, s.call)).toMatchObject({ ok: false, reason: 'password' });
    expect(s.text()).toBe('');
  });
});

describe('onay beklemesi', () => {
  it('onay süresi ayrı ölçülür ve "onay bekleniyor" olayı yayınlanır', async () => {
    const s = scene([WHATSAPP]);
    s.answers.push(true);
    const approve = s.call.approve;
    s.call.approve = async (request) => {
      s.input.advance(11_000);
      return approve(request);
    };
    const result = await s.control.type({ text: 'merhaba', enter: true }, s.call);
    expect(result).toMatchObject({ ok: true, entered: true, approvalMs: 11_000 });
    const waiting = s.activity.filter((event) => event.state === 'waiting').map((event) => event.on);
    expect(waiting).toEqual([true, false]);
    // Reddedilirse süre yine bildirilir (aracın "17 sn sürdü" görünen süresi yazma değil onay beklemesidir).
    const denied = scene([WHATSAPP]);
    denied.call.approve = async () => {
      denied.input.advance(17_000);
      return false;
    };
    expect(await denied.control.type({ text: 'merhaba', enter: true }, denied.call)).toMatchObject({ ok: false, reason: 'denied', approvalMs: 17_000 });
  });

  it('onaydan hemen sonra kullanıcının eli hâlâ faredeyse vazgeçilmez; çekilmesi beklenir', async () => {
    const s = scene([WHATSAPP]);
    s.answers.push(true);
    // Onay kartına fareyle basıldı: kullanıcı 2,5 sn daha fareyi oynatıyor (eski sınır 1,5 sn idi: "kullanıcı meşgul").
    let busyFor = 2500;
    s.input.userInput();
    s.whileSleeping = () => {
      if (busyFor > 0) {
        busyFor -= 50;
        s.input.state.cursor = { x: s.input.state.cursor.x + 9, y: s.input.state.cursor.y };
        s.input.userInput();
      }
    };
    const result = await s.control.type({ text: 'merhaba', enter: true }, s.call);
    expect(result).toMatchObject({ ok: true, entered: true });

    // Onay yokken sınır eskisi gibi: 1,5 sn sonra araya girilmez.
    const busy = scene([CHAT]);
    busy.input.userInput();
    busy.whileSleeping = () => {
      busy.input.state.cursor = { x: busy.input.state.cursor.x + 9, y: busy.input.state.cursor.y };
      busy.input.userInput();
    };
    expect(await busy.control.type({ text: 'x' }, busy.call)).toMatchObject({ ok: false, reason: 'user_busy' });
  });
});

describe('fare titremesi kullanıcı girdisi sayılmaz', () => {
  it('imleç birkaç piksel oynuyorsa (tuş basılı değil) eylem başlar; klavye girdisi yine bekletir', async () => {
    const jitter = scene([CHAT]);
    const home = { ...jitter.input.state.cursor };
    let flip = 0;
    jitter.input.userInput();
    jitter.whileSleeping = () => {
      flip += 1;
      // Bluetooth fare: imleç bir piksel gidip geliyor, girdi saati sürekli ilerliyor.
      jitter.input.state.cursor = { x: home.x + (flip % 2), y: home.y };
      jitter.input.userInput();
    };
    const result = await jitter.control.focus({ window: 'sohbet' }, jitter.call);
    expect(result.ok).toBe(true);

    // Klavye: imleç hiç oynamıyor ama girdi saati ilerliyor → kullanıcı yazıyor, araya girilmez.
    const typing = scene([CHAT]);
    typing.input.userInput();
    typing.whileSleeping = () => typing.input.userInput();
    expect(await typing.control.type({ text: 'x' }, typing.call)).toMatchObject({ ok: false, reason: 'user_busy' });
  });

  it('yazarken titreme yazıyı kesmez; imlecin gerçekten uzaklaşması keser', async () => {
    const s = scene([CHAT]);
    const home = { ...s.input.state.cursor };
    let tick = 0;
    let typing = false;
    s.input.onEvent = (event) => {
      if (event.type === 'text') typing = true;
    };
    s.whileSleeping = () => {
      if (!typing) return;
      tick += 1;
      // Parçalar arasındaki her beklemede: imleç bir piksel oynar ve sistem bizim girdimizden SONRA yabancı girdi görür.
      s.input.state.cursor = { x: home.x + (tick % 2), y: home.y + ((tick + 1) % 2) };
      s.input.advance(TUNING.inputToleranceMs + 40);
      s.input.userInput();
    };
    const text = 'titreyen fareyle de bu cümlenin tamamı yazılmalıdır; çünkü kullanıcı fareyi almadı.';
    expect(await s.control.type({ text }, s.call)).toMatchObject({ ok: true, typed: text.length });
    expect(tick).toBeGreaterThan(3);

    // Aynı anlarda imleç HİÇ oynamadan gelen yabancı girdi klavyedir: yazı kesilir.
    const keyboard = scene([CHAT]);
    let keyboardTyping = false;
    keyboard.input.onEvent = (event) => {
      if (event.type === 'text') keyboardTyping = true;
    };
    keyboard.whileSleeping = () => {
      if (!keyboardTyping) return;
      keyboard.input.advance(TUNING.inputToleranceMs + 40);
      keyboard.input.userInput();
    };
    expect(await keyboard.control.type({ text }, keyboard.call)).toMatchObject({ ok: false, reason: 'user_interrupt' });

    const grab = scene([CHAT]);
    grab.input.onEvent = (event, index) => {
      if (event.type === 'text' && index === 1) grab.input.state.cursor = { x: 5, y: 5 };
    };
    expect(await grab.control.type({ text }, grab.call)).toMatchObject({ ok: false, reason: 'user_interrupt' });
  });
});

describe('eylem sonrası ekran özeti', () => {
  it('öğeleri türlerine göre gruplar, yinelenenleri atar, fazlasını sayar; parola alanının adını söylemez', () => {
    const text = describeItems(
      [
        { role: 'Edit', name: 'Ara' },
        { role: 'Edit', name: 'Gizli', password: true },
        { role: 'Button', name: 'Gönder', flags: '*' },
        { role: 'Button', name: 'Gönder' },
        { role: 'ListItem', name: 'Deneme Kişi', flags: 's' },
        { role: 'Button', name: 'Kapalı', flags: 'x' },
      ],
      3,
    );
    expect(text).toBe('alanlar: “Ara”, “parola alanı” · düğmeler: “Gönder” (odakta), “Kapalı” (devre dışı) · satırlar: “Deneme Kişi” (seçili) (+3 öğe daha)');
    expect(describeItems([])).toBe('');
  });

  it('öndeki pencereyi, odağı ve görünen öğeleri verir; hassas pencereyi özetlemez; okuma hatasında susar', async () => {
    const s = scene([CHAT]);
    s.uia.state.elements.set(CHAT.hwnd, [element(1, 'Ara', 'Edit'), element(2, 'Gönder', 'Button')]);
    const seen = await observe(s.uia);
    expect(seen.text).toContain('Şimdi önde: “Sohbet [Sohbet Uygulaması]”');
    expect(seen.text).toContain('Pencerede görünenler: alanlar: “Ara” · düğmeler: “Gönder”');
    expect(seen.text).toContain('[EKRANDAN OKUNAN METİN');
    expect(seen.count).toBe(2);

    const bank = scene([win(50, 'Garanti BBVA İnternet Bankacılığı', 'chrome', 'Google Chrome')]);
    bank.uia.state.elements.set(50, [element(1, 'Kart numarası', 'Edit')]);
    expect((await observe(bank.uia)).text).toBe('');

    s.uia.state.fails = true;
    expect((await observe(s.uia)).text).toBe('');
  });
});
