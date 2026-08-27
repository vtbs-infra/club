import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const markdownFiles = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

function stripFencedCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

function headingSlugs(markdown: string): Set<string> {
  const occurrences = new Map<string, number>();
  const slugs = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(?: {0,3})#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    const heading = match?.[1];
    if (!heading) continue;
    const base = heading
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[`*_~]/g, '')
      .replace(/[^\p{L}\p{N}\- _]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    const count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}

const headingsByFile = new Map<string, Set<string>>();
const failures: string[] = [];

for (const markdownFile of markdownFiles) {
  const absoluteFile = resolve(markdownFile);
  const markdown = readFileSync(absoluteFile, 'utf8');
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of stripFencedCode(markdown).matchAll(linkPattern)) {
    const matchedTarget = match[1];
    if (!matchedTarget) continue;
    const rawTarget = matchedTarget.trim().replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(rawTarget)) continue;

    const parts = rawTarget.split('#', 2);
    const rawPath = parts[0] ?? '';
    const rawFragment = parts[1];
    let decodedPath: string;
    let decodedFragment: string | undefined;
    try {
      decodedPath = decodeURIComponent(rawPath);
      decodedFragment = rawFragment === undefined ? undefined : decodeURIComponent(rawFragment);
    } catch {
      failures.push(`${markdownFile}: invalid encoded link ${rawTarget}`);
      continue;
    }

    const targetFile = rawPath ? resolve(dirname(absoluteFile), decodedPath) : absoluteFile;
    if (!existsSync(targetFile)) {
      failures.push(`${markdownFile}: missing target ${rawTarget}`);
      continue;
    }

    if (decodedFragment && extname(targetFile).toLowerCase() === '.md') {
      let slugs = headingsByFile.get(targetFile);
      if (!slugs) {
        slugs = headingSlugs(readFileSync(targetFile, 'utf8'));
        headingsByFile.set(targetFile, slugs);
      }
      if (!slugs.has(decodedFragment.toLowerCase())) {
        failures.push(`${markdownFile}: missing heading ${rawTarget}`);
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Documentation link check failed:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${markdownFiles.length} Markdown files.\n`);
}
