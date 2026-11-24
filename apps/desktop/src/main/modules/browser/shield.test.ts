// Ağ kalkanı (sekme başına; sahte saat). v1'in K1–K7 senaryolarının v2 karşılıkları + v1'in kaçırdığı atlatmalar:
// masum adlı düğmenin fetch POST'u, gecikmeli gizli form, sendBeacon, sayfanın kendini yeniden yükleyip veriyi taşıması.
import { describe, expect, it } from 'vitest';
import { FORCE_MS, LOCK_MS, PERMIT_MS, TabShield, USER_WINDOW_MS, isGraphqlRead, isMutating, siteOf, type NetworkCard } from './shield';

function setup(page = { url: 'https://a.test/form', title: 'A formu' }) {
  const clock = { at: 1_000_000, now() { return this.at; } };
  const shield = new TabShield(clock, () => page);
  const cards: NetworkCard[] = [];
  const answers: Array<(ok: boolean) => void> = [];
  const ask = (card: NetworkCard) => {
    cards.push(card);
    return new Promise<boolean>((resolve) => answers.push(resolve));
  };
  return { clock, shield, cards, answers, ask };
}
const post = (resourceType = 'xhr', url = 'https://a.test/api/kaydet?jeton=GIZLI', body: string | null = 'x=1') => ({ method: 'POST', resourceType, url, body, pageUrl: 'https://a.test/form' });
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('gönderim kalkanı (ağ)', () => {
  it('kapsam: değiştirici yöntemler, her tür (cspReport hariç); GET hep geçer', () => {
    expect(isMutating('POST', 'xhr')).toBe(true);
    expect(isMutating('put', 'other')).toBe(true);
    expect(isMutating('DELETE', 'xhr')).toBe(true);
    expect(isMutating('POST', 'ping')).toBe(true);
    expect(isMutating('POST', 'mainFrame')).toBe(true);
    expect(isMutating('POST', 'cspReport')).toBe(false);
    expect(isMutating('GET', 'mainFrame')).toBe(false);
    const { shield } = setup();
    shield.interaction(false);
    expect(shield.decide({ method: 'GET', resourceType: 'xhr', url: 'https://a.test/x' }).verdict).toBe('pass');
  });

  it('Jarvis bu belgede etkileşmediyse sayfanın kendi POST\'u geçer (içeriği POST ile yükleyen siteler bozulmasın)', () => {
    const { shield, ask } = setup();
    shield.agentBegin(ask);
    expect(shield.decide(post()).verdict).toBe('pass');
    expect(shield.decide(post('mainFrame')).verdict).toBe('pass');
  });

  it('atlatma 1: masum adlı düğme ("Devam") fetch POST yapar → araç sürerken bekletilir ve kart sorulur (v1 bunu geçiriyordu)', async () => {
    const { shield, ask, cards, answers } = setup();
    shield.agentBegin(ask);
    shield.interaction(false);
    const decision = shield.decide(post());
    expect(decision.verdict).toBe('hold');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ method: 'POST', pageUrl: 'https://a.test/form', pageTitle: 'A formu' });
    // Aynı karta bağlanır: ikinci istek yeni kart açmaz.
    const second = shield.decide(post('ping'));
    expect(second.verdict).toBe('hold');
    expect(cards).toHaveLength(1);
    answers[0]!(false);
    expect(await (decision as { answer: Promise<boolean> }).answer).toBe(false);
    expect(await (second as { answer: Promise<boolean> }).answer).toBe(false);
    expect(shield.takeBlocked()).toBe(2);
  });

  it('onaylanan kart bekleyenleri bırakır ve 10 sn izin verir; izin uzamaz', async () => {
    const { shield, ask, answers, clock } = setup();
    shield.agentBegin(ask);
    shield.interaction(false);
    const held = shield.decide(post()) as { verdict: 'hold'; answer: Promise<boolean> };
    answers[0]!(true);
    expect(await held.answer).toBe(true);
    expect(shield.decide(post()).verdict).toBe('pass');
    clock.at += PERMIT_MS + 1;
    expect(shield.decide(post()).verdict).toBe('hold');
  });

  it('atlatma 2: araç döndükten SONRA gelen gecikmeli gönderim (zamanlayıcıyla gizli form) kartsız iptal; sıradaki etkileşim onaya zorlanır', () => {
    const { shield, ask, clock } = setup();
    shield.agentBegin(ask);
    shield.interaction(false);
    shield.agentEnd();
    clock.at += 45_000; // v1'in 30 sn kuyruğundan sonra da
    expect(shield.decide(post('mainFrame', 'https://kotu.test/topla')).verdict).toBe('cancel');
    expect(shield.takeBlocked()).toBe(1);
    expect(shield.mustConfirm()).toBe(true);
    clock.at += FORCE_MS + 1;
    expect(shield.mustConfirm()).toBe(false);
  });

  it('atlatma 3: sendBeacon (ping) ve PUT/DELETE da kapıdan geçer', () => {
    const { shield } = setup();
    shield.interaction(false);
    expect(shield.decide(post('ping')).verdict).toBe('cancel');
    expect(shield.decide({ method: 'DELETE', resourceType: 'xhr', url: 'https://a.test/hesap' }).verdict).toBe('cancel');
    expect(shield.decide({ method: 'PUT', resourceType: 'other', url: 'https://a.test/x' }).verdict).toBe('cancel');
  });

  it('atlatma 4: sayfa KENDİNİ yeniden yüklese de kir silinmez (veriyi saklayıp yeni belgede gönderemez); yalnız tarayıcının gezinimi siler', () => {
    const { shield } = setup();
    shield.interaction(false);
    // Sayfanın kendi gezinimi: documentChanged ÇAĞRILMAZ (servis yalnız beklenen gezinimde çağırır).
    expect(shield.decide(post()).verdict).toBe('cancel');
    shield.documentChanged(); // Jarvis'in jbrowser_open / geri ya da kullanıcının adres çubuğu
    expect(shield.decide(post()).verdict).toBe('pass');
  });

  it('ret sekmeyi 60 sn kilitler: araç sürerken bile yinelenen gönderim kartsız iptal; yeni etkileşim kilidi kaldırır', async () => {
    const { shield, ask, answers, clock, cards } = setup();
    shield.agentBegin(ask);
    shield.interaction(false);
    const held = shield.decide(post()) as { answer: Promise<boolean> };
    answers[0]!(false);
    await held.answer;
    shield.takeBlocked();
    expect(shield.decide(post()).verdict).toBe('cancel');
    expect(cards).toHaveLength(1);
    clock.at += LOCK_MS - 1000;
    expect(shield.decide(post()).verdict).toBe('cancel');
    shield.interaction(false); // yeni etkileşim: kilit kalkar, yeniden sorulur
    expect(shield.decide(post()).verdict).toBe('hold');
    expect(cards).toHaveLength(2);
  });

  it('eylem kapısında onaylanan etkileşim sekmeye 10 sn izin verir (Stripe\'ın gecikmeli form.submit\'i geçer)', () => {
    const { shield, clock } = setup();
    shield.interaction(true);
    expect(shield.decide(post('mainFrame')).verdict).toBe('pass');
    clock.at += PERMIT_MS + 1;
    expect(shield.decide(post('mainFrame')).verdict).toBe('cancel');
  });

  it('önceki onayın izni sonraki ONAYSIZ etkileşime ve Jarvis\'in açtığı yeni belgeye taşınmaz (uçtan uca sınamanın bulduğu açık)', () => {
    const { shield } = setup();
    shield.interaction(true); // onaylı giriş
    shield.documentChanged(); // Jarvis başka sayfaya gitti
    shield.interaction(false); // yazdı ve masum düğmeye bastı
    expect(shield.decide(post('mainFrame')).verdict).toBe('cancel');
    const second = setup();
    second.shield.interaction(true);
    second.shield.interaction(false); // aynı belgede onaysız yeni etkileşim
    expect(second.shield.decide(post()).verdict).toBe('cancel');
  });

  it('kullanıcının kendi girdisi 3 sn pencere açar ve kiri siler; Jarvis\'in eylemi ve yankısı kullanıcı sayılmaz', () => {
    const { shield, ask, clock } = setup();
    shield.agentBegin(ask);
    shield.interaction(false);
    shield.userInput(); // Jarvis'in kendi sendInputEvent yankısı (araç sürüyor)
    expect(shield.isDirty()).toBe(true);
    shield.agentEnd();
    shield.userInput(); // yankı payı içinde
    expect(shield.isDirty()).toBe(true);
    clock.at += 700;
    shield.userInput(); // gerçek kullanıcı
    expect(shield.isDirty()).toBe(false);
    expect(shield.decide(post()).verdict).toBe('pass');
    clock.at += USER_WINDOW_MS + 1;
    expect(shield.decide(post()).verdict).toBe('pass'); // kir yok: Jarvis bu belgede bir şey yazmadı
  });

  it('kart açıkken sekme kapanır, sonra onaylanırsa istek gönderilmez', async () => {
    const { shield, ask, answers } = setup();
    shield.agentBegin(ask);
    shield.interaction(false);
    const held = shield.decide(post()) as { answer: Promise<boolean> };
    shield.close();
    answers[0]!(true);
    expect(await held.answer).toBe(false);
  });

  it('soran hata verirse ret sayılır (güvenli taraf)', async () => {
    const { shield } = setup();
    shield.agentBegin(() => Promise.reject(new Error('kart açılamadı')));
    shield.interaction(false);
    const held = shield.decide(post()) as { answer: Promise<boolean> };
    expect(await held.answer).toBe(false);
    await tick();
    expect(shield.decide(post()).verdict).toBe('cancel');
  });

  it('aynı sitenin GraphQL OKUMA isteği kirli sekmede de geçer; mutation, başka site ve çözülemeyen gövde geçmez', () => {
    expect(isGraphqlRead(JSON.stringify({ query: 'query Faturalar { faturalar { id } }' }))).toBe(true);
    expect(isGraphqlRead(JSON.stringify({ query: '{ me { ad } }' }))).toBe(true);
    expect(isGraphqlRead(JSON.stringify([{ query: 'query A { a }' }, { query: 'query B { b }' }]))).toBe(true);
    expect(isGraphqlRead(JSON.stringify({ query: 'mutation Sil { hesapSil }' }))).toBe(false);
    expect(isGraphqlRead(JSON.stringify([{ query: 'query A { a }' }, { query: 'mutation B { b }' }]))).toBe(false);
    expect(isGraphqlRead(JSON.stringify({ operationName: 'X', extensions: { persistedQuery: { sha256Hash: 'abc' } } }))).toBe(false);
    expect(isGraphqlRead('ad=ali')).toBe(false);
    const { shield } = setup();
    shield.interaction(false);
    const read = JSON.stringify({ query: 'query { liste { id } }' });
    expect(shield.decide({ ...post('xhr', 'https://api.a.test/graphql', read) }).verdict).toBe('pass');
    expect(shield.decide({ ...post('xhr', 'https://kotu.test/graphql', read) }).verdict).toBe('cancel');
    expect(shield.decide({ ...post('mainFrame', 'https://a.test/graphql', read) }).verdict).toBe('cancel');
  });

  it('site karşılaştırması: alt alan adları ve iki parçalı uzantılar', () => {
    expect(siteOf('https://api.a.test/x')).toBe('a.test');
    expect(siteOf('https://www.hepsiburada.com.tr/')).toBe('hepsiburada.com.tr');
    expect(siteOf('https://giris.turkiye.gov.tr/')).toBe('turkiye.gov.tr');
    expect(siteOf('http://127.0.0.1:5000/')).toBe('127.0.0.1');
    expect(siteOf('nonsense')).toBe('');
  });

  it('korumada mı (sekmesi bilinmeyen istek için): kirli ve izinsiz', () => {
    const { shield, clock } = setup();
    expect(shield.guarded()).toBe(false);
    shield.interaction(false);
    expect(shield.guarded()).toBe(true);
    shield.interaction(true);
    expect(shield.guarded()).toBe(false);
    clock.at += PERMIT_MS + 1;
    expect(shield.guarded()).toBe(true);
  });
});
