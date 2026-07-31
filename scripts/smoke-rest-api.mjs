// Hermetic smoke test for the call_rest_api node's outbound HTTP (no DB, no
// internet). Everything it talks to is a throwaway loopback server started by
// this script, so CI never touches the owner's real Google Apps Script
// endpoints — but the code under test is the REAL lib/automation/rest.ts.
//
// Asserts the contract the automation engine depends on:
//   - {variable} / {{variable}} interpolation reaches URL, headers AND body
//   - default Content-Type is application/json for a JSON body
//   - a non-2xx response is reported as a failure, not thrown
//   - a connection that cannot be established resolves (run continues)
//   - a hung endpoint aborts on the timeout instead of wedging the run
//   - non-http(s) schemes are refused before any request is made
//   - logged/saved response text is capped
//
// Runs under tsx (same hooks as the other smokes) so it can import the real .ts.
//   node scripts/smoke-rest-api.mjs

import { createServer } from "node:http";
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

/** Start a loopback server; resolves with { url, close }. */
function serve(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(done);
          }),
      });
    });
  });
}

async function main() {
  const { callRestApi, REST_LOG_SNIPPET_CHARS, REST_SAVE_MAX_CHARS } = await import(
    "../src/lib/automation/rest.ts"
  );

  // Contact context mirrors what the engine builds for every node.
  const ctx = {
    full_name: "Wei Siang",
    phone: "60123456789",
    attributes: { ref_1: "HC-1042", delivery_date: "2026-08-14", token: "s3cr3t" },
  };

  // ── 1. Happy path: echo server records exactly what was sent ──
  let seen = null;
  const echo = await serve((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen = { method: req.method, url: req.url, headers: req.headers, body: raw };
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK-ROW-APPENDED");
    });
  });

  const ok = await callRestApi(
    {
      method: "post", // lower case on purpose: must be normalised
      url: `${echo.url}/exec?ref={ref_1}`,
      headers: "X-Token: {token}",
      body: '{"ref":"{ref_1}","date":"{delivery_date}","name":"{full_name}"}',
    },
    ctx
  );

  assert(ok.ok === true, `expected ok, got ${JSON.stringify(ok)}`);
  assert(ok.status === 200, `expected 200, got ${ok.status}`);
  assert(ok.method === "POST", `method must normalise to POST, got ${ok.method}`);
  assert(ok.text === "OK-ROW-APPENDED", `unexpected response text: ${ok.text}`);
  assert(seen.url === "/exec?ref=HC-1042", `URL vars must interpolate, got ${seen.url}`);
  assert(seen.headers["x-token"] === "s3cr3t", `header vars must interpolate, got ${seen.headers["x-token"]}`);
  assert(
    seen.headers["content-type"] === "application/json",
    `JSON body must default to application/json, got ${seen.headers["content-type"]}`
  );
  const sent = JSON.parse(seen.body);
  assert(sent.ref === "HC-1042", `body attribute var must interpolate, got ${sent.ref}`);
  assert(sent.date === "2026-08-14", `body attribute var must interpolate, got ${sent.date}`);
  assert(sent.name === "Wei Siang", `body built-in var must interpolate, got ${sent.name}`);

  // ── 2. Response capping (log snippet vs saved attribute) ──
  const bigServer = await serve((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("x".repeat(5000));
  });
  const big = await callRestApi({ method: "GET", url: bigServer.url }, ctx);
  await bigServer.close();
  assert(big.ok === true, "big-response call should succeed");
  assert(
    big.snippet.length <= REST_LOG_SNIPPET_CHARS + 1,
    `log snippet must be capped, got ${big.snippet.length}`
  );
  assert(
    big.text.length <= REST_SAVE_MAX_CHARS + 1,
    `saved text must be capped, got ${big.text.length}`
  );

  // ── 3. Non-2xx: reported as failure, never thrown ──
  const failServer = await serve((_req, res) => {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Apps Script exception");
  });
  const bad = await callRestApi({ url: failServer.url, body: "ping" }, ctx);
  await failServer.close();
  assert(bad.ok === false, "500 must be reported as not ok");
  assert(bad.status === 500, `expected status 500, got ${bad.status}`);
  assert(bad.error === "HTTP 500", `expected HTTP 500 error, got ${bad.error}`);
  assert(bad.snippet.includes("Apps Script exception"), "failure body should be logged");

  // ── 4. Unreachable endpoint: the port we just closed. Resolves, no throw. ──
  const dead = await callRestApi({ url: `${failServer.url}/exec` }, ctx);
  assert(dead.ok === false, "unreachable endpoint must be reported as not ok");
  assert(dead.status === null, `unreachable endpoint has no status, got ${dead.status}`);
  assert(typeof dead.error === "string" && dead.error.length > 0, "unreachable endpoint must log an error");

  // ── 5. Hung endpoint: aborts on the timeout (short one for the test) ──
  const hang = await serve(() => {
    /* never responds */
  });
  const startedAt = Date.now();
  const timedOut = await callRestApi({ url: hang.url }, ctx, { timeoutMs: 300 });
  const elapsed = Date.now() - startedAt;
  await hang.close();
  assert(timedOut.ok === false, "hung endpoint must be reported as not ok");
  assert(/timeout/.test(timedOut.error ?? ""), `expected a timeout error, got ${timedOut.error}`);
  assert(elapsed < 5000, `timeout must abort promptly, took ${elapsed}ms`);

  // ── 6. Safety rails: non-http(s) schemes and empty/invalid URLs ──
  const scheme = await callRestApi({ url: "file:///etc/passwd" }, ctx);
  assert(scheme.ok === false && /protocol/.test(scheme.error ?? ""), "file: must be refused");
  const nourl = await callRestApi({}, ctx);
  assert(nourl.ok === false && /no url/.test(nourl.error ?? ""), "missing url must be refused");
  // An unresolved {{VAR}} degrades to "{VAR}" — must be refused, not requested.
  const unresolved = await callRestApi({ url: "{{ERP_WEBHOOK_URL}}" }, ctx);
  assert(unresolved.ok === false && /invalid url/.test(unresolved.error ?? ""), "unresolved url var must be refused");

  await echo.close();

  console.log("REST-API SMOKE PASS:");
  console.log(`  happy path:   POST ${seen.url} -> ${ok.status} "${ok.text}"`);
  console.log(`  interpolated: url + header + body vars from contact attributes`);
  console.log(`  failures:     500, unreachable, timeout(${elapsed}ms) all resolved without throwing`);
  console.log(`  rails:        file:, empty url, unresolved {{VAR}} refused before any request`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
