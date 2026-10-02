export type EligibilityApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type EligibilityStatus = (
  message: string,
  kind?: "normal" | "success" | "error",
) => void;

interface EligibilityDecayPoint {
  date: string;
  points: number;
  weekStart: string;
  eligible: boolean;
  isMonday: boolean;
  isToday: boolean;
}

interface EligibilityPlayer {
  sprocket_player_id: string;
  name: string;
  division: string | null;
  skill_group: string | null;
  slot: string | null;
  salary: number | null;
  current_scrim_points: number;
  eligible_through: string | null;
  source_as_of: string | null;
}

interface SelectablePlayer {
  sprocket_player_id: string;
  name: string;
  division: string | null;
  slot: string | null;
}

interface EligibilityResponse {
  player: EligibilityPlayer;
  requirement: number;
  today: string;
  week_start: string;
  current_week_eligible: boolean;
  source_week_eligible: boolean;
  calculated_current_points: number;
  event_count: number;
  decay: EligibilityDecayPoint[];
  selectable_players: SelectablePlayer[];
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

function formatDate(value: string | null): string {
  if (!value) return "—";
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const normalized = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : us
      ? `${us[3]}-${String(Number(us[1])).padStart(2, "0")}-${String(Number(us[2])).padStart(2, "0")}`
      : "";
  if (!normalized) return value;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatShortDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Current Sprocket publication";
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

function salary(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function chartSvg(data: EligibilityResponse): string {
  const points = data.decay;
  if (points.length < 2) {
    return `<div class="eligibility-empty">Not enough eligibility history is available to draw the decay chart.</div>`;
  }

  const width = 1000;
  const height = 360;
  const margin = {left: 62, right: 24, top: 26, bottom: 54};
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxPoints = Math.max(...points.map(point => point.points), data.player.current_scrim_points);
  const yMax = Math.max(100, data.requirement + 20, Math.ceil((maxPoints + 20) / 10) * 10);
  const x = (index: number): number =>
    margin.left + (index / Math.max(1, points.length - 1)) * plotWidth;
  const y = (value: number): number =>
    margin.top + ((yMax - Math.max(0, value)) / yMax) * plotHeight;
  const thresholdY = y(data.requirement);
  const bottom = margin.top + plotHeight;

  const yTicks = [...new Set([
    0,
    data.requirement,
    Math.round(yMax / 2 / 10) * 10,
    yMax,
  ])].sort((a, b) => a - b);

  const horizontal = yTicks.map(value => {
    const py = y(value);
    return `<line x1="${margin.left}" y1="${py}" x2="${width - margin.right}" y2="${py}" class="eligibility-grid-line" />
      <text x="${margin.left - 10}" y="${py + 4}" class="eligibility-axis-label" text-anchor="end">${value}</text>`;
  }).join("");

  const mondayLines = points.map((point, index) => {
    if (!point.isMonday) return "";
    const px = x(index);
    return `<line x1="${px}" y1="${margin.top}" x2="${px}" y2="${bottom}" class="eligibility-week-line" />
      <text x="${px}" y="${bottom + 24}" class="eligibility-date-label" text-anchor="middle">${escapeHtml(formatShortDate(point.date))}</text>`;
  }).join("");

  const todayIndex = points.findIndex(point => point.isToday);
  const todayLine = todayIndex >= 0
    ? `<line x1="${x(todayIndex)}" y1="${margin.top}" x2="${x(todayIndex)}" y2="${bottom}" class="eligibility-today-line" />
       <text x="${x(todayIndex) + 5}" y="${margin.top + 14}" class="eligibility-today-label">Today</text>`
    : "";

  const edges = points.slice(1).map((point, index) => {
    const previous = points[index];
    return `<line x1="${x(index)}" y1="${y(previous.points)}" x2="${x(index + 1)}" y2="${y(point.points)}"
      class="eligibility-series ${point.eligible ? "eligible" : "ineligible"}" />`;
  }).join("");

  const hitTargets = points.map((point, index) =>
    `<circle cx="${x(index)}" cy="${y(point.points)}" r="8" class="eligibility-hit">
      <title>${escapeHtml(formatDate(point.date))}: ${point.points} points · ${point.eligible ? "Eligible week" : "Ineligible week"}</title>
    </circle>`,
  ).join("");

  return `
    <div class="eligibility-chart-scroll">
      <svg class="eligibility-chart" viewBox="0 0 ${width} ${height}" role="img"
        aria-label="Scrim point decay for ${escapeHtml(data.player.name)} from ${escapeHtml(formatDate(points[0].date))} through ${escapeHtml(formatDate(points.at(-1)?.date ?? points[0].date))}">
        <rect x="${margin.left}" y="${margin.top}" width="${plotWidth}" height="${Math.max(0, thresholdY - margin.top)}" class="eligibility-zone eligible-zone" />
        <rect x="${margin.left}" y="${thresholdY}" width="${plotWidth}" height="${Math.max(0, bottom - thresholdY)}" class="eligibility-zone ineligible-zone" />
        ${horizontal}
        ${mondayLines}
        ${todayLine}
        <line x1="${margin.left}" y1="${thresholdY}" x2="${width - margin.right}" y2="${thresholdY}" class="eligibility-threshold-line" />
        <text x="${width - margin.right - 6}" y="${thresholdY - 8}" text-anchor="end" class="eligibility-threshold-label">Eligibility ${data.requirement}</text>
        <text x="${width - margin.right - 8}" y="${margin.top + 18}" text-anchor="end" class="eligibility-zone-label eligible-label">Eligible</text>
        <text x="${width - margin.right - 8}" y="${bottom - 10}" text-anchor="end" class="eligibility-zone-label ineligible-label">Ineligible</text>
        ${edges}
        ${hitTargets}
        <text x="${margin.left}" y="17" class="eligibility-axis-title">Scrim Points</text>
      </svg>
    </div>`;
}

function playerOptions(players: SelectablePlayer[], selected: string): string {
  return players.map(player => {
    const suffix = [player.division, player.slot].filter(Boolean).join(" · ");
    return `<option value="${escapeHtml(player.sprocket_player_id)}" ${player.sprocket_player_id === selected ? "selected" : ""}>${escapeHtml(player.name)}${suffix ? ` — ${escapeHtml(suffix)}` : ""}</option>`;
  }).join("");
}

export function mountEligibilityPanel(
  panel: HTMLElement,
  api: EligibilityApi,
  setStatus: EligibilityStatus,
  isStaff: boolean,
  ownPlayerId: string | null,
): void {
  let selectedPlayerId = ownPlayerId ?? "";
  let data: EligibilityResponse | null = null;

  panel.innerHTML = `
    <div class="panel-heading">
      <div>
        <div class="eyebrow">Scrim Eligibility</div>
        <h2>Active Scrim Eligibility</h2>
        <p>Track active scrim points from this week's Monday through 30 days from today. Scrim points expire 30 days after they are earned, and weekly eligibility is locked from Monday.</p>
      </div>
    </div>
    <div id="eligibility-toolbar" class="toolbar eligibility-toolbar"></div>
    <div id="eligibility-content" class="eligibility-content">
      <div class="table-empty"><strong>Loading eligibility tracker…</strong></div>
    </div>`;

  const toolbar = panel.querySelector<HTMLElement>("#eligibility-toolbar");
  const output = panel.querySelector<HTMLElement>("#eligibility-content");
  if (!toolbar || !output) return;

  const bindToolbar = (): void => {
    const select = toolbar.querySelector<HTMLSelectElement>("#eligibility-player-select");
    select?.addEventListener("change", () => {
      selectedPlayerId = select.value;
      void load();
    });
    toolbar.querySelector("#eligibility-refresh")?.addEventListener("click", () => void load());
  };

  const render = (): void => {
    if (!data) return;
    selectedPlayerId = data.player.sprocket_player_id;

    toolbar.innerHTML = `
      ${isStaff && data.selectable_players.length > 0
        ? `<label>Player<select id="eligibility-player-select">${playerOptions(data.selectable_players, data.player.sprocket_player_id)}</select></label>`
        : `<div class="eligibility-player-fixed"><span>Player</span><strong>${escapeHtml(data.player.name)}</strong></div>`}
      <button id="eligibility-refresh" class="secondary-button">Refresh</button>
      <span class="eligibility-source">Source: ${escapeHtml(formatTimestamp(data.player.source_as_of))}</span>`;
    bindToolbar();

    const statusClass = data.current_week_eligible ? "eligible" : "ineligible";
    const statusText = data.current_week_eligible ? "Eligible" : "Not eligible";
    const mismatch = data.current_week_eligible !== data.source_week_eligible
      ? `<div class="eligibility-note warning">The raw point decay and Sprocket's current <strong>Eligible Through</strong> field do not agree for this week. Hagrid is showing the Monday-locked decay calculation in the chart.</div>`
      : "";
    const pointsMismatch = data.calculated_current_points !== data.player.current_scrim_points
      ? `<div class="eligibility-note warning">The event ledger currently totals ${data.calculated_current_points} points for today while the player feed reports ${data.player.current_scrim_points}. The two publications may be between refreshes.</div>`
      : "";

    output.innerHTML = `
      <div class="eligibility-player-heading">
        <div>
          <div class="eyebrow">${escapeHtml([data.player.division, data.player.slot].filter(Boolean).join(" · ") || "Roster")}</div>
          <h3>${escapeHtml(data.player.name)}</h3>
        </div>
        <span class="eligibility-status ${statusClass}">${statusText} this week</span>
      </div>
      <div class="eligibility-summary">
        <div><span>Current points</span><strong>${data.player.current_scrim_points}</strong></div>
        <div><span>Requirement</span><strong>${data.requirement}</strong></div>
        <div><span>Eligible through</span><strong>${escapeHtml(formatDate(data.player.eligible_through))}</strong></div>
        <div><span>Salary</span><strong>${escapeHtml(salary(data.player.salary))}</strong></div>
      </div>
      ${mismatch}${pointsMismatch}
      <div class="eligibility-chart-card">
        <div class="eligibility-chart-title"><div><strong>Scrim Point Decay</strong><span>${data.event_count} eligibility event${data.event_count === 1 ? "" : "s"} in the source ledger</span></div>
          <div class="eligibility-legend"><span><i class="legend-line eligible"></i>Eligible week</span><span><i class="legend-line ineligible"></i>Ineligible week</span></div>
        </div>
        ${chartSvg(data)}
      </div>
      <div class="eligibility-note">A week is treated as eligible when the player meets the division requirement on Monday. If points decay below the line later in that week, eligibility remains locked through Sunday.</div>`;
  };

  const load = async (): Promise<void> => {
    try {
      setStatus("Loading eligibility tracker…");
      const query = selectedPlayerId ? `?player_id=${encodeURIComponent(selectedPlayerId)}` : "";
      data = await api<EligibilityResponse>(`/api/activity/eligibility${query}`);
      render();
      setStatus(`${data.player.name}'s eligibility tracker loaded.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.innerHTML = `<div class="table-empty"><strong>Could not load eligibility.</strong><span>${escapeHtml(message)}</span></div>`;
      setStatus(message, "error");
    }
  };

  void load();
}
