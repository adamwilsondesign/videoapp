import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { getDb } from "../db/connection";

ffmpeg.setFfmpegPath(ffmpegStatic as string);

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
const EXPORTS_DIR = path.resolve(__dirname, "../../exports");
const FONT_BOLD = path.resolve(__dirname, "../../fonts/IBMPlexMono-Bold.ttf");
const FONT_REGULAR = path.resolve(__dirname, "../../fonts/IBMPlexMono-Regular.ttf");

if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// ============ STARTUP: detect capabilities once ============

const fontsExist = fs.existsSync(FONT_BOLD) && fs.existsSync(FONT_REGULAR);

let hasDrawtext = false;
try {
  const out = execFileSync(ffmpegStatic as string, ["-filters"], {
    encoding: "utf-8", timeout: 5000,
  });
  hasDrawtext = out.includes("drawtext");
} catch (e: any) {
  hasDrawtext = ((e.stdout || "") + (e.stderr || "")).includes("drawtext");
}

const useOverlays = fontsExist && hasDrawtext;
console.log(`[export] drawtext=${hasDrawtext}, fonts=${fontsExist} → mode: ${useOverlays ? "OVERLAYS" : "FAST COPY"}`);

// Concurrent export tracking
const pendingExports = new Map<string, Promise<string>>();

// ============ HELPERS ============

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/;/g, "\\;");
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function serveExport(filePath: string, shortID: string, res: Response): void {
  const stat = fs.statSync(filePath);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="allybi_${shortID}.mp4"`);
  fs.createReadStream(filePath).pipe(res);
}

// ============ EXPORT GENERATORS ============

/**
 * FAST PATH: Copy video stream as-is, only transcode audio to AAC.
 * Completes in ~1-2 seconds even on slow servers.
 * Used when drawtext filter is not available.
 */
function generateFastExport(inputPath: string, outputPath: string, shortID: string): Promise<string> {
  console.log(`[export] Fast copy for ${shortID}`);
  return new Promise<string>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v", "copy",        // Copy video stream — no re-encoding
        "-c:a", "aac",         // Transcode audio to AAC for compatibility
        "-b:a", "128k",
        "-movflags", "+faststart",
      ])
      .output(outputPath)
      .on("start", (cmd: string) => console.log(`[export] Cmd: ${cmd}`))
      .on("end", () => {
        console.log(`[export] Fast copy done for ${shortID}`);
        resolve(outputPath);
      })
      .on("error", (err: Error) => {
        console.error(`[export] Fast copy failed for ${shortID}: ${err.message}`);
        reject(err);
      })
      .run();
  });
}

/**
 * FULL PATH: Re-encode with branded watermark overlays + verification strip.
 * Requires drawtext filter and fonts. Uses ultrafast preset to minimize time.
 */
function generateFullExport(inputPath: string, outputPath: string, shortID: string): Promise<string> {
  console.log(`[export] Full overlay export for ${shortID}`);

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
      x: "0", y: `ih-ih*${stripH}`, w: "iw", h: `ih*${stripH}`,
      color: "black@0.7", t: "fill",
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

  return new Promise<string>((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(filters)
      .outputOptions([
        "-c:v", "libx264",
        "-preset", "ultrafast",   // Fastest encode to beat Render's 30s timeout
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
      ])
      .output(outputPath)
      .on("start", (cmd: string) => console.log(`[export] Cmd: ${cmd}`))
      .on("end", () => {
        console.log(`[export] Full export done for ${shortID}`);
        resolve(outputPath);
      })
      .on("error", (err: Error) => {
        console.error(`[export] Full export failed for ${shortID}: ${err.message}`);
        reject(err);
      })
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
      // Previous attempt failed; fall through to try again
    }
  }

  // Generate the export
  const generate = useOverlays
    ? generateFullExport(inputPath, outputPath, shortID)
    : generateFastExport(inputPath, outputPath, shortID);

  pendingExports.set(shortID, generate);

  try {
    await generate;

    const stat = fs.statSync(outputPath);
    if (stat.size === 0) throw new Error("Export produced empty file");

    serveExport(outputPath, shortID, res);
  } catch (err: any) {
    console.error(`[export] Failed for ${shortID}:`, err.message);
    try { fs.unlinkSync(outputPath); } catch {}

    // Last resort: if even fast copy failed, try serving the original file directly
    if (!useOverlays) {
      console.log(`[export] Serving original file as last resort for ${shortID}`);
      try {
        const origStat = fs.statSync(inputPath);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Length", origStat.size);
        res.setHeader("Content-Disposition", `attachment; filename="allybi_${shortID}.mp4"`);
        fs.createReadStream(inputPath).pipe(res);
        return;
      } catch {}
    }

    res.status(500).json({ error: "Export failed: " + err.message });
  } finally {
    pendingExports.delete(shortID);
  }
});

export default router;
