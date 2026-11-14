# Roadmap

Proposed improvements to Arcadian SkyTracker, grouped by what each one adds. These are ideas, not commitments, and none of them is a current detection or discovery claim.

## Reach: use it without installing anything

- **Shareable links.** The URL does not record what you are looking at. Encoding the position, filter, selected A/B pair and spectrum target would make any finding a link someone else can open.
- **Search by object name.** Live Mode takes a map click or RA/Dec only. A name resolver (CDS Sesame) would let people type "M31" or "Betelgeuse".
- **Docker image.** One command to run both servers, with the Python and Node versions pinned.

## Science: extend what the data can show

- **Any moving object, not just 3I/ATLAS.** The comet path depends on one saved prediction table. Fetching positions from JPL Horizons would allow spectra and tracking views for any comet or asteroid.
- **Light curves.** The spectrum code already groups exposures by season and compares brightness at matching wavelengths. A brightness-over-time plot for each wavelength bin is a small step from there; the blazar S5 0716+714 guided target is a natural test case.
- **Spectrum matching.** Compare a measured spectrum against a small library of reference shapes (star, ice-covered protostar, starburst galaxy, quasar) and report the closest type, with the same conservative wording used for band detection.
- **Automatic redshift suggestion.** The redshift ruler is manual. Proposing a redshift when several lines agree would suit the quasar and galaxy targets.
- **Spectral maps.** Measure a small grid of positions around a target to show where a band, such as PAH emission or water ice, is strongest in an extended object.
- **More than 100 observations per search.** Searches stop at 100 rows and mark the result as truncated. A date-range filter or paging would reach the rest.

## Learning: make it teach

- **Guided tours.** Each guided spectrum target already has a "what to look for" line. These could become step-by-step walkthroughs that end in a question the visitor answers from the plot.
- **Glossary on hover** for terms such as FITS, PSF, detector and linear variable filter.
- **Translations.** All interface text is English and written inline in the components.
- **Classroom export.** A one-page PDF or image of a spectrum or comparison with its plain-language summary and provenance.

## Project health

- **Continuous integration.** There is no CI. Backend tests, frontend unit tests, the build and the offline Playwright specs could run on every push, with the live-archive specs on a schedule.
- **A licence.** The repository has no LICENSE file, which legally blocks reuse.
- **Split dependencies and add linting.** `backend/requirements.txt` mixes runtime packages with pytest, and there is no linter or formatter configuration.
- **Accessibility pass.** Keyboard and screen-reader support exists in places, but the sky map and charts need a proper audit.

## Suggested order

1. Shareable links and CI. They are the cheapest way to put the project in front of more people, and none needs new scientific validation.
2. Horizons-based moving objects and light curves, the strongest new features. Each needs a `docs/` write-up validated against known sources, as the existing features have.
3. The learning features and the remaining project-health items.
