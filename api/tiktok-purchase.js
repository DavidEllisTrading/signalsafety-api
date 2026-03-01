import crypto from "crypto";

export default async function handler(req, res) {
  // CORS (bara för browser-test)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Logga headers så vi direkt ser om det är Shopify eller browser
    console.log("INCOMING", {
      method: req.method,
      path: req.url,
      ua: req.headers["user-agent"],
      shopify_topic: req.headers["x-shopify-topic"],
      webhook_id: req.headers["x-shopify-webhook-id"],
    });

    const body = req.body || {};

    // ---- 1) Läs data från Shopify webhook (order payload) ----
    // Shopify order har ofta: id, order_number, total_price, currency, email, phone
    const shopifyOrderId = body.id || body.order_id || body.admin_graphql_api_id;
    const shopifyValue =
      body.total_price ??
      body.current_total_price ??
      body.total_price_set?.shop_money?.amount ??
      body.current_total_price_set?.shop_money?.amount;

    const shopifyCurrency =
      body.currency ??
      body.currency_code ??
      body.total_price_set?.shop_money?.currency_code ??
      body.current_total_price_set?.shop_money?.currency_code;

    const shopifyEmail = body.email;
    const shopifyPhone = body.phone;

    // ---- 2) Läs data från browser-test (din custom payload) ----
    const browserEventId = body.event_id;
    const browserOrderId = body.order_id;
    const browserValue = body.value;
    const browserCurrency = body.currency;
    const browserEmail = body.email;
    const browserPhone = body.phone;
    const ttclid = body.ttclid;
    const timestamp = body.timestamp;

    // Prioritera Shopify om det finns, annars browser
    const orderId = String(shopifyOrderId || browserOrderId || "");
    const valueRaw = shopifyValue ?? browserValue ?? 0;
    const currency = shopifyCurrency || browserCurrency || "SEK";
    const email = shopifyEmail || browserEmail;
    const phone = shopifyPhone || browserPhone;

    // TikTok vill ha sekunder (int)
    const ts = Number.isFinite(Number(timestamp))
      ? Math.floor(Number(timestamp))
      : Math.floor(Date.now() / 1000);

    function sha256(v) {
      if (!v) return undefined;
      return crypto
        .createHash("sha256")
        .update(String(v).trim().toLowerCase())
        .digest("hex");
    }

    const eventId = String(browserEventId || orderId || crypto.randomUUID());
    const value = Number(valueRaw || 0);

    // Stoppa skräp: om webhook kommer men saknar value -> logga & avbryt
    if (!value || value <= 0) {
      console.warn("ABORT: Missing/invalid value", { valueRaw, body_keys: Object.keys(body || {}) });
      return res.status(400).json({ ok: false, error: "Missing/invalid order value" });
    }

    const payload = {
      pixel_code: process.env.TIKTOK_PIXEL_CODE || "D6FG1F3C77UF3AJEJKKG",
      event: "CompletePayment",
      timestamp: ts,
      event_id: eventId,
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

    console.log("TIKTOK_PAYLOAD", payload);

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

    // Returnera tydligt så du ser i Shopify delivery också
    return res.status(200).json({
      ok: true,
      source: req.headers["x-shopify-topic"] ? "shopify_webhook" : "browser",
      event_id: eventId,
      order_id: orderId || null,
      value,
      currency,
      tiktok: data,
    });
  } catch (error) {
    console.error("ERROR", error);
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
