// -------------------------------------------------------------
// Display helpers shared by the Dashboard, My Interviews, Reports and
// Profile pages.
// -------------------------------------------------------------

// Where a history row's "View" link points: Arena sessions have their own
// results page; Standard interviews open the saved report.
export function resultLink(interview) {
  const id = encodeURIComponent(interview.id ?? interview.interview_id);
  return interview.interview_mode === 'game' ? `/arena/results?id=${id}` : `/report?id=${id}`;
}

export function isCompleted(interview) {
  return interview.status === 'completed' || interview.status === 'evaluated';
}

export function modeLabel(mode) {
  return mode === 'game' ? 'Arena' : 'Standard';
}

export function formatDate(value, options = { dateStyle: 'medium' }) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatDuration(seconds) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0) return '—';
  const minutes = Math.floor(duration / 60);
  const remainder = duration % 60;
  return `${minutes}m ${remainder}s`;
}

// Longer totals (e.g. all practice time) read better as hours and minutes.
export function formatTotalTime(seconds) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0) return '0m';
  const hours = Math.floor(duration / 3600);
  const minutes = Math.round((duration % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}
