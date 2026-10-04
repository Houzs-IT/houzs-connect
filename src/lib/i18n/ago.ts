import { agoParts } from "@/lib/format";
import { fmt, type Dict } from "./dict";

/** "2 weeks ago" / "2 周前", from the shell's wording. */
export function agoLabel(t: Dict, d: Date | string): string {
  const p = agoParts(d);
  const one = p.n === 1 && (p.unit === "d" || p.unit === "w" || p.unit === "mo");
  return fmt(t.shell.ago[one ? `${p.unit}1` : p.unit], { n: p.n });
}
