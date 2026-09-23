#!/usr/bin/env python3
"""Render the shared factory geometry, logo and fonts as a social card.
Run: uv run --with fonttools --with brotli --with resvg-py python scripts/generate-social.py
PR #5 supplies metadata placement; its older text-only card is intentionally not reused.
"""
from pathlib import Path
import json
import re
import subprocess
import tempfile
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
import resvg_py

root = Path(__file__).resolve().parent.parent
css = (root / 'site/assets/style.css').read_text()
# Resolve the website's canonical palette for SVG renderers without CSS variables.
variables = dict(re.findall(r'(--[\w-]+):([^;}]+)', re.search(r':root\{([^}]+)', css)[1]))
variables.update({'--paper':'#eef6ed','--steel':'#b8cec1','--ground':'#102b22'})
variables.update(dict(re.findall(r'(--[\w-]+):([^;}]+)', re.search(r'\.factory-drawing,\.station-compartment\{([^}]+)', css)[1])))
styles = []
for selector, declarations in re.findall(r'([^{}]+)\{([^{}]+)\}', css):
    # The diagram's original material classes, not responsive UI selectors.
    if selector.startswith('.factory-svg ') and 'station-trace' not in selector:
        declarations = re.sub(r'var\((--[\w-]+)\)', lambda match:variables[match[1]], declarations)
        styles.append(f'{selector}{{{declarations}}}')
geometry = subprocess.check_output(['node','--input-type=module','-e',"import {factoryFloor} from './scripts/floor.mjs'; process.stdout.write(factoryFloor());"], cwd=root, text=True)
geometry = geometry.replace('<svg ', '<svg x="470" y="150" width="735" height="459" ', 1)
geometry = re.sub(r'<path class="station-trace"[^>]+/>','',geometry)
logo = (root / 'site/assets/odin-logo.svg').read_text().replace('<svg ', '<svg x="48" y="36" width="40" height="44" ',1)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<style>{''.join(styles)} text{{font-family:'Manrope';fill:#eef6ed}} .headline{{font-family:'Space Grotesk';font-weight:600;font-size:50px;letter-spacing:-1.5px}}</style>
<rect width="1200" height="630" fill="#102b22"/>
{logo}
<text x="104" y="67" font-family="Space Grotesk" font-size="26" font-weight="600">OdinLabs / R&amp;D</text>
<path d="M48 104H1152" stroke="#3d5b4e"/>
<text class="headline" x="48" y="203">What should an</text>
<text class="headline" x="48" y="260">agent’s work</text>
<text class="headline" x="48" y="317">have to prove?</text>
<text x="50" y="385" font-size="20">Open a station.</text>
<text x="50" y="416" font-size="20">Inspect the recorded experiment.</text>
{geometry}
<path d="M48 568H1152" stroke="#3d5b4e"/>
<text x="48" y="601" font-size="14">Concept drawing · Authored experiments · Source-bound results</text>
</svg>'''
with tempfile.TemporaryDirectory(prefix='odin-social-fonts-') as temporary:
    fonts=[]
    for family, weight in [('SpaceGrotesk',600),('Manrope',400),('JetBrainsMono',400)]:
        font=TTFont(root / f'site/assets/fonts/{family}-Variable.woff2')
        font=instantiateVariableFont(font, {'wght':weight}, inplace=True)
        canonical={'SpaceGrotesk':'Space Grotesk','Manrope':'Manrope','JetBrainsMono':'JetBrains Mono'}[family]
        for name_id in [1,16]:
            font['name'].setName(canonical,name_id,3,1,0x409)
        font.flavor=None
        path=Path(temporary)/f'{family}.ttf'; font.save(path); fonts.append(str(path))
    png=resvg_py.svg_to_bytes(svg_string=svg, font_files=fonts, skip_system_fonts=True)
output=root / 'site/assets/og/odin-rnd-og-image.png'
output.parent.mkdir(parents=True,exist_ok=True); output.write_bytes(png)
print(json.dumps({'file':str(output.relative_to(root)), 'width':1200,'height':630,'bytes':len(png)}))
