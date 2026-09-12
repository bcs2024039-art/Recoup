# Recoup: Revenue Recovery Agent

A full-stack, deployable version of the AI revenue recovery dashboard. The React frontend connects to a Python batch engine backend via REST API, with Gemini for AI judgment calls.

## Architecture

```
Browser
  ├─→ GET/              Express (Node :3000)  ->  React SPA
  ├─→ POST/api/gemini   Express               ->  Gemini REST API
  └─→ POST/api/batch    Express               ->  Python FastAPI (:8000) -> engine
```

- **Frontend** (`src/`):- React + TypeScript + Vite + Tailwind. Runs the full engine in-browser by default; can switch to Python engine mode via the "Engine" toggle in the dashboard.
- **Backend** (`backend/`):- Pure Python 3 engine (zero stdlib dependencies). Wrapped in a thin FastAPI HTTP layer for production use.
- **Server** (`server.ts`):- Express: serves the built SPA, proxies Gemini calls, proxies batch requests to Python.

---

## Quick Start - Docker Compose (Recommended)

```bash
# 1. Clone/copy this folder, then:
cp .env.example .env
# Edit .env and set your GEMINI_API_KEY

# 2. Build and start both services
docker compose up --build

# App is live at http://localhost:3000
```

---

## Manual Dev Setup

### Node frontend + Express server

Requires **Node.js 20+**.

```bash
cd frontend
npm install
cp ../.env.example ../.env   # set GEMINI_API_KEY (and PYTHON_API_URL if running Python too)
npm run dev            # starts Express + Vite HMR on http://localhost:3000
```

### Python batch engine

Requires **Python 3.10+**.

```bash
cd backend
pip install -r requirements.txt
# Set GEMINI_API_KEY in your environment (or it falls back to heuristics)
python -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

Then set `PYTHON_API_URL=http://localhost:8000` in your root `.env` and restart the Node server.

### Production build (no Docker)

```bash
cd frontend
npm run build          # builds React SPA + bundles server.ts → dist/server.cjs
NODE_ENV=production node dist/server.cjs
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Gemini API key is used by Express for `/api/gemini` proxy and by Python for LLM judgment calls. Get one free at [aistudio.google.com](https://aistudio.google.com/apikey). |
| `PORT` | No | Port for the Node/Express server (default: `3000`). |
| `PYTHON_API_URL` | No | URL of the Python FastAPI service. Set to `http://localhost:8000` for local dev, or `http://api:8000` inside Docker. If unset, the "Python" engine toggle still appears but returns a graceful error and falls back to browser mode. |

---

## Features

- **Landing page** -> Auth page -> Splash -> Dashboard (all existing design preserved exactly)
- **Dashboard tabs**: Overview · Cases · Escalation Queue · Policy Engine · Policy Lab · AI Judgment Lab
- **Engine toggle**: Run batch in-browser (JS engine, instant) or via Python (authoritative engine)
- **AI Judgment Lab**: Three real Gemini API calls - diagnose ambiguous decline, classify B2B reply, draft outreach copy
- **Audit exports**: Download `audit_log.json` and `cases.csv` from any batch run
- **Docker Compose**: One-command production deployment

---

## Python batch engine (standalone)

The Python engine can also be run independently as before:

```bash
cd backend
python3 run_batch.py --n 200 --seed 42
# Writes output/audit_log.jsonl, output/summary.json, output/cases.csv

python3 -m unittest discover -s tests -v
```

No pip install needed. Only `backend/requirements.txt` (FastAPI + uvicorn) is needed for the HTTP wrapper.
