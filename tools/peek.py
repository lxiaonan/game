# -*- coding: utf-8 -*-
"""Print a slice of a file around the Nth occurrence of a marker (debug helper)."""
import io
import sys

path, marker = sys.argv[1], sys.argv[2]
back = int(sys.argv[3]) if len(sys.argv) > 3 else 120
forward = int(sys.argv[4]) if len(sys.argv) > 4 else 240
text = io.open(path, encoding="utf-8").read()
index = text.index(marker)
print(repr(text[max(0, index - back):index + forward]))
