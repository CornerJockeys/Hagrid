import {fetchCsvDataset} from "./client";
import type {CsvRecord} from "./csv";
import type {Env} from "../types";

export interface SprocketFranchise {
  name: string;
  code: string | null;
  conference: string | null;
  superDivision: string | null;
  division: string | null;
}

export interface FranchiseResolution {
  match: SprocketFranchise | null;
  suggestions: SprocketFranchise[];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function value(row: CsvRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = row[key];
    if (candidate !== undefined && candidate.trim() !== "") {
      return candidate.trim();
    }
  }
  return null;
}

function fromRow(row: CsvRecord): SprocketFranchise | null {
  const name = value(row, "Franchise", "franchise");
  if (!name) return null;

  return {
    name,
    code: value(row, "Code", "code"),
    conference: value(row, "Conference", "conference"),
    superDivision: value(row, "Super Division", "super_division", "superDivision"),
    division: value(row, "Division", "division"),
  };
}

function dedupe(franchises: SprocketFranchise[]): SprocketFranchise[] {
  const seen = new Set<string>();
  const output: SprocketFranchise[] = [];

  for (const franchise of franchises) {
    const key = `${normalize(franchise.name)}\u0000${normalize(franchise.code ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(franchise);
  }

  return output;
}

export async function getFranchises(env: Env): Promise<SprocketFranchise[]> {
  const rows = await fetchCsvDataset(env, "teams");
  return dedupe(rows.map(fromRow).filter((item): item is SprocketFranchise => item !== null));
}

export async function resolveFranchise(
  env: Env,
  requested: string,
): Promise<FranchiseResolution> {
  const franchises = await getFranchises(env);
  const needle = normalize(requested);

  const exact = franchises.filter(franchise =>
    normalize(franchise.name) === needle || normalize(franchise.code ?? "") === needle,
  );

  if (exact.length === 1) {
    return {match: exact[0], suggestions: []};
  }

  if (exact.length > 1) {
    const canonical = dedupe(exact);
    if (canonical.length === 1) {
      return {match: canonical[0], suggestions: []};
    }
    return {match: null, suggestions: canonical.slice(0, 5)};
  }

  const suggestions = franchises
    .filter(franchise => {
      const name = normalize(franchise.name);
      const code = normalize(franchise.code ?? "");
      return name.includes(needle) || code.includes(needle);
    })
    .slice(0, 5);

  return {match: null, suggestions};
}
