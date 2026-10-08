export type RulebookApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type RulebookStatus = (message: string, kind?: "normal" | "success" | "error") => void;

type RulebookKind = "league" | "broadcast";

interface RulebookResponse {
  kind: RulebookKind;
  title: string;
  warning: string | null;
  content: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char] ?? char));
}

function blocks(content: string): string[] {
  return content.replace(/^\uFEFF/, "").split(/\r?\n\s*\r?\n/).map(value => value.trim()).filter(Boolean);
}

function results(content: string, query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return `<pre class="rulebook-full">${escapeHtml(content.replace(/^\uFEFF/, ""))}</pre>`;
  }
  const terms = trimmed.toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
  const matches = blocks(content).filter(block => {
    const haystack = block.toLocaleLowerCase("en-US");
    return terms.every(term => haystack.includes(term));
  }).slice(0, 60);
  if (matches.length === 0) {
    return `<div class="table-empty"><strong>No rulebook text matched that search.</strong><span>Try fewer or broader words.</span></div>`;
  }
  return `<div class="rulebook-results">${matches.map(block => `<pre class="rulebook-result">${escapeHtml(block)}</pre>`).join("")}</div>`;
}

export function mountRulebookPanel(
  panel: HTMLElement,
  api: RulebookApi,
  setStatus: RulebookStatus,
  kind: RulebookKind,
): void {
  let data: RulebookResponse | null = null;

  panel.innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">Captain+ reference</div><h2>${kind === "league" ? "League Rulebook" : "Broadcast Rulebook"}</h2>
      <p>Search the source rulebook text stored with Hagrid. Results preserve the wording in the uploaded source file.</p></div></div>
    <div class="toolbar rulebook-toolbar"><label>Search<input id="rulebook-search" type="search" placeholder="e.g. NCP, salary cap, substitutions" /></label><button id="rulebook-clear" class="secondary-button">Clear</button></div>
    <div id="rulebook-warning"></div>
    <div id="rulebook-content" class="rulebook-card"><div class="table-empty"><strong>Loading rulebook…</strong></div></div>`;

  const input = panel.querySelector<HTMLInputElement>("#rulebook-search");
  const output = panel.querySelector<HTMLElement>("#rulebook-content");
  const warning = panel.querySelector<HTMLElement>("#rulebook-warning");
  if (!input || !output || !warning) return;

  const render = (): void => {
    if (!data) return;
    warning.innerHTML = data.warning ? `<div class="notice-card warning"><strong>Source warning</strong><p>${escapeHtml(data.warning)}</p></div>` : "";
    output.innerHTML = results(data.content, input.value);
  };

  const load = async (): Promise<void> => {
    try {
      setStatus("Loading rulebook…");
      data = await api<RulebookResponse>(`/api/activity/rulebook?kind=${encodeURIComponent(kind)}`);
      render();
      setStatus(`${data.title} loaded.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.innerHTML = `<div class="table-empty"><strong>Could not load the rulebook.</strong><span>${escapeHtml(message)}</span></div>`;
      setStatus(message, "error");
    }
  };

  input.addEventListener("input", render);
  panel.querySelector("#rulebook-clear")?.addEventListener("click", () => { input.value = ""; render(); input.focus(); });
  void load();
}
