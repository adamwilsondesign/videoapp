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
