// 0.14 T18 (R8): Developer mode'da komut çalıştırma (komut_calistir, grup 'komut').
// Sınıflama (shared/komut-siniflama.ts komutSinifi) saf: gerçek yıkıcı ya da ağ komutu ÇALIŞTIRILMAZ, yalnız sınıflanır. Çalıştırma sınamaları
// `node -e` ile geçici klasörde (ana-surec.ts sahnesi: Electron sahte, USERPROFILE ve Belgeler geçici); gerçek `claude` CLI açılmaz.
// Ürün kuralı: onay yalnız geri dönüşsüz adımda — okuyan ve test eden bilinen komutlar sormadan çalışır; bilinmeyen her komut, ağa çıkan ve
// bileşik/iç içe komut onay kartından geçer (dongu.ts'in onay kapısı, ikinci kart yolu yok).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  komutSinifi, komutAgaCikar, komutAraciAcik, komutBicimdenOnay, komutIciGorulmez, gitKomutunuSertlestir, serbestGitKomutu, projeKoduCalistirir, KOMUT_AG_KAPALI_METNI,
  KOMUT_GORULMEZ_METNI, KOMUT_SURE_MS, KOMUT_ARAC_SURESI_MS,
} from '../src/shared/komut-siniflama.ts';
import { komutNotu } from '../src/main/ajan/kod-isleri.ts';
import { modKip } from '../src/shared/karakterler.ts';
import { aracSonucuKisalt, sonucKisaltildiMi, ARAC_SONUC_SINIRI } from '../src/main/ajan/zincir.ts';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

// ── Sahne: sahte Electron, geçici ev ve Belgeler ──────────────────────────────────────────────────────────────────────────────────────
const sahne = anaSurecSahnesi('komut', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
// Uygulama açılmadan önce kullanıcının ortamında olan değişkenler (modül yüklenirken alınan ilk ortam): kullanıcınındır, çocuğa geçer.
process.env.KULLANICI_API_KEY = 'kullanicinin-kendi-anahtari';
process.env.KULLANICI_DEGISKENI = 'gorunur';
await esbuildHazir();
const {
  komutAraciniKaydet, cocukOrtami, ciktiTemizle, komutuCalistir, gitOrtami, hookKlasoruHazirla, hookKlasorunuAyarla, depoRiskli, gitSurumunuAyarla,
  DEPO_PROGRAM_METNI, ESKI_GIT_METNI, HOOK_KLASORU_METNI, ALT_MODUL_NOTU, BICIM_METNI,
} = await import('../src/main/ajan/araclar/komut.ts');
const { aracBul } = await import('../src/main/ajan/araclar/kayit.ts');
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
komutAraciniKaydet();
// Uygulamanın kendi koyduğu iç değişkenler (modül yüklendikten sonra): çocuk görmez.
process.env.ELECTRON_OZEL_DEGISKEN = 'electron';
process.env.FUBER_CIHAZ_ANAHTARI = 'cihaz-anahtari';
process.env.FUBER_OTURUM = 'oturum-belirteci';
process.env.NODE_OPTIONS = '--no-warnings';
process.env.UYGULAMA_SESSION_TOKEN = 'uygulamanin-belirteci';
process.env.UYGULAMA_SECRET = 'uygulamanin-sirri';
process.env.Uygulama_Password = 'parola';

const windows = process.platform === 'win32';
const calisma = path.join(sahne.klasor, 'calisma');
fs.mkdirSync(calisma, { recursive: true });

type Istek = { baslik: string; aciklama: string; onizleme?: string; tehlike: string };
async function cagir(girdi: Record<string, unknown>, o: { karar?: 'bir_kez' | 'reddet'; sinyal?: AbortSignal } = {}) {
  const sorular: Istek[] = [];
  const arac = aracBul('komut_calistir');
  assert.ok(arac, 'komut_calistir kayıtlı değil');
  const r = await arac.calistir({ klasor: calisma, ...girdi }, {
    sohbetId: 1, sinyal: o.sinyal ?? new AbortController().signal, gorevIzinleri: new Set(),
    onay: async (i: Istek) => { sorular.push(i); return o.karar ?? 'bir_kez'; },
  } as never);
  return { r, sorular };
}
const yasiyor = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
async function bekle(kosul: () => boolean, ms = 15_000): Promise<boolean> {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (kosul()) return true; await new Promise((c) => setTimeout(c, 100)); }
  return kosul();
}

// ── Sınıflama (saf) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sinif = (k: string) => komutSinifi(k);
const SERBEST = { sinif: 'serbest' } as const;
const onay = (neden: 'yikici' | 'ag' | 'karmasik') => ({ sinif: 'onay', neden }) as const;

test('serbest: okuyan bilinen komutlar (brief + okuma eşdeğerleri), büyük-küçük harf duyarsız', () => {
  for (const k of [
    'git status', 'dir', 'Get-ChildItem', 'type package.json',
    'git log --oneline -5', 'git diff', 'git diff --stat HEAD', 'git show HEAD', 'git branch', 'git branch -a', 'git branch --show-current',
    'ls', 'ls -Force', 'cat README.md', 'Get-Content .\\a.txt -TotalCount 20', 'where node', 'where.exe git', 'Get-Command node',
    'git --version', 'git.exe status',
    'GIT STATUS', 'Dir', 'get-childitem -recurse', 'TYPE package.json', 'pwd', 'Get-Location', 'Write-Output merhaba', 'echo merhaba',
    'git rev-parse HEAD', 'git ls-files', 'git remote -v', 'git stash list', 'Select-String -Path a.txt -Pattern x', 'Test-Path a.txt',
  ]) assert.deepEqual(sinif(k), SERBEST, k);
});

// ── Düzeltme turu 5: güvenli karakter kapısı (Critical: ayrıştırma ayrışması kökten kapanır) ──────────────────────────────────────────────
test('güvenli karakter kapısı: serbest komutun ham metni yalnız harf (Türkçe dahil), rakam, boşluk ve - _ . / \\ : = , içerir', () => {
  // İzinli kümedeki her karakter serbest bir komutta kalabilir (girdiler zararsız).
  for (const k of ['git status', 'git log --oneline -5', 'Get-Content .\\a.txt', 'git diff --stat=HEAD', 'dir alt/klasor', 'type dosya_adı.json',
    'git log --since=2026-01-01', 'Select-String -Path a,b', 'git show HEAD', 'Write-Output çalışıyor']) assert.deepEqual(sinif(k), SERBEST, k);
});

test('güvenli karakter kapısı: küme dışındaki her sınıf serbest komutu onaya düşürür (karmaşık), neden karmaşık; girdiler zararsız', () => {
  // Her biçimde otherwise-serbest bir okuma komutuna küme dışı tek bir karakter eklenir: tırnak (tek/çift/kıvrık/ters), $ % @ & ; | < > ( ) { } [ ] # ! ~.
  for (const k of ['type a.json ~', 'dir a!b', 'dir a[0]', "dir a]b", 'Get-ChildItem a#b', 'git log a{b}', 'git show a(b)', 'git diff a;b', 'git log a|b',
    'git log a<b', 'dir a&b', 'git log a$b', 'dir a@b', 'dir a%b', 'dir `a`', "dir 'a'", 'dir "a"', 'Get-ChildItem ‘a’', 'Get-ChildItem “a”']) {
    assert.deepEqual(sinif(k), onay('karmasik'), k);
  }
});

test('güvenli karakter kapısı: kapıdan geçen serbest komut boşlukla bölününce argv ile birebir; yeniden yazım bu argv\'yi korur', () => {
  // Kapı geçince tırnak/işleç yok: boşlukla bölme = argv. serbestGitKomutu ve gitKomutunuSertlestir bu argv'yi kullanır.
  assert.deepEqual(serbestGitKomutu('git   -C   alt   status'), { altKomut: 'status', cKlasorleri: ['alt'] });
  assert.equal(gitKomutunuSertlestir('git log --oneline -5'), "git 'log' '--no-ext-diff' '--no-textconv' '--ignore-submodules=all' '--oneline' '-5'");
  // Çift boşluk ayrışma yaratmaz: fazladan boşluk argv'yi değiştirmez.
  assert.deepEqual(serbestGitKomutu('git status'), serbestGitKomutu('git  status'));
});

test('yıkıcı: brief listesi', () => {
  for (const k of ['rm -rf build', 'Remove-Item x -Recurse', 'del a.txt', 'git reset --hard', 'git push --force', 'git clean -fd', 'format D:', 'echo x > a.txt']) {
    assert.deepEqual(sinif(k), onay('yikici'), k);
  }
});

test('yıkıcı: PowerShell takma adları ve sistem araçları (büyük-küçük harf duyarsız)', () => {
  for (const k of ['rm a', 'del a', 'erase a', 'ri a', 'rd b', 'rmdir b', 'mv a b', 'move a b', 'ren a b', 'sc a.txt x', 'ac a.txt x', 'clc a.txt',
    'Set-Content a.txt x', 'Add-Content a.txt x', 'Clear-Content a.txt', 'Out-File a.txt', 'Move-Item a b', 'Rename-Item a b', 'Copy-Item a b -Force',
    'Stop-Process -Name node', 'kill 1234', 'Format-Volume -DriveLetter D', 'diskpart', 'reg delete HKCU\\Software\\X /f', 'schtasks /create /tn x /tr y',
    'sc.exe delete x', 'icacls C:\\x /grant Everyone:F', 'takeown /f C:\\x', 'Set-ExecutionPolicy Unrestricted',
    'REMOVE-ITEM a', 'Rm -RF build', 'DEL a.txt', 'set-content a x', 'Stop-Computer', 'shutdown /s', 'New-Item a.txt', 'mkdir yeni']) assert.deepEqual(sinif(k), onay('yikici'), k);
});

test('yıkıcı: yönlendirme (>, >>, 2>, *>) dosyaya yazar', () => {
  for (const k of ['dir >> liste.txt', 'npm test 2> hata.txt', 'git log > log.txt', 'Get-Content a *> b.txt', 'git status>a.txt', 'echo x > "a b.txt"', 'git status > $null.txt']) {
    assert.deepEqual(sinif(k), onay('yikici'), k);
  }
});

test('yıkıcı: bilinmeyen komut ve okuma listesindeki adın yazan/çalıştıran biçimi ("dosyaları ya da sistemi değiştirebilir")', () => {
  for (const k of ['foo-bar', 'python script.py', 'node script.js', `node -e "require('fs').rmSync('x')"`, 'npm run build', 'npm version patch',
    'npm test --script-shell=x', 'npm --prefix klasor test', 'git branch -D eski', 'git branch yeni-dal', 'git branch --delete x', 'git diff --output=fark.txt',
    'git log --outp=x', 'git -c core.pager=less log', 'git checkout -- .', 'git stash drop', 'git commit -m x', 'git push -f origin main',
    'git push origin +main', 'git push --force-with-lease', 'git push -uf origin x', 'git push origin :eski', 'git remote add o u',
    'C:\\tools\\git.exe status', '.\\betik.ps1', 'hostname yeni', 'cd ..',
    'Get-Content \\\\.\\PhysicalDrive0', 'git blame a.ts', 'git stash show', 'git stash list -p']) assert.deepEqual(sinif(k), onay('yikici'), k);
});

test('ağ: brief listesi ve eşdeğerleri', () => {
  for (const k of ['curl https://x', 'Invoke-WebRequest u', 'npm install', 'pip install x', 'git push', 'git pull', 'ssh h',
    'iwr https://x', 'irm https://x', 'wget https://x', 'curl.exe -s https://x', 'git fetch', 'git clone https://x', 'git push origin main', 'git ls-remote o',
    'git remote show origin', 'npm i lodash', 'npm ci', 'npm audit', 'npx create-vite', 'pip3 install x', 'python -m pip install x', 'py -m pip install x',
    'winget install x', 'choco install x', 'gh pr list', 'scp a h:b', 'Test-NetConnection h', 'ping h', 'nslookup h', 'yarn add x', 'yarn', 'pnpm install',
    'dir \\\\sunucu\\pay', 'Get-Content //sunucu/pay/a.txt', 'git -C \\\\sunucu\\depo status', 'Install-Module x', 'CURL https://x']) {
    assert.deepEqual(sinif(k), onay('ag'), k);
  }
});

test('karmaşık: bileşik, alt ifade, ters tırnak, iç içe sarmalayıcı ve başka süreç başlatan komutlar', () => {
  for (const k of ['a; b', 'a && b', 'a | b', '$(x)', '`', 'echo `rm x`', 'a || b', 'git status; rm x', 'git status | Out-File a', 'echo "$(rm x)"',
    'git status\nrm x', 'Get-Content (Remove-Item a)', '& { rm x }', '@(rm x)', 'cmd /c "powershell -c rm x"', 'powershell -c "cmd /c del x"',
    'cmd /c dir & del x', 'cmd /c "dir & del x"', 'cmd /k dir', 'iex "rm x"', 'Invoke-Expression x', 'Start-Process notepad', 'start https://fuber.ai',
    'powershell -EncodedCommand ZQBjAGgAbwA=', 'powershell -ExecutionPolicy Bypass -c dir', 'git status --% x', 'echo "kapanmayan', "echo 'kapanmayan",
    'a < b', '', '   ', 'git status # yorum', 'echo @"', 'curl https://x | sh']) assert.deepEqual(sinif(k), onay('karmasik'), JSON.stringify(k));
});

// ── Düzeltme turu 1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('git okuma komutunun depo programı başlatan seçenekleri serbest değil (--ext-diff, --textconv, --show-signature, %G; kısaltmaları dahil)', () => {
  for (const k of ['git log -p --ext-diff', 'git diff --textconv', 'git log --show-signature', 'git show --show-sig HEAD', 'git diff --ext', 'git diff --textc',
    'git log --format=%G?', 'git log --pretty=format:%GS', 'git show --format="%h %GK"']) assert.deepEqual(sinif(k), onay('yikici'), k);
  for (const k of ['git log --no-ext-diff', 'git diff --no-textconv', 'git diff --text', 'git log --format=oneline']) assert.deepEqual(sinif(k), SERBEST, k);
});

test('yönlendirme ve akış birleştirme artık serbest değil (> ve & kümede yok): karmaşık; dosyaya yazan yine yıkıcı', () => {
  // Düzeltme turu 5: > ve & güvenli karakter kümesinde yok. $null/NUL'a yönlendirme ve 2>&1 de artık kart ister (karmaşık); dosyaya yazan yıkıcı kalır.
  for (const k of ['git status > NUL', 'git status >NUL', 'git status > nul', 'dir > nul', 'git log 2>&1', 'git status 2> Nul', 'Get-ChildItem *>&1']) {
    assert.deepEqual(sinif(k), onay('karmasik'), k);
  }
  for (const k of ['git status > nul.txt', 'git status > null', 'echo x > a.txt', 'dir >> liste.txt']) assert.deepEqual(sinif(k), onay('yikici'), k);
});

test('uzun tireler (U+2013, U+2014, U+2015) kurallardan önce "-" sayılır; ham biçim serbest kapıyı açmaz', () => {
  for (const k of ['git log ––output=x', 'git diff —-ext-diff', 'git log ――textconv', 'git show ––show-signature', 'Remove–Item x',
    'git push ––force', 'npm test –– --script-shell=x']) assert.equal(sinif(k).sinif, 'onay', k);
  assert.deepEqual(sinif('git push ––force'), onay('yikici'), 'düzeltilmiş biçim daha sıkıysa o');
  // Düzeltme turu 5: uzun tire güvenli karakter kümesinde yok; düzeltilmiş biçim serbest olsa da ham metin kapıyı geçmez → karmaşık.
  assert.deepEqual(sinif('git log ––oneline'), onay('karmasik'), 'uzun tire kümede yok: kapı kapatır');
});

test('git sertleştirme (saf): serbest diff/log/show/status alt komuttan hemen sonra bayraklarını alır, sözcükler tek tırnakla yeniden yazılır', () => {
  // Düzeltme turu 4 (Y-2b): log ve show da fark seçeneği alır: --ignore-submodules=all onlara da eklenir.
  assert.equal(gitKomutunuSertlestir('git log --oneline -5'), "git 'log' '--no-ext-diff' '--no-textconv' '--ignore-submodules=all' '--oneline' '-5'");
  assert.equal(gitKomutunuSertlestir('git -C alt --no-pager diff --stat'), "git '-C' 'alt' '--no-pager' 'diff' '--no-ext-diff' '--no-textconv' '--ignore-submodules=all' '--stat'");
  assert.equal(gitKomutunuSertlestir('git log --grep x -- a.ts'), "git 'log' '--no-ext-diff' '--no-textconv' '--ignore-submodules=all' '--grep' 'x' '--' 'a.ts'");
  // Düzeltme turu 5: tırnaklı biçim (düz ya da kıvrık) güvenli karakter kapısından geçmez — serbest değil, yeniden yazılmaz.
  for (const k of ["git log --grep 'it''s' -- a.ts", 'git log --grep ‘x’’y’']) assert.equal(gitKomutunuSertlestir(k), k, k);
  assert.equal(gitKomutunuSertlestir('git show HEAD'), "git 'show' '--no-ext-diff' '--no-textconv' '--ignore-submodules=all' 'HEAD'");
  // Düzeltme turu 3 (Y2): status ve diff alt modülleri komut satırı seçeneğiyle bastırır.
  assert.equal(gitKomutunuSertlestir('git status --short'), "git 'status' '--ignore-submodules=all' '--short'");
  assert.equal(gitKomutunuSertlestir('git status'), "git 'status' '--ignore-submodules=all'");
  // Öbür serbest git komutları ve serbest olmayanlar değişmez. Düzeltme turu 4-5: sarmalayıcılı, $'lı ve tek tırnaklı biçim serbest değil (kapı), yeniden
  // yazılmaz (onaydan sonra yazıldığı gibi çalışır).
  for (const k of ['git branch -a', 'git rev-parse HEAD', 'git push', 'rm x', 'dir', 'git log --ext-diff', 'git commit -m deneme', 'cmd /c git show HEAD',
    "git log '$x'", '& git log']) assert.equal(gitKomutunuSertlestir(k), k, k);
  // Değişken, tek tırnak ve çift tırnak güvenli karakter kümesinde yok: serbest değil (karmaşık).
  assert.deepEqual(sinif('git log $env:DAL'), onay('karmasik'));
  assert.deepEqual(sinif('git status $x'), onay('karmasik'));
  assert.deepEqual(sinif('git diff "$x"'), onay('karmasik'));
  // Yeniden yazılan komut tek tırnaklı olduğu için yeniden sınıflanırsa serbest değildir (kapı); ama o komut yeniden sınıflanmaz — komut.ts doğrudan
  // çalıştırır. Yapı eklenmediğini argv'yle doğrularız (yukarıdaki birebir çıktı). Kullanıcı seçeneği kendisi yazsaydı Y-2a ile serbest olmazdı.
  assert.deepEqual(sinif('git status --ignore-submodules=all'), onay('yikici'));
  assert.deepEqual(serbestGitKomutu('git -C a -C b status'), { altKomut: 'status', cKlasorleri: ['a', 'b'] });
  assert.equal(serbestGitKomutu('git push'), null);
  assert.equal(serbestGitKomutu('dir'), null);
});

test('tırnak (düzeltme turu 5): tek ya da çift tırnak içeren her biçim serbest değil (karmaşık); zaten onaylı komutun nedeni değişmez', () => {
  // Çift tırnak (örnekler zararsız).
  for (const k of ['git show "HEAD"', 'git log --grep "a;b|c"', 'type "package.json"', 'Get-ChildItem "C:\\Program Files"', 'git log --grep="hello world"',
    'git status "-s"', "git log --grep 'a\"b'", 'Get-Content "a""b"', 'git status ‘x"y’']) {
    assert.deepEqual(sinif(k), onay('karmasik'), k);
  }
  // Zaten onaylı komutun nedeni değişmez (yıkıcı, ağ).
  assert.deepEqual(sinif('Remove-Item "a b.txt"'), onay('yikici'));
  assert.deepEqual(sinif('curl "https://x"'), onay('ag'));
  // Düzeltme turu 5: tek tırnak de kümede yok — tek tırnaklı yol okuma artık serbest değil (kartla öder).
  for (const k of ["type 'C:\\Dosyalar\\a.txt'", "Get-Content 'a b.txt'", "dir 'C:\\Klasor\\'", "git log --grep 'a b'", "dir 'C:\\Bir Klasor\\'"]) {
    assert.deepEqual(sinif(k), onay('karmasik'), k);
  }
});

test('Y3: ${ad} biçimi de değişken sayılır; yeniden yazılacak git komutunda karmaşık', () => {
  assert.deepEqual(sinif("git log '${env:DAL}'"), onay('karmasik'), 'düzeltme turu 4 (Y-3): yerel programın ham metninde $ — tek tırnakta da');
  assert.deepEqual(sinif('git log ${env:DAL}'), onay('karmasik'));
  assert.deepEqual(sinif('git diff "pre${x}son"'), onay('karmasik'));
});

test('describe serbest değil (düzeltme turu 3, Y2b)', () => {
  for (const k of ['git describe', 'git describe --dirty', 'git describe --tags']) assert.deepEqual(sinif(k), onay('yikici'), k);
});

// ── Düzeltme turu 4: ince ayrıştırma yerine kaba kurallar ──────────────────────────────────────────────────────────────────────────────
test('Y-1 (düzeltme turu 4): sarmalayıcıdan geçen her komut serbest değil (karmaşık); aynı iç komut doğrudan yazılınca serbest kalır', () => {
  // Biçimler: baştaki & ve ., cmd /c ve /k, powershell/pwsh -c / -Command / -EncodedCommand / -File, Start-Process; uzantı, yol ve harf farkıyla da.
  // İç komut ayrıştırılmaz (iç kabuğun göreceği metin sınıflayıcınınkinden ayrışabilir). İç komutlar zararsız.
  for (const k of ['& git status', '. git status', '&git status', 'cmd /c dir', 'cmd.exe /C git status', 'CMD /K dir', 'cmd /s /c dir', "cmd /c 'type package.json'",
    'C:\\Windows\\System32\\cmd.exe /c dir', 'powershell -c Get-ChildItem', "powershell -NoProfile -Command 'git log'", 'pwsh -c ls', 'pwsh.exe -Command dir',
    'powershell -EncodedCommand ZQBjAGgAbwA=', 'powershell -enc ZQBjAGgAbwA=', 'powershell -File a.ps1', 'pwsh -f a.ps1', 'powershell.exe -NonInteractive -File a.ps1',
    'Start-Process git', 'saps notepad', 'start notepad', 'cmd', 'powershell']) assert.deepEqual(sinif(k), onay('karmasik'), k);
  // İç komut yıkıcı ya da ağa çıkan olsa da neden karmaşık; "Yalnız bu bilgisayar" kapısı (komutAgaCikar) kaba sözcük taramasıyla yine yakalar.
  for (const k of ['cmd /c del a.txt', '& rm a', 'powershell -c Remove-Item a', 'cmd /c curl https://x', '& git pull']) assert.deepEqual(sinif(k), onay('karmasik'), k);
  assert.equal(komutAgaCikar('cmd /c curl https://x'), true);
  assert.equal(komutAgaCikar('& git pull'), true);
  // PowerShell düzeyindeki dosya yönlendirmesi yine yıkıcı.
  assert.deepEqual(sinif('cmd /c dir > a.txt'), onay('yikici'));
  // Aynı iç komut doğrudan yazılınca serbest.
  for (const k of ['git status', 'dir', 'type package.json', 'Get-ChildItem', 'git log', 'ls']) assert.deepEqual(sinif(k), SERBEST, k);
});

test('Y-1 (düzeltme turu 4): ham metinde % geçen komut serbest değil (karmaşık); %\'siz biçim serbest; zaten onaylı komutun nedeni değişmez', () => {
  for (const k of ['git log --format=%h', 'echo 100%', 'dir a%b', "Get-ChildItem '%x%'", 'git log -- %x%']) assert.deepEqual(sinif(k), onay('karmasik'), k);
  for (const k of ['git log --format=oneline', 'echo 100', 'dir ab']) assert.deepEqual(sinif(k), SERBEST, k);
  assert.deepEqual(sinif('del a%b'), onay('yikici'));
  assert.deepEqual(sinif('git log --format=%G?'), onay('yikici'));
});

test('değişken (düzeltme turu 5): $ ya da @ içeren her komut serbest değil (hem yerel program hem PowerShell cmdlet\'i); kümede yok', () => {
  // Kapı $ ve @'i her bağlamda yakalar (eski yerel/cmdlet ayrımı gereksizleşti): tek tırnakta, yönlendirme hedefinde ya da süslü parantezle olsa da.
  for (const k of ['git log $x', "git log --grep '$x'", 'git status 2>$null', 'git log -- $x', 'where.exe $x', 'findstr a $f', 'tree $HOME',
    'Get-ChildItem $HOME', 'dir $env:TEMP', 'Get-Content $HOME\\a.txt', 'Write-Output $PSVersionTable', 'Test-Path $x', 'git log --author=a@b.c', 'dir a@b']) {
    assert.deepEqual(sinif(k), onay('karmasik'), k);
  }
  // Zaten onaylı komutun nedeni değişmez.
  assert.deepEqual(sinif('git commit -m $x'), onay('yikici'));
});

test('npm işleç karakterleri (düzeltme turu 5): kapı & | < > ^ ( ) ! ve tırnağı zaten yakalar; işleçsiz npm test de onaylı (C1)', () => {
  for (const k of ["npm test -- 'a|b'", 'npm test -- a^b', 'npm run test -- a(b)', 'npm test -- a!b', 'npm test -- a<b']) assert.equal(sinif(k).sinif, 'onay', k);
  for (const k of ['npm test', 'npm test -- --grep x', 'npm run test', 'npm.cmd test']) assert.deepEqual(sinif(k), onay('yikici'), k);
});

// ── 0.14 son inceleme C1: proje kodunu çalıştıran komut her zaman onaylı; sürüm sorgusu araç zinciri indirmez ─────────────────────────────────────
test('C1: proje kodunu çalıştıran her komut onay ister (npm test/run, npx, yarn, pnpm, node/python dosya, make …); kart metni proje kodunu söyler', () => {
  const proje = ['npm test', 'npm t', 'npm tst', 'npm run test', 'npm run build', 'npm run-script test', 'npm start', 'npm exec x', 'npm.cmd test',
    'npx vitest', 'yarn test', 'yarn', 'yarn run x', 'pnpm test', 'pnpm run x', 'bun test', 'node index.js', 'node test', 'python main.py', 'python -m pytest',
    'py setup.py', 'make', 'make test', 'nmake', 'cargo test', 'go test', 'go run .', 'dotnet test', 'mvn test', 'gradle build', 'pytest', 'deno task x',
    'npx tsx a.ts', '.\\betik.ps1', 'betik.cmd'];
  for (const k of proje) {
    assert.equal(sinif(k).sinif, 'onay', k);
    assert.equal(projeKoduCalistirir(k), true, `${k}: kart proje kodunu söyler`);
  }
  for (const k of ['git status', 'dir', 'rm -rf x', 'curl https://x']) assert.equal(projeKoduCalistirir(k), false, k);
  for (const k of ['npm -v', 'node -v', 'npm ls', 'npm run']) assert.equal(projeKoduCalistirir(k), true, `Tur 2 N1: ${k}`);
});

test('Minor 3: uzantılı takma ad (ls.exe, cat.cmd, dir.com) PATH\'teki programa gider — serbest değil; gerçek programların uzantılı adı serbest', () => {
  for (const k of ['ls.exe', 'cat.cmd', 'dir.com', 'Get-Content.exe a.txt', 'type.bat a']) assert.equal(sinif(k).sinif, 'onay', k);
  for (const k of ['where.exe git', 'git.exe status', 'findstr.exe x a.txt', 'whoami.exe']) assert.deepEqual(sinif(k), SERBEST, k);
  for (const k of ['npm.cmd -v', 'node.exe -v']) assert.equal(sinif(k).sinif, 'onay', k);
});

test('C1 + Minor 4: sürüm sorgusu araç zinciri indirebilen ya da proje ayarı çalıştıran programlarda serbest değil', () => {
  for (const k of ['yarn --version', 'pnpm --version', 'bun --version', 'go version', 'go --version', 'rustc --version', 'cargo --version', 'python --version',
    'python3 --version', 'py --version', 'py -V', 'python -V']) assert.equal(sinif(k).sinif, 'onay', k);
  // Tur 2 (N1): hiçbir sürüm sorgusu serbest değil — yalnız git (sertleştirilmiş).
  for (const k of ['node -v', 'node --version', 'npm -v', 'npm --version', 'tsc --version', 'java --version', 'dotnet --version', 'docker --version',
    'pip --version', 'deno --version', 'uv --version', 'code --version']) assert.equal(sinif(k).sinif, 'onay', k);
  assert.deepEqual(sinif('git --version'), SERBEST);
});

test('uzak bilgisayar parametresi (düzeltme turu 5): okuma cmdlet\'inde computername/cn kısaltması ya da session adlı parametre → ag', () => {
  // Kısaltmalar (-co, -comp, -computer, -computername, -cn) ve session (girdiler zararsız: hedef adı yok).
  for (const k of ['Get-Process -ComputerName sunucu', 'Get-Service -cn sunucu', 'Get-Process -co sunucu', 'Get-Process -comp sunucu', 'Get-Service -computer sunucu',
    'Get-Process -Session s', 'Get-Process -PSSession s']) assert.deepEqual(sinif(k), onay('ag'), k);
  // "Yalnız bu bilgisayar"da reddedilir (neden ag).
  assert.equal(komutAgaCikar('Get-Process -ComputerName sunucu'), true);
  assert.equal(komutAgaCikar('Get-Service -cn sunucu'), true);
  // Yerel parametreler serbest kalır (computername'in öneki değil).
  for (const k of ['Get-Process -Name node', 'Get-Service -DisplayName x', 'Get-Process -Id 10', 'Get-ChildItem -Recurse']) assert.deepEqual(sinif(k), SERBEST, k);
});

test('uzak bilgisayar parametresi (düzeltme turu 5, öz denetim): -c tek harfi, değer yapışık biçimler, CimSession/PSComputerName; serbest olmayan cmdlet\'te de ag', () => {
  // Get-Process'te c ile başlayan tek parametre ComputerName: PowerShell -c'yi ona çözer.
  for (const k of ['Get-Process -c sunucu', 'Get-Service -C sunucu', 'Get-Process -cn:sunucu', 'Get-Process -ComputerName:sunucu', 'Get-Service -ComputerName=sunucu',
    'Get-Process -CimSession s', 'Get-Service -PSComputerName sunucu', 'gps -comp sunucu', 'gsv -cn sunucu', 'Get-WmiObject -cn sunucu', 'Get-CimInstance -CimSession s',
    'Restart-Service -ComputerName sunucu']) assert.deepEqual(sinif(k), onay('ag'), k);
  // Yıkıcı cmdlet yıkıcı kalır (daha ağır neden), ama "Yalnız bu bilgisayar"da ağa çıkar sayılır; sarmalayıcı da.
  assert.deepEqual(sinif('Restart-Computer -ComputerName sunucu'), onay('yikici'));
  for (const k of ['Restart-Computer -ComputerName sunucu', 'Stop-Process -cn sunucu -Name x', 'icm -cn sunucu {dir}', 'Invoke-Command -ComputerName sunucu -ScriptBlock {dir}',
    'Invoke-Command -Session s {dir}', 'dir; Get-Process -c sunucu', "powershell -c 'Get-Process -cn sunucu'", 'Get-WmiObject Win32_OS -comp sunucu',
    'Get-Process -cn.sunucu']) assert.equal(komutAgaCikar(k), true, k);
  // Yerel programların kendi -c / /c seçenekleri uzak bilgisayar değildir: yerel modda engellenmez, findstr /c: ağ sınıfına düşmez.
  for (const k of ['git -c a=b status', 'cmd /c dir', 'powershell -c dir', 'powershell -co dir', 'pwsh -Command dir', 'npm test -- -c', 'node -c a.js', 'findstr /c:x a.txt']) {
    assert.equal(komutAgaCikar(k), false, k);
  }
  assert.deepEqual(sinif('findstr /c:x a.txt'), SERBEST);
});

test('whoami (öz denetim): /upn ve /fqdn etki alanı denetleyicisine sorar → ag; öbür biçimler serbest', () => {
  for (const k of ['whoami /upn', 'whoami /FQDN', 'whoami -upn']) assert.deepEqual(sinif(k), onay('ag'), k);
  for (const k of ['whoami', 'whoami /all', 'whoami /groups', 'whoami /priv']) assert.deepEqual(sinif(k), SERBEST, k);
});

test('argv ayrışması (düzeltme turu 5, öz denetim): kümedeki virgül ve parametre adındaki nokta PowerShell\'de sözcüğü böler — serbest değil', () => {
  // Windows PowerShell 5.1'de sınandı (zararsız argv yankısı): ",a" → [a]; "a, b" → [a, b]; "a,-x:b" → [a,-x:, b]; "-a.b" → [-a, .b]; "-_a.b" → [-_a, .b].
  for (const k of ['git diff ,--output=x', 'git branch --contains ,-D x', 'git log a, b', 'git ls-files a,-x:b', 'git ls-files -o.x', 'Get-Content -Path.x',
    'git -C ,alt status', 'git log -- a,', 'dir a,,b', 'git log -a=b.c', 'git log -ä.b', 'git log -_a.b']) assert.deepEqual(sinif(k), onay('karmasik'), k);
  assert.equal(serbestGitKomutu('git -C ,alt status'), null);
  // Bölünmeyen biçimler serbest kalır: harf/rakam arasındaki virgül, -- önekli ve sayı, : değerinden sonraki nokta.
  for (const k of ['Select-String -Path a,b', 'git log --since=2.weeks', 'git log -1', 'git log -.5', 'Get-Content -Path:a.txt', 'Get-Content -Path a.txt', 'type a.b,c.d']) {
    assert.deepEqual(sinif(k), SERBEST, k);
  }
});

test('ağ yolu (düzeltme turu 5, öz denetim): karışık eğik çizgi (/\\ ve \\/) de UNC yoludur; "Yalnız bu bilgisayar" her konumdaki ağ yolunu görür', () => {
  for (const k of ['dir /\\sunucu\\pay', 'type \\/sunucu/pay/a.txt', 'Get-Content -Path:/\\sunucu\\a']) assert.deepEqual(sinif(k), onay('ag'), k);
  // Onaylı (yıkıcı) komutta seçeneğe yapışık ağ yolu da yerel modda ağa çıkar.
  for (const k of ['Copy-Item a /x:\\\\sunucu\\pay', 'robocopy a /\\sunucu\\pay', 'Remove-Item -Path:\\/sunucu/pay', 'Copy-Item a \\\\?\\UNC\\sunucu\\pay']) {
    assert.equal(komutAgaCikar(k), true, k);
  }
  for (const k of ['Get-Content \\\\?\\C:\\a.txt', 'Copy-Item a \\\\.\\pipe\\x', 'del C:\\a\\b']) assert.equal(komutAgaCikar(k), false, k);
});

test('ağ yolu (düzeltme turu 5): ham metinde \\\\ ya da // geçen komut (seçeneğe yapışık olsa da) → ag; yerel aygıt yolu yıkıcı kalır', () => {
  for (const k of ['type /x:\\\\sunucu\\pay', 'Get-ChildItem //sunucu/pay', 'dir \\\\sunucu\\pay', 'git -C \\\\sunucu\\depo status']) {
    assert.deepEqual(sinif(k), onay('ag'), k);
  }
  assert.equal(komutAgaCikar('type /x:\\\\sunucu\\pay'), true);
  // Yerel aygıt / uzun yol ağ değil (yıkıcı); komutAgaCikar bunları çıkar saymaz.
  assert.deepEqual(sinif('Get-Content \\\\.\\PhysicalDrive0'), onay('yikici'));
  assert.equal(komutAgaCikar('Get-Content \\\\?\\C:\\a.txt'), false);
});

test('Y-2a (düzeltme turu 4): serbest git komutunda kullanıcının verdiği alt modül seçeneği (adında submodule ya da git\'in kabul edebileceği kısaltması) serbest değil', () => {
  for (const k of ['git status --ignore-submodules=none', 'git status --ignore-submodules', 'git diff --submodule=log', 'git log -p --submodule', 'git show --ignore-submodules=dirty HEAD',
    'git ls-files --recurse-submodules', 'git log --no-recurse-submodules', 'git status --ignore-sub=none', 'git diff --submod=log', 'git ls-files --rec', 'git status --IGNORE-SUBMODULES']) {
    assert.deepEqual(sinif(k), onay('yikici'), k);
  }
  // Alt modülle ilgisiz seçenekler serbest kalır; ağa çıkan komutun nedeni değişmez.
  for (const k of ['git status --short', 'git log --stat --since=yesterday', 'git log --reverse', 'git diff --summary', 'git diff --stat', 'git branch --ignore-case',
    'git log --relative-date', 'git status --ignored']) assert.deepEqual(sinif(k), SERBEST, k);
  assert.deepEqual(sinif('git push --recurse-submodules=check'), onay('ag'));
  assert.deepEqual(sinif('git pull --recurse-submodules'), onay('ag'));
});

test('Y-4 (düzeltme turu 4, saf): komutBicimdenOnay — yalnız çift tırnak, %, $ ya da sarmalayıcı yüzünden onaya düşen komut', () => {
  for (const k of ['git show "HEAD"', 'echo 100%', 'git log $x', 'cmd /c dir', '& git status', 'powershell -c Get-ChildItem', 'Start-Process notepad', 'cmd /c del a.txt']) {
    assert.equal(komutBicimdenOnay(k), true, k);
  }
  // Gerçek bileşik yapı, yıkıcı ve ağ nedeni ve serbest komut değil.
  for (const k of ['git status; git log', 'git status | Out-File a', 'echo `x`', 'del a.txt', 'curl https://x', 'cmd /c dir > a.txt', 'git status', 'dir', 'git status --ignore-submodules']) {
    assert.equal(komutBicimdenOnay(k), false, k);
  }
});

test('Y-4 (düzeltme turu 4): yalnız biçim yüzünden onaya düşen komutun kartı "onayınızı istiyorum" der, birden çok komut iddia etmez; bileşiğin kartı değişmez', async () => {
  assert.equal(BICIM_METNI, 'Bu komutu çalıştırmadan önce onayınızı istiyorum.');
  // Hepsi reddedilir: hiçbiri çalışmaz (serbest olmadıkları için git sürümü de sorulmaz).
  for (const k of ['git show "HEAD"', 'echo 100%', 'git log $x', 'cmd /c dir', '& git status', 'powershell -c Get-ChildItem']) {
    const { r, sorular } = await cagir({ komut: k }, { karar: 'reddet' });
    assert.equal(sorular.length, 1, k);
    assert.equal(sorular[0].aciklama, BICIM_METNI, k);
    assert.doesNotMatch(sorular[0].aciklama, /birden çok|iç içe/, k);
    assert.match(r.icerik, /reddedildi/, k);
  }
  const karma = await cagir({ komut: 'git status; git log' }, { karar: 'reddet' });
  assert.match(karma.sorular[0].aciklama, /birden çok/);
  const yikici = await cagir({ komut: 'del a.txt' }, { karar: 'reddet' });
  assert.match(yikici.sorular[0].aciklama, /değiştirebilir/);
});

// ── Düzeltme turu 4, denetleyici kararı (P14): "Yalnız bu bilgisayar"da içi görülemeyen sarmalayıcı reddedilir ───────────────────────────
test('komutIciGorulmez (saf): kodlanmış komut, betik dosyası (-File; .ps1/.bat/.cmd çalıştırma) ve Start-Process; içi görülebilen sarmalayıcı değil', () => {
  for (const k of ['powershell -EncodedCommand ZQBjAGgAbwA=', 'powershell -enc ZQBjAGgAbwA=', 'pwsh -e ZQBjAGgAbwA=', 'powershell -File a.ps1', 'pwsh -f a.ps1',
    'powershell.exe -NoProfile -File a.ps1', '.\\betik.ps1', "& 'C:\\Betik Klasoru\\a.ps1'", '. .\\a.ps1', 'cmd /c kur.bat', 'C:\\araclar\\kur.cmd',
    'Start-Process notepad', 'saps notepad', 'start notepad', 'git status; .\\betik.ps1', 'pwsh a.ps1']) assert.equal(komutIciGorulmez(k), true, k);
  for (const k of ['cmd /c dir', "powershell -c 'Get-ChildItem'", 'powershell -Command dir', '& git status', 'Remove-Item a.ps1', 'type a.cmd', 'git status',
    'curl https://x', 'git add kur.bat']) assert.equal(komutIciGorulmez(k), false, k);
  assert.equal(KOMUT_GORULMEZ_METNI, 'Bu komutun ne yaptığı görülemediği için "Yalnız bu bilgisayar" seçiliyken çalıştırılmaz.');
});

test('komutAgaCikar: içi görülebilen sarmalayıcının iç metni de ağ denetiminden geçer', () => {
  for (const k of ["cmd /c 'git pull'", "powershell -c 'npm install'", 'pwsh -Command git fetch', '& git fetch', "cmd /k 'curl https://x'", 'git -c a=b pull']) {
    assert.equal(komutAgaCikar(k), true, k);
  }
  for (const k of ['cmd /c dir', "powershell -c 'Get-ChildItem'", '& git status', 'git -c a=b status']) assert.equal(komutAgaCikar(k), false, k);
});

test('"Yalnız bu bilgisayar"da içi görülemeyen sarmalayıcı onaya düşmeden reddedilir, düz sarmalayıcının içindeki ağ komutu da; normal modda ikisi de karta düşer', async () => {
  const gorulmez = ['powershell -EncodedCommand ZQBjAGgAbwA=', 'powershell -File a.ps1', '.\\betik.ps1', 'cmd /c kur.bat', 'Start-Process notepad'];
  const icAg = ["cmd /c 'git pull'", "powershell -c 'npm install'", '& git fetch'];
  try {
    ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; });
    for (const komut of gorulmez) {
      const { r, sorular } = await cagir({ komut });
      assert.equal(sorular.length, 0, `${komut}: onay sorulmaz`);
      assert.equal(r.hata, true, komut);
      assert.equal(r.icerik, KOMUT_GORULMEZ_METNI, komut);
    }
    for (const komut of icAg) {
      const { r, sorular } = await cagir({ komut });
      assert.equal(sorular.length, 0, `${komut}: onay sorulmaz`);
      assert.equal(r.icerik, KOMUT_AG_KAPALI_METNI, komut);
    }
    // İçi görülebilen ve ağa çıkmayan sarmalayıcı yerel modda da yalnız karta düşer (reddedilir: çalışmaz).
    const duz = await cagir({ komut: 'cmd /c dir' }, { karar: 'reddet' });
    assert.equal(duz.sorular.length, 1);
    assert.match(duz.r.icerik, /reddedildi/);
    // Kart beklenirken "Yalnız bu bilgisayar" seçilirse içi görülemeyen komut onaydan sonra da çalışmaz.
    ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; });
    const arac = aracBul('komut_calistir')!;
    const r2 = await arac.calistir({ komut: 'powershell -File a.ps1', klasor: calisma }, {
      sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set(),
      onay: async () => { ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; }); return 'bir_kez'; },
    } as never);
    assert.equal(r2.icerik, KOMUT_GORULMEZ_METNI);
  } finally { ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; }); }
  // Normal modda ikisi de karta düşer (reddedilir: hiçbiri çalışmaz).
  for (const komut of [...gorulmez, ...icAg]) {
    const { r, sorular } = await cagir({ komut }, { karar: 'reddet' });
    assert.equal(sorular.length, 1, `${komut}: normal modda kart`);
    assert.match(r.icerik, /reddedildi/, komut);
  }
});

test('komutAgaCikar: ağ sınıfı, yıkıcı ama ağa çıkan (git push --force), bileşik içindeki ağ komutu, adres ve ağ yolu', () => {
  for (const k of ['curl https://x', 'git push --force', 'git push -f', 'git status; curl x', 'Start-Process https://fuber.ai', 'dir \\\\s\\p',
    'cmd /c "git pull && dir"', 'npm install', 'iwr u -OutFile a.zip']) assert.equal(komutAgaCikar(k), true, k);
  for (const k of ['git status', 'rm -rf build', 'npm test', 'dir', 'echo x > a.txt', 'Get-Content \\\\?\\C:\\a.txt', "Write-Output 'file:///C:/a'"]) {
    assert.equal(komutAgaCikar(k), false, k);
  }
});

test('Developer mode kapısı: grupEtkin(\'komut\') kuralı (komutAraciAcik) ile ARAÇ NOTLARI\'nın komut satırı (komutNotu) her modda aynı', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    assert.equal(komutAraciAcik({ mod, gizliMod: false }), komutNotu(modKip(mod)) !== '', mod);
  }
  assert.equal(komutAraciAcik({ mod: 'gelistirici', gizliMod: false }), true);
  assert.equal(komutAraciAcik({ mod: 'is', gizliMod: false }), false);
  assert.equal(komutAraciAcik({ mod: 'gelistirici', gizliMod: true }), false, 'Gizli\'de yok');
  assert.equal(komutAraciAcik({ mod: 'is', gizliMod: true }), false);
  assert.equal(KOMUT_SURE_MS, 120_000, 'R8: 120 sn');
  assert.ok(KOMUT_ARAC_SURESI_MS > KOMUT_SURE_MS, 'döngünün araç süresi komutun kendi sınırından uzun (komut önce kapanır, kısmi çıktı modele gider)');
});

test('araç kaydı: komut_calistir grubu tam olarak "komut" (dongu.ts geri dönüşsüz sayar), şema { komut, klasor?, arka_plan? }', () => {
  const a = aracBul('komut_calistir')!;
  assert.equal(a.grup, 'komut');
  assert.equal(a.risk, 'onay', 'risk onay: her çağrı olay günlüğüne düşer, arka plan görev adımına girmez');
  const s = a.tanim.sema as { properties: Record<string, { type: string }>; required: string[] };
  assert.deepEqual(Object.keys(s.properties).sort(), ['arka_plan', 'klasor', 'komut']); // analiz 11 Kas bulgu 4: arka plan modu
  assert.deepEqual(s.required, ['komut']);
  assert.match(a.tanim.aciklama, /PowerShell/);
  assert.match(a.tanim.aciklama, /onay/);
  assert.match(a.etiket({ komut: 'git status' }), /git status/);
});

test('Business mode\'da ve Gizli\'de komut_calistir listede yok; Developer mode\'da var', async () => {
  const { turAraclari } = await import('../src/main/ajan/dongu.ts');
  const var_ = async () => (await turAraclari('merhaba', false)).some((a) => a.tanim.ad === 'komut_calistir');
  try {
    ayarlariKaydet((a) => { a.mod = 'is'; a.yerel.gizliMod = false; a.yerel.yalnizYerel = false; });
    assert.equal(await var_(), false, 'Business mode');
    ayarlariKaydet((a) => { a.mod = 'gelistirici'; });
    assert.equal(await var_(), true, 'Developer mode');
    ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
    assert.equal(await var_(), false, 'Developer + Gizli');
    ayarlariKaydet((a) => { a.mod = 'is'; });
    assert.equal(await var_(), false, 'Business + Gizli');
  } finally { ayarlariKaydet((a) => { a.mod = 'gelistirici'; a.yerel.gizliMod = false; a.yerel.yalnizYerel = false; }); }
});

test('cocukOrtami: ELECTRON_*, FUBER_*, NODE_OPTIONS ve uygulamanın koyduğu sır adlı değişkenler çıkar; kullanıcının kendi sırrı kalır', () => {
  const ilk = { Path: 'C:\\bin', GITHUB_TOKEN: 'kullanici', FUBER_X: '1', ELECTRON_Y: '2', NODE_OPTIONS: '--x', DEGISEN_KEY: 'ilk' };
  const simdi = { ...ilk, Uygulama_Secret: 's', YENI_PASSWORD: 'p', API_KEY: 'k', DEGISEN_KEY: 'uygulama', electron_run_as_node: '1', Fuber_Demo: '1', node_options: '--y', NORMAL: 'n' };
  const o = cocukOrtami(simdi, ilk);
  assert.deepEqual(Object.keys(o).sort(), ['DEGISEN_KEY', 'GITHUB_TOKEN', 'NORMAL', 'Path']);
  assert.equal(o.GITHUB_TOKEN, 'kullanici');
  assert.equal(o.DEGISEN_KEY, 'ilk', 'uygulama değiştirdiyse kullanıcının ilk değeri');
  // Windows'ta ad büyük-küçük harf duyarsız: kullanıcının "github_token"ı ilk ortamdaki "GITHUB_TOKEN"la aynıdır.
  assert.deepEqual(cocukOrtami({ github_token: 'kullanici' }, { GITHUB_TOKEN: 'kullanici' }), { github_token: 'kullanici' });
});

test('ciktiTemizle: ANSI ve denetim karakterleri silinir, \\r ile üzerine yazılan satırın son hâli kalır', () => {
  assert.equal(ciktiTemizle('\u001b[31mkırmızı\u001b[0m\r\nikinci\u0007\u0000'), 'kırmızı\nikinci');
  assert.equal(ciktiTemizle('%10\r%50\r%100\nbitti\r\n'), '%100\nbitti\n');
  assert.equal(ciktiTemizle('\u001b]0;başlık\u0007metin\u001b(B\ttab'), 'metin\ttab');
  assert.equal(ciktiTemizle('\ufeffbom'), 'bom');
});

test('çalıştırma: serbest komut onaysız; Türkçe karakterler bozulmaz (ğüşıöç), çıkış kodu döner', { skip: !windows && 'yalnız Windows' }, async () => {
  const { r, sorular } = await cagir({ komut: 'Write-Output ğüşıöç' }); // düzeltme turu 5: tırnaksız (tırnak kapıdan geçmez); Türkçe harf \p{L}
  assert.equal(sorular.length, 0, 'serbest komut onay sormaz');
  assert.equal(r.hata ?? false, false, r.icerik);
  assert.match(r.icerik, /^Çıkış kodu: 0$/m);
  assert.match(r.icerik, /ğüşıöç/);
  const n = await cagir({ komut: `node -e "console.log('ğüşıöç İı')"` });
  assert.equal(n.sorular.length, 1, 'bilinmeyen komut bir kez onay ister');
  assert.match(n.r.icerik, /^ğüşıöç İı$/m, n.r.icerik);
  const k = await cagir({ komut: 'node -e "process.exit(3)"' });
  assert.match(k.r.icerik, /^Çıkış kodu: 3$/m, k.r.icerik);
  assert.equal(k.r.hata ?? false, false, 'komut çalıştı; sıfır olmayan çıkış kodu aracın hatası değil');
  assert.match(k.r.ozet ?? '', /çıkış kodu 3/);
});

test('çalıştırma: onay kartı tek yol (dongu.ts onayı) — yıkıcı kart "değiştirebilir" der, reddedilince komut çalışmaz', { skip: !windows && 'yalnız Windows' }, async () => {
  const isaret = path.join(calisma, 'isaret.txt');
  const { r, sorular } = await cagir({ komut: `node -e "require('fs').writeFileSync('isaret.txt','1')"` }, { karar: 'reddet' });
  assert.equal(sorular.length, 1);
  assert.match(sorular[0].aciklama, /dosyaları ya da sistemi değiştirebilir/);
  assert.doesNotMatch(sorular[0].aciklama, /yıkıcı/i, 'kart komutun yıkıcı olduğunu iddia etmez');
  assert.match(sorular[0].onizleme ?? '', /writeFileSync/);
  assert.match(sorular[0].onizleme ?? '', new RegExp(`Klasör: ${calisma.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
  assert.equal(r.hata, true);
  assert.match(r.icerik, /reddedildi/);
  assert.equal(fs.existsSync(isaret), false, 'reddedilen komut çalışmadı');
  // Ağ ve karmaşık komutun kartı kendi nedenini söyler (çalıştırılmadan: hepsi reddedilir).
  const ag = await cagir({ komut: 'curl https://x' }, { karar: 'reddet' });
  assert.match(ag.sorular[0].aciklama, /dışarı/);
  const karma = await cagir({ komut: 'git status; git log' }, { karar: 'reddet' });
  assert.match(karma.sorular[0].aciklama, /birden çok/);
  // Kart komutun TAMAMINI gösterir (kesilmez: kullanıcı görmediği parçayı onaylamaz); 2.000 karakteri aşan komut sorulmadan geri çevrilir.
  const uzun = `node -e "${'1;'.repeat(900)}"`;
  const u = await cagir({ komut: uzun }, { karar: 'reddet' });
  assert.ok(u.sorular[0].onizleme?.startsWith(`${uzun}\n`), 'önizleme komutun tamamı');
  const asiri = await cagir({ komut: `echo ${'x'.repeat(2001)}` });
  assert.equal(asiri.sorular.length, 0);
  assert.equal(asiri.r.hata, true);
  assert.match(asiri.r.icerik, /çok uzun/);
});

test('C1 zinciri: ajan yeni klasöre package.json (ve .npmrc) yazar, ardından npm test — onay kartı çıkar, reddedilince betik çalışmaz', { skip: !windows && 'yalnız Windows' }, async () => {
  const { dosyaYazAraclariniKaydet } = await import('../src/main/ajan/araclar/dosya-yaz.ts');
  dosyaYazAraclariniKaydet();
  const proje = path.join(process.env.USERPROFILE!, 'Documents', 'c1-ajan-projesi');
  const isaret = path.join(proje, 'calisti.txt');
  const yaz = async (ad: string, icerik: string) => {
    const sorular: Istek[] = [];
    const r = await aracBul('dosya_yaz')!.calistir({ yol: path.join(proje, ad), icerik, kip: 'yeni' }, {
      sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set(), onay: async (i: Istek) => { sorular.push(i); return 'bir_kez'; },
    } as never);
    assert.equal(r.hata, undefined, r.icerik);
    return sorular.length;
  };
  assert.equal(await yaz('package.json', JSON.stringify({ name: 'c1', scripts: { test: "node -e \"require('fs').writeFileSync('calisti.txt','1')\"" } })), 0,
    'yeni düz dosya onaysız (değişmedi)');
  assert.equal(await yaz('.npmrc', 'fund=false\n'), 0);
  for (const komut of ['npm test', 'npm run test', 'npm t', 'npm test -- --grep x']) {
    const { r, sorular } = await cagir({ komut, klasor: proje }, { karar: 'reddet' });
    assert.equal(sorular.length, 1, `${komut}: onay kartı çıkmalı`);
    assert.match(sorular[0].aciklama, /proje/i, 'kart proje kodunu çalıştıracağını söyler');
    assert.match(sorular[0].aciklama, /dosyaları ya da sistemi değiştirebilir/);
    assert.match(r.icerik, /reddedildi/);
  }
  assert.equal(fs.existsSync(isaret), false, 'reddedilen npm test betiği çalışmadı');
});

// ── Tur 2 N1: çalışma klasörünün ayarıyla kendi kodunu bulan başlatıcılar hiçbir biçimde serbest değil ──────────────────────────────────────────
/** Klasördeki ayar dosyasıyla (npmrc, global.json, rust-toolchain, go.mod toolchain, .python-version, gradle/maven sarmalayıcısı, Volta, corepack…)
 *  çalışacak kodu seçebilen başlatıcılar. */
const BASLATICI_KOMUTLARI = ['npm -v', 'npm --version', 'npm ls', 'npm run', 'npm list', 'npm config list', 'npm.cmd -v', 'node -v', 'node --version', 'node.exe -v',
  'npx -v', 'yarn -v', 'pnpm -v', 'bun -v', 'pip --version', 'pip3 --version', 'python --version', 'python3 -V', 'py --version', 'go version', 'go env',
  'cargo --version', 'rustup show', 'rustc -V', 'dotnet --version', 'dotnet --info', 'gradle -v', 'gradlew -v', 'gradlew.bat -v', 'mvn -v', 'mvnw -v', 'mvnw.cmd -v',
  'deno --version', 'tsc --version', 'uv --version', 'java --version', 'docker --version', 'code --version', 'corepack -v', 'volta list', 'make -v', 'araç.cmd',
  'kabuk.bat', 'yardimci.exe'];

test('Tur 2 N1 (saf): başlatıcıların hiçbir biçimi serbest değil; serbest kalanlar çalışma klasöründen kod seçemeyen komutlar', () => {
  for (const k of BASLATICI_KOMUTLARI) assert.equal(sinif(k).sinif, 'onay', k);
  // Her npm ve node komutu (argümanlarıyla) — serbest sınıf asla dönmez.
  for (const a of ['', '-v', '--version', 'ls', 'list', 'll', 'la', 'run', 'run-script', 'help', 'config get x', 'root', 'prefix', 'bin', 'version']) {
    for (const p of ['npm', 'npm.cmd', 'node', 'node.exe']) assert.notEqual(sinif(`${p} ${a}`.trim()).sinif, 'serbest', `${p} ${a}`);
  }
  for (const k of ['git status', 'git --version', 'dir', 'Get-ChildItem', 'type package.json', 'where.exe git', 'findstr x a.txt', 'Get-Command node', 'whoami', 'hostname']) {
    assert.deepEqual(sinif(k), SERBEST, k);
  }
});

test('Tur 2 N1: ajanın yazdığı çalışma klasöründe (npmrc, global.json, araç zinciri dosyaları, .cmd kabuğu) her başlatıcı onay kartına düşer', { skip: !windows && 'yalnız Windows' }, async () => {
  const { dosyaYazAraclariniKaydet } = await import('../src/main/ajan/araclar/dosya-yaz.ts');
  dosyaYazAraclariniKaydet();
  const proje = path.join(process.env.USERPROFILE!, 'Documents', 'n1-ajan-projesi');
  const yaz = async (ad: string, icerik: string) => {
    const r = await aracBul('dosya_yaz')!.calistir({ yol: path.join(proje, ad), icerik, kip: 'yeni' }, {
      sohbetId: 77, sinyal: new AbortController().signal, gorevIzinleri: new Set(), onay: async () => 'reddet',
    } as never);
    return r;
  };
  // Onaysız yazılabilen yapılandırma dosyaları (çalıştırılabilir tür değil).
  for (const [ad, icerik] of [['.npmrc', 'script-shell=x\n'], ['package.json', '{"name":"n1","volta":{"node":"99.0.0"},"packageManager":"yarn@9.9.9"}'],
    ['global.json', '{"sdk":{"version":"99.0.0"}}'], ['rust-toolchain.toml', '[toolchain]\nchannel = "nightly"\n'], ['go.mod', 'module n1\n\ngo 1.99\ntoolchain go1.99.0\n'],
    ['.python-version', '3.99\n'], ['pip.ini', '[global]\nindex-url = http://x\n'], ['.yarnrc.yml', 'yarnPath: x.cjs\n'], ['gradle/wrapper/gradle-wrapper.properties', 'distributionUrl=x\n'],
    ['.mvn/wrapper/maven-wrapper.properties', 'distributionUrl=x\n']] as const) {
    const r = await yaz(ad, icerik);
    assert.equal(r.hata, undefined, `${ad}: ${r.icerik}`);
  }
  // Çalıştırılabilir kabuk (.cmd) kart ister; reddedildi — dosya yok. Kabuk adının çağrısı da kart ister.
  assert.match((await yaz('npm.cmd', '@echo x')).icerik, /reddedildi/);
  for (const komut of BASLATICI_KOMUTLARI) {
    const { r, sorular } = await cagir({ komut, klasor: proje }, { karar: 'reddet' });
    assert.equal(sorular.length, 1, `${komut}: onay kartı çıkmalı`);
    assert.match(r.icerik, /reddedildi/, komut);
  }
});

test('Tur 2 N1 (derinlik): serbest komut NoDefaultCurrentDirectoryInExePath=1 ve göreli PATH girdisi olmadan çalışır', async () => {
  const { serbestOrtam } = await import('../src/main/ajan/araclar/komut.ts');
  const e = serbestOrtam({ Path: `C:\\Windows\\System32;.;araclar;;C:\\Git\\cmd`, PSModulePath: 'C:\\Kullanicilar\\x\\Documents\\WindowsPowerShell\\Modules', DIGER: '1' });
  assert.equal(e.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(e.Path, 'C:\\Windows\\System32;C:\\Git\\cmd', 'göreli PATH girdileri (., araclar) atılır');
  assert.doesNotMatch(e.PSModulePath, /Documents/);
  assert.equal(e.DIGER, '1');
});

test('Minor 6: kart beklenirken Business mode\'a geçilirse onaylanan komut çalışmaz', { skip: !windows && 'yalnız Windows' }, async () => {
  const isaret = path.join(calisma, 'm6.txt');
  const arac = aracBul('komut_calistir')!;
  try {
    const r = await arac.calistir({ komut: `node -e "require('fs').writeFileSync('m6.txt','1')"`, klasor: calisma }, {
      sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set(),
      onay: async () => { ayarlariKaydet((a) => { a.mod = 'is'; }); return 'bir_kez'; },
    } as never);
    assert.equal(r.hata, true);
    assert.match(r.icerik, /Developer mode/);
    assert.equal(fs.existsSync(isaret), false);
  } finally { ayarlariKaydet((a) => { a.mod = 'gelistirici'; }); }
});

test('Minor 2: serbest komut kullanıcının Belgeler\\WindowsPowerShell\\Modules klasöründen modül yüklemez (PSModulePath yalnız sistem klasörleri)', { skip: !windows && 'yalnız Windows' }, async () => {
  const { psModulYolu } = await import('../src/main/ajan/araclar/komut.ts');
  const y = psModulYolu();
  assert.match(y, /WindowsPowerShell\\v1\.0\\Modules$/i);
  assert.doesNotMatch(y, /Documents|Belgeler|OneDrive/i);
  // Serbest komut (tırnaksız, $'sız) çocuğun gördüğü modül yolunu yazdırır: kullanıcı klasörü yok.
  const s = await cagir({ komut: 'Get-Content env:PSModulePath' });
  assert.equal(s.sorular.length, 0, s.r.icerik);
  assert.match(s.r.icerik, /Çıkış kodu: 0/);
  assert.match(s.r.icerik, /WindowsPowerShell\\v1\.0\\Modules/i);
  assert.doesNotMatch(s.r.icerik, /Documents\\WindowsPowerShell|Belgeler\\WindowsPowerShell/i, 'kullanıcının modül klasörü yolda yok');
  const h = await cagir({ komut: 'Get-FileHash package.json' }); // Microsoft.PowerShell.Utility kendiliğinden yüklenir: sistem yolu yeter
  assert.equal(h.sorular.length, 0);
  assert.match(h.r.icerik, /Çıkış kodu: [01]/);
  assert.doesNotMatch(h.r.icerik, /tanınmıyor|not recognized/i, 'yerleşik cmdlet sistem modül yoluyla bulunur');
});

test('çalıştırma: çocuk süreç uygulamanın iç değişkenlerini görmez (cihaz anahtarı, oturum belirteci dahil)', { skip: !windows && 'yalnız Windows' }, async () => {
  const { r } = await cagir({ komut: 'node -e "console.log(JSON.stringify(process.env))"' });
  const satir = r.icerik.split('\n').find((s) => s.startsWith('{'));
  assert.ok(satir, 'ortam çıktısı yok');
  const ortam = JSON.parse(satir) as Record<string, string>;
  const adlar = Object.keys(ortam).map((k) => k.toUpperCase());
  for (const yasak of ['ELECTRON_OZEL_DEGISKEN', 'FUBER_CIHAZ_ANAHTARI', 'FUBER_OTURUM', 'FUBER_VERI', 'FUBER_DEMO', 'NODE_OPTIONS', 'UYGULAMA_SESSION_TOKEN', 'UYGULAMA_SECRET', 'UYGULAMA_PASSWORD']) {
    assert.ok(!adlar.includes(yasak), `çocuk görmemeli: ${yasak}`);
  }
  assert.ok(!adlar.some((a) => a.startsWith('ELECTRON_') || a.startsWith('FUBER_')), 'ELECTRON_/FUBER_ önekli değişken kalmadı');
  assert.ok(!r.icerik.includes('cihaz-anahtari') && !r.icerik.includes('uygulamanin-belirteci'), 'değerler de yok');
  assert.equal(ortam.KULLANICI_API_KEY ?? ortam.kullanici_api_key, 'kullanicinin-kendi-anahtari', 'kullanıcının kendi değişkeni geçer');
  assert.equal(ortam.KULLANICI_DEGISKENI, 'gorunur');
  assert.ok(adlar.includes('PATH'), 'kullanıcının olağan ortamı (PATH) var');
});

test('çalıştırma: stdout ve stderr sırayla birleşir, ANSI silinir', { skip: !windows && 'yalnız Windows' }, async () => {
  const { r } = await cagir({ komut: `node -e "console.log('bir'); setTimeout(() => console.error('iki'), 250); setTimeout(() => process.stdout.write('\\u001b[32muc\\u001b[0m\\n'), 500)"` });
  const govde = r.icerik.split('\n').filter((s) => ['bir', 'iki', 'uc'].includes(s.trim()));
  assert.deepEqual(govde.map((s) => s.trim()), ['bir', 'iki', 'uc'], r.icerik);
  assert.doesNotMatch(r.icerik, /\u001b/);
});

test('çıktı 20.000 karakterde kesilir ve bunu söyler; baş ve SON görünür, ortadan atlanan sayılır (ajan döngüsü ikinci kez kesmez)', { skip: !windows && 'yalnız Windows' }, async () => {
  const { r } = await cagir({ komut: `node -e "process.stdout.write('BAS-SATIRI\\n' + 'x'.repeat(25000) + '\\nSON-SATIRI 3 gecti 1 kaldi\\n')"` });
  assert.ok(sonucKisaltildiMi(r.icerik), r.icerik.slice(-120));
  assert.match(r.icerik, /… \(sonuç kısaltıldı: 20\.000 \/ 25\.\d{3} karakter\)$/);
  assert.ok(r.icerik.length <= ARAC_SONUC_SINIRI + 60, String(r.icerik.length));
  assert.match(r.icerik, /^Çıkış kodu: 0$/m, 'çıkış kodu kesilen yerin önünde');
  assert.match(r.icerik, /^BAS-SATIRI$/m, 'baş görünür');
  assert.match(r.icerik, /\nSON-SATIRI 3 gecti 1 kaldi… \(sonuç kısaltıldı/, 'son satır (özet) görünür');
  assert.match(r.icerik, /\n… \(ortadan [\d.]+ karakter atlandı\) …\n/);
  assert.equal(aracSonucuKisalt(r.icerik), r.icerik, 'döngü yeniden kesmez');
  assert.match(r.ozet ?? '', /çıktı kısaltıldı/);
});

test('bellek sınırını (200.000) aşan çıktıda da son satır görünür, nottaki toplam gerçek uzunluk', { skip: !windows && 'yalnız Windows' }, async () => {
  const { r } = await cagir({ komut: `node -e "process.stdout.write('x'.repeat(300000) + '\\nSON-SATIRI\\n')"` });
  assert.match(r.icerik, /\nSON-SATIRI… \(sonuç kısaltıldı: 20\.000 \/ 300\.\d{3} karakter\)$/);
  assert.ok(r.icerik.length <= ARAC_SONUC_SINIRI + 60, String(r.icerik.length));
  assert.equal(aracSonucuKisalt(r.icerik), r.icerik);
});

test('durdurulunca süreç ağacı kapanır (sahte uzun süreç ve torunu)', { skip: !windows && 'yalnız Windows' }, async () => {
  for (const f of ['cocuk.pid', 'torun.pid']) fs.rmSync(path.join(calisma, f), { force: true });
  const kontrol = new AbortController();
  const sahte = `node -e "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync('torun.pid',String(c.pid));require('fs').writeFileSync('cocuk.pid',String(process.pid));setInterval(()=>{},1000)"`;
  const s = cagir({ komut: sahte }, { sinyal: kontrol.signal });
  assert.ok(await bekle(() => fs.existsSync(path.join(calisma, 'cocuk.pid')) && fs.existsSync(path.join(calisma, 'torun.pid'))), 'sahte süreç başlamadı');
  const cocuk = Number(fs.readFileSync(path.join(calisma, 'cocuk.pid'), 'utf8'));
  const torun = Number(fs.readFileSync(path.join(calisma, 'torun.pid'), 'utf8'));
  assert.ok(yasiyor(cocuk) && yasiyor(torun), 'ikisi de yaşıyor');
  const bas = Date.now();
  kontrol.abort();
  const { r } = await s;
  assert.ok(Date.now() - bas < 10_000, 'durdurma hemen döner');
  assert.equal(r.hata, true);
  assert.match(r.icerik, /durdurdu/);
  assert.ok(await bekle(() => !yasiyor(cocuk) && !yasiyor(torun)), `süreç ağacı kapanmadı (çocuk ${yasiyor(cocuk)}, torun ${yasiyor(torun)})`);
});

test('süre sınırında süreç ağacı kapanır, o ana dek çıktı ve sınır notu döner', { skip: !windows && 'yalnız Windows' }, async () => {
  fs.rmSync(path.join(calisma, 'torun2.pid'), { force: true });
  const sahte = `node -e "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync('torun2.pid',String(c.pid));console.log('basladi');setInterval(()=>{},1000)"`;
  const s = await komutuCalistir(sahte, { klasor: calisma, sureMs: 6000 });
  assert.equal(s.durum, 'zaman');
  assert.match(s.cikti, /basladi/);
  const torun = Number(fs.readFileSync(path.join(calisma, 'torun2.pid'), 'utf8'));
  assert.ok(await bekle(() => !yasiyor(torun)), 'torun süre sınırında kapanmadı');
});

test('"Yalnız bu bilgisayar" seçiliyken ağa çıkan komut hiç çalışmaz (onay da sorulmaz); öbür komutlar çalışır', { skip: !windows && 'yalnız Windows' }, async () => {
  try {
    ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; });
    for (const komut of ['curl https://x', 'git push --force', 'npm install', 'git status; curl x']) {
      const { r, sorular } = await cagir({ komut });
      assert.equal(sorular.length, 0, `${komut}: onay sorulmaz`);
      assert.equal(r.hata, true, komut);
      assert.equal(r.icerik, KOMUT_AG_KAPALI_METNI, komut);
    }
    assert.equal(KOMUT_AG_KAPALI_METNI, 'Bu bilgisayardan dışarı çıkan komutlar "Yalnız bu bilgisayar" seçiliyken çalışmaz.');
    const { r } = await cagir({ komut: "Write-Output 'yerel'" });
    assert.match(r.icerik, /^yerel$/m);
    // Onay beklenirken "Yalnız bu bilgisayar" seçilirse ağ komutu onaydan sonra da çalışmaz.
    ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; });
    const arac = aracBul('komut_calistir')!;
    const r2 = await arac.calistir({ komut: 'curl https://x', klasor: calisma }, {
      sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set(),
      onay: async () => { ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; }); return 'bir_kez'; },
    } as never);
    assert.equal(r2.icerik, KOMUT_AG_KAPALI_METNI);
  } finally { ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; }); }
});

test('Gizli açıksa araç çalışmaz (listede de yok); klasör yoksa Belgeler, var olmayan klasör hata', { skip: !windows && 'yalnız Windows' }, async () => {
  try {
    ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
    const { r, sorular } = await cagir({ komut: 'git status' });
    assert.equal(r.hata, true);
    assert.equal(sorular.length, 0);
    assert.match(r.icerik, /Gizli/);
  } finally { ayarlariKaydet((a) => { a.yerel.gizliMod = false; }); }
  const arac = aracBul('komut_calistir')!;
  const b = { sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set(), onay: async () => 'bir_kez' } as never;
  const v = await arac.calistir({ komut: 'pwd' }, b);
  assert.match(v.icerik, new RegExp(`Klasör: ${sahne.klasor.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`), v.icerik);
  const y = await arac.calistir({ komut: 'pwd', klasor: path.join(calisma, 'yok') }, b);
  assert.equal(y.hata, true);
  assert.match(y.icerik, /Klasör yok/);
  const g = await arac.calistir({ komut: 'pwd', klasor: 'goreli\\klasor' }, b);
  assert.equal(g.hata, true);
  assert.match(g.icerik, /tam yol/);
});

// ── Düzeltme turu 1: git sertleştirmesi (sahte depolar; gerçek git ve depodaki hiçbir program çalışmaz) ─────────────────────────────────
const depoKur = (ad: string, o: { config?: string; hooks?: readonly string[] } = {}): string => {
  const kok = path.join(sahne.klasor, 'depolar', ad);
  const git = path.join(kok, '.git');
  fs.mkdirSync(path.join(git, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(kok, 'alt', 'klasor'), { recursive: true });
  fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(git, 'config'), o.config ?? '[core]\n\trepositoryformatversion = 0\n\tbare = false\n');
  fs.writeFileSync(path.join(git, 'hooks', 'pre-commit.sample'), '#!/bin/sh\n');
  for (const h of o.hooks ?? []) fs.writeFileSync(path.join(git, 'hooks', h), '#!/bin/sh\n');
  return kok;
};

test('depoRiskli: klasörden yukarı bulunan deponun ayarı program çalıştırabiliyorsa (filter, include, gpg, diff.external, textconv) ya da okunamıyorsa true; hook ve hooksPath değil', () => {
  const temiz = depoKur('temiz');
  assert.equal(depoRiskli(temiz), false);
  assert.equal(depoRiskli(path.join(temiz, 'alt', 'klasor')), false, 'alt klasörden yukarı');
  for (const [ad, config] of [
    ['filtre', '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\tsmudge = git-lfs smudge -- %f\n\tprocess = git-lfs filter-process\n'],
    ['filtre-nokta', '[filter.lfs]\n\tsmudge = x\n'],
    ['textconv', '[diff "pdf"]\n\ttextconv = x\n'],
    ['include', '[include]\n\tpath = ../x.cfg\n'],
    ['includeif', '[includeIf "gitdir:~/"]\n\tpath = x\n'],
    ['external', '[diff]\n\texternal = x\n'],
    ['external-ayni-satir', '[diff] external = x\n'],
    ['gpg', '[gpg]\n\tprogram = x\n'],
    ['gpg-ssh', '[gpg "ssh"]\n\tprogram = x\n'],
    ['buyuk-harf', '[FILTER "x"]\n\tCLEAN = y\n'],
    // Düzeltme turu 4 (Y-2b): depo ayarındaki submodule.* ve diff.submodule de onay ister.
    ['alt-modul', '[submodule "x"]\n\turl = ../x\n\tactive = true\n'],
    ['diff-submodule', '[diff]\n\tsubmodule = log\n'],
    ['diff-submodule-buyuk', '[DIFF]\n\tSubmodule = short\n'],
  ] as const) assert.equal(depoRiskli(path.join(depoKur(ad, { config }), 'alt')), true, ad);
  // Daraltma (denetleyici kararı): hook dosyaları, hooksPath ve fsmonitor onay tetiklemez (okuma komutu hook çalıştırmaz; fsmonitor ortamla false).
  assert.equal(depoRiskli(depoKur('hook', { hooks: ['pre-commit', 'post-checkout', 'post-index-change', 'fsmonitor-watchman'] })), false, 'hook dosyaları');
  assert.equal(depoRiskli(depoKur('hookspath', { config: '[core]\n\thooksPath = .husky\n' })), false, 'core.hooksPath');
  assert.equal(depoRiskli(depoKur('fsmonitor', { config: '[core]\n\tfsmonitor = true\n' })), false, 'core.fsmonitor (GIT_CONFIG ile false)');
  // Bağlı çalışma ağacı: .git DOSYASI gitdir'i gösterir; ortak klasörün (commondir) ayarı ve hook'ları okunur.
  const agacKur = (ad: string, ana: string): string => {
    const agac = path.join(sahne.klasor, 'depolar', ad);
    const agacGit = path.join(ana, '.git', 'worktrees', ad);
    fs.mkdirSync(agac, { recursive: true });
    fs.mkdirSync(agacGit, { recursive: true });
    fs.writeFileSync(path.join(agacGit, 'commondir'), '../..\n');
    fs.writeFileSync(path.join(agac, '.git'), `gitdir: ${agacGit}\n`);
    return agac;
  };
  assert.equal(depoRiskli(agacKur('agac-riskli', depoKur('ana-riskli', { config: '[filter "x"]\n\tclean = y\n' }))), true, 'çalışma ağacı ortak ayarı okur');
  assert.equal(depoRiskli(agacKur('agac-temiz', depoKur('ana-temiz'))), false);
  // Okunamayan: bozuk .git dosyası, klasör olan config.
  const bozuk = path.join(sahne.klasor, 'depolar', 'bozuk');
  fs.mkdirSync(bozuk, { recursive: true });
  fs.writeFileSync(path.join(bozuk, '.git'), 'bozuk içerik\n');
  assert.equal(depoRiskli(bozuk), true, 'okunamayan .git dosyası');
  const klasorConfig = depoKur('klasor-config');
  fs.rmSync(path.join(klasorConfig, '.git', 'config'));
  fs.mkdirSync(path.join(klasorConfig, '.git', 'config'));
  assert.equal(depoRiskli(klasorConfig), true, 'okunamayan config');
});

/** Ortamdaki GIT_CONFIG girdilerini [anahtar, değer] çiftlerine çevirir (COUNT kadar). */
const gitConfigCiftleri = (o: Record<string, string>): [string, string][] => Array.from({ length: Number(o.GIT_CONFIG_COUNT ?? '0') }, (_, i) => [o[`GIT_CONFIG_KEY_${i}`], o[`GIT_CONFIG_VALUE_${i}`]] as [string, string]);

test('gitOrtami (Y1/Y2): GIT_OPTIONAL_LOCKS=0; hooksPath=boş klasör, diff.autoRefreshIndex=false, alt modül kapalı; yeni git\'te ek olarak fsmonitor/showSignature; var olanların ardına', () => {
  const o = gitOrtami({ PATH: 'p' }, true, 'C:\\bos');
  assert.equal(o.GIT_OPTIONAL_LOCKS, '0');
  // Düzeltme turu 4 (Y-2b): diff.submodule=short (ortam girdisi depo ayarının üstünde: satır içi alt modül farkı seçilemez).
  assert.deepEqual(gitConfigCiftleri(o), [
    ['core.hooksPath', 'C:\\bos'], ['diff.autoRefreshIndex', 'false'], ['diff.ignoreSubmodules', 'all'], ['status.submoduleSummary', 'false'],
    ['diff.submodule', 'short'], ['core.fsmonitor', 'false'], ['log.showSignature', 'false'],
  ]);
  // Eski git (2.36 öncesi): fsmonitor/showSignature YOK (false hook yolu sayılır), ama hook ve alt modül kapatması yine var.
  assert.deepEqual(gitConfigCiftleri(gitOrtami({ PATH: 'p' }, false, 'C:\\bos')), [
    ['core.hooksPath', 'C:\\bos'], ['diff.autoRefreshIndex', 'false'], ['diff.ignoreSubmodules', 'all'], ['status.submoduleSummary', 'false'],
    ['diff.submodule', 'short'],
  ]);
  // hookKlasoru verilmezse core.hooksPath atlanır (öbürleri kalır).
  assert.ok(!gitConfigCiftleri(gitOrtami({ PATH: 'p' }, true)).some(([k]) => k === 'core.hooksPath'));
  // Kullanıcının var olan GIT_CONFIG girdilerinin ardına yazılır (üzerine değil).
  const ek = gitOrtami({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'D' }, true, 'C:\\bos');
  assert.deepEqual(gitConfigCiftleri(ek)[0], ['user.name', 'D']);
  assert.equal(ek.GIT_CONFIG_COUNT, '8');
});

test('hookKlasoruHazirla (düzeltme turu 3): her seferinde var ve boş olduğu denetlenir; içine konan dosya temizlenir; hazırlanamazsa temiz değil, var olmayan yol', () => {
  const ilk = hookKlasoruHazirla();
  assert.equal(ilk.temiz, true);
  assert.ok(fs.statSync(ilk.yol).isDirectory(), 'klasör var');
  assert.deepEqual(fs.readdirSync(ilk.yol), [], 'klasör boş');
  // Kurcalama: klasöre dosya ve alt klasör konur → bir sonraki çağrı temizler (yol önbellekte olsa da içerik yeniden denetlenir).
  fs.writeFileSync(path.join(ilk.yol, 'pre-commit'), 'x');
  fs.mkdirSync(path.join(ilk.yol, 'alt'), { recursive: true });
  fs.writeFileSync(path.join(ilk.yol, 'alt', 'y'), 'y');
  const ikinci = hookKlasoruHazirla();
  assert.deepEqual([ikinci.yol, ikinci.temiz], [ilk.yol, true]);
  assert.deepEqual(fs.readdirSync(ikinci.yol), [], 'içerik temizlendi');
  // Hazırlanamayan klasör: yolu bir DOSYANIN altında (oluşturulamaz) → temiz değil; verilen yol kurcalanan değil, var olmayan bir yol.
  const engel = path.join(sahne.klasor, 'hook-engel');
  fs.writeFileSync(engel, 'dosya');
  try {
    hookKlasorunuAyarla(path.join(engel, 'git-bos-hooks'));
    const h = hookKlasoruHazirla();
    assert.equal(h.temiz, false);
    assert.notEqual(h.yol, path.join(engel, 'git-bos-hooks'));
    assert.equal(fs.existsSync(h.yol), false, 'hooksPath var olmayan bir yol (hook bulunmaz)');
  } finally { hookKlasorunuAyarla(undefined); }
});

test('serbest git komutu riskli depoda, -C ile gösterilen riskli depoda ya da eski/okunamayan git\'te onay ister; reddedilince çalışmaz', async () => {
  assert.equal(DEPO_PROGRAM_METNI, 'Bu depo, git komutlarında program çalıştıracak ayarlar içeriyor.');
  gitSurumunuAyarla('git version 2.45.1.windows.1');
  try {
    for (const [ad, o] of [
      ['riskli-lfs', { config: '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\trequired = true\n' }],
      ['riskli-gpg', { config: '[gpg]\n\tprogram = x\n' }],
    ] as const) {
      const { r, sorular } = await cagir({ komut: 'git status', klasor: depoKur(ad, o) }, { karar: 'reddet' });
      assert.equal(sorular.length, 1, ad);
      assert.equal(sorular[0].aciklama, DEPO_PROGRAM_METNI, ad);
      assert.match(r.icerik, /reddedildi/);
    }
    const riskli = depoKur('riskli-c', { config: '[include]\n\tpath = ../x.cfg\n' });
    assert.ok(!/\s/.test(riskli), 'sınama yolu boşluksuz (tırnaksız -C)');
    const c = await cagir({ komut: `git -C ${riskli} log -1`, klasor: calisma }, { karar: 'reddet' });
    assert.equal(c.sorular[0]?.aciklama, DEPO_PROGRAM_METNI, '-C ile gösterilen depo');
    // Düzeltme turu 3 (N1): boş hook klasörü hazırlanamazsa serbest git komutu onaya düşer (kartta nedeni).
    const engel = path.join(sahne.klasor, 'hook-engel-2');
    fs.writeFileSync(engel, 'dosya');
    hookKlasorunuAyarla(path.join(engel, 'git-bos-hooks'));
    try {
      const h = await cagir({ komut: 'git status', klasor: depoKur('hook-hazir-degil') }, { karar: 'reddet' });
      assert.equal(h.sorular.length, 1);
      assert.equal(h.sorular[0].aciklama, HOOK_KLASORU_METNI);
    } finally { hookKlasorunuAyarla(undefined); }
    gitSurumunuAyarla('git version 2.35.1.windows.2');
    const e = await cagir({ komut: 'git status', klasor: depoKur('eski-git') }, { karar: 'reddet' });
    assert.equal(e.sorular.length, 1);
    assert.equal(e.sorular[0].aciklama, ESKI_GIT_METNI);
    gitSurumunuAyarla(null);
    const y = await cagir({ komut: 'git status', klasor: depoKur('surum-yok') }, { karar: 'reddet' });
    assert.equal(y.sorular[0]?.aciklama, ESKI_GIT_METNI, 'sürüm okunamadı');
  } finally { gitSurumunuAyarla(undefined); }
});

test('serbest git komutu temiz depoda onaysız; diff/log/show alt komuttan sonra --no-ext-diff --no-textconv ve sertleştirilmiş ortamla çalışır (sahte git)', { skip: !windows && 'yalnız Windows' }, async () => {
  const kutu = path.join(sahne.klasor, 'sahte-git');
  fs.mkdirSync(kutu, { recursive: true });
  const konfig = 'Array.from({length:Number(e.GIT_CONFIG_COUNT||0)},(_,i)=>[e["GIT_CONFIG_KEY_"+i],e["GIT_CONFIG_VALUE_"+i]])';
  fs.writeFileSync(path.join(kutu, 'yaz.cjs'), `const e = process.env; console.log('SAHTE-GIT ' + JSON.stringify({ argv: process.argv.slice(2), kilit: e.GIT_OPTIONAL_LOCKS, konfig: ${konfig} }));\n`);
  fs.writeFileSync(path.join(kutu, 'git.cmd'), '@node "%~dp0yaz.cjs" %*\r\n');
  const eskiPath = process.env.PATH;
  process.env.PATH = `${kutu};${eskiPath}`;
  gitSurumunuAyarla('git version 2.45.1.windows.1');
  const oku = (icerik: string) => {
    const s = icerik.split('\n').find((x) => x.startsWith('SAHTE-GIT '));
    assert.ok(s, icerik);
    return JSON.parse(s.slice('SAHTE-GIT '.length)) as { argv: string[]; kilit?: string; konfig: [string, string][] };
  };
  const ayar = (g: { konfig: [string, string][] }, anahtar: string) => g.konfig.find(([k]) => k === anahtar)?.[1];
  try {
    const depo = depoKur('calisan');
    const l = await cagir({ komut: 'git log --oneline -3', klasor: depo });
    assert.equal(l.sorular.length, 0, 'serbest: onay yok');
    const g = oku(l.r.icerik);
    assert.deepEqual(g.argv, ['log', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--oneline', '-3'], 'Y-2b: log da alt modülleri bastırır');
    assert.equal(g.kilit, '0');
    // Y1/Y2: hook ve alt modül kapalı; hooksPath var olan boş bir klasör.
    assert.equal(ayar(g, 'diff.autoRefreshIndex'), 'false');
    assert.equal(ayar(g, 'diff.ignoreSubmodules'), 'all');
    assert.equal(ayar(g, 'status.submoduleSummary'), 'false');
    assert.equal(ayar(g, 'diff.submodule'), 'short', 'Y-2b');
    assert.equal(ayar(g, 'core.fsmonitor'), 'false');
    const hooksPath = ayar(g, 'core.hooksPath');
    assert.ok(hooksPath && fs.statSync(hooksPath).isDirectory() && fs.readdirSync(hooksPath).length === 0, 'hooksPath boş klasör');
    const stSonuc = (await cagir({ komut: 'git status --short', klasor: path.join(depo, 'alt') })).r;
    const st = oku(stSonuc.icerik);
    assert.deepEqual(st.argv, ['status', '--ignore-submodules=all', '--short'], 'Y2: status alt modülleri komut satırıyla bastırır');
    assert.equal(st.kilit, '0', 'aynı ortamı alır');
    assert.ok(!stSonuc.icerik.includes(ALT_MODUL_NOTU), '.gitmodules yokken not yok');
    // N3: depoda .gitmodules varsa serbest status/diff (düzeltme turu 4'ten beri log/show da) çıktısının sonunda tek satırlık not.
    const altli = depoKur('alt-modullu');
    fs.writeFileSync(path.join(altli, '.gitmodules'), '[submodule "x"]\n\tpath = x\n');
    const stA = await cagir({ komut: 'git status', klasor: altli });
    assert.match(stA.r.icerik, new RegExp(`\\n${ALT_MODUL_NOTU.replace(/[().]/g, '\\$&')}$`));
    assert.equal(ALT_MODUL_NOTU, '(Alt modüller gösterilmedi.)');
    const dfA = await cagir({ komut: 'git diff', klasor: altli });
    assert.deepEqual(oku(dfA.r.icerik).argv, ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all']);
    assert.ok(dfA.r.icerik.trimEnd().endsWith(ALT_MODUL_NOTU));
    // Düzeltme turu 4 (Y-2b): log ve show da --ignore-submodules=all alır; not onlarda da var. rev-parse gibi bastırmayan komutta yok.
    const lgA = await cagir({ komut: 'git log -1', klasor: altli });
    assert.deepEqual(oku(lgA.r.icerik).argv, ['log', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '-1']);
    assert.ok(lgA.r.icerik.trimEnd().endsWith(ALT_MODUL_NOTU), 'log için not var');
    const shA = await cagir({ komut: 'git show HEAD', klasor: altli });
    assert.deepEqual(oku(shA.r.icerik).argv, ['show', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', 'HEAD']);
    assert.ok(shA.r.icerik.trimEnd().endsWith(ALT_MODUL_NOTU), 'show için not var');
    assert.ok(!(await cagir({ komut: 'git rev-parse HEAD', klasor: altli })).r.icerik.includes(ALT_MODUL_NOTU), 'rev-parse için not yok');
    // Y-2b: depo ayarında submodule.* varsa serbest git komutu onay ister (kartta depo uyarısı); reddedilince çalışmaz.
    const altAyarli = depoKur('alt-modul-ayarli', { config: '[submodule "x"]\n\turl = ../x\n' });
    const sa = await cagir({ komut: 'git status', klasor: altAyarli }, { karar: 'reddet' });
    assert.equal(sa.sorular[0]?.aciklama, DEPO_PROGRAM_METNI);
    assert.ok(!sa.r.icerik.includes('SAHTE-GIT'), 'reddedilen komut çalışmadı');
    // Y1 kurcalama: hook klasörüne dosya konursa serbest git komutu çalışmadan önce temizlenir (kart yok, hooksPath yine boş).
    fs.writeFileSync(path.join(hooksPath, 'post-index-change'), 'x');
    const t = await cagir({ komut: 'git status', klasor: depo });
    assert.equal(t.sorular.length, 0, 'temizlenebildi: serbest');
    assert.deepEqual(fs.readdirSync(hooksPath), [], 'klasör temizlendi');
    assert.equal(ayar(oku(t.r.icerik), 'core.hooksPath'), hooksPath);
    // Daraltma: Husky'li depo (.husky klasörü, core.hooksPath=.husky, hook dosyaları) git status'u kartlı yapmaz.
    const husky = depoKur('husky', { config: '[core]\n\trepositoryformatversion = 0\n\thooksPath = .husky\n', hooks: ['pre-commit'] });
    fs.mkdirSync(path.join(husky, '.husky', '_'), { recursive: true });
    fs.writeFileSync(path.join(husky, '.husky', 'pre-commit'), 'npm test\n');
    const h = await cagir({ komut: 'git status', klasor: husky });
    assert.equal(h.sorular.length, 0, 'Husky deposunda git status serbest');
    assert.deepEqual(oku(h.r.icerik).argv, ['status', '--ignore-submodules=all']);
    // Onaylı git komutu (denetleyici kararı, N2 geri alındı): kullanıcının yazdığı gibi, normal git davranışıyla çalışır — yeniden yazılmaz, GIT_CONFIG_*
    // ve GIT_OPTIONAL_LOCKS girdisi yok (Husky/pre-commit hook'ları atlanmaz); yalnız genel çocuk ortam süzgecinden geçer. Serbest komutta girdiler var (yukarıda).
    const o = await cagir({ komut: 'git commit -m deneme', klasor: depo });
    assert.equal(o.sorular.length, 1, 'onaylı komut');
    const og = oku(o.r.icerik);
    assert.deepEqual(og.argv, ['commit', '-m', 'deneme'], 'yeniden yazılmadı');
    assert.deepEqual(og.konfig, [], 'onaylı git komutunda GIT_CONFIG_* yok');
    assert.equal(og.kilit, undefined, 'onaylı git komutunda GIT_OPTIONAL_LOCKS yok');
    assert.ok(g.konfig.length > 0 && ayar(g, 'core.hooksPath'), 'serbest komutta GIT_CONFIG_* var');
    // Düzeltme turu 4 (Y-1): sarmalayıcılı biçim onay ister (biçim kartı); onaylanınca yazıldığı gibi çalışır — yeniden yazılmaz, sertleştirilmiş ortam yok.
    const w = await cagir({ komut: 'cmd /c git status', klasor: depo });
    assert.equal(w.sorular.length, 1);
    assert.equal(w.sorular[0].aciklama, BICIM_METNI);
    const wg = oku(w.r.icerik);
    assert.deepEqual(wg.argv, ['status'], 'yazıldığı gibi');
    assert.deepEqual(wg.konfig, []);
    assert.equal(wg.kilit, undefined);
  } finally { process.env.PATH = eskiPath; gitSurumunuAyarla(undefined); }
});

test('kablolama: main.ts aracı kaydeder; dongu.ts grupEtkin(\'komut\') Developer kapısına bağlı, araç süresi ve durdurma sinyali komuta göre; satır tablosunda var', async () => {
  const kaynak = (...p: string[]) => fs.readFileSync(path.resolve(import.meta.dirname, '..', ...p), 'utf8');
  const main = kaynak('src', 'main', 'main.ts');
  assert.match(main, /import \{ komutAraciniKaydet \} from '\.\/ajan\/araclar\/komut\.js';/);
  assert.match(main, /komutAraciniKaydet\(\);/);
  const d = kaynak('src', 'main', 'ajan', 'dongu.ts');
  assert.match(d, /if \(grup === 'komut'\) return komutAraciAcik\(\{ mod: a\.mod, gizliMod: a\.yerel\.gizliMod === true \}\);/);
  assert.match(d, /arac\.grup === 'komut' \? KOMUT_ARAC_SURESI_MS/);
  assert.match(d, /arac\.grup === 'komut' \? AbortSignal\.any\(\[b\.sinyal, onayIptal\.signal\]\)/);
  const { aracSatiri, aracSatiriAdlari } = await import('../src/shared/arac-satiri.ts');
  assert.ok(aracSatiriAdlari.includes('komut_calistir'));
  assert.equal(aracSatiri('komut_calistir', { komut: 'git status' }, { durum: 'tamam' }, 'gelistirici').metin, 'Komut çalıştırıldı · “git status”');
  assert.equal(aracSatiri('komut_calistir', { komut: 'rm x' }, { durum: 'reddedildi' }, 'gelistirici').metin, 'Komut çalıştırılmadı · “rm x” · Onay verilmedi');
});
