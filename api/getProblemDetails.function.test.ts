import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import getProblemDetailsFunction from './getProblemDetails.function';

jest.mock('@dynatrace-sdk/client-classic-environment-v2', () => ({
  problemsClient: {
    getProblem: jest.fn(),
  },
}));

describe('getProblemDetails.function', () => {
  const mockedGetProblem = jest.mocked(problemsClient.getProblem);

  beforeEach(() => jest.clearAllMocks());

  it('fetches detailed problem evidence and creates RCA synthesis', async () => {
    const problem = {
      problemId: 'P-123',
      title: 'CPU-request saturation on node',
      severityLevel: 'RESOURCE_CONTENTION',
      impactLevel: 'INFRASTRUCTURE',
      rootCauseEntity: { name: 'node-01' },
      evidenceDetails: {
        details: [
          {
            displayName: 'CPU-request saturation on node',
            evidenceType: 'RESOURCE_CONTENTION',
            entity: { name: 'node-01' },
            rootCauseRelevant: true,
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
    expect(result.problemAnalysis?.rootCause).toBe('node-01');
    expect(result.problemAnalysis?.probableCause).toContain('CPU resource saturation');
    expect(result.problemAnalysis?.remediation).toContain('CPU utilization');
    expect(result.problemAnalysis?.impactSummary).toContain('25');
  });

  it('rejects an empty problem id', async () => {
    await expect(getProblemDetailsFunction({ problemId: '' })).rejects.toThrow(
      'problemId is required',
    );
    expect(mockedGetProblem).not.toHaveBeenCalled();
  });
});
