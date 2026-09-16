import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeIndustrialCatalog, type CatalogServer, type IndustrialConnector } from "../lib/connectors/mcp/catalog.ts";

const scraped: CatalogServer = {
  name: "Old SolidWorks row", slug: "solidworks", description: "scraped", category: "misc",
  topics: ["mcp"], repoUrl: "https://scraped.invalid", homepageUrl: "", stars: 10,
  license: "unknown", updated: "", klass: "unknown", reason: "scraped", connectUrl: "https://mcp.example/solidworks",
};
const curated: IndustrialConnector = {
  id: "solidworks", label: "SOLIDWORKS", domain: "cad", executionPattern: "edge-windows-stdio-com",
  riskCeiling: "mutate", proposedWave: "pilot", evidence: "https://github.com/example/solidworks",
  note: "reviewed row",
};

test("curated industrial rows override scraped identity and policy but retain reachability", () => {
  const [row] = mergeIndustrialCatalog([scraped], [curated]);
  assert.equal(row.name, "SOLIDWORKS");
  assert.equal(row.category, "cad");
  assert.equal(row.klass, "action");
  assert.equal(row.connectUrl, "https://mcp.example/solidworks");
  assert.equal(row.reachable, true);
  assert.equal(row.curated, true);
});

test("the committed industrial register contains 24 unique entries", () => {
  const rows = JSON.parse(readFileSync(new URL("../config/industrial-connectors.json", import.meta.url), "utf8")) as IndustrialConnector[];
  assert.equal(rows.length, 24);
  assert.equal(new Set(rows.map((row) => row.id)).size, 24);
  assert.ok(rows.some((row) => row.domain === "cam"));
  assert.deepEqual(rows.filter((row) => row.localCommand).map((row) => row.id), ["cad", "mcp-generic"]);
});
