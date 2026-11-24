// Ayarlar → Gün kaydı (0.10 Görev 3: eski adı "Düşünme motoru"): sürekli dinleme + rıza, durum ve duraklatma, çalışma saatleri, yazıya döken
// (Whisper/Vosk; yalnız Geliştirici), araya girme, rapor saati, saklama süreleri, ajan
// durumları ve kayıt silme. Açma/kapama ve seçimler anında kaydedilir; saat ve sayı girdileri odaktan çıkınca (ya da Enter'da).
import { useState } from 'react';
import { cagir, zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../bilesenler/Ortak';
import { Secici } from '../bilesenler/Secici';
import { useDusunmeDurumu, hataMetni, saatMetni, bugunMetni, AjanNoktasi, OdakGirdi, sinirla } from '../bilesenler/DusunmeOrtak';
import type { AjanDurumu, GunKaydiAyari, YaziciMotor, WhisperModeli, EslikciKipi } from '../../shared/tipler';
import { isDiliIhlali } from '../../shared/is-dili';
import { useAyarlar, type IcerikHaritasi } from './baglam';
import { AyarBolgesi, Satir, useAyarTanimi } from './Ortak';
import { TERIM, buyukBasla } from '../../shared/terimler';

const GUNLER: [number, string][] = [[1, 'Pzt'], [2, 'Sal'], [3, 'Çar'], [4, 'Per'], [5, 'Cum'], [6, 'Cmt'], [0, 'Paz']];
const MOTORLAR: [YaziciMotor, string, string?][] = [['otomatik', 'Otomatik'], ['whisper', 'Whisper', 'yerel, ücretsiz'], ['vosk', 'Vosk', 'dahili, hızlı']];
const WHISPER_MODELLERI: { deger: WhisperModeli; etiket: string; aciklama: string; rozet?: string }[] = [
  { deger: 'large-v3-turbo-q5_0', etiket: 'large-v3-turbo', aciklama: 'Türkçe + İngilizce · 574 MB', rozet: 'önerilen' },
  { deger: 'large-v3-q5_0', etiket: 'large-v3', aciklama: 'En isabetli · ~1,1 GB' },
  { deger: 'small-q5_1', etiket: 'small', aciklama: 'Hafif · ~190 MB' },
];
const WHISPER_GPU: { deger: GunKaydiAyari['whisperGpu']; etiket: string }[] = [{ deger: 'otomatik', etiket: 'Otomatik' }, { deger: 'cpu', etiket: 'Yalnız işlemci' }, { deger: 'cuda', etiket: 'NVIDIA (CUDA)' }];
const ESLIKCI: [EslikciKipi, string][] = [['kapali', 'Kapalı'], ['hatirlatma', 'Yalnız hatırlatma'], ['hatirlatma_espri', 'Hatırlatma + espri']];
const SAKLAMA: [keyof GunKaydiAyari['saklama'], string][] = [
  ['ham', buyukBasla(TERIM.dokum)], ['onemsiz', 'Önemsiz notlar'], ['onemli', 'Önemli notlar'], ['haftalikOnemsiz', 'Haftalık rapor: önemsizler'], ['haftalikOnemli', 'Haftalık rapor: önemliler'],
];
const SILME: { kapsam: 'bugun-dokum' | 'tum-dokum' | 'hepsi'; etiket: string; uyari: string }[] = [
  // 0.10 Görev 3 (P2): "döküm" → "yazıya dökülen konuşma", "meseleler" → "takip edilecekler" (iki modda).
  { kapsam: 'bugun-dokum', etiket: 'Bugünün konuşmaları', uyari: 'Bugün yazıya dökülen konuşmalar silinecek.' },
  { kapsam: 'tum-dokum', etiket: 'Bütün konuşmalar', uyari: 'Yazıya dökülen bütün konuşmalar silinecek; notlar ve raporlar kalır.' },
  { kapsam: 'hepsi', etiket: 'Her şey', uyari: 'Yazıya dökülen konuşmalar, notlar, raporlar ve takip edilecekler silinecek.' },
];

/** Gün kaydı ayarı + kısmi kayıt. */
function useGunKaydi() {
  const { a, kaydet } = useAyarlar();
  const g = a.gunKaydi;
  return { g, gk: (y: Partial<GunKaydiAyari>) => kaydet({ gunKaydi: { ...g, ...y } }) };
}

function DinlemeGrubu() {
  const { yenile, mod } = useAyarlar();
  const { g, gk } = useGunKaydi();
  const [d, setD] = useDusunmeDurumu();
  const [riza, setRiza] = useState(false);
  const [hata, setHata] = useState('');
  if (!g) return null;
  const duraklatildi = Boolean(g.duraklatBitis && Date.parse(g.duraklatBitis) > Date.now());
  const duraklat = (dk: number) => {
    setHata('');
    void cagir<typeof d>('gunkaydi:duraklat', dk).then((y) => { setD(y); yenile(); }).catch((e) => setHata(hataMetni(e)));
  };
  const gunSonunaDk = () => { const s = new Date(); s.setHours(23, 59, 0, 0); return Math.max(1, Math.ceil((s.getTime() - Date.now()) / 60_000)); };

  return (
    <>
      <Satir id="surekli-dinleme">
        <Anahtar acik={g.etkin} etiket="Sürekli dinleme" degistir={(v) => { if (v) setRiza((r) => !r); else { setRiza(false); gk({ etkin: false }); } }} />
      </Satir>
      {riza && !g.etkin && (
        <div className="onay" style={{ margin: '4px 0 14px' }}>
          <div className="onay__baslik"><Ikon ad="kalkan" olcu={16} />Açmadan önce</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13.5, color: 'var(--ink-2)' }}>
            <li>Fuber, çalışma saatlerinde mikrofonu sürekli dinler.</li>
            <li>Ses bu bilgisayarda yazıya dökülür; yalnız metin notlar burada tutulur.</li>
            <li>Yanındaki kişilerin sesi de yazıya geçebilir.</li>
          </ul>
          <div className="t-kucuk" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Türkiye’de alenî olmayan bir konuşmayı diğer tarafların rızası olmadan kaydetmek suç olabilir (TCK 133); yazıya dökülen konuşmalar da KVKK kapsamında kişisel veridir. Çevrendekileri bilgilendir, özel konuşmalarda duraklat. Bu bir hukuki tavsiye değildir.</div>
          <div className="onay__dugmeler">
            <button type="button" className="dgm dgm--beyaz dgm--k" onClick={() => { gk({ etkin: true, rizaTarihi: new Date().toISOString() }); setRiza(false); }}>Anladım, aç</button>
            <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => setRiza(false)}>Vazgeç</button>
          </div>
        </div>
      )}
      <Satir id="dinleme-durumu" ust aciklama={
        <span className="dinleme-durumu">
          <span className="dinleme-durumu__haplar">
            <span className="hap"><span className={`nokta ${d?.dinliyor ? 'nokta--yesil' : ''}`} />{d ? (d.dinliyor ? 'Dinliyor' : d.neden || 'Dinlemiyor') : 'Durum alınamadı'}</span>
            {/* Yazıcının adı (Whisper/Vosk) teknik ayrıntı: yalnız Geliştirici modunda (K2). */}
            {mod === 'gelistirici' && d?.yazici.aciklama && <span className="hap">{d.yazici.aciklama}</span>}
            {/* Durum yoksa duraklatmayı ayardan göster (varsa `neden` zaten söylüyor). */}
            {!d && duraklatildi && <span className="hap">Duraklatıldı · bitiş {saatMetni(g.duraklatBitis!)}</span>}
          </span>
          {d && <span>{bugunMetni(d)}</span>}
          {hata && <span className="ayarlar__hata">{hata}</span>}
        </span>
      }>
        <span className="dugme-sirasi">
          {/* 11 Kas (tasarımcı bulgu 19): dinleme kapalıyken duraklatma düğmeleri gösterilmez (devre dışı düğme gürültüsü). */}
          {duraklatildi
            ? <button type="button" className="dgm dgm--beyaz dgm--k" onClick={() => duraklat(0)}><Ikon ad="oynat" olcu={13} />Sürdür</button>
            : g.etkin && <>
              <button type="button" className="dgm dgm--koyu dgm--k" disabled={!g.etkin} onClick={() => duraklat(60)}>1 saat duraklat</button>
              <button type="button" className="dgm dgm--koyu dgm--k" disabled={!g.etkin} onClick={() => duraklat(gunSonunaDk())}>Bugünlük duraklat</button>
            </>}
        </span>
      </Satir>
      <Satir id="calisma-saatleri" ust>
        <div className="calisma-saatleri">
          <span className="saat-araligi">
            <OdakGirdi tur="time" genislik={120} aria-label="Başlangıç" deger={g.calisma.bas} duzelt={(v) => v || g.calisma.bas} kaydet={(v) => gk({ calisma: { ...g.calisma, bas: v } })} />
            <span aria-hidden="true">–</span>
            <OdakGirdi tur="time" genislik={120} aria-label="Bitiş" deger={g.calisma.bit} duzelt={(v) => v || g.calisma.bit} kaydet={(v) => gk({ calisma: { ...g.calisma, bit: v } })} />
          </span>
          <span className="gun-cipleri">
            {GUNLER.map(([n, ad]) => {
              const secili = g.calisma.gunler.includes(n);
              return <button key={n} type="button" className="gun-cip" aria-pressed={secili} onClick={() => gk({ calisma: { ...g.calisma, gunler: secili ? g.calisma.gunler.filter((x) => x !== n) : [...g.calisma.gunler, n].sort() } })}>{ad}</button>;
            })}
          </span>
        </div>
      </Satir>
      <Satir id="kilitte-duraklat"><Anahtar acik={g.kilitteDuraklat} etiket="Ekran kilitliyken duraklat" degistir={(v) => gk({ kilitteDuraklat: v })} /></Satir>
    </>
  );
}

function YaziciGrubu() {
  const { g, gk } = useGunKaydi();
  const [d, setD] = useDusunmeDurumu();
  const [hata, setHata] = useState('');
  const [kaldiriliyor, setKaldiriliyor] = useState(false);
  const t = useAyarTanimi('yazici');
  const tw = useAyarTanimi('whisper');
  if (!g || !t || !tw) return null;
  const w = d?.whisper;
  const ind = w?.indirme;
  const iniyor = Boolean(ind && !ind.hata && ind.yuzde < 100);
  const indir = () => { setHata(''); void cagir('gunkaydi:whisper-indir').catch((e) => setHata(hataMetni(e))); };
  const kaldir = () => {
    setHata(''); setKaldiriliyor(true);
    void cagir<typeof d>('gunkaydi:whisper-kaldir').then(setD).catch((e) => setHata(hataMetni(e))).finally(() => setKaldiriliyor(false));
  };

  return (
    <div className="yazici-ayar">
      <AyarBolgesi id="yazici" className="yazici-ayar__ust">
        <div className="ayar__metin"><b>{t.ad}</b><span>{t.aciklama}</span></div>
        <div className="sekmeler" role="radiogroup" aria-label={t.ad} style={{ flexWrap: 'wrap', borderRadius: 20 }}>
          {MOTORLAR.map(([m, ad, alt]) => (
            <button key={m} type="button" role="radio" aria-checked={g.motor === m} onClick={() => gk({ motor: m })}>{ad}{alt && <span className="sekme-alt">({alt})</span>}</button>
          ))}
        </div>
      </AyarBolgesi>
      <AyarBolgesi id="whisper" className="ic-kutu yazici-ayar__whisper">
        <div className="yazici-ayar__bas">
          <b>{tw.ad}</b>
          <span className="hap"><span className={`nokta ${w?.calisiyor ? 'nokta--yesil' : ''}`} />{w?.calisiyor ? 'çalışıyor' : w?.kurulu ? 'kurulu' : 'kurulu değil'}</span>
          {w?.kurulu && w.model && <span className="hap">{w.model}{w.gpu === undefined ? '' : w.gpu ? ' · GPU' : ' · işlemci'}</span>}
          <span style={{ flex: 1 }} />
          {/* `kurulu` seçili model için hesaplanır: model değişince yeniden "İndir ve kur" çıkar. */}
          {!w?.kurulu && <button type="button" className="dgm dgm--beyaz dgm--k" disabled={iniyor} onClick={indir}><Ikon ad="ice" olcu={14} />{iniyor ? 'İndiriliyor…' : ind?.hata ? 'Yeniden dene' : 'İndir ve kur'}</button>}
          {w?.kurulu && <button type="button" className="dgm dgm--koyu dgm--k" disabled={kaldiriliyor || iniyor} onClick={kaldir}><Ikon ad="cop" olcu={14} />{kaldiriliyor ? 'Kaldırılıyor…' : 'Kaldır'}</button>}
        </div>
        <div className="ikili">
          <div className="alan"><span>Whisper modeli</span><Secici etiket="Whisper modeli" genislik="100%" deger={g.whisperModel} secenekler={WHISPER_MODELLERI} degistir={(v) => gk({ whisperModel: v })} /></div>
          <div className="alan"><span>Ekran kartı</span><Secici etiket="Whisper ekran kartı" genislik="100%" deger={g.whisperGpu} secenekler={WHISPER_GPU} degistir={(v) => gk({ whisperGpu: v })} /></div>
        </div>
        {ind && (
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="ilerleme"><i style={{ width: `${Math.max(2, Math.min(100, ind.yuzde))}%` }} /></div>
            <div className="t-kucuk" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{ind.adim}</span><span>%{Math.round(ind.yuzde)}</span></div>
            {ind.hata && <div className="ayarlar__hata">{ind.hata}</div>}
          </div>
        )}
        {hata && <div className="ayarlar__hata">{hata}</div>}
        <div className="t-kucuk">{tw.aciklama}</div>
      </AyarBolgesi>
    </div>
  );
}

function AjanlarGrubu() {
  const { g, gk } = useGunKaydi();
  const { mod } = useAyarlar();
  const [d] = useDusunmeDurumu();
  const t = useAyarTanimi('ajan-durumlari');
  if (!g) return null;
  // Ajanın notu: sade yazı iki modda; teknik ayrıntı (yazıcı motoru, ham hata) yalnız Geliştirici'de. İş'te yasak sözcük taşıyan eski/ham
  // not gösterilmez (hata: "bir sorun oldu") — Ruling O.
  const ajanNotu = (x: AjanDurumu) => mod === 'gelistirici'
    ? [x.not, x.ayrinti].filter(Boolean).join(' · ')
    : x.not && isDiliIhlali(x.not) ? (x.durum === 'hata' ? 'bir sorun oldu' : '') : x.not;
  const kapali = g.eslikci === 'kapali';
  return (
    <>
      <Satir id="eslikci" ust>
        <div className="sekmeler" role="radiogroup" aria-label="Araya girme" style={{ flex: 'none' }}>
          {ESLIKCI.map(([k, e]) => <button key={k} type="button" role="radio" aria-checked={g.eslikci === k} onClick={() => gk({ eslikci: k })}>{e}</button>)}
        </div>
      </Satir>
      <div className={`eslikci-ayrinti${kapali ? ' eslikci-ayrinti--kapali' : ''}`} aria-disabled={kapali} inert={kapali}>
        <Satir id="eslikci-sesli"><Anahtar acik={g.eslikciSesli} etiket="Sesli konuş" degistir={(v) => gk({ eslikciSesli: v })} /></Satir>
        <Satir id="eslikci-saatlik">
          <OdakGirdi tur="number" genislik={90} min={1} max={12} aria-label="Saatte en çok" deger={String(g.eslikciSaatlik)} duzelt={(v) => sinirla(v, 1, 12, g.eslikciSaatlik)} kaydet={(v) => gk({ eslikciSaatlik: Number(v) })} />
        </Satir>
      </div>
      <Satir id="rapor-saati">
        <OdakGirdi tur="time" genislik={130} aria-label="Günlük rapor saati" deger={g.gunlukRaporSaati} duzelt={(v) => v || g.gunlukRaporSaati} kaydet={(v) => gk({ gunlukRaporSaati: v })} />
      </Satir>
      <Satir id="hafizaya-isle"><Anahtar acik={g.hafizayaIsle} etiket="Kalıcı bilgileri hafızaya da işle" degistir={(v) => gk({ hafizayaIsle: v })} /></Satir>
      {t && (
        <AyarBolgesi id="ajan-durumlari" className="ajan-durumlari">
          <div className="ayar__metin"><b>{t.ad}</b><span>{t.aciklama}</span></div>
          {d?.ajanlar.length ? d.ajanlar.map((x) => (
            <div className="satir" key={x.ad}>
              <AjanNoktasi a={x} />
              <span className="satir__ana"><div className="satir__baslik" style={x.durum === 'kapali' ? { color: 'var(--ink-4)' } : undefined}>{x.etiket}</div>{ajanNotu(x) && <div className="satir__alt" style={x.durum === 'hata' ? { color: 'var(--yazi-hata)' } : undefined}>{ajanNotu(x)}</div>}</span>
              <span className="satir__sag">{x.sayac} kez{x.son ? ` · ${zamanGoreli(x.son)}` : ''}</span>
            </div>
          )) : <div className="t-kucuk">Henüz bir çalışma yok.</div>}
        </AyarBolgesi>
      )}
    </>
  );
}

function SaklamaGrubu() {
  const { g, gk } = useGunKaydi();
  const [sil, setSil] = useState<(typeof SILME)[number] | null>(null);
  const [sonuc, setSonuc] = useState<{ tamam: boolean; metin: string } | null>(null);
  const [siliniyor, setSiliniyor] = useState(false);
  const t = useAyarTanimi('saklama-sureleri');
  if (!g || !t) return null;
  const onayla = () => {
    if (!sil) return;
    setSiliniyor(true);
    void cagir<boolean>('gunkaydi:sil', sil.kapsam)
      .then((ok) => setSonuc(ok ? { tamam: true, metin: '✓ Silindi.' } : { tamam: false, metin: 'Silinemedi.' }))
      .catch((e) => setSonuc({ tamam: false, metin: hataMetni(e) }))
      .finally(() => { setSiliniyor(false); setSil(null); });
  };

  return (
    <>
      <AyarBolgesi id="saklama-sureleri" className="saklama">
        <div className="ayar__metin"><b>{t.ad}</b><span>{t.aciklama}</span></div>
        <div className="saklama__izgara">
          {SAKLAMA.map(([k, e]) => (
            <label key={k} className="alan"><span>{e}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <OdakGirdi tur="number" genislik={80} min={1} max={365} deger={String(g.saklama[k])} duzelt={(v) => sinirla(v, 1, 365, g.saklama[k])} kaydet={(v) => gk({ saklama: { ...g.saklama, [k]: Number(v) } })} />
                <span className="t-kucuk">gün</span>
              </span>
            </label>
          ))}
        </div>
      </AyarBolgesi>
      <Satir id="kayit-sil" ust>
        <span className="dugme-sirasi">
          {SILME.map((s) => <button key={s.kapsam} type="button" className="dgm dgm--koyu dgm--k" aria-pressed={sil?.kapsam === s.kapsam} onClick={() => { setSonuc(null); setSil(s); }}>{s.etiket}</button>)}
        </span>
      </Satir>
      {sil && (
        <div className="onay" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 13.5 }}>{sil.uyari} Emin misin?</span>
          <span className="onay__dugmeler">
            <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => setSil(null)}>Vazgeç</button>
            <button type="button" className="dgm dgm--tehlike dgm--k" disabled={siliniyor} onClick={onayla}><Ikon ad="cop" olcu={14} />{siliniyor ? 'Siliniyor…' : 'Sil'}</button>
          </span>
        </div>
      )}
      {sonuc && <div style={{ fontSize: 13, color: sonuc.tamam ? 'var(--yazi-basari)' : 'var(--yazi-hata)', paddingBottom: 12 }}>{sonuc.metin}</div>}
    </>
  );
}

export const DUSUNME: IcerikHaritasi = { dinleme: DinlemeGrubu, yazici: YaziciGrubu, ajanlar: AjanlarGrubu, saklama: SaklamaGrubu };
