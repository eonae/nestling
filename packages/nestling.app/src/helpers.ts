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
  listening = false;
  closed = false;

  constructor(private readonly onClose?: () => void) {}

  endpoint<
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(definition: EndpointDefinition<I, O, P>): void {
    this.endpoints.push(definition);
  }

  async listen(): Promise<void> {
    this.listening = true;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.onClose?.();
  }
}
