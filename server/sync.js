import fs from 'node:fs';
import path from 'node:path';
import { getTestsFolderPath, importTestsFromFolder } from './importer.js';

export function parseGithubRepoUrl(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) return null;

  // Match "owner/repo"
  const shortMatch = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2], subPath: '' };
  }

  // Match "https://github.com/owner/repo" or ".../tree/branch/subpath"
  try {
    const url = new URL(raw);
    if (!url.hostname.includes('github.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, '');
    let subPath = '';
    if (parts[2] === 'tree' && parts.length > 4) {
      subPath = decodeURIComponent(parts.slice(4).join('/'));
    }
    return { owner, repo, subPath };
  } catch {
    return null;
  }
}

export async function syncFromGithub(db, repoInput, folderPath = getTestsFolderPath()) {
  const parsed = parseGithubRepoUrl(repoInput);
  if (!parsed) {
    throw new Error('Неверная ссылка на GitHub-репозиторий (пример: https://github.com/user/tests)');
  }

  fs.mkdirSync(folderPath, { recursive: true });

  const encodedSubPath = parsed.subPath
    ? parsed.subPath.split('/').map(encodeURIComponent).join('/')
    : '';
  const apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodedSubPath}`;
  const res = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AltynTests-ClassroomQuiz',
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub ответил ошибкой (${res.status}). Проверьте, что репозиторий публичный.`);
  }

  const items = await res.json();
  if (!Array.isArray(items)) {
    throw new Error('Указанный путь на GitHub не является папкой');
  }

  const checkStmt = db.prepare('SELECT id FROM tests WHERE source_file = ?');
  let downloaded = 0;

  for (const item of items) {
    if (item.type !== 'file' || !item.download_url) continue;
    const ext = path.extname(item.name).toLowerCase();
    if (!['.txt', '.md', '.json', '.docx'].includes(ext)) continue;

    // Skip if already imported
    if (checkStmt.get(item.name)) continue;

    const fileRes = await fetch(item.download_url, {
      headers: { 'User-Agent': 'AltynTests-ClassroomQuiz' },
    });
    if (!fileRes.ok) continue;

    const buf = Buffer.from(await fileRes.arrayBuffer());
    fs.writeFileSync(path.join(folderPath, item.name), buf);
    downloaded++;
  }

  const importResult = importTestsFromFolder(db, folderPath);
  return {
    downloaded,
    ...importResult,
  };
}
