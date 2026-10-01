"""Convert the selected original fonts to WOFF2 without removing glyphs.

Requires fonttools and brotli. No network access or game build is performed.
"""
import hashlib
import json
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
SELECTED = (
    'mochiypopone/MochiyPopOne-Regular.ttf',
    'zenmarugothic/ZenMaruGothic-Regular.ttf',
    'zenmarugothic/ZenMaruGothic-Bold.ttf',
    'yuseimagic/YuseiMagic-Regular.ttf',
)


def main():
    manifest_path = ROOT / 'sources.json'
    manifest = json.loads(manifest_path.read_text())
    expected = {record['file']: record['sha256'] for record in manifest['files']}
    # Check every original before replacing any web file.
    for name in SELECTED:
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        if actual != expected[name]:
            raise ValueError(f'Original font changed: {name}')

    converted = []
    for name in SELECTED:
        source = ROOT / name
        target = source.with_suffix('.woff2')
        with TTFont(source) as font:
            original_characters = font.getBestCmap()
            font.flavor = 'woff2'
            font.save(target)
        with TTFont(target) as font:
            if font.getBestCmap() != original_characters:
                raise ValueError(f'Character coverage changed: {name}')
        data = target.read_bytes()
        converted.append({
            'file': str(target.relative_to(ROOT)),
            'original': name,
            'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
            'conversion': 'FontTools WOFF2, original full glyph set retained',
        })

    manifest['web_fonts'] = converted
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
