import path from "path";
import { Storage } from "@digist/storage/index.js";

let _storage: Storage | null = null;

/** 解析 DiGist SQLite 路径：优先 DIGIST_DB，否则为仓库根目录下 data/digist.sqlite */
export function getDigistDbPath(): string {
  if (process.env.DIGIST_DB) return process.env.DIGIST_DB;
  return path.join(process.cwd(), "..", "data", "digist.sqlite");
}

export function getStorage(): Storage {
  if (!_storage) {
    _storage = new Storage(getDigistDbPath());
  }
  return _storage;
}

export function getEvolutionLogPath(): string {
  if (process.env.DIGIST_EVOLUTION_DIR) {
    return path.join(process.env.DIGIST_EVOLUTION_DIR, "evolution.jsonl");
  }
  return path.join(process.cwd(), "..", "data", "evolution", "evolution.jsonl");
}
