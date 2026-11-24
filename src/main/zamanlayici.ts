// ── Proaktif motor ───────────────────────────────────────────────────────────────────────────────────────────
// Bu AI rastgele bir AI değil: kullanıcı yazmasa bile ona mesaj atar, onun hakkında sık sık soru sorar ve
// öğrenir. → Arka planda (pencere kapalıyken de, sistem tepsisinde) çalışır:
//  • Hatırlatıcılar: zamanı gelince bildirim + ana sohbete mesaj + üstten inen adada bildirim (+ istenirse sesli).
//  • Sabah özeti (varsayılan 08:30): Fuber bugünün hatırlatıcılarına, planlarına, önemli e-postalarına bakıp yazar.
//  • Merak sorusu (günde 0-3, 11:00-20:00 arası rastgele): çekirdek hafızadaki boşluklara göre TEK soru.
//  • Akşam özeti (isteğe bağlı), e-posta eşitleme (5 dk), kokpit tazeleme (15 dk).
// Sessiz saatlerde (varsayılan 23:00-08:00) hatırlatıcılar dışında hiçbir şey yazmaz. Kullanıcı o sırada sohbet
// ediyorsa proaktif iş bekler (ana sohbette yanıt sürüyorsa sıraya girer). "Rahatsız etme" (sol menü, 1 saat; proaktif.
// rahatsizEtmeBitis) bitişine dek sessiz saat gibidir: eşlikçi, rapor duyurusu, özetler ve bildirimler susar, hatırlatıcılar gelir.
// Uygulama öndeyken (ana pencere odaklı ve görünür) hatırlatıcı ve mesaj Windows bildirimi değil ana pencerede tost olur (ada.ts
// yönlendirir); ada kapalıyken Windows bildirimi kalır.
import { beyinBasla, beyinde, sinyal } from './beyin.js';
import { Notification } from 'electron';
import { ayarlar } from './ayarlar.js';
import { yollar } from './yollar.js';
import { simdi as saat } from './saat.js';
import { adaAnaOndeMi } from './ada.js';
import { sureSuruyor } from '../shared/ada.js';
import { sessizSaatteMi } from '../shared/acilis.js';
import { meta, metaYaz, metaSil } from './vt.js';
import { zamaniGelenler, hatirlaticiTetiklendi, gunDonumu, hatirlaticilar, gorevler } from './planlama.js';
import { hafizaBuda } from './hafiza/depo.js';
import { yayinla } from './olaylar.js';
import { hitapMetni } from '../shared/hitap.js';
import { yerelOzetMetni } from '../shared/yerel-ozet.ts';
import { gecmisiOku, gecmiseEkle, tekrarMi as tekrarMiEski, oncekiyleAyniMi, beklemeli, oncekilerMetni, TEKRAR_UYARISI, type ProaktifIz } from '../shared/proaktif-tekrar.ts';
import { anaSohbet, mesajEkle, gorunume, mesajlar } from './sohbet.js';
import { kullaniciYazdiMi } from './sohbet-temizlik.js';
import { ozetKosusu } from './iceaktar.js';
import { sohbetOlayi, anaDinle } from './olaylar.js';
import { yanitla, mesgulMu } from './ajan/dongu.js';
import { kokpitYenile } from './kokpit/duzen.js';
import { esitle, epostaHesaplari } from './entegrasyon/eposta.js';
import { tekMotorYolu } from './motor/yerel.js';
import { proaktifIsCalisirMi, tanismaTalimati, type ProaktifIs } from '../shared/ic-talimat.js';
import { gorunenBloklarMetni } from '../shared/telefon-hafif.js';

let pencereyiAc: () => void = () => undefined;
let asistanaGonder: (veri: { tur: 'hatirlatma' | 'mesaj'; baslik: string; metin: string }) => void = () => undefined;

// YALNIZ FUBER_DEMO: Windows bildirimi gösterilmez, buraya yazılır (ada:test-bildirimler okur) — testler kullanıcının masaüstüne
// bildirim düşürmesin, "hatırlatıcı Windows bildirimine gitti" ölçülebilsin.
const testBildirimleri: { baslik: string; metin: string; zaman: number; ikon: string }[] = [];
export const testBildirimKaydi = () => testBildirimleri.slice();

export function bildirimGoster(baslik: string, metin: string, tikla?: () => void): void {
  // 0.10 E1 (K7): bildirimin içinde Fuber'in ikonu (Windows'ta uygulama logosu yerinde). Başlıktaki küçük ikon ve ad kimliğin kısayolundan
  // gelir (kabuk-kimligi.ts).
  const ikon = yollar.kaynak('ikon', 'fuber.png');
  if (process.env.FUBER_DEMO) { testBildirimleri.push({ baslik, metin: metin.slice(0, 240), zaman: Date.now(), ikon }); return; }
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: baslik, body: metin.slice(0, 240), silent: false, icon: ikon });
  n.on('click', () => (tikla ?? pencereyiAc)());
  n.show();
}

/** "Rahatsız etme" sürüyor mu (sol menü / Ayarlar → Kendiliğinden yazma; 1 saat). */
export function rahatsizEtmeMi(): boolean { return sureSuruyor(ayarlar().proaktif.rahatsizEtmeBitis, saat()); }

const dakika = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** Sessiz saat ya da "Rahatsız etme": hatırlatıcılar dışında kendiliğinden mesaj ve bildirim yok. Aralık kuralı TEK yerde
 *  (shared/acilis.ts sessizSaatteMi; açılış sesi de aynısını kullanır — 0.11 G12b, G11 incelemesi K4; tests/sessiz-saat.test.ts). */
export function sessizMi(d = new Date()): boolean {
  if (rahatsizEtmeMi()) return true;
  const p = ayarlar().proaktif;
  return sessizSaatteMi(p.sessizBaslangic, p.sessizBitis, d);
}
const bugun = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD yerel

/** Zamanı gelen hatırlatıcılar: ana sohbete mesaj + Windows bildirimi (uygulama arkadaysa; öndeyse ada.ts tost yapar) + ada.
 *  Rahatsız etme ve sessiz saat hatırlatıcıyı SUSTURMAZ. */
export async function hatirlaticilariIsle(): Promise<void> {
  for (const h of zamaniGelenler()) {
    hatirlaticiTetiklendi(h);
    beyinBasla('saat', `hatırlatıcı: ${h.baslik}`)(false, 'hatırlattı');
    sinyal('saat', 'kokpit', 'hatırlatıcı çaldı');
    const ana = anaSohbet();
    const metin = `⏰ **${h.baslik}**${h.aciklama ? `\n${h.aciklama}` : ''}`;
    const m = mesajEkle(ana, { rol: 'assistant', bloklar: [{ tur: 'metin', metin }], kaynak: 'proaktif', okunmamis: true });
    sohbetOlayi({ tur: 'yeni_mesaj', sohbetId: ana, mesaj: gorunume([m])[0] });
    if (!adaAnaOndeMi()) bildirimGoster(`Hatırlatma · ${h.baslik}`, h.aciklama ?? new Date(h.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }));
    asistanaGonder({ tur: 'hatirlatma', baslik: h.baslik, metin: h.aciklama ?? '' });
  }
}

/** Fuber'in kendiliğinden mesajını duyurur (Windows bildirimi — uygulama öndeyse tost — ve ada). Rahatsız etme sürerken duyurmaz
 *  (mesaj ana sohbette kalır); false döner. */
export function proaktifBildir(baslik: string, metin: string): boolean {
  if (rahatsizEtmeMi()) return false;
  if (!adaAnaOndeMi()) bildirimGoster(baslik, metin.replace(/[*_#`>]/g, '').slice(0, 220));
  asistanaGonder({ tur: 'mesaj', baslik, metin: metin.slice(0, 600) });
  return true;
}

const AZAMI_DENEME = 3; // günlük iş başına
const DENEME_ARASI = 10 * 60_000;
const surenIsler = new Set<string>();
const sonDeneme = new Map<string, number>();

/** Fuber'in kendiliğinden yaptığı bir iş: ana sohbete yazar, bildirir. Sohbet meşgulse sonraki tikte tekrar dener.
 *  Günlük anahtar YALNIZ başarılı turdan sonra yazılır (eskiden önce yazılıyordu: motor hatası o günün özetini
 *  yutuyordu); başarısızsa 10 dk arayla günde en çok 3 deneme. Testler de çağırır (tests/proaktif-yanki.test.ts). */
export async function proaktifIs(is: Exclude<ProaktifIs, 'tanisma'>, anahtar: string, bildirimBasligi: string): Promise<void> {
  // 0.12 cila: kapı tek kuraldır (yol; eskiden "hazır bulut motoru var mı" ayrıca soruluyordu — d683a7f'deki hafıza/kokpit kalıbı).
  const yol = tekMotorYolu();
  if (yol === 'yok' || meta(anahtar) || surenIsler.has(anahtar)) return;
  // 11 Kas analizi #9: "Yalnız bu bilgisayar"da (Gizli değil) sabah/akşam özeti MODELSİZ, şablonla (bugünün hatırlatıcıları, açık yapılacaklar).
  if (yol === 'yerel' && !ayarlar().yerel.gizliMod && (is === 'sabah' || is === 'aksam')) { yerelOzet(is, anahtar, bildirimBasligi); return; }
  // G1 (F2): SABAH/AKSAM/MERAK araç ister; Gizli/yerel turda araç yok (ajan/dongu.ts) — küçük yerel model talimatı aynen geri yazıyordu.
  // Bulut yolu yoksa iş BİLEREK atlanır: deneme ve gün anahtarı yazılmaz (Gizli kapanınca aynı gün çalışır; shared/ic-talimat.ts).
  if (!proaktifIsCalisirMi(is, yol)) return;
  const ana = anaSohbet();
  // 11 Kas analizi #6: tekrar koruması KODDA — gönderilenler meta listesinde (son 60), hafızada değil; aralık ve merak susması (shared/proaktif-tekrar.ts).
  const gecmis = proaktifGecmisi();
  if (beklemeli(is, gecmis, Date.now(), merakDurumu(ana, gecmis))) return; // sonraki tikte yeniden sorulur (deneme sayılmaz)
  // 11 Kas analizi §6.2: bakılacak hiçbir şey yokken sabah özeti modele gitmez (yedek model boş listeyle "14:00 strateji toplantısı" uydurdu).
  if (is === 'sabah' && sabahBos()) { metaYaz(anahtar, `bos:${new Date().toISOString()}`); return; }
  const denemeAnahtari = `${anahtar}:deneme`;
  const deneme = Number(meta(denemeAnahtari) ?? 0);
  if (deneme >= AZAMI_DENEME || Date.now() - (sonDeneme.get(anahtar) ?? 0) < DENEME_ARASI) return;
  if (mesgulMu(ana)) return; // sonraki tikte tekrar denenir (deneme sayılmaz)
  surenIsler.add(anahtar);
  sonDeneme.set(anahtar, Date.now());
  metaYaz(denemeAnahtari, String(deneme + 1));
  try {
    const talimat = `${PROAKTIF_TALIMATLARI[is]}${oncekilerMetni(gecmis, is, is === 'merak' ? 12 : 3)}`;
    let tekrar = false;
    const tekrarMi = (m: string) => (tekrar = tekrarMiEski(m, gecmis));
    let son = await yanitla(ana, { metin: talimat, gizliTetik: true, kaynak: 'proaktif', tekrarMi });
    if (!son && tekrar) {
      // Bir kez, "eskisini tekrarladın" uyarısıyla yeniden; yine tekrarsa bugün gönderilmez (gün anahtarı yazılır: üçüncü deneme olmaz).
      tekrar = false;
      son = await yanitla(ana, { metin: `${talimat}${TEKRAR_UYARISI}`, gizliTetik: true, kaynak: 'proaktif', tekrarMi });
      if (!son && tekrar) { metaYaz(anahtar, `tekrar:${new Date().toISOString()}`); console.info(`[proaktif] ${is}: yeni bir şey yok (tekrar), bugün gönderilmedi`); return; }
    }
    if (!son) return; // hata / durduruldu: anahtar yazılmaz, sonra yeniden denenir
    metaYaz(anahtar, new Date().toISOString());
    // 0.11 G6: yapay zekânın kartı bildirimde düz metin olarak (kartDuzMetin); yalnız karttan oluşan özet de boş kalmaz.
    const metin = gorunenBloklarMetni(son.bloklar);
    proaktifGecmisineYaz(is, metin || '');
    if (metin) proaktifBildir(bildirimBasligi, metin);
  } finally {
    surenIsler.delete(anahtar);
  }
}

// ── Kendiliğinden mesaj geçmişi (meta; hafızaya yazılmaz) ──────────────────────────────────────────────────────────────────────────────────
const PROAKTIF_GECMIS = 'proaktif:gecmis';
export const proaktifGecmisi = (): ProaktifIz[] => gecmisiOku(meta(PROAKTIF_GECMIS));
function proaktifGecmisineYaz(is: string, metin: string): void {
  if (!metin.trim()) return;
  metaYaz(PROAKTIF_GECMIS, JSON.stringify(gecmiseEkle(proaktifGecmisi(), { is, metin, zaman: new Date().toISOString() })));
}
/** Merak susması için: son merak sorularının her birinden sonra (6 saat içinde, sıradaki kendiliğinden mesajdan önce) kullanıcı yazdı mı; son yazışı. */
function merakDurumu(ana: number, gecmis: ProaktifIz[]): { yanitlandi: boolean[]; sonKullanici?: number } {
  const yazdigi = mesajlar(ana).filter((m) => kullaniciYazdiMi(m.rol, m.kaynak)).map((m) => Date.parse(m.zaman));
  const merak = gecmis.filter((g) => g.is === 'merak').slice(-3);
  return {
    yanitlandi: merak.map((g) => { const t = Date.parse(g.zaman); return yazdigi.some((u) => u > t && u - t < 6 * 3600_000); }),
    sonKullanici: yazdigi.length ? Math.max(...yazdigi) : undefined,
  };
}
/** Sabah özetinin bakacağı hiçbir şey yok mu: önümüzdeki 24 saatte hatırlatıcı, açık yapılacak, e-posta hesabı, gün kaydı yok. */
function sabahBos(): boolean {
  return !hatirlaticilar({ durum: 'bekliyor', sonraki: 24, limit: 1 }).length && !gorevler({ limit: 1 }).length && !epostaHesaplari().length && !ayarlar().gunKaydi?.etkin;
}

/** "Yalnız bu bilgisayar": modelsiz sabah/akşam özeti — hatırlatıcı ve yapılacaklardan şablon. Söylenecek bir şey yoksa ya da dünküyle aynıysa
 *  mesaj yazılmaz (gün anahtarı yine yazılır). Testler çağırır (tests/yerel-ozet.test.ts). */
export function yerelOzet(is: 'sabah' | 'aksam', anahtar: string, bildirimBasligi: string): boolean {
  const simdi = new Date();
  const gunBasi = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const hedef = gunBasi(simdi);
  if (is === 'aksam') hedef.setDate(hedef.getDate() + 1);
  const bitis = new Date(hedef);
  bitis.setDate(bitis.getDate() + 1);
  const hat = hatirlaticilar({ durum: 'bekliyor', limit: 50 }).filter((h) => { const t = Date.parse(h.zaman); return t >= hedef.getTime() && t < bitis.getTime(); });
  // Yalnız son tarihi geçmiş ya da ertesi güne dek dolan yapılacaklar: her sabah aynı açık iş listesi yeniden gelmesin.
  const acik = gorevler({ limit: 30 }).filter((g) => g.sonTarih && Date.parse(g.sonTarih) < bitis.getTime() + 86_400_000).slice(0, 6);
  const biten = is === 'aksam' ? gorevler({ durum: 'tamam', limit: 20 }).filter((g) => g.tamamlanma && Date.parse(g.tamamlanma) >= gunBasi(simdi).getTime()) : [];
  const metin = yerelOzetMetni(is, { hitap: hitapMetni(ayarlar().kullaniciAdi, ayarlar().hitap), hatirlaticilar: hat, acik, biten });
  metaYaz(anahtar, new Date().toISOString());
  // Veriden yazılan liste bayat olamaz; yalnız dünküyle AYNIYSA (veri değişmedi) yeniden gönderilmez.
  if (!metin || oncekiyleAyniMi(metin, proaktifGecmisi(), is)) return false;
  const ana = anaSohbet();
  const m = mesajEkle(ana, { rol: 'assistant', bloklar: [{ tur: 'metin', metin }], kaynak: 'proaktif', okunmamis: true });
  sohbetOlayi({ tur: 'yeni_mesaj', sohbetId: ana, mesaj: gorunume([m])[0] });
  proaktifGecmisineYaz(is, metin);
  proaktifBildir(bildirimBasligi, metin);
  return true;
}

// ── Hafıza budaması: günlük TEK ATIMLIK zamanlayıcı (yoklama yok; 11 Kas analizi #1) ───────────────────────────────────────────────────────
// Gece 03:30'da (uygulama kapalıysa açılıştan 5 dk sonra; son koşu 24 saatten eskiyse) hafiza/depo.ts hafizaBuda çalışır, sonra ertesi gece için
// yeniden kurulur. Modelsizdir; hiçbir şeyi kalıcı silmez (arşiv).
const BUDAMA_ANAHTARI = 'hafiza:budama:son';
let budamaSaati: NodeJS.Timeout | null = null;
/** Sonraki budamaya kalan süre (ms). Testler `simdi` ve `son` verir. */
export function budamaGecikmesi(simdi: Date, son: string | undefined): number {
  if (!son || simdi.getTime() - Date.parse(son) > 24 * 3600_000) return 5 * 60_000;
  const sonraki = new Date(simdi);
  sonraki.setHours(3, 30, 0, 0);
  if (sonraki <= simdi) sonraki.setDate(sonraki.getDate() + 1);
  return sonraki.getTime() - simdi.getTime();
}
export function hafizaBudamaZamanla(): void {
  if (budamaSaati) clearTimeout(budamaSaati);
  const son = meta(BUDAMA_ANAHTARI)?.split('|')[0];
  budamaSaati = setTimeout(() => {
    budamaSaati = null;
    try {
      const r = hafizaBuda();
      metaYaz(BUDAMA_ANAHTARI, `${new Date().toISOString()}|${JSON.stringify(r)}`);
      if (r.birlesen || r.arsivlenen || r.sabittenInen) { yayinla('hafiza:degisti', { adet: r.birlesen + r.arsivlenen + r.sabittenInen }); console.info('[hafıza] budama:', JSON.stringify(r)); }
    } catch (e) { console.warn('[hafıza] budama:', (e as Error).message); }
    hafizaBudamaZamanla();
  }, budamaGecikmesi(new Date(), son));
  budamaSaati.unref?.();
}

// ── Tanışma (kurulum sonu) ve bekleyen tanışma (0.12 cila düzeltme turu 1, I-3) ─────────────────────────────────────────────────
// Kurulum akışı yapay zekânın hazır olmasını beklemez: "Yalnız bu bilgisayar" seçen yeni kullanıcıda model kurulum bittiğinde hâlâ iner
// (ya da Fuber hesabı onay bekler) → yol 'yok' ve tanışma atlanıyor, bir daha denenmiyordu. Artık bekleme işareti yazılır; zamanlayıcı
// (tik, 30 sn) yol hazır, ana sohbet boş (kullanıcı henüz yazmadı) ve meşgul değilken tanışmayı BİR kez yapar. İşaret 48 saatte düşer
// (eski kurulumun tanışması günler sonra çıkmasın).
export const TANISMA_BEKLIYOR = 'tanisma:bekliyor';
const TANISMA_SURESI = 48 * 3600_000;

function tanismaBaslat(yol: 'yerel' | 'bulut'): void {
  metaSil(TANISMA_BEKLIYOR);
  // G1 (F2): yol 'yerel'se tanışma araçsız, kısa talimatla yerel modele gider (araç adı, yetenek listesi yok). İç talimat hiçbir yüzeyde
  // görünmez (shared/ic-talimat.ts; yankı bekçisi ajan/dongu.ts).
  void yanitla(anaSohbet(), { metin: tanismaTalimati(yol === 'yerel'), gizliTetik: true, kaynak: 'proaktif' });
}

/** Kurulum bitti (ipc.ts kurulum:tamamla): yol varsa tanışma hemen; yoksa bekleme işareti (bekleyenTanisma yapar). Dönen: başladı mı. */
export function tanismaYap(): boolean {
  const yol = tekMotorYolu();
  if (yol === 'yok' || !proaktifIsCalisirMi('tanisma', yol)) {
    metaYaz(TANISMA_BEKLIYOR, new Date().toISOString());
    return false;
  }
  tanismaBaslat(yol);
  return true;
}

/** Bekleyen tanışma (tik): işaret 48 saatten eskiyse ya da kullanıcı ana sohbette bu arada yazdıysa düşer; yol hazır ve ana sohbet meşgul
 *  değilse tanışma bir kez yapılır. Dönen: başladı mı. Testler `simdi` verir. */
export function bekleyenTanisma(simdi = Date.now()): boolean {
  const v = meta(TANISMA_BEKLIYOR);
  if (!v) return false;
  if (!(simdi - Date.parse(v) < TANISMA_SURESI)) { metaSil(TANISMA_BEKLIYOR); return false; }
  const yol = tekMotorYolu();
  if (yol === 'yok' || !proaktifIsCalisirMi('tanisma', yol)) return false;
  const ana = anaSohbet();
  if (mesajlar(ana).some((m) => kullaniciYazdiMi(m.rol, m.kaynak))) { metaSil(TANISMA_BEKLIYOR); return false; }
  // Ertelenen tanışma kendiliğinden bir mesajdır: sessiz saatte ve "Rahatsız etme"de beklenir (gece inen model tanışmayı gece getirmez).
  if (sessizMi(new Date(simdi))) return false;
  if (mesgulMu(ana)) return false;
  tanismaBaslat(yol);
  return true;
}

const SABAH = `SABAH ÖZETİ hazırla. Önce hatirlatici_listele (24 saat), gorev_listele ve bağlıysa eposta_listele (okunmamış) ile bugüne bak. Gün kaydı açıksa meseleler (açık; hedefi bugün/yarın olanlar) ve gun_raporu (gunluk, dün) ile dünden kalanlara da bak. Sonra kullanıcıya kısa, enerjik bir günaydın mesajı yaz: bugünün 1-3 önceliği, yaklaşan hatırlatıcılar, dikkat isteyen e-postalar, varsa tek bir öneri. YALNIZ araçların bugün döndürdüğüne dayan: geçmiş günlerin toplantılarını ve önceki özetlerini tekrar etme, olmayanı uydurma. Gerekirse kokpite "bugün" kartı koy (kokpit_kart id:"bugun", saat:14). 8 satırı geçme.`;
const AKSAM = `AKŞAM ÖZETİ hazırla: bugün konuşulanlara (hafiza_ara ile bugünün kayıtları), tamamlanan/açık görevlere ve yarının hatırlatıcılarına bak; kısa bir kapanış mesajı yaz: bugün ne ilerledi, yarın ne bekliyor, unutulan bir şey var mı. Önceki akşamların özetini tekrar etme. 6 satırı geçme.`;
// 11 Kas analizi #6: sorulan sorular hafızaya YAZDIRILMAZ (ayda 30 "Merak sorusu" kaydı hafızayı kirletiyordu, hafiza_ara yalnız son 10'unu görüyordu);
// zamanlayıcı önceki soruları bu talimatın sonuna kendisi ekler (shared/proaktif-tekrar.ts oncekilerMetni) ve tekrarı kodda yakalar.
const MERAK = `MERAK SORUSU: Kullanıcıyı daha iyi tanımak istiyorsun. Çekirdek hafızaya ve son hafıza kayıtlarına bak (hafiza_ara gerekirse); bilmediğin ama işine yarayacak önemli bir konu seç (projeleri, öncelikleri, çalışma alışkanlıkları, ekibi, hedefleri, tercihleri…). Aşağıda listelenen, daha önce sorduğun soruları ya da benzerlerini sorma. Sıcak ve kısa TEK bir soru yaz; neden sorduğunu yarım cümleyle söyleyebilirsin. Hafızaya kayıt yazma.`;
/** Kendiliğinden işlerin iç talimatları (modele gider, kullanıcıya hiçbir yüzeyde görünmez — G1/F2; shared/ic-talimat.ts). */
export const PROAKTIF_TALIMATLARI = { sabah: SABAH, aksam: AKSAM, merak: MERAK } as const;

function merakZamanlari(): number[] {
  const adet = Math.max(0, Math.min(3, ayarlar().proaktif.merakSorusuGunluk));
  // Adet anahtarda: ayardan "günde kaç soru" değişince bugünün planı yeniden kurulur (eskisi gün boyu kalıyordu).
  const k = `merak-plan:${bugun()}:${adet}`;
  const v = meta(k);
  if (v) return JSON.parse(v);
  const out = Array.from({ length: adet }, () => 11 * 60 + Math.floor(Math.random() * 9 * 60)).sort((a, b) => a - b);
  metaYaz(k, JSON.stringify(out));
  return out;
}

let sonEposta = 0;
let sonKokpit = 0;
let sonOzetDenemesi = 0;

/** Art arda geçici sonuçla biten koşu sayısı (geri çekilme; bir başarıda sıfır). Cila düzeltme turu 3 (N-10). */
let ozetGeriCekilme = 0;
let ozetKosusuSozu: Promise<unknown> = Promise.resolve();
/** Sonraki kendiliğinden yeniden denemeye kalan en kısa aralık: 15 dk × 2^(art arda geçici koşu), en çok 6 saat. */
export const ozetAraligi = (): number => Math.min(15 * 60_000 * 2 ** ozetGeriCekilme, 6 * 3600_000);
/** Süren kendiliğinden koşunun bitişi (testler). */
export const bekleyenOzetlerBitti = (): Promise<unknown> => ozetKosusuSozu;

/** Özeti çıkarılamamış içe aktarılan belgeleri yeniden dene (tik). Cila düzeltme turu 2 (N-9): sessiz saatte ve "Rahatsız etme"de beklenir
 *  (bekleyenTanisma gibi). Turu 3 (N-10): koşu geçici hatayla biterse (sunucu kapalı, ağ yok, 5xx, 429) aralık ikiye katlanır — 15 → 30 →
 *  60 dk … en çok 6 sa; bir başarıda 15 dk'ya döner. Dönen: deneme başlatıldı mı. */
export function bekleyenOzetler(simdi = Date.now()): boolean {
  if (sessizMi(new Date(simdi)) || simdi - sonOzetDenemesi <= ozetAraligi()) return false;
  sonOzetDenemesi = simdi;
  ozetKosusuSozu = ozetKosusu()
    .then((s) => { if (s.islenen > 0) ozetGeriCekilme = 0; else if (s.gecici) ozetGeriCekilme = Math.min(ozetGeriCekilme + 1, 5); })
    .catch(() => undefined);
  return true;
}

/** Tikin kendiliğinden yazma bölümü (sessiz saatte hiçbiri): sabah ve akşam özeti pencereleri, günün merak planı. Kendiliğinden yazma kapalıysa
 *  hiçbir şey yapmaz. `merakiBekle` (testler ve 30 günlük simülasyon): merak işi de beklenir; tikte beklenmez (e-posta/kokpit gecikmesin). */
export async function kendiligindenIsler(d: Date, o: { merakiBekle?: boolean } = {}): Promise<void> {
  const a = ayarlar();
  if (!a.proaktif.etkin || sessizMi(d)) return;
  const n = d.getHours() * 60 + d.getMinutes();
  if (a.proaktif.sabahOzeti && n >= dakika(a.proaktif.sabahOzeti) && n < dakika(a.proaktif.sabahOzeti) + 180) await proaktifIs('sabah', `sabah:${bugun()}`, 'Günaydın — özetin hazır');
  if (a.proaktif.aksamOzeti && n >= dakika(a.proaktif.aksamOzeti) && n < dakika(a.proaktif.aksamOzeti) + 120) await proaktifIs('aksam', `aksam:${bugun()}`, 'Günün özeti');
  const isler = merakZamanlari().map((z, i) => (n >= z && n < z + 120 ? proaktifIs('merak', `merak:${bugun()}:${i}`, 'Fuber bir şey sormak istiyor') : null)).filter(Boolean);
  if (o.merakiBekle) await Promise.all(isler);
}

async function tik(): Promise<void> {
  try { await hatirlaticilariIsle(); } catch { /* bir sonraki tik */ }
  // 0.11 G4: yerel gece yarısından sonraki ilk tik (ya da açılış): dünün işaretlileri karttan kalkar, günde TEK hafıza kaydı olur.
  // Kendiliğinden yazma kapalı olsa da çalışır (yapay zekâ çağırmaz; yalnız yerel kayıt).
  try { gunDonumu(new Date()); } catch { /* bir sonraki tik */ }
  const a = ayarlar();
  if (!a.kurulumTamam || process.env.FUBER_DEMO) return;
  // 0.12 cila düzeltme turu 1: kendiliğinden yazmadan bağımsız iki bekleyen iş — kurulum sonunda yapılamayan tanışma (I-3) ve özeti
  // çıkarılamamış içe aktarılan belgeler (I-1; 15 dk'da bir, kalıcı hatada belge başına en çok 3 kez; ikisi de sessiz saatte bekler).
  try { bekleyenTanisma(); } catch (e) { console.warn('[tanışma] bekleyen:', (e as Error).message); }
  try { bekleyenOzetler(); } catch (e) { console.warn('[içe aktar] bekleyen özetler:', (e as Error).message); }
  if (!a.proaktif.etkin) return;
  await kendiligindenIsler(new Date());
  if (a.proaktif.epostaTakip && epostaHesaplari().length && Date.now() - sonEposta > 5 * 60_000) { sonEposta = Date.now(); void beyinde('iletisim', 'e-postaları eşitliyor', () => esitle()).catch(() => 0); }
  if (Date.now() - sonKokpit > 15 * 60_000) { sonKokpit = Date.now(); void kokpitYenile('zaman'); }
}

export function zamanlayiciBaslat(o: { pencereyiAc: () => void; asistanaGonder: typeof asistanaGonder }): void {
  pencereyiAc = o.pencereyiAc;
  asistanaGonder = o.asistanaGonder;
  // Diğer modüllerin 'bildirim' olayları (önemli e-posta, WhatsApp) masaüstü bildirimine çevrilir (sessiz saat hariç).
  anaDinle<{ baslik: string; metin: string }>('bildirim', (b) => { if (!sessizMi()) bildirimGoster(b.baslik, b.metin); });
  setTimeout(() => void tik(), 5000);
  setInterval(() => void tik(), 30_000);
  if (!process.env.FUBER_DEMO) hafizaBudamaZamanla();
}
