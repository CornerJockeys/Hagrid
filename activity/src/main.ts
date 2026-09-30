import {DiscordSDK} from "@discord/embedded-app-sdk";
import "./style.css";

type SlotState = 1 | 2;
type EditMode = "drag" | "checkbox";
type Resolution = 30 | 60;

interface ActivityContext {
  guild_id: string;
  user_id: string;
  display_name: string;
  franchise: {name: string; code: string | null} | null;
  current_week_start: string;
  timezone: string;
  window: {
    start_minute: number;
    end_minute: number;
    base_resolution_minutes: number;
  };
}

interface AvailabilitySlot {
  day: number;
  minute: number;
  state: SlotState;
}

interface AvailabilityResponse {
  week_start: string;
  previous_week_start: string;
  slots: AvailabilitySlot[];
}

function requireApp(): HTMLDivElement {
  const value = document.querySelector<HTMLDivElement>("#app");
  if (!value) throw new Error("Missing #app root.");
  return value;
}

const app = requireApp();
const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

let discordSdk: DiscordSDK | null = null;
let accessToken = "";
let guildId = "";
let context: ActivityContext | null = null;
let weekStart = "";
let resolution: Resolution = 60;
let editMode: EditMode = "drag";
let slots = new Map<string, SlotState>();
let dirty = false;
let dragging = false;
let dragValue = true;
let lastPaintedKey = "";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char] ?? char);
}

function slotKey(day: number, minute: number): string {
  return `${day}:${minute}`;
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
  weekStart = context.current_week_start;
}

function shell(): void {
  const franchise = context?.franchise?.name ?? "Franchise not configured";
  const person = context?.display_name ?? "Discord user";
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div><div class="eyebrow">${escapeHtml(franchise)}</div><h1>Hagrid</h1></div>
        <div class="user-chip">${escapeHtml(person)}</div>
      </header>
      <nav class="tabs" aria-label="Hagrid tools">
        <button class="tab active" data-tab="availability">Availability</button>
        <button class="tab" data-tab="scouting">HC Prospect Board</button>
      </nav>
      <main>
        <section id="availability-panel" class="panel"></section>
        <section id="scouting-panel" class="panel hidden"></section>
      </main>
      <div id="activity-status" class="activity-status" aria-live="polite"></div>
    </div>`;

  document.querySelectorAll<HTMLButtonElement>(".tab").forEach(button => {
    button.addEventListener("click", () => switchTab(button.dataset.tab ?? "availability"));
  });
  renderAvailabilityPanel();
  renderScoutingPanel();
}

function switchTab(tab: string): void {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelector("#availability-panel")?.classList.toggle("hidden", tab !== "availability");
  document.querySelector("#scouting-panel")?.classList.toggle("hidden", tab !== "scouting");
}

function displayCellSelected(day: number, minute: number): boolean {
  for (let offset = 0; offset < resolution; offset += 30) {
    if (!slots.has(slotKey(day, minute + offset))) return false;
  }
  return true;
}

function displayCellPartial(day: number, minute: number): boolean {
  let count = 0;
  for (let offset = 0; offset < resolution; offset += 30) {
    if (slots.has(slotKey(day, minute + offset))) count += 1;
  }
  return count > 0 && count < resolution / 30;
}

function applyDisplayCell(day: number, minute: number, selected: boolean): void {
  for (let offset = 0; offset < resolution; offset += 30) {
    const key = slotKey(day, minute + offset);
    if (selected) slots.set(key, 1);
    else slots.delete(key);
  }
  dirty = true;
  updateSaveState();
}

function syncCellVisual(cell: HTMLElement, day: number, minute: number): void {
  const selected = displayCellSelected(day, minute);
  const partial = displayCellPartial(day, minute);
  cell.classList.toggle("selected", selected);
  cell.classList.toggle("partial", partial);
  cell.setAttribute("aria-checked", selected ? "true" : "false");
  const input = cell.querySelector<HTMLInputElement>("input[type=checkbox]");
  if (input) {
    input.checked = selected;
    input.indeterminate = partial;
  }
}

function updateSaveState(): void {
  const button = document.querySelector<HTMLButtonElement>("#save-availability");
  if (button) button.disabled = !dirty;
  const marker = document.querySelector<HTMLSpanElement>("#dirty-marker");
  if (marker) marker.textContent = dirty ? "Unsaved changes" : "Saved";
}

function renderAvailabilityPanel(): void {
  const panel = document.querySelector<HTMLElement>("#availability-panel");
  if (!panel || !context) return;

  panel.innerHTML = `
    <div class="panel-heading">
      <div>
        <div class="eyebrow">Eastern Time (ET)</div>
        <h2>My Availability</h2>
        <p>Noon to midnight, seven days a week. Drag across the grid or switch to checkbox editing.</p>
      </div>
      <div class="week-picker">
        <button id="previous-week" class="icon-button" aria-label="Previous week">←</button>
        <div><strong id="week-label">${formatWeek(weekStart)}</strong><span id="dirty-marker">Saved</span></div>
        <button id="next-week" class="icon-button" aria-label="Next week">→</button>
      </div>
    </div>
    <div class="toolbar">
      <label>Time blocks
        <select id="resolution-select">
          <option value="60" ${resolution === 60 ? "selected" : ""}>1 hour</option>
          <option value="30" ${resolution === 30 ? "selected" : ""}>30 minutes</option>
        </select>
      </label>
      <label>Edit style
        <select id="edit-mode-select">
          <option value="drag" ${editMode === "drag" ? "selected" : ""}>Drag to select</option>
          <option value="checkbox" ${editMode === "checkbox" ? "selected" : ""}>Checkboxes</option>
        </select>
      </label>
      <button id="copy-previous" class="secondary-button">Copy Previous Week</button>
      <button id="clear-availability" class="secondary-button">Clear</button>
      <button id="save-availability" class="primary-button" disabled>Save Availability</button>
    </div>
    <div class="grid-help">
      <span class="legend-swatch"></span><span>Available</span>
      <span class="muted">Selections are stored in 30-minute slots even when the grid is shown hourly.</span>
    </div>
    <div class="availability-scroll"><div id="availability-grid" class="availability-grid"></div></div>`;

  document.querySelector<HTMLSelectElement>("#resolution-select")?.addEventListener("change", event => {
    resolution = Number((event.target as HTMLSelectElement).value) as Resolution;
    renderAvailabilityGrid();
  });
  document.querySelector<HTMLSelectElement>("#edit-mode-select")?.addEventListener("change", event => {
    editMode = (event.target as HTMLSelectElement).value as EditMode;
    renderAvailabilityGrid();
  });
  document.querySelector("#previous-week")?.addEventListener("click", () => void changeWeek(-1));
  document.querySelector("#next-week")?.addEventListener("click", () => void changeWeek(1));
  document.querySelector("#copy-previous")?.addEventListener("click", () => void copyPreviousWeek());
  document.querySelector("#clear-availability")?.addEventListener("click", () => {
    slots.clear();
    dirty = true;
    renderAvailabilityGrid();
    updateSaveState();
  });
  document.querySelector("#save-availability")?.addEventListener("click", () => void saveAvailability());

  renderAvailabilityGrid();
  updateSaveState();
}

function paintCell(cell: HTMLElement): void {
  const day = Number(cell.dataset.day);
  const minute = Number(cell.dataset.minute);
  const key = slotKey(day, minute);
  if (key === lastPaintedKey) return;
  lastPaintedKey = key;
  applyDisplayCell(day, minute, dragValue);
  syncCellVisual(cell, day, minute);
}

function renderAvailabilityGrid(): void {
  const grid = document.querySelector<HTMLDivElement>("#availability-grid");
  if (!grid || !context) return;

  const parts: string[] = ["<div class=\"grid-corner\">Time</div>"];
  for (const day of dayNames) parts.push(`<div class="day-heading">${day}</div>`);

  for (let minute = context.window.start_minute; minute < context.window.end_minute; minute += resolution) {
    parts.push(`<div class="time-heading">${formatTime(minute)}</div>`);
    for (let day = 0; day < 7; day += 1) {
      const selected = displayCellSelected(day, minute);
      const partial = displayCellPartial(day, minute);
      if (editMode === "checkbox") {
        parts.push(`<label class="availability-cell checkbox-cell ${selected ? "selected" : ""} ${partial ? "partial" : ""}"
          data-day="${day}" data-minute="${minute}" role="checkbox" aria-checked="${selected}">
          <input type="checkbox" ${selected ? "checked" : ""} /></label>`);
      } else {
        parts.push(`<button class="availability-cell drag-cell ${selected ? "selected" : ""} ${partial ? "partial" : ""}"
          data-day="${day}" data-minute="${minute}" role="checkbox" aria-checked="${selected}"
          aria-label="${dayNames[day]} ${formatTime(minute)}"></button>`);
      }
    }
  }
  grid.innerHTML = parts.join("");

  grid.querySelectorAll<HTMLElement>(".availability-cell").forEach(cell => {
    const day = Number(cell.dataset.day);
    const minute = Number(cell.dataset.minute);
    if (editMode === "checkbox") {
      cell.querySelector<HTMLInputElement>("input")?.addEventListener("change", event => {
        applyDisplayCell(day, minute, (event.target as HTMLInputElement).checked);
        syncCellVisual(cell, day, minute);
      });
      return;
    }

    cell.addEventListener("pointerdown", event => {
      event.preventDefault();
      dragging = true;
      lastPaintedKey = "";
      dragValue = !displayCellSelected(day, minute);
      paintCell(cell);
    });
  });

  grid.addEventListener("pointermove", event => {
    if (!dragging || editMode !== "drag") return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".availability-cell") as HTMLElement | null;
    if (!target || !grid.contains(target)) return;
    paintCell(target);
  });
}

window.addEventListener("pointerup", () => {
  dragging = false;
  lastPaintedKey = "";
});
window.addEventListener("pointercancel", () => {
  dragging = false;
  lastPaintedKey = "";
});

async function loadAvailability(targetWeek: string): Promise<void> {
  setStatus("Loading availability…");
  const data = await api<AvailabilityResponse>(`/api/activity/availability?week=${encodeURIComponent(targetWeek)}`);
  weekStart = data.week_start;
  slots = new Map(data.slots.map(slot => [slotKey(slot.day, slot.minute), slot.state]));
  dirty = false;
  const label = document.querySelector("#week-label");
  if (label) label.textContent = formatWeek(weekStart);
  renderAvailabilityGrid();
  updateSaveState();
  setStatus("Availability loaded.", "success");
}

async function changeWeek(amount: number): Promise<void> {
  if (dirty && !window.confirm("Discard your unsaved availability changes?")) return;
  try {
    await loadAvailability(shiftWeek(weekStart, amount));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function copyPreviousWeek(): Promise<void> {
  try {
    const previous = shiftWeek(weekStart, -1);
    const data = await api<AvailabilityResponse>(`/api/activity/availability?week=${encodeURIComponent(previous)}`);
    slots = new Map(data.slots.map(slot => [slotKey(slot.day, slot.minute), slot.state]));
    dirty = true;
    renderAvailabilityGrid();
    updateSaveState();
    setStatus(
      data.slots.length > 0
        ? `Loaded ${formatWeek(previous)} into this week's draft. Click Save Availability to keep it.`
        : "The previous week had no saved availability; this week's draft is now empty.",
      "success",
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

async function saveAvailability(): Promise<void> {
  try {
    setStatus("Saving availability…");
    const payload = [...slots.entries()].map(([key, state]) => {
      const [day, minute] = key.split(":").map(Number);
      return {day, minute, state};
    });
    await api<{ok: boolean}>("/api/activity/availability", {
      method: "PUT",
      body: JSON.stringify({week_start: weekStart, slots: payload}),
    });
    dirty = false;
    updateSaveState();
    setStatus("Availability saved.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
}

function renderScoutingPanel(): void {
  const panel = document.querySelector<HTMLElement>("#scouting-panel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">Scouting</div><h2>HC Prospect Board</h2>
      <p>Filter first, then compare a manageable set of prospects instead of rendering the entire player pool.</p></div></div>
    <form id="prospect-filters" class="filter-grid">
      <label>Search<input name="search" type="search" placeholder="Player name" /></label>
      <label>League<select name="league"><option value="">Any</option><option>FL</option><option>AL</option><option>CL</option><option>ML</option></select></label>
      <label>Mode<select name="mode"><option value="">Any</option><option value="2s">2v2</option><option value="3s">3v3</option><option value="combined">Combined</option></select></label>
      <label>Temperature<select name="temperature"><option value="">Any</option><option>Hot</option><option>Warm</option><option>Cold</option></select></label>
      <label>Role<input name="role" type="text" placeholder="Any role" /></label>
      <label>Min games<input name="min_games" type="number" min="0" value="10" /></label>
      <label>Salary min<input name="salary_min" type="number" min="0" step="0.5" /></label>
      <label>Salary max<input name="salary_max" type="number" min="0" step="0.5" /></label>
      <label>Sort by<select name="sort"><option value="efficiency">Efficiency / Salary</option><option value="gpi">GPI</option><option value="opi">OPI</option><option value="dpi">DPI</option><option value="win_pct">Win %</option><option value="games">Games</option><option value="salary">Salary</option></select></label>
      <label>Rows<select name="limit"><option>10</option><option selected>25</option><option>50</option></select></label>
      <label class="check-option"><input name="hide_low_sample" type="checkbox" checked /> Hide low-sample players</label>
      <button class="primary-button" type="submit">Apply Filters</button>
    </form>
    <div class="table-card"><div class="table-empty" id="prospect-results">
      <strong>Prospect data is not connected yet.</strong>
      <span>The Activity filter surface is ready; the next scouting pass will wire these controls to the HCPB backend calculations.</span>
    </div></div>`;

  panel.querySelector<HTMLFormElement>("#prospect-filters")?.addEventListener("submit", event => {
    event.preventDefault();
    const formElement = event.currentTarget as HTMLFormElement;
    const form = new FormData(formElement);
    const active = [...form.entries()]
      .filter(([, value]) => String(value).trim() !== "")
      .map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`);
    const output = panel.querySelector<HTMLDivElement>("#prospect-results");
    if (output) {
      output.innerHTML = `<strong>Filters ready.</strong><span>${escapeHtml(active.join(" · ") || "No filters")}</span><span>The scouting dataset adapter will populate this table in the next implementation pass.</span>`;
    }
  });
}

async function start(): Promise<void> {
  try {
    await setupDiscord();
    shell();
    await loadAvailability(weekStart);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    app.innerHTML = `<div class="startup-card error-card"><h1>Hagrid</h1><p>Could not start the Activity.</p><code>${escapeHtml(message)}</code></div>`;
  }
}

void start();
