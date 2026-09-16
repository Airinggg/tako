import { answerFromSource } from "../eval/qa.ts";
import type { SkillStepRunner } from "./run.ts";

export type LiveStepRunnerOptions = {
  model?: string;
  topK?: number;
  home?: string;
  timeoutMs?: number;
};

/** Build a local-only runner that retrieves and extracts from each source. */
export function createLiveStepRunner(opts: LiveStepRunnerOptions = {}): SkillStepRunner {
  return async (instruction, sources) => {
    const results: Array<{ source: string; answer: string; pages: string[] }> = [];
    for (const source of sources) {
      const result = await answerFromSource(instruction, source, opts);
      results.push({ source, answer: result.answer, pages: result.pages });
    }
    return {
      text: results.length === 1
        ? results[0].answer
        : results.map((result) => `## ${result.source}\n\n${result.answer}`).join("\n\n"),
      pagesRead: results.flatMap((result) => result.pages.map((page) => `${result.source}/${page}`)),
    };
  };
}
