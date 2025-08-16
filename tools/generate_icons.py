from PIL import Image, ImageDraw
from pathlib import Path


def vertical_gradient(size, top_color, bottom_color):
    w, h = size
    img = Image.new("RGB", (w, h), color=top_color)
    top_r, top_g, top_b = top_color
    bot_r, bot_g, bot_b = bottom_color
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top_r + (bot_r - top_r) * t)
        g = int(top_g + (bot_g - top_g) * t)
        b = int(top_b + (bot_b - top_b) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def draw_icon(size):
    s = size
    # Background gradient: purple -> cyan
    bg = vertical_gradient((s, s), (124, 58, 237), (34, 211, 238))
    draw = ImageDraw.Draw(bg)

    # Stroke widths scale with size
    stroke = max(1, s // 12)
    thin = max(1, s // 18)

    # Safe margin
    m = max(2, s // 8)

    # Selection rounded rectangle outline
    rect = [m, m, s - m, s - m]
    radius = max(2, s // 6)
    # PIL rounded rectangle support via pieslice + rectangles
    # Use outline only
    try:
        draw.rounded_rectangle(rect, radius=radius, outline=(255, 255, 255), width=stroke)
    except Exception:
        # Fallback to normal rectangle
        draw.rectangle(rect, outline=(255, 255, 255), width=stroke)

    # Lens circle at center
    lens_r = s // 6
    cx = cy = s // 2
    lens_bb = [cx - lens_r, cy - lens_r, cx + lens_r, cy + lens_r]
    draw.ellipse(lens_bb, outline=(255, 255, 255), width=stroke)

    # Small sparkle at top-right for larger sizes
    if s >= 32:
        sp = s // 14
        sx = int(cx + lens_r * 0.9)
        sy = int(cy - lens_r * 0.9)
        # Draw a simple 4-point star
        draw.line([(sx - sp, sy), (sx + sp, sy)], fill=(255, 255, 255), width=thin)
        draw.line([(sx, sy - sp), (sx, sy + sp)], fill=(255, 255, 255), width=thin)

    # Subtle inner highlight ring for depth (only on big)
    if s >= 64:
        inner = s // 20
        inset = [m + inner, m + inner, s - m - inner, s - m - inner]
        try:
            draw.rounded_rectangle(inset, radius=max(2, radius - inner), outline=(255, 255, 255, 80), width=1)
        except Exception:
            pass

    return bg


def main():
    out_dir = Path("icons")
    out_dir.mkdir(parents=True, exist_ok=True)
    sizes = [16, 32, 48, 128]
    for s in sizes:
        img = draw_icon(s)
        path = out_dir / f"icon-{s}.png"
        img.save(path, format="PNG")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()

