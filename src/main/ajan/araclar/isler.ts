// ── Görev araçları (0.11 G9; spec §8) ─────────────────────────────────────────────────────────────────────────────────────────────────
// is_baslat: yapay zekâ kullanıcının "şunu takip et", "3 dakika boyunca …", "Ahmet cevap verince …" isteğini bir plana çevirir; plan katı
// doğrulanır (shared/isler.ts isPlaniDogrula), kullanıcı TEK onay kartıyla başlatır (OnayIstegi tur 'gorev' + planın insan dili). is_listele,
// is_durdur: görevlere bakar / durdurur. is_adim_bitti: YALNIZ görev adımı turunda listede (ajan/dongu.ts GOREV_ADIMI_GRUBU; main/isler/adim.ts):
// adımın özeti, bildirimi, sonraki aralık önerisi ve "bitti". Gizli/yerel turda araç listesi zaten boş; görevler orada başlamaz.
import { aracKaydet, sema, metinKisalt, type Arac } from './kayit.js';
import { ayarlar } from '../../ayarlar.js';
import { isPlaniDogrula, isPlaniMetni, sureMetni, durmaMetni, type IsOzet } from '../../../shared/isler.js';
import { TERIM } from '../../../shared/terimler.js';
import { isBaslat, isDurdur, isListesi } from '../../isler/zamanlayici.js';
import { adimBittiKaydet } from '../../isler/adim.js';
import { planKisileriniCoz } from '../../isler/kisiler.js';
import { GOREV_ADIMI_GRUBU } from '../dongu.js';

const DURUM: Record<IsOzet['durum'], string> = { onay: 'onay bekliyor', suruyor: 'sürüyor', durdu: 'durdu', bitti: 'bitti', hata: 'durdu (sorun)' };
/** Durum + (durduysa) GERÇEK nedeni: "durdu — Gizli modda görevler çalışmaz; görev durdu." (son inceleme I1: 'gizli' / 'yerel' ayrı). */
const durumu = (k: IsOzet) => ((k.durum === 'durdu' || k.durum === 'hata') && k.durmaNedeni ? `${DURUM[k.durum]} — ${durmaMetni(k.durmaNedeni)}` : DURUM[k.durum]);

const PLAN_ACIKLAMASI = 'Plan nesnesi: {"gozcu":{"tur":"whatsapp|eposta|sayfa|ekran|saat","hedef":"kişi adı/numarası, e-posta göndereni/konusu ya da https adresi"},'
  + '"aralik":{"min":30,"max":300} (saniye; min ≥ 10, saat gözcüsünde ≥ 30; max ≤ 3600),'
  + '"bitis":{"tur":"sure","saniye":180} | {"tur":"zaman","iso":"…+03:00"} | {"tur":"kosul","aciklama":"Ahmet cevap verince","sigorta":3600} | {"tur":"elle","sigorta":86400} (en çok 24 saat),'
  + '"izinler":[{"tur":"whatsapp_gonder","kisi":"Ahmet Yılmaz"} | {"tur":"eposta_gonder","adres":"muhasebe@ornek.com"} (tek çıplak adres; her adres için ayrı izin) | {"tur":"ekran"} | {"tur":"tarayici","alan":"ornek.com"}],"azamiAdim":60}';

const araclar: Arac[] = [
  {
    // Düzeltme turu 1 (denetleyici kararı): görev yalnız bilgisayarın başında başlar — 24 saate dek gönderim/ekran izni açar.
    grup: 'isler', risk: 'onay', yalnizMasada: true,
    etiket: (g) => `${TERIM.gorev} hazırlıyor: ${metinKisalt(String(g.baslik ?? ''), 40)}`,
    tanim: {
      ad: 'is_baslat',
      aciklama: 'Süreli ya da sürekli bir GÖREV başlatır (kullanıcı onaylarsa): "şunu takip et", "3 dakika boyunca …", "X cevap verince söyle", "bu sayfa değişince haber ver". '
        + 'Fuber kendini aralıklarla uyandırır; gözcü (whatsapp/eposta/sayfa/ekran) değişiklik görmezse yapay zekâ ÇAĞRILMAZ, aralık uzar — takip işinde mutlaka gözcü seç; '
        + '"saat" yalnız gözcüsü olamayan işler içindir (her aralıkta yapay zekâ çalışır). Bir kişiye yazmak, ekranı ya da bir siteyi kullanmak gerekiyorsa izinlere DAR olarak ekle; '
        + `izin dışı gönderim her seferinde ayrıca sorulur. ${PLAN_ACIKLAMASI}`,
      sema: sema({
        baslik: { type: 'string', description: 'Kısa başlık (ör. "Ahmet’in yanıtını izle")' },
        amac: { type: 'string', description: 'Görevin ne yapacağı, kullanıcının sözleriyle (adımlarda yapay zekâ bunu okur)' },
        plan: {
          type: 'object', description: 'gozcu, aralik, bitis, izinler, azamiAdim',
          properties: {
            gozcu: { type: 'object', properties: { tur: { type: 'string', enum: ['whatsapp', 'eposta', 'sayfa', 'ekran', 'saat'] }, hedef: { type: 'string' } } },
            aralik: { type: 'object', properties: { min: { type: 'integer' }, max: { type: 'integer' } } },
            bitis: { type: 'object', properties: { tur: { type: 'string', enum: ['sure', 'zaman', 'kosul', 'elle'] }, saniye: { type: 'integer' }, iso: { type: 'string' }, aciklama: { type: 'string' }, sigorta: { type: 'integer' } } },
            izinler: { type: 'array', items: { type: 'object', properties: { tur: { type: 'string', enum: ['whatsapp_gonder', 'eposta_gonder', 'ekran', 'tarayici'] }, kisi: { type: 'string' }, adres: { type: 'string' }, alan: { type: 'string' } } } },
            azamiAdim: { type: 'integer' },
          },
        },
      }, ['baslik', 'amac', 'plan']),
    },
    async calistir(g, b) {
      if (b.uzak) return { icerik: 'Görev yalnız bilgisayarın başında başlatılır; kullanıcıya bilgisayardan istemesini söyle.', hata: true, ozet: 'yalnız bilgisayarda' };
      const d = isPlaniDogrula(g.plan);
      // Biçim de geri söylenir: bazı sağlayıcıların araç kataloğu açıklamanın yalnız başını gösterir (motor/fuber.ts), düzeltme ona dayanır.
      if ('hata' in d) return { icerik: `Plan geçersiz: ${d.hata}. Düzeltip yeniden çağır. ${PLAN_ACIKLAMASI}`, hata: true, ozet: 'plan geçersiz' };
      // Ö1: WhatsApp kişileri (izinler, gözcü hedefi) kartTAN ÖNCE somut hesaba çözülür; kart numaranın sonunu gösterir.
      const v = planKisileriniCoz(d.plan);
      if ('hata' in v) return { icerik: `Plan geçersiz: ${v.hata}.`, hata: true, ozet: 'kişi belirsiz' };
      const baslik = String(g.baslik).replace(/\s+/g, ' ').trim().slice(0, 80);
      const amac = String(g.amac).trim().slice(0, 1000);
      const m = isPlaniMetni(v.plan, ayarlar().mod);
      const gonderim = v.plan.izinler.some((i) => i.tur !== 'tarayici');
      const karar = await b.onay({
        tur: 'gorev', baslik: `${TERIM.gorev}: ${baslik}`, aciklama: amac,
        onizleme: [`Ne yapacak: ${m.ne}`, `Nasıl: ${m.nasil}`, `Ne zaman biter: ${m.bitis}`, `İzinler: ${m.izinler.length ? m.izinler.join(' · ') : 'yok (kimseye yazmaz, ekranı kullanmaz)'}`, m.sinir].join('\n'),
        tehlike: gonderim ? 'orta' : 'dusuk', gorev: { baslik, ...m },
      });
      if (karar === 'reddet') return { icerik: 'Kullanıcı görevi başlatmadı (reddedildi).', hata: true, ozet: 'reddedildi' };
      const r = isBaslat({ baslik, amac, plan: v.plan });
      if ('hata' in r) return { icerik: r.hata, hata: true, ozet: 'başlamadı' };
      return { icerik: `Görev #${r.is.id} başladı ("${r.is.baslik}"); kendi sohbetinde çalışır, sonucu ana sohbete yazılır. Kullanıcıya kısaca söyle.`, ozet: 'başladı' };
    },
  },
  {
    grup: GOREV_ADIMI_GRUBU, risk: 'serbest',
    etiket: () => 'Adımı kaydediyor',
    tanim: {
      ad: 'is_adim_bitti',
      aciklama: 'Görev adımını bitirir: ozet (tek cümle); bildir (yalnız kullanıcının hemen bilmesi gerekiyorsa, tek kısa cümle); sonraki_sn (sonraki kontrol için önerin); amaç tamamlandıysa bitti: true ve sonuc.',
      sema: sema({
        ozet: { type: 'string' }, bildir: { type: 'string' }, sonraki_sn: { type: 'integer' }, bitti: { type: 'boolean' }, sonuc: { type: 'string' },
      }, ['ozet']),
    },
    async calistir(g, b) {
      return adimBittiKaydet(b.sohbetId, g) ? { icerik: 'Adım kaydedildi.', ozet: 'kaydedildi' } : { icerik: 'Şu an süren bir görev adımı yok.', hata: true };
    },
  },
  {
    grup: 'isler', risk: 'serbest',
    etiket: () => 'Görevlere bakıyor',
    tanim: { ad: 'is_listele', aciklama: 'Görevleri (süren, duran, biten) durumuyla listeler: son kontrol, adım sayısı, son özet ya da sonuç.', sema: sema({}) },
    async calistir() {
      const l = isListesi().slice(0, 15);
      const sat = (k: IsOzet) => {
        const kalan = k.durum === 'suruyor' && k.bitisZamani ? ` · kalan ${sureMetni((Date.parse(k.bitisZamani) - Date.now()) / 1000)}` : '';
        return `#${k.id} ${k.baslik} — ${durumu(k)}${kalan} · ${k.kontrol} kontrol, ${k.adim} adım${k.sonuc ? ` · sonuç: ${k.sonuc}` : k.sonOzet ? ` · son: ${k.sonOzet}` : ''}`;
      };
      return { icerik: l.length ? l.map(sat).join('\n') : 'Görev yok.', ozet: `${l.length} görev` };
    },
  },
  {
    grup: 'isler', risk: 'serbest',
    etiket: (g) => `Görevi durduruyor #${g.id}`,
    tanim: { ad: 'is_durdur', aciklama: 'Süren bir görevi durdurur (kullanıcı isteyince).', sema: sema({ id: { type: 'integer' } }, ['id']) },
    async calistir(g) {
      const k = isDurdur(Number(g.id), 'kullanici');
      if (!k) return { icerik: `#${g.id} bulunamadı.`, hata: true };
      return { icerik: `#${k.id} ${k.baslik} → ${DURUM[k.durum]}.`, ozet: DURUM[k.durum] };
    },
  },
];

export function islerAraclariniKaydet(): void { aracKaydet(...araclar); }
