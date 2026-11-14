"""Name resolver (GET /api/resolve). Network is mocked; the XML replies are TEST DATA copied in
shape from real CDS Sesame answers."""
from unittest.mock import patch

import pytest
import requests
from fastapi.testclient import TestClient

from backend.app import resolve
from backend.app.main import app

client = TestClient(app)

M31 = b'''<?xml version="1.0" encoding="UTF-8"?>
<Sesame><Target option="SNV"><name>M31</name>
  <Resolver name="S=Simbad, IDIA (via url)"><oid>1575544</oid><oname>M 31</oname><otype>AGN</otype>
    <jpos>00:42:44.32 +41:16:07.5</jpos><jradeg>10.6847083</jradeg><jdedeg>41.26875</jdedeg></Resolver>
</Target></Sesame>'''
NED_ONLY = b'''<?xml version="1.0"?><Sesame><Target option="SNV"><name>x</name>
  <Resolver name="S=Simbad"><INFO>*** Nothing found ***</INFO></Resolver>
  <Resolver name="N=NED"><oname>Some Galaxy</oname><jradeg>150.5</jradeg><jdedeg>-2.25</jdedeg></Resolver>
</Target></Sesame>'''
NOTHING = b'''<?xml version="1.0" encoding="UTF-8"?>
<Sesame><Target option="SNV"><name>notarealobject123</name><INFO> *** NNNothing found *** </INFO></Target></Sesame>'''


@pytest.fixture(autouse=True)
def empty_cache():
    resolve._cache.clear()
    yield
    resolve._cache.clear()


def test_parse_reads_the_first_resolver_with_a_position():
    assert resolve.parse(M31) == {'name': 'M 31', 'type': 'AGN', 'ra': 10.6847083, 'dec': 41.26875, 'service': 'Simbad'}
    assert resolve.parse(NED_ONLY) == {'name': 'Some Galaxy', 'type': None, 'ra': 150.5, 'dec': -2.25, 'service': 'NED'}
    assert resolve.parse(NOTHING) is None


@pytest.mark.parametrize('payload', [b'<html>busy</html>', b'not xml', b'<Sesame/>'])
def test_parse_rejects_answers_that_are_not_sesame(payload):
    with pytest.raises(resolve.ResolverUnavailable):
        resolve.parse(payload)


def test_out_of_range_positions_are_ignored():
    bad = M31.replace(b'<jradeg>10.6847083', b'<jradeg>400')
    assert resolve.parse(bad) is None


def test_second_mirror_is_tried_and_answers_are_cached():
    calls = []
    def fetch(url):
        calls.append(url)
        if url.startswith(resolve.MIRRORS[0]):
            raise requests.ConnectionError('down')
        return M31
    assert resolve.resolve('  m31 ', fetch)['ra'] == pytest.approx(10.6847083)
    assert calls == [f'{resolve.MIRRORS[0]}-ox/SNV?m31', f'{resolve.MIRRORS[1]}-ox/SNV?m31']
    assert resolve.resolve('M31', fetch)['name'] == 'M 31'  # Same name, other spelling: from the cache.
    assert len(calls) == 2


def test_names_are_url_encoded():
    seen = []
    resolve.resolve('NGC 1614 & more', lambda url: seen.append(url) or NOTHING)
    assert seen[0].endswith('?NGC%201614%20%26%20more')


def test_all_mirrors_down_is_unavailable_and_not_cached():
    def fetch(url):
        raise requests.Timeout('slow')
    with pytest.raises(resolve.ResolverUnavailable):
        resolve.resolve('M31', fetch)
    assert resolve._cache == {}


class Reply:
    def __init__(self, status, body=b'', location=None):
        self.status_code, self.body, self.headers = status, body, {'Location': location} if location else {}
        self.is_redirect = location is not None

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))

    def iter_content(self, size):
        yield self.body

    def close(self):
        pass


def test_the_cds_redirect_is_followed_only_to_https_sesame():
    mirror = 'https://vizier.idia.ac.za/viz-bin/nph-sesame/-ox/SNV?M31'
    with patch('backend.app.resolve.requests.get', side_effect=[Reply(302, location=mirror), Reply(200, M31)]) as get:
        assert resolve._get('https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?M31') == M31
    assert get.call_args_list[1].args[0] == mirror
    assert all(call.kwargs['allow_redirects'] is False for call in get.call_args_list)
    for location in ('http://vizier.idia.ac.za/viz-bin/nph-sesame/-ox/SNV?M31', 'https://example.org/elsewhere'):
        with patch('backend.app.resolve.requests.get', return_value=Reply(302, location=location)):
            with pytest.raises(resolve.ResolverUnavailable):
                resolve._get('https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?M31')


def test_oversized_answers_are_refused():
    with patch('backend.app.resolve.requests.get', return_value=Reply(200, b'x' * (resolve.MAX_BYTES + 1))):
        with pytest.raises(resolve.ResolverUnavailable):
            resolve._get('https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV?M31')


def test_endpoint_found_not_found_solar_system_unavailable_and_invalid():
    with patch('backend.app.resolve._get', return_value=M31):
        found = client.get('/api/resolve', params={'name': 'M31'})
    assert found.status_code == 200
    assert found.json() == {'status': 'found', 'query': 'M31', 'name': 'M 31', 'type': 'AGN', 'type_label': 'Active galactic nucleus',
                            'ra': 10.6847083, 'dec': 41.26875, 'service': 'Simbad', 'source': 'Simbad via CDS Sesame'}
    with patch('backend.app.resolve._get', return_value=NOTHING):
        missing = client.get('/api/resolve', params={'name': 'notarealobject123'})
        planet = client.get('/api/resolve', params={'name': ' Mars '})
    assert missing.status_code == 404 and missing.json()['status'] == 'not_found'
    assert 'Check the spelling' in missing.json()['message']
    assert planet.status_code == 404 and 'Solar System' in planet.json()['message']
    with patch('backend.app.resolve._get', side_effect=requests.ConnectionError('down')):
        down = client.get('/api/resolve', params={'name': 'Vega'})
    assert down.status_code == 503 and down.json()['status'] == 'unavailable'
    for bad in ['', '   ', 'a' * 101, 'M31\nX']:
        assert client.get('/api/resolve', params={'name': bad}).status_code == 422
