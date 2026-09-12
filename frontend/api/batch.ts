export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const pythonUrl = process.env.PYTHON_API_URL;
  if (!pythonUrl) {
    return res.status(503).json({ error: "Python batch engine not configured, using in-browser simulation" });
  }

  try {
    const upstream = await fetch(`${pythonUrl}/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (error: any) {
    return res.status(502).json({ error: error.message || "Failed to reach Python API" });
  }
}
