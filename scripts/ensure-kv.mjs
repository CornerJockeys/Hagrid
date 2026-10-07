const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
const requestedId = (process.env.CLOUDFLARE_KV_NAMESPACE_ID || "").trim();
const namespaceTitle = (process.env.HAGRID_KV_NAMESPACE_TITLE || "hagrid-cache").trim();

if (!accountId || !apiToken) {
  console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
  process.exit(2);
}

if (requestedId) {
  if (!/^[0-9a-f]{32}$/i.test(requestedId)) {
    console.error("CLOUDFLARE_KV_NAMESPACE_ID is present but does not look like a KV namespace ID.");
    process.exit(2);
  }
  process.stdout.write(requestedId);
  process.exit(0);
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces`;
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
  const list = await cloudflare(`${apiBase}?per_page=100`, {method: "GET"});
  const namespaces = Array.isArray(list.result) ? list.result : [];
  const exact = namespaces.filter(namespace =>
    namespace?.title === namespaceTitle &&
    typeof namespace?.id === "string"
  );

  if (exact.length > 1) {
    throw new Error(
      `Multiple KV namespaces are titled ${namespaceTitle}; set CLOUDFLARE_KV_NAMESPACE_ID explicitly.`,
    );
  }
  if (exact.length === 1) {
    console.error(`Using existing KV namespace ${namespaceTitle} (${exact[0].id}).`);
    process.stdout.write(exact[0].id);
    process.exit(0);
  }

  const created = await cloudflare(apiBase, {
    method: "POST",
    body: JSON.stringify({title: namespaceTitle}),
  });
  const id = created.result?.id;
  if (typeof id !== "string" || !id) {
    throw new Error("Cloudflare created the KV namespace but did not return its ID.");
  }
  console.error(`Created KV namespace ${namespaceTitle} (${id}).`);
  process.stdout.write(id);
} catch (error) {
  console.error(`Could not provision KV: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
