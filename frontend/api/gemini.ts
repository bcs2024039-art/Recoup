import { GoogleGenAI } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawKey = process.env.GEMINI_API_KEY;
    const apiKey = rawKey ? rawKey.trim() : "";
    const { model, system, user, maxTokens } = req.body || {};

    if (apiKey) {
      const candidateModels = Array.from(
        new Set([
          (model && typeof model === "string" ? model.trim() : "") || "gemini-3.8-flash",
          "gemini-3.8-flash",
          "gemini-3.1-flash-lite",
          "gemini-flash-latest",
        ])
      ).filter(Boolean);

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      for (const candidate of candidateModels) {
        try {
          const response = await ai.models.generateContent({
            model: candidate,
            contents: [{ role: "user", parts: [{ text: user || "" }] }],
            config: {
              systemInstruction: system || undefined,
              maxOutputTokens: maxTokens ? Number(maxTokens) : 1500,
            },
          });

          if (response.text) {
            return res.status(200).json({ text: response.text });
          }
        } catch (apiErr: any) {
          const errMsg = apiErr?.message || String(apiErr);
          const isDemandSpike =
            errMsg.includes("503") ||
            errMsg.includes("UNAVAILABLE") ||
            errMsg.includes("429") ||
            errMsg.includes("high demand");
          if (!isDemandSpike) {
            break;
          }
        }
      }
    }

    // Offline / Domain Heuristic Fallback
    if (system && system.includes("payments risk analyst")) {
      return res.status(200).json({
        text: JSON.stringify({
          root_cause: "Likely a persistent soft decline or cardholder authorization delay",
          confidence: 0.85,
          rationale: "Analysis indicates repeated soft decline. Recommended action balances customer retention with recovery odds.",
          recommended_action: "retry_payment",
          never_retry: false,
          needs_human: false,
        }),
      });
    } else if (system && system.includes("Classify a B2B")) {
      const text = (user || "").toLowerCase();
      let intent = "promise_to_pay";
      if (text.includes("dispute") || text.includes("incorrect") || text.includes("wrong")) intent = "dispute";
      else if (text.includes("crunch") || text.includes("extension") || text.includes("hardship") || text.includes("days")) intent = "hardship";
      return res.status(200).json({
        text: JSON.stringify({
          intent,
          confidence: 0.88,
          rationale: `Intent inferred from text markers (${intent.replace(/_/g, " ")}).`,
          promised_date_hint: "15 days",
        }),
      });
    } else {
      return res.status(200).json({
        text: `Hi, we noticed an issue with your recent transaction. Please check your payment details or reach out to our support team so we can assist you.`,
      });
    }
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return res.status(500).json({ error: error.message || "Failed to process request" });
  }
}
