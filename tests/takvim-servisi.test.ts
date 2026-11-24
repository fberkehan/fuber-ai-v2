// 5 Kas: takvim bağlantısı bir şey açıyor ama işe yaramıyordu. Kök neden: Gündem yalnız Yönetim'in `gundemAraci` girdiği katalog girdisini
// takvim sayıyordu; hiçbir girdide (ILK_KATALOG dahil) gündem aracı yoktu → Gündem hep "Takvim bağlı değil" + "Bağla" gösteriyor, Bağla E-posta'ya
// gidiyordu; takvim servisi bağlansa bile etkinlik okunmuyordu. Düzeltme: takvim servisinin (simge takvim/microsoft) araçlarından etkinlik listeleyen
// okuma aracı kendiliğinden seçilir; katalogda takvim servisi yoksa tek düz satır, Bağla yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gundemAraciSec, gundemAraciOnayIster, aracOnayGerekirMi, takvimServisiMi, OTOMATIK_GUNDEM_ARACI, ILK_KATALOG } from '../src/shared/mcp-katalog.ts';
// Ad denetimi tek başına: salt okunur ilanlı aracın seçilip seçilmediğine bakılır (onay kuralı ayrıca sınanır).
const ETKINLIK_ADI_UYAR = (ad: string) => gundemAraciSec([{ name: ad, annotations: { readOnlyHint: true } }], 0, { ...ILK_KATALOG[1], saltOkunur: [ad] }) !== null;
import { gundemSayfasi, TAKVIM_SERVISI_YOK } from '../src/shared/centik-veri.ts';

const SIMDI = new Date(2026, 10, 5, 10, 30).getTime();
const BOS_KOKPIT = { hatirlaticilar: [], gorevler: [], epostalar: [], dusunme: { meseleler: [] } } as unknown as Parameters<typeof gundemSayfasi>[0];

test('takvim servisi: simge takvim ya da microsoft, ya da gündem aracı tanımlı', () => {
  assert.equal(takvimServisiMi(ILK_KATALOG.find((g) => g.id === 'google-takvim')!), true);
  assert.equal(takvimServisiMi(ILK_KATALOG.find((g) => g.id === 'microsoft-365')!), true);
  assert.equal(takvimServisiMi(ILK_KATALOG.find((g) => g.id === 'notion')!), false);
  assert.equal(takvimServisiMi({ ...ILK_KATALOG[5], gundemAraci: { ad: 'x_list', girdi: {} } }), true);
  assert.equal(OTOMATIK_GUNDEM_ARACI.startsWith('__'), true);
});

const RO = { readOnlyHint: true } as const;
const TAKVIM_GIRDISI = ILK_KATALOG.find((g) => g.id === 'google-takvim')!;

test('Google Calendar MCP biçimi: salt okunur list_events seçilir, bugünün aralığı + primary doldurulur', () => {
  const araclar = [
    { name: 'create_event', inputSchema: { type: 'object', properties: { summary: {} } } },
    { name: 'list_calendars', inputSchema: { type: 'object', properties: {} }, annotations: RO },
    { name: 'list_events', inputSchema: { type: 'object', properties: { calendarId: {}, timeMin: {}, timeMax: {}, singleEvents: {}, orderBy: {}, maxResults: {} } }, annotations: RO },
  ];
  const s = gundemAraciSec(araclar, SIMDI, TAKVIM_GIRDISI)!;
  assert.equal(s.ad, 'list_events');
  assert.equal(s.girdi.calendarId, 'primary');
  assert.equal(s.girdi.timeMin, new Date(2026, 10, 5).toISOString());
  assert.equal(s.girdi.timeMax, new Date(2026, 10, 6).toISOString());
  assert.equal(s.girdi.singleEvents, true);
  assert.equal(s.girdi.orderBy, 'startTime');
  assert.equal(s.girdi.maxResults, 50);
});

test('Microsoft biçimi (list-calendar-view, startDateTime/endDateTime); get_events', () => {
  const s = gundemAraciSec([{ name: 'send-mail', annotations: RO }, { name: 'list-calendar-view', inputSchema: { properties: { startDateTime: {}, endDateTime: {} } }, annotations: RO }], SIMDI, TAKVIM_GIRDISI)!;
  assert.equal(s.ad, 'list-calendar-view');
  assert.deepEqual(Object.keys(s.girdi).sort(), ['endDateTime', 'startDateTime']);
  assert.equal(gundemAraciSec([{ name: 'get_events', annotations: RO }], SIMDI, TAKVIM_GIRDISI)?.ad, 'get_events');
  // Tam ad öncelikli: list_events, search_events'ten önce.
  assert.equal(gundemAraciSec([{ name: 'search_events', annotations: RO }, { name: 'list_events', annotations: RO }], SIMDI, TAKVIM_GIRDISI)?.ad, 'list_events');
});

test('inceleme I1: izin listesi + readOnlyHint + olağan onay kuralı; çapasız ad ve ilansız araç seçilmez', () => {
  // Çapasız desen açığı: clear/purge… _events_list hiçbir desene uymaz (salt okunur ilan etse bile).
  for (const ad of ['clear_events_list', 'purge_events_list', 'archive_events_list', 'import_events_list']) {
    assert.equal(gundemAraciSec([{ name: ad, annotations: RO }], SIMDI, TAKVIM_GIRDISI), null, ad);
  }
  // readOnlyHint yok ya da false: ad uysa da kendiliğinden çağrılmaz; Gündem "onay ya da ayar istiyor" der.
  for (const ann of [undefined, { readOnlyHint: false }]) {
    const l = [{ name: 'list_events', ...(ann ? { annotations: ann } : {}) }];
    assert.equal(gundemAraciSec(l, SIMDI, TAKVIM_GIRDISI), null, JSON.stringify(ann));
    assert.equal(gundemAraciOnayIster(l, TAKVIM_GIRDISI), true);
    assert.equal(aracOnayGerekirMi(TAKVIM_GIRDISI, l[0]), true);
  }
  // Sahte ilan: yazan adlı araç readOnlyHint: true diyor — ad denetimi DE onay kuralı DA reddeder.
  for (const ad of ['delete_events', 'create_events', 'clear_events']) {
    const a = { name: ad, annotations: RO };
    assert.equal(gundemAraciSec([a], SIMDI, TAKVIM_GIRDISI), null, ad);
    assert.equal(ETKINLIK_ADI_UYAR(ad), false, `${ad}: ad denetimi`);
    assert.equal(aracOnayGerekirMi(TAKVIM_GIRDISI, a), true, `${ad}: onay kuralı`);
  }
  assert.equal(gundemAraciSec([{ name: 'list_events', annotations: { readOnlyHint: true, destructiveHint: true } }], SIMDI, TAKVIM_GIRDISI), null);
  assert.equal(gundemAraciSec([], SIMDI, TAKVIM_GIRDISI), null);
  assert.equal(gundemAraciOnayIster([{ name: 'send-mail' }], TAKVIM_GIRDISI), false, 'etkinlik aracı yok: onay değil "araç yok"');
});

test('11 Kas: katalogda takvim servisi yoksa (açık kaynak, Yönetim yok) Gündem neyin bağlanacağını söyler ve Bağlantılar yolunu sunar', () => {
  const s = gundemSayfasi(BOS_KOKPIT, null, SIMDI, { cipa: null });
  assert.deepEqual(s.bos, { metin: TAKVIM_SERVISI_YOK, eylem: 'baglantilar', cipa: 'servisler' });
  assert.match(TAKVIM_SERVISI_YOK, /^Takvim bağlı değil\./);
  assert.match(TAKVIM_SERVISI_YOK, /Google|Outlook/);
  assert.doesNotMatch(TAKVIM_SERVISI_YOK, /Fuber Yönetim|Yönetim/, 'açık kaynak kullanıcısının Yönetim uygulaması yok');
  // Developer mode: kendi takvim sunucusunu MCP sunucuları bölümünden ekler.
  assert.deepEqual(gundemSayfasi(BOS_KOKPIT, null, SIMDI, { cipa: null, yedekCipa: 'mcp' }).bos, { metin: TAKVIM_SERVISI_YOK, eylem: 'baglantilar', cipa: 'mcp' });
  // Takvim servisi varsa eski davranış: kartına Bağla.
  assert.deepEqual(gundemSayfasi(BOS_KOKPIT, null, SIMDI, { cipa: 'servis-google-takvim' }).bos?.eylem, 'baglantilar');
});
