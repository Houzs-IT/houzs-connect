# Ecommerce — design / scoping note

Status: **research, not built.** Decide tier A vs B from this; nothing ships yet.

## Why this exists

The owner now wants Ecommerce (WhatsApp commerce). `docs/seampify-spec.md` records
that it was earlier called "not needed" and was **never connected for Houzs**, and
`docs/seampify-research.md §8` marks it low priority. Connect has **nothing** for
commerce today: no catalog id on `channel`, no product message helpers, no `order`
webhook handling, no product/cart nodes. So this is greenfield.

## The hard prerequisite (gates every tier)

WhatsApp commerce is driven by a **Meta Commerce Manager catalog** linked to the
WABA. This is a business/Meta-side setup, not code:

1. Create a catalog in Meta Commerce Manager, add products (each gets a
   `retailer_id` / SKU, shown under the item name in Catalog → Items).
2. Connect the catalog to the WhatsApp Business Account (WhatsApp Manager).
3. For tier B only: enable the **cart** on the number.

Until this exists there is nothing to send and no orders to receive. **Open
question for the owner: is Houzs willing to maintain a product catalog in Meta?**
A furniture range with per-order customisation and delivery scheduling may not map
cleanly onto fixed catalog SKUs — this is the crux of the original "not needed".

## Does it fit Houzs?

The platform exists for ERP-driven **delivery follow-up (跟单)** of big-ticket
furniture. WhatsApp **cart/checkout** is built for quick SKU retail — the opposite.
Tier A (a sales agent sending product cards mid-chat) fits the sales motion; tier B
(self-serve cart → order) only pays off if customers should self-checkout in
WhatsApp, which does not obviously match delivered furniture.

## WhatsApp commerce primitives (Cloud API, verified Oct 2026)

- **Single product message** — `interactive.type: "product"`, `action` =
  `{ catalog_id, product_retailer_id }`. No header allowed; body optional.
- **Multi-product message** — `interactive.type: "product_list"`, `action` =
  `{ catalog_id, sections[] }`; header **required**; ≤10 sections, ≤30 products
  total, each referencing a `product_retailer_id`.
- **Product carousel** — up to 10 cards, each with its own `product_retailer_id`
  + `catalog_id`. (Connect already has a carousel *template* builder — different
  thing, but the UI pattern is familiar.)
- **Order webhook (inbound)** — the customer sends a cart; arrives as a message of
  `type: "order"` with an `order` object `{ catalog_id, product_items[], text }`,
  each item `{ product_retailer_id, quantity, item_price (unit), currency }`. A
  cart holds ≤99 of each item and **cannot be edited once sent** (a change = a new
  order). The total is computed from the unit prices — reconcile, don't trust a
  single total field.
- **Native payment (`order_details` / `quick_pay`)** — in-app WhatsApp payment is
  **region-limited** (India / Brazil / Singapore style gateways: razorpay, payu,
  billdesk…). **Not generally available in Malaysia.** So for Houzs, an order's
  payment stays on the **existing bank-transfer + receipt-OCR flow Connect already
  has** (`src/lib/receipt-intake.ts`, the Payments module) — the `order_details`
  payment message is out of scope.

## Tier A — product / catalog messages (lighter)

Send product cards in a chat, a flow, or a campaign. Customer views products;
ordering continues as today (reply / sales agent / ERP). No cart capture, no Orders.

- **Schema:** a `catalog_id` per company (or per `channel`) — one column, or a
  small `commerce_settings` row. No order tables.
- **Transport:** add `sendProduct` / `sendProductList` to `src/lib/whatsapp/cloud-api.ts`
  (mirrors the existing `sendButtons` / `sendFlow` shape) + the DEMO no-op.
- **Automation node:** a `send_product` node (pick catalog + product id[s]) in
  `nodeCatalog.ts` + `engine.ts`, like `send_template`.
- **Inbox:** an optional "Send products" action in the composer.
- **Browse view:** optional — a read-only Products list synced from the catalog.
- **Effort:** ~medium, roughly one PR, plus the Meta catalog setup.

## Tier B — cart + checkout orders (heavy)

Tier A **plus** receiving orders.

- **Schema:** `order` + `order_item` tables (catalog_id, contact, items with
  retailer_id/qty/unit-price/currency, computed total, status), per company.
- **Webhook:** handle `type: "order"` in `src/app/api/webhooks/whatsapp/route.ts`
  (alongside text/interactive/button) → create the order, attach to the contact’s
  conversation.
- **UI:** an Ecommerce module with **Orders / Products / Catalog Settings** tabs
  (Catalog Settings = store the catalog id / "authorize" step).
- **Automation node:** `send_cart_confirmation` (Seampify's node) — confirm an
  order back to the customer.
- **The order → payment → fulfilment decision (must settle before building):**
  - *Payment:* Malaysia has no native WhatsApp payment, so reuse the existing
    receipt/Payments flow — the order just references the payment that comes in.
  - *Ownership:* **does Connect own orders, or hand them to the ERP?** The whole
    platform treats the **ERP as source of truth** (companies, delivery planning,
    callbacks). A WhatsApp order is really an ERP sales order. Most consistent with
    the architecture: Connect captures the `order` webhook and **posts it to the
    ERP** (like the delivery callback contract), rather than growing a parallel
    order system in Connect. That needs an ERP endpoint — an ERP-side decision.
- **Effort:** large, multi-PR, + the Meta cart setup + the ERP order contract.

## Recommendation

1. **Settle the catalog question first** — if Houzs won't maintain a Meta catalog,
   neither tier is possible; stop here.
2. If yes, **start with tier A.** It delivers the realistic value (rich product
   messages a sales agent sends mid-跟单) at a fraction of the cost and with no
   dependency on cart, orders, or an ERP order contract.
3. **Defer tier B** until there's a concrete need for self-serve checkout AND an
   agreed answer to "Connect vs ERP owns orders." If/when it happens, orders post
   to the ERP and payment reuses the receipt flow — not WhatsApp native payment.

## Open questions for the owner

- Will Houzs maintain a product catalog in Meta Commerce Manager?
- Goal: sales agent **sends product cards** (A), or customers **self-checkout** (B)?
- For B: should a WhatsApp order become an **ERP sales order** (recommended), and
  what ERP endpoint receives it?

## Sources

- [Cloud API — Messages reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/)
- [Catalogs overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalogs-overview/)
- [Interactive product carousel messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/interactive-product-carousel-messages.md)
- [WhatsApp orders](https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-br/orders/)
- [Receive payments via payment gateways](https://developers.facebook.com/documentation/business-messaging/whatsapp/payments/payments-in/pg)
