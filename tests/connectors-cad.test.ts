import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectCad, normaliseRow } from "../lib/connectors/cad/collect.ts";
import { renderCad } from "../lib/connectors/cad/render.ts";

const jsonExport = fileURLToPath(new URL("../lib/connectors/cad/__fixtures__/cad-export.json", import.meta.url));
const csvExport = fileURLToPath(new URL("../lib/connectors/cad/__fixtures__/cad-export.csv", import.meta.url));
const fusionExport = fileURLToPath(new URL("../lib/connectors/cad/__fixtures__/fusion-export.json", import.meta.url));

test("normaliseRow maps varied column names, classifies type, parses dates, keeps unknowns", () => {
  const d = normaliseRow({
    "File Name": "GBX-1001.SLDPRT", "PN": "GBX-1001", "Desc": "Housing",
    "Rev": "B", "Mat": "6061-T6", "Workflow State": "Released",
    "Checked In By": "a.sam", "Checked In": "08/20/2026 14:05",
    "Project": "Orbit", "whereUsed": "GBX-1000",
  }, "solidworks");
  assert.equal(d.system, "solidworks");
  assert.equal(d.partNumber, "GBX-1001");
  assert.equal(d.type, "part");                    // from .SLDPRT
  assert.equal(d.material, "6061-T6");
  assert.equal(d.state, "Released");
  assert.equal(d.modifiedBy, "a.sam");
  assert.match(d.modifiedAt, /^2026-08-20T/);      // date normalised to ISO
  assert.deepEqual(d.whereUsed, ["GBX-1000"]);
  assert.deepEqual(d.props, { Project: "Orbit" }); // unmapped column preserved
});

test("classifyType recognises CATIA extensions and the type column", () => {
  assert.equal(normaliseRow({ "File Name": "housing.CATPart" }).type, "part");
  assert.equal(normaliseRow({ "File Name": "gearbox.CATProduct" }).type, "assembly");
  assert.equal(normaliseRow({ "File Name": "sheet.CATDrawing" }).type, "drawing");
  assert.equal(normaliseRow({ name: "part1.prt", "Document Type": "Assembly" }).type, "assembly");
});

test("collectCad reads the JSON export, sorts by part number, builds BOM", async () => {
  const docs = await collectCad(jsonExport, "solidworks");
  assert.deepEqual(docs.map((d) => d.partNumber), ["GBX-1000", "GBX-1001", "GBX-1002"]);
  assert.ok(docs.every((d) => d.system === "solidworks"));

  const asm = docs[0];
  assert.equal(asm.type, "assembly");
  assert.equal(asm.revision, "C");
  assert.equal(asm.children.length, 3);
  assert.deepEqual(asm.children[2], { partNumber: "STD-BRG-6204", description: "Ball bearing 6204", quantity: 4 });
  assert.deepEqual(asm.drawings, ["GBX-1000-DRW.SLDDRW"]);
  assert.equal(asm.props.Project, "Orbit");

  assert.equal(docs[1].material, "6061-T6");
  assert.deepEqual(docs[1].whereUsed, ["GBX-1000"]);
  assert.equal(docs[2].state, "Under Review");
});

test("collectCad also accepts a CSV export", async () => {
  const docs = await collectCad(csvExport, "catia");
  assert.deepEqual(docs.map((d) => d.partNumber), ["BRK-200", "BRK-201"]);
  assert.equal(docs[0].system, "catia");
  assert.equal(docs[0].type, "part");
  assert.equal(docs[0].description, "Mounting bracket, L");   // quoted comma survived
  assert.equal(docs[0].material, "6061-T6");
});

test("renderCad files under cad/<system>/<type>/ with frontmatter, facts and BOM", async () => {
  const [asm, housing] = await collectCad(jsonExport, "solidworks");

  const a = renderCad(asm);
  assert.equal(a.path, "cad/solidworks/assembly/gbx-1000.md");
  assert.match(a.markdown, /^---\nsource: cad\ncad_system: "solidworks"\ndoc_type: assembly\npart_number: "GBX-1000"/);
  assert.match(a.markdown, /revision: "C"/);
  assert.match(a.markdown, /## Bill of materials/);
  assert.match(a.markdown, /\| STD-BRG-6204 \| Ball bearing 6204 \| 4 \|/);
  assert.match(a.markdown, /## Notes\n\nRev C: swapped to 6204 bearings/);

  const h = renderCad(housing);
  assert.equal(h.path, "cad/solidworks/part/gbx-1001.md");
  assert.match(h.markdown, /## Where used\n\n- GBX-1000/);
  assert.match(h.markdown, /\| Material \| 6061-T6 \|/);
});

test("collectCad ingests a Fusion metadata export — folds nested props, builds BOM, keeps a parameters doc", async () => {
  const docs = await collectCad(fusionExport, "fusion");
  assert.deepEqual(docs.map((d) => d.partNumber), ["BRK-ASSY", "BRK-ASSY-PARAMS", "BRK-PLATE"]);
  assert.ok(docs.every((d) => d.system === "fusion"));

  const asm = docs[0];
  assert.equal(asm.type, "assembly");                       // Type column
  assert.equal(asm.revision, "v3");
  assert.equal(asm.children.length, 3);
  assert.deepEqual(asm.children[1], { partNumber: "BRK-ARM", description: "Adjustable arm", quantity: 2 });
  assert.equal(asm.props.mass_kg, "0.284");                 // nested props object folded in
  assert.equal(asm.props.bbox_cm, "12.0 x 8.0 x 3.4");
  assert.equal(asm.props["[object Object]"], undefined);    // and not stringified whole

  const plate = docs[2];
  assert.equal(plate.material, "Aluminum 6061");
  assert.deepEqual(plate.whereUsed, ["BRK-ASSY"]);
  assert.equal(plate.props["Tako.tolerance_class"], "IT7");

  const params = docs[1];
  assert.match(params.notes, /arm_length = 60 mm/);

  const a = renderCad(asm);
  assert.equal(a.path, "cad/fusion/assembly/brk-assy.md");
  assert.match(a.markdown, /## Custom properties/);
  assert.match(a.markdown, /\| mass_kg \| 0\.284 \|/);
});

test("renderCad separates systems by path", async () => {
  const [d] = await collectCad(csvExport, "catia");
  assert.equal(renderCad(d).path, "cad/catia/part/brk-200.md");
  assert.equal(renderCad(d).markdown, renderCad(d).markdown); // stable
});
