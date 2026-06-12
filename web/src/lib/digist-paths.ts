import { join } from "path";

/** 仓库根目录（web 的上一级），可用 DIGIST_ROOT 覆盖 */
export function getDigistRoot(): string {
  return process.env.DIGIST_ROOT ?? join(process.cwd(), "..");
}

export function getDataDir(): string {
  return join(getDigistRoot(), "data");
}

/** 融合报告 Markdown 目录（与引擎 `reportDir` 一致） */
export function reportsDir(): string {
  return join(getDataDir(), "reports");
}

/** 进化日志 JSONL（与 EvolutionLog 一致；可用 DIGIST_EVOLUTION_DIR 覆盖目录） */
export function evolutionJsonlPath(): string {
  if (process.env.DIGIST_EVOLUTION_DIR) {
    return join(process.env.DIGIST_EVOLUTION_DIR, "evolution.jsonl");
  }
  return join(getDataDir(), "evolution", "evolution.jsonl");
}
