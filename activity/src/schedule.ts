export type ScheduleStatus = (message: string, kind?: "normal" | "success" | "error") => void;

export function mountSchedulePanel(panel: HTMLElement, setStatus: ScheduleStatus): void {
  panel.innerHTML = `
    <div class="panel-heading"><div><div class="eyebrow">Season schedule</div><h2>Schedule</h2>
      <p>The league-wide S20 schedule will live here once MLE publishes the schedule/fixtures source Hagrid can ingest.</p></div></div>
    <div class="notice-card warning">
      <strong>Schedule not available yet</strong>
      <p>Hagrid is ready for this view, but the Season 20 schedule/fixtures dataset has not been wired yet. This page will use one league-wide schedule with no division selector.</p>
    </div>`;
  setStatus("Schedule will populate once the S20 schedule/fixtures source is available.");
}
