import { gzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const kib = 1024;

type Asset = {
  name: string;
  bytes: number;
  gzipBytes: number;
};

async function assetsFor(surface: 'console-web' | 'forge-web'): Promise<Asset[]> {
  const directory = resolve(root, 'apps', surface, 'build', 'client', 'assets');
  const names = await readdir(directory);
  return Promise.all(
    names
      .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
      .map(async (name) => {
        const content = await readFile(resolve(directory, name));
        return { name, bytes: content.byteLength, gzipBytes: gzipSync(content).byteLength };
      }),
  );
}

function assertBudget(label: string, actual: number, maximum: number) {
  if (actual > maximum) {
    throw new Error(`${label} exceeded: ${actual} bytes > ${maximum} bytes`);
  }
}

const consoleAssets = await assetsFor('console-web');
const forgeAssets = await assetsFor('forge-web');
const graphChunk = consoleAssets.find(
  (asset) => asset.name.startsWith('MemoryGraph3D.client-') && asset.name.endsWith('.js'),
);
if (!graphChunk) throw new Error('lazy MemoryGraph3D chunk is missing');
const organizationControlChunk = consoleAssets.find(
  (asset) =>
    asset.name.startsWith('OrganizationControlPanel.client-') && asset.name.endsWith('.js'),
);
if (!organizationControlChunk) throw new Error('lazy OrganizationControlPanel chunk is missing');

const consoleInitialJs = consoleAssets
  .filter(
    (asset) =>
      asset.name.endsWith('.js') && asset !== graphChunk && asset !== organizationControlChunk,
  )
  .reduce((total, asset) => total + asset.gzipBytes, 0);
const forgeInitialJs = forgeAssets
  .filter((asset) => asset.name.endsWith('.js'))
  .reduce((total, asset) => total + asset.gzipBytes, 0);
const consoleCss = consoleAssets
  .filter((asset) => asset.name.endsWith('.css'))
  .reduce((total, asset) => total + asset.gzipBytes, 0);
const forgeCss = forgeAssets
  .filter((asset) => asset.name.endsWith('.css'))
  .reduce((total, asset) => total + asset.gzipBytes, 0);

assertBudget('Console initial JavaScript gzip', consoleInitialJs, 125 * kib);
assertBudget('Forge initial JavaScript gzip', forgeInitialJs, 125 * kib);
assertBudget('Console CSS gzip', consoleCss, 20 * kib);
assertBudget('Forge CSS gzip', forgeCss, 20 * kib);
assertBudget('Memory graph lazy JavaScript gzip', graphChunk.gzipBytes, 150 * kib);
assertBudget(
  'Organization control lazy JavaScript gzip',
  organizationControlChunk.gzipBytes,
  20 * kib,
);

console.log(
  JSON.stringify({
    status: 'ok',
    budgets: {
      consoleInitialJsGzipBytes: consoleInitialJs,
      forgeInitialJsGzipBytes: forgeInitialJs,
      consoleCssGzipBytes: consoleCss,
      forgeCssGzipBytes: forgeCss,
      memoryGraphLazyJsGzipBytes: graphChunk.gzipBytes,
      organizationControlLazyJsGzipBytes: organizationControlChunk.gzipBytes,
    },
  }),
);
