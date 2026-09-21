/** Canvas <-> automation adapter. The only place graph shape and the
 * automation-record shape (trigger/action1/action2, exactly what
 * createAutomation() in scripts/demo.ts validates) meet, so the existing
 * List view and this Canvas view can never drift apart.
 *
 * The trigger/action string sets below are duplicated from
 * scripts/demo.ts's AB_TRIGGER_OPTIONS/AB_ACTION_OPTIONS rather than
 * imported, because this module must be importable from a plain node:test
 * file without booting scripts/demo.ts's server. tests/connectors-automation-canvas.test.ts
 * includes a same-values regression test against the real exported arrays
 * so the two lists cannot silently diverge. */

export type TriggerNodeId = "drive" | "notion" | "slack" | "schedule" | "manual";

export type CanvasEdge = {
  automationName: string;
  triggerNode: TriggerNodeId;
  actionSteps: [string, string];
};

export const TRIGGER_NODE_TO_STRING: Record<TriggerNodeId, string> = {
  drive: "New file added to Drive",
  notion: "New page added to Notion",
  slack: "New message in Slack",
  schedule: "Every Monday morning",
  manual: "Manual",
};

const STRING_TO_TRIGGER_NODE: Record<string, TriggerNodeId> = Object.fromEntries(
  Object.entries(TRIGGER_NODE_TO_STRING).map(([node, str]) => [str, node as TriggerNodeId]),
);

export function skillToEdge(skill: { name: string; trigger: string; procedureSteps: string[] }): CanvasEdge | null {
  const triggerNode = STRING_TO_TRIGGER_NODE[skill.trigger];
  if (!triggerNode) return null;
  if (skill.procedureSteps.length !== 2) return null;
  return {
    automationName: skill.name,
    triggerNode,
    actionSteps: [skill.procedureSteps[0], skill.procedureSteps[1]],
  };
}

export function edgeInputToAutomationPayload(
  triggerNode: TriggerNodeId,
  actionSteps: [string, string],
): { trigger: string; action1: string; action2: string } {
  return {
    trigger: TRIGGER_NODE_TO_STRING[triggerNode],
    action1: actionSteps[0],
    action2: actionSteps[1],
  };
}
