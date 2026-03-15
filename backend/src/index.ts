import express from "express";
import cors from "cors";
import os from "os";
import path from "path";
import uploadRouter from "./routes/upload";
import exportRouter from "./routes/export";
import verifyRouter from "./routes/verify";
import videoRouter from "./routes/video";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(cors());
app.use(express.json());

// Serve the web app from /public
const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));

// Redirect / to /app
app.get("/", (_req, res) => {
  res.redirect("/app");
});

// Serve /app → app.html
app.get("/app", (_req, res) => {
  res.sendFile(path.join(publicDir, "app.html"));
});

// Diagnostic endpoint — check FFmpeg, fonts, disk, etc.
app.get("/api/debug", (_req, res) => {
  const ffmpegStatic = require("ffmpeg-static");
  const { execFileSync } = require("child_process");
  const fs = require("fs");
  const path = require("path");

  const info: Record<string, any> = {};

  // Check ffmpeg-static path
  info.ffmpegPath = ffmpegStatic;
  info.ffmpegExists = fs.existsSync(ffmpegStatic);

  // Check if binary is executable
  try {
    const ver = execFileSync(ffmpegStatic, ["-version"], { encoding: "utf-8", timeout: 5000 });
    info.ffmpegVersion = ver.split("\n")[0];
  } catch (e: any) {
    info.ffmpegError = e.message?.substring(0, 200);
  }

  // Check drawtext
  try {
    const out = execFileSync(ffmpegStatic, ["-filters"], { encoding: "utf-8", timeout: 5000 });
    info.hasDrawtext = out.includes("drawtext");
    info.hasDrawbox = out.includes("drawbox");
  } catch (e: any) {
    const combined = (e.stdout || "") + (e.stderr || "");
    info.hasDrawtext = combined.includes("drawtext");
    info.hasDrawbox = combined.includes("drawbox");
  }

  // Check fonts
  const fontBold = path.resolve(__dirname, "../fonts/IBMPlexMono-Bold.ttf");
  const fontRegular = path.resolve(__dirname, "../fonts/IBMPlexMono-Regular.ttf");
  info.fontBoldPath = fontBold;
  info.fontBoldExists = fs.existsSync(fontBold);
  info.fontRegularPath = fontRegular;
  info.fontRegularExists = fs.existsSync(fontRegular);

  // Check directories
  const uploadsDir = path.resolve(__dirname, "../uploads");
  const exportsDir = path.resolve(__dirname, "../exports");
  info.uploadsDir = uploadsDir;
  info.uploadsDirExists = fs.existsSync(uploadsDir);
  info.uploadsFiles = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).length : 0;
  info.exportsDirExists = fs.existsSync(exportsDir);

  // Memory
  const mem = process.memoryUsage();
  info.memoryMB = {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
  };

  // DB check
  try {
    const { getDb } = require("./db/connection");
    const db = getDb();
    const count = db.prepare("SELECT COUNT(*) as c FROM videos").get() as any;
    info.videosInDb = count.c;
  } catch (e: any) {
    info.dbError = e.message?.substring(0, 200);
  }

  res.json(info);
});

// API routes — specific paths before the catch-all /:shortID
app.use("/api/upload", uploadRouter);
app.use("/api/export", exportRouter);
app.use("/videos", videoRouter);
app.use("/", verifyRouter);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Allybi backend running on http://0.0.0.0:${PORT}`);
  console.log(`Local network: http://${getLocalIP()}:${PORT}`);
  console.log(`Open the app:  http://${getLocalIP()}:${PORT}/app`);
});

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}
