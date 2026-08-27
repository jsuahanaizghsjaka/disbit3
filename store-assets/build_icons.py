# -*- coding: utf-8 -*-
"""
Нарезка иконок disbit из фото мыльного пузыря (icon-source-bubble.jpg, 1000x1000).

Источник проще предыдущего: чистый чёрный фон, без скруглённых углов и
водяного знака — не нужна ни инпейнтинг углов, ни обрезка чужой рамки.

  1. пишет полнокадровые квадраты (веб, PWA, apple-touch, ico, Android
     ic_launcher/ic_launcher_round) — прямое масштабирование исходника;
  2. вырезает сам пузырь по альфа-маске (яркость минус фон) — нужно для
     адаптивной иконки Android (foreground отдельно от background) и
     maskable-варианта PWA, где фон и знак должны жить раздельно.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'icon-source-bubble.jpg')
OUT = os.path.join(HERE, 'icons_out')
os.makedirs(OUT, exist_ok=True)

# тон фона приложения (--bg в style.css) — используем его, а не чистый чёрный
# исходника, чтобы адаптивная иконка не спорила с реальным фоном приложения
BG = (0x0C, 0x14, 0x22)
BG_HEX = '#0C1422'

im = Image.open(SRC).convert('RGB')
side = im.size[0]
a = np.asarray(im).astype(np.float64)

full = im  # исходник уже чистый квадрат без скруглений — обрезка не нужна


def square(size):
    out = full.resize((size, size), Image.LANCZOS)
    # JPEG-шум в плоском чёрном раздувает PNG почти без пользы на мелких иконках
    return out if size > 600 else out.filter(ImageFilter.GaussianBlur(0.4))


def save(im, name):
    im.save(os.path.join(OUT, name), optimize=True)


# --- вырезаем сам пузырь: альфа = ФОРМА силуэта, не яркость пикселя ---------
# Пузырь полупрозрачный — его середина в фото такая же тёмная, как фон.
# Альфа по яркости приняла бы середину за фон и прорезала в диске дыру
# кружевом (проверено: сетка альфы дала пятна 0/255 вперемешку внутри контура).
# Пузырь физически круглый — поэтому вырезаем сплошным эллипсом по измеренным
# границам, а не по содержимому пикселей.
strict = a.sum(axis=2) > 25
rows = np.where(strict.any(axis=1))[0]
cols = np.where(strict.any(axis=0))[0]
pad = 6
bbox = (max(0, cols[0] - pad), max(0, rows[0] - pad),
        min(side, cols[-1] + pad), min(side, rows[-1] + pad))
w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]

disc = Image.new('L', (w, h), 0)
inset = 2                                  # запас, чтобы блик у самого края не обрезало
ImageDraw.Draw(disc).ellipse((inset, inset, w - 1 - inset, h - 1 - inset), fill=255)
disc = disc.filter(ImageFilter.GaussianBlur(1.2))     # мягкий край, не рваный

knot = im.crop(bbox).convert('RGBA')
knot.putalpha(disc)
solid_frac = max(knot.size) / side
print(f'пузырь вырезан: {knot.size}px, занимает {solid_frac:.0%} исходного кадра')


def knot_on(size, share, bg=BG):
    """пузырь на сплошном фоне; share — доля кадра под сам пузырь"""
    canvas = Image.new('RGBA', (size, size), bg + (255,))
    k = knot.copy()
    target = int(size * share)
    k.thumbnail((target, target), Image.LANCZOS)
    canvas.alpha_composite(k, ((size - k.size[0]) // 2, (size - k.size[1]) // 2))
    return canvas


# --- веб / PWA -----------------------------------------------------------------
save(square(1024), 'icon-1024.png')
save(square(512), 'icon-512.png')
save(square(192), 'icon-192.png')
save(square(180), 'apple-touch-icon.png')
square(256).save(os.path.join(OUT, 'app.ico'),
                 sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# maskable: пузырь ужат в безопасный круг ~62%, вокруг ровный фон приложения
save(knot_on(512, 0.62).convert('RGB'), 'icon-maskable-512.png')

# --- Android ---------------------------------------------------------------
for name, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    d = os.path.join(OUT, 'mipmap-' + name)
    os.makedirs(d, exist_ok=True)
    square(px).save(os.path.join(d, 'ic_launcher.png'))

    rnd = square(px).convert('RGBA')                     # круглая для старых лаунчеров
    circle = Image.new('L', (px * 4, px * 4), 0)
    ImageDraw.Draw(circle).ellipse((0, 0, px * 4 - 1, px * 4 - 1), fill=255)
    rnd.putalpha(circle.resize((px, px), Image.LANCZOS))
    rnd.save(os.path.join(d, 'ic_launcher_round.png'))

    # адаптивная: кадр 108dp, пузырь в безопасной зоне ~72dp, фон прозрачный —
    # цвет подложки берёт values/ic_launcher_background.xml
    fg_px = int(round(px * 108 / 48))
    fg = Image.new('RGBA', (fg_px, fg_px), (0, 0, 0, 0))
    k = knot.copy()
    t = int(fg_px * 0.60)
    k.thumbnail((t, t), Image.LANCZOS)
    fg.alpha_composite(k, ((fg_px - k.size[0]) // 2, (fg_px - k.size[1]) // 2))
    fg.save(os.path.join(d, 'ic_launcher_foreground.png'))

open(os.path.join(OUT, 'bg_color.txt'), 'w').write(BG_HEX)
print('фон адаптивной иконки:', BG_HEX)
print('готово ->', OUT)
