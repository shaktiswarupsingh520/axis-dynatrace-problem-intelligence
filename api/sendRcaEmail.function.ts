import { workflowsClient } from '@dynatrace-sdk/client-automation';

type Payload = {
  to?: string[];
  cc?: string[];
  subject?: string;
  message?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Current live Axis RCA email workflow.
const WORKFLOW_ID = '47401efc-c932-42bc-91dc-384645f1d2bc';

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

const errorText = (cause: unknown): string => {
  if (cause instanceof Error && cause.message) return cause.message;
  if (cause && typeof cause === 'object') {
    const value = cause as Record<string, unknown>;
    const nested = value.message ?? value.error ?? value.details ?? value.response ?? value.body;
    if (typeof nested === 'string') return nested;
    try { return JSON.stringify(nested ?? value); } catch { return 'Unknown workflow execution error'; }
  }
  return String(cause ?? 'Unknown workflow execution error');
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

  try {
    const execution = await workflowsClient.runWorkflow({
      id: WORKFLOW_ID,
      body: {
        input: { to, cc, subject, message },
        params: {},
      },
      monitor: false,
    });

    return {
      accepted: true,
      workflowId: WORKFLOW_ID,
      executionId: execution.id ?? null,
      status: execution.state ?? 'ACCEPTED',
    };
  } catch (cause: unknown) {
    return {
      accepted: false,
      workflowId: WORKFLOW_ID,
      error: errorText(cause),
    };
  }
};
