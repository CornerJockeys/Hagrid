export type StatsApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type StatsStatus = (message: string, kind?: "normal" | "success" | "error") => void;

type Division = "all" | "FL" | "AL" | "CL" | "ML";
type Source = "matches" | "scrims";

interface StatLine {
  mode: string;
  games: number;
  win_pct: number | null;
  score: number | null;
  sprocket: number | null;
  gpi: number | null;
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
  source: Source;
  source_as_of: string | null;
  refreshed_at: string | null;
  rows: StatsPlayer[];
}

interface PlayerSeries {
  match_id: string;
  mode: string;
  opponent: string | null;
  scheduled_time: string | null;
  result: "W" | "L" | null;
  team_wins: number | null;
  opponent_wins: number | null;
  games_played: number;
  game_wins: number | null;
  game_losses: number | null;
  win_pct: number | null;
  score: number | null;
  gpi: number | null;
  opi: number | null;
  dpi: number | null;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
}

interface PlayerSeriesResponse {
  player: {
    sprocket_player_id: string;
    name: string;
    division: string | null;
    slot: string;
  };
  matches: PlayerSeries[];
  source_as_of: string | null;
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

function matchDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(date);
}

function resultLabel(match: PlayerSeries): string {
  if (!match.result) return "—";
  if (match.team_wins === null || match.opponent_wins === null) return match.result;
  return `${match.result} ${match.team_wins}-${match.opponent_wins}`;
}

export function mountStatsPanel(panel: HTMLElement, api: StatsApi, setStatus: StatsStatus): void {
  let division: Division = "all";
  let source: Source = "matches";
  let data: StatsResponse | null = null;
  let serial = 0;

  panel.innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">Current franchise · Performance</div><h2>Stats</h2>
      <p>Official Season 20 match stats are the primary view. Click a player in Match Stats to inspect each 2s/3s series they played.</p></div></div>
    <div class="toolbar stats-toolbar">
      <div class="segmented-control" id="stats-source">
        <button class="secondary-button active" data-stats-source="matches">Matches</button>
        <button class="secondary-button" data-stats-source="scrims">Scrims</button>
      </div>
      <div class="segmented-control" id="stats-divisions">
        <button class="secondary-button active" data-stats-division="all">All</button>
        <button class="secondary-button" data-stats-division="FL">FL</button>
        <button class="secondary-button" data-stats-division="AL">AL</button>
        <button class="secondary-button" data-stats-division="CL">CL</button>
        <button class="secondary-button" data-stats-division="ML">ML</button>
      </div>
      <button id="stats-refresh" class="secondary-button">Refresh</button>
    </div>
    <div id="stats-content" class="table-card"></div>
    <div id="stats-player-modal"></div>`;

  const output = panel.querySelector<HTMLElement>("#stats-content");
  const modalRoot = panel.querySelector<HTMLElement>("#stats-player-modal");
  if (!output || !modalRoot) return;

  const closePlayer = (): void => {
    modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
  };

  const openPlayer = async (player: StatsPlayer): Promise<void> => {
    try {
      setStatus(`Loading ${player.name}'s match history…`);
      const detail = await api<PlayerSeriesResponse>(
        `/api/activity/stats/player?player_id=${encodeURIComponent(player.sprocket_player_id)}`,
      );

      const rows = detail.matches.map(match => `
        <tr>
          <td>${escapeHtml(matchDate(match.scheduled_time))}</td>
          <td>${escapeHtml(modeLabel(match.mode))}</td>
          <td>${escapeHtml(match.opponent ?? "Unknown")}</td>
          <td><strong class="match-result ${match.result === "W" ? "win" : match.result === "L" ? "loss" : ""}">${escapeHtml(resultLabel(match))}</strong></td>
          <td class="numeric">${match.games_played}</td>
          <td class="numeric">${match.game_wins === null || match.game_losses === null ? "—" : `${match.game_wins}-${match.game_losses}`}</td>
          <td class="numeric">${number(match.gpi)}</td>
          <td class="numeric">${number(match.opi)}</td>
          <td class="numeric">${number(match.dpi)}</td>
          <td class="numeric">${number(match.score)}</td>
          <td class="numeric">${match.goals}</td>
          <td class="numeric">${match.assists}</td>
          <td class="numeric">${match.saves}</td>
          <td class="numeric">${match.shots}</td>
          <td class="numeric">${match.demos}</td>
        </tr>`).join("");

      modalRoot.innerHTML = `
        <div class="prospect-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(detail.player.name)} match history">
          <button class="modal-backdrop" data-close-stats-player aria-label="Close"></button>
          <div class="prospect-modal-card stats-player-modal-card">
            <div class="modal-heading">
              <div>
                <div class="eyebrow">${escapeHtml(detail.player.division ?? player.division)} · Slot ${escapeHtml(detail.player.slot)}</div>
                <h2>${escapeHtml(detail.player.name)}</h2>
                <p class="stats-player-help">Season 20 official match series. Performance values are aggregated from the games this player actually appeared in.</p>
              </div>
              <button class="icon-button" data-close-stats-player aria-label="Close">×</button>
            </div>
            ${detail.matches.length === 0
              ? `<div class="notice-card"><p>No Season 20 match games were found for this player yet.</p></div>`
              : `<div class="prospect-table-scroll stats-player-scroll">
                  <table class="prospect-table stats-player-table">
                    <thead><tr><th>Date</th><th>Mode</th><th>Opponent</th><th>Series</th><th>Games</th><th>Game Rec.</th><th>GPI</th><th>OPI</th><th>DPI</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th><th>Demos</th></tr></thead>
                    <tbody>${rows}</tbody>
                  </table>
                </div>`}
          </div>
        </div>`;

      document.body.classList.add("modal-open");
      modalRoot.querySelectorAll<HTMLElement>("[data-close-stats-player]").forEach(element => {
        element.addEventListener("click", closePlayer);
      });
      setStatus(`Loaded ${detail.matches.length} match series for ${detail.player.name}.`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const syncButtons = (): void => {
    panel.querySelectorAll<HTMLButtonElement>("[data-stats-division]").forEach(button => {
      button.classList.toggle("active", button.dataset.statsDivision === division);
    });
    panel.querySelectorAll<HTMLButtonElement>("[data-stats-source]").forEach(button => {
      button.classList.toggle("active", button.dataset.statsSource === source);
    });
  };

  const render = (): void => {
    if (!data) {
      output.innerHTML = `<div class="table-empty"><strong>Loading ${source === "matches" ? "match" : "scrim"} stats…</strong></div>`;
      return;
    }
    if (data.rows.length === 0) {
      output.innerHTML = `<div class="table-empty"><strong>No current roster stats matched this division.</strong></div>`;
      return;
    }

    const secondaryMetric = source === "matches" ? "GPI" : "Sprocket";
    const body = data.rows.flatMap(player => {
      const lines = player.stats.length > 0 ? player.stats : [null];
      return lines.map((stat, index) => {
        const first = index === 0;
        const playerCell = first
          ? source === "matches"
            ? `<button class="stats-player-link" data-stats-player="${escapeHtml(player.sprocket_player_id)}"><strong>${escapeHtml(player.name)}</strong><small>View matches</small></button>`
            : `<strong>${escapeHtml(player.name)}</strong>`
          : "";
        return `
          <tr class="${source === "matches" && first ? "stats-clickable-row" : ""}" data-row-player="${first ? escapeHtml(player.sprocket_player_id) : ""}">
            <td class="prospect-name">${playerCell}</td>
            <td>${first ? escapeHtml(player.division) : ""}</td>
            <td>${first ? escapeHtml(player.slot) : ""}</td>
            <td class="numeric">${first ? escapeHtml(salary(player.salary)) : ""}</td>
            <td>${stat ? escapeHtml(modeLabel(stat.mode)) : "—"}</td>
            <td class="numeric">${stat?.games ?? "—"}</td>
            <td class="numeric">${stat ? percent(stat.win_pct) : "—"}</td>
            <td class="numeric">${stat ? number(source === "matches" ? stat.gpi : stat.sprocket) : "—"}</td>
            <td class="numeric">${stat ? number(stat.opi) : "—"}</td>
            <td class="numeric">${stat ? number(stat.dpi) : "—"}</td>
            <td class="numeric">${stat ? number(stat.score) : "—"}</td>
            <td class="numeric">${stat ? number(stat.goals) : "—"}</td>
            <td class="numeric">${stat ? number(stat.assists) : "—"}</td>
            <td class="numeric">${stat ? number(stat.saves) : "—"}</td>
            <td class="numeric">${stat ? number(stat.shots) : "—"}</td>
            <td class="numeric">${stat ? number(stat.demos) : "—"}</td>
          </tr>`;
      });
    }).join("");

    output.innerHTML = `
      <div class="prospect-meta">
        <span>${escapeHtml(data.franchise)} · ${division === "all" ? "All divisions" : division} · ${source === "matches" ? "Season 20 matches" : "Scrims"}</span>
        <span>${data.rows.length} roster player${data.rows.length === 1 ? "" : "s"}</span>
      </div>
      <div class="prospect-table-scroll"><table class="prospect-table stats-table">
        <thead><tr><th>Player</th><th>Div.</th><th>Slot</th><th>Salary</th><th>Mode</th><th>Games</th><th>Win%</th><th>${secondaryMetric}</th><th>OPI</th><th>DPI</th><th>Score</th><th>Goals</th><th>Assists</th><th>Saves</th><th>Shots</th><th>Demos</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>`;

    if (source === "matches") {
      const byId = new Map(data.rows.map(player => [player.sprocket_player_id, player]));
      output.querySelectorAll<HTMLElement>("[data-stats-player]").forEach(element => {
        element.addEventListener("click", event => {
          event.stopPropagation();
          const player = byId.get(element.dataset.statsPlayer ?? "");
          if (player) void openPlayer(player);
        });
      });
      output.querySelectorAll<HTMLElement>("[data-row-player]").forEach(row => {
        const id = row.dataset.rowPlayer ?? "";
        if (!id) return;
        row.addEventListener("click", () => {
          const player = byId.get(id);
          if (player) void openPlayer(player);
        });
      });
    }
  };

  const load = async (): Promise<void> => {
    const request = ++serial;
    data = null;
    render();
    try {
      setStatus(`Loading ${source === "matches" ? "official match" : "scrim"} stats…`);
      const next = await api<StatsResponse>(
        `/api/activity/stats?division=${encodeURIComponent(division)}&source=${source}`,
      );
      if (request !== serial) return;
      data = next;
      render();
      setStatus(
        `Loaded ${next.rows.length} ${division === "all" ? "team" : division} ${source === "matches" ? "match" : "scrim"} stat profile${next.rows.length === 1 ? "" : "s"}.`,
        "success",
      );
    } catch (error) {
      if (request !== serial) return;
      const message = error instanceof Error ? error.message : String(error);
      output.innerHTML = `<div class="table-empty"><strong>Could not load team stats.</strong><span>${escapeHtml(message)}</span></div>`;
      setStatus(message, "error");
    }
  };

  panel.querySelectorAll<HTMLButtonElement>("[data-stats-source]").forEach(button => {
    button.addEventListener("click", () => {
      const value = button.dataset.statsSource;
      if (value !== "matches" && value !== "scrims") return;
      if (value === source) return;
      source = value;
      syncButtons();
      void load();
    });
  });

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
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape" && modalRoot.innerHTML) closePlayer();
  });

  syncButtons();
  void load();
}
