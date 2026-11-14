import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// TEST DATA: synthetic rows and mocked API replies. No IRSA access.
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/image.json', import.meta.url)));
const png = fs.readFileSync(new URL('../fixtures/synthetic.png', import.meta.url));
const row = (obs_id, band, observed_at_utc) => ({obs_id, energy_bandpassname: band, obs_collection: 'test-only', observed_at_utc,
  s_ra: 10.68, s_dec: 41.27, t_exptime: 113, em_min: null, em_max: null, access_format: 'application/x-votable+xml;content=datalink',
  access_url: `https://irsa.ipac.caltech.edu/datalink/links/spherex?ID=synthetic-${obs_id}-${band}`});
const rows = [row('SYNTHETIC-JUL', 'SPHEREx-D1', '2026-07-10T00:01:31.000'), row('SYNTHETIC-JAN', 'SPHEREx-D1', '2026-01-01T06:00:12.000')];
const frame = (r, role) => ({role, obs_id: r.obs_id, band: r.energy_bandpassname, detector: 1, observed_at_utc: r.observed_at_utc,
  wavelength_um: .8935, bandwidth_um: .01, diagnostics: {}, provenance: {source: 'irsa_cutout'}});
const compareResult = ({a, b, mode}) => ({compare_id: 'd'.repeat(64), decision: 'WARN', cache_hit: false, overlap_fraction: .98,
  validation: {mode, decision: 'WARN', difference_allowed: false, wavelength_delta_um: 0, time_separation_hours: 4554, overlap_fraction: .98,
    reasons: [{code: 'synthetic', severity: 'warn', detail: 'Synthetic test reply.', values: {}}]},
  frames: [frame(rows.find(r => r.access_url === a.access_url), 'a'), frame(rows.find(r => r.access_url === b.access_url), 'b')],
  grid: {shape: [176, 176], north_up: true}, stretch: {shared: false}, difference: null,
  previews: {a: `/api/compare/${'d'.repeat(64)}/a.png`, b: `/api/compare/${'d'.repeat(64)}/b.png`, difference: null}, notes: ['Synthetic test reply.']});

async function mockApi(page) {
  const calls = {observations: [], compare: [], spectrum: []};
  await page.route('**/api/observations?**', route => {
    calls.observations.push(Object.fromEntries(new URL(route.request().url()).searchParams));
    return route.fulfill({json: {status: 'live', ra: 10.6847, dec: 41.2687, count: rows.length, truncated: false, observations: rows}});
  });
  await page.route('**/api/images', route => route.fulfill({json: fixture}));
  await page.route('**/api/images/*/preview', route => route.fulfill({contentType: 'image/png', body: png}));
  await page.route('**/api/images/progress', route => route.fulfill({json: {jobs: []}}));
  await page.route('**/api/compare', route => {calls.compare.push(route.request().postDataJSON()); return route.fulfill({json: compareResult(route.request().postDataJSON())});});
  await page.route('**/api/compare/*/*.png', route => route.fulfill({contentType: 'image/png', body: png}));
  await page.route('**/api/spectrum/features', route => route.fulfill({json: {features: [], thresholds: {}, method: {}, moving_targets: []}}));
  // The spectrum job itself is not under test here: record the request and fail it plainly.
  await page.route('**/api/spectrum', route => {calls.spectrum.push(route.request().postDataJSON());
    return route.fulfill({status: 503, json: {status: 'unavailable', code: 'test', message: 'Synthetic test: spectrum not measured.'}});});
  return calls;
}

const SHARED = '/?ra=10.684708&dec=41.26875&fov=0.5&band=SPHEREx-D1&search=1&a=SYNTHETIC-JAN.D1&b=SYNTHETIC-JUL.D1&compare=time&view=SYNTHETIC-JUL.D1&spectrum=here';

test('a shared link reopens the position, zoom, filter, search, picks, comparison, image and spectrum', async ({page}) => {
  const calls = await mockApi(page);
  await page.goto(SHARED);
  await expect(page.getByTestId('selected-ra')).toHaveText('10.684708°');
  await expect(page.getByTestId('selected-dec')).toHaveText('41.268750°');
  await expect(page.locator('#wavelength-mode')).toHaveValue('SPHEREx-D1');
  await expect(page.getByTestId('compare-slot-a')).toContainText('SYNTHETIC-JAN');
  await expect(page.getByTestId('compare-slot-b')).toContainText('SYNTHETIC-JUL');
  await expect(page.getByTestId('compare-result')).toBeVisible();
  await expect(page.getByText('Selected observation SYNTHETIC-JUL')).toBeVisible();
  expect(calls.observations).toEqual([{ra: '10.684708', dec: '41.26875', band: 'SPHEREx-D1'}]);
  expect(calls.compare).toHaveLength(1);
  expect(calls.compare[0].mode).toBe('time');
  expect(calls.spectrum).toEqual([{ra: 10.684708, dec: 41.26875}]);
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-testid="sky-map"]').skyAtlas?.getFov()[0]), {timeout: 60000}).toBeCloseTo(0.5, 2);
  // The restored view keeps describing itself in the address bar.
  const params = new URL(page.url()).searchParams;
  for (const [key, value] of new URL(SHARED, 'http://x').searchParams) expect(params.get(key), key).toBe(value);
});

test('exploring updates the address bar, and the copy button copies it', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockApi(page);
  await page.goto('/');
  await page.locator('#ra').fill('10.684708');
  await page.locator('#dec').fill('41.26875');
  await page.getByRole('button', {name: 'Go To Coordinates'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('ra')).toBe('10.684708');
  await page.getByRole('button', {name: 'Search SPHEREx Observations'}).click();
  await page.getByRole('button', {name: 'Set SYNTHETIC-JAN SPHEREx-D1 as A for comparison'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('a')).toBe('SYNTHETIC-JAN.D1');
  expect(new URL(page.url()).searchParams.get('search')).toBe('1');
  await page.getByTestId('copy-link').click();
  await expect(page.getByTestId('copy-link')).toHaveText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  // A new position starts a new view: the old picks leave the link.
  await page.locator('#ra').fill('83.822');
  await page.getByRole('button', {name: 'Go To Coordinates'}).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('a')).toBeNull();
});

test('an observation the archive no longer returns is reported, not invented', async ({page}) => {
  await mockApi(page);
  await page.goto('/?ra=10.684708&dec=41.26875&a=SYNTHETIC-GONE.D1&b=SYNTHETIC-JUL.D1&compare=time');
  await expect(page.getByTestId('share-note')).toContainText('SYNTHETIC-GONE.D1');
  await expect(page.getByTestId('compare-slot-a')).toContainText('Not chosen');
  await expect(page.getByTestId('compare-slot-b')).toContainText('SYNTHETIC-JUL');
  await expect(page.getByTestId('compare-result')).toHaveCount(0);
});

test('a link with invalid values opens the default view', async ({page}) => {
  await mockApi(page);
  await page.goto('/?ra=999&dec=abc&band=SPHEREx-D9&spectrum=<b>');
  await expect(page.getByTestId('selected-ra')).toHaveText('210.802270°');
  await expect(page.locator('#wavelength-mode')).toHaveValue('');
});
