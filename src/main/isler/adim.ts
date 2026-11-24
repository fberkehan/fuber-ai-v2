// ── Görev adımı: yapay zekânın bir turu (0.11 G9; spec §8 Adım; testler: tests/isler-izin.test.ts, tests/isler-ic-talimat.test.ts) ──────────
// Gözcü değişiklik bulunca zamanlayıcı bir adım çalıştırır: görevin KENDİ sohbetinde (tür 'gorev') kısa bir iç talimatla (G1: `gizliTetik` —
// hiçbir yüzeyde görünmez; yankılanırsa döngü yanıtı düşürür ve null döner). Bağlam talimatta DEĞİL <baglam> bloğundadır (kayda girmez): amaç,
// plan, son 3 adımın özeti, gözcünün bulduğu değişiklik — tüm geçmiş değil. Araçlar: turun araçları ∩ (risk serbest ya da görev izninin alanı;
// ekran/tarayıcı araçları yalnız o izinle) + is_adim_bitti. İzin kapsamındaki çağrı onay sormaz; kapsam dışı normal onay kartına düşer
// (ajan/dongu.ts GorevAdimi). Adım is_adim_bitti ile biter (sonra model çağrılmaz); çağrılmadıysa özet turun son metninden alınır.
// BAŞARISIZ adım (null): tur hata verdi/durdu, yanıt ya da özet/bildirim/sonuç iç talimatı yankıladı ya da (0.14 T13) adım 30 model çağrısında
// is_adim_bitti'siz yarım kaldı (görev sohbetine "yarım kaldı" satırı) — zamanlayıcı onu saymaz, bildirmez. İstisna (düzeltme turu 2): yarım kalan
// adımda geri dönüşsüz bir iş (gönderim, dosya silme, komut, onay kapısından geçen çağrı) başarıyla yapıldıysa adım sayılır, yeniden denenmez; özeti
// yapılanların listesidir.
// ERTELENEN adım ('ertele'; düzeltme turu 1): kullanıcı görev sohbetinde yazışıyor (meşgul hatası gösterilmez) ya da zamanlayıcı adımı kesti
// (kullanıcı ekranı kullanmaya başladı) — başarısız sayılmaz, kısa süre sonra yeniden planlanır.
// Düzeltme turu 1: WhatsApp izni KİŞİYE bağlı — `kime` gönderimle aynı kuralla çözülür, ad birden çok kişiye uyuyorsa izin yok (whatsapp.ts
// whatsappKisiCoz). İzinle (onaysız) yapılan gönderimler görevin kaydına ve görev sohbetine "Gönderilenler: …" olarak yazılır (alıcı + zaman;
// metin yok) — adım yankı yüzünden başarısız olsa da.
// Son inceleme C1: e-posta izni de gönderimin GERÇEK alıcılarına bakar — kime/cc/bcc gönderenin kendi ayrıştırıcısıyla çözülür
// (entegrasyon/eposta-alicilari.ts); izinli adresin yanına saklanan her alıcı (görünen ad, grup, tırnak, boşluk hilesi) normal onay kartına düşer.
// Son inceleme küçük 4: izin dışı gönderimin onay kartı görevi adıyla anar (GorevAdimi.baslik).
import { yanitla, mesgulMu, durdur, GOREV_ADIMI_GRUBU, type GorevAdimi } from '../ajan/dongu.js';
import { aracBul, type Arac } from '../ajan/araclar/kayit.js';
import { mesajEkle, gorunume } from '../sohbet.js';
import { sohbetOlayi } from '../olaylar.js';
import { ayarlar } from '../ayarlar.js';
import { tarayiciSayfasi } from '../tarayici.js';
import { whatsappKisiCoz } from '../entegrasyon/whatsapp-kapisi.js';
import { epostaAlicilari } from '../entegrasyon/eposta-alicilari.js';
import { izinVarMi, izinAlaninda, isPlaniMetni, sureMetni, planlananBitis, jidAyniMi, gonderilenlerMetni, type Gonderim } from '../../shared/isler.js';
import { icTalimatYankisiMi } from '../../shared/ic-talimat.js';
import { gorunenBloklarMetni } from '../../shared/telefon-hafif.js';
import { gonderimEkle, type IsKaydi } from './depo.js';

export interface AdimSonucu { ozet: string; bildir?: string; sonrakiSn?: number; bitti?: boolean; sonuc?: string }
/** Adım yapılmadı ama başarısız da değil: zamanlayıcı kısa süre sonra yeniden dener. */
export const ERTELE = 'ertele' as const;

/** Adımın iç talimatı: kısa, emir kipinde, göreve özgü hiçbir şey taşımaz (amaç/plan bağlam bloğunda) — yanıtta aynen tekrar edilebilecek uzun
 *  liste yok (G1 yankı bekçisi ≥ 40 karakterlik ortak parçayı yankı sayar). Son inceleme küçük 3: "GÖREV ADIMI:" gibi büyük harfli BAŞLIKLA
 *  başlamaz — bekçi başlıkla başlayan her yanıtı yankı sayar ve olağan bir özet ("Görev adımı: Ahmet’e yazdım.") adımı başarısız yapardı;
 *  gerçek yankıyı 40 karakterlik ortak parça kuralı yakalar (tests/isler-ic-talimat.test.ts). */
export const ADIM_TALIMATI = 'Bağlamdaki görevin sıradaki adımını yap; bitirince is_adim_bitti aracını çağır.';

/** 0.14 T13 düzeltme turu 1: adım tavana (GOREV_AZAMI_ADIM, 30 model çağrısı) is_adim_bitti'siz ulaştı — tamamlandı SAYILMAZ (başarısız adım gibi: sayılmaz,
 *  iz ilerlemez, değişiklik sonraki adımda yeniden ele alınır; art arda 3'te görev durur) ve görev sohbetine bu satır düşer. */
// 11 Kas (iş izi işi, bulgu 7): görev sohbetinde iç sınır sayısı (GOREV_AZAMI_ADIM) yazılmaz.
export const ADIM_YARIM_KALDI = 'Bu adım uzun sürdü, burada durdum; değişiklik bir sonraki adımda yeniden ele alınır.';
/** Düzeltme turu 2 (denetleyici kararı): tavanda kalan adımda geri dönüşsüz bir araç başarıyla çalıştıysa (gönderim, dosya silme, komut, onay kapısından
 *  geçen her çağrı; dongu.ts araciCalistir `geriDonussuz`) adım yeniden DENENMEZ — yinelenen gönderim olmasın. Adımın özeti ve görev sohbetindeki satır
 *  yapılanların kısa listesidir: araç adı ve hedefi. */
export const yarimKalanAdimMetni = (yapilanlar: readonly string[]): string => `Bu adım yarım kaldı; şunlar yapıldı: ${yapilanlar.join(', ')}.`;

/** Yapılan geri dönüşsüz işin kısa satırı: araç adı ve hedefi (gönderimde izindeki kişi ya da alıcı; dosyada dosya adı; komutta komutun başı). */
function yapilanSatiri(ad: string, g: Record<string, unknown>, alici?: string): string {
  const yol = typeof g.yol === 'string' ? g.yol.split(/[\\/]/).pop() : undefined;
  const hedef = alici ?? [g.kime, yol, g.adres, g.komut, g.baslik].find((x): x is string => typeof x === 'string' && Boolean(x.trim()));
  return hedef ? `${ad} (${satir(hedef, 60)})` : ad;
}

/** Süren adımların is_adim_bitti sonucu (sohbet kimliğine göre; araç buraya yazar, adım okur). */
const bekleyen = new Map<number, AdimSonucu | null>();

const satir = (d: unknown, n: number): string | undefined => {
  if (typeof d !== 'string') return undefined;
  const s = d.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, n) : undefined;
};

/** is_adim_bitti aracının işi: bu sohbette süren bir adım varsa sonucunu kaydeder (yoksa false). */
export function adimBittiKaydet(sohbetId: number, g: Record<string, unknown>): boolean {
  if (!bekleyen.has(sohbetId)) return false;
  const ozet = satir(g.ozet, 400);
  if (!ozet) return false;
  const sn = typeof g.sonraki_sn === 'number' && Number.isFinite(g.sonraki_sn) ? g.sonraki_sn : undefined;
  bekleyen.set(sohbetId, {
    ozet, ...(satir(g.bildir, 300) ? { bildir: satir(g.bildir, 300) } : {}), ...(sn !== undefined ? { sonrakiSn: sn } : {}),
    ...(g.bitti === true ? { bitti: true } : {}), ...(satir(g.sonuc, 600) ? { sonuc: satir(g.sonuc, 600) } : {}),
  });
  return true;
}

/** Adımın araçları: serbest olanlar (ekran ve tarayıcı araçları yalnız o izinle) + izinlerin alanındaki gönderim/kontrol araçları + is_adim_bitti.
 *  Görev başlatma/durdurma ve dış bağlantı (MCP) araçları adımda yok. */
function adimAraclari(liste: Arac[], is: IsKaydi): Arac[] {
  const secilen = liste.filter((a) => {
    if (a.grup === 'isler' || a.grup === 'mcp' || a.grup === 'temel-mcp') return false;
    if (a.grup === 'bilgisayar' || a.grup === 'tarayici') return izinAlaninda(is.plan, a.tanim.ad);
    return a.risk === 'serbest' || izinAlaninda(is.plan, a.tanim.ad);
  });
  const bitir = aracBul('is_adim_bitti');
  return bitir && bitir.grup === GOREV_ADIMI_GRUBU ? [...secilen, bitir] : secilen;
}

/** Bağlam bloğu (modele gider, kayda girmez). */
function adimBaglami(is: IsKaydi, bulgu: string | undefined, simdi: Date): string {
  const m = isPlaniMetni(is.plan, ayarlar().mod);
  const bitis = planlananBitis(is.plan, is.baslangic);
  const kalan = bitis ? Math.max(0, Math.round((Date.parse(bitis) - simdi.getTime()) / 1000)) : null;
  const { min, max } = is.plan.aralik;
  return [
    '# GÖREV (kullanıcının onayladığı, kendini aralıklarla uyandıran iş)',
    `Başlık: ${is.baslik}`,
    `Amaç: ${is.amac}`,
    `Ne: ${m.ne} Nasıl: ${m.nasil}`,
    `Bitiş: ${m.bitis}${kalan !== null ? ` (kalan ${sureMetni(kalan)})` : ''}`,
    `İzinler: ${m.izinler.length ? m.izinler.join('; ') : 'yok — kimseye yazma, ekranı kullanma'}. İzin dışındaki gönderim kullanıcıya sorulur.`,
    `Adım: ${is.adim + 1} / en çok ${is.plan.azamiAdim}.`,
    is.ozetler.length ? `Son adımlar:\n${is.ozetler.map((o, i) => `${i + 1}) ${o}`).join('\n')}` : 'Bu görevin ilk adımı.',
    bulgu ? `Gözcünün bulduğu değişiklik:\n${bulgu}` : '',
    `Adımı bitirirken is_adim_bitti çağır: ozet (tek cümle, ne yaptın/ne gördün); bildir (yalnız kullanıcının hemen bilmesi gereken bir şey varsa, tek kısa cümle); sonraki_sn (sonraki kontrol için önerin, ${min}-${max} sn); amaç tamamlandıysa bitti: true ve sonuc (tek cümle).`,
  ].filter(Boolean).join('\n');
}

/** Çağrının gideceği yer, izin denetimi için (modelin girdisinin üstüne yazılır): WhatsApp'ta `kime`nin gönderimle aynı kuralla çözülen jid'i
 *  (ad birden çok kişiye uyuyorsa boş); e-postada kime + cc + bcc'nin GÖNDERENİN ayrıştırıcısıyla çözülen bütün adresleri (son inceleme C1;
 *  izin verilemeyecek biçimde null — modelin yazdığı `epostaAlicilari` her durumda ezilir); tarayıcıda adres yoksa açık sayfanınki. */
function izinGirdisi(ad: string, g: Record<string, unknown>): Record<string, unknown> {
  if (ad === 'whatsapp_gonder') {
    const r = whatsappKisiCoz(typeof g.kime === 'string' ? g.kime : '');
    return { ...g, aliciJid: r.jid && r.adaylar.length === 1 ? r.jid : '' };
  }
  if (ad === 'eposta_gonder') return { ...g, epostaAlicilari: epostaAlicilari(g) };
  if (ad.startsWith('tarayici_') && typeof g.adres !== 'string') return { ...g, adres: acikSayfa() };
  return g;
}

/** İzinle yapılan gönderimin izi: WhatsApp'ta izindeki kişinin adı, e-postada gönderimin gittiği adres(ler) (`cozulen`: izin denetiminin
 *  çözdüğü alıcı — WhatsApp'ta jid, e-postada adres listesi). */
function gonderimIzi(is: IsKaydi, ad: string, g: Record<string, unknown>, cozulen: unknown, zaman: Date): Gonderim | null {
  if (ad === 'whatsapp_gonder') {
    const i = is.plan.izinler.find((x) => x.tur === 'whatsapp_gonder' && x.jid && typeof cozulen === 'string' && jidAyniMi(x.jid, cozulen));
    return { alici: i && i.tur === 'whatsapp_gonder' ? i.kisi : String(g.kime ?? ''), kanal: 'WhatsApp', zaman: zaman.toISOString() };
  }
  if (ad === 'eposta_gonder') {
    const alicilar = Array.isArray(cozulen) ? cozulen.filter((x): x is string => typeof x === 'string') : [g.kime, g.cc].filter((x): x is string => typeof x === 'string' && Boolean(x.trim()));
    return { alici: alicilar.join(', '), kanal: 'e-posta', zaman: zaman.toISOString() };
  }
  return null;
}

/** Bir yapay zekâ adımı. Başarısızsa null (zamanlayıcı saymaz, bildirmez; art arda 3'te görev durur); yapılamadıysa ERTELE. `sinyal`: zamanlayıcı
 *  adımı keserse (kullanıcı ekranı kullanmaya başladı) tur durdurulur ve ERTELE döner. */
export async function adimCalistir(is: IsKaydi, bulgu?: string, simdi: Date = new Date(), sinyal?: AbortSignal): Promise<AdimSonucu | null | typeof ERTELE> {
  const sohbetId = is.sohbetId;
  if (bekleyen.has(sohbetId)) return null; // aynı görevin önceki adımı sürüyor
  // Kullanıcı görev sohbetinde yazışıyor: adım yapılmaz, sonra denenir (sohbete "meşgul" hatası düşmez — yanitla çağrılmaz).
  if (mesgulMu(sohbetId) || sinyal?.aborted) return ERTELE;
  bekleyen.set(sohbetId, null);
  const izinliCagri = new WeakMap<object, unknown>(); // onaysız geçen çağrının girdisi → çözülen alıcı
  const gonderilen: Gonderim[] = [];
  let yarimKaldi = false;
  const yapilanlar: string[] = []; // bu denemede başarıyla çalışan geri dönüşsüz çağrılar (araç adı ve hedef)
  const kes = () => durdur(sohbetId);
  sinyal?.addEventListener('abort', kes, { once: true });
  try {
    const kanca: GorevAdimi = {
      baglam: adimBaglami(is, bulgu, simdi),
      baslik: is.baslik,
      araclar: (liste) => adimAraclari(liste, is),
      izinli: (ad, g) => {
        const girdi = izinGirdisi(ad, g);
        const evet = izinVarMi(is.plan, ad, girdi);
        if (evet) izinliCagri.set(g, ad === 'eposta_gonder' ? girdi.epostaAlicilari : girdi.aliciJid);
        return evet;
      },
      bitti: () => bekleyen.get(sohbetId) != null,
      // Düzeltme turu 2 (N4): whatsapp_gonder'e ham `kime` değil, çözülen hesap gider (ad tek kişiye uyuyorsa); izin aynı hesaba bakar.
      girdiCoz: (ad, g) => {
        if (ad !== 'whatsapp_gonder' || typeof g.kime !== 'string') return g;
        const r = whatsappKisiCoz(g.kime);
        return r.jid && r.adaylar.length === 1 && r.jid !== g.kime ? { ...g, kime: r.jid } : g;
      },
      aracBitti: (ad, g, basarili, geriDonussuz) => {
        if (basarili && geriDonussuz) yapilanlar.push(yapilanSatiri(ad, g, gonderimIzi(is, ad, g, izinliCagri.get(g), new Date())?.alici || undefined));
        if (!basarili || !izinliCagri.has(g)) return;
        const iz = gonderimIzi(is, ad, g, izinliCagri.get(g), new Date());
        if (!iz) return;
        gonderilen.push(iz);
        try { gonderimEkle(is.id, iz); } catch (e) { console.warn('[görev] gönderim izi yazılamadı:', (e as Error).message); }
      },
      tavandaKaldi: () => { yarimKaldi = true; },
    };
    const son = await yanitla(sohbetId, { metin: ADIM_TALIMATI, gizliTetik: true, kaynak: 'proaktif', gorev: kanca });
    if (sinyal?.aborted) return ERTELE;
    if (!son) return null;
    // 0.14 T13 düzeltme turu 1: tavanda kalan adım "tamamlandı" sayılmaz (özeti "Bir adım tamamlandı." olmaz): görev sohbetinde "yarım kaldı" der.
    // Düzeltme turu 2: geri dönüşsüz bir iş yapıldıysa adım yeniden denenmez (null değil, sayılan adım; özeti yapılanların listesi) — yoksa null.
    if (yarimKaldi && bekleyen.get(sohbetId) == null) {
      const satirMetni = yapilanlar.length ? yarimKalanAdimMetni(yapilanlar) : ADIM_YARIM_KALDI;
      try {
        const m = mesajEkle(sohbetId, { rol: 'not', bloklar: [{ tur: 'metin', metin: satirMetni }], gizli: false });
        sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([m])[0] });
      } catch (e) { console.warn('[görev] yarım adım satırı yazılamadı:', (e as Error).message); }
      return yapilanlar.length ? { ozet: satir(satirMetni, 400) ?? satirMetni } : null;
    }
    const kayitli = bekleyen.get(sohbetId) ?? null;
    const metin = gorunenBloklarMetni(son.bloklar).trim();
    const sonuc: AdimSonucu = kayitli ?? { ozet: satir(metin, 400) ?? 'Bir adım tamamlandı.' };
    // G1: özet/bildirim/sonuç (araç girdisi; döngünün yankı bekçisi bunlara bakmaz) iç talimatı tekrar ediyorsa adım başarısız.
    if ([sonuc.ozet, sonuc.bildir, sonuc.sonuc].some((t) => t && icTalimatYankisiMi(t, ADIM_TALIMATI))) return null;
    // Model yalnız is_adim_bitti çağırdıysa görev sohbetinde görünen bir cümle yok: adımın özeti orada görünsün.
    if (!son.bloklar.some((b) => b.tur === 'metin' && b.metin.trim())) {
      const m = mesajEkle(sohbetId, { rol: 'assistant', bloklar: [{ tur: 'metin', metin: sonuc.ozet }], kaynak: 'proaktif' });
      sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([m])[0] });
    }
    return sonuc;
  } finally {
    sinyal?.removeEventListener('abort', kes);
    bekleyen.delete(sohbetId);
    // İzinle yapılan gönderimler adımın sonucundan bağımsız olarak görev sohbetinde görünür (yankıda tur kayıtları silinmiş olabilir).
    if (gonderilen.length) {
      try {
        const m = mesajEkle(sohbetId, { rol: 'not', bloklar: [{ tur: 'metin', metin: gonderilenlerMetni(gonderilen) }], gizli: false });
        sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([m])[0] });
      } catch (e) { console.warn('[görev] gönderim satırı yazılamadı:', (e as Error).message); }
    }
  }
}

/** Fuber Tarayıcı'da açık sayfanın adresi (yoksa boş). */
function acikSayfa(): string {
  try { return tarayiciSayfasi().adres ?? ''; } catch { return ''; }
}
