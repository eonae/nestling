import type { EndpointDefinition } from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';

// Mock transport
export class MockTransport implements ITransport {
  endpoints: EndpointDefinition<any, any, any>[] = [];

  endpoint<TInput, TMeta, TOutput>(
    definition: EndpointDefinition<TInput, TMeta, TOutput>,
  ): void {
    this.endpoints.push(definition as EndpointDefinition<any, any, any>);
  }

  async listen(): Promise<void> {
    // Mock
  }

  async close(): Promise<void> {
    // Mock
  }
}
