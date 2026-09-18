import assert from "node:assert/strict";
import test from "node:test";
import { dispatch } from "../lib/cli/dispatch.ts";

test("no arguments and help flags select usage", () => {
  assert.deepEqual(dispatch([]), { command: "help", target: "", flags: [] });
  assert.deepEqual(dispatch(["--help"]), { command: "help", target: "", flags: [] });
});

test("connect accepts every connector and passes flags through", () => {
  for (const connector of ["notion", "slack", "drive", "notes", "discord", "cad", "meetings"]) {
    assert.deepEqual(dispatch(["connect", connector, "--full"]), {
      command: "connect", target: connector, flags: ["--full"],
    });
  }
  assert.deepEqual(dispatch(["connect", "notion", "--full", "--since", "yesterday"]), {
    command: "connect", target: "notion", flags: ["--full", "--since", "yesterday"],
  });
});

test("connect rejects a missing or unknown connector", () => {
  assert.equal(dispatch(["connect"]).error, "connect requires a connector");
  assert.equal(dispatch(["connect", "email"]).error, "unknown connector: email");
});

test("sync preserves source flags", () => {
  assert.deepEqual(dispatch(["sync", "--source", "engineering", "--full"]), {
    command: "sync", target: "gbrain", flags: ["--source", "engineering", "--full"],
  });
});

test("sync watch and once modes route to the continuous runner", () => {
  assert.deepEqual(dispatch(["sync", "--watch", "--interval", "60"]), {
    command: "sync", target: "scripts/sync-daemon.ts", flags: ["--watch", "--interval", "60"],
  });
  assert.deepEqual(dispatch(["sync", "--once"]), {
    command: "sync", target: "scripts/sync-daemon.ts", flags: ["--once"],
  });
});

test("local pages dispatch to their scripts", () => {
  assert.deepEqual(dispatch(["ask"]), { command: "ask", target: "scripts/ask.ts", flags: [] });
  assert.deepEqual(dispatch(["console"]), { command: "console", target: "scripts/console.ts", flags: [] });
  assert.deepEqual(dispatch(["scopes"]), { command: "scopes", target: "scripts/scope-builder.ts", flags: [] });
  assert.deepEqual(dispatch(["skills"]), { command: "skills", target: "scripts/list-skills.ts", flags: [] });
  assert.deepEqual(dispatch(["workers"]), { command: "workers", target: "scripts/list-workers.ts", flags: [] });
});

test("eval requires a suite and preserves following flags", () => {
  assert.deepEqual(dispatch(["eval", "synthetic", "--verbose"]), {
    command: "eval", target: "synthetic", flags: ["--verbose"],
  });
  assert.equal(dispatch(["eval"]).error, "eval requires a suite");
});

test("serve and status dispatch to gbrain", () => {
  assert.deepEqual(dispatch(["serve", "--port", "8788"]), {
    command: "serve", target: "gbrain", flags: ["--port", "8788"],
  });
  assert.deepEqual(dispatch(["status"]), { command: "status", target: "gbrain", flags: [] });
});

test("unknown commands return an error while preserving flags", () => {
  assert.deepEqual(dispatch(["launch", "--fast"]), {
    command: "launch", target: "", flags: ["--fast"], error: "unknown command: launch",
  });
});
