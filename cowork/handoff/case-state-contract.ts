/**
 * Contract between the data layer (Claude) and the dashboard UI (Codex).
 *
 * Codex: build `app/(projects)/` against these types. Import them from
 * `@/cowork/handoff/case-state-contract`. Use `sampleBoard` (below) as fixture
 * data until the real loader lands.
 *
 * Claude: the real loader in `lib/projects/` must return a `ProjectBoard` with
 * this exact shape. If the shape must change, update this file and add a note to
 * cowork/TASKBOARD.md.
 */

export type Channel = "slack" | "line" | "messenger" | "notion" | "gdrive" | "meeting";

/** A single source message/document a claim is grounded in. */
export interface SourceRef {
  channel: Channel;
  /** Human-readable location, e.g. "#project-lirem", "Notion / 案件管理". */
  location: string;
  /** ISO 8601. */
  timestamp: string;
  /** Short quoted snippet that supports the claim. */
  excerpt: string;
  /** Deep link if the connector can produce one. */
  url?: string;
}

export type CaseStage =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "review"
  | "done";

export interface Person {
  id: string;
  displayName: string;
  /** Handles seen per channel, for cross-tool identity. */
  handles?: Partial<Record<Channel, string>>;
}

export interface TaskItem {
  id: string;
  title: string;
  assignee?: Person;
  dueDate?: string; // ISO date
  done: boolean;
  /** Set by the dropped-task detector. */
  dropped?: boolean;
  sources: SourceRef[];
}

export interface Decision {
  id: string;
  /** What was decided, in one line. */
  statement: string;
  decidedAt: string; // ISO
  /** Set by the decided-not-executed detector. */
  executed: boolean;
  sources: SourceRef[];
}

export interface ProjectCase {
  id: string;
  name: string;
  owner?: Person;
  stage: CaseStage;
  /** ISO timestamp of the most recent activity across all channels. */
  lastActivity: string;
  /** Next concrete action, if the extractor found one. */
  nextAction?: string;
  tasks: TaskItem[];
  decisions: Decision[];
  /** Detector output. */
  flags: {
    overdue: boolean;
    stale: boolean;
    hasDroppedTasks: boolean;
    hasUnexecutedDecisions: boolean;
  };
  sources: SourceRef[];
}

export interface ProjectBoard {
  generatedAt: string; // ISO
  /** Every case, most-recently-active first. */
  cases: ProjectCase[];
  people: Person[];
  /** Non-fatal notes from the pipeline (e.g. "LINE connector not configured"). */
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Fixture — realistic shape, invented data. Safe to ship in the repo. */
/* ------------------------------------------------------------------ */

const aoki: Person = {
  id: "p_aoki",
  displayName: "青木",
  handles: { slack: "@aoki", notion: "Aoki M." },
};
const rivera: Person = {
  id: "p_rivera",
  displayName: "Rivera",
  handles: { slack: "@d.rivera", messenger: "Dani Rivera" },
};

export const sampleBoard: ProjectBoard = {
  generatedAt: "2026-08-28T00:00:00Z",
  people: [aoki, rivera],
  warnings: ["LINE connector not configured — LINE threads not included."],
  cases: [
    {
      id: "c_lp_relaunch",
      name: "Lirem コーポレートサイト リニューアル",
      owner: aoki,
      stage: "in_progress",
      lastActivity: "2026-08-27T09:12:00Z",
      nextAction: "ワイヤーフレームの最終レビューを予約する",
      tasks: [
        {
          id: "t_wf",
          title: "全ページのワイヤーフレーム",
          assignee: aoki,
          dueDate: "2026-08-25",
          done: false,
          dropped: true,
          sources: [
            {
              channel: "slack",
              location: "#lirem-web",
              timestamp: "2026-08-19T04:30:00Z",
              excerpt: "青木さんに WF まとめてもらう、25 日目安で",
            },
          ],
        },
        {
          id: "t_copy",
          title: "トップページのコピー案",
          assignee: rivera,
          dueDate: "2026-09-02",
          done: false,
          sources: [
            {
              channel: "notion",
              location: "Notion / 案件管理 / Lirem",
              timestamp: "2026-08-22T11:00:00Z",
              excerpt: "Copy draft — owner: Rivera, due Sep 2",
            },
          ],
        },
      ],
      decisions: [
        {
          id: "d_cms",
          statement: "CMS は WordPress ではなく Notion 連携で進める",
          decidedAt: "2026-08-20T06:00:00Z",
          executed: false,
          sources: [
            {
              channel: "meeting",
              location: "定例 2026-08-20 議事録",
              timestamp: "2026-08-20T06:00:00Z",
              excerpt: "決定：CMS は Notion ベース。WP は不採用。",
            },
          ],
        },
      ],
      flags: {
        overdue: true,
        stale: false,
        hasDroppedTasks: true,
        hasUnexecutedDecisions: true,
      },
      sources: [],
    },
    {
      id: "c_ir_deck",
      name: "投資家向け説明資料 更新",
      owner: rivera,
      stage: "review",
      lastActivity: "2026-08-15T02:00:00Z",
      nextAction: undefined,
      tasks: [
        {
          id: "t_numbers",
          title: "Q2 数値の差し込み",
          assignee: rivera,
          dueDate: "2026-08-12",
          done: true,
          sources: [
            {
              channel: "messenger",
              location: "Rivera との DM",
              timestamp: "2026-08-12T08:20:00Z",
              excerpt: "numbers are in, deck ready for review",
            },
          ],
        },
      ],
      decisions: [],
      flags: {
        overdue: false,
        stale: true,
        hasDroppedTasks: false,
        hasUnexecutedDecisions: false,
      },
      sources: [],
    },
  ],
};
