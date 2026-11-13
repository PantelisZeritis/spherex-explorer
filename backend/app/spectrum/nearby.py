"""Catalogued infrared sources around a position, and whether to suggest measuring one of them.

A forced measurement is made exactly where the visitor clicked. A few arcseconds off a star, or in
a gap inside bright nebulosity, the spectrum comes out empty or even negative (the background
ring is brighter than the aperture). This module looks up AllWISE sources near the position so the
interface can offer to move onto the nearest measurable one, and name bright sources that fall in
the background ring.

AllWISE W1 (3.4 um) and W2 (4.6 um) lie inside the SPHEREx range, so their brightness is a fair
guide to what SPHEREx will see. The catalogue is from 2010: fast-moving or variable stars differ.
It is queried through IRSA Gator with a short column list (a few kB, about 2 s), not TAP, because
TAP cone searches on AllWISE can take tens of seconds.
"""
import math
from functools import lru_cache

import numpy as np
import requests
from astropy.io import ascii as astropy_ascii

from ..irsa import IRSAUnavailable
from .archive import BANDS
from .photometry import ANNULUS_IN_PX, ANNULUS_OUT_PX, APERTURE_PX

GATOR_URL = 'https://irsa.ipac.caltech.edu/cgi-bin/Gator/nph-query'
COLUMNS = 'designation,ra,dec,w1mpro,w1sigmpro,w2mpro,w2sigmpro,ext_flg'
PIXEL_ARCSEC = 6.15
SEARCH_ARCSEC = 75.0
# Within this distance the catalogued source IS the measured one (a third of the aperture radius).
HERE_ARCSEC = 5.0
# Rough limits for one measurement: below MIN the spectrum is mostly noise; above MAX SPHEREx
# saturates (see docs/spectral-fingerprint.md).
MIN_MJY, MAX_MJY = 0.5, 100.0
# Suggest moving only when the neighbour is clearly brighter than what is already measured.
BRIGHTER_BY = 3.0
RING_ARCSEC = (ANNULUS_IN_PX * PIXEL_ARCSEC, ANNULUS_OUT_PX * PIXEL_ARCSEC)


def to_mjy(magnitude, band):
    if magnitude is None:
        return None
    return BANDS[band][1] * 1000 * 10 ** (-0.4 * magnitude)


def _number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def separation_arcsec(ra, dec, other_ra, other_dec):
    """Great-circle separation (haversine), accurate at any declination."""
    lat1, lat2 = math.radians(dec), math.radians(other_dec)
    half = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(math.radians(other_ra - ra) / 2) ** 2
    return math.degrees(2 * math.asin(min(1.0, math.sqrt(half)))) * 3600


def sources_from_rows(ra, dec, rows):
    """Catalogue rows -> sources with separation and W1/W2 flux densities, nearest first."""
    sources = []
    for row in rows:
        row_ra, row_dec = _number(row.get('ra')), _number(row.get('dec'))
        if row_ra is None or row_dec is None:
            continue
        # A magnitude without an uncertainty is an upper limit in AllWISE: not a measured brightness.
        w1 = to_mjy(_number(row.get('w1mpro')), 'W1') if _number(row.get('w1sigmpro')) is not None else None
        w2 = to_mjy(_number(row.get('w2mpro')), 'W2') if _number(row.get('w2sigmpro')) is not None else None
        if w1 is None and w2 is None:
            continue
        sources.append({'name': f"WISE {str(row.get('designation', '')).strip()}".strip(), 'ra': row_ra, 'dec': row_dec,
                        'separation_arcsec': separation_arcsec(ra, dec, row_ra, row_dec),
                        'w1_mjy': w1, 'w2_mjy': w2, 'extended': (_number(row.get('ext_flg')) or 0) > 0})
    return sorted(sources, key=lambda source: source['separation_arcsec'])


def brightness(source):
    return max(value for value in (source['w1_mjy'], source['w2_mjy']) if value is not None)


def assess(sources):
    """What is at the position, which neighbour to suggest, and which bright sources sit in the ring."""
    here = next((source for source in sources if source['separation_arcsec'] <= HERE_ARCSEC), None)
    floor = max(MIN_MJY, BRIGHTER_BY * brightness(here)) if here else MIN_MJY
    candidates = [source for source in sources if source is not here and source['separation_arcsec'] > HERE_ARCSEC
                  and floor <= brightness(source) <= MAX_MJY]
    # Prefer bright, then near: brightness per arcsecond of distance keeps a slightly fainter
    # neighbour at 8 arcsec ahead of a slightly brighter one at 70 arcsec.
    suggestion = max(candidates, key=lambda source: brightness(source) / max(source['separation_arcsec'], PIXEL_ARCSEC), default=None)
    reference = brightness(here) if here else 0.0
    ring = [source for source in sources if RING_ARCSEC[0] <= source['separation_arcsec'] <= RING_ARCSEC[1]
            and brightness(source) >= max(MIN_MJY, BRIGHTER_BY * reference)]
    if suggestion:
        reason = 'brighter_neighbour' if here else 'nothing_here'
    else:
        reason = 'source_here' if here else 'nothing_nearby'
    return {'here': here, 'suggestion': suggestion, 'reason': reason,
            'ring': sorted(ring, key=brightness, reverse=True)[:3],
            'too_bright_nearby': [source for source in sources if brightness(source) > MAX_MJY][:3]}


def fetch_rows(ra, dec, radius_arcsec=SEARCH_ARCSEC):
    params = {'catalog': 'allwise_p3as_psd', 'spatial': 'cone', 'radius': f'{radius_arcsec:g}', 'radunits': 'arcsec',
              'objstr': f'{ra:.6f} {dec:+.6f}', 'outfmt': '1', 'selcols': COLUMNS}
    try:
        response = requests.get(GATOR_URL, params=params, timeout=(8, 25))
        response.raise_for_status()
        text = response.text
    except requests.RequestException as exc:
        raise IRSAUnavailable('The IRSA catalogue service could not be reached. Please retry.') from exc
    if 'RowsRetrieved' not in text:
        raise IRSAUnavailable('IRSA returned an unexpected catalogue response.')
    if int(text.split('RowsRetrieved', 1)[1].split('\n', 1)[0].strip(' =') or 0) == 0:
        return []
    try:
        table = astropy_ascii.read(text, format='ipac')
    except Exception as exc:  # noqa: BLE001 - any parse failure means the service answered oddly
        raise IRSAUnavailable('IRSA returned an unreadable catalogue table.') from exc
    # Masked cells (a missing uncertainty marks an upper limit) become None, never 0.
    return [{name: None if np.ma.is_masked(row[name]) else row[name] for name in table.colnames} for row in table]


@lru_cache(maxsize=256)
def nearby(ra, dec):
    sources = sources_from_rows(ra, dec, fetch_rows(ra, dec))
    return {**assess(sources), 'sources': sources[:12], 'radius_arcsec': SEARCH_ARCSEC, 'ring_arcsec': list(RING_ARCSEC),
            'aperture_arcsec': APERTURE_PX * PIXEL_ARCSEC, 'catalogue': 'AllWISE (2010)', 'limits_mjy': [MIN_MJY, MAX_MJY]}
