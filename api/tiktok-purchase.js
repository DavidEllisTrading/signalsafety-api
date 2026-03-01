import crypto from "crypto";

export default async function handler(req, res) {
  // CORS för browser-test
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};

    // ---- DEBUG: visa exakt vad som kommer in
    console.log("INCOMING_BODY_KEYS", Object.keys(body));
    console.log("INCOMING_TIMESTAMP_RAW", body.timestamp, typeof body.timestamp);

    const {
      test_event_code,
      event_id,
      order_id,
      currency,
      value,
      email,
      phone,
      ttclid,
      timestamp, // optional
    } = body;

    function sha256(v) {
      if (!v) return undefined;
      return crypto
        .createHash("sha256")
        .update(String(v).trim().toLowerCase())
        .digest("hex");
    }

    // TikTok: skicka ALLTID timestamp som int (sekunder)
    const ts =
      typeof timestamp === "number"
        ? Math.floor(timestamp)
        : typeof timestamp === "string" && timestamp.trim() !== "" && !Number.isNaN(Number(timestamp))
          ? Math.floor(Number(timestamp))
          : Math.floor(Date.now() / 1000);

    // EXTRA DEBUG: logga vad vi skickar
    console.log("TIMESTAMP_COMPUTED", ts, typeof ts);

    const payload = {
      pixel_code: process.env.TIKTOK_PIXEL_CODE, // sätt i Vercel
      event: "Purchase", // viktig: TikTok standard-event för köp
      timestamp: ts,
      event_id: String(event_id || order_id || crypto.randomUUID()),
      test_event_code: test_event_code || undefined,
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

    console.log("TIKTOK_PAYLOAD", payload);

    const resp = await fetch("https://business-api.tiktok.com/open_api/v1.3/pixel/track/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": process.env.TIKTOK_ACCESS_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    console.log("TIKTOK_RESPONSE", { http_status: resp.status, data });

    return res.status(200).json({ ok: true, tiktok: data });
  } catch (e) {
    console.error("ERROR", e);
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
