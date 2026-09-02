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

  it('fetches detailed problem evidence and impact data', async () => {
    const problem = { problemId: 'P-123', title: 'Host unavailable' };
    mockedGetProblem.mockResolvedValue(problem as never);

    const result = await getProblemDetailsFunction({ problemId: 'P-123' });

    expect(mockedGetProblem).toHaveBeenCalledWith({
      problemId: 'P-123',
      fields: 'evidenceDetails,impactAnalysis,recentComments',
    });
    expect(result).toEqual(problem);
  });

  it('rejects an empty problem id', async () => {
    await expect(getProblemDetailsFunction({ problemId: '' })).rejects.toThrow(
      'problemId is required',
    );
    expect(mockedGetProblem).not.toHaveBeenCalled();
  });
});
