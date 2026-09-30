import {parseCsv, type CsvRecord} from "./csv";
import type {Env} from "../types";

const DEFAULT_DATASET_BASE_URL =
  "https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets/public/data";
const DEFAULT_LEGACY_DATASET_BASE_URL =
  "https://sprocket-public-datasets.nyc3.cdn.digitaloceanspaces.com/datasets";

export class DatasetFetchError extends Error {
  readonly dataset: string;
  readonly status: number | null;
  readonly url: string | null;

  constructor(
    dataset: string,
    message: string,
    status: number | null = null,
    url: string | null = null,
  ) {
    super(message);
    this.name = "DatasetFetchError";
    this.dataset = dataset;
    this.status = status;
    this.url = url;
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
        "User-Agent": "Hagrid/0.1 (+https://github.com/CornerJockeys/Hagrid)",
      },
    });
  } catch (error) {
    throw new DatasetFetchError(
      dataset,
      `Failed to fetch Sprocket dataset ${dataset}: ${error instanceof Error ? error.message : String(error)}`,
      null,
      url,
    );
  }

  if (!response.ok) {
    throw new DatasetFetchError(
      dataset,
      `Sprocket dataset ${dataset} returned HTTP ${response.status}.`,
      response.status,
      url,
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
      url,
    );
  }
}

export async function fetchCsvDataset(env: Env, dataset: string): Promise<CsvRecord[]> {
  const primaryBase = env.SPROCKET_DATASET_BASE_URL ?? DEFAULT_DATASET_BASE_URL;
  try {
    return await fetchCsvAtBase(dataset, primaryBase);
  } catch (error) {
    if (!(error instanceof DatasetFetchError) || ![403, 404].includes(error.status ?? 0)) {
      throw error;
    }

    const legacyBase = env.SPROCKET_LEGACY_DATASET_BASE_URL ?? DEFAULT_LEGACY_DATASET_BASE_URL;
    if (legacyBase.replace(/\/+$/, "") === primaryBase.replace(/\/+$/, "")) throw error;

    console.warn(
      `Sprocket ${dataset} was unavailable at the public/data path (${error.status}); trying the legacy root publication.`,
    );
    try {
      return await fetchCsvAtBase(dataset, legacyBase);
    } catch (fallbackError) {
      if (fallbackError instanceof DatasetFetchError) {
        throw new DatasetFetchError(
          dataset,
          `Sprocket dataset ${dataset} failed at both current and legacy publications ` +
            `(${error.status ?? "network"} then ${fallbackError.status ?? "network"}).`,
          fallbackError.status,
          fallbackError.url,
        );
      }
      throw fallbackError;
    }
  }
}

export async function fetchLegacyCsvDataset(env: Env, dataset: string): Promise<CsvRecord[]> {
  return fetchCsvAtBase(
    dataset,
    env.SPROCKET_LEGACY_DATASET_BASE_URL ?? DEFAULT_LEGACY_DATASET_BASE_URL,
  );
}
