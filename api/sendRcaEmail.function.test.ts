import { workflowsClient } from '@dynatrace-sdk/client-automation';
import sendRcaEmail from './sendRcaEmail.function';

jest.mock('@dynatrace-sdk/client-automation', () => ({
  workflowsClient: {
    runWorkflow: jest.fn(),
  },
}));

describe('sendRcaEmail.function', () => {
  const runWorkflow = jest.mocked(workflowsClient.runWorkflow);

  beforeEach(() => {
    jest.clearAllMocks();
    runWorkflow.mockResolvedValue({
      id: 'execution-123',
      state: 'RUNNING',
    } as never);
  });

  it('validates recipients and runs the configured workflow', async () => {
    const result = await sendRcaEmail({
      to: ['owner@axisbank.com'],
      cc: ['manager@axisbank.com'],
      subject: 'Dynatrace RCA | P-123',
      message: 'RCA body',
    });

    expect(runWorkflow).toHaveBeenCalledWith({
      id: '476401cf-c932-42bc-91dc-380465f1d2bc',
      body: {
        input: {
          to: ['owner@axisbank.com'],
          cc: ['manager@axisbank.com'],
          subject: 'Dynatrace RCA | P-123',
          message: 'RCA body',
        },
        params: {},
      },
      monitor: false,
    });
    expect(result.accepted).toBe(true);
    expect(result.executionId).toBe('execution-123');
  });

  it('returns the workflow error instead of crashing the function', async () => {
    runWorkflow.mockRejectedValue(new Error('Forbidden: workflow access denied'));

    const result = await sendRcaEmail({
      to: ['owner@axisbank.com'],
      subject: 'Dynatrace RCA | P-123',
      message: 'RCA body',
    });

    expect(result).toEqual({
      accepted: false,
      workflowId: '476401cf-c932-42bc-91dc-380465f1d2bc',
      error: 'Forbidden: workflow access denied',
    });
  });

  it('rejects invalid recipients', async () => {
    await expect(sendRcaEmail({
      to: ['bad-address'],
      subject: 'Test',
      message: 'RCA',
    })).rejects.toThrow('Invalid To email address');
  });
});
