// ── Kişiliğin "Kod işleri" bölümü (saf; Electron'a bağlı değil — birim testli: tests/kod-isleri.test.ts) ─────────────────────────────
// Görev 26 (K17/K18: Claude Code yalnız Geliştirici, İş modunda hiçbiri görünmez): bölüm yalnız Geliştirici modunda kişiliğe girer; İş
// modunda Claude Code adı modele hiç verilmez (sohbet araçları da kapalı: shared/cc-ayar.ts ccSohbetteAcik). Eskiden İş modunda Fuber
// kendini "Claude Code oturumlarını bulur, işi oraya devrederim" diye tanıtıyordu.
// Son inceleme (G26 küçüğü): bölüm araçlarla AYNI kapıdan girer — mod + yönetici açık + claude.exe kurulu (ccSohbetteAcik). Eskiden
// yalnız moda bakıyordu: yönetici kapalıyken ya da claude.exe yokken araçlar yoktu ama bölüm "devret" diyordu. Metin uygulama içi
// oturumu anlatır (Görev 27: terminal değil).
// 0.14 T13 (model yalnız sohbet ediyor, Claude Code gibi her yere bağlanıp iş yapamıyordu): bölüm artık "devret" demez. Küçük kod ve dosya işini Fuber
// kendi araçlarıyla (dosya, belge, Developer'da komut) KENDİSİ yapar; yalnız büyük kod işi (çok dosyalı değişiklik, proje çapında iş, uzun derleme/test
// döngüsü) kullanıcının Claude Code oturumuna verilir.
import { ccSohbetteAcik } from '../../shared/cc-ayar.ts';
import type { KipKimligi } from '../../shared/karakterler.ts';

export function kodIsleriBolumu(k: { mod: string; etkin: boolean; kurulu: boolean }, kullanici: string): string {
  if (!ccSohbetteAcik(k.mod, k.etkin, k.kurulu)) return '';
  return `
# KOD İŞLERİ (kendin yap, büyük kod işini Claude Code'a ver)
- Küçük kod ve dosya işini KENDİN yap: dosyayı oku (\`dosya_oku\`), düzelt (\`dosya_duzenle\`, \`dosya_yaz\`), gerekirse komutu çalıştır (\`komut_calistir\`) ve sonucu doğrula. Tek dosyalık düzeltme, küçük betik, bir yapılandırma satırı ya da bir komutun çıktısı için Claude Code oturumu açma.
- Büyük kod işini (çok dosyalı değişiklik, proje çapında yeniden yazım, uzun derleme ve test döngüsü) ${kullanici}'nın bilgisayarındaki Claude Code'a (kendi aboneliği) ver: önce \`claude_code_oturumlari\` ile doğru oturumu bul (proje adı, konu, tarih). Tek ve net eşleşme varsa \`claude_code_gorev\` ile o oturumu sürdürerek isteği OLDUĞU GİBİ ilet; birden çok aday varsa 2-3 adayı kısaca sun ve hangisi olduğunu sor; uygun oturum yoksa proje klasöründe yeni oturum aç. İsteğe kendi fikrini ya da ek iş EKLEME.
- "O sohbette nerede kalmıştık?" için \`claude_code_oturum\` ile son hâline bak. Oturumu başlattıktan sonra işin Fuber'in Claude Code sayfasında sürdüğünü söyle (izin isteklerini orada o yanıtlar); bitmiş gibi anlatma.
`;
}

/** 0.14 T13 düzeltme turu 1: ARAÇ NOTLARI'nın komut satırı yalnız Developer mode'da modele gider (komut çalıştırma yalnız Developer: R8; Business
 *  mode'da PowerShell yeteneği hiç anlatılmaz — `kodIsleriBolumu` ile aynı desen). Düzeltme turu 2: girdi turun KİLİTLİ kipi (`karakter.kip`; tur
 *  sürerken ayar değişse de satır karakterle tutarlı kalır). */
export function komutNotu(kip: KipKimligi): string {
  if (kip !== 'developer') return '';
  return '- Komut: komut_calistir ile PowerShell komutu çalıştır (klasör verilmezse Belgeler); yıkıcı, ağa çıkan ya da bileşik komut onay ister. Sunucu ya da izleyici (npm run dev, --watch) için arka_plan: true: süre sınırı olmadan arka planda çalışır; çıktısını surec_cikti ile oku, surec_durdur ile durdur.';
}
