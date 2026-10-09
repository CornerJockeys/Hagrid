export type StandingsApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type StandingsStatus = (message: string, kind?: "normal" | "success" | "error") => void;

type Division = "all" | "FL" | "AL" | "CL" | "ML";
type Mode = "Overall" | "Doubles" | "Standard";

interface Standing {
  ranking: number;
  name: string;
  division_name: string | null;
  conference: string | null;
  wins: number;
  losses: number;
  league: string | null;
  mode: string | null;
  season: string;
  source_as_of: string | null;
}

interface StandingSection {
  division: Exclude<Division, "all">;
  league_name: string;
  franchise: Standing | null;
  table: Standing[];
}

interface StandingsResponse {
  franchise: string;
  season: number;
  division: Division;
  mode: Mode;
  available: boolean;
  message: string | null;
  sections: StandingSection[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char] ?? char));
}

function record(row: Standing): string {
  const total = row.wins + row.losses;
  const pct = total > 0 ? (row.wins / total * 100).toFixed(1) : "0.0";
  return `${row.wins}-${row.losses} (${pct}%)`;
}

export function mountStandingsPanel(panel: HTMLElement, api: StandingsApi, setStatus: StandingsStatus): void {
  let division: Division = "all";
  let mode: Mode = "Overall";
  let serial = 0;

  panel.innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">Season standings</div><h2>Standings</h2>
      <p>Current S20 standings for the configured franchise and its relevant divisions/conferences.</p></div></div>
    <div class="toolbar standings-toolbar">
      <div class="segmented-control">
        <button class="secondary-button active" data-standings-division="all">All</button>
        <button class="secondary-button" data-standings-division="FL">FL</button>
        <button class="secondary-button" data-standings-division="AL">AL</button>
        <button class="secondary-button" data-standings-division="CL">CL</button>
        <button class="secondary-button" data-standings-division="ML">ML</button>
      </div>
      <label>Mode<select id="standings-mode"><option>Overall</option><option>Doubles</option><option>Standard</option></select></label>
      <button id="standings-refresh" class="secondary-button">Refresh</button>
    </div>
    <div id="standings-content"><div class="table-empty"><strong>Loading standings…</strong></div></div>`;

  const output = panel.querySelector<HTMLElement>("#standings-content");
  const modeSelect = panel.querySelector<HTMLSelectElement>("#standings-mode");
  if (!output || !modeSelect) return;

  const syncButtons = (): void => {
    panel.querySelectorAll<HTMLButtonElement>("[data-standings-division]").forEach(button => {
      button.classList.toggle("active", button.dataset.standingsDivision === division);
    });
  };

  const render = (data: StandingsResponse): void => {
    if (!data.available) {
      output.innerHTML = `<div class="notice-card warning"><strong>Standings not available yet</strong><p>${escapeHtml(data.message ?? "Standings will populate after matches have been played.")}</p></div>`;
      return;
    }

    output.innerHTML = data.sections.map(section => {
      if (!section.franchise || section.table.length === 0) {
        return `<div class="table-card"><div class="table-empty"><strong>${section.division}</strong><span>No ${escapeHtml(data.mode.toLowerCase())} standings were published for this team yet.</span></div></div>`;
      }
      const context = [section.franchise.division_name, section.franchise.conference].filter(Boolean).join(" · ");
      return `<div class="table-card standings-section">
        <div class="prospect-meta"><span>${section.division} · ${escapeHtml(context || section.league_name)}</span><span>${escapeHtml(data.mode)}</span></div>
        <div class="prospect-table-scroll"><table class="prospect-table standings-table"><thead><tr><th>Rank</th><th>Team</th><th>Record</th></tr></thead><tbody>
          ${section.table.map(row => `<tr class="${row.name === data.franchise ? "standings-own-row" : ""}"><td class="numeric">${row.ranking}</td><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(record(row))}</td></tr>`).join("")}
        </tbody></table></div>
      </div>`;
    }).join("");
  };

  const load = async (): Promise<void> => {
    const request = ++serial;
    try {
      setStatus("Loading standings…");
      const data = await api<StandingsResponse>(`/api/activity/standings?division=${encodeURIComponent(division)}&mode=${encodeURIComponent(mode)}`);
      if (request !== serial) return;
      render(data);
      setStatus(data.available ? `Loaded ${mode.toLowerCase()} standings.` : data.message ?? "Standings are not available yet.", data.available ? "success" : "normal");
    } catch (error) {
      if (request !== serial) return;
      const message = error instanceof Error ? error.message : String(error);
      output.innerHTML = `<div class="table-empty"><strong>Could not load standings.</strong><span>${escapeHtml(message)}</span></div>`;
      setStatus(message, "error");
    }
  };

  panel.querySelectorAll<HTMLButtonElement>("[data-standings-division]").forEach(button => {
    button.addEventListener("click", () => {
      const value = button.dataset.standingsDivision;
      if (value !== "all" && value !== "FL" && value !== "AL" && value !== "CL" && value !== "ML") return;
      division = value;
      syncButtons();
      void load();
    });
  });
  modeSelect.addEventListener("change", () => { mode = modeSelect.value as Mode; void load(); });
  panel.querySelector("#standings-refresh")?.addEventListener("click", () => void load());
  syncButtons();
  void load();
}
