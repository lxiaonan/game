# -*- coding: utf-8 -*-
"""Print the id / position / home radius of every neighbour in src/npcs.js."""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = io.open(os.path.join(ROOT, "src", "npcs.js"), encoding="utf-8").read()
pattern = re.compile(r"id: '([a-z]+)', name: '([^']+)'[^}]*?x: (-?[\d.]+), z: (-?[\d.]+), home: ([\d.]+)")
for match in pattern.finditer(src):
    print("%-14s %-8s x=%-6s z=%-6s home=%s" % match.groups())
