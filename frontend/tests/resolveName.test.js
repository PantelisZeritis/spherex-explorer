import test from 'node:test';
import assert from 'node:assert/strict';
import { describeResolved, resolveName } from '../src/resolveName.js';

const reply = (status, body) => async () => ({ok: status < 400, status, json: async () => {if (body === undefined) throw new Error('not json'); return body;}});

test('a found name is described by its catalogue name, type and source', () => {
  assert.equal(describeResolved({query: 'M31', name: 'M 31', type: 'AGN', type_label: 'Active galactic nucleus', source: 'Simbad via CDS Sesame'}),
    'M 31 · Active galactic nucleus · Simbad via CDS Sesame');
  assert.equal(describeResolved({query: 'x', name: null, type: 'Xyz', type_label: null, source: 'NED via CDS Sesame'}), 'x · SIMBAD type Xyz · NED via CDS Sesame');
});

test('lookups return found answers and turn every other reply into a readable error', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = reply(200, {status: 'found', ra: 10.68, dec: 41.27});
    assert.equal((await resolveName('M31')).ra, 10.68);
    globalThis.fetch = reply(404, {status: 'not_found', message: 'No object called “zzz” was found.'});
    await assert.rejects(resolveName('zzz'), /No object called/);
    globalThis.fetch = reply(503, {status: 'unavailable', message: 'The CDS name resolver could not be reached.'});
    await assert.rejects(resolveName('M31'), /could not be reached/);
    globalThis.fetch = reply(502);
    await assert.rejects(resolveName('M31'), /backend is not responding/);
  } finally {globalThis.fetch = original;}
});
