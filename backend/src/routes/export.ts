import { Router, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { execFile, execFileSync } from "child_process";
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

// Clear stale exports on startup to force regeneration with correct codecs
try {
  const existingExports = fs.readdirSync(EXPORTS_DIR);
  for (const file of existingExports) {
    if (file.startsWith("export_") && file.endsWith(".mp4")) {
      fs.unlinkSync(path.join(EXPORTS_DIR, file));
      console.log(`[export] Cleared stale export: ${file}`);
    }
  }
} catch (err) {
  console.warn("[export] Could not clear exports directory:", err);
}

// ============ STARTUP VALIDATION ============

// Check font files exist
const fontsAvailable = fs.existsSync(FONT_BOLD) && fs.existsSync(FONT_REGULAR);
console.log(`[export] Font Bold: ${fs.existsSync(FONT_BOLD) ? "OK" : "MISSING"} (${FONT_BOLD})`);
console.log(`[export] Font Regular: ${fs.existsSync(FONT_REGULAR) ? "OK" : "MISSING"} (${FONT_REGULAR})`);

// Check if drawtext filter is available in the ffmpeg binary
let drawtextAvailable = false;
try {
  const filtersOutput = execFileSync(ffmpegStatic as string, ["-filters"], {
    timeout: 5000,
    encoding: "utf-8",
  });
  drawtextAvailable = filtersOutput.includes("drawtext");
  console.log(`[export] FFmpeg drawtext filter: ${drawtextAvailable ? "available" : "NOT available"}`);
} catch (e: any) {
  // -filters might exit non-zero on some builds; check stdout+stderr
  const combined = (e.stdout || "") + (e.stderr || "");
  drawtextAvailable = combined.includes("drawtext");
  console.log(`[export] FFmpeg drawtext filter: ${drawtextAvailable ? "available" : "NOT available"} (checked via error output)`);
}

const canUseOverlays = fontsAvailable && drawtextAvailable;
console.log(`[export] Overlay mode: ${canUseOverlays ? "FULL (watermarks + strip)" : "FALLBACK (re-encode only)"}`);

// Track exports currently being generated to prevent duplicate work
const exportsInProgress = new Set<string>();

// ============ HELPERS ============

interface VideoInfo {
  width: number;
  height: number;
  hasAudio: boolean;
  audioCodec: string | null;
  videoCodec: string | null;
}

/** Probe video dimensions and codec info using ffmpeg -i (no ffprobe dependency) */
async function probeVideo(filePath: string): Promise<VideoInfo> {
  const ffmpegPath = ffmpegStatic as string;

  try {
    // ffmpeg -i with no output always exits with code 1, printing info to stderr
    await execFileAsync(ffmpegPath, ["-i", filePath], {
      timeout: 10000,
    });
  } catch (err: any) {
    // ffmpeg -i with no real output always exits with code 1; parse stderr
    const stderr: string = err.stderr || "";

    const videoMatch = stderr.match(
      /Stream\s+#\d+:\d+.*Video:\s+(\w+).*?(\d{2,5})x(\d{2,5})/
    );
    const audioMatch = stderr.match(
      /Stream\s+#\d+:\d+.*Audio:\s+(\w+)/
    );

    if (!videoMatch) {
      throw new Error("Could not detect video stream dimensions");
    }

    return {
      width: parseInt(videoMatch[2], 10),
      height: parseInt(videoMatch[3], 10),
      hasAudio: !!audioMatch,
      audioCodec: audioMatch ? audioMatch[1] : null,
      videoCodec: videoMatch[1],
    };
  }

  throw new Error("Unexpected: ffmpeg -i did not produce stderr output");
}

/** Escape special characters for FFmpeg drawtext filter text option */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\") // \ -> \\
    .replace(/:/g, "\\:")   // : -> \:
    .replace(/'/g, "\\'")   // ' -> \'
    .replace(/;/g, "\\;");  // ; -> \;
}

/** Escape a file path for FFmpeg filter option (colons need escaping) */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/** Run FFmpeg export with given filters and output options. Returns the output path on success. */
function runFfmpeg(
  inputPath: string,
  outputPath: string,
  filters: Array<{ filter: string; options: Record<string, string> }>,
  outputOpts: string[],
  shortID: string,
  label: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let cmd = ffmpeg(inputPath);

    if (filters.length > 0) {
      cmd = cmd.videoFilters(filters);
    }

    cmd
      .outputOptions(outputOpts)
      .output(outputPath)
      .on("start", (cmdline: string) => {
        console.log(`[export] FFmpeg ${label} started for ${shortID}`);
        console.log(`[export] Command: ${cmdline}`);
      })
      .on("end", () => {
        console.log(`[export] FFmpeg ${label} complete for ${shortID}`);
        resolve();
      })
      .on("error", (err: Error) => {
        console.error(`[export] FFmpeg ${label} failed for ${shortID}:`, err.message);
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
  const exportFilename = `export_${row.short_id}.mp4`;
  const outputPath = path.join(EXPORTS_DIR, exportFilename);

  if (!fs.existsSync(inputPath)) {
    res.status(404).json({ error: "Original video file missing" });
    return;
  }

  // Serve cached export if it exists, is newer than source, and is non-empty
  if (fs.existsSync(outputPath)) {
    const srcStat = fs.statSync(inputPath);
    const expStat = fs.statSync(outputPath);
    if (expStat.mtimeMs > srcStat.mtimeMs && expStat.size > 0) {
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Length", expStat.size);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="allybi_${row.short_id}.mp4"`
      );
      fs.createReadStream(outputPath).pipe(res);
      return;
    }
    // Stale or empty — delete and regenerate
    try { fs.unlinkSync(outputPath); } catch {}
  }

  // Prevent duplicate concurrent generation
  if (exportsInProgress.has(shortID)) {
    res.status(202).json({ status: "generating", message: "Export is being generated, please retry in a few seconds" });
    return;
  }
  exportsInProgress.add(shortID);

  // Probe the input video
  let videoInfo: VideoInfo;
  try {
    videoInfo = await probeVideo(inputPath);
    console.log(
      `[export] Probed ${row.short_id}: ${videoInfo.width}x${videoInfo.height}, ` +
      `video=${videoInfo.videoCodec}, audio=${videoInfo.audioCodec}`
    );
  } catch (probeErr: any) {
    exportsInProgress.delete(shortID);
    console.error(`[export] Probe failed for ${row.short_id}:`, probeErr.message);
    res.status(500).json({ error: "Failed to analyze video: " + probeErr.message });
    return;
  }

  // Standard output options for universal playback
  const baseOutputOpts = [
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
  ];

  // Build overlay filters (only if fonts + drawtext available)
  const overlayFilters: Array<{ filter: string; options: Record<string, string> }> = [];

  if (canUseOverlays) {
    // Build strip text — use simple ASCII bullet to avoid encoding issues
    const rawStripText = `A - Allybi Verified  |  allybi.ai/${row.short_id}`;
    const stripText = escapeDrawtext(rawStripText);

    // Build repeating watermark text
    const wmUnit = `Allybi  ${row.short_id}`;
    const wmLine = escapeDrawtext(Array(5).fill(wmUnit).join("          "));

    // Generate watermark rows staggered across the video
    const wmRows = 5;
    for (let r = 0; r < wmRows; r++) {
      const yFrac = (0.08 + r * 0.19).toFixed(2);
      const xOffset = r % 2 === 0 ? "0" : "(w*0.12)";
      overlayFilters.push({
        filter: "drawtext",
        options: {
          fontfile: escapeFilterPath(FONT_REGULAR),
          text: wmLine,
          fontsize: "(h*0.022)",
          fontcolor: "white@0.10",
          x: xOffset,
          y: `(h*${yFrac})`,
        },
      });
    }

    // Strip height: 7% of frame height
    const stripH = "0.07";

    // Full-width dark strip at bottom
    overlayFilters.push({
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

    // Centered white text on the strip
    overlayFilters.push({
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
  }

  try {
    let exportSucceeded = false;

    // STAGE 1: Try full export with overlays (if available)
    if (overlayFilters.length > 0) {
      try {
        await runFfmpeg(inputPath, outputPath, overlayFilters, baseOutputOpts, row.short_id, "full");
        exportSucceeded = true;
      } catch (fullErr: any) {
        console.error(`[export] Full export failed, trying fallback. Error: ${fullErr.message}`);
        // Clean up failed output
        try { fs.unlinkSync(outputPath); } catch {}
      }
    }

    // STAGE 2: Fallback — re-encode without any overlays
    if (!exportSucceeded) {
      console.log(`[export] Using fallback (plain re-encode) for ${row.short_id}`);
      await runFfmpeg(inputPath, outputPath, [], baseOutputOpts, row.short_id, "fallback");
    }

    // Verify the output file is valid
    const stat = fs.statSync(outputPath);
    if (stat.size === 0) {
      throw new Error("Export produced an empty file");
    }

    console.log(`[export] Serving ${row.short_id} (${(stat.size / 1024).toFixed(0)} KB)`);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="allybi_${row.short_id}.mp4"`
    );
    fs.createReadStream(outputPath).pipe(res);
  } catch (err: any) {
    console.error("[export] Generation failed completely:", err.message);
    // Clean up partial file
    try { fs.unlinkSync(outputPath); } catch {}
    res.status(500).json({ error: "Failed to generate export video: " + err.message });
  } finally {
    exportsInProgress.delete(shortID);
  }
});

export default router;
