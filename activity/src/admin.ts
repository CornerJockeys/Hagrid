export type AdminApi = <T>(path: string, init?: RequestInit) => Promise<T>;
export type AdminStatus = (
  message: string,
  kind?: "normal" | "success" | "error",
) => void;

interface RoleAutomationResponse {
  mappings: {
    new_member: string;
    FL: string;
    AL: string;
    CL: string;
    ML: string;
    captain: string;
  };
  updated_at: string | null;
  updated_by_discord_id: string | null;
}

interface RoleField {
  key: keyof RoleAutomationResponse["mappings"];
  label: string;
  description: string;
}

const FIELDS: RoleField[] = [
  {
    key: "new_member",
    label: "New Member",
    description: "Assigned after a new human member joins and completes Membership Screening.",
  },
  {
    key: "FL",
    label: "FL Player",
    description: "Applied while the player occupies a competitive Foundation League roster slot.",
  },
  {
    key: "AL",
    label: "AL Player",
    description: "Applied while the player occupies a competitive Academy League roster slot.",
  },
  {
    key: "CL",
    label: "CL Player",
    description: "Applied while the player occupies a competitive Champion League roster slot.",
  },
  {
    key: "ML",
    label: "ML Player",
    description: "Applied while the player occupies a competitive Master League roster slot.",
  },
  {
    key: "captain",
    label: "RL Captain",
    description: "Applied in addition to the player's division roles when Sprocket identifies them as Captain.",
  },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char] ?? char);
}

function displayTimestamp(value: string | null): string {
  if (!value) return "Using defaults";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(parsed);
}

export function mountAdminPanel(
  panel: HTMLElement,
  api: AdminApi,
  setStatus: AdminStatus,
): void {
  panel.innerHTML = `
    <div class="panel-heading">
      <div>
        <div class="eyebrow">GM/FM · Discord Automation</div>
        <h2>Admin</h2>
        <p>Configure the Discord roles Hagrid assigns for each automated circumstance. Separate multiple role IDs with commas.</p>
      </div>
    </div>
    <div class="admin-role-card">
      <div class="admin-role-intro">
        <strong>Role Automation</strong>
        <span>One ID assigns one role. Commas assign multiple roles. Leaving a field blank disables automatic assignment for that circumstance.</span>
      </div>
      <form id="role-automation-form" class="admin-role-form">
        <div id="role-automation-fields" class="admin-role-fields"></div>
        <div class="admin-role-footer">
          <div id="role-automation-meta" class="admin-role-meta">Loading settings…</div>
          <button class="primary-button" type="submit">Save Role Settings</button>
        </div>
      </form>
    </div>
    <div class="notice-card">
      <strong>Protected staff roles</strong>
      <p>AGM, GM, and FM cannot be configured here. Hagrid will continue leaving those roles entirely under human control.</p>
    </div>`;

  const form = panel.querySelector<HTMLFormElement>("#role-automation-form");
  const fieldsRoot = panel.querySelector<HTMLElement>("#role-automation-fields");
  const meta = panel.querySelector<HTMLElement>("#role-automation-meta");
  if (!form || !fieldsRoot || !meta) return;

  fieldsRoot.innerHTML = FIELDS.map(field => `
    <label class="admin-role-field">
      <span class="admin-role-label">${escapeHtml(field.label)}</span>
      <input
        type="text"
        data-role-mapping="${field.key}"
        autocomplete="off"
        spellcheck="false"
        placeholder="123456789012345678, 987654321098765432"
      />
      <small>${escapeHtml(field.description)}</small>
    </label>
  `).join("");

  const inputs = (): Record<string, HTMLInputElement> =>
    Object.fromEntries(
      [...panel.querySelectorAll<HTMLInputElement>("[data-role-mapping]")]
        .map(input => [input.dataset.roleMapping ?? "", input]),
    );

  const apply = (data: RoleAutomationResponse): void => {
    const byKey = inputs();
    for (const field of FIELDS) {
      const input = byKey[field.key];
      if (input) input.value = data.mappings[field.key] ?? "";
    }

    const updater = data.updated_by_discord_id
      ? ` · last saved by Discord user ${data.updated_by_discord_id}`
      : "";
    meta.textContent = `Last saved: ${displayTimestamp(data.updated_at)}${updater}`;
  };

  const load = async (): Promise<void> => {
    try {
      setStatus("Loading role automation settings…");
      const data = await api<RoleAutomationResponse>("/api/activity/admin/roles");
      apply(data);
      setStatus("Role automation settings loaded.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      meta.textContent = "Could not load role automation settings.";
      setStatus(message, "error");
    }
  };

  form.addEventListener("submit", event => {
    event.preventDefault();
    void (async () => {
      const byKey = inputs();
      const mappings = Object.fromEntries(
        FIELDS.map(field => [field.key, byKey[field.key]?.value ?? ""]),
      );

      try {
        setStatus("Saving role automation settings…");
        const data = await api<RoleAutomationResponse>("/api/activity/admin/roles", {
          method: "PUT",
          body: JSON.stringify({mappings}),
        });
        apply(data);
        setStatus(
          "Role automation settings saved. Roster mappings will reconcile on the next hourly role pass.",
          "success",
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), "error");
      }
    })();
  });

  void load();
}
