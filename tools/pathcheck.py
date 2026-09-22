# Check every path the browser will request: it must be relative (a GitHub Pages
# project site is served from /<repo>/, not from the domain root) and its filename
# case must match exactly (Pages runs on Linux; Windows would hide a mismatch).
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

refs = set()
problems = []

html = open('index.html', encoding='utf-8').read()
for m in re.finditer(r'(?:src|href)="([^"]+)"', html):
    refs.add(m.group(1))
# module imports, resolved relative to the importing file
for path in glob.glob('src/*.js'):
    text = open(path, encoding='utf-8').read()
    for m in re.finditer(r"""from\s+['"]([^'"]+)['"]""", text):
        refs.add(os.path.normpath(os.path.join('src', m.group(1))))
    if re.search(r"from\s+['\"]/", text):
        problems.append(f'{path}: 绝对路径 import')

# textures, via the TEXTURES table in assets.js
assets = open('src/assets.js', encoding='utf-8').read()
for name in re.findall(r"^\s*\w+: '([\w]+)',", assets, re.M):
    refs.add('assets/tex/%s.png' % name)

# absolute URLs on purpose?
for m in re.finditer(r'(?:src|href)="(https?:)?//[^"]*"', html):
    problems.append('外链资源: ' + m.group(0))
for m in re.finditer(r'["\'](/[^"\']*)["\']', html):
    if m.group(1).startswith('//'):
        continue
    problems.append('HTML 里的绝对路径: ' + m.group(1))

checked = 0
for ref in sorted(refs):
    if ref.startswith(('data:', '#')):
        continue
    real = os.path.normpath(ref.lstrip('/'))
    directory, base = os.path.dirname(real), os.path.basename(real)
    if not os.path.isdir(directory):
        problems.append(f'目录不存在: {ref}')
        continue
    checked += 1
    names = os.listdir(directory)
    if base not in names:
        near = [n for n in names if n.lower() == base.lower()]
        problems.append(f'大小写不符: {ref}' + (f' -> 实际是 {near}' if near else ' (不存在)'))

print(f'检查了 {checked} 个引用')
if problems:
    print('发现问题:')
    for p in problems:
        print('  -', p)
    sys.exit(1)
print('全部相对路径、大小写完全一致 —— 可以直接部署在 /<repo>/ 子路径下')
