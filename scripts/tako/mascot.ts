import { TAKO_COLORS } from "./tokens.ts";

export type MascotState = "resting" | "connecting" | "pointing" | "settled";

/** Where the full mascot may appear, per the spec's placement rules. Screen
 * ids here are the same ids used in demo.ts's nav/section data — keep them
 * in sync when a screen is renamed. */
export const MASCOT_PLACEMENT = {
  prominent: ["onboarding", "home-empty", "connect-setup", "automation-templates", "success-recovery"],
  sparing: ["ask", "tasks", "activity"],
  never: ["approvals", "permissions"],
} as const;

type PlacementScreen =
  | typeof MASCOT_PLACEMENT.prominent[number]
  | typeof MASCOT_PLACEMENT.sparing[number];

/** The eight-armed body, exactly as specified: amber body, cream underside
 * detail, two charcoal eyes, small ear fins, teal integration nodes. Do not
 * change arm count, arm length, fin size, or add suction-cup detail. */
function bodySvg(extra: string = ""): string {
  const arm = (rotation: number) => `
    <path class="tako-arm" transform="rotate(${rotation} 60 70)"
      d="M60 70 q-6 14 -2 22 q4 6 10 2 q4-8 2-20 z"
      fill="${TAKO_COLORS.amber}" stroke="${TAKO_COLORS.cream}" stroke-width="1.5" />`;
  const arms = [-70, -50, -25, -8, 8, 25, 50, 70].map(arm).join("");
  return `
  <svg viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="tako">
    ${arms}
    <ellipse cx="60" cy="55" rx="34" ry="30" fill="${TAKO_COLORS.amber}" />
    <ellipse cx="60" cy="60" rx="24" ry="18" fill="${TAKO_COLORS.cream}" opacity="0.5" />
    <path d="M32 40 q-6-10 2-14 q8-2 8 8 z" fill="${TAKO_COLORS.cream}" />
    <path d="M88 40 q6-10 -2-14 q-8-2 -8 8 z" fill="${TAKO_COLORS.cream}" />
    <circle cx="48" cy="52" r="4" fill="#3A3A38" />
    <circle cx="72" cy="52" r="4" fill="#3A3A38" />
    ${extra}
  </svg>`;
}

/** The compact mark used beside sensitive/restrained screens — no body, no
 * expression, just enough shape to be recognizable as tako's icon. */
export function mascotMark(size: "small" | "large" = "large"): string {
  const px = size === "small" ? 20 : 32;
  return `<span class="tako-mark" style="display:inline-block;width:${px}px;height:${px}px" aria-hidden="true">${bodySvg()}</span>`;
}

/** A node it connects to, for the "connecting two apps" and similar approved
 * behaviors. Teal per the spec's "teal integration nodes." */
function nodeSvg(x: number, y: number): string {
  return `<circle cx="${x}" cy="${y}" r="7" fill="${TAKO_COLORS.info}" opacity="0.85" />`;
}

/**
 * The full illustrated mascot in one of its approved behavior states.
 * Throws if asked to render on a screen in MASCOT_PLACEMENT.never — this is
 * a structural guard, not just a convention, per the spec's explicit rule
 * that the mascot must never appear beside sensitive/approval content.
 */
export function mascotScene(state: MascotState, screen?: PlacementScreen | (typeof MASCOT_PLACEMENT.never)[number]): string {
  if (screen && (MASCOT_PLACEMENT.never as readonly string[]).includes(screen)) {
    throw new Error(`tako must not appear on "${screen}" — use mascotMark() or nothing there instead`);
  }
  const connectingNodes = state === "connecting" ? nodeSvg(20, 30) + nodeSvg(100, 30) : "";
  return `<div class="tako-scene tako-scene--${state}" aria-hidden="true">${bodySvg(connectingNodes)}</div>`;
}
