"""Verificare completa a unui folder de capitole: goluri, duplicate, rezolutii aberante.

folosire: python verify_images.py <folder-surse>
"""
import hashlib, os, sys
from collections import Counter, defaultdict
from PIL import Image

ROOT = os.path.abspath(sys.argv[1])


def natkey(s):
    try: return (0, float(s))
    except ValueError: return (1, s)


chapters, by_hash, bad = [], defaultdict(list), []
total_pag = 0

for ch in sorted(os.listdir(ROOT), key=natkey):
    d = os.path.join(ROOT, ch)
    if not os.path.isdir(d): continue
    files = sorted((f for f in os.listdir(d) if f.lower().endswith((".webp", ".jpg", ".jpeg", ".png", ".gif", ".avif", ".bmp"))),
                   key=lambda f: natkey(os.path.splitext(f)[0]))
    if not files: continue

    dims, mb = {}, 0
    for f in files:
        p = os.path.join(d, f)
        mb += os.path.getsize(p)
        with open(p, "rb") as source:
            by_hash[hashlib.sha256(source.read()).hexdigest()].append(f"{ch}/{f}")
        try:
            with Image.open(p) as im:
                im.verify()
            with Image.open(p) as im:
                dims[f] = im.size
        except Exception as e:
            bad.append(f"{ch}/{f}: {e!r}")

    nums = [int(os.path.splitext(f)[0]) for f in files if os.path.splitext(f)[0].isdigit()]
    gaps = [n for n in range(1, max(nums) + 1) if n not in nums] if nums else []
    modal = Counter(dims.values()).most_common(1)[0][0] if dims else (0, 0)
    odd = [f"{f}={w}x{h}" for f, (w, h) in dims.items() if (w, h) != modal and w < h]
    wide = [f for f, (w, h) in dims.items() if w > h]
    chapters.append((ch, len(files), mb / 1024 / 1024, modal, gaps, odd, wide))
    total_pag += len(files)

print(f"{'cap':<8}{'pag':>5}{'MB':>8}   {'modal':<12}stare")
for ch, n, mb, modal, gaps, odd, wide in chapters:
    stare = []
    if gaps: stare.append(f"GOLURI {gaps}")
    if odd:  stare.append(f"REZOLUTIE {', '.join(odd)}")
    if wide: stare.append(f"{len(wide)} duble")
    print(f"{ch:<8}{n:>5}{mb:>8.1f}   {modal[0]}x{modal[1]:<7}{'  '.join(stare) or 'ok'}")

print(f"\ncapitole: {len(chapters)} | pagini: {total_pag}")
print(f"fisiere corupte: {len(bad)}")
for b in bad: print("   ", b)

intra = {h: v for h, v in by_hash.items() if len(v) > 1 and len({p.split('/')[0] for p in v}) == 1}
intre = {h: v for h, v in by_hash.items() if len({p.split('/')[0] for p in v}) > 1}
print(f"\nduplicate IN ACELASI capitol (grav): {len(intra)}")
for v in intra.values(): print("   ", " == ".join(v))
print(f"duplicate intre capitole (de obicei cartonase de final): {len(intre)}")
for v in intre.values(): print("   ", " == ".join(v))
sys.exit(1 if bad or any(chapter[4] for chapter in chapters) or intra else 0)
