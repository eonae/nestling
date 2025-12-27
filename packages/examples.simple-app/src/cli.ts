import { writeFile } from 'node:fs/promises';

import { makeContainer } from './container';

export const main = async () => {
  const container = await makeContainer();

  const metadata = await container.toJSON();
  const json = JSON.stringify(metadata, null, 2);

  await writeFile('di-metadata.json', json);
};

// eslint-disable-next-line no-console
main().catch(console.error);
