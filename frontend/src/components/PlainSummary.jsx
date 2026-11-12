// "In plain words" card: a short reading of a result for non-astronomers, plus a collapsible
// guide to the chart or images it sits above.
export default function PlainSummary({summary, guide, guideTitle = 'How to read this', testId}) {
  if (!summary) return null;
  return <aside className={`plain-summary plain-${summary.tone || summary.kind || 'info'}`} aria-label="In plain words" data-testid={testId}>
    <div className="plain-eyebrow">IN PLAIN WORDS</div>
    <strong className="plain-headline">{summary.headline}</strong>
    <ul>{summary.sentences.map(sentence => <li key={sentence}>{sentence}</li>)}</ul>
    {guide && <details className="plain-guide"><summary>{guideTitle}</summary>
      <dl>{guide.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}</dl>
    </details>}
    <p className="plain-footnote">A rough guide worked out from the measurements, not an expert classification.</p>
  </aside>;
}
