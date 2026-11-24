// Ayarlar → Genel: kimlik (ad + hitap, canlı önizleme), kullanım biçimi (Business mode / Developer mode, K2), Windows açılışı ve Hakkında (sürüm,
// atıflar; Görev 25).
// `ModKartlari` kurulum sihirbazının "Nasıl kullanacaksın?" adımında da kullanılır (Görev 15).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../bilesenler/Ortak';
import { hitapMetni } from '../../shared/hitap';
import { KIP_ADI } from '../../shared/karakterler';
import { DEVELOPER_KAPSAMI } from '../../shared/kurulum-taslak';
import { motorBagliMi } from '../../shared/abonelik';
import { surumEtiketi } from '../../shared/surum';
import type { Ayarlar, Mod } from '../../shared/tipler';
import { useAyarlar, type IcerikHaritasi } from './baglam';
import { AyarBolgesi, Satir } from './Ortak';
import { UCUNCU_TARAF, VERI_KAYNAKLARI, type UcuncuTaraf } from '../../shared/ucuncu-taraf';
import { AraclarTeklifi } from '../claudecode/AraclarTeklifi';
import './hakkinda.css';

function KimlikGrubu() {
  const { a, kaydet } = useAyarlar();
  // Kayıtlı ad/hitap başka yerden değişince (yeniden açılan kurulum sihirbazı) taslak kayıtlı değerle yeniden başlar.
  return <KimlikFormu key={`${a.kullaniciAdi}|${a.hitap}`} a={a} kaydet={kaydet} />;
}

/** Ad + hitap: yerel durum, canlı önizleme ("Fuber sana … diye seslenecek") ve açık Kaydet düğmesi. */
function KimlikFormu({ a, kaydet }: { a: Ayarlar; kaydet: (d: Partial<Ayarlar>) => void }) {
  const [ad, setAd] = useState(a.kullaniciAdi);
  const [hitap, setHitap] = useState(a.hitap);
  const degisti = ad.trim() !== a.kullaniciAdi || hitap.trim() !== a.hitap;
  return (
    <div className="kimlik">
      <div className="ikili">
        <label className="alan" data-ayar="ad"><span>Adın</span><input className="girdi" value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Deniz" /></label>
        <label className="alan" data-ayar="hitap"><span>Hitap (ör. Bey, Hanım ya da tam ifade: Hocam)</span><input className="girdi" value={hitap} onChange={(e) => setHitap(e.target.value)} placeholder="Bey" /></label>
      </div>
      <div className="kimlik__alt">
        <span className="hap">Fuber sana <b className="kimlik__hitap">“{hitapMetni(ad, hitap) || '…'}”</b> diye seslenecek</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="dgm dgm--beyaz dgm--k" disabled={!degisti || !ad.trim()} onClick={() => kaydet({ kullaniciAdi: ad.trim(), hitap: hitap.trim() })}>Kaydet</button>
      </div>
      {/* 11 Kas (tasarımcı bulgu 10): "kişiliği sabittir" cümlesi kip açıklamalarıyla çelişiyordu; tek sade cümle. */}
      <p className="t-kucuk kimlik__not">Fuber’in nasıl konuşmasını istediğini ona söylemen yeter; tercihini hafızasına yazar.</p>
    </div>
  );
}

const MODLAR: { mod: Mod; ad: string; simge: string; metin: string; maddeler: string[] }[] = [
  // 0.10 Görev 2 (C-2, D2): "Satış sürümünde abonelikle hazır motor" kalktı — yapay zekâ Fuber hesabıyla gelir.
  { mod: 'is', ad: KIP_ADI.is, simge: 'canta', metin: 'Sade ve hazır. Teknik ayrıntılar gizli; Fuber işini kendisi ayarlar.', maddeler: ['Ada, kokpit ve öneriler', 'Kendi yapay zekân (Claude, OpenAI uyumlu ya da yerel)', 'Teknik ayar yok'] },
  // 0.13 son düzeltme 3: kullanıcı anahtarı yolu kalktı; kapsam kurulumdaki kartla aynı kaynaktan.
  { mod: 'gelistirici', ad: KIP_ADI.gelistirici, simge: 'kod', metin: 'Her şey açık: Claude Code, MCP ve yerel model ayrıntıları da görünür.', maddeler: DEVELOPER_KAPSAMI.map(([, m]) => m) },
];

/** İki kartlı seçim (radyo grubu): ←/→ ile de değişir (odak yeni seçilen karta geçer). */
export function ModKartlari({ mod, degistir }: { mod: Mod; degistir: (m: Mod) => void }) {
  const kartlar = useRef<Partial<Record<Mod, HTMLButtonElement | null>>>({});
  const tus = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const yeni: Mod = mod === 'is' ? 'gelistirici' : 'is';
    degistir(yeni);
    kartlar.current[yeni]?.focus();
  };
  return (
    <div className="mod-kartlari" role="radiogroup" aria-label="Kullanım biçimi" onKeyDown={tus}>
      {MODLAR.map((m) => {
        const secili = m.mod === mod;
        return (
          <button key={m.mod} ref={(el) => { kartlar.current[m.mod] = el; }} type="button" role="radio" aria-checked={secili} tabIndex={secili ? 0 : -1} className="mod-karti" data-mod={m.mod} onClick={() => { if (!secili) degistir(m.mod); }}>
            <span className="mod-karti__ust">
              <span className="mod-karti__simge"><Ikon ad={m.simge} olcu={18} /></span>
              <span className="mod-karti__ad">{m.ad}</span>
              <span className="mod-karti__isaret" aria-hidden="true">{secili && <Ikon ad="tamam" olcu={14} kalinlik={2} />}</span>
            </span>
            <span className="mod-karti__metin">{m.metin}</span>
            <span className="mod-karti__maddeler">{m.maddeler.map((x) => <span key={x}><Ikon ad="tamam" olcu={13} />{x}</span>)}</span>
          </button>
        );
      })}
    </div>
  );
}

function ModGrubu() {
  const { a, kaydet, git } = useAyarlar();
  // 0.10 Görev 2 (D-2): İş → Geliştirici geçişinde bulut motoru yoksa Ayarlar doğrudan Hesap ve kullanım'ı açar (0.13 T15: Motorlar kalktı; üstte
  // Fuber hesabıyla giriş); araçlar teklifi motor bağlanınca gelir (main.tsx). Kategori yeni modla görünür olunca gidilir.
  const motoraGit = useRef(false);
  useEffect(() => {
    if (!motoraGit.current || a.mod !== 'gelistirici') return;
    motoraGit.current = false;
    git('motor');
  }, [a.mod]);
  const degistir = (m: Mod) => {
    if (a.mod === 'is' && m === 'gelistirici' && !motorBagliMi(a.saglayicilar, a.hesap)) motoraGit.current = true;
    kaydet({ mod: m });
  };
  return (
    <AyarBolgesi id="mod" className="mod-bolgesi">
      <ModKartlari mod={a.mod} degistir={degistir} />
      {/* I8: İş → Geliştirici geçince "Geliştirici araçları" teklifi BURADA, anahtarın altında (pencerenin üstünde sabit kart değil). */}
      {a.mod === 'gelistirici' && <AraclarTeklifi />}
      <p className="t-kucuk">İstediğin zaman değiştirebilirsin; ayarların, hafızan ve sohbetlerin olduğu gibi kalır.</p>
    </AyarBolgesi>
  );
}

function BaslangicGrubu() {
  const { a, kaydet } = useAyarlar();
  return <Satir id="baslangic"><Anahtar acik={a.baslangictaAc} etiket="Windows açılışında başlat" degistir={(v) => kaydet({ baslangictaAc: v })} /></Satir>;
}

/** Hakkında: sürüm ve pakete giren bileşenlerin atıfları (Ruling BC; 0.10 Görev 1, D-26). Lisans metinleri kaynak dosyalarından birebir
 *  (shared/ucuncu-taraf.ts; pakette resources/lisanslar/UCUNCU-TARAF.txt). Sonda kokpit kartlarının veri kaynakları (0.10 Görev 3, A-58:
 *  Ayarlar → Pano'dan buraya taşındı). */
function HakkindaGrubu() {
  const [surum, setSurum] = useState('');
  // 0.12 H6 (P12): kurulu uygulama bu bilgisayarın ortamındaki test ayarlarından bazılarını yok saydıysa yalnız ADLARI (yoksa satır çizilmez).
  const [yokSayilan, setYokSayilan] = useState<string[]>([]);
  // İsteğe bağlı modüllerle (WhatsApp) pakete girenlerin bildirimleri ana süreçten gelir (modülsüz derlemede yok).
  const [ozel, setOzel] = useState<UcuncuTaraf[]>([]);
  useEffect(() => { void cagir<{ surum: string; ortamUyarilari?: string[]; ozelLisanslar?: UcuncuTaraf[] }>('durum:al').then((d) => { setSurum(d.surum); setYokSayilan(d.ortamUyarilari ?? []); setOzel(d.ozelLisanslar ?? []); }, () => undefined); }, []);
  return (
    <Satir id="atiflar" dikey>
      <dl className="hakkinda">
        <div><dt>Fuber AI</dt><dd>{surum ? `Sürüm ${surumEtiketi(surum)} · ` : ''}© 2026 Fuber AI</dd></div>
        {yokSayilan.length > 0 && (
          <div data-ortam-yok-sayilan=""><dt>Güvenlik</dt><dd>Bu bilgisayarın ortam ayarlarından bazıları yok sayıldı: {yokSayilan.join(', ')}.</dd></div>
        )}
        {[...UCUNCU_TARAF, ...ozel].map((x) => (
          <div key={x.ad}>
            <dt>{x.ne}</dt>
            <dd>
              {x.atif}
              <details className="hakkinda__lisans">
                <summary>Lisans metni{x.kaynakca?.length ? ' ve kaynakça' : ''}</summary>
                <pre>{x.metin}</pre>
                {x.kaynakca?.map((k) => <p key={k}>{k}</p>)}
              </details>
            </dd>
          </div>
        ))}
        {/* Lisans bağlantısı yeni pencere değil: ana süreç http(s) adresini sistem tarayıcısında açar (pencere-ortak.ts). */}
        {VERI_KAYNAKLARI.map((v) => (
          <div key={v.ne} data-veri-kaynagi="">
            <dt>{v.ne}</dt>
            <dd>{v.atif}{v.lisans && <> — <a className="hakkinda__baglanti" href={v.lisans.adres} target="_blank" rel="noreferrer">{v.lisans.ad}</a></>}</dd>
          </div>
        ))}
      </dl>
    </Satir>
  );
}

export const GENEL: IcerikHaritasi = { kimlik: KimlikGrubu, mod: ModGrubu, baslangic: BaslangicGrubu, hakkinda: HakkindaGrubu };
