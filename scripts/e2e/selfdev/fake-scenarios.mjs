// Çekirdek geliştirme (Katman 2) için sahte Claude Code senaryoları. `workshop/fake-claude.mjs` yalnız şu tek satırla
// buraya yönlendirir: `[[sahte:cekirdek|<mod>]]` yönergesi. Aşama istemdeki "AŞAMA: PLAN|UYGULAMA|DÜZELTME" satırından anlaşılır
// (modules/selfdev/prompts.ts). Dosyayı çalışma klasörüne (worktree) YALNIZ `Write` aracıyla yazar (fikstür yalnız onu yürütür).
//
//   temiz           plan çekirdek · uygulama sınamadan geçen bir dosya yazar
//   bozuk-duzelt    uygulama "BOZUK" içerikli dosya yazar (sahte depodaki typecheck kalır) · düzeltme turu düzgün yazar
//   hep-bozuk       uygulama da her düzeltme turu da BOZUK yazar (dürüst başarısızlık)
//   eklenti         plan "EKLENTİ" der (çekirdek gerekmez)
//   yavas           uygulama aşaması 20 sn bekler (aşama çizgisi ve iptal sınaması), sonra temiz
const PLAN = (kind) => `## UYGUNLUK
${kind === 'eklenti' ? 'EKLENTİ — bu basit bir kart, eklentiyle yapılabilir.' : 'ÇEKİRDEK'}

## ÖZET
${kind === 'eklenti' ? 'Bir kart eklentisi yeterli olur.' : 'Ana pencereye yeni bir bölüm eklenecek; siz yeni bir sayfa göreceksiniz.'}

## DOSYALAR
- src/ozellik.txt — yeni özellik dosyası

## RİSK
- Düşük: yalnız yeni bir dosya ekleniyor.

## SINAMA
- typecheck ve test koşar.`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function run({ params, prompt, say, result, callTool }) {
  const mode = params[0] ?? 'temiz';
  const phase = /AŞAMA: (PLAN|UYGULAMA|DÜZELTME)/.exec(prompt)?.[1] ?? 'PLAN';
  if (phase === 'PLAN') {
    say('Depoyu okuyorum.');
    callTool('Read', { file_path: 'package.json' });
    const plan = PLAN(mode);
    say(plan);
    result(plan);
    return;
  }
  if (phase === 'UYGULAMA') {
    if (mode === 'yavas') await sleep(20000);
    callTool('Write', { file_path: 'src/ozellik.txt', content: mode === 'bozuk-duzelt' || mode === 'hep-bozuk' ? 'BOZUK özellik' : 'yeni özellik: temiz' });
    const text = '## DEĞİŞİKLİK ÖZETİ\n- src/ozellik.txt yazıldı';
    say(text);
    result(text);
    return;
  }
  // DÜZELTME
  callTool('Write', { file_path: 'src/ozellik.txt', content: mode === 'hep-bozuk' ? 'BOZUK özellik (yine)' : 'yeni özellik: düzeltildi' });
  const text = '## DEĞİŞİKLİK ÖZETİ\n- hata düzeltildi';
  say(text);
  result(text);
}
