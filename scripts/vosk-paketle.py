# Vosk küçük Türkçe modelini (düz yapı) vosk-browser'ın beklediği yapıya çevirip resources/vosk/tr.tar.gz yazar.
#   model/am/final.mdl, model/conf/{mfcc.conf,model.conf}, model/ivector/*, model/graph/{Gr.fst,HCLr.fst,disambig_tid.int},
#   model/graph/phones/word_boundary.int
# Kaynak: https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip (Apache 2.0), .uretim/vosk/ altına açılmış.
import io, os, sys, tarfile

kaynak = sys.argv[1] if len(sys.argv) > 1 else os.path.join('..', '..', '..', '.uretim', 'vosk', 'vosk-model-small-tr-0.3')
hedef = os.path.join('resources', 'vosk', 'tr.tar.gz')
os.makedirs(os.path.dirname(hedef), exist_ok=True)

YERLESIM = {
    'final.mdl': 'am/final.mdl',
    'mfcc.conf': 'conf/mfcc.conf',
    'Gr.fst': 'graph/Gr.fst',
    'HCLr.fst': 'graph/HCLr.fst',
    'disambig_tid.int': 'graph/disambig_tid.int',
    'word_boundary.int': 'graph/phones/word_boundary.int',
}
MODEL_CONF = b"""--min-active=200
--max-active=3000
--beam=10.0
--lattice-beam=2.0
--acoustic-scale=1.0
--frame-subsampling-factor=3
--endpoint.silence-phones=1:2:3:4:5:6:7:8:9:10
--endpoint.rule2.min-trailing-silence=0.5
--endpoint.rule3.min-trailing-silence=1.0
--endpoint.rule4.min-trailing-silence=2.0
"""

# vosk-browser'ın açıcısı alt klasörleri KENDİSİ oluşturmaz: klasör girdileri arşivde dosyalardan önce açıkça
# bulunmalı (yoksa dosyalar sessizce yazılamaz ve "Folder ... does not contain model files" hatası gelir).
KLASORLER = ['model', 'model/am', 'model/conf', 'model/graph', 'model/graph/phones', 'model/ivector']

with tarfile.open(hedef, 'w:gz') as t:
    for k in KLASORLER:
        d = tarfile.TarInfo(k)
        d.type = tarfile.DIRTYPE
        d.mode = 0o755
        t.addfile(d)
    for ad, yeni in YERLESIM.items():
        t.add(os.path.join(kaynak, ad), arcname=f'model/{yeni}')
    for ad in os.listdir(os.path.join(kaynak, 'ivector')):
        t.add(os.path.join(kaynak, 'ivector', ad), arcname=f'model/ivector/{ad}')
    bilgi = tarfile.TarInfo('model/conf/model.conf')
    bilgi.size = len(MODEL_CONF)
    t.addfile(bilgi, io.BytesIO(MODEL_CONF))
print(hedef, os.path.getsize(hedef), 'bayt')
