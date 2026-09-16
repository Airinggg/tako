import { join, resolve } from "node:path";

export type Scope = {
  name: string;
  purpose: string;
  rules: string[];
  includePrefixes: string[];
  createdAt: string;
};

export type TreeNode = {
  name: string;
  prefix: string;
  pageCount: number;
  sourceIds: string[];
  children: TreeNode[];
};

export type PreviewNode = Pick<TreeNode, "name" | "prefix" | "pageCount" | "sourceIds">;
export type ExcludedPreview = { nodes: PreviewNode[]; sharedSourceWarning: string[] };

type Entry = { slug: string; source?: string };
type MutableNode = { name: string; prefix: string; pageCount: number; sourceIds: Set<string>; children: Map<string, MutableNode> };

function finish(node: MutableNode): TreeNode {
  return {
    name: node.name,
    prefix: node.prefix,
    pageCount: node.pageCount,
    sourceIds: [...node.sourceIds].sort(),
    children: [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).map(finish),
  };
}

export function buildTree(entries: Entry[]): TreeNode[] {
  const roots = new Map<string, MutableNode>();
  for (const entry of [...entries].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const segments = entry.slug.split("/").filter(Boolean);
    if (segments.length < 2) continue;
    const connector = segments[0];
    let root = roots.get(connector);
    if (!root) {
      root = { name: connector, prefix: `${connector}/`, pageCount: 0, sourceIds: new Set(), children: new Map() };
      roots.set(connector, root);
    }
    root.pageCount += 1;
    if (entry.source) root.sourceIds.add(entry.source);

    // The final segment is the page slug. Group only directory segments,
    // capped at two levels below the connector.
    let current = root;
    for (const segment of segments.slice(1, -1).slice(0, 2)) {
      let child = current.children.get(segment);
      if (!child) {
        child = { name: segment, prefix: `${current.prefix}${segment}/`, pageCount: 0, sourceIds: new Set(), children: new Map() };
        current.children.set(segment, child);
      }
      child.pageCount += 1;
      if (entry.source) child.sourceIds.add(entry.source);
      current = child;
    }
  }
  return [...roots.values()].sort((a, b) => a.name.localeCompare(b.name)).map(finish);
}

function covers(prefix: string, node: TreeNode): boolean {
  return node.prefix.startsWith(prefix);
}

function overlaps(prefixes: readonly string[], node: TreeNode): boolean {
  return prefixes.some((prefix) => covers(prefix, node) || prefix.startsWith(node.prefix));
}

function preview(tree: readonly TreeNode[], prefixes: readonly string[], wantIncluded: boolean): PreviewNode[] {
  const result: PreviewNode[] = [];
  const visit = (node: TreeNode) => {
    const fullyIncluded = prefixes.some((prefix) => covers(prefix, node));
    const hasIncludedDescendant = overlaps(prefixes, node);
    if (wantIncluded && fullyIncluded) {
      result.push({ name: node.name, prefix: node.prefix, pageCount: node.pageCount, sourceIds: node.sourceIds });
      return;
    }
    if (!wantIncluded && !hasIncludedDescendant) {
      result.push({ name: node.name, prefix: node.prefix, pageCount: node.pageCount, sourceIds: node.sourceIds });
      return;
    }
    if (node.children.length) for (const child of node.children) visit(child);
  };
  for (const node of tree) visit(node);
  return result;
}

export function included(tree: readonly TreeNode[], prefixes: readonly string[]): PreviewNode[] {
  return preview(tree, prefixes, true);
}

export function excluded(tree: readonly TreeNode[], prefixes: readonly string[]): ExcludedPreview {
  const nodes = preview(tree, prefixes, false);
  const includedNodes = included(tree, prefixes);
  const sharedSourceWarning: string[] = [];
  for (const connector of tree) {
    const inside = includedNodes.filter((node) => node.prefix.startsWith(connector.prefix));
    const outside = nodes.filter((node) => node.prefix.startsWith(connector.prefix));
    if (!inside.length || !outside.length) continue;
    const insideSources = new Set(inside.flatMap((node) => node.sourceIds));
    const shared = new Set(outside.flatMap((node) => node.sourceIds).filter((source) => insideSources.has(source)));
    if (shared.size) sharedSourceWarning.push(`${connector.name}: selected and excluded subtrees still share source ${[...shared].sort().join(", ")}; real isolation requires a separate source.`);
  }
  return { nodes, sharedSourceWarning };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function realisationPlan(scope: Scope, sourceOfPrefix: Map<string, string>, repoRoot = process.cwd()): string[] {
  const root = resolve(repoRoot);
  const sourceEntries = [...sourceOfPrefix.entries()];
  const rootsBySource = new Map<string, string>();
  for (const [prefix, source] of sourceEntries) {
    const current = rootsBySource.get(source);
    if (!current || prefix.split("/").length < current.split("/").length) rootsBySource.set(source, prefix);
  }

  const wholeSources = new Set<string>();
  const partial: Array<{ prefix: string; source: string }> = [];
  for (const prefix of scope.includePrefixes) {
    const source = sourceEntries.find(([candidate]) => prefix === candidate || prefix.startsWith(candidate) || candidate.startsWith(prefix))?.[1];
    if (!source) continue;
    const sourceRoot = rootsBySource.get(source)!;
    if (sourceRoot.startsWith(prefix)) wholeSources.add(source);
    else partial.push({ prefix, source });
  }

  const commands: string[] = [];
  for (const source of [...wholeSources].sort()) {
    commands.push(`# Whole source ${shellQuote(source)} is already isolated; add it to --federated-read for scope ${shellQuote(scope.name)}.`);
  }
  if (partial.length) {
    const target = join(root, "brain-sources", scope.name);
    commands.push(`# Create the directory for scope ${shellQuote(scope.name)}.`);
    commands.push(`mkdir -p ${shellQuote(target)}`);
    commands.push(`# Initialise the new scope source as its own Git repository.`);
    commands.push(`git -C ${shellQuote(target)} init`);
    for (const { prefix, source } of partial.sort((a, b) => a.prefix.localeCompare(b.prefix))) {
      const clean = prefix.replace(/\/$/, "");
      const parent = clean.split("/").slice(0, -1).join("/");
      const from = join(root, "brain-sources", source, clean);
      const toParent = join(target, parent);
      commands.push(`# Preserve the connector path for ${shellQuote(prefix)} in the new source.`);
      commands.push(`mkdir -p ${shellQuote(toParent)}`);
      commands.push(`# Copy ${shellQuote(prefix)} from source ${shellQuote(source)} into the new scope source.`);
      commands.push(`rsync -a ${shellQuote(`${from}/`)} ${shellQuote(`${join(target, clean)}/`)}`);
      commands.push(`# Remove the carved subtree from source ${shellQuote(source)} after reviewing the copy.`);
      commands.push(`git -C ${shellQuote(join(root, "brain-sources", source))} rm -r -- ${shellQuote(clean)}`);
    }
    for (const source of [...new Set(partial.map((item) => item.source))].sort()) {
      commands.push(`# Commit removals from the original source ${shellQuote(source)}.`);
      commands.push(`git -C ${shellQuote(join(root, "brain-sources", source))} commit -m ${shellQuote(`scope: carve out ${scope.name}`)}`);
    }
    commands.push(`# Stage the new scope source.`);
    commands.push(`git -C ${shellQuote(target)} add -A`);
    commands.push(`# Commit the new scope source before registering it with GBrain.`);
    commands.push(`git -C ${shellQuote(target)} commit -m ${shellQuote(`scope: create ${scope.name}`)}`);
    commands.push(`# Point the reviewed GBrain commands at the protected Alethia home.`);
    commands.push(`export GBRAIN_HOME="$HOME/.aletheia-brain"`);
    commands.push(`# Run the vendored CLI from its package directory.`);
    commands.push(`cd ${shellQuote(join(root, "packages/brain"))}`);
    commands.push(`# Register the new Git-backed source after reviewing this plan.`);
    commands.push(`bun src/cli.ts sources add ${shellQuote(scope.name)} --path ${shellQuote(target)} --name ${shellQuote(scope.name)}`);
    commands.push(`# Index the newly registered scope source.`);
    commands.push(`bun src/cli.ts sync --source ${shellQuote(scope.name)}`);
  }
  const reads = [...wholeSources, ...(partial.length ? [scope.name] : [])].sort();
  commands.push(`# Register people for this scope with --federated-read ${reads.join(",") || "<none>"}.`);
  return commands;
}
