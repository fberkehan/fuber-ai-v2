// ── Projeler sekmesi (Görev 28, K17): oturum klasörlerinden proje listesi + proje CLAUDE.md'si (görüntüle / düzenle) ──────────────
// CLAUDE.md YALNIZ proje kökündeki dosya ('claudecode:claude-md-oku/yaz'); kaydetmeden önce fark gösterilir; okunduğundan beri dosya
// değiştiyse yazılmaz (özet denetimi) — "Diskteki sürümü yükle" ile yeniden açılır.
import { useEffect, useMemo, useState } from 'react';
import { cagir, zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { FarkGorunumu } from './FarkGorunumu';
import { satirFarki, parcalaraBol, farkSayilari } from './fark';
import { islem } from './depo';
import { kisaYol } from './yardimci';

export interface CcProje { cwd: string; ad: string; sonEtkinlik?: string; oturumSayisi: number; dal?: string; claudeMd: boolean; var: boolean }
interface Md { yol: string; var: boolean; icerik: string; ozet: string }

const SABLON = (ad: string) => `# ${ad}

## Proje
- Ne yapar: …
- Yığın: …

## Kurallar
- Türkçe yaz; kod adları projedeki dile uysun.
- Değişiklikten önce testleri çalıştır: \`npm test\`.
- Gizli anahtarları ASLA dosyaya yazma.

## Komutlar
- Derleme: \`npm run build\`
- Test: \`npm test\`
`;

export function Projeler({ projeler, yenile, yeniOturum, klasorSec }: {
  projeler: CcProje[] | null; yenile: () => void; yeniOturum: (cwd: string) => void; klasorSec: () => void;
}) {
  const [secili, setSecili] = useState<string | null>(null);
  useEffect(() => { if (!secili && projeler?.length) setSecili(projeler.find((p) => p.var)?.cwd ?? projeler[0].cwd); }, [projeler, secili]);
  const p = projeler?.find((x) => x.cwd === secili) ?? null;
  return (
    <div className="cc-projeler">
      <aside className="cc-sol cc-projeler__liste" aria-label="Projeler">
        <div className="cc-sol__ust">
          <button type="button" className="dgm dgm--koyu cc-yeni" onClick={klasorSec}><Ikon ad="klasor" olcu={16} />Klasör seç…</button>
        </div>
        <div className="cc-sol__liste">
          <div className="cc-sol__bolum-bas"><span className="ust-etiket">Projeler</span>{projeler && <span className="cc-sol__sayi">{projeler.length}</span>}</div>
          {projeler === null && <p className="cc-sol__not">Projeler taranıyor…</p>}
          {projeler?.length === 0 && <p className="cc-sol__not">Henüz proje yok. Bir klasör seçip oturum başlattığında burada listelenir.</p>}
          {projeler?.map((x) => (
            <button key={x.cwd} type="button" className="cc-oturum cc-proje" aria-current={x.cwd === secili ? 'true' : undefined} onClick={() => setSecili(x.cwd)} data-proje={x.ad}>
              <span className="cc-oturum__ust">
                <b className="cc-oturum__baslik">{x.ad}</b>
                {x.claudeMd ? <span className="cc-cip" title="Projede CLAUDE.md var">CLAUDE.md</span> : null}
                {!x.var && <span className="cc-cip cc-cip--hata">klasör yok</span>}
              </span>
              <span className="cc-oturum__alt">{x.sonEtkinlik ? zamanGoreli(x.sonEtkinlik) : ''}{x.dal ? ` · ${x.dal}` : ''} · {x.oturumSayisi} oturum</span>
              <span className="cc-proje__yol cc-yol" title={x.cwd}>{kisaYol(x.cwd)}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="cc-orta cc-projeler__ayrinti" aria-label="Proje ayrıntısı">
        {p ? <ProjeAyrintisi key={p.cwd} p={p} yeniOturum={yeniOturum} yenile={yenile} /> : (
          <div className="cc-bos">
            <div className="cc-bos__simge"><Ikon ad="klasor" olcu={26} /></div>
            <h2>Projeler</h2>
            <p>Claude Code oturumlarının klasörleri burada proje olarak toplanır. Her projenin CLAUDE.md talimat dosyasını buradan okuyup düzenleyebilirsin.</p>
            <button type="button" className="dgm dgm--beyaz" onClick={klasorSec}><Ikon ad="klasor" olcu={16} />Klasör seç…</button>
          </div>
        )}
      </section>
    </div>
  );
}

function ProjeAyrintisi({ p, yeniOturum, yenile }: { p: CcProje; yeniOturum: (cwd: string) => void; yenile: () => void }) {
  const [md, setMd] = useState<Md | null>(null);
  const [hata, setHata] = useState('');
  const [metin, setMetin] = useState('');
  const [onizle, setOnizle] = useState(false);
  const [ileti, setIleti] = useState<{ metin: string; hata?: boolean; degisti?: boolean } | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const yukle = async () => {
    setHata(''); setIleti(null); setOnizle(false);
    try { const m = await cagir<Md>('claudecode:claude-md-oku', p.cwd); setMd(m); setMetin(m.icerik); } catch (e) { setHata((e as Error).message); }
  };
  useEffect(() => { if (p.var) void yukle(); }, [p.cwd]); // eslint-disable-line react-hooks/exhaustive-deps
  const degisti = md !== null && metin !== md.icerik;
  const fark = useMemo(() => (onizle && md ? satirFarki(md.icerik, metin) : []), [onizle, md, metin]);
  const sayi = farkSayilari(fark);
  const kaydet = async () => {
    if (!md) return;
    setMesgul(true);
    const r = await islem<{ tamam: boolean; kod?: string; ozet?: string; hata?: string }>('claudecode:claude-md-yaz', p.cwd, metin, md.ozet);
    setMesgul(false);
    if (r.tamam) { setMd({ ...md, var: true, icerik: metin, ozet: r.ozet ?? md.ozet }); setOnizle(false); setIleti({ metin: 'CLAUDE.md kaydedildi. Yeni oturumlar bunu okur.' }); if (!md.var) yenile(); }
    else setIleti({ metin: r.hata ?? 'Kaydedilemedi.', hata: true, degisti: r.kod === 'degisti' });
  };
  return (
    <div className="cc-proje-ayrinti">
      <header className="cc-proje-bas">
        <h2>{p.ad}{p.dal && <span className="cc-cip"><Ikon ad="dal" olcu={12} />{p.dal}</span>}<span className="cc-cip">{p.oturumSayisi} oturum</span></h2>
        <div className="cc-proje-bas__alt">
          <span className="cc-yol" title={p.cwd}>{p.cwd}</span>
          <button type="button" className="dgm dgm--koyu dgm--k" disabled={!p.var} onClick={() => void cagir('claudecode:klasor-ac', p.cwd)}><Ikon ad="klasor" olcu={14} />Klasörü aç</button>
          <button type="button" className="dgm dgm--beyaz dgm--k" disabled={!p.var} onClick={() => yeniOturum(p.cwd)}><Ikon ad="arti" olcu={14} />Bu projede oturum</button>
        </div>
      </header>
      {!p.var ? (
        <div className="cc-bos"><div className="cc-bos__simge" data-ton="hata"><Ikon ad="uyari" olcu={24} /></div><h2>Klasör bulunamadı</h2><p>Bu proje klasörü taşınmış ya da silinmiş. Geçmiş oturumları Oturumlar sekmesinde okunabilir.</p></div>
      ) : hata ? (
        <div className="cc-bos"><div className="cc-bos__simge" data-ton="hata"><Ikon ad="uyari" olcu={24} /></div><h2>CLAUDE.md okunamadı</h2><p>{hata}</p><button type="button" className="dgm dgm--koyu" onClick={() => void yukle()}>Yeniden dene</button></div>
      ) : (
        <div className="cc-md-duzen">
          <div className="cc-md-duzen__bas">
            <span className="ust-etiket">CLAUDE.md</span>
            <span className="cc-md-duzen__yol cc-yol" title={md?.yol}>proje kökünde · {kisaYol(md?.yol ?? `${p.cwd}\\CLAUDE.md`, 2)}</span>
            <span className="cc-bosluk" />
            {degisti && !onizle && <span className="cc-cip">kaydedilmedi</span>}
          </div>
          {md && !md.var && !metin && (
            <div className="cc-md-duzen__yok">
              <Ikon ad="isik" olcu={18} />
              <div><b>Bu projede CLAUDE.md yok.</b><span>CLAUDE.md, Claude Code’un bu projede her oturumda okuduğu talimatlardır: proje özeti, kurallar, komutlar.</span></div>
              <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => setMetin(SABLON(p.ad))}>Şablonla başla</button>
            </div>
          )}
          {onizle ? (
            <div className="cc-md-duzen__fark" aria-label="Kaydedilecek değişiklikler">
              <div className="cc-md-duzen__fark-bas"><b>Kaydetmeden önce değişiklikler</b><span className="cc-arac__sayi"><b data-ton="ekle">+{sayi.eklenen}</b><b data-ton="sil">−{sayi.silinen}</b></span></div>
              <FarkGorunumu parcalar={parcalaraBol(fark, 3)} enCok={400} acikBaslangic etiket="CLAUDE.md farkı" />
            </div>
          ) : (
            <textarea className="cc-md-duzen__alan" value={metin} onChange={(e) => { setMetin(e.target.value); setIleti(null); }} spellCheck={false} aria-label="CLAUDE.md içeriği" placeholder={md ? 'CLAUDE.md boş. Proje talimatlarını buraya yaz.' : 'Yükleniyor…'} disabled={!md} />
          )}
          {ileti && (
            <div className={`cc-ileti${ileti.hata ? ' cc-ileti--hata' : ''}`} role={ileti.hata ? 'alert' : 'status'}>
              {ileti.metin}
              {ileti.degisti && <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void yukle()}>Diskteki sürümü yükle</button>}
            </div>
          )}
          <div className="cc-md-duzen__alt">
            {onizle ? (
              <>
                <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => setOnizle(false)}>Düzenlemeye dön</button>
                <span className="cc-bosluk" />
                <button type="button" className="dgm dgm--beyaz dgm--k" disabled={mesgul} onClick={() => void kaydet()}><Ikon ad="tamam" olcu={14} />{md?.var ? 'Kaydet' : 'Oluştur'}</button>
              </>
            ) : (
              <>
                <button type="button" className="dgm dgm--hayalet dgm--k" disabled={!degisti} onClick={() => md && setMetin(md.icerik)}>Geri al</button>
                <span className="cc-bosluk" />
                <button type="button" className="dgm dgm--beyaz dgm--k" disabled={!degisti} onClick={() => setOnizle(true)}>Farkı gör ve kaydet</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
