import test from 'node:test';
import assert from 'node:assert/strict';
import { findObservation, observationRef, readShare, writeShare } from '../src/shareLink.js';

const row = (obs_id, detector) => ({obs_id, energy_bandpassname: `SPHEREx-D${detector}`, access_url: `https://irsa.ipac.caltech.edu/x?ID=${obs_id}/D${detector}`});
const GUIDED = ['3i-atlas', 'l1527'];

test('a full view round-trips through the URL', () => {
  const a = row('2026W21_2A_0213_2', 5), b = row('2025W28_1B_0480_4', 5);
  const query = writeShare({position: {ra: 10.6847083333, dec: 41.26875}, fov: [0.123456][0], filter: {band: 'SPHEREx-D5', wavelength: ''},
    searched: true, a, b, view: a, compare: 'time', spectrum: 'here'});
  assert.equal(query, '?ra=10.684708&dec=41.26875&fov=0.1235&band=SPHEREx-D5&search=1&a=2026W21_2A_0213_2.D5&b=2025W28_1B_0480_4.D5&compare=time&view=2026W21_2A_0213_2.D5&spectrum=here');
  assert.deepEqual(readShare(query, GUIDED), {
    position: {ra: 10.684708, dec: 41.26875}, fov: 0.1235, filter: {band: 'SPHEREx-D5', wavelength: '', custom: false}, search: true,
    a: '2026W21_2A_0213_2.D5', b: '2025W28_1B_0480_4.D5', view: '2026W21_2A_0213_2.D5', compare: 'time', spectrum: 'here'});
});

test('an empty URL restores nothing', () => {
  assert.deepEqual(readShare('', GUIDED), {position: null, fov: null, filter: null, search: false, a: null, b: null, view: null, compare: null, spectrum: null});
  assert.equal(writeShare({}), '');
});

test('invalid values are dropped one by one, never trusted', () => {
  const view = readShare('?ra=400&dec=10&fov=-1&band=SPHEREx-D9&um=0x10&a=<script>&b=x.D7&view=ok.D2&compare=blink&spectrum=elsewhere', GUIDED);
  assert.equal(view.position, null);
  assert.equal(view.fov, null);
  assert.equal(view.filter, null);
  assert.equal(view.a, null);
  assert.equal(view.b, null);
  assert.equal(view.view, 'ok.D2');
  assert.equal(view.compare, null);
  assert.equal(view.spectrum, null);
  assert.equal(view.search, true, 'an observation to open implies a search');
});

test('a wavelength filter is kept as a number; a half-typed one is left out', () => {
  assert.deepEqual(readShare('?um=2,5', GUIDED).filter, {band: '', wavelength: '2.5', custom: true});
  assert.equal(writeShare({filter: {band: '', wavelength: '2,5', custom: true}}), '?um=2.5');
  assert.equal(writeShare({filter: {band: '', wavelength: '2.', custom: true}}), '?um=2');
  assert.equal(writeShare({filter: {band: '', wavelength: '9', custom: true}}), '');
});

test('a comparison needs two different picks; a spectrum "here" needs a position', () => {
  assert.equal(readShare('?a=x.D1&compare=time', GUIDED).compare, null);
  assert.equal(readShare('?a=x.D1&b=x.D1&compare=time', GUIDED).b, null);
  assert.equal(readShare('?spectrum=here', GUIDED).spectrum, null);
  assert.equal(readShare('?spectrum=3i-atlas', GUIDED).spectrum, '3i-atlas');
  assert.equal(writeShare({a: row('x', 1), compare: 'time'}), '?a=x.D1');
});

test('picks are found in search results by observation and detector', () => {
  const rows = [row('2026W21_2A_0213_3', 2), row('2026W21_2A_0213_3', 5)];
  assert.equal(findObservation(rows, '2026W21_2A_0213_3.D5'), rows[1]);
  assert.equal(findObservation(rows, '2026W21_2A_0213_3.D1'), null);
  assert.equal(findObservation(rows, 'bad'), null);
  assert.equal(observationRef({obs_id: 'x', energy_bandpassname: 'unknown'}), null);
});
