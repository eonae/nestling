import type {
  AnyInput,
  AnyMeta,
  AnyOutput,
  EndpointDefinition,
} from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';

// Mock transport
export class MockTransport implements ITransport {
  endpoints: EndpointDefinition<any, any, any>[] = [];

  endpoint<
    I extends AnyInput = AnyInput,
    O extends AnyOutput = AnyOutput,
    M extends AnyMeta = AnyMeta,
  >(definition: EndpointDefinition<I, O, M>): void {
    this.endpoints.push(definition);
  }

  async listen(): Promise<void> {
    // Mock
  }

  async close(): Promise<void> {
    // Mock
  }
}
