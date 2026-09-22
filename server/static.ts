import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use("/assets", express.static(path.join(distPath, "assets"), { maxAge: "1y", immutable: true }));
  app.use(express.static(distPath, { maxAge: "5m", index: false }));

  // fall through to index.html if the file doesn't exist
  app.get("/", (_req, res) => {
    res.set("Cache-Control", "no-cache").sendFile(path.resolve(distPath, "index.html"));
  });
  app.use("/{*path}", (_req, res) => {
    res.status(404).type("text").send("Page not found. Return to / for Floodwatch.");
  });
}
