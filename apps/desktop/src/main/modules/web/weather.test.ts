import { describe, expect, it } from 'vitest';
import { fakeFetch, fixture } from './fake-fetch';
import { locative, placeCandidates } from './text';
import { buildReport, createWeather, describeCode, pickPlace, PlaceNotFoundError, rainVerdict } from './weather';

const forecast = JSON.parse(fixture('om-forecast-ankara.json'));
const ankara = pickPlace(JSON.parse(fixture('om-geocode-ankara.json')))!;

describe('yer adı', () => {
  it('Türkçe ekleri ayıklar', () => {
    expect(placeCandidates("Ankara'nın")).toEqual(['Ankara']);
    expect(placeCandidates('Rize’de')).toEqual(['Rize']);
    expect(placeCandidates('rizede')).toEqual(['rizede', 'rize']);
    expect(placeCandidates('istanbulda')).toEqual(['istanbulda', 'istanbul']);
    expect(placeCandidates('İzmir ilinde')).toEqual(['İzmir']);
    expect(placeCandidates('Bodrum')).toEqual(['Bodrum']);
  });

  it('bulunma eki ünlü uyumuna ve sert ünsüze uyar', () => {
    expect(locative('Ankara')).toBe("Ankara'da");
    expect(locative('Rize')).toBe("Rize'de");
    expect(locative('Paris')).toBe("Paris'te");
    expect(locative('İstanbul')).toBe("İstanbul'da");
    expect(locative('Kadıköy')).toBe("Kadıköy'de");
    expect(locative('Erzurum')).toBe("Erzurum'da");
  });

  it('en olası yeri seçer: başkent, nüfus, Türkiye', () => {
    expect(ankara).toMatchObject({ name: 'Ankara', countryCode: 'TR', major: true });
    const ambiguous = {
      results: [
        { name: 'Kadıköy', latitude: 1, longitude: 1, country_code: 'TR', admin1: 'Yalova', population: 2741, feature_code: 'PPL' },
        { name: 'Kadıköy', latitude: 2, longitude: 2, country_code: 'TR', admin1: 'İstanbul', admin2: 'Silivri', population: 1454, feature_code: 'PPL' },
      ],
    };
    expect(pickPlace(ambiguous)?.admin1).toBe('Yalova');
    expect(pickPlace(ambiguous, 'İstanbul')?.admin1).toBe('İstanbul');
  });

  it('ilçe adı sorulunca aynı adlı köyü değil ilçeyi seçer', () => {
    // Kodlayıcının "Kadıköy" yanıtından (16 Kas 2026): ilçe yerleşim olarak yok, kanıtı bir burun kaydı.
    const kadikoy = {
      results: [
        { name: 'Kadıköy', latitude: 40.62, longitude: 29.22, country_code: 'TR', admin1: 'Yalova', admin2: 'Yalova', population: 2741, feature_code: 'PPL' },
        { name: 'Kadıköy', latitude: 41.13, longitude: 28.36, country_code: 'TR', admin1: 'İstanbul', admin2: 'Silivri', population: 1454, feature_code: 'PPL' },
        { name: 'Kadıköy Barajı', latitude: 40.79, longitude: 26.77, country_code: 'TR', admin1: 'Edirne', admin2: 'Keşan İlçesi', feature_code: 'DAM' },
        { name: 'Kadıköy Burnu', latitude: 40.99096, longitude: 29.01736, country_code: 'TR', admin1: 'İstanbul', admin2: 'Kadıköy', feature_code: 'CAPE' },
      ],
    };
    expect(pickPlace(kadikoy, undefined, 'Kadıköy')).toMatchObject({ name: 'Kadıköy', admin1: 'İstanbul', latitude: 40.99096, major: false });
    // Niteleyici hâlâ kazanır: "Kadıköy, Yalova" köydür.
    expect(pickPlace(kadikoy, 'Yalova', 'Kadıköy')?.admin1).toBe('Yalova');
    // İlçe yerleşim olarak varsa nüfusu olmasa da köyün önüne geçer.
    const besiktas = {
      results: [
        { name: 'Beşiktaş', latitude: 41.1, longitude: 42.7, country_code: 'TR', admin1: 'Ardahan', admin2: 'Ardahan', population: 342, feature_code: 'PPL' },
        { name: 'Beşiktaş', latitude: 41.04, longitude: 29.0, country_code: 'TR', admin1: 'İstanbul', admin2: 'Beşiktaş', feature_code: 'PPL' },
      ],
    };
    expect(pickPlace(besiktas, undefined, 'Beşiktaş')).toMatchObject({ name: 'Beşiktaş', admin1: 'İstanbul' });
    // Yerleşim olmayan sonuç (dağ, baraj) tek başına yer sayılmaz.
    const kartal = {
      results: [
        { name: 'Kartal', latitude: 41.4, longitude: 24.7, country_code: 'BG', feature_code: 'PK' },
        { name: 'Kartal', latitude: 47.67, longitude: 19.54, country_code: 'HU', admin1: 'Pest ili', population: 6017, feature_code: 'PPL' },
        { name: 'Kartal', latitude: 40.9, longitude: 29.19, country_code: 'TR', admin1: 'İstanbul', admin2: 'Kartal', feature_code: 'PPL' },
      ],
    };
    expect(pickPlace(kartal, undefined, 'Kartal')?.admin1).toBe('İstanbul');
    expect(pickPlace({ results: [{ name: 'Kartal', latitude: 41.4, longitude: 24.7, country_code: 'BG', feature_code: 'PK' }] }, undefined, 'Kartal')).toBeNull();
  });
});

describe('rapor', () => {
  it('bugün: şu an + gün içi en düşük/en yüksek + yağış', () => {
    const report = buildReport(ankara, forecast, 'today');
    expect(report.speech).toBe("Ankara'da şu an 11 derece, kapalı; hissedilen 9; rüzgâr saatte 5 km. Bugün kapalı; en düşük 6, en yüksek 13 derece; yağış olasılığı yüzde 5.");
    expect(report.current).toMatchObject({ temperature: 11, feelsLike: 9, summary: 'kapalı', humidity: 75 });
  });

  it('yarın: yağmur sorusuna yargı', () => {
    const report = buildReport(ankara, forecast, 'tomorrow');
    expect(report.speech).toContain("Ankara'da yarın (Salı) gök gürültülü sağanak");
    expect(report.speech).toContain('yağış olasılığı yüzde 48 (yaklaşık 2,4 mm)');
    expect(report.speech).toContain('yağmur bekleniyor'); // gök gürültülü sağanak kodu + %48
  });

  it('hafta: yedi gün, yağışlı günler başta', () => {
    const report = buildReport(ankara, forecast, 'week');
    expect(report.days).toHaveLength(7);
    expect(report.speech.startsWith("Ankara'da bu hafta yağışlı günler: cuma, cumartesi.")).toBe(true);
  });

  it('hava kodu ve yağmur yargısı', () => {
    expect(describeCode(0)).toBe('açık');
    expect(describeCode(75)).toBe('yoğun kar yağışlı');
    expect(describeCode(42)).toBe('değişken');
    const day = { date: '2026-11-17', weekday: 'Salı', code: 73, summary: '', min: 0, max: 2, precipitationChance: 80, precipitationMm: 5, windMaxKmh: 10 };
    expect(rainVerdict(day)).toBe('kar bekleniyor');
    expect(rainVerdict({ ...day, code: 1, precipitationChance: 10 })).toBe('yağmur beklenmiyor');
  });
});

describe('createWeather (sahte ağ)', () => {
  it('Türkçe ekli yer adıyla çalışır, önbellekten okur', async () => {
    const fetcher = fakeFetch([
      { match: 'geocoding-api.open-meteo.com', contentType: 'application/json', body: fixture('om-geocode-ankara.json') },
      { match: 'api.open-meteo.com/v1/forecast', contentType: 'application/json', body: fixture('om-forecast-ankara.json') },
    ]);
    const weather = createWeather(fetcher);
    const first = await weather.get("Ankara'nın", 'today');
    expect(first.place.name).toBe('Ankara');
    await weather.get('Ankara', 'tomorrow');
    expect(fetcher.calls.filter((url) => url.includes('forecast'))).toHaveLength(1);
    expect(fetcher.calls.filter((url) => url.includes('geocoding'))).toHaveLength(1);
    // Dışarıya giden yalnız yer adı ve koordinat: kullanıcıya ait hiçbir şey yok.
    expect(fetcher.calls[0]).toBe('https://geocoding-api.open-meteo.com/v1/search?name=Ankara&count=50&language=tr&format=json');
    expect(fetcher.calls[1]).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=39\.9199&longitude=32\.8543&/);
  });

  it('yer bulunamazsa dürüst hata (eksiz adayı da dener)', async () => {
    const fetcher = fakeFetch([{ match: 'geocoding', contentType: 'application/json', body: '{"generationtime_ms":0.1}' }]);
    await expect(createWeather(fetcher).get('zzqqde', 'today')).rejects.toBeInstanceOf(PlaceNotFoundError);
    expect(fetcher.calls).toHaveLength(2);
  });
});
