"""Nearby-source suggestions: pure logic on catalogue rows, no network."""
import math

from fastapi.testclient import TestClient

from backend.app.irsa import IRSAUnavailable
from backend.app.main import app
from backend.app.spectrum import nearby

RA, DEC = 69.97458, 26.05278


def row(east_arcsec, north_arcsec, w1_mjy, w2_mjy=None, name='J0000', w1_err=0.05, w2_err=0.05):
    mag = lambda flux, band: None if flux is None else -2.5 * math.log10(flux / (nearby.BANDS[band][1] * 1000))
    return {'designation': name, 'ra': RA + east_arcsec / 3600 / math.cos(math.radians(DEC)), 'dec': DEC + north_arcsec / 3600,
            'w1mpro': mag(w1_mjy, 'W1'), 'w1sigmpro': w1_err if w1_mjy is not None else None,
            'w2mpro': mag(w2_mjy, 'W2'), 'w2sigmpro': w2_err if w2_mjy is not None else None, 'ext_flg': 0}


def assess(*rows):
    return nearby.assess(nearby.sources_from_rows(RA, DEC, list(rows)))


def test_magnitudes_convert_back_to_flux_and_separation_is_on_the_sky():
    [source] = nearby.sources_from_rows(RA, DEC, [row(30, 40, 12.0, 8.0)])
    assert math.isclose(source['w1_mjy'], 12.0, rel_tol=1e-9) and math.isclose(source['w2_mjy'], 8.0, rel_tol=1e-9)
    assert math.isclose(source['separation_arcsec'], 50.0, rel_tol=1e-3)


def test_a_magnitude_without_uncertainty_is_an_upper_limit_and_ignored():
    [source] = nearby.sources_from_rows(RA, DEC, [row(10, 0, 5.0, 4.0, w2_err=None)])
    assert source['w2_mjy'] is None and nearby.brightness(source) == source['w1_mjy']
    assert nearby.sources_from_rows(RA, DEC, [row(10, 0, 5.0, None, w1_err=None)]) == []


def test_empty_spot_suggests_the_nearest_measurable_neighbour():
    result = assess(row(20, 0, 15.0, name='near'), row(0, 70, 30.0, name='far'), row(0, -10, 0.1, name='faint'))
    assert result['reason'] == 'nothing_here' and result['here'] is None
    assert result['suggestion']['name'] == 'WISE near'  # 15 mJy at 20 arcsec beats 30 mJy at 70 arcsec


def test_a_source_at_the_position_is_kept_unless_a_neighbour_is_much_brighter():
    kept = assess(row(1, 1, 10.0, name='here'), row(15, 0, 20.0, name='neighbour'))
    assert kept['reason'] == 'source_here' and kept['suggestion'] is None
    moved = assess(row(1, 1, 1.0, name='here'), row(15, 0, 20.0, name='neighbour'))
    assert moved['reason'] == 'brighter_neighbour' and moved['suggestion']['name'] == 'WISE neighbour'


def test_saturating_sources_are_never_suggested_but_bright_ring_sources_are_named():
    result = assess(row(50, 0, 400.0, name='blinding'), row(0, 45, 3.0, name='ring'))
    assert result['suggestion']['name'] == 'WISE ring'
    assert [source['name'] for source in result['ring']] == ['WISE blinding', 'WISE ring']
    assert [source['name'] for source in result['too_bright_nearby']] == ['WISE blinding']
    assert assess()['reason'] == 'nothing_nearby'


def test_nearby_endpoint_reports_catalogue_outages_as_503(monkeypatch):
    nearby.nearby.cache_clear()
    def offline(*args, **kwargs):
        raise IRSAUnavailable('offline')
    monkeypatch.setattr(nearby, 'fetch_rows', offline)
    response = TestClient(app).get('/api/spectrum/nearby', params={'ra': RA, 'dec': DEC})
    assert response.status_code == 503 and response.json()['code'] == 'catalogue_unavailable'
    monkeypatch.setattr(nearby, 'fetch_rows', lambda ra, dec: [row(20, 0, 15.0, name='near')])
    nearby.nearby.cache_clear()
    body = TestClient(app).get('/api/spectrum/nearby', params={'ra': RA, 'dec': DEC}).json()
    assert body['suggestion']['name'] == 'WISE near' and body['ring_arcsec'][0] > 30
    assert TestClient(app).get('/api/spectrum/nearby', params={'ra': 400, 'dec': 0}).status_code == 422
    nearby.nearby.cache_clear()
