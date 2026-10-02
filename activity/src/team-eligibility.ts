export type TeamEligibilityApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type TeamEligibilityStatus = (
  message: string,
  kind?: "normal" | "success" | "error",
) => void;

type Division = "all" | "FL" | "AL" | "CL" | "ML";

interface TeamEligibilityPlayer {
  sprocket_player_id: string;
  name: string;
  division: string | null;
  slot: string | null;
  salary: number | null;
  current_scrim_points: number;
  calculated_current_points: number;
  requirement: number | null;
  current_week_eligible: boolean;
  source_week_eligible: boolean;
  eligible_through: string | null;
  source_as_of: string | null;
}

interface TeamEligibilityResponse {
  franchise: string;
  today: string;
  week_start: string;
  division: Division;
  players: TeamEligibilityPlayer[];
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
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function salary(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function mountTeamEligibilityPanel(
  panel: HTMLElement,
  api: TeamEligibilityApi,
  setStatus: TeamEligibilityStatus,
): void {
  let division: Division = "all";
  let data: TeamEligibilityResponse | null = null;

  panel.innerHTML = `
    <div class="panel-heading">
      <div>
        <div class="eyebrow">Captain+ · Scrim Eligibility</div>
        <h2>Team Eligibility</h2>
        <p>Review the current competitive roster at a glance. Status follows Hagrid's weekly eligibility latch, while points and Eligible Through come from the current Sprocket publications.</p>
      </div>
    </div>
    <div class="toolbar eligibility-toolbar">
      <div class="segmented-control" id="team-eligibility-divisions">
        <button class="secondary-button active" data-team-eligibility-division="all">All</button>
        <button class="secondary-button" data-team-eligibility-division="FL">FL</button>
        <button class="secondary-button" data-team-eligibility-division="AL">AL</button>
        <button class="secondary-button" data-team-eligibility-division="CL">CL</button>
        <button class="secondary-button" data-team-eligibility-division="ML">ML</button>
      </div>
      <button id="team-eligibility-refresh" class="secondary-button">Refresh</button>
    </div>
    <div id="team-eligibility-content" class="eligibility-content">
      <div class="table-empty"><strong>Loading team eligibility…</strong></div>
    </div>`;

  const output = panel.querySelector<HTMLElement>("#team-eligibility-content");
  if (!output) return;

  const syncButtons = (): void => {
    panel.querySelectorAll<HTMLButtonElement>("[data-team-eligibility-division]").forEach(button => {
      button.classList.toggle("active", button.dataset.teamEligibilityDivision === division);
    });
  };

  const render = (): void => {
    if (!data) return;
    if (data.players.length === 0) {
      output.innerHTML = `<div class="table-empty"><strong>No competitive roster entries matched this division.</strong></div>`;
      return;
    }

    const eligible = data.players.filter(player => player.current_week_eligible).length;
    const mismatches = data.players.filter(player => player.current_week_eligible !== player.source_week_eligible).length;

    output.innerHTML = `
      <div class="eligibility-summary">
        <div><span>Roster</span><strong>${data.players.length}</strong></div>
        <div><span>Eligible this week</span><strong>${eligible}</strong></div>
        <div><span>Need attention</span><strong>${data.players.length - eligible}</strong></div>
        <div><span>Source mismatches</span><strong>${mismatches}</strong></div>
      </div>
      <div class="prospect-table-scroll">
        <table class="prospect-table">
          <thead><tr><th>Player</th><th>Division</th><th>Slot</th><th>Status</th><th>Points</th><th>Req.</th><th>Eligible Through</th><th>Salary</th></tr></thead>
          <tbody>
            ${data.players.map(player => `
              <tr>
                <td class="prospect-name"><strong>${escapeHtml(player.name)}</strong></td>
                <td>${escapeHtml(player.division ?? "—")}</td>
                <td>${escapeHtml(player.slot ?? "—")}</td>
                <td><span class="eligibility-status ${player.current_week_eligible ? "eligible" : "ineligible"}">${player.current_week_eligible ? "Eligible" : "Not eligible"}</span></td>
                <td class="numeric">${player.current_scrim_points}</td>
                <td class="numeric">${player.requirement ?? "—"}</td>
                <td>${escapeHtml(formatDate(player.eligible_through))}</td>
                <td class="numeric">${escapeHtml(salary(player.salary))}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      ${mismatches > 0 ? `<div class="eligibility-note warning">${mismatches} player${mismatches === 1 ? "" : "s"} currently differ between Hagrid's weekly-latched calculation and Sprocket's Eligible Through field.</div>` : ""}
    `;
  };

  const load = async (): Promise<void> => {
    try {
      setStatus("Loading team eligibility…");
      data = await api<TeamEligibilityResponse>(
        `/api/activity/eligibility/team?division=${encodeURIComponent(division)}`,
      );
      render();
      setStatus(`Loaded ${data.players.length} team eligibility row${data.players.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.innerHTML = `<div class="table-empty"><strong>Could not load team eligibility.</strong><span>${escapeHtml(message)}</span></div>`;
      setStatus(message, "error");
    }
  };

  panel.querySelectorAll<HTMLButtonElement>("[data-team-eligibility-division]").forEach(button => {
    button.addEventListener("click", () => {
      const value = button.dataset.teamEligibilityDivision;
      if (value !== "all" && value !== "FL" && value !== "AL" && value !== "CL" && value !== "ML") return;
      if (value === division) return;
      division = value;
      syncButtons();
      void load();
    });
  });
  panel.querySelector("#team-eligibility-refresh")?.addEventListener("click", () => void load());

  syncButtons();
  void load();
}
