import { AppModule } from './app.module';
import { LoggingModule } from './logging';

import type { BuiltContainer } from '@nestling/container';
import { ContainerBuilder } from '@nestling/container';

export const makeContainer = async (): Promise<BuiltContainer> => {
  return await new ContainerBuilder()
    .register(LoggingModule)
    .register(AppModule)
    .build();
};
