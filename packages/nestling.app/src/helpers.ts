import type { EndpointDefinition, IMiddleware } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';

// Mock transport
export class MockTransport implements ITransport {
  endpoints: EndpointDefinition[] = [];
  middleware: IMiddleware[] = [];

  endpoint(definition: EndpointDefinition): void {
    this.endpoints.push(definition);
  }

  use(middleware: any): void {
    this.middleware.push(middleware);
  }

  async listen(): Promise<void> {
    // Mock
  }

  async close(): Promise<void> {
    // Mock
  }
}
