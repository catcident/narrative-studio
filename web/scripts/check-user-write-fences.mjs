import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceDirectory = path.resolve(scriptDirectory, '../src');
const durableUserCollections = [
  'knowledgeGraphs',
  'knowledgeGraphVersions',
  'novels',
  'entityEmbeddings',
  'chunkEmbeddings',
];
const collectionPattern = new RegExp(`['"](?:${durableUserCollections.join('|')})['"]`);
const mutationPattern = /\.(?:insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|replaceOne|findOneAndUpdate|findOneAndDelete|findOneAndReplace|bulkWrite)\s*\(/;

async function findSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findSourceFiles(absolutePath);
    return entry.isFile() && /\.(?:ts|tsx|js)$/.test(entry.name) ? [absolutePath] : [];
  }));
  return nested.flat();
}

const allowedSessionOnlyHelpers = new Set([
  path.resolve(sourceDirectory, 'lib/versionHistory.ts'),
]);
const sourceFiles = await findSourceFiles(sourceDirectory);
const violations = [];
for (const sourceFile of sourceFiles) {
  if (sourceFile.endsWith(path.join('internal', 'account-withdrawal', 'route.ts'))) continue;
  const source = await readFile(sourceFile, 'utf8');
  if (!collectionPattern.test(source) || !mutationPattern.test(source)) continue;
  if (allowedSessionOnlyHelpers.has(sourceFile)) {
    if (!source.includes('session: ClientSession') || !source.includes('{ session }')) {
      violations.push(path.relative(path.resolve(scriptDirectory, '..'), sourceFile));
    }
    continue;
  }
  if (!source.includes('runWithSubjectWriteFence')) {
    violations.push(path.relative(path.resolve(scriptDirectory, '..'), sourceFile));
  }
}

if (violations.length > 0) {
  console.error('[write-fence] User-scoped mutation source is missing the shared fence/session contract:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('[write-fence] All discovered user-scoped mutations use the shared commit fence/session contract.');
}
