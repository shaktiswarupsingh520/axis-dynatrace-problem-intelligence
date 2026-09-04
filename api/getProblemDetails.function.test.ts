import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import getProblemDetailsFunction from './getProblemDetails.function';

jest.mock('@dynatrace-sdk/client-classic-environment-v2', () => ({
  problemsClient: {
    getProblem: jest.fn(),
  },
}));

jest.mock('@dynatrace-sdk/client-query', () => ({
  queryExecutionClient: {
    queryExecute: jest.fn(),
    queryPoll: jest.fn(),
  },
}));

describe('getProblemDetails.function', () => {
  const mockedGetProblem = jest.mocked(problemsClient.getProblem);
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
    mockedGetProblem.mockResolvedValue(problem as never);

    const result = await getProblemDetailsFunction({ problemId: 'P-123' });

    expect(mockedGetProblem).toHaveBeenCalledWith({
      problemId: 'P-123',
      fields: 'evidenceDetails,impactAnalysis,recentComments',
    });
    expect(mockedQueryExecute).toHaveBeenCalledTimes(2);
    expect(result.problemAnalysis?.rootCause).toBe('node-01');
    expect(result.problemAnalysis?.rootCauseEntityId).toBe('HOST-123');
    expect(result.problemAnalysis?.rootCauseEntityType).toBe('host');
    expect(result.problemAnalysis?.probableCause).toContain('node-01');
    expect(result.problemAnalysis?.probableCause).toContain('CPU usage exceeded');
    expect(result.problemAnalysis?.confidence).toBe('High');
    expect(result.problemAnalysis?.analysisReady).toBe(true);
  });

  it('does not invent a root cause when Dynatrace has not exposed one', async () => {
    mockedGetProblem.mockResolvedValue({
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
    } as never);

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

  it('rejects an empty problem id', async () => {
    await expect(getProblemDetailsFunction({ problemId: '' })).rejects.toThrow(
      'problemId is required',
    );
    expect(mockedGetProblem).not.toHaveBeenCalled();
  });
});
