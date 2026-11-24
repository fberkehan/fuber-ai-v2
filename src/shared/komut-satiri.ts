// ── Komut satırı ↔ komut + argümanlar (saf; Bağlantılar → MCP sunucusu ekle) ────────────────────────────────────────
// Görev 19 denetimi: MCP formunun "Komut" alanı her tuşta boşluktan bölünüp yeniden birleştiriliyordu: boşluk yazılamıyordu
// ("npx -y paket" → "npx-ypaket") ve "C:\Program Files\…" gibi boşluklu yollar parçalanıyordu. Alan artık metni olduğu gibi
// tutar; kaydederken burada ayrıştırılır. Windows alışkanlığıyla yalnız ÇİFT tırnak gruplar (tek tırnak yolda geçebilir:
// "C:\Kullanicilar\O'Brien"); ters bölü olduğu gibi kalır.

export function komutAyristir(satir: string): string[] {
  const out: string[] = [];
  let parca = '';
  let tirnakta = false;
  let basladi = false; // "" gibi boş tırnaklı argüman da sayılır
  for (const ch of satir) {
    if (ch === '"') { tirnakta = !tirnakta; basladi = true; continue; }
    if (!tirnakta && /\s/.test(ch)) {
      if (basladi) { out.push(parca); parca = ''; basladi = false; }
      continue;
    }
    parca += ch;
    basladi = true;
  }
  if (basladi) out.push(parca);
  return out;
}

/** Kayıtlı komut + argümanlar → düzenlenebilir/gösterilebilir tek satır (boşluklu parça çift tırnakla). */
export function komutSatiri(komut?: string, argumanlar: readonly string[] = []): string {
  return [komut ?? '', ...argumanlar].filter((x, i) => i > 0 || x !== '').map((x) => (x === '' || /\s/.test(x) ? `"${x}"` : x)).join(' ');
}
