export type CsvRecord = Record<string, string>;

export function parseCsv(input: string): CsvRecord[] {
  const rows = parseRows(input.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return [];

  const headers = rows[0].map(header => header.trim());
  if (headers.every(header => header === "")) {
    throw new Error("CSV dataset does not contain a header row.");
  }

  return rows
    .slice(1)
    .filter(row => row.some(value => value !== ""))
    .map(row => {
      const record: CsvRecord = {};
      for (let index = 0; index < headers.length; index += 1) {
        const header = headers[index];
        if (!header) continue;
        record[header] = row[index] ?? "";
      }
      return record;
    });
}

function parseRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char !== "\r") {
      field += char;
    }
  }

  if (quoted) {
    throw new Error("CSV dataset ended inside a quoted field.");
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
