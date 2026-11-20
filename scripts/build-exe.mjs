import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const clientDist = path.join(rootDir, 'client', 'dist');
const outDir = path.join(rootDir, 'dist-exe');

if (!fs.existsSync(clientDist)) {
  console.error('Сначала выполните npm run build (папка client/dist не найдена).');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// 1. Collect all files from client/dist
function walkDir(dir, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files = files.concat(walkDir(full, rel));
    } else {
      files.push({ rel, full });
    }
  }
  return files;
}

const distFiles = walkDir(clientDist);
const mapEntries = distFiles
  .map(({ rel, full }) => {
    const b64 = fs.readFileSync(full).toString('base64');
    return `  [${JSON.stringify(rel)}, Buffer.from(${JSON.stringify(b64)}, 'base64')]`;
  })
  .join(',\n');

const entryCode = `import { startServer } from '../server/index.js';

const embeddedAssets = new Map([
${mapEntries}
]);

startServer({ embeddedAssets, openBrowser: true });
`;

const entryPath = path.join(outDir, 'sea-entry.mjs');
fs.writeFileSync(entryPath, entryCode, 'utf8');

// 2. Bundle with esbuild
const esbuildBin = path.join(
  rootDir,
  'client',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild'
);
const bundlePath = path.join(outDir, 'bundle.cjs');

console.log('1/4 Сборка единого серверного бандла...');
execFileSync(
  esbuildBin,
  [
    entryPath,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node24',
    `--outfile=${bundlePath}`,
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' }
);

// 3. Create SEA blob
const seaConfigPath = path.join(outDir, 'sea-config.json');
const blobPath = path.join(outDir, 'sea-prep.blob');
fs.writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
    },
    null,
    2
  ),
  'utf8'
);

console.log('2/4 Генерация SEA-блоба...');
execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
  stdio: 'inherit',
});

// 4. Copy node.exe and inject blob
const exePath = path.join(outDir, 'Тесты_Алтын_Каппасовны.exe');
fs.copyFileSync(process.execPath, exePath);

// Remove Windows Authenticode signature if present in PE Optional Header DataDirectory[4]
stripPeSignature(exePath);

console.log('3/4 Внедрение приложения в .exe...');
const postjectCli = path.join(rootDir, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(
  process.execPath,
  [
    postjectCli,
    exePath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit' }
);

console.log(`\n4/4 Готово! Файл создан:\n  ${exePath}\n`);

/**
 * Clears the PE Certificate Table entry (DataDirectory[4]) so postject can
 * inject into a copied signed node.exe without requiring Windows SDK signtool.
 */
function stripPeSignature(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.readUInt16LE(0) !== 0x5a4d) return; // MZ
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOffset) !== 0x00004550) return; // PE\0\0
  const magic = buf.readUInt16LE(peOffset + 24);
  // PE32+ (64-bit) = 0x20b, PE32 (32-bit) = 0x10b
  const certDirOffset = magic === 0x20b ? peOffset + 24 + 112 + 4 * 8 : peOffset + 24 + 96 + 4 * 8;
  const certRva = buf.readUInt32LE(certDirOffset);
  const certSize = buf.readUInt32LE(certDirOffset + 4);
  if (certRva !== 0 || certSize !== 0) {
    buf.writeUInt32LE(0, certDirOffset);
    buf.writeUInt32LE(0, certDirOffset + 4);
    fs.writeFileSync(filePath, buf);
  }
}
