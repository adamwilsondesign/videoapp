/**
 * Video branding pipeline — overlays watermark + verification strip onto video.
 *
 * Uses sharp (SVG → PNG) to generate a transparent overlay image, then
 * FFmpeg's `overlay` filter to composite it onto the video. This approach
 * works on ALL FFmpeg builds, unlike `drawtext` which requires libfreetype.
 */
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

ffmpeg.setFfmpegPath(ffmpegStatic as string);

// ============ STARTUP: detect FFmpeg capabilities ============

export const hasOverlayFilter: boolean = (() => {
  try {
    const out = execFileSync(ffmpegStatic as string, ["-filters"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    return out.includes("overlay");
  } catch (e: any) {
    return ((e.stdout || "") + (e.stderr || "")).includes("overlay");
  }
})();

console.log(`[branding] overlay filter=${hasOverlayFilter}`);

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
export function probeVideo(inputPath: string): { width: number; height: number } {
  try {
    execFileSync(ffmpegStatic as string, ["-i", inputPath], {
      encoding: "utf-8",
      timeout: 10000,
    });
  } catch (e: any) {
    const stderr: string = e.stderr || "";
    const match = stderr.match(/Stream.*Video.*?(\d{2,5})x(\d{2,5})/);
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
  }
  return { width: 1280, height: 720 };
}

/**
 * Generate a transparent PNG overlay with:
 *  - Semi-transparent watermark text rows across the frame
 *  - Dark strip at the bottom with the verification text
 */
async function generateOverlayPng(
  width: number,
  height: number,
  shortID: string,
  outputPath: string,
): Promise<void> {
  const stripH = Math.round(height * 0.07);
  const stripY = height - stripH;
  const fontSize = Math.max(10, Math.round(height * 0.018));
  // Monospace char width ≈ 0.6 × font-size
  const charW = (sz: number) => sz * 0.6;

  // --- Watermark rows ---
  const wmUnit = `Allybi  ${shortID}`;
  const wmLine = Array(4).fill(wmUnit).join("     ");

  let watermarkRows = "";
  for (let r = 0; r < 6; r++) {
    const yPos = Math.round(height * (0.08 + r * 0.16));
    const xOffset = r % 2 === 0 ? 0 : Math.round(width * 0.08);
    // Manually centre: x = (width - textWidth) / 2 + offset
    const approxTextW = wmLine.length * charW(fontSize);
    const xPos = Math.round(Math.max(0, (width - approxTextW) / 2) + xOffset);
    watermarkRows += `    <text x="${xPos}" y="${yPos}" font-family="'Courier New', Courier, monospace" font-size="${fontSize}" fill="white" fill-opacity="0.35">${escapeXml(wmLine)}</text>\n`;
  }

  // --- Bottom verification strip ---
  const stripText = `Allybi Verified  |  ${shortID}`;
  // Scale strip font to fit within 90% of video width
  const maxStripW = width * 0.9;
  let stripFontSize = Math.max(11, Math.round(height * 0.022));
  while (stripText.length * charW(stripFontSize) > maxStripW && stripFontSize > 10) {
    stripFontSize--;
  }
  const stripTextW = stripText.length * charW(stripFontSize);
  const stripTextX = Math.round((width - stripTextW) / 2);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
${watermarkRows}
    <rect x="0" y="${stripY}" width="${width}" height="${stripH}" fill="black" fill-opacity="0.75"/>
    <text x="${stripTextX}" y="${Math.round(stripY + stripH / 2 + stripFontSize * 0.35)}" font-family="'Courier New', Courier, monospace" font-weight="bold" font-size="${stripFontSize}" fill="white">${escapeXml(stripText)}</text>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

/**
 * Re-render a video with the Allybi watermark and verification strip.
 *
 * Pipeline:
 *  1. Probe video for dimensions
 *  2. Generate transparent overlay PNG via sharp
 *  3. Composite overlay onto video with FFmpeg overlay filter + libx264 ultrafast
 *  4. Clean up temp overlay PNG
 *
 * @param inputPath  Path to the original (unbranded) video
 * @param outputPath Path where the branded video should be written
 * @param shortID    The verification ID to embed
 * @returns          The outputPath on success
 */
export async function generateBrandedVideo(
  inputPath: string,
  outputPath: string,
  shortID: string,
): Promise<string> {
  console.log(`[branding] Starting branded encode for ${shortID}`);

  const { width, height } = probeVideo(inputPath);
  console.log(`[branding] Video dimensions: ${width}x${height}`);

  // Write overlay PNG next to the output file (same filesystem, avoids cross-device issues)
  const overlayPath = outputPath.replace(/\.mp4$/i, "_overlay.png");
  await generateOverlayPng(width, height, shortID, overlayPath);
  console.log(`[branding] Overlay PNG generated`);

  return new Promise<string>((resolve, reject) => {
    ffmpeg(inputPath)
      .input(overlayPath)
      .complexFilter("[0:v][1:v]overlay=0:0[vout]")
      .outputOptions([
        "-map", "[vout]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
      ])
      .output(outputPath)
      .on("start", (cmd: string) => console.log(`[branding] Cmd: ${cmd}`))
      .on("end", () => {
        console.log(`[branding] Done for ${shortID}`);
        try { fs.unlinkSync(overlayPath); } catch {}
        resolve(outputPath);
      })
      .on("error", (err: Error) => {
        console.error(`[branding] Failed for ${shortID}: ${err.message}`);
        try { fs.unlinkSync(overlayPath); } catch {}
        reject(err);
      })
      .run();
  });
}
