import {playerBadges} from "./player-badges";

export type StatsApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type StatsStatus = (message: string, kind?: "normal" | "success" | "error") => void;

type Division = "all" | "FL" | "AL" | "CL" | "ML";

interface StatLine {
  mode: string;
  games: number;
  win_pct: number | null;
  score: number | null;
  sprocket: number | null;
  dpi: number | null;
  opi: number | null;
  goals: number | null;
  assists: number | null;
  saves: number | null;
  shots: number | null;
  demos: number | null;
}

interface StatsPlayer {
  sprocket_player_id: string;
  name: string;
  division: string;
  slot: string;
  salary: number | null;
  joined_date: string | null;
  seasons_played: number | null;
  seasons: string[];
  stats: StatLine[];
}

interface StatsResponse {
  franchise: string;
  division: Division;
  source_as_of: string | null;
  refreshed_at: string | null;
  rows: StatsPlayer[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char] ?? char));
}

function number(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const scaled = value <= 1 ? value * 100 : value;
  return `${scaled.toFixed(1)}%`;
}

function salary(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function modeLabel(mode: string): string {
  if (mode === "2s") return "2s";
  if (mode === "3s") return "3s";
  return mode;
}

export function mountStatsPanel(panel: HTMLElement, api: StatsApi, setStatus: StatsStatus): void {
  let division: Division = "all";
  let data: StatsResponse | null = null;
  let serial = 0;

  panel.innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">Current franchise · Scrim performance</div><h2>Stats</h2>
      <p>Compare current roster performance by division using Hagrid\'s cached MLE scrim-stat snapshot.</p></div></div>
    <div class="toolbar stats-toolbar">
      <div class="segmented-control" id="stats-divisions">
        <button class="secondary-button active" data-stats-division="all">All</button>
        <button class="secondary-button" data-stats-division="FL">FL</button>
        <button class="secondary-button" data-stats-division="AL">AL</button>
        <button class="secondary-button" data-stats-division="CL">CL</button>
        <button class="secondary-button" data-stats-division="ML">ML</button>
      </div>
      <button id="stats-refresh" class="secondary-button">Refresh</button>
    </div>
    <div id="stats-content" class="table-card"><div class="table-empty"><strong>Loading team stats…</strong></div></div>`;

  const output = panel.querySelector<HTMLElement>("#stats-content");
  if (!output) return;

  const syncButtons = (): void => {
    panel.querySelectorAll<HTMLButtonElement>("[data-stats-division]").forEach(button => {
      button.classList.toggle("active", button.dataset.statsDivision === division);
    });
  };

  const render = (): void => {
    if (!data) return;
    if (data.rows.length === 0) {
      output.innerHTML = `<div class="table-empty"><strong>No current roster stats matched this division.</strong><span>Stats appear after MLE publishes usable scrim data for rostered players.</span></div>`;
      return;
    }

    const body = data.rows.flatMap(player => {
      const lines = player.stats.length > 0 ? player.stats : [null];
      return lines.map((stat, index) => `
        <tr>
          <td class="prospect-name"><strong>${index === 0 ? escapeHtml(player.name) : ""}</strong>${index === 0 ? playerBadges(player) : ""}</td>
          <td>${index === 0 ? escapeHtml(player.division) : ""}</td>
          <td>${index === 0 ? escapeHtml(player.slot) : ""}</td>
          <td class="numeric">${index === 0 ? escapeHtml(salary(player.salary)) : ""}</td>
          <td>${stat ? escapeHtml(modeLabel(stat.mode)) : "—"}</td>
          <td class="numeric">${stat?.games ?? "—"}</td>
          <td class="numeric">${stat ? percent(stat.win_pct) : "—"}</td>
          <td class="numeric">${stat ? number(stat.sprocket) : "—"}</td>
          <td class="numeric">${stat ? number(stat.opi) : "—"}</td>
          <td class="numeric">${stat ? number(stat.dpi) : "—"}</td>
          <td class="numeric">${stat ? number(stat.score) : "—"}</td>
          <td class="numeric">${stat ? number(stat.goals) : "—"}</td>
          <td class="numeric">${stat ? number(stat.assists) : "—"}</td>
          <td class="numeric">${stat ? number(stat.saves) : "—"}</td>
          <td class="numeric">${stat ? number(stat.shots) : "—"}</td>
          <td class="numeric">${stat ? number(stat.demos) : "—"}</td>
        </tr>`);
    }).join("");

    output.innerHTML = `
      <div class="prospect-meta"><span>${escapeHtml(data.franchise)} · ${division === "all" ? "All divisions" : division}</span><span>${data.rows.length} roster player${data.rows.length === 1 ? "" : "s"}</span></div>
      <div class="prospect-table-scroll"><table class="prospect-table stats-table">
        <thead><tr><th>Player</th><th>Div.</th><th>Slot</th><th>Salary</th><th>Mode</th><th>Games</th><th>Win%</th><th>Sprocket</th><th>OPI</th><th>DPI</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th><th>Demos</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>`;
  };

  const load = async (): Promise<void> => {
    const request = ++serial;
    try {
      setStatus("Loading team stats…");
      const next = await api<StatsResponse>(`/api/activity/stats?division=${encodeURIComponent(division)}`);
      if (request !== serial) return;
      data = next;
      render();
      setStatus(`Loaded ${next.rows.length} ${division === "all" ? "team" : division} roster stat profile${next.rows.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      if (request !== serial) return;
      const message = error instanceof Error ? error.message : String(error);
      output.innerHTML = `<div class="table-empty"><strong>Could not load team stats.</strong><span>${escapeHtml(message)}</span></div>`;
      setStatus(message, "error");
    }
  };

  panel.querySelectorAll<HTMLButtonElement>("[data-stats-division]").forEach(button => {
    button.addEventListener("click", () => {
      const value = button.dataset.statsDivision;
      if (value !== "all" && value !== "FL" && value !== "AL" && value !== "CL" && value !== "ML") return;
      if (value === division) return;
      division = value;
      syncButtons();
      void load();
    });
  });
  panel.querySelector("#stats-refresh")?.addEventListener("click", () => void load());
  syncButtons();
  void load();
}
