import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { getDb } from "../db/connection";

ffmpeg.setFfmpegPath(ffmpegStatic as string);

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
const EXPORTS_DIR = path.resolve(__dirname, "../../exports");

if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

const router = Router();

router.get("/:shortID", async (req: Request, res: Response): Promise<void> => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM videos WHERE short_id = ?")
    .get(req.params.shortID) as any;

  if (!row) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const inputPath = path.join(UPLOADS_DIR, row.stored_filename);
  const exportFilename = `export_${row.short_id}.mp4`;
  const outputPath = path.join(EXPORTS_DIR, exportFilename);

  if (!fs.existsSync(inputPath)) {
    res.status(404).json({ error: "Original video file missing" });
    return;
  }

  // If export already exists, serve it directly
  if (fs.existsSync(outputPath)) {
    res.download(outputPath, `allybi_${row.short_id}.mp4`);
    return;
  }

  // Build the drawtext string with bullet character
  const stripText = `A \\xE2\\x80\\xA2 Allybi Verified  |  allybi.ai/${row.short_id}`;

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters([
          // 1. Draw full-width semi-transparent black strip at bottom
          {
            filter: "drawbox",
            options: {
              x: "0",
              y: "ih-ih*0.06",
              w: "iw",
              h: "ih*0.06",
              color: "black@0.7",
              t: "fill",
            },
          },
          // 2. Draw centered white text on top of the strip
          {
            filter: "drawtext",
            options: {
              text: stripText,
              fontsize: "(h*0.024)",
              fontcolor: "white",
              x: "(w-text_w)/2",
              y: "h-h*0.038",
            },
          },
        ])
        .outputOptions(["-c:a", "copy", "-movflags", "+faststart"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err: Error) => reject(err))
        .run();
    });

    res.download(outputPath, `allybi_${row.short_id}.mp4`);
  } catch (err: any) {
    console.error("Export generation failed:", err.message);
    // Clean up partial file
    try { fs.unlinkSync(outputPath); } catch {}
    res.status(500).json({ error: "Failed to generate export video" });
  }
});

export default router;
