import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { getDb } from "../db/connection";

const router = Router();
const TEMPLATE_PATH = path.resolve(__dirname, "../templates/verify.html");

router.get("/api/verify/:shortID", (req: Request, res: Response): void => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM videos WHERE short_id = ?")
    .get(req.params.shortID) as any;

  if (!row) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  res.json({
    shortID: row.short_id,
    originalFilename: row.original_filename,
    uploadTimestamp: row.upload_timestamp,
    status: row.status,
    fileSizeBytes: row.file_size_bytes,
    mimeType: row.mime_type,
  });
});

router.get("/:shortID", (req: Request, res: Response): void => {
  // Skip reserved paths (static files, api, etc.)
  const reserved = ["api", "videos", "app", "app.js", "styles.css", "favicon.ico"];
  if (reserved.includes(req.params.shortID) || req.params.shortID.includes(".")) {
    res.status(404).send("Not found");
    return;
  }

  const db = getDb();
  const row = db
    .prepare("SELECT * FROM videos WHERE short_id = ?")
    .get(req.params.shortID) as any;

  if (!row) {
    res.status(404).send("Video not found");
    return;
  }

  let template = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const host = (req.get("host") as string) || "localhost:3000";
  const protocol = req.protocol;

  template = template
    .replace(/\{\{SHORT_ID\}\}/g, row.short_id)
    .replace(
      /\{\{VIDEO_URL\}\}/g,
      `${protocol}://${host}/videos/${row.short_id}`
    )
    .replace(/\{\{UPLOAD_TIMESTAMP\}\}/g, row.upload_timestamp)
    .replace(/\{\{STATUS\}\}/g, row.status)
    .replace(
      /\{\{VERIFY_URL\}\}/g,
      `${protocol}://${host}/${row.short_id}`
    )
    .replace(/\{\{FILE_SIZE\}\}/g, formatFileSize(row.file_size_bytes));

  res.type("html").send(template);
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default router;
