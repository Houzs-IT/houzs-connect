"use client";

import { useState } from "react";
import { importContactsChunk, previewImportPhones } from "./actions";
import {
  buildRows,
  CHUNK_ROWS,
  guessTarget,
  MAX_FILE_BYTES,
  MAX_ROWS,
  MAX_SKIPS_SHOWN,
  parseCsv,
  PREVIEW_ROWS,
  TARGET_EMAIL,
  TARGET_IGNORE,
  TARGET_NAME,
  TARGET_PHONE,
  type CsvRecord,
  type ImportField,
  type PhonePreview,
  type RowOutcome,
  type SkipReason,
} from "./csv";

interface TagOption {
  id: string;
  name: string;
}

type SkippedOutcome = Extract<RowOutcome, { kind: "skipped" }>;

const REASON_LABEL: Record<SkipReason, string> = {
  "no-phone": "No phone number in the row",
  "not-a-number": "Nothing number-like in the phone column",
  "too-short": "Too short to be a phone number",
  "too-long": "Too long to be a phone number",
  scientific: "The spreadsheet mangled the number",
  "not-written": "The database did not confirm the write",
};

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]";
const labelCls = "mb-1 block text-[11px] text-[var(--color-muted)]";
const selectCls =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[12px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
const th = "px-3 py-2 font-medium";
const td = "px-3 py-2 text-[var(--color-muted)]";

/** Thousands separators without a locale, so server and client agree. */
function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

/**
 * Seampify's "Upload Contacts", built where it belongs.
 *
 * Theirs lives inside the campaign wizard, which makes an import a thing you
 * can only do while sending a blast. An import that creates contacts is an
 * address-book operation, so it sits on Contacts — and the campaign targets the
 * batch afterwards through the tag this panel stamps on every row it touched.
 *
 * The file is parsed here in the browser and sent to the server in chunks of
 * CHUNK_ROWS. Next caps a server action body at 20 MB and the action runs in a
 * 128 MB Worker isolate, so a 4,000-row address book goes as twenty small
 * requests instead of one payload that has to be held whole at both ends.
 */
/**
 * The picked file as CSV text. A .csv is already text; a .xlsx is a zip of XML,
 * so it is decoded to CSV with SheetJS — imported on demand (only when an Excel
 * file is actually picked) so the CSV path carries none of that weight. Only the
 * first sheet is read.
 */
async function fileToCsvText(file: File): Promise<string> {
  if (!/\.xlsx?$/i.test(file.name)) return file.text();
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const first = wb.SheetNames[0];
  return first ? XLSX.utils.sheet_to_csv(wb.Sheets[first]) : "";
}

export function ImportContactsButton({
  fields,
  tags,
}: {
  fields: ImportField[];
  tags: TagOption[];
}) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<CsvRecord[]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [preview, setPreview] = useState<PhonePreview[]>([]);
  const [tagName, setTagName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [outcomes, setOutcomes] = useState<RowOutcome[] | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);

  function clearFile() {
    setFileName("");
    setHeaders([]);
    setRecords([]);
    setMapping([]);
    setPreview([]);
    setNotice(null);
    setOutcomes(null);
    setStopped(null);
    setSent(0);
  }

  function startOver() {
    clearFile();
    // Remounts the file input, so picking the same file again still fires.
    setNonce((n) => n + 1);
  }

  async function refreshPreview(body: CsvRecord[], map: string[]) {
    const rows = buildRows(body.slice(0, PREVIEW_ROWS), map);
    // Normalisation is server-side on purpose: normalisePhone() in actions.ts
    // is the one implementation, shared with addContact and the Contacts
    // search. One round trip for five rows shows the operator the exact value
    // the import will key on.
    setPreview(await previewImportPhones(rows.map((r) => r.phone)));
  }

  async function onPick(file: File | null) {
    clearFile();
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setNotice(
        `That file is ${(file.size / 1048576).toFixed(1)} MB. It is parsed here in your browser, so the importer stops at ${MAX_FILE_BYTES / 1048576} MB — split it and import the parts.`
      );
      return;
    }
    setFileName(file.name);

    let text = "";
    try {
      text = await fileToCsvText(file);
    } catch {
      setNotice("That file could not be read.");
      return;
    }

    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      setNotice("There is nothing in that file.");
      return;
    }
    const head = parsed[0].cells.map((h, i) => h.trim() || `Column ${i + 1}`);
    const body = parsed.slice(1);
    if (body.length === 0) {
      setNotice("That file has a header row and nothing under it.");
      return;
    }
    if (body.length > MAX_ROWS) {
      setNotice(
        `That file has ${fmt(body.length)} rows. The importer stops at ${fmt(MAX_ROWS)} — split it and import the parts.`
      );
      return;
    }

    const guessed = head.map((h) => guessTarget(h, fields));
    setHeaders(head);
    setRecords(body);
    setMapping(guessed);
    await refreshPreview(body, guessed);
  }

  function onMap(index: number, value: string) {
    const next = mapping.map((m, i) => (i === index ? value : m));
    setMapping(next);
    void refreshPreview(records, next);
  }

  async function runImport() {
    setBusy(true);
    setStopped(null);
    setSent(0);

    const all = buildRows(records, mapping);
    const acc: RowOutcome[] = [];
    // Phone -> the line that first wrote it. A file that lists the same
    // customer in chunk 1 and chunk 20 would otherwise be reported as an
    // update, which is true of the database and misleading about the file.
    const firstLineFor = new Map<string, number>();

    for (let i = 0; i < all.length; i += CHUNK_ROWS) {
      const slice = all.slice(i, i + CHUNK_ROWS);
      const final = i + CHUNK_ROWS >= all.length;

      let res;
      try {
        res = await importContactsChunk({ rows: slice, tagName: tagName.trim(), final });
      } catch {
        setStopped(
          `The connection failed part way through. ${plural(acc.length, "row was", "rows were")} already accounted for and nothing before that point was lost — re-run the same file to finish it, since a contact that is already in will be updated rather than duplicated.`
        );
        break;
      }
      if (!res.ok) {
        setStopped(res.error);
        break;
      }

      for (const o of res.outcomes) {
        if (o.kind === "created" || o.kind === "updated") {
          const first = firstLineFor.get(o.phone);
          if (first !== undefined) {
            acc.push({ line: o.line, kind: "duplicate", phone: o.phone, ofLine: first });
            continue;
          }
          firstLineFor.set(o.phone, o.line);
        }
        acc.push(o);
      }
      setSent(Math.min(i + CHUNK_ROWS, all.length));
    }

    acc.sort((a, b) => a.line - b.line);
    setOutcomes(acc);
    setBusy(false);
  }

  const phoneMapped = mapping.includes(TARGET_PHONE);
  const previewRows = buildRows(records.slice(0, PREVIEW_ROWS), mapping);
  const skipped: SkippedOutcome[] = (outcomes ?? []).filter(
    (o): o is SkippedOutcome => o.kind === "skipped"
  );
  const created = (outcomes ?? []).filter((o) => o.kind === "created").length;
  const updated = (outcomes ?? []).filter((o) => o.kind === "updated").length;
  const folded = (outcomes ?? []).filter((o) => o.kind === "duplicate").length;

  /**
   * Closing after a finished import clears it, so the next time the panel opens
   * it opens on the file picker rather than on the last run's report.
   */
  function dismiss() {
    setOpen(false);
    if (outcomes !== null) startOver();
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="ml-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
    >
      Import CSV
    </button>
  );

  if (!open) return trigger;

  return (
    <>
      {trigger}
      <div
        role="presentation"
        onClick={() => !busy && dismiss()}
        className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--color-ink)_38%,transparent)] p-6"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Import contacts from a CSV file"
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[86vh] w-[880px] max-w-full flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
        >
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">
              Import contacts from a CSV or Excel file
            </h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
              Every phone number goes through the same normaliser the rest of the CRM uses, so
              011-1110 8822, +60 11-1110 8822 and 601111108822 all land on one contact. A number
              already in the address book is updated, never duplicated.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {/* ── Step 1: pick a file ─────────────────────────────── */}
            {records.length === 0 && (
              <div>
                <label className={labelCls}>CSV or Excel file</label>
                <input
                  key={nonce}
                  type="file"
                  accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
                  className="block w-full text-[12.5px] text-[var(--color-muted)] file:mr-3 file:rounded-lg file:border file:border-[var(--color-border)] file:bg-[var(--color-surface-2)] file:px-3 file:py-1.5 file:text-[12.5px] file:font-medium file:text-[var(--color-ink)]"
                />
                {notice && (
                  <p className="mt-3 text-[12px] text-[var(--color-danger)]">{notice}</p>
                )}
                <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
                  <p>
                    Up to {fmt(MAX_ROWS)} rows and {MAX_FILE_BYTES / 1048576} MB per file. The file
                    is read and parsed here in your browser and the rows are sent {CHUNK_ROWS} at a
                    time, so a 4,000-contact import is twenty small requests rather than one large
                    upload. A bigger file should be split and imported in parts.
                  </p>
                  <p className="mt-2">
                    Excel (.xlsx / .xls) is read directly — its first sheet is used. For a text
                    file, comma, semicolon and tab separators are all detected; quoted fields,
                    commas and line breaks inside a quoted field, and Windows line endings are
                    handled. Blank lines are ignored. The first row is treated as the header.
                  </p>
                </div>
              </div>
            )}

            {/* ── Step 2: map, preview, tag ───────────────────────── */}
            {records.length > 0 && outcomes === null && (
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[12.5px] text-[var(--color-ink)]">
                    <span className="font-medium">{fileName}</span>
                    <span className="text-[var(--color-faint)]">
                      {" "}
                      — {plural(records.length, "row", "rows")}, {plural(headers.length, "column", "columns")}
                    </span>
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={startOver}
                    className="text-[11.5px] text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
                  >
                    Choose a different file
                  </button>
                </div>

                <h3 className="mt-4 text-[12px] font-semibold text-[var(--color-ink)]">
                  Match the columns
                </h3>
                <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">
                  Anything left on Ignore is not imported. Where two columns carry the same field,
                  the first one with a value in it wins.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {headers.map((h, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2"
                    >
                      <span
                        className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-ink)]"
                        title={h}
                      >
                        {h}
                      </span>
                      <span className="text-[var(--color-faint)]">→</span>
                      <div className="w-[160px] shrink-0">
                        <select
                          value={mapping[i] ?? TARGET_IGNORE}
                          aria-label={`Import the column ${h} as`}
                          onChange={(e) => onMap(i, e.target.value)}
                          className={selectCls}
                        >
                          <option value={TARGET_IGNORE}>Ignore</option>
                          <option value={TARGET_NAME}>Name</option>
                          <option value={TARGET_PHONE}>Phone</option>
                          <option value={TARGET_EMAIL}>Email</option>
                          {fields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                {!phoneMapped && (
                  <p className="mt-3 text-[12px] text-[var(--color-danger)]">
                    Map one column to Phone. It is the key every contact is stored under, so
                    nothing can be imported without it.
                  </p>
                )}

                <h3 className="mt-5 text-[12px] font-semibold text-[var(--color-ink)]">
                  First {Math.min(PREVIEW_ROWS, records.length)} rows
                </h3>
                <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--color-border)]">
                  <table className="w-full min-w-[640px] text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                        <th className={th}>Line</th>
                        <th className={th}>Phone in the file</th>
                        <th className={th}>Saved as</th>
                        <th className={th}>Name</th>
                        <th className={th}>Email</th>
                        <th className={th}>Fields</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => {
                        const p = preview[i];
                        const attrCount = Object.keys(r.attributes).length;
                        return (
                          <tr
                            key={r.line}
                            className="border-b border-[var(--color-border)] last:border-0"
                          >
                            <td className="px-3 py-2 text-[var(--color-faint)]">{r.line}</td>
                            <td className="px-3 py-2 font-mono text-[11.5px] text-[var(--color-muted)]">
                              {r.phone || "—"}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11.5px]">
                              {p?.ok ? (
                                <span className="text-[var(--color-ink)]">+{p.phone}</span>
                              ) : (
                                <span
                                  className="text-[var(--color-danger)]"
                                  title={p?.message ?? ""}
                                >
                                  skipped
                                </span>
                              )}
                            </td>
                            <td className={td}>{r.name || "—"}</td>
                            <td className={td}>{r.email || "—"}</td>
                            <td className={td}>{attrCount > 0 ? fmt(attrCount) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-5 max-w-[420px]">
                  <label className={labelCls} htmlFor="import-tag">
                    Tag everything in this import (optional)
                  </label>
                  <input
                    id="import-tag"
                    list="import-tag-options"
                    value={tagName}
                    disabled={busy}
                    onChange={(e) => setTagName(e.target.value)}
                    placeholder="e.g. Raya 2026 list"
                    className={inputCls}
                  />
                  <datalist id="import-tag-options">
                    {tags.map((t) => (
                      <option key={t.id} value={t.name} />
                    ))}
                  </datalist>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
                    Pick an existing tag or type a new one — a new name is created on import. This
                    is how a campaign targets exactly this batch afterwards: Campaigns, audience by
                    tag.
                  </p>
                </div>
              </div>
            )}

            {/* ── Step 3: what happened ───────────────────────────── */}
            {outcomes !== null && (
              <div>
                {stopped && (
                  <p className="mb-3 rounded-lg border border-[var(--color-danger)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-danger)]">
                    {stopped}
                  </p>
                )}
                <p className="text-[12.5px] text-[var(--color-ink)]">
                  <span className="font-medium">{fileName}</span>
                  <span className="text-[var(--color-faint)]">
                    {" "}
                    —{" "}
                    {/* An import that stopped early says so in the total, not
                        just in the banner above it. */}
                    {outcomes.length < records.length
                      ? `${fmt(outcomes.length)} of ${fmt(records.length)} rows accounted for`
                      : `${plural(outcomes.length, "row", "rows")} accounted for`}
                  </span>
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {[
                    { label: "New contacts", value: created },
                    { label: "Updated", value: updated },
                    { label: "Folded into an earlier row", value: folded },
                    { label: "Skipped", value: skipped.length },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5"
                    >
                      <div className="text-[18px] font-semibold text-[var(--color-ink)]">
                        {fmt(s.value)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--color-faint)]">{s.label}</div>
                    </div>
                  ))}
                </div>

                {tagName.trim() && created + updated > 0 && (
                  <p className="mt-3 text-[11.5px] text-[var(--color-muted)]">
                    {plural(created + updated, "contact carries", "contacts carry")} the tag
                    <span className="font-medium text-[var(--color-ink)]"> {tagName.trim()}</span>.
                    Target them from a campaign with audience by tag.
                  </p>
                )}

                {folded > 0 && (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
                    {plural(folded, "row was", "rows were")} the same phone number as an earlier row
                    in the file once normalised, so they were merged into that contact rather than
                    written twice.
                  </p>
                )}

                {skipped.length === 0 ? (
                  <p className="mt-4 text-[12px] text-[var(--color-muted)]">
                    Nothing was skipped.
                  </p>
                ) : (
                  <div className="mt-4">
                    <h3 className="text-[12px] font-semibold text-[var(--color-ink)]">
                      Skipped rows, and why
                    </h3>
                    <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">
                      Line numbers are the lines in the file, so they match the row numbers in the
                      spreadsheet.
                      {skipped.length > MAX_SKIPS_SHOWN
                        ? ` Showing the first ${fmt(MAX_SKIPS_SHOWN)} of ${fmt(skipped.length)}.`
                        : ""}
                    </p>
                    <div className="mt-2 max-h-[260px] overflow-y-auto rounded-lg border border-[var(--color-border)]">
                      <table className="w-full text-left text-[12px]">
                        <thead className="sticky top-0 bg-[var(--color-surface-2)]">
                          <tr className="border-b border-[var(--color-border)] text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                            <th className={th}>Line</th>
                            <th className={th}>Reason</th>
                            <th className={th}>Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skipped.slice(0, MAX_SKIPS_SHOWN).map((s) => (
                            <tr
                              key={s.line}
                              className="border-b border-[var(--color-border)] last:border-0"
                            >
                              <td className="px-3 py-2 text-[var(--color-faint)]">{s.line}</td>
                              <td className="px-3 py-2 text-[var(--color-ink)]">
                                {REASON_LABEL[s.reason]}
                              </td>
                              <td className={td}>{s.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-4">
            <span className="text-[11.5px] text-[var(--color-faint)]">
              {busy && records.length > 0
                ? `Importing… ${fmt(sent)} of ${fmt(records.length)} rows sent`
                : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={dismiss}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
              >
                {outcomes === null ? "Cancel" : "Close"}
              </button>
              {outcomes === null ? (
                <button
                  type="button"
                  disabled={busy || !phoneMapped || records.length === 0}
                  onClick={() => void runImport()}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Importing…" : `Import ${plural(records.length, "row", "rows")}`}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startOver}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white"
                >
                  Import another file
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
