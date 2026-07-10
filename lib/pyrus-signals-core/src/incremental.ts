import {
  aggregatePyrusSignalsBarsForTimeframe,
  buildPyrusSignalsDirectionalFeatures,
  isPyrusSignalsBarInSession,
  resolvePyrusSignalsSessionKey,
  resolvePyrusSignalsTrendDirection,
  type PyrusSignalsBar,
  type PyrusSignalsDirection,
  type PyrusSignalsEvaluation,
  type PyrusSignalsFilterState,
  type PyrusSignalsSignalEvent,
  type PyrusSignalsSignalSettings,
  type PyrusSignalsStructureEvent,
  type PyrusSignalsStructureEventType,
} from "./index";

export type IncrementalPyrusSignalsEvaluator = {
  append(bar: PyrusSignalsBar): PyrusSignalsEvaluation;
  clone(): IncrementalPyrusSignalsEvaluator;
  result(): PyrusSignalsEvaluation;
};

export type IncrementalPyrusSignalsEvaluationOptions = {
  includeProvisionalSignals?: boolean;
  lastBarClosed?: boolean;
};

const toIso = (bar: PyrusSignalsBar): string =>
  bar.ts || new Date(bar.time * 1000).toISOString();

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const roundSix = (value: number): number => Number(value.toFixed(6));

class IncrementalFiniteSma {
  readonly values: number[];
  readonly result: number[];

  private rollingSum: number;
  private validCount: number;

  constructor(
    private readonly period: number,
    source?: IncrementalFiniteSma,
  ) {
    this.values = source ? source.values.slice() : [];
    this.result = source ? source.result.slice() : [];
    this.rollingSum = source?.rollingSum ?? 0;
    this.validCount = source?.validCount ?? 0;
  }

  clone(): IncrementalFiniteSma {
    return new IncrementalFiniteSma(this.period, this);
  }

  append(value: number): number {
    this.values.push(value);
    this.result.push(Number.NaN);
    const index = this.values.length - 1;
    if (this.period <= 0) {
      return this.result[index];
    }

    if (Number.isFinite(value)) {
      this.rollingSum += value;
      this.validCount += 1;
    }
    if (index >= this.period) {
      const dropped = this.values[index - this.period];
      if (Number.isFinite(dropped)) {
        this.rollingSum -= dropped;
        this.validCount -= 1;
      }
    }
    if (index >= this.period - 1 && this.validCount === this.period) {
      this.result[index] = roundSix(this.rollingSum / this.period);
    }
    return this.result[index];
  }
}

const appendWma = (
  values: number[],
  result: number[],
  period: number,
): number => {
  result.push(Number.NaN);
  if (!values.length || period <= 0) {
    return result[result.length - 1];
  }

  const index = values.length - 1;
  const weightTotal = (period * (period + 1)) / 2;
  if (index >= period - 1) {
    let weightedSum = 0;
    let valid = true;
    for (let offset = 0; offset < period; offset += 1) {
      const value = values[index - period + 1 + offset];
      if (!Number.isFinite(value)) {
        valid = false;
        break;
      }
      weightedSum += value * (offset + 1);
    }
    if (valid) {
      result[index] = roundSix(weightedSum / weightTotal);
    }
  }
  return result[index];
};

const appendStandardDeviation = (
  values: number[],
  result: number[],
  period: number,
): number => {
  result.push(Number.NaN);
  if (!values.length || period <= 0) {
    return result[result.length - 1];
  }

  const index = values.length - 1;
  if (index >= period - 1) {
    const window = values.slice(index - period + 1, index + 1);
    if (window.some((value) => !Number.isFinite(value))) {
      return result[index];
    }
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    result[index] = roundSix(Math.sqrt(variance));
  }
  return result[index];
};

const appendPercentRank = (
  values: number[],
  result: number[],
  period: number,
): number => {
  result.push(Number.NaN);
  if (!values.length || period <= 1) {
    return result[result.length - 1];
  }

  const index = values.length - 1;
  if (index >= period - 1) {
    const window = values.slice(index - period + 1, index + 1);
    const current = values[index];
    if (
      !Number.isFinite(current) ||
      window.some((value) => !Number.isFinite(value))
    ) {
      return result[index];
    }
    let lessOrEqual = 0;
    window.forEach((value) => {
      if (value <= current) {
        lessOrEqual += 1;
      }
    });
    result[index] = roundSix(((lessOrEqual - 1) / (period - 1)) * 100);
  }
  return result[index];
};

class IncrementalAdx {
  readonly result: number[];

  private readonly trueRanges: number[];
  private readonly plusDm: number[];
  private readonly minusDm: number[];
  private readonly dx: number[];
  private initialSmoothedTr: number;
  private initialSmoothedPlusDm: number;
  private initialSmoothedMinusDm: number;
  private smoothedTr: number;
  private smoothedPlusDm: number;
  private smoothedMinusDm: number;
  private initialDxSum: number;
  private initialDxCount: number;
  private initialAdxIndex: number | null;
  private initialAdxValue: number;
  private changedIndexes: number[];

  constructor(private readonly period: number, source?: IncrementalAdx) {
    this.result = source ? source.result.slice() : [];
    this.trueRanges = source ? source.trueRanges.slice() : [];
    this.plusDm = source ? source.plusDm.slice() : [];
    this.minusDm = source ? source.minusDm.slice() : [];
    this.dx = source ? source.dx.slice() : [];
    this.initialSmoothedTr = source?.initialSmoothedTr ?? 0;
    this.initialSmoothedPlusDm = source?.initialSmoothedPlusDm ?? 0;
    this.initialSmoothedMinusDm = source?.initialSmoothedMinusDm ?? 0;
    this.smoothedTr = source?.smoothedTr ?? 0;
    this.smoothedPlusDm = source?.smoothedPlusDm ?? 0;
    this.smoothedMinusDm = source?.smoothedMinusDm ?? 0;
    this.initialDxSum = source?.initialDxSum ?? 0;
    this.initialDxCount = source?.initialDxCount ?? 0;
    this.initialAdxIndex = source?.initialAdxIndex ?? null;
    this.initialAdxValue = source?.initialAdxValue ?? Number.NaN;
    this.changedIndexes = source ? source.changedIndexes.slice() : [];
  }

  clone(): IncrementalAdx {
    return new IncrementalAdx(this.period, this);
  }

  append(chartBars: PyrusSignalsBar[]): number {
    const index = chartBars.length - 1;
    this.changedIndexes = [];
    this.result.push(Number.NaN);
    this.trueRanges.push(0);
    this.plusDm.push(0);
    this.minusDm.push(0);
    this.dx.push(Number.NaN);

    if (this.period <= 0) {
      return this.result[index];
    }

    if (index >= 1) {
      const currentBar = chartBars[index];
      const previousBar = chartBars[index - 1];
      if (currentBar && previousBar) {
        const upMove = currentBar.h - previousBar.h;
        const downMove = previousBar.l - currentBar.l;
        this.trueRanges[index] = Math.max(
          currentBar.h - currentBar.l,
          Math.abs(currentBar.h - previousBar.c),
          Math.abs(currentBar.l - previousBar.c),
        );
        this.plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
        this.minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
      }
    }

    if (index >= 1 && index <= this.period) {
      this.initialSmoothedTr += this.trueRanges[index] ?? 0;
      this.initialSmoothedPlusDm += this.plusDm[index] ?? 0;
      this.initialSmoothedMinusDm += this.minusDm[index] ?? 0;
    }

    if (index === this.period) {
      this.smoothedTr = this.initialSmoothedTr;
      this.smoothedPlusDm = this.initialSmoothedPlusDm;
      this.smoothedMinusDm = this.initialSmoothedMinusDm;
      this.computeDx(index);
    } else if (index > this.period) {
      this.smoothedTr =
        this.smoothedTr - this.smoothedTr / this.period + this.trueRanges[index];
      this.smoothedPlusDm =
        this.smoothedPlusDm -
        this.smoothedPlusDm / this.period +
        this.plusDm[index];
      this.smoothedMinusDm =
        this.smoothedMinusDm -
        this.smoothedMinusDm / this.period +
        this.minusDm[index];
      this.computeDx(index);
    }

    if (index >= this.period * 2) {
      this.revealInitialAdx();
      if (
        this.initialAdxIndex !== index &&
        Number.isFinite(this.dx[index]) &&
        Number.isFinite(this.result[index - 1])
      ) {
        this.result[index] = roundSix(
          (this.result[index - 1] * (this.period - 1) + this.dx[index]) /
            this.period,
        );
        this.changedIndexes.push(index);
      }
    }

    return this.result[index];
  }

  consumeChangedIndexes(): number[] {
    const changedIndexes = this.changedIndexes;
    this.changedIndexes = [];
    return changedIndexes;
  }

  private computeDx(index: number): void {
    if (!Number.isFinite(this.smoothedTr) || this.smoothedTr <= 0) {
      return;
    }
    const plusDi = (this.smoothedPlusDm / this.smoothedTr) * 100;
    const minusDi = (this.smoothedMinusDm / this.smoothedTr) * 100;
    const diSum = plusDi + minusDi;
    if (diSum <= 0) {
      return;
    }
    this.dx[index] = (Math.abs(plusDi - minusDi) / diSum) * 100;
    this.countInitialDx(index);
  }

  private countInitialDx(index: number): void {
    if (this.initialAdxIndex != null || !Number.isFinite(this.dx[index])) {
      return;
    }
    this.initialDxSum += this.dx[index];
    this.initialDxCount += 1;
    if (this.initialDxCount === this.period) {
      this.initialAdxIndex = index;
      this.initialAdxValue = roundSix(this.initialDxSum / this.period);
    }
  }

  private revealInitialAdx(): void {
    if (
      this.initialAdxIndex != null &&
      !Number.isFinite(this.result[this.initialAdxIndex])
    ) {
      this.result[this.initialAdxIndex] = this.initialAdxValue;
      this.changedIndexes.push(this.initialAdxIndex);
    }
  }
}

class MedianPositiveIntervalTracker {
  private readonly intervals: number[];
  private median: number;

  constructor(source?: MedianPositiveIntervalTracker) {
    this.intervals = source ? source.intervals.slice() : [];
    this.median = source?.median ?? 0;
  }

  clone(): MedianPositiveIntervalTracker {
    return new MedianPositiveIntervalTracker(this);
  }

  append(interval: number): boolean {
    const previousMedian = this.median;
    if (Number.isFinite(interval) && interval > 0) {
      let low = 0;
      let high = this.intervals.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((this.intervals[middle] ?? 0) <= interval) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }
      this.intervals.splice(low, 0, interval);
      this.median = this.intervals[Math.floor(this.intervals.length / 2)] ?? 0;
    }
    return !Object.is(previousMedian, this.median);
  }

  value(): number {
    return this.median;
  }
}

const resolvePivotHigh = (
  chartBars: PyrusSignalsBar[],
  pivotIndex: number,
  strength: number,
): number | null => {
  if (pivotIndex - strength < 0 || pivotIndex + strength >= chartBars.length) {
    return null;
  }
  const pivotValue = chartBars[pivotIndex]?.h;
  if (!Number.isFinite(pivotValue)) {
    return null;
  }
  for (
    let index = pivotIndex - strength;
    index <= pivotIndex + strength;
    index += 1
  ) {
    if (
      index !== pivotIndex &&
      (chartBars[index]?.h ?? Number.NEGATIVE_INFINITY) > pivotValue
    ) {
      return null;
    }
  }
  return pivotValue;
};

const resolvePivotLow = (
  chartBars: PyrusSignalsBar[],
  pivotIndex: number,
  strength: number,
): number | null => {
  if (pivotIndex - strength < 0 || pivotIndex + strength >= chartBars.length) {
    return null;
  }
  const pivotValue = chartBars[pivotIndex]?.l;
  if (!Number.isFinite(pivotValue)) {
    return null;
  }
  for (
    let index = pivotIndex - strength;
    index <= pivotIndex + strength;
    index += 1
  ) {
    if (
      index !== pivotIndex &&
      (chartBars[index]?.l ?? Number.POSITIVE_INFINITY) < pivotValue
    ) {
      return null;
    }
  }
  return pivotValue;
};

const hasHardBarTimeGap = (
  chartBars: PyrusSignalsBar[],
  index: number,
  medianInterval: number,
): boolean => {
  if (index <= 0 || medianInterval <= 0) {
    return false;
  }

  return chartBars[index].time - chartBars[index - 1].time > medianInterval * 2;
};

const buildFilterState = (
  chartBars: PyrusSignalsBar[],
  index: number,
  direction: number,
  settings: PyrusSignalsSignalSettings,
  adx: number[],
  volatilityScore: number[],
  atrSmoothed: number[],
  regimeDirectionAge: number[],
): PyrusSignalsFilterState => {
  const mtfDirections = [settings.mtf1, settings.mtf2, settings.mtf3].map(
    (mtfTimeframe) =>
      resolvePyrusSignalsTrendDirection(
        aggregatePyrusSignalsBarsForTimeframe(
          chartBars.slice(0, index + 1),
          mtfTimeframe,
        ),
        settings.basisLength,
      ),
  ) as [number, number, number];
  const currentAdx = adx[index];
  const currentVolatilityScore = volatilityScore[index];
  const directionalFeatures = buildPyrusSignalsDirectionalFeatures({
    chartBars,
    index,
    direction,
    mtfDirections,
    adx: currentAdx,
    volatilityScore: currentVolatilityScore,
    atr: atrSmoothed[index],
    regimeAgeBars: regimeDirectionAge[index],
  });
  const currentSessionKey = resolvePyrusSignalsSessionKey(chartBars[index]);
  const mtfPass: [boolean, boolean, boolean] = [
    !settings.requireMtf1 || mtfDirections[0] === direction,
    !settings.requireMtf2 || mtfDirections[1] === direction,
    !settings.requireMtf3 || mtfDirections[2] === direction,
  ];
  const adxPass =
    !settings.requireAdx ||
    (Number.isFinite(currentAdx) && currentAdx >= settings.adxMin);
  const volatilityPass =
    !settings.requireVolScoreRange ||
    (Number.isFinite(currentVolatilityScore) &&
      currentVolatilityScore >= settings.volScoreMin &&
      currentVolatilityScore <= settings.volScoreMax);
  const sessionPass =
    !settings.restrictToSelectedSessions ||
    settings.sessions.some((session) =>
      isPyrusSignalsBarInSession(chartBars[index], session),
    );
  const gatedPass =
    mtfPass.every(Boolean) && adxPass && volatilityPass && sessionPass;
  return {
    enabled: settings.signalFiltersEnabled,
    direction,
    mtfDirections,
    adx: currentAdx,
    volatilityScore: currentVolatilityScore,
    directionalFeatures,
    sessionKey: currentSessionKey,
    mtfPass,
    adxPass,
    volatilityPass,
    sessionPass,
    passes: !settings.signalFiltersEnabled || gatedPass,
  };
};

class IncrementalPyrusSignalsEvaluatorImpl
  implements IncrementalPyrusSignalsEvaluator
{
  private readonly settings: PyrusSignalsSignalSettings;
  private readonly chartBars: PyrusSignalsBar[];
  private readonly closes: number[];
  private readonly basis: number[];
  private readonly atrRaw: number[];
  private readonly atrTrueRanges: number[];
  private readonly atrSmoothedSma: IncrementalFiniteSma;
  private readonly atrSmoothed: number[];
  private readonly upperBand: number[];
  private readonly lowerBand: number[];
  private readonly trendLine: number[];
  private readonly bullWires: [number[], number[], number[]];
  private readonly bearWires: [number[], number[], number[]];
  private readonly adxState: IncrementalAdx;
  private readonly volumeSmaState: IncrementalFiniteSma;
  private readonly volumeSma: number[];
  private readonly bbMidState: IncrementalFiniteSma;
  private readonly bbStdDev: number[];
  private readonly bbDev: number[];
  private readonly bbWidthPct: number[];
  private readonly bbPercentRank: number[];
  private readonly volatilityScore: number[];
  private readonly trendDirectionSeries: number[];
  private readonly regimeDirection: number[];
  private readonly regimeDirectionAge: number[];
  private readonly structureEvents: PyrusSignalsStructureEvent[];
  private readonly signalEvents: PyrusSignalsSignalEvent[];
  private readonly intervals: MedianPositiveIntervalTracker;
  private readonly includeProvisionalSignals: boolean;
  private readonly lastBarClosed: boolean;

  private atrInitialRolling = 0;
  private atrValue = Number.NaN;
  private trendDirection = 1;
  private trendBasisComputable = false;
  private marketStructureDirection = 0;
  private lastSwingHigh = Number.NaN;
  private previousSwingHigh = Number.NaN;
  private lastSwingLow = Number.NaN;
  private previousSwingLow = Number.NaN;
  private breakableHigh = Number.NaN;
  private breakableLow = Number.NaN;
  private previousRegimeDirection: number | null = null;

  constructor(
    settings: PyrusSignalsSignalSettings,
    options: IncrementalPyrusSignalsEvaluationOptions = {},
    source?: IncrementalPyrusSignalsEvaluatorImpl,
  ) {
    this.settings = source
      ? { ...source.settings, sessions: source.settings.sessions.slice() }
      : settings;
    this.chartBars = source ? source.chartBars.slice() : [];
    this.closes = source ? source.closes.slice() : [];
    this.basis = source ? source.basis.slice() : [];
    this.atrRaw = source ? source.atrRaw.slice() : [];
    this.atrTrueRanges = source ? source.atrTrueRanges.slice() : [];
    this.atrSmoothedSma = source
      ? source.atrSmoothedSma.clone()
      : new IncrementalFiniteSma(settings.atrSmoothing);
    this.atrSmoothed = this.atrSmoothedSma.result;
    this.upperBand = source ? source.upperBand.slice() : [];
    this.lowerBand = source ? source.lowerBand.slice() : [];
    this.trendLine = source ? source.trendLine.slice() : [];
    this.bullWires = source
      ? [
          source.bullWires[0].slice(),
          source.bullWires[1].slice(),
          source.bullWires[2].slice(),
        ]
      : [[], [], []];
    this.bearWires = source
      ? [
          source.bearWires[0].slice(),
          source.bearWires[1].slice(),
          source.bearWires[2].slice(),
        ]
      : [[], [], []];
    this.adxState = source
      ? source.adxState.clone()
      : new IncrementalAdx(settings.adxLength);
    this.volumeSmaState = source
      ? source.volumeSmaState.clone()
      : new IncrementalFiniteSma(settings.volumeMaLength);
    this.volumeSma = this.volumeSmaState.result;
    this.bbMidState = source
      ? source.bbMidState.clone()
      : new IncrementalFiniteSma(settings.shadowLength);
    this.bbStdDev = source ? source.bbStdDev.slice() : [];
    this.bbDev = source ? source.bbDev.slice() : [];
    this.bbWidthPct = source ? source.bbWidthPct.slice() : [];
    this.bbPercentRank = source ? source.bbPercentRank.slice() : [];
    this.volatilityScore = source ? source.volatilityScore.slice() : [];
    this.trendDirectionSeries = source
      ? source.trendDirectionSeries.slice()
      : [];
    this.regimeDirection = source ? source.regimeDirection.slice() : [];
    this.regimeDirectionAge = source ? source.regimeDirectionAge.slice() : [];

    const filterStateClones = new Map<
      PyrusSignalsFilterState,
      PyrusSignalsFilterState
    >();
    const cloneFilterState = (
      filterState: PyrusSignalsFilterState | null,
    ): PyrusSignalsFilterState | null => {
      if (!filterState) {
        return null;
      }
      const existing = filterStateClones.get(filterState);
      if (existing) {
        return existing;
      }
      const clone: PyrusSignalsFilterState = {
        ...filterState,
        mtfDirections: [...filterState.mtfDirections],
        directionalFeatures: { ...filterState.directionalFeatures },
        mtfPass: [...filterState.mtfPass],
      };
      filterStateClones.set(filterState, clone);
      return clone;
    };
    this.structureEvents = source
      ? source.structureEvents.map((event) => ({
          ...event,
          filterState: cloneFilterState(event.filterState),
        }))
      : [];
    this.signalEvents = source
      ? source.signalEvents.map((event) => ({
          ...event,
          filterState: cloneFilterState(event.filterState)!,
        }))
      : [];
    this.intervals = source
      ? source.intervals.clone()
      : new MedianPositiveIntervalTracker();
    this.includeProvisionalSignals = source
      ? source.includeProvisionalSignals
      : options.includeProvisionalSignals !== false;
    this.lastBarClosed = source
      ? source.lastBarClosed
      : options.lastBarClosed === true;

    if (source) {
      this.atrInitialRolling = source.atrInitialRolling;
      this.atrValue = source.atrValue;
      this.trendDirection = source.trendDirection;
      this.trendBasisComputable = source.trendBasisComputable;
      this.marketStructureDirection = source.marketStructureDirection;
      this.lastSwingHigh = source.lastSwingHigh;
      this.previousSwingHigh = source.previousSwingHigh;
      this.lastSwingLow = source.lastSwingLow;
      this.previousSwingLow = source.previousSwingLow;
      this.breakableHigh = source.breakableHigh;
      this.breakableLow = source.breakableLow;
      this.previousRegimeDirection = source.previousRegimeDirection;
    }
  }

  append(bar: PyrusSignalsBar): PyrusSignalsEvaluation {
    this.chartBars.push(bar);
    this.closes.push(bar.c);
    const index = this.chartBars.length - 1;
    const medianChanged = this.appendMedianInterval(index);

    appendWma(this.closes, this.basis, this.settings.basisLength);
    const atrRawValue = this.appendAtrRaw(index);
    this.atrSmoothedSma.append(atrRawValue);
    this.appendBands(index);
    this.adxState.append(this.chartBars);
    const changedAdxIndexes = this.adxState.consumeChangedIndexes();
    this.volumeSmaState.append(bar.v);
    this.appendVolatilityScore(index);
    this.appendPaintSlots();
    this.refreshRetroactiveFilterStates(changedAdxIndexes, index);
    this.promoteNoLongerFinalBar(index - 1);
    this.appendStructureAndSignals(index);

    if (medianChanged) {
      this.refreshPaintSeries();
    } else {
      this.paintIndex(index);
    }

    return this.result();
  }

  clone(): IncrementalPyrusSignalsEvaluatorImpl {
    return new IncrementalPyrusSignalsEvaluatorImpl(this.settings, {}, this);
  }

  result(): PyrusSignalsEvaluation {
    return {
      basis: this.basis,
      atrRaw: this.atrRaw,
      atrSmoothed: this.atrSmoothed,
      upperBand: this.upperBand,
      lowerBand: this.lowerBand,
      trendLine: this.trendLine,
      bullWires: this.bullWires,
      bearWires: this.bearWires,
      adx: this.adxState.result,
      volatilityScore: this.volatilityScore,
      trendDirection: this.trendDirectionSeries,
      regimeDirection: this.regimeDirection,
      trendBasisComputable: this.trendBasisComputable,
      marketStructureDirection: this.marketStructureDirection,
      structureEvents: this.structureEvents,
      signalEvents: this.signalEvents,
    };
  }

  private appendMedianInterval(index: number): boolean {
    if (index <= 0) {
      return false;
    }
    return this.intervals.append(
      this.chartBars[index].time - this.chartBars[index - 1].time,
    );
  }

  private appendAtrRaw(index: number): number {
    const bar = this.chartBars[index];
    const trueRange =
      index === 0
        ? bar.h - bar.l
        : Math.max(
            bar.h - bar.l,
            Math.abs(bar.h - (this.chartBars[index - 1]?.c ?? bar.c)),
            Math.abs(bar.l - (this.chartBars[index - 1]?.c ?? bar.c)),
          );
    this.atrTrueRanges.push(trueRange);
    this.atrRaw.push(Number.NaN);

    if (this.settings.atrLength <= 0) {
      return this.atrRaw[index];
    }
    if (index < this.settings.atrLength) {
      this.atrInitialRolling += trueRange ?? 0;
    }
    if (index === this.settings.atrLength - 1) {
      this.atrValue = this.atrInitialRolling / this.settings.atrLength;
      this.atrRaw[index] = roundSix(this.atrValue);
    } else if (index >= this.settings.atrLength) {
      this.atrValue =
        (this.atrValue * (this.settings.atrLength - 1) + trueRange) /
        this.settings.atrLength;
      this.atrRaw[index] = roundSix(this.atrValue);
    }
    return this.atrRaw[index];
  }

  private appendBands(index: number): void {
    const basis = this.basis[index];
    const atrSmoothed = this.atrSmoothed[index];
    this.upperBand.push(
      Number.isFinite(basis) && Number.isFinite(atrSmoothed)
        ? roundSix(
            basis + atrSmoothed * this.settings.volatilityMultiplier,
          )
        : Number.NaN,
    );
    this.lowerBand.push(
      Number.isFinite(basis) && Number.isFinite(atrSmoothed)
        ? roundSix(
            basis - atrSmoothed * this.settings.volatilityMultiplier,
          )
        : Number.NaN,
    );
  }

  private appendVolatilityScore(index: number): void {
    const bbMid = this.bbMidState.append(this.closes[index]);
    const stdDev = appendStandardDeviation(
      this.closes,
      this.bbStdDev,
      this.settings.shadowLength,
    );
    const dev = Number.isFinite(stdDev)
      ? stdDev * this.settings.shadowStdDev
      : Number.NaN;
    this.bbDev.push(dev);

    const close = this.closes[index];
    const width =
      Number.isFinite(bbMid) &&
      Number.isFinite(dev) &&
      Number.isFinite(close) &&
      close > 0
        ? (dev * 2) / close
        : Number.NaN;
    this.bbWidthPct.push(width);
    const rank = appendPercentRank(this.bbWidthPct, this.bbPercentRank, 200);
    this.volatilityScore.push(
      Number.isFinite(rank) ? clamp(Math.round(rank / 10), 0, 10) : 0,
    );
  }

  private appendPaintSlots(): void {
    this.trendLine.push(Number.NaN);
    for (const wires of [...this.bullWires, ...this.bearWires]) {
      wires.push(Number.NaN);
    }
  }

  private appendStructureAndSignals(index: number): void {
    const currentBar = this.chartBars[index];

    if (
      index >= 5 &&
      Number.isFinite(this.basis[index]) &&
      Number.isFinite(this.basis[index - 5])
    ) {
      this.trendBasisComputable = true;
      if (this.basis[index] > this.basis[index - 5]) {
        this.trendDirection = 1;
      } else if (this.basis[index] < this.basis[index - 5]) {
        this.trendDirection = -1;
      }
    }
    this.trendDirectionSeries.push(this.trendDirection);

    const pivotIndex = index - this.settings.timeHorizon;
    if (pivotIndex >= this.settings.timeHorizon) {
      const pivotHigh = resolvePivotHigh(
        this.chartBars,
        pivotIndex,
        this.settings.timeHorizon,
      );
      if (pivotHigh != null) {
        this.previousSwingHigh = this.lastSwingHigh;
        this.lastSwingHigh = pivotHigh;
        this.breakableHigh = pivotHigh;
      }
      const pivotLow = resolvePivotLow(
        this.chartBars,
        pivotIndex,
        this.settings.timeHorizon,
      );
      if (pivotLow != null) {
        this.previousSwingLow = this.lastSwingLow;
        this.lastSwingLow = pivotLow;
        this.breakableLow = pivotLow;
      }
    }

    let bullishBos = false;
    let bearishBos = false;
    let bullishChoch = false;
    let bearishChoch = false;

    if (
      Number.isFinite(this.breakableHigh) &&
      (this.settings.bosConfirmation === "wicks"
        ? currentBar.h > this.breakableHigh
        : currentBar.c > this.breakableHigh)
    ) {
      if (this.marketStructureDirection === 1) {
        bullishBos = true;
        this.breakableHigh = Number.NaN;
      } else if (this.passesChochFilters(index, "long", this.breakableHigh)) {
        bullishChoch = true;
        this.marketStructureDirection = 1;
        this.breakableHigh = Number.NaN;
      }
    }

    if (
      Number.isFinite(this.breakableLow) &&
      (this.settings.bosConfirmation === "wicks"
        ? currentBar.l < this.breakableLow
        : currentBar.c < this.breakableLow)
    ) {
      if (this.marketStructureDirection === -1) {
        bearishBos = true;
        this.breakableLow = Number.NaN;
      } else if (this.passesChochFilters(index, "short", this.breakableLow)) {
        bearishChoch = true;
        this.marketStructureDirection = -1;
        this.breakableLow = Number.NaN;
      }
    }

    const activeRegimeDirection =
      this.marketStructureDirection !== 0
        ? this.marketStructureDirection
        : this.trendDirection;
    this.regimeDirection.push(activeRegimeDirection);
    this.regimeDirectionAge.push(
      this.previousRegimeDirection != null &&
        this.previousRegimeDirection === activeRegimeDirection
        ? this.regimeDirectionAge[index - 1] + 1
        : 1,
    );
    this.previousRegimeDirection = activeRegimeDirection;

    const actionable = this.isActionableIndex(index);
    const pushStructure = (
      eventType: PyrusSignalsStructureEventType,
      direction: PyrusSignalsDirection,
      filterState: PyrusSignalsFilterState | null,
    ) => {
      this.structureEvents.push({
        id: `${eventType}-${index}-${currentBar.time}`,
        eventType,
        direction,
        barIndex: index,
        time: currentBar.time,
        ts: toIso(currentBar),
        actionable,
        filterState,
      });
    };

    if (bullishBos) {
      pushStructure("bullish_bos", "long", null);
    }
    if (bearishBos) {
      pushStructure("bearish_bos", "short", null);
    }

    if (bullishChoch || bearishChoch) {
      const direction = bullishChoch ? 1 : -1;
      const eventDirection: PyrusSignalsDirection = bullishChoch
        ? "long"
        : "short";
      const filterState = buildFilterState(
        this.chartBars,
        index,
        direction,
        this.settings,
        this.adxState.result,
        this.volatilityScore,
        this.atrSmoothed,
        this.regimeDirectionAge,
      );
      pushStructure(
        bullishChoch ? "bullish_choch" : "bearish_choch",
        eventDirection,
        filterState,
      );
      if (filterState.passes && actionable) {
        this.signalEvents.push(
          this.buildSignalEvent(index, eventDirection, filterState, actionable),
        );
      }
    }

    void this.previousSwingHigh;
    void this.previousSwingLow;
  }

  private passesChochFilters(
    index: number,
    direction: PyrusSignalsDirection,
    pivotLevel: number,
  ): boolean {
    const currentBar = this.chartBars[index];
    if (!currentBar || !Number.isFinite(pivotLevel)) {
      return false;
    }

    const currentAtr = this.atrRaw[index];
    const atrBuffer =
      Number.isFinite(currentAtr) && this.settings.chochAtrBuffer > 0
        ? currentAtr * this.settings.chochAtrBuffer
        : 0;
    const breakThreshold =
      direction === "long" ? pivotLevel + atrBuffer : pivotLevel - atrBuffer;
    const hasBufferedBreak =
      direction === "long"
        ? this.settings.bosConfirmation === "wicks"
          ? currentBar.h > breakThreshold
          : currentBar.c > breakThreshold
        : this.settings.bosConfirmation === "wicks"
          ? currentBar.l < breakThreshold
          : currentBar.c < breakThreshold;

    if (!hasBufferedBreak) {
      return false;
    }

    if (this.settings.chochBodyExpansionAtr > 0) {
      if (!Number.isFinite(currentAtr)) {
        return false;
      }
      const candleBody = Math.abs(currentBar.c - currentBar.o);
      if (candleBody < currentAtr * this.settings.chochBodyExpansionAtr) {
        return false;
      }
    }

    if (this.settings.chochVolumeGate > 0) {
      const baselineVolume = this.volumeSma[index];
      if (
        !Number.isFinite(baselineVolume) ||
        currentBar.v < baselineVolume * this.settings.chochVolumeGate
      ) {
        return false;
      }
    }

    return true;
  }

  private refreshRetroactiveFilterStates(
    changedAdxIndexes: number[],
    currentIndex: number,
  ): void {
    for (const changedIndex of changedAdxIndexes) {
      if (changedIndex >= currentIndex) {
        continue;
      }
      const structureEvent = this.structureEvents.find(
        (event) =>
          event.barIndex === changedIndex &&
          (event.eventType === "bullish_choch" ||
            event.eventType === "bearish_choch"),
      );
      if (!structureEvent) {
        continue;
      }

      const direction = structureEvent.direction === "long" ? 1 : -1;
      const filterState = buildFilterState(
        this.chartBars,
        changedIndex,
        direction,
        this.settings,
        this.adxState.result,
        this.volatilityScore,
        this.atrSmoothed,
        this.regimeDirectionAge,
      );
      structureEvent.filterState = filterState;

      this.syncSignalEventForStructure(structureEvent);
    }
  }

  private promoteNoLongerFinalBar(index: number): void {
    if (index < 0 || !this.isActionableIndex(index)) {
      return;
    }

    for (const structureEvent of this.structureEvents) {
      if (structureEvent.barIndex !== index || structureEvent.actionable) {
        continue;
      }
      structureEvent.actionable = true;
      this.syncSignalEventForStructure(structureEvent);
    }
  }

  private syncSignalEventForStructure(
    structureEvent: PyrusSignalsStructureEvent,
  ): void {
    if (
      structureEvent.eventType !== "bullish_choch" &&
      structureEvent.eventType !== "bearish_choch"
    ) {
      return;
    }
    if (!structureEvent.filterState) {
      return;
    }

    const existingSignalIndex = this.signalEvents.findIndex(
      (event) =>
        event.barIndex === structureEvent.barIndex &&
        event.direction === structureEvent.direction,
    );
    const shouldEmitSignal =
      structureEvent.filterState.passes && structureEvent.actionable;
    if (!shouldEmitSignal) {
      if (existingSignalIndex >= 0) {
        this.signalEvents.splice(existingSignalIndex, 1);
      }
      return;
    }

    const signalEvent = this.buildSignalEvent(
      structureEvent.barIndex,
      structureEvent.direction,
      structureEvent.filterState,
      structureEvent.actionable,
    );
    if (existingSignalIndex >= 0) {
      this.signalEvents[existingSignalIndex] = signalEvent;
      return;
    }

    const insertAt = this.signalEvents.findIndex(
      (event) => event.barIndex > structureEvent.barIndex,
    );
    if (insertAt === -1) {
      this.signalEvents.push(signalEvent);
      return;
    }
    this.signalEvents.splice(insertAt, 0, signalEvent);
  }

  private buildSignalEvent(
    index: number,
    eventDirection: PyrusSignalsDirection,
    filterState: PyrusSignalsFilterState,
    actionable: boolean,
  ): PyrusSignalsSignalEvent {
    const currentBar = this.chartBars[index];
    const signalPrice =
      eventDirection === "long"
        ? currentBar.l -
          (Number.isFinite(this.atrRaw[index])
            ? this.atrRaw[index] * this.settings.signalOffsetAtr
            : 0)
        : currentBar.h +
          (Number.isFinite(this.atrRaw[index])
            ? this.atrRaw[index] * this.settings.signalOffsetAtr
            : 0);
    return {
      id: `${
        eventDirection === "long" ? "buy" : "sell"
      }-${index}-${currentBar.time}`,
      eventType: eventDirection === "long" ? "buy_signal" : "sell_signal",
      direction: eventDirection,
      barIndex: index,
      time: currentBar.time,
      ts: toIso(currentBar),
      price: roundSix(signalPrice),
      close: currentBar.c,
      actionable,
      filtered: false,
      filterState,
    };
  }

  private isActionableIndex(index: number): boolean {
    return (
      this.includeProvisionalSignals ||
      !this.settings.waitForBarClose ||
      this.lastBarClosed ||
      index < this.chartBars.length - 1
    );
  }

  private refreshPaintSeries(): void {
    this.trendLine.fill(Number.NaN);
    for (const wires of [...this.bullWires, ...this.bearWires]) {
      wires.fill(Number.NaN);
    }
    for (let index = 0; index < this.chartBars.length; index += 1) {
      this.paintIndex(index);
    }
  }

  private paintIndex(index: number): void {
    this.trendLine[index] = Number.NaN;
    for (const wires of [...this.bullWires, ...this.bearWires]) {
      wires[index] = Number.NaN;
    }

    const activeRegimeDirection = this.regimeDirection[index];
    const activeTrendLine =
      activeRegimeDirection === 1
        ? this.lowerBand[index]
        : this.upperBand[index];
    const previousRegimeDirection =
      index > 0 ? this.regimeDirection[index - 1] : null;
    const regimeFlipped =
      previousRegimeDirection != null &&
      previousRegimeDirection !== activeRegimeDirection;
    if (
      !hasHardBarTimeGap(this.chartBars, index, this.intervals.value()) &&
      !regimeFlipped &&
      Number.isFinite(activeTrendLine)
    ) {
      this.trendLine[index] = activeTrendLine;
      const wireStep = Number.isFinite(this.atrSmoothed[index])
        ? this.atrSmoothed[index] * this.settings.wireSpread
        : Number.NaN;
      if (Number.isFinite(wireStep)) {
        const wireDirection = activeRegimeDirection === 1 ? -1 : 1;
        const wires =
          activeRegimeDirection === 1 ? this.bullWires : this.bearWires;
        wires[0][index] = roundSix(activeTrendLine + wireDirection * wireStep);
        wires[1][index] = roundSix(
          activeTrendLine + wireDirection * wireStep * 2,
        );
        wires[2][index] = roundSix(
          activeTrendLine + wireDirection * wireStep * 3,
        );
      }
    }
  }
}

export const createIncrementalPyrusSignalsEvaluator = (
  settings: PyrusSignalsSignalSettings,
  options: IncrementalPyrusSignalsEvaluationOptions = {},
): IncrementalPyrusSignalsEvaluator =>
  new IncrementalPyrusSignalsEvaluatorImpl(settings, options);
