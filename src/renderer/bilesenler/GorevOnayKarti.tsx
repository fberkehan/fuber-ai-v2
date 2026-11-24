// ── Görev başlatma onay kartı (0.11 G10; spec §8 "Onay kartı") ───────────────────────────────────────────────────────────────────────
// Kullanıcı "şunu takip et" dediğinde Fuber bir plan hazırlar; plan TEK kartla onaylanır ("Başlat" / "Vazgeç"). Kart planın bütününü insan diliyle
// gösterir (main/ajan/araclar/isler.ts → shared/isler.ts isPlaniMetni): Ne yapacak · Nasıl kontrol eder · Ne zaman biter · İzinler · Adım sınırı; üstte
// görevin amacı (kullanıcının sözleriyle; uzunsa MetinKirp ile 3 satır, tamamı ipucunda). WhatsApp izni KİŞİYE bağlıdır: "Ahmet’e (…2233) WhatsApp’tan
// yazabilir" — numaranın yalnız son dört hanesi görünür, tam numara hiçbir yerde yazılmaz. "Bu görev boyunca izin ver" seçeneği yoktur: izinler planın
// içindedir. Görev onayı YALNIZ masada ve adada görünür (telefona gitmez: shared/kopru-protokol.ts telefondaGosterilmez), bu yüzden bu kart yalnız
// masaüstü sohbetinde (bilesenler/Sohbet.tsx OnayKarti) ve adada (ada/Ada.tsx) çizilir. Genel onay kartının çerçevesini (.onay) paylaşır.
import { Ikon } from './Ikon';
import { MetinKirp } from '../ui';
import type { OnayIstegi } from '../../shared/tipler';
import { TERIM } from '../../shared/terimler';
import './gorev-onay.css';

/** İzin yoksa söylenen sakin cümle (kimseye yazmaz, ekranı kullanmaz) — tool önizlemesiyle aynı. */
export const IZIN_YOK_METNI = 'Yok — kimseye yazmaz, ekranı kullanmaz.';

function Alan({ ad, anahtar, children }: { ad: string; anahtar: string; children: React.ReactNode }) {
  return (
    <div className="onay-gorev__alan" data-alan={anahtar}>
      <dt>{ad}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function GorevOnayKarti({ o, karar }: { o: OnayIstegi; karar: (id: string, k: 'bir_kez' | 'reddet') => void }) {
  const g = o.gorev;
  if (!g) return null;
  return (
    <div className="onay onay-gorev" data-tehlike={o.tehlike} data-onay-gorev="" role="group" aria-label={`${TERIM.gorev} onayı: ${g.baslik}`}>
      <div className="onay__etiket">{TERIM.gorev} · onayın gerekiyor</div>
      <div className="onay__baslik"><Ikon ad="saat" olcu={16} /><span className="onay-gorev__baslik"><MetinKirp metin={`${TERIM.gorev}: ${g.baslik}`} satir={2} as="span" /></span></div>
      {o.aciklama && <div className="onay-gorev__amac" data-alan="amac"><MetinKirp metin={o.aciklama} satir={3} /></div>}
      <dl className="onay-gorev__liste">
        <Alan ad="Ne yapacak" anahtar="ne"><MetinKirp metin={g.ne} satir={2} as="span" /></Alan>
        <Alan ad="Nasıl kontrol eder" anahtar="nasil"><MetinKirp metin={g.nasil} satir={3} as="span" /></Alan>
        <Alan ad="Ne zaman biter" anahtar="bitis"><MetinKirp metin={g.bitis} satir={2} as="span" /></Alan>
        <Alan ad="İzinler" anahtar="izinler">
          {g.izinler.length
            ? <ul className="onay-gorev__izinler">{g.izinler.map((i, n) => <li key={n}><MetinKirp metin={i} satir={2} as="span" /></li>)}</ul>
            : <MetinKirp metin={IZIN_YOK_METNI} satir={2} as="span" />}
        </Alan>
        <Alan ad="Adım sınırı" anahtar="sinir"><MetinKirp metin={g.sinir} satir={2} as="span" /></Alan>
      </dl>
      <div className="onay__dugmeler">
        <button type="button" className="dgm dgm--beyaz dgm--k" data-karar="baslat" onClick={() => karar(o.id, 'bir_kez')}><Ikon ad="tamam" olcu={14} />Başlat</button>
        <button type="button" className="dgm dgm--hayalet dgm--k" data-karar="vazgec" onClick={() => karar(o.id, 'reddet')}>Vazgeç</button>
      </div>
    </div>
  );
}
