// Görev 27 (Ruling BV): Claude Code ayarı — yeni profil "Düzenlemelere izin ver", 0.6/0.7/0.8 profili tamYetki'sini korur; Tam yetki
// modu yalnız ayar açıkken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccAyarGoc, ccBaslangicModu, ccModSecilebilir, ccUzakModu, CC_AYAR_VARSAYILAN, CC_MOD_ADLARI } from '../src/shared/cc-ayar.ts';

const birlesik = (ham: Record<string, unknown> | undefined) => ({ ...CC_AYAR_VARSAYILAN, ...(ham ?? {}) });

test('yeni profil (dosya yok): acceptEdits, Tam yetki kapalı, uygulama içi yol', () => {
  assert.deepEqual(ccAyarGoc(undefined, false, birlesik(undefined)), { etkin: true, terminal: 'konsol', tamYetki: false, varsayilanMod: 'acceptEdits', yol: 'uygulama', chrome: true });
});

test('0.6–0.8 profili: tamYetki true (ya da hiç yazılmamış) korunur → varsayılan mod Tam yetki; false → Her şeyi sor; öteki alanlar aynen', () => {
  const eskiAcik = { etkin: true, terminal: 'wt', tamYetki: true };
  assert.deepEqual(ccAyarGoc(eskiAcik, true, birlesik(eskiAcik)), { etkin: true, terminal: 'wt', tamYetki: true, varsayilanMod: 'bypassPermissions', yol: 'uygulama', chrome: true });
  const eskiKapali = { etkin: false, terminal: 'konsol', tamYetki: false };
  assert.deepEqual(ccAyarGoc(eskiKapali, true, birlesik(eskiKapali)), { etkin: false, terminal: 'konsol', tamYetki: false, varsayilanMod: 'default', yol: 'uygulama', chrome: true });
  // claudeCode hiç yoksa (çok eski profil): eski varsayılan tamYetki açıktı.
  assert.deepEqual(ccAyarGoc(undefined, true, birlesik(undefined)).tamYetki, true);
  assert.equal(ccAyarGoc({ etkin: true }, true, birlesik({ etkin: true })).varsayilanMod, 'bypassPermissions');
});

test('göçmüş profil: kayıtlı varsayılan mod ve yol olduğu gibi kalır (kural bir daha çalışmaz)', () => {
  const yeni = { etkin: true, terminal: 'konsol', tamYetki: true, varsayilanMod: 'plan', yol: 'terminal', chrome: true };
  assert.deepEqual(ccAyarGoc(yeni, true, birlesik(yeni)), yeni);
  const kapali = { etkin: true, terminal: 'konsol', tamYetki: false, varsayilanMod: 'acceptEdits', yol: 'uygulama', chrome: true };
  assert.deepEqual(ccAyarGoc(kapali, true, birlesik(kapali)), kapali);
});

test('bozuk değerler geçerliye düşer; bozuk varsayılan mod eski profil gibi tamYetki\'den türetilir', () => {
  const bozuk = { etkin: 'evet', terminal: 'bash', tamYetki: 'acik', varsayilanMod: 'auto', yol: 'x' };
  const a = ccAyarGoc(bozuk, true, birlesik(bozuk));
  assert.deepEqual(a, { etkin: true, terminal: 'konsol', tamYetki: true, varsayilanMod: 'bypassPermissions', yol: 'uygulama', chrome: true });
});

test('Tam yetki modu yalnız ayar açıkken seçilir; başlangıç modu kuralı', () => {
  assert.equal(ccModSecilebilir('bypassPermissions', false), false);
  assert.equal(ccModSecilebilir('bypassPermissions', true), true);
  assert.equal(ccModSecilebilir('plan', false), true);
  assert.equal(ccBaslangicModu({ tamYetki: false, varsayilanMod: 'acceptEdits' }), 'acceptEdits');
  assert.equal(ccBaslangicModu({ tamYetki: false, varsayilanMod: 'acceptEdits' }, 'plan'), 'plan');
  assert.equal(ccBaslangicModu({ tamYetki: false, varsayilanMod: 'acceptEdits' }, 'bypassPermissions'), 'acceptEdits', 'istenen Tam yetki ayar kapalıyken verilmez');
  assert.equal(ccBaslangicModu({ tamYetki: false, varsayilanMod: 'bypassPermissions' }), 'acceptEdits', 'ayar sonradan kapandıysa kayıtlı Tam yetki de verilmez');
  assert.equal(ccBaslangicModu({ tamYetki: true, varsayilanMod: 'bypassPermissions' }), 'bypassPermissions');
  assert.equal(ccBaslangicModu({ tamYetki: true, varsayilanMod: 'default' }, 'auto'), 'default', 'listede olmayan mod yok sayılır');
});

test('Ruling CA: telefondan başlayan oturum en çok "Düzenlemelere izin ver" (Tam yetki asla)', () => {
  assert.deepEqual((['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const).map(ccUzakModu), ['default', 'acceptEdits', 'plan', 'acceptEdits']);
});

test('Türkçe mod adları (K17)', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CC_MOD_ADLARI).map(([k, v]) => [k, v.ad])), { default: 'Her şeyi sor', acceptEdits: 'Düzenlemelere izin ver', plan: 'Plan', bypassPermissions: 'Tam yetki' });
});
