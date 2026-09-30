import {readFile, writeFile} from "node:fs/promises";

const sourcePath = "wrangler.toml";
const outputPath = process.env.HAGRID_WRANGLER_CONFIG || ".wrangler.deploy.toml";

function required(name, pattern = null) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  if (pattern && !pattern.test(value)) throw new Error(`${name} has an invalid format.`);
  return value;
}

function tomlString(value) {
  return JSON.stringify(value);
}

const databaseId = required(
  "CLOUDFLARE_D1_DATABASE_ID",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);
const applicationId = required("DISCORD_APPLICATION_ID", /^\d{10,25}$/);
const publicKey = required("DISCORD_PUBLIC_KEY", /^[0-9a-f]{64}$/i);

let config = await readFile(sourcePath, "utf8");
if (!config.includes('database_id = "REPLACE_WITH_D1_DATABASE_ID"')) {
  throw new Error("wrangler.toml does not contain the expected D1 placeholder.");
}
config = config.replace(
  'database_id = "REPLACE_WITH_D1_DATABASE_ID"',
  `database_id = ${tomlString(databaseId)}`,
);

const vars = [
  "",
  "[vars]",
  `DISCORD_APPLICATION_ID = ${tomlString(applicationId)}`,
  `DISCORD_PUBLIC_KEY = ${tomlString(publicKey)}`,
];

for (const [name, key] of [
  ["SPROCKET_DATASET_BASE_URL", "SPROCKET_DATASET_BASE_URL"],
  ["SPROCKET_LEGACY_DATASET_BASE_URL", "SPROCKET_LEGACY_DATASET_BASE_URL"],
]) {
  const value = (process.env[name] || "").trim();
  if (value) vars.push(`${key} = ${tomlString(value)}`);
}

config += `${vars.join("\n")}\n`;
await writeFile(outputPath, config, "utf8");
console.log(`Prepared ${outputPath} for D1 ${databaseId.slice(0, 8)}… and Discord app ${applicationId}.`);
