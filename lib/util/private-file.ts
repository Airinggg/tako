import { chmodSync, closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

/** Atomically replace a local secret-bearing file and keep it owner-only. */
export function writePrivateFileAtomic(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Enforce the mode independently of the process umask and again after the
  // rename so an existing permissive destination cannot survive the update.
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}
