import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import getProblemsFunction from './getProblems.function';

jest.mock('@dynatrace-sdk/client-classic-environment-v2', () => ({
  problemsClient: {
    getProblems: jest.fn(),
  },
}));

describe('getProblems.function', () => {
  const mockedGetProblems = jest.mocked(problemsClient.getProblems);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch problems newest first using the default timeframe', async () => {
    mockedGetProblems.mockResolvedValue({
      problems: [{ problemId: 'abc123', displayId: 'P-123456', title: 'Test problem' }],
      totalCount: 1,
      pageSize: 100,
    } as never);

    const result = await getProblemsFunction();

    expect(mockedGetProblems).toHaveBeenCalledWith({
      from: 'now-24h',
      to: 'now',
      problemSelector: undefined,
      pageSize: 100,
      sort: '-startTime',
    });
    expect(result.problems).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    expect(result.pageSize).toBe(100);
    expect(result.warnings).toEqual([]);
  });

  it('should combine a custom selector with a management zone selector', async () => {
    mockedGetProblems.mockResolvedValue({
      problems: [],
      totalCount: 0,
      pageSize: 50,
      nextPageKey: 'next-page',
      warnings: ['test warning'],
    } as never);

    const result = await getProblemsFunction({
      from: 'now-7d',
      to: 'now',
      problemSelector: 'status("OPEN")',
      managementZoneId: 'mz-123',
      pageSize: 50,
    });

    expect(mockedGetProblems).toHaveBeenCalledWith({
      from: 'now-7d',
      to: 'now',
      problemSelector: 'status("OPEN"),managementZoneIds("mz-123")',
      pageSize: 50,
      sort: '-startTime',
    });
    expect(result).toEqual({
      problems: [],
      totalCount: 0,
      nextPageKey: 'next-page',
      pageSize: 50,
      warnings: ['test warning'],
    });
  });
});
