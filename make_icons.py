#!/usr/bin/env python3
"""Focus Tracker — icon generator (pure stdlib, no Pillow).

Renders a rounded indigo->sky gradient square with a white clock face
(ring + center dot + hands at 10:10) at 4x, then box-downsamples.
Run:  python3 make_icons.py
Writes icons/icon16.png, icon32.png, icon48.png, icon128.png
"""
import math
import os
import struct
import zlib

SIZES = [16, 32, 48, 128]
SS = 4  # supersample factor
TOP = (0x63, 0x66, 0xF1)     # indigo
BOTTOM = (0x0E, 0xA5, 0xE9)  # sky
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_inside(x, y, s, r):
    cx = min(max(x, r), s - r)
    cy = min(max(y, r), s - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def segment_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size):
    s = size * SS
    r = s * 0.27
    c = s / 2.0
    ring_r = s * 0.26
    ring_w = s * 0.05
    hand_w = s * 0.05
    dot_r = s * 0.045
    # hands at 10:10 — endpoints on the ring
    h1 = (c + ring_r * math.cos(math.radians(-120)), c + ring_r * math.sin(math.radians(-120)))
    h2 = (c + ring_r * math.cos(math.radians(-38)), c + ring_r * math.sin(math.radians(-38)))

    pixels = []
    for y in range(s):
        row = []
        t = y / float(s - 1)
        base = lerp(TOP, BOTTOM, t)
        for x in range(s):
            if not rounded_inside(x, y, s - 1, r):
                row.append((0, 0, 0, 0))
                continue
            d_centre = math.hypot(x - c, y - c)
            on_ring = abs(d_centre - ring_r) <= ring_w / 2.0
            on_hand = (
                segment_dist(x, y, c, c, h1[0], h1[1]) <= hand_w / 2.0
                or segment_dist(x, y, c, c, h2[0], h2[1]) <= hand_w / 2.0
            )
            on_dot = d_centre <= dot_r
            if on_ring or on_hand or on_dot:
                row.append((*WHITE, 255))
            else:
                row.append((*base, 255))
        pixels.append(row)

    # box downsample SS x SS -> 1
    out = []
    for oy in range(size):
        row = []
        for ox in range(size):
            acc = [0, 0, 0, 0]
            for dy in range(SS):
                for dx in range(SS):
                    p = pixels[oy * SS + dy][ox * SS + dx]
                    for i in range(4):
                        acc[i] += p[i]
            n = SS * SS
            row.append(tuple(round(v / n) for v in acc))
        out.append(row)
    return out


def write_png(path, pixels):
    h = len(pixels)
    w = len(pixels[0])
    raw = b"".join(
        b"\x00" + b"".join(bytes(px) for px in row) for row in pixels
    )

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))  # 8-bit RGBA
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs("icons", exist_ok=True)
    for size in SIZES:
        path = os.path.join("icons", f"icon{size}.png")
        write_png(path, render(size))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
