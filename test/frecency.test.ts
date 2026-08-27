import { describe, expect, it } from 'vitest';
import {
  AGE_WEIGHT,
  AGING_THRESHOLD,
  DAY_SECONDS,
  HOUR_SECONDS,
  WEEK_SECONDS,
  ageWeight,
  applyAging,
  frecency,
  needsAging,
  totalVisits,
  type VisitRecord,
} from '../src/store/frecency.js';

const NOW = 1_800_000_000;
const record = (visits: number, ago: number): VisitRecord => ({
  path: '/x',
  visits,
  lastVisit: NOW - ago,
});

describe('ageWeight', () => {
  it('uses the zoxide buckets', () => {
    expect(ageWeight(0)).toBe(AGE_WEIGHT.withinHour);
    expect(ageWeight(HOUR_SECONDS - 1)).toBe(AGE_WEIGHT.withinHour);
    expect(ageWeight(HOUR_SECONDS)).toBe(AGE_WEIGHT.withinDay);
    expect(ageWeight(DAY_SECONDS)).toBe(AGE_WEIGHT.withinWeek);
    expect(ageWeight(WEEK_SECONDS)).toBe(AGE_WEIGHT.older);
  });
});

describe('frecency', () => {
  it('multiplies visits by the age weight', () => {
    expect(frecency(record(10, 0), NOW)).toBe(40);
    expect(frecency(record(10, DAY_SECONDS), NOW)).toBe(5);
    expect(frecency(record(10, WEEK_SECONDS * 2), NOW)).toBe(2.5);
  });

  it('treats a future timestamp as just visited', () => {
    expect(frecency({ path: '/x', visits: 1, lastVisit: NOW + HOUR_SECONDS }, NOW)).toBe(
      AGE_WEIGHT.withinHour,
    );
  });

  it('ranks a fresh rare visit above a stale frequent one', () => {
    expect(frecency(record(3, 0), NOW)).toBeGreaterThan(frecency(record(10, WEEK_SECONDS * 4), NOW));
  });
});

describe('aging', () => {
  it('triggers above the threshold only', () => {
    expect(needsAging([record(AGING_THRESHOLD, 0)])).toBe(false);
    expect(needsAging([record(AGING_THRESHOLD + 1, 0)])).toBe(true);
  });

  it('scales everything down and drops the noise', () => {
    const aged = applyAging([record(100, 0), { path: '/y', visits: 1, lastVisit: NOW }]);
    expect(aged).toHaveLength(1);
    expect(aged[0]?.visits).toBeCloseTo(90);
  });

  it('sums visits across records', () => {
    expect(totalVisits([record(2, 0), { path: '/y', visits: 3, lastVisit: NOW }])).toBe(5);
  });
});
