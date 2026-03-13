import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { getDb } from "../db/connection";

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
const router = Router();

router.get("/:shortID", (req: Request, res: Response): void => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM videos WHERE short_id = ?")
    .get(req.params.shortID) as any;

  if (!row) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const filePath = path.join(UPLOADS_DIR, row.stored_filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Video file missing from storage" });
    return;
  }

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": row.mime_type,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": row.mime_type,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

export default router;
