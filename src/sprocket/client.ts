import {parseCsv, type CsvRecord} from "./csv";
import type {Env} from "../types";

const DEFAULT_DATASET_BASE_URL =
  "https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets/public/data";
const DEFAULT_LEGACY_DATASET_BASE_URL =
  "https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets";

export class DatasetFetchError extends Error {
  readonly dataset: string;
  readonly status: number | null;

  constructor(dataset: string, message: string, status: number | null = null) {
    super(message);
    this.name = "DatasetFetchError";
    this.dataset = dataset;
    this.status = status;
  }
}

function validateDatasetPath(dataset: string): void {
  if (!/^[a-z0-9_/-]+$/i.test(dataset) || dataset.includes("..")) {
    throw new Error(`Invalid dataset path: ${dataset}`);
  }
}

async function fetchCsvAtBase(
  dataset: string,
  baseUrl: string,
): Promise<CsvRecord[]> {
  validateDatasetPath(dataset);
  const url = `${baseUrl.replace(/\/+$/, "")}/${dataset}.csv`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.1",
      },
    });
  } catch (error) {
    throw new DatasetFetchError(
      dataset,
      `Failed to fetch Sprocket dataset ${dataset}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new DatasetFetchError(
      dataset,
      `Sprocket dataset ${dataset} returned HTTP ${response.status}.`,
      response.status,
    );
  }

  const body = await response.text();
  try {
    return parseCsv(body);
  } catch (error) {
    throw new DatasetFetchError(
      dataset,
      `Sprocket dataset ${dataset} could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      response.status,
    );
  }
}

export async function fetchCsvDataset(env: Env, dataset: string): Promise<CsvRecord[]> {
  return fetchCsvAtBase(
    dataset,
    env.SPROCKET_DATASET_BASE_URL ?? DEFAULT_DATASET_BASE_URL,
  );
}

export async function fetchLegacyCsvDataset(env: Env, dataset: string): Promise<CsvRecord[]> {
  return fetchCsvAtBase(
    dataset,
    env.SPROCKET_LEGACY_DATASET_BASE_URL ?? DEFAULT_LEGACY_DATASET_BASE_URL,
  );
}
