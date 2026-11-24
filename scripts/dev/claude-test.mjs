import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
const key = fs.readFileSync(process.env.KEYFILE, "utf8").trim();
async function dene(etiket, opts) {
  try {
    const c = new Anthropic(opts(key));
    const r = await c.messages.create({ model: "claude-sonnet-5-5", max_tokens: 200, messages: [{ role: "user", content: "Sadece 'tamam' yaz." }] });
    const t = r.content.filter(b => b.type === "text").map(b => b.text).join("");
    console.log(etiket, "OK", r.model, JSON.stringify(t), r.usage.input_tokens, r.usage.output_tokens);
    return true;
  } catch (e) { console.log(etiket, "HATA", e.status, (e.error?.error?.type || ""), String(e.message).slice(0, 160)); return false; }
}
if (!(await dene("x-api-key", k => ({ apiKey: k })))) await dene("bearer", k => ({ apiKey: null, authToken: k }));
