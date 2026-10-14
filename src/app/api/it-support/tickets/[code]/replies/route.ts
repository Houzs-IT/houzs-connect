import { hubFetch, hubFor, itJson, readForm, relay } from "@/lib/it-support/hub";
import { IT_CODE, itAddFiles } from "@/lib/it-support/shared";

/** POST /api/it-support/tickets/:code/replies (multipart: body, files) — my reply to IT. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const hub = await hubFor();
  if (hub instanceof Response) return hub;
  const { code } = await params;
  if (!IT_CODE.test(code)) return itJson({ error: "Not found" }, 404);
  const input = await readForm(req);
  if (!input) return itJson({ error: "Invalid request body" }, 400);
  const body = (input.fields.body ?? "").trim();
  if (!body && input.files.length === 0) return itJson({ error: "Write a reply or attach a file." }, 400);
  const files = itAddFiles([], input.files);
  if (files.skipped.length) return itJson({ error: files.skipped.join("; ") }, 400);

  const out = new FormData();
  if (body) out.set("body", body);
  for (const file of input.files) out.append("files", file, file.name);
  return relay(hubFetch(hub, `/tickets/${code}/replies`, { method: "POST", body: out }));
}
