// Yerel MCP test sunucusu (stdio): sentetik "proje takip" verisi döner. Çağrılar MCP_GUNLUK dosyasına yazılır.
import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const VERI = {
  'mavi kuş': 'Mavi Kuş — sürüm 1.4 RC; açık hata sayısı: 3 (ödeme ekranı, bildirim, çevrimdışı sepet); beta kullanıcı: 340.',
  'kuzey rüzgârı': 'Kuzey Rüzgârı — tasarım revizyonu; açık hata sayısı: 0; teslim: 24 Ekim.',
};
const sunucu = new Server({ name: 'proje-takip-test', version: '1.0.0' }, { capabilities: { tools: {} } });
sunucu.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'proje_durumu',
    title: 'Proje durumu',
    description: 'Proje takip sisteminden bir projenin sürümünü, açık hata sayısını ve kullanıcı sayısını getirir.',
    inputSchema: { type: 'object', properties: { proje: { type: 'string', description: 'Proje adı' } }, required: ['proje'] },
    annotations: { readOnlyHint: true },
  }],
}));
sunucu.setRequestHandler(CallToolRequestSchema, async (istek) => {
  const proje = String(istek.params.arguments?.proje ?? '').toLocaleLowerCase('tr-TR');
  if (process.env.MCP_GUNLUK) fs.appendFileSync(process.env.MCP_GUNLUK, `${JSON.stringify({ arac: istek.params.name, proje })}\n`);
  const bulunan = Object.entries(VERI).find(([k]) => proje.includes(k.split(' ')[0]));
  return { content: [{ type: 'text', text: bulunan ? bulunan[1] : `Kayıt yok: ${proje}` }] };
});
await sunucu.connect(new StdioServerTransport());
