// ── Not tutucu ajan: ham dökümü madde madde nota çevirir (önemli / önemsiz), meseleleri ve kalıcı bilgileri ayıklar ──
// Token ekonomisi: döküm yalnız BİR KEZ (notlandırılırken) modele gider; sonrası hep bu kısa maddeler üzerinden yürür.
// Önemsizler de tutulur (eşlikçi "iki gün önce de çiğ köfte demiştin" diyebilsin) ama kısa süre: önemsiz 3, önemli 7 gün.
import { ayarlar } from '../ayarlar.js';
import { hafizaEkle, hafizaAra } from '../hafiza/depo.js';
import { notlanmamisSatirlar, satirlariNotlandir, maddeEkle, meseleler, meseleGetir, meseleGuncelle, meseleEkle } from './depo.js';
import { silinmeTarihi, meseleEslestir, benzerlik, gundenTarih, gunEkle } from './donem.js';
import { ajanJson, kullaniciHitabi, gunAdi, isYolu } from './model.js';
import { motorYokHatasi } from '../motor/secici.js';
import { yerelSicakMi } from '../motor/yerel.js';
import { sinyal } from '../beyin.js';
import type { DokumSatiri, Onem, HafizaTuru } from '../../shared/tipler.js';
import type { SabitYol } from '../../shared/tek-motor.js';

interface Cikti {
  maddeler?: { saat?: string; metin: string; onem: Onem; konu?: string; kisiler?: string[]; eglenceli?: boolean; satirlar?: number[] }[];
  meseleler?: { baslik: string; kisi?: string; hedef?: string; durum?: 'acik' | 'kapandi' | 'iptal'; ilgili?: number; ayrinti?: string }[];
  kalici?: { tur?: string; baslik: string; icerik: string }[];
}

const SISTEM = (hitap: string) => `Sen Fuber'in arka plan NOT TUTUCU ajanısın. Aşağıda ${hitap} ve çevresindekilerin gün içinde mikrofonun duyduğu konuşmaların OTOMATİK dökümü var (tanıma hataları ve başkalarının sesi olabilir).

Görevin: dökümü hatırlanabilir, KISA not maddelerine çevirmek.
- Her madde tek satır, en çok 160 karakter, geçmiş zaman, kim ne dedi/ne oldu: "Ali kira sözleşmesini cumartesi göndereceğini söyledi." Döküm hatalıysa anlamı belliyse düzelt; belli değilse o kısmı ALMA. Uydurma.
- onem "onemli": kararlar, planlar, randevular, verilen sözler, işler, para, tarih/saat, dosya ve eşya yerleri ("sözleşme masaüstündeki Ev klasöründe"), kişiler hakkında bilgi, cevapsız kalan sorular, kurallar/yasaklar ("bir daha çiğ köfte yemeyeceğiz").
- onem "onemsiz": gündelik sohbet, şakalar, yemek muhabbeti, ufak tefek — bunları da TUT (kısa); komikse eglenceli: true.
- Hiç alma: TV/müzik/reklam sesi, anlamsız kırıntılar, aynı şeyin tekrarı, selamlaşma.
- satirlar: maddenin dayandığı G numaraları.
- meseleler: tamamlanmamış işler ve bekleyen şeyler (biri bir şey yapacak/dönecek, bir soru cevap bekliyor). hedef varsa göreli günü ("cumartesi", "yarın") satırın tarihine göre YYYY-AA-GG'ye çevir. Döküm mevcut açık bir meseleyi kapatıyorsa ("Ali sözleşmeyi gönderdi") durum "kapandi" ve ilgili = o meselenin numarası.
- kalici: uzun süre hatırlanmaya değer kalıcı bilgi (tercih, karar, kişi bilgisi, kural) — günde en çok 3; yoksa boş.

JSON: {"maddeler":[{"saat":"14:05","metin":"…","onem":"onemli|onemsiz","konu":"kısa konu","kisiler":["Ali"],"eglenceli":false,"satirlar":[12,13]}],"meseleler":[{"baslik":"…","kisi":"…","hedef":"2026-10-24","durum":"acik|kapandi|iptal","ilgili":3,"ayrinti":"…"}],"kalici":[{"tur":"tercih|kural|kisi|bilgi|olay","baslik":"…","icerik":"…"}]}`;

const HAFIZA_TURU: Record<string, HafizaTuru> = { tercih: 'tercih', kural: 'kural', kisi: 'kisi', bilgi: 'bilgi', olay: 'olay', karar: 'olay' };
let suren: Promise<{ madde: number; mesele: number }> | null = null;

/**
 * Notlandırılmamış dökümü işler. Eklenen madde sayısını döner. Bir tur sürerken gelen çağrı onun BİTMESİNİ bekler ve
 * ardından kalanı işler (eskiden "0 madde" deyip dönüyordu: raporcu ve eşlikçi notlar yazılmadan çalışıyordu).
 */
export async function notTut(): Promise<{ madde: number; mesele: number }> {
  return sirayla(() => notTutTuru());
}

/** Aynı anda tek not tutma turu (Gizli bekleyenleri işleme de bu sıraya girer). */
async function sirayla(is: () => Promise<{ madde: number; mesele: number }>): Promise<{ madde: number; mesele: number }> {
  let onceki = { madde: 0, mesele: 0 };
  while (suren) onceki = await suren.catch(() => ({ madde: 0, mesele: 0 }));
  suren = is();
  try {
    const r = await suren;
    return { madde: r.madde + onceki.madde, mesele: r.mesele + onceki.mesele };
  } finally {
    suren = null;
  }
}

/** Bekleyen (notlanmamış) satır sayısı — işin bugünkü yolunda görünenler: bulut yolunda Gizli satırlar SAYILMAZ (düzeltme turu 3:
 *  takılı Gizli satırlar "15 satır birikti" ve "5 dk'dır bekliyor" tetiklerini bozmasın, "N satırı nota çeviriyor" yanıltmasın). */
export function bekleyenSatirlar(limit: number) {
  return notlanmamisSatirlar(limit, { gizliHaric: isYolu()?.gizliHaric ?? true });
}

/**
 * Gizli mod kapandı (düzeltme turu 3): bekleyen Gizli satırlar, yerel beyin HÂLÂ açıkken (soğuk açılış yok) yerelde notlanır — notları
 * kaybolmasın. Yerel beyin açık değilse dokunulmaz: bulut yolunda görünmez kalırlar (sayaçlara da girmez), Gizli mod bir daha açılınca
 * işlenir, açılmazsa saklama süresinde silinir. main.ts sunucuyu bu iş bitince kapatır.
 */
export async function gizliBekleyenleriNotla(): Promise<{ madde: number; mesele: number }> {
  if (!yerelSicakMi() || !notlanmamisSatirlar(1, { yalnizGizli: true }).length) return { madde: 0, mesele: 0 };
  return sirayla(async () => {
    let madde = 0, mesele = 0;
    for (;;) {
      const satirlar = notlanmamisSatirlar(140, { yalnizGizli: true });
      if (!satirlar.length) break;
      const gun = new Date(satirlar[0].zaman).toLocaleDateString('sv-SE');
      const parti = satirlar.filter((s) => new Date(s.zaman).toLocaleDateString('sv-SE') === gun);
      const r = await parcaIsle(gun, parti, { gizli: true, sabit: 'yerel', gizliHaric: false });
      madde += r.madde; mesele += r.mesele;
      satirlariNotlandir(parti.map((s) => s.id));
    }
    return { madde, mesele };
  });
}

/**
 * Görev 21 düzeltme turu 2 (Gizli mod): yol işin başında bir kez seçilir (model.ts isYolu). Bulut yolunda Gizli satırlar HİÇ okunmaz
 * (notlanmamış kalır; yerel beyin Gizli modda işler, işlenmezse saklama süresinde silinir) ve buluta giden "açık meseleler" listesinde
 * Gizli meseleler yoktur. Yerel yolda Gizli ve Gizli olmayan satırlar AYRI partilerde işlenir: Gizli partinin maddeleri/meseleleri Gizli
 * bölüme yazılır, dokunduğu mesele Gizli'ye geçer, kalıcı bilgi hafızaya YAZILMAZ (hafıza bulut bağlamına girer).
 */
async function notTutTuru(): Promise<{ madde: number; mesele: number }> {
  let madde = 0, mesele = 0;
  // Motor yoksa (Gizli modda yerel beyin hazır değil dahil) bekleyen herhangi bir satır varsa motorun asıl nedeni ("motor durdu")
  // fırlatılır — "yeni not yok" diye yutulmaz (Gizli satırlar da sayılır: düzeltme turu 3).
  const bulunan = isYolu();
  if (!bulunan && notlanmamisSatirlar(1).length) throw motorYokHatasi();
  const yol = bulunan ?? { sabit: undefined, gizliHaric: true };
  for (;;) {
    const satirlar = notlanmamisSatirlar(140, { gizliHaric: yol.gizliHaric });
    if (!satirlar.length) break;
    // Günler karışmasın: ilk satırın günüyle aynı gün olanları al (gün değişince sonraki tur). Gizli ve Gizli olmayan satırlar da
    // karışmaz: ilk satırla aynı türden ardışık satırlar.
    const gun = new Date(satirlar[0].zaman).toLocaleDateString('sv-SE');
    const gizli = Boolean(satirlar[0].gizli);
    const parti: DokumSatiri[] = [];
    for (const s of satirlar) {
      if (new Date(s.zaman).toLocaleDateString('sv-SE') !== gun || Boolean(s.gizli) !== gizli) break;
      parti.push(s);
    }
    const r = await parcaIsle(gun, parti, { gizli, sabit: yol.sabit, gizliHaric: yol.gizliHaric });
    madde += r.madde; mesele += r.mesele;
    satirlariNotlandir(parti.map((s) => s.id));
  }
  return { madde, mesele };
}

async function parcaIsle(gun: string, satirlar: DokumSatiri[], o: { gizli: boolean; sabit: SabitYol | undefined; gizliHaric: boolean }): Promise<{ madde: number; mesele: number }> {
  const g = ayarlar().gunKaydi;
  // Gizli olmayan parti Gizli meseleleri görmez (yerelde de: notları Gizli bilgiyle karışmasın).
  const gizliGorme = o.gizliHaric || !o.gizli;
  const acik = meseleler('acik', 40, { gizliHaric: gizliGorme });
  const kullanici = [
    `Tarih: ${gunAdi(gun)} (${gun})`,
    // Küçük (yerel) modeller göreli günü hesaplarken yanılıyor: önümüzdeki 7 gün hazır verilir, seçmesi yeter.
    `Önümüzdeki günler: ${Array.from({ length: 7 }, (_, i) => gunEkle(gun, i + 1)).map((t) => `${gunAdi(t)} ${t}`).join(' · ')}`,
    acik.length ? `Açık meseleler:\n${acik.map((m) => `#${m.id} ${m.baslik}${m.kisi ? ` (${m.kisi})` : ''}${m.hedef ? ` — hedef ${m.hedef}` : ''}`).join('\n')}` : 'Açık mesele yok.',
    '',
    'Döküm:',
    ...satirlar.map((s) => `[G-${s.id} ${new Date(s.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}] ${s.metin}`),
  ].join('\n');
  const { veri } = await ajanJson<Cikti>(SISTEM(kullaniciHitabi()), kullanici, 'gunkaydi:not', 3000, o.sabit);
  if (!veri) throw new Error('Not tutucu geçerli JSON döndürmedi');

  let madde = 0;
  for (const m of veri.maddeler ?? []) {
    if (!m?.metin?.trim()) continue;
    const onem: Onem = m.onem === 'onemli' ? 'onemli' : 'onemsiz';
    const zaman = (() => {
      const d = gundenTarih(gun);
      const [h, dk] = String(m.saat ?? '').split(':').map(Number);
      if (Number.isFinite(h)) d.setHours(h, Number.isFinite(dk) ? dk : 0);
      else { const ilk = satirlar.find((s) => m.satirlar?.includes(s.id)); return ilk?.zaman ?? satirlar[0].zaman; }
      return d.toISOString();
    })();
    maddeEkle({
      gun, zaman, metin: m.metin.trim().slice(0, 300), onem, konu: m.konu?.slice(0, 60), kisiler: (m.kisiler ?? []).slice(0, 6),
      eglenceli: Boolean(m.eglenceli), satirlar: (m.satirlar ?? []).map((x) => `G-${x}`).join(','),
      silinme: silinmeTarihi(gun, onem === 'onemli' ? g.saklama.onemli : g.saklama.onemsiz), ...(o.gizli ? { gizli: true } : {}),
    });
    madde++;
  }

  let mesele = 0;
  const kaynak = `G-${satirlar[0].id}…G-${satirlar[satirlar.length - 1].id}`;
  for (const x of veri.meseleler ?? []) {
    if (!x?.baslik) continue;
    const hedef = /^\d{4}-\d{2}-\d{2}$/.test(x.hedef ?? '') ? x.hedef : undefined;
    // Bulut partisi Gizli bir meseleye dokunamaz (model numarasını göremez; yine de süzülür).
    const ilgili = x.ilgili ? meseleGetir(x.ilgili) : null;
    const mevcut = (ilgili?.durum === 'acik' && !(gizliGorme && ilgili.gizli) ? ilgili : null) ?? meseleEslestir(x.baslik, x.kisi, meseleler('acik', 80, { gizliHaric: gizliGorme }));
    if (mevcut) {
      meseleGuncelle(mevcut.id, { durum: x.durum === 'kapandi' || x.durum === 'iptal' ? x.durum : undefined, hedef: hedef ?? undefined, ayrinti: x.ayrinti ?? undefined, kaynakEk: kaynak, ...(o.gizli ? { gizli: true } : {}) });
    } else if (x.durum !== 'kapandi' && x.durum !== 'iptal') {
      meseleEkle({ baslik: x.baslik.slice(0, 160), kisi: x.kisi?.slice(0, 60), ilkGun: gun, hedef, ayrinti: x.ayrinti?.slice(0, 300), kaynak, ...(o.gizli ? { gizli: true } : {}) });
      mesele++;
    }
  }

  if (g.hafizayaIsle && !o.gizli) {
    for (const k of (veri.kalici ?? []).slice(0, 3)) {
      if (!k?.baslik || !k.icerik) continue;
      const benzer = hafizaAra({ sorgu: k.baslik, limit: 3 }).some((h) => benzerlik(h.baslik, k.baslik) >= 0.8);
      if (benzer) continue;
      sinyal('not', 'hafiza', k.baslik.slice(0, 60));
      hafizaEkle({ tur: HAFIZA_TURU[k.tur ?? ''] ?? 'bilgi', baslik: k.baslik.slice(0, 120), icerik: k.icerik.slice(0, 600), etiketler: ['gün kaydı'], onem: 3, kaynak: `gunkaydi:${gun}`, olayTarihi: gun });
    }
  }
  return { madde, mesele };
}
