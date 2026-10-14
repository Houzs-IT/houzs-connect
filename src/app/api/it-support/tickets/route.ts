import { hubFetch, hubFor, itJson, readForm, relay } from "@/lib/it-support/hub";
import { IT_KINDS, IT_STATUSES, IT_URGENCIES, itAddFiles } from "@/lib/it-support/shared";

/** GET /api/it-support/tickets?status=a,b — the signed-in person's own requests. */
export async function GET(req: Request) {
  const hub = await hubFor();
  if (hub instanceof Response) return hub;
  const wanted = (new URL(req.url).searchParams.get("status") ?? "").split(",");
  const statuses = wanted.filter((s) => (IT_STATUSES as readonly string[]).includes(s));
  return relay(hubFetch(hub, `/tickets${statuses.length ? `?status=${statuses.join(",")}` : ""}`));
}

// What the browser may set on a new request. Who is reporting (name, email,
// phone, department) and the browser are filled in here, never taken from it.
const FIELDS = ["title", "description", "type", "priority", "occurred_at", "page_url"] as const;

/** POST /api/it-support/tickets (multipart: the fields above + `files`) — report a problem. */
export async function POST(req: Request) {
  const hub = await hubFor();
  if (hub instanceof Response) return hub;
  const input = await readForm(req);
  if (!input) return itJson({ error: "Invalid request body" }, 400);
  const f = input.fields;
  if (!f.title?.trim()) return itJson({ error: "Say in a few words what the problem is." }, 400);
  if (f.type && !(IT_KINDS as readonly string[]).includes(f.type)) return itJson({ error: "Unknown kind of request" }, 400);
  if (f.priority && !(IT_URGENCIES as readonly string[]).includes(f.priority)) return itJson({ error: "Unknown urgency" }, 400);
  const files = itAddFiles([], input.files);
  if (files.skipped.length) return itJson({ error: files.skipped.join("; ") }, 400);

  const out = new FormData();
  for (const k of FIELDS) if (f[k]?.trim()) out.set(k, f[k].trim());
  const me = hub.me;
  out.set("reporter_name", me.name || me.email);
  out.set("reporter_email", me.email);
  if (me.phone) out.set("reporter_phone", me.phone);
  if (me.department?.name) out.set("reporter_department", me.department.name);
  const agent = req.headers.get("user-agent");
  if (agent) out.set("user_agent", agent.slice(0, 500));
  for (const file of input.files) out.append("files", file, file.name);
  return relay(hubFetch(hub, "/tickets", { method: "POST", body: out }));
}
