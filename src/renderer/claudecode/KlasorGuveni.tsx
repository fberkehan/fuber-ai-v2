// ── Klasör güven kartı (son dalga B, I1) ─────────────────────────────────────────────────────────────────────────────────────
// Başsız Claude Code, terminaldeki "Bu klasöre güveniyor musun?" sorusunu sormaz; klasörün kendi .claude/settings*.json kancaları, izin
// kuralları ve .mcp.json sunucuları ilk oturumda yüklenirdi. Fuber kendi kartını gösterir: klasörde ne var (dosya + kısa özet), güvenirsen
// ne olur, güvenmezsen ne olur. Karar klasör başına Fuber'de saklanır (main/claudecode/klasor-guveni.ts; kanal telefondan KAPALI);
// Ayarlar sekmesindeki "Klasör güveni" listesinden silinir (sonraki oturumda yeniden sorulur).
//  • "Güveniyorum" kendiliğinden odak ALMAZ (kaçan Enter karar vermez); kart açılınca odak kartın kendisinde.
//  • Kart oturum görünümünün yerinde (çalışma alanının ortası); yazma kutusu karar verilene dek yok.
import { useEffect, useRef, useState } from 'react';
import { Ikon } from '../bilesenler/Ikon';
import { islem } from './depo';
import './klasor-guveni.css';

export type GuvenKarari = 'guven' | 'guvenme';
export interface KlasorGuvenBilgisi {
  cwd: string; gerekli: boolean; mcp: boolean; karar?: GuvenKarari;
  /** N3: gösterilen dosya kümesinin parmak izi (karar bununla saklanır); `degisti`: önceki karardan sonra ayarlar değişti. */
  parmakIzi?: string; degisti?: boolean;
  /** Düzeltme turu 2: ayar dosyaları çok büyük/çok sayıda → iz çıkarılamadı; "Güveniyorum" sunulmaz. */
  sinirsiz?: boolean;
  dosyalar: { ad: string; tur: 'proje' | 'yerel' | 'mcp' | 'ozellestirme'; ozet: string }[];
}
export const GUVEN_SORUSU = 'Bu klasörün kendi Claude Code ayarları var (kancalar, izin kuralları, MCP sunucuları). Güveniyor musun?';
const TUR_ADI: Record<KlasorGuvenBilgisi['dosyalar'][number]['tur'], string> = { proje: 'Proje ayarı', yerel: 'Yerel ayar', mcp: 'MCP', ozellestirme: 'Özelleştirme' };

/** Durum (cwd) ya da karar kaydı (cwd + karar). */
export async function klasorGuveniAl(cwd: string): Promise<KlasorGuvenBilgisi | null> {
  const r = await islem<{ tamam: boolean; hata?: string; durum?: KlasorGuvenBilgisi }>('claudecode:klasor-guveni', { cwd }).catch(() => null);
  return r?.tamam && r.durum ? r.durum : null;
}

export function KlasorGuveniKarti({ guven, kararVerildi, vazgec }: {
  guven: KlasorGuvenBilgisi; kararVerildi: (k: GuvenKarari) => void; vazgec: () => void;
}) {
  const [mesgul, setMesgul] = useState<GuvenKarari | null>(null);
  const [hata, setHata] = useState('');
  const kart = useRef<HTMLElement>(null);
  useEffect(() => { kart.current?.focus({ preventScroll: true }); }, [guven.cwd]);
  const proje = guven.cwd.split(/[\\/]/).filter(Boolean).pop() ?? guven.cwd;
  const kaydet = async (karar: GuvenKarari) => {
    setMesgul(karar); setHata('');
    const r = await islem<{ tamam: boolean; hata?: string }>('claudecode:klasor-guveni', { cwd: guven.cwd, karar, ...(typeof guven.parmakIzi === 'string' ? { parmakIzi: guven.parmakIzi } : {}) }).catch((e) => ({ tamam: false, hata: (e as Error).message }));
    setMesgul(null);
    if (!r.tamam) { setHata(r.hata ?? 'Karar kaydedilemedi.'); return; }
    kararVerildi(karar);
  };
  return (
    <div className="cc-oturum-gorunum">
      <header className="cc-oturum-bas">
        <div className="cc-oturum-bas__metin">
          <h2>Klasör güveni</h2>
          <span className="cc-oturum-bas__alt">
            <span className="cc-oturum-bas__proje"><Ikon ad="klasor" olcu={12} />{proje}</span>
            <span className="cc-guven__yol" title={guven.cwd}>{guven.cwd}</span>
          </span>
        </div>
      </header>
      <div className="cc-guven-govde">
        <section ref={kart} className="cc-izin cc-guven onay" aria-labelledby="cc-guven-soru" data-klasor-guveni="" tabIndex={-1}>
          <div className="cc-izin__ust">
            <div className="onay__baslik"><Ikon ad="kalkan" olcu={16} /><span id="cc-guven-soru">{GUVEN_SORUSU}</span></div>
          </div>
          {/* Soru ve kararlar hep görünür; ayrıntılar alçak pencerede (1080×680) kartın içinde kayar. */}
          {guven.degisti && !guven.sinirsiz && <p className="cc-guven__degisti" data-guven-degisti="">Bu klasörün Claude Code ayarları son kararından sonra değişti; yeniden bak.</p>}
          {guven.sinirsiz && <p className="cc-guven__degisti" data-guven-sinirsiz="">Bu klasörün Claude Code ayar dosyaları çok büyük ya da çok sayıda: Fuber değişiklikleri izleyemez, bu yüzden güvenilemez. Ayarları yüklenmeden çalışabilirsin.</p>}
          <div className="cc-guven__icerik">
            <ul className="cc-guven__liste" aria-label="Bu klasörde bulunanlar">
              {guven.dosyalar.map((d) => (
                <li key={`${d.tur}:${d.ad}`} className="cc-guven__oge">
                  <span className="cc-guven__tur">{TUR_ADI[d.tur]}</span>
                  <code className="cc-guven__ad">{d.ad}</code>
                  <span className="cc-guven__ozet">{d.ozet}</span>
                </li>
              ))}
            </ul>
            <div className="cc-guven__ikili">
              <div className="cc-guven__secenek">
                <b>Güvenirsen</b>
                <span>Kancalar oturum açılırken bilgisayarında komut çalıştırabilir, izin kuralları bazı komutları sormadan çalıştırır, MCP sunucuları başlar.</span>
              </div>
              <div className="cc-guven__secenek">
                <b>Güvenmezsen</b>
                <span>Klasörün ayarları, kancaları, MCP sunucuları ve CLAUDE.md’si yüklenmez; kendi Claude Code ayarların geçerli kalır{guven.mcp ? ' (.mcp.json olduğu için kendi MCP sunucuların da bu klasörde kapalı)' : ''}.</span>
              </div>
            </div>
            <p className="cc-guven__not">Kararın bu klasör için saklanır (Ayarlar’dan silinir). Telefondan ya da sohbetten açılan oturumlar karar veremez: karar yoksa ayarlar yüklenmez.</p>
          </div>
          {hata && <div className="cc-izin__hata" role="alert">{hata}</div>}
          <div className="onay__dugmeler cc-izin__dugmeler">
            <button type="button" className="dgm dgm--hayalet dgm--k" disabled={mesgul !== null} onClick={vazgec}>Vazgeç</button>
            <span className="cc-bosluk" />
            <button type="button" className="dgm dgm--koyu dgm--k" data-guven="guvenme" disabled={mesgul !== null} onClick={() => void kaydet('guvenme')}>
              <Ikon ad="kapat" olcu={14} />{mesgul === 'guvenme' ? 'Kaydediliyor…' : 'Güvenme, yükleme'}
            </button>
            {!guven.sinirsiz && (
              <button type="button" className="dgm dgm--beyaz dgm--k" data-guven="guven" disabled={mesgul !== null} onClick={() => void kaydet('guven')}>
                <Ikon ad="tamam" olcu={14} />{mesgul === 'guven' ? 'Kaydediliyor…' : 'Güveniyorum'}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Ayarlar sekmesi: kayıtlı kararlar (en yeni önce) ve "Kararı sil". */
export function KlasorGuveniListesi() {
  const [liste, setListe] = useState<{ yol: string; karar: GuvenKarari; zaman: number }[] | null>(null);
  const [hata, setHata] = useState('');
  const yukle = () => { void islem<{ tamam: boolean; liste?: { yol: string; karar: GuvenKarari; zaman: number }[] }>('claudecode:klasor-guveni', {}).then((r) => setListe(r.liste ?? [])).catch(() => setListe([])); };
  useEffect(yukle, []);
  const sil = async (yol: string) => {
    setHata('');
    type Yanit = { tamam: boolean; hata?: string; liste?: { yol: string; karar: GuvenKarari; zaman: number }[] };
    const r: Yanit = await islem<Yanit>('claudecode:klasor-guveni', { cwd: yol, karar: null }).catch((e) => ({ tamam: false, hata: (e as Error).message }));
    if (!r.tamam) { setHata(r.hata ?? 'Silinemedi.'); return; }
    setListe(r.liste ?? []);
  };
  return (
    <section className="kart cc-ayarlar__kart" data-klasor-guveni-listesi="">
      <div className="cc-ayarlar__bas"><span className="ust-etiket">Klasör güveni</span></div>
      <p className="cc-ayarlar__not">Kendi Claude Code ayarları (kancalar, izin kuralları, MCP sunucuları) olan bir klasörde ilk oturumdan önce Fuber sorar. Güvenmediğin klasörde bu ayarlar yüklenmez.</p>
      {liste === null ? <p className="cc-ayarlar__not">Okunuyor…</p> : liste.length === 0 ? (
        <p className="cc-ayarlar__not" data-bos="">Henüz karar verdiğin klasör yok.</p>
      ) : (
        <ul className="cc-guven-kararlar">
          {liste.slice(0, 50).map((k) => (
            <li key={k.yol}>
              <span className="cc-hal" data-ton={k.karar === 'guven' ? 'bitti' : 'notr'}><i aria-hidden="true" />{k.karar === 'guven' ? 'Güvenildi' : 'Güvenilmedi'}</span>
              <span className="cc-guven-kararlar__klasor" title={k.yol}>
                <b>{k.yol.split(/[\\/]/).filter(Boolean).pop() ?? k.yol}</b>
                <span className="cc-guven-kararlar__yol">{k.yol}</span>
              </span>
              <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void sil(k.yol)} aria-label={`Kararı sil: ${k.yol}`}>Kararı sil</button>
            </li>
          ))}
        </ul>
      )}
      {hata && <div className="cc-ileti cc-ileti--hata">{hata}</div>}
    </section>
  );
}
