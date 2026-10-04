import type { RemoteTemplate } from "./templates";

/*
  What the Templates page lists in DEMO mode (no Meta account connected), so
  the page, the variable mapping and the campaign composer can be tried out
  before WhatsApp is connected. Never used once WHATSAPP_MODE=LIVE: the real
  list comes from Meta then.
*/
const t = (
  name: string,
  language: string,
  category: string,
  status: RemoteTemplate["status"],
  body: string,
  extra: Partial<RemoteTemplate> = {}
): RemoteTemplate => ({
  id: `demo_${name}_${language}`,
  name,
  language,
  category,
  status,
  body,
  buttons: [],
  header: "",
  footer: "",
  mediaHeader: false,
  rejectedReason: null,
  ...extra,
});

export const DEMO_TEMPLATES: RemoteTemplate[] = [
  t(
    "sales_pic_update",
    "en_GB",
    "UTILITY",
    "APPROVED",
    "Dear {{1}},\n\nThis is an official notification regarding your recent furniture order with Houzs Century Sdn Bhd.\n\nSales Order Number : {{2}}\nReference Number : {{3}}\nBranding : {{4}}\n\nThank you for your continued support!",
    { header: "Account Update: Change in Sales PIC", footer: "Houzs Century Management" }
  ),
  t(
    "delivery_date_confirm",
    "en",
    "UTILITY",
    "APPROVED",
    "Hi {{1}}! Your order {{2}} is ready.\n\nIs {{3}} a good delivery date? Tap a button below and we'll confirm the lorry slot.",
    { buttons: ["Confirm Date", "Change Date"] }
  ),
  t(
    "promo_oct_clearance",
    "en",
    "MARKETING",
    "APPROVED",
    "Hi {{1}}! Our October clearance is on: up to 30% off {{2}} sofas until 31 Oct.\n\nYour sales person {{3}} can hold a set for you.",
    { buttons: ["View catalogue", "Stop promotions"] }
  ),
  t("balance_due_notice", "en", "UTILITY", "APPROVED", "Dear {{1}}, a balance of RM {{2}} is due for your order {{3}}."),
  t("delivery_week_v2", "ms", "MARKETING", "PENDING", "Pesanan anda {{1}} akan dihantar minggu ini. Kami akan hubungi anda {{2}}."),
  t("greeting_raya", "ms", "MARKETING", "PAUSED", "Selamat Hari Raya daripada {{1}}!", {
    rejectedReason: "Paused by Meta · low quality rating",
  }),
  t("survey_feedback", "zh_CN", "UTILITY", "REJECTED", "{{1}} 您好，感谢您的购买！请为本次送货打分：{{2}}", {
    rejectedReason: "Variable at the start of the message",
  }),
];
