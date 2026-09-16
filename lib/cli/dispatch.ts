import { isConnectorName } from "../connectors/registry.ts";

export type DispatchPlan = {
  command: string;
  target: string;
  flags: string[];
  error?: string;
};

const FIXED_TARGETS: Record<string, string> = {
  ask: "scripts/ask.ts",
  console: "scripts/console.ts",
  scopes: "scripts/scope-builder.ts",
  skills: "scripts/list-skills.ts",
  workers: "scripts/list-workers.ts",
  sync: "gbrain",
  serve: "gbrain",
  status: "gbrain",
  doctor: "scripts/doctor.ts",
  setup: "scripts/setup.ts",
};

/** Parse CLI arguments without reading environment, files, or process state. */
export function dispatch(argv: readonly string[]): DispatchPlan {
  const args = [...argv];
  const command = args.shift() ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help", target: "", flags: args };
  }

  if (command === "connect") {
    const target = args.shift() ?? "";
    if (!target) return { command, target, flags: args, error: "connect requires a connector" };
    if (!isConnectorName(target)) return { command, target, flags: args, error: `unknown connector: ${target}` };
    return { command, target, flags: args };
  }

  if (command === "eval") {
    const target = args.shift() ?? "";
    if (!target) return { command, target, flags: args, error: "eval requires a suite" };
    return { command, target, flags: args };
  }

  if (command === "sync" && (args.includes("--watch") || args.includes("--once"))) {
    return { command, target: "scripts/sync-daemon.ts", flags: args };
  }

  const target = FIXED_TARGETS[command];
  if (target) return { command, target, flags: args };
  return { command, target: "", flags: args, error: `unknown command: ${command}` };
}
