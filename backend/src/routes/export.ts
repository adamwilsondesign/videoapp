import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import { getDb } from "../db/connection";

ffmpeg.setFfmpegPath(ffmpegStatic as string);

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
const EXPORTS_DIR = path.resolve(__dirname, "../../exports");

if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// ============ STARTUP ============

// Clear stale cached exports so they regenerate with the branded overlay
try {
  const stale = fs.readdirSync(EXPORTS_DIR).filter(f => f.startsWith("export_") && f.endsWith(".mp4"));
  for (const f of stale) fs.unlinkSync(path.join(EXPORTS_DIR, f));
  if (stale.length) console.log(`[export] Cleared ${stale.length} stale cached export(s)`);
} catch {}

// Check which FFmpeg filters are available
let hasOverlayFilter = false;
try {
  const out = execFileSync(ffmpegStatic as string, ["-filters"], {
    encoding: "utf-8", timeout: 5000,
  });
  hasOverlayFilter = out.includes("overlay");
} catch (e: any) {
  hasOverlayFilter = ((e.stdout || "") + (e.stderr || "")).includes("overlay");
}

console.log(`[export] overlay filter=${hasOverlayFilter} → mode: ${hasOverlayFilter ? "BRANDED OVERLAY" : "FAST COPY"}`);

// Concurrent export tracking
const pendingExports = new Map<string, Promise<string>>();

// ============ HELPERS ============

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Probe video dimensions by parsing `ffmpeg -i` stderr output.
 * No ffprobe binary needed.
 */
function probeVideo(inputPath: string): { width: number; height: number } {
  try {
    execFileSync(ffmpegStatic as string, ["-i", inputPath], {
      encoding: "utf-8",
      timeout: 10000,
    });
  } catch (e: any) {
    // ffmpeg -i always exits with code 1 when no output specified — that's expected
    const stderr: string = e.stderr || "";
    const match = stderr.match(/Stream.*Video.*?(\d{2,5})x(\d{2,5})/);
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
  }
  // Fallback: assume 1280x720 (common webcam resolution)
  return { width: 1280, height: 720 };
}

/**
 * Generate a transparent PNG overlay with:
 *  - Semi-transparent watermark text rows across the frame
 *  - Dark strip at the bottom with the verification text
 *
 * Uses SVG → PNG via sharp. No FFmpeg drawtext filter needed.
 */
async function generateOverlayPng(
  width: number,
  height: number,
  shortID: string,
  outputPath: string,
): Promise<void> {
  const stripH = Math.round(height * 0.07);
  const stripY = height - stripH;
  const fontSize = Math.max(10, Math.round(height * 0.02));
  // Ensure strip text fits within video width
  const stripFontSize = Math.max(11, Math.round(Math.min(height * 0.022, width * 0.015)));

  const wmUnit = `Allybi  ${shortID}`;
  const wmLine = Array(4).fill(wmUnit).join("     ");
  const stripText = `A - Allybi Verified  |  allybi.ai/${shortID}`;

  // Build watermark rows (5 staggered rows, centered, semi-transparent)
  let watermarkRows = "";
  for (let r = 0; r < 5; r++) {
    const yPos = Math.round(height * (0.10 + r * 0.18));
    const xOffset = r % 2 === 0 ? 0 : Math.round(width * 0.08);
    watermarkRows += `    <text x="${Math.round(width / 2 + xOffset)}" y="${yPos}" text-anchor="middle" font-family="'Courier New', Courier, monospace" font-size="${fontSize}" fill="white" fill-opacity="0.18">${escapeXml(wmLine)}</text>\n`;
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
${watermarkRows}
    <rect x="0" y="${stripY}" width="${width}" height="${stripH}" fill="black" fill-opacity="0.7"/>
    <text x="${Math.round(width / 2)}" y="${Math.round(stripY + stripH / 2 + stripFontSize * 0.35)}" font-family="'Courier New', Courier, monospace" font-weight="bold" font-size="${stripFontSize}" fill="white" text-anchor="middle">${escapeXml(stripText)}</text>
</svg>`;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(outputPath);
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
 * No watermark or verification strip — used only as a last-resort fallback.
 */
function generateFastExport(inputPath: string, outputPath: string, shortID: string): Promise<string> {
  console.log(`[export] Fast copy (no overlay) for ${shortID}`);
  return new Promise<string>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-c:v", "copy",
        "-c:a", "aac",
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
 * BRANDED PATH: Generate overlay PNG with sharp, then composite onto video
 * using FFmpeg's `overlay` filter (available in ALL FFmpeg builds, unlike drawtext).
 *
 * Steps:
 *  1. Probe video dimensions
 *  2. Render SVG overlay → PNG via sharp
 *  3. FFmpeg: [video] + [overlay.png] → overlay=0:0 → libx264 ultrafast → output
 */
async function generateBrandedExport(inputPath: string, outputPath: string, shortID: string): Promise<string> {
  console.log(`[export] Branded overlay export for ${shortID}`);

  // 1. Probe video dimensions
  const { width, height } = probeVideo(inputPath);
  console.log(`[export] Video dimensions: ${width}x${height}`);

  // 2. Generate overlay PNG
  const overlayPath = path.join(EXPORTS_DIR, `overlay_${shortID}.png`);
  await generateOverlayPng(width, height, shortID, overlayPath);
  console.log(`[export] Overlay PNG generated for ${shortID}`);

  // 3. Composite with FFmpeg
  return new Promise<string>((resolve, reject) => {
    ffmpeg(inputPath)
      .input(overlayPath)
      .complexFilter("[0:v][1:v]overlay=0:0[vout]")
      .outputOptions([
        "-map", "[vout]",
        "-map", "0:a?",           // include audio if present (? = optional)
        "-c:v", "libx264",
        "-preset", "ultrafast",   // fastest encoding to stay within Render's 30s timeout
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
      ])
      .output(outputPath)
      .on("start", (cmd: string) => console.log(`[export] Cmd: ${cmd}`))
      .on("end", () => {
        console.log(`[export] Branded export done for ${shortID}`);
        try { fs.unlinkSync(overlayPath); } catch {}
        resolve(outputPath);
      })
      .on("error", (err: Error) => {
        console.error(`[export] Branded export failed for ${shortID}: ${err.message}`);
        try { fs.unlinkSync(overlayPath); } catch {}
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

  // Generate the export — try branded overlay, fall back to fast copy if overlay fails
  const generate = hasOverlayFilter
    ? generateBrandedExport(inputPath, outputPath, shortID).catch((brandedErr) => {
        console.warn(`[export] Branded overlay failed, falling back to fast copy: ${brandedErr.message}`);
        try { fs.unlinkSync(outputPath); } catch {}
        return generateFastExport(inputPath, outputPath, shortID);
      })
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

    // Last resort: serve original file directly
    console.log(`[export] Serving original file as last resort for ${shortID}`);
    try {
      const origStat = fs.statSync(inputPath);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", origStat.size);
      res.setHeader("Content-Disposition", `attachment; filename="allybi_${shortID}.mp4"`);
      fs.createReadStream(inputPath).pipe(res);
      return;
    } catch {}

    res.status(500).json({ error: "Export failed: " + err.message });
  } finally {
    pendingExports.delete(shortID);
  }
});

export default router;
