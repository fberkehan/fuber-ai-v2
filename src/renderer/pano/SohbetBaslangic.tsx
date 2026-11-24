// ── Kokpit sohbetinin boş hâli (Görev 24 düzeltme turu 1, kritik): taze profilde sağ sütun koca bir boş panel olmasın ─────────────────
// Ruling: sohbet listesinin başında, motor çalışsa da çalışmasa da görünen panel —
//  (4) motor yokken en üstte motorun TEK bildirimi (0.10 Görev 2, A-1/A-3/A-41: shared/motor-durumu.ts motorBildirimi — hiç bağlanmamışsa
//      nötr "Fuber hesabına giriş yap" + tek düğme "Giriş yap" (Fuber hesabı penceresi); kopmuşsa kırmızı; hesap onay bekliyorsa sakin,
//      kapalıysa / kullanım hakkı dolduysa R10 metniyle; Gizli modda Gizli modun kendi bildirimi); sohbet şeridi bu sırada hiç çizilmez
//      (Sohbet bosPanelBildirir). Sütun kısaysa (KISA_SUTUN_PX; 1080×680, A-36) kart tek satıra iner: simge + kısa metin + düğme. Bulut
//      motoru varsa kısa "Fuber hazır" kartı (yalnız yerel modelde — Gizli mod dahil — araçlar yok: kart hatırlatıcı/e-posta vaat etmesin);
//  (1) "Bugünün özeti" — yerelde: bugün/sıradaki (gundemOgeleri), tek satır hava, gündemin ilk iki konusu, dolar; her satır kendi
//      kartını (ızgarada vurgulayarak) ya da haberini (Fuber Tarayıcı) açar;
//  (2) bağlama göre sorulabilecekler — yalnız gönderilebilirken (A-38: gönderilemeyecek bir şey önerilmez; Sohbet.tsx'teki ilke); Gizli
//      modda yalnız Gizli turda yapılabilenler (F1 düzeltme turu 2, KK-1: shared/kokpit-istemleri.ts);
//  (3) ana sohbet dışında sohbet varsa "Son sohbetler" (0.11 G7: sohbet:liste'den; satır sayfa değiştirmez, paneldeki sohbeti açar).
// Bütün metinler İş dilinde (model/anahtar/sağlayıcı yok). 0.11 G5: bölümler kütüphanenin yoğun Kart'ı, satırlar Satir (kokpit kartlarıyla
// aynı dil); öneriler Dugme. Satırların sabit adları (data-ozet) önizlemenin tıklama yoludur.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Dugme, Kart, Liste, MetinKirp, Satir } from '../ui';
import { cagir, zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { HavaSimgesi } from './HavaSimgesi';
import { motorEylemiYap, useMotorSinyali } from '../motor-sinyali';
import { YerelYenidenIndirDugmeleri } from '../bilesenler/YerelYenidenIndir';
import { motorBildirimi, motorEngelliMi, motorsuzAcilanlar, yalnizYerelSecili } from '../../shared/motor-durumu';
import { gundemOgeleri, type Gundem } from '../../shared/gundem';
import { oneriListesi, sohbetOnerileri, type Istem } from '../../shared/kokpit-istemleri';
import { gunesSaatleri, havaMetni, havaSimgesi, type PanoDurumu } from '../../shared/pano';
import type { KokpitVerisi, SohbetOzet } from '../../shared/tipler';
import { ozetSatirlari } from '../../shared/kokpit-tekil';

type Sor = (istem: Istem) => void;
type Git = (sayfa: string, id?: number) => void;
const saat = (iso: string | number | Date) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const paraBicim = (x: number, kod: string) => { try { return x.toLocaleString('tr-TR', { style: 'currency', currency: kod, minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch { return x.toFixed(2); } };


/** A-36: sohbet sütunu bu yükseklikten kısaysa motor kartı tek satıra iner. Sütun pencerenin bütün yüksekliğini kaplar: 1080×680'de
 *  ölçülen ≈ 680 px (planın "600 px'ten kısa (1080×680)" amacı bu boyutu hedefler), 1440×900'de ≈ 900 px — eşik ikisinin arasında. */
const KISA_SUTUN_PX = 720;
function useKisaSutun(ref: RefObject<HTMLElement | null>): boolean {
  const [kisa, setKisa] = useState(false);
  useEffect(() => {
    const sutun = ref.current?.closest<HTMLElement>('.kokpit__sohbet') ?? ref.current?.parentElement;
    if (!sutun || typeof ResizeObserver === 'undefined') return;
    const olc = () => setKisa(sutun.getBoundingClientRect().height < KISA_SUTUN_PX);
    olc();
    const r = new ResizeObserver(olc);
    r.observe(sutun);
    return () => r.disconnect();
  }, [ref]);
  return kisa;
}

/** Izgaradaki kartı görünür alana getirip kısa süre vurgular (hareketi azaltta yalnız çerçeve). */
export function kartaGit(tip: string): void {
  const el = document.querySelector<HTMLElement>(`.izgara > [data-kart="${tip}"]`);
  if (!el) return;
  const az = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'nearest', behavior: az ? 'auto' : 'smooth' });
  el.removeAttribute('data-isaret');
  void el.offsetWidth;
  el.setAttribute('data-isaret', '');
  setTimeout(() => el.removeAttribute('data-isaret'), 1600);
}

function gundemSatiri(g: Gundem): string {
  if (g.kip === 'bos' || !g.ogeler.length) return 'Bugün takvimin açık';
  const o = g.ogeler[0];
  if (g.kip === 'siradaki') return `Sıradaki: ${o.baslik}${o.zaman && o.tur !== 'mesele' ? ` · ${new Date(o.zaman).toLocaleDateString('tr-TR', { weekday: 'short' })} ${saat(o.zaman)}` : ''}`;
  const ek = g.toplam > 1 ? ` · +${g.toplam - 1}` : '';
  return o.gecikti ? `Geciken: ${o.baslik}${ek}` : `${o.zaman && o.tur !== 'mesele' && o.tur !== 'toplanti' ? `${saat(o.zaman)} ` : ''}${o.baslik}${ek}`;
}

const BOS_IZGARA: ReadonlySet<string> = new Set();

/** 0.11 G7: `sohbetler` (sohbet:liste; arşivdekiler yok, önizlemeler temiz) ve `sohbetAc`: "Son sohbetler" satırı sayfa değiştirmez, paneldeki
 *  sohbeti değiştirir (sohbet seçiciyle aynı yol); "Tümü" Sohbetler sayfasına götürür. */
/** `izgara`: kokpit ızgarasında görünen kart tipleri — 11 Kas (tasarımcı bulgu 6): "Bugünün özeti" yalnız ızgarada OLMAYANI taşır (Bugün bandı,
 *  hava, gündem konuları, döviz zaten kartlardaysa satırı yok); hepsi ızgaradaysa özet çizilmez, panel sohbet olarak kalır. */
export function SohbetBaslangic({ v, pano, sor, git, sohbetler, sohbetAc, izgara = BOS_IZGARA }: { v: KokpitVerisi; pano: PanoDurumu; sor: Sor; git: Git; sohbetler: readonly SohbetOzet[]; sohbetAc: (id: number) => void; izgara?: ReadonlySet<string> }) {
  const m = useMotorSinyali();
  const kok = useRef<HTMLDivElement>(null);
  const kisa = useKisaSutun(kok);
  // Bildirim yalnız yanıt verilemeyen ya da hesabın beklediği hâllerde (yalnız yerel modelde kart yok: gündelik sohbet çalışır).
  const bildirim = m.hazir && motorEngelliMi(m.gorunum) ? motorBildirimi(m.gorunum, m.mod, m.hesapDurumu, m.gizli, m.motor.yarim, yalnizYerelSecili(m.motor), m.motor.yerelYuzde) : null;
  let g: Gundem;
  try { g = gundemOgeleri(v); } catch { g = { kip: 'bos', ogeler: [], toplam: 0 }; }
  const konular = pano.gundem.durum === 'hazir' ? (pano.gundem.veri ?? []).slice(0, 2) : [];
  const hava = pano.hava;
  const usd = pano.piyasa.durum === 'hazir' ? pano.piyasa.veri?.kurlar.find((k) => k.kod === 'USD') : undefined;
  const okunmamis = v.epostalar.filter((e) => !e.okundu).length;
  const digerSohbetler = sohbetler.filter((s) => s.tur !== 'ana').slice(0, 3);
  const gunes = gunesSaatleri(new Date(), pano.konum.enlem, pano.konum.boylam);

  // Bağlama göre sorulabilecekler (en çok 4; shared/kokpit-istemleri.ts). F1 düzeltme turu 2 (KK-1): Gizli modda araç isteyenlerin
  // (hatırlatıcı, e-posta, plan, haber) yerine Gizli turda yapılabilenler.
  const oneriler = oneriListesi(sohbetOnerileri({ konu: konular[0]?.ad, okunmamis, takvimBos: g.kip === 'bos' }), m.aracsiz).slice(0, 4); // G8 K3: Gizli YA DA yalnız yerel

  const simge = bildirim?.seviye === 'kirmizi' ? 'uyari' : 'kisi';
  const oz = ozetSatirlari(izgara);
  const ozetHava = oz.hava && hava.durum !== 'kapali';
  const ozetKonular = oz.konu ? konular : [];
  const ozetDolar = oz.dolar ? usd : undefined;
  const ozetVar = oz.gundem || ozetHava || ozetKonular.length > 0 || Boolean(ozetDolar);
  return (
    <div className="sohbet-bas" data-sohbet-baslangic="" ref={kok}>
      {bildirim ? (
        <Kart yogun className="sohbet-bas__kart sohbet-bas__kur" aria-label={bildirim.baslik} data-motor-bildirimi={m.gorunum} data-seviye={bildirim.seviye} data-kisa={kisa ? '' : undefined}>
          {kisa ? (
            <div className={`sohbet-bas__kur-satir${bildirim.ikincil?.eylem ? ' sohbet-bas__kur-satir--iki' : ''}`}>
              <span className="sohbet-bas__kur-simge" aria-hidden="true"><Ikon ad={simge} olcu={16} /></span>
              <b className="sohbet-bas__kur-kisa" title={bildirim.metin}><MetinKirp as="span" metin={bildirim.kisa} satir={2} /></b>
              {/* H3c düzeltme turu 2: açıklama yalnız ipucunda kalmaz — kısa kartta görünür tek satır. */}
              {bildirim.alt && <span className="sohbet-bas__kur-alt" title={bildirim.metin}><MetinKirp as="span" metin={bildirim.alt} satir={1} /></span>}
              {/* H3c (P14 K1): "hazır değil" kartı iki AÇIK seçim — sürüm ve boyutuyla; 1 GB üstünde kartın içinde boyutlu onay. Düğmeler başlığın
                  hizasında kendi satırlarında (dar sütunda alt alta). */}
              {bildirim.eylem === 'yerel-kur' ? <span className="sohbet-bas__kur-dugmeler"><YerelYenidenIndirDugmeleri b={bildirim} /></span> : bildirim.dugme && <Dugme tur="birincil" boyut="k" data-motor-eylem={bildirim.eylem} data-cipa={bildirim.cipa} onClick={() => motorEylemiYap(bildirim)}>{bildirim.dugme}</Dugme>}
            </div>
          ) : (
            <>
              <div className="sohbet-bas__kur-ust"><span className="sohbet-bas__kur-simge" aria-hidden="true"><Ikon ad={simge} olcu={16} /></span><b>{bildirim.baslik}</b></div>
              {bildirim.metin && <p className="sohbet-bas__metin">{bildirim.metin}</p>}
              {(bildirim.dugme || bildirim.ikincil) && (
                <div className="sohbet-bas__dugmeler">
                  {bildirim.eylem === 'yerel-kur' ? <YerelYenidenIndirDugmeleri b={bildirim} /> : <>
                    {bildirim.dugme && <Dugme tur="birincil" boyut="k" data-motor-eylem={bildirim.eylem} data-cipa={bildirim.cipa} onClick={() => motorEylemiYap(bildirim)}>{bildirim.dugme}</Dugme>}
                    {bildirim.ikincil && <Dugme tur="hayalet" boyut="k" data-cipa={bildirim.ikincil.cipa} data-motor-eylem={bildirim.ikincil.eylem} onClick={() => motorEylemiYap(bildirim.ikincil!)}>{bildirim.ikincil.etiket}</Dugme>}
                  </>}
                </div>
              )}
            </>
          )}
        </Kart>
      ) : m.hazir && m.gorunum === 'hazir' ? (
        // Yalnız bulut motoru varken: hatırlatıcı/e-posta/plan vaadi yalnız yerel modelle (Gizli mod, araçsız) tutmaz (G24 küçüğü).
        <Kart yogun className="sohbet-bas__kart sohbet-bas__hazir" aria-label="Fuber hazır">
          <div className="sohbet-bas__kur-ust"><span className="sohbet-bas__kur-simge" aria-hidden="true"><Ikon ad="isik" olcu={16} /></span><b>Fuber hazır</b></div>
          <p className="sohbet-bas__metin">Bir şey sor ya da söyle: hatırlatıcı kurar, e-postalarını tarar, gündemi özetler, günü planlar.</p>
        </Kart>
      ) : null}

      {ozetVar && <Kart yogun baslik="Bugünün özeti" className="sohbet-bas__kart sohbet-bas__ozet">
        <Liste>
          {oz.gundem && <Satir key="gundem" sol={<Ikon ad={g.kip === 'bos' ? 'tamam' : 'zil'} olcu={16} />} baslik={gundemSatiri(g)} satir={2} tikla={() => kartaGit('gundem')} data-ozet="gundem" />}
          {ozetHava && (
            <Satir key="hava"
              sol={hava.durum === 'hazir' && hava.veri ? <HavaSimgesi tur={havaSimgesi(hava.veri.simdi.simge)} olcu={20} /> : <Ikon ad="gunes" olcu={16} />}
              baslik={hava.durum === 'hazir' && hava.veri ? `${pano.konum.sehir} ${hava.veri.simdi.sicaklik}° · ${havaMetni(hava.veri.simdi.simge)}` : pano.konum.sehir}
              alt={hava.durum === 'hazir' && hava.veri ? `En yüksek ${hava.veri.bugun.enYuksek}° · En düşük ${hava.veri.bugun.enDusuk}°` : gunes.batis ? `Gün batımı ${saat(gunes.batis)}` : undefined}
              tikla={() => kartaGit('hava')} data-ozet="hava" />
          )}
          {ozetKonular.map((t) => (
            <Satir key={`konu:${t.ad}`} sol={<Ikon ad="kure" olcu={16} />} baslik={t.ad} alt={t.ornek.baslik} tikla={() => void cagir('tarayici:goster', t.ornek.link)} data-ozet="konu" />
          ))}
          {ozetDolar && (
            <Satir key="usd" sol={<Ikon ad="grafik" olcu={16} />} baslik={`Dolar ${paraBicim(ozetDolar.deger, pano.piyasa.veri!.yerel)}`}
              alt={ozetDolar.degisim !== undefined ? `${ozetDolar.degisim >= 0 ? 'Artış' : 'Düşüş'} %${Math.abs(ozetDolar.degisim).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined}
              tikla={() => kartaGit('piyasa')} data-ozet="dolar" />
          )}
        </Liste>
      </Kart>}

      {/* A-38: gönderilemeyecekken (hiç motor yok) tıklanabilir öneri yok — tıklanınca "olmuyor" hissi vermesin; yerine hesapla nelerin
          açılacağını anlatan tıklanmaz kısa liste (sütun boş kalmasın; panoda boş kutu kalmamalı). F1 düzeltme turu 1 (K-6):
          Gizli modda Gizli'nin yapamayacağı işler (hatırlatıcı, e-posta, planlama) vaat edilmez — tek satır (shared/motor-durumu.ts). */}
      {m.hazir && !m.gonderilebilir && (
        <Kart yogun baslik="Fuber’le neler yapabilirsin" className="sohbet-bas__kart" data-acilanlar={m.gizli ? 'gizli' : ''}>
          <Liste>
            {motorsuzAcilanlar(m.gizli, yalnizYerelSecili(m.motor)).map(([simge, metin]) => <Satir key={metin} sol={<Ikon ad={simge} olcu={16} />} baslik={metin} satir={2} />)}
          </Liste>
        </Kart>
      )}
      {(!m.hazir || m.gonderilebilir) && (
        <Kart yogun baslik="Sorabileceklerin" className="sohbet-bas__kart">
          <div className="sohbet-bas__cipler">
            {oneriler.map((o) => <Dugme key={o.etiket} tur="ikincil" boyut="k" simge="gonder" className="sohbet-bas__cip" onClick={() => sor(o.istem)}>{o.etiket}</Dugme>)}
          </div>
        </Kart>
      )}

      {digerSohbetler.length > 0 && (
        <Kart yogun baslik="Son sohbetler" className="sohbet-bas__kart" eylem={{ etiket: 'Tümü', tikla: () => git('sohbetler') }}>
          <Liste>
            {digerSohbetler.map((s) => <Satir key={s.id} sol={<Ikon ad="sohbet" olcu={16} />} baslik={s.baslik} alt={s.sonMesaj || undefined} sag={zamanGoreli(s.guncelleme)} tikla={() => sohbetAc(s.id)} data-son-sohbet={String(s.id)} />)}
          </Liste>
        </Kart>
      )}
    </div>
  );
}
