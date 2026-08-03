# -*- coding: utf-8 -*-
"""
Нарезка иконок disbit из присланного PNG 2048x2048.

  1. находит плитку (в исходнике она лежит на тёмно-синей подложке генератора);
  2. меряет радиус скругления и заполняет углы продолжением фона плитки —
     получается полнокадровый квадрат, кадр не режется, знак прежнего размера;
  3. пишет все размеры: веб, PWA, apple-touch, ico, Android mipmap.

Водяной знак генератора лежит за границей плитки и в вывод не попадает.
Для Android адаптивной иконки плитка кладётся в безопасную зону 108dp-кадра
со скруглением — launcher сам наложит свою маску поверх.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'icon-source-2048.png')
OUT = os.path.join(HERE, 'icons_out')
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.float64)
H, W, _ = a.shape

# --- 1. границы плитки -------------------------------------------------------
inside = ((a[:, :, 2] - a[:, :, 0]) <= 10) & \
         (0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2] > 45)

band = inside[int(H * .30):int(H * .70)]
left = int(np.median([np.argmax(r) for r in band if r.any()]))
right = int(np.median([len(r) - 1 - np.argmax(r[::-1]) for r in band if r.any()]))
vb = inside[:, int(W * .30):int(W * .70)]
top = int(np.median([np.argmax(c) for c in vb.T if c.any()]))
side = right - left + 1
plate = im.crop((left, top, left + side, top + side))

# радиус скругления: насколько верхняя строка плитки уже её ширины
row0 = inside[top + 2, left:left + side]
radius = int(np.argmax(row0)) if row0.any() else int(side * .22)
radius = min(max(radius, int(side * .10)), int(side * .35))
print(f'плитка {side}px (x{left} y{top}), радиус скругления {radius}px = {radius/side:.0%}')

# --- 2. углы: продолжаем фон плитки наружу ----------------------------------
mask = Image.new('L', (side, side), 255)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, side - 1, side - 1), radius=radius, fill=0)
corner = np.asarray(mask.filter(ImageFilter.GaussianBlur(2))) > 60      # True = угол вне плитки

work = np.asarray(plate).astype(np.float64)
# стартовый тон берём с самой кромки плитки, а не со всей площади:
# в середину попадает светящийся знак, от него углы вышли бы светлее фона
border = np.zeros((side, side), bool)
b = int(side * .04)
border[:b, :] = border[-b:, :] = border[:, :b] = border[:, -b:] = True
work[corner] = np.median(work[border & ~corner].reshape(-1, 3), axis=0)
for _ in range(80):                       # размываем и подливаем только в углы — тон продолжается
    blur = np.asarray(Image.fromarray(work.clip(0, 255).astype(np.uint8))
                      .filter(ImageFilter.GaussianBlur(side / 60))).astype(np.float64)
    work[corner] = blur[corner]
full = Image.fromarray(work.clip(0, 255).astype(np.uint8))
# по самой кромке плитки идёт светлая фаска — срезаем её, иначе на полнокадровой
# иконке остаётся призрак скруглённого силуэта
trim = int(side * .03)
full = full.crop((trim, trim, side - trim, side - trim))

# плитка со скруглением и прозрачными углами — для адаптивной иконки Android
tile = plate.convert('RGBA')
tile.putalpha(Image.eval(mask, lambda v: 255 - v))

# фон адаптивной иконки — тёмный тон нижней части плитки
dark = tuple(int(v) for v in np.asarray(plate)[int(side * .8):, :, :].reshape(-1, 3).mean(axis=0))
bg_hex = '#%02X%02X%02X' % dark
print('фон адаптивной иконки:', bg_hex)


def square(size):
    im = full.resize((size, size), Image.LANCZOS)
    # в артворке есть плёночное зерно: PNG его почти не жмёт, а на мелких
    # размерах оно всё равно не видно — гасим, файлы становятся в разы легче
    return im if size > 600 else im.filter(ImageFilter.GaussianBlur(0.5))


def save(im, name):
    im.save(os.path.join(OUT, name), optimize=True)


# --- 3. веб / PWA ------------------------------------------------------------
save(square(1024), 'icon-1024.png')
save(square(512), 'icon-512.png')
save(square(192), 'icon-192.png')
save(square(180), 'apple-touch-icon.png')
square(256).save(os.path.join(OUT, 'app.ico'),
                 sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# maskable: плитка ужата в безопасный круг 80%, вокруг ровный тёмный фон
mk = Image.new('RGBA', (512, 512), dark + (255,))
t = tile.resize((410, 410), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.5))
mk.alpha_composite(t, (51, 51))
save(mk.convert('RGB'), 'icon-maskable-512.png')

# --- 4. Android --------------------------------------------------------------
for name, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    d = os.path.join(OUT, 'mipmap-' + name)
    os.makedirs(d, exist_ok=True)
    square(px).save(os.path.join(d, 'ic_launcher.png'))

    rnd = square(px).convert('RGBA')                     # круглая для старых лаунчеров
    circle = Image.new('L', (px * 4, px * 4), 0)
    ImageDraw.Draw(circle).ellipse((0, 0, px * 4 - 1, px * 4 - 1), fill=255)
    rnd.putalpha(circle.resize((px, px), Image.LANCZOS))
    rnd.save(os.path.join(d, 'ic_launcher_round.png'))

    # адаптивная: кадр 108dp, плитка = 72dp (безопасная зона), центр
    fg_px = int(round(px * 108 / 48))
    vis = int(round(px * 72 / 48))
    fg = Image.new('RGBA', (fg_px, fg_px), (0, 0, 0, 0))
    fg.alpha_composite(tile.resize((vis, vis), Image.LANCZOS), ((fg_px - vis) // 2,) * 2)
    fg.save(os.path.join(d, 'ic_launcher_foreground.png'))

open(os.path.join(OUT, 'bg_color.txt'), 'w').write(bg_hex)
print('готово ->', OUT)
