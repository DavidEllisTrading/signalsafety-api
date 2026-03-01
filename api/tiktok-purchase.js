import crypto from "crypto";

export default async function handler(req, res) {
  // CORS (bara för browser-test)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    console.log("INCOMING", {
      method: req.method,
      path: req.url,
      shopify_topic: req.headers["x-shopify-topic"],
      webhook_id: req.headers["x-shopify-webhook-id"],
    });

    const body = req.body || {};

    // Shopify orders/paid webhook har INTE dina egna fält som event_id/value/email osv,
    // så vi plockar smart från Shopify payload.
    const orderId = body.id || body.order_id || body.admin_graphql_api_id || body.name;
    const currency = body.currency || body.presentment_currency || "SEK";

    // Shopify: total_price / current_total_price kan vara sträng
    const rawValue =
      body.current_total_price ??
      body.total_price ??
      body.total_price_set?.shop_money?.amount ??
      body.current_total_price_set?.shop_money?.amount ??
      body.total_price_set?.presentment_money?.amount ??
      body.current_total_price_set?.presentment_money?.amount;

    const value = Number(rawValue || 0);

    const email = body.email || body.contact_email || body.customer?.email;
    const phone = body.phone || body.customer?.phone || body.shipping_address?.phone;

    // Om du testar manuellt via fetch kan du skicka dessa
    const ttclid = body.ttclid; // valfritt
    const test_event_code = body.test_event_code; // VIKTIG för Test Events
    const timestamp = body.timestamp; // valfritt

    function sha256(v) {
      if (!v) return undefined;
      return crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");
    }

    // TikTok vill ha sekunder (int)
    const ts = Number.isFinite(Number(timestamp))
      ? Math.floor(Number(timestamp))
      : Math.floor(Date.now() / 1000);

    const pixel_code = process.env.TIKTOK_PIXEL_CODE || "D6FG1F3C77UF3AJEJKKG";

    const payload = {
      pixel_code,
      event: "Purchase",                // <-- DETTA gör att det blir “Purchase” i UI
      timestamp: ts,
      event_id: String(orderId || crypto.randomUUID()),

      // test_event_code gör att server-event syns i “Test events”
      ...(test_event_code ? { test_event_code } : {}),

      context: ttclid ? { ad: { callback: ttclid } } : undefined,

      user: {
        email: email ? sha256(email) : undefined,
        phone: phone ? sha256(phone) : undefined,
      },

      properties: {
        currency,
        value,
      },
    };

    console.log("TIKTOK_PAYLOAD", {
      pixel_code,
      event: payload.event,
      timestamp: payload.timestamp,
      event_id: payload.event_id,
      currency: payload.properties.currency,
      value: payload.properties.value,
      hasTestEventCode: !!test_event_code,
      hasEmail: !!email,
      hasPhone: !!phone,
      hasTtclid: !!ttclid,
    });

    const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/pixel/track/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": process.env.TIKTOK_ACCESS_TOKEN,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    console.log("TIKTOK_RESPONSE", { http_status: response.status, data });

    return res.status(200).json({ ok: true, tiktok: data });
  } catch (error) {
    console.error("ERROR", error);
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
