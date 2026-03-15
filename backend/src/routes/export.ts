/**
 * Export route — serves the branded video as a downloadable file.
 *
 * Since branding is now applied at upload time, this route simply
 * streams the already-branded file with Content-Disposition: attachment.
 */
import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { getDb } from "../db/connection";

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

// Clean up legacy exports directory if it exists
const LEGACY_EXPORTS = path.resolve(__dirname, "../../exports");
try {
  if (fs.existsSync(LEGACY_EXPORTS)) {
    fs.rmSync(LEGACY_EXPORTS, { recursive: true, force: true });
    console.log("[export] Removed legacy exports/ directory");
  }
} catch {}

const router = Router();

router.get("/:shortID", (req: Request, res: Response): void => {
  const shortID = req.params.shortID as string;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM videos WHERE short_id = ?")
    .get(shortID) as any;

  if (!row) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const filePath = path.join(UPLOADS_DIR, row.stored_filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Video file missing" });
    return;
  }

  const stat = fs.statSync(filePath);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="allybi_${shortID}.mp4"`);
  fs.createReadStream(filePath).pipe(res);
});

export default router;
