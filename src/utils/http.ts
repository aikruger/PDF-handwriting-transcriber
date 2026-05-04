import { requestUrl, RequestUrlParam } from 'obsidian';

export async function remoteJsonRequest(options: RequestUrlParam): Promise<any> {
  const response = await requestUrl(options);

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
    throw error;
  }

  return responseBody;
}

export async function localJsonRequest(options: RequestUrlParam): Promise<any> {
  return remoteJsonRequest(options);
}
