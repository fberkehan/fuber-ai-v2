// ── Kurulu uygulamada ortam kapısı (0.12 H6, Ruling P12): main.ts'in İLK içe aktarımı ───────────────────────────────────────────────────
// Kararın kendisi saf ve birim testli: shared/ortam-kapisi.ts. Burada yalnız uygulanır, kurulu (paketli) uygulamada:
//   · izin verilmeyen sunucu/yerel adres değişkenleri, RunAsNode isteyen test kancaları, güvenlik geçersiz kılmaları (NODE_TLS_REJECT_UNAUTHORIZED,
//     SSLKEYLOGFILE) ve — profil yalıtılmış değilse — sahte komut/sır/klasör kancaları ile arka plan test kipi process.env'den SİLİNİR (kod
//     varsayılana döner; çocuk süreçler de görmez); günlüğe sakin bir uyarı düşer (değer yazılmaz); uyarılar Ayarlar → Genel → Hakkında'da da görünür;
//   · FUBER_VERI verilmiş ama yalıtılmış değilse ya da komut satırında yasak bir bayrak varsa uygulama hiçbir pencere açmadan çıkar; kullanıcıya
//     kısa, sakin bir kutu gösterilir (arka plan test kipinde ve yalıtılmış profilde kutu yok — yalnız günlük).
// Varsayılan veri klasörü = appData + ürün adı: --user-data-dir'den bağımsız ve OLUŞTURULMAZ (Electron'un userData yolu ilk soruluşta klasörü
// yaratır; burada hiç sorulmaz). Yalnız kurulu uygulamada hesaplanır; paketsizde (önizleme/test) hiçbir yol okunmaz.
// Bazı modüller değişkeni YÜKLENİRKEN okur (gunkaydi/whisper.ts), bu yüzden bu modül main.ts'te öteki bütün yerel modüllerden ÖNCE içe aktarılır
// (esbuild ESM paketi modülleri içe aktarma sırasıyla çalıştırır; tests/ortam-kapisi.test.ts denetler).
import { app, dialog } from 'electron';
import fs from 'node:fs';
import { ACILMADI_KUTUSU, MASAUSTU_EK_YASAK, kuruluOrtamiKaydet, paketliOrtamKarari, yasakliBayraklar, type GercekYol } from '../shared/ortam-kapisi.js';

/** Var olan yolun gerçek yolu (8.3 kısa ad, junction, harf çözülür); yoksa/okunamazsa null. */
const gercekYol: GercekYol = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };

/** Varsayılan veri klasörü (oluşturmadan). app.getPath ÇÖKERTMEMELİ: ev klasörü AppData'sı olmayan bir yere çevrilmişse bilinen klasör çözülemez
 *  ve getPath fırlatır — o zaman '' (karar KAPALI kalır: FUBER_VERI yalıtılmış sayılmaz). */
function varsayilanVeri(): string {
  try { return `${app.getPath('appData')}\\${app.getName()}`; } catch { return ''; }
}

// Boşluklu FUBER_VERI: uygulama ham değeri kullanır (main.ts setPath, yollar.ts) — kararla aynı değeri görsünler diye burada kırpılır; boşsa silinir.
if (process.env.FUBER_VERI !== undefined) { const v = process.env.FUBER_VERI.trim(); if (v) process.env.FUBER_VERI = v; else delete process.env.FUBER_VERI; }

const paketli = app.isPackaged;
const karar = paketliOrtamKarari(process.env, paketli, paketli ? { varsayilanVeri: varsayilanVeri(), gercekYol } : {});
for (const ad of karar.sil) delete process.env[ad];
for (const u of karar.uyarilar) console.warn(`[ortam] ${u}`);
kuruluOrtamiKaydet(paketli, karar.uyarilar);

const yasak = yasakliBayraklar((b) => app.commandLine.hasSwitch(b), { paketli, yalitilmis: karar.yalitilmis, ek: MASAUSTU_EK_YASAK });
if (karar.veriGecersiz || yasak.length) {
  if (yasak.length) console.error(`[ortam] Fuber AI açılmadı: kurulu uygulama şu komut satırı bayraklarıyla çalışmaz: ${yasak.map((b) => `--${b}`).join(', ')}.`);
  if (karar.veriGecersiz) console.error('[ortam] Fuber AI açılmadı: FUBER_VERI yalıtılmış bir test klasörü değil.');
  if (karar.kutu) { try { dialog.showErrorBox(ACILMADI_KUTUSU.masaustuBaslik, karar.veriGecersiz ? ACILMADI_KUTUSU.veri : ACILMADI_KUTUSU.bayrak); } catch { /* kutu gösterilemedi */ } }
  process.exit(1);
}
