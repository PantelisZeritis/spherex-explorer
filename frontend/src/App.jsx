import DetectionLab from './components/DetectionLab';
import DemoTargetSummary from './components/DemoTargetSummary';
import { useRef, useState, useEffect } from 'react';
import DownloadTray from './components/DownloadTray';
import SkyMap from './components/SkyMap';
import CoordinatePanel from './components/CoordinatePanel';
import ObservationsTable from './components/ObservationsTable';
import ImageInspector from './components/ImageInspector';
import TemporalImageExplorer from './components/TemporalImageExplorer';
import ComparePanel from './components/ComparePanel';
import { sameObservation } from './compareAdapter';
import { demoResult, loadDemoManifest } from './demoAdapter';
import WavelengthFilter from './components/WavelengthFilter';
import SpectrumPanel from './components/SpectrumPanel';
import { ALL_FILTER, filterParams, filterDemoResult } from './wavelengths';
import { findObservation, readShare, writeShare } from './shareLink';
import { GUIDED_TARGETS } from './spectrumTargets';
const DEFAULT_POSITION = {ra: 210.80227, dec: 54.34895};
const compareKey = (a, b, target) => `${a?.access_url}|${b?.access_url}|${target.ra}|${target.dec}`;

function CopyLink() {
  const [message, setMessage] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {await navigator.clipboard.writeText(window.location.href); setMessage('Link copied');}
    catch {setMessage('Copy the address bar to share');}
    clearTimeout(timer.current); timer.current = setTimeout(() => setMessage(''), 2500);
  }
  return <button type="button" className="share-link" onClick={copy} data-testid="copy-link" aria-live="polite"
    title="The link opens this position, zoom, filter, search, picked observations and spectrum">{message || 'Copy link to this view'}</button>;
}
const MODES = [
  {id:'live', icon:'◉', badge:'Needs internet', title:'Live Mode', tagline:'Query NASA/IPAC IRSA in real time', points:['Pick any point on the interactive sky atlas','Its 0.75–5 µm spectrum from every SPHEREx exposure'], best:'exploring your own targets'},
  {id:'demo', icon:'▶', badge:'Works offline', title:'Demo Mode', tagline:'Instant tour of preloaded real observations', points:['Curated targets with spectra, ready immediately','No network or IRSA queries required'], best:'presentations & a quick first look'},
];
export default function App() {
  // Demo Mode is hidden from visitors: only an explicit ?mode=demo URL opens it, and only then is the mode choice shown.
  const [showModes] = useState(() => new URLSearchParams(window.location.search).get('mode') === 'demo');
  const [mode, setMode] = useState(() => showModes ? 'demo' : 'live');
  // A shared Live Mode link (see shareLink.js), read once when the page opens.
  const [shared] = useState(() => showModes ? null : readShare(window.location.search, GUIDED_TARGETS.map(target => target.id)));
  const [manifest, setManifest] = useState(null), [demoTargetId, setDemoTargetId] = useState('');
  const [filter, setFilter] = useState(() => shared?.filter || ALL_FILTER), [filterError, setFilterError] = useState('');
  const [selected, setSelected] = useState(() => shared?.position || DEFAULT_POSITION);
  const [navigation, setNavigation] = useState(() => shared?.position || shared?.fov
    ? {...(shared.position || DEFAULT_POSITION), fov: shared.fov, exact: true} : null);
  const [fov, setFov] = useState(null);
  const [result, setResult] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [imageObservation, setImageObservation] = useState(null);
  const [picks, setPicks] = useState({a: null, b: null});
  const [compared, setCompared] = useState(null), [autoCompare, setAutoCompare] = useState(null);
  const [spectrum, setSpectrum] = useState(null), [shareNote, setShareNote] = useState('');
  // While a shared link's search is pending, the URL keeps the link as it was opened.
  const restoring = useRef(Boolean(shared?.search));
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  function chooseDemoTarget(target, scienceNote, activeFilter = ALL_FILTER) {
    const {params} = filterParams(activeFilter);
    const next = filterDemoResult(demoResult(target, scienceNote), params);
    setFilter(activeFilter); setFilterError('');
    setPicks({a:null,b:null});
    setDemoTargetId(target.id); setSelected({ra:target.ra, dec:target.dec}); setNavigation({ra:target.ra, dec:target.dec});
    setResult(next); setError(''); setImageObservation(next.observations[0] || null);
  }
  function changeMode(next) {
    request.current?.abort(); request.current = null;
    setFilter(ALL_FILTER); setFilterError('');
    setMode(next); setResult(null); setError(''); setLoading(false);
    setImageObservation(null); setManifest(null); setFov(null); setPicks({a: null, b: null});
  }
  function changePicks(update) {setCompared(null); setAutoCompare(null); setPicks(update);}
  function restoreShared(data) {
    if (!restoring.current) return;
    restoring.current = false;
    const rows = data.observations || [];
    const found = {a: findObservation(rows, shared.a), b: findObservation(rows, shared.b), view: findObservation(rows, shared.view)};
    const missing = ['a', 'b', 'view'].filter(key => shared[key] && !found[key]).map(key => shared[key]);
    if (missing.length) setShareNote(`The shared link names ${missing.join(', ')}, not found in this search. The archive may have changed since the link was made, or the search returned only its first ${rows.length} matches.`);
    setPicks({a: found.a, b: found.b});
    if (found.view) setImageObservation(found.view);
    if (found.a && found.b && shared.compare) setAutoCompare({key: compareKey(found.a, found.b, selected), mode: shared.compare});
  }
  useEffect(() => {if (mode === 'live' && shared?.search) search(shared.filter || ALL_FILTER);}, []);
  useEffect(() => {
    if (mode !== 'live' || restoring.current) return;
    const query = writeShare({position: selected, fov: fov?.[0], filter, searched: Boolean(result || loading || error),
      a: picks.a, b: picks.b, view: imageObservation, compare: compared, spectrum});
    if (query !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${query}${window.location.hash}`);
  }, [mode, selected, fov, filter, result, loading, error, picks, imageObservation, compared, spectrum]);
  function pick(role, row) {
    setCompared(null); setAutoCompare(null);
    // Choosing a row already in the other slot moves it, so A and B never hold the same observation.
    setPicks(current => {
      const other = role === 'a' ? 'b' : 'a';
      return {...current, [role]: sameObservation(current[role], row) ? null : row,
        [other]: sameObservation(current[other], row) ? null : current[other]};
    });
  }
  useEffect(() => {
    if (mode !== 'demo') return;
    const controller = new AbortController(); request.current = controller;
    setLoading(true);
    loadDemoManifest({signal:controller.signal}).then(data => {
      if (request.current !== controller) return;
      setManifest(data);
      chooseDemoTarget(data.targets.find(target => target.status === 'ready') || data.targets[0], data.science_note);
    }).catch(err => {if (request.current === controller && !controller.signal.aborted) setError(err.message);})
      .finally(() => {if (request.current === controller) setLoading(false);});
    return () => controller.abort();
  }, [mode]);
  function select(point) {restoring.current = false; setShareNote(''); changePicks({a: null, b: null}); setImageObservation(null); request.current?.abort(); request.current = null; setLoading(false); setSelected(point); setResult(null); setError('');}
  function changeFilter(next, apply) {
    setFilter(next); setFilterError('');
    if (apply && (result || loading || error)) search(next);
  }
  async function search(activeFilter = filter) {
    const {params, error:invalid} = filterParams(activeFilter);
    if (invalid) {setFilterError(invalid); return;}
    setFilterError('');
    if (mode === 'demo') {
      const target = manifest?.targets.find(item => item.id === demoTargetId);
      if (target) chooseDemoTarget(target, manifest.science_note, activeFilter);
      return;
    }
    setImageObservation(null); setPicks({a: null, b: null});
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setResult(null); setError('');
    const timeout = setTimeout(() => controller.abort('timeout'), 65000);
    try {
      const response = await fetch(`/api/observations?${new URLSearchParams({...selected, ...params})}`, {signal: controller.signal});
      // A non-JSON reply means the app's own backend did not answer (IRSA failures arrive as JSON messages).
      let data = {};
      try {data = await response.json();} catch {data = {};}
      if (!response.ok || data.status !== 'live') throw new Error(data.message || (response.status >= 500
        ? 'The app\'s backend is not responding. Start it with ./scripts/start.sh (or ./scripts/backend.sh).'
        : 'The observation service is unavailable.'));
      if (request.current === controller) {setResult(data); restoreShared(data);}
    } catch (err) {
      if (request.current === controller) setError(controller.signal.aborted ? 'The observation search timed out.' : err.message);
    } finally {clearTimeout(timeout); if (request.current === controller) setLoading(false);}
  }
  return <div className="app"><header><a className="brand" href="/" aria-label="Arcadian SkyTracker home"><span className="brand-icon">✳</span><span>ARCADIAN<span className="brand-sub">SKYTRACKER</span></span></a><div className="header-context">NASA SPACE APPS CHALLENGE 2026 <span>Planet X & SPHEREx · Team prototype</span></div><div className="header-actions">{mode === 'live' && <CopyLink/>}<span className="milestone">03 / SPECTRAL FINGERPRINTS</span></div></header>
    <main>
    <section className="panel mode-panel" aria-label="Data mode">
      {showModes && <fieldset className="mode-choice" role="radiogroup" aria-label="Data mode">
        <legend>Choose how to explore</legend>
        {MODES.map(option => <label key={option.id} className={`mode-card mode-${option.id}${mode === option.id ? ' is-active' : ''}`}>
          <input type="radio" name="data-mode" value={option.id} checked={mode === option.id} onChange={() => changeMode(option.id)}/>
          <span className="mode-card-top"><span className="mode-icon" aria-hidden="true">{option.icon}</span><span className="mode-badge">{option.badge}</span><span className="mode-check" aria-hidden="true"/></span>
          <strong>{option.title}</strong>
          <span className="mode-tagline">{option.tagline}</span>
          <ul>{option.points.map(point => <li key={point}>{point}</li>)}</ul>
          <span className="mode-best">Best for: {option.best}</span>
        </label>)}
      </fieldset>}
      <p role="note" className="mode-note">{mode === 'demo' ? 'DEMO MODE · Local, preloaded real SPHEREx data. No live IRSA query. PNGs are display previews, not scientific arrays.' : 'LIVE MODE · Observation searches and new cutouts require NASA/IPAC IRSA network access.'}</p>
      {shareNote && <p role="status" className="share-note" data-testid="share-note">{shareNote}</p>}
      {mode === 'demo' && <>
        {loading && <p role="status">Loading preloaded target manifest…</p>}
        {manifest && <><label htmlFor="demo-target">Preloaded target</label><select id="demo-target" value={demoTargetId} onChange={event => chooseDemoTarget(manifest.targets.find(target => target.id === event.target.value), manifest.science_note)}>
          {manifest.targets.map(target => <option key={target.id} value={target.id}>{target.name}{target.status === 'missing' ? ' — not prepared' : ''}</option>)}
        </select><form onSubmit={event => {event.preventDefault(); search();}}>
          <WavelengthFilter filter={filter} onChange={changeFilter} error={filterError}/>
          <button type="submit">Apply preloaded filter</button>
        </form>{manifest.targets.find(target => target.id === demoTargetId)?.missing_reason && <p role="status">{manifest.targets.find(target => target.id === demoTargetId).missing_reason}</p>}</>}
      </>}
    </section>
    <div className="intro"><div><div className="eyebrow">EXPLORE THE INFRARED UNIVERSE</div><h1>Every point in the sky<br className="mobile-break"/> has a spectrum.</h1><p>Pick any position and read its infrared fingerprint from SPHEREx: ices, gas, dust, and how they change with time.</p></div><div className="fov"><span>FIELD OF VIEW</span><strong data-testid="fov">{mode === 'demo' ? 'Preloaded cutouts' : fov ? `${fov[0].toFixed(3)}° × ${fov[1].toFixed(3)}°` : 'Connecting…'}</strong></div></div>
    {mode === 'live' ? <div className="workspace"><section className="map-panel"><div className="map-heading"><span><i/> CELESTIAL ATLAS</span><span>ICRS / DSS2 COLOR</span></div><SkyMap selected={selected} navigation={navigation} onSelect={select} onFov={setFov}/></section><CoordinatePanel selected={selected} onGo={(point, fov) => {select(point); setNavigation({...point, fov});}} onSearch={() => search()} loading={loading} filter={filter} onFilterChange={changeFilter} filterError={filterError}/></div> : <section className="panel demo-region" aria-label="Preloaded sky region">
      <h2>{manifest?.targets.find(target => target.id === demoTargetId)?.name || 'Preloaded sky region'}</h2>
      <DemoTargetSummary target={manifest?.targets.find(target => target.id === demoTargetId)}/>
      {manifest && <p>Reference ICRS RA {selected.ra.toFixed(6)}°, Dec {selected.dec.toFixed(6)}°. For tracking targets this reference is the first prepared frame; each image records its own center. The cutouts below retain native detector orientation and may have different coverage. Live Mode provides the interactive Aladin sky atlas.</p>}
    </section>}
    <SpectrumPanel mode={mode} selected={selected} demoTargetId={demoTargetId} shared={shared?.spectrum} onSpectrum={setSpectrum} onGo={(point, fov) => {select(point); setNavigation({...point, fov});}}/>
    <div className="section-divider"><div className="eyebrow">THE EXPOSURES BEHIND THE SPECTRUM</div><p>Search, view and compare the individual SPHEREx images of this position.</p></div>
    <ObservationsTable mode={mode} result={result} loading={loading} error={error} selectedObservation={imageObservation} onViewImage={setImageObservation}
      compare={{...picks, onPick: pick}} target={selected}/>
    {result?.count > 0 && <ComparePanel key={compareKey(picks.a, picks.b, selected)}
      picks={picks} target={selected} onRemove={role => changePicks(current => ({...current, [role]: null}))}
      onSwap={() => changePicks(current => ({a: current.b, b: current.a}))}
      autoRun={autoCompare?.key === compareKey(picks.a, picks.b, selected) ? autoCompare.mode : null}
      onResult={data => setCompared(data?.validation?.mode || null)} onCleared={() => setCompared(null)}/>}
    {import.meta.env.VITE_ENABLE_DETECTION_LAB === 'true' && <DetectionLab/>}
    <TemporalImageExplorer result={result} loading={loading} error={error} target={selected}/>
    <ImageInspector observation={imageObservation} target={selected}/></main><footer><span>Arcadian SkyTracker · Milestone 03</span><span>Sky atlas by <a href="https://aladin.cds.unistra.fr/AladinLite/">Aladin Lite / CDS</a> · DSS2 imagery · Observations from <a href="https://irsa.ipac.caltech.edu/Missions/spherex.html">NASA/IPAC IRSA</a></span></footer><DownloadTray enabled={mode === 'live'}/></div>;
}
