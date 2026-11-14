import { test, expect } from '@playwright/test';

// TEST DATA: mocked /api/resolve replies shaped like real CDS Sesame results. No network.
const M31 = {status: 'found', query: 'Andromeda', name: 'M 31', type: 'AGN', type_label: 'Active galactic nucleus',
  ra: 10.6847083, dec: 41.26875, service: 'Simbad', source: 'Simbad via CDS Sesame'};

test('a name moves the selection and the map to the object and says what was found', async ({page}) => {
  const asked = [];
  await page.route('**/api/resolve?**', route => {asked.push(new URL(route.request().url()).searchParams.get('name')); return route.fulfill({json: M31});});
  await page.goto('/');
  await page.getByLabel('Find an object by name').fill('  Andromeda ');
  await page.getByLabel('Find an object by name').press('Enter');
  await expect(page.getByTestId('selected-ra')).toHaveText('10.684708°');
  await expect(page.getByTestId('selected-dec')).toHaveText('41.268750°');
  await expect(page.getByTestId('name-found')).toHaveText('Found M 31 · Active galactic nucleus · Simbad via CDS Sesame');
  expect(asked).toEqual(['Andromeda']);
  await expect.poll(() => new URL(page.url()).searchParams.get('ra')).toBe('10.684708');
  await expect.poll(() => page.evaluate(() => document.querySelector('[data-testid="sky-map"]').skyAtlas?.getFov()[0]), {timeout: 60000}).toBeLessThanOrEqual(1.0001);
  // Choosing another position retires the "Found" line, which only describes the found object.
  await page.locator('#ra').fill('83.822');
  await page.getByRole('button', {name: 'Go To Coordinates'}).click();
  await expect(page.getByTestId('name-found')).toHaveCount(0);
});

test('an unknown name or an unreachable resolver is explained and the selection stays put', async ({page}) => {
  let reply = {status: 404, json: {status: 'not_found', query: 'Mars', message: 'Mars is in our Solar System, so it moves across the sky and has no fixed position to look up.'}};
  await page.route('**/api/resolve?**', route => route.fulfill(reply));
  await page.goto('/');
  const before = await page.getByTestId('selected-ra').textContent();
  await page.getByLabel('Find an object by name').fill('Mars');
  await page.getByRole('button', {name: 'Find', exact: true}).click();
  await expect(page.locator('.name-search').getByRole('alert')).toContainText('Solar System');
  reply = {status: 503, json: {status: 'unavailable', message: 'The CDS name resolver could not be reached. Please retry, or enter RA and Dec.'}};
  await page.getByRole('button', {name: 'Find', exact: true}).click();
  await expect(page.locator('.name-search').getByRole('alert')).toContainText('could not be reached');
  await expect(page.getByTestId('selected-ra')).toHaveText(before);
  await page.getByLabel('Find an object by name').fill('   ');
  await page.getByRole('button', {name: 'Find', exact: true}).click();
  await expect(page.locator('.name-search').getByRole('alert')).toContainText('Enter an object name');
});

test('the real CDS Sesame resolver finds M31 through the backend', {tag: '@live'}, async ({request}) => {
  const response = await request.get('/api/resolve?name=M31');
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data).toMatchObject({status: 'found', name: 'M 31'});
  expect(data.ra).toBeCloseTo(10.6847, 3);
  expect(data.dec).toBeCloseTo(41.2687, 3);
});
