// Sahte MCP servisi + OAuth yetki sunucusu (0.14 T16) — testler ve önizleme için. YALNIZ 127.0.0.1; gerçek OAuth sağlayıcısına hiçbir şey gitmez.
// Masaüstü kataloğu https adres ister (shared/mcp-katalog.ts); bu sunucu kendini `genel` (varsayılan https://mcp.sahte.example) adıyla tanıtır, masaüstü
// FUBER_DEMO + FUBER_TEST_MCP_TABAN ile `.example` adreslerini bu kapıya çevirir (main/entegrasyon/mcp-oauth.ts testYonlendir). Uçlar:
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728: { resource: <genel>/mcp, authorization_servers: [<genel>] }
//   GET  /.well-known/oauth-authorization-server       RFC 8414 (registration_endpoint yalnız `dinamikKayit` açıkken)
//   POST /register                                     RFC 7591 dinamik istemci kaydı (yalnız `dinamikKayit`)
//   GET  /authorize                                    kendiliğinden izin verir (`izinReddet`: error=access_denied); PKCE S256 zorunlu; geri dönüş yalnız
//                                                      http://127.0.0.1:<kapı>/… ya da http://[::1]:<kapı>/… (açık kapı)
//   POST /token                                        authorization_code (PKCE doğrulanır) ve refresh_token; `istemciSirri` verilmişse gizli istemci:
//                                                      client_secret ister (masaüstü sırrı bilmez → kod alışverişi Fuber'in aracısından geçmeli)
//   POST /mcp                                          Streamable HTTP MCP (durumsuz, JSON yanıt): initialize, tools/list, tools/call; geçersiz ya da
//                                                      süresi dolmuş belirteç → 401 + WWW-Authenticate (resource_metadata)
// Araçlar: dosyalari_listele (readOnlyHint), taslak_olustur (yazan), taslak_listele (ipucusuz; katalogun saltOkunur'unda verilir), yavas_oku (readOnlyHint;
// `cagriBeklet` açıkken yanıt bekler), buyuk_veri (readOnlyHint; yalnız structuredContent, `buyukBoyut` karakter) + `ekAraclar`.
// Denetim: `s.ayarla({...})`, `s.surumuDoldur()` (bütün erişim belirteçleri dolar), `s.birak()` (bekleyen yanıtları salar), `s.istekler`, `s.cagrilar`.
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const rastgele = (n = 12) => randomBytes(n).toString('hex');
const s256 = (v) => createHash('sha256').update(String(v ?? ''), 'ascii').digest('base64url');
const geriDonusGecerli = (a) => {
  let u;
  try { u = new URL(a); } catch { return false; }
  return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === '[::1]') && /^\d+$/.test(u.port) && !u.username && !u.password;
};

export async function sahteMcpOauth(o = {}) {
  const ayar = {
    genel: 'https://mcp.sahte.example', dinamikKayit: true, istemciKimligi: 'fuber-sabit', istemciSirri: null, omurSn: 3600,
    izinReddet: false, yenilemeReddet: false, yenilemeBeklet: false, cagriBeklet: false, mcpBeklet: false, buyukBoyut: 123_456, ekAraclar: [], ...o,
  };
  const istekler = [];
  const cagrilar = [];
  const belirtecIstekleri = [];
  const istemciler = new Map(); // client_id → { redirect_uris }
  const kodlar = new Map();     // kod → { client_id, redirect_uri, cc, kullanildi }
  const erisimler = new Map();  // access → { son }
  const yenilemeler = new Map(); // refresh → client_id
  const verilenler = [];        // verilen bütün belirteçler (sızıntı denetimi)
  let bekleyenler = [];

  const temelAraclar = () => [
    { name: 'dosyalari_listele', title: 'Dosyaları listele', description: 'Klasördeki dosyaları listeler.', inputSchema: { type: 'object', properties: { klasor: { type: 'string', description: 'Klasör' } } }, annotations: { readOnlyHint: true } },
    { name: 'taslak_olustur', title: 'Taslak oluştur', description: 'Yeni bir taslak oluşturur.', inputSchema: { type: 'object', properties: { konu: { type: 'string' }, metin: { type: 'string' } }, required: ['konu'] } },
    { name: 'taslak_listele', description: 'Taslakları listeler.', inputSchema: { type: 'object', properties: {} } },
    { name: 'yavas_oku', description: 'Yavaş bir okuma.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'buyuk_veri', description: 'Büyük yapılandırılmış sonuç.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    // Onay kuralı (düzeltme turu 1): okuma fiilli + salt okunur ilanlı (onaysız olabilir), salt okunur İLANLI ama silen (onay), yıkıcı ilanlı okuma (onay).
    { name: 'list_drafts', description: 'Taslakları listeler (salt okunur ilanlı, okuma fiilli).', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
    { name: 'delete_file', description: 'Bir dosyayı siler (yanlışlıkla salt okunur ilanlı).', inputSchema: { type: 'object', properties: { yol: { type: 'string' } } }, annotations: { readOnlyHint: true } },
    { name: 'read_secret', description: 'Okur ama yıkıcı ilanlı.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, destructiveHint: true } },
    ...ayar.ekAraclar,
  ];

  const belirtecVer = (client_id) => {
    const erisim = `sahte_at_${rastgele()}`, yenileme = `sahte_rt_${rastgele()}`;
    erisimler.set(erisim, { son: Date.now() + ayar.omurSn * 1000 });
    yenilemeler.set(yenileme, client_id);
    verilenler.push(erisim, yenileme);
    return { access_token: erisim, token_type: 'Bearer', expires_in: ayar.omurSn, refresh_token: yenileme };
  };
  const yaz = (res, durum, govde, basliklar = {}) => { res.writeHead(durum, { 'content-type': 'application/json', 'cache-control': 'no-store', ...basliklar }); res.end(JSON.stringify(govde)); };
  const oauthHata = (res, durum, error, aciklama) => yaz(res, durum, { error, ...(aciklama ? { error_description: aciklama } : {}) });
  /** Yanıtı bekletir: s.birak() ya da istemci bağlantıyı kesince (res 'close', yanıt yazılmadan) biter. */
  const bekle = (res) => new Promise((coz) => {
    const b = { coz, res, kapandi: false };
    bekleyenler.push(b);
    res.on('close', () => { if (!res.writableFinished) { b.kapandi = true; kesilenler.push(Date.now()); coz('kapandi'); } });
  });
  /** İstemcinin yanıt beklerken kestiği istekler (Gizli açılınca süren çağrı/yenileme kesilir). */
  const kesilenler = [];

  const kesifPR = () => ({ resource: `${ayar.genel}/mcp`, authorization_servers: [ayar.genel], bearer_methods_supported: ['header'] });
  const kesifAS = () => ({
    issuer: ayar.genel, authorization_endpoint: `${ayar.genel}/authorize`, token_endpoint: `${ayar.genel}/token`,
    ...(ayar.dinamikKayit ? { registration_endpoint: `${ayar.genel}/register` } : {}),
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ayar.istemciSirri ? ['client_secret_post'] : ['none'],
  });

  async function mcpYanitla(req, res, govde) {
    // `mcpBeklet`: servis hiç yanıt vermez (ölü/kara delik servis; tur başı beklemesi testi).
    if (ayar.mcpBeklet && (await bekle(res)) === 'kapandi') return undefined;
    // `mcpHata`: servis çöktü (500); bağlantı hemen düşer.
    if (ayar.mcpHata) return yaz(res, 500, { error: 'servis çöktü' });
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
    const e = m ? erisimler.get(m[1]) : undefined;
    if (!e || Date.now() > e.son) {
      res.writeHead(401, { 'www-authenticate': `Bearer error="invalid_token", resource_metadata="${ayar.genel}/.well-known/oauth-protected-resource/mcp"`, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'invalid_token' }));
    }
    const ileti = govde;
    if (!ileti || typeof ileti !== 'object' || Array.isArray(ileti)) return yaz(res, 400, { jsonrpc: '2.0', error: { code: -32600, message: 'geçersiz' } });
    if (ileti.id === undefined) { res.writeHead(202); return res.end(); } // bildirim
    const sonuc = (result) => yaz(res, 200, { jsonrpc: '2.0', id: ileti.id, result });
    if (ileti.method === 'initialize') return sonuc({ protocolVersion: ileti.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sahte-mcp', version: '1.0.0' } });
    if (ileti.method === 'ping') return sonuc({});
    if (ileti.method === 'tools/list') return sonuc({ tools: temelAraclar() });
    if (ileti.method === 'tools/call') {
      const ad = ileti.params?.name;
      const girdi = ileti.params?.arguments ?? {};
      cagrilar.push({ ad, girdi, belirtec: m[1] });
      if (ad === 'dosyalari_listele') return sonuc({ content: [{ type: 'text', text: 'rapor.pdf\nsunum.pptx\nbutce.xlsx' }] });
      if (ad === 'taslak_olustur') return sonuc({ content: [{ type: 'text', text: `Taslak oluşturuldu: ${girdi.konu ?? ''}` }] });
      if (ad === 'taslak_listele') return sonuc({ content: [{ type: 'text', text: 'Taslak yok.' }] });
      if (ad === 'yavas_oku') {
        if (ayar.cagriBeklet && (await bekle(res)) === 'kapandi') return undefined;
        return sonuc({ content: [{ type: 'text', text: 'yavaş okuma bitti' }] });
      }
      if (ad === 'buyuk_veri') return sonuc({ content: [], structuredContent: { veri: 'v'.repeat(ayar.buyukBoyut) } });
      if (ad === 'list_drafts' || ad === 'delete_file' || ad === 'read_secret') return sonuc({ content: [{ type: 'text', text: `${ad} çalıştı` }] });
      const ek = ayar.ekAraclar.find((a) => a.name === ad);
      if (ek) return sonuc({ content: [{ type: 'text', text: `${ad} çalıştı: ${JSON.stringify(girdi)}` }] });
      return yaz(res, 200, { jsonrpc: '2.0', id: ileti.id, error: { code: -32602, message: `Bilinmeyen araç: ${ad}` } });
    }
    return yaz(res, 200, { jsonrpc: '2.0', id: ileti.id, error: { code: -32601, message: 'yok' } });
  }

  async function belirtec(req, res, form) {
    const p = Object.fromEntries(form);
    const kayit = { grant: p.grant_type, alanlar: Object.keys(p).sort(), sirli: Boolean(p.client_secret), client_id: p.client_id ?? null };
    belirtecIstekleri.push(kayit);
    if (ayar.istemciSirri) {
      if (p.client_id !== ayar.istemciKimligi || p.client_secret !== ayar.istemciSirri) return oauthHata(res, 401, 'invalid_client', 'istemci doğrulanamadı');
    }
    if (p.grant_type === 'authorization_code') {
      const k = kodlar.get(p.code);
      if (!k || k.kullanildi) return oauthHata(res, 400, 'invalid_grant', 'kod geçersiz');
      k.kullanildi = true;
      if (s256(p.code_verifier) !== k.cc) return oauthHata(res, 400, 'invalid_grant', 'PKCE doğrulanamadı');
      if (p.redirect_uri !== k.redirect_uri) return oauthHata(res, 400, 'invalid_grant', 'geri dönüş adresi uyuşmuyor');
      if (!ayar.istemciSirri && p.client_id !== k.client_id) return oauthHata(res, 400, 'invalid_client', 'istemci uyuşmuyor');
      return yaz(res, 200, belirtecVer(k.client_id));
    }
    if (p.grant_type === 'refresh_token') {
      if (ayar.yenilemeBeklet && (await bekle(res)) === 'kapandi') return undefined;
      if (ayar.yenilemeReddet) return oauthHata(res, 400, 'invalid_grant', 'yenileme reddedildi');
      const c = yenilemeler.get(p.refresh_token);
      if (!c) return oauthHata(res, 400, 'invalid_grant', 'yenileme belirteci geçersiz');
      yenilemeler.delete(p.refresh_token);
      return yaz(res, 200, belirtecVer(c));
    }
    return oauthHata(res, 400, 'unsupported_grant_type');
  }

  const sunucu = http.createServer((req, res) => {
    let ham = '';
    req.on('data', (d) => { ham += d; });
    req.on('end', async () => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const tur = String(req.headers['content-type'] ?? '');
      let govde = null;
      if (/json/.test(tur)) { try { govde = ham ? JSON.parse(ham) : null; } catch { govde = null; } }
      istekler.push({ yontem: req.method, yol: u.pathname, sorgu: Object.fromEntries(u.searchParams), basliklar: { ...req.headers }, govde, ham, zaman: Date.now() });
      try {
        if (req.method === 'GET' && /^\/\.well-known\/oauth-protected-resource(\/mcp)?$/.test(u.pathname)) return yaz(res, 200, kesifPR());
        if (req.method === 'GET' && /^\/\.well-known\/(oauth-authorization-server|openid-configuration)/.test(u.pathname)) return yaz(res, 200, kesifAS());
        if (req.method === 'POST' && u.pathname === '/register') {
          if (!ayar.dinamikKayit) return yaz(res, 404, { error: 'yok' });
          const g = govde ?? {};
          if (!Array.isArray(g.redirect_uris) || !g.redirect_uris.length || !g.redirect_uris.every(geriDonusGecerli)) return yaz(res, 400, { error: 'invalid_redirect_uri' });
          const client_id = `dcr_${rastgele(6)}`;
          istemciler.set(client_id, { redirect_uris: g.redirect_uris });
          return yaz(res, 201, { ...g, client_id, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: 'none' });
        }
        if (req.method === 'GET' && u.pathname === '/authorize') {
          const q = Object.fromEntries(u.searchParams);
          const bilinen = istemciler.has(q.client_id) || q.client_id === ayar.istemciKimligi;
          if (!bilinen || !geriDonusGecerli(q.redirect_uri) || q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) {
            return yaz(res, 400, { error: 'invalid_request', bilinen, geri: geriDonusGecerli(q.redirect_uri) });
          }
          const hedef = new URL(q.redirect_uri);
          if (q.state) hedef.searchParams.set('state', q.state);
          if (ayar.izinReddet) hedef.searchParams.set('error', 'access_denied');
          else {
            const kod = `kod_${rastgele()}`;
            kodlar.set(kod, { client_id: q.client_id, redirect_uri: q.redirect_uri, cc: q.code_challenge, kullanildi: false });
            hedef.searchParams.set('code', kod);
          }
          res.writeHead(302, { location: hedef.href });
          return res.end();
        }
        if (req.method === 'POST' && u.pathname === '/token') return await belirtec(req, res, new URLSearchParams(ham));
        if (u.pathname === '/mcp') {
          if (req.method === 'POST') return await mcpYanitla(req, res, govde);
          res.writeHead(405, { allow: 'POST' });
          return res.end();
        }
        res.writeHead(404);
        res.end();
      } catch (e) {
        if (!res.headersSent) yaz(res, 500, { error: String(e?.message ?? e) });
      }
    });
  });
  await new Promise((c) => sunucu.listen(0, '127.0.0.1', c));
  const adres = `http://127.0.0.1:${sunucu.address().port}`;
  return {
    adres, istekler, cagrilar, belirtecIstekleri, verilenler, kesilenler,
    get genel() { return ayar.genel; },
    get mcpAdresi() { return `${ayar.genel}/mcp`; },
    /** Gizli istemcide sunucunun (Fuber aracısının) belirteç isteğini göndereceği gerçek adres (http, bu kapı). */
    get belirtecUcu() { return `${adres}/token`; },
    ayarla: (x) => Object.assign(ayar, x),
    ayar: () => ({ ...ayar }),
    /** Bütün erişim belirteçlerinin süresi dolar (yenileme belirteçleri geçerli kalır). */
    surumuDoldur: () => { for (const e of erisimler.values()) e.son = 0; },
    /** Bekletilen yanıtları salar. */
    birak: () => { const l = bekleyenler; bekleyenler = []; for (const b of l) b.coz('birakildi'); },
    /** Şu an yanıt bekleyen (istemcinin kesmediği) istek sayısı. */
    bekleyenSayisi: () => bekleyenler.filter((b) => !b.kapandi).length,
    temizle: () => { istekler.length = 0; cagrilar.length = 0; belirtecIstekleri.length = 0; kesilenler.length = 0; },
    kapat: () => new Promise((c) => { for (const b of bekleyenler) b.coz('kapandi'); sunucu.closeAllConnections(); sunucu.close(() => c()); }),
  };
}
