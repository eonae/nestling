/* eslint-disable unicorn/no-process-exit */
/* eslint-disable no-console */

import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import type * as net from 'node:net';
import * as path from 'node:path';

export interface StaticServerOptions {
  /** Порт для запуска сервера */
  port: number;
  /** Путь к директории со статическими файлами */
  staticDir: string;
  /** Отключить кеширование (полезно для разработки) */
  disableCache?: boolean;
  /** Дополнительные HTTP заголовки */
  headers?: Record<string, string>;
  /** Таймаут для graceful shutdown в миллисекундах */
  shutdownTimeout?: number;
  /** Имя файла по умолчанию для директорий */
  indexFile?: string;
}

/** Карта MIME-типов для различных расширений файлов */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Универсальный HTTP сервер для обслуживания статических файлов
 * с поддержкой graceful shutdown
 */
export class StaticServer {
  private server: http.Server;
  private connections = new Set<net.Socket>();
  private isShuttingDown = false;
  private options: Required<StaticServerOptions>;

  constructor(options: StaticServerOptions) {
    this.options = {
      disableCache: false,
      headers: {},
      shutdownTimeout: 5000,
      indexFile: 'index.html',
      ...options,
    };

    // Создаём HTTP сервер
    this.server = http.createServer(async (request, response) => {
      try {
        await this.handleRequest(request, response);
      } catch (error) {
        console.error(`❌ Error handling request ${request.url}:`, error);
        this.sendError(response, 500, 'Internal Server Error');
      }
    });

    // Отслеживаем соединения для graceful shutdown
    this.server.on('connection', (socket) => {
      this.connections.add(socket);
      socket.on('close', () => {
        this.connections.delete(socket);
      });
    });

    this.setupGracefulShutdown();
  }

  /**
   * Запускает сервер на указанном порту
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.options.port, (err?: Error) => {
        if (err) {
          reject(err);

          return;
        }

        console.log(
          `🚀 Static server started on http://localhost:${this.options.port}`,
        );
        console.log(`📁 Serving directory: ${this.options.staticDir}`);
        resolve();
      });
    });
  }

  /**
   * Останавливает сервер
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isShuttingDown) {
        resolve();
        return;
      }

      this.isShuttingDown = true;
      console.log('🛑 Stopping static server...');

      // Устанавливаем таймаут для принудительного завершения
      const forceShutdownTimeout = setTimeout(() => {
        console.log('❌ Shutdown timeout reached. Forcing shutdown...');
        this.forceCloseConnections();
        reject(new Error('Shutdown timeout'));
      }, this.options.shutdownTimeout);

      // Закрываем сервер
      this.server.close((err) => {
        clearTimeout(forceShutdownTimeout);

        if (err) {
          console.error('❌ Error stopping server:', err.message);
          reject(err);
        } else {
          console.log('✅ Static server stopped');
          resolve();
        }
      });

      // Принудительно закрываем активные соединения
      this.forceCloseConnections();
    });
  }

  /**
   * Получает информацию о сервере
   */
  getInfo(): {
    port: number;
    staticDir: string;
    isListening: boolean;
    activeConnections: number;
    isShuttingDown: boolean;
  } {
    return {
      port: this.options.port,
      staticDir: this.options.staticDir,
      isListening: this.server.listening,
      activeConnections: this.connections.size,
      isShuttingDown: this.isShuttingDown,
    };
  }

  /**
   * Принудительно закрывает все активные соединения
   */
  private forceCloseConnections(): void {
    if (this.connections.size > 0) {
      console.log(`🔌 Closing ${this.connections.size} active connections...`);
      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();
    }
  }

  /**
   * Обрабатывает HTTP запрос
   */
  private async handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const url = request.url || '/';
    const method = request.method || 'GET';

    // Поддерживаем только GET запросы
    if (method !== 'GET') {
      return this.sendError(response, 405, 'Method Not Allowed');
    }

    // Удаляем query parameters и декодируем URL
    const pathname = decodeURIComponent(url.split('?')[0]);

    // Защита от path traversal атак
    if (pathname.includes('..') || pathname.includes('\0')) {
      return this.sendError(response, 400, 'Bad Request');
    }

    const filePath = this.resolveFilePath(pathname);

    try {
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        // Если это директория, ищем index файл
        const indexPath = path.join(filePath, this.options.indexFile);
        try {
          const indexStats = await fs.stat(indexPath);
          if (indexStats.isFile()) {
            return this.serveFile(indexPath, response);
          }
        } catch {
          // Index файл не найден
        }
        return this.sendError(response, 404, 'Not Found');
      } else if (stats.isFile()) {
        return this.serveFile(filePath, response);
      } else {
        return this.sendError(response, 404, 'Not Found');
      }
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return this.sendError(response, 404, 'Not Found');
      } else if ((error as any).code === 'EACCES') {
        return this.sendError(response, 403, 'Forbidden');
      } else {
        throw error;
      }
    }
  }

  /**
   * Определяет полный путь к файлу
   */
  private resolveFilePath(pathname: string): string {
    // Убираем ведущий слеш и нормализуем путь
    const relativePath = pathname.startsWith('/')
      ? pathname.slice(1)
      : pathname;
    return path.join(this.options.staticDir, relativePath);
  }

  /**
   * Обслуживает файл
   */
  private async serveFile(
    filePath: string,
    response: http.ServerResponse,
  ): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const stats = await fs.stat(filePath);
    const content = await fs.readFile(filePath);

    // Устанавливаем заголовки
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': stats.size.toString(),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...this.options.headers,
    };

    // Заголовки кеширования
    if (this.options.disableCache) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    } else {
      headers['Cache-Control'] = 'public, max-age=3600'; // 1 час
      headers['Last-Modified'] = stats.mtime.toUTCString();
    }

    response.writeHead(200, headers);
    response.end(content);
  }

  /**
   * Отправляет ошибку
   */
  private sendError(
    response: http.ServerResponse,
    statusCode: number,
    message: string,
  ): void {
    response.writeHead(statusCode, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    response.end(`${statusCode} ${message}`);
  }

  /**
   * Настраивает graceful shutdown при получении сигналов
   */
  private setupGracefulShutdown(): void {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const gracefulShutdown = async () => {
      if (this.isShuttingDown) {
        console.log('\n⚠️  Force shutdown...');
        process.exit(1);
      }

      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        console.error('❌ Error stopping server:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
  }
}
