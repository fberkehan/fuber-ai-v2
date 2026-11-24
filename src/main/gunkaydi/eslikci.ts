// ── Eşlikçi ajan: konuşmalara gerektiğinde ARAYA GİRER ───────────────────────────────────────────────────────────
// Örnek: kullanıcı arkadaşına "bugün çiğ köfte yesek mi" der; Fuber "hayır, iki gün önce bir daha yemeyeceğiz
// demiştin" diye hatırlatır. Çoğu zaman SUSAR. Kapılar (ucuzdan pahalıya):
//   1) hız: saatlik sınır, son araya girişten 3 dk geçmeli, sessiz saat değil, Fuber o an başka yanıt üzerinde değil;
//   2) ön eleme (modelsiz): son cümlenin anahtar kelimeleri notlarda / hafızada / açık meselelerde iz bırakıyor mu;
//      espri kipinde iz olmasa da ara sıra (20 dk'da bir) konuşma soru/ünlem içeriyorsa denenir;
//   3) model kararı: JSON {konus, tur, metin, guven}; eşik hatırlatmada 0,7, espride 0,82.
// Söylenen ses kulakta yankı yapmasın diye kulak konuşma boyunca bekler (asistan seslendirmesi zaten bildirir).
import { ayarlar } from '../ayarlar.js';
import { hafizaAra } from '../hafiza/depo.js';
import { anahtarKelimeler } from '../hafiza/normal.js';
import { anaSohbet, mesajEkle, gorunume } from '../sohbet.js';
import { sohbetOlayi, yayinla } from '../olaylar.js';
import { mesgulMu } from '../ajan/dongu.js';
import { sessizMi } from '../zamanlayici.js';
import { maddeAra, raporAra, meseleler, eslikEkle, eslikSayisi, sonEslikler } from './depo.js';
import { benzerlik } from './donem.js';
import { ajanJson, kullaniciHitabi, isYolu } from './model.js';
import type { DokumSatiri } from '../../shared/tipler.js';

interface Karar { konus?: boolean; tur?: 'hatirlatma' | 'espri' | 'bilgi'; metin?: string; guven?: number; kaynaklar?: string[] }

const SISTEM = (hitap: string, espri: boolean) => `Sen Fuber'sin: ${hitap} adlı kişinin kişisel yapay zekâsı. Şu an arka planda onun ve yanındakilerin konuşmasını dinliyorsun.
Çoğu zaman SUSARSIN (konus: false). Yalnız şu durumlarda çok kısa araya girersin:
1) Konuşulan şey notlardaki/hafızadaki bir şeyle çelişiyor ya da hatırlatma gerektiriyor. Örnek: "bugün çiğ köfte yesek mi?" ↔ iki gün önce "bir daha çiğ köfte yemeyeceğiz" denmiş → "Hayır! İki gün önce bir daha yemeyeceğiz demiştiniz, hatırlatırım 🙂".
2) Unutulmuş bir söz, açık mesele, randevu ya da dosya yeri doğrudan konuyla ilgili ("Ali'nin sözleşmesi cumartesi gelecekti").
${espri ? '3) Gerçekten yerinde, kibar ve çok kısa bir espri varsa (nadiren; kimseyi kırmadan).' : '3) Espri YAPMA.'}
Kurallar: Kesin değilsen konuşma. Notta olmayan bir şeyi biliyormuş gibi yapma. Dökümde kimin konuştuğu yazmaz: kişileri karıştırma, bir sözü belirli birine yükleme; emin değilsen "demiştiniz" gibi genel konuş ve ${hitap} adlı kişiye hitap et. Sağlık, para, ilişki gibi özel konuları başkalarının yanında açma. Söyleyeceğin şey sesli okunacak: 1-2 kısa cümle, doğal Türkçe (konuşma İngilizceyse İngilizce), zamanı doğal söyle ("iki gün önce", "salı günü"). Kendi önceki araya girişlerini tekrarlama.
JSON: {"konus":false} ya da {"konus":true,"tur":"hatirlatma|espri|bilgi","metin":"…","guven":0.0-1.0,"kaynaklar":["N-12"]}`;

let sonDeneme = 0;
let sonEspriDenemesi = 0;
let suruyor = false;
let sonIslenen = 0;

const gunOnce = (iso: string) => {
  const g = Math.round((new Date(new Date().toDateString()).getTime() - new Date(new Date(iso).toDateString()).getTime()) / 86_400_000);
  return g <= 0 ? 'bugün' : g === 1 ? 'dün' : `${g} gün önce`;
};

/** Yeni döküm satırlarından sonra çağrılır (motor 2,5 sn biriktirip çağırır). */
export async function eslikDegerlendir(tumSon: DokumSatiri[], teslim: (metin: string, tur: string) => void): Promise<'sus' | 'konustu' | 'atlandi'> {
  const g = ayarlar().gunKaydi;
  if (g.eslikci === 'kapali' || suruyor || !tumSon.length) return 'atlandi';
  // Gizli mod (Görev 21 düzeltme turu 2): yol başta seçilir. Bulut yolunda Gizli satırlar, notlar, raporlar, meseleler ve eşlikler HİÇ
  // okunmaz (az önce Gizli moddayken söylenenler dahil); yerel yolda hepsi okunur ve araya giriş, okunanlar Gizli ise Gizli kaydedilir.
  // Motor yoksa (önceki davranış) model çağrısı asıl nedeni fırlatır; bulut yolu varsayılır (Gizli kayıtlar okunmaz).
  const yol = isYolu() ?? { sabit: undefined, gizliHaric: true };
  const h = { gizliHaric: yol.gizliHaric };
  const son = h.gizliHaric ? tumSon.filter((s) => !s.gizli) : tumSon;
  const yeni = son.filter((s) => s.id > sonIslenen);
  sonIslenen = Math.max(sonIslenen, tumSon[tumSon.length - 1].id);
  if (!yeni.length) return 'atlandi';
  const simdi = Date.now();
  if (sessizMi() || mesgulMu(anaSohbet())) return 'atlandi';
  if (eslikSayisi(new Date(simdi - 3600_000).toISOString()) >= g.eslikciSaatlik) return 'atlandi';
  const sonEslik = sonEslikler(1, h)[0];
  let gizliOkundu = son.some((s) => s.gizli) || Boolean(sonEslik?.gizli);
  if (sonEslik && simdi - new Date(sonEslik.zaman).getTime() < 3 * 60_000) return 'atlandi';
  if (simdi - sonDeneme < 8000) return 'atlandi';

  // 2) Ön eleme: son 2 satırın anahtar kelimeleriyle iz ara.
  const odak = yeni.slice(-2).map((s) => s.metin).join(' ');
  const kelimeler = anahtarKelimeler(odak, 8);
  if (!kelimeler.length) return 'atlandi';
  const sorgu = kelimeler.join(' ');
  const izler: string[] = [];
  const bugunBas = new Date(new Date().toDateString()).toISOString();
  for (const m of maddeAra(sorgu, 6, h)) {
    if (yeni.some((s) => m.satirlar.includes(`G-${s.id}`))) continue; // aynı konuşmanın kendisi
    if (m.gizli) gizliOkundu = true;
    izler.push(`[N-${m.id} · ${gunOnce(m.zaman)} ${new Date(m.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · ${m.onem}] ${m.metin}`);
  }
  for (const hf of hafizaAra({ sorgu, limit: 3 })) izler.push(`[H-${hf.id} · ${gunOnce(hf.olayTarihi ?? hf.guncelleme)}] ${hf.baslik}: ${hf.icerik.slice(0, 200)}`);
  for (const r of raporAra(sorgu, 1, h)) { if (r.gizli) gizliOkundu = true; izler.push(`[R-${r.id} · ${r.tur} ${r.donem}] ${r.ozet.slice(0, 220)}`); }
  for (const ms of meseleler('acik', 40, h)) if (benzerlik(odak, `${ms.baslik} ${ms.kisi ?? ''}`) >= 0.4) { if (ms.gizli) gizliOkundu = true; izler.push(`[mesele #${ms.id}${ms.hedef ? ` · hedef ${ms.hedef}` : ''}] ${ms.baslik}`); }
  const espriKipi = g.eslikci === 'hatirlatma_espri';
  const espriAdayi = espriKipi && !izler.length && /[?!]|\b(m[iıuü]|mısın|misin|yesek|gidelim|yapalım)\b/i.test(odak) && simdi - sonEspriDenemesi > 20 * 60_000;
  // Bugün olmuş bir şeye dair iz de geçerli ("az önce de söyledin"), ama yalnız bugünkü satırlarla aynıysa değil.
  if (!izler.length && !espriAdayi) return 'sus';
  if (espriAdayi) sonEspriDenemesi = simdi;

  // 3) Model kararı
  suruyor = true;
  sonDeneme = simdi;
  try {
    const kullanici = [
      `Şu an: ${new Date().toLocaleString('tr-TR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}`,
      `Son konuşma (en yenisi sonda):\n${son.slice(-6).map((s) => `- ${s.metin}`).join('\n')}`,
      izler.length ? `İlgili notlar/hafıza:\n${izler.slice(0, 8).join('\n')}` : 'İlgili not yok.',
      sonEslik ? `Senin son araya girişin (${gunOnce(sonEslik.zaman)}): ${sonEslik.metin}` : '',
      `Bugün başlangıcı: ${bugunBas}`,
    ].filter(Boolean).join('\n\n');
    const { veri } = await ajanJson<Karar>(SISTEM(kullaniciHitabi(), espriKipi), kullanici, 'gunkaydi:eslik', 1500, yol.sabit); // düşünme kapatılamaz: 300'de bütçe düşünmeye gidip karar boş kalıyordu (19 Eki)
    const esik = veri?.tur === 'espri' ? 0.82 : 0.7;
    if (!veri?.konus || !veri.metin?.trim() || (veri.guven ?? 0) < esik) return 'sus';
    if (veri.tur === 'espri' && !espriKipi) return 'sus';
    const metin = veri.metin.trim().slice(0, 240);
    eslikEkle({ tetik: odak.slice(0, 300), metin, tur: veri.tur ?? 'bilgi', kaynaklar: veri.kaynaklar, ...(gizliOkundu ? { gizli: true } : {}) });
    // Ana sohbete de düşer (sonra "az önce ne demiştin?" sorulabilsin). Gizli bilgiden doğduysa Gizli bölümde.
    const ana = anaSohbet();
    const m = mesajEkle(ana, { rol: 'assistant', bloklar: [{ tur: 'metin', metin }], kaynak: 'eslikci', okunmamis: true, ...(gizliOkundu ? { gizli: true } : {}) });
    sohbetOlayi({ tur: 'yeni_mesaj', sohbetId: ana, mesaj: gorunume([m])[0] });
    teslim(metin, veri.tur ?? 'bilgi');
    yayinla('kokpit:veri-degisti', {});
    return 'konustu';
  } finally {
    suruyor = false;
  }
}
