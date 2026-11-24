// ── Claude Code hatalarını kullanıcıya TEK CÜMLE + EYLEM olarak anlatmak (13 Kas 2026; paketli onarım) ────────────────────────────────
// Gerçek Claude Code hataları İngilizce, ham JSON ("API Error: 401 {\"type\":\"error\",…,\"request_id\":\"req_…\"}"), sistem kodu
// (ECONNREFUSED, ConnectionRefused) ya da yığın izi taşır; süreç çökünce stderr'in son satırları da. Hiçbiri kullanıcıya olduğu gibi gösterilmez:
// ham metin SINIFLANIR; her sınıfın bir Türkçe cümlesi ve bir eylemi vardır. Sınıflanamayan hata: ham metin JSON/yığın/yollardan arındırılıp
// kısaltılır ("Claude Code şunu bildirdi: …") ve yine bir eylemle biter. Saf; birim testli (tests/cc-hata.test.ts).
export type CcHataSinifi = 'giris' | 'kredi' | 'limit' | 'ag' | 'yok' | 'yogun' | 'model' | 'baglam' | 'genel';
export interface CcHataAciklamasi { sinif: CcHataSinifi; metin: string }

const S = (s: unknown) => String(s ?? '');

/** Metindeki ham öğeleri atar: ANSI, JSON bloğu, yığın satırları, istek kimlikleri; boşlukları tek satıra indirir. */
export function hamTemizle(ham: string): string {
  let m = S(ham).replace(/\u001b\[[0-9;]*m/g, '');
  // yığın izi satırları
  m = m.split(/\r?\n/).filter((s) => !/^\s*at\s+\S+/.test(s) && !/^\s*\^+\s*$/.test(s)).join(' ');
  // JSON bloğu: içinde "message" varsa onu al, yoksa at
  m = m.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, (blok) => {
    const ic = /"message"\s*:\s*"([^"]{1,200})"/.exec(blok);
    return ic ? ic[1] : '';
  });
  m = m.replace(/\breq_[0-9A-Za-z]{6,}\b/g, '').replace(/\b(?:node:)?internal\/[\w/.:-]+/g, '');
  m = m.replace(/\(\s*\)/g, '');
  return m.replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

const KURALLAR: { sinif: Exclude<CcHataSinifi, 'genel'>; desen: RegExp }[] = [
  { sinif: 'yok', desen: /native binary not found|not found at|\bENOENT\b|spawn .* (?:ENOENT|EINVAL)|is not recognized|cannot find the (?:file|path)|bulunamad|claude-yok/i },
  { sinif: 'kredi', desen: /credit balance|billing|payment required|\b402\b|insufficient (?:funds|credit|quota)|out of credits|extra usage|spend limit/i },
  { sinif: 'limit', desen: /hit your (?:usage )?limit|usage limit|rate.?limit|\b429\b|too many requests|quota exceeded|limit reached|resets? (?:at )?\d/i },
  { sinif: 'giris', desen: /invalid api key|please run \/login|not logged in|\/login|authentication[_ ]?(?:error|failed)|invalid x-api-key|oauth token (?:has )?expired|token (?:has )?expired|\b401\b|unauthorized|org(?:anization)? (?:disabled|not allowed)/i },
  { sinif: 'ag', desen: /unable to connect|connection ?refused|econnrefused|econnreset|enotfound|etimedout|eai_again|getaddrinfo|network (?:error|is unreachable)|fetch failed|socket hang up|timed? ?out|connection error|certificate|\bssl\b|\bproxy\b|offline/i },
  { sinif: 'yogun', desen: /overloaded|\b529\b|\b503\b|service unavailable|temporarily unavailable/i },
  { sinif: 'model', desen: /model[_ ]not[_ ]found|\b404\b.*model|model .*(?:not (?:found|available)|does not exist)|invalid model/i },
  { sinif: 'baglam', desen: /prompt is too long|context (?:length|window)|too many tokens|max_output_tokens|maximum context/i },
];

const CUMLE: Record<Exclude<CcHataSinifi, 'genel'>, string> = {
  giris: 'Claude Code’da oturum açık değil ya da süresi dolmuş: Claude Code sayfasında Ayarlar → “Oturum aç”a bas, sonra mesajı yeniden gönder.',
  kredi: 'Claude hesabında kredi ya da ödeme sorunu var: Anthropic hesabından kredi ekle ya da planını denetle, sonra yeniden dene.',
  limit: 'Claude kullanım sınırına ulaşıldı: sınır sıfırlanınca yeniden dene ya da başka bir model seç.',
  ag: 'Claude’a ulaşılamıyor: internet bağlantını (VPN ya da vekil varsa onu da) denetle, sonra mesajı yeniden gönder.',
  yok: 'Claude Code bulunamadı: claude.com/claude-code adresinden kur, sonra Fuber AI’yı yeniden aç.',
  yogun: 'Claude şu an çok yoğun: birkaç dakika sonra yeniden dene.',
  model: 'Seçilen model bu hesapta yok: model seçicisinden başka bir model seç.',
  baglam: 'Konuşma modelin sığabileceğinden uzun: /compact ile özetle ya da yeni oturum aç.',
};

/** "resets 5pm (Europe/Istanbul)" gibi sıfırlanma bilgisi (varsa). */
function sifirlanma(ham: string): string {
  const m = /resets?\s+(?:at\s+)?([^·\n]{2,40}?)(?:\s*·|\s*\.|$)/i.exec(ham);
  return m ? m[1].trim() : '';
}

/**
 * Ham hata metni (+ varsa Claude Code'un asistan hata kodu: authentication_failed, billing_error, rate_limit …) → tek cümle + eylem.
 * `ham` boşsa ve kod da yoksa genel bir cümle döner.
 */
export function ccHataAciklamasi(ham: unknown, kod?: unknown): CcHataAciklamasi {
  const metin = S(ham);
  const k = S(kod);
  const kodSinifi: Partial<Record<string, Exclude<CcHataSinifi, 'genel'>>> = {
    authentication_failed: 'giris', oauth_org_not_allowed: 'giris', billing_error: 'kredi', rate_limit: 'limit', overloaded: 'yogun', model_not_found: 'model', max_output_tokens: 'baglam',
  };
  let sinif: CcHataSinifi | undefined = kodSinifi[k];
  if (!sinif) sinif = KURALLAR.find((r) => r.desen.test(metin))?.sinif;
  if (sinif) {
    let c = CUMLE[sinif as Exclude<CcHataSinifi, 'genel'>];
    if (sinif === 'limit') { const s = sifirlanma(metin); if (s) c = `Claude kullanım sınırına ulaşıldı (sıfırlanma: ${s}): o zaman yeniden dene ya da başka bir model seç.`; }
    return { sinif, metin: c };
  }
  if (k === 'account_on_hold') return { sinif: 'kredi', metin: 'Claude hesabı askıda: claude.ai hesabından durumu denetle, sonra yeniden dene.' };
  if (k === 'verification_required') return { sinif: 'giris', metin: 'Claude hesabı doğrulama bekliyor: claude.ai’da doğrula, sonra yeniden dene.' };
  const temiz = hamTemizle(metin);
  if (!temiz) return { sinif: 'genel', metin: 'Claude Code bir hata bildirdi: mesajı yeniden gönder; sürerse yeni bir oturum aç.' };
  const kisa = temiz.length > 140 ? `${temiz.slice(0, 139)}…` : temiz;
  return { sinif: 'genel', metin: `Claude Code bir hata bildirdi (${kisa}): mesajı yeniden gönder; sürerse yeni bir oturum aç.` };
}

/** Süreç çökmesi: çıkış kodu / sinyal + stderr'in son satırları. Sınıflanırsa o cümle; değilse "kapandı" cümlesi (yığın izi ve yollar olmadan). */
export function ccCokusAciklamasi(neden: { kod?: string; sinyal?: string; ileti?: string }, stderr: string): CcHataAciklamasi {
  const birlesik = `${S(neden.ileti)}\n${S(stderr)}`;
  const s = KURALLAR.find((r) => r.desen.test(birlesik))?.sinif;
  if (s) return { sinif: s, metin: CUMLE[s] };
  const temiz = hamTemizle(S(stderr).split(/\r?\n/).filter(Boolean).slice(-8).join('\n'));
  const ne = neden.kod ? ` (çıkış kodu ${neden.kod})` : neden.sinyal ? ` (sinyal ${neden.sinyal})` : '';
  const ek = temiz ? `: ${temiz.length > 140 ? `${temiz.slice(0, 139)}…` : temiz}` : '';
  return { sinif: 'genel', metin: `Claude Code beklenmedik biçimde kapandı${ne}${ek}. Yeni bir mesajla sürdürebilirsin.` };
}
