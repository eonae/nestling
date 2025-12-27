import { writeFile } from 'node:fs/promises';

import { makeContainer } from './container';

export const main = async () => {
  const container = await makeContainer();

  await writeFile(
    'di-metadata.json',
    JSON.stringify(await container.toJSON(), null, 2),
  );
};

// eslint-disable-next-line no-console
main().catch(console.error);
