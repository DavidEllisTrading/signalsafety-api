import crypto from "crypto";

export default async function handler(req, res) {
  // CORS (bara för att du ska kunna testa från browsern)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Endast POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Minimal log så du ser att Shopify/webhooken kom in
    console.log("INCOMING", {
      method: req.method,
      path: req.url,
      topic: req.headers["x-shopify-topic"],
      webhook_id: req.headers["x-shopify-webhook-id"],
      ua: req.headers["user-agent"],
    });

    const {
      event_id,
      order_id,
      currency,
      value,
      email,
      phone,
      ttclid,
      timestamp,        // optional
      test_event_code,  // optional (för TikTok Test Events)
    } = req.body || {};

    function sha256(v) {
      if (!v) return undefined;
      return crypto
        .createHash("sha256")
        .update(String(v).trim().toLowerCase())
        .digest("hex");
    }

    // TikTok vill ha unix timestamp i sekunder.
    // Skicka som STRING för att undvika 40002 ("not a valid string")
    const ts = Number.isFinite(Number(timestamp))
      ? Math.floor(Number(timestamp))
      : Math.floor(Date.now() / 1000);

    const pixelCode = (process.env.TIKTOK_PIXEL_CODE || "").trim() || "D6FG1F3C77UF3AJEJKKG";
    const accessToken = (process.env.TIKTOK_ACCESS_TOKEN || "").trim();

    const payload = {
      pixel_code: pixelCode,
      event: "Purchase",
      timestamp: String(ts),
      event_id: String(event_id || order_id || crypto.randomUUID()),
      test_event_code: test_event_code ? String(test_event_code) : undefined,

      // TikTok click id (om du har den)
      context: ttclid ? { ad: { callback: String(ttclid) } } : undefined,

      user: {
        email: email ? sha256(email) : undefined,
        phone: phone ? sha256(phone) : undefined,
      },

      properties: {
        currency: currency || "SEK",
        value: Number(value || 0),
      },
    };

    console.log("TIKTOK_PAYLOAD", payload);
    console.log("PIXEL_CODE_USED", pixelCode);
    console.log("ACCESS_TOKEN_FIRST_6", accessToken ? accessToken.slice(0, 6) : "MISSING");

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

    return res.status(200).json({ ok: true, tiktok: data });
  } catch (error) {
    console.error("ERROR", error);
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
