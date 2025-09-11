// import React, { useMemo, useRef, useState, useEffect } from 'react';

// Editable, exportable SVG diagram for insurance claim arrivals and settlements
// - X-axis is DATE
// - Each claim is a horizontal line from notification (circle) to settlement (final X)
// - Partial payments are X marks along the line
// - Sorted by notification date (earliest at top)
//
// Splits:
// - Train: notify < trainCut
// - Val:   trainCut <= notify < valCut
// - Test:  valCut   <= notify < testCut
// - Post:  notify >= testCut (outside observation window)
//
// Censoring:
// - If a claim's settlement is after its dataset cutoff, its observed segment ends at the cutoff with a square; the continuation is dashed & faded.
//
// Duplication (data leakage illustration):
// - If a TRAIN claim is censored because settlement is strictly between trainCut and valCut,
//   add a duplicate in VAL (immediately below). The VAL copy is not censored; the segment before trainCut is
//   rendered dashed+faded to indicate overlap with train data.
// - If a VAL claim is censored because settlement is strictly between valCut and testCut,
//   add a duplicate in TEST (immediately below the VAL row). The TEST copy is not censored; the segment before valCut
//   is rendered dashed+faded to indicate overlap with validation data.

// -------------------- Helpers --------------------
function hashStringToSeed(str) {
  let h = 2166136261 >>> 0; // FNV-1a basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MS_PER_DAY = 86400000;
const toISODate = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
function clampDate(d, min, max) {
  const t = d.getTime();
  return new Date(Math.min(Math.max(t, min.getTime()), max.getTime()));
}
function addDays(d, days) {
  return new Date(d.getTime() + days * MS_PER_DAY);
}
function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}
function parseMaybeDate(value, baseStart) {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof value === 'number' && baseStart instanceof Date) {
    return addDays(baseStart, value);
  }
  return null;
}
function monthKeyUTC(d) {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}
function dedupeByCalendarMonth(dates) {
  const seen = new Set();
  const out = [];
  for (const d of dates) {
    const key = monthKeyUTC(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

// Tick helpers for calendar-aware axis labels
function startOfMonthUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonthsUTC(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function generateSmartTicks(start, end, maxTicks = 10) {
  const spanDays = daysBetween(start, end);
  const ticks = [];
  maxTicks = Math.max(2, Math.floor(maxTicks));
  if (spanDays > 365 * 3) {
    // Yearly ticks
    const startY = start.getUTCFullYear();
    const endY = end.getUTCFullYear();
    const totalYears = endY - startY + 1;
    const stepY = Math.max(1, Math.ceil(totalYears / maxTicks));
    for (let y = startY; y <= endY; y += stepY) {
      ticks.push(new Date(Date.UTC(y, 0, 1)));
    }
  } else {
    // Monthly/quarterly ticks (step chosen to fit under maxTicks)
    const s0 = startOfMonthUTC(start);
    const e0 = startOfMonthUTC(end);
    const monthsSpan = (e0.getUTCFullYear() - s0.getUTCFullYear()) * 12 + (e0.getUTCMonth() - s0.getUTCMonth()) + 1;
    const stepM = Math.max(1, Math.ceil(monthsSpan / maxTicks));
    for (let m = 0; ; m += stepM) {
      const t = addMonthsUTC(s0, m);
      if (t > end) break;
      ticks.push(t);
    }
  }
  return ticks;
}

function generateClaims({
  n = 20,
  startDate,
  endDate,
  minDurDays = 30,
  maxDurDays = 300,
  maxPartials = 3,
  seed = 1,
  dedupeMonthly = true,
}) {
  const rand = mulberry32(seed);
  const claims = [];
  const totalDays = Math.max(1, daysBetween(startDate, endDate));
  const latestNotify = Math.max(0, totalDays - minDurDays);
  for (let i = 0; i < n; i++) {
    const notify = addDays(startDate, Math.floor(rand() * latestNotify));
    const dur = minDurDays + Math.floor(rand() * Math.max(1, maxDurDays - minDurDays + 1));
    const rawSettlement = addDays(notify, dur);
    const settlement = rawSettlement > endDate ? endDate : rawSettlement;
    let k = Math.floor(rand() * (maxPartials + 1));
    if (daysBetween(notify, settlement) < 2) k = 0;
    let partials = [];
    for (let j = 0; j < k; j++) {
      const spanDays = Math.max(1, daysBetween(notify, settlement));
      const t = addDays(notify, Math.floor(rand() * spanDays));
      partials.push(t);
    }
    partials = partials
      .filter((t) => t > notify && t < settlement)
      .sort((a, b) => a.getTime() - b.getTime());
    if (dedupeMonthly) partials = dedupeByCalendarMonth(partials);
    claims.push({ notify, settlement, partials });
  }
  claims.sort((a, b) => a.notify.getTime() - b.notify.getTime());
  return claims;
}

function XMark({ x, y, size = 6, strokeWidth = 2, color = 'currentColor', opacity = 1 }) {
  return (
    <g opacity={opacity}>
      <line x1={x - size} y1={y - size} x2={x + size} y2={y + size} strokeWidth={strokeWidth} stroke={color} />
      <line x1={x - size} y1={y + size} x2={x + size} y2={y - size} strokeWidth={strokeWidth} stroke={color} />
    </g>
  );
}

function SquareMark({ x, y, size = 8, strokeWidth = 2, color = 'currentColor' }) {
  const half = size / 2;
  return <rect x={x - half} y={y - half} width={size} height={size} fill='white' stroke={color} strokeWidth={strokeWidth} />;
}

// -------------------- Component --------------------
function ClaimsDiagram() {
  // Controls / state
  const { useState, useMemo, useRef, useEffect } = React;
  const [numClaims, setNumClaims] = useState(20);
  const [startDateStr, setStartDateStr] = useState('2020-01-01');
  const [endDateStr, setEndDateStr] = useState('2025-01-01');
  const [minDurDays, setMinDurDays] = useState(30);
  const [maxDurDays, setMaxDurDays] = useState(365);
  const [maxPartials, setMaxPartials] = useState(3);
  const [seedText, setSeedText] = useState('insurer-diagram');
  const [axisTicks, setAxisTicks] = useState(10);
  const [label, setLabel] = useState('Date');
  const [useCustom, setUseCustom] = useState(false);
  const [customJson, setCustomJson] = useState(
    JSON.stringify(
      [
        { notify: '2020-02-15', settlement: '2020-10-01', partials: ['2020-04-01', '2020-07-10'] },
        { notify: '2022-03-10', settlement: '2023-01-20', partials: ['2022-06-01', '2022-12-15'] },
        { notify: '2024-01-05', settlement: '2025-03-15', partials: ['2024-04-09', '2024-09-30'] },
      ],
      null,
      2
    )
  );
  const [rowGap, setRowGap] = useState(20);
  const [margins, setMargins] = useState({ left: 70, right: 24, top: 28, bottom: 52 });
  const [dedupeMonthly, setDedupeMonthly] = useState(true);
  const [trainCutStr, setTrainCutStr] = useState('2021-06-30');
  const [valCutStr, setValCutStr] = useState('2023-06-30');
  const [testCutStr, setTestCutStr] = useState('2025-01-01');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const COLORS = { train: '#2563eb', val: '#f59e0b', test: '#10b981', post: '#9ca3af' };
  const FADE_OPACITY = 0.35;
  const LEAK_OPACITY = 0.35;
  const LEAK_DASH = '3 3';

  const seed = useMemo(() => hashStringToSeed(seedText), [seedText]);

  // Split options
  const SPLIT_OPTIONS = [
    { id: 'notify', label: 'Notification date' },
    { id: 'settlement', label: 'Settlement date' },
    { id: 'notifyDup', label: 'Both' },
  ];
  const [splitMode, setSplitMode] = useState('notify');

  // Parse start/end
  const [startDate, endDate] = useMemo(() => {
    const s = new Date(startDateStr);
    const e = new Date(endDateStr);
    const sOk = !isNaN(s.getTime()) ? s : new Date('2020-01-01T00:00:00Z');
    const eOk = !isNaN(e.getTime()) ? e : new Date('2025-01-01T00:00:00Z');
    return sOk.getTime() < eOk.getTime() ? [sOk, eOk] : [eOk, sOk];
  }, [startDateStr, endDateStr]);

  // Clamp & sort cutoffs
  const [trainCut, valCut, testCut] = useMemo(() => {
    const clamp = (d) => clampDate(d, startDate, endDate);
    const candidates = [trainCutStr, valCutStr, testCutStr]
      .map((s) => new Date(s))
      .filter((d) => !isNaN(d.getTime()))
      .map(clamp)
      .sort((a, b) => a.getTime() - b.getTime());
    if (candidates.length !== 3) {
      const a = clamp(new Date('2021-01-01'));
      const b = clamp(new Date('2023-01-01'));
      const c = clamp(new Date('2025-01-01'));
      return [a, b, c];
    }
    return candidates;
  }, [trainCutStr, valCutStr, testCutStr, startDate, endDate]);

  // Dataset helpers
  function datasetForNotify(tDate) {
    const t = tDate.getTime();
    if (t < trainCut.getTime()) return { name: 'train', cutoff: trainCut, color: COLORS.train };
    if (t < valCut.getTime()) return { name: 'val', cutoff: valCut, color: COLORS.val };
    if (t < testCut.getTime()) return { name: 'test', cutoff: testCut, color: COLORS.test };
    return { name: 'post', cutoff: endDate, color: COLORS.post };
  }
  function datasetForSettlement(sDate) {
    const t = sDate.getTime();
    if (t <= trainCut.getTime()) return { name: 'train', cutoff: trainCut, color: COLORS.train };
    if (t <= valCut.getTime()) return { name: 'val', cutoff: valCut, color: COLORS.val };
    if (t <= testCut.getTime()) return { name: 'test', cutoff: testCut, color: COLORS.test };
    return null; // after observation window
  }

  // Claims
  const autoClaims = useMemo(
    () =>
      generateClaims({
        n: numClaims,
        startDate,
        endDate,
        minDurDays,
        maxDurDays,
        maxPartials,
        seed,
        dedupeMonthly,
      }),
    [numClaims, startDate, endDate, minDurDays, maxDurDays, maxPartials, seed, dedupeMonthly]
  );

  const parsedCustom = useMemo(() => {
    if (!useCustom) return null;
    try {
      const data = JSON.parse(customJson);
      if (!Array.isArray(data)) return null;
      const cleaned = data
        .map((d) => ({
          notify: parseMaybeDate(d.notify, new Date(startDateStr)),
          settlement: parseMaybeDate(d.settlement, new Date(startDateStr)),
          partials: Array.isArray(d.partials) ? d.partials.map((p) => parseMaybeDate(p, new Date(startDateStr))) : [],
        }))
        .filter((d) => d.notify instanceof Date && d.settlement instanceof Date)
        .map((d) => {
          const notify = clampDate(d.notify, startDate, endDate);
          const settlement = clampDate(d.settlement, notify, endDate);
          let p = d.partials
            .filter(Boolean)
            .map((x) => clampDate(x, notify, settlement))
            .filter((x) => x > notify && x < settlement)
            .sort((a, b) => a.getTime() - b.getTime());
          if (dedupeMonthly) p = dedupeByCalendarMonth(p);
          return { notify, settlement, partials: p };
        })
        .sort((a, b) => a.notify.getTime() - b.notify.getTime());
      return cleaned;
    } catch {
      return null;
    }
  }, [useCustom, customJson, startDateStr, startDate, endDate, dedupeMonthly]);

  const claims = useCustom && parsedCustom ? parsedCustom : autoClaims;

  // ---- One-time initialization of cutoffs based on simulated data ----
  const [didInitCuts, setDidInitCuts] = useState(false);
  useEffect(() => {
    if (didInitCuts) return;
    const list = (claims || []).map((c) => c.notify).sort((a, b) => a.getTime() - b.getTime());
    const n = list.length;
    const obsEnd = new Date('2025-01-01T00:00:00Z');

    if (n >= 2) {
      const clampIdx = (idx) => Math.min(Math.max(idx, 0), n - 2);
      const target60 = Math.round(0.6 * n);
      const k60 = clampIdx(target60 - 1);
      const mid60 = new Date((list[k60].getTime() + list[k60 + 1].getTime()) / 2);

      const target80Raw = Math.round(0.8 * n) - 1;
      let k80 = clampIdx(target80Raw);
      if (k80 <= k60) k80 = clampIdx(k60 + 1);
      const mid80 = new Date((list[k80].getTime() + list[k80 + 1].getTime()) / 2);

      const tTrain = toISODate(clampDate(mid60, startDate, obsEnd));
      const tVal = toISODate(clampDate(mid80, startDate, obsEnd));
      const tTest = toISODate(clampDate(obsEnd, startDate, obsEnd));
      setTrainCutStr(tTrain);
      setValCutStr(tVal);
      setTestCutStr(tTest);
      setDidInitCuts(true);
    } else {
      const total = daysBetween(startDate, obsEnd);
      const tTrain = toISODate(addDays(startDate, Math.floor(0.6 * total)));
      const tVal = toISODate(addDays(startDate, Math.floor(0.8 * total)));
      const tTest = toISODate(obsEnd);
      setTrainCutStr(tTrain);
      setValCutStr(tVal);
      setTestCutStr(tTest);
      setDidInitCuts(true);
    }
  }, [claims, startDate, didInitCuts]);

  // Row builder (reused by UI)
  function buildRows(localClaims, mode) {
    const out = [];
    for (const c of localClaims) {
      // Observation window ends at testCut: drop claims notified on/after testCut
      if (c.notify.getTime() >= testCut.getTime()) continue;

      if (mode === 'notify') {
        // If settlement is at/after test cutoff, classify as Unused (grey) and censor at testCut
        if (c.settlement.getTime() >= testCut.getTime()) {
          out.push({
            claim: c,
            dataset: 'post',
            color: COLORS.post,
            cutoff: testCut,
            isCensored: true,
            observedEnd: testCut,
            isDuplicate: false,
            hasDuplicate: false,
          });
          continue;
        }
        const ds = datasetForNotify(c.notify);
        const baseCutoff = ds.name === 'post' ? endDate : ds.cutoff;
        const isCensored = ds.name !== 'post' && c.notify < baseCutoff && c.settlement > baseCutoff;
        const observedEnd = isCensored ? baseCutoff : c.settlement;
        out.push({
          claim: c,
          dataset: ds.name,
          color: ds.color,
          cutoff: baseCutoff,
          isCensored,
          observedEnd,
          isDuplicate: false,
          hasDuplicate: false,
        });
        continue;
      }

      if (mode === 'notifyDup') {
        // If settlement is at/after test cutoff, classify as Unused (grey) and censor at testCut (no duplication)
        if (c.settlement.getTime() >= testCut.getTime()) {
          out.push({
            claim: c,
            dataset: 'post',
            color: COLORS.post,
            cutoff: testCut,
            isCensored: true,
            observedEnd: testCut,
            isDuplicate: false,
            hasDuplicate: false,
          });
          continue;
        }
        const ds = datasetForNotify(c.notify);
        const baseCutoff = ds.name === 'post' ? endDate : ds.cutoff;
        const isCensored = ds.name !== 'post' && c.notify < baseCutoff && c.settlement > baseCutoff;
        const observedEnd = isCensored ? baseCutoff : c.settlement;
        const primaryRow = {
          claim: c,
          dataset: ds.name,
          color: ds.color,
          cutoff: baseCutoff,
          isCensored,
          observedEnd,
          isDuplicate: false,
          hasDuplicate: false,
        };
        const baseIndex = out.length;
        out.push(primaryRow);
        // Duplicate TRAIN -> VAL
        if (
          ds.name === 'train' &&
          c.settlement.getTime() > trainCut.getTime() &&
          c.settlement.getTime() <= valCut.getTime()
        ) {
          out.push({
            claim: c,
            dataset: 'val',
            color: COLORS.val,
            cutoff: valCut,
            isCensored: false,
            observedEnd: c.settlement,
            isDuplicate: true,
            leakUntil: trainCut,
            linkFrom: baseIndex,
          });
          primaryRow.hasDuplicate = true;
        }
        // Duplicate VAL -> TEST
        if (
          ds.name === 'val' &&
          c.settlement.getTime() > valCut.getTime() &&
          c.settlement.getTime() <= testCut.getTime()
        ) {
          out.push({
            claim: c,
            dataset: 'test',
            color: COLORS.test,
            cutoff: testCut,
            isCensored: false,
            observedEnd: c.settlement,
            isDuplicate: true,
            leakUntil: valCut,
            linkFrom: baseIndex,
          });
          primaryRow.hasDuplicate = true;
        }
        continue;
      }

      if (mode === 'settlement') {
        // If settlement is at/after test cutoff, classify as Unused (grey) and censor at testCut
        if (c.settlement.getTime() >= testCut.getTime()) {
          out.push({
            claim: c,
            dataset: 'post',
            color: COLORS.post,
            cutoff: testCut,
            isCensored: true,
            observedEnd: testCut,
            isDuplicate: false,
            hasDuplicate: false,
          });
          continue;
        }
        const ds = datasetForSettlement(c.settlement);
        if (!ds) continue; // settlement after observation window (already handled above)
        out.push({
          claim: c,
          dataset: ds.name,
          color: ds.color,
          cutoff: ds.cutoff,
          isCensored: false,
          observedEnd: c.settlement,
          isDuplicate: false, // solid; no leak styling in settlement-based split
          hasDuplicate: false,
        });
        continue;
      }
    }
    return out;
  }

  // Build rows for current UI
  const rows = useMemo(() => buildRows(claims, splitMode), [claims, splitMode, trainCut, valCut, testCut, endDate]);

  // SVG layout
  const width = 1100;
  const contentHeight = Math.max(1, rows.length) * rowGap;
  const height = margins.top + contentHeight + margins.bottom;
  const xMin = startDate.getTime();
  const xMax = endDate.getTime();
  function xScale(date) {
    const w = width - margins.left - margins.right;
    const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
    return margins.left + ((t - xMin) / (xMax - xMin)) * w;
  }
  function yScale(i) {
    return margins.top + i * rowGap;
  }

  const svgRef = useRef(null);
  function downloadSVG() {
    if (!svgRef.current) return;
    const svgElement = svgRef.current;
    const svgData = new XMLSerializer().serializeToString(svgElement);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'claims-diagram.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function formatTick(d) {
    const spanDays = daysBetween(startDate, endDate);
    if (spanDays > 365 * 3) return d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${d.getUTCFullYear()}-${m}`;
  }

  const ticks = useMemo(() => {
    return generateSmartTicks(startDate, endDate, axisTicks + 1);
  }, [startDate, endDate, axisTicks]);

  // -------------------- Render --------------------
  return (
    <div className='w-full relative'>
      {/* Main content */}
      <div className='w-full p-4 flex flex-col items-center'>
        <div className='text-xl font-semibold mb-2'>Individual Reserving Dataset Splits</div>
        <div className='mb-3 text-sm flex flex-wrap items-center justify-center gap-4'>
          <span className='font-medium'>Split by:</span>
          <label className='inline-flex items-center gap-2'>
            <input type='radio' name='splitModeTop' value='notify' checked={splitMode === 'notify'} onChange={(e) => setSplitMode(e.target.value)} />
            <span>Notification date</span>
          </label>
          <label className='inline-flex items-center gap-2'>
            <input type='radio' name='splitModeTop' value='settlement' checked={splitMode === 'settlement'} onChange={(e) => setSplitMode(e.target.value)} />
            <span>Settlement date</span>
          </label>
          <label className='inline-flex items-center gap-2'>
            <input type='radio' name='splitModeTop' value='notifyDup' checked={splitMode === 'notifyDup'} onChange={(e) => setSplitMode(e.target.value)} />
            <span>Both</span>
          </label>
        </div>
        <div className='text-sm opacity-80 mb-4'>
          Each horizontal line represents one claim as it develops over time from notification to settlement. Circles mark notification; X marks indicate payments; the final X is the settlement.
          Colored by dataset: <span style={{ color: COLORS.train }}>Train</span>, <span style={{ color: COLORS.val }}>Validation</span>, <span style={{ color: COLORS.test }}>Test</span>.{' '}<span className='opacity-70'>Claims that settle on or after the Test cutoff appear in grey as Unused.</span>{' '}Censored segments end with a square at the dataset cutoff; the continuation is dashed and faded.
        </div>
        <div className='w-4/5 overflow-auto rounded-2xl ring-1 ring-gray-300'>
          <svg ref={svgRef} xmlns='http://www.w3.org/2000/svg' viewBox={`0 0 ${width} ${height}`} width='100%' role='img'>
            <rect x={0} y={0} width={width} height={height} fill='white' />

            <defs>
              <marker id='dup-arrow' viewBox='0 0 10 10' refX='6' refY='5' markerWidth='6' markerHeight='6' orient='auto-start-reverse'>
                <path d='M 0 0 L 10 5 L 0 10 z' fill='#6b7280' />
              </marker>
            </defs>

            {/* Axis */}
            <g>
              <line x1={margins.left} y1={margins.top + contentHeight + 10} x2={width - margins.right} y2={margins.top + contentHeight + 10} stroke='#111827' strokeWidth={1} />
              {ticks.map((t, i) => {
                const x = xScale(t);
                return (
                  <g key={i}>
                    <line x1={x} y1={margins.top + contentHeight + 6} x2={x} y2={margins.top + contentHeight + 14} stroke='#111827' />
                    <text x={x} y={margins.top + contentHeight + 30} fontSize={12} textAnchor='middle' fill='#111827'>
                      {formatTick(t)}
                    </text>
                  </g>
                );
              })}
              <text x={(margins.left + width - margins.right) / 2} y={height - 10} textAnchor='middle' fontSize={12} fill='#111827'>
                {label}
              </text>
            </g>

            {/* Cutoff lines */}
            <g>
              {[{ label: 'Train cutoff', x: trainCut }, { label: 'Validation cutoff', x: valCut }, { label: 'Test cutoff', x: testCut }].map((c, idx) => {
                const x = xScale(c.x);
                return (
                  <g key={idx}>
                    <line x1={x} y1={margins.top - 6} x2={x} y2={margins.top + contentHeight + 10} stroke='#6b7280' strokeDasharray='4 4' />
                    <text x={x - 6} y={margins.top - 8} fontSize={11} fill='#6b7280' textAnchor='end'>
                      {c.label}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* Claims */}
            <g>
              {rows.map((r, idx) => {
                const c = r.claim;
                const y = yScale(idx);
                const color = r.color;

                const xNotify = xScale(c.notify);
                const observedEndClamped = new Date(Math.min(r.observedEnd.getTime(), testCut.getTime()));
                const settlementClamped = new Date(Math.min(c.settlement.getTime(), testCut.getTime()));

                return (
                  <g key={idx}>
                    <text x={margins.left - 8} y={y + 4} fontSize={10} textAnchor='end' opacity={0.5}>
                      {idx + 1}
                    </text>

                    {/* Primary row observed segment */}
                    {!r.isDuplicate && c.notify < observedEndClamped && (
                      <line x1={xNotify} y1={y} x2={xScale(observedEndClamped)} y2={y} stroke={color} strokeWidth={2} />
                    )}

                    {/* Duplicate row: left overlap dashed+faded, right solid */}
                    {r.isDuplicate && (() => {
                      const leakUntil = r.leakUntil || trainCut;
                      const leftEnd = new Date(Math.min(leakUntil.getTime(), settlementClamped.getTime()));
                      const rightStartMs = Math.max(c.notify.getTime(), leakUntil.getTime());
                      const rightStart = new Date(rightStartMs);
                      const rightEnd = settlementClamped;
                      return (
                        <>
                          {c.notify < leakUntil && c.notify < leftEnd && (
                            <line
                              x1={xNotify}
                              y1={y}
                              x2={xScale(leftEnd)}
                              y2={y}
                              stroke={color}
                              strokeWidth={2}
                              strokeDasharray={LEAK_DASH}
                              opacity={splitMode === 'notifyDup' ? 1 : LEAK_OPACITY}
                            />
                          )}
                          {rightStart.getTime() < rightEnd.getTime() && (
                            <line x1={xScale(rightStart)} y1={y} x2={xScale(rightEnd)} y2={y} stroke={color} strokeWidth={2} />
                          )}
                        </>
                      );
                    })()}

                    {/* start circle */}
                    <circle cx={xNotify} cy={y} r={5} fill='white' stroke={color} strokeWidth={2} opacity={r.isDuplicate && splitMode !== 'notifyDup' ? LEAK_OPACITY : 1} />

                    {/* link from original notification to duplicate (only in notifyDup) */}
                    {splitMode === 'notifyDup' && r.isDuplicate && typeof r.linkFrom === 'number' && (
                      <line
                        x1={xNotify}
                        y1={yScale(r.linkFrom) + 5}
                        x2={xNotify}
                        y2={y - 5}
                        stroke='#6b7280'
                        strokeDasharray='2 2'
                        markerEnd='url(#dup-arrow)'
                        opacity={0.7}
                      />
                    )}

                    {/* Primary censored continuation (no dashed tail if duplicate exists) */}
                    {!r.isDuplicate && r.isCensored && (
                      <>
                        {!r.hasDuplicate && settlementClamped.getTime() > observedEndClamped.getTime() && (
                          <line
                            x1={xScale(observedEndClamped)}
                            y1={y}
                            x2={xScale(settlementClamped)}
                            y2={y}
                            stroke={splitMode === 'notify' ? COLORS.post : color}
                            strokeWidth={2}
                            strokeDasharray='6 6'
                            opacity={FADE_OPACITY}
                          />
                        )}
                        <SquareMark x={xScale(observedEndClamped)} y={y} size={10} strokeWidth={2} color={color} />
                      </>
                    )}

                    {/* partial payments */}
                    {c.partials.map((t, j) => {
                      if (t > testCut) return null; // never show events after observation end

                      // Determine visibility window per row
                      let visibleUntil = settlementClamped;
                      if (!r.isDuplicate && r.isCensored && r.hasDuplicate) {
                        // Primary censored with duplicate: show only up to observed cutoff
                        visibleUntil = observedEndClamped;
                      }
                      if (t > visibleUntil) return null;

                      // Opacity rules
                      let op = 1;
                      if (!r.isDuplicate && r.isCensored && !r.hasDuplicate && t > observedEndClamped) op = FADE_OPACITY; // faded beyond cutoff when no duplicate
                      if (r.isDuplicate) {
                        const leakUntil = r.leakUntil || trainCut;
                        if (t < leakUntil) op = splitMode === 'notifyDup' ? 1 : LEAK_OPACITY; // leak region on duplicate rows (no fade in "Both" mode)
                      }
                      // Color rules for censored region in Notification date mode
                      let col = color;
                      if (splitMode === 'notify' && !r.isDuplicate && r.isCensored && !r.hasDuplicate && t > observedEndClamped) {
                        col = COLORS.post;
                      }
                      return <XMark key={j} x={xScale(t)} y={y} size={6} strokeWidth={2} color={col} opacity={op} />;
                    })}

                    {/* final X */}
                    {(() => {
                      if (r.dataset === 'post') return null;
                      const settlementObserved = c.settlement.getTime() <= testCut.getTime();
                      const canDraw = r.isDuplicate || (!r.isDuplicate && (!r.isCensored || (!r.hasDuplicate && settlementObserved)));
                      if (!canDraw) return null;
                      const faded = !r.isDuplicate && r.isCensored;
                      return (
                        <XMark
                          x={xScale(settlementClamped)}
                          y={y}
                          size={8}
                          strokeWidth={2}
                          color={splitMode === 'notify' && !r.isDuplicate && r.isCensored ? COLORS.post : color}
                          opacity={faded ? FADE_OPACITY : 1}
                        />
                      );
                    })()}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        <div className='mt-3 relative w-4/5'>
          {/* Absolute-centered main legend */}
          <div className='pointer-events-none absolute inset-0 flex justify-center items-center'>
            <div className='flex items-center gap-4 text-sm'>
              <span className='flex items-center gap-2'>
                <span className='inline-block w-4 h-0.5' style={{ background: COLORS.train }} />
                Train
              </span>
              <span className='flex items-center gap-2'>
                <span className='inline-block w-4 h-0.5' style={{ background: COLORS.val }} />
                Validation
              </span>
              <span className='flex items-center gap-2'>
                <span className='inline-block w-4 h-0.5' style={{ background: COLORS.test }} />
                Test
              </span>
              <span className='flex items-center gap-2 opacity-70'>
                <span className='inline-block w-4 h-0.5' style={{ background: COLORS.post }} />
                Unused
              </span>
              </div>
          </div>

          {/* Grid for left buttons and right secondary legend */}
          <div className='grid grid-cols-[auto_1fr_auto] items-center gap-3'>
            <div className='flex items-center gap-3'>
              <button onClick={() => setSidebarOpen(!sidebarOpen)} className='px-3 py-2 rounded-xl ring-1 ring-gray-300 hover:bg-gray-50'>
                {sidebarOpen ? 'Hide Controls' : 'Show Controls'}
              </button>
              <button onClick={downloadSVG} className='px-3 py-2 rounded-xl ring-1 ring-gray-300 hover:bg-gray-50'>
                Download SVG
              </button>
              <button onClick={() => setSeedText(String(Date.now()))} className='px-3 py-2 rounded-xl ring-1 ring-gray-300 hover:bg-gray-50' title='Randomise dataset'>Randomise dataset</button>
            </div>
            <div />
            <div className='flex justify-end items-center gap-4 text-sm'>
              {splitMode === 'notify' && (
                <span className='flex items-center gap-2 opacity-80'>
                  <svg width='24' height='8' className='inline-block' aria-hidden>
                    <line x1='0' y1='4' x2='24' y2='4' stroke='#6b7280' strokeWidth='2' strokeDasharray='6 6' />
                  </svg>
                  Censored region
                </span>
              )}
              {splitMode === 'notifyDup' && (
                <span className='flex items-center gap-2 opacity-80'>
                  <svg width='24' height='8' className='inline-block' aria-hidden>
                    <line x1='0' y1='4' x2='24' y2='4' stroke='#111827' strokeWidth='2' strokeDasharray='3 3' />
                  </svg>
                  Data Leakage
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div className='fixed inset-0 bg-black bg-opacity-50 z-40' onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`fixed top-0 right-0 h-full w-80 bg-white shadow-xl transform transition-transform duration-300 ease-in-out z-50 ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className='p-4 h-full overflow-y-auto'>
          <div className='flex items-center justify-between mb-4'>
            <div className='text-lg font-semibold'>Controls</div>
            <button onClick={() => setSidebarOpen(false)} className='p-2 hover:bg-gray-100 rounded-lg'>
              <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' />
              </svg>
            </button>
          </div>
          <div className='grid grid-cols-1 gap-3'>
          {/* Split strategy (moved to top) */}
          <label className='flex flex-col text-sm'>
            Start date
            <input type='date' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={startDateStr} onChange={(e) => setStartDateStr(e.target.value)} />
          </label>
          <label className='flex flex-col text-sm'>
            End date
            <input type='date' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={endDateStr} onChange={(e) => setEndDateStr(e.target.value)} />
          </label>

          <label className='flex flex-col text-sm'>
            Number of claims
            <input type='range' className='mt-2 w-full' min={1} max={200} step={1} value={numClaims} onChange={(e) => setNumClaims(Number(e.target.value))} />
            <div className='text-xs mt-1'>Current: {numClaims}</div>
          </label>

          <label className='flex flex-col text-sm'>
            Min duration (days)
            <input type='number' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={minDurDays} min={1} onChange={(e) => setMinDurDays(Math.max(1, Number(e.target.value)))} />
          </label>
          <label className='flex flex-col text-sm'>
            Max duration (days)
            <input type='number' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={maxDurDays} min={minDurDays} onChange={(e) => setMaxDurDays(Math.max(minDurDays, Number(e.target.value)))} />
          </label>

          <label className='flex flex-col text-sm'>
            Max partial payments
            <input type='number' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={maxPartials} min={0} onChange={(e) => setMaxPartials(Math.max(0, Number(e.target.value)))} />
          </label>
          <label className='flex flex-col text-sm'>
            Axis ticks
            <input type='number' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={axisTicks} min={1} onChange={(e) => setAxisTicks(Math.max(1, Number(e.target.value)))} />
          </label>

          <label className='flex flex-col text-sm'>
            Row gap (px)
            <input type='number' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={rowGap} min={10} onChange={(e) => setRowGap(Math.max(10, Number(e.target.value)))} />
          </label>
          <div className='flex flex-col text-sm'>
            <span>Canvas margins</span>
            <div className='grid grid-cols-4 gap-2 mt-1'>
              <input type='number' className='p-2 rounded-xl ring-1 ring-gray-300' value={margins.left} onChange={(e) => setMargins({ ...margins, left: Number(e.target.value) })} title='Left' />
              <input type='number' className='p-2 rounded-xl ring-1 ring-gray-300' value={margins.right} onChange={(e) => setMargins({ ...margins, right: Number(e.target.value) })} title='Right' />
              <input type='number' className='p-2 rounded-xl ring-1 ring-gray-300' value={margins.top} onChange={(e) => setMargins({ ...margins, top: Number(e.target.value) })} title='Top' />
              <input type='number' className='p-2 rounded-xl ring-1 ring-gray-300' value={margins.bottom} onChange={(e) => setMargins({ ...margins, bottom: Number(e.target.value) })} title='Bottom' />
            </div>
          </div>

          {/* Dataset cutoff dates */}
          <div className='space-y-3'>
            <label className='flex flex-col text-sm'>
              Train cutoff (date)
              <input type='date' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={toISODate(trainCut)} onChange={(e) => setTrainCutStr(e.target.value)} />
            </label>
            <label className='flex flex-col text-sm'>
              Validation cutoff (date)
              <input type='date' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={toISODate(valCut)} onChange={(e) => setValCutStr(e.target.value)} />
            </label>
            <label className='flex flex-col text-sm'>
              Test cutoff (date)
              <input type='date' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={toISODate(testCut)} onChange={(e) => setTestCutStr(e.target.value)} />
            </label>
          </div>
          <label className='flex flex-col text-sm'>
            Seed (text)
            <input type='text' className='mt-1 p-2 rounded-xl ring-1 ring-gray-300' value={seedText} onChange={(e) => setSeedText(e.target.value)} />
          </label>
        </div>

        <div className='mt-6'>
          <div className='flex items-center gap-2 mb-2'>
            <input id='useCustom' type='checkbox' checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
            <label htmlFor='useCustom' className='text-sm font-medium'>
              Use custom data (JSON)
            </label>
          </div>
          <textarea className='w-full h-40 p-3 rounded-xl ring-1 ring-gray-300 font-mono text-xs' value={customJson} onChange={(e) => setCustomJson(e.target.value)} disabled={!useCustom} />
          <div className='text-xs opacity-70 mt-2'>
            Format: [ {'{ notify: ISOstring|number, settlement: ISOstring|number, partials: (ISOstring|number)[] }'}, ... ]
            <br />
            If numbers are provided, they are interpreted as <strong>days since Start date</strong>.
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
