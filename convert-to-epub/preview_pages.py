"""Preview pages 009-010-011. Usage: python preview_pages.py <root> <chapter> [chapter...]"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(sys.argv[1])
CAPS = sys.argv[2:]
OUT = os.path.join(os.getcwd(), "output", "previews")
os.makedirs(OUT, exist_ok=True)

TW, TH, PAD, LAB = 430, 604, 12, 24
try:    font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 18)
except OSError: font = ImageFont.load_default()

for ch in CAPS:
    strip = Image.new("RGB", (3 * TW + 4 * PAD, TH + LAB + 2 * PAD), (24, 24, 27))
    d = ImageDraw.Draw(strip)
    for i, p in enumerate(("009", "010", "011")):
        f = next((os.path.join(ROOT, ch, p + ext) for ext in (".webp", ".jpg", ".jpeg", ".png", ".gif", ".avif")
                  if os.path.exists(os.path.join(ROOT, ch, p + ext))), None)
        if not f: continue
        x = PAD + i * (TW + PAD)
        d.text((x + 2, PAD), f"cap. {ch}   pagina {int(p)}", font=font, fill=(235, 235, 240))
        with Image.open(f) as im:
            im = im.convert("RGB"); im.thumbnail((TW, TH), Image.Resampling.LANCZOS)
            strip.paste(im, (x + (TW - im.width) // 2, PAD + LAB))
    out = os.path.join(OUT, f"preview-ch-{ch}.jpg")
    strip.save(out, "JPEG", quality=88)
    print(out)
