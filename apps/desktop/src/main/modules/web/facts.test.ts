import { describe, expect, it } from 'vitest';
import { countryCode, createDays, createFx, currencyCode, describeDay, fixedTurkishHolidays, fxSpeech, parseTcmb } from './facts';
import { fakeFetch, fixture } from './fake-fetch';

const tcmbRoute = { match: 'tcmb.gov.tr', contentType: 'application/xml', body: fixture('tcmb-today.xml') };
const ecbRoute = { match: 'api.frankfurter.dev', contentType: 'application/json', body: fixture('frankfurter-usd.json') };

describe('döviz', () => {
  it('para birimi adları', () => {
    expect(currencyCode('dolar')).toBe('USD');
    expect(currencyCode('Amerikan Doları')).toBe('USD');
    expect(currencyCode('Euro')).toBe('EUR');
    expect(currencyCode('avro')).toBe('EUR');
    expect(currencyCode('sterlin')).toBe('GBP');
    expect(currencyCode('TL')).toBe('TRY');
    expect(currencyCode('lira')).toBe('TRY');
    expect(currencyCode('sek')).toBe('SEK');
    expect(currencyCode('bitcoin')).toBeNull();
  });

  it('TCMB bülteni', () => {
    const bulletin = parseTcmb(fixture('tcmb-today.xml'));
    expect(bulletin.date).toBe('2026-11-13');
    expect(bulletin.rates.get('USD')).toMatchObject({ unit: 1, forexBuying: 50.1926, forexSelling: 50.283 });
    expect(bulletin.rates.get('JPY')?.unit).toBe(100);
  });

  it('dolar kaç lira: TCMB satış kuru, tarihiyle', async () => {
    const quote = await createFx(fakeFetch([tcmbRoute, ecbRoute])).quote('USD', 'TRY', 1);
    expect(quote).toMatchObject({ source: 'TCMB', date: '2026-11-13', selling: 50.283, buying: 50.1926 });
    expect(fxSpeech(quote)).toBe("TCMB'nin 13 Kasım 2026 kuruyla 1 dolar 50,28 lira (döviz satış; alış 50,19).");
  });

  it('TL → döviz ve tutar', async () => {
    const quote = await createFx(fakeFetch([tcmbRoute])).quote('TRY', 'EUR', 1000);
    expect(quote.source).toBe('TCMB');
    expect(quote.result).toBeGreaterThan(10);
    expect(quote.result).toBeLessThan(30);
  });

  it('TCMB yavaşsa (ölçüldü: 3–9 sn) ECB kuruyla yanıtlar; TCMB arkada önbelleğe dolar', async () => {
    const fetcher = fakeFetch([{ ...tcmbRoute, delayMs: 200 }, ecbRoute]);
    const fx = createFx(fetcher, Date.now, { tcmbWaitMs: 20 });
    const quick = await fx.quote('USD', 'TRY', 1);
    expect(quick.source).toBe('Frankfurter (ECB)');
    expect(fxSpeech(quick)).toContain('Avrupa Merkez Bankası');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const later = await fx.quote('USD', 'TRY', 1);
    expect(later.source).toBe('TCMB');
    expect(fetcher.calls.filter((url) => url.includes('tcmb'))).toHaveLength(1);
  });

  it('TL dışı çift ECB’den; bilinmeyen kod dürüst hata', async () => {
    const fx = createFx(fakeFetch([ecbRoute]));
    const quote = await fx.quote('USD', 'EUR', 100);
    expect(quote.source).toBe('Frankfurter (ECB)');
    await expect(fx.quote('USD', 'XYZ', 1)).rejects.toMatchObject({ name: 'UnknownCurrencyError' });
  });

  it('iki kaynak da düşerse hata', async () => {
    await expect(createFx(fakeFetch([{ match: /./, fail: 'network' }]), Date.now, { tcmbWaitMs: 50 }).quote('USD', 'TRY', 1)).rejects.toThrow();
  });
});

describe('gün ve resmî tatil', () => {
  const holidays2026 = (JSON.parse(fixture('nager-2026-tr.json')) as Array<{ date: string; localName: string }>).map((entry) => ({ date: entry.date as `${number}-${number}-${number}`, name: entry.localName }));

  it('tatil günü ve sıradaki tatil', () => {
    const info = describeDay('2026-10-29', '2026-10-29', 'TR', holidays2026, true);
    expect(info.holiday?.name).toBe('Cumhuriyet Bayramı');
    expect(info.speech.startsWith("Bugün 29 Ekim 2026, Perşembe. Türkiye'de resmî tatil: Cumhuriyet Bayramı.")).toBe(true);
    const may = describeDay('2026-05-20', '2026-05-20', 'TR', holidays2026, true);
    expect(may.holiday).toBeNull();
    expect(may.next?.name).toMatch(/Kurban Bayramı/);
    expect(may.speech).toContain("Türkiye'de resmî tatil değil.");
  });

  it('ağ yoksa sabit tatillere bakılır ve eksik olduğu söylenir', async () => {
    const days = createDays(fakeFetch([{ match: /./, fail: 'network' }]), () => new Date('2026-11-16T10:00:00').getTime());
    const info = await days.info('2026-11-16', 'TR');
    expect(info.complete).toBe(false);
    expect(info.speech).toContain('dinî bayramlar denetlenemedi');
    expect(info.next?.name).toBe('Yılbaşı');
    expect(fixedTurkishHolidays(2027)).toHaveLength(7);
  });

  it('ülke adları; Nager’e yalnız yıl ve ülke kodu gider', async () => {
    expect(countryCode('İngiltere')).toBe('GB');
    expect(countryCode('uk')).toBe('GB');
    expect(countryCode(undefined)).toBe('TR');
    const fetcher = fakeFetch([{ match: 'date.nager.at', contentType: 'application/json', body: fixture('nager-2026-tr.json') }]);
    const info = await createDays(fetcher, () => new Date('2026-11-16T10:00:00').getTime()).info('2026-11-16', 'TR');
    expect(fetcher.calls[0]).toBe('https://date.nager.at/api/v3/PublicHolidays/2026/TR');
    expect(info.speech.startsWith("Bugün 16 Kasım 2026, Pazartesi. Türkiye'de resmî tatil değil.")).toBe(true);
  });
});
