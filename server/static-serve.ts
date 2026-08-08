import path from "path";
import express from "express";

const IMMUTABLE_ASSET_PATTERN = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/;

export function cacheControlForStaticFile(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (normalizedPath.endsWith(".html")) return "no-store";
  if (IMMUTABLE_ASSET_PATTERN.test(normalizedPath)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}

/**
 * Sets up static file serving for the Express app
 * @param app Express application instance
 */
export function setupStaticServing(app: express.Application) {
  const publicDirectory = path.join(process.cwd(), "dist", "public");

  // Serve static files from the public directory
  app.use(
    express.static(publicDirectory, {
      dotfiles: "deny",
      fallthrough: true,
      setHeaders: (res, filePath) => {
        res.setHeader("Cache-Control", cacheControlForStaticFile(filePath));
      },
    }),
  );

  // For any other routes, serve the index.html file
  app.get("/{*splat}", (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith("/api/")) {
      return next();
    }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(publicDirectory, "index.html"));
  });
}
