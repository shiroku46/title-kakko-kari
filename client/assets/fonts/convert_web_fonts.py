"""Create complete regular/bold Noto Sans JP faces and their WOFF2 copies.

Requires fonttools and brotli. No network access or game build is performed.
The original variable font and OFL stay unchanged; archived fonts stay unused.
"""
import hashlib
import json
from pathlib import Path

import brotli
import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent
SOURCE = 'notosansjp/NotoSansJP-Variable.ttf'
LICENSE = 'notosansjp/OFL.txt'
FACES = (('Regular', 400), ('Bold', 700))
REQUIRED_CHARACTERS = 'タイトルカッコカリ仮名前部屋作参加遊方本当題名説明投票得点猫騙こんにちはABC0123456789（）！？'


def record(path, **details):
    data = path.read_bytes()
    return {
        'file': str(path.relative_to(ROOT)),
        **details,
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
    }


def unicode_maps(font):
    """Include every Unicode cmap, rather than checking a sample or subset."""
    return sorted(
        (table.platformID, table.platEncID, table.language, sorted(table.cmap.items()))
        for table in font['cmap'].tables if table.isUnicode()
    )


def verify_face(path, characters, maps, glyphs, weight):
    with TTFont(path) as font:
        if font.getBestCmap() != characters or unicode_maps(font) != maps:
            raise ValueError(f'Character coverage changed: {path.name}')
        if font.getGlyphOrder() != glyphs:
            raise ValueError(f'Glyph order changed: {path.name}')
        if 'fvar' in font or font['OS/2'].usWeightClass != weight:
            raise ValueError(f'Static face weight mismatch: {path.name}')
        # OFL reserves "Source", not "Noto Sans JP". Copyright text is kept;
        # no derived primary font name may use the reserved name.
        names = (name.toUnicode() for name in font['name'].names
                 if name.nameID in (1, 4, 6, 16))
        if any('Source' in name for name in names):
            raise ValueError(f'Reserved primary font name: {path.name}')


def main():
    manifest_path = ROOT / 'sources.json'
    manifest = json.loads(manifest_path.read_text())
    expected = {entry['file']: entry['sha256'] for entry in manifest['files']}
    # Check the original and its byte-for-byte license before replacing files.
    for name in (SOURCE, LICENSE):
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        if actual != expected[name]:
            raise ValueError(f'Original source changed: {name}')

    derived = []
    web = []
    with TTFont(ROOT / SOURCE, recalcTimestamp=False) as original:
        characters = original.getBestCmap()
        missing = sorted(set(map(ord, REQUIRED_CHARACTERS)) - characters.keys())
        if missing:
            raise ValueError(f'Required characters missing: {missing}')
        maps = unicode_maps(original)
        glyphs = original.getGlyphOrder()
        for face, weight in FACES:
            static_path = ROOT / f'notosansjp/NotoSansJP-{face}.ttf'
            web_path = static_path.with_suffix('.woff2')
            font = instantiateVariableFont(
                original, {'wght': weight}, inplace=False,
                optimize=True, updateFontNames=True,
            )
            try:
                # Retain the source timestamp for repeatable output bytes.
                font.recalcTimestamp = False
                font.save(static_path)
                verify_face(static_path, characters, maps, glyphs, weight)
                font.flavor = 'woff2'
                font.save(web_path)
            finally:
                font.close()
            verify_face(web_path, characters, maps, glyphs, weight)
            details = {'original': SOURCE, 'weight': weight,
                       'unicode_characters': len(characters)}
            derived.append(record(
                static_path, **details,
                conversion='FontTools static instance, original full glyph set retained',
            ))
            web.append(record(
                web_path, **details,
                static_face=str(static_path.relative_to(ROOT)),
                conversion='FontTools WOFF2, original full glyph set retained',
            ))

    manifest['derived_fonts'] = derived
    manifest['web_fonts'] = web
    manifest['conversion_tools'] = {
        'fonttools': fontTools.version,
        'brotli': brotli.__version__,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
