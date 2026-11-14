/**
 * Shareable Live Mode links: what the visitor is looking at, kept in the page URL.
 *
 *   ra, dec   selected ICRS position (degrees)
 *   fov       sky-map width (degrees)
 *   band | um wavelength / detector filter
 *   search=1  the observation search was run
 *   a, b      observations picked for comparison, as <obs_id>.D<detector>
 *   view      observation open in the image inspector, same form
 *   compare   comparison run for A and B: time | wavelength
 *   spectrum  spectrum measured: "here" (at ra/dec) or a guided target id
 *
 * Reading never trusts the URL: each value is validated and an invalid one is dropped on its own.
 * A link replays the archive query; the archive may answer differently later.
 */
import { validCoordinates } from './coordinates.js';
import { BANDS, parseWavelength } from './wavelengths.js';

const COMPARE_MODES = ['time', 'wavelength'];
const OBSERVATION = /^([A-Za-z0-9_\-]{1,80})\.D([1-6])$/;
const MAX_FOV = 180;

/** A table row as it appears in a link, or null if the row cannot be named. */
export function observationRef(row) {
  const detector = /^SPHEREx-D([1-6])$/.exec(row?.energy_bandpassname || '')?.[1];
  const ref = row?.obs_id && detector ? `${row.obs_id}.D${detector}` : null;
  return ref && OBSERVATION.test(ref) ? ref : null;
}

/** The row in search results that a link names, or null. */
export function findObservation(rows, ref) {
  const match = OBSERVATION.exec(ref || '');
  if (!match || !Array.isArray(rows)) return null;
  return rows.find(row => row.obs_id === match[1] && row.energy_bandpassname === `SPHEREx-D${match[2]}`) || null;
}

/** Parse a query string into a validated view. Missing or invalid values are null. */
export function readShare(search, spectrumIds = []) {
  const params = new URLSearchParams(search);
  const get = key => params.get(key)?.trim() || null;
  const ra = get('ra'), dec = get('dec');
  const position = ra != null && dec != null && validCoordinates(ra, dec) ? {ra: Number(ra), dec: Number(dec)} : null;
  const fovText = get('fov');
  const fov = fovText != null && /^\d+(\.\d+)?$/.test(fovText) && Number(fovText) > 0 && Number(fovText) <= MAX_FOV ? Number(fovText) : null;
  let filter = null;
  const band = get('band'), um = get('um');
  if (band && BANDS.some(item => item.band === band)) filter = {band, wavelength: '', custom: false};
  else if (um && !parseWavelength(um).error) filter = {band: '', wavelength: String(parseWavelength(um).value), custom: true};
  const ref = key => OBSERVATION.test(get(key) || '') ? get(key) : null;
  const a = ref('a'), b = ref('b'), view = ref('view');
  const compareMode = get('compare');
  const spectrum = get('spectrum');
  return {
    position, fov, filter,
    // Picks and an open image only exist in search results, so they imply a search.
    search: get('search') === '1' || Boolean(a || b || view),
    a, b: b === a ? null : b, view,
    compare: a && b && a !== b && COMPARE_MODES.includes(compareMode) ? compareMode : null,
    spectrum: spectrum === 'here' && position ? 'here' : spectrumIds.includes(spectrum) ? spectrum : null,
  };
}

const round = (value, digits) => String(Number(value.toFixed(digits)));

/** The query string ("" or "?…") for the current Live Mode view. */
export function writeShare({position, fov, filter, searched, a, b, view, compare, spectrum}) {
  const params = new URLSearchParams();
  if (position) {params.set('ra', round(position.ra, 6)); params.set('dec', round(position.dec, 6));}
  if (Number.isFinite(fov) && fov > 0) params.set('fov', String(Number(fov.toPrecision(4))));
  if (filter?.band) params.set('band', filter.band);
  else if (filter?.custom && filter.wavelength !== '' && !parseWavelength(filter.wavelength).error) params.set('um', String(parseWavelength(filter.wavelength).value));
  if (searched) params.set('search', '1');
  const refA = observationRef(a), refB = observationRef(b), refView = observationRef(view);
  if (refA) params.set('a', refA);
  if (refB) params.set('b', refB);
  if (refA && refB && COMPARE_MODES.includes(compare)) params.set('compare', compare);
  if (refView) params.set('view', refView);
  if (spectrum) params.set('spectrum', spectrum);
  const text = params.toString();
  return text ? `?${text}` : '';
}
