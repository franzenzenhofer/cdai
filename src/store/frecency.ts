export const HOUR_SECONDS = 3600;
export const DAY_SECONDS = 86_400;
export const WEEK_SECONDS = 604_800;

/** zoxide's aging multipliers. */
export const AGE_WEIGHT = {
  withinHour: 4,
  withinDay: 2,
  withinWeek: 0.5,
  older: 0.25,
} as const;

/** Above this total visit count the whole db is aged down, mirroring zoxide's maintenance step. */
export const AGING_THRESHOLD = 9000;
export const AGING_FACTOR = 0.9;
export const AGING_DROP_BELOW = 1.0;

export interface VisitRecord {
  readonly path: string;
  /** Canonical identity deduplicates logical and physical spellings of the same directory. */
  readonly realPath?: string;
  readonly visits: number;
  readonly lastVisit: number;
}

export const ageWeight = (ageSeconds: number): number => {
  if (ageSeconds < HOUR_SECONDS) return AGE_WEIGHT.withinHour;
  if (ageSeconds < DAY_SECONDS) return AGE_WEIGHT.withinDay;
  if (ageSeconds < WEEK_SECONDS) return AGE_WEIGHT.withinWeek;
  return AGE_WEIGHT.older;
};

export const frecency = (record: VisitRecord, nowSeconds: number): number =>
  record.visits * ageWeight(Math.max(0, nowSeconds - record.lastVisit));

export const totalVisits = (records: readonly VisitRecord[]): number =>
  records.reduce((sum, r) => sum + r.visits, 0);

export const needsAging = (records: readonly VisitRecord[]): boolean =>
  totalVisits(records) > AGING_THRESHOLD;

export const applyAging = (records: readonly VisitRecord[]): VisitRecord[] =>
  records
    .map((r) => ({ ...r, visits: r.visits * AGING_FACTOR }))
    .filter((r) => r.visits >= AGING_DROP_BELOW);
