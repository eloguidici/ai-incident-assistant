/** Default and bounds for analysis list pagination. */
export const Pagination = {
  DefaultLimit: 20,
  DefaultOffset: 0,
  MaxLimit: 50,
  MinLimit: 1,
  MaxOffset: 100_000,
} as const;

/** Characters shown in analysis list excerpts. */
export const AnalysisListExcerptLength = 180;
