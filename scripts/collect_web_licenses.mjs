import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, 'public', 'licenses');
await fs.mkdir(destination, { recursive: true });
const inventory = [];
const seen = new Set();
const noticeName = /^(licen[cs]e|copying|notice|copyright|thirdpartynotices)([._-]|$)/i;

async function packagesIn(modulesDirectory) {
  let entries;
  try { entries = await fs.readdir(modulesDirectory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const directory = path.join(modulesDirectory, entry.name);
    if (entry.name.startsWith('@')) {
      for (const child of await fs.readdir(directory, { withFileTypes: true })) {
        if (child.isDirectory()) result.push(path.join(directory, child.name));
      }
    } else result.push(directory);
  }
  return result;
}

async function collectPackage(directory) {
  let metadata;
  try { metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const id = `${metadata.name}@${metadata.version}`;
  if (!seen.has(id)) {
    seen.add(id);
    const safeId = id.replace(/[^a-z0-9._-]/gi, '_');
    const files = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && noticeName.test(entry.name)) {
        const target = path.join(destination, 'npm', safeId, entry.name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(path.join(directory, entry.name), target);
        files.push(path.relative(destination, target).split(path.sep).join('/'));
      }
    }
    inventory.push({ name: metadata.name, version: metadata.version, license: metadata.license || null,
      repository: metadata.repository?.url || metadata.repository || metadata.homepage || null, notice_files: files });
  }
  for (const child of await packagesIn(path.join(directory, 'node_modules'))) await collectPackage(child);
}

for (const directory of await packagesIn(path.join(root, 'node_modules'))) await collectPackage(directory);
await fs.cp(path.join(root, 'licenses', 'browser'), path.join(destination, 'upstream'), { recursive: true });
for (const entry of await fs.readdir(path.join(root, 'licenses'), { withFileTypes: true })) {
  if (entry.name === 'browser') continue;
  await fs.cp(path.join(root, 'licenses', entry.name), path.join(destination, entry.name), { recursive: true });
}
await fs.copyFile(path.join(root, 'THIRD_PARTY.md'), path.join(destination, 'THIRD_PARTY.md'));
await fs.writeFile(path.join(destination, 'inventory.json'), JSON.stringify({
  scope: 'Paquetes instalados durante la construcción; incluye herramientas que no se distribuyen en tiempo de ejecución.',
  packages: inventory.sort((a, b) => a.name.localeCompare(b.name)),
}, null, 2));
console.log(`Avisos web recopilados: ${inventory.length} paquetes.`);
