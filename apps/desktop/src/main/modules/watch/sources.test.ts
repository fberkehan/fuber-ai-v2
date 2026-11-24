// v1 `tests/isler-gozcu.test.ts`ten taşındı ve v2 kaynaklarına uyarlandı. v1'de gözcüler WhatsApp, e-posta, sayfa,
// ekran ve saatti; v2'de saat, sayfa, dosya, pencere/sekme ve Claude Code (WhatsApp yok; e-posta takılı kaynak).
// Ağ ve pencere okuması sahtedir: sınama ağa çıkmaz, geliştiricinin pencerelerine bakmaz.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { t, type ToolRegistry } from '@fuber/shared';
import { testBus } from '../../core/brain/testkit';
import { fakeFetch } from '../web/fake-fetch';
import { checkUrl, createSafeFetch, isPublicAddress } from '../web/net';
import { claudeSource, expandKnownFolder, fileSource, fileTargetCheck, pageSource, pageText, timeSource, windowSource } from './sources';

const signal = new AbortController().signal;
const input = (target: string, previous: string | null = null, since = 0) => ({ target, previous, since, signal });

describe('saat', () => {
  it('vaktinden önce bekler (uyanış anı verir), vakti gelince "şimdi" der; geçmiş an reddedilir', async () => {
    let now = Date.parse('2026-11-16T10:00:00Z');
    const source = timeSource(() => now);
    expect(source.normalize!('2026-11-16T09:00:00Z')).toHaveProperty('error');
    expect(source.normalize!('yarın')).toHaveProperty('error');
    const ok = source.normalize!('2026-11-16T17:00:00+03:00');
    expect(ok).toEqual({ target: '2026-11-16T14:00:00.000Z' });
    const before = await source.check(input('2026-11-16T14:00:00.000Z'));
    expect(before).toMatchObject({ signature: 'wait', wakeAt: Date.parse('2026-11-16T14:00:00Z') });
    now = Date.parse('2026-11-16T14:00:01Z');
    expect(await source.check(input('2026-11-16T14:00:00.000Z', 'wait'))).toMatchObject({ signature: 'due', fire: true });
  });
});

describe('web sayfası', () => {
  it('görünen metin: betik ve stil düşer, kısa satır ("Stokta var") kalır', () => {
    const text = pageText('<html><head><style>.a{}</style><script>var x = "Stokta yok";</script></head><body><nav class="menu">Menü</nav><main><h1>Kulaklık</h1><p>Fiyat: 1.299,90 TL</p><span>Stokta var</span></main></body></html>', 'text/html');
    expect(text).toContain('Fiyat: 1.299,90 TL');
    expect(text).toContain('Stokta var');
    expect(text).not.toContain('Stokta yok');
  });

  it('aynı metin aynı imza; metin değişince imza değişir; Gizli kipte ağa çıkmaz', async () => {
    let body = '<p>Fiyat 1.299 TL</p>';
    let network = true;
    const fetcher = fakeFetch([{ match: 'ornek.com', body: '' }]);
    const dynamic = (async (url: string, options?: object) => ({ ...(await fetcher(url, options)), body: Buffer.from(body) })) as typeof fetcher;
    const source = pageSource({ fetcher: dynamic, networkAllowed: () => network });
    const a = await source.check(input('https://ornek.com/urun'));
    const b = await source.check(input('https://ornek.com/urun', a.signature));
    expect(b.signature).toBe(a.signature);
    body = '<p>Fiyat 1.199 TL</p>';
    const c = await source.check(input('https://ornek.com/urun', b.signature));
    expect(c.signature).not.toBe(b.signature);
    expect(c.text).toContain('1.199');
    network = false;
    expect(source.available!()).toBe(t('watch.source.pagePrivate'));
    await expect(source.check(input('https://ornek.com/urun'))).rejects.toThrow();
    expect(fetcher.calls).toHaveLength(3);
  });

  it('adres kapısı: yalnız herkese açık http(s); yerel ağ, dosya ve betik adresleri reddedilir', () => {
    const source = pageSource({ fetcher: fakeFetch([]), networkAllowed: () => true });
    expect(source.normalize!('ornek.com/fiyat')).toEqual({ target: 'https://ornek.com/fiyat' });
    for (const bad of ['http://127.0.0.1:8080/', 'http://localhost/', 'file:///C:/gizli.txt', 'javascript:alert(1)', 'http://192.168.1.1/', 'http://yazici/']) {
      expect(source.normalize!(bad), bad).toHaveProperty('error');
    }
  });

  it('HTTP hata yanıtı denetim hatasıdır (iş onu "değişmedi" sayar)', async () => {
    const source = pageSource({ fetcher: fakeFetch([{ match: 'ornek.com', status: 503, body: 'bakım' }]), networkAllowed: () => true });
    await expect(source.check(input('https://ornek.com'))).rejects.toThrow(/503/);
  });

  describe('gerçek güvenli ağ kapısıyla (bu bilgisayardaki sahte sunucu)', () => {
    let server: http.Server;
    let base = '';
    beforeAll(async () => {
      server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        // 4 MB gönderir: kapı gövdeyi 1,5 MB'ta keser, sayfa belleğe bütünüyle alınmaz.
        response.end(`<p>Başlık</p>${'<p>dolgu satırı</p>'.repeat(220_000)}`);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it('üretim kapısı geri döngüyü reddeder; sınama istisnasıyla okur ve büyük gövdeyi keser', async () => {
      const production = pageSource({ fetcher: createSafeFetch(), networkAllowed: () => true });
      expect(production.normalize!(base)).toHaveProperty('error');
      const isAllowed = (address: string) => isPublicAddress(address) || address === '127.0.0.1';
      const loopback = pageSource({ fetcher: createSafeFetch({ isAllowed, isPortAllowed: () => true }), networkAllowed: () => true, checkTarget: (url) => checkUrl(url, isAllowed, () => true) });
      expect(loopback.normalize!(base)).toEqual({ target: base });
      const probe = await loopback.check(input(base));
      expect(probe.text.startsWith('Başlık')).toBe(true);
      expect(probe.text.length).toBeLessThan(1_600_000);
    });
  });
});

describe('dosya ve klasör', () => {
  // Geçici klasör deponun `artifacts/` altında: işletim sisteminin geçici klasörü AppData içindedir ve izlenmez.
  const root = path.join(process.cwd(), 'artifacts', `watch-sources-${process.pid}`);
  beforeAll(() => fs.mkdirSync(root, { recursive: true }));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('belge kapısıyla aynı yasaklar: AppData, sistem klasörü, uygulamanın veri klasörü, anahtar dosyası', () => {
    const deps = { dataDir: path.join(root, 'veri') };
    expect(fileTargetCheck('C:\\Users\\x\\AppData\\Roaming\\uygulama\\a.txt', deps)).toHaveProperty('error');
    expect(fileTargetCheck('C:\\Windows\\System32\\drivers\\etc\\hosts', deps)).toHaveProperty('error');
    expect(fileTargetCheck(path.join(root, 'veri', 'fuber.db'), deps)).toHaveProperty('error');
    expect(fileTargetCheck(path.join(root, 'id_rsa'), deps)).toHaveProperty('error');
    expect(fileTargetCheck('\\\\sunucu\\paylasim\\a.txt', deps)).toHaveProperty('error');
    expect(fileTargetCheck(path.join(root, 'rapor.txt'), deps)).toEqual({ target: path.join(root, 'rapor.txt') });
  });

  it('sesle söylenen bilinen klasör kullanıcı profilindeki yerine çevrilir', () => {
    expect(expandKnownFolder('İndirilenler', 'C:\\Users\\k')).toBe(path.join('C:\\Users\\k', 'Downloads'));
    expect(expandKnownFolder('Masaüstü\\Faturalar', 'C:\\Users\\k')).toBe(path.join('C:\\Users\\k', 'Desktop', 'Faturalar'));
    expect(expandKnownFolder('D:\\Arşiv', 'C:\\Users\\k')).toBe('D:\\Arşiv');
  });

  it('dosya: yokken "missing"; oluşunca kaynak "oluştu" der; içerik değişince imza değişir', async () => {
    const source = fileSource({ dataDir: path.join(root, 'veri') });
    const file = path.join(root, 'rapor.txt');
    const missing = await source.check(input(file));
    expect(missing.signature).toBe('missing');
    fs.writeFileSync(file, 'ilk sürüm');
    const created = await source.check(input(file, 'missing'));
    expect(created.finding).toBe(t('watch.finding.fileCreated', { name: 'rapor.txt' }));
    expect(created.text).toContain('ilk sürüm');
    fs.writeFileSync(file, 'ikinci sürüm, daha uzun');
    const changed = await source.check(input(file, created.signature));
    expect(changed.signature).not.toBe(created.signature);
  });

  it('klasör: dosya adları metne girer; yeni dosya imzayı değiştirir', async () => {
    const source = fileSource({ dataDir: path.join(root, 'veri') });
    const folder = path.join(root, 'gelen');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'a.pdf'), 'x');
    const first = await source.check(input(folder));
    expect(first.text).toBe('a.pdf');
    fs.writeFileSync(path.join(folder, 'fatura-kasim.pdf'), 'y');
    const second = await source.check(input(folder, first.signature));
    expect(second.signature).not.toBe(first.signature);
    expect(second.text.split('\n')).toEqual(['a.pdf', 'fatura-kasim.pdf']);
  });
});

describe('pencere ve sekme', () => {
  it('okuma izni kapalıysa (araç kayıtlı değil) kaynak sunulmaz; açıksa pc_read_window ile okur, çerçeve satırları imzaya girmez', async () => {
    const calls: unknown[] = [];
    let registered = false;
    let body = 'Gelen kutusu (3)';
    const tools = {
      has: (name: string) => registered && name === 'pc_read_window',
      run: async (name: string, value: unknown) => {
        calls.push({ name, value });
        return { ok: true, text: `${t('pc.untrusted.begin')}\n${body}\n${t('pc.untrusted.end')}` };
      },
    } as unknown as Pick<ToolRegistry, 'has' | 'run'>;
    const source = windowSource({ tools, origin: () => ({ channel: 'job', speakerVerified: null }) });
    expect(source.available!()).toBe(t('watch.source.windowOff'));
    registered = true;
    expect(source.available!()).toBeNull();
    const a = await source.check(input('Outlook'));
    expect(a.text).toBe('Gelen kutusu (3)');
    body = 'Gelen kutusu (4)';
    const b = await source.check(input('Outlook', a.signature));
    expect(b.signature).not.toBe(a.signature);
    expect(calls[0]).toEqual({ name: 'pc_read_window', value: { window: 'Outlook', max_chars: 6000 } });
  });
});

describe('Claude Code', () => {
  const status = (id: string, value: string, projectName = 'atlas') => ({ session: id, seq: 1, at: 0, event: { type: 'status', summary: { id, status: value, projectName, title: 'testleri düzelt' } } });

  it('yalnız ÇALIŞIRKEN görülen oturumun bitişi sayılır; proje adı süzer; yeni bitiş "dürt"er', async () => {
    const bus = testBus();
    let now = 1_000;
    const source = claudeSource(bus, () => now);
    const pokes: string[] = [];
    const off = source.subscribe!('atlas', () => pokes.push('atlas'));
    const emit = (payload: unknown) => (bus.emit as unknown as (type: string, value: unknown) => void)('projects.claudeEvent', payload);
    // Açılışta gelen anlık "done" (önceki durumu bilinmiyor) sayılmaz.
    emit(status('s0', 'done'));
    expect((await source.check(input('atlas', null, 0))).text).toBe('');
    emit(status('s1', 'running'));
    now = 2_000;
    emit(status('s1', 'done'));
    emit(status('s2', 'running', 'fuber'));
    emit(status('s2', 'error', 'fuber'));
    const atlas = await source.check(input('atlas', null, 0));
    expect(atlas.text).toBe(`atlas: ${t('watch.claude.done')}`);
    expect(atlas.signature).toBe('2000');
    expect(pokes).toEqual(['atlas']);
    // İmzadan sonrası yok: değişmedi.
    expect((await source.check(input('atlas', atlas.signature, 0))).text).toBe('');
    // İş başlamadan önceki bitiş sayılmaz.
    expect((await source.check(input('atlas', null, 5_000))).text).toBe('');
    // Boş hedef: hangisi olursa.
    expect((await source.check(input('', null, 0))).text.split('\n')).toHaveLength(2);
    off();
    source.dispose();
  });

  it('bitişi projeler modülü duyurduysa (`projects.claudeAnnounced`) iş ikinci bildirimi göndermez; duyurmadıysa gönderir', async () => {
    const bus = testBus();
    let now = 1_000;
    const source = claudeSource(bus, () => now, { announceWaitMs: 60 });
    const emit = (type: string, payload: unknown) => (bus.emit as unknown as (type: string, value: unknown) => void)(type, payload);
    emit('projects.claudeEvent', status('s1', 'running'));
    now = 2_000;
    emit('projects.claudeEvent', status('s1', 'done'));
    // Duyuru denetimden SONRA gelir (projeler modülü bitişi ~1,2 sn bekleyip bildirir): bekleme onu yakalar.
    const probe = await source.check(input('atlas', null, 0));
    setTimeout(() => emit('projects.claudeAnnounced', { liveId: 's1', project: 'atlas', status: 'done' }), 10);
    expect(await probe.announcedElsewhere).toBe(true);
    // Duyuru hiç gelmedi (kullanıcı oturumu sayfada izliyor): süre dolunca iş kendi haberini verir.
    emit('projects.claudeEvent', status('s2', 'running'));
    now = 3_000;
    emit('projects.claudeEvent', status('s2', 'error'));
    expect(await (await source.check(input('atlas', '2000', 0))).announcedElsewhere).toBe(false);
    // Eski bir turun duyurusu yeni bitişi "duyuruldu" yapmaz.
    emit('projects.claudeEvent', status('s1', 'running'));
    now = 4_000;
    emit('projects.claudeEvent', status('s1', 'done'));
    expect(await (await source.check(input('atlas', '3000', 0))).announcedElsewhere).toBe(false);
    // Duyuru denetimden ÖNCE geldiyse beklenmez.
    now = 4_500;
    emit('projects.claudeAnnounced', { liveId: 's1', project: 'atlas', status: 'done' });
    const started = Date.now();
    expect(await (await source.check(input('atlas', '3000', 0))).announcedElsewhere).toBe(true);
    expect(Date.now() - started).toBeLessThan(50);
    source.dispose();
  });
});
