"""Object names to sky positions, through CDS Sesame (SIMBAD, then NED, then VizieR).

GET /api/resolve?name=M31 returns the catalogue name, object type and ICRS position of the first
service that knows the name. Nothing is guessed: an unknown name is reported as not found, and an
unreachable resolver as unavailable. The same mirrors as astropy's resolver are used.
"""
from collections import OrderedDict
import re
import threading
from urllib.parse import quote, urlsplit
import xml.etree.ElementTree as ET

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
import requests

MIRRORS = ('https://cds.unistra.fr/cgi-bin/nph-sesame/', 'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/')
OPTIONS = '-ox/SNV'      # XML output; SIMBAD, then NED, then VizieR; stop at the first answer.
MAX_BYTES = 64 * 1024    # A Sesame answer for one name is about 1 KB.
MAX_REDIRECTS = 3        # CDS redirects to a regional mirror.
CACHE_SIZE = 256
NAME = re.compile(r'^[^\x00-\x1f\x7f]{1,100}$')
# Bodies of the Solar System move across the sky, so no catalogue gives them a fixed position.
SOLAR_SYSTEM = {'sun', 'moon', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'}

# Plain words for common SIMBAD object types; other codes are shown as they are.
TYPES = {
    '*': 'Star', '**': 'Double or multiple star', 'PM*': 'High proper-motion star', 'V*': 'Variable star',
    'Em*': 'Emission-line star', 'Be*': 'Be star', 'C*': 'Carbon star', 'RG*': 'Red giant', 'AB*': 'AGB star',
    'Mi*': 'Mira variable', 'LP*': 'Long-period variable', 's*r': 'Red supergiant', 's*b': 'Blue supergiant',
    's*y': 'Yellow supergiant', 'WR*': 'Wolf-Rayet star', 'WD*': 'White dwarf', 'BD*': 'Brown dwarf',
    'Y*O': 'Young stellar object', 'YSO': 'Young stellar object', 'TT*': 'T Tauri star', 'Or*': 'Orion variable',
    'pr*': 'Pre-main-sequence star', 'EB*': 'Eclipsing binary', 'SB*': 'Spectroscopic binary', 'Psr': 'Pulsar',
    'XB*': 'X-ray binary', 'Ce*': 'Cepheid variable', 'RR*': 'RR Lyrae variable', 'Cl*': 'Star cluster',
    'OpC': 'Open star cluster', 'GlC': 'Globular star cluster', 'As*': 'Stellar association',
    'G': 'Galaxy', 'GiG': 'Galaxy in a group', 'GiC': 'Galaxy in a cluster', 'IG': 'Interacting galaxies',
    'PaG': 'Pair of galaxies', 'SBG': 'Starburst galaxy', 'H2G': 'HII galaxy', 'LSB': 'Low surface brightness galaxy',
    'AGN': 'Active galactic nucleus', 'SyG': 'Seyfert galaxy', 'Sy1': 'Seyfert 1 galaxy', 'Sy2': 'Seyfert 2 galaxy',
    'LIN': 'LINER galaxy', 'QSO': 'Quasar', 'Bla': 'Blazar', 'BLL': 'BL Lac blazar', 'rG': 'Radio galaxy',
    'ClG': 'Cluster of galaxies', 'GrG': 'Group of galaxies', 'PN': 'Planetary nebula', 'HII': 'HII region (glowing hydrogen)',
    'SNR': 'Supernova remnant', 'MoC': 'Molecular cloud', 'DNe': 'Dark cloud', 'RNe': 'Reflection nebula',
    'GNe': 'Nebula', 'Cld': 'Cloud', 'ISM': 'Interstellar matter', 'SFR': 'Star-forming region',
}
_cache, _cache_lock = OrderedDict(), threading.Lock()
router = APIRouter(prefix='/api/resolve', tags=['Name resolver'])


class ResolverUnavailable(Exception):
    pass


def _get(url):
    """One Sesame answer, following CDS's redirect to a regional mirror (HTTPS Sesame paths only)."""
    for _ in range(MAX_REDIRECTS + 1):
        response = requests.get(url, timeout=(5, 20), allow_redirects=False, stream=True)
        try:
            if response.is_redirect:
                location = response.headers.get('Location', '')
                parts = urlsplit(location)
                if parts.scheme != 'https' or '/nph-sesame/' not in parts.path:
                    raise ResolverUnavailable('The name resolver redirected to an unexpected address.')
                url = location
                continue
            response.raise_for_status()
            body = b''
            for chunk in response.iter_content(8192):
                body += chunk
                if len(body) > MAX_BYTES:
                    raise ResolverUnavailable('The name resolver sent an unexpectedly large answer.')
            return body
        finally:
            response.close()
    raise ResolverUnavailable('The name resolver redirected too many times.')


def parse(payload):
    """The first resolver's answer: {name, type, ra, dec, service}, or None when nothing was found."""
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as exc:
        raise ResolverUnavailable('The name resolver sent an unreadable answer.') from exc
    if root.tag != 'Sesame' or root.find('Target') is None:
        raise ResolverUnavailable('The name resolver sent an unexpected answer.')
    for resolver in root.iter('Resolver'):
        try:
            ra, dec = float(resolver.findtext('jradeg')), float(resolver.findtext('jdedeg'))
        except (TypeError, ValueError):
            continue
        if not (0 <= ra < 360 and -90 <= dec <= 90):
            continue
        service = (resolver.get('name') or '').split('=', 1)[-1].split(',')[0].strip() or 'Sesame'
        return {'name': (resolver.findtext('oname') or '').strip() or None,
                'type': (resolver.findtext('otype') or '').strip() or None,
                'ra': ra, 'dec': dec, 'service': service}
    return None


def resolve(name, fetch=None):
    """Resolve a name, trying each mirror in turn. Found and not-found answers are cached."""
    fetch = fetch or _get  # Looked up at call time, so tests can replace it.
    key = ' '.join(name.split()).casefold()
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    errors = []
    for mirror in MIRRORS:
        try:
            result = parse(fetch(f'{mirror}{OPTIONS}?{quote(" ".join(name.split()))}'))
            break
        except (requests.RequestException, ResolverUnavailable) as exc:
            errors.append(exc)
    else:
        raise ResolverUnavailable('The CDS name resolver could not be reached. Please retry, or enter RA and Dec.') from errors[-1]
    with _cache_lock:
        _cache[key] = result
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return result


def not_found_message(name):
    if ' '.join(name.split()).casefold() in SOLAR_SYSTEM:
        return (f'{name.strip()} is in our Solar System, so it moves across the sky and has no fixed position to look up. '
                'Comet 3I/ATLAS has its own guided spectrum, which follows its predicted path.')
    return f'No object called “{name.strip()}” was found in SIMBAD, NED or VizieR. Check the spelling, or try a catalogue name such as NGC 1614.'


@router.get('')
def resolve_name(name: str = Query(..., min_length=1, max_length=100)):
    if not NAME.match(name) or not name.strip():
        return JSONResponse(status_code=422, content={'status': 'invalid', 'message': 'Enter an object name.'})
    try:
        result = resolve(name)
    except ResolverUnavailable as exc:
        return JSONResponse(status_code=503, content={'status': 'unavailable', 'message': str(exc)})
    if result is None:
        return JSONResponse(status_code=404, content={'status': 'not_found', 'query': name.strip(), 'message': not_found_message(name)})
    return {'status': 'found', 'query': name.strip(), **result, 'type_label': TYPES.get(result['type']),
            'source': f'{result["service"]} via CDS Sesame'}
