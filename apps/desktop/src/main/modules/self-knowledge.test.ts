// Kendini bilme: öz-tanım GERÇEK araç ve modül tanımlarından üretilir (elle yazılmış yetenek listesi yok).
// Bütün yerleşik modüllerin araçları toplanır (`local-groups.test.ts` ile aynı yol) ve şunlar güvenceye alınır:
//   1. her araç tam bir bilinen kümeye düşer; her yerel kümenin öz-tanımda adı ve "ne işe yarar" cümlesi vardır;
//   2. modül kapanınca araçları, kümesi, sayfası ve yeteneği düşer; modül "KAPALI" diye nedeniyle yazılır;
//   3. cümle kayıttan çıkar: bilgisayarı kullanma izni kapalıyken "tıklar, yazar" yazılmaz;
//   4. boyutlar: yerel blok bugünkünden (1962 karakter, kayıtlı 110 araçla) büyümez; zengin öz-tanım sınırlıdır.
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { t, type ModuleDef, type ToolDef } from '@fuber/shared';
import { estimateTokens } from '../core/brain';
import { LOCAL_GROUP_TABLE, isLocalTool } from '../core/brain/local-tools';
import { listCapabilities, renderSelfBlock, selfHints, type SelfState } from '../core/brain/self';
import { CLUSTER_INFO, buildCatalog, buildClusters, renderSelfKnowledge, type CatalogModule, type CatalogTool } from '../core/brain/self-catalog';
import { stableSystem } from '../core/brain/prompt';
import { DEFAULT_POLICY } from '@fuber/shared';
import ambient from './ambient/index';
import browser from './browser/index';
import { browserTools } from './browser/tools';
import documents from './documents/index';
import importV1 from './import-v1/index';
import meeting from './meeting/index';
import mail from './mail/index';
import memory from './memory/index';
import pc from './pc/index';
import { controlTools, readTools } from './pc/tools';
import { deviceControlTools, deviceReadTools } from './pc/device';
import { fileControlTools, fileReadTools } from './pc/files';
import { selftestTool } from './pc/selftest';
import { systemControlTools, systemReadTools } from './pc/system';
import planner from './planner/index';
import projects from './projects/index';
import stage from './stage/index';
import voiceControl from './voice-control/index';
import watch from './watch/index';
import web from './web/index';
import workshop from './workshop/index';
import selfdev from './selfdev/index';

vi.mock('electron', () => ({ app: { isPackaged: false, commandLine: { getSwitchValue: () => '' }, getPath: () => os.tmpdir() } }));

const MODULES: ModuleDef[] = [ambient, browser, documents, importV1, mail, meeting, memory, pc, planner, projects, stage, voiceControl, watch, web, workshop];
const asTools = (moduleId: string, defs: readonly ToolDef[]): CatalogTool[] => defs.map((def) => ({ name: def.name, moduleId, risk: def.risk, ...(def.group ? { group: def.group } : {}) }));
const READ = asTools('pc', [...readTools({ uia: {}, screens: () => [] } as never), ...fileReadTools({} as never), ...systemReadTools({} as never), ...deviceReadTools({} as never)]);
const CONTROL = asTools('pc', [
  ...controlTools({} as never),
  ...fileControlTools({} as never),
  ...systemControlTools({ uia: {}, input: {} } as never),
  ...deviceControlTools({} as never),
  selftestTool(async () => ({ ok: false, stopped: null, steps: [], ms: 0 })),
]);
/** Bütün yerleşik araçlar (izinle kaydedilenler dahil). */
const ALL: CatalogTool[] = [
  ...MODULES.flatMap((module) => asTools(module.id, module.tools ?? [])),
  ...READ,
  ...CONTROL,
  ...asTools('browser', browserTools({ driver: {} as never })),
];
const moduleList = (off: Record<string, CatalogModule['state']> = {}): CatalogModule[] =>
  MODULES.map((module) => ({ id: module.id, name: t(module.nameKey), description: t(module.descriptionKey), kind: 'builtin' as const, state: off[module.id] ?? 'on' }));
const CONTROLS = { spoken: ['sessiz saatler', 'hitap', 'ses motoru'], managed: ['uyandırma sözü', 'asistanın adı'], localOnly: ['kısayollar'] };

const knowledgeOf = (tools: readonly CatalogTool[], modules: CatalogModule[] | null) =>
  renderSelfKnowledge(buildCatalog({ appName: 'Fuber AI 2', appVersion: '2.0.0-demo.3', persona: 'Jarvis', tools, modules, controls: CONTROLS }));

/** Örnek kurulum: beyin yerelde (bulut düşük), ses ekran kartında, derin beyin yok. */
function localState(tools: readonly CatalogTool[]): SelfState {
  return {
    appName: 'Fuber AI 2',
    appVersion: '2.0.0-demo.3',
    brain: { provider: 'local', reason: 'cloud_down', cause: 'billing', model: 'qwen3.5-4b-q4km', deep: { ok: false, reason: 'Anthropic hesabında kredi yok', provider: null, known: true } },
    voice: { ready: true, stt: { provider: 'whisper-local', gpu: true }, tts: { provider: 'supertonic', active: 'supertonic', device: 'cuda', fallbackReason: null }, micMuted: false, quiet: false, bargeIn: 'wake', wakePaused: false, conversation: false, meeting: false },
    admin: 'approved',
    hotkeys: { talk: 'Ctrl+Alt+J', mute: 'Ctrl+Alt+K' },
    pc: { control: true, read: true },
    work: ['Takip: example.com fiyatı'],
    capabilities: listCapabilities({ clusters: buildClusters(tools), local: true, localCallable: (name) => isLocalTool(name, tools.find((tool) => tool.name === name)?.group), deepOk: false }),
  };
}

describe('öz-tanım kayıttan üretilir', () => {
  it('her yerel kümenin öz-tanımda adı ve cümlesi var', () => {
    const known = new Set(CLUSTER_INFO.map((info) => info.id));
    for (const group of LOCAL_GROUP_TABLE) if (group.id !== 'core') expect(known.has(group.id), `öz-tanımda küme yok: ${group.id}`).toBe(true);
  });

  it('her yerleşik araç tam bir BİLİNEN kümeye düşer; her kümenin cümlesi dolu', () => {
    const clusters = buildClusters(ALL, moduleList());
    const placed = clusters.flatMap((cluster) => cluster.tools);
    expect(placed.sort()).toEqual(ALL.map((tool) => tool.name).sort());
    expect(clusters.filter((cluster) => cluster.id.startsWith('module:')).map((cluster) => cluster.id)).toEqual([]);
    for (const cluster of clusters) expect(cluster.purpose, cluster.id).not.toBe('');
    // Onay isteyenler ve derin beyin isteyenler kayıttan işaretlenir.
    expect(clusters.find((cluster) => cluster.id === 'mail')!.approval).toContain('mail_send');
    expect(clusters.find((cluster) => cluster.id === 'workshop')!.deep).toEqual(['skill_build']);
  });

  it('kümesi bilinmeyen aracın modülü ad ve açıklamasıyla kendi kümesi olur (yeni modül bu dosyaya dokunmadan görünür)', () => {
    const tools: CatalogTool[] = [...ALL, { name: 'pano_yaz', moduleId: 'pano', risk: 'write' }];
    const modules: CatalogModule[] = [...moduleList(), { id: 'pano', name: 'Pano', description: 'Kullanıcının panosu.', kind: 'builtin', state: 'on' }];
    const knowledge = knowledgeOf(tools, modules);
    expect(knowledge).toContain('  - Pano: Kullanıcının panosu. → pano_yaz.');
  });

  it('zengin öz-tanım: kimlik, sayfalar, modüller, kümeler, değiştirilebilen/değiştirilemeyen; deterministik', () => {
    const knowledge = knowledgeOf(ALL, moduleList());
    expect(knowledge).toBe(knowledgeOf(ALL, moduleList()));
    expect(knowledge).toContain("Sen Fuber AI 2 sürüm 2.0.0-demo.3'sin; kişilik adın Jarvis.");
    expect(knowledge).toMatch(/sayfalar \(app_navigate ile açarsın\): [^\n]*Toplantı/);
    expect(knowledge).toContain('Ayarlar’ın sekmeleri: Ses, Kısayollar, Gizlilik ve veri, E-posta, Bağlantı, Tanı');
    for (const tool of ALL) expect(knowledge, tool.name).toContain(tool.name);
    expect(knowledge).toContain('Değiştirebildiklerin: sesle/yazıyla değişen ayarlar (settings_set; değerlerini settings_list okur): sessiz saatler, hitap, ses motoru; eklentilerin (Atölye kümesi).');
    expect(knowledge).toContain('Değiştiremediklerin (istenirse nereden değişeceğini söyle): Fuber Yönetim’den yönetilenler: uyandırma sözü, asistanın adı; yalnız Ayarlar sayfasından değişenler: kısayollar.');
    // Değişken bir şey yok (mikrofon, saat, süren iş): sabit istemde durur.
    expect(knowledge).not.toMatch(/Mikrofon|saat \d|Takip:/);
  });

  it('modül kapanınca araçları, kümesi, sayfası ve yeteneği düşer; modül nedeniyle KAPALI yazılır', () => {
    const tools = ALL.filter((tool) => tool.moduleId !== 'meeting');
    const knowledge = knowledgeOf(tools, moduleList({ meeting: 'off-policy', ambient: 'off-user' }));
    expect(knowledge).not.toContain('meeting_');
    expect(knowledge).not.toContain('Toplantı modu:');
    expect(knowledge).not.toMatch(/sayfalar \(app_navigate ile açarsın\): [^\n]*Toplantı/);
    expect(knowledge).toContain('KAPALI: Ortam dinleme (bu bilgisayarda kapatıldı), Toplantı (Fuber Yönetim’de kapalı)');
    const ids = listCapabilities({ clusters: buildClusters(tools), local: false, localCallable: () => true, deepOk: true }).map((item) => item.id);
    expect(ids).not.toContain('group:meeting');
    expect(listCapabilities({ clusters: buildClusters(ALL), local: false, localCallable: () => true, deepOk: true }).map((item) => item.id)).toContain('group:meeting');
  });

  it('cümle kayıttan çıkar: bilgisayarı kullanma izni kapalıyken (yalnız okuma araçları) "tıklar, yazar" yazılmaz', () => {
    const readOnly = ALL.filter((tool) => !CONTROL.some((control) => control.name === tool.name));
    const pcLine = (tools: readonly CatalogTool[]) => knowledgeOf(tools, moduleList()).split('\n').find((line) => line.startsWith('  - Bilgisayarı kullanma'))!;
    expect(pcLine(readOnly)).toContain('pencereleri ve ekranları listeler, pencereyi okur');
    expect(pcLine(readOnly)).not.toContain('tıklar');
    expect(pcLine(readOnly)).not.toContain('yazar, tuşa basar');
    expect(pcLine(ALL)).toContain('tıklar, sürükler, kaydırır');
  });

  it('d6 kendini geliştirme: "yapamıyorum" deyip kesmez, eklenti önerir; Atölye yoksa öneri yazılmaz; çekirdek geliştirme yalnız kayıtlıysa anılır', () => {
    const knowledge = knowledgeOf(ALL, moduleList());
    expect(knowledge).toContain('Kümelerinde yoksa kesip bırakma, "Şu an bunu yapamıyorum; isterseniz kendime bu yeteneği ekleyebilirim" de; onaylarsa skill_build ile başlat.');
    expect(knowledge).not.toContain('core_develop');
    expect(knowledge).not.toContain('Kümelerinde yoksa yapamadığını söyle');
    const withCore = knowledgeOf([...ALL, ...asTools('selfdev', selfdev.tools ?? [])], moduleList());
    expect(withCore).toContain('onaylarsa skill_build (eklenti yetmezse core_develop) ile başlat.');
    const noWorkshop = knowledgeOf(ALL.filter((tool) => tool.moduleId !== 'workshop'), moduleList({ workshop: 'off-user' }));
    expect(noWorkshop).toContain('Kümelerinde yoksa yapamadığını söyle.');
    expect(noWorkshop).not.toContain('ekleyebilirim');
    // Yerel beyin: derin beyin yokken "bunu yapabilir hale gel" sözüne GERÇEK neden ipucu olarak verilir ("ekleyemem" değil).
    const hints = selfHints(localState(ALL), 'bunu yapabilir hale gel');
    expect(hints.join(' ')).toMatch(/Atölye\) VAR ama .*"Ekleyemem" deme/);
  });

  it('modül kaydı yoksa "bilinmiyor" yazar; sayfalar yüklü modüllerden çıkarılır', () => {
    const knowledge = knowledgeOf(ALL.filter((tool) => tool.moduleId !== 'meeting'), null);
    expect(knowledge).toContain('- Modüllerin listesi: bilinmiyor.');
    expect(knowledge).not.toMatch(/sayfalar \(app_navigate ile açarsın\): [^\n]*Toplantı/);
  });
});

describe('boyutlar (yerel bağlam 8192; ölçüm rapora yazılır)', () => {
  it('yerel blok bugünkünden büyümez; zengin öz-tanım sınırlıdır', () => {
    const local = renderSelfBlock(localState(ALL));
    const rich = renderSelfBlock({ ...localState(ALL), brain: { provider: 'cloud', reason: 'ok', cause: null, model: 'sonnet', cloudName: 'Claude Code', claudeCode: true, deep: { ok: true, reason: null, provider: 'claude-code', known: true } } }, { rich: true });
    const knowledge = knowledgeOf(ALL, moduleList());
    const system = stableSystem({ persona: DEFAULT_POLICY.persona, userName: null, userAddress: null }, 'voice', false, undefined, knowledge);
    console.log(
      `[öz-tanım ölçümü] araç ${ALL.length}; yerel blok ${local.length} karakter (~${estimateTokens(local)} token; önce 1962 / ~785); ` +
        `zengin durum bloğu ${rich.length} (~${estimateTokens(rich)}; önce 2139); zengin öz-tanım ${knowledge.length} (~${estimateTokens(knowledge)}); ` +
        `sesli sabit istem (öz-tanım dahil) ${system.length} (~${estimateTokens(system)})`,
    );
    // Önceki ölçüm (elle yazılmış aile listesiyle, aynı 110 araç ve aynı durum): 1962 karakter.
    expect(local.length).toBeLessThan(1962);
    // Yerel blokta süren işler yazılmaz (sistem istemi önbellekte kalsın); zengin blokta yazılır.
    expect(local).not.toContain('Takip:');
    expect(rich).toContain('Süren işler (1): Takip: example.com fiyatı.');
    expect(knowledge.length).toBeLessThan(9000);
  });
});
