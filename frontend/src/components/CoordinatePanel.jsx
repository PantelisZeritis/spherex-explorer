import { useEffect, useRef, useState } from 'react';
import { validCoordinates } from '../coordinates';
import { NAME_FOV_DEG, NAME_MAX_LENGTH, describeResolved, resolveName } from '../resolveName';
import WavelengthFilter from './WavelengthFilter';

function NameSearch({selected, onGo}) {
  const [name, setName] = useState(''), [busy, setBusy] = useState(false);
  const [found, setFound] = useState(null), [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  // The result describes the found position only; moving elsewhere retires it.
  useEffect(() => {if (found && (found.ra !== selected.ra || found.dec !== selected.dec)) setFound(null);}, [selected]);
  async function find(event) {
    event.preventDefault();
    if (!name.trim()) {setError('Enter an object name, such as M31 or Betelgeuse.'); return;}
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 45000);
    setBusy(true); setError(''); setFound(null);
    try {
      const result = await resolveName(name.trim(), {signal: controller.signal});
      if (request.current !== controller) return;
      setFound(result);
      onGo({ra: result.ra, dec: result.dec}, NAME_FOV_DEG);
    } catch (err) {
      if (request.current === controller) setError(controller.signal.reason === 'timeout' ? 'The name lookup timed out. Please retry, or enter RA and Dec.' : err.message);
    } finally {clearTimeout(timeout); if (request.current === controller) setBusy(false);}
  }
  return <form className="name-search" onSubmit={find} aria-busy={busy}>
    <label htmlFor="object-name">Find an object by name</label>
    <div className="name-search-row">
      <input id="object-name" value={name} maxLength={NAME_MAX_LENGTH} onChange={event => setName(event.target.value)}
        placeholder="e.g. M31, Betelgeuse, Orion Nebula" autoComplete="off" spellCheck="false"/>
      <button type="submit" disabled={busy}>{busy ? 'Finding…' : 'Find'}</button>
    </div>
    {found && <p className="name-found" role="status" data-testid="name-found">Found <strong>{describeResolved(found)}</strong></p>}
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

export default function CoordinatePanel({selected, onGo, onSearch, loading, filter, onFilterChange, filterError}) {
  const [ra, setRa] = useState(String(selected.ra)), [dec, setDec] = useState(String(selected.dec));
  const [error, setError] = useState('');
  useEffect(() => {setRa(selected.ra.toFixed(6)); setDec(selected.dec.toFixed(6)); setError('');}, [selected]);
  function go(event) {
    event.preventDefault();
    if (!validCoordinates(ra, dec)) {setError('Enter RA from 0 to <360° and Dec from −90 to +90°.'); return;}
    setError(''); onGo({ra: Number(ra), dec: Number(dec)});
  }
  return <aside className="panel coordinates">
    <div className="eyebrow">TARGET INSPECTOR</div><h2>Selected location</h2>
    <span className="tag">ICRS · decimal degrees</span>
    <dl><div><dt>Right ascension</dt><dd data-testid="selected-ra">{selected.ra.toFixed(6)}<small>°</small></dd></div><div><dt>Declination</dt><dd data-testid="selected-dec">{selected.dec.toFixed(6)}<small>°</small></dd></div></dl>
    <NameSearch selected={selected} onGo={onGo}/>
    <form onSubmit={go}><label htmlFor="ra">RA <span>0 ≤ RA &lt; 360°</span></label><input id="ra" inputMode="decimal" value={ra} onChange={e => setRa(e.target.value)} required/>
      <label htmlFor="dec">Dec <span>−90° to +90°</span></label><input id="dec" inputMode="decimal" value={dec} onChange={e => setDec(e.target.value)} required/>
      {error && <p className="error" role="alert">{error}</p>}<button className="secondary" type="submit">Go To Coordinates <span>↗</span></button></form>
    <div className="search-block"><div className="eyebrow">SPHEREx ARCHIVE</div><p>Find spectral images whose footprints cover your selected point.</p><form onSubmit={event => {event.preventDefault(); if (!loading) onSearch();}}>
      <WavelengthFilter filter={filter} onChange={onFilterChange} error={filterError}/>
      <button type="submit" disabled={loading}>{loading ? 'Searching IRSA…' : 'Search SPHEREx Observations'}</button></form><small>Live query · NASA/IPAC IRSA</small></div>
  </aside>;
}
