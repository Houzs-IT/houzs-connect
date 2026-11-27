// The ?highlight=<label> matcher (AI Connector round 5). Shared by the in-app
// helper (components/shell/HighlightFromUrl.tsx) and the show_me screenshot
// capture, so a box in a screenshot is exactly the element the live link
// outlines. Read-only: never clicks or edits. Pure DOM — no React, no app code.
const INTERACTIVE = "button, a, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [role='switch'], summary, label, input[type='button'], input[type='submit']";
const SCAN = `${INTERACTIVE}, th, h1, h2, h3, h4, legend, span, div, p, li, td, dt, input, textarea, select`;

/** A label for comparing: whitespace collapsed, trimmed, lower case. */
export const normLabel = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const tight = (s: string): string => s.replace(/\s+/g, "").toLowerCase();

const visible = (el: Element): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const view = el.ownerDocument.defaultView;
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n instanceof HTMLElement && n.hidden) return false;
    if (n.getAttribute("aria-hidden") === "true") return false;
    const style = view?.getComputedStyle(n);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  }
  return true;
};

const laidOut = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  const width = el.ownerDocument.defaultView?.innerWidth ?? Infinity;
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < width;
};

/** The element's text (an input button's value). The deepest match wins below, so a card never beats its own button. */
const ownText = (el: Element): string => {
  if (el instanceof HTMLInputElement && (el.type === "button" || el.type === "submit")) return el.value;
  return el.textContent ?? "";
};

/** Only the element's direct text nodes: a tab "Overdue" with a count badge child still reads "Overdue". */
const directText = (el: Element): string =>
  Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent ?? "")
    .join(" ");

const matches = (candidate: string, want: string): boolean => {
  if (!candidate) return false;
  return normLabel(candidate) === normLabel(want) || tight(candidate) === tight(want);
};

/**
 * The visible element whose text (or aria-label / title / placeholder) is one of the labels, trimmed
 * and case-insensitive. `labels` = the English label first, then the same label in the person's UI
 * language (Connect's dictionary). The deepest text match wins, then its nearest interactive ancestor
 * is returned (a span inside a button gives the button).
 */
export function findHighlightTarget(root: ParentNode, labels: string | readonly string[]): HTMLElement | null {
  const wants = (typeof labels === "string" ? [labels] : [...labels]).filter((l) => normLabel(l));
  if (!wants.length) return null;
  const shown = Array.from(root.querySelectorAll(SCAN)).filter(visible);
  const all = shown.some(laidOut) ? shown.filter(laidOut) : shown;
  for (const label of wants) {
    const byAttr = all.find((el) => ["aria-label", "title", "placeholder"].some((a) => matches(el.getAttribute(a) ?? "", label)));
    const byText = all.filter((el) => matches(ownText(el), label) || matches(directText(el), label));
    const deepest = byText.filter((el) => !byText.some((o) => o !== el && el.contains(o)));
    const first: Element | undefined = deepest.length ? deepest[0] : undefined;
    const pick = deepest.find((el) => el.closest(INTERACTIVE)) ?? first ?? byAttr;
    if (!pick) continue;
    const interactive = pick.closest(INTERACTIVE);
    return (interactive instanceof HTMLElement ? interactive : pick) as HTMLElement;
  }
  return null;
}

/**
 * The same label in another dictionary: every string leaf of `from` equal to `label` gives the leaf
 * at the same path in `to` (e.g. "Resolve" in English -> the Chinese button text).
 */
export function translateLabel(label: string, from: unknown, to: unknown): string[] {
  const out = new Set<string>();
  const want = normLabel(label);
  const walk = (a: unknown, b: unknown) => {
    if (typeof a === "string") {
      if (typeof b === "string" && normLabel(a) === want && normLabel(b) !== want) out.add(b);
      return;
    }
    if (!a || typeof a !== "object" || !b || typeof b !== "object") return;
    for (const k of Object.keys(a)) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
  };
  walk(from, to);
  return [...out];
}

/** The URL without its highlight parameter (other parameters and the hash kept). */
export function withoutHighlight(href: string): string {
  const u = new URL(href);
  u.searchParams.delete("highlight");
  return `${u.pathname}${u.search}${u.hash}`;
}
