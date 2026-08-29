import { StaticServer } from '@common/static-server';
import * as path from 'path';
import * as fs from 'fs/promises';
import open from 'open';

/**
 * Основная функция визуализации:
 * 1. Копирует файл с графом в статическую директорию
 * 2. Запускает статический HTTP сервер
 * 3. Открывает браузер
 */
export interface VisualizationOptions {
  port?: number;
  graphFile: string;
  silent?: boolean;
  openBrowser?: boolean;
}

export const visualize = async (
  options: VisualizationOptions,
): Promise<void> => {
  const {
    port = 3333,
    graphFile,
    silent = false,
    openBrowser = true,
  } = options;

  const toolsDir = path.dirname(new URL(import.meta.url).pathname);
  const staticDir = path.join(toolsDir, 'static');
  const targetPath = path.join(staticDir, 'data', 'graph-data.json');

  if (!silent) {
    console.log('🔍 Copying graph data...');
  }

  try {
    // Создаем директорию data если её нет
    await fs.mkdir(path.join(staticDir, 'data'), { recursive: true });

    // Копируем файл с графом в статическую директорию
    await fs.copyFile(graphFile, targetPath);

    if (!silent) {
      console.log('✅ Graph data copied to static directory');
    }
  } catch (error) {
    if (!silent) {
      console.error('❌ Failed to copy graph data:', error);
    }
    throw error;
  }

  // Создаём и запускаем статический сервер
  const server = new StaticServer({
    port,
    staticDir,
    disableCache: true, // отключаем кеш для разработки
    shutdownTimeout: 5000,
  });

  try {
    await server.start();

    if (!silent) {
      console.log('📊 Starting 3D dependency graph visualization...');
    }

    const url = `http://localhost:${port}`;

    // Автоматически открываем браузер, если это запрошено
    if (openBrowser) {
      if (!silent) {
        console.log('🌐 Opening visualization in browser...');
      }
      await open(url);
    }

    return new Promise(() => {
      // Держим сервер запущенным
      process.on('SIGINT', async () => {
        if (!silent) {
          console.log('\n👋 Shutting down visualization server...');
        }
        await server.stop();
        process.exit(0);
      });
    });
  } catch (error) {
    if (!silent) {
      console.error('❌ Server startup error:', error);
    }
    throw error;
  }
};
