import { requestUrl, RequestUrlParam } from 'obsidian';

/**
 * Standardized JSON request utility that uses Obsidian's requestUrl
 */
export async function remoteJsonRequest(options: RequestUrlParam): Promise<any> {
  const response = await requestUrl(options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP Error ${response.status}`);
  }
  return response.json;
}

/**
 * Convenience method for local connections that could be changed to fetch later if needed.
 * Currently uses requestUrl for consistency.
 */
export async function localJsonRequest(options: RequestUrlParam): Promise<any> {
  return remoteJsonRequest(options);
}
