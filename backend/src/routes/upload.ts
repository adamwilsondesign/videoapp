import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getDb } from "../db/connection";
import { generateBase62Id } from "../utils/base62";

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

router.post("/", upload.single("video"), (req: Request, res: Response): void => {
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
  const newPath = path.join(UPLOADS_DIR, storedFilename);

  fs.renameSync(req.file.path, newPath);

  const uploadTimestamp = new Date().toISOString();

  db.prepare(`
    INSERT INTO videos (short_id, original_filename, stored_filename, mime_type, file_size_bytes, upload_timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    shortId,
    req.file.originalname,
    storedFilename,
    req.file.mimetype,
    req.file.size,
    uploadTimestamp
  );

  const host = (req.get("host") as string) || "localhost:3000";
  const protocol = req.protocol;

  res.json({
    shortID: shortId,
    verifyURL: `${protocol}://${host}/${shortId}`,
    uploadTimestamp,
  });
});

export default router;
