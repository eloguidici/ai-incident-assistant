/** CQRS query: load one owned analysis detail. */
export class GetAnalysisQuery {
  /**
   * @param ownerId Authenticated analyst id.
   * @param analysisId Analysis id from the route.
   */
  constructor(
    public readonly ownerId: string,
    public readonly analysisId: string,
  ) {}
}
