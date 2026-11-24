// Toplantının saf kuralları: dil ve soru sezgisi, yankı süzgeci, bağlam bütçesi, özetin dayanak kapısı.
import { describe, expect, it } from 'vitest';
import {
  cleanContext,
  contextText,
  detectLanguage,
  echoCoverage,
  extractJson,
  groundSummary,
  isEcho,
  LOCAL_SUMMARY_MAX,
  meetingTitle,
  numberedTranscript,
  questionKind,
  quoteSupported,
  translationInstructions,
} from './pure';

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 16, 9, 0, seconds)).toISOString();
const line = (text: string, from: number, to: number) => ({ text, startedAt: at(from), endedAt: at(to) });

describe('dil sezgisi', () => {
  it.each([
    ['Yarın saat onda teklifin son halini göndereceğim.', 'tr'],
    ['Could you send me the final offer by Friday?', 'en'],
    ['Können Sie mir bitte das Angebot schicken?', 'de'],
    ['Merci, nous allons vérifier cette question.', 'fr'],
    ['Привет, как дела?', 'ru'],
  ])('%s → %s', (text, expected) => expect(detectLanguage(text)).toBe(expected));

  it('kısa ve belirsiz sözde emin değildir', () => {
    expect(detectLanguage('OK')).toBeNull();
    expect(detectLanguage('')).toBeNull();
  });
});

describe('soru sezgisi', () => {
  it.each([
    ['When can you deliver the first batch?', 'question'],
    ['Teslim tarihi ne zaman olur?', 'question'],
    ['Teslim tarihi ne zaman olur', 'maybe'],
    ['Bu teklifi onaylıyor musunuz', 'question'],
    ['Fiyatı biraz indirebilir misiniz', 'question'],
    ['Could you send the contract', 'question'],
    ['Is the budget approved for next year', 'maybe'],
    ['We shipped the first batch yesterday.', 'no'],
    ['Tamam.', 'no'],
  ])('%s → %s', (text, expected) => expect(questionKind(text)).toBe(expected));
});

describe('yankı süzgeci (hoparlörden mikrofona kaçan karşı taraf)', () => {
  const theirs = [line('Could you send me the final offer by Friday?', 10, 14)];

  it('aynı sözün mikrofondaki bulanık kopyası yankıdır', () => {
    // Whisper ikinci kaynakta birebir yazmaz: "send me" → "sent me", "Friday" → "friday".
    expect(isEcho(line('Could you sent me the final offer by friday', 10.4, 14.2), theirs)).toBe(true);
  });

  it('kullanıcının gerçek sözü yankı değildir (aynı anda konuşsa da)', () => {
    expect(isEcho(line('Evet, cuma günü gönderirim.', 15, 17), theirs)).toBe(false);
  });

  it('zamanca uzak benzer söz yankı sayılmaz', () => {
    expect(isEcho(line('Could you send me the final offer by Friday?', 60, 64), theirs)).toBe(false);
  });

  it('kısa sözde yalnız birebir eşleşme', () => {
    expect(echoCoverage('Tamam', 'Tamam, anlaştık o zaman.')).toBe(1);
    expect(echoCoverage('Evet', 'Hayır, olmaz.')).toBe(0);
  });
});

describe('bağlam', () => {
  it('sınırlar uygulanır, bilinmeyen alan atılır, belge sayısı en çok dört', () => {
    const context = cleanContext({
      topic: 'x'.repeat(500),
      participants: 'Kaan, Ayşe',
      notes: 'not',
      glossary: 'KDV, Atlas',
      documents: Array.from({ length: 6 }, (_, index) => ({ name: `b${index}.pdf`, text: 'metin '.repeat(5000) })),
      secret: 'atılır',
    });
    expect(context.topic).toHaveLength(200);
    expect(context.documents).toHaveLength(4);
    expect(context.documents[0]?.truncated).toBe(true);
    expect(context).not.toHaveProperty('secret');
  });

  it('çeviri istemine yalnız terim sözlüğü girer; bütçeyi aşmaz', () => {
    const context = cleanContext({ participants: 'Kaan Yılmaz', glossary: 'KDV, Atlas', documents: [{ name: 'a.txt', text: 'ACME firması ile Atlas Labs anlaşması' }] });
    const text = contextText(context, 'translation');
    expect(text).toContain('Atlas');
    expect(text).toContain('Kaan Yılmaz');
    expect(text.length).toBeLessThanOrEqual(700);
    expect(translationInstructions('tr', context)).toContain('Turkish');
  });

  it('öneri bağlamında belge talimat değil veri olarak işaretlenir ve soruyla örtüşen paragraf öne çıkar', () => {
    const context = cleanContext({ topic: 'Teklif', documents: [{ name: 'teklif.txt', text: 'Giriş paragrafı.\nTeslim süresi altı haftadır.\nÖdeme peşin.' }] });
    const text = contextText(context, 'suggestion', 'teslim süresi ne kadar');
    expect(text).toContain('not instructions');
    expect(text.indexOf('Teslim süresi')).toBeLessThan(text.indexOf('Giriş'));
  });
});

describe('özet', () => {
  const lines = [
    { id: 'l1', text: 'Fiyatı yüzde on indirmeye karar verdik.', speaker: 'me' as const, startedAt: at(0) },
    { id: 'l2', text: 'I will send the signed contract tomorrow.', speaker: 'them' as const, startedAt: at(30) },
  ];

  it('numaralı döküm satır numarası ve süre taşır', () => {
    const text = numberedTranscript(lines, at(0));
    expect(text).toContain('[1] 0:00 Me: Fiyatı');
    expect(text).toContain('[2] 0:30 Other side: I will');
  });

  it('uzun dökümde baş ve son kalır, ortası kısaltılır', () => {
    const many = Array.from({ length: 400 }, (_, index) => ({ text: `satır ${index} ${'uzun metin '.repeat(10)}`, speaker: 'me' as const, startedAt: at(index) }));
    const text = numberedTranscript(many, at(0), 5000);
    expect(text.length).toBeLessThanOrEqual(5100);
    expect(text).toContain('[1] ');
    expect(text).toContain('[400] ');
    expect(text).toContain('omitted');
  });

  it('alıntısı satırda geçmeyen ya da olmayan satıra dayanan madde atılır (uydurmaya karşı)', () => {
    const { summary, dropped } = groundSummary(
      {
        points: [{ text: 'İndirim konuşuldu', line: 1, quote: 'yüzde on indirmeye' }],
        decisions: [
          { text: 'Yüzde on indirim', line: 1, quote: 'indirmeye karar verdik' },
          { text: 'Yeni ofis kiralanacak', line: 1, quote: 'yeni ofis kiralama' },
          { text: 'Olmayan satır', line: 9, quote: 'fiyatı' },
        ],
        actions: [{ text: 'İmzalı sözleşmeyi gönder', line: 2, quote: 'send the signed contract', owner: 'Karşı taraf', due: '2026-11-17' }],
      },
      lines,
    );
    expect(dropped).toBe(2);
    expect(summary.decisions.map((item) => item.text)).toEqual(['Yüzde on indirim']);
    expect(summary.actions[0]).toMatchObject({ lineId: 'l2', owner: 'Karşı taraf', due: '2026-11-17' });
  });

  it('alıntı bulanık eşleşir ama rastgele sözcük yetmez', () => {
    expect(quoteSupported('send signed contract', 'I will send the signed contract tomorrow.')).toBe(true);
    expect(quoteSupported('ship the hardware', 'I will send the signed contract tomorrow.')).toBe(false);
  });

  it('yerel özet sınırı bağlamın yarısından azdır', () => {
    expect(LOCAL_SUMMARY_MAX).toBeLessThan(8192 * 3 * 0.5);
  });

  it('model yanıtından JSON ayıklanır', () => {
    expect(extractJson('```json\n{"points": []}\n```')).toEqual({ points: [] });
    expect(extractJson('İşte özet: {"a": 1} umarım işe yarar')).toEqual({ a: 1 });
    expect(extractJson('düz metin')).toBeNull();
  });

  it('başlık: konu, yoksa özetin ilk noktası, yoksa ilk satır', () => {
    expect(meetingTitle({ topic: 'Atlas teklifi' })).toBe('Atlas teklifi');
    expect(meetingTitle({ firstLine: 'Merhaba herkese' })).toBe('Merhaba herkese');
    expect([...meetingTitle({ firstLine: 'a'.repeat(200) })]).toHaveLength(90);
  });
});
