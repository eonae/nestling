import { E2E_TOKEN } from './create-test-app';

/** Запросы e2e-тестов: обёртка над `fetch` с заголовком авторизации по флагу */
export class HttpClient {
  constructor(private readonly baseUrl: string) {}

  get(path: string, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, { headers });
  }

  json(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options: { auth?: boolean; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.auth ? { authorization: `Bearer ${E2E_TOKEN}` } : {}),
        ...options.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  raw(
    method: 'POST',
    path: string,
    body: string | FormData,
    headers: Record<string, string> = {},
    auth = false,
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${E2E_TOKEN}` } : {}),
        ...headers,
      },
      body,
    });
  }
}
