import crypto from "crypto";

export default async function handler(req, res) {
  // CORS (för browser-test)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    console.log("INCOMING", {
      method: req.method,
      path: req.url,
      topic: req.headers["x-shopify-topic"],
      webhook_id: req.headers["x-shopify-webhook-id"],
    });

    const {
      event_id,
      order_id,
      currency,
      value,
      email,
      phone,
      ttclid,
      timestamp,
      test_event_code,
    } = req.body || {};

    function sha256(v) {
      if (!v) return undefined;
      return crypto
        .createHash("sha256")
        .update(String(v).trim().toLowerCase())
        .digest("hex");
    }

    // Unix timestamp i sekunder → skickas som STRING
    const ts = Number.isFinite(Number(timestamp))
      ? Math.floor(Number(timestamp))
      : Math.floor(Date.now() / 1000);

    const payload = {
      pixel_code: process.env.TIKTOK_PIXEL_CODE,
      event: "Purchase",
      timestamp: String(ts),
      event_id: String(event_id || order_id || crypto.randomUUID()),

      user: {
        email: email ? sha256(email) : undefined,
        phone: phone ? sha256(phone) : undefined,
      },

      properties: {
        currency: currency || "SEK",
        value: Number(value || 0),
      },

      context: ttclid
        ? { ad: { callback: String(ttclid) } }
        : undefined,
    };

    // 🔥 Viktigt: lägg till test_event_code om det finns
    if (test_event_code) {
      payload.test_event_code = String(test_event_code);
    }

    console.log("TIKTOK_PAYLOAD", payload);

    const response = await fetch(
      "https://business-api.tiktok.com/open_api/v1.3/pixel/track/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": process.env.TIKTOK_ACCESS_TOKEN,
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    console.log("TIKTOK_RESPONSE", {
      http_status: response.status,
      data,
    });

    return res.status(200).json({
      ok: true,
      tiktok: data,
    });
  } catch (error) {
    console.error("ERROR", error);
    return res.status(500).json({
      ok: false,
      error: String(error),
    });
  }
}
