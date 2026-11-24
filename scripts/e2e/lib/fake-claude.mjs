// Tek sahte Claude Code ikilisi (sınama fikstürü): `FUBER2_CLAUDE_CLI` buna bakar ve aynı koşuda derin beyin, konuşan
// beyin ve uygulama içi Claude Code oturumları sahte CLI ile çalışır. Gerçek CLI gibi alt kip ARGÜMANDAN seçilir:
//
//   -p + --mcp-config  (kalıcı, akış girdili süreç: KONUŞAN BEYİN; araçlar MCP'den) → brain/fake-claude-brain.mjs
//   -p / --print       (başsız tek koşu: derin beyin, Atölye, araştırma)             → workshop/fake-claude.mjs
//   gerisi             (akış girdili etkileşimli oturum, `auth`, `agents`)            → projects/fake-claude-session.mjs
//
// `--version` ve `auth status` iki fikstürde de vardır ve varsayılanları aynıdır (2.1.325, oturum açık). Başsız fikstürün
// kendi ayarı (`FAKE_CLAUDE_AUTH`, `FAKE_CLAUDE_VERSION`) verilmişse bu kısa alt komutlar da ona gider; oturum fikstürünün
// ayarları `SAHTE_CC_*` değişkenleridir. Ağ kullanmaz, kotadan harcamaz.
const argv = process.argv.slice(2);
const headless = argv.includes('-p') || argv.includes('--print');
const brain = headless && argv.includes('--mcp-config');
const shortCommand = argv[0] === '--version' || (argv[0] === 'auth' && argv[1] === 'status');
const headlessKnobs = process.env.FAKE_CLAUDE_AUTH !== undefined || process.env.FAKE_CLAUDE_VERSION !== undefined;

await import(brain ? '../brain/fake-claude-brain.mjs' : headless || (shortCommand && headlessKnobs) ? '../workshop/fake-claude.mjs' : '../projects/fake-claude-session.mjs');
