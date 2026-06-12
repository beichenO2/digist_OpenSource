import { join } from "path";
import { Storage } from "@digist/storage/index";
import { getDataDir } from "./digist-paths";

let storage: Storage | null = null;

export function getStorage(): Storage {
  if (!storage) {
    const dbPath = process.env.DIGIST_DB ?? join(getDataDir(), "digist.sqlite");
    storage = new Storage(dbPath);
  }
  return storage;
}
