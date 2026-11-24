// ── Panelin Raf sayfası (0.14 T27; R21) ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Çentiğe sürüklenen dosya ve metinlerin durağı. Dışarıdan bir şey çentiğe sürüklenince (useAsistan.ts surukleHareketi: `buttons === 1` fare hareketi) pencere bırakma
// hedefi olur ve panel bu sayfayla açılır: solda "Dosyaları buraya bırak" alanı (üstüne gelince "Bırak, ekleyeyim"), sağda en yeniden eskiye iki sütun kart (iki satır görünür,
// fazlası kayar; en çok 30). Raf DOSYAYI KOPYALAMAZ — yalnız yolunu, adını, boyutunu tutar (main/raf.ts, userData/raf.json). Tıklamak dosyayı açar (shell.openPath; çalıştırılabilir
// türler açılmaz, klasörde gösterilir; yerinde olmayan "Dosya yerinde yok" der), metin kartı panoya kopyalar. Kartı panelden dışarı (başka uygulamaya) sürüklemek dosyayı
// yerinde bırakır: işletim sistemi sürüklemesi ana süreçten başlar (webContents.startDrag). Açma ve sürükleme ana sürece YOL değil KİMLİK gider; yeni öğe eklerken de arayüz yol göndermez:
// bırakılan File nesneleri preload'un `rafBirak` köprüsüne verilir, yolu preload çözer (webUtils.getPathForFile); uydurma nesne boş yol verir ve eklenmez. (Liste yanıtı yolu
// arayüze GÖSTERMEK için döner; eylem için hiçbir yol geri gitmez.) Hiçbir şey bir yere yüklenmez (P14). Karakter yok
// (Sade modda da). Liste sayfa takılınca bir kez çekilir; yoklama ve zamanlayıcı yok (yalnız bildirim satırı için tek atımlık 3 sn). Hareket yalnız transform ve opacity.
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react';
import { cagir } from '../../api';
import { Ikon } from '../../bilesenler/Ikon';
import { DOSYA_YOK_METNI, boyutYaz, type RafOgesi } from '../../../shared/raf';

/** Bildirim satırının ekranda kaldığı süre (ms). */
const BILDIRIM_MS = 3000;

interface EkleSonucu { liste: RafOgesi[]; eklenen: number; reddedilen: { yol: string; neden: string }[]; cozulemeyen?: number }
interface AcSonucu { tamam: boolean; mesaj: string }

/** Son liste modülde tutulur: sayfalar arasında gezerken önceki liste hemen çizilir (arkadan taze liste gelir). */
let son: RafOgesi[] | null = null;

const dosyaMi = (o: RafOgesi): o is Extract<RafOgesi, { tur: 'dosya' }> => o.tur === 'dosya';

export function Raf(): ReactElement {
  const [liste, setListe] = useState<RafOgesi[] | null>(son);
  const [ustunde, setUstunde] = useState(false);
  const [bildirim, setBildirim] = useState('');
  const bildirimZaman = useRef<ReturnType<typeof setTimeout> | null>(null);

  const yaz = (l: RafOgesi[]) => { son = l; setListe(l); };
  const haber = (m: string) => {
    if (bildirimZaman.current) clearTimeout(bildirimZaman.current);
    setBildirim(m);
    bildirimZaman.current = setTimeout(() => { bildirimZaman.current = null; setBildirim(''); }, BILDIRIM_MS);
  };
  useEffect(() => {
    let takili = true;
    void Promise.resolve(cagir<RafOgesi[]>('raf:liste')).then((x) => { if (Array.isArray(x)) { son = x; if (takili) setListe(x); } }).catch(() => undefined);
    return () => { takili = false; if (bildirimZaman.current) clearTimeout(bildirimZaman.current); };
  }, []);

  const tum = liste ?? [];
  const bos = tum.length === 0;
  const gosterilen = [...tum].reverse(); // en yeni önce

  // ── Bırakma ──
  const birakilabilir = (e: DragEvent) => { const t = e.dataTransfer?.types; return Boolean(t && (t.includes('Files') || t.includes('text/plain'))); };
  const uzerinde = (e: DragEvent<HTMLDivElement>) => {
    if (!birakilabilir(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!ustunde) setUstunde(true);
  };
  const ayrildi = (e: DragEvent<HTMLDivElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setUstunde(false); };
  const birakildi = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setUstunde(false);
    const dosyalar = [...(e.dataTransfer?.files ?? [])];
    const metin = dosyalar.length === 0 ? e.dataTransfer?.getData('text/plain') ?? '' : '';
    const birak = window.fuber?.rafBirak;
    if (!birak || (dosyalar.length === 0 && !metin.trim())) return;
    void Promise.resolve(birak(dosyalar, metin)).then((x) => {
      const r = x as EkleSonucu | null;
      if (!r || !Array.isArray(r.liste)) return;
      yaz(r.liste);
      if (r.reddedilen.length) haber(r.reddedilen[0].neden);
      else if ((r.cozulemeyen ?? 0) > 0 && r.eklenen === 0) haber('Bu dosya eklenemedi');
      else if (r.eklenen === 0) haber('Zaten rafta');
      else haber(r.eklenen === 1 ? 'Rafa eklendi' : `${r.eklenen} öğe rafa eklendi`);
    }).catch(() => haber('Eklenemedi'));
  };

  // ── Kart eylemleri (ana sürece yalnız kimlik gider) ──
  const ac = (o: RafOgesi) => {
    void Promise.resolve(cagir<AcSonucu>('raf:ac', o.id)).then((r) => {
      if (r?.mesaj) haber(r.mesaj);
      if (r && !r.tamam && r.mesaj === DOSYA_YOK_METNI) void Promise.resolve(cagir<RafOgesi[]>('raf:liste')).then((x) => { if (Array.isArray(x)) yaz(x); }).catch(() => undefined);
    }).catch(() => haber('Açılamadı'));
  };
  const sil = (o: RafOgesi) => { void Promise.resolve(cagir<RafOgesi[]>('raf:sil', o.id)).then((x) => { if (Array.isArray(x)) yaz(x); }).catch(() => undefined); };
  /** Kartı dışarı sürükle: tarayıcının kendi sürüklemesi iptal, işletim sistemi sürüklemesini ana süreç başlatır (dosya yerinde kalır, yol gönderilmez). */
  const surukle = (e: DragEvent, o: RafOgesi) => {
    e.preventDefault();
    if (o.tur === 'dosya' && !o.eksik) void Promise.resolve(cagir('raf:surukle', o.id)).catch(() => undefined);
  };
  const tus = (e: KeyboardEvent, o: RafOgesi) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); sil(o); } };

  return (
    <div className="raf-sayfa" data-raf-uzerinde={ustunde ? '' : undefined} data-raf-bos={bos ? '' : undefined} data-raf-sayi={tum.length}
      onDragEnter={uzerinde} onDragOver={uzerinde} onDragLeave={ayrildi} onDrop={birakildi}>
      <div className="raf-sayfa__alan" data-raf-alan="">
        <span className="raf-sayfa__alan-simge" aria-hidden="true"><Ikon ad="ice" olcu={20} /></span>
        <span className="raf-sayfa__alan-metin" role="status" aria-live="polite" data-raf-metin="">
          {ustunde ? 'Bırak, ekleyeyim' : bildirim || 'Dosyaları buraya bırak'}
        </span>
      </div>
      {!bos && (
        <ul className="raf-sayfa__liste" aria-label="Raftaki öğeler"
          onWheel={(e) => { const el = e.currentTarget; if (el.scrollHeight > el.clientHeight + 1) e.stopPropagation(); /* kayan liste sayfa değiştirmesin */ }}>
          {gosterilen.map((o) => {
            const dosya = dosyaMi(o);
            const ad = dosya ? o.ad : (o.metin.split(/\r?\n/).find((s) => s.trim()) ?? o.metin).trim();
            const alt = dosya ? (o.eksik ? DOSYA_YOK_METNI : boyutYaz(o.boyut) || (o.klasor ? 'Klasör' : '')) : `${o.metin.length} karakter`;
            return (
              <li key={o.id} className="raf-kart" data-raf-ogesi={o.id} data-tur={o.tur} data-eksik={dosya && o.eksik ? '' : undefined}>
                <button type="button" className="raf-kart__ana" draggable={dosya && !o.eksik} aria-disabled={dosya && o.eksik ? true : undefined}
                  title={dosya ? o.yol : o.metin.slice(0, 300)} onClick={() => ac(o)} onDragStart={(e) => surukle(e, o)} onKeyDown={(e) => tus(e, o)}>
                  <span className="raf-kart__simge" aria-hidden="true"><Ikon ad={dosya ? (o.klasor ? 'klasor' : 'dosya') : 'kopyala'} olcu={16} /></span>
                  <span className="raf-kart__metin">
                    <span className="raf-kart__ad" data-raf-ad="">{ad}</span>
                    <span className="raf-kart__alt" data-raf-alt="">{alt}</span>
                  </span>
                </button>
                <button type="button" className="raf-kart__sil" aria-label={`${dosya ? o.ad : 'Metni'} raftan kaldır`} title="Raftan kaldır (dosya silinmez)" onClick={() => sil(o)}>
                  <Ikon ad="kapat" olcu={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
