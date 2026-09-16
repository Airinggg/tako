/** Read-only GBrain scope planner. Serves http://localhost:4341. */
import { spawnSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildTree, excluded, included, realisationPlan, type Scope, type TreeNode } from "../lib/scopes/model.ts";

const REPO = join(import.meta.dir, "..");
const BRAIN_CLI = join(REPO, "packages/brain/src/cli.ts");
const GBRAIN_HOME = join(process.env.HOME || "", ".aletheia-brain");
const SCOPES_PATH = join(REPO, "config/scopes.json");
const PORT = Number(process.env.PORT) || 4341;
const cache = new Map<string, { at: number; value: string }>();

function gb(args: string[]): string {
  const key = args.join("\0");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.value;
  const result = spawnSync("bun", [BRAIN_CLI, ...args], {
    cwd: join(REPO, "packages/brain"), env: { ...process.env, GBRAIN_HOME },
    encoding: "utf8", timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`gbrain ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  const value = result.stdout.replace(/^gbrain \d.*available\. Run:.*$/m, "").trim();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function gbJson<T>(args: string[]): T {
  const output = gb(args);
  const start = output.search(/[\[{]/);
  return JSON.parse(start >= 0 ? output.slice(start) : output) as T;
}

type SourceStatus = { source_id: string; name: string; total_pages: number; local_path: string | null };
type SourceView = { id: string; name: string; pageCount: number; localPath: string | null };

function loadTree(): { tree: TreeNode[]; sources: SourceView[] } {
  const statuses = gbJson<{ sources: SourceStatus[] }>(["sources", "status", "--json"]).sources
    .filter((source) => source.source_id !== "default" && source.total_pages > 0);
  const entries: Array<{ slug: string; source: string }> = [];
  for (const source of statuses) {
    for (const line of gb(["list", "--source", source.source_id]).split("\n")) {
      const slug = line.split("\t")[0]?.trim();
      if (slug && slug.includes("/")) entries.push({ slug, source: source.source_id });
    }
  }
  return {
    tree: buildTree(entries),
    sources: statuses.map((source) => ({ id: source.source_id, name: source.name, pageCount: source.total_pages, localPath: source.local_path })),
  };
}

async function readScopes(): Promise<Scope[]> {
  try {
    const parsed = JSON.parse(await readFile(SCOPES_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function saveScopes(scopes: Scope[]): Promise<void> {
  const temporary = `${SCOPES_PATH}.tmp`;
  await writeFile(temporary, `${JSON.stringify(scopes, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, SCOPES_PATH);
}

function allPrefixes(tree: readonly TreeNode[]): Set<string> {
  const values = new Set<string>();
  const visit = (node: TreeNode) => { values.add(node.prefix); node.children.forEach(visit); };
  tree.forEach(visit);
  return values;
}

function validateScope(input: any, tree: readonly TreeNode[]): Scope {
  const name = String(input?.name ?? "").trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(name)) throw new Error("name must be kebab-case, 1-32 characters");
  const purpose = String(input?.purpose ?? "").trim();
  const rules = Array.isArray(input?.rules) ? input.rules.map(String).map((rule: string) => rule.trim()).filter(Boolean) : [];
  const includePrefixes = Array.isArray(input?.includePrefixes) ? [...new Set(input.includePrefixes.map(String))].sort() : [];
  if (!includePrefixes.length) throw new Error("select at least one source prefix");
  const valid = allPrefixes(tree);
  const invalid = includePrefixes.find((prefix) => !valid.has(prefix));
  if (invalid) throw new Error(`prefix is not present in the current tree: ${invalid}`);
  return { name, purpose, rules, includePrefixes, createdAt: new Date().toISOString() };
}

function sourceMap(tree: readonly TreeNode[]): Map<string, string> {
  const result = new Map<string, string>();
  const visit = (node: TreeNode) => {
    if (node.sourceIds.length === 1) result.set(node.prefix, node.sourceIds[0]);
    node.children.forEach(visit);
  };
  tree.forEach(visit);
  return result;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

Bun.serve({
  hostname: "127.0.0.1", port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (url.pathname === "/api/tree" && request.method === "GET") return json(loadTree());
      if (url.pathname === "/api/scopes" && request.method === "GET") return json({ scopes: await readScopes() });
      if (url.pathname === "/api/scopes" && request.method === "POST") {
        const view = loadTree();
        const scope = validateScope(await request.json(), view.tree);
        const scopes = await readScopes();
        if (scopes.some((item) => item.name === scope.name)) throw new Error(`scope already exists: ${scope.name}`);
        scopes.push(scope);
        await saveScopes(scopes.sort((a, b) => a.name.localeCompare(b.name)));
        return json({ scope }, 201);
      }
      if (url.pathname === "/api/scopes/plan" && request.method === "POST") {
        const name = String((await request.json() as any)?.name ?? "");
        const scope = (await readScopes()).find((item) => item.name === name);
        if (!scope) throw new Error(`unknown scope: ${name}`);
        const view = loadTree();
        return json({ commands: realisationPlan(scope, sourceMap(view.tree), REPO), included: included(view.tree, scope.includePrefixes), excluded: excluded(view.tree, scope.includePrefixes) });
      }
      return new Response("not found", { status: 404 });
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
  },
});

console.log(`scope builder → http://localhost:${PORT}   (read-only GBRAIN_HOME=${GBRAIN_HOME})`);

const PAGE = /* html */ `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scope builder</title><style>
:root{--bg:#0a0a0f;--surface:#12121a;--hover:#1a1a2a;--line:#1e1e2e;--line2:#3a3a5a;--text:#e0e0e0;--muted:#888;--faint:#555;--ok:#34a853;--warn:#f5a623;--danger:#ff6b6b;--read:#3b82f6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.45 Inter,system-ui,sans-serif}header{padding:20px 24px 8px}h1{font-size:21px;margin:0}.sub{color:var(--muted)}main{padding:14px 24px 50px}.grid{display:grid;grid-template-columns:minmax(260px,1fr) minmax(260px,1fr) minmax(300px,1.15fr);gap:12px}.panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;min-height:510px}h2{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:0 0 12px}h3{font-size:13px;margin:16px 0 7px}.tree,.tree ul{list-style:none;padding-left:0}.tree ul{padding-left:18px;border-left:1px solid var(--line)}.tree li{margin:4px 0}.node{display:flex;gap:7px;align-items:center;padding:3px 5px;border-radius:6px}.node:hover{background:var(--hover)}details>summary{cursor:pointer;color:var(--muted)}.count{margin-left:auto;color:var(--faint);font-variant-numeric:tabular-nums}.source{font:10px ui-monospace;color:var(--read)}label.form{display:block;color:var(--muted);font-size:11px;margin:12px 0 4px}input[type=text],textarea{width:100%;border:1px solid var(--line);background:#0f0f1a;color:var(--text);border-radius:8px;padding:9px;font:13px Inter,system-ui}textarea{min-height:110px;resize:vertical}.preview{border:1px solid var(--line);border-radius:9px;padding:10px;margin-bottom:10px}.preview ul{padding-left:18px;margin:5px 0}.included{border-color:rgba(52,168,83,.45)}.excluded{border-color:rgba(255,107,107,.35)}.warn{background:rgba(245,166,35,.1);border:1px solid rgba(245,166,35,.35);color:var(--warn);padding:9px;border-radius:8px;margin:8px 0}.muted{color:var(--muted)}button{border:1px solid var(--line2);background:var(--line2);color:var(--text);padding:9px 14px;border-radius:8px;cursor:pointer}button:disabled{opacity:.5}.err{color:var(--danger);margin-top:8px}.saved{color:var(--muted);font-size:11px;margin-top:8px}.plan{margin-top:12px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px}.planbar{display:flex;justify-content:space-between}pre{white-space:pre-wrap;overflow:auto;background:#08080c;border:1px solid var(--line);padding:14px;border-radius:9px;color:#cbd5e1;font:12px/1.55 "JetBrains Mono",ui-monospace,monospace}@media(max-width:900px){.grid{grid-template-columns:1fr}.panel{min-height:0}}
</style><header><h1>Create scope</h1><div class="sub">local planner · explicit access boundaries · no brain mutations</div></header><main>
<div class="grid"><section class="panel"><h2>1 · Pick source subtrees</h2><div id="sources" class="muted">loading brain…</div><ul id="tree" class="tree"></ul></section>
<section class="panel"><h2>2 · Define the scope</h2><label class="form">Name (kebab-case)</label><input id="name" type="text" placeholder="engineering"><label class="form">What is this scope for?</label><textarea id="purpose" placeholder="The work and people this scope supports"></textarea><label class="form">Rules (one per line)</label><textarea id="rules" placeholder="Cite every claim\nDo not expose personnel files"></textarea><div id="saved" class="saved"></div></section>
<section class="panel"><h2>3 · Verify boundaries</h2><div class="preview included"><strong>Included</strong><ul id="included"><li class="muted">nothing selected</li></ul></div><div class="preview excluded"><strong>Excluded · this scope cannot see</strong><ul id="excluded"></ul></div><div id="warnings"></div><button id="create">Create scope</button><div id="error" class="err"></div></section></div>
<section class="plan"><div class="planbar"><h2>Realisation plan · review, then run manually</h2><button id="copy" disabled>Copy</button></div><pre id="plan">Create a scope to generate commands. This page never executes them.</pre></section></main>
<script type="module">
const $=s=>document.querySelector(s), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,opts)=>{const r=await fetch(path,opts),v=await r.json();if(!r.ok)throw new Error(v.error||'request failed');return v};let TREE=[],SOURCES=[],selected=new Set();
function nodeHtml(n){const kids=n.children.length?'<details open><summary>'+n.children.length+' subtrees</summary><ul>'+n.children.map(nodeHtml).join('')+'</ul></details>':'';return '<li><label class="node"><input type="checkbox" value="'+esc(n.prefix)+'"><span>'+esc(n.name)+'</span><span class="source">'+esc(n.sourceIds.join(','))+'</span><span class="count">'+n.pageCount+'</span></label>'+kids+'</li>'}
function walk(nodes,fn){nodes.forEach(n=>{fn(n);walk(n.children,fn)})}function overlaps(n){return [...selected].some(p=>n.prefix.startsWith(p)||p.startsWith(n.prefix))}function full(n){return [...selected].some(p=>n.prefix.startsWith(p))}
function collect(nodes,want,out=[]){for(const n of nodes){if(want&&full(n)){out.push(n);continue}if(!want&&!overlaps(n)){out.push(n);continue}if(n.children.length)collect(n.children,want,out)}return out}
function renderPreview(){const inside=collect(TREE,true,[]),outside=collect(TREE,false,[]);const list=(id,a,empty)=>$(id).innerHTML=a.length?a.map(n=>'<li><span class="mono">'+esc(n.prefix)+'</span> · '+n.pageCount+'</li>').join(''):'<li class="muted">'+empty+'</li>';list('#included',inside,'nothing selected');list('#excluded',outside,'nothing excluded');const warnings=[];for(const root of TREE){const i=inside.filter(n=>n.prefix.startsWith(root.prefix)),o=outside.filter(n=>n.prefix.startsWith(root.prefix));const is=new Set(i.flatMap(n=>n.sourceIds));const shared=[...new Set(o.flatMap(n=>n.sourceIds).filter(s=>is.has(s)))];if(i.length&&o.length&&shared.length)warnings.push(root.name+': selected and excluded subtrees still share source '+shared.join(', ')+'; real isolation requires a separate source.')}$('#warnings').innerHTML=warnings.map(w=>'<div class="warn">'+esc(w)+'</div>').join('')}
async function load(){const [{tree,sources},{scopes}]=await Promise.all([api('/api/tree'),api('/api/scopes')]);TREE=tree;SOURCES=sources;$('#sources').innerHTML=sources.map(s=>'<span class="source">'+esc(s.id)+'</span> '+s.pageCount+' pages').join(' · ');$('#tree').innerHTML=tree.map(nodeHtml).join('');$('#saved').textContent=scopes.length?'Saved: '+scopes.map(s=>s.name).join(', '):'No saved scopes yet.';$('#tree').addEventListener('change',e=>{const p=e.target.value;if(e.target.checked){for(const x of [...selected])if(x.startsWith(p)||p.startsWith(x))selected.delete(x);selected.add(p)}else selected.delete(p);document.querySelectorAll('#tree input').forEach(x=>x.checked=selected.has(x.value));renderPreview()});renderPreview()}
$('#create').addEventListener('click',async()=>{const button=$('#create');button.disabled=true;$('#error').textContent='';try{const body={name:$('#name').value.trim(),purpose:$('#purpose').value.trim(),rules:$('#rules').value.split(/\\n/).map(x=>x.trim()).filter(Boolean),includePrefixes:[...selected]};const {scope}=await api('/api/scopes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await api('/api/scopes/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:scope.name})});const text=result.commands.join('\\n');$('#plan').textContent=text;$('#copy').disabled=false;$('#saved').textContent='Saved: '+scope.name;renderPreview()}catch(e){$('#error').textContent=e.message}finally{button.disabled=false}});
$('#copy').addEventListener('click',async()=>{await navigator.clipboard.writeText($('#plan').textContent);$('#copy').textContent='Copied';setTimeout(()=>$('#copy').textContent='Copy',1200)});load().catch(e=>$('#error').textContent=e.message);
</script></html>`;
