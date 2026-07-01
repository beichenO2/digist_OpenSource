import { join } from "path";
import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";

/** 仓库根目录（web 的上一级），可用 DIGIST_ROOT 覆盖 */
export function getDigistRoot(): string {
  return process.env.DIGIST_ROOT ?? join(process.cwd(), "..");
}

/** Prepend NVM Node bin dir matching .nvmrc / engines.node (mirrors scripts/ensure-node.sh). */
export function resolveDigistNodeBin(): string | undefined {
  const root = getDigistRoot();
  let required = "22";
  try {
    required = readFileSync(join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "");
  } catch {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
        engines?: { node?: string };
      };
      const match = pkg.engines?.node?.match(/>=(\d+)/);
      if (match) required = match[1];
    } catch {
      /* keep default */
    }
  }

  const nvmBase = join(homedir(), ".nvm/versions/node");
  if (!existsSync(nvmBase)) return undefined;

  const matches = readdirSync(nvmBase)
    .filter((d) => d.startsWith(`v${required}`))
    .sort();
  const best = matches.at(-1);
  if (!best) return undefined;

  const binDir = join(nvmBase, best, "bin");
  return existsSync(join(binDir, "node")) ? binDir : undefined;
}

export function digistExecEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const nodeBin = resolveDigistNodeBin();
  return {
    ...process.env,
    ...(nodeBin ? { PATH: `${nodeBin}:${process.env.PATH ?? ""}` } : {}),
    ...extra,
  };
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
