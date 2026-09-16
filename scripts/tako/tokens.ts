/** Design tokens for tako. Every screen references these by CSS variable —
 * never a bare hex — so the palette has exactly one source of truth. */

export const TAKO_COLORS = {
  canvas: "#F3F5F1",
  surface: "#FFFFFF",
  text: "#1E2925",
  textSecondary: "#66716C",
  primary: "#286653",
  selected: "#DCEBE4",
  info: "#527E8A",
  amber: "#D49A55",
  cream: "#F2D5A7",
  error: "#B85D55",
  border: "#DDE2DE",
} as const;

export const TAKO_TYPE_SCALE = {
  hero: "44px",       // 44-52px range; served value picked at the low end for
                       // operational screens per "no 60-90px headings" rule.
  pageTitle: "32px",  // 30-36px
  sectionTitle: "22px", // 20-24px
  body: "16px",       // 15-17px
  supporting: "13.5px", // 13-14px
  label: "12.5px",    // 12-13px
} as const;

export const TAKO_SPACING_UNIT = 8; // 8-point spacing system

export const TAKO_RADIUS = {
  card: "14px", // 12-16px range
} as const;

export const TAKO_MOTION = {
  feedbackMs: 160,   // 120-200ms
  panelMs: 220,      // 180-280ms
  mascotMs: 360,     // 280-500ms
  ambientMaxMs: 800,
} as const;

const cssVarName = (key: string) =>
  "--tako-" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

export const TAKO_CSS_TOKENS = `:root {
  --tako-font: Inter, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
${Object.entries(TAKO_COLORS).map(([k, v]) => `  ${cssVarName(k)}: ${v};`).join("\n")}
  --tako-radius-card: ${TAKO_RADIUS.card};
  --tako-space-1: ${TAKO_SPACING_UNIT}px;
  --tako-space-2: ${TAKO_SPACING_UNIT * 2}px;
  --tako-space-3: ${TAKO_SPACING_UNIT * 3}px;
  --tako-space-4: ${TAKO_SPACING_UNIT * 4}px;
  --tako-space-6: ${TAKO_SPACING_UNIT * 6}px;
  --tako-hero: ${TAKO_TYPE_SCALE.hero};
  --tako-page-title: ${TAKO_TYPE_SCALE.pageTitle};
  --tako-section-title: ${TAKO_TYPE_SCALE.sectionTitle};
  --tako-body: ${TAKO_TYPE_SCALE.body};
  --tako-supporting: ${TAKO_TYPE_SCALE.supporting};
  --tako-label: ${TAKO_TYPE_SCALE.label};
  --tako-feedback-ms: ${TAKO_MOTION.feedbackMs}ms;
  --tako-panel-ms: ${TAKO_MOTION.panelMs}ms;
  --tako-mascot-ms: ${TAKO_MOTION.mascotMs}ms;
}`;
