export type TeamAvailabilityApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type TeamAvailabilityStatus = (
  message: string,
  kind?: "normal" | "success" | "error",
) => void;

type Resolution = 30 | 60;
type SlotState = 1 | 2;
type TeamDivisionFilter = "all" | "FL" | "AL" | "CL" | "ML";

interface AvailabilitySlot {
  day: number;
  minute: number;
  state: SlotState;
}

interface TeamPlayer {
  sprocketPlayerId: string;
  discordUserId: string | null;
  name: string;
  division: string | null;
  salary: number | null;
  slot: string | null;
  staffPosition: string | null;
  submitted: boolean;
  linked: boolean;
  updatedAt: string | null;
  slots: AvailabilitySlot[];
}

interface TeamAvailabilityResponse {
  week_start: string;
  division: string;
  window: {
    start_minute: number;
    end_minute: number;
    base_resolution_minutes: number;
  };
  players: TeamPlayer[];
  missing: TeamPlayer[];
  divisions: string[];
}

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const teamDivisions: Exclude<TeamDivisionFilter, "all">[] = ["FL", "AL", "CL", "ML"];

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char] ?? char);
}

function shiftWeek(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount * 7);
  return date.toISOString().slice(0, 10);
}

function formatWeek(value: string): string {
  const start = new Date(`${value}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

function formatTime(minute: number): string {
  const hour24 = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not submitted";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(parsed);
}

function key(day: number, minute: number): string {
  return `${day}:${minute}`;
}

function slotMap(player: TeamPlayer): Map<string, SlotState> {
  return new Map(player.slots.map(slot => [key(slot.day, slot.minute), slot.state]));
}

function playerAvailableForDisplay(
  player: TeamPlayer,
  day: number,
  minute: number,
  resolution: Resolution,
): {available: boolean; preferred: boolean} {
  if (!player.submitted) return {available: false, preferred: false};
  const values = slotMap(player);
  let preferred = true;
  for (let offset = 0; offset < resolution; offset += 30) {
    const state = values.get(key(day, minute + offset));
    if (state !== 1 && state !== 2) return {available: false, preferred: false};
    if (state !== 2) preferred = false;
  }
  return {available: true, preferred};
}

function compressRanges(player: TeamPlayer, day: number): string {
  const minutes = player.slots
    .filter(slot => slot.day === day)
    .map(slot => slot.minute)
    .sort((a, b) => a - b);
  if (minutes.length === 0) return "Unavailable";

  const ranges: Array<{start: number; end: number}> = [];
  let start = minutes[0];
  let previous = minutes[0];
  for (const minute of minutes.slice(1)) {
    if (minute === previous + 30) {
      previous = minute;
      continue;
    }
    ranges.push({start, end: previous + 30});
    start = minute;
    previous = minute;
  }
  ranges.push({start, end: previous + 30});
  return ranges.map(range => `${formatTime(range.start)}–${formatTime(range.end)}`).join(", ");
}

function detailModal(title: string, body: string): string {
  return `
    <div class="prospect-modal team-detail-modal" role="dialog" aria-modal="true">
      <button class="modal-backdrop" data-close-team-detail aria-label="Close detail"></button>
      <div class="prospect-modal-card team-modal-card">
        <div class="modal-heading"><h2>${escapeHtml(title)}</h2><button class="icon-button" data-close-team-detail aria-label="Close detail">×</button></div>
        ${body}
      </div>
    </div>`;
}

export function mountTeamAvailabilityPanel(
  panel: HTMLElement,
  api: TeamAvailabilityApi,
  setStatus: TeamAvailabilityStatus,
  initialWeek: string,
): void {
  let weekStart = initialWeek;
  let resolution: Resolution = 60;
  let selectedDivision: TeamDivisionFilter = "all";
  let data: TeamAvailabilityResponse | null = null;

  panel.innerHTML = `
    <div class="panel-heading">
      <div><div class="eyebrow">Staff · Eastern Time (ET)</div><h2>Team Availability</h2>
        <p>Compare the current competitive roster, spot missing submissions, and open any time block or player for detail.</p></div>
      <div class="week-picker">
        <button id="team-previous-week" class="icon-button" aria-label="Previous week">←</button>
        <div><strong id="team-week-label">${formatWeek(weekStart)}</strong><span>Staff view</span></div>
        <button id="team-next-week" class="icon-button" aria-label="Next week">→</button>
      </div>
    </div>
    <div class="toolbar team-toolbar">
      <div class="team-division-control">
        <span>Division</span>
        <div class="team-division-filter" role="group" aria-label="Filter team availability by division">
          <button type="button" class="team-division-button active" data-team-division="all" aria-pressed="true">All</button>
          ${teamDivisions.map(division => `<button type="button" class="team-division-button" data-team-division="${division}" aria-pressed="false">${division}</button>`).join("")}
        </div>
      </div>
      <label>Time blocks<select id="team-resolution"><option value="60">1 hour</option><option value="30">30 minutes</option></select></label>
      <button id="team-refresh" class="secondary-button">Refresh</button>
    </div>
    <div id="team-summary" class="staff-summary"></div>
    <div id="team-missing" class="missing-card"></div>
    <div class="availability-scroll team-availability-scroll"><div id="team-availability-grid" class="availability-grid team-grid"></div></div>
    <div class="table-card team-roster-card" id="team-roster"></div>
    <div id="team-detail-root"></div>`;

  const divisionButtons = [...panel.querySelectorAll<HTMLButtonElement>("[data-team-division]")];
  const resolutionSelect = panel.querySelector<HTMLSelectElement>("#team-resolution");
  const label = panel.querySelector<HTMLElement>("#team-week-label");
  const summary = panel.querySelector<HTMLElement>("#team-summary");
  const missing = panel.querySelector<HTMLElement>("#team-missing");
  const grid = panel.querySelector<HTMLElement>("#team-availability-grid");
  const roster = panel.querySelector<HTMLElement>("#team-roster");
  const detailRoot = panel.querySelector<HTMLElement>("#team-detail-root");
  if (!resolutionSelect || !label || !summary || !missing || !grid || !roster || !detailRoot) return;

  const syncDivisionButtons = (): void => {
    for (const button of divisionButtons) {
      const active = button.dataset.teamDivision === selectedDivision;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };

  const closeDetail = (): void => {
    detailRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
  };

  const bindClose = (): void => {
    detailRoot.querySelectorAll<HTMLElement>("[data-close-team-detail]").forEach(element => {
      element.addEventListener("click", closeDetail);
    });
  };

  const openTimeDetail = (day: number, minute: number): void => {
    if (!data) return;
    const available: TeamPlayer[] = [];
    const unavailable: TeamPlayer[] = [];
    const missingPlayers: TeamPlayer[] = [];
    for (const player of data.players) {
      if (!player.submitted || !player.linked) {
        missingPlayers.push(player);
        continue;
      }
      if (playerAvailableForDisplay(player, day, minute, resolution).available) available.push(player);
      else unavailable.push(player);
    }
    const group = (heading: string, values: TeamPlayer[], empty: string): string => `
      <section class="time-detail-group"><h3>${escapeHtml(heading)} · ${values.length}</h3>
      ${values.length > 0 ? values.map(player => `<div class="detail-person"><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.slot ?? "Roster")}</span></div>`).join("") : `<p class="muted-copy">${escapeHtml(empty)}</p>`}</section>`;
    detailRoot.innerHTML = detailModal(
      `${dayNames[day]} ${formatTime(minute)}${resolution === 60 ? `–${formatTime(minute + 60)}` : `–${formatTime(minute + 30)}`}`,
      `<div class="time-detail-columns">
        ${group("Available", available, "No rostered players are available for this whole block.")}
        ${group("Unavailable", unavailable, "No submitted players are unavailable for this block.")}
        ${group("Missing", missingPlayers, "Everyone has submitted availability.")}
      </div>`,
    );
    document.body.classList.add("modal-open");
    bindClose();
  };

  const openPlayerDetail = (player: TeamPlayer): void => {
    const days = dayNames.map((day, index) => `
      <div class="player-day-row"><strong>${day}</strong><span>${escapeHtml(player.submitted ? compressRanges(player, index) : "No submission")}</span></div>`).join("");
    const status = !player.linked ? "Discord account not linked" : player.submitted ? `Submitted ${formatTimestamp(player.updatedAt)}` : "Missing submission";
    detailRoot.innerHTML = detailModal(
      player.name,
      `<div class="player-detail-meta">
        <span>${escapeHtml(player.division ?? "No division")}</span><span>${escapeHtml(player.slot ?? "No slot")}</span><span>${escapeHtml(status)}</span>
      </div><div class="player-week-detail">${days}</div>`,
    );
    document.body.classList.add("modal-open");
    bindClose();
  };

  const render = (): void => {
    if (!data) return;
    label.textContent = formatWeek(data.week_start);
    syncDivisionButtons();

    const submitted = data.players.filter(player => player.submitted).length;
    const linked = data.players.filter(player => player.linked).length;
    const rosterLabel = selectedDivision === "all" ? "Roster" : `${selectedDivision} Roster`;
    summary.innerHTML = `
      <div><span>${rosterLabel}</span><strong>${data.players.length}</strong></div>
      <div><span>Submitted</span><strong>${submitted}</strong></div>
      <div><span>Missing</span><strong>${data.missing.length}</strong></div>
      <div><span>Discord Linked</span><strong>${linked}/${data.players.length}</strong></div>`;

    if (data.missing.length === 0) {
      missing.innerHTML = `<div><div class="eyebrow">Missing submissions</div><strong>Everyone is in.</strong></div>`;
    } else {
      missing.innerHTML = `<div><div class="eyebrow">Missing submissions · ${data.missing.length}</div><div class="missing-list">
        ${data.missing.map(player => `<button class="missing-chip" data-player-id="${escapeHtml(player.sprocketPlayerId)}">${escapeHtml(player.name)}${player.linked ? "" : " · unlinked"}</button>`).join("")}
      </div></div>`;
      missing.querySelectorAll<HTMLButtonElement>(".missing-chip").forEach(button => {
        const player = data?.players.find(value => value.sprocketPlayerId === button.dataset.playerId);
        if (player) button.addEventListener("click", () => openPlayerDetail(player));
      });
    }

    const parts: string[] = ["<div class=\"grid-corner\">Time</div>"];
    for (const day of dayNames) parts.push(`<div class="day-heading">${day}</div>`);
    for (let minute = data.window.start_minute; minute < data.window.end_minute; minute += resolution) {
      parts.push(`<div class="time-heading">${formatTime(minute)}</div>`);
      for (let day = 0; day < 7; day += 1) {
        let available = 0;
        let preferred = 0;
        for (const player of data.players) {
          const state = playerAvailableForDisplay(player, day, minute, resolution);
          if (state.available) available += 1;
          if (state.preferred) preferred += 1;
        }
        const rosterCount = data.players.length;
        const ratio = rosterCount > 0 ? available / rosterCount : 0;
        const title = `${dayNames[day]} ${formatTime(minute)}: ${available}/${rosterCount} available${preferred > 0 ? `, ${preferred} preferred` : ""}`;
        parts.push(`<button class="team-heat-cell ${available === 0 ? "is-empty" : ""}" data-day="${day}" data-minute="${minute}" style="--availability-ratio:${ratio.toFixed(3)}" title="${escapeHtml(title)}">
          <strong>${available === 0 ? "" : available}</strong>${preferred > 0 ? `<small>★ ${preferred}</small>` : ""}
        </button>`);
      }
    }
    grid.innerHTML = parts.join("");
    grid.querySelectorAll<HTMLButtonElement>(".team-heat-cell").forEach(cell => {
      cell.addEventListener("click", () => openTimeDetail(Number(cell.dataset.day), Number(cell.dataset.minute)));
    });

    roster.innerHTML = data.players.length === 0
      ? `<div class="table-empty"><strong>No competitive roster entries matched this division.</strong></div>`
      : `<div class="prospect-meta"><span>Roster submissions</span><span>${submitted}/${data.players.length} submitted</span></div>
        <div class="prospect-table-scroll team-roster-scroll"><table class="prospect-table team-roster-table"><thead><tr><th>Player</th><th>Division</th><th>Slot</th><th>Status</th><th>Updated</th></tr></thead><tbody>
        ${data.players.map(player => `<tr class="prospect-row team-player-row" tabindex="0" data-player-id="${escapeHtml(player.sprocketPlayerId)}">
          <td class="prospect-name"><strong>${escapeHtml(player.name)}</strong></td><td>${escapeHtml(player.division ?? "—")}</td><td>${escapeHtml(player.slot ?? "—")}</td>
          <td>${!player.linked ? '<span class="status-pill status-pend">Unlinked</span>' : player.submitted ? '<span class="status-pill status-fa">Submitted</span>' : '<span class="status-pill status-pend">Missing</span>'}</td>
          <td>${escapeHtml(formatTimestamp(player.updatedAt))}</td></tr>`).join("")}
        </tbody></table></div>`;
    roster.querySelectorAll<HTMLTableRowElement>(".team-player-row").forEach(row => {
      const player = data?.players.find(value => value.sprocketPlayerId === row.dataset.playerId);
      if (!player) return;
      const open = (): void => openPlayerDetail(player);
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
    try {
      setStatus("Loading team availability…");
      data = await api<TeamAvailabilityResponse>(
        `/api/activity/availability/team?week=${encodeURIComponent(weekStart)}&division=${encodeURIComponent(selectedDivision)}`,
      );
      weekStart = data.week_start;
      render();
      setStatus(`Loaded ${data.players.length} rostered player${data.players.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  };

  panel.querySelector("#team-previous-week")?.addEventListener("click", () => {
    weekStart = shiftWeek(weekStart, -1);
    void load();
  });
  panel.querySelector("#team-next-week")?.addEventListener("click", () => {
    weekStart = shiftWeek(weekStart, 1);
    void load();
  });
  panel.querySelector("#team-refresh")?.addEventListener("click", () => void load());
  for (const button of divisionButtons) {
    button.addEventListener("click", () => {
      const value = button.dataset.teamDivision;
      if (value !== "all" && value !== "FL" && value !== "AL" && value !== "CL" && value !== "ML") return;
      if (value === selectedDivision) return;
      selectedDivision = value;
      syncDivisionButtons();
      void load();
    });
  }
  resolutionSelect.addEventListener("change", () => {
    resolution = Number(resolutionSelect.value) as Resolution;
    render();
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && detailRoot.childElementCount > 0) closeDetail();
  });

  syncDivisionButtons();
  void load();
}