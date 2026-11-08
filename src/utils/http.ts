import { requestUrl, RequestUrlParam } from 'obsidian';
import { Logger } from './logger';

export async function remoteJsonRequest(options: RequestUrlParam): Promise<any> {
  const reqOptions = { ...options, throw: false };
  const response = await requestUrl(reqOptions);

  let responseBody: any = null;
  try {
    responseBody = response.json;
  } catch {
    responseBody = null;
  }

  if (response.status < 200 || response.status >= 300) {
    const apiMessage =
      responseBody?.error?.message ||
      responseBody?.message ||
      responseBody?.error ||
      `HTTP Error ${response.status}`;

    const error = new Error(apiMessage) as Error & {
      status?: number;
      responseBody?: any;
    };

    error.status = response.status;
    error.responseBody = responseBody;

    Logger.error('Request', 'Failed HTTP request', {
        url: options.url,
        status: response.status,
        category: getErrorCategory(response.status),
        retryable: isRetryable(response.status)
    });

    throw error;
  }

  return responseBody;
}

export async function localJsonRequest(options: RequestUrlParam): Promise<any> {
  return remoteJsonRequest(options);
}

function getErrorCategory(status: number): string {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status === 402) return 'insufficient_credit';
    if (status >= 500) return 'server';
    return 'client';
}

function isRetryable(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
}
