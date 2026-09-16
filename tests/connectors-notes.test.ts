import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectNotes } from "../lib/connectors/notes/collect.ts";
import { renderNote } from "../lib/connectors/notes/render.ts";

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "notes-root-"));
  await mkdir(join(root, "sub"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, "ideas.md"), "# Big idea\n\nship it");
  await writeFile(join(root, "sub", "log.txt"), "plain text note, no heading");
  await writeFile(join(root, "sub", "meeting.markdown"), "---\ntags: [x]\n---\n# Sync\n\nnotes");
  await writeFile(join(root, "skip.pdf"), "binary");
  await writeFile(join(root, ".git", "config"), "[core]");
  return root;
}

test("collectNotes walks roots, respects extensions, ignores dot-dirs", async () => {
  const root = await fixtureRoot();
  const records = await collectNotes({ roots: [root], extensions: [".md", ".markdown", ".txt"] });
  assert.deepEqual(records.map((r) => r.relPath), ["ideas.md", "sub/log.txt", "sub/meeting.markdown"]);
  assert.equal(records[0].title, "Big idea");                 // from # heading
  assert.equal(records[1].title, "plain text note, no heading"); // from first line
});

test("renderNote strips existing frontmatter and stamps provenance", async () => {
  const root = await fixtureRoot();
  const records = await collectNotes({ roots: [root], extensions: [".markdown"] });
  const { path, markdown } = renderNote(records[0]);
  assert.equal(path, "notes/" + records[0].rootName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "/sub/meeting.md");
  assert.match(markdown, /^---\nsource: notes\ntitle: "Sync"\npath: "sub\/meeting.markdown"\nroot: /);
  assert.doesNotMatch(markdown, /tags: \[x\]/);   // original frontmatter removed
  assert.match(markdown, /# Sync\n\nnotes\n$/);
});
