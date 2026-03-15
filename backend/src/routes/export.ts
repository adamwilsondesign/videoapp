import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { getDb } from "../db/connection";

const execFileAsync = promisify(execFile);

ffmpeg.setFfmpegPath(ffmpegStatic as string);

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
const EXPORTS_DIR = path.resolve(__dirname, "../../exports");
const FONT_BOLD = path.resolve(__dirname, "../../fonts/IBMPlexMono-Bold.ttf");
const FONT_REGULAR = path.resolve(__dirname, "../../fonts/IBMPlexMono-Regular.ttf");

if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// Log font availability at startup
console.log(`[export] Font Bold: ${fs.existsSync(FONT_BOLD) ? "OK" : "MISSING"}`);
console.log(`[export] Font Regular: ${fs.existsSync(FONT_REGULAR) ? "OK" : "MISSING"}`);

// If another request is already generating the same export, store
// the promise so subsequent requests can wait for it instead of
// returning 202 JSON (which breaks direct browser navigation).
const pendingExports = new Map<string, Promise<string>>();

// ============ HELPERS ============

/** Escape special characters for FFmpeg drawtext filter text option */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/;/g, "\\;");
}

/** Escape a file path for FFmpeg filter option */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/** Serve a file as an MP4 download */
function serveExport(filePath: string, shortID: string, res: Response): void {
  const stat = fs.statSync(filePath);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", stat.size);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="allybi_${shortID}.mp4"`
  );
  fs.createReadStream(filePath).pipe(res);
}

/** Generate the export MP4 — tries overlays first, then plain re-encode */
async function generateExport(
  inputPath: string,
  outputPath: string,
  shortID: string
): Promise<string> {
  const fontsExist = fs.existsSync(FONT_BOLD) && fs.existsSync(FONT_REGULAR);

  const baseOutputOpts = [
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
  ];

  // STAGE 1: Try with branded overlays
  if (fontsExist) {
    try {
      await runFfmpegWithOverlays(inputPath, outputPath, shortID, baseOutputOpts);
      const stat = fs.statSync(outputPath);
      if (stat.size > 0) {
        console.log(`[export] Full export OK for ${shortID} (${(stat.size / 1024).toFixed(0)} KB)`);
        return outputPath;
      }
    } catch (err: any) {
      console.error(`[export] Full export failed for ${shortID}: ${err.message}`);
      try { fs.unlinkSync(outputPath); } catch {}
    }
  }

  // STAGE 2: Fallback — plain re-encode (no overlays)
  console.log(`[export] Using plain re-encode for ${shortID}`);
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(baseOutputOpts)
      .output(outputPath)
      .on("start", (cmd: string) => console.log(`[export] Fallback cmd: ${cmd}`))
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });

  const stat = fs.statSync(outputPath);
  if (stat.size === 0) throw new Error("Export produced empty file");
  console.log(`[export] Fallback export OK for ${shortID} (${(stat.size / 1024).toFixed(0)} KB)`);
  return outputPath;
}

/** Run FFmpeg with branded watermark overlays and verification strip */
async function runFfmpegWithOverlays(
  inputPath: string,
  outputPath: string,
  shortID: string,
  outputOpts: string[]
): Promise<void> {
  const rawStripText = `A - Allybi Verified  |  allybi.ai/${shortID}`;
  const stripText = escapeDrawtext(rawStripText);
  const wmUnit = `Allybi  ${shortID}`;
  const wmLine = escapeDrawtext(Array(5).fill(wmUnit).join("          "));
  const stripH = "0.07";

  const filters: Array<{ filter: string; options: Record<string, string> }> = [];

  // Watermark rows
  for (let r = 0; r < 5; r++) {
    const yFrac = (0.08 + r * 0.19).toFixed(2);
    filters.push({
      filter: "drawtext",
      options: {
        fontfile: escapeFilterPath(FONT_REGULAR),
        text: wmLine,
        fontsize: "(h*0.022)",
        fontcolor: "white@0.10",
        x: r % 2 === 0 ? "0" : "(w*0.12)",
        y: `(h*${yFrac})`,
      },
    });
  }

  // Dark strip at bottom
  filters.push({
    filter: "drawbox",
    options: {
      x: "0",
      y: `ih-ih*${stripH}`,
      w: "iw",
      h: `ih*${stripH}`,
      color: "black@0.7",
      t: "fill",
    },
  });

  // Strip text
  filters.push({
    filter: "drawtext",
    options: {
      fontfile: escapeFilterPath(FONT_BOLD),
      text: stripText,
      fontsize: "(h*0.024)",
      fontcolor: "white",
      x: "(w-text_w)/2",
      y: `(h-h*${stripH})+((h*${stripH}-text_h)/2)`,
    },
  });

  return new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(filters)
      .outputOptions(outputOpts)
      .output(outputPath)
      .on("start", (cmd: string) => console.log(`[export] Full cmd: ${cmd}`))
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

// ============ ROUTER ============

const router = Router();

router.get("/:shortID", async (req: Request, res: Response): Promise<void> => {
  const shortID = req.params.shortID as string;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM videos WHERE short_id = ?")
    .get(shortID) as any;

  if (!row) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const inputPath = path.join(UPLOADS_DIR, row.stored_filename);
  const exportFilename = `export_${shortID}.mp4`;
  const outputPath = path.join(EXPORTS_DIR, exportFilename);

  if (!fs.existsSync(inputPath)) {
    res.status(404).json({ error: "Original video file missing" });
    return;
  }

  // Serve from cache if valid
  if (fs.existsSync(outputPath)) {
    const srcStat = fs.statSync(inputPath);
    const expStat = fs.statSync(outputPath);
    if (expStat.mtimeMs > srcStat.mtimeMs && expStat.size > 0) {
      serveExport(outputPath, shortID, res);
      return;
    }
    try { fs.unlinkSync(outputPath); } catch {}
  }

  // If another request is already generating this export, wait for it
  if (pendingExports.has(shortID)) {
    try {
      await pendingExports.get(shortID);
      if (fs.existsSync(outputPath)) {
        serveExport(outputPath, shortID, res);
        return;
      }
    } catch {
      // Previous attempt failed; we'll try again below
    }
  }

  // Generate the export
  const exportPromise = generateExport(inputPath, outputPath, shortID);
  pendingExports.set(shortID, exportPromise);

  try {
    await exportPromise;
    serveExport(outputPath, shortID, res);
  } catch (err: any) {
    console.error(`[export] Failed for ${shortID}:`, err.message);
    try { fs.unlinkSync(outputPath); } catch {}
    res.status(500).json({ error: "Export failed: " + err.message });
  } finally {
    pendingExports.delete(shortID);
  }
});

export default router;
