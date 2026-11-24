// Görev 26 / Ruling CF + son dalga B (M4) — gerçek ikili dumanında Agent SDK'nın `query`'si korumalarla sarılır; motorun KENDİ seçenekleri
// (settingSources, managedSettings, strictMcpConfig, disallowedTools — sınanan şey bunlar) OLDUĞU GİBİ geçer, yalnız aşağıdakiler eklenir:
//  • Araç İZİN LİSTESİ: `tools` = senaryonun listesi (varsayılan Read, Glob, Grep; Bash yalnız onu sınayan senaryoda). Eski kara liste
//    (disallowedTools) değil: listede olmayan hiçbir yerleşik araç modele görünmez.
//  • env: TEST anahtarı ANTHROPIC_API_KEY (kişisel abonelik değil); başka kimlik/taban değişkeni geçmez; güncelleyici ve zorunlu
//    olmayan trafik kapalı. Süreç başlamadan DENETLENİR (kapalı başarısızlık): CLAUDE_CONFIG_DIR = geçici dizin (gerçek ~/.claude
//    DEĞİL), anahtar test anahtarı, OAuth belirteci yok, cwd geçici kökün içinde, izinsiz bayrak yok, model sabit.
//  • persistSession: false (oturum dökümü yazılmaz).
//  • canUseTool önce burada süzülür: Read/Glob/Grep yalnız geçici klasörün içinde ve motorun izin yoluyla; Bash/PowerShell motorun izin
//    yoluna iletilir (koşum onları REDDEDER — sınanan "masada onay bekler" yolu); gerisi anında reddedilir. Her çağrı kaydedilir.
//  • SDK kancaları: PreToolUse (Bash/PowerShell) yalnız senaryonun izinli zararsız komutlarını geçirir, gerisini REDDEDER (bir allow kuralı
//    komutu canUseTool'a sormadan çalıştırırsa bile yalnız `echo … > isaret-*.txt`/`ls` çalışabilir); PostToolUse bir komutun GERÇEKTEN
//    çalıştığını kaydeder; SessionStart oturum açılış olayını kaydeder.
//  • system/init'ten yalnız ADLAR (apiKeySource, eklenti adları, MCP sunucu adı + hâli) ve sayılar kaydedilir; anahtar hiçbir yere yazılmaz.
// Modül yüklenince `globalThis.__ccDuman.sarmal = 'yuklendi'`: koşum süreç açmadan önce bunu ister (kanca.mjs yönlendirmesi çalışmadıysa
// gerçek SDK yüklenir, işaret konmaz ve koşum hiçbir şey başlatmadan düşer).
import fs from 'node:fs';
import path from 'node:path';
import * as gercek from '@anthropic-ai/claude-agent-sdk';

export * from '@anthropic-ai/claude-agent-sdk';

const d = () => globalThis.__ccDuman;
if (globalThis.__ccDuman) globalThis.__ccDuman.sarmal = 'yuklendi';

const OKUMA = new Set(['Read', 'Glob', 'Grep']);
const KOMUT = new Set(['Bash', 'PowerShell']);
const icinde = (kok, p) => {
  try {
    const k = fs.realpathSync(kok).toLowerCase();
    const t = path.resolve(kok, String(p ?? '.'));
    const g = (fs.existsSync(t) ? fs.realpathSync(t) : t).toLowerCase();
    return g === k || g.startsWith(k + path.sep);
  } catch { return false; }
};
/** Okuma aracı ve yalnız senaryonun geçici klasörünün içi (yol verilmemişse cwd = geçici klasör). */
export function okumaIzinliMi(arac, girdi) {
  if (!OKUMA.has(arac)) return false;
  const kok = d().senaryo.cwd;
  const yollar = [girdi?.file_path, girdi?.path].filter((x) => x !== undefined && x !== null && x !== '');
  if (typeof girdi?.pattern === 'string' && arac === 'Glob' && /(^|[\\/])\.\.([\\/]|$)|^[a-z]:|^[\\/]/i.test(girdi.pattern)) return false;
  return yollar.every((y) => icinde(kok, y));
}
/** PreToolUse kalkanı: yalnız zararsız, geçici klasör içi komutlar (senaryo istemindekiler) geçer. */
export const zararsizKomut = (k) => /^(echo fuber-[a-d] > isaret-[a-d]\.txt|ls( -[A-Za-z1]+)?( \.)?|pwd|dir)$/.test(String(k ?? '').trim());
const DUZENLEME = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export const KALKAN_RET = (neden) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Duman testi kalkanı: ${neden}` } });
/** Kalkan (PreToolUse) sarmalayıcısı: içteki denetim hata verirse REDDEDER — düşüp geçmez (tests/cc-duman-kalkan.test.ts). */
export const kalkanSar = (f, hataKaydet = () => {}) => async (girdi) => {
  try { return (await f(girdi)) ?? {}; } catch { try { hataKaydet(); } catch { /* yok */ } return KALKAN_RET('kalkan denetleyemedi'); }
};
const komutOzeti = (g) => String(g?.command ?? '').slice(0, 200);
const KORUMA = (m) => { throw new Error(`DUMAN KORUMASI: ${m}`); };

export function query(a) {
  const o = a.options ?? {};
  const s = d()?.senaryo;
  if (!s || d().sarmal !== 'yuklendi') KORUMA('senaryo/sarmal yok');
  // CF: atlatma yok; izin modu default ya da (telefon oturumlarının gerçek modu, düzeltme turu) acceptEdits — düzenlemeler yalnız geçici
  // klasörün içinde (aşağıdaki PreToolUse kalkanı dışını reddeder); model sabit.
  if (!['default', 'acceptEdits'].includes(o.permissionMode) || o.allowDangerouslySkipPermissions) KORUMA(`izin modu default/acceptEdits olmalı, atlatma yok (${o.permissionMode})`);
  if (o.model !== 'claude-sonnet-5-5') KORUMA(`model claude-sonnet-5-5 olmalı (${o.model})`);
  const env = {};
  for (const [k, v] of Object.entries(o.env ?? {})) if (!/^(ANTHROPIC_|CLAUDE_CODE_OAUTH|CLAUDE_CODE_SESSION_ACCESS|CLAUDECODE$|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_SSE_PORT)/i.test(k)) env[k] = v;
  env.ANTHROPIC_API_KEY = d().anahtar;
  env.DISABLE_AUTOUPDATER = '1';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  if (path.resolve(env.CLAUDE_CONFIG_DIR ?? '') !== path.resolve(d().yapilandirma)) KORUMA('CLAUDE_CONFIG_DIR geçici dizin değil');
  const asilIzin = o.canUseTool;
  const canUseTool = async (arac, girdi, x) => {
    const kayit = { senaryo: s.ad, arac, komut: komutOzeti(girdi) || null, yol: girdi?.file_path ?? girdi?.path ?? null, izin: false, neden: typeof x?.decisionReason === 'string' ? x.decisionReason.slice(0, 200) : null };
    d().izinler.push(kayit);
    if (KOMUT.has(arac)) return asilIzin(arac, girdi, x); // motorun izin yolu: koşumun izinBekliyor'u REDDEDER
    if (!okumaIzinliMi(arac, girdi)) return { behavior: 'deny', message: 'Bu duman testinde yalnız geçici klasörün içinde Read/Glob/Grep izinli.' };
    kayit.izin = true;
    return asilIzin(arac, girdi, x);
  };
  const kanca = (f) => async (girdi) => { try { return (await f(girdi)) ?? {}; } catch { return {}; } };
  // Kalkan (PreToolUse) hata verirse REDDEDER (düzeltme turu: düşüp geçmez).
  const kalkan = (f) => kalkanSar(f, () => d().kalkan.push({ senaryo: s.ad, komut: 'kalkan hata verdi' }));
  // Motorun KENDİ PreToolUse kancaları kayıt altında (çağrıldı mı, ne dedi) — değişmeden.
  const motorKancalari = (o.hooks?.PreToolUse ?? []).map((m) => ({ ...m, hooks: m.hooks.map((h) => async (girdi, id, x) => {
    const y = await h(girdi, id, x);
    d().motorKanca.push({ senaryo: s.ad, arac: girdi?.tool_name, yol: girdi?.tool_input?.file_path ?? null, komut: komutOzeti(girdi?.tool_input) || null, karar: y?.hookSpecificOutput?.permissionDecision ?? null });
    return y;
  }) }));
  const hooks = {
    ...(o.hooks ?? {}),
    PreToolUse: [...motorKancalari, { matcher: 'Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit', hooks: [kalkan((g) => {
      if (DUZENLEME.has(g.tool_name)) {
        const hedef = g.tool_input?.file_path ?? g.tool_input?.notebook_path;
        if (typeof hedef === 'string' && icinde(d().kok, path.resolve(s.cwd, hedef))) return {};
        d().kalkan.push({ senaryo: s.ad, komut: `${g.tool_name} ${String(hedef).slice(0, 160)}` });
        return KALKAN_RET('düzenleme yalnız geçici kökün içinde.');
      }
      const k = g.tool_input?.command;
      if (zararsizKomut(k)) return {};
      d().kalkan.push({ senaryo: s.ad, komut: komutOzeti(g.tool_input) });
      return KALKAN_RET('yalnız istemdeki zararsız komut.');
    })] }],
    PostToolUse: [...(o.hooks?.PostToolUse ?? []), { matcher: 'Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit', hooks: [kanca((g) => {
      d().calisan.push(DUZENLEME.has(g.tool_name) ? { senaryo: s.ad, arac: g.tool_name, yol: String(g.tool_input?.file_path ?? ''), komut: '' } : { senaryo: s.ad, arac: g.tool_name, komut: komutOzeti(g.tool_input) });
      return {};
    })] }],
    SessionStart: [...(o.hooks?.SessionStart ?? []), { hooks: [kanca((g) => { d().acilis.push({ senaryo: s.ad, kaynak: String(g.source ?? '') }); return {}; })] }],
  };
  const asilSpawn = o.spawnClaudeCodeProcess;
  const spawnClaudeCodeProcess = (so) => {
    // Süreç açılmadan son denetim (kapalı başarısızlık).
    const e = so.env ?? {};
    if (path.resolve(e.CLAUDE_CONFIG_DIR ?? '') !== path.resolve(d().yapilandirma)) KORUMA('spawn: CLAUDE_CONFIG_DIR');
    if (e.ANTHROPIC_API_KEY !== d().anahtar) KORUMA('spawn: test anahtarı');
    if (Object.keys(e).some((k) => /^CLAUDE_CODE_OAUTH|^ANTHROPIC_(AUTH_TOKEN|BASE_URL)$/i.test(k))) KORUMA('spawn: kimlik değişkeni');
    if (!icinde(d().kok, so.cwd)) KORUMA('spawn: cwd geçici kökün dışında');
    if ((so.args ?? []).some((x) => /dangerously-skip-permissions/.test(String(x)))) KORUMA('spawn: izinsiz bayrak');
    d().spawn.push({ senaryo: s.ad, args: (so.args ?? []).filter((x) => String(x).startsWith('--')).map((x) => String(x).split('=')[0]) });
    return asilSpawn ? asilSpawn(so) : KORUMA('spawn: motorun süreç kancası yok');
  };
  d().secenekler.push({ senaryo: s.ad, settingSources: o.settingSources ?? null, strictMcpConfig: o.strictMcpConfig ?? false, managedSettings: o.managedSettings ?? null, disallowedTools: o.disallowedTools ?? null, tools: s.araclar });
  // Senaryo D (düzeltme turu): geçici kökteki ikinci klasör çalışma dizini (--add-dir) olur → "Düzenlemelere izin ver" oraya yazımı normalde
  // SORMADAN onaylar; motorun kancası 'ask' derse canUseTool'a gelir (decisionReason kaydedilir).
  const q = gercek.query({ ...a, options: { ...o, env, canUseTool, hooks, spawnClaudeCodeProcess, tools: s.araclar, persistSession: false, ...(s.ekKlasorler ? { additionalDirectories: s.ekKlasorler } : {}) } });
  // Query'nin yineleyicisi ayrı bir üreteç (sdk.mjs: [Symbol.asyncIterator]() { return this.sdkMessages }): onu sararak dinle.
  const asilYineleyici = q[Symbol.asyncIterator].bind(q);
  q[Symbol.asyncIterator] = () => {
    const it = asilYineleyici();
    return {
      async next(...x) {
        const r = await it.next(...x);
        const m = r.value;
        if (!r.done && m && m.type === 'system' && m.subtype === 'init') {
          d().init.push({ senaryo: s.ad, apiKeySource: m.apiKeySource, surum: m.claude_code_version, model: m.model, izinModu: m.permissionMode,
            mcp: (m.mcp_servers ?? []).map((v) => `${String(v?.name ?? '?').slice(0, 40)}:${String(v?.status ?? '?').slice(0, 20)}`),
            eklentiler: (m.plugins ?? []).map((p) => String(p?.name ?? p).slice(0, 60)), araclar: (m.tools ?? []).map((t) => String(t).slice(0, 40)) });
        }
        if (!r.done && m && m.type === 'result') d().sonuc.push({ senaryo: s.ad, subtype: m.subtype, is_error: m.is_error, total_cost_usd: m.total_cost_usd, num_turns: m.num_turns, duration_ms: m.duration_ms });
        return r;
      },
      return: (v) => it.return?.(v) ?? Promise.resolve({ done: true, value: v }),
      throw: (e) => it.throw?.(e) ?? Promise.reject(e),
      [Symbol.asyncIterator]() { return this; },
    };
  };
  return q;
}
