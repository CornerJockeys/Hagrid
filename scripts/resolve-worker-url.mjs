const explicit = (process.env.HAGRID_BASE_URL || "").trim().replace(/\/+$/, "");
if (explicit) {
  process.stdout.write(explicit);
  process.exit(0);
}

const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
const workerName = (process.env.HAGRID_WORKER_NAME || "hagrid").trim();

if (!accountId || !apiToken) {
  console.error("HAGRID_BASE_URL or Cloudflare account credentials are required.");
  process.exit(2);
}

try {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
    {headers: {Authorization: `Bearer ${apiToken}`}},
  );
  const body = await response.json().catch(() => null);
  const subdomain = body?.result?.subdomain;
  if (!response.ok || !body?.success || typeof subdomain !== "string" || !subdomain) {
    const errors = Array.isArray(body?.errors)
      ? body.errors.map(error => error?.message || JSON.stringify(error)).join("; ")
      : `HTTP ${response.status}`;
    throw new Error(errors || "Cloudflare did not return a Workers subdomain.");
  }
  process.stdout.write(`https://${workerName}.${subdomain}.workers.dev`);
} catch (error) {
  console.error(`Could not resolve workers.dev URL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
