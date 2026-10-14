// Pure smoke for IT Support's shared rules (src/lib/it-support/shared.ts): the
// tabs, the attachment limits the hub enforces, which hub answers reach the
// person, and which request codes may be forwarded. No DB, no network.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const { IT_CODE, IT_MAX_BYTES, IT_STATUSES, isItStatus, itAddFiles, itInTab, itRelayStatus, itStatusTone } =
  await import("../src/lib/it-support/shared.ts");

// Tabs: every state lands in exactly one of Active / Resolved, and All shows everything.
for (const s of IT_STATUSES) {
  assert(itInTab(s, "all"), `${s} shows under All`);
  assert(itInTab(s, "active") !== itInTab(s, "resolved"), `${s} is in exactly one of Active and Resolved`);
}
for (const s of ["resolved", "closed", "rejected"]) assert(itInTab(s, "resolved"), `${s} is Resolved`);
for (const s of ["open", "in_progress", "on_hold", "testing", "waiting_reporter"]) assert(itInTab(s, "active"), `${s} is Active`);
assert(itInTab("some_new_state", "active"), "a state the hub adds later still shows under Active, not nowhere");

// States: unknown ones are recognised as unknown, and still get a chip colour.
assert(isItStatus("waiting_reporter") && !isItStatus("archived"), "isItStatus knows the eight states only");
assert(itStatusTone("resolved") === "green" && itStatusTone("waiting_reporter") === "orange", "Done is green, Waiting for you is orange");
assert(itStatusTone("archived") === "neutral", "an unknown state is neutral, not an error");

// Attachments: type, size and count, with a reason for each file left out.
const f = (name, type, size = 1000) => ({ name, type, size });
let r = itAddFiles([], [f("a.png", "image/png"), f("b.pdf", "application/pdf"), f("c.mp4", "video/mp4"), f("d.mov", "video/quicktime")]);
assert(r.take.length === 4 && r.skipped.length === 0, "pictures, PDF, MP4 and MOV are accepted");
r = itAddFiles([], [f("x.exe", "application/x-msdownload"), f("y.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")]);
assert(r.take.length === 0 && r.skipped.length === 2, "other file types are refused with a reason each");
r = itAddFiles([], [f("big.png", "image/png", IT_MAX_BYTES + 1), f("ok.png", "image/png", IT_MAX_BYTES)]);
assert(r.take.join() === "1" && /larger than 10 MB/.test(r.skipped[0]), "over 10 MB is refused, exactly 10 MB is fine");
const four = [1, 2, 3, 4].map((i) => f(`${i}.png`, "image/png"));
r = itAddFiles(four, [f("5.png", "image/png"), f("6.png", "image/png")]);
assert(r.take.join() === "0" && /at most 5 files/.test(r.skipped[0]), "a sixth file is refused, the fifth is taken");

// Relay: the hub's own sentences for the reporter pass through; anything else is "unavailable".
for (const s of [400, 404, 409]) assert(itRelayStatus(s) === "pass", `${s} from the hub reaches the person`);
for (const s of [401, 403, 500, 502, 503]) assert(itRelayStatus(s) === "unavailable", `${s} from the hub is shown as unavailable`);

// Codes: only the hub's shapes are forwarded into a hub path.
for (const c of ["CONNECT-0001", "HK-1", "CONTS-0042", "2990-0007"]) assert(IT_CODE.test(c), `${c} is a request code`);
for (const c of ["connect-0001", "CONNECT-", "../tickets", "CONNECT-1/confirm", "TOOLONGCODE-1", "HK-0001?x=1"]) {
  assert(!IT_CODE.test(c), `${c} is refused`);
}

console.log("smoke-it-support: all assertions passed");
