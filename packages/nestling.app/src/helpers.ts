import type {
  AnyInput,
  AnyOutput,
  AnyPayload,
  EndpointDefinition,
  TransportCapabilities,
} from '@nestling/pipeline';
import type { ITransport } from '@nestling/transport';

/** Способности мока по умолчанию: всё, кроме потоков и файлов */
const VALUE_ONLY: TransportCapabilities = {
  input: new Set(['value']),
  output: new Set(['value']),
};

// Mock transport
export class MockTransport implements ITransport {
  endpoints: EndpointDefinition<any, any, any, never>[] = [];
  listening = false;
  closed = false;

  readonly capabilities: TransportCapabilities;

  constructor(
    private readonly onClose?: () => void,
    capabilities: TransportCapabilities = VALUE_ONLY,
  ) {
    this.capabilities = capabilities;
  }

  endpoint<
    I extends AnyPayload = AnyPayload,
    O extends AnyOutput = AnyOutput,
    P extends AnyInput = AnyInput,
  >(definition: EndpointDefinition<I, O, P, never>): void {
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
