// ── Hafıza: Fuber'in bildikleri (şeffaf ve düzenlenebilir) ──────────────────────────────────────────────────
// Üst sekmeler: Hafıza (uzun süreli kayıtlar) | Belgeler (içe aktarılanlar; Görev 20b, K3) | Notlar | Raporlar | Meseleler
// (düşünme motoru / gün kaydı). "Unut" 5 sn "Geri al" penceresinden sonra uygulanır (Görev 20b, K2; geri-al.ts).
import { useEffect, useState } from 'react';
import { cagir, dinle, zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Secici } from '../bilesenler/Secici';
import { Notlar } from '../bilesenler/Notlar';
import { Raporlar } from '../bilesenler/Raporlar';
import { Meseleler } from '../bilesenler/Meseleler';
import { Belgeler } from '../bilesenler/Belgeler';
import { useDusunmeDurumu, UFAK_HAP } from '../bilesenler/DusunmeOrtak';
import { silmeler, useSilmeler } from '../geri-al';
import type { HafizaKaydi, HafizaTuru } from '../../shared/tipler';
import { HAFIZA_TURLERI, hafizaTurAdi, hafizaFormuGecerli } from '../../shared/hafiza-tur';
import { kaynakGorunumu } from '../../shared/hafiza-kaynak';
import { TERIM } from '../../shared/terimler';

const TURLER: [HafizaTuru | '', string][] = [['', 'Tümü'], ...HAFIZA_TURLERI.map((t) => [t.tur, t.cogul] as [HafizaTuru, string])];

type Sekme = 'hafiza' | 'belgeler' | 'notlar' | 'raporlar' | 'meseleler';
const SEKMELER: [Sekme, string, string][] = [
  ['hafiza', 'Hafıza', ''],
  ['belgeler', 'Belgeler', 'Öğrettiğin belgeler · yalnız bu bilgisayarda'],
  ['notlar', 'Notlar', 'Gün boyu duyduklarından tutulan notlar · yalnız bu bilgisayarda'],
  ['raporlar', 'Raporlar', 'Günlük, haftalık ve aylık özetler'],
  ['meseleler', TERIM.takip, 'Konuşmalardan çıkan işler'], // 0.10 Görev 3 (P2): eski adı "Meseleler"
];
/** Kokpit kartları #raporlar / #meseleler ile belli bir sekmeyi açtırır. */
const istenenSekme = (): Sekme | null => { const h = location.hash.slice(1); return SEKMELER.some(([k]) => k === h) ? (h as Sekme) : null; };

export function Hafiza() {
  const [sekme, setSekme] = useState<Sekme>(() => istenenSekme() ?? 'hafiza');
  const [dusunme] = useDusunmeDurumu();
  useEffect(() => {
    const al = () => { const s = istenenSekme(); if (!s) return; setSekme(s); history.replaceState(null, '', location.pathname + location.search); };
    al();
    window.addEventListener('hashchange', al);
    return () => window.removeEventListener('hashchange', al);
  }, []);
  const [liste, setListe] = useState<HafizaKaydi[]>([]);
  const [sorgu, setSorgu] = useState('');
  const [tur, setTur] = useState<HafizaTuru | ''>('');
  const [hamSayi, setSayi] = useState(0);
  const [duzen, setDuzen] = useState<Partial<HafizaKaydi> | null>(null);
  // "Geri al" penceresindeki kayıtlar listede ve sayıda görünmez (silme 5 sn sonra uygulanır).
  const { gizli } = useSilmeler();
  const gorunen = liste.filter((h) => !gizli(`hafiza:${h.id}`));
  const sayi = Math.max(0, hamSayi - (liste.length - gorunen.length));
  // Silme ana süreçte (5 sn sonra ya da çıkışta) uygulanır; liste `hafiza:degisti` olayıyla o anki süzgeçle yenilenir.
  const unut = (h: HafizaKaydi) => silmeler.ertele({ tur: 'hafiza', id: h.id }, `“${h.baslik}” unutuldu`, `“${h.baslik}” unutulamadı`);

  const yenile = async () => {
    setSayi(await cagir<number>('hafiza:sayisi'));
    if (sorgu.trim()) setListe((await cagir<HafizaKaydi[]>('hafiza:ara', sorgu)).filter((h) => !tur || h.tur === tur));
    else setListe(await cagir<HafizaKaydi[]>('hafiza:liste', { tur: tur || undefined, limit: 300 }));
  };
  useEffect(() => { void yenile(); }, [tur]);
  useEffect(() => { const z = setTimeout(() => void yenile(), 250); return () => clearTimeout(z); }, [sorgu]);
  useEffect(() => dinle('hafiza:degisti', () => void yenile()), [sorgu, tur]);

  const kaydet = async () => {
    if (!duzen || !hafizaFormuGecerli(duzen)) return;
    // Yalnız formdaki alanlar gider; tüm kayıt (kaynak dahil) gidince her kayıtta kaynak kendine yeniden ekleniyordu.
    if (duzen.id) await cagir('hafiza:guncelle', duzen.id, { tur: duzen.tur, baslik: duzen.baslik, icerik: duzen.icerik, sabit: Boolean(duzen.sabit) });
    else await cagir('hafiza:kaydet', { tur: duzen.tur ?? 'bilgi', baslik: duzen.baslik, icerik: duzen.icerik, sabit: duzen.sabit ?? false, onem: duzen.onem ?? 3 });
    setDuzen(null);
    void yenile();
  };

  return (
    <div className="pano__icerik" style={{ position: 'relative', inset: 'auto', height: '100%' }}>
      <div className="sayfa">
        {/* 0.10 Görev 1 (D1): başlıktaki beyin kalktı; başlık Bağlantılar'ın sayfa__bas'ıyla aynı hiza ve boyda. */}
        <div className="sayfa__bas">
          <div>
            <div className="t-dev" style={{ fontSize: 40 }}>Hafıza</div>
            <div className="t-giris">{sekme === 'hafiza' ? `${sayi} kayıt · yalnız bu bilgisayarda · Fuber konuşmaları da arayabilir` : SEKMELER.find(([k]) => k === sekme)?.[2]}</div>
          </div>
          {sekme === 'hafiza' && <button className="dgm dgm--beyaz" onClick={() => setDuzen({ tur: 'bilgi', onem: 3 })}><Ikon ad="arti" olcu={15} />Bir şey öğret</button>}
        </div>
        <div className="ust-sekmeler" role="tablist">
          {SEKMELER.map(([k, e]) => (
            <button key={k} role="tab" aria-selected={sekme === k} onClick={() => setSekme(k)}>
              {e}{k === 'meseleler' && dusunme?.acikMesele ? <span className="hap hap--mavi" style={{ height: 18, padding: '0 7px', fontSize: 12, marginLeft: 7 }}>{dusunme.acikMesele}</span> : null}
            </button>
          ))}
        </div>
        {sekme === 'belgeler' && <Belgeler />}
        {sekme === 'notlar' && <Notlar />}
        {sekme === 'raporlar' && <Raporlar />}
        {sekme === 'meseleler' && <Meseleler />}
        {sekme === 'hafiza' && <>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ position: 'relative', flex: '1 1 280px' }}>
            <span style={{ position: 'absolute', left: 13, top: 11, color: 'var(--ink-4)' }}><Ikon ad="ara" olcu={17} /></span>
            <input className="girdi" style={{ paddingLeft: 40 }} placeholder="Ara: kelime, kişi, proje, “geçen hafta”…" value={sorgu} onChange={(e) => setSorgu(e.target.value)} />
          </div>
          <div className="sekmeler">{TURLER.map(([k, e]) => <button key={k} aria-selected={tur === k} onClick={() => setTur(k)}>{e}</button>)}</div>
        </div>

        {duzen && (
          <div className="kart kutu" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
            <div className="ikili">
              <label className="alan"><span>Başlık</span><input className="girdi" value={duzen.baslik ?? ''} onChange={(e) => setDuzen({ ...duzen, baslik: e.target.value })} /></label>
              <div className="alan"><span>Tür</span><Secici etiket="Tür" genislik="100%" deger={duzen.tur ?? 'bilgi'} secenekler={HAFIZA_TURLERI.map((t) => ({ deger: t.tur, etiket: t.tekil }))} degistir={(v) => setDuzen({ ...duzen, tur: v })} /></div>
            </div>
            <label className="alan"><span>Bilgi</span><textarea className="metin-alan" value={duzen.icerik ?? ''} onChange={(e) => setDuzen({ ...duzen, icerik: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={Boolean(duzen.sabit)} onChange={(e) => setDuzen({ ...duzen, sabit: e.target.checked })} />Her zaman hatırla (çekirdek)</label>
              <span style={{ flex: 1 }} />
              <button className="dgm dgm--hayalet" onClick={() => setDuzen(null)}>Vazgeç</button>
              <button className="dgm dgm--beyaz" disabled={!hafizaFormuGecerli(duzen)} title={hafizaFormuGecerli(duzen) ? undefined : 'Başlık ve bilgi gerekli'} onClick={() => void kaydet()}>Kaydet</button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gap: 10 }}>
          {gorunen.map((h) => (
            // 11 Kas (tasarımcı bulgular 7 ve 15): iç kimlik hapı ("H-8") ve ham kaynak ("sohbet:1") yok; kaynak insan diliyle ("Sohbetten").
            // "çekirdek" çipi yerine küçük raptiye; sabitle / düzenle / unut üstüne gelince (ya da klavye odağında) görünür.
            <div key={h.id} className={`kart hafiza-kayit ${h.sabit ? 'kart--vurgu' : ''}`} data-hafiza-kayit={h.id} style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                  <span className="hap" style={UFAK_HAP}>{hafizaTurAdi(h.tur)}</span>
                  {h.sabit && <span className="hafiza-kayit__igne" role="img" aria-label="Her zaman hatırlanır" title="Her zaman hatırlanır"><Ikon ad="igne" olcu={13} /></span>}
                  <b style={{ fontSize: 14.5 }}>{h.baslik}</b>
                </div>
                <div className="soluk" style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', userSelect: 'text' }}>{h.icerik}</div>
                <div className="t-kucuk" style={{ marginTop: 6 }}>{[zamanGoreli(h.guncelleme), kaynakGorunumu(h.kaynak), h.etiketler.join(', ')].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="hafiza-kayit__eylem" style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                <button className="dgm dgm--hayalet dgm--k dgm--simge" aria-label={h.sabit ? 'Sabitlemeyi kaldır' : 'Her zaman hatırla'} title={h.sabit ? 'Sabitlemeyi kaldır' : 'Her zaman hatırla'} onClick={() => void cagir('hafiza:guncelle', h.id, { sabit: !h.sabit }).then(yenile)}><Ikon ad="igne" olcu={14} /></button>
                <button className="dgm dgm--hayalet dgm--k dgm--simge" aria-label="Düzenle" title="Düzenle" onClick={() => setDuzen(h)}><Ikon ad="kalem" olcu={14} /></button>
                <button className="dgm dgm--hayalet dgm--k dgm--simge" aria-label="Unut" title="Unut" onClick={() => unut(h)}><Ikon ad="cop" olcu={14} /></button>
              </div>
            </div>
          ))}
          {!gorunen.length && <div className="kart kutu cok-soluk">{sorgu ? 'Eşleşen kayıt yok.' : 'Henüz kayıt yok. Konuştukça öğrenirim; ya da “Bir şey öğret” ile ekle, İçe Aktar klasörüne dosya bırak.'}</div>}
        </div>
        </>}
      </div>
    </div>
  );
}
