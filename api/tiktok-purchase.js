import crypto from "crypto";

export default async function handler(req, res) {
  // CORS för browser-test
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const topic = req.headers["x-shopify-topic"];
    const webhookId = req.headers["x-shopify-webhook-id"];

    console.log("INCOMING", {
      method: req.method,
      path: req.url,
      ua: req.headers["user-agent"],
      shopify_topic: topic,
      webhook_id: webhookId,
    });

    const body = req.body || {};

    // ---------- Helpers ----------
    const sha256 = (v) => {
      if (!v) return undefined;
      return crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");
    };

    const nowSec = () => Math.floor(Date.now() / 1000);

    // ---------- Detect payload type ----------
    const looksLikeShopifyOrder = body && (body.id || body.order_number || body.total_price);

    // ---------- Extract fields ----------
    let order_id, currency, value, email, phone, ttclid, event_id, timestamp;

    if (looksLikeShopifyOrder) {
      // Shopify order payload
      order_id = String(body.id || body.order_number);
      currency = body.currency || body.presentment_currency || "SEK";
      value = Number(body.total_price || 0);

      email = body.email || (body.customer && body.customer.email) || undefined;
      phone =
        body.phone ||
        (body.customer && body.customer.phone) ||
        (body.shipping_address && body.shipping_address.phone) ||
        undefined;

      // TikTok click id brukar INTE komma i webhooken om du inte sparar den själv i order attributes/metafields.
      // Om du sparar den i "note_attributes" så plockar vi den här:
      if (Array.isArray(body.note_attributes)) {
        const found = body.note_attributes.find((x) => (x?.name || "").toLowerCase() === "ttclid");
        ttclid = found?.value;
      }

      event_id = order_id;
      timestamp = nowSec();
    } else {
      // Browser-test payload (din JSON)
      order_id = body.order_id;
      currency = body.currency || "SEK";
      value = Number(body.value || 0);
      email = body.email;
      phone = body.phone;
      ttclid = body.ttclid;
      event_id = body.event_id || order_id || crypto.randomUUID();
      timestamp = Number.isFinite(Number(body.timestamp)) ? Math.floor(Number(body.timestamp)) : nowSec();
    }

    // ---------- Build TikTok payload ----------
    const pixel_code = process.env.TIKTOK_PIXEL_CODE || "D6FG1F3C77UF3AJEJKKG";
    const accessToken = process.env.TIKTOK_ACCESS_TOKEN;

    if (!accessToken) {
      return res.status(500).json({ ok: false, error: "Missing TIKTOK_ACCESS_TOKEN env var" });
    }

    const tiktokEvent = {
      event: "CompletePayment",
      event_time: timestamp,          // TikTok: seconds
      event_id: String(event_id),
      pixel_code,
      properties: {
        currency,
        value,
      },
      user: {
        email: email ? sha256(email) : undefined,
        phone: phone ? sha256(phone) : undefined,
      },
      context: ttclid ? { ad: { callback: ttclid } } : undefined,
    };

    // TikTok endpoint vill oftast ha data-array
    const payload = { data: [tiktokEvent] };

    console.log("TIKTOK_PAYLOAD", payload);

    const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/pixel/track/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": accessToken,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    console.log("TIKTOK_RESPONSE", { http_status: response.status, data });

    return res.status(200).json({
      ok: true,
      source: looksLikeShopifyOrder ? "shopify" : "browser",
      order_id,
      tiktok: data,
    });
  } catch (error) {
    console.error("ERROR", error);
    return res.status(500).json({ ok: false, error: String(error) });
  }
}
