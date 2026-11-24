// Bu cihazda çalışan yapay zekâ: kurulumun TEK önerisi (0.10 E4, K5). Kullanıcıya model listesi gösterilmez; donanımdan (sistem:kontrol)
// tek öneri: ekran kartı belleği ≥ 16 GB → en büyük, ≥ 8 GB → orta, yoksa en hafif (işlemcide). Disk yetmezse bir küçüğüne iner; hiçbiri
// sığmıyorsa ya da bellek en hafife bile yetmiyorsa "uygun değil" (nedeniyle). Boyut tek sayı: "~1,9 GB iner" (model + ilk kurulumun payı).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ILK_KURULUM_PAYI, yerelIndirmeBoyutu, yerelOnerisi, type YerelModelOzeti } from '../src/shared/yerel-boyut.ts';
import { YEREL_MODELLER } from '../src/main/yerel/paketler.ts';

const MODELLER: YerelModelOzeti[] = (Object.entries(YEREL_MODELLER) as [keyof typeof YEREL_MODELLER, (typeof YEREL_MODELLER)[keyof typeof YEREL_MODELLER]][])
  .map(([ad, m]) => ({ ad, boyut: m.boyut, ramGB: m.ramGB, ...(m.vramGB !== undefined ? { vramGB: m.vramGB } : {}), kurulu: false }));
const oner = (m: Parameters<typeof yerelOnerisi>[0], l = MODELLER) => yerelOnerisi(m, l);
const model = (r: ReturnType<typeof yerelOnerisi>) => (r.uygun ? r.model : null);

test('K5 eşikleri: ekran kartı ≥ 16 GB → en büyük (27B), ≥ 8 GB → orta (9B), yoksa en hafif (4B, işlemcide)', () => {
  assert.equal(model(oner({ nvidia: true, vramGB: 16, ramGB: 32, bosDiskGB: 400 })), 'bonsai2-27b');
  assert.equal(model(oner({ nvidia: true, vramGB: 24, ramGB: 16, bosDiskGB: 400 })), 'bonsai2-27b');
  assert.equal(model(oner({ nvidia: true, vramGB: 15.9, ramGB: 32, bosDiskGB: 400 })), 'bonsai2-9b');
  assert.equal(model(oner({ nvidia: true, vramGB: 8, ramGB: 8, bosDiskGB: 400 })), 'bonsai2-9b');
  assert.equal(model(oner({ nvidia: true, vramGB: 6, ramGB: 32, bosDiskGB: 400 })), 'bonsai2-4b');
  assert.equal(model(oner({ nvidia: false, ramGB: 64, bosDiskGB: 400 })), 'bonsai2-4b', 'NVIDIA yok: bellek ne olursa olsun en hafif');
  assert.equal(model(oner({ nvidia: true, ramGB: 32, bosDiskGB: 400 })), 'bonsai2-4b', 'kart belleği okunamadı');
  assert.equal(model(oner({ nvidia: true, vramGB: 24, ramGB: 32, bosDiskGB: 400, islemciZorla: true })), 'bonsai2-4b', '"Yalnız işlemci" seçili');
  // Listenin sırası önemli değil (boyuta göre sıralanır).
  assert.equal(model(oner({ nvidia: true, vramGB: 16, ramGB: 32, bosDiskGB: 400 }, [...MODELLER].reverse())), 'bonsai2-27b');
});

test('etiket kısa ve sade (model adı yok), ekran kartı mı işlemci mi; tek sayı "~N GB iner" (ilk kurulumda çalıştırıcı payıyla)', () => {
  const b = oner({ nvidia: true, vramGB: 16, ramGB: 32, bosDiskGB: 400 });
  assert.ok(b.uygun);
  assert.equal(b.etiket, 'Büyük sürüm');
  assert.equal(b.ekranKarti, true);
  assert.equal(b.metin, '~8,5 GB iner');
  assert.equal(b.bayt, YEREL_MODELLER['bonsai2-27b'].boyut + ILK_KURULUM_PAYI);
  const o = oner({ nvidia: true, vramGB: 8, ramGB: 16, bosDiskGB: 400 });
  assert.ok(o.uygun && o.etiket === 'Orta sürüm' && o.metin === '~3,8 GB iner');
  const h = oner({ nvidia: false, ramGB: 8, bosDiskGB: 400 });
  assert.ok(h.uygun && h.etiket === 'Hafif sürüm' && h.ekranKarti === false && h.metin === '~2,5 GB iner');
  // Çalıştırıcı zaten kuruluysa yalnız model iner.
  const k = oner({ nvidia: false, ramGB: 8, bosDiskGB: 400, calistiriciKurulu: true });
  assert.ok(k.uygun && k.metin === '~1,2 GB iner');
  for (const r of [b, o, h]) assert.ok(r.uygun && !/bonsai|\d+B\b|model/i.test(`${r.etiket} ${r.metin}`), JSON.stringify(r));
});

test('kurulu öneri: "kurulu" (bir şey inmez)', () => {
  const l = MODELLER.map((m) => (m.ad === 'bonsai2-4b' ? { ...m, kurulu: true } : m));
  const r = oner({ nvidia: false, ramGB: 8, bosDiskGB: 400 }, l);
  assert.ok(r.uygun && r.model === 'bonsai2-4b' && r.kurulu === true && r.metin === 'kurulu', JSON.stringify(r));
});

test('disk yetmezse bir küçüğe iner; hiçbiri sığmıyorsa uygun değil (nedeniyle)', () => {
  // 27B ~8,5 GB + 1 GB pay; 9B ~3,8 + 1; 4B ~2,5 + 1 (0.14.1: yazıya çevirme payı dahil).
  assert.equal(model(oner({ nvidia: true, vramGB: 16, ramGB: 32, bosDiskGB: 6 })), 'bonsai2-9b');
  assert.equal(model(oner({ nvidia: true, vramGB: 16, ramGB: 32, bosDiskGB: 4 })), 'bonsai2-4b');
  const yok = oner({ nvidia: true, vramGB: 16, ramGB: 32, bosDiskGB: 2 });
  assert.equal(yok.uygun, false);
  assert.ok(!yok.uygun && /Diskte en az 3,5 GB boş yer gerekir/.test(yok.neden), JSON.stringify(yok));
  // Ölçülemeyen disk (NaN / yok) engel sayılmaz.
  assert.equal(model(oner({ nvidia: false, ramGB: 8, bosDiskGB: Number.NaN })), 'bonsai2-4b');
  assert.equal(model(oner({ nvidia: false, ramGB: 8 })), 'bonsai2-4b');
});

test('bellek/ekran kartı da disk gibi bir küçüğe indirir: diske sığdığı için inilen hafif sürüm ekran kartında çalışır, sistem belleğine takılmaz', () => {
  // Ekran kartı 16 GB, disk yalnız hafife yetiyor, sistem belleği 4 GB: hafif sürüm kartta çalışır — "uygun değil" denmez.
  const r = oner({ nvidia: true, vramGB: 16, ramGB: 4, bosDiskGB: 4 });
  assert.ok(r.uygun && r.model === 'bonsai2-4b' && r.ekranKarti === true, JSON.stringify(r));
  // Kart orta sürüme yetiyor ama orta sürüm diske sığmıyor; hafif kartta: uygun.
  const o = oner({ nvidia: true, vramGB: 8, ramGB: 4, bosDiskGB: 4 });
  assert.ok(o.uygun && o.model === 'bonsai2-4b' && o.ekranKarti === true, JSON.stringify(o));
});

test('işlemcide en hafif için bellek yetmiyorsa uygun değil; ekran kartında çalışan öneri sistem belleğine takılmaz', () => {
  const az = oner({ nvidia: false, ramGB: 4, bosDiskGB: 400 });
  assert.ok(!az.uygun && /En az 6 GB bellek gerekir/.test(az.neden), JSON.stringify(az));
  assert.equal(model(oner({ nvidia: true, vramGB: 8, ramGB: 4, bosDiskGB: 400 })), 'bonsai2-9b');
  assert.equal(oner({ nvidia: false, ramGB: 8, bosDiskGB: 400 }, []).uygun, false, 'liste boş');
});

test('yerelIndirmeBoyutu: tek sayı ve metin (indirme onayı, Gizlilik ve Ayarlar aynı sayıyı yazar)', () => {
  assert.deepEqual(yerelIndirmeBoyutu({ boyut: YEREL_MODELLER['bonsai2-4b'].boyut }), { gb: 2.5, metin: '2,5 GB iner' });
  assert.deepEqual(yerelIndirmeBoyutu({ boyut: YEREL_MODELLER['bonsai2-4b'].boyut }, true), { gb: 1.2, metin: '1,2 GB iner' });
  assert.deepEqual(yerelIndirmeBoyutu({ boyut: YEREL_MODELLER['bonsai2-27b'].boyut }), { gb: 8.5, metin: '8,5 GB iner' });
});
