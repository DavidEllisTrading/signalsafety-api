import crypto from "crypto";

export default async function handler(req, res) {
  // CORS (för browser-test)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const topic = req.headers["x-shopify-topic"];
    const webhookId = req.headers["x-shopify-webhook-id"];

    // Shopify skickar order-objekt (inte dina egna fält)
    const order = req.body || {};

    // --- plocka ut viktiga fält från Shopify order ---
    const orderId = order.id || order.order_id || order.admin_graphql_api_id || "";
    const orderNumber = order.order_number || order.name || "";
    const currency = order.currency || order.presentment_currency || "SEK";

    // Shopify totals är ofta strings
    const rawValue =
      order.current_total_price ??
      order.total_price ??
      order.total_price_set?.shop_money?.amount ??
      order.current_total_price_set?.shop_money?.amount ??
      order.subtotal_price ??
      order.subtotal_price_set?.shop_money?.amount ??
      0;

    const value = Number(rawValue || 0);

    const email = order.email || order.contact_email || "";
    const phone = order.phone || order.customer?.phone || order.billing_address?.phone || "";

    // ttclid kan du bara få om du sparar den någonstans (cookie → checkout attribut → order note / metafield).
    // Om du inte har det ännu: skicka utan context.
    const ttclid =
      order.note_attributes?.find((x) => x?.name === "ttclid")?.value ||
      order.attributes?.ttclid ||
      order.ttclid ||
      "";

    // timestamp i sekunder
    const ts = Math.floor(Date.now() / 1000);

    function sha256(v) {
      if (!v) return undefined;
      return crypto
        .createHash("sha256")
        .update(String(v).trim().toLowerCase())
        .digest("hex");
    }

    // event_id: stabilt så du inte dubblar (Shopify order id)
    const eventId = String(orderId || orderNumber || crypto.randomUUID());

    // ---- DEBUG (minimal men tillräcklig) ----
    console.log("INCOMING", {
      topic,
      webhookId,
      hasOrderId: Boolean(orderId),
      orderId: String(orderId).slice(0, 12),
      currency,
      rawValue,
      value,
      hasEmail: Boolean(email),
      hasPhone: Boolean(phone),
      hasTtclid: Boolean(ttclid),
    });

    // Stoppa här om du får value = 0, för då har du fortfarande fel fält
    if (!Number.isFinite(value) || value <= 0) {
      console.log("BAD_VALUE_DETECTED", {
        rawValue,
        total_price: order.total_price,
        current_total_price: order.current_total_price,
        currency,
      });
      // Skicka ändå 200 till Shopify så du inte hamnar i retry-loop,
      // men markera ok:false så du ser i dina egna logs.
      return res.status(200).json({
        ok: false,
        reason: "value_missing_or_zero",
        hint: "Check which Shopify total field you want to use",
      });
    }

    const payload = {
      pixel_code: process.env.TIKTOK_PIXEL_CODE, // måste finnas i Vercel
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

    console.log("TIKTOK_PAYLOAD", {
      pixel_code: payload.pixel_code,
      event: payload.event,
      timestamp: payload.timestamp,
      event_id: payload.event_id,
      currency: payload.properties.currency,
      value: payload.properties.value,
      hasContext: Boolean(payload.context),
      hasEmail: Boolean(payload.user.email),
      hasPhone: Boolean(payload.user.phone),
    });

    if (!process.env.TIKTOK_ACCESS_TOKEN) {
      return res.status(500).json({ ok: false, error: "Missing TIKTOK_ACCESS_TOKEN env var" });
    }
    if (!process.env.TIKTOK_PIXEL_CODE) {
      return res.status(500).json({ ok: false, error: "Missing TIKTOK_PIXEL_CODE env var" });
    }

    const response = await fetch("https://business-api.tiktok.com/open_api/v1.3/pixel/track/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": process.env.TIKTOK_ACCESS_TOKEN,
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
