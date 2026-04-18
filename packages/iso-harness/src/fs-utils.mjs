import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

export async function writeJson(filePath, obj) {
  await writeFile(filePath, JSON.stringify(obj, null, 2) + '\n');
}
