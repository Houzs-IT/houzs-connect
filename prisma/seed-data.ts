// Houzs-shaped seed constants. The org chart + fields here mirror the real Seampify
// account captured 2026-07-28. In production these come from the ERP org chart + the
// ERP order schema; this seed just makes the demo tangible.

export type FieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";

// The 63 contact fields observed in Seampify (Settings > Contact Fields).
export const CONTACT_FIELDS: { key: string; name: string; type: FieldType }[] = [
  { key: "reference_no", name: "Reference No.", type: "TEXT" },
  { key: "brand", name: "Brand", type: "TEXT" },
  { key: "purchase_venue", name: "Purchase Venue", type: "TEXT" },
  { key: "sales_person", name: "Sales Person", type: "TEXT" },
  { key: "delivery_state", name: "Delivery State", type: "TEXT" },
  { key: "office_contact", name: "Office Contact", type: "TEXT" },
  { key: "message_status", name: "Message Status", type: "TEXT" },
  { key: "client_delivery_date", name: "Client Delivery Date", type: "DATE" },
  { key: "delivery_time", name: "Delivery Time", type: "TEXT" },
  { key: "delivery_message_status", name: "Delivery Message Status", type: "TEXT" },
  { key: "drivers_name", name: "Drivers Name", type: "TEXT" },
  { key: "drivers_contact", name: "Drivers Contact", type: "TEXT" },
  { key: "car_plate", name: "Car Plate", type: "TEXT" },
  { key: "drivers_ic", name: "Driver's IC", type: "TEXT" },
  { key: "field_type", name: "Field Type", type: "TEXT" },
  { key: "contact_number_type", name: "Contact Number Type", type: "TEXT" },
  { key: "customer_phone", name: "Customer Phone", type: "TEXT" },
  { key: "house_type", name: "House Type", type: "SELECT" },
  { key: "new_house", name: "New House", type: "TEXT" },
  { key: "renovation", name: "Renovation", type: "TEXT" },
  { key: "disposal", name: "Disposal", type: "TEXT" },
  { key: "disposal_item", name: "Disposal Item", type: "TEXT" },
  { key: "delivery_confirmation", name: "Delivery Confirmation", type: "TEXT" },
  { key: "reschedule", name: "Reschedule", type: "TEXT" },
  { key: "visiting_time", name: "Visiting Time", type: "TEXT" },
  { key: "address_state", name: "Address State", type: "TEXT" },
  { key: "amount", name: "Amount", type: "NUMBER" },
  { key: "response", name: "Response", type: "TEXT" },
  { key: "ref_1", name: "Ref 1", type: "TEXT" },
  { key: "ref_2", name: "Ref 2", type: "TEXT" },
  { key: "ref_3", name: "Ref 3", type: "TEXT" },
  { key: "brand_1", name: "Brand 1", type: "TEXT" },
  { key: "brand_2", name: "Brand 2", type: "TEXT" },
  { key: "brand_3", name: "Brand 3", type: "TEXT" },
  { key: "sales_location_1", name: "Sales Location 1", type: "TEXT" },
  { key: "sales_location_2", name: "Sales Location 2", type: "TEXT" },
  { key: "sales_location_3", name: "Sales Location 3", type: "TEXT" },
  { key: "venue_1", name: "Venue 1", type: "TEXT" },
  { key: "venue_2", name: "Venue 2", type: "TEXT" },
  { key: "venue_3", name: "Venue 3", type: "TEXT" },
  { key: "sales_agent_1", name: "Sales Agent 1", type: "TEXT" },
  { key: "sales_agent_2", name: "Sales Agent 2", type: "TEXT" },
  { key: "sales_agent_3", name: "Sales Agent 3", type: "TEXT" },
  { key: "delivery_date_1", name: "Delivery Date 1", type: "DATE" },
  { key: "delivery_date_2", name: "Delivery Date 2", type: "DATE" },
  { key: "delivery_date_3", name: "Delivery Date 3", type: "DATE" },
  { key: "delivery_message_status_1", name: "Delivery Message Status 1", type: "TEXT" },
  { key: "delivery_message_status_2", name: "Delivery Message Status 2", type: "TEXT" },
  { key: "delivery_message_status_3", name: "Delivery Message Status 3", type: "TEXT" },
  { key: "order_total", name: "Order Total", type: "NUMBER" },
  { key: "send_status", name: "Send Status", type: "TEXT" },
  { key: "amend_date_reason", name: "Amend Date Reason", type: "TEXT" },
  { key: "date_amended", name: "Date Amended", type: "TEXT" },
  { key: "amend_date_reason_2", name: "Amend Date Reason 2", type: "TEXT" },
  { key: "new_delivery_date", name: "New Delivery Date", type: "DATE" },
  { key: "button_status", name: "Button Status", type: "TEXT" },
  { key: "sales_person_2", name: "Sales Person 2", type: "TEXT" },
  { key: "send_status_1_day", name: "Send Status 1 Day", type: "TEXT" },
  { key: "automation", name: "Automation", type: "TEXT" },
  { key: "replied_check", name: "Replied Check", type: "TEXT" },
  { key: "got_amend_date", name: "Got Amend Date 1", type: "TEXT" },
  { key: "got_amend_date_2", name: "Got Amend Date 2", type: "TEXT" },
  { key: "got_amend_date_3", name: "Got Amend Date 3", type: "TEXT" },
  // Houzs addition (not in Seampify): the delivery address shown in the
  // hc_order_postage_confirm template for the customer to confirm. Already added
  // to Houzs Century in prod 2026-10-02 via Settings > Contact fields; listed
  // here so a fresh environment seeds it too.
  { key: "delivery_address", name: "Delivery Address", type: "TEXT" },
];

export type Role =
  | "OWNER"
  | "ADMIN"
  | "MANAGER"
  | "AGENT"
  | "SALES"
  | "DRIVER"
  | "VIEWER";

// Demo org chart (real one comes from the ERP org chart later).
// `manager` references another member's `key`.
export const MEMBERS: {
  key: string;
  name: string;
  email: string;
  role: Role;
  title: string;
  department: string;
  manager?: string;
}[] = [
  { key: "boss", name: "Houzs_CS Team 1", email: "hello@houzscentury.com", role: "OWNER", title: "Operations Lead", department: "Management" },
  { key: "nancy", name: "Nancy Kuan", email: "kuannc85@gmail.com", role: "MANAGER", title: "Customer Service Manager", department: "Support", manager: "boss" },
  { key: "syu", name: "Houzs Century_Syu", email: "houzsorder@gmail.com", role: "AGENT", title: "Order & Delivery Coordinator", department: "Support", manager: "nancy" },
  { key: "sya", name: "Houzs Century_Sya Sya", email: "tihanibatrishia01@gmail.com", role: "AGENT", title: "Support Agent", department: "Support", manager: "nancy" },
  { key: "azza", name: "Houzs Century_Azza", email: "azzaedrynna@gmail.com", role: "AGENT", title: "Support Agent", department: "Support", manager: "nancy" },
  { key: "peter", name: "Peter", email: "houzssales@gmail.com", role: "SALES", title: "Sales Executive", department: "Sales", manager: "boss" },
  { key: "marketing", name: "Marketing", email: "inhousemarketinghub@gmail.com", role: "ADMIN", title: "Marketing", department: "Marketing", manager: "boss" },
  { key: "driver1", name: "Delivery Driver A", email: "driver.a@houzscentury.com", role: "DRIVER", title: "Delivery Driver", department: "Logistics", manager: "syu" },
];

export const DEPARTMENTS = ["Management", "Support", "Sales", "Marketing", "Logistics"];

export const TAGS = [
  { name: "scheduling", color: "#f5b301" },
  { name: "balance collection", color: "#e5484d" },
  { name: "delivered", color: "#30a46c" },
  { name: "pending reschedule", color: "#f76808" },
  { name: "vip", color: "#8e4ec6" },
];

export const QUICK_REPLIES = [
  { shortcut: "hi", body: "Hi {full_name}, thanks for reaching out to Houzs Century! How can we help you today?" },
  { shortcut: "bank", body: "🏦 Bank: Maybank\n💳 Account Name: Houzs Century Sdn Bhd\n💰 Account No: 5644 1861 0346\nPlease send the payment slip here once done." },
  { shortcut: "delivery", body: "Your delivery for order {ref_1} is scheduled on {delivery_date_1}. Our team will contact you a day before to confirm the time." },
];
