// ── Kurulumun kısa sayfaları: Hoş geldin, Tanışalım, İşin, Günün, Bağlantılar, İzinler (0.10 E4, K6) ──────────────────────────────────
// Fuber hesabı, Görünüm, Ses, Gizlilik, Cihazdaki yapay zekâ, Geliştirici araçları ve Hazırsın kendi dosyalarında. Her sayfada TEK soru,
// makul varsayılan seçili; alt şeritteki tek birincil düğme "Devam" (sayfalar/Kurulum.tsx). Durum sihirbazda tutulur; buradakiler çizer.
// Metinler kısa ve doğal Türkçe (en çok iki cümle, kesme işareti ’); İş modunda model, sağlayıcı, "anahtar" ve "beyin" sözcüğü yok.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../bilesenler/Ortak';
import { UrunIsareti } from '../bilesenler/UrunIsareti';
import { Rozet } from '../bilesenler/Rozet';
import { EpostaFormu, WhatsappBaglan, useWhatsappDurumu } from '../bilesenler/Formlar';
import { ACIL_YEDEK, useAcilDurdurma } from '../acil-kisayol';
import { hitapMetni } from '../../shared/hitap';
import { kisayolGosterimi } from '../../shared/kisayol';
import { ROL_ADLARI, type IsRolu, type KurulumKipi } from '../../shared/kurulum-adimlari';
import type { Ayarlar } from '../../shared/tipler';

export interface Tanisma { kullaniciAdi: string; hitap: string }

/** Sayfanın tek başlığı ve en çok iki cümlelik girişi. */
export function Bas({ baslik, giris }: { baslik: string; giris?: string }) {
  return <div className="kurulum__bas"><h1 className="t-baslik">{baslik}</h1>{giris && <p className="t-giris">{giris}</p>}</div>;
}

export interface Secenek<T extends string> { deger: T; ad: string; aciklama?: string; rozet?: boolean; devreDisi?: boolean; ek?: ReactNode }

/** Tek seçimli kartlar (radyo grubu): ←/→ ya da ↑/↓ seçimi değiştirir (kapalı seçenek atlanır), odak yeni karta geçer. */
export function Secenekler<T extends string>({ etiket, secenekler, deger, sec, bicim = 'kart' }: {
  etiket: string; secenekler: readonly Secenek<T>[]; deger: T; sec: (v: T) => void; bicim?: 'kart' | 'hap';
}) {
  const acik = secenekler.filter((s) => !s.devreDisi);
  const tus = (e: KeyboardEvent<HTMLDivElement>) => {
    const yon = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!yon || !acik.length) return;
    e.preventDefault();
    const i = acik.findIndex((s) => s.deger === deger);
    const yeni = acik[(i + yon + acik.length) % acik.length];
    sec(yeni.deger);
    const grup = e.currentTarget;
    requestAnimationFrame(() => grup.querySelector<HTMLButtonElement>(`[data-secenek="${yeni.deger}"]`)?.focus());
  };
  return (
    <div className={`secenekler secenekler--${bicim}`} role="radiogroup" aria-label={etiket} onKeyDown={tus} data-secenek-sayisi={secenekler.length}>
      {secenekler.map((s) => (
        <button
          key={s.deger} type="button" role="radio" className="secenek-karti" data-secenek={s.deger} aria-checked={s.deger === deger}
          aria-disabled={s.devreDisi || undefined} tabIndex={s.deger === deger ? 0 : -1} onClick={() => { if (!s.devreDisi) sec(s.deger); }}
        >
          <span className="secenek-karti__isaret" aria-hidden="true" />
          <span className="secenek-karti__yazi">
            <span className="secenek-karti__ad">{s.ad}{s.rozet && <Rozet />}</span>
            {s.aciklama && <span className="secenek-karti__aciklama">{s.aciklama}</span>}
            {s.ek}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Hoş geldin: Fuber'in ürün işareti büyük, tek cümle (Apple sakinliği). Yeniden açılan sihirbazda karşılama yerine yön. */
export function HosGeldinAdimi({ kip }: { kip: KurulumKipi }) {
  const yeniden = kip === 'yeniden';
  return (
    <div className="hosgeldin" data-hosgeldin="">
      <span className="hosgeldin__isaret"><UrunIsareti olcu={92} etiket="Fuber" /></span>
      <h1 className="hosgeldin__baslik">{yeniden ? 'Kurulumu gözden geçir.' : 'Fuber’e hoş geldin.'}</h1>
      <p className="hosgeldin__giris">{yeniden ? 'Değiştirmek istediğin sayfayı soldan seç ya da “Devam” ile sırayla geç.' : 'Birkaç kısa soruyla seni tanıyıp hazır olurum; her seçimi sonra Ayarlar’dan değiştirebilirsin.'}</p>
    </div>
  );
}

/** Tanışalım: ad ve hitap (ikisi de isteğe bağlı; boş geçilebilir). */
export function TanismaAdimi({ t, set }: { t: Tanisma; set: (t: Tanisma) => void }) {
  const hitap = hitapMetni(t.kullaniciAdi, t.hitap);
  return (
    <>
      <Bas baslik="Sana nasıl sesleneyim?" giris="Adını yazarsan sana öyle seslenirim; istersen boş bırak." />
      <div className="ikili">
        <label className="alan"><span>Adın</span><input className="girdi" autoFocus value={t.kullaniciAdi} maxLength={60} onChange={(e) => set({ ...t, kullaniciAdi: e.target.value })} placeholder="Adın" data-alan="ad" /></label>
        <label className="alan"><span>Hitap (ör. Bey, Hanım, Hocam)</span><input className="girdi" value={t.hitap} maxLength={40} onChange={(e) => set({ ...t, hitap: e.target.value })} placeholder="Bey" data-alan="hitap" /></label>
      </div>
      {t.kullaniciAdi.trim() && <div className="hap hitap-onizleme" data-hitap-onizleme="">Sana <b>“{hitap}”</b> diye sesleneceğim</div>}
    </>
  );
}

/** İşin: rol (Kurucu / Yönetici / Ekip lideri / Geliştiriciyim / Diğer) ve isteğe bağlı şirket adı. "Geliştiriciyim" kullanım biçimini
 *  Geliştirici'ye çevirir (sihirbaz anında kaydeder; Hazırsın'dan önce "Geliştirici araçları" girer). Geliştirici'de bu bilgisayarda
 *  Claude Code notu varsa içe aktarma satırı (varsayılan kapalı, denetim C-11; İş'te hiç yok). */
export function IsinAdimi({ rol, setRol, sirket, setSirket, claudeSayi, claudeHafiza, setClaudeHafiza }: {
  rol: IsRolu; setRol: (r: IsRolu) => void; sirket: string; setSirket: (s: string) => void;
  claudeSayi: number; claudeHafiza: boolean; setClaudeHafiza: (v: boolean) => void;
}) {
  const gelistirici = rol === 'gelistirici';
  return (
    <>
      <Bas baslik="Ne iş yapıyorsun?" giris="Önerilerimi ve günlük özetimi buna göre hazırlarım." />
      <Secenekler etiket="Rolün" bicim="hap" deger={rol} sec={setRol} secenekler={ROL_ADLARI.map(([deger, ad]) => ({ deger, ad }))} />
      <label className="alan alan--sirket"><span>Şirketin <em className="kurulum__istege">(isteğe bağlı)</em></span>
        <input className="girdi" value={sirket} maxLength={80} onChange={(e) => setSirket(e.target.value)} placeholder="Şirketinin adı" data-alan="sirket" />
      </label>
      {gelistirici && (
        <div className="kurulum-not" role="note" data-gelistirici-notu="">
          <Ikon ad="kod" olcu={16} />
          <span>Developer mode’a geçtim: Claude Code sayfası açılır, kurulumun sonunda önerilen araçları sorarım.</span>
        </div>
      )}
      {gelistirici && claudeSayi > 0 && (
        <div className="izin-satiri" data-claude-hafiza="">
          <span className="izin-satiri__yazi"><b>Claude Code notlarımı oku</b><span>Bu bilgisayarda {claudeSayi} not var; projelerini baştan bilirim.</span></span>
          <Anahtar acik={claudeHafiza} degistir={setClaudeHafiza} etiket="Claude Code notlarımı oku" />
        </div>
      )}
    </>
  );
}

/** Günün: çalışma saatleri, sabah özeti ve bilgisayar açılınca başlama (sabah özeti için gerekli; kapalıyken tek cümle uyarı, C-23). */
export function GununAdimi({ gunBas, gunBit, setGun, sabah, setSabah, ayar, kaydet, sessizUygulanir }: {
  gunBas: string; gunBit: string; setGun: (bas: string, bit: string) => void; sabah: string; setSabah: (s: string) => void;
  ayar: Ayarlar; kaydet: (d: Partial<Ayarlar>) => void;
  /** Saatler sessiz saate eşlenecek mi (sayfalar/Kurulum.tsx): metin yalnız uygulanan şeyi söyler (I1 5b). */
  sessizUygulanir: boolean;
}) {
  const [sonSabah, setSonSabah] = useState(sabah || '08:30');
  const mac = window.fuber?.platform === 'darwin';
  return (
    <>
      <Bas baslik="Günün nasıl geçiyor?" giris={sessizUygulanir ? 'Mesai dışında sessiz kalırım; hatırlatıcıların yine zamanında gelir.' : 'Planlarımı bu saatlere göre yaparım; hatırlatıcıların zamanında gelir.'} />
      <div className="izin-listesi">
        <div className="izin-satiri">
          {/* Mesai dışı = sessiz saat (proaktif.sessizBaslangic/Bitis; ipc.ts kurulum:tamamla, shared/kurulum-adimlari.ts sessizSaatleri).
              Gece yarısını aşan mesai sessiz saate eşlenmez; yeniden açılan sihirbazda dokunulmamış önerilen saat de yazılmaz. */}
          <span className="izin-satiri__yazi"><b>Çalışma saatlerin</b><span>{sessizUygulanir ? 'Bu saatlerin dışında yalnız hatırlatıcılar için yazarım.' : 'Sessiz saatin Ayarlar’daki gibi kalır.'}</span></span>
          <span className="saat-araligi">
            <input className="girdi" type="time" value={gunBas} onChange={(e) => setGun(e.target.value || gunBas, gunBit)} aria-label="Çalışma başlangıcı" data-alan="gun-bas" />
            <span aria-hidden="true">–</span>
            <input className="girdi" type="time" value={gunBit} onChange={(e) => setGun(gunBas, e.target.value || gunBit)} aria-label="Çalışma bitişi" data-alan="gun-bit" />
          </span>
        </div>
        <div className="izin-satiri">
          <span className="izin-satiri__yazi"><b>Sabah özeti</b><span>{sabah ? 'Her sabah günün özetiyle sana yazarım.' : 'Kapalı; açarsan her sabah günün özetiyle yazarım.'}</span></span>
          <span className="saat-araligi">
            {sabah && <input className="girdi" type="time" value={sabah} onChange={(e) => { if (e.target.value) { setSabah(e.target.value); setSonSabah(e.target.value); } }} aria-label="Sabah özeti saati" data-alan="sabah" />}
            <Anahtar acik={Boolean(sabah)} degistir={(v) => setSabah(v ? sonSabah : '')} etiket="Sabah özeti" />
          </span>
        </div>
        <div className="izin-satiri">
          <span className="izin-satiri__yazi">
            <b>{mac ? 'Mac açılınca başlat' : 'Windows açılışında başlat'}</b>
            <span>{!ayar.baslangictaAc && sabah ? 'Fuber kapalıyken sabah özeti gelmez.' : 'Tepside sessizce çalışırım; hatırlatıcılar zamanında gelir.'}</span>
          </span>
          <Anahtar acik={ayar.baslangictaAc} degistir={(v) => kaydet({ baslangictaAc: v })} etiket={mac ? 'Mac açılınca başlat' : 'Windows açılışında başlat'} />
        </div>
      </div>
    </>
  );
}

/** Bağlantılar (C-21): aynı düzende iki satır — simge, ad, tek satır açıklama, sağda "Bağla". Açılan form tek başına durur. */
export function BaglantilarAdimi({ ayar, yenile }: { ayar: Ayarlar; yenile: () => void }) {
  const [acik, setAcik] = useState<'eposta' | 'whatsapp' | null>(null);
  const [wa] = useWhatsappDurumu(); // WhatsApp satırı yalnız ana süreç izin verirse (modül + İş modu + WhatsApp hakkı)
  const hesap = ayar.eposta.filter((e) => e.parolaVar).length;
  const gelistirici = ayar.mod === 'gelistirici';
  const satir = (tur: 'eposta' | 'whatsapp', simge: string, ad: string, aciklama: string, bagli: string | null) => (
    <div className="baglanti-satiri" data-baglanti={tur} key={tur}>
      <span className="baglanti-satiri__simge" aria-hidden="true"><Ikon ad={simge} olcu={17} /></span>
      <span className="izin-satiri__yazi"><b>{ad}</b><span>{aciklama}</span></span>
      {bagli && <span className="hap"><span className="nokta nokta--yesil" />{bagli}</span>}
      <button type="button" className="dgm dgm--koyu dgm--k" aria-expanded={acik === tur} onClick={() => {
        if (acik === tur) { setAcik(null); return; }
        setAcik(tur);
        if (tur === 'whatsapp' && !ayar.whatsapp.bagli) void cagir('whatsapp:baslat').catch(() => undefined);
      }}>{acik === tur ? 'Kapat' : bagli && tur === 'eposta' ? 'Bir hesap daha' : bagli ? 'Yönet' : 'Bağla'}</button>
    </div>
  );
  return (
    <>
      <Bas baslik="Nereden haber alayım?" giris="İsteğe bağlı; sonra Bağlantılar sayfasından da eklersin." />
      <div className="izin-listesi">
        {acik !== 'whatsapp' && satir('eposta', 'posta', 'E-posta', 'Önemli e-postaları söylerim; parolan yalnız e-posta sunucuna gider.', hesap ? `${hesap} hesap` : null)}
        {acik === 'eposta' && <div className="baglanti-formu"><EpostaFormu birincil={false} bitti={() => { yenile(); setAcik(null); }} /></div>}
        {acik !== 'eposta' && wa.izinli && satir('whatsapp', 'wp', 'WhatsApp', 'Mesajların bu bilgisayarda saklanır; gönderim hep onay ister.', ayar.whatsapp.bagli ? 'Bağlı' : null)}
        {acik === 'whatsapp' && wa.izinli && <div className="baglanti-formu"><WhatsappBaglan birincil={false} /></div>}
      </div>
      {!acik && <p className="kurulum__dip">{gelistirici ? 'Notion, GitHub gibi servisler: Bağlantılar sayfasında.' : 'Başka servisler: Bağlantılar sayfasında.'}</p>}
    </>
  );
}

/** İzinler: tarayıcı, fare ve klavye, dosyalar, "Hey Fuber"; Tam yetki kapalı ve açılırken satır içi onay ister (C-23). */
export function IzinlerAdimi({ ayar, kaydet }: { ayar: Ayarlar; kaydet: (d: Partial<Ayarlar>) => void }) {
  const acilTus = useAcilDurdurma();
  const [tamOnay, setTamOnay] = useState(false);
  const y = ayar.yetki;
  const satirlar: [string, string, string, boolean, (v: boolean) => void][] = [
    ['tarayici', 'Tarayıcı', 'Kendi penceremde web’de gezinir, okurum; tıklamadan önce sorarım.', y.tarayici, (v) => kaydet({ yetki: { ...y, tarayici: v } })],
    ['bilgisayar', 'Fare ve klavye', `Her görevde sorarım; ${acilTus ?? ACIL_YEDEK} her şeyi anında durdurur.`, y.bilgisayar, (v) => kaydet({ yetki: { ...y, bilgisayar: v } })],
    ['dosyalar', 'Dosyalar', 'Masaüstü, Belgeler ve İndirilenler’i okurum; başka klasör için sorarım.', y.dosyaOkuma, (v) => kaydet({ yetki: { ...y, dosyaOkuma: v } })],
    ['uyandirma', '“Hey Fuber”', 'Mikrofon bu bilgisayarda dinlenir; ses yalnız uyandıktan sonra gider.', ayar.ses.uyandirma, (v) => kaydet({ ses: { ...ayar.ses, uyandirma: v } })],
  ];
  return (
    <>
      <Bas baslik="Bilgisayarında neleri kullanayım?" giris="Önerilenler açık; hepsini sonra Ayarlar’dan değiştirirsin." />
      <div className="izin-listesi">
        {satirlar.map(([k, b, a, v, f]) => (
          <div className="izin-satiri" key={k} data-izin={k}>
            <span className="izin-satiri__yazi"><b>{b}</b><span>{a}</span></span>
            <Anahtar acik={v} degistir={f} etiket={b} />
          </div>
        ))}
        <div className="izin-satiri" data-izin="tam-yetki">
          {tamOnay ? (
            <>
              <span className="izin-satiri__yazi"><b>Tam yetki açılsın mı?</b><span>Fare, klavye ve tarayıcıda sormadan çalışırım; gönderimler yine onay ister.</span></span>
              <span className="saat-araligi">
                <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => setTamOnay(false)}>Vazgeç</button>
                <button type="button" className="dgm dgm--koyu dgm--k" data-tam-yetki-ac="" onClick={() => { kaydet({ yetki: { ...y, tamYetki: true, bilgisayar: true, tarayici: true } }); setTamOnay(false); }}>Aç</button>
              </span>
            </>
          ) : (
            <>
              <span className="izin-satiri__yazi"><b>Tam yetki</b><span>{y.tamYetki ? 'Açık: sormadan çalışırım; gönderimler yine onay ister.' : 'Kapalı: her görevde önce sorarım.'}</span></span>
              <Anahtar acik={y.tamYetki} degistir={(v) => { if (v) setTamOnay(true); else kaydet({ yetki: { ...y, tamYetki: false } }); }} etiket="Tam yetki" />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** "… [Ctrl+Shift+Space] ya da [“Hey Fuber”]" (Hazırsın ve tanıtım turu): kısayol okunur yazılır (Mac'te ⌘); "Hey Fuber" kapalıyken
 *  (C-29) ya da bilinmiyorsa yalnız kısayol çipi; kısayol yoksa yalnız "Hey Fuber". */
export function CagirmaIpucu({ kisayol, uyandirma = true }: { kisayol: string | null | undefined; uyandirma?: boolean }) {
  const tus = kisayolGosterimi(kisayol, window.fuber?.platform === 'darwin'); // G3: "Ctrl+Shift+Boşluk" (Mac'te ⌘)
  if (!uyandirma) return tus ? <span className="tus">{tus}</span> : null;
  return <>{tus && <><span className="tus">{tus}</span><span>ya da</span></>}<span className="tus">“Hey Fuber”</span></>;
}
