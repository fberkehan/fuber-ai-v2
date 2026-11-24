// ── Gün kaydı araçları (düşünme motoru): Fuber sohbette kendi notlarına bakabilsin ───────────────────────────────
// "Bu dosya neredeydi?", "Ali'ye ne sormuştum, hallolmuş muydu?", "Bugün neler konuştuk?", "Haftalık rapor".
// Atıf biçimi: [N-12 · 19 Eki 14:05] (not maddesi), [G-345 · …] (ham döküm satırı), [R-3 · günlük 2026-10-19].
import { aracKaydet, sema, metinKisalt, type Arac } from './kayit.js';
import { ayarlar, ayarlariKaydet } from '../../ayarlar.js';
import { maddeAra, maddeler, dokumAra, raporAra, raporGetir, raporlar, meseleler, meseleGetir, meseleGuncelle } from '../../gunkaydi/depo.js';
import { raporCalistir, dusunmeDurumu } from '../../gunkaydi/dusunme.js';
import { mevcutDonem } from '../../gunkaydi/raporcu.js';
import type { RaporTuru, Rapor } from '../../../shared/tipler.js';

const kisaZaman = (iso: string) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const raporMetni = (r: Rapor) => [
  `[R-${r.id} · ${r.tur} ${r.donem}] ${r.baslik}`, r.ozet,
  r.onemli.length ? `Önemli:\n${r.onemli.map((x) => `- ${x.metin}`).join('\n')}` : '',
  r.onemsiz.length ? `Önemsiz:\n${r.onemsiz.map((x) => `- ${x.metin}`).join('\n')}` : '',
  r.kararlar.length ? `Kararlar: ${r.kararlar.join(' | ')}` : '',
  r.acikMeseleler.length ? `Açık: ${r.acikMeseleler.join(' | ')}` : '',
  r.ileriye.length ? `İleriye: ${r.ileriye.join(' | ')}` : '',
  r.espri ? `Espri: ${r.espri}` : '',
].filter(Boolean).join('\n');

// Görev 21 düzeltme turu 2: bu araçlar yalnız BULUT turunda var (Gizli modda araç yok) — Gizli mod kayıtları hiç dönmez.
const BULUT = { gizliHaric: true } as const;

const araclar: Arac[] = [
  {
    grup: 'hafiza', risk: 'serbest',
    etiket: (g) => `Gün kaydında arıyor: “${metinKisalt(String(g.sorgu ?? ''), 50)}”`,
    tanim: {
      ad: 'gun_kaydi_ara',
      aciklama: 'Gün boyu dinlenen konuşmaların notlarında (önemli/önemsiz maddeler), raporlarında ve gerekirse ham dökümünde arar. "Şu dosya neredeydi", "X\'e ne demiştim", "geçen gün ne konuştuk" gibi sorularda ÖNCE bunu kullan. Atıfları aynen ver.',
      sema: sema({ sorgu: { type: 'string', description: 'Anahtar kelimeler (ör. "kira sözleşmesi Ali")' }, dokum: { type: 'boolean', description: 'Ham dökümde de ara (notlarda yoksa)' } }, ['sorgu']),
    },
    async calistir(g) {
      const sorgu = String(g.sorgu);
      const satirlar: string[] = [];
      for (const m of maddeAra(sorgu, 12, BULUT)) satirlar.push(`[N-${m.id} · ${kisaZaman(m.zaman)} · ${m.onem}] ${m.metin}`);
      for (const r of raporAra(sorgu, 3, BULUT)) satirlar.push(`[R-${r.id} · ${r.tur} ${r.donem}] ${r.baslik}: ${metinKisalt(r.ozet, 300)}`);
      if (g.dokum || satirlar.length < 3) for (const s of dokumAra(sorgu, 8, BULUT)) satirlar.push(`[G-${s.id} · ${kisaZaman(s.zaman)} · döküm] ${metinKisalt(s.metin, 300)}`);
      const d = dusunmeDurumu();
      if (!satirlar.length) return { icerik: d.etkin ? 'Gün kaydında eşleşen bir şey yok.' : 'Gün kaydı (sürekli dinleme) kapalı; bu konuda not yok.', ozet: '0 sonuç' };
      return { icerik: satirlar.join('\n'), ozet: `${satirlar.length} sonuç` };
    },
  },
  {
    grup: 'hafiza', risk: 'serbest',
    etiket: (g) => `Gün notlarına bakıyor${g.gun ? `: ${g.gun}` : ''}`,
    tanim: {
      ad: 'gun_notlari',
      aciklama: 'Bir günün not maddelerini (önemli ve önemsiz, saatleriyle) listeler. Varsayılan bugün. "Bugün neler konuştuk / planım var mı" için.',
      sema: sema({ gun: { type: 'string', description: 'YYYY-AA-GG (boş = bugün)' }, onem: { type: 'string', enum: ['onemli', 'onemsiz'] } }),
    },
    async calistir(g) {
      const gun = /^\d{4}-\d{2}-\d{2}$/.test(String(g.gun ?? '')) ? String(g.gun) : new Date().toLocaleDateString('sv-SE');
      const l = maddeler({ gun, onem: g.onem as 'onemli' | 'onemsiz' | undefined, ...BULUT }).reverse();
      if (!l.length) return { icerik: `${gun} için not yok.`, ozet: '0 madde' };
      return { icerik: l.map((m) => `[N-${m.id} · ${new Date(m.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · ${m.onem}${m.eglenceli ? ' · komik' : ''}] ${m.metin}`).join('\n'), ozet: `${l.length} madde` };
    },
  },
  {
    grup: 'hafiza', risk: 'serbest',
    etiket: (g) => `${g.tur === 'haftalik' ? 'Haftalık' : g.tur === 'aylik' ? 'Aylık' : 'Günlük'} rapora bakıyor`,
    tanim: {
      ad: 'gun_raporu',
      aciklama: 'Günlük/haftalık/aylık raporu getirir; yoksa ve hazirla=true ise şimdi hazırlatır. donem: gün "2026-10-19", hafta "2026-W43", ay "2026-10" (boş = içinde bulunulan).',
      sema: sema({ tur: { type: 'string', enum: ['gunluk', 'haftalik', 'aylik'] }, donem: { type: 'string' }, hazirla: { type: 'boolean' } }, ['tur']),
    },
    async calistir(g) {
      const tur = String(g.tur) as RaporTuru;
      const donem = String(g.donem ?? '') || mevcutDonem(tur);
      let r = raporGetir(tur, donem, BULUT);
      if ((!r || g.hazirla) && g.hazirla !== false) { const y = await raporCalistir(tur, donem); r = (y && !y.gizli ? y : null) ?? r; }
      if (!r) {
        const son = raporlar({ tur, limit: 1, ...BULUT })[0];
        return { icerik: `${tur} ${donem} için rapor yok (yeterli not yok).${son ? `\nEn son ${tur} rapor:\n${raporMetni(son)}` : ''}`, ozet: 'yok' };
      }
      return { icerik: raporMetni(r), ozet: r.baslik };
    },
  },
  {
    grup: 'plan', risk: 'serbest',
    etiket: () => 'Takip edileceklere bakıyor', // 0.10 Görev 3 (P2): "Meseleler" → "Takip edilecekler"
    tanim: {
      ad: 'meseleler',
      aciklama: 'Konuşmalardan çıkan açık meseleleri (biri bir şey yapacak, cevap bekleniyor) ve hedef tarihlerini listeler; durum ile kapatılmışları da.',
      sema: sema({ durum: { type: 'string', enum: ['acik', 'kapandi', 'hepsi'] } }),
    },
    async calistir(g) {
      const l = meseleler((g.durum as 'acik' | 'kapandi' | 'hepsi') ?? 'acik', 40, BULUT);
      if (!l.length) return { icerik: 'Mesele yok.', ozet: '0' };
      return { icerik: l.map((m) => `#${m.id} [${m.durum}] ${m.baslik}${m.kisi ? ` — ${m.kisi}` : ''}${m.hedef ? ` · hedef ${m.hedef}` : ''} · ilk ${m.ilkGun}${m.ayrinti ? ` · ${m.ayrinti}` : ''}`).join('\n'), ozet: `${l.length} takip edilecek iş` };
    },
  },
  {
    grup: 'plan', risk: 'serbest',
    etiket: (g) => `Takip edilecek işi güncelliyor #${g.id}`,
    tanim: {
      ad: 'mesele_guncelle',
      aciklama: 'Bir meseleyi kapatır/iptal eder ya da hedef tarihini değiştirir (kullanıcı "o iş halloldu" dediğinde).',
      sema: sema({ id: { type: 'integer' }, durum: { type: 'string', enum: ['acik', 'kapandi', 'iptal'] }, hedef: { type: 'string', description: 'YYYY-AA-GG' } }, ['id']),
    },
    async calistir(g) {
      // Gizli mod meselesi bulut turundan görünmez ve değiştirilemez (numarasını tahmin etse de).
      if (meseleGetir(Number(g.id))?.gizli) return { icerik: 'Bulunamadı', hata: true };
      const m = meseleGuncelle(Number(g.id), { durum: g.durum as 'acik' | 'kapandi' | 'iptal' | undefined, hedef: g.hedef as string | undefined });
      return m ? { icerik: `#${m.id} → ${m.durum}${m.hedef ? `, hedef ${m.hedef}` : ''}`, ozet: m.durum } : { icerik: 'Bulunamadı', hata: true };
    },
  },
  {
    grup: 'hafiza', risk: 'serbest',
    etiket: (g) => (Number(g.dakika) > 0 ? `Dinlemeyi ${g.dakika} dk duraklatıyor` : 'Dinlemeyi sürdürüyor'),
    tanim: {
      ad: 'gun_kaydi_duraklat',
      aciklama: 'Sürekli dinlemeyi (gün kaydı) duraklatır ya da sürdürür. Kullanıcı "dinlemeyi durdur / özel konuşacağız / misafir var" derse kullan. dakika: 0 = sürdür.',
      sema: sema({ dakika: { type: 'integer', description: 'Kaç dakika (ör. 60); 0 = sürdür' } }, ['dakika']),
    },
    async calistir(g, b) {
      const dk = Math.max(0, Math.min(24 * 60, Number(g.dakika) || 0));
      ayarlariKaydet((a) => { a.gunKaydi.duraklatBitis = dk ? new Date(Date.now() + dk * 60_000).toISOString() : undefined; });
      const d = dusunmeDurumu();
      return { icerik: dk ? `Gün kaydı ${dk} dk duraklatıldı.` : `Gün kaydı sürüyor (${d.dinliyor ? 'dinliyor' : d.neden}).`, ozet: dk ? `${dk} dk` : 'sürüyor' };
    },
  },
];

export function gunKaydiAraclariniKaydet(): void { aracKaydet(...araclar); }
