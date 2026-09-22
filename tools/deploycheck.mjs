// Deployment self-check for 熊二的世界 — pure HTTP, no browser.
//
//   node tools/deploycheck.mjs https://user.github.io/repo/
//   node tools/deploycheck.mjs http://127.0.0.1:8910/my-repo/index.html
//
// It loads nothing but the deployed files, so it can run anywhere and has no
// window to steal focus. It checks the things a static host actually gets wrong:
//
//   - a referenced file that 404s
//   - a filename whose case does not match (Windows hides this, Pages is Linux)
//   - an absolute path that escapes the /<repo>/ prefix
//   - a .js served with a MIME type the browser refuses to run as a module
//
// Exit code 0 means the deployment is sound.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';

const ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const INPUT = process.argv[2];
if (!INPUT) {
  console.error('用法: node tools/deploycheck.mjs <网址或本地目录>');
  process.exit(1);
}

/** Collect every path the browser will request, from the source of truth. */
function collectRefs() {
  const refs = new Set();
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) refs.add(m[1]);

  const srcDir = join(ROOT, 'src');
  for (const file of readdirSync(srcDir)) {
    const text = readFileSync(join(srcDir, file), 'utf8');
    for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      refs.add(posix.normalize(posix.join('src', m[1])));
    }
  }
  const assets = readFileSync(join(srcDir, 'assets.js'), 'utf8');
  for (const m of assets.matchAll(/^\s*\w+: '([\w]+)',/gm)) refs.add(`assets/tex/${m[1]}.png`);
  return [...refs].filter((r) => !r.startsWith('data:') && !r.startsWith('#'));
}

const isUrl = /^https?:\/\//.test(INPUT);
const base = isUrl
  ? new URL(INPUT.endsWith('/') ? INPUT : INPUT.replace(/[^/]*$/, ''), INPUT).href
  : new URL(`file:///${INPUT.replace(/\\/g, '/').replace(/\/?$/, '/')}`).href;

const refs = collectRefs();
const failures = [];
const warnings = [];
let total = 0;
let escaped = 0;

async function get(url) {
  if (url.startsWith('file:')) {
    const body = readFileSync(fileURLToPath(url));
    return { status: 200, body, type: '' };
  }
  const res = await fetch(url, { redirect: 'follow' });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body, type: res.headers.get('content-type') || '' };
}

// index.html itself first
const indexUrl = new URL('index.html', base).href;
const index = await get(indexUrl);
if (index.status !== 200) failures.push(`index.html -> ${index.status}`);
else total += index.body.length;
console.log(`站点      ${base}`);
console.log(`index.html ${index.status}  ${(index.body.length / 1024).toFixed(1)} KB`);

for (const ref of refs) {
  const url = new URL(ref, base).href;
  if (isUrl && !url.startsWith(base)) {
    escaped += 1;
    failures.push(`跳出部署前缀: ${ref}`);
    continue;
  }
  let res;
  try {
    res = await get(url);
  } catch (e) {
    failures.push(`${ref} -> 请求失败 ${e.message}`);
    continue;
  }
  if (res.status !== 200) {
    failures.push(`${ref} -> ${res.status}`);
    continue;
  }
  total += res.body.length;
  if (ref.endsWith('.js') && res.type && !/javascript|ecmascript/i.test(res.type)) {
    failures.push(`${ref} 的 MIME 是 "${res.type}",ES module 会被浏览器拒绝执行`);
  }
  if (res.body.length === 0) warnings.push(`${ref} 是 0 字节`);
}

console.log(`资源      ${refs.length} 个引用,合计 ${(total / 1048576).toFixed(1)} MB`);
if (escaped) console.log(`前缀      有 ${escaped} 个引用跳出了 ${base}`);
for (const w of warnings) console.log(`警告      ${w}`);
if (failures.length) {
  console.log('');
  console.log('失败项:');
  for (const f of failures) console.log('  - ' + f);
}
console.log('');
console.log(failures.length === 0 ? '✅ 部署自检通过:路径、大小写、MIME 都正常' : `❌ 部署自检未通过(${failures.length} 项)`);
process.exitCode = failures.length === 0 ? 0 : 1;
