// Assemble the files that actually need to be uploaded to a server.
//
//   node tools/pack.mjs [目标目录]        # 默认 dist/
//
// Only index.html, src/, vendor/ and assets/tex/ are served at runtime. The AI
// source art (assets/raw), the Python asset pipeline and the Playwright test
// tooling are all development-only and are deliberately left out: they are 136MB
// of the 172MB project and none of it is ever requested by a browser.
import { cpSync, existsSync, mkdirSync, rmSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.argv[2] || 'dist';
const DEST = join(ROOT, OUT);

const ITEMS = [
  'index.html',
  'src',
  'vendor',
  'assets/tex',
];

if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

let files = 0;
let bytes = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      files += 1;
      bytes += statSync(full).size;
    }
  }
}

for (const item of ITEMS) {
  const from = join(ROOT, item);
  if (!existsSync(from)) {
    console.error(`缺少 ${item},打包中止`);
    process.exit(1);
  }
  const to = join(DEST, item);
  const isDir = statSync(from).isDirectory();
  mkdirSync(isDir ? to : join(to, '..'), { recursive: true });
  cpSync(from, to, { recursive: true });
  if (isDir) {
    walk(to);
  } else {
    files += 1;
    bytes += statSync(from).size;
  }
}

// GitHub Pages runs Jekyll by default, which skips files and folders whose names
// start with an underscore. Nothing here does today, but the empty marker file is
// the documented way to turn that off, and it costs nothing.
writeFileSync(join(DEST, '.nojekyll'), '');

console.log(`已生成 ${OUT}/`);
console.log(`  ${files} 个文件,${(bytes / 1048576).toFixed(1)} MB`);
console.log('');
console.log('上传后由任意静态服务器托管即可,例如:');
console.log(`  nginx: 把 deploy/nginx.conf 里的 root 指向 ${OUT}/ 目录`);
console.log(`  临时:  python start_game.py 0.0.0.0 8000   (在 ${OUT}/ 目录下运行)`);
