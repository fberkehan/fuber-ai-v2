// ── Komut sınıflama (0.14 T18, R8; saf → birim testli: tests/komut-siniflama.test.ts) ─────────────────────────────────────────────────
// Claude Code gibi çalışır; onay YALNIZ geri dönüşsüz adımda. komut_calistir (yalnız Developer mode; main/ajan/araclar/komut.ts) her komutu
// çalıştırmadan önce buradan geçirir:
//   · serbest — okuyan BİLİNEN komutlar (git status/log/diff/show/branch, dir/ls/Get-ChildItem, type/cat/Get-Content, where,
//     Get-Command …): sormadan çalışır. Son inceleme tur 2 (N1): çalışma klasöründeki ayarla kendi kodunu seçebilen hiçbir başlatıcı (npm, node, pip,
//     python, go, cargo, dotnet, gradle/mvn sarmalayıcıları, .cmd/.bat kabukları) — sürüm sorgusu dahil — serbest değil. Liste kapalıdır: adı tanıdık olsa da yazan/çalıştıran biçimi (git branch yeni,
//     git diff --output, node -e, npm run build) serbest DEĞİL. Son inceleme C1: proje kodunu çalıştıran komut (npm test, npm run …, node dosya,
//     python dosya, make …) dosyaları kim yazmış olursa olsun HER SEFERİNDE onay ister.
//   · onay / 'ag'       — bu bilgisayardan dışarı çıkan komut (curl, Invoke-WebRequest, npm install, pip install, git push/pull, ssh, ağ yolu \\sunucu).
//   · onay / 'yikici'   — bilinen yıkıcı komutlar (rm, del, Remove-Item, Set-Content, format, git reset --hard, git push --force …), dosyaya
//     yönlendirme (>, >>, 2>) ve TANINMAYAN her komut. Kart "dosyaları ya da sistemi değiştirebilir" der (yıkıcı olduğunu iddia etmez).
//   · onay / 'karmasik' — bileşik ya da okunması güç yapı: ; && || | ters tırnak, $( ) @( ) ( ) { }, satır sonu, kapanmayan tırnak; sarmalayıcı
//     ve başka süreç başlatan komutlar (& . cmd powershell pwsh Start-Process iex Invoke-Command …).
// Denetim büyük-küçük harf duyarsızdır. Tırnak içindeki ayırıcı komutu bileşik yapmaz; çift tırnak içindeki $( ) ve ters tırnak yapar (PowerShell
// genişletir). Akış birleştirme (2>&1) ve $null'a / NUL'a yönlendirme dosyaya yazmadığı için yönlendirme sayılmaz (denetleyici onayı).
// Düzeltme turu 1: git okuma komutları depo ayarındaki programı başlatabilir — --ext-diff/--textconv/--show-signature/%G serbest değil, blame çıktı;
// serbest git komutunu komut.ts sertleştirir (gitKomutunuSertlestir: diff/log/show'a --no-ext-diff --no-textconv; ortam ve depo denetimi orada). Uzun
// tireler (– — ―) "-" sayılarak da denetlenir.
// Düzeltme turu 3: ham metinde ASCII çift tırnak (") geçen komut hiç serbest değildir (karmasik); boşluk içerip ters bölüyle biten değer de. status ve
// diff alt modülleri komut satırı seçeneğiyle bastırır; describe serbest değil. Sertleştirme yalnız serbest git komutuna; onaylı git normal davranışla çalışır.
// Düzeltme turu 4 (denetleyici kararı: ince ayrıştırma yerine kaba ama sağlam kurallar; her ince ayar yeni bir kenar açıyordu):
//   · Sarmalayıcıdan (& . cmd /c /k, powershell/pwsh -c -Command -EncodedCommand -File, Start-Process …) geçen komut hiç serbest değildir ('karmasik');
//     iç komut ayrıştırılmaz — model iç komutu doğrudan çağırabilir, bir şey kaybolmaz.
//   · Ham metinde % geçen komut serbest değildir; serbest YEREL programın (git, npm, where.exe …) ham metninde $ ya da @ geçerse de (değişkenin açılmış
//     değeri yerine). npm (betik kabuğu) argümanında cmd işleci varsa da. Çift tırnak kuralı (tur 3) sürer.
//   · Serbest git komutunda kullanıcının verdiği alt modül seçeneği serbest değildir; log ve show da --ignore-submodules=all alır.
//   · Bu biçim kuralları yüzünden onaya düşen komutun kartı birden çok komut iddia etmez (komutBicimdenOnay; metin komut.ts BICIM_METNI).
// Düzeltme turu 5 (denetleyici kararı: ayrıştırma ayrışmasını kökten kapatan GÜVENLİ KARAKTER KAPISI; GUVENLI_KARAKTER):
//   · Bir komut serbest olamıyorsa önce burada durur: ham metnin her karakteri yalnız harf (\p{L}), rakam, ASCII boşluk ve - _ . / \ : = , olacak. Tırnak,
//     $ % @ & ; | < > ( ) { } [ ] # ! ~ ve uzun tire içeren komut serbest DEĞİL (karmaşık, nötr kart). Kapıdan geçen komut boşlukla bölününce PowerShell'in
//     argv'si ile birebir: bitişik tırnak, boş argüman ve genişleme ayrışması olamaz. Önceki turların tırnak/%/$/@ yüzey kuralları ve npm işleç kuralı bu
//     kapıya katlandı. Tek tırnaklı yol okuma ve akış birleştirme (2>&1, >NUL) artık kart ister. Öz denetim: kümedeki virgül (başta, sonda, ardından -)
//     ve parametre adındaki nokta ("-a.b") PowerShell'de sözcüğü böler (5.1'de sınandı) — o biçimler de serbest değil (argvAyrisir).
//   · Uzak bilgisayar / oturum parametresi (computername ve kısaltmaları, cn, cmdlet'te tek c, computer/session geçen ad) → ag (uzakBilgisayarParam); yerel
//     modda bileşik/sarmalayıcılı komutun her parçasında aranır (uzakParamVar; yıkıcı cmdlet yıkıcı kalır ama yerel modda reddedilir).
//   · Ham metinde ağ yolu (\\ // /\ \/) → ag (AG_YOLU_HAM); yerel aygıt/uzun yol (\\.\, \\?\) yolNedeni ile yıkıcı kalır. Yerel modda metnin her yerinde
//     aranır (AG_YOLU_HER).
// "Yalnız bu bilgisayar" seçiliyken ağa çıkan komut hiç çalışmaz (komutAgaCikar: ağ sınıfı + yıkıcı ama ağa çıkan + bileşiğin/sarmalayıcının içindeki ağ komutu,
// adres ve ağ yolu) ve içi görülemeyen sarmalayıcı reddedilir (komutIciGorulmez); Gizli'de ve Business mode'da araç listede yoktur (komutAraciAcik).
import { modKip } from './karakterler.ts';
import type { Mod } from './tipler.ts';

export type KomutNedeni = 'yikici' | 'ag' | 'karmasik';
export interface KomutSinifi { sinif: 'serbest' | 'onay'; neden?: KomutNedeni }

/** R8: komutun kendi süre sınırı (süreç başladıktan sonra; onay beklenirken saymaz). */
export const KOMUT_SURE_MS = 120_000;
/** Ajan döngüsünün bu araca tanıdığı süre (dongu.ts araciCalistir): komutun sınırı + kapanış payı — komut önce kapanır, o ana dek çıktısı modele gider. */
export const KOMUT_ARAC_SURESI_MS = KOMUT_SURE_MS + 15_000;
/** "Yalnız bu bilgisayar" seçiliyken ağa çıkan komutun tek satırlık yanıtı (shared/bulut-kapisi.ts BULUT_KAPALI_METNI deseni). */
export const KOMUT_AG_KAPALI_METNI = 'Bu bilgisayardan dışarı çıkan komutlar "Yalnız bu bilgisayar" seçiliyken çalışmaz.';
/** "Yalnız bu bilgisayar" seçiliyken içi görülemeyen sarmalayıcının (komutIciGorulmez) tek satırlık yanıtı (ağ reddiyle aynı aile). */
export const KOMUT_GORULMEZ_METNI = 'Bu komutun ne yaptığı görülemediği için "Yalnız bu bilgisayar" seçiliyken çalıştırılmaz.';

/** dongu.ts grupEtkin('komut'): yalnız Developer mode (turun kilitli kipiyle aynı eşleme: karakterler.ts modKip — kod-isleri.ts komutNotu 'developer'
 *  kipine bakar) ve Gizli kapalıyken. */
export function komutAraciAcik(o: { mod: Mod; gizliMod: boolean }): boolean {
  return modKip(o.mod) === 'developer' && !o.gizliMod;
}

const SERBEST: KomutSinifi = { sinif: 'serbest' };
const AG: KomutSinifi = { sinif: 'onay', neden: 'ag' };
const YIKICI: KomutSinifi = { sinif: 'onay', neden: 'yikici' };
const KARMASIK: KomutSinifi = { sinif: 'onay', neden: 'karmasik' };

// ── Listeler (küçük harf; .exe/.cmd/.bat/.com uzantısı ve yol atılmış ad) ────────────────────────────────────────────────────────────────
/** Her argümanla okuyan komutlar (yönlendirme ve bileşik yapı ayrıca denetlenir). PowerShell'de `where` Where-Object'tir: zararsız. */
const OKUYANLAR = new Set([
  'dir', 'ls', 'gci', 'get-childitem', 'type', 'cat', 'gc', 'get-content', 'where', 'get-command', 'gcm',
  'pwd', 'get-location', 'gl', 'echo', 'write', 'write-output', 'write-host', 'whoami', 'get-date', 'get-process', 'ps', 'gps',
  'get-item', 'gi', 'get-itemproperty', 'gp', 'test-path', 'resolve-path', 'rvpa', 'split-path', 'join-path', 'select-string', 'sls', 'findstr',
  'tree', 'get-filehash', 'get-service', 'gsv', 'get-alias', 'gal', 'get-acl', 'ver',
]);
/** Yalnız `--version` ile serbest (sürüm sorgusu). 0.14 son inceleme C1 + Minor 4: sürüm sorgusu bile araç zinciri indirebilen ya da proje ayarını
 *  çalıştıran programlar listeden çıktı — yarn/pnpm/bun (corepack, .yarnrc yarnPath), go (go.mod toolchain), rustc/cargo (rust-toolchain.toml, rustup),
 *  python/python3/py (Python kurulum yöneticisi eksik sürümü kendiliğinden kurabilir). Bunlar onay ister. */
// Son inceleme tur 2 (N1): liste BOŞ — sürüm sorgusu bile başlatıcının kendi kodunu çalışma klasöründeki ayarla seçmesine yol açabilir (npm'in Windows
// başlatıcısı klasörün .npmrc'sini okur; Volta/corepack/global.json/rust-toolchain/.python-version). Serbest kalan tek sürüm sorgusu sertleştirilmiş git'tir.
const SURUM_ARACLARI = new Set<string>();
/** Bilinen yıkıcı komutlar ve takma adları (bilinmeyen her komut da yıkıcı sayılır; liste niyeti açık eder ve okuma listesiyle çakışmayı önler). */
const YIKICILAR = new Set([
  'rm', 'del', 'erase', 'ri', 'rd', 'rmdir', 'remove-item', 'mv', 'move', 'mi', 'move-item', 'ren', 'rni', 'rename', 'rename-item',
  'sc', 'ac', 'clc', 'set-content', 'add-content', 'clear-content', 'out-file', 'tee', 'tee-object', 'copy-item', 'copy', 'cp', 'cpi', 'xcopy', 'robocopy',
  'stop-process', 'kill', 'spps', 'taskkill', 'format', 'format-volume', 'diskpart', 'reg', 'regedit', 'schtasks', 'icacls', 'cacls', 'takeown', 'attrib',
  'set-executionpolicy', 'shutdown', 'stop-computer', 'restart-computer', 'bcdedit', 'cipher', 'vssadmin', 'wmic', 'sfc', 'dism', 'chkdsk', 'fsutil',
  'new-item', 'ni', 'mkdir', 'md', 'set-item', 'si', 'set-itemproperty', 'sp', 'new-itemproperty', 'remove-itemproperty', 'rp', 'clear-item', 'cli',
  'clear-recyclebin', 'set-acl', 'setx',
]);
/** Ağa çıkan programlar (her biçimde). */
const AG_PROGRAMLARI = new Set([
  'curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod', 'start-bitstransfer', 'bitsadmin', 'certutil', 'ssh', 'scp', 'sftp', 'ftp', 'tftp',
  'telnet', 'nc', 'ncat', 'netcat', 'ping', 'tracert', 'pathping', 'nslookup', 'resolve-dnsname', 'test-connection', 'test-netconnection', 'tnc',
  'send-mailmessage', 'enter-pssession', 'etsn', 'new-pssession', 'nsn', 'mstsc', 'net', 'rsync', 'rclone', 'npx', 'pnpx', 'bunx', 'uvx', 'winget', 'choco',
  'scoop', 'nuget', 'gh', 'az', 'aws', 'gcloud', 'gsutil', 'kubectl', 'helm', 'terraform', 'vercel', 'netlify', 'firebase', 'wrangler', 'heroku', 'fly', 'flyctl',
  'install-module', 'update-module', 'find-module', 'save-module', 'publish-module', 'install-package', 'find-package', 'install-script', 'update-help', 'save-help',
]);
/** Alt komutuyla ağa çıkan paket yöneticileri (`*` = alt komutsuz çağrı da ağa çıkar: yarn = yarn install). */
const AG_ALT_KOMUTLARI: Record<string, ReadonlySet<string>> = {
  npm: new Set(['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall', 'add', 'ci', 'clean-install', 'ic', 'install-clean',
    'install-test', 'it', 'cit', 'sit', 'update', 'up', 'upgrade', 'udpate', 'publish', 'unpublish', 'audit', 'outdated', 'view', 'v', 'info', 'show', 'search',
    's', 'se', 'find', 'login', 'logout', 'adduser', 'add-user', 'exec', 'x', 'ping', 'init', 'create', 'dist-tag', 'owner', 'access', 'team', 'org', 'hook',
    'star', 'unstar', 'stars', 'whoami', 'token', 'profile', 'deprecate', 'doctor', 'repo', 'docs', 'bugs', 'home']),
  yarn: new Set(['*', 'install', 'add', 'upgrade', 'up', 'global', 'dlx', 'create', 'publish', 'outdated', 'info', 'npm', 'login', 'audit']),
  pnpm: new Set(['install', 'i', 'add', 'update', 'up', 'upgrade', 'dlx', 'create', 'publish', 'outdated', 'audit', 'fetch', 'info', 'view', 'login']),
  bun: new Set(['install', 'i', 'add', 'update', 'upgrade', 'x', 'create', 'publish', 'outdated']),
  pip: new Set(['install', 'download', 'wheel', 'search', 'index']),
  pip3: new Set(['install', 'download', 'wheel', 'search', 'index']),
  uv: new Set(['pip', 'add', 'sync', 'lock', 'tool', 'run', 'python', 'publish']),
  cargo: new Set(['install', 'add', 'update', 'fetch', 'publish', 'search', 'login', 'yank', 'owner']),
  go: new Set(['get', 'install', 'mod']),
  dotnet: new Set(['add', 'restore', 'tool', 'nuget', 'workload']),
  docker: new Set(['pull', 'push', 'login', 'logout', 'search']),
  conda: new Set(['install', 'create', 'update', 'upgrade', 'search']),
  mamba: new Set(['install', 'create', 'update', 'upgrade', 'search']),
  poetry: new Set(['install', 'add', 'update', 'lock', 'publish']),
  gem: new Set(['install', 'update', 'push', 'fetch']),
};
/** git'in ağa çıkan alt komutları (remote yalnız show/update/prune ile). */
const GIT_AG = new Set(['push', 'pull', 'fetch', 'clone', 'ls-remote', 'submodule', 'lfs', 'svn', 'send-email', 'request-pull']);
/** Başka bir komutu ya da süreci çalıştıran komutlar: sarmalayıcıdır, her biçimde karmaşık (düzeltme turu 4, Y-1; iç komut ayrıştırılmaz). Baştaki & ve .
 *  de sarmalayıcıdır (cozumle). */
const BASLATICILAR = new Set(['cmd', 'powershell', 'pwsh', 'iex', 'invoke-expression', 'start-process', 'saps', 'start', 'invoke-command', 'icm', 'start-job',
  'sajb', 'start-threadjob', 'invoke-item', 'ii', 'bash', 'sh', 'wsl', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32', 'runas', 'call', 'forfiles']);

/** Uzantısıyla (.exe/.cmd) yazılınca da serbest kalan gerçek programlar (Minor 3); öbür okuma adları PowerShell takma adı/cmdlet'tir. */
const UZANTILI_SERBEST = new Set(['git', 'where', 'findstr', 'tree', 'whoami', 'hostname', ...SURUM_ARACLARI]);

/** Sözcüğün komut adı: küçük harf, yol ve çalıştırılabilir uzantısı atılmış ("C:\Git\cmd\git.exe" → "git"). */
const taban = (s: string): string => s.toLowerCase().split(/[\\/]/).pop()!.replace(/\.(?:exe|cmd|bat|com)$/, '');

// ── Ayrıştırma ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Düzeltme turu 4: yalnız PowerShell bağlamı (sarmalayıcının içi ayrıştırılmaz, cmd bağlamı kalktı). Değişkenler sözcük başına izlenmez: serbest yerel
 *  programın ham metninde $ geçerse komut serbest değildir (komutSinifi). */
interface Ayrisim { kelimeler: string[]; karmasik: boolean; yazar: boolean }

// PowerShell kıvrık tırnakları da tırnak sayar (‘ ’ ‚ ‛ tek, “ ” „ çift).
const TEK = new Set(["'", '‘', '’', '‚', '‛']);
const CIFT = new Set(['"', '“', '”', '„']);
const BOSLUK = /\s/;
/** Hiçbir yere yazmayan yönlendirme hedefleri: $null ve aygıt adı NUL (tam ad, harf duyarsız; nul.txt değil). */
const bosHedefMi = (h: string): boolean => { const x = h.toLowerCase(); return x === 'nul' || x === '$null'; };

/**
 * Komut metnini sözcüklere ayırır (tırnaklar açılır). Bileşik/okunması güç yapıda `karmasik`, dosyaya yönlendirmede `yazar`. Tek tırnak birebir
 * ('' = '), çift tırnak içinde $( ve ters tırnak karmaşık. Baştaki & bir sözcük olarak kalır (sarmalayıcı: cozumle).
 */
function ayristir(t: string): Ayrisim {
  const kelimeler: string[] = [];
  let k = '';
  let kelimeVar = false;
  let yazar = false;
  const bitir = () => { if (kelimeVar) kelimeler.push(k); k = ''; kelimeVar = false; };
  const karmasik = (): Ayrisim => ({ kelimeler, karmasik: true, yazar });
  /** `i`'deki tırnaktan kapanan tırnağa dek: [içerik, kapanışın indeksi] ya da null (kapanmıyor / içi karmaşık). */
  const tirnak = (i: number): [string, number] | null => {
    const tekMi = TEK.has(t[i]);
    const kume = tekMi ? TEK : CIFT;
    let s = '';
    for (let j = i + 1; j < t.length; j++) {
      const d = t[j];
      if (!tekMi && (d === '`' || (d === '$' && t[j + 1] === '('))) return null;
      if (kume.has(d)) {
        if (kume.has(t[j + 1] ?? '')) { s += d; j++; continue; } // '' ya da "" kaçışı
        return [s, j];
      }
      s += d;
    }
    return null;
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (BOSLUK.test(c)) { bitir(); continue; }
    if (TEK.has(c) || CIFT.has(c)) {
      const r = tirnak(i);
      if (!r) return karmasik();
      k += r[0]; kelimeVar = true; i = r[1];
      continue;
    }
    if ('`;|(){}<'.includes(c)) return karmasik();
    if (c === '&') {
      if (!kelimeler.length && !kelimeVar) { kelimeler.push('&'); continue; } // baştaki çağrı işleci
      return karmasik();
    }
    if ((c === '$' || c === '@') && '({'.includes(t[i + 1] ?? '')) return karmasik();
    if (c === '@' && (TEK.has(t[i + 1] ?? '') || CIFT.has(t[i + 1] ?? ''))) return karmasik(); // here-string
    if (c === '#' && !kelimeVar) return karmasik(); // yorum: gerisi okunmaz
    if (c === '>') {
      // Akış numarası (2>, *>) yönlendirmenin parçasıdır; başka bir sözcük ise sözcük biter.
      if (kelimeVar && /^[1-6*]$/.test(k)) { k = ''; kelimeVar = false; } else bitir();
      let j = i + 1;
      if (t[j] === '>') j++;
      if (t[j] === '&') {
        if (/[1-6]/.test(t[j + 1] ?? '')) { i = j + 1; continue; } // 2>&1: akış birleştirme, dosyaya yazmaz
        return karmasik();
      }
      while (j < t.length && BOSLUK.test(t[j])) j++;
      let hedef = '';
      if (j < t.length && (TEK.has(t[j]) || CIFT.has(t[j]))) {
        const r = tirnak(j);
        if (!r) return karmasik();
        hedef = r[0] || '""'; j = r[1] + 1;
      } else {
        while (j < t.length && !BOSLUK.test(t[j]) && !';|&<>(){}`'.includes(t[j])) { hedef += t[j]; j++; }
      }
      if (!hedef) return karmasik();
      if (!bosHedefMi(hedef)) yazar = true;
      i = j - 1;
      continue;
    }
    k += c; kelimeVar = true;
  }
  bitir();
  return { kelimeler, karmasik: false, yazar };
}

// ── Kurallar ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** git'in komuttan önceki genel seçenekleri: yalnız zararsızlar atlanır (-c, --exec-path gibi komut çalıştırabilenler değil). Kalan [alt komut, ...]. */
function gitGenel(arg: readonly string[]): string[] | null {
  let i = 0;
  while (i < arg.length && arg[i].startsWith('-')) {
    if (arg[i] === '-C') { if (i + 1 >= arg.length) return null; i += 2; continue; }
    if (['--no-pager', '-P', '--no-optional-locks', '--no-replace-objects', '--literal-pathspecs'].includes(arg[i])) { i++; continue; }
    return null;
  }
  return arg.slice(i);
}

/** git push'u yıkıcı yapan biçim: zorla, silme, ayna, budama ya da +/: ile başlayan refspec. */
const pushYikici = (arg: readonly string[]): boolean => arg.some((a) =>
  /^--(?:fo|del|mir|pru)/.test(a) || (/^-[a-zA-Z]+$/.test(a) && /[fd]/.test(a)) || /^[+:]/.test(a));

/** Okuma biçimindeki git alt komutları. Düzeltme turu 1: `blame` çıktı (textconv'u kapatan bayrağı yok). Düzeltme turu 3: `describe` çıktı (çalışma ağacı
 *  denetimi düşük düzey fark yolunu kullanır; alt modül bastırması orada etkili değil). */
const GIT_OKUYAN = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files']);
/** Serbestken yeniden yazılan alt komutlar ve alt komuttan hemen sonra eklenen bayraklar (gitKomutunuSertlestir). --ignore-submodules=all komut satırı
 *  seçeneği olduğu için deponun alt modül başına `ignore` girdisini de geçersiz kılar (ortamdaki varsayılan kılamaz; düzeltme turu 3, Y2). Düzeltme turu 4
 *  (Y-2b): log ve show da fark seçeneği aldığı için onlara da eklenir. Kullanıcının kendi alt modül seçeneği serbest değildir (altModulSecenegi). */
const GIT_YENIDEN_YAZIM: Readonly<Record<string, readonly string[]>> = {
  diff: ['--no-ext-diff', '--no-textconv', '--ignore-submodules=all'],
  log: ['--no-ext-diff', '--no-textconv', '--ignore-submodules=all'],
  show: ['--no-ext-diff', '--no-textconv', '--ignore-submodules=all'],
  status: ['--ignore-submodules=all'],
};
/** Serbestken yeniden yazılan alt komutlar; hepsi alt modülleri bastırır (komut.ts: depoda .gitmodules varsa sonuca not düşer). */
export const GIT_YENIDEN_YAZILAN: ReadonlySet<string> = new Set(Object.keys(GIT_YENIDEN_YAZIM));
/** Okuma komutunu serbest olmaktan çıkaran seçenekler (git uzun seçenekleri kısaltılabilir: önekler): --output dosyaya yazar; --ext-diff, --textconv ve
 *  --show-signature depo ayarındaki yardımcı programı (dış fark aracı, textconv sürücüsü, gpg.program) başlatır. %G biçim yer tutucusu da imzayı
 *  doğrular (gpg.program). */
const GIT_OKUMA_YASAK = /^--(?:ou|ext|textc|show-s)|%G/;
const GIT_BRANCH_GUVENLI = /^(?:-a|--all|-r|--remotes|-v|-vv|--verbose|-l|--list|--show-current|--merged|--no-merged|--contains|--no-contains|--points-at|--sort=.*|--format=.*|--color(?:=.*)?|--no-color|--column(?:=.*)?|--no-column|-i|--ignore-case|--abbrev(?:=.*)?|--no-abbrev)$/;

/** Git'in alt modül seçeneklerinin adları (kısaltma denetimi için). */
const ALT_MODUL_ADLARI = ['ignore-submodules', 'submodule', 'recurse-submodules'];
/** Düzeltme turu 4 (Y-2a): kullanıcının verdiği alt modül seçeneği — adında (= öncesi, harf duyarsız) "submodule" geçen ya da git'in kabul edebileceği bir
 *  kısaltmayla (başında no- olsa da) bu adlardan birine denk gelen uzun seçenek. Eklenen --ignore-submodules=all'ı geri alabilir: komut serbest değil. */
function altModulSecenegi(a: string): boolean {
  if (!a.startsWith('-')) return false;
  const ad = a.split('=')[0].toLowerCase();
  if (ad.includes('submodule')) return true;
  const kok = /^--(?:no-)?(.+)$/.exec(ad)?.[1];
  return kok !== undefined && ALT_MODUL_ADLARI.some((s) => s.startsWith(kok));
}

/** git kuralı: alt komutun kuralı; serbest çıkan komutta kullanıcının alt modül seçeneği varsa serbest değil (ağ ve yıkıcı nedenleri değişmez). */
function gitKurali(arg: readonly string[]): KomutSinifi {
  const s = gitAltKomutKurali(arg);
  return s.sinif === 'serbest' && arg.some(altModulSecenegi) ? YIKICI : s;
}

function gitAltKomutKurali(arg: readonly string[]): KomutSinifi {
  if (arg.length === 1 && (arg[0] === '--version' || arg[0] === 'version')) return SERBEST;
  const r = gitGenel(arg);
  if (!r || !r.length) return YIKICI;
  const alt = r[0].toLowerCase();
  const geri = r.slice(1);
  if (GIT_AG.has(alt)) return alt === 'push' && pushYikici(geri) ? YIKICI : AG;
  if (alt === 'remote') {
    if (!geri.length || (geri.length === 1 && (geri[0] === '-v' || geri[0] === '--verbose'))) return SERBEST;
    if (geri[0] === 'get-url') return SERBEST;
    return ['show', 'update', 'prune'].includes(geri[0].toLowerCase()) ? AG : YIKICI;
  }
  // stash list yalnız argümansız (log seçenekleri -p ile fark, %G ile imza denetimi çalıştırır); stash show farkı gösterir (ext-diff/textconv): çıktı.
  if (alt === 'stash') return geri.length === 1 && geri[0].toLowerCase() === 'list' ? SERBEST : YIKICI;
  if (GIT_OKUYAN.has(alt)) return geri.some((a) => GIT_OKUMA_YASAK.test(a)) ? YIKICI : SERBEST;
  if (alt === 'branch') {
    if (geri.some((a) => a.startsWith('-') && !GIT_BRANCH_GUVENLI.test(a))) return YIKICI;
    const konumsal = geri.filter((a) => !a.startsWith('-'));
    // Konumsal sözcük yalnız --list deseni ya da --merged/--contains gibi seçeneğin işlemesi olabilir; değilse dal OLUŞTURUR.
    return !konumsal.length || geri.some((a) => /^(?:-l|--list|--merged|--no-merged|--contains|--no-contains|--points-at)$/.test(a)) ? SERBEST : YIKICI;
  }
  return YIKICI;
}

/** 0.14 son inceleme C1 + tur 2 (N1): npm'in HİÇBİR biçimi serbest değil. Betik çalıştıranlar (test, run, start, exec) projenin kodunu çalıştırır; `-v`,
 *  `ls`, argümansız `run` bile npm'in Windows başlatıcısı kendi CLI'sinin yerini çalışma klasörünün npm ayarını okuyarak seçtiği için ajanın yazdığı bir
 *  dosyanın gösterdiği kodu çalıştırabilir. */
function npmKurali(_arg: readonly string[]): KomutSinifi {
  return YIKICI;
}

/** C1: proje kodunu (paket betiği, test, derleme dosyası ya da klasördeki bir dosya) çalıştıran programlar — onay kartı bunu açıkça söyler
 *  (komut.ts PROJE_KODU_METNI). Sınıflama bunlardan bağımsızdır: hiçbiri serbest değil (sürüm sorgusu dışında). */
const PROJE_KODU_PROGRAMLARI = new Set(['npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx', 'node', 'deno', 'tsx', 'ts-node', 'python', 'python3', 'py',
  'pytest', 'tox', 'nox', 'uv', 'uvx', 'poetry', 'pipenv', 'make', 'nmake', 'mingw32-make', 'cmake', 'ninja', 'msbuild', 'dotnet', 'cargo', 'go', 'java',
  'mvn', 'mvnw', 'gradle', 'gradlew', 'ant', 'ruby', 'rake', 'bundle', 'perl', 'php', 'composer', 'jest', 'vitest', 'mocha', 'electron', 'pip', 'pip3', 'rustc',
  'rustup', 'corepack', 'volta', 'tsc']);

/** C1: komut projenin ya da klasördeki bir dosyanın kodunu çalıştırabilir mi (yalnız onay kartının metni için; serbest komutta false). */
export function projeKoduCalistirir(komut: string): boolean {
  if (typeof komut !== 'string' || komutSinifi(komut).sinif === 'serbest') return false;
  const a = ayristir(komut.trim());
  const ilk = a.kelimeler[0];
  if (ilk === undefined || ilk === '&' || ilk === '.') return false;
  return PROJE_KODU_PROGRAMLARI.has(taban(ilk)) || /\.(?:js|mjs|cjs|ts|py|ps1|bat|cmd)$/i.test(ilk);
}

/** Sözcük (ve ardındakiler) ağa çıkan bir komut mu: ağ programı, paket yöneticisinin ağ alt komutu, git'in ağ alt komutu, python -m pip install. */
function agaCikanMi(ad: string, arg: readonly string[]): boolean {
  if (AG_PROGRAMLARI.has(ad)) return true;
  if (ad === 'git') {
    const r = gitGenel(arg);
    // Tanınmayan genel seçenek (-c, --git-dir …): ağ alt komutunun adı herhangi bir yerde geçiyorsa "çıkar" (kaba, güvenli yön; "Yalnız bu bilgisayar").
    if (!r) return arg.some((a) => GIT_AG.has(a.toLowerCase()));
    if (!r.length) return false;
    const alt = r[0].toLowerCase();
    return GIT_AG.has(alt) || (alt === 'remote' && ['show', 'update', 'prune'].includes((r[1] ?? '').toLowerCase()));
  }
  if ((ad === 'python' || ad === 'python3' || ad === 'py') && arg.includes('-m')) {
    const m = arg[arg.indexOf('-m') + 1];
    return m === 'pip' && AG_ALT_KOMUTLARI.pip.has(arg[arg.indexOf('-m') + 2] ?? '');
  }
  const altlar = AG_ALT_KOMUTLARI[ad];
  if (!altlar) return false;
  const alt = arg.find((a) => !a.startsWith('-'));
  return alt === undefined ? altlar.has('*') && !arg.length : altlar.has(alt.toLowerCase());
}

/** Ağ yolu (\\sunucu\pay, //sunucu/pay; -Path:\\…, FileSystem::\\…): 'ag'; \\?\C:\ ve \\.\ (yerel uzun yol, aygıt ad alanı) 'yikici'; değilse null. */
function yolNedeni(arg: readonly string[]): KomutNedeni | null {
  for (const a of arg) {
    const m = /^(?:-[\w-]+[:=])?(?:[\w.\\]+::)?[\\/]{2}([^\\/]?)([\\/]?)(unc[\\/])?/i.exec(a);
    if (!m) continue;
    return (m[1] === '?' || m[1] === '.') && m[2] && !m[3] ? 'yikici' : 'ag';
  }
  return null;
}

/** Kendi -c/-co … seçeneği uzak bilgisayar olmayan yerel programlar (uzak bilgisayar parametresi kuralı bunlara uygulanmaz; iç metinleri ayrıca denetlenir). */
const UZAK_PARAM_DISI = new Set(['git', 'npm', 'npx', 'node', 'cmd', 'powershell', 'pwsh', 'python', 'python3', 'py', 'pip', 'pip3', 'java', 'dotnet', 'uv',
  'gcc', 'g++', 'clang', 'tar', 'cargo', 'go', 'tsc', 'deno', 'bun', 'pnpm', 'yarn']);
/** -c tek harfinin ComputerName'e çözülebildiği komut: okuma listesindeki cmdlet/takma ad, Fiil-Ad biçimli cmdlet ya da başlatıcı (icm). */
const cmdletBicimli = (ad: string): boolean => OKUYANLAR.has(ad) || BASLATICILAR.has(ad) || /^[a-z]+-[a-z]+$/.test(ad);

/** Düzeltme turu 5 (Important: uzak bilgisayar): adı `computername`'in kısaltması (co, comp, computer …; cmdlet'te tek `c` de), `cn`, ya da içinde
 *  `computer`/`session` geçen (CimSession, PSSession, PSComputerName) PowerShell parametresi komutu ağa çıkarır. Yalnız `-` önekli (PowerShell parametresi
 *  `/` ile yazılmaz: findstr /c: gibi yerel seçenek değil); ad `:` `=` ya da `.` (PowerShell parametre adını noktada keser) öncesidir. */
function uzakBilgisayarParam(a: string, kisaC: boolean): boolean {
  if (!/^-[^-]/.test(a)) return false;
  const ad = a.slice(1).split(/[:=.]/)[0].toLowerCase();
  if (!ad) return false;
  if (ad === 'c') return kisaC;
  return ad === 'cn' || 'computername'.startsWith(ad) || ad.includes('computer') || ad.includes('session');
}

function komutKurali(ad: string, arg: readonly string[]): KomutSinifi {
  if (ad === 'git') return gitKurali(arg); // ağ alt komutları ve push --force dahil
  if (agaCikanMi(ad, arg)) return AG;
  if (YIKICILAR.has(ad)) return YIKICI; // uzak bilgisayar parametresi olsa da (daha ağır neden); "Yalnız bu bilgisayar"da komutAgaCikar yakalar
  // Düzeltme turu 5: uzak bilgisayar / oturum parametresi (okuma cmdlet'i ya da tanınmayan cmdlet) → ağ. Bu kural olmadan okuma cmdlet'leri serbest kalamazdı.
  if (!UZAK_PARAM_DISI.has(ad) && arg.some((a) => uzakBilgisayarParam(a, cmdletBicimli(ad)))) return AG;
  if (ad === 'npm') return npmKurali(arg); // npm argümanındaki cmd işleçleri (& | < > ^ ( ) !) güvenli karakter kapısında zaten yakalanır
  if (ad === 'node') return YIKICI; // tur 2 (N1): node -v de değil (Volta benzeri kabuk klasörün package.json'ından sürüm seçer)
  if (ad === 'hostname') return arg.length ? YIKICI : SERBEST;
  // Öz denetim: whoami /upn ve /fqdn adı etki alanı denetleyicisine sorar (ağ); öbür whoami biçimleri yerel belirteci okur.
  if (ad === 'whoami' && arg.some((a) => /^[-/](?:upn|fqdn)$/i.test(a))) return AG;
  if (arg.length === 1 && SURUM_ARACLARI.has(ad) && arg[0] === '--version') return SERBEST;
  if (OKUYANLAR.has(ad)) return SERBEST;
  return YIKICI;
}

/** Çözüm: sınıf; `bicim` = karmaşıklık yalnız yüzey biçiminden (sarmalayıcı, çift tırnak, %, $, sonda ters bölülü boşluklu değer: kartı birden çok komut
 *  iddia etmez — komutBicimdenOnay); `kelimeler` = yalın komutun sözcükleri. */
interface Cozum { sonuc: KomutSinifi; bicim?: true; kelimeler?: string[] }

function cozumle(metin: string): Cozum {
  const t = metin.trim();
  if (!t || /[\r\n\u0085\u2028\u2029]/.test(t)) return { sonuc: KARMASIK };
  const a = ayristir(t);
  if (a.karmasik || a.kelimeler.includes('--%')) return { sonuc: KARMASIK };
  if (a.yazar) return { sonuc: YIKICI }; // PowerShell düzeyinde dosyaya yönlendirme (sarmalayıcılı komutta da)
  const k = a.kelimeler;
  if (!k.length) return { sonuc: KARMASIK };
  // Düzeltme turu 4 (Y-1): sarmalayıcı (baştaki & ya da ., cmd, powershell, pwsh, Start-Process …; yol ve uzantıyla da) hiç serbest değil. İç komut
  // ayrıştırılmaz: iç kabuğun göreceği metin bu ayrıştırmadan ayrışabilir (argüman, tırnak, % ve $ genişletmesi). Model iç komutu doğrudan çağırabilir.
  if (k[0] === '&' || k[0] === '.' || BASLATICILAR.has(taban(k[0]))) return { sonuc: KARMASIK, bicim: true };
  let sonuc = komutKurali(taban(k[0]), k.slice(1));
  // Yolu verilmiş program ("C:\araclar\git.exe status") adı tanıdık olsa da serbest sayılmaz: o yolda her şey olabilir.
  if (sonuc.sinif === 'serbest' && /[\\/:]/.test(k[0])) sonuc = YIKICI;
  // Son inceleme Minor 3: uzantılı ad (ls.exe, cat.cmd) PowerShell takma adı değil, PATH'teki programdır — yalnız gerçek programların uzantılı adı serbest.
  if (sonuc.sinif === 'serbest' && /\.(?:exe|cmd|bat|com)$/i.test(k[0]) && !UZANTILI_SERBEST.has(taban(k[0]))) sonuc = YIKICI;
  if (sonuc.sinif === 'serbest') { const y = yolNedeni(k.slice(1)); if (y) sonuc = { sinif: 'onay', neden: y }; }
  // Not: sonda ters bölülü boşluklu değer ve çift tırnak gibi biçimler artık güvenli karakter kapısında (sinifla) yakalanır.
  return { sonuc, kelimeler: k };
}

const gitAltKomutu = (arg: readonly string[]): string | undefined => gitGenel(arg)?.[0]?.toLowerCase();

// Düzeltme turu 1 (Minor 4): PowerShell uzun tireleri (– — ―) parametre öneki sayar. Kural düzeltilmiş biçime de uygulanır; ama düzeltilmiş biçim
// serbest kapıyı AÇMAZ (program tireyi olduğu gibi alabilir: "npm test –– --script-shell=x"de npm `––`'yi ayırıcı saymaz) — iki biçim de serbestse
// serbest; düzeltilmiş biçim onay diyorsa o, değilse ham biçimin sınıfı.
const UZUN_TIRE = /[\u2013\u2014\u2015]/;
const UZUN_TIRELER = /[\u2013\u2014\u2015]/g;

// ── Güvenli karakter kapısı (düzeltme turu 5, Critical: ayrıştırma ayrışması kökten kapanır) ─────────────────────────────────────────────
// Bir komut serbest olamıyorsa önce burada durur: ham metnin HER karakteri yalnız bu kümeden olacak — harf (Türkçe dahil, \p{L}), rakam, ASCII boşluk ve
// - _ . / \ : = , . Tırnak (tek/çift/kıvrık/ters), $ % @ & ; | < > ( ) { } [ ] # ! ~ ve uzun tire içeren komut serbest DEĞİLDİR (neden karmaşık, nötr kart).
// Böylece kapıdan geçen komut boşlukla bölününce PowerShell'in verdiği argv ile birebir aynıdır: ayrışma (bitişik tırnak, boş argüman, genişleme) olamaz.
const GUVENLI_KARAKTER = /^[\p{L}\d \t_.,:=/\\-]*$/u;
/** Öz denetim (Windows PowerShell 5.1'de zararsız argv yankısıyla sınandı): kümenin içinde de iki karakter sözcüğü böler. Virgül dizi işlecidir — baştaki
 *  ya da sondaki virgül düşer (",a" → a; "a, b" → a b), virgülden sonra gelen - parametre başlatır ("a,-x:b" → "a,-x:" "b"); yalnız iki harf/rakam
 *  arasındaki virgül sözcükte kalır ("a,b"). Harf ya da _ ile başlayan parametre adı noktada biter ("-a.b" → "-a" ".b"; ":" değerinden sonra değil).
 *  Bu biçimdeki sözcük de serbest değil: kapıdan geçen komutun boşlukla bölünmesi argv ile birebir kalır. */
const argvAyrisir = (k: string): boolean => k.trim().split(/[ \t]+/).some((w) =>
  /(?<![\p{L}\d]),|,(?![\p{L}\d])/u.test(w) || /^-(?![-\d.])[^:.]*\./.test(w));
/** Finding 3: ham metinde iki eğik çizgi (ters, düz ya da karışık: \\ // /\ \/ — Windows hepsini UNC sayar) → ağ yolu. Yerel aygıt/uzun yol (\\.\, \\?\)
 *  sözcük başındaysa cozumle'de yolNedeni ile yıkıcı sayılır ve buraya (serbest dalına) gelmez; başka konumdaysa kaba kural ag der (onay). */
const AG_YOLU_HAM = /[\\/]{2}/;

/**
 * Sınıf + biçim bayrağı. Serbest çıkan komuta ham metin üzerinde güvenli karakter kapısı uygulanır (düzeltme turu 5): kümedeki karakterlerden biri bile
 * dışarıdaysa komut serbest olamaz; neden karmaşık, nötr kart (bicim). Önce kapı (tırnak/$/%/@/işleç/uzun tire → karmaşık), sonra ağ yolu (\\ ya da //
 * → ag). Zaten onaylı komutun nedeni (yikici, ag) değişmez: onlar serbest dalına hiç girmez.
 */
function sinifla(komut: string): Cozum {
  const k = typeof komut === 'string' ? komut : '';
  const ham = cozumle(k);
  const c = !UZUN_TIRE.test(k) ? ham : ((d) => (d.sonuc.sinif === 'onay' ? d : ham))(cozumle(k.replace(UZUN_TIRELER, '-')));
  if (c.sonuc.sinif !== 'serbest') return c;
  if (!GUVENLI_KARAKTER.test(k) || argvAyrisir(k)) return { sonuc: KARMASIK, bicim: true }; // güvenli karakter kapısı (önce: tırnaklı file:// gibi biçim nötr kart alır)
  if (AG_YOLU_HAM.test(k)) return { sonuc: AG }; // finding 3: ham metinde ağ yolu
  return c;
}

/** Komutun sınıfı (R8): serbest ya da onay + neden. Düzeltme turu 5'ten beri tırnaklı her biçim (tek tırnaklı yol da) onay ister (güvenli karakter kapısı). */
export function komutSinifi(komut: string): KomutSinifi {
  return sinifla(komut).sonuc;
}

/** Düzeltme turu 4 (Y-4): komut YALNIZ yüzey biçimi yüzünden (sarmalayıcı, çift tırnak, %, $, sonda ters bölülü boşluklu değer) onaya düştü — kartı birden
 *  çok komut iddia etmez (komut.ts BICIM_METNI). Bileşik yapı, yıkıcı ve ağ nedeninde false. */
export function komutBicimdenOnay(komut: string): boolean {
  const c = sinifla(komut);
  return c.sonuc.neden === 'karmasik' && c.bicim === true;
}

// ── git sertleştirmesi (düzeltme turu 1; komut.ts uygular) ─────────────────────────────────────────────────────────────────────────────
/** Serbest bir git komutu mu: alt komutu ve -C ile verilen klasörler (sırayla; çalışma klasörüne göre çözülür). Serbest değilse ya da git değilse null. */
export function serbestGitKomutu(komut: string): { altKomut: string; cKlasorleri: string[] } | null {
  if (komutSinifi(komut).sinif !== 'serbest') return null;
  const k = cozumle(komut).kelimeler; // serbest komut sarmalayıcısızdır: ilk sözcük programın kendisi
  if (!k || taban(k[0]) !== 'git') return null;
  const arg = k.slice(1);
  const cKlasorleri: string[] = [];
  for (let i = 0; i < arg.length && arg[i].startsWith('-'); i++) if (arg[i] === '-C') cKlasorleri.push(arg[++i]);
  return { altKomut: gitAltKomutu(arg) ?? '', cKlasorleri };
}

/** PowerShell tek tırnağı: içerik birebir (tek tırnak benzerleri ikilenir). */
const tekTirnak = (s: string): string => `'${s.replace(/(['\u2018\u2019\u201a\u201b])/g, '$1$1')}'`;

/**
 * Serbest `git diff|log|show|status`: alt komuttan hemen sonra GIT_YENIDEN_YAZIM bayrakları eklenmiş, sözcükleri PowerShell tek tırnağıyla yeniden yazılmış
 * komut (serbest git komutunda bileşik yapı, sarmalayıcı, çift tırnak, % ve $ yok: tek tırnak birebir korur). Öbür komutlar olduğu gibi döner. Onaylı
 * komut yeniden yazılmaz: kullanıcının yazdığı gibi çalışır (düzeltme turu 3, N2).
 */
export function gitKomutunuSertlestir(komut: string): string {
  const g = serbestGitKomutu(komut);
  if (!g || !GIT_YENIDEN_YAZILAN.has(g.altKomut)) return komut;
  const arg = cozumle(komut).kelimeler!.slice(1);
  const altYeri = arg.length - (gitGenel(arg)?.length ?? 0);
  const yeni = [...arg.slice(0, altYeri + 1), ...GIT_YENIDEN_YAZIM[g.altKomut], ...arg.slice(altYeri + 1)];
  return `git ${yeni.map(tekTirnak).join(' ')}`;
}

const ADRES = /\b(?!file:)[a-z][a-z0-9+.-]*:\/\/[^\s'"]/i;
const AG_YOLU = /(?:^|[\s'"=:(,])[\\/]{2}(?:(?![?.][\\/])[\w.-]|[?.][\\/]unc[\\/])/i;
/** Düzeltme turu 5 (kararın "\\ ya da // geçen komut ag" kuralı, "Yalnız bu bilgisayar" için): metnin HERHANGİ bir yerindeki iki eğik çizgi (ters, düz,
 *  karışık; seçeneğe yapışık da). İstisna yalnız yerel uzun yol/aygıt (\\?\C:, \\.\pipe; \\?\UNC\ değil) ve yerel dosya adresi file:///. */
const AG_YOLU_HER = /(?<!file:\/?)[\\/]{2}(?![?.][\\/](?!unc[\\/]))|file:\/\/(?!\/)/i;

/** "Yalnız bu bilgisayar": bileşik/sarmalayıcılı komutun herhangi bir parçasında uzak bilgisayar parametresi (icm -cn, Restart-Computer -ComputerName …).
 *  Her program yerindeki sözcük (baş, ayırıcı, & ya da . sonrası) o parçanın komutudur; yerel programların kendi -c seçeneği sayılmaz. */
function uzakParamVar(k: string): boolean {
  const s = sozcukDizisi(k);
  let ad = '';
  return s.some((w, i) => {
    const onceki = s[i - 1];
    if (i === 0 || AYIRICI.test(onceki) || onceki === '&' || onceki === '.') { if (w !== '&' && w !== '.' && !AYIRICI.test(w)) ad = taban(w); return false; }
    return !UZAK_PARAM_DISI.has(ad) && uzakBilgisayarParam(w, cmdletBicimli(ad));
  });
}

/** "Yalnız bu bilgisayar" kapısı: komut bu bilgisayardan dışarı çıkıyor mu — ağ sınıfı, yıkıcı ama ağa çıkan (git push --force), bileşik ya da
 *  sarmalayıcılı komutun herhangi bir parçasındaki ağ komutu (sarmalayıcının nedeni 'karmasik' olduğu için kaba sözcük taraması), adres (file:// hariç) ya da
 *  ağ yolu. Kaba ama güvenli yönde: şüphede "çıkar" der. Uzun tireli biçim de denetlenir. */
export function komutAgaCikar(komut: string, derinlik = 0): boolean {
  if (typeof komut !== 'string') return false;
  return [komut, komut.replace(UZUN_TIRELER, '-')].some((k) => {
    if (komutSinifi(k).neden === 'ag' || ADRES.test(k) || AG_YOLU.test(k) || AG_YOLU_HER.test(k)) return true;
    const sozcukler = k.split(/[\s;|&(){}`"'\u2018\u2019\u201c\u201d$@,<>=]+/).filter(Boolean);
    if (sozcukler.some((s, i) => agaCikanMi(taban(s), sozcukler.slice(i + 1)))) return true;
    if (uzakParamVar(k)) return true;
    // Denetleyici kararı (düzeltme turu 4): içi görülebilen sarmalayıcının iç metni de aynı denetimden geçer (iç komut 'ag' sınıfındaysa çıkar).
    const ic = derinlik < 3 ? sarmalayiciIci(k) : null;
    return ic !== null && komutAgaCikar(ic, derinlik + 1);
  });
}

/** İçi görülebilen sarmalayıcının iç metni: `cmd … /c|/k <metin>`, `powershell|pwsh … -c|-Command <metin>`, `& …` ya da `. …`; değilse null. cmd ve
 *  PowerShell iç metni sözcükleri boşlukla birleştirip kendisi ayrıştırır; & ve . sözcükleri olduğu gibi geçirir (boşluklu sözcük tek tırnakla). */
function sarmalayiciIci(t: string): string | null {
  const a = ayristir(t.trim());
  const k = a.kelimeler;
  if (a.karmasik || k.length < 2) return null;
  if (k[0] === '&' || k[0] === '.') return k.slice(1).map((w) => (/\s/.test(w) ? tekTirnak(w) : w)).join(' ');
  const ad = taban(k[0]);
  const yer = ad === 'cmd' ? k.findIndex((w, i) => i > 0 && /^\/[ck]$/i.test(w))
    : ad === 'powershell' || ad === 'pwsh' ? k.findIndex((w, i) => i > 0 && KOMUT_SECENEGI.test(w)) : -1;
  return yer > 0 && yer + 1 < k.length ? k.slice(yer + 1).join(' ') : null;
}

// ── "Yalnız bu bilgisayar": içi görülemeyen sarmalayıcı (düzeltme turu 4, denetleyici kararı; P14 kesin) ───────────────────────────────────
const BETIK_DOSYASI = /\.(?:ps1|bat|cmd)$/i;
/** powershell/pwsh seçenekleri (- ya da / önekli, kısaltmalarıyla): kodlanmış komut, betik dosyası, düz komut metni. */
const KODLU_KOMUT = /^[-/](?:e|ec|en\w*)$/i;
const DOSYA_SECENEGI = /^[-/]f(?:i(?:l(?:e)?)?)?$/i;
const KOMUT_SECENEGI = /^[-/]c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i;
const GORULMEZ_BASLATICILAR = new Set(['start-process', 'saps', 'start']);
const AYIRICI = /^[;|&(){}\r\n\u0085\u2028\u2029]$/;
/** Kaba sözcük dizisi: tırnaklı parça tek sözcük (tırnakları atılmış), ayırıcılar (; | & ( ) { } satır sonu) kendi başına sözcük. */
const sozcukDizisi = (k: string): string[] =>
  (k.match(/[;|&(){}\r\n\u0085\u2028\u2029]|'[^']*'|"[^"]*"|[^\s;|&(){}'"]+/g) ?? []).map((s) => s.replace(/^(['"])([\s\S]*)\1$/, '$2'));

/**
 * İçi görülemeyen sarmalayıcı var mı (kaba sözcük taraması, bileşik ya da iç içe komutun her yerinde): kodlanmış komut ya da betik dosyası seçeneği
 * (powershell/pwsh çağrısından sonra), program yerinde .ps1/.bat/.cmd betiği (baş, ayırıcı, `.`, `call`, cmd /c|/k, -c/-Command ardı ya da powershell/pwsh
 * çağrısından sonra), Start-Process (saps, start). İçinde ağa çıkılıp çıkılmadığı görülemez: "Yalnız bu bilgisayar" seçiliyken onay sorulmadan reddedilir
 * (komut.ts; yalnız onay isteyen komutta — serbest komutun içeriği bilinir). Uzun tireli biçim de denetlenir.
 */
export function komutIciGorulmez(komut: string): boolean {
  if (typeof komut !== 'string') return false;
  return [komut, komut.replace(UZUN_TIRELER, '-')].some((k) => {
    const s = sozcukDizisi(k);
    let ps = false; // bir powershell/pwsh çağrısından sonra
    return s.some((w, i) => {
      const ad = taban(w);
      if (GORULMEZ_BASLATICILAR.has(ad)) return true;
      if (ad === 'powershell' || ad === 'pwsh') { ps = true; return false; }
      if (ps && (KODLU_KOMUT.test(w) || DOSYA_SECENEGI.test(w))) return true;
      const onceki = s[i - 1];
      const programYeri = i === 0 || ps || AYIRICI.test(onceki) || onceki === '.' || /^call$/i.test(onceki) || /^\/[ck]$/i.test(onceki) || KOMUT_SECENEGI.test(onceki);
      return programYeri && (BETIK_DOSYASI.test(w) || BETIK_DOSYASI.test(w.split(/\s+/)[0]));
    });
  });
}
