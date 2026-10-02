import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const violations = [];
let checked = 0;

function boundary(file) {
  const parts = file.split(path.sep);
  if (parts[0] === 'domain' || parts[0] === 'application') return parts[0];
  if (parts[0] === 'adapters') return parts.slice(0, 3).join('/');
  return ['main.ts', 'main.tsx', 'app.module.ts'].includes(file) ? 'composition' : 'unknown';
}

function allows(source, target) {
  if (source === 'composition') return true;
  if (source === 'domain') return target === 'domain';
  if (source === 'application') return target === 'domain' || target === 'application';
  return target === 'domain' || target === 'application' || target === source;
}

async function inspect(directory, sourceRoot) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(file, sourceRoot);
      continue;
    }
    if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    checked++;
    const location = path.relative(root, file);
    const source = boundary(path.relative(sourceRoot, file));
    if (source === 'unknown') violations.push(`${location}: place this module in an architecture boundary`);
    const core = source === 'domain' || source === 'application';
    const content = await readFile(file, 'utf8');
    const imports = [
      ...content.matchAll(/^(?:import|export)\s+(?:[^;'"`]*?\s+from\s*)?['"]([^'"]+)['"]/gm),
      ...content.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ];
    for (const [, name] of imports) {
      if (name.startsWith('.')) {
        const targetFile = path.resolve(path.dirname(file), name);
        const relative = path.relative(sourceRoot, targetFile);
        const target = boundary(relative);
        const resource = !core && name.endsWith('.json');
        if (source !== 'composition' && !resource && (relative.startsWith('..') || !allows(source, target))) {
          violations.push(`${location}: ${source} cannot import ${name}`);
        }
      } else if (core && !name.startsWith('node:')) {
        violations.push(`${location}: core cannot import external dependency ${name}`);
      }
    }
    if (core && /\bfetch\s*\(/.test(content)) {
      violations.push(`${location}: network calls belong in an outbound adapter`);
    }
    if (core && /\bprocess\.env\b/.test(content)) {
      violations.push(`${location}: environment configuration belongs outside the core`);
    }
  }
}

for (const app of ['api', 'web']) {
  const sourceRoot = path.join(root, 'apps', app, 'src');
  await inspect(sourceRoot, sourceRoot);
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${checked} production modules respect the hexagonal boundaries.`);
}
