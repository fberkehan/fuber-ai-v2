// ── Temel araçlar: hafıza, hatırlatıcı, yapılacaklar/plan, öneri, kokpit, zaman ───────────────────────────────────
import { aracKaydet, sema, metinKisalt, type Arac } from './kayit.js';
import { hafizaAra, hafizaEkle, hafizaGuncelle, hafizaSil, hafizaGetir, mesajAra, belgeAra, atifEtiketi } from '../../hafiza/depo.js';
import { hatirlaticiEkle, hatirlaticilar, hatirlaticiGuncelle, gorevEkle, gorevler, gorevGuncelle, bugunTamamlananlar, oneriEkle } from '../../planlama.js';
import { ozelKartYaz, ozelKartSil, kokpitYenile } from '../../kokpit/duzen.js';
import { yerelGun } from '../../vt.js';
import type { HafizaTuru } from '../../../shared/tipler.js';
import { kaynakEtiketi, kullaniciKaynakliMi } from '../../../shared/hafiza-kaynak.js';
import { fuberHafizaSilmesi } from '../../silme-kuyrugu.js';

const TURLER: HafizaTuru[] = ['kullanici', 'proje', 'tercih', 'kisi', 'olay', 'bilgi', 'kural', 'gorev'];
const yerel = (iso: string) => new Date(iso).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

const hafiza: Arac[] = [
  {
    grup: 'hafiza', risk: 'serbest',
    etiket: (g) => `Hafızada arıyor: “${metinKisalt(String(g.sorgu ?? ''), 50)}”`,
    tanim: {
      ad: 'hafiza_ara',
      aciklama: 'Kalıcı hafızada, geçmiş konuşmalarda ve içe aktarılmış belgelerde arar. Anahtar kelime, tür ve tarih aralığıyla süz. Bağlamda olmayan geçmiş bilgi için ÖNCE bunu kullan.',
      sema: sema({
        sorgu: { type: 'string', description: 'Anahtar kelimeler (ör. "ACME fiyat kararı")' },
        tur: { type: 'string', enum: TURLER, description: 'İsteğe bağlı tür süzgeci' },
        baslangic: { type: 'string', description: 'ISO tarih (dahil)' },
        bitis: { type: 'string', description: 'ISO tarih (hariç)' },
        kapsam: { type: 'string', enum: ['hepsi', 'hafiza', 'konusmalar', 'belgeler'] },
        limit: { type: 'integer' },
      }, ['sorgu']),
    },
    async calistir(g) {
      const kapsam = String(g.kapsam ?? 'hepsi');
      const satirlar: string[] = [];
      if (kapsam === 'hepsi' || kapsam === 'hafiza') {
        for (const h of hafizaAra({ sorgu: String(g.sorgu), tur: g.tur as string | undefined, baslangic: g.baslangic as string | undefined, bitis: g.bitis as string | undefined, limit: Number(g.limit ?? 10), dokun: true }))
          satirlar.push(`[${atifEtiketi(h)}] (${h.tur}${h.sabit ? ', çekirdek' : ''}; ${kaynakEtiketi(h.kaynak)}) ${h.baslik}: ${h.icerik}`);
      }
      if (kapsam === 'hepsi' || kapsam === 'konusmalar') {
        for (const m of mesajAra(String(g.sorgu), 6)) satirlar.push(`[M-${m.id} · ${yerelGun(m.zaman)} · ${m.rol === 'user' ? 'kullanıcı' : 'Fuber'}] ${metinKisalt(m.metin, 500)}`);
      }
      if (kapsam === 'hepsi' || kapsam === 'belgeler') {
        for (const p of belgeAra(String(g.sorgu), 5)) satirlar.push(`[D-${p.belgeId} · ${p.ad}] ${metinKisalt(p.metin, 600)}`);
      }
      return { icerik: satirlar.length ? satirlar.join('\n') : 'Sonuç yok. Farklı anahtar kelimelerle ya da tarih aralığı vermeden tekrar dene.', ozet: `${satirlar.length} sonuç` };
    },
  },
  {
    grup: 'hafiza', risk: 'serbest',
    etiket: (g) => `Hafızaya kaydediyor: ${metinKisalt(String(g.baslik ?? ''), 50)}`,
    tanim: {
      ad: 'hafiza_kaydet',
      aciklama: 'Kalıcı değeri olan bir bilgiyi hafızaya kaydeder (kişi, proje, karar, tercih, tarih, kural). Aynı konuda kayıt varsa hafiza_guncelle kullan. sabit:true = her zaman hatırlanacak çekirdek bilgi (az ve öz). Sır (parola/anahtar) YAZMA.',
      sema: sema({
        tur: { type: 'string', enum: TURLER },
        baslik: { type: 'string', description: 'Kısa başlık (ör. "ACME fiyatları")' },
        icerik: { type: 'string', description: 'Tek başına anlaşılır, tarihli, net bilgi' },
        etiketler: { type: 'array', items: { type: 'string' } },
        onem: { type: 'integer', description: '1-5' },
        sabit: { type: 'boolean' },
        olay_tarihi: { type: 'string', description: 'Olayın tarihi (ISO), varsa' },
      }, ['tur', 'baslik', 'icerik']),
    },
    async calistir(g, b) {
      const h = hafizaEkle({ tur: g.tur as HafizaTuru, baslik: String(g.baslik), icerik: String(g.icerik), etiketler: (g.etiketler as string[]) ?? [], onem: Number(g.onem ?? 3), sabit: Boolean(g.sabit), kaynak: `sohbet:${b.sohbetId}`, olayTarihi: g.olay_tarihi as string | undefined });
      return { icerik: `Kaydedildi: [H-${h.id}]`, ozet: `H-${h.id} kaydedildi` };
    },
  },
  {
    grup: 'hafiza', risk: 'serbest',
    etiket: (g) => `Hafızayı güncelliyor: H-${g.id}`,
    tanim: {
      ad: 'hafiza_guncelle',
      aciklama: 'Var olan hafıza kaydını günceller (yeni bilgi eskisinin yerini alıyorsa ya da tamamlıyorsa). Yalnız değişen alanları ver. Kaynağı "kurulum", "sen söyledin" ya da "ayarlardan" olan kayıt için kullanıcıya onay sorulur.',
      sema: sema({ id: { type: 'integer' }, baslik: { type: 'string' }, icerik: { type: 'string' }, etiketler: { type: 'array', items: { type: 'string' } }, onem: { type: 'integer' }, sabit: { type: 'boolean' }, tur: { type: 'string', enum: TURLER } }, ['id']),
    },
    async calistir(g, b) {
      const id = Number(g.id);
      const eski = hafizaGetir(id);
      if (!eski) return { icerik: `H-${g.id} bulunamadı`, hata: true };
      // Düzeltme turu 2 (hafiza_sil ile tutarlı): kullanıcıdan gelen kayıt (kurulum, Hafıza'da elle, Ayarlar'daki ad) yalnız ONAYLA değişir.
      if (kullaniciKaynakliMi(eski.kaynak)) {
        const yeniBaslik = typeof g.baslik === 'string' ? g.baslik : eski.baslik, yeniIcerik = typeof g.icerik === 'string' ? g.icerik : eski.icerik;
        const k = await b.onay({
          baslik: 'Bu hafıza kaydı değişsin mi?',
          aciklama: `Bu kaydı sen verdin (${kaynakEtiketi(eski.kaynak)}). Fuber onu güncellemek istiyor.`,
          onizleme: `Şimdi: ${eski.baslik}: ${eski.icerik}\nYeni: ${yeniBaslik}: ${yeniIcerik}`.slice(0, 900), tehlike: 'orta',
        });
        if (k === 'reddet') return { icerik: `Kullanıcı onay vermedi (reddedildi): [H-${id}] değişmedi.`, hata: true };
      }
      const h = hafizaGuncelle(id, { baslik: g.baslik as string, icerik: g.icerik as string, etiketler: g.etiketler as string[], onem: g.onem as number, sabit: g.sabit as boolean, tur: g.tur as HafizaTuru, kaynak: `sohbet:${b.sohbetId}` });
      return h ? { icerik: `Güncellendi: [H-${h.id}] ${h.baslik}`, ozet: 'güncellendi' } : { icerik: `H-${g.id} bulunamadı`, hata: true };
    },
  },
  {
    // I6 (son inceleme): model doğru bir hafızayı sessizce silmişti. Artık (1) kullanıcıdan gelen kayıt (kurulum, Hafıza'da elle eklenen,
    // Ayarlar'daki ad; shared/hafiza-kaynak.ts) yalnız ONAYLA silinir (kişilik: "silme önce sor" ile tutarlı); (2) silme hemen
    // uygulanmaz: masaüstünde "Fuber bir hafızayı sildi · Geri al" tostu çıkar (mevcut geri alınabilir silme kuyruğu, Ctrl+Z da);
    // süre dolunca ya da çıkışta uygulanır. Kuyruk yoksa (ipc kurulmadı) doğrudan silinir.
    grup: 'hafiza', risk: 'serbest',
    etiket: (g) => `Hafızadan siliyor: H-${g.id}`,
    tanim: { ad: 'hafiza_sil', aciklama: 'Yanlış ya da geçersizleşmiş bir hafıza kaydını siler (kullanıcı unutmanı isterse). Kaynağı "kurulum", "sen söyledin" ya da "ayarlardan" olan kayıt için kullanıcıya onay sorulur.', sema: sema({ id: { type: 'integer' } }, ['id']) },
    async calistir(g, b) {
      const id = Number(g.id);
      const h = hafizaGetir(id);
      if (!h) return { icerik: 'Kayıt yok', hata: true };
      // Düzeltme turu 2: telefondan ya da kendiliğinden (proaktif) başlayan turda masaüstündeki "Geri al" tostu görülmeyebilir —
      // silme o zaman da ONAYLA (onay kartı telefona bildirim olarak da gider; reddedilirse hiçbir şey silinmez). Onaydan sonra silme yine
      // masaüstünün geri al kuyruğundan geçer.
      const uzakta = Boolean(b.uzak || b.proaktif);
      if (kullaniciKaynakliMi(h.kaynak) || uzakta) {
        const k = await b.onay({
          baslik: 'Bu hafıza kaydı silinsin mi?',
          aciklama: kullaniciKaynakliMi(h.kaynak)
            ? `Bu kaydı sen verdin (${kaynakEtiketi(h.kaynak)}). Fuber onu yanlış ya da eskimiş sanıyor.`
            : `Fuber bu kaydı (${kaynakEtiketi(h.kaynak)}) yanlış ya da eskimiş sanıyor. ${b.uzak ? 'Telefondan' : 'Kendiliğinden'} başlayan bir işte silme için onayın gerekir.`,
          onizleme: `${h.baslik}: ${h.icerik}`.slice(0, 600), tehlike: 'orta',
        });
        if (k === 'reddet') return { icerik: `Kullanıcı onay vermedi (reddedildi): [H-${id}] silinmedi.`, hata: true };
      }
      if (fuberHafizaSilmesi(id, h.baslik)) return { icerik: `Silindi: ${h.baslik} (kullanıcı birkaç saniye içinde "Geri al" diyebilir).`, ozet: 'silindi' };
      return hafizaSil(id) ? { icerik: `Silindi: ${h.baslik}`, ozet: 'silindi' } : { icerik: 'Kayıt yok', hata: true };
    },
  },
];

const plan: Arac[] = [
  {
    grup: 'plan', risk: 'serbest',
    etiket: (g) => `Hatırlatıcı kuruyor: ${metinKisalt(String(g.baslik ?? ''), 40)} · ${g.zaman ? yerel(String(g.zaman)) : ''}`,
    tanim: {
      ad: 'hatirlatici_kur',
      aciklama: 'Hatırlatıcı kurar; zamanı gelince masaüstü bildirimi + kokpitte sol üstte kart + istenirse sesli uyarı. Zamanı bağlamdaki şimdiki zamana göre KESİN ISO (saat dilimiyle) ver. Toplantı için genelde 15 dk önceye ikinci bir hatırlatıcı da kur.',
      sema: sema({
        baslik: { type: 'string' },
        zaman: { type: 'string', description: 'ISO 8601, saat dilimli (ör. 2026-10-20T09:00:00+03:00)' },
        aciklama: { type: 'string' },
        tekrar: { type: 'string', enum: ['yok', 'gunluk', 'hafta_ici', 'haftalik', 'aylik'] },
        onem: { type: 'integer', description: '1-5' },
      }, ['baslik', 'zaman']),
    },
    async calistir(g, b) {
      const h = hatirlaticiEkle({ baslik: String(g.baslik), zaman: String(g.zaman), aciklama: g.aciklama as string, tekrar: g.tekrar as string, onem: g.onem as number, kaynak: `sohbet:${b.sohbetId}` });
      void kokpitYenile('yeni hatırlatıcı', true);
      return { icerik: `Kuruldu #${h.id}: ${h.baslik} — ${yerel(h.zaman)}${h.tekrar !== 'yok' ? ` (${h.tekrar})` : ''}`, ozet: yerel(h.zaman) };
    },
  },
  {
    grup: 'plan', risk: 'serbest',
    etiket: () => 'Hatırlatıcılara bakıyor',
    tanim: { ad: 'hatirlatici_listele', aciklama: 'Bekleyen hatırlatıcıları (ve son 12 saatte bildirilmiş olanları "[bildirildi]" işaretiyle) listeler; yaklaşanlar önce.', sema: sema({ saat: { type: 'integer', description: 'Önümüzdeki kaç saat (boş = hepsi); en çok 1 saat geriye bakar' } }) },
    async calistir(g) {
      const l = hatirlaticilar({ sonraki: g.saat ? Number(g.saat) : undefined });
      return { icerik: l.length ? l.map((h) => `#${h.id} ${yerel(h.zaman)} — ${h.baslik}${h.tekrar !== 'yok' ? ` (${h.tekrar})` : ''}${h.durum === 'gonderildi' ? ' [bildirildi]' : ''}`).join('\n') : 'Bekleyen hatırlatıcı yok.', ozet: `${l.length} hatırlatıcı` };
    },
  },
  {
    grup: 'plan', risk: 'serbest',
    etiket: (g) => `Hatırlatıcıyı güncelliyor #${g.id}`,
    tanim: { ad: 'hatirlatici_guncelle', aciklama: 'Hatırlatıcıyı erteler (yeni zaman), tamamlar ya da iptal eder. Tekrarlayanda "tamam" yalnız bu seferi geçer (sonraki zamana kurulur); seriyi bitirmek için "iptal".', sema: sema({ id: { type: 'integer' }, durum: { type: 'string', enum: ['tamam', 'iptal', 'bekliyor'] }, zaman: { type: 'string' }, baslik: { type: 'string' } }, ['id']) },
    async calistir(g) {
      const h = hatirlaticiGuncelle(Number(g.id), { durum: g.durum as string, zaman: g.zaman as string, baslik: g.baslik as string });
      return h ? { icerik: `#${h.id} → ${h.durum}, ${yerel(h.zaman)}`, ozet: h.durum } : { icerik: 'Bulunamadı', hata: true };
    },
  },
  {
    grup: 'plan', risk: 'serbest',
    etiket: (g) => `Yapılacaklara ekliyor: ${metinKisalt(String(g.baslik ?? ''), 50)}`,
    tanim: { ad: 'gorev_ekle', aciklama: 'Yapılacak işi/planı kaydeder (kokpitteki Yapılacaklar kartında görünür).', sema: sema({ baslik: { type: 'string' }, aciklama: { type: 'string' }, son_tarih: { type: 'string' }, proje: { type: 'string' }, oncelik: { type: 'integer', description: '1-5' } }, ['baslik']) },
    async calistir(g) {
      const x = gorevEkle({ baslik: String(g.baslik), aciklama: g.aciklama as string, sonTarih: g.son_tarih as string, proje: g.proje as string, oncelik: g.oncelik as number });
      void kokpitYenile('yeni yapılacak', true);
      // Son inceleme küçük 5: "Görev" artık süreli görevlerdir (TERIM.gorev; is_* araçları) — yapılacak işin sonucu "görev" demez (TERIM.yapilacaklar).
      return { icerik: `Yapılacak iş #${x.id} Yapılacaklar’a eklendi (bu bir yapılacak iş kimliği; hafıza atıfı değil — [H-…] verme).`, ozet: `#${x.id}` };
    },
  },
  {
    grup: 'plan', risk: 'serbest',
    etiket: () => 'Yapılacaklara bakıyor',
    tanim: {
      ad: 'gorev_listele',
      aciklama: 'Açık yapılacakları ya da BUGÜN tamamlananları listeler (durum "tamam"; kokpitteki Yapılacaklar kartı). Önceki günlerin tamamlananları hafızadadır: günde bir "Tamamlananlar · <gün>" kaydı (hafiza_ara).',
      sema: sema({ durum: { type: 'string', enum: ['acik', 'tamam'] }, proje: { type: 'string' } }),
    },
    async calistir(g) {
      if (g.durum === 'tamam') {
        // Gizli açıkken tamamlananlar bulut yapay zekâya gitmez (hafızaya girmedikleri gibi).
        const t = bugunTamamlananlar(new Date(), { proje: g.proje as string | undefined, gizliHaric: true });
        return {
          icerik: t.length ? t.map((x) => `#${x.id} [${x.oncelik}] ${x.baslik}${x.proje ? ` · ${x.proje}` : ''}${x.tamamlanma ? ` · tamamlandı ${new Date(x.tamamlanma).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}`).join('\n') : 'Bugün tamamlanan yapılacak iş yok.',
          ozet: `${t.length} yapılacak iş`,
        };
      }
      const l = gorevler({ durum: g.durum as string, proje: g.proje as string });
      return { icerik: l.length ? l.map((x) => `#${x.id} [${x.oncelik}] ${x.baslik}${x.proje ? ` · ${x.proje}` : ''}${x.sonTarih ? ` · son ${yerel(x.sonTarih)}` : ''}`).join('\n') : 'Yapılacak iş yok.', ozet: `${l.length} yapılacak iş` };
    },
  },
  {
    grup: 'plan', risk: 'serbest',
    etiket: () => 'Yapılacak işi güncelliyor',
    tanim: { ad: 'gorev_guncelle', aciklama: 'Yapılacak işi tamamlar ya da düzenler. Tamamlanan iş kokpitteki Yapılacaklar kartında o gün üstü çizili kalır, ertesi gün hafızaya geçer; yeniden açmak (durum "acik") yalnız tamamlandığı gün mümkündür.', sema: sema({ id: { type: 'integer' }, durum: { type: 'string', enum: ['acik', 'tamam'] }, baslik: { type: 'string' }, aciklama: { type: 'string' }, son_tarih: { type: 'string' }, oncelik: { type: 'integer' } }, ['id']) },
    async calistir(g) {
      const x = gorevGuncelle(Number(g.id), { durum: g.durum as string, baslik: g.baslik as string, aciklama: g.aciklama as string, sonTarih: g.son_tarih as string, oncelik: g.oncelik as number });
      void kokpitYenile('yapılacak güncellendi', true);
      if (x && g.durum === 'acik' && x.durum !== 'acik') return { icerik: `#${x.id} geçmiş bir günde tamamlandı ve hafızaya geçti; yeniden açılamaz. Gerekirse yeni bir yapılacak iş ekle.`, hata: true };
      return x ? { icerik: `#${x.id} → ${x.durum}`, ozet: x.durum } : { icerik: 'Bulunamadı', hata: true };
    },
  },
  {
    grup: 'plan', risk: 'serbest',
    etiket: (g) => `Kokpite ${g.tur === 'dikkat' ? 'uyarı' : 'öneri'} ekliyor`,
    tanim: { ad: 'oneri_ekle', aciklama: 'Kokpite bir öneri ya da "dikkat" notu ekler (yaklaşan risk, unutulan iş, fırsat).', sema: sema({ tur: { type: 'string', enum: ['oneri', 'dikkat', 'soru'] }, baslik: { type: 'string' }, icerik: { type: 'string' }, gecerlilik_saat: { type: 'integer' } }, ['tur', 'baslik']) },
    async calistir(g) {
      const o = oneriEkle({ tur: g.tur as 'oneri', baslik: String(g.baslik), icerik: g.icerik as string, gecerlilikSaat: g.gecerlilik_saat as number });
      void kokpitYenile('yeni öneri', true);
      return { icerik: `Eklendi #${o.id}`, ozet: 'eklendi' };
    },
  },
];

const kokpit: Arac[] = [
  {
    grup: 'kokpit', risk: 'serbest',
    etiket: (g) => `Kokpite kart koyuyor: ${metinKisalt(String(g.baslik ?? ''), 40)}`,
    tanim: {
      ad: 'kokpit_kart',
      aciklama: 'Kokpite (ana ekran) özel bir kart koyar ya da günceller: not, liste ya da metrikler. Aynı id ile çağırırsan günceller. Geçici kartlar için saat ver.',
      sema: sema({
        id: { type: 'string', description: 'Kalıcı kimlik (ör. "proje-durum")' },
        baslik: { type: 'string' },
        icerik: { type: 'string', description: 'Kısa markdown' },
        liste: { type: 'array', items: { type: 'string' } },
        metrikler: { type: 'array', items: { type: 'object', properties: { ad: { type: 'string' }, deger: { type: 'string' } } } },
        oncelik: { type: 'integer', description: '1-5 (5 = en üstte)' },
        saat: { type: 'integer', description: 'Kaç saat kalsın (boş = kalıcı)' },
      }, ['id', 'baslik']),
    },
    async calistir(g) {
      ozelKartYaz({ id: String(g.id), baslik: String(g.baslik), icerik: g.icerik as string, liste: g.liste as string[], metrikler: g.metrikler as { ad: string; deger: string }[], oncelik: Number(g.oncelik ?? 3), saat: g.saat as number | undefined });
      void kokpitYenile('özel kart', true);
      return { icerik: 'Kart kokpitte.', ozet: 'kokpitte' };
    },
  },
  {
    grup: 'kokpit', risk: 'serbest',
    etiket: (g) => `Kokpitten kart kaldırıyor: ${g.id}`,
    tanim: { ad: 'kokpit_kart_kaldir', aciklama: 'Özel kartı kokpitten kaldırır.', sema: sema({ id: { type: 'string' } }, ['id']) },
    async calistir(g) { ozelKartSil(String(g.id)); void kokpitYenile('kart kaldırıldı', true); return { icerik: 'Kaldırıldı', ozet: 'kaldırıldı' }; },
  },
  {
    grup: 'kokpit', risk: 'serbest',
    etiket: () => 'Kokpit yerleşimini ayarlıyor',
    tanim: {
      ad: 'kokpit_duzen',
      aciklama: 'Kullanıcının kokpit yerleşim isteğini KALICI tercih olarak kaydeder ve kokpiti hemen yeniden düzenler (ör. "hatırlatıcılar hep sol üstte", "e-postaları küçült").',
      sema: sema({ tercih: { type: 'string' } }, ['tercih']),
    },
    async calistir(g, b) {
      hafizaEkle({ tur: 'tercih', baslik: 'Kokpit yerleşimi', icerik: String(g.tercih), etiketler: ['kokpit', 'yerlesim'], onem: 4, kaynak: `sohbet:${b.sohbetId}` });
      await kokpitYenile(`kullanıcı tercihi: ${g.tercih}`, true);
      return { icerik: 'Tercih kaydedildi, kokpit yeniden düzenlendi.', ozet: 'düzenlendi' };
    },
  },
];

const zaman: Arac = {
  grup: 'plan', risk: 'serbest',
  etiket: () => 'Saate bakıyor',
  tanim: { ad: 'zaman', aciklama: 'Şimdiki yerel tarih/saat ve saat dilimi.', sema: sema({}) },
  async calistir() {
    const d = new Date();
    return { icerik: `${d.toLocaleString('tr-TR', { dateStyle: 'full', timeStyle: 'medium' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone}, UTC${-d.getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-d.getTimezoneOffset() / 60}) · ISO ${d.toISOString()}` };
  },
};

export function temelAraclariKaydet(): void {
  aracKaydet(...hafiza, ...plan, ...kokpit, zaman);
}
