"""set-hazirla.mjs'in Python yarısı: Common Voice parquet'i ve Piper (Node'da karşılığı yok).

  cv <parquet> <ayar.wav> <sinama.wav> <metin.txt> <ayar_sn>      klipleri karıştırıp 0,2-1 sn boşlukla iki akış yazar
  piper <ses-klasoru> <metin.txt> <cikti.wav> <adet> <atla>        cümleleri okur (0,25-1 sn boşluk)
  klipler <ses-klasoru> <cumleler.txt> <klasor> <ses>              her cümleye bir klip (0,7 sn önce, 1,5 sn sonra sessizlik)
  olumlu <ses-klasoru> <klasor> <ses>                              "Hey Fuber" tutulan sınav klipleri
Piper sesleri sherpa-onnx'in VITS paketinden gelir (.onnx + .onnx.json), piper-tts ile okunur; yalnız ölçüm aracıdır, ürüne girmez.
"""
import io
import random
import sys
import wave

import numpy as np

HZ = 16000
TOHUM = 20261031


def wav_yaz(yol, o, hz):
    with wave.open(yol, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(hz)
        w.writeframes((np.clip(o, -1, 1) * 32767).astype(np.int16).tobytes())


def cv(parquet, ayar, sinama, metin, ayar_sn):
    import pyarrow.parquet as pq
    import soundfile as sf
    t = pq.read_table(parquet, columns=['audio', 'transcription', 'duration'])
    r = random.Random(TOHUM)
    sira = list(range(t.num_rows))
    r.shuffle(sira)
    metinler, parcalar, hedef = [], [], ayar
    birikti, ayar_sn = 0.0, float(ayar_sn)
    for s, i in enumerate(sira):
        x, hz = sf.read(io.BytesIO(t['audio'][i].as_py()['bytes']), dtype='float32')
        if x.ndim > 1:
            x = x.mean(axis=1)
        if hz != HZ:
            raise SystemExit(f'beklenmeyen hız {hz}')
        parcalar.append(x)
        parcalar.append(np.zeros(int(HZ * r.uniform(0.2, 1.0)), dtype=np.float32))
        birikti += (len(x) + len(parcalar[-1])) / HZ
        metinler.append(t['transcription'][i].as_py())
        if hedef is ayar and birikti >= ayar_sn:
            wav_yaz(ayar, np.concatenate(parcalar), HZ)
            parcalar, hedef = [], sinama
    wav_yaz(sinama, np.concatenate(parcalar), HZ)
    with open(metin, 'w', encoding='utf-8') as f:
        f.write('\n'.join(metinler))
    print(f'  cv: {t.num_rows} klip, {sum(t["duration"].to_pylist()) / 3600:.2f} saat konuşma')


def _ses(klasor):
    import glob
    from piper import PiperVoice
    return PiperVoice.load(glob.glob(f'{klasor}/*.onnx')[0])


def _oku(v, metin, olcek=None):
    from piper import SynthesisConfig
    parca = list(v.synthesize(metin, syn_config=SynthesisConfig(length_scale=olcek) if olcek else None))
    return np.concatenate([p.audio_float_array for p in parca]).astype(np.float32), parca[0].sample_rate


def piper(model, metin, cikti, adet, atla):
    v = _ses(model)
    cumle = [s.strip() for s in open(metin, encoding='utf-8').read().split('\n') if s.strip()][int(atla):][: int(adet)]
    r = random.Random(TOHUM + int(atla))
    p, hz = [], 22050
    for s in cumle:
        try:
            x, hz = _oku(v, s)
        except Exception:
            continue
        p.append(x)
        p.append(np.zeros(int(hz * r.uniform(0.25, 1.0)), dtype=np.float32))
    wav_yaz(cikti, np.concatenate(p), hz)
    print(f'  piper {model[-12:]}: {sum(len(x) for x in p) / hz / 60:.1f} dk')


def _klip(v, metin, yol, olcek=None):
    x, hz = _oku(v, metin, olcek)
    z = np.zeros(int(hz * 0.7), dtype=np.float32)
    wav_yaz(yol, np.concatenate([z, x, np.zeros(int(hz * 1.5), dtype=np.float32)]), hz)


def klipler(model, cumleler, klasor, ses):
    v = _ses(model)
    for i, s in enumerate(c for c in open(cumleler, encoding='utf-8').read().split('\n') if c.strip()):
        _klip(v, s, f'{klasor}/{ses}_{i:03d}.wav')


OLUMLU = ['Hey Fuber.', 'Hey Fuber!', 'Hey, Fuber.', 'Hey Fuber, yarın sabah ne var?', 'Hey Fuber, saat kaç?',
          'Hey Fuber, bana bir hatırlatıcı kur.', 'Hey Fuber, e-postalarıma bakar mısın?']


def olumlu(model, klasor, ses):
    v = _ses(model)
    for i, s in enumerate(OLUMLU):
        for ad, olcek in (('hizli', 0.85), ('orta', 1.0), ('yavas', 1.2)):
            _klip(v, s, f'{klasor}/{ses}_{i:02d}_{ad}.wav', olcek)


if __name__ == '__main__':
    {'cv': cv, 'piper': piper, 'klipler': klipler, 'olumlu': olumlu}[sys.argv[1]](*sys.argv[2:])
