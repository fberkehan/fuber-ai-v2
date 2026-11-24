// Ayarlar → Yapay zekâ sağlayıcısı. 5 Kas (Business kullanıcıları da kendi API anahtarını kullanabilir): Business'ta TEK satır — "Kendi Claude
// anahtarım": anahtarı kaydetmek Claude'u seçer, Sil Fuber'e döndürür (ana süreç kuralı iki modda aynı: shared/motor-secimi.ts claudeSecili). Satır
// `data-is-dili-istisna` taşır. Developer'da aşağıdaki ayrıntılı düzen sürer. 0.14, ürün kararı:
// 0.13 T15'in "kullanıcı anahtarı yok" kuralı tersine döner. Sağlayıcı: Fuber (varsayılan, bugünkü davranış) ya da
// Claude (Anthropic). Claude yalnız seçili + anahtar kayıtlıyken kullanılır (iki modda; shared/motor-secimi.ts claudeSecili). Mod geçişi seçimi
// bozmaz.
// Anahtar: maskeli girdi → sir:yaz (ana süreç biçimi ve modu yeniden denetler; telefondan kapalı). Kayıtlı anahtar ASLA gösterilmez — yalnız
// "Kayıtlı" + "Sil". "Bağlantıyı dene" motor:sina('anthropic') (Gizli / "Yalnız bu bilgisayar"da ana süreç buluta gitmez).
// Modeller: rol başına (sohbet = ana, arka plan = yardimci) Claude modeli + düşünme gücü; liste motor:model-bilgileri('anthropic')
// (Claude seçili değilken ağa çıkmadan yerleşik tablo).
import { useEffect, useMemo, useState } from 'react';
import { cagir } from '../api';
import { Anahtar } from '../bilesenler/Ortak';
import { Secici, type SeciciSecenegi } from '../bilesenler/Secici';
import { useAyarlar, type IcerikHaritasi } from './baglam';
import { Satir } from './Ortak';
import { claudeRolSecimi, claudeSecili, EFORLAR, OPENAI_UYUMLU_HAZIR, openaiAnahtariGecerli, openaiModelGecerli, openaiTabanGecerli, openaiUyumluSecili, yerelTabanMi, type ClaudeRolSecimi } from '../../shared/motor-secimi';
import type { Ayarlar, Efor, ModelRolu } from '../../shared/tipler';
import type { ModelListesi } from '../../shared/model-bilgisi';

const EFOR_ADI: Record<Efor, string> = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', xhigh: 'Çok yüksek', max: 'En yüksek' };
const EFOR_SECENEKLERI: SeciciSecenegi<Efor>[] = EFORLAR.map((e) => ({ deger: e, etiket: EFOR_ADI[e] }));

/** IPC hatasının Electron önekini atar ("Error invoking remote method 'sir:yaz': Error: …"). */
const hataMetni = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

function SaglayiciGrubu() {
  const { a, kaydet } = useAyarlar();
  const secim = a.motorSecimi === 'anthropic' || a.motorSecimi === 'openai' ? a.motorSecimi : 'fuber';
  const etkin = claudeSecili(a);
  return (
    <Satir id="motor-secimi" ust ek={secim === 'anthropic' && !etkin ? <span data-claude-bekliyor=""> Claude anahtarı kaydedilene dek yanıtlar Fuber’den gelir.</span>
      : secim === 'openai' && !openaiUyumluSecili(a) ? <span data-openai-bekliyor=""> Kendi sağlayıcın ayarlanana dek yanıtlar Fuber’den ya da bu bilgisayardan gelir.</span> : null}>
      <div className="sekmeler" role="radiogroup" aria-label="Yapay zekâ sağlayıcısı">
        {([['fuber', 'Fuber'], ['anthropic', 'Claude (Anthropic)'], ['openai', 'Kendi sağlayıcın']] as const).map(([d, ad]) => (
          <button key={d} type="button" role="radio" aria-checked={secim === d} onClick={() => { if (secim !== d) kaydet({ motorSecimi: d }); }}>{ad}</button>
        ))}
      </div>
    </Satir>
  );
}

interface Deneme { tamam: boolean; model?: string; yanit?: string; hata?: string }

function AnahtarGrubu() {
  const { a, yenile, kaydet } = useAyarlar();
  const is = a.mod !== 'gelistirici';
  const [v, setV] = useState('');
  const [hata, setHata] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const [deneme, setDeneme] = useState<Deneme | null>(null);
  const kayitli = a.claudeAnahtariVar === true;
  const temiz = v.trim();

  const yaz = async (deger: string | null) => {
    setMesgul(true); setHata(''); setDeneme(null);
    try {
      await cagir('sir:yaz', 'api:anthropic', deger);
      setV('');
      // Business: tek satır — kaydet = Claude'u kullan, Sil = Fuber'e dön (Developer'da seçim ayrı satırda).
      if (is) kaydet({ motorSecimi: deger ? 'anthropic' : 'fuber' });
      yenile();
    } catch (e) { setHata(hataMetni(e)); } finally { setMesgul(false); }
  };
  const dene = async () => {
    setMesgul(true); setDeneme(null);
    try { setDeneme(await cagir<Deneme>('motor:sina', 'anthropic')); } catch (e) { setDeneme({ tamam: false, hata: hataMetni(e) }); } finally { setMesgul(false); }
  };

  return (
    <div data-is-dili-istisna={is ? '' : undefined}>
      <Satir id="claude-anahtar" ust>
        {kayitli ? (
          <span className="dugme-sirasi">
            <span className="hap" data-claude-kayitli="">{is ? (claudeSecili(a) ? 'Kullanılıyor' : 'Kayıtlı') : 'Kayıtlı'}</span>
            {is && !claudeSecili(a) && <button type="button" className="dgm dgm--koyu dgm--k" disabled={mesgul} onClick={() => kaydet({ motorSecimi: 'anthropic' })}>Kullan</button>}
            <button type="button" className="dgm dgm--koyu dgm--k" disabled={mesgul} onClick={() => void dene()}>{mesgul ? 'Deneniyor…' : 'Bağlantıyı dene'}</button>
            <button type="button" className="dgm dgm--k" disabled={mesgul} onClick={() => void yaz(null)}>Sil</button>
          </span>
        ) : (
          <form className="dugme-sirasi" onSubmit={(e) => { e.preventDefault(); if (temiz) void yaz(temiz); }}>
            <input className="girdi" type="password" style={{ width: 240 }} value={v} placeholder="sk-ant-…" aria-label="Claude anahtarı"
              autoComplete="off" spellCheck={false} onChange={(e) => { setV(e.target.value); setHata(''); }} />
            <button type="submit" className="dgm dgm--koyu dgm--k" disabled={mesgul || !temiz}>{is ? 'Kaydet ve kullan' : 'Anahtarı kaydet'}</button>
          </form>
        )}
      </Satir>
      {hata && <div className="deneme-sonucu" role="alert" style={{ color: 'var(--yazi-hata)' }}>{hata}</div>}
      {deneme && (
        <div className="deneme-sonucu" aria-live="polite" style={{ color: deneme.tamam ? 'var(--yazi-basari)' : 'var(--yazi-hata)' }}>
          {deneme.tamam ? `✓ Claude yanıt verdi${deneme.model && !is ? ` · ${deneme.model}` : ''}` : `✕ ${deneme.hata ?? 'Bağlanılamadı.'}`}
        </div>
      )}
    </div>
  );
}

function useClaudeListesi(tazele: string): ModelListesi | null {
  const [l, setL] = useState<ModelListesi | null>(null);
  useEffect(() => {
    let canli = true;
    cagir<ModelListesi>('motor:model-bilgileri', 'anthropic').then((x) => { if (canli) setL(x); }).catch(() => { /* yerleşik liste yoksa seçici serbest yazıma izin verir */ });
    return () => { canli = false; };
  }, [tazele]);
  return l;
}

function RolSatiri({ id, rol, liste }: { id: string; rol: ModelRolu; liste: ModelListesi | null }) {
  const { a, kaydet } = useAyarlar();
  const s = claudeRolSecimi(a, rol);
  const secenekler = useMemo<SeciciSecenegi[]>(() => {
    const m = (liste?.modeller ?? []).filter((x) => x.id.startsWith('claude-')).map((x) => ({ deger: x.id, etiket: x.ad || x.id, aciklama: x.ad && x.ad !== x.id ? x.id : undefined }));
    return m.some((x) => x.deger === s.model) ? m : [{ deger: s.model, etiket: s.model }, ...m];
  }, [liste, s.model]);
  const yaz = (yeni: Partial<ClaudeRolSecimi>) => kaydet({ claudeModeller: { ana: claudeRolSecimi(a, 'ana'), yardimci: claudeRolSecimi(a, 'yardimci'), [rol]: { ...s, ...yeni } } });
  return (
    <Satir id={id} ust>
      <span className="dugme-sirasi">
        <Secici etiket={rol === 'ana' ? 'Sohbet modeli' : 'Arka plan modeli'} genislik={220} deger={s.model} secenekler={secenekler} serbest ara degistir={(m) => yaz({ model: m })} />
        <Secici etiket="Düşünme gücü" genislik={130} deger={s.efor ?? 'medium'} secenekler={EFOR_SECENEKLERI} degistir={(e) => yaz({ efor: e })} />
      </span>
    </Satir>
  );
}

function ModellerGrubu() {
  const { a, kaydet } = useAyarlar();
  const liste = useClaudeListesi(`${a.claudeAnahtariVar}|${claudeSecili(a)}`);
  return (
    <>
      <RolSatiri id="claude-ana-model" rol="ana" liste={liste} />
      <RolSatiri id="claude-yardimci-model" rol="yardimci" liste={liste} />
      <Satir id="claude-web-arama">
        <Anahtar acik={a.saglayicilar.anthropic.sunucuWebArama} etiket="Claude’un web araması" degistir={(v) => kaydet({ saglayicilar: { anthropic: { sunucuWebArama: v } } as unknown as Ayarlar['saglayicilar'] })} />
      </Satir>
    </>
  );
}

// ── Açık kaynak hazırlığı (11 Kas): kendi OpenAI uyumlu sağlayıcın (Fuber hesabı gerekmez) ─────────────────────────────────────────────
// Taban adresi (hazır: OpenAI, OpenRouter, bu bilgisayardaki Ollama / LM Studio; ya da elle) + model + anahtar. Bu bilgisayardaki sunucu anahtar
// istemez. "Kaydet ve kullan" ayarı yazar, anahtarı (varsa) sir:yaz ile ayrı yuvaya ('api:openai') koyar ve sağlayıcıyı 'openai' yapar; "Kullanma"
// Fuber'e döner, anahtar kalır; "Anahtarı sil" yuvayı boşaltır. Kayıtlı anahtar ASLA gösterilmez. Gizli / "Yalnız bu bilgisayar"da ana süreç buluta
// gitmez (bu bilgisayardaki sunucu dahil: Gizli yalnız Fuber'in kendi yerel yapay zekâsını kullanır).
function OpenaiUyumluGrubu() {
  const { a, yenile, kaydet } = useAyarlar();
  const [taban, setTaban] = useState(a.openaiUyumlu?.tabanUrl ?? OPENAI_UYUMLU_HAZIR[0].tabanUrl);
  const [model, setModel] = useState(a.openaiUyumlu?.model ?? '');
  const [anahtar, setAnahtar] = useState('');
  const [hata, setHata] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const [deneme, setDeneme] = useState<Deneme | null>(null);
  const kayitli = a.openaiAnahtariVar === true;
  const yerel = yerelTabanMi(taban);
  const etkin = openaiUyumluSecili(a);
  const t = taban.trim().replace(/\/+$/, '');
  const m = model.trim();
  const k = anahtar.trim();
  const gecerli = openaiTabanGecerli(t) && openaiModelGecerli(m) && (yerel || kayitli || openaiAnahtariGecerli(k));

  const kullan = async () => {
    setMesgul(true); setHata(''); setDeneme(null);
    try {
      if (k) await cagir('sir:yaz', 'api:openai', k);
      setAnahtar('');
      kaydet({ openaiUyumlu: { tabanUrl: t, model: m }, motorSecimi: 'openai' });
      yenile();
    } catch (e) { setHata(hataMetni(e)); } finally { setMesgul(false); }
  };
  const anahtariSil = async () => {
    setMesgul(true); setHata(''); setDeneme(null);
    try { await cagir('sir:yaz', 'api:openai', null); yenile(); } catch (e) { setHata(hataMetni(e)); } finally { setMesgul(false); }
  };
  const dene = async () => {
    setMesgul(true); setDeneme(null);
    try { setDeneme(await cagir<Deneme>('motor:sina', 'openai')); } catch (e) { setDeneme({ tamam: false, hata: hataMetni(e) }); } finally { setMesgul(false); }
  };

  return (
    <div data-is-dili-istisna="" data-openai-uyumlu="">
      <Satir id="openai-taban" ust>
        <span className="dugme-sirasi">
          <Secici etiket="Hazır" genislik={200} deger={OPENAI_UYUMLU_HAZIR.find((h) => h.tabanUrl === t)?.tabanUrl ?? ''}
            secenekler={[...OPENAI_UYUMLU_HAZIR.map((h) => ({ deger: h.tabanUrl, etiket: h.ad })), { deger: '', etiket: 'Başka adres' }]}
            degistir={(v) => { if (v) setTaban(v); }} />
          <input className="girdi" style={{ width: 260 }} value={taban} aria-label="Taban adresi" spellCheck={false} autoComplete="off"
            placeholder="https://…/v1" onChange={(e) => { setTaban(e.target.value); setHata(''); }} />
        </span>
      </Satir>
      <Satir id="openai-model" ust>
        <input className="girdi" style={{ width: 240 }} value={model} aria-label="Model" spellCheck={false} autoComplete="off"
          placeholder={yerel ? 'llama3.2' : 'gpt-5.5'} onChange={(e) => { setModel(e.target.value); setHata(''); }} />
      </Satir>
      <Satir id="openai-anahtar" ust>
        <span className="dugme-sirasi">
          {kayitli ? <span className="hap" data-openai-kayitli="">Kayıtlı</span>
            : <input className="girdi" type="password" style={{ width: 240 }} value={anahtar} aria-label="Sağlayıcı anahtarı" autoComplete="off" spellCheck={false}
              placeholder={yerel ? 'Bu bilgisayarda gerekmez' : 'sk-…'} onChange={(e) => { setAnahtar(e.target.value); setHata(''); }} />}
          <button type="button" className="dgm dgm--koyu dgm--k" disabled={mesgul || !gecerli} onClick={() => void kullan()} data-openai-kullan="">{etkin ? 'Kaydet' : 'Kaydet ve kullan'}</button>
          {etkin && <button type="button" className="dgm dgm--koyu dgm--k" disabled={mesgul} onClick={() => void dene()}>{mesgul ? 'Deneniyor…' : 'Bağlantıyı dene'}</button>}
          {etkin && <button type="button" className="dgm dgm--k" disabled={mesgul} onClick={() => kaydet({ motorSecimi: 'fuber' })}>Kullanma</button>}
          {kayitli && <button type="button" className="dgm dgm--k" disabled={mesgul} onClick={() => void anahtariSil()}>Anahtarı sil</button>}
        </span>
      </Satir>
      {hata && <div className="deneme-sonucu" role="alert" style={{ color: 'var(--yazi-hata)' }}>{hata}</div>}
      {deneme && (
        <div className="deneme-sonucu" aria-live="polite" style={{ color: deneme.tamam ? 'var(--yazi-basari)' : 'var(--yazi-hata)' }}>
          {deneme.tamam ? `✓ Yanıt geldi${deneme.model ? ` · ${deneme.model}` : ''}` : `✕ ${deneme.hata ?? 'Bağlanılamadı.'}`}
        </div>
      )}
    </div>
  );
}

export const SAGLAYICI: IcerikHaritasi = { saglayici: SaglayiciGrubu, 'claude-anahtari': AnahtarGrubu, 'claude-modelleri': ModellerGrubu, 'kendi-saglayici': OpenaiUyumluGrubu };
