"""Pack generated artwork into aligned game atlases. Requires Pillow, NumPy, SciPy."""
from pathlib import Path
from PIL import Image, ImageDraw
import json
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets/world-map/players'
DOC = ROOT / 'docs/design/world-map-players'
CELL = 112
DIRECTIONS = ['down', 'right', 'left', 'up']
characters = {}
all_frames = {}
for gender in ['male', 'female']:
    source = Image.open(OUT / 'source' / f'player-{gender}.png').convert('RGBA')
    atlas = Image.new('RGBA', (CELL * 4, CELL * 4))
    packed = []
    for row in range(4):
        row_frames = []
        for col in range(4):
            crop = source.crop((round(col*source.width/4), round(row*source.height/4),
                                round((col+1)*source.width/4), round((row+1)*source.height/4)))
            pixels = np.array(crop)
            labels, count = ndimage.label(pixels[:,:,3] > 24)
            sizes = np.bincount(labels.ravel())
            # Remove isolated specks / neighboring-row fragments, retain main artwork.
            keep = sizes >= max(40, sizes[1:].max()*0.005)
            keep[0] = False
            mask = ndimage.binary_dilation(keep[labels], iterations=2)
            pixels[:,:,3] *= mask
            crop = Image.fromarray(pixels)
            bbox = crop.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
            if bbox is None:
                raise ValueError(f'Empty frame: {gender}/{row}/{col}')
            crop = crop.crop(bbox)
            scale = min(96/crop.height, 96/crop.width)
            crop = crop.resize((round(crop.width*scale), round(crop.height*scale)), Image.Resampling.LANCZOS)
            frame = Image.new('RGBA', (CELL, CELL))
            frame.alpha_composite(crop, ((CELL-crop.width)//2, 104-crop.height))
            atlas.alpha_composite(frame, (col*CELL, row*CELL))
            row_frames.append(frame)
        packed.append(row_frames)
    atlas.save(OUT / f'player-{gender}.png', optimize=True)
    atlas.save(OUT / f'player-{gender}.webp', lossless=True, method=6)
    packed[0][0].save(OUT / f'player-{gender}-idle.png', optimize=True)
    all_frames[gender] = packed
    characters[gender] = {'image': f'player-{gender}.webp', 'fallback': f'player-{gender}.png'}

manifest = {
    'version': 1, 'frameWidth': CELL, 'frameHeight': CELL,
    'columns': 4, 'rows': 4, 'directions': DIRECTIONS,
    'anchor': {'x': 56, 'y': 104},
    'display': {'width': 56, 'height': 56, 'tileSize': 40, 'visibleHeightApprox': 48},
    'animations': {'idle': {'frames': [0], 'frameDurationMs': 1000},
                   'walk': {'frames': [1, 2, 3, 0], 'frameDurationMs': 130}},
    'characters': characters
}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
DOC.mkdir(parents=True, exist_ok=True)
preview = []
for step in [1, 2, 3, 0]:
    panel = Image.new('RGB', (640, 260), '#304b3b')
    draw = ImageDraw.Draw(panel)
    draw.text((16, 10), 'Map players | 40px tiles | 48px character height', fill='white')
    for gi, gender in enumerate(['male', 'female']):
        y = 64 + gi*112
        draw.text((16, y+20), gender, fill='white')
        for row, direction in enumerate(DIRECTIONS):
            x = 130 + row*130
            draw.rectangle((x, y+20, x+40, y+60), outline='#63846a')
            frame = all_frames[gender][row][step].resize((56,56), Image.Resampling.LANCZOS)
            panel.paste(frame, (x-8, y+8), frame)
            draw.text((x-2, y+70), direction, fill='white')
    preview.append(panel)
preview[0].save(DOC / 'walk-preview.gif', save_all=True, append_images=preview[1:], duration=130, loop=0)
preview[0].save(DOC / 'size-preview.png')
print(json.dumps({'atlas': [448,448], 'frame': [112,112], 'rows': DIRECTIONS,
                  'files': {p.name:p.stat().st_size for p in OUT.glob('*') if p.is_file()}}, indent=2))
