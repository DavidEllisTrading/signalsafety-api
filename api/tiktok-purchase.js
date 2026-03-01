import crypto from "crypto";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { event_id, order_id, currency, value, email, phone, ttclid } = req.body || {};

    function sha256(v) {
      if (!v) return null;
      return crypto
        .createHash("sha256")
        .update(String(v).trim().toLowerCase())
        .digest("hex");
    }

    const payload = {
      pixel_code: "D6FG1F3C77UF3AJEJKKG",
      event: "CompletePayment",
      timestamp: Math.floor(Date.now() / 1000),
      event_id: String(event_id || order_id || crypto.randomUUID()),
      context: ttclid ? { ad: { callback: ttclid } } : undefined,
      user: {
        email: email ? sha256(email) : undefined,
        phone: phone ? sha256(phone) : undefined,
      },
      properties: {
        currency: currency || "SEK",
        value: Number(value || 0),
      },
    };

    const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/pixel/track/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": process.env.TIKTOK_ACCESS_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return res.status(200).json({ ok: true, tiktok: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
