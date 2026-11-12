// Plain-language summaries for readers who are not astronomers. Pure functions: every sentence
// is derived from numbers the analysis already reports, and each says "usually" or "typical of"
// where it interprets. These are a reading guide, never a classification.

import { usablePoints } from './spectrum.js';

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const capital = text => text.charAt(0).toUpperCase() + text.slice(1);
const list = items => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const SHORT = [0.75, 1.6], LONG = [3.6, 5.0];

/* How the brightness changes from the short (near-visible) to the long (heat) end of the range.
   Returns 'falling', 'rising', 'flat' or null when either end has too few measurements. */
export function spectrumShape(points) {
  const inside = ([low, high]) => points.filter(point => point.wavelength_um >= low && point.wavelength_um <= high).map(point => point.flux_mjy);
  const short = inside(SHORT), long = inside(LONG);
  if (short.length < 3 || long.length < 3) return null;
  const left = median(short), right = median(long);
  if (!(left > 0) && !(right > 0)) return null;
  if (!(left > 0)) return 'rising';
  if (!(right > 0)) return 'falling';
  const ratio = right / left;
  return ratio >= 2 ? 'rising' : ratio <= 0.5 ? 'falling' : 'flat';
}

const SHAPE_TEXT = {
  falling: 'It is brightest at the short-wavelength end (left) and fades towards the right. That is the usual look of starlight: a single star, or a whole galaxy of stars.',
  rising: 'It gets brighter towards the long-wavelength end (right). That usually means warm dust glowing in the infrared, or a cool object hidden inside a dusty cloud.',
  flat: 'Its brightness is fairly even across the whole range, so no single kind of light dominates.',
};

const GROUP_TEXT = {
  Ices: names => `Light is being absorbed by frozen ${list(names)}. Ice only survives in very cold, dark places, so this light has passed through a cold cloud of gas and dust, the kind where new stars and planets form.`,
  'Comet gas': names => `${capital(list(names))} is glowing: gas boiling off a comet as the Sun warms it.`,
  PAH: () => 'Large carbon molecules (PAHs) are glowing. They light up near young, hot stars, so this usually marks a region that is forming stars.',
  'Hot gas': names => `Glowing ${list(names)}: gas heated by hot young stars or by matter falling onto something.`,
};

function groupOf(feature, result) {
  if (feature.id === 'pah') return 'PAH';
  if (feature.id === 'co2' && result.kind === 'emission') return 'Comet gas';
  if (feature.group === 'Dust and gas') return 'Hot gas';
  return feature.group;
}

const SHORT_NAMES = {h2o_ice: 'water', co2: 'carbon dioxide', co: 'carbon monoxide', co_gas: 'carbon monoxide', h2o_gas: 'water vapour',
  br_alpha: 'hydrogen', pa_alpha: 'hydrogen', pa_beta: 'hydrogen', he_i: 'helium', s_iii: 'sulphur'};

/* True for a comet (as opposed to a fast-moving star whose position is also tracked). */
export const isComet = request => request?.kind === 'moving' || request?.comet === true;

/* The plain-language reading of one spectrum. `features` is the catalogue from /api/spectrum/features. */
export function spectrumSummary({analysis, points, features = [], comet = false}) {
  if (!analysis) return null;
  const good = usablePoints(points);
  if (!good.length) {
    return {headline: 'No usable measurements', kind: 'faint',
      sentences: [(analysis.counts?.saturated || 0) > 0 ? 'Every exposure was saturated: this object is so bright that it overwhelms SPHEREx\'s detectors, like a photo of a lamp that comes out pure white.'
        : 'None of the exposures gave a clean measurement at this position, so there is nothing to read yet.']};
  }
  const snr = analysis.median_snr;
  const sentences = [];
  if (snr != null && snr < 3) {
    return {headline: 'Nothing clearly visible here',
      sentences: ['SPHEREx does not clearly see a source at this position: the dots scatter around zero, which is what pure noise looks like.',
        'This does not mean the spot is empty, only that anything there is too faint for these measurements.'],
      kind: 'faint'};
  }
  sentences.push(snr == null ? `${good.length} measurements were usable.`
    : snr >= 10 ? `The source is clearly detected, well above the noise (${good.length} usable measurements).`
      : `The source is faint (${good.length} usable measurements), so individual dots are noisy. Trust the overall trend more than single dots.`);
  if (good.length < 8) sentences.push('With this few measurements the spectrum is only a rough sketch; most chemical fingerprints cannot be tested.');

  const shape = spectrumShape(analysis.binned?.length ? analysis.binned : good);
  if (comet) sentences.push('For a comet, most of this light is sunlight reflected by dust around it; at the longest wavelengths the warmed dust also glows.');
  else if (shape) sentences.push(SHAPE_TEXT[shape]);

  const byId = new Map(features.map(feature => [feature.id, feature]));
  const results = analysis.mixed_seasons
    ? (analysis.features_by_season || []).flatMap(entry => entry.features)
    : analysis.features || [];
  const groups = new Map();
  for (const result of results) {
    const feature = byId.get(result.id);
    if (result.status !== 'detected' || !feature) continue;
    const group = groupOf(feature, result);
    const names = groups.get(group) || new Set();
    names.add(SHORT_NAMES[feature.id] || feature.label);
    groups.set(group, names);
  }
  if (groups.size) {
    for (const [group, names] of groups) sentences.push((GROUP_TEXT[group] || (items => `Detected: ${list(items)}.`))([...names]));
  } else if (good.length >= 8) {
    sentences.push('No chemical fingerprints stand out: the spectrum is smooth. That is normal for ordinary stars, many galaxies and quasars at SPHEREx\'s level of detail.');
  }

  const change = analysis.variability;
  const variable = change?.status === 'variable';
  if (variable) {
    const amount = change.amplitude >= 1 ? `about ${(1 + change.amplitude).toFixed(1)} times` : `about ${Math.round(change.amplitude * 100)}%`;
    sentences.push(`Its brightness changed by ${amount} between visits${comet ? ', as expected for a comet whose distance from the Sun and Earth changes' : ': something about it is active or changing'}.`);
  } else if (change && change.status !== 'not_measurable') {
    sentences.push('It looked the same on every visit: the coloured dot groups lie on top of each other.');
  } else if ((analysis.seasons || []).length < 2) {
    sentences.push(comet ? 'These measurements come from one stretch of observing, so they show the comet at one moment.' : 'SPHEREx has only visited this spot once so far, so we cannot yet tell whether it changes.');
  }

  let headline, kind;
  if (groups.has('Comet gas')) {headline = 'A comet releasing gas as the Sun warms it'; kind = 'comet';}
  else if (comet) {headline = 'A comet, seen mostly by reflected sunlight'; kind = 'comet';}
  else if (groups.has('Ices')) {headline = 'Light passing through a cold, icy cloud'; kind = 'ice';}
  else if (groups.has('PAH')) {headline = 'Signs of stars being formed'; kind = 'starforming';}
  else if (groups.has('Hot gas')) {headline = 'Hot, glowing gas'; kind = 'gas';}
  else if (variable) {headline = 'A smooth spectrum that changes brightness'; kind = 'variable';
    sentences.push('Featureless light that brightens and fades is typical of active galaxy centres (quasars and blazars) and of some variable stars.');}
  else if (good.length < 8) {headline = 'Too few measurements for a full picture'; kind = 'smooth';}
  else if (shape === 'falling') {headline = 'Looks like ordinary starlight'; kind = 'starlight';}
  else if (shape === 'rising') {headline = 'A dusty or hidden source glowing in the infrared'; kind = 'dusty';}
  else {headline = 'A smooth spectrum without clear fingerprints'; kind = 'smooth';}
  return {headline, sentences, kind};
}

/* Static guide to the spectrum chart. */
export const SPECTRUM_READING_GUIDE = [
  ['Each dot', 'is one SPHEREx photo measuring this target, through one colour of infrared light.'],
  ['Left to right', 'is the colour (wavelength, in micrometres µm). Left is just beyond red light; right is closer to heat.'],
  ['Higher', 'means brighter. The little vertical bars show how uncertain each dot is.'],
  ['Dot colours', 'are visits about six months apart. If the colours overlap, nothing changed between visits.'],
  ['White line', 'is the average of nearby dots, to make the overall shape easier to see.'],
  ['Shaded labelled bands', 'are chemical fingerprints the app found. A dip means something in front is absorbing that colour (like ice); a bump means gas is glowing at that colour.'],
  ['σ (sigma)', 'says how sure a detection is. 5σ or more means it is very unlikely to be a fluke of noise.'],
  ['Log / Linear', 'changes the height scale. Log helps when a few dots are much brighter than the rest.'],
];

const REASON_TEXT = {
  duplicate_observation: 'A and B are the same photo, so nothing can have changed between them.',
  band_mismatch: 'The two photos were taken with different SPHEREx cameras, which see different infrared colours. That is like comparing a photo through red glass with one through blue glass.',
  time_unknown: 'The date of one photo is missing, so we cannot say what happened in between.',
  too_close_in_time: 'The photos were taken less than an hour apart, too soon for most things in space to change.',
  wavelength_mismatch: 'Your target landed on slightly different infrared colours in the two photos, so any brightness difference could just be the colour, not a real change. You can still blink them.',
  wavelength_unknown: 'The exact colour each photo saw at your target is unknown, so brightness cannot be compared directly.',
  no_overlap: 'The two photos do not cover the same piece of sky.',
  low_overlap: 'The two photos share too little of the same sky to subtract one from the other.',
  not_simultaneous: 'A colour comparison needs two photos taken at the same time; these were not.',
  same_wavelength: 'Both photos show the same infrared colour; use the Time mode to compare dates instead.',
  incompatible_units: 'The two images are not in the same brightness units, so they cannot be subtracted.',
};

const days = hours => hours == null ? null : hours < 48 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`;

/* The plain-language reading of one comparison result from /api/compare. */
export function compareSummary(result) {
  if (!result) return null;
  const validation = result.validation || {};
  const mode = validation.mode;
  const gap = days(validation.time_separation_hours);
  const sentences = [];
  sentences.push(mode === 'wavelength'
    ? 'You are comparing two infrared colours of the same patch of sky, photographed at the same time. Things that look brighter in the longer-wavelength image are usually cooler or dustier.'
    : `You are comparing the same patch of sky, through the same infrared colour, photographed ${gap ? `${gap} apart` : 'on two dates'}.`);

  const candidates = result.context === 'real_observation_comparison' && result.detection?.status === 'screened' && validation.difference_allowed
    ? result.detection.candidates || [] : [];
  const blocking = (validation.reasons || []).filter(reason => reason.severity !== 'info').map(reason => REASON_TEXT[reason.code]).filter(Boolean);
  let headline, tone;
  if (result.moving_target) {
    headline = 'Tracking a moving comet'; tone = 'info';
    sentences.push('The comet moves against the background stars between the two photos. Dashed circles show where official predictions place it; that is a prediction, not a measurement.');
  } else if (mode === 'wavelength') {
    headline = 'A colour comparison, not a change over time'; tone = 'info';
    sentences.push('Differences between these two images come from colour, not from anything changing. Use Blink to see which objects stand out in one colour more than the other.');
  } else if (candidates.length) {
    headline = `${candidates.length} spot${candidates.length > 1 ? 's' : ''} worth a closer look`; tone = 'found';
    sentences.push(`The software found ${candidates.length === 1 ? 'one spot' : `${candidates.length} spots`} that look${candidates.length === 1 ? 's' : ''} different between the two dates, circled on the difference image. Each could be something real (a star that flared or faded, an asteroid passing by) or a leftover from image processing. They are leads to check, not discoveries.`);
  } else if (validation.difference_allowed && result.detection?.status === 'screened') {
    headline = 'No real change detected'; tone = 'none';
    sentences.push('Nothing changed enough to stand out from the normal noise of the images. Small differences you may see by eye are expected from processing.');
  } else if (result.previews?.difference) {
    headline = 'You can look, but the software cannot confirm changes'; tone = 'info';
    sentences.push('The difference image is shown for looking only: these photos do not meet all the checks needed to say a difference is real.');
  } else {
    headline = 'These two photos cannot be fairly compared'; tone = 'blocked';
  }
  if (tone !== 'found' && tone !== 'none') sentences.push(...blocking.slice(0, 2));
  if (!result.stretch?.shared) sentences.push('Each image has its own brightness setting, so do not compare how bright things look between A and B.');
  return {headline, sentences, tone};
}

export const COMPARE_READING_GUIDE = [
  ['Side by side', 'shows both photos next to each other, oldest first in Time mode.'],
  ['Blink', 'flips between the two photos once a second. Anything that jumps, appears or vanishes is a difference your eye can catch.'],
  ['Difference', 'subtracts A from B (B − A). Mid-grey means no change; lighter means brighter in B; darker means fainter in B.'],
  ['Bright stars', 'often leave light/dark rings in the difference image. That comes from small sharpness differences, not real change.'],
  ['Violet', 'marks pixels with no valid data in one of the photos.'],
  ['Cyan circles', 'are spots the software flagged as possibly changed (or, for a comet, its predicted position).'],
];
