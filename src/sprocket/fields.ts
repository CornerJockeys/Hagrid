import type {CsvRecord} from "./csv";

export function field(row: CsvRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value.trim() !== "") {
      return value.trim();
    }
  }
  return null;
}

export function numberField(row: CsvRecord, ...keys: string[]): number | null {
  const raw = field(row, ...keys);
  if (raw === null) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function integerField(row: CsvRecord, ...keys: string[]): number | null {
  const value = numberField(row, ...keys);
  if (value === null || !Number.isInteger(value)) return null;
  return value;
}

export function sameText(left: string | null, right: string | null): boolean {
  return (left ?? "").trim().toLocaleLowerCase("en-US") ===
    (right ?? "").trim().toLocaleLowerCase("en-US");
}
