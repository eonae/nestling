import type { HandlerConfig, Transport } from './interfaces.js';

/**
 * Класс приложения, управляющий транспортами
 */
export class App {
  private readonly transports = new Map<string, Transport>();

  /**
   * Создает экземпляр App с транспортами
   * @param transports - объект с транспортами {name: transport}
   */
  constructor(transports: Record<string, Transport>) {
    for (const [name, transport] of Object.entries(transports)) {
      this.transports.set(name, transport);
    }
  }

  /**
   * Регистрирует handler в указанном транспорте
   */
  registerHandler(config: HandlerConfig): void {
    const transport = this.transports.get(config.transport);
    if (!transport) {
      throw new Error(
        `Transport "${config.transport}" not found. Available transports: ${[...this.transports.keys()].join(', ')}`,
      );
    }

    transport.registerHandler(config);
  }

  /**
   * Запускает все транспорты
   */
  async listen(): Promise<void> {
    const promises = [...this.transports.values()].map((transport) =>
      transport.listen(),
    );
    await Promise.all(promises);
  }

  /**
   * Останавливает все транспорты
   */
  async close(): Promise<void> {
    const promises = [...this.transports.values()]
      .filter((transport) => transport.close)
      .map((transport) => {
        const closeMethod = transport.close;
        if (closeMethod) {
          return closeMethod();
        }
        return Promise.resolve();
      });
    await Promise.all(promises);
  }
}
