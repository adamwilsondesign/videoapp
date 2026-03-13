import Database from "better-sqlite3";
import path from "path";
import { initializeSchema } from "./schema";

const DB_PATH = path.resolve(__dirname, "../../allybi.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initializeSchema(db);
  }
  return db;
}
