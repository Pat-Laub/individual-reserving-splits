// components/PlotlySpark.jsx
// Minimal Plotly wrapper for tiny "spark" charts (bar or line) with a red cutoff.
// Usage: <PlotlySpark kind="bar" values={[...]} cutoffIndex={k} labels={[...]}/>

function PlotlySpark({
  values,
  cutoffIndex,
  labels,
  kind = 'line',
  height = 100,
  currency = false
}) {
  const elRef = React.useRef(null);
  const { formatCurrency } = (window.utils || {});

  React.useEffect(() => {
    if (!elRef.current || !window.Plotly) return;

    const n = Array.isArray(values) ? values.length : 0;
    const x = (labels && labels.length === n)
      ? labels
      : Array.from({ length: n }, (_, i) => `Q${i + 1}`);

    // Split into observed (≤ cutoff) vs future (> cutoff)
    const yObs = values.map((v, i) => (i <= cutoffIndex ? v : null));
    const yFut = values.map((v, i) => (i > cutoffIndex ? v : null));

    const mkHover = (v, i) => {
      const label = x[i];
      if (v == null) return `${label}: —`;
      const val = (currency && formatCurrency)
        ? formatCurrency(v)
        : (typeof v === 'number' ? v.toFixed(2) : String(v));
      return `${label}: ${val}`;
    };
    const text = values.map(mkHover);

    const obsTrace = (kind === 'bar')
      ? { type: 'bar', x, y: yObs, marker: { color: '#93c5fd', line: { color: '#3b82f6', width: 1 } }, text, hovertemplate: '%{text}<extra></extra>' }
      : { type: 'scatter', mode: 'lines', x, y: yObs, line: { color: '#3b82f6', width: 2 }, text, hovertemplate: '%{text}<extra></extra>' };

    const futTrace = (kind === 'bar')
      ? { type: 'bar', x, y: yFut, marker: { color: '#e5e7eb', line: { color: '#9ca3af', width: 1 } }, hoverinfo: 'skip' }
      : { type: 'scatter', mode: 'lines', x, y: yFut, line: { color: '#e5e7eb', width: 2 }, hoverinfo: 'skip' };

    // Red cutoff line as a paper‑relative shape (works for category x-axes)
    const xRatio = n > 1 ? cutoffIndex / (n - 1) : 0;
    const layout = {
      height,
      margin: { l: 32, r: 6, t: 8, b: 20 },
      showlegend: false,
      hovermode: 'x',
      shapes: [{
        type: 'line',
        xref: 'paper', yref: 'paper',
        x0: xRatio, x1: xRatio,
        y0: 0, y1: 1,
        line: { color: '#dc2626', width: 2 }
      }],
      xaxis: { fixedrange: true, tickfont: { size: 10 } },
      yaxis: { fixedrange: true, zeroline: false, gridcolor: '#f3f4f6', tickfont: { size: 10 } }
    };

    const config = { displayModeBar: false, responsive: true };

    Plotly.react(elRef.current, [futTrace, obsTrace], layout, config);

    const onResize = () => window.Plotly && window.Plotly.Plots.resize(elRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [JSON.stringify(values), cutoffIndex, kind, height, labels && labels.join('|'), currency]);

  return <div ref={elRef} className="w-full" />;
}

// Expose globally like your other components
window.PlotlySpark = PlotlySpark;
