const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
const requestedId = (process.env.CLOUDFLARE_D1_DATABASE_ID || "").trim();
const databaseName = (process.env.HAGRID_D1_DATABASE_NAME || "hagrid").trim();

if (!accountId || !apiToken) {
  console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
  process.exit(2);
}

if (requestedId) {
  if (!/^[0-9a-f-]{36}$/i.test(requestedId)) {
    console.error("CLOUDFLARE_D1_DATABASE_ID is present but does not look like a UUID.");
    process.exit(2);
  }
  process.stdout.write(requestedId);
  process.exit(0);
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database`;
const headers = {
  Authorization: `Bearer ${apiToken}`,
  "Content-Type": "application/json",
};

async function cloudflare(url, init = {}) {
  const response = await fetch(url, {...init, headers: {...headers, ...(init.headers || {})}});
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    const errors = Array.isArray(body?.errors)
      ? body.errors.map(error => error?.message || JSON.stringify(error)).join("; ")
      : `HTTP ${response.status}`;
    throw new Error(errors || `Cloudflare API returned HTTP ${response.status}`);
  }
  return body;
}

try {
  const list = await cloudflare(`${apiBase}?name=${encodeURIComponent(databaseName)}&per_page=100`, {method: "GET"});
  const databases = Array.isArray(list.result) ? list.result : [];
  const exact = databases.filter(database => database?.name === databaseName && typeof database?.uuid === "string");

  if (exact.length > 1) {
    throw new Error(`Multiple D1 databases are named ${databaseName}; set CLOUDFLARE_D1_DATABASE_ID explicitly.`);
  }
  if (exact.length === 1) {
    console.error(`Using existing D1 database ${databaseName} (${exact[0].uuid}).`);
    process.stdout.write(exact[0].uuid);
    process.exit(0);
  }

  const created = await cloudflare(apiBase, {
    method: "POST",
    body: JSON.stringify({name: databaseName}),
  });
  const uuid = created.result?.uuid;
  if (typeof uuid !== "string" || !uuid) {
    throw new Error("Cloudflare created the D1 database but did not return its UUID.");
  }
  console.error(`Created D1 database ${databaseName} (${uuid}).`);
  process.stdout.write(uuid);
} catch (error) {
  console.error(`Could not provision D1: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
