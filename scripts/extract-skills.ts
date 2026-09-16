/**
 *   npm run skills:extract              # all department sources
 *   npm run skills:extract -- shared    # one source
 *   SKILLS_MODEL=qwen3.5:9b npm run skills:extract
 *
 * Mines recurring procedures from each source's ingested Markdown with a LOCAL
 * model and writes DRAFT skills to `skill-drafts/<source>/<name>.md` for human
 * review. Nothing is published; nothing leaves the machine.
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { mineSkills, ollamaModel, type CorpusDoc } from "../lib/skills/extract.ts";
import { renderDraft } from "../lib/skills/render-draft.ts";

const REPO = join(import.meta.dir, "..");
const SOURCES_DIR = join(REPO, "brain-sources");
const DRAFTS_DIR = join(REPO, "skill-drafts");

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));

async function listSources(): Promise<string[]> {
  const entries = await readdir(SOURCES_DIR, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "default")
    .map((e) => e.name)
    .filter((n) => wanted.length === 0 || wanted.includes(n));
}

async function corpusFor(source: string): Promise<CorpusDoc[]> {
  const root = join(SOURCES_DIR, source);
  const files = await readdir(root, { recursive: true }).catch(() => [] as string[]);
  const docs: CorpusDoc[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    if (f.startsWith("skills/") || f.includes("/skills/")) continue; // don't feed skills back in
    const text = await readFile(join(root, f), "utf8").catch(() => "");
    // strip frontmatter
    const body = text.startsWith("---\n") ? text.replace(/^---\n[\s\S]*?\n---\n?/, "") : text;
    if (body.trim().length > 40) docs.push({ path: f, text: body.trim() });
  }
  return docs;
}

const model = ollamaModel();
let total = 0;

for (const source of await listSources()) {
  const corpus = await corpusFor(source);
  if (corpus.length === 0) { console.log(`${source}: no content, skipped`); continue; }
  process.stdout.write(`${source}: mining ${corpus.length} doc(s)… `);
  let drafts;
  try {
    drafts = await mineSkills(corpus, model);
  } catch (err) {
    console.log(`model error: ${(err as Error).message}`);
    continue;
  }
  const outDir = join(DRAFTS_DIR, source);
  await mkdir(outDir, { recursive: true });
  for (const draft of drafts) {
    const { path, markdown } = renderDraft(draft, source);
    await writeFile(join(DRAFTS_DIR, path), markdown);
  }
  total += drafts.length;
  console.log(`${drafts.length} draft(s) → ${relative(REPO, outDir)}/`);
}

console.log(total === 0
  ? "\nNo procedures extracted. Ingest more content, or try SKILLS_MODEL=qwen3.5:9b."
  : `\n${total} draft skill(s) written to skill-drafts/. Review, edit, then promote per each file's header.`);
