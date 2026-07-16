#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PARTIALS = [
    ROOT / 'partials' / 'doctype.html',
    ROOT / 'partials' / 'head.html',
    ROOT / 'partials' / 'body-start.html',
    ROOT / 'partials' / 'control-panel.html',
    ROOT / 'partials' / 'ecu-frame.html',
    ROOT / 'partials' / 'body-end.html',
]
OUTPUT = ROOT / 'index.html'

if __name__ == '__main__':
    content = ''
    for partial in PARTIALS:
        if not partial.exists():
            raise FileNotFoundError(f'Missing partial: {partial}')
        part_text = partial.read_text(encoding='utf-8')
        content += part_text
        if not part_text.endswith('\n'):
            content += '\n'

    OUTPUT.write_text(content, encoding='utf-8')
    print(f'Built {OUTPUT}')
