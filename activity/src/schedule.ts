export type ScheduleApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type ScheduleStatus = (message: string, kind?: "normal" | "success" | "error") => void;

interface ScheduleMatchup {
  away: string;
  home: string;
}

interface ScheduleWeek {
  matchWeek: number;
  label: string;
  startDate: string;
  endDate: string;
  kind: "Division" | "Conference";
  homeChoosesMap: true;
  matchups: ScheduleMatchup[];
}

interface FranchiseScheduleWeek {
  matchWeek: number;
  label: string;
  startDate: string;
  endDate: string;
  kind: "Division" | "Conference";
  homeChoosesMap: true;
  matchup: ScheduleMatchup | null;
}

interface ScheduleBye {
  label: string;
  afterMatchWeek: number;
}

interface ScheduleResponse {
  franchise: string;
  today: string;
  default_match_week: number;
  franchise_schedule: FranchiseScheduleWeek[];
  weeks: ScheduleWeek[];
  byes: ScheduleBye[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;",
  })[char] ?? char);
}

function opponent(franchise: string, matchup: ScheduleMatchup): string {
  return matchup.away === franchise ? matchup.home : matchup.away;
}

function location(franchise: string, matchup: ScheduleMatchup): "Home" | "Away" {
  return matchup.home === franchise ? "Home" : "Away";
}

export function mountSchedulePanel(
  panel: HTMLElement,
  api: ScheduleApi,
  setStatus: ScheduleStatus,
): void {
  let data: ScheduleResponse | null = null;
  let selectedWeek = 1;
  let fullSchedule = false;

  panel.innerHTML = `
    <div class="panel-heading">
      <div><div class="eyebrow">Season 20 · Schedule</div><h2>Schedule</h2>
        <p>Your franchise schedule opens first. Use Full Schedule to browse every league matchup by Match Week.</p></div>
      <button id="schedule-view-toggle" class="secondary-button">Full Schedule</button>
    </div>
    <div id="schedule-full-toolbar" class="toolbar schedule-toolbar" style="display:none">
      <label>Match Week<select id="schedule-week"></select></label>
      <button id="schedule-refresh" class="secondary-button">Refresh</button>
    </div>
    <div id="schedule-content" class="table-card"><div class="table-empty"><strong>Loading schedule…</strong></div></div>`;

  const select = panel.querySelector<HTMLSelectElement>("#schedule-week");
  const output = panel.querySelector<HTMLElement>("#schedule-content");
  const fullToolbar = panel.querySelector<HTMLElement>("#schedule-full-toolbar");
  const toggle = panel.querySelector<HTMLButtonElement>("#schedule-view-toggle");
  if (!select || !output || !fullToolbar || !toggle) return;

  const renderFranchiseSchedule = (): void => {
    if (!data) return;

    const rows = data.franchise_schedule.map(week => {
      if (!week.matchup) {
        return `
          <tr>
            <td class="numeric">${week.matchWeek}</td>
            <td>${escapeHtml(week.label)}</td>
            <td>${escapeHtml(week.kind)}</td>
            <td colspan="2">No scheduled matchup found</td>
          </tr>`;
      }

      return `
        <tr>
          <td class="numeric">${week.matchWeek}</td>
          <td>${escapeHtml(week.label)}</td>
          <td>${escapeHtml(week.kind)}</td>
          <td><strong>${escapeHtml(opponent(data!.franchise, week.matchup))}</strong></td>
          <td>${location(data!.franchise, week.matchup)}</td>
        </tr>`;
    }).join("");

    output.innerHTML = `
      <div class="prospect-meta">
        <span>${escapeHtml(data.franchise)} · Matches 1–10</span>
        <span>Home team chooses map</span>
      </div>
      <div class="prospect-table-scroll">
        <table class="prospect-table schedule-table franchise-schedule-table">
          <thead><tr><th>Match</th><th>Dates</th><th>Type</th><th>Opponent</th><th>Site</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  const renderFullSchedule = (): void => {
    if (!data) return;
    const week = data.weeks.find(value => value.matchWeek === selectedWeek);
    if (!week) {
      output.innerHTML = `<div class="table-empty"><strong>Schedule week not found.</strong></div>`;
      return;
    }

    const rows = week.matchups.map(matchup => {
      const own = matchup.away === data!.franchise || matchup.home === data!.franchise;
      return `
        <tr class="${own ? "standings-own-row" : ""}">
          <td><strong>${escapeHtml(matchup.away)}</strong></td>
          <td class="schedule-at">@</td>
          <td><strong>${escapeHtml(matchup.home)}</strong></td>
        </tr>`;
    }).join("");

    const byeAfter = data.byes.filter(value => value.afterMatchWeek === week.matchWeek);
    output.innerHTML = `
      <div class="prospect-meta">
        <span>Match ${week.matchWeek} · ${escapeHtml(week.kind)}</span>
        <span>${escapeHtml(week.label)}</span>
      </div>
      <div class="prospect-table-scroll">
        <table class="prospect-table schedule-table">
          <thead><tr><th>Away</th><th></th><th>Home</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${byeAfter.length > 0 ? `<div class="schedule-byes">${byeAfter.map(value => `<span class="player-badge">${escapeHtml(value.label)}</span>`).join("")}</div>` : ""}
    `;
  };

  const render = (): void => {
    if (!data) return;
    fullToolbar.style.display = fullSchedule ? "flex" : "none";
    toggle.textContent = fullSchedule ? "Our Schedule" : "Full Schedule";
    if (fullSchedule) renderFullSchedule();
    else renderFranchiseSchedule();
  };

  const populate = (): void => {
    if (!data) return;
    select.innerHTML = data.weeks.map(week =>
      `<option value="${week.matchWeek}">Match ${week.matchWeek} — ${escapeHtml(week.label)} · ${escapeHtml(week.kind)}</option>`
    ).join("");
    selectedWeek = data.default_match_week;
    select.value = String(selectedWeek);
    render();
  };

  const load = async (): Promise<void> => {
    try {
      setStatus("Loading Season 20 schedule…");
      data = await api<ScheduleResponse>("/api/activity/schedule");
      populate();
      setStatus(`Loaded ${data.franchise}'s S20 schedule.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.innerHTML = `<div class="table-empty"><strong>Could not load the schedule.</strong><span>${escapeHtml(message)}</span></div>`;
      setStatus(message, "error");
    }
  };

  toggle.addEventListener("click", () => {
    fullSchedule = !fullSchedule;
    render();
  });
  select.addEventListener("change", () => {
    const value = Number(select.value);
    if (!Number.isInteger(value)) return;
    selectedWeek = value;
    render();
  });
  panel.querySelector("#schedule-refresh")?.addEventListener("click", () => void load());

  void load();
}
