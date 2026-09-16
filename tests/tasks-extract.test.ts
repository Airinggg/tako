import assert from "node:assert/strict";
import test from "node:test";
import { mineTasks, type CorpusDoc } from "../lib/tasks/extract.ts";

const now = () => "2026-08-31T00:00:00.000Z";

const corpus: CorpusDoc[] = [
  { path: "discord/general/2026-08-28.md", date: "2026-08-28",
    text: "Grace: I'll reply to the Onocom email today. Yan: I'll book the meeting room for 9/1. Grace: replied, done." },
  { path: "discord/general/2026-08-29.md", date: "2026-08-29",
    text: "Yan: still waiting on the ISJ confirmation, blocked until they answer. someone should make the pitch slides." },
];

test("mineTasks parses the model's array, fills dates/mentions, normalises state & owner", async () => {
  const model = async () => JSON.stringify([
    { title: "Reply to the Onocom email", owner: "Grace", state: "done", has_deadline: false,
      quote: "I'll reply to the Onocom email today" },
    { title: "Book the meeting room for 9/1", owner: "Yan", state: "in progress", has_deadline: true,
      quote: "I'll book the meeting room for 9/1" },
    { title: "Get the ISJ confirmation", owner: "Yan", state: "BLOCKED", has_deadline: false,
      quote: "still waiting on the ISJ confirmation" },
    { title: "Make the pitch slides", owner: "null", state: "open", has_deadline: false,
      quote: "someone should make the pitch slides" },
  ]);
  const tasks = await mineTasks(corpus, model, now);

  assert.equal(tasks.length, 4);
  const onocom = tasks.find((t) => t.title.includes("Onocom"))!;
  assert.equal(onocom.state, "done");
  assert.equal(onocom.owner, "Grace");
  assert.equal(onocom.firstSeen, "2026-08-28");           // from the doc the quote lives in
  assert.equal(onocom.source, "discord/general/2026-08-28.md");

  const room = tasks.find((t) => t.title.includes("meeting room"))!;
  assert.equal(room.state, "in_progress");                // "in progress" -> snake
  assert.equal(room.hasDeadline, true);

  const isj = tasks.find((t) => t.title.includes("ISJ"))!;
  assert.equal(isj.state, "blocked");                     // "BLOCKED" -> lower

  const slides = tasks.find((t) => t.title.includes("pitch slides"))!;
  assert.equal(slides.owner, null);                       // "null" string -> null
});

test("mineTasks merges duplicate titles and bumps mentions", async () => {
  const model = async () => JSON.stringify([
    { title: "Ship the report", owner: "A", state: "open", quote: "ship the report" },
    { title: "ship the report", owner: "A", state: "open", quote: "ship the report" },
  ]);
  const tasks = await mineTasks(
    [{ path: "a.md", date: "2026-08-20", text: "ship the report" }], model, now,
  );
  assert.equal(tasks.length, 1);
  assert.ok(tasks[0].mentions >= 2);
});

test("mineTasks tolerates prose/fences, a bare object, and empty input", async () => {
  assert.deepEqual(await mineTasks(corpus, async () => "here:\n[]\nthanks", now), []);
  assert.deepEqual(await mineTasks(corpus, async () => "not json", now), []);
  assert.deepEqual(await mineTasks([], async () => "[]", now), []);
  const one = await mineTasks(corpus, async () => '{"title":"Do the thing","state":"open","quote":"do the thing"}', now);
  assert.equal(one.length, 1);
  assert.equal(one[0].title, "Do the thing");
});

test("mineTasks gives every task a stable id derived from the title", async () => {
  const model = async () => JSON.stringify([{ title: "Same Title", state: "open", quote: "x" }]);
  const a = await mineTasks([{ path: "a.md", text: "x" }], model, now);
  const b = await mineTasks([{ path: "b.md", text: "x" }], model, now);
  assert.equal(a[0].id, b[0].id);
  assert.match(a[0].id, /^t_/);
});
