import getProblemDetailsFunction from './getProblemDetails.function';

type Payload = { problemId: string };

/**
 * Backward-compatible RCA endpoint.
 *
 * RCA generation now has exactly one implementation: getProblemDetails.
 * Keeping this thin alias prevents older deployed UI bundles from invoking
 * the former duplicate RCA engine that caused HTTP 540 execution crashes.
 */
export default async function (payload: Payload) {
  return getProblemDetailsFunction(payload);
}
