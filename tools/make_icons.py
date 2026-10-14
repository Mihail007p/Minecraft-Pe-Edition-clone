#!/usr/bin/env python3
"""Генерирует PNG-иконки приложения (изометрический блок дёрна) без внешних зависимостей."""
import struct, zlib, os, random

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')


def png(width, height, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def render(size, maskable=False):
    rnd = random.Random(7)
    img = bytearray(size * size * 4)
    # Фон: для maskable — сплошной, иначе прозрачный
    if maskable:
        for i in range(size * size):
            img[i * 4:i * 4 + 4] = bytes((59, 125, 42, 255))
    pad = size * 0.2 if maskable else size * 0.06
    w = size - pad * 2  # ширина куба
    cx = size / 2
    top_y = pad
    # Вершины: top (cx, top_y), right (cx + w/2, top_y + w/4), bottom (cx, top_y + w/2), left (cx - w/2, top_y + w/4)
    h = w / 2
    grass = (109, 171, 66)
    dirt = (134, 96, 67)
    grass_side_depth = 0.18

    def put(x, y, col):
        if 0 <= x < size and 0 <= y < size:
            i = (x + y * size) * 4
            img[i:i + 4] = bytes((*col, 255))

    def jitter(col, amt):
        return tuple(max(0, min(255, c + rnd.randint(-amt, amt))) for c in col)

    def shade(col, f):
        return tuple(int(c * f) for c in col)

    for y in range(size):
        for x in range(size):
            px = x + 0.5 - cx
            py = y + 0.5 - top_y
            # верхняя грань: ромб |px|/(w/2) + |py - w/4|/(w/4) <= 1
            if abs(px) / (w / 2) + abs(py - w / 4) / (w / 4) <= 1:
                # пикселизация 16x16
                u = int(((px / (w / 2)) + (py - w / 4) / (w / 4)) * 8 + 8) % 16
                v = int((-(px / (w / 2)) + (py - w / 4) / (w / 4)) * 8 + 8) % 16
                rnd.seed(u * 31 + v * 17)
                put(x, y, jitter(grass, 10))
                continue
            # боковые грани
            if py >= w / 4 and abs(px) <= w / 2:
                # верхняя граница боковой грани — нижняя кромка ромба (V-образная, низшая точка в центре)
                edge_top = w / 2 - (abs(px) / (w / 2)) * (w / 4)
                edge_bot = edge_top + h
                if edge_top <= py <= edge_bot:
                    frac = (py - edge_top) / h
                    col = grass if frac < grass_side_depth else dirt
                    rnd.seed(int(px) * 13 + int(py) * 7)
                    col = jitter(col, 10)
                    col = shade(col, 0.78 if px < 0 else 0.6)
                    put(x, y, col)
    return bytes(img)


os.makedirs(OUT, exist_ok=True)
for name, size, maskable in (('icon-192.png', 192, False), ('icon-512.png', 512, False),
                             ('icon-512-maskable.png', 512, True), ('apple-touch-icon.png', 180, True)):
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(png(size, size, render(size, maskable)))
    print('written', name)
