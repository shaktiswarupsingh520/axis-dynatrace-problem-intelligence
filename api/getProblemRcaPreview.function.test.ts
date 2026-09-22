import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import getProblemRcaPreview from './getProblemRcaPreview.function';

jest.mock('@dynatrace-sdk/client-classic-environment-v2', () => ({
  problemsClient: { getProblems: jest.fn() },
}));

describe('getProblemRcaPreview.function', () => {
  const mockedGetProblems = jest.mocked(problemsClient.getProblems);

  beforeEach(() => jest.clearAllMocks());

  it('returns a fast deterministic RCA preview from the Problems API', async () => {
    mockedGetProblems.mockResolvedValueOnce({
      totalCount: 1,
      problems: [{
        problemId: 'P-123',
        displayId: 'P-123',
        title: 'Failure rate increase',
        status: 'OPEN',
        severityLevel: 'ERROR',
        impactLevel: 'SERVICES',
        startTime: 1756800000000,
        endTime: -1,
        rootCauseEntity: { name: 'hermes', entityId: { id: 'SERVICE-123', type: 'SERVICE' } },
        affectedEntities: [{ name: 'notifier.api.axisb.com:8080', entityId: { id: 'SERVICE-456', type: 'SERVICE' } }],
        managementZones: [{ id: 'mz-1', name: 'NHIAcquirer_1261' }],
        evidenceDetails: { details: [{ displayName: 'Server response time', evidenceType: 'EVENT', rootCauseRelevant: true, entity: { name: 'notifier.api.axisb.com:8080' } }] },
        impactAnalysis: { impacts: [{ impactType: 'SERVICE', impactedEntity: { name: 'notifier.api.axisb.com:8080' } }] },
      }],
    } as never);

    mockedGetProblems.mockResolvedValueOnce({
      totalCount: 1,
      problems: [{
        problemId: 'P-122',
        displayId: 'P-122',
        title: 'Failure rate increase',
        status: 'CLOSED',
        severityLevel: 'ERROR',
        startTime: 1756700000000,
        endTime: 1756703600000,
        affectedEntities: [{ name: 'notifier.api.axisb.com:8080', entityId: { id: 'SERVICE-456', type: 'SERVICE' } }],
        managementZones: [{ id: 'mz-1', name: 'NHIAcquirer_1261' }],
      }],
    } as never);

    const result = await getProblemRcaPreview({ problemId: 'P-123' });

    expect(mockedGetProblems).toHaveBeenCalledTimes(2);
    expect(result.nativeRootCauseEntity).toBe('hermes');
    expect(result.problemAnalysis.rootCause).toBe('hermes');
    expect(result.problemAnalysis.confidence).toBe('High');
    expect(result.evidenceSummary.correlatedEvents).toBe(1);
    expect(result.occurrenceCount).toBe(1);
    expect(result.problemFacts.duration).toBe('0.0 h');
    expect(result.managementZones).toEqual(['NHIAcquirer_1261']);
  });

  it('does not invent a root cause when native Davis has none', async () => {
    mockedGetProblems.mockResolvedValue({
      totalCount: 1,
      problems: [{
        problemId: 'P-456',
        displayId: 'P-456',
        title: 'Failure rate increase',
        status: 'OPEN',
        severityLevel: 'ERROR',
        impactLevel: 'SERVICES',
        startTime: 1756800000000,
        endTime: -1,
        rootCauseEntity: null,
        affectedEntities: [],
        evidenceDetails: { details: [] },
        impactAnalysis: { impacts: [] },
      }],
    } as never);

    const result = await getProblemRcaPreview({ problemId: 'P-456' });

    expect(result.nativeRootCauseEntity).toBeNull();
    expect(result.problemAnalysis.rootCause).toBe('Not identified by Davis');
    expect(result.problemAnalysis.confidence).toBe('Not established');
    expect(result.analysis).toContain('Not established');
  });
});
