// Sahte olay yardımcısı (yalnız test, 0.14 T22): resources/bin/fuber-olay.exe ile AYNI satır protokolü (src/shared/sistem-olay.ts). Sonuç makinenin
// gerçek ses, şarj, ağ ve tam ekranına bağlı olmasın diye olaylar dışarıdan verilir; yardımcı kendiliğinden yalnız `hazir` yazar.
// Kullanım: FUBER_DEMO=1 FUBER_OLAY_KOMUT='["node", "scripts/dev/sahte-olay.mjs"]' (src/main/olay-yardimcisi.ts). Ana süreç test kancası ada:test-olay
// (yalnız FUBER_DEMO) bu sürecin stdin'ine şu komutları yazar:
//   {"k":"sahte-olay","olay":{...}} → olay satırı aynen yazılır ve iç hâle uygulanır (sonraki `durum` yanıtı onu da içerir);
//   {"k":"sahte-cik","kod":1}       → süreç o kodla çıkar (çöküş).
// Gerçek komutlar: {"k":"durum"} → iç hâl; {"k":"klavye","acik":…} → kaydedilir (yanıt yok, gerçek yardımcı gibi); ses ve medya komutları yanıtsız; bozuk
// ya da bilinmeyen komut tek `hata` satırı. stdin kapanınca çıkar (0).
// Bayraklar (tests/olay-yardimcisi.test.ts): --hazir-yok → `hazir` hiç yazılmaz (takılmış yardımcı); --cikma → stdin kapanınca ÇIKMAZ (öldürülmeli).
import readline from 'node:readline';

const hazirYok = process.argv.includes('--hazir-yok');
const cikma = process.argv.includes('--cikma');
const ALANLAR = { guc: 'guc', ag: 'ag', 'ses-aygiti': 'sesAygiti', ses: 'ses', parlaklik: 'parlaklik', caps: 'caps', dil: 'dil', 'tam-ekran': 'tamEkran', medya: 'medya' };
const durum = { guc: null, ag: null, sesAygiti: null, ses: null, parlaklik: null, caps: null, dil: null, tamEkran: null, medya: null };
const yaz = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

function uygula(o) {
  const alan = ALANLAR[o.t];
  if (!alan) return;
  const { t: _t, ...govde } = o;
  if (o.t === 'ag') durum.ag = o.bagli;
  else if (o.t === 'caps') durum.caps = o.acik;
  else if (o.t === 'parlaklik') durum.parlaklik = o.duzey;
  else if (o.t === 'medya') durum.medya = o;
  else durum[alan] = govde;
}

if (!hazirYok) yaz({ t: 'hazir', surum: 1 });
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (satir) => {
  if (!satir.trim()) return;
  let k;
  try { k = JSON.parse(satir); } catch { yaz({ t: 'hata', mesaj: 'komut okunamadı' }); return; }
  switch (k?.k) {
    case 'durum': yaz({ t: 'durum', ...durum }); break;
    case 'klavye': if (typeof k.acik !== 'boolean') yaz({ t: 'hata', mesaj: 'klavye: acik eksik' }); break;
    case 'ses': case 'medya': break;
    case 'sahte-olay': if (k.olay && typeof k.olay.t === 'string') { uygula(k.olay); yaz(k.olay); } break;
    case 'sahte-cik': process.exit(Number(k.kod) || 0); break;
    default: yaz({ t: 'hata', mesaj: `bilinmeyen komut: ${String(k?.k)}` });
  }
});
rl.on('close', () => {
  // Takılmış yardımcı: ana süreç öldürmeli. Öldürülmezse (test yarıda kaldı) 10 sn sonra kendisi çıkar: arka planda süreç kalmaz.
  if (cikma) { setTimeout(() => process.exit(0), 10_000); return; }
  process.exit(0);
});
