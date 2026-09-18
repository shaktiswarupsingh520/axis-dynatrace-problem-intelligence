import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import getProblemDetailsFunction from './getProblemDetails.function';

jest.mock('@dynatrace-sdk/client-classic-environment-v2', () => ({
  problemsClient: {
    getProblems: jest.fn(),
  },
}));

jest.mock('@dynatrace-sdk/client-query', () => ({
  queryExecutionClient: {
    queryExecute: jest.fn(),
    queryPoll: jest.fn(),
  },
}));

describe('getProblemDetails.function', () => {
  const mockedGetProblems = jest.mocked(problemsClient.getProblems);
  const mockedQueryExecute = jest.mocked(queryExecutionClient.queryExecute);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedQueryExecute.mockImplementation(async ({ body }) => {
      if (body.query.includes('fetch dt.davis.events')) {
        return {
          state: 'SUCCEEDED',
          result: {
            records: [
              {
                'event.id': 'event-1',
                'event.name': 'CPU saturation',
                'event.description': 'CPU usage exceeded the baseline on node-01',
                'event.start': '2026-09-02T12:00:00Z',
                'event.category': 'RESOURCE_CONTENTION',
                'event.severity': 2,
                'dt.smartscape_source.id': 'HOST-123',
                'dt.smartscape_source.type': 'host',
                'dt.davis.is_rootcause_relevant': true,
              },
            ],
          },
        } as never;
      }

      return {
        state: 'SUCCEEDED',
        result: {
          records: [
            {
              display_id: 'P-123',
              'event.name': 'CPU saturation',
              'event.description': 'CPU usage exceeded the baseline on node-01',
              'dt.analysis.ready': true,
              'dt.davis.event_ids': ['event-1'],
              'dt.davis.affected_users_count': 25,
              'root_cause.smartscape_entity': {
                id: 'HOST-123',
                type: 'host',
                name: 'node-01',
              },
            },
          ],
        },
      } as never;
    });
  });

  it('uses authoritative Grail root-cause entity and causal Davis event', async () => {
    const problem = {
      problemId: 'P-123',
      title: 'CPU-request saturation on node',
      rootCauseEntity: 'node-01',
      rootCauseEntityId: 'HOST-123',
      severityLevel: 'RESOURCE_CONTENTION',
      impactLevel: 'INFRASTRUCTURE',
      evidenceDetails: {
        details: [
          {
            displayName: 'CPU-request saturation on node',
            evidenceType: 'RESOURCE_CONTENTION',
            entity: { name: 'node-01' },
            rootCauseRelevant: false,
          },
        ],
      },
      impactAnalysis: {
        impacts: [
          {
            impactType: 'INFRASTRUCTURE',
            impactedEntity: { name: 'node-01' },
            estimatedAffectedUsers: 25,
          },
        ],
      },
    };
    mockedGetProblems.mockResolvedValue({ totalCount: 1, problems: [problem as never] });

    const result = await getProblemDetailsFunction({ problemId: 'P-123' });

    expect(mockedGetProblems).toHaveBeenCalledWith({
      from: 'now-365d',
      to: 'now',
      pageSize: 1,
      problemSelector: 'displayId("P-123")',
      fields: 'evidenceDetails,impactAnalysis,recentComments',
    });
    expect(mockedQueryExecute).toHaveBeenCalled();
    expect(
      mockedQueryExecute.mock.calls.some(([request]) =>
        request.body.query.includes('fetch dt.davis.problems')
      ),
    ).toBe(true);
    expect(
      mockedQueryExecute.mock.calls.some(([request]) =>
        request.body.query.includes('fetch dt.davis.events')
      ),
    ).toBe(true);
    expect(result.problemAnalysis?.rootCause).toBe('node-01');
    expect(result.problemAnalysis?.rootCauseEntityId).toBe('HOST-123');
    expect(result.problemAnalysis?.rootCauseEntityType).toBe('host');
    expect(result.problemAnalysis?.probableCause).toContain('node-01');
    expect(result.problemAnalysis?.probableCause).toContain('node-01');
    expect(result.problemAnalysis?.confidence).toBe('High');
    expect(result.problemAnalysis?.analysisReady).toBe(true);
  });



  it('prefers the native Davis root-cause name over a Grail entity id or secondary name', async () => {
    mockedGetProblems.mockResolvedValue({ totalCount: 1, problems: [{
      problemId: 'P-789',
      title: 'Failure rate increase',
      rootCauseEntity: {
        name: 'hermes',
        entityId: { id: 'SERVICE-604A2FB4275E32CA', type: 'SERVICE' },
      },
      evidenceDetails: { details: [] },
      impactAnalysis: { impacts: [] },
    }] } as never);

    mockedQueryExecute.mockImplementation(async ({ body }) => {
      if (body.query.includes('fetch dt.davis.events')) {
        return {
          state: 'SUCCEEDED',
          result: { records: [] },
        } as never;
      }
      return {
        state: 'SUCCEEDED',
        result: {
          records: [
            {
              display_id: 'P-789',
              'event.name': 'Failure rate increase',
              'dt.analysis.ready': true,
              'dt.davis.event_ids': [],
              'root_cause.smartscape_entity': {
                id: 'SERVICE-604A2FB4275E32CA',
                type: 'service',
                name: 'SERVICE-604A2FB4275E32CA',
              },
            },
          ],
        },
      } as never;
    });

    const result = await getProblemDetailsFunction({ problemId: 'P-789' });

    expect(result.nativeRootCauseEntity).toBe('hermes');
    expect(result.problemAnalysis?.rootCause).toBe('hermes');
    expect(result.problemAnalysis?.rootCauseEntityId).toBe('SERVICE-604A2FB4275E32CA');
    expect(result.problemAnalysis?.rootCauseEntityType).toBe('SERVICE');
    expect(result.definitiveRootCause).toBe(true);
  });

  it('does not fall back to Grail when native Davis explicitly reports no root cause', async () => {
    mockedGetProblems.mockResolvedValue({ totalCount: 1, problems: [{
      problemId: 'P-790',
      title: 'Failure rate increase',
      rootCauseEntity: null,
      rootCauseEntityId: null,
      evidenceDetails: { details: [] },
      impactAnalysis: { impacts: [] },
    }] } as never);

    mockedQueryExecute.mockImplementation(async ({ body }) => {
      if (body.query.includes('fetch dt.davis.events')) {
        return {
          state: 'SUCCEEDED',
          result: { records: [] },
        } as never;
      }
      return {
        state: 'SUCCEEDED',
        result: {
          records: [
            {
              display_id: 'P-790',
              'event.name': 'Failure rate increase',
              'dt.analysis.ready': true,
              'root_cause.smartscape_entity': {
                id: 'SERVICE-FAKE',
                type: 'service',
                name: 'fake-grail-root',
              },
            },
          ],
        },
      } as never;
    });

    const result = await getProblemDetailsFunction({ problemId: 'P-790' });

    expect(result.nativeRootCauseEntity).toBeNull();
    expect(result.problemAnalysis?.rootCause).toBe('No definitive root-cause entity exposed yet');
    expect(result.problemAnalysis?.rootCauseEntityId).toBeUndefined();
    expect(result.definitiveRootCause).toBe(false);
  });

  it('builds an evidence-first deterministic RCA without AI-generated metric claims', async () => {
    mockedGetProblems.mockResolvedValue({
      totalCount: 1,
      problems: [{
        problemId: 'P-801',
        title: 'Failure rate increase',
        rootCauseEntity: {
          name: 'hermes',
          entityId: { id: 'SERVICE-604A2FB4275E32CA', type: 'SERVICE' },
        },
        managementZones: [{ id: 'mz-1', name: 'NHIAcquirer_1261' }],
        evidenceDetails: { details: [] },
        impactAnalysis: { impacts: [] },
      }],
    } as never);

    mockedQueryExecute.mockImplementation(async ({ body }) => {
      if (body.query.includes('fetch dt.davis.events')) {
        return {
          state: 'SUCCEEDED',
          result: {
            records: [{
              'event.id': 'event-801',
              'event.name': 'Server response time',
              'event.description': 'Root-cause relevant Davis event',
              'event.start': '2026-09-18T11:45:00Z',
              'dt.smartscape_source.id': 'SERVICE-604A2FB4275E32CA',
              'dt.smartscape_source.type': 'SERVICE',
              'dt.davis.is_rootcause_relevant': true,
            }],
          },
        } as never;
      }
      if (body.query.includes('fetch dt.davis.problems.snapshots')) {
        return {
          state: 'SUCCEEDED',
          result: { records: [{ timestamp: '2026-09-18T11:45:00Z', event: { status: 'ACTIVE' } }] },
        } as never;
      }
      if (body.query.includes('fetch dt.davis.problems')) {
        return {
          state: 'SUCCEEDED',
          result: {
            records: [{
              display_id: 'P-801',
              'event.id': 'event-801',
              'event.name': 'Failure rate increase',
              'event.status': 'CLOSED',
              'event.severity': 'ERROR',
              'event.category': 'ERROR',
              'event.start': '2026-09-18T11:45:00Z',
              'event.end': '2026-09-18T11:51:00Z',
              'dt.analysis.ready': true,
              'dt.davis.event_ids': ['event-801'],
              'dt.davis.affected_users_count': 12,
              affected_entity_ids: ['SERVICE-604A2FB4275E32CA'],
              affected_entity_names: ['notifier.api.axisb.com:8080'],
            }],
          },
        } as never;
      }
      return { state: 'SUCCEEDED', result: { records: [] } } as never;
    });

    const result = await getProblemDetailsFunction({ problemId: 'P-801' });

    expect(result.analysis).toContain('## Root Cause Assessment');
    expect(result.analysis).toContain('hermes');
    expect(result.analysis).toContain('SERVICE-604A2FB4275E32CA');
    expect(result.analysis).toContain('Duration: 6.0 min');
    expect(result.analysis).toContain('Affected users: 12');
    expect(result.analysis).not.toContain('53 ms');
    expect(result.analysis).not.toContain('92 ms');
    expect(result.managementZones).toEqual(['NHIAcquirer_1261']);
    expect(result.problemAnalysis?.fullRca).toBe(result.analysis);
  });

  it('does not invent a root cause when Dynatrace has not exposed one', async () => {
    mockedGetProblems.mockResolvedValue({ totalCount: 1, problems: [{
      problemId: 'P-456',
      title: 'Failure rate increase',
      impactLevel: 'SERVICES',
      evidenceDetails: {
        details: [
          {
            displayName: 'Failure rate increased on checkout',
            evidenceType: 'ERROR',
            entity: { name: 'checkout-service' },
          },
        ],
      },
    }] } as never);

    mockedQueryExecute.mockResolvedValue({
      state: 'SUCCEEDED',
      result: {
        records: [
          {
            display_id: 'P-456',
            'event.description': 'Failure rate increased on checkout',
            'dt.analysis.ready': false,
            'dt.davis.event_ids': [],
          },
        ],
      },
    } as never);

    const result = await getProblemDetailsFunction({ problemId: 'P-456' });

    expect(result.problemAnalysis?.rootCause).toBe('No definitive root-cause entity exposed yet');
    expect(result.problemAnalysis?.confidence).toBe('Pending Davis analysis');
    expect(result.problemAnalysis?.probableCause).toContain('This is evidence, not a confirmed root cause');
  });

  it('returns JSON-safe RCA data when DQL contains BigInt values', async () => {
    mockedGetProblems.mockResolvedValue({
      problems: [{
        problemId: 'P-800',
        title: 'Serialization test',
        rootCauseEntity: null,
        evidenceDetails: { details: [] },
        impactAnalysis: { impacts: [] },
      }],
    } as never);

    mockedQueryExecute.mockImplementation(async ({ body }) => {
      if (body.query.includes('fetch dt.davis.events')) {
        return { state: 'SUCCEEDED', result: { records: [] } } as never;
      }
      return {
        state: 'SUCCEEDED',
        result: {
          records: [{
            display_id: 'P-800',
            'event.name': 'Serialization test',
            'dt.analysis.ready': true,
            'dt.davis.event_ids': [],
            syntheticBigInt: 123n,
          }],
        },
      } as never;
    });

    const result = await getProblemDetailsFunction({ problemId: 'P-800' });

    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('rejects an empty problem id', async () => {
    await expect(getProblemDetailsFunction({ problemId: '' })).rejects.toThrow(
      'problemId is required',
    );
    expect(mockedGetProblems).not.toHaveBeenCalled();
  });
});
