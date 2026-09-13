import { createEslintConfig } from '../../.config/eslint.config.js';

export default createEslintConfig(import.meta.url, { published: false });
