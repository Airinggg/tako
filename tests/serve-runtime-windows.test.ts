import assert from "node:assert/strict";
import test from "node:test";
import { findAlethiaServe } from "../lib/cli/serve-runtime.ts";

/** `process.platform` is a getter on Node/Bun's `process` object but is
 *  still configurable -- overriding it temporarily and restoring it
 *  afterward is the standard way to test platform-dispatch code without a
 *  real second OS. */
function withPlatform<T>(platform: string, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

test("findAlethiaServe skips the Unix-only ps fallback on win32, returning null instead of shelling out", () => {
  // No managed state file exists for this test run, so without the win32
  // guard this would fall through to spawnSync("ps", ...) -- a command
  // that doesn't exist on Windows. The guard should short-circuit to null
  // before that ever happens.
  withPlatform("win32", () => {
    assert.equal(findAlethiaServe(), null);
  });
});
