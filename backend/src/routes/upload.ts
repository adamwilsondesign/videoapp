import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getDb } from "../db/connection";
import { generateBase62Id } from "../utils/base62";
import { generateBrandedVideo, hasOverlayFilter } from "../utils/branding";

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    cb(null, `tmp_${Date.now()}_${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Accept video/* MIME types and common browser-recorded types
    if (
      file.mimetype.startsWith("video/") ||
      file.mimetype === "application/octet-stream"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are accepted"));
    }
  },
});

const router = Router();

router.post("/", upload.single("video"), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const db = getDb();

    let shortId: string;
    do {
      shortId = generateBase62Id();
    } while (db.prepare("SELECT 1 FROM videos WHERE short_id = ?").get(shortId));

    const storedFilename = `${shortId}.mp4`;
    const brandedPath = path.join(UPLOADS_DIR, storedFilename);
    const tmpPath = req.file.path;

    // Brand the video with watermark + verification strip
    try {
      if (hasOverlayFilter) {
        await generateBrandedVideo(tmpPath, brandedPath, shortId);
        // Branding succeeded — delete the temp original
        try { fs.unlinkSync(tmpPath); } catch {}
        console.log(`[upload] Branded video saved for ${shortId}`);
      } else {
        // Overlay filter not available — save original as-is
        fs.renameSync(tmpPath, brandedPath);
        console.warn(`[upload] No overlay filter — saved unbranded for ${shortId}`);
      }
    } catch (err: any) {
      console.error(`[upload] Branding failed for ${shortId}: ${err.message}`);
      // Fallback: keep original unbranded video rather than losing the upload
      if (!fs.existsSync(brandedPath)) {
        fs.renameSync(tmpPath, brandedPath);
      }
      // Clean up temp if it still exists and branded file was partially written
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }

    // Use the branded file's size (may differ from upload size after re-encode)
    const stat = fs.statSync(brandedPath);
    const uploadTimestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO videos (short_id, original_filename, stored_filename, mime_type, file_size_bytes, upload_timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      shortId,
      req.file.originalname,
      storedFilename,
      "video/mp4",   // Always MP4 after FFmpeg re-encode
      stat.size,
      uploadTimestamp
    );

    const host = (req.get("host") as string) || "localhost:3000";
    const protocol = req.protocol;

    res.json({
      shortID: shortId,
      verifyURL: `${protocol}://${host}/${shortId}`,
      uploadTimestamp,
    });
  } catch (err: any) {
    console.error(`[upload] Unexpected error:`, err.message);
    res.status(500).json({ error: "Upload failed: " + err.message });
  }
});

export default router;
