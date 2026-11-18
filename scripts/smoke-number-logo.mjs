// Pure smoke for the number-card logo (CONNECT-0004): no DB, no network.
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";
registerCjs();
registerEsm();
const { numberLogoSrc } = await import("../src/lib/whatsapp/number-logo.ts");
const assert = (c, m) => { if (!c) throw new Error(`ASSERT FAILED: ${m}`); };
assert(numberLogoSrc("houzs-century") === "/logo-hc-mark.png", "Houzs keeps its mark");
for (const s of ["2990", "hookka", "the-conts", null, undefined, ""])
  assert(numberLogoSrc(s) === null, `${s} must not get the Houzs mark`);
console.log("number-logo smoke: ok");
