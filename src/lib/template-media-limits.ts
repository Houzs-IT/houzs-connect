// What a template header file may be. Shared by the editor (file picker hints)
// and the server actions (the real check). Plain constants, so a client
// component can import it without pulling in the database.

export type HeaderMediaFormat = "IMAGE" | "DOCUMENT";

/**
 * Meta's own rules for template headers are JPEG / PNG up to 5 MB and PDF up
 * to 100 MB. Connect keeps the file in Postgres, so documents get the same
 * 5 MB cap as images: a catalogue PDF for WhatsApp should be small anyway.
 */
export const HEADER_MEDIA: Record<HeaderMediaFormat, { types: string[]; accept: string; maxBytes: number }> = {
  IMAGE: { types: ["image/jpeg", "image/png"], accept: "image/jpeg,image/png", maxBytes: 5 * 1024 * 1024 },
  DOCUMENT: { types: ["application/pdf"], accept: "application/pdf", maxBytes: 5 * 1024 * 1024 },
};

export function isHeaderMediaFormat(v: unknown): v is HeaderMediaFormat {
  return v === "IMAGE" || v === "DOCUMENT";
}

/** Null when the file fits the format; otherwise why not, in words. */
export function headerFileProblem(format: HeaderMediaFormat, file: { type: string; size: number }): string | null {
  const rule = HEADER_MEDIA[format];
  if (!rule.types.includes(file.type)) {
    return format === "IMAGE" ? "The header image must be a JPEG or PNG." : "The header document must be a PDF.";
  }
  if (file.size === 0) return "The file is empty.";
  if (file.size > rule.maxBytes) return "The file is over 5 MB.";
  return null;
}
