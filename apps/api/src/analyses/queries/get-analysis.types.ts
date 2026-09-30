/** Input for {@link GetAnalysisHandler} after auth and id validation. */
export type GetAnalysisQuery = {
  ownerId: string;
  analysisId: string;
};
