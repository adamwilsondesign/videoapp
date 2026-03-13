import Database from "better-sqlite3";

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      short_id          TEXT    NOT NULL UNIQUE,
      original_filename TEXT    NOT NULL,
      stored_filename   TEXT    NOT NULL,
      mime_type         TEXT    NOT NULL DEFAULT 'video/mp4',
      file_size_bytes   INTEGER NOT NULL,
      upload_timestamp  TEXT    NOT NULL,
      status            TEXT    NOT NULL DEFAULT 'verified'
    );
    CREATE INDEX IF NOT EXISTS idx_videos_short_id ON videos(short_id);
  `);
}
