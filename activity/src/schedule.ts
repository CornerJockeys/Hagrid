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

interface ScheduleBye {
  label: string;
  afterMatchWeek: number;
}

interface ScheduleResponse {
  franchise: string;
  today: string;
  default_match_week: number;
  weeks: ScheduleWeek[];
  byes: ScheduleBye[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;",
  })[char] ?? char);
}

export function mountSchedulePanel(
  panel: HTMLElement,
  api: ScheduleApi,
  setStatus: ScheduleStatus,
): void {
  let data: ScheduleResponse | null = null;
  let selectedWeek = 1;

  panel.innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">Season 20 · League schedule</div><h2>Schedule</h2>
      <p>League-wide home/away schedule. The home team chooses the map.</p></div></div>
    <div class="toolbar schedule-toolbar">
      <label>Match Week<select id="schedule-week"></select></label>
      <button id="schedule-refresh" class="secondary-button">Refresh</button>
    </div>
    <div id="schedule-content" class="table-card"><div class="table-empty"><strong>Loading schedule…</strong></div></div>`;

  const select = panel.querySelector<HTMLSelectElement>("#schedule-week");
  const output = panel.querySelector<HTMLElement>("#schedule-content");
  if (!select || !output) return;

  const render = (): void => {
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
      setStatus(`Loaded S20 schedule. Defaulted to Match ${selectedWeek}.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.innerHTML = `<div class="table-empty"><strong>Could not load the schedule.</strong><span>${escapeHtml(message)}</span></div>`;
      setStatus(message, "error");
    }
  };

  select.addEventListener("change", () => {
    const value = Number(select.value);
    if (!Number.isInteger(value)) return;
    selectedWeek = value;
    render();
  });
  panel.querySelector("#schedule-refresh")?.addEventListener("click", () => void load());

  void load();
}
