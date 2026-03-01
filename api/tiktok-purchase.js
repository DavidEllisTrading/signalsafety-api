import crypto from "crypto";

export default async function handler(req, res) {
  // CORS (för browser-test; du kan låsa senare)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Only POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Logga inkommande webhook/request
    console.log("INCOMING", {
      method: req.method,
      path: req.url,
      shopify_topic: req.headers["x-shopify-topic"],
      webhook_id: req.headers["x-shopify-webhook-id"],
      ua: req.headers["user-agent"],
    });

    const body = req.body || {};

    const {
      event_id,
      order_id,
      currency,
      value,
      email,
      phone,
      ttclid,
      // valfritt: om du skickar timestamp själv
      timestamp,
    } = body;

    function sha256(v) {
      if (!v) return undefined;
      return crypto
        .createHash("sha256")
        .update(String(v).trim().toLowerCase())
        .digest("hex");
    }

    // TikTok vill ha unix timestamp i SEKUNDER
    // och i din setup kräver den STRING (inte number)
    const tsNum = Number.isFinite(Number(timestamp))
      ? Math.floor(Number(timestamp))
      : Math.floor(Date.now() / 1000);

    const pixelCode = process.env.TIKTOK_PIXEL_CODE || "D6FG1F3C77UF3AJEJKKG";
    const accessToken = process.env.TIKTOK_ACCESS_TOKEN;

    // Viktigt: access token måste finnas
    if (!accessToken) {
      return res.status(500).json({ ok: false, error: "Missing TIKTOK_ACCESS_TOKEN in env" });
    }

    const payload = {
      pixel_code: pixelCode,
      event: "CompletePayment",
      timestamp: String(tsNum), // ✅ FIX: string, inte number
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

    // Debug: visa vad du skickar (men ingen access token)
    console.log("PIXEL_CODE_USED", pixelCode);
    console.log("ACCESS_TOKEN_FIRST_6", String(accessToken).slice(0, 6));
    console.log("FULL_PAYLOAD", payload);

    const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/pixel/track/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": accessToken,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    console.log("TIKTOK_RESPONSE", {
      http_status: response.status,
      data,
    });

    // Returnera alltid 200 till Shopify så den inte spammar retries,
    // men du ser i logs om TikTok gav error code.
    return res.status(200).json({ ok: true, tiktok: data });
  } catch (error) {
    console.error("ERROR", error);
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
