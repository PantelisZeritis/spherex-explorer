import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundDominated, compareSummary, isComet, pahDip, spectrumShape, spectrumSummary } from '../src/plainSummary.js';

const curve = fn => Array.from({length: 40}, (_, i) => {const wavelength_um = 0.75 + i * 0.11; return {status: 'ok', wavelength_um, flux_mjy: fn(wavelength_um), flux_err_mjy: 0.1};});
const catalogue = [
  {id: 'h2o_ice', label: 'Water ice', group: 'Ices'}, {id: 'co2', label: 'Carbon dioxide', group: 'Ices'},
  {id: 'pah', label: 'PAH 3.3 µm', group: 'Dust and gas'}, {id: 'br_alpha', label: 'Hydrogen Brackett α', group: 'Dust and gas'},
];
const steady = {status: 'steady', amplitude: 0.01, floor: 0.08};

test('the shape compares the near-visible end with the long end, and needs points at both', () => {
  assert.equal(spectrumShape(curve(w => 10 / w ** 2)), 'falling');
  assert.equal(spectrumShape(curve(w => w ** 2)), 'rising');
  assert.equal(spectrumShape(curve(() => 5)), 'flat');
  assert.equal(spectrumShape(curve(() => 5).slice(0, 10)), null);
});

test('a faint position says so instead of interpreting noise', () => {
  const summary = spectrumSummary({analysis: {median_snr: 1.2, features: [], seasons: []}, points: curve(() => 0)});
  assert.equal(summary.kind, 'faint');
  assert.match(summary.headline, /Nothing clearly/);
});

test('detected ices lead the headline; absent bands are not mentioned', () => {
  const analysis = {median_snr: 40, binned: [], seasons: [{}, {}], variability: steady,
    features: [{id: 'h2o_ice', status: 'detected', kind: 'absorption'}, {id: 'co2', status: 'detected', kind: 'absorption'}, {id: 'pah', status: 'not_detected'}]};
  const summary = spectrumSummary({analysis, points: curve(w => w), features: catalogue});
  assert.equal(summary.kind, 'ice');
  assert.ok(summary.sentences.some(sentence => /frozen water and carbon dioxide/.test(sentence)));
  assert.ok(!summary.sentences.some(sentence => /PAH/.test(sentence)));
  assert.ok(summary.sentences.some(sentence => /same on every visit/.test(sentence)));
});

test('CO2 in emission reads as comet gas, and a comet without gas bands is still a comet', () => {
  const analysis = {median_snr: 20, binned: [], seasons: [{}], features: [{id: 'co2', status: 'detected', kind: 'emission'}], variability: {status: 'not_measurable'}};
  assert.equal(spectrumSummary({analysis, points: curve(() => 1), features: catalogue}).kind, 'comet');
  assert.equal(spectrumSummary({analysis: {...analysis, features: []}, points: curve(() => 1), features: catalogue, comet: true}).kind, 'comet');
});

test('a featureless source that varies is described as variable; smooth starlight as starlight', () => {
  const base = {median_snr: 50, binned: [], seasons: [{}, {}], features: []};
  const variable = spectrumSummary({analysis: {...base, variability: {status: 'variable', amplitude: 1.4}}, points: curve(w => 10 / w), features: catalogue});
  assert.equal(variable.kind, 'variable');
  assert.ok(variable.sentences.some(sentence => /2\.4 times/.test(sentence)));
  assert.equal(spectrumSummary({analysis: {...base, variability: steady}, points: curve(w => 10 / w ** 2), features: catalogue}).kind, 'starlight');
});

test('mixed-season spectra are summarised from the per-season bands', () => {
  const analysis = {median_snr: 30, binned: [], mixed_seasons: true, features: [], seasons: [{}, {}], variability: {status: 'variable', amplitude: 3},
    features_by_season: [{index: 0, features: [{id: 'pah', status: 'detected', kind: 'emission'}]}]};
  assert.equal(spectrumSummary({analysis, points: curve(() => 1), features: catalogue}).kind, 'starforming');
});

const comparison = (overrides = {}) => ({context: 'real_observation_comparison', stretch: {shared: true}, previews: {difference: 'x'},
  validation: {mode: 'time', difference_allowed: true, time_separation_hours: 24 * 180, reasons: []},
  detection: {status: 'screened', candidates: []}, ...overrides});

test('comparison summaries follow the server verdict', () => {
  const none = compareSummary(comparison());
  assert.equal(none.tone, 'none');
  assert.match(none.sentences[0], /180 days apart/);
  const found = compareSummary(comparison({detection: {status: 'screened', candidates: [{id: 'c1'}, {id: 'c2'}]}}));
  assert.equal(found.tone, 'found');
  assert.match(found.headline, /^2 spots/);
  const blocked = compareSummary(comparison({previews: {}, detection: null,
    validation: {mode: 'time', difference_allowed: false, time_separation_hours: 0.2, reasons: [{code: 'band_mismatch', severity: 'reject'}, {code: 'wavelength_match', severity: 'info'}]}}));
  assert.equal(blocked.tone, 'blocked');
  assert.ok(blocked.sentences.some(sentence => /different SPHEREx cameras/.test(sentence)));
  const colour = compareSummary(comparison({validation: {mode: 'wavelength', difference_allowed: false, reasons: []}, previews: {}, stretch: {shared: false}}));
  assert.match(colour.headline, /colour comparison/);
  assert.ok(colour.sentences.some(sentence => /own brightness setting/.test(sentence)));
});

test('a tracked star is not a comet, and saturated exposures are explained', () => {
  assert.equal(isComet({kind: 'demo', tracked: true, comet: false}), false);
  assert.equal(isComet({kind: 'demo', tracked: true, comet: true}), true);
  assert.equal(isComet({kind: 'moving'}), true);
  const summary = spectrumSummary({analysis: {counts: {saturated: 21}, seasons: []}, points: [{status: 'saturated'}]});
  assert.equal(summary.headline, 'No usable measurements');
  assert.match(summary.sentences[0], /saturated/);
});

test('a spectrum pushed below zero by a brighter surrounding glow is explained, with its 3.3 µm PAH dip', () => {
  // Shaped like a real case: about -1 to -4 mJy everywhere, plunging to about -18 mJy at 3.2–3.5 µm, three seasons.
  const points = curve(w => w > 3.2 && w < 3.5 ? -18 : -1 - w / 2).map(point => ({...point, flux_err_mjy: 0.3}));
  assert.ok(backgroundDominated(points));
  assert.ok(pahDip(points));
  const summary = spectrumSummary({analysis: {median_snr: -12, binned: [], features: [], seasons: [{}, {}, {}], variability: {status: 'not_measurable'}}, points, features: catalogue});
  assert.equal(summary.kind, 'background');
  assert.ok(summary.sentences.some(sentence => /3\.3 µm/.test(sentence)));
  assert.ok(summary.sentences.some(sentence => /fixed feature of the sky/.test(sentence)));
  // Pure noise around zero is still called faint, not background.
  const noise = curve(w => Math.sin(w * 37) * 0.2).map(point => ({...point, flux_err_mjy: 0.3}));
  assert.equal(backgroundDominated(noise), false);
  assert.equal(spectrumSummary({analysis: {median_snr: 0.1, features: [], seasons: []}, points: noise}).kind, 'faint');
});
