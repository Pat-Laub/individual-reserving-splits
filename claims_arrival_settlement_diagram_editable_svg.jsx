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

// Generate random quarterly inflation rates based on quarter key
function getQuarterlyInflationRate(quarterKey, seed = 1) {
  // Create a hash from the quarter key for consistent random inflation rates
  let hash = 0;
  const str = quarterKey + seed.toString();
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Use multiple hash values to create more variation
  const hash2 = Math.abs(hash) * 17 + quarterKey.charCodeAt(quarterKey.length - 1) * 137;
  const hash3 = Math.abs(hash2) * 31 + quarterKey.charCodeAt(0) * 73;

  // Use hash to generate inflation rate between -2% and +6% per quarter
  const normalized = (Math.abs(hash3) % 10000) / 10000; // Better normalization
  const inflationRate = (normalized * 0.08) - 0.02; // Scale to -2% to +6%

  return inflationRate;
}

// Inflation adjustment function using random quarterly rates
function adjustForInflation(nominalAmount, paymentDate, observationEndDate, seed = 1) {
  if (!observationEndDate || !paymentDate) return nominalAmount;

  const paymentQuarter = getQuarterInfo(paymentDate, paymentDate);
  const observationQuarter = getQuarterInfo(observationEndDate, paymentDate);

  // If payment is after observation end, no adjustment needed
  if (paymentDate >= observationEndDate) return nominalAmount;

  // Calculate quarters between payment and observation end
  let currentDate = new Date(paymentDate);
  let adjustedAmount = nominalAmount;

  while (currentDate < observationEndDate) {
    const currentQuarter = getQuarterInfo(currentDate, currentDate); // Use currentDate as reference for calendar quarter
    const calendarQuarterKey = `${currentQuarter.calendarYear}Q${currentQuarter.calendarQuarter}`;
    const inflationRate = getQuarterlyInflationRate(calendarQuarterKey, seed);
    adjustedAmount *= (1 + inflationRate);

    // Move to next quarter
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 3, currentDate.getDate());
  }

  return adjustedAmount;
}

// Calculate adjustment factor from source quarter to target quarter
function calculateAdjustmentFactor(sourceQuarter, targetQuarter, seed = 1) {
  if (sourceQuarter === targetQuarter) return 1.0;

  // Parse quarters (e.g., "2022Q3" -> {year: 2022, quarter: 3})
  const parseQuarter = (quarterStr) => {
    const match = quarterStr.match(/(\d{4})Q(\d)/);
    return { year: parseInt(match[1]), quarter: parseInt(match[2]) };
  };

  const source = parseQuarter(sourceQuarter);
  const target = parseQuarter(targetQuarter);

  // Create date from quarter
  const quarterToDate = (q) => new Date(q.year, (q.quarter - 1) * 3, 15); // Mid-month of first month in quarter

  const sourceDate = quarterToDate(source);
  const targetDate = quarterToDate(target);

  // Use the existing inflation adjustment function
  return adjustForInflation(1.0, sourceDate, targetDate, seed);
}

// Format currency with 2 decimal places
function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) {
    return "-";
  }
  return `$${Number(amount).toFixed(2)}`;
}

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

// Quarterly aggregation helpers
function getQuarterInfo(date, referenceDate) {
  // Validate inputs
  if (!date || !referenceDate || isNaN(date.getTime()) || isNaN(referenceDate.getTime())) {
    return {
      calendarYear: 2020,
      calendarQuarter: 1,
      developmentQuarter: 0,
      quarterKey: '2020Q1'
    };
  }

  const refYear = referenceDate.getUTCFullYear();
  const refQuarter = Math.floor(referenceDate.getUTCMonth() / 3);

  const dateYear = date.getUTCFullYear();
  const dateQuarter = Math.floor(date.getUTCMonth() / 3);

  const quartersSinceRef = (dateYear - refYear) * 4 + (dateQuarter - refQuarter);

  // Clamp to reasonable range
  const clampedQuarters = Math.max(-50, Math.min(50, quartersSinceRef));

  return {
    calendarYear: dateYear,
    calendarQuarter: dateQuarter + 1,
    developmentQuarter: clampedQuarters, // 0-based by default
    quarterKey: `${dateYear}Q${dateQuarter + 1}`
  };
}

function aggregateClaimToQuarters(claim, oneBasedDevQuarters = false, observationEndDate = null) {
  // Validate claim object
  if (!claim || !claim.accident || !claim.notify || !claim.settlement || !claim.staticCovariates || !claim.payments) {
    return {
      claimInfo: {
        claimId: 'INVALID',
        Legal_Representation: 'N',
        Injury_Severity: '1',
        Age_of_Claimant: 'Unknown',
        accidentDate: new Date(),
        notifyDate: new Date(),
        settlementDate: new Date(),
        accidentQuarter: '2020Q1',
        notifyQuarter: '2020Q1',
        notifyLag: 0
      },
      quarters: []
    };
  }

  const accidentQuarter = getQuarterInfo(claim.accident, claim.accident);
  const notifyQuarter = getQuarterInfo(claim.notify, claim.accident);
  const settlementQuarter = getQuarterInfo(claim.settlement, claim.accident);

  // Group payments by quarter
  const quarterlyPayments = new Map();

  for (const payment of claim.payments) {
    const paymentQuarter = getQuarterInfo(payment.date, claim.accident);
    const key = paymentQuarter.quarterKey;

    if (!quarterlyPayments.has(key)) {
      quarterlyPayments.set(key, {
        ...paymentQuarter,
        totalAmount: 0,
        paymentCount: 0,
        payments: []
      });
    }

    const quarterData = quarterlyPayments.get(key);
    quarterData.totalAmount += payment.amount;
    quarterData.paymentCount += 1;
    quarterData.payments.push(payment);
  }

  // Create complete sequence from accident to settlement
  const startDevQuarter = accidentQuarter.developmentQuarter;
  const endDevQuarter = settlementQuarter.developmentQuarter;
  const quarters = [];

  // Validate development quarter range
  if (endDevQuarter < startDevQuarter || endDevQuarter - startDevQuarter > 100) {
    // Invalid range, return minimal data
    return {
      claimInfo: {
        claimId: claim.staticCovariates.claimId,
        ...claim.staticCovariates,
        accidentDate: claim.accident,
        notifyDate: claim.notify,
        settlementDate: claim.settlement,
        accidentQuarter: accidentQuarter.quarterKey,
        notifyQuarter: notifyQuarter.quarterKey,
        notifyLag: notifyQuarter.developmentQuarter - accidentQuarter.developmentQuarter
      },
      quarters: []
    };
  }

  for (let devQ = startDevQuarter; devQ <= endDevQuarter; devQ++) {
    // Find existing quarter data or create empty one
    const existingQuarter = Array.from(quarterlyPayments.values())
      .find(q => q.developmentQuarter === devQ);

    if (existingQuarter) {
      // Apply inflation adjustment to quarterly aggregated amounts if observationEndDate is provided
      if (observationEndDate) {
        // Use the middle of the quarter as the representative date for inflation adjustment
        const quarterStart = new Date(existingQuarter.year, (existingQuarter.quarter - 1) * 3, 1);
        const quarterMiddle = new Date(quarterStart.getTime() + (90 * 24 * 60 * 60 * 1000) / 2); // ~45 days

        const nominalAmount = existingQuarter.totalAmount;
        const adjustedAmount = adjustForInflation(nominalAmount, quarterMiddle, observationEndDate, 1);

        // Ensure we don't get NaN values
        const safeAdjustedAmount = isNaN(adjustedAmount) ? nominalAmount : adjustedAmount;

        // Create adjusted quarter data
        const adjustedQuarter = {
          ...existingQuarter,
          nominalAmount: nominalAmount,
          totalAmount: safeAdjustedAmount,
          inflationAdjusted: true,
          // Also adjust individual payment amounts for display purposes
          payments: existingQuarter.payments.map(payment => {
            const adjustedPaymentAmount = adjustForInflation(payment.amount, payment.date, observationEndDate, 1);
            const safeAdjustedPaymentAmount = isNaN(adjustedPaymentAmount) ? payment.amount : adjustedPaymentAmount;
            return {
              ...payment,
              nominalAmount: payment.amount,
              amount: safeAdjustedPaymentAmount,
              inflationAdjusted: true
            };
          })
        };
        quarters.push(adjustedQuarter);
      } else {
        // No inflation adjustment - add nominalAmount property for consistency
        const quarterWithNominal = {
          ...existingQuarter,
          nominalAmount: existingQuarter.totalAmount,
          inflationAdjusted: false
        };
        quarters.push(quarterWithNominal);
      }
    } else {
      // Create empty quarter - need to determine calendar quarter
      const quarterDate = new Date(claim.accident);
      quarterDate.setMonth(quarterDate.getMonth() + (devQ * 3));
      const emptyQuarterInfo = getQuarterInfo(quarterDate, claim.accident);

      quarters.push({
        ...emptyQuarterInfo,
        developmentQuarter: devQ,
        totalAmount: 0,
        nominalAmount: 0,
        paymentCount: 0,
        payments: [],
        inflationAdjusted: !!observationEndDate
      });
    }
  }

  // Adjust development quarters if one-based is selected
  if (oneBasedDevQuarters) {
    quarters.forEach(q => {
      q.developmentQuarter = q.developmentQuarter + 1;
    });
  }

  return {
    claimInfo: {
      claimId: claim.staticCovariates.claimId,
      ...claim.staticCovariates,
      accidentDate: claim.accident,
      notifyDate: claim.notify,
      settlementDate: claim.settlement,
      accidentQuarter: accidentQuarter.quarterKey,
      notifyQuarter: notifyQuarter.quarterKey,
      notifyLag: notifyQuarter.developmentQuarter - accidentQuarter.developmentQuarter
    },
    quarters
  };
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
  observationEndDate, // Add parameter for inflation adjustment
}) {
  const rand = mulberry32(seed);
  const claims = [];
  const totalDays = Math.max(1, daysBetween(startDate, endDate));
  const latestNotify = Math.max(0, totalDays - minDurDays);
  // Static covariate options
  const postcodes = ['2000', '3000', '4000', '5000', '6000', '7000', '1000'];
  const claimTypes = ['Motor', 'Property', 'Liability', 'Workers Comp'];
  const regions = ['Metro', 'Regional', 'Remote'];

  for (let i = 0; i < n; i++) {
    // Generate accident date (7-60 days before notification)
    const accidentOffset = 7 + Math.floor(rand() * 54);
    const notify = addDays(startDate, Math.floor(rand() * latestNotify));
    const accident = addDays(notify, -accidentOffset);

    const dur = minDurDays + Math.floor(rand() * Math.max(1, maxDurDays - minDurDays + 1));
    const rawSettlement = addDays(notify, dur);
    const settlement = rawSettlement > endDate ? endDate : rawSettlement;

    // Generate payments (using original logic)
    let k = Math.floor(rand() * (maxPartials + 1));
    if (daysBetween(notify, settlement) < 2) k = 0;
    let payments = [];
    for (let j = 0; j < k; j++) {
      const spanDays = Math.max(1, daysBetween(notify, settlement));
      const t = addDays(notify, Math.floor(rand() * spanDays));
      const amount = 1 + Math.floor(rand() * 9); // Random nominal amount 1-9

      payments.push({
        date: t,
        amount: amount // Store nominal amount initially
      });
    }

    // Filter, sort, and dedupe payments
    payments = payments
      .filter((p) => p.date > notify && p.date <= settlement)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (dedupeMonthly) {
      const seen = new Set();
      const deduped = [];
      for (const p of payments) {
        const key = monthKeyUTC(p.date);
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(p);
        } else {
          // If same month, add amounts together
          const existing = deduped.find(d => monthKeyUTC(d.date) === key);
          if (existing) {
            existing.amount += p.amount;
          }
        }
      }
      payments = deduped;
    }

    // Legacy partials for backward compatibility
    const partials = payments.map(p => p.date);

    // Static covariates
    const staticCovariates = {
      postcode: postcodes[Math.floor(rand() * postcodes.length)],
      claimType: claimTypes[Math.floor(rand() * claimTypes.length)],
      region: regions[Math.floor(rand() * regions.length)],
      claimId: `CLM-${String(i + 1).padStart(4, '0')}`
    };

    claims.push({
      accident,
      notify,
      settlement,
      partials, // for backward compatibility
      payments, // new enhanced payment data
      staticCovariates
    });
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
  const [minDurDays, setMinDurDays] = useState(180);
  const [maxDurDays, setMaxDurDays] = useState(1095);
  const [maxPartials, setMaxPartials] = useState(20);
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
  const [selectedClaimIndex, setSelectedClaimIndex] = useState(0);
  const [oneBasedDevQuarters, setOneBasedDevQuarters] = useState(false);

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
  const [splitMode, setSplitMode] = useState('settlement');

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
        observationEndDate: endDate, // Use endDate as the observation end for inflation adjustment
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
    return margins.top + 10 + i * rowGap; // Add 10px buffer after cutoff labels
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

  // Selected claim quarterly data
  const selectedClaim = selectedClaimIndex !== null ? claims[selectedClaimIndex] : null;
  const quarterlyData = selectedClaim ? aggregateClaimToQuarters(selectedClaim, oneBasedDevQuarters, endDate) : null;
  const [showPaymentDetails, setShowPaymentDetails] = useState(true);
  const [showQuarterlyAggregation, setShowQuarterlyAggregation] = useState(true);

  // Quarterly visualization component
  function QuarterlyPreprocessingView({ claimData }) {
    if (!claimData) {
      return (
        <div className="text-center py-8 text-gray-500">
          Select a claim above to see its quarterly preprocessing
        </div>
      );
    }

    try {
      const { claimInfo, quarters } = claimData;

      // Check if inflation adjustment was applied
      const hasInflationAdjustment = quarters && quarters.length > 0 &&
        quarters.some(q => q.inflationAdjusted);

      // Validate data
      if (!claimInfo || !quarters || !Array.isArray(quarters)) {
        return (
          <div className="text-center py-8 text-gray-500">
            Error loading claim data. Please select a different claim.
          </div>
        );
      }
    const maxNominalAmount = Math.max(...quarters.map(q => isNaN(q.nominalAmount) ? 0 : q.nominalAmount), 1);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Quarterly Preprocessing: {claimInfo.claimId}</div>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={oneBasedDevQuarters}
              onChange={(e) => setOneBasedDevQuarters(e.target.checked)}
            />
            <span>1-based dev quarters</span>
          </label>
        </div>

        {/* Preprocessing Steps Overview */}
        <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <div className="text-sm font-medium text-blue-900 mb-2">Key Preprocessing Steps:</div>
          <div className="space-y-1 text-sm text-blue-800">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <span><strong>Step 1:</strong> Quarterly Aggregation - Convert continuous timeline to quarterly periods</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <span><strong>Step 2:</strong> Inflation Adjustment - {hasInflationAdjustment ? 'Adjust to today\'s dollars' : 'Not applied'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              <span><strong>Step 3:</strong> Feature Engineering - Calculate cumulative metrics and development quarters</span>
            </div>
          </div>
        </div>

        {/* Static covariates */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-2">Static Covariates</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div><strong>Type:</strong> {claimInfo.claimType}</div>
            <div><strong>Region:</strong> {claimInfo.region}</div>
            <div><strong>Postcode:</strong> {claimInfo.postcode}</div>
            <div><strong>Notify Lag:</strong> {claimInfo.notifyLag} quarters</div>
          </div>
        </div>

        {/* Timeline with accident date */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-3">Continuous Timeline</div>
          <div className="relative">
            <svg width="100%" height="100" viewBox="0 0 800 100">
              {(() => {
                // Calculate timeline bounds
                const timelineStart = claimInfo.accidentDate;
                const timelineEnd = claimInfo.settlementDate;
                const timelineSpan = timelineEnd.getTime() - timelineStart.getTime();

                // SVG dimensions
                const svgLeft = 40;
                const svgRight = 760;
                const svgWidth = svgRight - svgLeft;
                const timelineY = 40;

                // Scale function
                const timeScale = (date) => {
                  const t = date.getTime();
                  return svgLeft + ((t - timelineStart.getTime()) / timelineSpan) * svgWidth;
                };

                // Generate quarter boundaries
                const quarterBoundaries = [];
                let currentDate = new Date(timelineStart.getUTCFullYear(), 0, 1); // Start of year
                while (currentDate <= timelineEnd) {
                  if (currentDate >= timelineStart) {
                    quarterBoundaries.push(new Date(currentDate));
                  }
                  // Move to next quarter start
                  const month = currentDate.getMonth();
                  const nextQuarterMonth = Math.floor(month / 3) * 3 + 3;
                  if (nextQuarterMonth >= 12) {
                    currentDate = new Date(currentDate.getFullYear() + 1, 0, 1);
                  } else {
                    currentDate = new Date(currentDate.getFullYear(), nextQuarterMonth, 1);
                  }
                }
                // Add final boundary if needed
                const finalBoundary = new Date(timelineEnd.getUTCFullYear() + 1, 0, 1);
                if (quarterBoundaries.length === 0 || quarterBoundaries[quarterBoundaries.length - 1] < timelineEnd) {
                  quarterBoundaries.push(finalBoundary);
                }

                return (
                  <>
                    {/* Timeline base */}
                    <line x1={svgLeft} y1={timelineY} x2={svgRight} y2={timelineY} stroke="#64748b" strokeWidth="2" />

                    {/* Quarter boundaries and labels */}
                    {quarterBoundaries.map((boundary, i) => {
                      if (i === 0) return null; // Skip first boundary

                      const prevBoundary = quarterBoundaries[i - 1];
                      const x1 = timeScale(prevBoundary);
                      const x2 = timeScale(boundary);
                      const midX = (x1 + x2) / 2;

                      // Quarter info
                      const quarter = Math.floor(prevBoundary.getMonth() / 3) + 1;
                      const year = prevBoundary.getFullYear();

                      return (
                        <g key={i}>
                          {/* Quarter boundary ticks */}
                          <line x1={x1} y1={timelineY - 8} x2={x1} y2={timelineY + 8} stroke="#9ca3af" strokeWidth="1" />
                          {boundary <= timelineEnd && (
                            <line x1={x2} y1={timelineY - 8} x2={x2} y2={timelineY + 8} stroke="#9ca3af" strokeWidth="1" />
                          )}

                          {/* Quarter label */}
                          <text x={midX} y={timelineY - 12} fontSize="9" textAnchor="middle" fill="#6b7280">
                            {year}Q{quarter}
                          </text>
                        </g>
                      );
                    })}

                    {/* Accident date */}
                    <circle cx={timeScale(claimInfo.accidentDate)} cy={timelineY} r="6" fill="#ef4444" stroke="white" strokeWidth="2" />
                    <text x={timeScale(claimInfo.accidentDate)} y={timelineY + 20} fontSize="10" textAnchor="middle" fill="#374151">Accident</text>

                    {/* Notification */}
                    <circle cx={timeScale(claimInfo.notifyDate)} cy={timelineY} r="5" fill="white" stroke="#3b82f6" strokeWidth="2" />
                    <text x={timeScale(claimInfo.notifyDate)} y={timelineY + 20} fontSize="10" textAnchor="middle" fill="#374151">Notify</text>

                    {/* Payments */}
                    {selectedClaim.payments.map((payment, i) => {
                      const x = timeScale(payment.date);
                      return (
                        <g key={i}>
                          <g transform={`translate(${x}, ${timelineY})`}>
                            <line x1="-3" y1="-3" x2="3" y2="3" stroke="#10b981" strokeWidth="2" />
                            <line x1="-3" y1="3" x2="3" y2="-3" stroke="#10b981" strokeWidth="2" />
                          </g>
                          <text x={x} y={timelineY + 20} fontSize="9" textAnchor="middle" fill="#374151">{formatCurrency(payment.nominalAmount || payment.amount)}</text>
                        </g>
                      );
                    })}

                    {/* Settlement */}
                    <g transform={`translate(${timeScale(claimInfo.settlementDate)}, ${timelineY})`}>
                      <line x1="-4" y1="-4" x2="4" y2="4" stroke="#dc2626" strokeWidth="3" />
                      <line x1="-4" y1="4" x2="4" y2="-4" stroke="#dc2626" strokeWidth="3" />
                    </g>
                    <text x={timeScale(claimInfo.settlementDate)} y={timelineY + 20} fontSize="10" textAnchor="middle" fill="#374151">Settlement</text>
                  </>
                );
              })()}
            </svg>
          </div>
        </div>

        {/* Payment Details (Expandable) */}
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">Payment Details</div>
            <button
              onClick={() => setShowPaymentDetails(!showPaymentDetails)}
              className="text-xs px-3 py-1 bg-blue-200 hover:bg-blue-300 rounded-full transition-colors"
            >
              {showPaymentDetails ? 'Hide' : 'Show'} Details
            </button>
          </div>

          {showPaymentDetails && (
            <div className="bg-white rounded border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Event</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-center font-medium">Calendar Quarter</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-center font-medium">Dev Quarter</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Create combined list of all events
                    const events = [
                      {
                        type: 'accident',
                        date: claimInfo.accidentDate,
                        label: 'Accident',
                        amount: null
                      },
                      {
                        type: 'notification',
                        date: claimInfo.notifyDate,
                        label: 'Notification',
                        amount: null
                      },
                      ...selectedClaim.payments.map((payment, i) => ({
                        type: 'payment',
                        date: payment.date,
                        label: `#${i + 1}`,
                        amount: payment.nominalAmount || payment.amount, // Use nominal amount for display in early sections
                        nominalAmount: payment.nominalAmount || payment.amount,
                        inflationAdjusted: payment.inflationAdjusted
                      })),
                      {
                        type: 'settlement',
                        date: claimInfo.settlementDate,
                        label: 'Settlement',
                        amount: null
                      }
                    ];

                    // Sort by date
                    events.sort((a, b) => a.date.getTime() - b.date.getTime());

                    return events.map((event, i) => {
                      const eventQuarter = getQuarterInfo(event.date, claimInfo.accidentDate);
                      const adjustedDevQuarter = eventQuarter.developmentQuarter + (oneBasedDevQuarters ? 1 : 0);
                      const isEvent = event.type !== 'payment';

                      return (
                        <tr key={i} className={`border-t border-gray-100 ${isEvent ? 'bg-gray-50' : ''}`}>
                          <td className={`px-3 py-2 ${isEvent ? 'font-medium text-gray-700' : 'text-gray-600'}`}>
                            {event.label}
                          </td>
                          <td className="px-3 py-2">{toISODate(event.date)}</td>
                          <td className="px-3 py-2 text-center font-mono">{eventQuarter.quarterKey}</td>
                          <td className="px-3 py-2 text-right font-medium">
                            {event.amount !== null ? (
                              <div>
                                <div>{formatCurrency(event.amount)}</div>
                                {event.nominalAmount && event.inflationAdjusted && (
                                  <div className="text-xs text-gray-500">
                                    (nominal: {formatCurrency(event.nominalAmount)})
                                  </div>
                                )}
                              </div>
                            ) : ''}
                          </td>
                          <td className="px-3 py-2 text-center font-mono">Q{adjustedDevQuarter}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quarterly aggregation */}
        <div className="bg-yellow-50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">Quarterly Aggregation</div>
            <button
              onClick={() => setShowQuarterlyAggregation(!showQuarterlyAggregation)}
              className="text-xs px-3 py-1 bg-yellow-200 hover:bg-yellow-300 rounded-full transition-colors"
            >
              {showQuarterlyAggregation ? 'Hide' : 'Show'} Aggregation
            </button>
          </div>

          {showQuarterlyAggregation && (
          <div className="grid grid-cols-2 gap-6">
            {/* Left half - Visual bars */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-600 mb-2">Payment Composition</div>
              {quarters.map((quarter, i) => (
                <div key={i} className="flex items-center gap-4 p-2 bg-white rounded border">
                  <div className="w-16 text-sm font-mono">
                    Dev Q{quarter.developmentQuarter}
                  </div>
                  <div className="w-20 text-sm">
                    {quarter.quarterKey}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 rounded overflow-hidden relative" style={{ width: `${(quarter.nominalAmount / maxNominalAmount) * 100}%`, minWidth: '60px' }}>
                        {quarter.payments.map((payment, paymentIdx) => {
                          const colors = ['#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#451a03'];
                          const color = colors[paymentIdx % colors.length];
                          const paymentNominalAmount = payment.nominalAmount || payment.amount;
                          const paymentWidth = (paymentNominalAmount / quarter.nominalAmount) * 100;
                          return (
                            <div
                              key={paymentIdx}
                              className="h-full flex items-center justify-center relative"
                              style={{
                                backgroundColor: color,
                                width: `${paymentWidth}%`,
                                minWidth: '2px'
                              }}
                              title={`Payment ${paymentIdx + 1}: ${formatCurrency(paymentNominalAmount)} on ${toISODate(payment.date)}`}
                            >
                              {paymentWidth > 8 && (
                                <span className="text-xs font-medium text-white drop-shadow-sm">
                                  {formatCurrency(paymentNominalAmount)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Right half - Summary table */}
            <div>
              <div className="text-xs font-medium text-gray-600 mb-2">Quarterly Summary</div>
              <div className="bg-white rounded border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Quarter</th>
                      <th className="px-3 py-2 text-right font-medium">Sum</th>
                      <th className="px-3 py-2 text-right font-medium">Count</th>
                      <th className="px-3 py-2 text-right font-medium">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarters.map((quarter, i) => {
                      const payments = quarter.payments;
                      const nominalAmounts = payments.map(p => p.nominalAmount || p.amount);
                      const avg = nominalAmounts.length > 0 ? (nominalAmounts.reduce((a, b) => a + b, 0) / nominalAmounts.length) : null;

                      return (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-mono">Dev Q{quarter.developmentQuarter}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(quarter.nominalAmount)}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{quarter.paymentCount}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{avg !== null ? formatCurrency(avg) : '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Inflation Adjustment */}
        {hasInflationAdjustment && (
          <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
            <div className="text-sm font-medium mb-3 text-orange-900">Inflation Adjustment</div>

            {/* Inflation Rates Lookup Table */}
            <div className="mb-4">
              <div className="text-xs font-medium text-orange-800 mb-2">Quarterly Inflation Rates</div>
              <div className="bg-white rounded border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Calendar Quarter</th>
                      <th className="px-2 py-1 text-left font-medium">Target Quarter</th>
                      <th className="px-2 py-1 text-right font-medium">Quarter's Inflation Rate</th>
                      <th className="px-2 py-1 text-right font-medium">Adjustment Factor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      // Get all unique calendar quarters from the data and sort them
                      const calendarQuarters = new Set();
                      const observationQuarter = getQuarterInfo(endDate, endDate);
                      const targetQuarter = `${observationQuarter.calendarYear}Q${observationQuarter.calendarQuarter}`;

                      quarters.forEach(quarter => {
                        if (quarter.paymentCount > 0) {
                          const calendarQuarterKey = `${quarter.year || quarter.calendarYear}Q${quarter.quarter || quarter.calendarQuarter}`;
                          calendarQuarters.add(calendarQuarterKey);
                        }
                      });

                      return Array.from(calendarQuarters).sort().map((calendarQuarter, i) => {
                        const quarterInflationRate = getQuarterlyInflationRate(calendarQuarter, 1);
                        const inflationRatePercent = (quarterInflationRate * 100).toFixed(1);
                        const sign = quarterInflationRate >= 0 ? '+' : '';

                        // Calculate adjustment factor from this quarter to target quarter
                        const adjustmentFactor = calculateAdjustmentFactor(calendarQuarter, targetQuarter);

                        return (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-2 py-1 font-mono text-xs">{calendarQuarter}</td>
                            <td className="px-2 py-1 font-mono text-xs">{targetQuarter}</td>
                            <td className="px-2 py-1 text-right text-xs">{sign}{inflationRatePercent}%</td>
                            <td className="px-2 py-1 text-right text-xs font-mono">{adjustmentFactor.toFixed(4)}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment Adjustments Table */}
            <div className="text-xs font-medium text-orange-800 mb-2">Payment Adjustments</div>
            <div className="bg-white rounded border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Dev Quarter</th>
                    <th className="px-3 py-2 text-left font-medium">Calendar Quarter</th>
                    <th className="px-3 py-2 text-right font-medium">Nominal Amount</th>
                    <th className="px-3 py-2 text-right font-medium">Adjustment Factor</th>
                    <th className="px-3 py-2 text-right font-medium">Adjusted Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {quarters.map((quarter, i) => {
                    if (quarter.paymentCount === 0) return null; // Skip empty quarters

                    // Create the calendar quarter key based on the actual quarter year and quarter
                    const calendarQuarterKey = `${quarter.year || quarter.calendarYear}Q${quarter.quarter || quarter.calendarQuarter}`;

                    // Get target quarter (observation end date)
                    const observationQuarter = getQuarterInfo(endDate, endDate);
                    const targetQuarter = `${observationQuarter.calendarYear}Q${observationQuarter.calendarQuarter}`;

                    // Calculate adjustment factor from this calendar quarter to target quarter
                    const adjustmentFactor = calculateAdjustmentFactor(calendarQuarterKey, targetQuarter);

                    // Calculate the correctly adjusted amount: nominal * adjustment factor
                    const correctlyAdjustedAmount = quarter.nominalAmount * adjustmentFactor;

                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono">Dev Q{quarter.developmentQuarter}</td>
                        <td className="px-3 py-2 font-mono">{calendarQuarterKey}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(quarter.nominalAmount)}</td>
                        <td className="px-3 py-2 text-right text-gray-600 font-mono">{adjustmentFactor.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right font-medium text-orange-700">{formatCurrency(correctlyAdjustedAmount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Cumulative View */}
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-3">Cumulative View</div>
          <div className="bg-white rounded border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Quarter</th>
                  <th className="px-3 py-2 text-right font-medium">Cumulative Total Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Payment Count</th>
                  <th className="px-3 py-2 text-right font-medium">Avg Payment</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let cumulativeSum = 0;
                  let cumulativeCount = 0;
                  let allPayments = [];

                  // Get target quarter for adjustment factor calculation
                  const observationQuarter = getQuarterInfo(endDate, endDate);
                  const targetQuarter = `${observationQuarter.calendarYear}Q${observationQuarter.calendarQuarter}`;

                  return quarters.map((quarter, i) => {
                    // Calculate inflation-adjusted amount for this quarter
                    const calendarQuarterKey = `${quarter.year || quarter.calendarYear}Q${quarter.quarter || quarter.calendarQuarter}`;
                    const adjustmentFactor = calculateAdjustmentFactor(calendarQuarterKey, targetQuarter);
                    const inflationAdjustedAmount = quarter.nominalAmount * adjustmentFactor;

                    cumulativeSum += inflationAdjustedAmount;
                    cumulativeCount += quarter.paymentCount;

                    // Add current quarter's individual payments to running list (using adjusted amounts)
                    allPayments = allPayments.concat(quarter.payments.map(p => {
                      const paymentAdjustmentFactor = calculateAdjustmentFactor(calendarQuarterKey, targetQuarter);
                      return (p.nominalAmount || p.amount) * paymentAdjustmentFactor;
                    }));

                    const avgPayment = allPayments.length > 0 ? (cumulativeSum / allPayments.length) : 0;

                    return (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono">Dev Q{quarter.developmentQuarter}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(cumulativeSum)}</td>
                        <td className="px-3 py-2 text-right font-medium">{cumulativeCount}</td>
                        <td className="px-3 py-2 text-right font-medium">{avgPayment > 0 ? formatCurrency(avgPayment) : '-'}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-600 mt-2">
            <strong>Code variables:</strong> Cumulative Total Paid = <code>total_payment_size</code>, Avg Payment = <code>average_payment_size</code>
          </div>
        </div>

        {/* Outstanding Liability View */}
        <div className="bg-red-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-3">Outstanding Claim Liability View</div>
          {(() => {
            // Calculate ultimate claim size as total of all payments over claim lifetime
            // Use inflation-adjusted amounts for ultimate calculation
            const observationQuarter = getQuarterInfo(endDate, endDate);
            const targetQuarter = `${observationQuarter.calendarYear}Q${observationQuarter.calendarQuarter}`;

            const ultimateClaimSize = quarters.reduce((total, quarter) => {
              const calendarQuarterKey = `${quarter.year || quarter.calendarYear}Q${quarter.quarter || quarter.calendarQuarter}`;
              const adjustmentFactor = calculateAdjustmentFactor(calendarQuarterKey, targetQuarter);
              const inflationAdjustedAmount = quarter.nominalAmount * adjustmentFactor;
              return total + inflationAdjustedAmount;
            }, 0);

            return (
              <>
                <div className="text-sm mb-3">
                  <strong>Ultimate = Total Payments Over Claim Lifetime = {formatCurrency(ultimateClaimSize)}</strong>
                </div>
                <div className="bg-white rounded border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Quarter</th>
                        <th className="px-3 py-2 text-right font-medium">Total Paid</th>
                        <th className="px-3 py-2 text-right font-medium">Outstanding Liability</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let cumulativeSum = 0;

                        return quarters.map((quarter, i) => {
                          // Calculate inflation-adjusted amount for this quarter
                          const calendarQuarterKey = `${quarter.year || quarter.calendarYear}Q${quarter.quarter || quarter.calendarQuarter}`;
                          const adjustmentFactor = calculateAdjustmentFactor(calendarQuarterKey, targetQuarter);
                          const inflationAdjustedAmount = quarter.nominalAmount * adjustmentFactor;

                          cumulativeSum += inflationAdjustedAmount;
                          const outstandingLiability = Math.max(0, ultimateClaimSize - cumulativeSum);

                          return (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-3 py-2 font-mono">Dev Q{quarter.developmentQuarter}</td>
                              <td className="px-3 py-2 text-right font-medium">{formatCurrency(cumulativeSum)}</td>
                              <td className="px-3 py-2 text-right font-medium">{formatCurrency(outstandingLiability)}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
          <div className="text-xs text-gray-600 mt-2">
            <strong>Target variable:</strong> Outstanding Liability = <code>ultimate_claim_size - cumulative_payments_to_date</code>
          </div>
        </div>

        {/* Development Period Calculation */}
        {/*
        <div className="bg-purple-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-3">Development Period Calculation</div>
          <div className="space-y-3">

            {/* Key Dates */}
            {/*
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">Key Date Calculations</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div>
                  <strong>Accident Quarter:</strong><br/>
                  <code className="text-xs bg-gray-100 px-1 rounded">getQuarter(accident_date)</code><br/>
                  <span className="text-gray-600">= Q{getQuarterInfo(claimInfo.accidentDate, claimInfo.accidentDate).developmentQuarter}</span>
                </div>
                <div>
                  <strong>Notification Quarter:</strong><br/>
                  <code className="text-xs bg-gray-100 px-1 rounded">getQuarter(notification_date)</code><br/>
                  <span className="text-gray-600">= Q{getQuarterInfo(claimInfo.notifyDate, claimInfo.accidentDate).developmentQuarter}</span>
                </div>
                <div>
                  <strong>Settlement Quarter:</strong><br/>
                  <code className="text-xs bg-gray-100 px-1 rounded">getQuarter(settlement_date)</code><br/>
                  <span className="text-gray-600">= Q{getQuarterInfo(claimInfo.settlementDate, claimInfo.accidentDate).developmentQuarter}</span>
                </div>
              </div>
            </div>

            {/* Development Period Formula */}
            {/*
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">Development Period Formula</div>
              <div className="text-sm">
                <code className="bg-gray-100 px-2 py-1 rounded text-xs">
                  {oneBasedDevQuarters ?
                    'development_period = event_quarter - accident_quarter + 1' :
                    'development_period = event_quarter - accident_quarter'
                  }
                </code>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                This formula converts quarters into development periods relative to the accident quarter.
                {oneBasedDevQuarters && <><br/>The "+1" ensures development periods start from 1 (one-based numbering).</>}
              </div>
            </div>

            {/* Range Calculation */}
            {/*
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">Development Period Range for This Claim</div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <strong>Min Development Period:</strong><br/>
                  <code className="text-xs bg-gray-100 px-1 rounded">notification_quarter - accident_quarter{oneBasedDevQuarters ? ' + 1' : ''}</code><br/>
                  <span className="text-gray-600">= {oneBasedDevQuarters ?
                    (getQuarterInfo(claimInfo.notifyDate, claimInfo.accidentDate).developmentQuarter + 1) :
                    (getQuarterInfo(claimInfo.notifyDate, claimInfo.accidentDate).developmentQuarter)
                  }</span>
                </div>
                <div>
                  <strong>Max Development Period:</strong><br/>
                  <code className="text-xs bg-gray-100 px-1 rounded">settlement_quarter - accident_quarter{oneBasedDevQuarters ? ' + 1' : ''}</code><br/>
                  <span className="text-gray-600">= {oneBasedDevQuarters ?
                    (getQuarterInfo(claimInfo.settlementDate, claimInfo.accidentDate).developmentQuarter + 1) :
                    (getQuarterInfo(claimInfo.settlementDate, claimInfo.accidentDate).developmentQuarter)
                  }</span>
                </div>
              </div>
            </div>

          </div>
        </div>
        */}

        {/* Data Structure Transformation */}
        <div className="bg-orange-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-3">WIP: Data Structure Transformation</div>
          <div className="space-y-3">

            {/* Concept Explanation */}
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">From Transactions to Development Triangle</div>
              <div className="text-sm text-gray-700">
                We transform individual claim histories into many training observations in a development triangle format.
                We create one row per claim per development period, containing cumulative information up to that point.
              </div>
            </div>

            {/* Row Generation Logic */}
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">
                One Row Per Claim Per Development Period
              </div>

              {(() => {
                // Convert timestamp dates to quarters for calculation
                const accidentQuarter = isFinite(claimInfo.accidentDate) ? getQuarterInfo(claimInfo.accidentDate, claimInfo.accidentDate).developmentQuarter : 0;
                const notifyQuarter = isFinite(claimInfo.notifyDate) ? getQuarterInfo(claimInfo.notifyDate, claimInfo.accidentDate).developmentQuarter : 0;
                const settlementQuarter = isFinite(claimInfo.settlementDate) ? getQuarterInfo(claimInfo.settlementDate, claimInfo.accidentDate).developmentQuarter : 0;

                const numRows = Math.max(0, Math.min(20, settlementQuarter - notifyQuarter + 1));
                const validNumRows = isFinite(numRows) && numRows > 0 ? Math.floor(numRows) : 0;

                // SVG dimensions
                const svgWidth = 600;
                const svgHeight = Math.max(120, 40 + validNumRows * 25);
                const rowHeight = 20;
                const startY = 30;

                return (
                  <div className="space-y-4">
                    {/* Visual Row Generation */}
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-xs font-medium mb-2">
                        Claim {claimInfo.claimId} → {validNumRows} Training Rows:
                      </div>
                      <svg width="100%" height={svgHeight} className="border rounded bg-white">
                        {/* Original claim representation at top */}
                        <rect x="20" y="10" width="560" height="15" fill="#E5E7EB" stroke="#9CA3AF" strokeWidth="1" rx="2"/>
                        <text x="25" y="21" fontSize="10" fill="#374151" fontWeight="bold">
                          Original Claim {claimInfo.claimId}
                        </text>
                        <text x="450" y="21" fontSize="9" fill="#6B7280">
                          Notify Q{notifyQuarter} → Settle Q{settlementQuarter}
                        </text>

                        {/* Training rows */}
                        {Array.from({ length: validNumRows }, (_, i) => {
                          const y = startY + i * 25;
                          const currentQuarter = notifyQuarter + i;
                          const devPeriod = oneBasedDevQuarters ?
                            (currentQuarter - accidentQuarter + 1) :
                            (currentQuarter - accidentQuarter);

                          // Calculate cutoff point based on development quarter
                          const totalWidth = 540;
                          const cutoffRatio = Math.min(1, (i + 1) / validNumRows);
                          const cutoffWidth = totalWidth * cutoffRatio;

                          return (
                            <g key={i}>
                              {/* Full row background (censored part) */}
                              <rect
                                x="20"
                                y={y}
                                width={totalWidth}
                                height={rowHeight}
                                fill="#FEF3C7"
                                stroke="#F59E0B"
                                strokeWidth="1"
                                rx="2"
                                opacity="0.3"
                              />

                              {/* Visible (uncensored) part */}
                              <rect
                                x="20"
                                y={y}
                                width={cutoffWidth}
                                height={rowHeight}
                                fill="#DBEAFE"
                                stroke="#3B82F6"
                                strokeWidth="1"
                                rx="2"
                              />

                              {/* Cutoff line */}
                              <line
                                x1={20 + cutoffWidth}
                                y1={y}
                                x2={20 + cutoffWidth}
                                y2={y + rowHeight}
                                stroke="#DC2626"
                                strokeWidth="2"
                              />

                              {/* Row label */}
                              <text x="25" y={y + 13} fontSize="9" fill="#1E40AF" fontWeight="bold">
                                Row {i + 1}
                              </text>

                              {/* Development period */}
                              <text x="80" y={y + 13} fontSize="8" fill="#374151">
                                Dev Period {devPeriod}
                              </text>

                              {/* Cutoff label */}
                              <text x={25 + cutoffWidth} y={y + 13} fontSize="8" fill="#DC2626" fontWeight="bold">
                                Cut at DQ{devPeriod}
                              </text>

                              {/* Available data indicator */}
                              <text x="450" y={y + 13} fontSize="8" fill="#059669">
                                Data: Accident → Q{currentQuarter}
                              </text>
                            </g>
                          );
                        })}

                        {/* Legend */}
                        <g transform="translate(20, {svgHeight - 35})">
                          <rect x="0" y="0" width="15" height="10" fill="#DBEAFE" stroke="#3B82F6" strokeWidth="1"/>
                          <text x="20" y="8" fontSize="8" fill="#374151">Available Data</text>

                          <rect x="120" y="0" width="15" height="10" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="1" opacity="0.3"/>
                          <text x="140" y="8" fontSize="8" fill="#374151">Future (Censored)</text>

                          <line x1="250" y1="5" x2="265" y2="5" stroke="#DC2626" strokeWidth="2"/>
                          <text x="270" y="8" fontSize="8" fill="#374151">Development Cutoff</text>
                        </g>
                      </svg>

                      <div className="mt-2 text-xs text-gray-600">
                        <strong>Process:</strong> Panel Data Transformation
                      </div>
                    </div>

                    {/* Row details */}
                    <div className="space-y-2">
                      <div className="text-sm font-medium">One Row Per Claim Per Development Period:</div>
                      <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
                        {validNumRows > 0 ? Array.from({ length: validNumRows }, (_, i) => {
                          const currentQuarter = notifyQuarter + i;
                          const devPeriod = oneBasedDevQuarters ?
                            (currentQuarter - accidentQuarter + 1) :
                            (currentQuarter - accidentQuarter);
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 p-2 rounded">
                              <span className="font-mono bg-blue-100 px-2 py-1 rounded text-blue-800 min-w-12">R{i + 1}</span>
                              <span className="flex-1">
                                Claim {claimInfo.claimId} at Dev Period {devPeriod}
                                <span className="text-green-600 ml-2 font-medium">
                                  [Available: Accident → Q{currentQuarter}]
                                </span>
                                <span className="text-red-600 ml-2">
                                  [Censored: Q{currentQuarter + 1}+ ]
                                </span>
                              </span>
                            </div>
                          );
                        }) : (
                          <div className="text-xs text-gray-500 p-2 bg-yellow-50 rounded">
                            This claim settles immediately, creating minimal development history.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>



          </div>
        </div>

        {/* Feature Engineering */}
        <div className="bg-indigo-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-3">WIP: Feature Engineering</div>
          <div className="space-y-3">

            {/* Log Transformations */}
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">Log Transformations</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <strong>Payment Features:</strong>
                  <ul className="text-xs mt-1 space-y-1 text-gray-600">
                    <li>• <code>log_total_payment_size</code></li>
                    <li>• <code>log_average_payment_size</code></li>
                  </ul>
                </div>
                <div>
                  <strong>Incurred Features:</strong>
                  <ul className="text-xs mt-1 space-y-1 text-gray-600">
                    <li>• <code>log_average_incurred_size</code></li>
                    <li>• <code>log_latest_incurred</code></li>
                    <li>• <code>log_latest_ocl</code></li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Remaining Claim Value */}
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">Target Variable: Outstanding Claim Liability</div>
              <div className="text-sm">
                <strong>Outstanding Claim Liability:</strong><br/>
                <code className="text-xs bg-gray-100 px-1 rounded">outstanding_liability = ultimate_claim_size - cumulative_payments_to_date</code>
                <div className="mt-2 text-xs text-gray-600">
                  This represents the unpaid portion of the claim liability, which is what neural network reserving models predict.
                  For the selected claim, this is the amount the insurer still expects to pay out.
                </div>
              </div>
            </div>

            {/* Temporal Features */}
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">Temporal Features</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>
                  <strong>Development Timing:</strong>
                  <ul className="text-xs mt-1 space-y-1 text-gray-600">
                    <li>• <code>development_period</code></li>
                    <li>• <code>settlement_period</code></li>
                    <li>• <code>notification_delay</code></li>
                    <li>• <code>settlement_delay</code></li>
                  </ul>
                </div>
                <div>
                  <strong>Activity Patterns:</strong>
                  <ul className="text-xs mt-1 space-y-1 text-gray-600">
                    <li>• <code>average_num_payments_per_period</code></li>
                    <li>• <code>cumulative_num_payments</code></li>
                    <li>• <code>payment_count</code> (current period)</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Static Covariates */}
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">Static Covariates (Attached to Each Row)</div>
              <div className="text-sm">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <strong>Legal Representation:</strong><br/>
                    <span className="text-gray-600">{claimInfo.Legal_Representation}</span>
                  </div>
                  <div>
                    <strong>Injury Severity:</strong><br/>
                    <span className="text-gray-600">{claimInfo.Injury_Severity}</span>
                  </div>
                  <div>
                    <strong>Age of Claimant:</strong><br/>
                    <span className="text-gray-600">{claimInfo.Age_of_Claimant}</span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-600">
                  These remain constant across all development periods for the same claim, providing contextual information
                  that may influence the claim's development pattern.
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Final Dataset Preview */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="text-sm font-medium mb-3">WIP: Final Dataset Preview</div>
          <div className="space-y-3">

            {/* Dataset Summary */}
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">Dataset Structure</div>
              <div className="text-sm">
                <strong>From Transaction-Level to Development Triangle Format:</strong>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="font-medium">Original Data:</span><br/>
                    <span className="text-xs text-gray-600">• Individual payment transactions</span><br/>
                    <span className="text-xs text-gray-600">• Variable timing within periods</span><br/>
                    <span className="text-xs text-gray-600">• One row per transaction</span>
                  </div>
                  <div>
                    <span className="font-medium">Transformed Data:</span><br/>
                    <span className="text-xs text-gray-600">• One row per claim per development period</span><br/>
                    <span className="text-xs text-gray-600">• Cumulative features up to each period</span><br/>
                    <span className="text-xs text-gray-600">• Ready for ML model training</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sample Row Structure */}
            <div className="bg-white p-3 rounded border">
              <div className="text-xs font-medium text-gray-600 mb-2">Sample Row from Final Dataset</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-300 px-2 py-1">claim_no</th>
                      <th className="border border-gray-300 px-2 py-1">development_period</th>
                      <th className="border border-gray-300 px-2 py-1">cumulative_num_payments</th>
                      <th className="border border-gray-300 px-2 py-1">log_total_payment_size</th>
                      <th className="border border-gray-300 px-2 py-1">log_average_payment_size</th>
                      <th className="border border-gray-300 px-2 py-1">Legal_Representation</th>
                      <th className="border border-gray-300 px-2 py-1">log_claim_size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarters && quarters.length > 0 ? quarters.slice(0, 3).map((quarter, i) => {
                      const cumulativeSum = quarters.slice(0, i + 1).reduce((sum, q) => sum + q.totalAmount, 0);
                      const cumulativeCount = quarters.slice(0, i + 1).reduce((sum, q) => sum + q.paymentCount, 0);
                      const avgPayment = cumulativeCount > 0 ? cumulativeSum / cumulativeCount : 0;
                      const logTotal = cumulativeSum > 0 ? Math.log(cumulativeSum).toFixed(2) : '0.00';
                      const logAvg = avgPayment > 0 ? Math.log(avgPayment).toFixed(2) : '0.00';
                      const remainingClaim = Math.max(1, 100 - cumulativeSum); // Ensure positive
                      const logRemaining = Math.log(remainingClaim).toFixed(2);

                      return (
                        <tr key={i}>
                          <td className="border border-gray-300 px-2 py-1 text-center">{claimInfo.claimId}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center">{quarter.developmentQuarter}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center">{cumulativeCount}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center">{logTotal}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center">{logAvg}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center">{claimInfo.Legal_Representation}</td>
                          <td className="border border-gray-300 px-2 py-1 text-center">{logRemaining}</td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan="7" className="border border-gray-300 px-2 py-1 text-center text-gray-500">
                          No quarterly data available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                This shows one row per development period for claim {claimInfo.claimId}. Each row represents the cumulative state
                at a specific development period, with all features calculated up to that point in time.
              </div>
            </div>


          </div>
        </div>
      </div>
    );
    } catch (error) {
      console.error('Error in QuarterlyPreprocessingView:', error);
      return (
        <div className="text-center py-8 text-red-500">
          Error rendering quarterly preprocessing view. Please try selecting a different claim.
        </div>
      );
    }
  }

  // -------------------- Render --------------------
  return (
    <div className='w-full relative'>
      {/* Main content */}
      <div className='w-full p-4 flex flex-col items-center'>
        <div className='text-xl font-semibold mb-2'>Individual Reserving Dataset Splits</div>
        <div className='mb-3 text-sm text-gray-600 text-center max-w-2xl'>
          Click on any claim line in the diagram below to select it for detailed analysis in the preprocessing sections.
        </div>
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
              <line x1={margins.left} y1={margins.top + 10 + contentHeight + 10} x2={width - margins.right} y2={margins.top + 10 + contentHeight + 10} stroke='#111827' strokeWidth={1} />
              {ticks.map((t, i) => {
                const x = xScale(t);
                return (
                  <g key={i}>
                    <line x1={x} y1={margins.top + 10 + contentHeight + 6} x2={x} y2={margins.top + 10 + contentHeight + 14} stroke='#111827' />
                    <text x={x} y={margins.top + 10 + contentHeight + 30} fontSize={12} textAnchor='middle' fill='#111827'>
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
                    <line x1={x} y1={margins.top - 6} x2={x} y2={margins.top + 10 + contentHeight + 10} stroke='#6b7280' strokeDasharray='4 4' />
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
                  <g
                    key={idx}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedClaimIndex(idx)}
                  >
                    <text x={margins.left - 8} y={y + 4} fontSize={10} textAnchor='end' opacity={0.5}>
                      {idx + 1}
                    </text>

                    {/* Selection highlight */}
                    {selectedClaimIndex === idx && (
                      <rect
                        x={margins.left - 12}
                        y={y - 10}
                        width={width - margins.left - margins.right + 24}
                        height={20}
                        fill="rgba(59, 130, 246, 0.1)"
                        stroke="rgb(59, 130, 246)"
                        strokeWidth={1}
                        rx={4}
                      />
                    )}

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
              {/* <button onClick={downloadSVG} className='px-3 py-2 rounded-xl ring-1 ring-gray-300 hover:bg-gray-50'>
                Download SVG
              </button> */}
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

        {/* Quarterly Preprocessing Section */}
        <div className='w-full max-w-6xl mx-auto p-4 mt-8 border-t border-gray-200'>
          <QuarterlyPreprocessingView claimData={quarterlyData} />
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
