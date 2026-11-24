// 0.14 T17 düzeltme turu 1: araç şemaları HER modelde çalışmalı (ürün kararı: araçlar modelden bağımsız). Bazı sağlayıcılar (ör. OpenRouter
// üzerinden Gemini) `type: ['string','number']` gibi tür dizisini ve `anyOf`/`oneOf`'u reddeder; o modelde bütün araçlı sohbet 400 verir.
// Bu test KAYITLI bütün araçların şemalarını tarar (main.ts'in kaydettiği her araç grubu) ve sonraki görevleri de korur.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

anaSurecSahnesi('arac-sema', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const { temelAraclariKaydet } = await import('../src/main/ajan/araclar/temel.ts');
const { gunKaydiAraclariniKaydet } = await import('../src/main/ajan/araclar/gunkaydi.ts');
const { kartAraciniKaydet } = await import('../src/main/ajan/araclar/kart.ts');
const { islerAraclariniKaydet } = await import('../src/main/ajan/araclar/isler.ts');
const { claudeCodeAraclariniKaydet } = await import('../src/main/claudecode/araclar.ts');
const { epostaAraclariniKaydet } = await import('../src/main/entegrasyon/eposta.ts');
// WhatsApp araçları isteğe bağlı modülde (bu depoda yok); onların şemaları modülün kendi testinde aynı kuralla taranır.
const { whatsappAraclariniKaydet } = await import('../src/main/entegrasyon/whatsapp-kapisi.ts');
const { mcpAraclariniKaydet } = await import('../src/main/entegrasyon/mcp.ts');
const { tarayiciAraclariniKaydet } = await import('../src/main/tarayici.ts');
const { bilgisayarAraclariniKaydet } = await import('../src/main/bilgisayar.ts');
const { dosyaAraclariniKaydet } = await import('../src/main/iceaktar.ts');
const { dosyaYazAraclariniKaydet } = await import('../src/main/ajan/araclar/dosya-yaz.ts');
const { tumAraclar } = await import('../src/main/ajan/araclar/kayit.ts');
for (const k of [temelAraclariKaydet, gunKaydiAraclariniKaydet, kartAraciniKaydet, islerAraclariniKaydet, claudeCodeAraclariniKaydet, epostaAraclariniKaydet,
  whatsappAraclariniKaydet, mcpAraclariniKaydet, tarayiciAraclariniKaydet, bilgisayarAraclariniKaydet, dosyaAraclariniKaydet, dosyaYazAraclariniKaydet]) k();

type Dugum = Record<string, unknown>;
const nesne = (x: unknown): x is Dugum => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Şema ağacını gezer (properties değerleri, items); tür dizisi, anyOf, oneOf, allOf bulunan yolları döndürür. */
function sema_ihlalleri(d: unknown, yol: string): string[] {
  if (!nesne(d)) return [];
  const out: string[] = [];
  if (Array.isArray(d.type)) out.push(`${yol}: type dizi (${JSON.stringify(d.type)})`);
  for (const k of ['anyOf', 'oneOf', 'allOf']) if (k in d) out.push(`${yol}: ${k} var`);
  if (nesne(d.properties)) for (const [ad, alt] of Object.entries(d.properties)) out.push(...sema_ihlalleri(alt, `${yol}.${ad}`));
  if (d.items !== undefined) out.push(...(Array.isArray(d.items) ? d.items.flatMap((x, i) => sema_ihlalleri(x, `${yol}[${i}]`)) : sema_ihlalleri(d.items, `${yol}[]`)));
  return out;
}

test('taramanın kendisi: tür dizisi, anyOf ve oneOf iç içe de yakalanır; düz şema temiz', () => {
  assert.deepEqual(sema_ihlalleri({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'string' } } } }, 'x'), []);
  assert.equal(sema_ihlalleri({ type: 'object', properties: { a: { type: ['string', 'number'] } } }, 'x').length, 1);
  assert.equal(sema_ihlalleri({ type: 'object', properties: { a: { type: 'array', items: { type: 'array', items: { type: ['string', 'number'] } } } } }, 'x').length, 1);
  assert.equal(sema_ihlalleri({ type: 'object', properties: { a: { anyOf: [{ type: 'string' }] } } }, 'x').length, 1);
  assert.equal(sema_ihlalleri({ oneOf: [] }, 'x').length, 1);
  // "type" adlı bir ÖZELLİK (nesne) tür dizisi değildir.
  assert.deepEqual(sema_ihlalleri({ type: 'object', properties: { type: { type: 'string' } } }, 'x'), []);
});

test('kayıtlı bütün araçların şemalarında tür dizisi, anyOf, oneOf, allOf yok (her modelde çalışsın)', () => {
  const araclar = tumAraclar();
  assert.ok(araclar.length >= 50, `taranan araç sayısı: ${araclar.length}`);
  for (const ad of ['dosya_yaz', 'dosya_duzenle', 'dosya_sil', 'belge_uret', 'hafiza_ara', 'kart_goster', 'eposta_gonder', 'tarayici_ac', 'bilgisayar_tikla']) {
    assert.ok(araclar.some((a) => a.tanim.ad === ad), `taranan araçlar arasında: ${ad}`);
  }
  const ihlal = araclar.flatMap((a) => sema_ihlalleri(a.tanim.sema, a.tanim.ad));
  assert.deepEqual(ihlal, []);
});
