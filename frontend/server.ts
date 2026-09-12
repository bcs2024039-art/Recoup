import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3000", 10);

  app.use(express.json());

  // API routes FIRST

  // ── Gemini proxy ─────────────────────────────────────────────────────────
  app.post("/api/gemini", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY environment variable is missing" });
      }

      const { model, system, user, maxTokens } = req.body;
      const ai = new GoogleGenAI({ apiKey });

      const response = await ai.models.generateContent({
        model: model || "gemini-3.7-flash",
        contents: [{ role: "user", parts: [{ text: user }] }],
        config: {
          systemInstruction: system,
        }
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "Failed to call Gemini" });
    }
  });

  // ── Python batch engine proxy ─────────────────────────────────────────────
  // Forwards /api/batch → Python FastAPI service (PYTHON_API_URL env var).
  // When PYTHON_API_URL is not set the route returns 503 so the frontend
  // can gracefully fall back to the in-browser JS engine.
  app.post("/api/batch", async (req, res) => {
    const pythonUrl = process.env.PYTHON_API_URL;
    if (!pythonUrl) {
      return res.status(503).json({ error: "Python API not configured (PYTHON_API_URL not set)" });
    }
    try {
      const upstream = await fetch(`${pythonUrl}/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch (error: any) {
      console.error("Python API Error:", error);
      res.status(502).json({ error: error.message || "Failed to reach Python API" });
    }
  });

  // ── Vite middleware for development ───────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*path}', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Python API URL: ${process.env.PYTHON_API_URL || "(not set – browser-only mode)"}`);
  });
}

startServer();
