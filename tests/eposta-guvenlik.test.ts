// C1 kardeşi (son inceleme, düzeltme turu 2): telefondan PAROLASIZ `eposta:kaydet` kayıtlı hesabın parolasıyla telefonun seçtiği sunucuya
// bağlanıyordu (inceleyicinin sahte IMAP sunucusu parolayı TLS'siz AUTHENTICATE PLAIN'de düz metin aldı) ve saldırganın sunucusu
// kaydediliyordu. Artık: (1) telefon yalnız taze parolayla kaydeder (köprü reddeder); (2) HİÇBİR yolda kayıtlı parola kaydedildiği
// bağlantıdan (sunucu, port, kullanıcı, güvenli) başkasına gitmez: hesapDene bağlanmaz, hesapKaydet ve genel ayar kaydı parolayı siler.
// Gerçek köprü yolu (main/kopru.ts uzakCagir) ve masaüstünün aynı işleyicisi; sahte IMAP sunucusu yalnız 127.0.0.1'de. Ağ yok.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';

const PAROLA = 'GIZLI-PAROLA-123', YEREL_PAROLA = 'YEREL-PAROLA-9';
const CRLF = '\r\n';
const yakalanan: string[] = [];
let baglanti = 0;
// Sahte IMAP: her komuta OK der, AUTHENTICATE PLAIN'in base64 yükünü kaydeder (inceleyicinin yoklamasıyla aynı).
const sahte = net.createServer((s) => {
  baglanti++;
  s.write(`* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] hazir${CRLF}`);
  let tampon = '';
  let bekleyen: string | null = null;
  s.on('data', (d) => {
    tampon += d.toString();
    let i;
    while ((i = tampon.indexOf(CRLF)) >= 0) {
      const satir = tampon.slice(0, i); tampon = tampon.slice(i + 2);
      yakalanan.push(satir);
      const etiket = satir.split(' ')[0];
      if (bekleyen) { s.write(`${bekleyen} OK giris${CRLF}`); bekleyen = null; continue; }
      if (/AUTHENTICATE PLAIN$/i.test(satir)) { bekleyen = etiket; s.write(`+ ${CRLF}`); continue; }
      if (/CAPABILITY/i.test(satir)) s.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN${CRLF}${etiket} OK${CRLF}`);
      else if (/LOGOUT/i.test(satir)) { s.write(`* BYE${CRLF}${etiket} OK${CRLF}`); s.end(); }
      else s.write(`${etiket} OK tamam${CRLF}`);
    }
  });
  s.on('error', () => undefined);
});
await new Promise<void>((c) => sahte.listen(0, '127.0.0.1', c));
const port = (sahte.address() as net.AddressInfo).port;
after(() => sahte.close());

const e1 = { id: 'e1', ad: 'İş', adres: 'deniz@ornek.com', imapSunucu: 'imap.ornek.com', imapPort: 993, smtpSunucu: 'smtp.ornek.com', smtpPort: 465, kullanici: 'deniz@ornek.com', guvenli: true };
const e2 = { id: 'e2', ad: 'Yerel', adres: 'yerel@ornek.com', imapSunucu: '127.0.0.1', imapPort: port, smtpSunucu: '127.0.0.1', smtpPort: 1, kullanici: 'yerel@ornek.com', guvenli: true };
const { klasor } = anaSurecSahnesi('eposta-guvenlik', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false, mcp: [], eposta: [e1, e2],
});
(globalThis as Record<string, unknown>).__sifreleme = true;
await ipcKurBos();
const { sirYaz, sirOku, ayarlar } = await import('../src/main/ayarlar.ts');
const { hesapKaydet } = await import('../src/main/entegrasyon/eposta.ts');
sirYaz('eposta:e1', PAROLA);
sirYaz('eposta:e2', YEREL_PAROLA);
// Masaüstü arayüzünün yolu: ipcMain işleyicisi (ilk bağımsız değişken olay).
const masaKaydet = (x: unknown) => ipcIsleyicileri().get('eposta:kaydet')!({}, x) as Promise<{ hesap: unknown; sinama: { imap: boolean; smtp: boolean; hata?: string } }>;
const ayarKaydet = (x: unknown) => ipcIsleyicileri().get('ayarlar:kaydet')!({}, x);
const disk = () => JSON.parse(fs.readFileSync(path.join(klasor, 'ayarlar.json'), 'utf8'));
const gordu = (p: string) => yakalanan.some((l) => l.includes(p) || Buffer.from(l.trim(), 'base64').toString('latin1').includes(p));
const saldiri = { ad: 'İş', adres: 'deniz@ornek.com', imapSunucu: '127.0.0.1', imapPort: port, smtpSunucu: '127.0.0.1', smtpPort: 1, kullanici: 'deniz@ornek.com', guvenli: true };

test('masaüstü yolu da: bağlantısı değişen parolasız istek HİÇ bağlanmaz (kayıtlı parola başka sunucuya, TLS\'siz porta gitmez)', async () => {
  const r = await masaKaydet({ ...saldiri, id: 'e1' });
  assert.equal(r.hesap, null);
  assert.match(String(r.sinama.hata), /Parolayı yeniden yaz/);
  const r2 = await masaKaydet(saldiri); // kimlik verilmeden (aynı adres) de aynı hesap sayılır
  assert.equal(r2.hesap, null);
  assert.equal(baglanti, 0, 'sahte sunucuya bağlanıldı');
  assert.equal(gordu(PAROLA), false);
  assert.equal(sirOku('eposta:e1'), PAROLA);
  assert.equal(ayarlar().eposta.find((x) => x.id === 'e1')!.imapSunucu, 'imap.ornek.com');
});

test('aynı bağlantı, parolasız sınama: kayıtlı parola YALNIZ kaydedildiği sunucuya gider (meşru yeniden sınama)', async () => {
  const r = await masaKaydet({ ...e2 });
  assert.equal(r.sinama.imap, true, String(r.sinama.hata));
  assert.equal(gordu(YEREL_PAROLA), true, 'kayıtlı sunucu kendi parolasını almalı');
  assert.equal(gordu(PAROLA), false);
  assert.equal(sirOku('eposta:e2'), YEREL_PAROLA, 'aynı bağlantıda parola kalır');
});

test('hesapKaydet: bağlantı parolasız değişirse kayıtlı parola SİLİNİR (eşitleme/gönderim onu yeni sunucuya götürmez); taze parola yazılır', () => {
  const h = hesapKaydet({ ad: 'Üç', adres: 'uc@ornek.com', imapSunucu: 'imap.uc.com', imapPort: 993, smtpSunucu: 'smtp.uc.com', smtpPort: 465, kullanici: 'uc@ornek.com', guvenli: true, parola: 'UC-PAROLA' });
  assert.equal(sirOku(`eposta:${h.id}`), 'UC-PAROLA');
  hesapKaydet({ id: h.id, ad: 'Üç (yeni ad)', adres: 'uc@ornek.com', imapSunucu: 'IMAP.uc.com ', imapPort: 993, smtpSunucu: 'smtp.uc.com', smtpPort: 465, kullanici: 'uc@ornek.com', guvenli: true });
  assert.equal(sirOku(`eposta:${h.id}`), 'UC-PAROLA', 'yalnız ad değişti (sunucu adı büyük harf/boşluk farkı aynı sayılır): parola kalır');
  hesapKaydet({ id: h.id, ad: 'Üç', adres: 'uc@ornek.com', imapSunucu: 'kotu.example', imapPort: 143, smtpSunucu: 'kotu.example', smtpPort: 25, kullanici: 'uc@ornek.com', guvenli: false });
  assert.equal(sirOku(`eposta:${h.id}`), undefined);
  assert.equal(ayarlar().eposta.find((x) => x.id === h.id)!.parolaVar, false);
});

test('genel ayar kaydı (ayarlar:kaydet) bir hesabın bağlantısını değiştirirse parolası silinir; yalnız ad değişirse kalır', () => {
  const liste = () => ayarlar().eposta.map((x) => ({ ...x }));
  ayarKaydet({ eposta: liste().map((x) => (x.id === 'e2' ? { ...x, ad: 'Yerel (yeni ad)' } : x)) });
  assert.equal(sirOku('eposta:e2'), YEREL_PAROLA);
  ayarKaydet({ eposta: liste().map((x) => (x.id === 'e2' ? { ...x, imapPort: 143 } : x)) });
  assert.equal(sirOku('eposta:e2'), undefined, 'port değişti: parola silinmeli');
  assert.equal(sirOku('eposta:e1'), PAROLA, 'değişmeyen hesabın parolası kalır');
});
