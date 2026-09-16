/**
 * Ask the brain — a minimal local chat page. Fully option A: retrieval and
 * answer synthesis both run on local Ollama, nothing leaves the machine.
 *
 *   npm run ask                      # http://localhost:4331
 *   PORT=5001 ASK_MODEL=qwen3.5:9b npm run ask
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const BRAIN_CLI = join(REPO, "packages/brain/src/cli.ts");
const GBRAIN_HOME = process.env.GBRAIN_HOME || join(process.env.HOME || "", ".aletheia-brain");
const MODEL = process.env.ASK_MODEL || "qwen2.5:3b-instruct";
const OLLAMA = process.env.OLLAMA_HOST || "http://localhost:11434";
const PORT = Number(process.env.PORT) || 4331;

function gb(args: string[]): string {
  const r = spawnSync("bun", [BRAIN_CLI, ...args], {
    cwd: join(REPO, "packages/brain"),
    env: { ...process.env, GBRAIN_HOME },
    encoding: "utf8", timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(`gbrain ${args[0]}: ${r.stderr || r.stdout}`);
  return r.stdout.replace(/^gbrain \d.*available\. Run:.*$/m, "").trim();
}

async function ollama(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false, think: false, keep_alive: "30m", options: { temperature: 0 } }),
    timeout: false as never,
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return ((await res.json()).response ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function sources(): string[] {
  try {
    const j = JSON.parse(gb(["sources", "status", "--json"]));
    return j.sources.filter((s: any) => s.source_id !== "default" && s.total_pages > 0).map((s: any) => s.source_id);
  } catch { return ["shared"]; }
}

/** BM25 search matches keywords, not full JA sentences — pull out the content
 * words (latin, katakana, kanji runs; drop lone hiragana particles + EN stopwords). */
function keywords(q: string): string {
  const STOP = new Set(["the", "a", "an", "is", "are", "was", "were", "what", "which", "how", "does", "do", "of", "in", "on", "to", "for", "and", "or"]);
  const toks = q.match(/[A-Za-z0-9]+|[ー゠-ヿ]+|[一-鿿]+/g) ?? [];
  const kw = toks.filter((t) => !STOP.has(t.toLowerCase()) && t.length > 1);
  return kw.length ? kw.join(" ") : q;
}

async function ask(question: string, source: string): Promise<{ answer: string; pages: string[]; ms: number }> {
  const t0 = Date.now();
  let hits = gb(["search", keywords(question), "--source", source]);
  if (!/^\[[\d.]+\]/m.test(hits)) hits = gb(["search", question, "--source", source]); // fall back to the raw question
  const ranked = [...new Set(
    hits.split("\n").map((l) => l.match(/^\[[\d.]+\]\s+(\S+)/)?.[1]).filter((s): s is string => !!s && s.includes("/")),
  )];
  // rule/skill definitions rarely answer a content question — drop them unless
  // nothing else matched. Keep the top 5 to stop one long page dominating.
  const content = ranked.filter((s) => !s.startsWith("skills/"));
  const slugs = (content.length ? content : ranked).slice(0, 3);
  if (!slugs.length) return { answer: "(no pages in this source matched the question)", pages: [], ms: Date.now() - t0 };
  const page = (s: string) => gb(["get", s, "--source", source]).replace(/^---\n[\s\S]*?\n---\n?/, "").trim().slice(0, 3000);
  const primary = `PRIMARY SOURCE — [${slugs[0]}]\n${page(slugs[0])}`;
  const extra = slugs.slice(1).map((s) => `context — [${s}]\n${page(s).slice(0, 1200)}`).join("\n\n");
  const prompt = `Answer the question from the PRIMARY SOURCE below. Use the "context" pages only if the primary source does not contain the answer. If none of them answer it, say so plainly — do not guess. Cite the page slug in square brackets after each fact, e.g. [${slugs[0]}]. Match the question's language.\n\nQuestion: ${question}\n\n${primary}\n\n${extra}`;
  return { answer: await ollama(prompt), pages: slugs, ms: Date.now() - t0 };
}

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (url.pathname === "/api/sources") return json({ sources: sources(), model: MODEL });
      if (url.pathname === "/api/ask" && req.method === "POST") {
        const { question, source } = await req.json();
        if (!question?.trim()) return json({ error: "empty question" }, 400);
        return json(await ask(String(question).trim(), String(source || "shared")));
      }
      return new Response("not found", { status: 404 });
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
  },
});

console.log(`ask the brain → http://localhost:${PORT}   (model: ${MODEL}, local-only, GBRAIN_HOME=${GBRAIN_HOME})`);

const PAGE = /* html */ `<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ask the brain</title>
<style>
 :root{--bg:#faf7ee;--card:#fffdf8;--ink:#24463d;--sage:#527e70;--amber:#d39a3c;--line:#e5e0d3;--muted:#7a7566}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.6 "Noto Sans JP",system-ui,sans-serif}
 .wrap{max-width:760px;margin:0 auto;padding:40px 20px 80px}
 h1{font-size:22px;margin:0 0 4px} .sub{color:var(--muted);font-size:13px;margin-bottom:24px}
 form{display:flex;flex-direction:column;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
 textarea{width:100%;min-height:78px;resize:vertical;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;background:#fff}
 .row{display:flex;gap:10px;align-items:center}
 select{padding:8px 10px;border:1px solid var(--line);border-radius:10px;font:inherit;background:#fff}
 button{margin-left:auto;padding:9px 20px;border:0;border-radius:10px;background:var(--ink);color:#fff;font:inherit;cursor:pointer;min-height:44px}
 button:disabled{opacity:.5;cursor:default}
 .note{color:var(--muted);font-size:12px;margin-top:8px}
 .answer{margin-top:22px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;white-space:pre-wrap}
 .answer.err{border-color:var(--amber);color:#7a4a12}
 .meta{color:var(--muted);font-size:12px;margin-top:14px;border-top:1px solid var(--line);padding-top:10px}
 .meta code{background:#f1ede0;padding:1px 5px;border-radius:4px;font-size:11px}
 .spin{display:inline-block;width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--sage);border-radius:50%;animation:s .8s linear infinite;vertical-align:-2px;margin-right:6px}
 @keyframes s{to{transform:rotate(360deg)}}
</style>
<div class="wrap">
 <h1>Ask the brain</h1>
 <div class="sub" id="sub">local only — retrieval and answer both run on Ollama, nothing leaves this machine</div>
 <form id="f">
   <textarea id="q" placeholder="例: takoの最初のPoCは何を入力にして何を抽出する？" autofocus></textarea>
   <div class="row">
     <label>source</label>
     <select id="src"></select>
     <button id="btn" type="submit">Ask</button>
   </div>
   <div class="note">first question of a session can take 30–60s while the local model loads.</div>
 </form>
 <div id="out"></div>
</div>
<script type="module">
const $=(s)=>document.querySelector(s);
async function boot(){
  const {sources,model}=await fetch('/api/sources').then(r=>r.json());
  $('#src').innerHTML=(sources.length?sources:['shared']).map(s=>'<option>'+s+'</option>').join('');
  $('#sub').textContent='local only — model: '+model+' — nothing leaves this machine';
}
$('#f').addEventListener('submit',async(e)=>{
  e.preventDefault();
  const q=$('#q').value.trim(); if(!q)return;
  $('#btn').disabled=true; $('#out').innerHTML='<div class="answer"><span class="spin"></span>thinking…</div>';
  try{
    const r=await fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q,source:$('#src').value})}).then(x=>x.json());
    if(r.error){$('#out').innerHTML='<div class="answer err">'+r.error+'</div>';}
    else{
      const cites=(r.pages||[]).map(p=>'<code>'+p+'</code>').join(' ');
      $('#out').innerHTML='<div class="answer">'+r.answer.replace(/</g,'&lt;')+'<div class="meta">pages used: '+(cites||'—')+' · '+Math.round(r.ms/1000)+'s</div></div>';
    }
  }catch(err){$('#out').innerHTML='<div class="answer err">'+err.message+'</div>';}
  $('#btn').disabled=false;
});
boot();
</script>`;
