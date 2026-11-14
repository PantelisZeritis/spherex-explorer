# Data and API provenance

Verified on 2026-11-06 against official sources and the live IRSA service.

## Published table and columns

The official [SPHEREx Help PDF](https://irsa.ipac.caltech.edu/onlinehelp/spherex/help.pdf) includes `FROM spherex.obscore`. The official [data-access guide](https://github.com/Caltech-IPAC/spherex-archive-documentation/blob/main/documentation/spherex_data_access.md) describes public archive access. The [IRSA tutorial](https://github.com/Caltech-IPAC/irsa-tutorials/blob/main/tutorials/spherex/spherex_cutouts.md) demonstrates ICRS point-in-footprint queries (its alternative tables are `spherex.artifact` and `spherex.plane`). This application uses ObsCore as requested, with its published `s_region` footprint.

We independently executed this query against the official production TAP endpoint, not a guessed or test endpoint:

```sql
SELECT column_name, datatype, unit
FROM TAP_SCHEMA.columns
WHERE table_name = 'spherex.obscore'
```

The service confirmed all application columns:

| Column | IRSA type | Unit / interpretation |
| --- | --- | --- |
| obs_id | char | Observation ID (not unique across detectors) |
| s_ra, s_dec | double | deg, ICRS image center |
| s_region | char | ObsCore sky footprint |
| t_min, t_max | double | d, MJD observation bounds |
| t_exptime | double | s |
| em_min, em_max | double | m |
| energy_bandpassname | char | Detector/bandpass label |
| obs_collection | char | Archive collection/release |
| access_url | char | Product access/DataLink endpoint |
| access_format | char | MIME type |

The production client repeats a required-column check at first use. It does not assume a particular release collection or fabricate missing columns. The query can return multiple available releases and detectors; collection and bandpass remain visible. No cross-release deduplication is attempted.

## Bounded discovery query

```sql
SELECT TOP 101 obs_id, s_ra, s_dec, t_min, t_max, t_exptime,
  em_min, em_max, energy_bandpassname, obs_collection, access_url, access_format
FROM spherex.obscore
WHERE 1=CONTAINS(POINT('ICRS',210.80227,54.34895),s_region)
ORDER BY t_min DESC, obs_id ASC, energy_bandpassname ASC
```

Request parameters: `REQUEST=doQuery`, `LANG=ADQL`, `FORMAT=votable`, `MAXREC=101`. TAP `QUERY_STATUS=ERROR` and malformed payloads fail explicitly. `OVERFLOW` is valid truncated data. IRSA supplies distinct VOTable FIELD IDs (`col_0`, etc.) and names (`obs_id`, etc.); Astropy is explicitly instructed to use names.

## Map API

[Official release v3.8.1](https://github.com/cds-astro/aladin-lite/releases/tag/v3.8.1) was confirmed stable (not prerelease). Loaded from the official `aladin-lite@3.8.1` npm package after `A.init`; npm integrity is locked. Its JavaScript, embedded styles, and WebAssembly are served locally. The versioned CDN was unresponsive from this development environment, so it is not a runtime dependency. The pinned [View.js source](https://github.com/cds-astro/aladin-lite/blob/v3.8.1/src/js/View.js) confirms that the generic `click` callback provides `{ra, dec, x, y, isDragging}`, computing RA/Dec with `pix2world(x, y, 'icrs')`. The application ignores drag releases. It uses `gotoRaDec`, `getFov`, `A.catalog`, and `A.source`, with `zoomChanged` and `resizeChanged` listeners. The underlying Aladin pan/zoom and branding are preserved.


The sky background uses the genuine DSS2 color HiPS from STScI's public mirror:
`https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/DSSColor`.
This mirror is published in the [official CDS survey registry](https://alasky.cds.unistra.fr/MocServer/query?ID=CDS%2FP%2FDSS2%2Fcolor&fmt=html&get=record). Its metadata and CORS headers were checked directly; browser tests confirm real HEALPix JPEG tile downloads. The mirror avoids this environment's CDS connectivity problem and IRSA's missing CORS headers on its DSS2 mirror. No sky images are baked into the application.

## Name resolver

Checked on 2026-11-14 against the live service. `GET /api/resolve?name=…` asks [CDS Sesame](https://cds.unistra.fr/cgi-bin/Sesame) for XML (`-ox`) from SIMBAD, then NED, then VizieR (`SNV`), stopping at the first that knows the name. It uses the same two addresses as astropy's resolver: `https://cds.unistra.fr/cgi-bin/nph-sesame/`, which currently redirects to a regional VizieR mirror, and `https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/` as a fallback. Redirects are followed only to HTTPS Sesame paths, answers over 64 KB are refused, and an answer that is not Sesame XML counts as the service being unavailable.

The reply keeps the catalogue's own name (`oname`), object type code (`otype`, with plain words for common SIMBAD types) and J2000 position in degrees (`jradeg`, `jdedeg`). Names that resolved during the check, with the name and type returned:

| Typed | Catalogue name | Type | RA, Dec (°) |
| --- | --- | --- | --- |
| M31 | M 31 | AGN | 10.684708, +41.268750 |
| Betelgeuse | * alf Ori | s*r (red supergiant) | 88.792939, +7.407064 |
| NGC 1614 | NGC 1614 | Sy1 | 68.500113, −8.579047 |
| Orion Nebula | M 42 | HII | 83.820100, −5.387600 |
| L1527 | LDN 1527 | DNe (dark cloud) | 69.970800, +25.750000 |

The last row is why the found name is always shown: "L1527" resolves to the centre of the dark cloud, about 0.3° from the embedded protostar that the guided spectrum target measures. Unknown names, and Solar System bodies such as Mars, return "Nothing found"; they are reported as not found, and nothing is guessed. Found and not-found answers are cached in memory (up to 256 names); failures are not cached.
