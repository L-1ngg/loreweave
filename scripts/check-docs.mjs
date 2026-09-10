import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  cwd: root, encoding: 'utf8',
}).split('\0').filter((file) => file.endsWith('.md') && existsSync(resolve(root, file))))];
const failures = [];
let checked = 0;
for (const file of files) {
  // Migration snapshots retain their original links and are not current instructions.
  if (file.startsWith('.scratch/rag-v1/') && file !== '.scratch/rag-v1/README.md') continue;
  const body = readFileSync(resolve(root, file), 'utf8');
  const prose = body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  for (const match of prose.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
    const href = match[1];
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/')) continue;
    const [relative, fragment] = href.split('#');
    const target = relative
      ? resolve(root, dirname(file), decodeURIComponent(relative))
      : resolve(root, file);
    checked++;
    if (!existsSync(target)) {
      failures.push(`${file}: missing ${href}`);
      continue;
    }
    if (fragment && target.endsWith('.md')) {
      const counts = new Map();
      const anchors = [...readFileSync(target, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map((heading) => {
        const base = heading[1].toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replaceAll(' ', '-');
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        return count ? `${base}-${count}` : base;
      });
      if (!anchors.includes(decodeURIComponent(fragment))) failures.push(`${file}: missing anchor ${href}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${checked} local links across ${files.length} Markdown files (historical snapshots excluded).`);
}
