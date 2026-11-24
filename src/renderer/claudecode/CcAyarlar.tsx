// ── Ayarlar sekmesi (Görev 28, K17): yeni oturum modu, Tam yetki, sohbetten verilen işlerin yolu, terminal, Claude Code durumu ──────
import { useEffect, useState } from 'react';
import { islem } from './depo';
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../bilesenler/Ortak';
import { MOD_ADLARI } from './yardimci';
import { KlasorGuveniListesi } from './KlasorGuveni';
import type { CcMod } from '../../shared/cc-olay';
import type { CcAyari } from '../../shared/cc-ayar';

export interface CcAuth { kurulu: boolean; girisYapildi: boolean; yontem?: string; hata?: string }
// Son dalga B (I1): "Her şeyi sor" her komutu sormaz — okumalar, zararsız komutlar ve Claude Code ayarlarındaki izin kuralları sormadan geçer.
const MOD_ACIKLAMA: Record<CcMod, string> = {
  default: 'Düzenlemelerde ve değişiklik yapan komutlarda sorar; okuma, zararsız komut ve Claude Code izin kuralların sormaz.',
  acceptEdits: 'Düzenlemeler kendiliğinden; değişiklik yapan komutlar için sorar. Önerilen.',
  plan: 'Yalnız okur ve plan çıkarır; düzenleme ve komut çalıştırma kapalı.',
  bypassPermissions: 'Hiç sormaz. Yalnız güvendiğin projelerde.',
};

export function CcAyarlar({ ayar, kaydet, claude, auth, authYenile }: {
  ayar: CcAyari; kaydet: (d: Partial<CcAyari>) => Promise<void>; claude: string | null; auth: CcAuth | null; authYenile: () => void;
}) {
  const [giris, setGiris] = useState<{ metin: string; hata?: boolean } | null>(null);
  const [kaydedildi, setKaydedildi] = useState(0);
  useEffect(() => { if (!kaydedildi) return; const z = setTimeout(() => setKaydedildi(0), 2000); return () => clearTimeout(z); }, [kaydedildi]);
  const yaz = async (d: Partial<CcAyari>) => { await kaydet(d); setKaydedildi(Date.now()); };
  const tamYetki = (v: boolean) => void yaz(v ? { tamYetki: true } : { tamYetki: false, ...(ayar.varsayilanMod === 'bypassPermissions' ? { varsayilanMod: 'acceptEdits' as CcMod } : {}) });
  const girisYap = async () => {
    setGiris(null);
    const r = await islem<{ tamam: boolean; hata?: string }>('claudecode:giris');
    setGiris(r.tamam ? { metin: 'Giriş penceresi açıldı. Anthropic’in kendi sayfasında giriş yap; bitince “Yeniden denetle”.' } : { metin: r.hata ?? 'Giriş başlatılamadı.', hata: true });
  };
  return (
    <div className="cc-ayarlar">
      <div className="cc-ayarlar__izgara">
      <div className="cc-ayarlar__sutun">
        <section className="kart cc-ayarlar__kart">
          <div className="cc-ayarlar__bas"><span className="ust-etiket">Yeni oturumların izin modu</span>{kaydedildi > 0 && <span className="cc-kaydedildi" role="status"><Ikon ad="tamam" olcu={13} />Kaydedildi</span>}</div>
          <div className="cc-mod-izgara" role="radiogroup" aria-label="Yeni oturumların izin modu">
            {(['acceptEdits', 'default', 'plan', 'bypassPermissions'] as CcMod[]).map((m) => {
              const kapali = m === 'bypassPermissions' && !ayar.tamYetki;
              return (
                <button key={m} type="button" role="radio" aria-checked={ayar.varsayilanMod === m} className="cc-mod-secenek" data-tam={m === 'bypassPermissions' ? '' : undefined}
                  disabled={kapali} onClick={() => void yaz({ varsayilanMod: m })} title={kapali ? 'Önce aşağıdan Tam yetki’yi aç' : undefined}>
                  <span className="cc-mod-secenek__ust"><b>{MOD_ADLARI[m]}</b>{m === 'bypassPermissions' && <span className="cc-tam-rozet">{kapali ? 'kapalı' : 'dikkat'}</span>}<span className="cc-mod-secenek__isaret" aria-hidden="true" /></span>
                  <span className="cc-mod-secenek__aciklama">{MOD_ACIKLAMA[m]}</span>
                </button>
              );
            })}
          </div>
          <p className="cc-ayarlar__not">Oturum içinde de yazma kutusunun altından değiştirilir. Telefondan ya da sohbetten (Fuber’e verilen işler) başlayan oturumlar en çok “Düzenlemelere izin ver” ile çalışır; Tam yetkiye yalnız burada, oturumun içinden geçilir. Telefondan başlayan oturumda her komut masada onay bekler.</p>
        </section>
        <CcDurumKarti claude={claude} auth={auth} authYenile={authYenile} giris={giris} girisYap={() => void girisYap()} />
      </div>
      <div className="cc-ayarlar__sutun">
        <section className="kart cc-ayarlar__kart">
          <div className="ayar" data-ayar="cc-tam-yetki">
            <div className="ayar__metin"><b>Tam yetki</b><span>Açıkken “Tam yetki” modu seçilebilir: Claude Code dosya düzenleme ve komutlar için <em className="cc-uyari-yazi">hiç izin sormaz</em>. Eski terminal yolu da izinsiz açılır. Yalnız güvendiğin projelerde aç.</span></div>
            <Anahtar acik={ayar.tamYetki} degistir={tamYetki} etiket="Tam yetki" />
          </div>
          <div className="ayar">
            <div className="ayar__metin"><b>Sohbetten verilen işler</b><span>Fuber’e “şu projede şunu yaptır” dediğinde Claude Code nerede çalışsın. Fuber her işten önce onayını sorar (yalnız genel “Tam yetki” açıksa sormaz).</span></div>
            <div className="sekmeler" role="radiogroup" aria-label="Sohbetten verilen işler">
              {([['uygulama', 'Uygulama içinde'], ['terminal', 'Terminalde']] as const).map(([k, ad]) => <button key={k} type="button" role="radio" aria-checked={ayar.yol === k} onClick={() => void yaz({ yol: k })}>{ad}</button>)}
            </div>
          </div>
          <div className="ayar">
            <div className="ayar__metin"><b>Terminal</b><span>“Terminalde aç” ve eski yol için: Windows’un konsolu ya da Windows Terminal.</span></div>
            <div className="sekmeler" role="radiogroup" aria-label="Terminal">
              {([['konsol', 'Konsol'], ['wt', 'Windows Terminal']] as const).map(([k, ad]) => <button key={k} type="button" role="radio" aria-checked={ayar.terminal === k} onClick={() => void yaz({ terminal: k })}>{ad}</button>)}
            </div>
          </div>
          <div className="ayar">
            <div className="ayar__metin"><b>Fuber Claude Code’u yönetsin</b><span>Kapalıysa sohbette Claude Code araçları kullanılmaz; bu sayfa yine çalışır.</span></div>
            <Anahtar acik={ayar.etkin} degistir={(v) => void yaz({ etkin: v })} etiket="Fuber Claude Code’u yönetsin" />
          </div>
        </section>
        <KlasorGuveniListesi />
      </div>
      </div>
    </div>
  );
}

function CcDurumKarti({ claude, auth, authYenile, giris, girisYap }: { claude: string | null; auth: CcAuth | null; authYenile: () => void; giris: { metin: string; hata?: boolean } | null; girisYap: () => void }) {
  return (
        <section className="kart cc-ayarlar__kart">
          <div className="cc-ayarlar__bas"><span className="ust-etiket">Claude Code</span></div>
          <div className="cc-durum-satir">
            <span className="cc-hal" data-ton={claude ? 'bitti' : 'hata'}><i aria-hidden="true" />{claude ? 'Kurulu' : 'Bulunamadı'}</span>
            <span className="cc-yol" title={claude ?? ''}>{claude === 'test' ? 'Önizleme: sahte Claude Code (gerçek claude.exe çalıştırılmaz)' : claude ?? 'claude.exe bu bilgisayarda bulunamadı. Claude Code’u kurunca burada görünür.'}</span>
          </div>
          <div className="cc-durum-satir">
            <span className="cc-hal" data-ton={auth?.girisYapildi ? 'bitti' : auth ? 'izin' : 'notr'}><i aria-hidden="true" />{auth === null ? 'Denetleniyor' : auth.girisYapildi ? 'Oturum açık' : 'Oturum kapalı'}</span>
            <span className="cc-durum-satir__metin">{auth?.girisYapildi ? `Giriş yöntemi: ${auth.yontem === 'claude.ai' ? 'Claude hesabı' : auth.yontem ?? 'bilinmiyor'}` : auth?.hata ? auth.hata : 'Giriş Anthropic’in kendi penceresinde yapılır; Fuber kimlik bilgini görmez ve saklamaz.'}</span>
          </div>
          <div className="cc-denetci__dugmeler">
            {!auth?.girisYapildi && <button type="button" className="dgm dgm--beyaz dgm--k" disabled={!claude} onClick={girisYap}>Oturum aç</button>}
            <button type="button" className="dgm dgm--koyu dgm--k" onClick={authYenile}><Ikon ad="yenile" olcu={14} />Yeniden denetle</button>
          </div>
          {giris && <div className={`cc-ileti${giris.hata ? ' cc-ileti--hata' : ''}`}>{giris.metin}</div>}
        </section>
  );
}
