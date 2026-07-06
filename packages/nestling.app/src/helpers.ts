import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
} from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';

// Mock transport
export class MockTransport implements ITransport {
  endpoints: EndpointDefinition<any, any, any>[] = [];

  endpoint<
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(definition: EndpointDefinition<I, O, P>): void {
    this.endpoints.push(definition);
  }

  async listen(): Promise<void> {
    // Mock
  }

  async close(): Promise<void> {
    // Mock
  }
}
