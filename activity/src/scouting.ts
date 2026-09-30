export type ActivityApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type ActivityStatus = (
  message: string,
  kind?: "normal" | "success" | "error",
) => void;

type ScoutingMode = "2s" | "3s" | "combined";

interface ScoutingState {
  refreshedAt: string;
  checkedAt: string;
  prospectCount: number;
  rowCount: number;
}

interface ScoutingRow {
  sprocketPlayerId: string;
  name: string;
  salary: number | null;
  league: string;
  status: "FA" | "PEND";
  mode: ScoutingMode;
  games: number;
  winPct: number | null;
  score: number | null;
  sprocket: number | null;
  dpi: number | null;
  opi: number | null;
  goals: number | null;
  assists: number | null;
  saves: number | null;
  shots: number | null;
  shotPct: number | null;
  demos: number | null;
  effSalary: number | null;
  temp: number;
  bucket: "Hot" | "Warm" | "Cold";
  mainRole: string;
  altRole: string;
  roleConfidence: string;
  flags: string;
}

interface ScoutingListResponse {
  rows: ScoutingRow[];
  total: number;
  state: ScoutingState | null;
}

interface ScoutingPlayerResponse {
  player: ScoutingRow;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char] ?? char);
}

function number(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function salary(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function freshness(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(date);
}

function queryFromForm(form: HTMLFormElement): URLSearchParams {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    const text = String(value).trim();
    if (text) params.set(key, text);
  }
  const hideLowSample = form.querySelector<HTMLInputElement>("[name=hide_low_sample]");
  params.set("hide_low_sample", hideLowSample?.checked ? "true" : "false");
  return params;
}

function resultTable(result: ScoutingListResponse): string {
  if (result.rows.length === 0) {
    return `<div class="table-empty"><strong>No matching prospects.</strong><span>Adjust the filters and try again.</span></div>`;
  }

  const rows = result.rows.map(row => `
    <tr class="prospect-row" tabindex="0" data-player-id="${escapeHtml(row.sprocketPlayerId)}" data-mode="${escapeHtml(row.mode)}">
      <td class="prospect-name"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.league)} · ${escapeHtml(row.mode === "combined" ? "Combined" : row.mode)}</small></td>
      <td><span class="status-pill status-${row.status.toLocaleLowerCase("en-US")}">${escapeHtml(row.status)}</span></td>
      <td class="numeric">${salary(row.salary)}</td>
      <td class="numeric">${row.games}</td>
      <td class="numeric">${number(row.effSalary)}</td>
      <td class="numeric">${percent(row.winPct)}</td>
      <td class="numeric">${number(row.sprocket)}</td>
      <td class="numeric">${number(row.opi)}</td>
      <td class="numeric">${number(row.dpi)}</td>
    </tr>`).join("");

  return `
    <div class="prospect-meta">
      <span>Showing ${result.rows.length} of ${result.total} matching rows.</span>
      ${result.state ? `<span>Data refreshed ${escapeHtml(freshness(result.state.refreshedAt))} · checked ${escapeHtml(freshness(result.state.checkedAt))}</span>` : ""}
    </div>
    <div class="prospect-table-scroll">
      <table class="prospect-table">
        <thead><tr>
          <th>Name</th><th>Status</th><th>Salary</th><th>Games</th><th>Eff/Sal</th><th>Win%</th><th>Sprocket</th><th>OPI</th><th>DPI</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function detailMetric(label: string, value: string): string {
  return `<div class="detail-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function playerDetail(player: ScoutingRow): string {
  const flags = player.flags || "None";
  return `
    <div class="prospect-modal" role="dialog" aria-modal="true" aria-labelledby="prospect-detail-title">
      <button class="modal-backdrop" data-close-detail aria-label="Close player detail"></button>
      <div class="prospect-modal-card">
        <div class="modal-heading">
          <div>
            <div class="eyebrow">${escapeHtml(player.league)} · ${escapeHtml(player.mode === "combined" ? "Combined" : player.mode)} · ${escapeHtml(player.status)}</div>
            <h2 id="prospect-detail-title">${escapeHtml(player.name)}</h2>
          </div>
          <button class="icon-button" data-close-detail aria-label="Close player detail">×</button>
        </div>
        <div class="detail-summary">
          ${detailMetric("Salary", salary(player.salary))}
          ${detailMetric("Games", String(player.games))}
          ${detailMetric("Eff/Sal", number(player.effSalary))}
          ${detailMetric("Win%", percent(player.winPct))}
          ${detailMetric("Sprocket", number(player.sprocket))}
          ${detailMetric("OPI", number(player.opi))}
          ${detailMetric("DPI", number(player.dpi))}
        </div>
        <h3>Scouting detail</h3>
        <div class="detail-grid">
          ${detailMetric("Temp", number(player.temp, 3))}
          ${detailMetric("Bucket", player.bucket)}
          ${detailMetric("Main Role", player.mainRole)}
          ${detailMetric("Alt Role", player.altRole)}
          ${detailMetric("Role Confidence", player.roleConfidence)}
          ${detailMetric("Score", number(player.score))}
          ${detailMetric("Goals", number(player.goals))}
          ${detailMetric("Assists", number(player.assists))}
          ${detailMetric("Saves", number(player.saves))}
          ${detailMetric("Shots", number(player.shots))}
          ${detailMetric("SH%", percent(player.shotPct))}
          ${detailMetric("Demos", number(player.demos))}
        </div>
        <div class="detail-flags"><span>Flags</span><strong>${escapeHtml(flags)}</strong></div>
      </div>
    </div>`;
}

export function mountScoutingPanel(
  panel: HTMLElement,
  api: ActivityApi,
  setStatus: ActivityStatus,
): void {
  panel.innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">Scouting</div><h2>HC Prospect Board</h2>
      <p>Filter the board before comparing prospects. Select any player row for the deeper scouting profile.</p></div></div>
    <form id="prospect-filters" class="filter-grid">
      <label>Search<input name="search" type="search" placeholder="Player name" /></label>
      <label>Division<select name="league"><option value="">Any</option><option>FL</option><option>AL</option><option>CL</option><option>ML</option><option>PL</option></select></label>
      <label>Mode<select name="mode"><option value="">Any</option><option value="2s">2v2</option><option value="3s">3v3</option><option value="combined">Combined</option></select></label>
      <label>Temperature<select name="temperature"><option value="">Any</option><option>Hot</option><option>Warm</option><option>Cold</option></select></label>
      <label>Role<input name="role" type="text" placeholder="1st, 2nd, 3rd" /></label>
      <label>Min games<input name="min_games" type="number" min="0" value="0" /></label>
      <label>Salary min<input name="salary_min" type="number" min="0" step="0.5" /></label>
      <label>Salary max<input name="salary_max" type="number" min="0" step="0.5" /></label>
      <label>Sort by<select name="sort"><option value="efficiency">Efficiency / Salary</option><option value="gpi">Sprocket</option><option value="opi">OPI</option><option value="dpi">DPI</option><option value="win_pct">Win %</option><option value="games">Games</option><option value="salary">Salary</option><option value="temp">Temperature</option></select></label>
      <label>Rows<select name="limit"><option>10</option><option selected>25</option><option>50</option></select></label>
      <label class="check-option"><input name="hide_low_sample" type="checkbox" /> Hide low-sample players</label>
      <button class="primary-button" type="submit">Apply Filters</button>
    </form>
    <div class="table-card" id="prospect-results"><div class="table-empty"><strong>Loading prospect board…</strong></div></div>
    <div id="prospect-detail-root"></div>`;

  const form = panel.querySelector<HTMLFormElement>("#prospect-filters");
  const output = panel.querySelector<HTMLDivElement>("#prospect-results");
  const detailRoot = panel.querySelector<HTMLDivElement>("#prospect-detail-root");
  if (!form || !output || !detailRoot) return;

  let requestSerial = 0;

  const closeDetail = (): void => {
    detailRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
  };

  const bindDetailClose = (): void => {
    detailRoot.querySelectorAll<HTMLElement>("[data-close-detail]").forEach(element => {
      element.addEventListener("click", closeDetail);
    });
  };

  const openPlayer = async (playerId: string, mode: ScoutingMode): Promise<void> => {
    try {
      setStatus("Loading player detail…");
      const data = await api<ScoutingPlayerResponse>(
        `/api/activity/scouting/player?id=${encodeURIComponent(playerId)}&mode=${encodeURIComponent(mode)}`,
      );
      detailRoot.innerHTML = playerDetail(data.player);
      document.body.classList.add("modal-open");
      bindDetailClose();
      setStatus(`${data.player.name} loaded.`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const bindRows = (): void => {
    output.querySelectorAll<HTMLTableRowElement>(".prospect-row").forEach(row => {
      const open = (): void => {
        const playerId = row.dataset.playerId ?? "";
        const mode = (row.dataset.mode ?? "") as ScoutingMode;
        if (playerId && mode) void openPlayer(playerId, mode);
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    });
  };

  const load = async (): Promise<void> => {
    const serial = ++requestSerial;
    const params = queryFromForm(form);
    output.innerHTML = `<div class="table-empty"><strong>Loading prospect board…</strong></div>`;
    try {
      const result = await api<ScoutingListResponse>(`/api/activity/scouting?${params.toString()}`);
      if (serial !== requestSerial) return;
      output.innerHTML = resultTable(result);
      bindRows();
      setStatus(`Loaded ${result.rows.length} of ${result.total} matching prospect rows.`, "success");
    } catch (error) {
      if (serial !== requestSerial) return;
      output.innerHTML = `<div class="table-empty"><strong>Could not load the prospect board.</strong><span>${escapeHtml(error instanceof Error ? error.message : String(error))}</span></div>`;
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  };

  form.addEventListener("submit", event => {
    event.preventDefault();
    void load();
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && detailRoot.childElementCount > 0) closeDetail();
  });

  void load();
}
