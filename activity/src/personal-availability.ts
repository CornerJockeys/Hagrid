export type PersonalAvailabilityApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type PersonalAvailabilityStatus = (
  message: string,
  kind?: "normal" | "success" | "error",
) => void;

type SlotState = 1 | 2;
type EditMode = "drag" | "checkbox";
type Resolution = 30 | 60;

interface AvailabilitySlot {
  day: number;
  minute: number;
  state: SlotState;
}

interface AvailabilityPlayer {
  sprocket_player_id: string;
  name: string;
  division: string | null;
  slot: string | null;
  discord_linked?: boolean;
  editable?: boolean;
}

interface AvailabilityResponse {
  week_start: string;
  previous_week_start: string;
  player: AvailabilityPlayer;
  selectable_players: AvailabilityPlayer[];
  slots: AvailabilitySlot[];
}

export interface AvailabilityWindow {
  start_minute: number;
  end_minute: number;
  base_resolution_minutes: number;
}

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

function slotKey(day: number, minute: number): string {
  return `${day}:${minute}`;
}

export function mountPersonalAvailabilityPanel(
  panel: HTMLElement,
  api: PersonalAvailabilityApi,
  setStatus: PersonalAvailabilityStatus,
  initialWeek: string,
  windowConfig: AvailabilityWindow,
): {load: () => Promise<void>} {
  let weekStart = initialWeek;
  let selectedPlayerId = "";
  let currentPlayer: AvailabilityPlayer | null = null;
  let selectablePlayers: AvailabilityPlayer[] = [];
  let resolution: Resolution = 60;
  let editMode: EditMode = "drag";
  let slots = new Map<string, SlotState>();
  let dirty = false;
  let dragging = false;
  let dragValue = true;
  let lastPaintedKey = "";

  const displayCellSelected = (day: number, minute: number): boolean => {
    for (let offset = 0; offset < resolution; offset += 30) {
      if (!slots.has(slotKey(day, minute + offset))) return false;
    }
    return true;
  };

  const displayCellPartial = (day: number, minute: number): boolean => {
    let count = 0;
    for (let offset = 0; offset < resolution; offset += 30) {
      if (slots.has(slotKey(day, minute + offset))) count += 1;
    }
    return count > 0 && count < resolution / 30;
  };

  const updateSaveState = (): void => {
    const editable = currentPlayer?.editable !== false;
    const button = panel.querySelector<HTMLButtonElement>("#save-availability");
    if (button) button.disabled = !editable || !dirty;
    const marker = panel.querySelector<HTMLSpanElement>("#dirty-marker");
    if (marker) marker.textContent = editable ? (dirty ? "Unsaved changes" : "Saved") : "Read only";
    panel.querySelectorAll<HTMLButtonElement>("#copy-previous, #clear-availability").forEach(control => {
      control.disabled = !editable;
    });
  };

  const applyDisplayCell = (day: number, minute: number, selected: boolean): void => {
    if (currentPlayer?.editable === false) return;
    for (let offset = 0; offset < resolution; offset += 30) {
      const key = slotKey(day, minute + offset);
      if (selected) slots.set(key, 1);
      else slots.delete(key);
    }
    dirty = true;
    updateSaveState();
  };

  const syncCellVisual = (cell: HTMLElement, day: number, minute: number): void => {
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
  };

  const paintCell = (cell: HTMLElement): void => {
    const day = Number(cell.dataset.day);
    const minute = Number(cell.dataset.minute);
    const key = slotKey(day, minute);
    if (key === lastPaintedKey) return;
    lastPaintedKey = key;
    applyDisplayCell(day, minute, dragValue);
    syncCellVisual(cell, day, minute);
  };

  const renderGrid = (): void => {
    const grid = panel.querySelector<HTMLDivElement>("#availability-grid");
    if (!grid) return;
    const parts: string[] = ["<div class=\"grid-corner\">Time</div>"];
    for (const day of dayNames) parts.push(`<div class="day-heading">${day}</div>`);

    for (let minute = windowConfig.start_minute; minute < windowConfig.end_minute; minute += resolution) {
      parts.push(`<div class="time-heading">${formatTime(minute)}</div>`);
      for (let day = 0; day < 7; day += 1) {
        const selected = displayCellSelected(day, minute);
        const partial = displayCellPartial(day, minute);
        const editable = currentPlayer?.editable !== false;
        if (editMode === "checkbox") {
          parts.push(`<label class="availability-cell checkbox-cell ${selected ? "selected" : ""} ${partial ? "partial" : ""} ${editable ? "" : "read-only"}" data-day="${day}" data-minute="${minute}" role="checkbox" aria-checked="${selected}"><input type="checkbox" ${selected ? "checked" : ""} ${editable ? "" : "disabled"} /></label>`);
        } else {
          parts.push(`<button class="availability-cell drag-cell ${selected ? "selected" : ""} ${partial ? "partial" : ""} ${editable ? "" : "read-only"}" data-day="${day}" data-minute="${minute}" role="checkbox" aria-checked="${selected}" aria-label="${dayNames[day]} ${formatTime(minute)}" ${editable ? "" : "disabled"}></button>`);
        }
      }
    }
    grid.innerHTML = parts.join("");

    grid.querySelectorAll<HTMLElement>(".availability-cell").forEach(cell => {
      if (currentPlayer?.editable === false) return;
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
  };

  const load = async (): Promise<void> => {
    setStatus("Loading availability…");
    const playerQuery = selectedPlayerId ? `&player_id=${encodeURIComponent(selectedPlayerId)}` : "";
    const data = await api<AvailabilityResponse>(
      `/api/activity/availability?week=${encodeURIComponent(weekStart)}${playerQuery}`,
    );
    weekStart = data.week_start;
    currentPlayer = data.player;
    selectedPlayerId = data.player.sprocket_player_id;
    selectablePlayers = data.selectable_players;
    slots = new Map(data.slots.map(slot => [slotKey(slot.day, slot.minute), slot.state]));
    dirty = false;

    const label = panel.querySelector("#week-label");
    if (label) label.textContent = formatWeek(weekStart);

    const heading = panel.querySelector<HTMLElement>("#availability-heading");
    if (heading) heading.textContent = data.player.editable === false ? `${data.player.name} Availability` : "My Availability";
    const description = panel.querySelector<HTMLElement>("#availability-description");
    if (description) {
      description.textContent = data.player.editable === false
        ? "Read-only view of this player's saved availability for the selected week."
        : "Noon to midnight, seven days a week. Drag across the grid or switch to checkbox editing.";
    }

    const control = panel.querySelector<HTMLElement>("#availability-player-control");
    if (control) {
      control.innerHTML = selectablePlayers.length > 0
        ? `<span>Player</span><select id="availability-player-select">${selectablePlayers
            .slice()
            .sort((a, b) => (a.division ?? "").localeCompare(b.division ?? "") || a.name.localeCompare(b.name))
            .map(player => {
              const suffix = [player.division, player.slot?.replace(/^PLAYER/i, "")].filter(Boolean).join(" · ");
              return `<option value="${player.sprocket_player_id}" ${player.sprocket_player_id === selectedPlayerId ? "selected" : ""}>${player.name}${suffix ? ` — ${suffix}` : ""}</option>`;
            }).join("")}</select>`
        : "";
      control.querySelector<HTMLSelectElement>("#availability-player-select")?.addEventListener("change", event => {
        if (dirty && !window.confirm("Discard your unsaved availability changes?")) {
          (event.target as HTMLSelectElement).value = selectedPlayerId;
          return;
        }
        selectedPlayerId = (event.target as HTMLSelectElement).value;
        void load().catch(error => setStatus(error instanceof Error ? error.message : String(error), "error"));
      });
    }

    renderGrid();
    updateSaveState();
    setStatus(
      data.player.editable === false ? `${data.player.name}'s availability loaded.` : "Availability loaded.",
      "success",
    );
  };

  const changeWeek = async (amount: number): Promise<void> => {
    if (dirty && !window.confirm("Discard your unsaved availability changes?")) return;
    weekStart = shiftWeek(weekStart, amount);
    try {
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const copyPreviousWeek = async (): Promise<void> => {
    try {
      const previous = shiftWeek(weekStart, -1);
      if (currentPlayer?.editable === false) return;
      const data = await api<AvailabilityResponse>(`/api/activity/availability?week=${encodeURIComponent(previous)}`);
      slots = new Map(data.slots.map(slot => [slotKey(slot.day, slot.minute), slot.state]));
      dirty = true;
      renderGrid();
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
  };

  const save = async (): Promise<void> => {
    if (currentPlayer?.editable === false) return;
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
  };

  panel.innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">Eastern Time (ET)</div><h2 id="availability-heading">My Availability</h2><p id="availability-description">Noon to midnight, seven days a week. Drag across the grid or switch to checkbox editing.</p></div>
      <div class="week-picker"><button id="previous-week" class="icon-button" aria-label="Previous week">←</button><div><strong id="week-label">${formatWeek(weekStart)}</strong><span id="dirty-marker">Saved</span></div><button id="next-week" class="icon-button" aria-label="Next week">→</button></div></div>
    <div class="toolbar">
      <label id="availability-player-control" class="availability-player-control"></label>
      <label>Time blocks<select id="resolution-select"><option value="60">1 hour</option><option value="30">30 minutes</option></select></label>
      <label>Edit style<select id="edit-mode-select"><option value="drag">Drag to select</option><option value="checkbox">Checkboxes</option></select></label>
      <button id="copy-previous" class="secondary-button">Copy Previous Week</button><button id="clear-availability" class="secondary-button">Clear</button><button id="save-availability" class="primary-button" disabled>Save Availability</button>
    </div>
    <div class="grid-help"><span class="legend-swatch"></span><span>Available</span><span class="muted">Selections are stored in 30-minute slots even when the grid is shown hourly.</span></div>
    <div class="availability-scroll"><div id="availability-grid" class="availability-grid"></div></div>`;

  panel.querySelector<HTMLSelectElement>("#resolution-select")?.addEventListener("change", event => {
    resolution = Number((event.target as HTMLSelectElement).value) as Resolution;
    renderGrid();
  });
  panel.querySelector<HTMLSelectElement>("#edit-mode-select")?.addEventListener("change", event => {
    editMode = (event.target as HTMLSelectElement).value as EditMode;
    renderGrid();
  });
  panel.querySelector("#previous-week")?.addEventListener("click", () => void changeWeek(-1));
  panel.querySelector("#next-week")?.addEventListener("click", () => void changeWeek(1));
  panel.querySelector("#copy-previous")?.addEventListener("click", () => void copyPreviousWeek());
  panel.querySelector("#clear-availability")?.addEventListener("click", () => {
    if (currentPlayer?.editable === false) return;
    slots.clear();
    dirty = true;
    renderGrid();
    updateSaveState();
  });
  panel.querySelector("#save-availability")?.addEventListener("click", () => void save());

  window.addEventListener("pointerup", () => {
    dragging = false;
    lastPaintedKey = "";
  });
  window.addEventListener("pointercancel", () => {
    dragging = false;
    lastPaintedKey = "";
  });

  renderGrid();
  updateSaveState();
  return {load};
}
