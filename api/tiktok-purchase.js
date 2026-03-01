import crypto from "crypto";

export default async function handler(req, res) {
  // CORS (för browser-test)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Only POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ✅ FINGERPRINT (temporärt) — bevisar att denna deploy körs
  return res.status(200).json({
    fingerprint: "BUILD_2026_03_01_1909",
    env: {
      hasAccessToken: Boolean(process.env.TIKTOK_ACCESS_TOKEN),
      hasPixelCode: Boolean(process.env.TIKTOK_PIXEL_CODE),
    },
  });

  // ------------------------------------------------------------
  // När fingerprint stämmer: kommentera bort returnen ovan
  // ------------------------------------------------------------

  try {
    console.log("INCOMING", {
      method: req.method,
      path: req.url,
      shopify_topic: req.headers["x-shopify-topic"],
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

    // TikTok vill ha sekunder (int)
    const ts = Number.isFinite(Number(timestamp))
      ? Math.floor(Number(timestamp))
      : Math.floor(Date.now() / 1000);

    const pixelCode = process.env.TIKTOK_PIXEL_CODE || "D6FG1F3C77UF3AJEJKKG";

    const payload = {
      pixel_code: pixelCode,
      event: "CompletePayment",
      timestamp: ts,
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
      // om du kör TikTok Test Events
      test_event_code: test_event_code ? String(test_event_code) : undefined,
    };

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

    return res.status(200).json({ ok: true, tiktok: data });
  } catch (error) {
    console.error("ERROR", error);
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
