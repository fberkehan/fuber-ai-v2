// 5 Kas: Fuber'in içinde Claude Code kullanırken "<task-notification> <task-id>…</task-id> <tool-use-id>…</tool-use-id> <output-file>…</output-file>
// <status>completed</status> <summary>Agent "…" finished</summary> …" sohbette kullanıcının KENDİ yazdığı balon gibi görünüyor ve yer kaplıyordu.
// Kök neden: Claude Code bu bildirimleri kullanıcı rolüyle yazar (JSONL'de type 'user', canlıda yeniden oynatılan user iletisi); istemTemizle yalnız
// system-reminder ve komut etiketlerini atıyordu → bildirim 'kullanici' olayı oluyordu. Düzeltme: etiketle sarılı koşum iletisi (task-notification ve
// benzerleri) kullanıcı balonu DEĞİL, tek satırlık 'sistem' olayı (özet) + açılır ayrıntı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccNormallestir, dokumSatiriOlaylari, yeniBaglam, harnesBildirimleri, type CcOlay } from '../src/shared/cc-olay.ts';
import { modelKur } from '../src/renderer/claudecode/dokum-modeli.ts';

// Gerçek biçimde (Claude Code 2.1 arka plan alt ajanı bitince yazdığı) bildirim.
const BILDIRIM = `<task-notification>
<task-id>a3dc7ff7a17eb8937</task-id>
<tool-use-id>toolu_01ABCdefGHIjklMNOpqrSTU</tool-use-id>
<output-file>C:\\Kullanicilar\\deniz\\AppData\\Local\\Temp\\claude\\tasks\\a3dc7ff7a17eb8937.output</output-file>
<status>completed</status>
<summary>Agent "Takvim hatasını incele" finished</summary>
<result>Kök neden bulundu; düzeltme hazır.</result>
<usage><total_tokens>48211</total_tokens><tool_uses>37</tool_uses><duration_ms>412233</duration_ms></usage>
</task-notification>
Full transcript available at: C:\\Kullanicilar\\deniz\\AppData\\Local\\Temp\\claude\\tasks\\a3dc7ff7a17eb8937.output`;

const sistemler = (o: CcOlay[]) => o.filter((x): x is Extract<CcOlay, { tur: 'sistem' }> => x.tur === 'sistem');

test('harnesBildirimleri: task-notification → tek satır özet + ayrıntı; sıradan metin null', () => {
  const b = harnesBildirimleri(BILDIRIM)!;
  assert.equal(b.length, 1);
  assert.equal(b[0].metin, 'Arka plan işi bitti: Agent "Takvim hatasını incele" finished');
  assert.ok(!b[0].metin.includes('\n'));
  assert.match(b[0].ayrinti, /Kök neden bulundu/);
  assert.match(b[0].ayrinti, /a3dc7ff7a17eb8937\.output/);
  assert.doesNotMatch(b[0].ayrinti, /<\/?[a-z-]+>/, 'ayrıntıda ham etiket yok');
  assert.equal(harnesBildirimleri('Testleri düzelt'), null);
  assert.equal(harnesBildirimleri('Bu <div>etiket</div> benim yazdığım HTML'), null, 'kullanıcının yazdığı HTML koşum iletisi sayılmaz');
  assert.equal(harnesBildirimleri('Şunu incele: <task-notification><summary>x</summary></task-notification>'), null, 'kullanıcı metninin içinde alıntı: kullanıcının');
});

test('durumlar: failed / killed ayrı cümle; özetsizse görev kimliği yok, genel cümle', () => {
  assert.equal(harnesBildirimleri(BILDIRIM.replace('completed', 'failed'))![0].metin, 'Arka plan işi başarısız: Agent "Takvim hatasını incele" finished');
  assert.equal(harnesBildirimleri(BILDIRIM.replace('completed', 'killed'))![0].metin, 'Arka plan işi durduruldu: Agent "Takvim hatasını incele" finished');
  assert.equal(harnesBildirimleri('<task-notification><task-id>x1</task-id><status>completed</status></task-notification>')![0].metin, 'Arka plan işi bitti.');
  // İki bildirim art arda: iki satır.
  assert.equal(harnesBildirimleri(`${BILDIRIM}\n${BILDIRIM.replace('Takvim hatasını incele', 'Testleri çalıştır')}`)!.length, 2);
});

test('inceleme m6: kullanıcının kendi kebap etiketi (<my-notes>) koşum bildirimi sayılmaz', () => {
  assert.equal(harnesBildirimleri('<my-notes>yarın sunum</my-notes>'), null);
  assert.deepEqual(dokumSatiriOlaylari({ type: 'user', message: { role: 'user', content: '<my-notes>yarın sunum</my-notes>' }, uuid: 'm' }, yeniBaglam()).map((x) => x.tur), ['kullanici']);
});

test('başka kebap-adlı koşum etiketi de kullanıcı balonu olmaz (tek satır "Claude Code bildirimi")', () => {
  const b = harnesBildirimleri('<user-prompt-submit-hook>Kanca çıktısı: biçimlendirme tamam</user-prompt-submit-hook>')!;
  assert.equal(b.length, 1);
  assert.equal(b[0].metin, 'Claude Code bildirimi: Kanca çıktısı: biçimlendirme tamam');
});

test('JSONL döküm satırı (type user, metin ya da metin bloğu) → sistem olayı; kullanıcı balonu yok', () => {
  for (const content of [BILDIRIM, [{ type: 'text', text: BILDIRIM }]]) {
    const o = dokumSatiriOlaylari({ type: 'user', message: { role: 'user', content }, uuid: 'n1' }, yeniBaglam());
    assert.deepEqual(o.map((x) => x.tur), ['sistem'], JSON.stringify(content).slice(0, 40));
    const s = sistemler(o)[0];
    assert.equal(s.seviye, 'bilgi');
    assert.equal(s.metin, 'Arka plan işi bitti: Agent "Takvim hatasını incele" finished');
    assert.ok(s.ayrinti);
  }
  // system-reminder ile birlikte gelirse de.
  const o = dokumSatiriOlaylari({ type: 'user', message: { role: 'user', content: `<system-reminder>gizli</system-reminder>\n${BILDIRIM}` }, uuid: 'n2' }, yeniBaglam());
  assert.deepEqual(o.map((x) => x.tur), ['sistem']);
});

test('canlı akış: yeniden oynatılan user iletisi (isReplay) → sistem olayı', () => {
  const o = ccNormallestir({ type: 'user', message: { role: 'user', content: BILDIRIM }, parent_tool_use_id: null, uuid: 'r1', session_id: 's', isReplay: true }, yeniBaglam());
  assert.deepEqual(o.map((x) => x.tur), ['sistem']);
});

test('döküm modeli: bildirim tek satırlık sistem öğesi (ayrıntısıyla); kullanıcının gerçek mesajı balon kalır', () => {
  const b = yeniBaglam();
  const olaylar = [
    ...dokumSatiriOlaylari({ type: 'user', message: { role: 'user', content: 'Takvimi düzelt' }, uuid: 'u1' }, b),
    ...dokumSatiriOlaylari({ type: 'user', message: { role: 'user', content: BILDIRIM }, uuid: 'n1' }, b),
  ].map((olay, i) => ({ olay, zaman: 1000 + i }));
  const l = modelKur(olaylar).liste();
  assert.deepEqual(l.map((x) => x.tur), ['kullanici', 'sistem']);
  const s = l[1] as Extract<(typeof l)[number], { tur: 'sistem' }>;
  assert.equal(s.metin, 'Arka plan işi bitti: Agent "Takvim hatasını incele" finished');
  assert.match(s.ayrinti ?? '', /Kök neden bulundu/);
});
