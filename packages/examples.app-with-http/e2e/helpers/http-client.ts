/**
 * Простой HTTP клиент для e2e тестов
 */
export class HttpClient {
  constructor(private baseUrl: string) {}

  async get(path: string, headers?: Record<string, string>): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers,
    });
  }

  async post(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete(path: string, headers?: Record<string, string>): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers,
    });
  }

  async upload(
    path: string,
    file: { name: string; content: Buffer; type: string },
  ): Promise<Response> {
    const formData = new FormData();
    const blob = new Blob([file.content], { type: file.type });
    formData.append('avatar', blob, file.name);

    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      body: formData,
    });
  }
}

