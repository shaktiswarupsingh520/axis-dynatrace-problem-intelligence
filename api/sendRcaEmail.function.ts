import { appSettingsObjectsClient } from '@dynatrace-sdk/client-app-settings-v2';
import { workflowsClient } from '@dynatrace-sdk/client-automation';

type Payload = {
  to?: string[];
  cc?: string[];
  subject?: string;
  message?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WORKFLOW_SCHEMA_ID = 'rca-email-config';

const normalizeRecipients = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean),
  )];
};

const validateRecipients = (field: string, recipients: string[]): void => {
  if (recipients.length > 10) throw new Error(`${field} supports a maximum of 10 recipients.`);
  const invalid = recipients.filter((recipient) => !EMAIL_PATTERN.test(recipient));
  if (invalid.length) throw new Error(`Invalid ${field} email address: ${invalid[0]}`);
};

export default async function (payload: Payload = {}) {
  const to = normalizeRecipients(payload.to);
  const cc = normalizeRecipients(payload.cc);
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const message = typeof payload.message === 'string' ? payload.message : '';

  if (!to.length) throw new Error('At least one To recipient is required.');
  validateRecipients('To', to);
  validateRecipients('Cc', cc);
  if (!subject) throw new Error('Email subject is required.');
  if (!message.trim()) throw new Error('Email message is required.');
  if (message.length > 256 * 1024) throw new Error('Email message exceeds the Dynatrace email action limit of 256 KiB.');

  const settings = await appSettingsObjectsClient.getEffectiveAppSettingsValues({
    schemaId: WORKFLOW_SCHEMA_ID,
  });
  const workflowId = settings.items?.[0]?.value && typeof settings.items[0].value === 'object'
    ? (settings.items[0].value as Record<string, unknown>).workflowId
    : undefined;

  if (typeof workflowId !== 'string' || !/^[0-9a-f-]{36}$/i.test(workflowId.trim())) {
    throw new Error('RCA email workflow is not configured. Set the live workflow UUID in the RCA email workflow app setting.');
  }

  const execution = await workflowsClient.runWorkflow({
    id: workflowId.trim(),
    body: {
      input: { to, cc, subject, message },
      params: {},
    },
    monitor: false,
  });

  return {
    accepted: true,
    workflowId: workflowId.trim(),
    executionId: execution.id ?? null,
    status: execution.state ?? execution.status ?? 'ACCEPTED',
  };
};
