/** Object name to sky position through the backend's GET /api/resolve (CDS Sesame). */
export const NAME_MAX_LENGTH = 100;
// Map width after jumping to a named object: close enough to see it, wide enough for a large galaxy's core.
export const NAME_FOV_DEG = 1;

export async function resolveName(name, {signal} = {}) {
  const response = await fetch(`/api/resolve?${new URLSearchParams({name})}`, {signal});
  let data = {};
  try {data = await response.json();} catch {data = {};}
  if (response.ok && data.status === 'found') return data;
  if (data.status === 'not_found' || data.status === 'invalid' || data.status === 'unavailable') throw new Error(data.message);
  throw new Error(response.status >= 500
    ? 'The app\'s backend is not responding. Start it with ./scripts/start.sh (or ./scripts/backend.sh).'
    : 'The name could not be looked up.');
}

/** One line saying what a name resolved to, e.g. "M 31 · Active galactic nucleus · Simbad via CDS Sesame". */
export function describeResolved(result) {
  const type = result.type_label || (result.type ? `SIMBAD type ${result.type}` : null);
  return [result.name || result.query, type, result.source].filter(Boolean).join(' · ');
}
