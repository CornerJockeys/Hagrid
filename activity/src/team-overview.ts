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

interface UsageBand {
  used: number;
  limit: number;
  remaining: number;
}

interface HighUsagePlayer {
  sprocket_player_id: string | null;
  name: string;
  slot: string;
  high_usage: boolean;
  doubles: UsageBand;
  standard: UsageBand;
  combined: UsageBand;
}

interface TeamOverviewRow {
  division: Division;
  roster_count: number;
  roster_limit: number;
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
  slots: {
    filled: number;
    limit: number;
    open: number;
  };
  high_usage: {
    active: boolean;
    data_available: boolean;
    starts_on: string;
    players: HighUsagePlayer[];
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

function usageLine(label: string, value: UsageBand): string {
  return `${label} ${value.used}/${value.limit} · ${value.remaining} left`;
}

export function mountTeamOverviewPanel(
  panel: HTMLElement,
  api: TeamOverviewApi,
  setStatus: TeamOverviewStatus,
  currentWeekStart: string,
  windowConfig: AvailabilityWindow,
  ownPlayerId: string | null,
  canEditOwnAvailability: boolean,
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
    </section>
    <div id="high-usage-modal"></div>`;

  const cards = panel.querySelector<HTMLElement>("#team-overview-cards");
  const modalRoot = panel.querySelector<HTMLElement>("#high-usage-modal");
  if (!cards || !modalRoot) return;

  const closeHighUsage = (): void => {
    modalRoot.innerHTML = "";
    document.body.classList.remove("modal-open");
  };

  const openHighUsage = (team: TeamOverviewRow): void => {
    const status = !team.high_usage.active
      ? `Usage tracking begins ${shortDate(team.high_usage.starts_on)}.`
      : !team.high_usage.data_available
        ? "Hagrid is awaiting current slot-usage data for this team."
        : "";

    const rows = team.high_usage.players.map(player => `
      <div class="usage-detail-player${player.high_usage ? " high-usage-player" : ""}">
        <div class="usage-detail-player-heading">
          <strong>${escapeHtml(player.name)}</strong>
          <span>Slot ${escapeHtml(player.slot)}${player.high_usage ? " · High Usage" : ""}</span>
        </div>
        <div class="usage-detail-grid">
          <div class="detail-metric">
            <span>2s</span>
            <strong>${player.doubles.used}/${player.doubles.limit}</strong>
            <small>${player.doubles.remaining} remaining</small>
          </div>
          <div class="detail-metric">
            <span>3s</span>
            <strong>${player.standard.used}/${player.standard.limit}</strong>
            <small>${player.standard.remaining} remaining</small>
          </div>
          <div class="detail-metric">
            <span>Combined</span>
            <strong>${player.combined.used}/${player.combined.limit}</strong>
            <small>${player.combined.remaining} remaining</small>
          </div>
        </div>
      </div>`).join("");

    modalRoot.innerHTML = `
      <div class="prospect-modal" role="dialog" aria-modal="true" aria-label="${team.division} high usage">
        <button class="modal-backdrop" data-close-high-usage aria-label="Close"></button>
        <div class="prospect-modal-card usage-modal-card">
          <div class="modal-heading">
            <div>
              <div class="eyebrow">${escapeHtml(overview?.franchise ?? "")} · ${team.division}</div>
              <h2>Slot Usage</h2>
              <p class="usage-modal-help">All occupied slots are listed. Players with two or fewer uses remaining in either 2s or 3s are moved to the top.</p>
            </div>
            <button class="icon-button" data-close-high-usage aria-label="Close">×</button>
          </div>
          ${status
            ? `<div class="notice-card"><p>${escapeHtml(status)}</p></div>`
            : `<div class="usage-detail-list">${rows}</div>`}
        </div>
      </div>`;
    document.body.classList.add("modal-open");
    modalRoot.querySelectorAll<HTMLElement>("[data-close-high-usage]").forEach(element => {
      element.addEventListener("click", closeHighUsage);
    });
  };

  const mountEligibility = (): void => {
    if (eligibilityMounted) return;
    const teamRoot = panel.querySelector<HTMLElement>("#combined-team-eligibility");
    const playerRoot = panel.querySelector<HTMLElement>("#combined-player-eligibility");
    if (!teamRoot || !playerRoot) return;
    mountTeamEligibilityPanel(teamRoot, api, setStatus);
    mountEligibilityPanel(playerRoot, api, setStatus, true, ownPlayerId);
    eligibilityMounted = true;
  };

  const mountAvailability = (): void => {
    if (availabilityMounted) return;
    const personalRoot = panel.querySelector<HTMLElement>("#combined-my-availability");
    const teamRoot = panel.querySelector<HTMLElement>("#combined-team-availability");
    if (!personalRoot || !teamRoot) return;
    if (canEditOwnAvailability) {
      const personal = mountPersonalAvailabilityPanel(
        personalRoot,
        api,
        setStatus,
        currentWeekStart,
        windowConfig,
      );
      personalAvailabilityLoad = personal.load;
    } else {
      personalRoot.innerHTML = "";
    }
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
      const highUsagePlayers = team.high_usage.players.filter(player => player.high_usage);
      const highUsageText = !team.high_usage.active
        ? `Begins ${shortDate(team.high_usage.starts_on)}`
        : !team.high_usage.data_available
          ? "Awaiting usage data"
          : highUsagePlayers.length === 0
            ? "No players near mode limits"
            : `${highUsagePlayers.length} player${highUsagePlayers.length === 1 ? "" : "s"} near a mode limit`;
      const usageRows = team.high_usage.active && team.high_usage.data_available
        ? team.high_usage.players.map(player => `
            <div class="overview-slot-usage${player.high_usage ? " high" : ""}">
              <div class="overview-slot-usage-heading">
                <strong>Slot ${escapeHtml(player.slot)}</strong>
                <span>${escapeHtml(player.name)}</span>
              </div>
              <div class="overview-slot-usage-modes">
                <div class="overview-slot-usage-mode usage-2s">
                  <span>2s</span>
                  <strong>${player.doubles.used}/${player.doubles.limit}</strong>
                </div>
                <div class="overview-slot-usage-mode usage-3s">
                  <span>3s</span>
                  <strong>${player.standard.used}/${player.standard.limit}</strong>
                </div>
              </div>
            </div>`).join("")
        : "";
      const slotsText = team.slots.open === 0
        ? "Roster full"
        : `${team.slots.open} open slot${team.slots.open === 1 ? "" : "s"}`;

      return `
        <article class="team-overview-card">
          <div class="team-overview-card-title">
            <div><div class="eyebrow">${escapeHtml(overview?.franchise ?? "")}</div><h3>${team.division}</h3></div>
            <span class="team-roster-count">${team.roster_count}/${team.roster_limit} players</span>
          </div>
          <div class="team-overview-metrics">
            <button data-open-team-page="eligibility">
              <span>Eligibility</span>
              <strong>${team.eligibility.eligible}/${team.roster_count}</strong>
              <small>${team.eligibility.attention === 0 ? "Everyone eligible" : `${team.eligibility.attention} need attention`}</small>
            </button>
            <div>
              <span>Slots</span>
              <strong>${team.slots.filled}/${team.slots.limit}</strong>
              <small>${escapeHtml(slotsText)}</small>
            </div>
            <button class="team-high-usage" data-open-high-usage="${team.division}">
              <span>High Usage</span>
              <strong>${team.high_usage.active && team.high_usage.data_available ? highUsagePlayers.length : "—"}</strong>
              <small>${escapeHtml(highUsageText)}</small>
              ${usageRows ? `<div class="overview-slot-usage-list">${usageRows}</div>` : ""}
              ${usageRows ? '<small class="usage-click-hint">Click for combined usage and remaining totals.</small>' : ""}
            </button>
            <div>
              <span>Team Salary</span>
              <strong>${number(team.salary.team_salary)} / ${number(team.salary.cap)}</strong>
              <small>Cap space ${number(team.salary.cap_space)}</small>
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
    cards.querySelectorAll<HTMLButtonElement>("[data-open-high-usage]").forEach(button => {
      button.addEventListener("click", () => {
        const division = button.dataset.openHighUsage as Division | undefined;
        const team = overview?.teams.find(value => value.division === division);
        if (team) openHighUsage(team);
      });
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
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape" && modalRoot.innerHTML) closeHighUsage();
  });

  void load();
}
