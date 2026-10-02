import {DiscordSDK} from "@discord/embedded-app-sdk";
import {mountPersonalAvailabilityPanel, type AvailabilityWindow} from "./personal-availability";
import {mountEligibilityPanel} from "./eligibility";
import {mountScoutingPanel} from "./scouting";
import {mountTeamAvailabilityPanel} from "./team-availability";
import {mountTeamEligibilityPanel} from "./team-eligibility";
import "./style.css";
import "./eligibility.css";
import "./team-availability.css";

interface ActivityContext {
  guild_id: string;
  user_id: string;
  display_name: string;
  franchise: {name: string; code: string | null} | null;
  access: {
    roster_member: boolean;
    staff: boolean;
    player_id: string | null;
    player_name: string | null;
    division: string | null;
    staff_position: string | null;
    slot: string | null;
  };
  current_week_start: string;
  timezone: string;
  window: AvailabilityWindow;
}

function requireApp(): HTMLDivElement {
  const value = document.querySelector<HTMLDivElement>("#app");
  if (!value) throw new Error("Missing #app root.");
  return value;
}

const app = requireApp();
const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
let discordSdk: DiscordSDK | null = null;
let accessToken = "";
let guildId = "";
let context: ActivityContext | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char] ?? char);
}

function setStatus(message: string, kind: "normal" | "success" | "error" = "normal"): void {
  const element = document.querySelector<HTMLDivElement>("#activity-status");
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (guildId) headers.set("X-Hagrid-Guild-Id", guildId);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(path, {...init, headers});
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `Request failed (${response.status}).`);
  }
  return payload as T;
}

async function setupDiscord(): Promise<void> {
  if (!clientId) throw new Error("VITE_DISCORD_CLIENT_ID is not configured.");
  discordSdk = new DiscordSDK(clientId);
  await discordSdk.ready();

  const {code} = await discordSdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "applications.commands", "guilds.members.read"],
  });

  const tokenResponse = await fetch("/api/activity/token", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({code}),
  });
  const tokenBody = await tokenResponse.json() as {access_token?: string; error?: string};
  if (!tokenResponse.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error ?? "Discord authorization failed.");
  }

  accessToken = tokenBody.access_token;
  const auth = await discordSdk.commands.authenticate({access_token: accessToken});
  if (!auth) throw new Error("Discord authentication failed.");

  guildId = discordSdk.guildId ?? "";
  if (!guildId) throw new Error("Hagrid's Activity must be opened from a Discord server.");
  context = await api<ActivityContext>("/api/activity/context");
}

function switchTab(tab: string): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll<HTMLElement>("[data-panel]").forEach(panel => {
    panel.classList.toggle("hidden", panel.dataset.panel !== tab);
  });
}

function shell(): {loadPersonal: (() => Promise<void>) | null} {
  if (!context) return {loadPersonal: null};
  const franchise = context.franchise?.name ?? "Franchise not configured";
  const accessLabel = context.access.staff
    ? context.access.staff_position ?? context.access.slot ?? "Staff"
    : context.access.division ?? "Roster";

  if (!context.access.roster_member) {
    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar"><div><div class="eyebrow">${escapeHtml(franchise)}</div><h1>Hagrid</h1></div><div class="user-chip">${escapeHtml(context.display_name)}</div></header>
        <div class="startup-card access-card"><h2>Roster access required</h2><p>Your Discord account is verified in this server, but Hagrid cannot match it to the current franchise roster.</p><p>Ask franchise staff to run the data sync and confirm your Discord ID is linked in Sprocket/MLE.</p></div>
      </div>`;
    return {loadPersonal: null};
  }

  const staffPanels = context.access.staff
    ? `<section id="team-eligibility-panel" class="panel hidden" data-panel="team-eligibility"></section><section id="team-availability-panel" class="panel hidden" data-panel="team-availability"></section><section id="scouting-panel" class="panel hidden" data-panel="scouting"></section>`
    : "";

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div><div class="eyebrow">${escapeHtml(franchise)}</div><h1>Hagrid</h1></div>
        <div class="user-chip"><span>${escapeHtml(context.display_name)}</span><small>${escapeHtml(accessLabel)}</small></div>
      </header>
      <nav class="tabs" aria-label="Hagrid tools">
        <button class="tab active" data-tab="eligibility">Eligibility</button>${context.access.staff ? `<button class="tab" data-tab="team-eligibility">Team Eligibility</button>` : ""}<button class="tab" data-tab="availability">Availability</button>${context.access.staff ? `<button class="tab" data-tab="team-availability">Team Availability</button><button class="tab" data-tab="scouting">Scouting</button>` : ""}
      </nav>
      <main>
        <section id="eligibility-panel" class="panel" data-panel="eligibility"></section><section id="availability-panel" class="panel hidden" data-panel="availability"></section>${staffPanels}
      </main>
      <div id="activity-status" class="activity-status" aria-live="polite"></div>
    </div>`;

  const availabilityPanel = document.querySelector<HTMLElement>("#availability-panel");
  const personal = availabilityPanel
    ? mountPersonalAvailabilityPanel(
      availabilityPanel,
      api,
      setStatus,
      context.current_week_start,
      context.window,
    )
    : null;

  let eligibilityMounted = false;
  let teamEligibilityMounted = false;
  let teamAvailabilityMounted = false;
  let scoutingMounted = false;
  const mountLazyView = (tab: string): void => {
    if (tab === "eligibility" && !eligibilityMounted) {
      const panel = document.querySelector<HTMLElement>("#eligibility-panel");
      if (panel) {
        mountEligibilityPanel(
          panel,
          api,
          setStatus,
          Boolean(context?.access.staff),
          context?.access.player_id ?? null,
        );
        eligibilityMounted = true;
      }
    }

    if (!context?.access.staff) return;
    if (tab === "team-eligibility" && !teamEligibilityMounted) {
      const panel = document.querySelector<HTMLElement>("#team-eligibility-panel");
      if (panel) {
        mountTeamEligibilityPanel(panel, api, setStatus);
        teamEligibilityMounted = true;
      }
    }
    if (tab === "team-availability" && !teamAvailabilityMounted) {
      const panel = document.querySelector<HTMLElement>("#team-availability-panel");
      if (panel) {
        mountTeamAvailabilityPanel(panel, api, setStatus, context.current_week_start);
        teamAvailabilityMounted = true;
      }
    }
    if (tab === "scouting" && !scoutingMounted) {
      const panel = document.querySelector<HTMLElement>("#scouting-panel");
      if (panel) {
        mountScoutingPanel(panel, api, setStatus);
        scoutingMounted = true;
      }
    }
  };

  document.querySelectorAll<HTMLButtonElement>(".tab").forEach(button => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab ?? "availability";
      switchTab(tab);
      mountLazyView(tab);
    });
  });

  mountLazyView("eligibility");
  return {loadPersonal: personal?.load ?? null};
}

async function start(): Promise<void> {
  try {
    await setupDiscord();
    shell();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    app.innerHTML = `<div class="startup-card error-card"><h1>Hagrid</h1><p>Could not start the Activity.</p><code>${escapeHtml(message)}</code></div>`;
  }
}

void start();
