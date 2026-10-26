// IT Support: logic shared by the API routes and the screen, with no server or
// browser dependency so scripts/smoke-it-support.mjs can pin it.
//
// The requests live in the Houzs IT Hub (support.houzscentury.com), not in
// Connect's database. Every Houzs system's IT Support follows one standard set of
// rules (states, words, upload limits, tabs); this file is Connect's copy of them.

export type ItStatus =
  | "open" | "in_progress" | "on_hold" | "testing" | "waiting_reporter" | "resolved" | "closed" | "rejected";

export const IT_STATUSES: readonly ItStatus[] = [
  "open", "in_progress", "on_hold", "testing", "waiting_reporter", "resolved", "closed", "rejected",
];
export const IT_KINDS = ["bug", "development"] as const;
export const IT_URGENCIES = ["urgent", "high", "medium", "low"] as const;
export type ItKind = (typeof IT_KINDS)[number];
export type ItUrgency = (typeof IT_URGENCIES)[number];

export interface ItRequestRow {
  code: string; type: string; priority: string; status: string; title: string;
  created_at: string; updated_at: string; assignee_name: string | null; unread: boolean;
}
export interface ItFileRef { id: number; event_id: number; filename: string; mime: string; size: number }
export interface ItStep {
  id: number; kind: "created" | "comment" | "status" | "assign" | "priority" | "type";
  author_kind: "reporter" | "developer" | "system"; author_name: string;
  body: string | null; from_value: string | null; to_value: string | null; created_at: string;
  attachments: ItFileRef[];
}
export interface ItDetail {
  ticket: {
    code: string; type: string; priority: string; status: string; title: string; description: string;
    occurred_at?: string | null; page_url?: string | null; assignee_name: string | null;
    created_at: string; updated_at: string;
  };
  events: ItStep[];
}

export const IT_MAX_FILES = 5;
export const IT_MAX_BYTES = 10 * 1024 * 1024;
export const IT_ACCEPT = "image/*,video/mp4,video/quicktime,application/pdf,.zip";
/** Request codes the hub hands out, e.g. CONNECT-0001. Anything else never reaches the hub. */
export const IT_CODE = /^[A-Z0-9]{2,8}-\d{1,8}$/;

/** The three tabs on "My requests". Active is everything still with IT or with the reporter. */
export type ItTab = "all" | "active" | "resolved";
const RESOLVED: ReadonlySet<string> = new Set(["resolved", "closed", "rejected"]);
export function itInTab(status: string, tab: ItTab): boolean {
  if (tab === "all") return true;
  return tab === "resolved" ? RESOLVED.has(status) : !RESOLVED.has(status);
}

/** Whether a state is one this build knows; an unknown one is shown as the hub spelled it. */
export const isItStatus = (s: string): s is ItStatus => (IT_STATUSES as readonly string[]).includes(s);

/** The colour family of a state chip (Connect's pastel tokens). */
export function itStatusTone(s: string): "neutral" | "blue" | "purple" | "orange" | "green" | "red" {
  switch (s) {
    case "in_progress": return "blue";
    case "testing": return "purple";
    case "waiting_reporter": return "orange";
    case "resolved": return "green";
    case "rejected": return "red";
    default: return "neutral";
  }
}

/** A .zip goes by its name: browsers label it application/zip, application/x-zip-compressed or nothing. */
const isAllowedFile = ({ name, type }: { name: string; type: string }) =>
  type.startsWith("image/") || type === "application/pdf" || type === "video/mp4" || type === "video/quicktime" ||
  name.toLowerCase().endsWith(".zip");

/**
 * Files added to an attachment list (picked, dropped or pasted): the new list, and
 * one line for each file left out. The file browser's `accept` only filters the
 * picker; drop and paste come through here too.
 */
export function itAddFiles(
  current: readonly { name: string; size: number; type: string }[],
  added: readonly { name: string; size: number; type: string }[],
): { take: number[]; skipped: string[] } {
  const take: number[] = [];
  const skipped: string[] = [];
  let room = IT_MAX_FILES - current.length;
  added.forEach((f, i) => {
    if (!isAllowedFile(f)) skipped.push(`${f.name}: only pictures, PDF, MP4, MOV or ZIP`);
    else if (f.size > IT_MAX_BYTES) skipped.push(`${f.name} is larger than 10 MB`);
    else if (room <= 0) skipped.push(`${f.name}: at most ${IT_MAX_FILES} files`);
    else { take.push(i); room -= 1; }
  });
  return { take, skipped };
}

/** The hub's answer turned into ours. Its 4xx sentences are written for the reporter and pass through. */
export function itRelayStatus(hubStatus: number): "pass" | "unavailable" {
  return hubStatus === 400 || hubStatus === 404 || hubStatus === 409 ? "pass" : "unavailable";
}
