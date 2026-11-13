import test from 'node:test';
import assert from 'node:assert/strict';
import { direction, nearbyAdvice } from '../src/plainSummary.js';

const RA = 69.97458, DEC = 26.05278, COS = Math.cos(DEC * Math.PI / 180);
const source = (name, east, north, w1, w2 = null) => ({name, ra: RA + east / 3600 / COS, dec: DEC + north / 3600,
  separation_arcsec: Math.hypot(east, north), w1_mjy: w1, w2_mjy: w2});
const data = fields => ({ra: RA, dec: DEC, radius_arcsec: 75, ring: [], too_bright_nearby: [], here: null, suggestion: null, ...fields});

test('directions follow a north-up map, including across RA 0', () => {
  assert.equal(direction(RA, DEC, RA, DEC + 0.01), 'north');
  assert.equal(direction(RA, DEC, RA + 0.01, DEC), 'east');
  assert.equal(direction(RA, DEC, RA - 0.01, DEC - 0.01), 'south-west');
  assert.equal(direction(359.999, 0, 0.001, 0), 'east');
});

test('an empty spot names the suggested neighbour, its distance, direction and brightness', () => {
  const near = source('WISE J1', 20, 0, 15);
  const advice = nearbyAdvice(data({reason: 'nothing_here', suggestion: near}));
  assert.equal(advice.suggestion, near);
  assert.match(advice.sentences[0], /20″ to the east, at about 15 mJy/);
  assert.equal(advice.sentences.length, 1);
  const inside = nearbyAdvice(data({reason: 'nothing_here', suggestion: source('WISE J3', -9, 0, 20), aperture_arcsec: 15.4}));
  assert.match(inside.sentences[1], /already falls in the measuring circle/);
});

test('a brighter neighbour is compared with what is here', () => {
  const advice = nearbyAdvice(data({reason: 'brighter_neighbour', here: source('WISE here', 1, 1, 1.2), suggestion: source('WISE J2', 0, 30, 0.5, 12)}));
  assert.match(advice.sentences[0], /about 10 times brighter/);
});

test('a negative spectrum names a bright source where the sky glow is sampled, or blames diffuse glow', () => {
  const ring = source('WISE bright', -50, 0, 250);
  const withRing = nearbyAdvice(data({reason: 'nothing_nearby', ring: [ring], too_bright_nearby: [ring]}), 'background');
  assert.match(withRing.sentences[1], /WISE bright \(about 250 mJy\) lies 50″ to the west/);
  assert.match(withRing.sentences[2], /too bright for SPHEREx/);
  assert.equal(withRing.suggestion, null);
  const diffuse = nearbyAdvice(data({reason: 'nothing_nearby'}), 'background');
  assert.match(diffuse.sentences[1], /spread-out glowing gas and dust/);
});

test('on target, a faint result says the source may be too faint', () => {
  const advice = nearbyAdvice(data({reason: 'source_here', here: source('WISE here', 1, 0, 0.6)}), 'faint');
  assert.match(advice.sentences[0], /you are on target\. It may simply be too faint/);
  assert.equal(nearbyAdvice(null), null);
});
