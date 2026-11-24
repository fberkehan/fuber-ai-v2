"""'Hey Fuber' uyandırma ölçümü — Vosk taban çizgisi: 0.13 öncesi src/renderer/kulak.ts ile AYNI dil bilgisi ve karar kuralı.

1) Klipler (Microsoft Tolga, tr-TR OneCore sesi; satır: ad|SSML, 'p' = uyandırmalı, 'n' = uyandırmamalı):
   powershell -File scripts/dev/uyandirma/tolga.ps1 -Klasor <klasör> -Liste scripts/dev/uyandirma/klipler-1.txt
2) Ölçüm (Python vosk paketi + vosk-model-small-tr-0.3 klasörü):
   python scripts/dev/uyandirma/olc.py <model-klasörü> <klip-klasörü> ['<aday dil bilgisi JSON>']
19 Eki 2026 sonucu (iki takım, 50 klip): 16/20 doğru uyanma, 1/30 yanlış alarm ("Hey Uber").
Ortam değişkenleri HEY / AD / ADLAR ile eşikler denenebilir.

3) Sürekli akış (olc.mjs çağırır): python olc.py --akis <model-klasörü> <wav>
   Uygulamadaki gibi TEK tanıyıcı bütün akışı dinler; uyandıran her sonucun zamanını JSON yazar.
   python olc.py --json <model-klasörü> <klip-klasörü>   her klip için {ad, uyandi} JSON yazar.
"""
import glob, json, os, sys, wave
from vosk import Model, KaldiRecognizer, SetLogLevel

SetLogLevel(-1)
sys.stdout.reconfigure(encoding='utf-8')
GRAMER = ['hey fiber', 'hey fuar', 'hay fiber', 'ey fiber', 'hey süper', 'fiber', '[unk]']
HEY, AD, SURE, ARA = float(os.environ.get('HEY', 0.45)), float(os.environ.get('AD', 0.97)), 0.12, 0.6
ADLAR = set(os.environ.get('ADLAR', 'fiber').split(','))


def uyanan_zaman(sonuc):
    k = sonuc.get('result', [])
    for h, s in zip(k, k[1:]):
        if h['word'] in ('hey', 'hay', 'ey') and h['conf'] >= HEY and s['word'] in ADLAR and s['conf'] >= AD \
                and s['end'] - s['start'] >= SURE and s['start'] - h['end'] < ARA:
            return s['end']
    return None


def uyandi_mi(sonuclar):
    return any(uyanan_zaman(s) is not None for s in sonuclar)


def akis(model, yol):
    m = Model(model)
    w = wave.open(yol, 'rb')
    r = KaldiRecognizer(m, w.getframerate(), json.dumps(GRAMER, ensure_ascii=False))
    r.SetWords(True)
    zamanlar = []
    def bak(s):
        z = uyanan_zaman(s)
        if z is not None:
            zamanlar.append(round(z, 2))
    while True:
        d = w.readframes(2000)
        if not d:
            break
        if r.AcceptWaveform(d):
            bak(json.loads(r.Result()))
    bak(json.loads(r.FinalResult()))
    print(json.dumps({'zamanlar': zamanlar, 'sn': w.getnframes() / w.getframerate()}))


def klip_sonuclari(m, f, gramer):
    w = wave.open(f, 'rb')
    r = KaldiRecognizer(m, w.getframerate(), json.dumps(gramer, ensure_ascii=False))
    r.SetWords(True)
    sonuclar = []
    while True:
        d = w.readframes(4000)
        if not d:
            break
        if r.AcceptWaveform(d):
            sonuclar.append(json.loads(r.Result()))
    sonuclar.append(json.loads(r.FinalResult()))
    return sonuclar


def json_klipler(model, klasor):
    m = Model(model)
    for f in sorted(glob.glob(os.path.join(klasor, '*.wav'))):
        print(json.dumps({'ad': os.path.basename(f)[:-4], 'uyandi': uyandi_mi(klip_sonuclari(m, f, GRAMER))}, ensure_ascii=False))


def insan_okur(model, klasor, aday):
    m = Model(model)
    gramerler = {'kulak.ts': GRAMER}
    if aday:
        gramerler['aday'] = json.loads(aday)
    for ad, gramer in gramerler.items():
        dogru = kacan = yanlis = pozitif_sayi = negatif_sayi = 0
        print(f'== {ad}: {gramer}')
        for f in sorted(glob.glob(os.path.join(klasor, '*.wav'))):
            sonuclar = klip_sonuclari(m, f, gramer)
            u = uyandi_mi(sonuclar)
            isim = os.path.basename(f)[:-4]
            pozitif = isim.startswith('p')
            pozitif_sayi += pozitif
            negatif_sayi += not pozitif
            dogru += pozitif and u
            kacan += pozitif and not u
            yanlis += (not pozitif) and u
            metin = ' || '.join(' '.join(f"{x['word']}:{x['conf']:.2f}" for x in s.get('result', [])) for s in sonuclar if s.get('text'))
            isaret = ('✓' if u else '✗ KAÇTI') if pozitif else ('✗ YANLIŞ ALARM' if u else '·')
            print(f'  {isaret:14} {isim:22} {metin}')
        print(f'  → doğru uyanma {dogru}/{pozitif_sayi} · kaçan {kacan} · yanlış alarm {yanlis}/{negatif_sayi}')


if __name__ == '__main__':
    if sys.argv[1] == '--akis':
        akis(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == '--json':
        json_klipler(sys.argv[2], sys.argv[3])
    else:
        insan_okur(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
