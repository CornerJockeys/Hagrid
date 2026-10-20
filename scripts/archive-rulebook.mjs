import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DOCUMENT_ID = "12HhCEkuGfGF9Q5pjhPPea4okGUF9eguwgFL9D7mRk24";
const TEXT_URL = `https://docs.google.com/document/d/${DOCUMENT_ID}/export?format=txt`;
const PDF_URL = `https://docs.google.com/document/d/${DOCUMENT_ID}/export?format=pdf`;
const RESOURCES = path.resolve("resources");
const INDEX_PATH = path.join(RESOURCES, "rulebook-archive-index.json");
const CURRENT_TEXT_PATH = path.join(RESOURCES, "Minor League Esports Season 20 Rulebook.txt");
const DATA_PATH = path.resolve("src/rulebooks/data.ts");

function canonicalNumber(value) {
  if (!/^\d+\.\d+$/.test(value)) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : value;
}

function canonicalLine(value) {
  return value
    .trim()
    .replace(/[\t ]+/g, " ")
    .replace(/\b\d+\.\d+\b/g, canonicalNumber);
}

function cleanText(value) {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function contentHash(value) {
  const canonical = cleanText(value)
    .split("\n")
    .map(canonicalLine)
    .filter(Boolean)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function eastDate(value) {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value ?? "";
  return `${get("month")}-${get("day")}-${get("year")}`;
}

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) return {versions: []};
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    return Array.isArray(parsed.versions) ? parsed : {versions: []};
  } catch {
    return {versions: []};
  }
}

function updateBundledData(text) {
  const source = fs.readFileSync(DATA_PATH, "utf8");
  const startMarker = "export const SEASON_20_RULEBOOK = ";
  const broadcastMarker = "\n\nexport const BROADCAST_RULEBOOK_TITLE";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(broadcastMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Could not locate the bundled League Rulebook constant.");
  }
  const prefix = source.slice(0, start) + startMarker;
  const suffix = source.slice(end);
  fs.writeFileSync(DATA_PATH, `${prefix}${JSON.stringify(text)};${suffix}`);
}

async function main() {
  const base = (process.env.HAGRID_BASE_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("HAGRID_BASE_URL is required.");

  const statusResponse = await fetch(`${base}/api/rulebook/watch-state`);
  if (!statusResponse.ok) {
    throw new Error(`Could not read Hagrid Rulebook Watch state (${statusResponse.status}).`);
  }
  const status = await statusResponse.json();

  if (!status.enabled) {
    console.log("Rulebook Watch is paused; archive job skipped.");
    output("archived", "false");
    return;
  }
  if (!status.current_hash) {
    console.log("Hagrid has not established a known-good rulebook baseline yet.");
    output("archived", "false");
    return;
  }

  const textResponse = await fetch(TEXT_URL);
  if (!textResponse.ok) throw new Error(`Google Docs text export failed (${textResponse.status}).`);
  const text = cleanText(await textResponse.text());
  const hash = contentHash(text);

  if (hash !== status.current_hash) {
    console.log("Google Doc no longer matches Hagrid's accepted baseline; waiting for the watcher.");
    output("archived", "false");
    return;
  }

  fs.mkdirSync(RESOURCES, {recursive: true});
  const index = loadIndex();
  if (index.versions.some(version => version.hash === hash)) {
    console.log("Accepted rulebook version is already archived.");
    output("archived", "false");
    return;
  }

  const date = eastDate(status.last_synced_at);
  const stem = "Minor League Esports Season 20 Rulebook";
  let suffix = "";
  let sequence = 1;
  let pdfName = `${stem} ${date}.pdf`;
  let txtName = `${stem} ${date}.txt`;

  // If this is the first indexed version and Michael already placed today's
  // dated PDF in the repo, adopt it instead of creating a duplicate -2 file.
  const canAdoptExisting = index.versions.length === 0 && fs.existsSync(path.join(RESOURCES, pdfName));
  if (!canAdoptExisting) {
    while (
      fs.existsSync(path.join(RESOURCES, pdfName)) ||
      fs.existsSync(path.join(RESOURCES, txtName))
    ) {
      sequence += 1;
      suffix = `-${sequence}`;
      pdfName = `${stem} ${date}${suffix}.pdf`;
      txtName = `${stem} ${date}${suffix}.txt`;
    }

    const pdfResponse = await fetch(PDF_URL);
    if (!pdfResponse.ok) throw new Error(`Google Docs PDF export failed (${pdfResponse.status}).`);
    fs.writeFileSync(path.join(RESOURCES, pdfName), Buffer.from(await pdfResponse.arrayBuffer()));
  }

  fs.writeFileSync(path.join(RESOURCES, txtName), text);
  fs.writeFileSync(CURRENT_TEXT_PATH, text);
  updateBundledData(text);

  index.versions.push({
    hash,
    accepted_at: status.last_synced_at ?? new Date().toISOString(),
    pdf: pdfName,
    text: txtName,
  });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");

  console.log(`Archived accepted rulebook ${hash.slice(0, 12)}… as ${pdfName}.`);
  output("archived", "true");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
