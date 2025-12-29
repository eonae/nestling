import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Получает информацию о всех workspace пакетах
 */
function getAllWorkspacePackages() {
  const packagesDir = join(__dirname, 'packages');
  const packages = new Map();

  try {
    const packageDirs = readdirSync(packagesDir);
    
    packageDirs.forEach(dir => {
      const packagePath = join(packagesDir, dir);
      if (statSync(packagePath).isDirectory()) {
        const packageJsonPath = join(packagePath, 'package.json');
        
        // Проверяем, существует ли package.json
        try {
          statSync(packageJsonPath);
        } catch (error) {
          // Если package.json не существует, пропускаем эту директорию
          return;
        }
        
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
          packages.set(packageJson.name, {
            name: packageJson.name,
            path: packagePath,
            packageName: dir
          });
        } catch (error) {
          console.warn(`Не удалось прочитать package.json для ${dir}: ${error.message}`);
        }
      }
    });
  } catch (error) {
    console.warn('Не удалось прочитать директорию packages');
  }

  return packages;
}

/**
 * Автоматически генерирует moduleNameMapper для workspace зависимостей
 */
function generateWorkspaceModuleMapper(packageJsonPath) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const moduleMapper = {};
  
  // Получаем информацию о всех workspace пакетах
  const allPackages = getAllWorkspacePackages();

  // Находим все workspace зависимости
  Object.entries(dependencies).forEach(([name, version]) => {
    if (version.startsWith('workspace:')) {
      const packageInfo = allPackages.get(name);
      
      if (packageInfo) {
        // Маппим на исходные файлы для тестов
        moduleMapper[`^${name}$`] = `<rootDir>/../${packageInfo.packageName}/src/index.ts`;
      } else {
        console.warn(`Не удалось найти workspace пакет ${name}`);
      }
    }
  });

  return moduleMapper;
}

/**
 * Базовая конфигурация Jest для всех пакетов
 */
export function createJestConfig(fileUrl) {
  const packageJsonPath = join(dirname(fileURLToPath(fileUrl)), 'package.json');
  const workspaceMapper = generateWorkspaceModuleMapper(packageJsonPath);
  
  return {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
      '^.+\\.ts$': [
        'ts-jest',
        {
          useESM: true,
          tsconfig: {
            target: 'es2022',
            useDefineForClassFields: true,
            experimentalDecorators: false,
            emitDecoratorMetadata: false,
          },
        },
      ],
    },
    moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
      '^lodash-es$': 'lodash',
      ...workspaceMapper,
    },
  };
}
