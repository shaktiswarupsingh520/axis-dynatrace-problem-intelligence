import { appSettingsObjectsClient } from '@dynatrace-sdk/client-app-settings-v2';
import { workflowsClient } from '@dynatrace-sdk/client-automation';
import sendRcaEmail from './sendRcaEmail.function';

jest.mock('@dynatrace-sdk/client-app-settings-v2', () => ({
  appSettingsObjectsClient: {
    getEffectiveAppSettingsValues: jest.fn(),
  },
}));

jest.mock('@dynatrace-sdk/client-automation', () => ({
  workflowsClient: {
    runWorkflow: jest.fn(),
  },
}));

describe('sendRcaEmail.function', () => {
  const getSettings = jest.mocked(appSettingsObjectsClient.getEffectiveAppSettingsValues);
  const runWorkflow = jest.mocked(workflowsClient.runWorkflow);

  beforeEach(() => {
    jest.clearAllMocks();
    getSettings.mockResolvedValue({
      items: [{ value: { workflowId: '123e4567-e89b-12d3-a456-426614174000' } }],
    } as never);
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

    expect(getSettings).toHaveBeenCalledWith({ schemaId: 'rca-email-config' });
    expect(runWorkflow).toHaveBeenCalledWith({
      id: '123e4567-e89b-12d3-a456-426614174000',
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

  it('rejects invalid recipients', async () => {
    await expect(sendRcaEmail({
      to: ['bad-address'],
      subject: 'Test',
      message: 'RCA',
    })).rejects.toThrow('Invalid To email address');
  });
});
