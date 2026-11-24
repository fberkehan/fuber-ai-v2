import { describe, expect, it } from 'vitest';
import { parseToolbarUrl } from './toolbar';
import { addressBlock, cleanUserAgent, dangerousDownload, downloadFileName, resolveAddress, resolvedAllowed, shortAddress } from './urls';

describe('adres kuralları', () => {
  it('adres çözme: tam adres, şemasız alan adı, arama; web dışı şema reddedilir (v1 adresCoz)', () => {
    expect(resolveAddress('https://ornek.com/a?b=1')).toBe('https://ornek.com/a?b=1');
    expect(resolveAddress('ornek.com.tr/giris')).toBe('https://ornek.com.tr/giris');
    expect(resolveAddress('example.com')).toBe('https://example.com/');
    expect(resolveAddress('e-devlet giriş')).toMatch(/^https:\/\/duckduckgo\.com\/\?q=e-devlet%20giri%C5%9F$/);
    expect(resolveAddress('gmail')).toMatch(/duckduckgo/);
    expect(resolveAddress('3.14')).toMatch(/duckduckgo/);
    expect(resolveAddress('')).toBeNull();
    for (const raw of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'chrome://settings', 'fuber://x']) expect(resolveAddress(raw), raw).toBeNull();
  });

  it('yalnız http(s); iç ağ, bu bilgisayar, yerel adlar ve kimlik bilgili adres kapalı', () => {
    const main = { mainFrame: true };
    expect(addressBlock('https://www.turkiye.gov.tr/', main)).toBeNull();
    expect(addressBlock('https://ornek.com:8443/x', main)).toBeNull();
    expect(addressBlock('http://203.0.113.5/', main)).toBe('private'); // belgeleme bloğu
    for (const raw of ['http://127.0.0.1:47820/v1/policy', 'http://localhost:3000/', 'http://192.168.1.1/', 'http://10.0.0.8/', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://yazici/', 'http://nas.local/']) {
      expect(addressBlock(raw, main), raw).not.toBeNull();
    }
    expect(addressBlock('file:///C:/Users/', main)).toBe('scheme');
    expect(addressBlock('chrome://gpu', main)).toBe('scheme');
    expect(addressBlock('devtools://devtools/', main)).toBe('scheme');
    expect(addressBlock('https://kullanici:parola@ornek.com/', main)).toBe('credentials');
    expect(addressBlock('data:text/html,x', main)).toBe('scheme');
    expect(addressBlock('data:image/png;base64,AA', { mainFrame: false })).toBeNull();
    expect(addressBlock('about:blank', main)).toBeNull();
    expect(addressBlock('wss://ornek.com/soket', { mainFrame: false })).toBeNull();
    expect(addressBlock('ws://127.0.0.1:9000/', { mainFrame: false })).not.toBeNull();
  });

  it('sınama izni yalnız verilen adres:port\'u açar', () => {
    const rules = { allow: ['127.0.0.1:5123'] };
    expect(addressBlock('http://127.0.0.1:5123/giris', { mainFrame: true, rules })).toBeNull();
    expect(addressBlock('http://127.0.0.1:5124/', { mainFrame: true, rules })).not.toBeNull();
    expect(addressBlock('http://127.0.0.1/', { mainFrame: true, rules })).not.toBeNull();
  });

  it('ad çözümlemesi: adreslerden biri bile iç ağdaysa kapalı (DNS ile iç ağa yönlendirme)', () => {
    expect(resolvedAllowed(['93.184.216.34'])).toBe(true);
    expect(resolvedAllowed(['93.184.216.34', '127.0.0.1'])).toBe(false);
    expect(resolvedAllowed(['::ffff:192.168.0.1'])).toBe(false);
    expect(resolvedAllowed([])).toBe(false);
  });

  it('indirme: çalıştırılabilir uzantılar hiçbir koşulda; güvenli dosya adı (v1 indirmeDosyaAdi)', () => {
    for (const name of ['kur.exe', 'a.MSI', 'betik.ps1', 'x.js', 'k.lnk', 'paket.msix', 'disk.iso', 'makro.docm', 'yardim.chm', 'kur.exe. ', 'a.appinstaller']) expect(dangerousDownload(name), name).toBe(true);
    for (const name of ['beyanname.pdf', 'tablo.xlsx', 'rapor.docx', 'resim.png', 'arsiv.zip', 'README']) expect(dangerousDownload(name), name).toBe(false);
    const taken = new Set(['fatura.pdf']);
    expect(downloadFileName('fatura.pdf', 'https://a.test/x', (n) => taken.has(n))).toBe('fatura (2).pdf');
    expect(downloadFileName('..\\..\\Windows\\evil.pdf', 'https://a.test/x', () => false)).toBe('evil.pdf');
    expect(downloadFileName('', 'https://a.test/belgeler/beyan%20name.pdf', () => false)).toBe('beyan name.pdf');
    expect(downloadFileName('CON', 'https://a.test/', () => false)).toBe('_CON');
    expect(downloadFileName('a<b>:c?.pdf', 'https://a.test/', () => false)).toBe('a_b__c_.pdf');
  });

  it('kullanıcı aracından Electron ve uygulama adı çıkar; kısa adres sorgu dizgesini göstermez', () => {
    expect(cleanUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) fuber-ai-2/2.0.0 Chrome/140.0.0.0 Electron/45.2.3 Safari/537.36')).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    );
    expect(shortAddress('https://banka.test/hesap/transfer?token=GIZLI#x')).toBe('banka.test/hesap/transfer');
    expect(shortAddress('javascript:1')).toBe('');
  });
});

describe('araç çubuğu', () => {
  it('jbctl: adresleri eyleme çevrilir; tanınmayan reddedilir', () => {
    expect(parseToolbarUrl('jbctl:back')).toEqual({ kind: 'back' });
    expect(parseToolbarUrl('jbctl:stop')).toEqual({ kind: 'stop' });
    expect(parseToolbarUrl('jbctl:go?u=' + encodeURIComponent('ornek.com/a b'))).toEqual({ kind: 'go', input: 'ornek.com/a b' });
    expect(parseToolbarUrl('jbctl:tab?no=3')).toEqual({ kind: 'tab', no: 3 });
    expect(parseToolbarUrl('jbctl:close_tab?no=2')).toEqual({ kind: 'close_tab', no: 2 });
    expect(parseToolbarUrl('jbctl:tab?no=-1')).toBeNull();
    expect(parseToolbarUrl('jbctl:go?u=')).toBeNull();
    expect(parseToolbarUrl('jbctl:rm-rf')).toBeNull();
    expect(parseToolbarUrl('https://jbctl/stop')).toBeNull();
  });
});
