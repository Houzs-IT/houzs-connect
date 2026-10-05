// A template's header file: kept when the template is made, attached to every send.
//
// Meta reviews an IMAGE / DOCUMENT header template against a SAMPLE
// (example.header_handle) and keeps only that. Each send must carry its own
// header parameter, or Meta refuses it. So Connect keeps the file the editor was
// given (connect.template_media) and, at send time, uploads it to the sending
// number (POST /{phone-number-id}/media) and attaches the media id.
//
// A media id belongs to the number that uploaded it and lasts 30 days, so ids
// are cached per number in `uploads` and renewed after 25 days: a campaign
// uploads the file once, not once per customer.

import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { ensureTemplateMediaTable } from "@/db/ensure-template-media";
import { bypassReadCache } from "@/db/fresh";
import { templateMedia } from "@/db/schema";
import { base64ToBytes, bytesToBase64 } from "@/lib/member-photo";
import { isHeaderMediaFormat, type HeaderMediaFormat } from "@/lib/template-media-limits";
import { mediaConfig, uploadMedia } from "./media";

const REUSE_MS = 25 * 24 * 60 * 60 * 1000;

/** The WABA the template list and every send use (templates.ts templateConfig). */
const wabaId = () => process.env.WHATSAPP_WABA_ID || null;

export const headerKey = (name: string, language: string) => `${name}|${language}`;

export type StoredHeader = { id: string; format: HeaderMediaFormat; fileName: string; mimeType: string; updatedAt: Date };

/** Keep (or replace) the header file for one template. Clears cached media ids. */
export async function saveTemplateMedia(
  db: DB,
  p: { name: string; language: string; format: HeaderMediaFormat; mimeType: string; fileName: string; bytes: ArrayBuffer; by?: string | null }
): Promise<void> {
  const waba = wabaId();
  if (!waba) throw new Error("WhatsApp is not connected.");
  await ensureTemplateMediaTable(db);
  const row = {
    format: p.format,
    mimeType: p.mimeType,
    fileName: p.fileName,
    data: bytesToBase64(new Uint8Array(p.bytes)),
    uploads: {},
    updatedAt: new Date(),
    updatedBy: p.by ?? null,
  };
  await db
    .insert(templateMedia)
    .values({ wabaId: waba, templateName: p.name, language: p.language, ...row })
    .onConflictDoUpdate({ target: [templateMedia.wabaId, templateMedia.templateName, templateMedia.language], set: row });
}

/** Every stored header on this WABA, keyed by headerKey(name, language). No file bytes. */
export async function storedHeaders(db: DB): Promise<Map<string, StoredHeader>> {
  const out = new Map<string, StoredHeader>();
  const waba = wabaId();
  if (!waba) return out;
  try {
    await ensureTemplateMediaTable(db);
    const rows = await db
      .select({
        id: templateMedia.id,
        name: templateMedia.templateName,
        language: templateMedia.language,
        format: templateMedia.format,
        fileName: templateMedia.fileName,
        mimeType: templateMedia.mimeType,
        updatedAt: templateMedia.updatedAt,
      })
      .from(templateMedia)
      // Fresh: the page shows a file someone added a second ago.
      .where(and(eq(templateMedia.wabaId, waba), bypassReadCache()));
    for (const r of rows) {
      if (!isHeaderMediaFormat(r.format)) continue;
      out.set(headerKey(r.name, r.language), { id: r.id, format: r.format, fileName: r.fileName, mimeType: r.mimeType, updatedAt: r.updatedAt });
    }
  } catch (e) {
    console.warn("[template-media] list failed:", e);
  }
  return out;
}

/** One stored file with its bytes, for the staff preview route. */
export async function storedHeaderFile(db: DB, id: string) {
  await ensureTemplateMediaTable(db);
  const [row] = await db
    .select({ data: templateMedia.data, mimeType: templateMedia.mimeType, fileName: templateMedia.fileName, updatedAt: templateMedia.updatedAt })
    .from(templateMedia)
    .where(and(eq(templateMedia.id, id), bypassReadCache()))
    .limit(1);
  return row ? { bytes: base64ToBytes(row.data), mimeType: row.mimeType, fileName: row.fileName, updatedAt: row.updatedAt } : null;
}

/**
 * The `header` component for sending this template from `senderPhoneId`, or
 * null when Connect holds no header file for it (a text-header template, or
 * one made outside Connect that nobody has given a file yet). `ok: false` when
 * the file exists but could not be uploaded: the send should fail with that
 * reason rather than go out without the header Meta will ask for.
 */
export async function headerForSend(
  db: DB,
  name: string,
  language: string,
  senderPhoneId: string
): Promise<{ ok: true; component: Record<string, unknown> } | { ok: false; error: string } | null> {
  const waba = wabaId();
  if (!waba) return null;
  let row: { id: string; format: string; mimeType: string; fileName: string; uploads: unknown } | undefined;
  try {
    await ensureTemplateMediaTable(db);
    [row] = await db
      .select({
        id: templateMedia.id,
        format: templateMedia.format,
        mimeType: templateMedia.mimeType,
        fileName: templateMedia.fileName,
        uploads: templateMedia.uploads,
      })
      .from(templateMedia)
      // Fresh: a file replaced a minute ago must not lose to Hyperdrive's copy.
      .where(and(eq(templateMedia.wabaId, waba), eq(templateMedia.templateName, name), eq(templateMedia.language, language), bypassReadCache()))
      .limit(1);
  } catch (e) {
    console.warn("[template-media] lookup failed:", e);
    return null;
  }
  if (!row || !isHeaderMediaFormat(row.format)) return null;

  const cached = (row.uploads as Record<string, { id?: string; at?: number }> | null)?.[senderPhoneId];
  let mediaId = cached?.id && cached.at && Date.now() - cached.at < REUSE_MS ? cached.id : null;
  if (!mediaId) {
    const cfg = mediaConfig(senderPhoneId);
    if (!cfg) return { ok: false, error: "WhatsApp is not connected." };
    const file = await storedHeaderFile(db, row.id);
    if (!file) return null;
    const up = await uploadMedia(cfg, new Blob([file.bytes], { type: row.mimeType }), row.fileName, row.mimeType);
    if (!up.ok) return { ok: false, error: `The template's header file could not be uploaded to WhatsApp: ${up.error}` };
    mediaId = up.data.id;
    // Best effort: without the cache the next send just uploads again.
    await db
      .execute(sql`
        update connect.template_media
        set uploads = uploads || ${JSON.stringify({ [senderPhoneId]: { id: mediaId, at: Date.now() } })}::jsonb
        where id = ${row.id}
      `)
      .catch((e) => console.warn("[template-media] cache write failed:", e));
  }

  const component =
    row.format === "DOCUMENT"
      ? { type: "header", parameters: [{ type: "document", document: { id: mediaId, filename: row.fileName } }] }
      : { type: "header", parameters: [{ type: "image", image: { id: mediaId } }] };
  return { ok: true, component };
}
