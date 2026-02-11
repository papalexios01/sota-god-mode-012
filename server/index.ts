import express from "express";
import { requestIdMiddleware, timingMiddleware, basicRateLimit } from "./middleware";
import { registerRoutes } from "./routes";

const app = express();

app.use(requestIdMiddleware);
app.use(timingMiddleware);
app.use(basicRateLimit({ windowMs: 60_000, max: 120 }));
app.use(express.json({ limit: "10mb" }));

// SECURITY FIX: Restrict CORS to known origins instead of wildcard "*"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const origin = req.headers.origin || "";

  // In development, allow localhost origins
  const isDev = process.env.NODE_ENV !== "production";
  const isAllowed =
    ALLOWED_ORIGINS.length === 0
      ? isDev // If no origins configured, allow all in dev only
      : ALLOWED_ORIGINS.includes(origin);

  if (isAllowed || isDev) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type, x-neuronwriter-key");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
};

app.use(corsMiddleware);
registerRoutes(app);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Server] Unhandled error:", err.message);
  if (!res.headersSent) {
    res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Server] API server running on port ${PORT}`);
});
