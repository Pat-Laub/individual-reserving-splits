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
function adjustForInflation(nominalAmount, paymentDate, observationEndDate, priceIndexMap) {
  // Price Index based adjustment
  return adjustUsingPriceIndex(nominalAmount, paymentDate, observationEndDate, priceIndexMap);
}

// Calculate adjustment factor from source quarter to target quarter
function calculateAdjustmentFactor(sourceQuarter, targetQuarter, priceIndexMap) {
  if (sourceQuarter === targetQuarter) return 1.0;
  const parseQuarter = (quarterStr) => {
    const match = quarterStr.match(/(\d{4})Q(\d)/);
    return { year: parseInt(match[1]), quarter: parseInt(match[2]) };
  };
  const source = parseQuarter(sourceQuarter);
  const target = parseQuarter(targetQuarter);
  const quarterToDate = (q) => new Date(Date.UTC(q.year, (q.quarter - 1) * 3, 1));
  const sourceDate = quarterToDate(source);
  const targetDate = quarterToDate(target);
  return adjustForInflation(1.0, sourceDate, targetDate, priceIndexMap);
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
// -------------------- Price Index (replaces per-quarter inflation rates) --------------------
// We "make up" a reproducible Price Index by quarter between the start and end dates.
// The adjustment factor is: AdjustmentFactor(sourceQuarter) = PriceIndex[targetQuarter] / PriceIndex[sourceQuarter].

function startOfQuarterUTC(d) {
  const y = d.getUTCFullYear();
  const qStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(y, qStartMonth, 1));
}
function addQuartersUTC(d, n) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * n, 1));
}
function quarterKeyFromUTC(d) {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}Q${q}`;
}

/**
 * Generate a deterministic quarterly Price Index time series between startDate and endDate (inclusive, by quarter).
 * Base ~100 at the first quarter, then apply a small positive drift with light noise.
 * Returns: { series: [{date, quarterKey, index}], map: { [quarterKey]: index } }
 */
function generatePriceIndexSeries(startDate, endDate, seed = 1) {
  const series = [];
  const map = {};
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  let q = startOfQuarterUTC(new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1)));
  const lastQ = startOfQuarterUTC(new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1)));

  // Start around 100
  let idx = 100;
  while (q <= lastQ) {
    // Drift ~ +1.0% to +1.6% per quarter, plus small noise [-0.4%, +0.4%]
    const drift = 0.013 + (rnd() * 0.006);     // [1.3%, 1.9%]
    const noise = (rnd() - 0.5) * 0.008;       // [-0.4%, +0.4%]
    idx = Math.max(60, idx * (1 + drift + noise));
    const k = quarterKeyFromUTC(q);
    series.push({ date: new Date(q), quarterKey: k, index: idx });
    map[k] = idx;
    q = addQuartersUTC(q, 1);
  }

  return { series, map };
}

/** Adjust a nominal amount from paymentDate's quarter to targetDate's quarter using the Price Index. */
function adjustUsingPriceIndex(nominalAmount, paymentDate, targetDate, priceIndexMap) {
  if (!paymentDate || !targetDate || !priceIndexMap) return nominalAmount;
  const srcKey = getQuarterInfo(paymentDate, paymentDate).quarterKey;
  const tgtKey = getQuarterInfo(targetDate, targetDate).quarterKey;
  const srcIdx = priceIndexMap[srcKey];
  const tgtIdx = priceIndexMap[tgtKey];
  if (!srcIdx || !tgtIdx) return nominalAmount;
  return nominalAmount * (tgtIdx / srcIdx);
}

/** Adjustment factor between two quarter keys using the Price Index map. */
function calculateAdjustmentFactorByIndex(sourceQuarterKey, targetQuarterKey, priceIndexMap) {
  if (!priceIndexMap) return 1.0;
  const s = priceIndexMap[sourceQuarterKey];
  const t = priceIndexMap[targetQuarterKey];
  if (!s || !t) return 1.0;
  return t / s;
}

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

function aggregateClaimToQuarters(claim, oneBasedDevQuarters = false, observationEndDate = null, priceIndexMap = null) {
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
        // Adjust each payment using the Price Index and sum
        const adjustedPayments = existingQuarter.payments.map(payment => {
          const adjustedPaymentAmount = adjustUsingPriceIndex(payment.amount, payment.date, observationEndDate, priceIndexMap);
          const safeAdjustedPaymentAmount = isNaN(adjustedPaymentAmount) ? payment.amount : adjustedPaymentAmount;
          return {
            ...payment,
            nominalAmount: payment.amount,
            amount: safeAdjustedPaymentAmount,
            inflationAdjusted: true
          };
        });
        const adjustedTotal = adjustedPayments.reduce((s, p) => s + p.amount, 0);

        const adjustedQuarter = {
          ...existingQuarter,
          nominalAmount: existingQuarter.totalAmount,
          totalAmount: isNaN(adjustedTotal) ? existingQuarter.totalAmount : adjustedTotal,
          inflationAdjusted: true,
          payments: adjustedPayments
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


// -------------------- Quarterly Preprocessing Component --------------------
// This component shows all the preprocessing steps in detail

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
  const [seedText, setSeedText] = useState('preprocessing-diagram');
  const [dedupeMonthly, setDedupeMonthly] = useState(true);
  const [trainCutStr, setTrainCutStr] = useState('2021-06-30');
  const [valCutStr, setValCutStr] = useState('2023-06-30');
  const [testCutStr, setTestCutStr] = useState('2025-01-01');
  const [selectedClaimIndex, setSelectedClaimIndex] = useState(null);
  const [oneBasedDevQuarters, setOneBasedDevQuarters] = useState(true);
  const [showPaymentDetails, setShowPaymentDetails] = useState(true);
  const [showQuarterlyAggregation, setShowQuarterlyAggregation] = useState(true);

  const COLORS = { train: '#2563eb', val: '#f59e0b', test: '#10b981', post: '#9ca3af' };
  const FADE_OPACITY = 0.35;
  const LEAK_OPACITY = 0.35;
  const LEAK_DASH = '3 3';

  const seed = useMemo(() => hashStringToSeed(seedText), [seedText]);

  // Hardcoded to settlement date mode for preprocessing
  const splitMode = 'settlement';

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


  // ----- Price Index (made-up) for the displayed window -----
  const { series: priceIndexSeries, map: priceIndexMap } = useMemo(() => {
    return generatePriceIndexSeries(startDate, endDate, seed);
  }, [startDate, endDate, seed]);

  const claims = autoClaims;

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

  // Set default claim to CLM-0001
  useEffect(() => {
    if (selectedClaimIndex === null && claims.length > 0) {
      const clm0001Index = claims.findIndex(c => c.staticCovariates.claimId === 'CLM-0001');
      if (clm0001Index !== -1) {
        setSelectedClaimIndex(clm0001Index);
      } else {
        setSelectedClaimIndex(0);
      }
    }
  }, [claims, selectedClaimIndex]);

  // Selected claim quarterly data
  const selectedClaim = selectedClaimIndex !== null ? claims[selectedClaimIndex] : null;
  const quarterlyData = selectedClaim ? aggregateClaimToQuarters(selectedClaim, oneBasedDevQuarters, endDate, priceIndexMap) : null;

  // -------------------- Render --------------------
  return (
    <div className='w-full relative'>
      {/* Main content */}
      <div className='w-full p-4 flex flex-col items-center'>
        <div className='text-xl font-semibold mb-2'>Individual Reserving Data Preprocessing</div>
        <div className='mb-4 text-sm text-gray-600 text-center max-w-2xl'>
          This page demonstrates the preprocessing steps applied to individual insurance claims before they are used in machine learning models for reserving.
        </div>

        {/* Claim Selection Interface */}
        <div className='mb-6 p-4 bg-gray-50 rounded-lg border'>
          <div className='text-sm font-medium mb-3'>Select a Claim for Detailed Analysis:</div>
          <div className='flex flex-wrap gap-2'>
            {claims
              .slice(0, Math.min(20, claims.length))
              .map((claim, index) => ({ claim, originalIndex: index }))
              .sort((a, b) => a.claim.staticCovariates.claimId.localeCompare(b.claim.staticCovariates.claimId, undefined, { numeric: true }))
              .map(({ claim, originalIndex }) => (
                <button
                  key={originalIndex}
                  onClick={() => setSelectedClaimIndex(originalIndex)}
                  className={`px-3 py-2 rounded text-xs font-medium transition-colors ${selectedClaimIndex === originalIndex
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                    }`}
                >
                  {claim.staticCovariates.claimId}
                </button>
              ))}
          </div>
          <div className='text-xs text-gray-600 mt-2'>
            Dataset split: Settlement date mode (claims grouped by their settlement date)
          </div>
        </div>

        {/* Quarterly Preprocessing Section */}
        <div className='w-full max-w-6xl mx-auto p-4'>
          <QuarterlyPreprocessingView
            claimData={quarterlyData}
            oneBasedDevQuarters={oneBasedDevQuarters}
            setOneBasedDevQuarters={setOneBasedDevQuarters}
            endDate={endDate}
            showPaymentDetails={showPaymentDetails}
            setShowPaymentDetails={setShowPaymentDetails}
            showQuarterlyAggregation={showQuarterlyAggregation}
            setShowQuarterlyAggregation={setShowQuarterlyAggregation}
            selectedClaim={selectedClaim}
            priceIndexMap={priceIndexMap}
            priceIndexSeries={priceIndexSeries}
          />
        </div>
      </div>
    </div>
  );
}
