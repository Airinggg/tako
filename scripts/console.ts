/**
 * Scope-aware local department console.
 *
 *   bun scripts/console.ts            # serves http://localhost:4321
 *   PORT=5000 bun scripts/console.ts
 *
 * Brain reads use the vendored CLI. The only brain mutations exposed here are
 * the existing register-client and revoke-client invite actions.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { gbrainHome } from "../lib/eval/qa.ts";
import { grantsForScope, parseSkillFrontmatter, type SkillFrontmatter } from "../lib/scopes/grants.ts";
import { buildTree, excluded, included, type Scope } from "../lib/scopes/model.ts";
import { ClientError, readJsonBody, requireAdmin, resolveAdminToken, safeErrorResponse } from "../lib/util/http-security.ts";

const REPO = join(import.meta.dir, "..");
const BRAIN_CLI = join(REPO, "packages/brain/src/cli.ts");
const GBRAIN_HOME = gbrainHome();
const SCOPES_PATH = join(REPO, "config/scopes.json");
const BRAIN_SOURCES = join(REPO, "brain-sources");
const PORT = Number(process.env.PORT) || 4321;

const CACHE_TTL_MS = Number(process.env.CONSOLE_CACHE_MS) || 8_000;
const cache = new Map<string, { at: number; out: string }>();

function gb(args: string[], opts: { cache?: boolean } = {}): string {
  const key = JSON.stringify(args);
  if (opts.cache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.out;
  }
  const result = spawnSync("bun", [BRAIN_CLI, ...args], {
    cwd: join(REPO, "packages/brain"),
    env: { ...process.env, GBRAIN_HOME },
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`gbrain ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  const out = result.stdout.replace(/^gbrain \d.*available\. Run:.*$/m, "").trim();
  if (opts.cache) cache.set(key, { at: Date.now(), out });
  return out;
}

function gbJson<T>(args: string[]): T {
  const out = gb(args, { cache: true });
  const start = out.search(/[\[{]/);
  return JSON.parse(start >= 0 ? out.slice(start) : out) as T;
}

type SourceStatus = {
  source_id: string; name: string; local_path: string | null; federated: boolean;
  total_pages: number; embed_coverage_pct: number; last_sync_at: string | null;
  lag_seconds: number | null; sync_running: boolean;
};
type Client = {
  client_id: string; client_name: string; scopes: string;
  source_id: string; federated_read: string[];
};
type PageEntry = { slug: string; source: string };

function readScopes(): Scope[] {
  try {
    const value = JSON.parse(readFileSync(SCOPES_PATH, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

/** Page slugs from `gbrain list --source X` (TSV: slug\ttype\tdate\ttitle). */
function sourceEntries(sourceId: string): PageEntry[] {
  return gb(["list", "--source", sourceId], { cache: true }).split("\n").flatMap((line) => {
    const slug = line.split("\t")[0]?.trim();
    return slug?.includes("/") ? [{ slug, source: sourceId }] : [];
  });
}

function walkFiles(directory: string, files: string[] = []): string[] {
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(path, files);
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function loadSkillInventory(): { skills: SkillFrontmatter[]; rules: string[] } {
  const skills: SkillFrontmatter[] = [];
  const rules: string[] = [];
  if (!existsSync(BRAIN_SOURCES)) return { skills, rules };
  for (const sourceEntry of readdirSync(BRAIN_SOURCES, { withFileTypes: true })) {
    if (!sourceEntry.isDirectory()) continue;
    const source = sourceEntry.name;
    for (const file of walkFiles(join(BRAIN_SOURCES, source, "skills"))) {
      if (basename(file) === "SKILL.md") {
        const parsed = parseSkillFrontmatter(readFileSync(file, "utf8"), source);
        if (parsed) skills.push(parsed);
      } else if (/^_.*-rules\.md$/.test(basename(file))) {
        rules.push(file);
      }
    }
  }
  return { skills, rules };
}

function matchesScope(slug: string, scope: Scope): boolean {
  return scope.includePrefixes.some((prefix) => slug.startsWith(prefix));
}

function realisedAccess(scope: Scope, sources: readonly SourceStatus[], entries: readonly PageEntry[]) {
  const bySource = new Map<string, PageEntry[]>();
  for (const entry of entries) {
    const group = bySource.get(entry.source) ?? [];
    group.push(entry);
    bySource.set(entry.source, group);
  }

  const readable = new Set<string>();
  const partial = new Set<string>();
  for (const [source, pages] of bySource) {
    const selected = pages.filter((page) => matchesScope(page.slug, scope));
    if (!selected.length) continue;
    if (selected.length === pages.length) readable.add(source);
    else partial.add(source);
  }

  const namedPages = bySource.get(scope.name) ?? [];
  const namedSourceIsContained = namedPages.length > 0 && namedPages.every((page) => matchesScope(page.slug, scope));
  const hasAnySelection = entries.some((entry) => matchesScope(entry.slug, scope));
  const unresolved = !hasAnySelection || (partial.size > 0 && !namedSourceIsContained);
  const realisedSources = [...readable].sort();
  const primarySource = realisedSources.includes(scope.name) ? scope.name : realisedSources[0] ?? "";
  const missingSources = realisedSources.filter((id) => !sources.some((source) => source.source_id === id));
  return { realisedSources, primarySource, unresolved: unresolved || missingSources.length > 0 };
}

function syncView(sourceIds: readonly string[], sources: readonly SourceStatus[], unresolved: boolean) {
  const status = sourceIds.flatMap((id) => sources.filter((source) => source.source_id === id));
  if (unresolved || !status.length) return { syncStatus: "realisation needed", syncTone: "warn", lastSync: null };
  if (status.some((source) => source.sync_running)) return { syncStatus: `${status.length} source${status.length === 1 ? "" : "s"} syncing`, syncTone: "warn", lastSync: null };
  const embedPct = Math.min(...status.map((source) => source.embed_coverage_pct));
  const dates = status.map((source) => source.last_sync_at).filter((date): date is string => Boolean(date)).sort();
  const lastSync = dates[0] ?? null;
  if (embedPct < 100) return { syncStatus: `embed ${embedPct}%`, syncTone: "warn", lastSync };
  if (status.every((source) => source.last_sync_at)) return { syncStatus: "up to date", syncTone: "ok", lastSync };
  return { syncStatus: "never synced", syncTone: "warn", lastSync };
}

function sourceCards(sources: readonly SourceStatus[], clients: readonly Client[], entries: readonly PageEntry[]) {
  return sources.map((source) => {
    let docs = 0, skills = 0, rules = 0;
    for (const entry of entries.filter((page) => page.source === source.source_id)) {
      if (/^skills\/_/.test(entry.slug)) rules++;
      else if (/^skills\/.+\/skill$/.test(entry.slug)) skills++;
      else docs++;
    }
    return {
      kind: "source", id: source.source_id, name: source.name, purpose: "",
      docs, skills, rules,
      members: clients.filter((client) => client.source_id === source.source_id || client.federated_read.includes(source.source_id)).length,
      included: [], excluded: [], warnings: [],
      primarySource: source.source_id, readSources: [source.source_id], shareable: true,
      syncStatus: source.sync_running ? "syncing" : source.embed_coverage_pct < 100 ? `embed ${source.embed_coverage_pct}%` : source.last_sync_at ? "up to date" : "never synced",
      syncTone: source.sync_running || source.embed_coverage_pct < 100 || !source.last_sync_at ? "warn" : "ok",
      lastSync: source.last_sync_at,
    };
  });
}

function loadDashboard() {
  const sources = gbJson<{ sources: SourceStatus[] }>(["sources", "status", "--json"]).sources
    .filter((source) => source.source_id !== "default");
  const clients = gbJson<{ clients: Client[] }>(["auth", "clients", "--json"]).clients;
  const entries = sources.flatMap((source) => sourceEntries(source.source_id));
  const scopes = readScopes();
  if (!scopes.length) {
    return { mode: "sources", banner: "No scopes yet — run `npm run scope:build`", brains: sourceCards(sources, clients, entries) };
  }

  const tree = buildTree(entries);
  const inventory = loadSkillInventory();
  const brains = scopes.map((scope) => {
    const inside = included(tree, scope.includePrefixes);
    const outside = excluded(tree, scope.includePrefixes);
    const access = realisedAccess(scope, sources, entries);
    const grants = grantsForScope({ ...scope, realisedSources: access.realisedSources }, inventory.skills, inventory.rules);
    const sync = syncView(access.realisedSources, sources, access.unresolved);
    const members = clients.filter((client) => {
      const readable = new Set(client.federated_read);
      return access.realisedSources.length > 0 && access.realisedSources.every((source) => readable.has(source));
    });
    return {
      kind: "scope", id: scope.name, name: scope.name, purpose: scope.purpose,
      docs: inside.reduce((sum, node) => sum + node.pageCount, 0),
      skills: grants.skills.length, skillNames: grants.skills,
      rules: grants.rules.length, members: members.length,
      included: inside.map((node) => ({ prefix: node.prefix, pages: node.pageCount })),
      excluded: outside.nodes.map((node) => ({ prefix: node.prefix, pages: node.pageCount })),
      warnings: outside.sharedSourceWarning,
      primarySource: access.primarySource, readSources: access.realisedSources,
      shareable: !access.unresolved && Boolean(access.primarySource),
      ...sync,
    };
  });
  return { mode: "scopes", banner: "", brains };
}

function loadMembers() {
  return gbJson<{ clients: Client[] }>(["auth", "clients", "--json"]).clients.map((client) => ({
    id: client.client_id, name: client.client_name, scopes: client.scopes,
    write: client.source_id, read: client.federated_read,
  }));
}

function invite(name: string, email: string, source: string, federatedRead: string[]) {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) throw new ClientError("name must be kebab-case, 2-64 chars");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ClientError("enter a valid email address");
  const reads = [...new Set([source, ...federatedRead])].filter(Boolean);
  if (!source || !reads.length) throw new ClientError("the selected scope has no realised source yet");
  cache.clear();
  const out = gb(["auth", "register-client", name, "--scopes", "read", "--source", source, "--federated-read", reads.join(",")]);
  const clientId = out.match(/(gbrain_cl_[a-f0-9]{16,})/)?.[1] ?? "";
  const secret = out.match(/(secret|client[_-]?secret)[:\s]+([A-Za-z0-9._-]{16,})/i)?.[2]
    ?? out.match(/\b([A-Za-z0-9._-]{40,})\b/)?.[1] ?? "";
  return { name, email, source, reads, clientId, secret, raw: out };
}

function revoke(clientId: string) {
  if (!/^gbrain_cl_[a-f0-9]+$/.test(clientId)) throw new ClientError("bad client id");
  cache.clear();
  return gb(["auth", "revoke-client", clientId]);
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Mutating routes gated by X-Admin-Token — see requireAdmin() in
// lib/util/http-security.ts. Checked once, before the route if-chain, rather
// than repeated per-route below.
const ADMIN_ROUTES = new Set(["/api/invite", "/api/revoke"]);

if (import.meta.main) {
  const ADMIN_TOKEN = resolveAdminToken();
  Bun.serve({
    hostname: "127.0.0.1", port: PORT,
    async fetch(request) {
      const url = new URL(request.url);
      try {
        if (request.method === "POST" && ADMIN_ROUTES.has(url.pathname)) {
          const err = requireAdmin(request, ADMIN_TOKEN);
          if (err) return json({ error: err.message }, err.status);
        }

        if (url.pathname === "/") return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
        if (url.pathname === "/api/brains" && request.method === "GET") return json(loadDashboard());
        if (url.pathname === "/api/members" && request.method === "GET") return json({ members: loadMembers() });
        if (url.pathname === "/api/invite" && request.method === "POST") {
          const body = await readJsonBody<Record<string, any>>(request);
          const configuredScopes = readScopes();
          if (configuredScopes.length) {
            const dashboard = loadDashboard();
            const requested = Array.isArray(body.scopeNames) ? [...new Set(body.scopeNames.map(String))] : [];
            const cards = dashboard.brains.filter((brain: any) => requested.includes(brain.id));
            const primary = cards.find((brain: any) => brain.id === String(body.primaryScope));
            if (!requested.length || cards.length !== requested.length || !primary) throw new ClientError("choose at least one configured scope");
            if (cards.some((brain: any) => !brain.shareable)) throw new ClientError("realise every selected scope before inviting a member");
            const reads = [...new Set(cards.flatMap((brain: any) => brain.readSources))] as string[];
            return json(invite(String(body.name).trim(), String(body.email).trim(), primary.primarySource, reads));
          }
          return json(invite(String(body.name).trim(), String(body.email).trim(), String(body.source), Array.isArray(body.federatedRead) ? body.federatedRead : []));
        }
        if (url.pathname === "/api/revoke" && request.method === "POST") {
          const { clientId } = await readJsonBody<{ clientId?: string }>(request);
          return json({ ok: true, message: revoke(String(clientId)) });
        }
        return new Response("not found", { status: 404 });
      } catch (error) {
        return safeErrorResponse(error, json);
      }
    },
  });

  console.log(`department console → http://localhost:${PORT}   (GBRAIN_HOME=${GBRAIN_HOME})`);
}

const PAGE = /* html */ `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Scopes overview</title>
<style>
:root{--bg:#0a0a0f;--surface:#12121a;--hover:#1a1a2a;--line:#1e1e2e;--line2:#3a3a5a;--text:#e0e0e0;--muted:#888;--faint:#555;--ok:#34a853;--warn:#f5a623;--danger:#ff6b6b;--read:#3b82f6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,system-ui,sans-serif}code,.mono{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px}header{padding:24px 32px 8px}h1{font-size:22px;margin:0}.sub{color:var(--muted);font-size:13px}main{padding:16px 32px 64px;max-width:1280px}section{margin-top:28px}h2{font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:0 0 12px}.banner{display:none;padding:11px 14px;border:1px solid rgba(245,166,35,.4);background:rgba(245,166,35,.1);color:var(--warn);border-radius:10px;margin-top:14px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px}.card h3{margin:0 0 2px;font-size:17px}.purpose{color:var(--muted);min-height:42px}.cid{color:var(--faint)}.stats{display:flex;gap:20px;margin:14px 0 10px;flex-wrap:wrap}.stat b{display:block;font-size:20px}.stat span{color:var(--muted);font-size:10px}.rowline{display:flex;justify-content:space-between;gap:14px;color:var(--muted);font-size:12px;padding:3px 0}.boundary{display:block;margin-top:8px}.boundary span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.boundary .in{color:#8bc89c}.boundary .out{color:#c88989}.card-warning{color:var(--warn);font-size:11px;margin-top:8px}.card-actions{display:flex;justify-content:flex-end;margin-top:14px}.badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:12px}.b-ok{background:rgba(52,168,83,.15);color:var(--ok)}.b-warn{background:rgba(245,166,35,.15);color:var(--warn)}.b-read{background:rgba(59,130,246,.15);color:var(--read)}table{width:100%;border-collapse:collapse}th{text-align:left;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);padding:10px 12px;font-weight:500}td{padding:10px 12px;border-top:1px solid var(--line)}tr:hover td{background:var(--hover)}button{font:13px Inter,sans-serif;padding:7px 14px;border-radius:8px;border:1px solid var(--line2);background:transparent;color:var(--text);cursor:pointer}button.primary{background:var(--line2)}button.danger{color:#fff;background:var(--danger);border-color:var(--danger)}button:disabled{opacity:.45;cursor:default}.invite{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px;max-width:620px}.invite label.field{display:block;font-size:12px;color:var(--muted);margin:12px 0 4px}.invite input[type=text],.invite input[type=email],.invite select{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:#0f0f1a;color:var(--text)}.scopes{display:flex;flex-wrap:wrap;gap:12px;margin-top:7px}.scopes label{display:flex;align-items:center;gap:6px}.count{color:var(--muted);font-size:12px;margin-top:10px}.key{margin-top:14px;padding:12px 14px;border-radius:8px;background:rgba(0,0,0,.3);border:1px solid var(--line)}.key .warn{color:var(--warn);font-size:12px}.err{color:var(--danger);font-size:13px;margin-top:8px}.empty{color:var(--faint);text-align:center;padding:24px}@media(max-width:700px){header,main{padding-left:18px;padding-right:18px}.cards{grid-template-columns:1fr}}
</style><header><h1>Scopes overview</h1><div class="sub">local · explicit access boundaries · team provisioning</div></header><main><div id="banner" class="banner"></div>
<section><h2 id="cards-title">Scopes</h2><div id="cards" class="cards"><div class="empty">loading…</div></div></section>
<section id="invite-section"><h2>People / invite</h2><div class="invite" id="invite"><div class="empty">loading…</div></div></section>
<section><h2>Members</h2><table id="members"><thead><tr><th>Name</th><th>Scopes</th><th>Reads</th><th>Client id</th><th></th></tr></thead><tbody><tr><td colspan="5" class="empty">loading…</td></tr></tbody></table></section>
</main><script type="module">
const $=(s,r=document)=>r.querySelector(s);const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const api=async(p,o)=>{const r=await fetch(p,o),v=await r.json();if(!r.ok)throw new Error(v.error||'request failed');return v};
/* Admin-gated mutating routes (invite/revoke) need an X-Admin-Token header.
   The page itself stays unauthenticated — only these requests attach a
   token, read from localStorage, prompting once on a 401 and retrying. */
const adminFetch=async(p,o)=>{
  o=o||{};
  const headers=new Headers(o.headers||{});
  const stored=localStorage.getItem('tako-admin-token');
  if(stored)headers.set('X-Admin-Token',stored);
  let r=await fetch(p,{...o,headers});
  if(r.status===401){
    const entered=prompt('Admin token required for this action:');
    if(entered){
      localStorage.setItem('tako-admin-token',entered);
      headers.set('X-Admin-Token',entered);
      r=await fetch(p,{...o,headers});
    }
  }
  return r;
};
const adminApi=async(p,o)=>{const r=await adminFetch(p,o),v=await r.json();if(!r.ok)throw new Error(v.error||'request failed');return v};
let BRAINS=[],MODE='sources',ACTIVE='';
const summary=a=>a.length?a.map(x=>x.prefix+' ('+x.pages+')').join(', '):'none';
function cardHtml(b){return '<article class="card"><h3>'+esc(b.name)+'</h3><div class="purpose">'+esc(b.purpose||'GBrain source')+'</div><div class="cid mono">'+esc(b.readSources.join(', ')||'not realised')+'</div><div class="stats"><div class="stat"><b>'+b.docs+'</b><span>DOCUMENTS</span></div><div class="stat"><b>'+b.skills+'</b><span>SKILLS</span></div><div class="stat"><b>'+b.members+'</b><span>MEMBERS</span></div><div class="stat"><b>'+b.rules+'</b><span>RULES</span></div></div><div class="rowline"><span>Sync</span><span class="badge b-'+esc(b.syncTone)+'">'+esc(b.syncStatus)+'</span></div><div class="rowline"><span>Last sync</span><span>'+(b.lastSync?new Date(b.lastSync).toLocaleString():'—')+'</span></div>'+(b.kind==='scope'?'<div class="boundary"><span class="in" title="'+esc(summary(b.included))+'">Included · '+esc(summary(b.included))+'</span><span class="out" title="'+esc(summary(b.excluded))+'">Excluded · '+esc(summary(b.excluded))+'</span></div>'+(b.warnings.length?'<div class="card-warning">'+esc(b.warnings.join(' '))+'</div>':'')+(!b.shareable?'<div class="card-warning">Realise this scope before sharing it.</div>':'')+'<div class="card-actions"><button class="primary share" data-scope="'+esc(b.id)+'" '+(b.shareable?'':'disabled title="Realise this scope first"')+'>Share with your team</button></div>':'')+'</article>'}
async function loadCards(){try{const data=await api('/api/brains');BRAINS=data.brains;MODE=data.mode;$('#cards-title').textContent=MODE==='scopes'?'Scopes':'Department brains';if(data.banner){$('#banner').style.display='block';$('#banner').textContent=data.banner}else $('#banner').style.display='none';$('#cards').innerHTML=BRAINS.length?BRAINS.map(cardHtml).join(''):'<div class="empty">nothing indexed yet</div>';document.querySelectorAll('.share').forEach(button=>button.addEventListener('click',()=>{ACTIVE=button.dataset.scope;renderInvite();$('#invite-section').scrollIntoView({behavior:'smooth'})}));if(!ACTIVE)ACTIVE=BRAINS.find(b=>b.shareable)?.id||BRAINS[0]?.id||'';renderInvite()}catch(e){$('#cards').innerHTML='<div class="err">'+esc(e.message)+'</div>'}}
function renderInvite(){const active=BRAINS.find(b=>b.id===ACTIVE)||BRAINS[0];if(!active){$('#invite').innerHTML='<div class="empty">No source is ready to share.</div>';return}if(MODE==='scopes'){const checks=BRAINS.map(b=>'<label title="'+(b.shareable?'':'Realise this scope first')+'"><input type="checkbox" name="scope" value="'+esc(b.id)+'" '+(b.id===active.id?'checked ':'')+(b.shareable?'':'disabled ')+'> '+esc(b.name)+'</label>').join('');$('#invite').innerHTML='<strong>Share '+esc(active.name)+' with your team</strong><label class="field">Name (kebab-case)</label><input type="text" id="iname" placeholder="alice-tan" autocomplete="off"><label class="field">Email</label><input type="email" id="iemail" placeholder="alice@example.com"><label class="field">Scopes</label><div class="scopes">'+checks+'</div><div class="count" id="icount"></div><div style="margin-top:14px"><button class="primary" id="ibtn">Send invite</button></div><div id="iout"></div>'}else{const options=BRAINS.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join(''),checks=BRAINS.map(b=>'<label><input type="checkbox" name="read" value="'+esc(b.id)+'" '+(b.id==='shared'?'checked ':'')+'> '+esc(b.name)+'</label>').join('');$('#invite').innerHTML='<label class="field">Name (kebab-case)</label><input type="text" id="iname" placeholder="alice-tan"><label class="field">Email</label><input type="email" id="iemail" placeholder="alice@example.com"><label class="field">Writes to</label><select id="isource">'+options+'</select><label class="field">Can read</label><div class="scopes">'+checks+'</div><div class="count" id="icount"></div><div style="margin-top:14px"><button class="primary" id="ibtn">Send invite</button></div><div id="iout"></div>'}const update=()=>{const chosen=MODE==='scopes'?[...document.querySelectorAll('input[name=scope]:checked')].map(x=>x.value):[...new Set([$('#isource').value,...[...document.querySelectorAll('input[name=read]:checked')].map(x=>x.value)])];const docs=BRAINS.filter(b=>chosen.includes(b.id)).reduce((n,b)=>n+b.docs,0);$('#icount').textContent='This agent will be able to search '+docs+' document'+(docs===1?'':'s')+' across '+chosen.length+' scope'+(chosen.length===1?'':'s')+'. Nothing else.'};$('#invite').addEventListener('change',update);update();$('#ibtn').addEventListener('click',doInvite)}
async function doInvite(){const button=$('#ibtn'),out=$('#iout');button.disabled=true;out.innerHTML='';try{const body={name:$('#iname').value.trim(),email:$('#iemail').value.trim()};if(MODE==='scopes'){body.primaryScope=ACTIVE;body.scopeNames=[...document.querySelectorAll('input[name=scope]:checked')].map(x=>x.value)}else{body.source=$('#isource').value;body.federatedRead=[...document.querySelectorAll('input[name=read]:checked')].map(x=>x.value)}const r=await adminApi('/api/invite',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});out.innerHTML='<div class="key"><div class="warn">Shown once. Copy it into '+esc(r.email)+'’s agent config now.</div><div class="mono">client_id: '+esc(r.clientId||'(see raw)')+'</div><div class="mono">secret: '+esc(r.secret||'(not parsed — see raw below)')+'</div><pre class="mono" style="white-space:pre-wrap;color:var(--muted)">'+esc(r.raw)+'</pre></div>';await Promise.all([loadMembers(),loadCards()])}catch(e){out.innerHTML='<div class="err">'+esc(e.message)+'</div>'}finally{button.disabled=false}}
async function loadMembers(){const tb=$('#members tbody');try{const {members}=await api('/api/members');if(!members.length){tb.innerHTML='<tr><td colspan="5" class="empty">no members yet — use the invite form above</td></tr>';return}tb.innerHTML=members.map(m=>'<tr><td>'+esc(m.name)+'</td><td><span class="badge b-read">'+esc(m.scopes)+'</span></td><td class="mono" style="color:var(--muted)">'+esc(m.read.join(', '))+'</td><td class="mono" style="color:var(--faint)">'+esc(m.id.slice(0,22))+'…</td><td><button class="danger" data-id="'+esc(m.id)+'">Revoke</button></td></tr>').join('');tb.querySelectorAll('button[data-id]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Revoke '+button.dataset.id+'? Its tokens die immediately.'))return;button.disabled=true;try{await adminApi('/api/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientId:button.dataset.id})});await Promise.all([loadMembers(),loadCards()])}catch(e){alert(e.message)}}))}catch(e){tb.innerHTML='<tr><td colspan="5" class="err">'+esc(e.message)+'</td></tr>'}}
loadCards();loadMembers();
</script></html>`;
