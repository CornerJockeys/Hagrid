import assert from "node:assert/strict";

const base = (process.env.HAGRID_BASE_URL || "").trim().replace(/\/+$/, "");
if (!base) {
  console.error("HAGRID_BASE_URL is required, for example https://hagrid.example.workers.dev");
  process.exit(2);
}

async function json(path) {
  const response = await fetch(`${base}${path}`, {
    headers: {Accept: "application/json"},
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return {response, body};
}

const health = await json("/health");
assert.equal(health.response.status, 200, `/health returned ${health.response.status}`);
assert.equal(health.body.ok, true, "/health did not report ok=true");
assert.equal(health.body.service, "hagrid", "/health service mismatch");
console.log("Health: OK");

const ready = await json("/ready");
assert.equal(ready.response.status, 200, `/ready returned ${ready.response.status}: ${JSON.stringify(ready.body)}`);
assert.equal(ready.body.ok, true, "/ready did not report ok=true");
assert.equal(ready.body.database?.ok, true, "D1 readiness failed");
assert.equal(ready.body.discord?.public_key, true, "Discord public key is not configured");
assert.equal(ready.body.discord?.application_id, true, "Discord application ID is not configured");
assert.equal(ready.body.discord?.client_secret, true, "Discord client secret is not configured");
console.log("Readiness: OK");

const root = await fetch(`${base}/`, {headers: {Accept: "text/html"}});
assert.equal(root.status, 200, `/ returned ${root.status}`);
const rootText = await root.text();
assert.ok(rootText.length > 0, "Activity root returned an empty body");
console.log("Activity root: OK");

console.log(`Deployed Hagrid smoke test passed for ${base}.`);
