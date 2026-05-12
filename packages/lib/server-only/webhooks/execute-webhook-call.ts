import type { Prisma } from '@prisma/client';

import { fetchWithTimeout } from '../../utils/timeout';
import { assertNotPrivateUrl } from './assert-webhook-url';

const WEBHOOK_TIMEOUT_MS = 10_000;

// D2DHQ fork: retry transient failures so a deploy bounce or a 5-second
// blip on the consumer doesn't drop the webhook permanently. Delays grow
// 500ms → 2s → 5s. Total worst-case wall time ~7.5s plus per-attempt
// timeouts; acceptable for a server-side dispatcher.
const RETRY_DELAYS_MS = [500, 2_000, 5_000] as const;

export type WebhookCallResult = {
  success: boolean;
  responseCode: number;
  responseBody: Prisma.InputJsonValue | Prisma.JsonNullValueInput;
  responseHeaders: Record<string, string>;
};

const parseBody = (text: string): Prisma.InputJsonValue => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A "transient" failure deserves a retry: network/DNS errors (status 0)
// or any 5xx from the consumer. 4xx is a client mistake (auth, payload
// shape) that won't fix itself on retry — return immediately so the
// operator sees the error in webhook logs.
const isTransientFailure = (result: WebhookCallResult): boolean => {
  if (result.success) return false;
  if (result.responseCode === 0) return true;
  return result.responseCode >= 500 && result.responseCode <= 599;
};

const performWebhookCall = async (options: {
  url: string;
  body: unknown;
  secret: string | null;
}): Promise<WebhookCallResult> => {
  const { url, body, secret } = options;

  try {
    await assertNotPrivateUrl(url);

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      body: JSON.stringify(body),
      redirect: 'manual',
      timeoutMs: WEBHOOK_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Secret': secret ?? '',
      },
    });

    const text = await response.text();

    return {
      success: response.ok,
      responseCode: response.status,
      responseBody: parseBody(text),
      responseHeaders: Object.fromEntries(response.headers.entries()),
    };
  } catch (err) {
    return {
      success: false,
      responseCode: 0,
      responseBody: err instanceof Error ? err.message : 'Unknown error',
      responseHeaders: {},
    };
  }
};

export const executeWebhookCall = async (options: {
  url: string;
  body: unknown;
  secret: string | null;
}): Promise<WebhookCallResult> => {
  let lastResult = await performWebhookCall(options);
  if (!isTransientFailure(lastResult)) {
    return lastResult;
  }

  for (const delayMs of RETRY_DELAYS_MS) {
    await sleep(delayMs);
    lastResult = await performWebhookCall(options);
    if (!isTransientFailure(lastResult)) {
      return lastResult;
    }
  }

  return lastResult;
};

// Exported for tests; not part of the public API.
export const __internals = { isTransientFailure, RETRY_DELAYS_MS };
