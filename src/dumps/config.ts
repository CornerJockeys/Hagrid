import type {DumpKind} from "./format";

export const S20_DUMP_THREAD_IDS: Record<DumpKind, string> = {
  usage: "1555478962187018271",
  salary: "1555478919811964928",
  eligibility: "1555478866716262420",
};

export function dumpThreadId(kind: DumpKind): string {
  return S20_DUMP_THREAD_IDS[kind];
}
