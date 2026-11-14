# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Arcadian SkyTracker: a React/Vite frontend and a FastAPI backend for exploring NASA SPHEREx infrared observations (search, FITS viewing, time/wavelength comparison, spectra). No database and no user accounts. README.md is the user-facing guide; `docs/` holds the scientific provenance and validation notes for each feature.

## Commands

Run everything from the repository root. `./scripts/setup.sh` creates `.venv` (Python 3.12+) and runs `npm ci` in `frontend/`.

```bash
./scripts/start.sh                                   # both servers (API :8000, Vite :5173), Bash 4.3+
./scripts/backend.sh / ./scripts/frontend.sh         # same, in two terminals

.venv/bin/python -m pytest backend/tests -q          # backend tests
.venv/bin/python -m pytest backend/tests/test_spectrum.py -q -k <name>   # single backend test
npm --prefix frontend test                           # frontend unit tests (node:test, tests/*.test.js)
(cd frontend && node --test tests/spectrum.test.js)  # single frontend unit file
npm --prefix frontend run build
npm --prefix frontend run test:browser               # Playwright, all specs
npm --prefix frontend run test:browser -- tests/browser/demo.spec.js   # single spec

.venv/bin/python scripts/prepare_demo.py --validate frontend/public/demo   # check the demo bundle
```

- Use `python -m pytest` from the root, not bare `pytest`. There is no conftest or pyproject; tests import `backend.app...`, which works only because `-m` puts the cwd on `sys.path`.
- Playwright starts its own servers on **8001/5174** (it needs `.venv` to exist). It uses `/usr/bin/google-chrome` if present, else `CHROME_PATH`, else Playwright's own Chromium (`npx playwright install chromium`).
- Browser tests that need the internet are tagged `{tag: '@live'}`; `--grep-invert @live` runs the rest. Tests that download real FITS are also skipped unless `SKYTRACKER_LIVE_FITS=1`. The validation-lab spec is skipped unless Vite starts with `VITE_ENABLE_DETECTION_LAB=true`.
- CI (`.github/workflows/ci.yml`) runs the backend tests on Python 3.12 and 3.15, frontend unit tests and build, and the non-`@live` browser tests (plus the validation lab with its flag). `live.yml` runs the `@live` tests weekly and on demand. Tag any new test that reaches a real external service `@live`, or CI will fail whenever that service is down.
- `scripts/smoke_*.py`, `scripts/check_mirror_cutouts.py` and `scripts/spectrum.py` are live network checks against real archives. They are not part of the test suite.
- `VITE_ENABLE_DETECTION_LAB=true` shows the developer-only synthetic validation UI.
- Runtime settings are `SKYTRACKER_*` environment variables, read in `image_download.ImageSettings.from_env`, `compare_service.CompareCacheSettings`, `spectrum/service.py` and `demo.py`. Caches go under `.cache/` (gitignored).

## Architecture

### Two data modes
- **Live Mode**: the frontend calls the backend, which queries NASA/IPAC IRSA (the `spherex.obscore` TAP table, in `irsa.py`) and downloads FITS products.
- **Demo Mode** (`?mode=demo`): a bundle checked into `frontend/public/demo/`, made of `manifest.json` plus `assets/<sha256>/{original.fits,preview.png,metadata.json}`. The frontend loads the manifest and previews as static files. FITS readouts, comparisons and spectra still go through the backend, which reads the same bundle (`demo.py`; `SKYTRACKER_DEMO_DIR` points it elsewhere).
- The manifest is validated twice, by the Pydantic `Manifest` model plus `validate_bundle` in `backend/app/demo.py` and by `validateDemoManifest` in `frontend/src/demoAdapter.js`. Both check checksums, asset-path patterns and IRSA URL shapes. Keep the two in sync when the schema changes (`demo/manifest.schema.json`).
- **Never hand-edit the bundle.** The pipeline is `scripts/discover_demo.py` (saves metadata to `demo/discovery/`), then `acquire_demo*.py` (downloads into the gitignored `demo/acquired/` and writes `demo/source-records/` and `demo/plans/`), then `prepare_demo.py --config demo/targets.json --output <new dir>`. `prepare_demo.py` refuses to overwrite an existing output directory.

### Backend (`backend/app/`)
- `main.py` mounts the routers: `/api/observations`, `/api/pairs`, `/api/images` (`images.py`), `/api/demo` (`demo.py`), `/api/compare` (`compare_api.py`), `/api/validation` (`validation_api.py`) and `/api/spectrum` (`spectrum/api.py`). Services are singletons injected with `Depends` and `lru_cache`. Tests override them via `app.dependency_overrides` or patching.
- **Image pipeline**: `ImageService` (`image_service.py`) is an on-disk cache keyed by a sha256 `image_id`. It uses single-flight per image and bounded semaphores, and raises `ImageError` (mapped to a JSON `{status:'unavailable', code, message}` response with the right HTTP status) when busy. `MirrorDownloader` (`image_download.py`) fetches the full product from the AWS S3 Open Data mirror and cuts it locally (`local_cutout.py`), producing bytes identical to IRSA's cutout service. On any mirror problem it falls back to `IRSAImageDownloader`. URLs are validated against IRSA and mirror host/path patterns before any request.
- **FITS decoding never runs in the API process.** `fits_worker.process_fits` spawns `python -m backend.app.fits_worker` under rlimits (CPU, address space) with a timeout. New FITS-parsing operations go in the worker.
- `progress.BOARD` tracks in-flight downloads for the frontend download tray (`GET /api/images/progress`).
- **Comparison**: `compare_service.CompareService` resolves the A/B refs (`image_id`, `demo_image_id` or `access_url`) and calls `analysis/pipeline.compare_files`. `analysis/compare.py` loads frames, reprojects them to a common north-up grid and runs `validate()`, which returns `Reason`s that can block a difference image or any scientific claim. Detection, diagnostics, real-pair assessment and moving-target (3I/ATLAS ephemeris) checks live alongside it in `analysis/`.
- **Spectra** (`spectrum/`): `archive.py` finds the exposures covering a point with a single TAP query. `remote.py` uses HTTP range reads to fetch only the needed FITS header and pixel rows (about 0.3 MB of a 70 MB product) from the S3 mirror. `photometry.py` does aperture photometry with flag masks. `analysis.py` measures bands, seasons and variability against conservative thresholds. `service.py` runs live spectra as background jobs that the client polls. Demo spectra are computed offline from the bundle. `moving.py` handles 3I/ATLAS from the saved ephemeris in `demo/discovery/`.

### Frontend (`frontend/src/`)
- `App.jsx` holds the mode and selection state. `components/*.jsx` contain the UI. Pure logic lives in plain `.js` modules (`spectrum.js`, `timeline.js`, `wavelengths.js`, `plainSummary.js`, `*Adapter.js`, …) so the `node --test` unit tests can import it without a bundler. Keep explicit `.js` extensions on those imports.
- The `*Adapter.js` modules hold the API contracts with the backend. The comment block at the top of `imageAdapter.js` documents the `POST /api/images` contract the Time Slider relies on.
- Live Mode state is mirrored into the URL (`shareLink.js`, written with `history.replaceState` in `App.jsx`). A shared link is read once on load and replayed: search, then A/B picks, open image and comparison (`ComparePanel` `autoRun`), and spectrum (`SpectrumPanel` `shared`). New view state that should survive a shared link needs a parameter there.
- Vite proxies `/api` to `SKYTRACKER_API_TARGET` (default `http://127.0.0.1:8000`). Aladin Lite is imported dynamically (it is a large chunk).

## Scientific-integrity rules (enforced in code and tests)

- **Never invent or substitute observations.** When IRSA or the mirror is unavailable, return an explicit "unavailable" error and an empty result, never a placeholder or synthetic image.
- **Synthetic data must be labelled.** Test fixtures use obs IDs or collections matching `synthetic|fixture|test-only|demo` so the UI labels them. The demo manifest validator rejects real-bundle IDs that match this pattern.
- **Comparisons and detections stay conservative.** Images differ by wavelength (linear variable filters), detector, PSF and calibration, so a visual difference is not presented as variability, motion or a detection. The difference view and scientific screening appear only when `validate()` allows them. Spectral features use 5σ and 8% thresholds, and a forced measurement is never shown as a detection.
- PNG previews are per-frame stretched display images, never photometric data. Original FITS bytes are preserved. `*.fits` is marked binary in `.gitattributes`.

## Conventions

- Commit messages use conventional prefixes (`feat:`, `fix:`, `perf:`, `docs:`, `test:`) followed by a plain-language summary.
- A feature with scientific claims gets a write-up in `docs/` that covers its method, its limits and how it was validated against real data.
