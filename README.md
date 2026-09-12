# Recoup - Revenue Recovery Agent

A full-stack application for intelligent payment recovery, dunning policy simulation, and AI-assisted financial risk analysis. Recoup pairs a React and TypeScript frontend with a dual-execution recovery simulation engine (client-side in-browser and server-side Python FastAPI) alongside Gemini API integration.

## Architecture

```
Browser
  |-- GET  /             -> Vite / Express / Static Host -> React SPA
  |-- POST /api/gemini   -> Gemini API Proxy (Google GenAI)
  `-- POST /api/batch    -> Python FastAPI Service (:8001) / Fallback Engine
```

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, Recharts, Motion, and Lucide icons.
- **Backend API**: Express server proxying Gemini calls and batch workloads.
- **Python Engine**: Python 3 simulation engine with FastAPI HTTP endpoints for headless batch processing.
- **Serverless / Cloud Ready**: Configured for Vercel deployment with dedicated serverless function handlers in `/api`.

---

## Deployment on Vercel

The project includes standard Vercel configuration (`vercel.json`) and serverless route handlers:

1. Connect this repository to Vercel.
2. In the Vercel Project Settings under **Environment Variables**, configure:
   - `GEMINI_API_KEY`: Google Gemini API key.
   - `PYTHON_API_URL` *(Optional)*: URL of a deployed Python batch service if hosting the Python backend remotely. When omitted, the platform automatically executes the simulation engine directly in the browser.
3. Deploy. The Vite static bundle and `/api` serverless routes are built and deployed automatically.

---

## Local Development

### Prerequisites
- Node.js 20+
- Python 3.10+ (optional, for running the local Python simulation backend)

### 1. Environment Setup

Copy the example environment configuration:

```bash
cp .env.example .env
```

Set your `GEMINI_API_KEY` in `.env`.

### 2. Install and Run

Run both frontend and backend concurrently:

```bash
npm install
npm run dev
```

The application will be accessible at `http://localhost:3000`.

To run only the frontend:

```bash
cd frontend
npm install
npm run dev
```

To run the Python batch service standalone:

```bash
cd backend
pip install -r requirements.txt
python3 api.py
```

---

## Production Build

To compile both the client SPA and the Node server:

```bash
npm run build
npm start
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Recommended | API key used for server-side Gemini intelligence calls (diagnostics, classification, copy generation). |
| `PYTHON_API_URL` | Optional | Address of the Python FastAPI service (default for local dev: `http://localhost:8001`). If unset, client runs in-browser engine. |
| `PORT` | Optional | Port for the Node server in containerized environments (default: `3000`). |

---

## Core Capabilities

- **Recovery Dashboard**: Key performance indicators, recovery rates, net financial yield, and category breakdown.
- **Cases & Escalations**: Drill-down inspection of failed transactions, retry schedules, and human escalation queues.
- **Policy Engine & Lab**: Dunning configuration, grace period tuning, channel mix experimentation, and batch comparisons.
- **AI Judgment Lab**: Powered by Gemini for decline root cause diagnosis, B2B intent classification, and empathetic outreach drafting.
- **Data Export**: Export structured audit logs (`audit_log.json`) and case reports (`cases.csv`).

---

## Testing

Run unit tests for the Python recovery engine:

```bash
cd backend
python3 -m unittest discover -s tests -v
```
