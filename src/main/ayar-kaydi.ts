// ── ayarlar:kaydet süzgeci (saf; tests/ayar-kaydi.test.ts) ─────────────────────────────────────────────────────────────────────
// Arayüzün gönderdiği ayar kopyası bazı alanları YAZAMAZ; onları yalnız kendi akışları değiştirir. Girdi değiştirilmez, süzülmüş kopya döner.
//   · abonelik — KALDIRILMIŞ alan (0.11 G12a: abonelik yüzeyi ve ana süreç yolu silindi; tipte yok): eski bir kopya (bayat arayüz
//     önbelleği, eski telefon sürümü) onu dosyaya geri yazamaz; yüklemede de atılır (ayarlar.ts).
//   · kurulumSurumu — yalnız kurulum:tamamla / kurulum:yukseltme-bitti (Görev 23): bayat bir kopya onu geri alıp yükseltme sihirbazını
//     yeniden açtırmasın.
//   · yerel.bekleyenKurulum — istenen yerel kurulumun kaydını yalnız ana süreç yazar (yerel:kur): arayüzün `{ yerel: { ...y } }` kopyası
//     onu diriltmesin.
//   · hesap — masaüstü Fuber hesabı (0.10 E3) yalnız main/hesap.ts'ten (giriş, durum, çıkış): arayüz hesabın hâlini ("aktif") ya da
//     e-postasını kendisi yazıp kapalı bir hesabı açık gösteremesin; bayat kopya çıkıştan sonra hesabı diriltmesin.
//   · kisayolTemizligiSurumu — yalnız açılıştaki kimlik gaspı temizliği (main/kabuk-kimligi.ts, 0.10 E1): bayat bir kopya onu geri alıp
//     taramayı yeniden yaptırmasın.
//   · motorCalisti — yalnız ana süreç (ilk başarılı bulut çağrısı, motor:sina; 0.10 Görev 2 P3): arayüz "bağlantı koptu"yu "bağlı değil"e
//     çeviremesin, bayat kopya onu geri almasın.
//   · yerel.gizliGeriAlindi — F1 (Ö1): "Gizli modu kapattım" notu yalnız ana süreçte yazılır/silinir (main/yerel/gizli-geri-al.ts,
//     yerel:gizli-notu-kapat): arayüzün `{ yerel: { ...y } }` kopyası onu diriltmesin ya da silmesin.
//   · cihazSoneki — F1 (K5): cihaz adının kurulum başına son eki yalnız main/hesap.ts'te üretilir (bir kez; sonra hep aynı).
//   · yenilikSurumu — 0.11 G12b: sürüm yenilik kartının (0.12’de yeni) işareti yalnız kurulum:tamamla / yenilik:kapat yazar; bayat bir arayüz kopyası kapatılmış
//     kartı diriltmesin (shared/yenilik.ts).
//   · yalnizYerelGocu — son bütün dal incelemesi K-1: "Yalnız bu bilgisayar" yükseltme göçünün işareti yalnız ana süreçte (ayarlar.ts,
//     yerel/gizli-geri-al.ts acilistaYalnizYerelGocu): bayat ya da düşmanca bir kopya onu silip göçü yeniden çalıştıramaz.
// Düzeltilen (düşmez): gorunum.tema — bilinmeyen değer 'koyu' yazılır; 'cam' (Şeffaf, 0.13 T13) geçerlidir ve korunur: telefon başka bir ayarı kaydederken
//   tema'yı da geri gönderir, camı ezmemeli.
//   · gorunum.karakterler — 0.14 T6b (Sade mod): yalnız 'goster' | 'sade'; bilinmeyen değer düşer (bilgisayardaki değer kalır).
//   · claudeAnahtariVar — 0.14: Anthropic anahtarının kayıtlı olduğu bilgisi yalnız ana süreçte (ayarlar.ts) hesaplanır.
// 0.14 (ürün kararı) — denetlenen (düşer): motorSecimi yalnız 'fuber' | 'anthropic' (5 Kas: iki modda da; Business'ta da kendi
//   Claude anahtarı kullanılabilir). claudeModeller yalnız bilinen roller, geçerli Claude
//   model kimliği ve efor (shared/motor-secimi.ts claudeModelleriSuz); geçersizse alan bütün düşer.
import type { Ayarlar, Mod } from '../shared/tipler.js';
import { claudeModelleriSuz, openaiUyumluSuz, MOTOR_SECIMLERI } from '../shared/motor-secimi.ts';
import { karakterGorunumuGecerli } from '../shared/karakter-gorunum.ts';

export function ayarKaydiniSuz(d: Partial<Ayarlar>, mevcutMod: Mod = 'is'): Partial<Ayarlar> {
  if (!d || typeof d !== 'object') return d;
  const c: Partial<Ayarlar> = { ...d };
  delete c.claudeAnahtariVar;
  delete c.openaiAnahtariVar;
  if ('motorSecimi' in c) {
    void mevcutMod;
    if (!MOTOR_SECIMLERI.includes(c.motorSecimi as never)) delete c.motorSecimi;
  }
  if ('claudeModeller' in c) {
    const m = claudeModelleriSuz(c.claudeModeller);
    if (m) c.claudeModeller = m as Ayarlar['claudeModeller']; else delete c.claudeModeller;
  }
  // Açık kaynak hazırlığı: kendi OpenAI uyumlu sağlayıcının ayarı (taban adresi https ya da bu bilgisayar; geçerli model) — geçersizse alan bütün düşer.
  if ('openaiUyumlu' in c) {
    const o = openaiUyumluSuz(c.openaiUyumlu);
    if (o) c.openaiUyumlu = o; else delete c.openaiUyumlu;
  }
  // "Hesapsız" tercihi yalnız boolean.
  if ('hesapsizTercih' in c && typeof c.hesapsizTercih !== 'boolean') delete c.hesapsizTercih;
  delete (c as Record<string, unknown>).abonelik;
  delete c.kurulumSurumu;
  delete c.hesap;
  delete c.kisayolTemizligiSurumu;
  delete c.yenilikSurumu;
  delete c.motorCalisti;
  delete c.cihazSoneki;
  delete c.yalnizYerelGocu;
  // 0.14 son inceleme I7: MCP sunucuları yalnız mcp:kaydet / mcp:sil ile değişir (değerler sır yuvasına orada ayrılır): ayarlar:kaydet'teki bayat ya da
  // düz değerli bir `mcp` kopyası ayarlar.json'a yazılmaz.
  delete c.mcp;
  // Saf modül (testler doğrudan içe aktarır): kural shared/tema-cozum.ts temaGocu ile aynı (bilinmeyen → koyu).
  if (c.gorunum && typeof c.gorunum === 'object' && 'tema' in c.gorunum && !(['koyu', 'acik', 'sistem', 'cam'] as unknown[]).includes(c.gorunum.tema)) {
    c.gorunum = { ...c.gorunum, tema: 'koyu' };
  }
  // 0.14 T6b (Sade mod): gorunum.karakterler yalnız 'goster' | 'sade'; bilinmeyen değer DÜŞER (kayıtlı değer kalır).
  if (c.gorunum && typeof c.gorunum === 'object' && 'karakterler' in c.gorunum && !karakterGorunumuGecerli(c.gorunum.karakterler)) {
    const { karakterler: _k, ...gorunum } = c.gorunum;
    c.gorunum = gorunum as Ayarlar['gorunum'];
  }
  if (c.yerel && typeof c.yerel === 'object' && ('bekleyenKurulum' in c.yerel || 'gizliGeriAlindi' in c.yerel)) {
    const { bekleyenKurulum: _b, gizliGeriAlindi: _g, ...yerel } = c.yerel;
    c.yerel = yerel as Ayarlar['yerel'];
  }
  return c;
}
