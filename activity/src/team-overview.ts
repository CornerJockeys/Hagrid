import {mountEligibilityPanel} from "./eligibility";
import {
  mountPersonalAvailabilityPanel,
  type AvailabilityWindow,
} from "./personal-availability";
import {mountTeamAvailabilityPanel} from "./team-availability";
import {mountTeamEligibilityPanel} from "./team-eligibility";

export type TeamOverviewApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type TeamOverviewStatus = (
  message: string,
  kind?: "normal" | "success" | "error",
) => void;

type Division = "FL" | "AL" | "CL" | "ML";

interface TeamOverviewRow {
  division: Division;
  roster_count: number;
  eligibility: {
    eligible: number;
    attention: number;
  };
  salary: {
    team_salary: number;
    cap: number;
    cap_space: number;
    counted_players: number;
    salary_player_limit: number;
  };
  usage: {
    active: boolean;
    data_available: boolean;
    warning_slots: number;
    tracked_slots: number;
    roster_slots: number;
    starts_on: string;
  };
  availability: {
    week_start: string;
    submitted: number;
    missing: number;
    linked: number;
    roster: number;
  };
}

interface TeamOverviewResponse {
  franchise: string;
  today: string;
  week_start: string;
  visible_divisions: Division[];
  teams: TeamOverviewRow[];
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

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function mountTeamOverviewPanel(
  panel: HTMLElement,
  api: TeamOverviewApi,
  setStatus: TeamOverviewStatus,
  currentWeekStart: string,
  windowConfig: AvailabilityWindow,
  ownPlayerId: string | null,
): void {
  let overview: TeamOverviewResponse | null = null;
  let eligibilityMounted = false;
  let availabilityMounted = false;
  let personalAvailabilityLoad: (() => Promise<void>) | null = null;
  let personalAvailabilityLoaded = false;

  panel.innerHTML = `
    <div class="team-hub-heading">
      <div>
        <div class="eyebrow">Franchise Operations</div>
        <h2>Team Overview</h2>
        <p>Roster health at a glance. Your Discord role controls which divisional teams are visible.</p>
      </div>
      <button id="team-overview-refresh" class="secondary-button">Refresh</button>
    </div>
    <div class="team-hub-nav" role="tablist" aria-label="Team Overview pages">
      <button class="team-hub-tab active" data-team-page="overview" role="tab">Overview</button>
      <button class="team-hub-tab" data-team-page="eligibility" role="tab">Eligibility</button>
      <button class="team-hub-tab" data-team-page="availability" role="tab">Availability</button>
    </div>
    <section class="team-hub-page" data-team-page-panel="overview">
      <div id="team-overview-cards" class="team-overview-grid">
        <div class="table-empty"><strong>Loading team overview…</strong></div>
      </div>
    </section>
    <section class="team-hub-page hidden" data-team-page-panel="eligibility">
      <div class="team-hub-stack">
        <div id="combined-team-eligibility"></div>
        <div id="combined-player-eligibility"></div>
      </div>
    </section>
    <section class="team-hub-page hidden" data-team-page-panel="availability">
      <div class="team-hub-stack">
        <div id="combined-my-availability"></div>
        <div id="combined-team-availability"></div>
      </div>
    </section>`;

  const cards = panel.querySelector<HTMLElement>("#team-overview-cards");
  if (!cards) return;

  const mountEligibility = (): void => {
    if (eligibilityMounted) return;
    const teamRoot = panel.querySelector<HTMLElement>("#combined-team-eligibility");
    const playerRoot = panel.querySelector<HTMLElement>("#combined-player-eligibility");
    if (!teamRoot || !playerRoot) return;
    mountTeamEligibilityPanel(teamRoot, api, setStatus);
    // Every roster member can browse the eligibility of players in the team(s)
    // exposed by the backend. The backend remains authoritative for scope.
    mountEligibilityPanel(playerRoot, api, setStatus, true, ownPlayerId);
    eligibilityMounted = true;
  };

  const mountAvailability = (): void => {
    if (availabilityMounted) return;
    const personalRoot = panel.querySelector<HTMLElement>("#combined-my-availability");
    const teamRoot = panel.querySelector<HTMLElement>("#combined-team-availability");
    if (!personalRoot || !teamRoot) return;
    const personal = mountPersonalAvailabilityPanel(
      personalRoot,
      api,
      setStatus,
      currentWeekStart,
      windowConfig,
    );
    personalAvailabilityLoad = personal.load;
    mountTeamAvailabilityPanel(teamRoot, api, setStatus, currentWeekStart);
    availabilityMounted = true;
  };

  const switchPage = (page: string): void => {
    panel.querySelectorAll<HTMLButtonElement>("[data-team-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.teamPage === page);
      button.setAttribute("aria-selected", button.dataset.teamPage === page ? "true" : "false");
    });
    panel.querySelectorAll<HTMLElement>("[data-team-page-panel]").forEach(section => {
      section.classList.toggle("hidden", section.dataset.teamPagePanel !== page);
    });
    if (page === "eligibility") mountEligibility();
    if (page === "availability") {
      mountAvailability();
      if (!personalAvailabilityLoaded && personalAvailabilityLoad) {
        personalAvailabilityLoaded = true;
        void personalAvailabilityLoad().catch(error =>
          setStatus(error instanceof Error ? error.message : String(error), "error"),
        );
      }
    }
  };

  const render = (): void => {
    if (!overview) return;
    if (overview.teams.length === 0) {
      cards.innerHTML = `<div class="table-empty"><strong>No visible divisional roster was found.</strong></div>`;
      return;
    }

    cards.innerHTML = overview.teams.map(team => {
      const usageText = !team.usage.active
        ? `Begins ${shortDate(team.usage.starts_on)}`
        : !team.usage.data_available
          ? "Awaiting usage data"
          : team.usage.warning_slots === 0
            ? "No slots near limits"
            : `${team.usage.warning_slots} slot${team.usage.warning_slots === 1 ? "" : "s"} near limits`;
      const salaryClass = team.salary.cap_space < 0 ? "negative" : "";
      return `
        <article class="team-overview-card">
          <div class="team-overview-card-title">
            <div><div class="eyebrow">${escapeHtml(overview?.franchise ?? "")}</div><h3>${team.division}</h3></div>
            <span class="team-roster-count">${team.roster_count} player${team.roster_count === 1 ? "" : "s"}</span>
          </div>
          <div class="team-overview-metrics">
            <button data-open-team-page="eligibility">
              <span>Eligibility</span>
              <strong>${team.eligibility.eligible}/${team.roster_count}</strong>
              <small>${team.eligibility.attention === 0 ? "Everyone eligible" : `${team.eligibility.attention} need attention`}</small>
            </button>
            <div>
              <span>Usage</span>
              <strong>${team.usage.active && team.usage.data_available ? `${team.usage.tracked_slots}/${team.usage.roster_slots}` : "—"}</strong>
              <small>${escapeHtml(usageText)}</small>
            </div>
            <div>
              <span>Team Salary</span>
              <strong>${number(team.salary.team_salary)} / ${number(team.salary.cap)}</strong>
              <small class="${salaryClass}">Cap space ${number(team.salary.cap_space)}</small>
            </div>
            <button data-open-team-page="availability">
              <span>Availability</span>
              <strong>${team.availability.submitted}/${team.availability.roster}</strong>
              <small>${team.availability.missing === 0 ? "All submitted" : `${team.availability.missing} missing`}</small>
            </button>
          </div>
        </article>`;
    }).join("");

    cards.querySelectorAll<HTMLButtonElement>("[data-open-team-page]").forEach(button => {
      button.addEventListener("click", () => switchPage(button.dataset.openTeamPage ?? "overview"));
    });
  };

  const load = async (): Promise<void> => {
    try {
      setStatus("Loading team overview…");
      overview = await api<TeamOverviewResponse>("/api/activity/team-overview");
      render();
      setStatus(
        `Loaded ${overview.teams.length} visible divisional team${overview.teams.length === 1 ? "" : "s"}.`,
        "success",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cards.innerHTML = `<div class="table-empty"><strong>Could not load Team Overview.</strong><span>${escapeHtml(message)}</span></div>`;
      setStatus(message, "error");
    }
  };

  panel.querySelectorAll<HTMLButtonElement>("[data-team-page]").forEach(button => {
    button.addEventListener("click", () => switchPage(button.dataset.teamPage ?? "overview"));
  });
  panel.querySelector("#team-overview-refresh")?.addEventListener("click", () => void load());

  void load();
}
