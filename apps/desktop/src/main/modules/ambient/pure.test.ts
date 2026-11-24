// Fuber AI 1'den alınan saf parçaların testleri: `tests/donem.test.ts`, `tests/seslenme.test.ts` ve
// `tests/proaktif-tekrar.test.ts` (ilk üç senaryo) buraya taşındı; beklenen değerler v1 ile aynıdır.
import { describe, expect, it } from 'vitest';
import { addressNames, analyzeAddress, isFollowUp, nameForm } from './address';
import { dueReports, expiryDate, isoWeek, isWithinHours, matchIssue, monthWeeks, previousMonth, previousWeek, shiftDay, topicSimilarity, weekDays } from './periods';
import {
  appendHistory,
  bodyOf,
  isRepeat,
  previousText,
  PROACTIVE_GAP_MS,
  PROACTIVE_HISTORY_SIZE,
  readHistory,
  sameAsPrevious,
  shouldWait,
  type ProactiveTrace,
} from './repeat-guard';
import { keywords, looseFtsQuery, stemSimilarity, turkishStem } from './stems';

describe('dönemler (v1 donem.ts)', () => {
  it('ISO hafta ve günleri', () => {
    expect(isoWeek(new Date(2026, 9, 19))).toBe('2026-W43'); // Pzt
    expect(isoWeek(new Date(2026, 9, 25, 23, 59))).toBe('2026-W43'); // Paz
    expect(isoWeek(new Date(2026, 9, 26))).toBe('2026-W44');
    expect(isoWeek(new Date(2027, 0, 1))).toBe('2026-W53'); // 1 Ocak 2027 Cuma → 2026'nın 53. haftası
    expect(weekDays('2026-W43')).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    expect(monthWeeks('2026-10')).toEqual(expect.arrayContaining(['2026-W40', '2026-W44']));
    expect(previousWeek(new Date(2026, 9, 19))).toBe('2026-W42');
    expect(previousMonth(new Date(2026, 0, 3))).toBe('2025-12');
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('dinleme saatleri (gece yarısını aşan aralık dahil)', () => {
    const work = { from: '08:00', to: '23:00', days: [1, 2, 3, 4, 5] };
    expect(isWithinHours(new Date(2026, 9, 19, 9, 0), work)).toBe(true); // Pzt 09:00
    expect(isWithinHours(new Date(2026, 9, 19, 23, 30), work)).toBe(false);
    expect(isWithinHours(new Date(2026, 9, 18, 12, 0), work)).toBe(false); // Pazar
    const night = { from: '20:00', to: '02:00', days: [5] }; // Cuma gecesi
    expect(isWithinHours(new Date(2026, 9, 23, 21, 0), night)).toBe(true); // Cuma 21:00
    expect(isWithinHours(new Date(2026, 9, 24, 1, 0), night)).toBe(true); // Cmt 01:00 (Cuma gecesinin devamı)
    expect(isWithinHours(new Date(2026, 9, 24, 21, 0), night)).toBe(false); // Cmt 21:00
  });

  it('vadesi gelen raporlar: kaçırılan günler, rapor saati, biten hafta/ay; var olan ve verisiz atlanır', () => {
    const existing = new Set(['daily:2026-10-31']);
    const data = new Set(['daily:2026-10-30', 'daily:2026-10-31', 'daily:2026-11-01', 'weekly:2026-W43', 'monthly:2026-10']);
    const due = (now: Date) => dueReports(now, '21:30', (kind, period) => existing.has(`${kind}:${period}`), (kind, period) => data.has(`${kind}:${period}`));
    // 1 Kasım 2026 Pazar 10:00 → evvelsi gün (30) eksik, dün (31) var, bugün henüz saat gelmedi; W43 bitti; Ekim bitti
    expect(due(new Date(2026, 10, 1, 10, 0))).toEqual([
      { kind: 'daily', period: '2026-10-30' },
      { kind: 'weekly', period: '2026-W43' },
      { kind: 'monthly', period: '2026-10' },
    ]);
    expect(due(new Date(2026, 10, 1, 21, 45)).some((report) => report.kind === 'daily' && report.period === '2026-11-01')).toBe(true);
  });

  it('saklama: gün sonundan n gün sonra', () => {
    const expiry = new Date(expiryDate('2026-10-19', 3));
    expect(expiry.getDate()).toBe(22);
    expect(expiry.getHours()).toBe(23);
  });

  it('mesele eşleştirme: aynı konu yeni mesele açmaz, farklı kişi eşleşmez', () => {
    const existing = [
      { id: 1, title: 'Ali kira sözleşmesini gönderecek', person: 'Ali' },
      { id: 2, title: 'Sunucu faturası ödenecek', person: null },
    ];
    expect(matchIssue('Ali kira sözleşmesini cumartesi gönderecek', 'Ali', existing)?.id).toBe(1);
    expect(matchIssue('Kira sözleşmesi gönderilecek', 'Mehmet', existing)).toBeNull();
    expect(matchIssue('Sunucu faturasını öde', undefined, existing)?.id).toBe(2);
    expect(topicSimilarity('çiğ köfte yemeyeceğiz', 'bir daha çiğ köfte yemeyelim')).toBeGreaterThanOrEqual(0.6);
  });
});

describe('seslenme (v1 seslenme.ts)', () => {
  const fuber = addressNames('Fuber');
  const jarvis = addressNames('Jarvis');
  const verdict = (line: string, names = fuber) => analyzeAddress(line, names).verdict;

  it('ad biçimi: eksiz / ekli', () => {
    expect(nameForm('fuber', fuber)).toBe('bare');
    expect(nameForm('fiber', fuber)).toBe('bare');
    expect(nameForm("fuber'e", fuber)).toBe('suffixed');
    expect(nameForm('fuber’in', fuber)).toBe('suffixed');
    expect(nameForm('fuberden', fuber)).toBe('suffixed');
    expect(nameForm('fiberin', fuber)).toBe('suffixed');
    expect(nameForm('fabrika', fuber)).toBeNull();
    expect(nameForm('Jarvis', jarvis)).toBe('bare');
    expect(nameForm('çarvis', jarvis)).toBe('bare');
    expect(nameForm("Jarvis'e", jarvis)).toBe('suffixed');
    expect(nameForm('jarvisten', jarvis)).toBe('suffixed');
  });

  it('seslenmeler yakalanır', () => {
    for (const line of [
      'ee fiber nasılsın nasıl gidiyor',
      'Fuber buralarda mısın?',
      'füber orda mısın',
      'fuber yarın sabah dokuzda toplantım var hatırlat bana',
      'fuber şu ödeme projesindeki hatayı düzeltir misin, stripe webhook patlıyor',
      'hey fuber bugün hava nasıl',
      'bugün ne yapıyoruz fuber',
      'fuber kira sözleşmesini imzalayalım mı sence',
      'hadi fuber bir şaka yap',
    ]) {
      expect(verdict(line), line).toBe('addressed');
    }
    for (const line of ['ee Jarvis nasılsın', 'bugün ne yapıyoruz Jarvis', 'Carvis yarın dokuzda toplantım var hatırlat bana', 'Jarvis orada mısın?']) {
      expect(verdict(line, jarvis), line).toBe('addressed');
    }
  });

  it('söz etmeler ve alakasızlar seslenme sayılmaz', () => {
    for (const line of [
      'dün Fuber’e sordum, güzel cevap verdi',
      'fuberden çıkan raporu okudun mu',
      'Fuber’in sesi güzelmiş bu arada',
      'fiber internet yine kesildi',
      'evde fiber optik kablo var mı',
      'hadi kalk gidelim artık geç oldu',
    ]) {
      expect(verdict(line), line).not.toBe('addressed');
    }
    expect(verdict('Fuber çok iyi cevap verdi dün')).toBe('unclear');
    expect(verdict("dün Jarvis'e sordum güzel cevap verdi", jarvis)).toBe('not');
    expect(verdict('Jarvis çok iyi cevap verdi dün', jarvis)).toBe('unclear');
  });

  it('devam penceresi: asistan konuştuktan sonra adsız yanıt', () => {
    const now = 1_000_000;
    expect(isFollowUp('evet olur, sekiz buçukta hatırlat', now - 5000, now, fuber)).toBe(true);
    expect(isFollowUp('tamam teşekkürler', now - 3000, now, fuber)).toBe(true);
    expect(isFollowUp('evet olur', now - 30_000, now, fuber)).toBe(false); // pencere geçti
    expect(isFollowUp('Fuber’e söyledim zaten', now - 3000, now, fuber)).toBe(false);
    // Yandakine söylenen ikinci kişi / soru asistana sayılmaz
    expect(isFollowUp('Şu pencereyi biraz açar mısın hava aldı', now - 4000, now, fuber)).toBe(false);
    expect(isFollowUp('sen ne dersin?', now - 5000, now, fuber)).toBe(false);
  });
});

describe('tekrar bekçisi (v1 proaktif-tekrar.ts)', () => {
  const STALE = 'Bugün senin için öncelikli olanlar: 1) ISO 9001 kontrol listesi (21 Eki), 2) 14:00 Atlas Gıda toplantısı, 3) Q4 bütçesi hazırlığı. Yaklaşan hatırlatıcı: 14:00.';
  const trace = (kind: string, text: string, daysAgo = 1): ProactiveTrace => ({ kind, text, at: new Date(Date.now() - daysAgo * 86_400_000).toISOString() });

  it('tekrar listenin TAMAMINDA aranır; farklı ileti geçer; kalıp satırları benzerlik sayılmaz', () => {
    const history: ProactiveTrace[] = [
      trace('morning', STALE, 25),
      ...Array.from({ length: 30 }, (_, index) => trace('curiosity', `Farklı soru ${index}: ekibin ${['satış', 'finans', 'İK', 'operasyon', 'depo'][index % 5]} tarafında ${index}. konu`, 20 - index / 2)),
    ];
    expect(isRepeat('Bugün senin için öncelikli olanlar: 1) ISO 9001 kontrol listesi (21 Ekim), 2) 14:00 Atlas Gıda toplantısı, 3) Q4 bütçesi hazırlığı.', history)).toBe(true);
    const curiosity = [trace('curiosity', 'Selin, bu yoğunlukta en kritik nokta ISO 9001 denetimi mi, yoksa Q4 bütçesi mi?')];
    expect(isRepeat('Selin, bu yoğunlukta en kritik nokta ISO denetimi mi yoksa Q4 bütçesi mi?', curiosity)).toBe(true);
    expect(isRepeat('Haftanın hangi günü en verimli olduğunu hissediyorsun?', curiosity)).toBe(false);
    expect(bodyOf('Günaydın Selin!\nBugün:\n- 16:00 Murat ile bütçe toplantısı')).toBe('- 16:00 Murat ile bütçe toplantısı');
    expect(isRepeat('Günaydın Selin!\nBugün:\n- 16:00 Murat ile bütçe toplantısı', [trace('morning', 'Günaydın Selin!\nBugün:\n- 14:00 Atlas Gıda toplantısı')])).toBe(false);
    expect(isRepeat('', history)).toBe(false);
  });

  it('geçmiş listesi: en çok 60, bozuk kayıt güvenle boş; "daha önce sorduğun" bölümü yalnız aynı tür', () => {
    let list: ProactiveTrace[] = [];
    for (let index = 0; index < 75; index++) list = appendHistory(list, { kind: 'curiosity', text: `soru ${index}`, at: new Date().toISOString() });
    expect(list).toHaveLength(PROACTIVE_HISTORY_SIZE);
    expect(list[0]!.text).toBe('soru 15');
    expect(readHistory('{bozuk')).toEqual([]);
    expect(readHistory(JSON.stringify([{ kind: 'curiosity', text: 'a', at: 'x' }, { wrong: 1 }]))).toHaveLength(1);
    const text = previousText([trace('morning', STALE), trace('curiosity', 'Ekibinde en çok kime güveniyorsun?')], 'curiosity');
    expect(text).toMatch(/SORMA/);
    expect(text).toMatch(/kime güveniyorsun/);
    expect(text).not.toMatch(/öncelikli/);
    expect(previousText([], 'curiosity')).toBe('');
    expect(sameAsPrevious('Günaydın!\n- 14:00 toplantı', [trace('morning', 'Günaydın!\n- 14:00 toplantı')], 'morning')).toBe(true);
    expect(sameAsPrevious('Günaydın!\n- 14:00 toplantı', [trace('morning', 'Günaydın!\n- 10:30 rapor')], 'morning')).toBe(false);
  });

  it('bekleme: iki ileti arası 90 dk; son 3 merak yanıtsızsa 2 gün susar; kullanıcı son 30 dk yazdıysa merak sorulmaz', () => {
    const now = Date.now();
    const near = [{ kind: 'morning', text: 'x', at: new Date(now - PROACTIVE_GAP_MS + 60_000).toISOString() }];
    expect(shouldWait('curiosity', near, now, { answered: [] })).toBe(true);
    expect(shouldWait('morning', [{ ...near[0]!, at: new Date(now - 3 * 3_600_000).toISOString() }], now, { answered: [] })).toBe(false);
    const three = [trace('curiosity', 'a', 3), trace('curiosity', 'b', 2), trace('curiosity', 'c', 1)];
    expect(shouldWait('curiosity', three, now, { answered: [false, false, false] })).toBe(true);
    expect(shouldWait('curiosity', three, now, { answered: [false, true, false] })).toBe(false);
    expect(shouldWait('morning', three, now, { answered: [false, false, false] })).toBe(false);
    expect(shouldWait('curiosity', [], now, { answered: [], lastUserAt: now - 10 * 60_000 })).toBe(true);
  });
});

describe('kök ve anahtar sözcük', () => {
  it('ekler atılır, kök en az dört harf kalır', () => {
    // v1 kökleyicisi bilerek kabadır: çekim eklerini art arda atar ("toplan"), önek araması için bu yeter.
    expect(turkishStem('toplantilarimi')).toBe('toplan');
    expect(turkishStem('2026')).toBe('2026');
    expect(stemSimilarity('Kaan teklifi gönderecek', 'teklif Kaan’dan gelecek')).toBeGreaterThanOrEqual(0.6);
  });

  it('anahtar sözcükler sık sözcükleri atar; gevşek sorgu kökleri VEYA ile bağlar', () => {
    expect(keywords('bugün çiğ köfte yesek mi acaba')).toEqual(['cig', 'kofte', 'yesek']);
    expect(looseFtsQuery('çiğ köfteleri yesek mi')).toBe('"cig" OR "koft" * OR "yesek" *');
    expect(looseFtsQuery('ve de mi')).toBeNull();
  });
});
