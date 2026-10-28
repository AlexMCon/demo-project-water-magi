"""Convert chapter image folders into fixed-layout EPUBs: one per chapter, or grouped with --group-size."""
import argparse
import os
import re
import uuid
import zipfile
import io
from datetime import datetime, timezone
from xml.sax.saxutils import escape
from PIL import Image

SCREEN_W, SCREEN_H = 1236, 1648
QUALITY      = 85
GRAYSCALE    = True
SPLIT_SPREAD = True                  # taie paginile duble in doua pagini portret
RTL          = True                  # manga: jumatatea dreapta se citeste prima

NS = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")
IMAGE_EXTENSIONS = (".webp", ".jpg", ".jpeg", ".png", ".gif", ".avif", ".bmp")

ROOT = OUT = SERIES = PREFIX = ""
LANGUAGE = "en"
ONLY = None


def natkey(s):
    try: return (0, float(s))
    except ValueError: return (1, s)


def prepare(im):
    if GRAYSCALE and im.mode != "L":
        im = im.convert("L")
    elif im.mode not in ("L", "RGB"):
        im = im.convert("RGB")
    scale = min(SCREEN_W / im.width, SCREEN_H / im.height, 1.0)
    if scale < 1.0:
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)
    return im


def page_images(path):
    with Image.open(path) as im:
        im.load()
        if SPLIT_SPREAD and im.width > im.height:
            mid = im.width // 2
            left, right = im.crop((0, 0, mid, im.height)), im.crop((mid, 0, im.width, im.height))
            for half in ((right, left) if RTL else (left, right)):
                yield prepare(half)
        else:
            yield prepare(im)


def jpeg_bytes(im):
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=QUALITY, optimize=True)
    return buf.getvalue()


CONTAINER = '''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>'''

CSS = "html,body{margin:0;padding:0;height:100%;}\nsvg{display:block;}\n"


def page_xhtml(idx, w, h):
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>{idx:04d}</title>
  <meta name="viewport" content="width={w}, height={h}"/>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
       version="1.1" width="100%" height="100%" viewBox="0 0 {w} {h}"
       preserveAspectRatio="xMidYMid meet">
    <image width="{w}" height="{h}" xlink:href="img/{idx:04d}.jpg"/>
  </svg>
</body>
</html>'''


def build(book, chapters, out_path, series_index):
    """chapters: [(label, [image paths])]; one TOC entry per chapter."""
    pages, toc = [], []
    for label, files in chapters:
        toc.append((label, len(pages) + 1))
        for f in files:
            for im in page_images(f):
                pages.append((len(pages) + 1, jpeg_bytes(im), im.width, im.height))

    title = escape(f"{SERIES} - Ch. {book}")
    bid   = uuid.uuid5(NS, f"{SERIES}-{book}")
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not pages:
        raise ValueError("Chapter has no images")

    manifest, spine = [], []
    for i, _, _, _ in pages:
        props = ' properties="cover-image"' if i == 1 else ""
        manifest.append(f'    <item id="img{i:04d}" href="img/{i:04d}.jpg" media-type="image/jpeg"{props}/>')
        manifest.append(f'    <item id="pg{i:04d}" href="{i:04d}.xhtml" media-type="application/xhtml+xml"/>')
        spine.append(f'    <itemref idref="pg{i:04d}"/>')

    opf = f'''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">urn:uuid:{bid}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:language>{escape(LANGUAGE)}</dc:language>
    <meta property="dcterms:modified">{modified}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">portrait</meta>
    <meta property="rendition:spread">none</meta>
    <meta name="cover" content="img0001"/>
    <meta name="calibre:series" content="{escape(SERIES, {chr(34): '&quot;'})}"/>
    <meta name="calibre:series_index" content="{escape(str(series_index), {chr(34): '&quot;'})}"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
{chr(10).join(manifest)}
  </manifest>
  <spine page-progression-direction="{'rtl' if RTL else 'ltr'}">
{chr(10).join(spine)}
  </spine>
</package>'''

    if len(toc) == 1:
        entries = f'<li><a href="0001.xhtml">{title}</a></li>'
    else:
        entries = "".join(f'<li><a href="{p:04d}.xhtml">{escape("Ch. " + label)}</a></li>' for label, p in toc)
    nav = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>{title}</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1>
  <ol>{entries}</ol></nav></body>
</html>'''

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", CONTAINER)
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/nav.xhtml", nav)
        z.writestr("OEBPS/style.css", CSS)
        for i, data, w, h in pages:
            z.writestr(f"OEBPS/{i:04d}.xhtml", page_xhtml(i, w, h))
            z.writestr(f"OEBPS/img/{i:04d}.jpg", data, zipfile.ZIP_STORED)
    return len(pages)


def page_num(f):
    stem = os.path.splitext(os.path.basename(f))[0]
    return int(stem) if stem.isdigit() else None


def main(argv=None):
    global ROOT, OUT, SERIES, PREFIX, ONLY, SCREEN_W, SCREEN_H, QUALITY, GRAYSCALE, SPLIT_SPREAD, RTL, LANGUAGE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Folder containing chapter folders (1, 2, 3, ...)")
    parser.add_argument("output", help="Destination for EPUB files")
    parser.add_argument("series", help="Series title")
    parser.add_argument("chapters", nargs="*", help="Optional chapter folder names/numbers")
    parser.add_argument("--width", type=int, default=1236)
    parser.add_argument("--height", type=int, default=1648)
    parser.add_argument("--quality", type=int, default=85)
    parser.add_argument("--language", default="en")
    parser.add_argument("--color", action="store_true", help="Preserve color instead of grayscale")
    parser.add_argument("--ltr", action="store_true", help="Read left to right")
    parser.add_argument("--no-split-spreads", action="store_true", help="Keep landscape pages intact")
    parser.add_argument("--source", dest="extra_sources", action="append", default=[], metavar="DIR",
                        help="Additional folder with chapter folders (repeatable)")
    parser.add_argument("--group-size", type=int, help="One EPUB per N chapters by number (1-N, N+1-2N, ...); "
                        "fractional chapters go in the group of their whole number")
    parser.add_argument("--groups", type=int, nargs="+", metavar="K", help="With --group-size or --ranges: build only these groups (1 = first)")
    parser.add_argument("--ranges", nargs="+", metavar="A-B", help="One EPUB per explicit chapter range, e.g. 1-15 16-25")
    parser.add_argument("--move-pages", action="append", default=[], metavar="SRC:A-B=DEST",
                        help="Append pages A..B of chapter SRC to the end of chapter DEST, e.g. 22:1-20=21")
    args = parser.parse_args(argv)
    sources = [args.source] + args.extra_sources
    for s in sources:
        if not os.path.isdir(s): parser.error(f"Source directory does not exist: {s}")
    if args.width < 1 or args.height < 1 or not 1 <= args.quality <= 100:
        parser.error("Width/height must be positive; quality must be between 1 and 100")
    if args.group_size is not None and args.group_size < 1: parser.error("--group-size must be positive")
    if args.groups and not (args.group_size or args.ranges): parser.error("--groups requires --group-size or --ranges")
    if args.ranges and args.group_size: parser.error("--ranges and --group-size are mutually exclusive")
    ranges = []
    for r in args.ranges or []:
        m = re.fullmatch(r"(\d+)-(\d+)", r)
        if not m or int(m.group(1)) > int(m.group(2)): parser.error(f"Invalid range: {r}")
        ranges.append((int(m.group(1)), int(m.group(2))))
    ROOT, OUT, SERIES = os.path.abspath(args.source), os.path.abspath(args.output), args.series
    PREFIX = re.sub(r"[^A-Za-z0-9._-]+", "-", SERIES).strip("-") or "book"
    ONLY = args.chapters or None
    SCREEN_W, SCREEN_H, QUALITY = args.width, args.height, args.quality
    GRAYSCALE, SPLIT_SPREAD, RTL, LANGUAGE = not args.color, not args.no_split_spreads, not args.ltr, args.language
    os.makedirs(OUT, exist_ok=True)

    chapters = {}  # label -> list of image paths
    for root in sources:
        for ch in os.listdir(root):
            d = os.path.join(root, ch)
            if not os.path.isdir(d):    continue
            label = re.sub(r"^(?:chapter|ch)[-_ ]", "", ch, flags=re.IGNORECASE)
            if ONLY and ch not in ONLY and label not in ONLY: continue
            names = sorted((f for f in os.listdir(d) if f.lower().endswith(IMAGE_EXTENSIONS)),
                           key=lambda f: natkey(os.path.splitext(f)[0]))
            if not names: continue
            if label in chapters: parser.error(f"Chapter {label} exists in more than one source")
            chapters[label] = [os.path.join(d, f) for f in names]

    gaps = {}
    for label, files in chapters.items():
        nums = [n for n in map(page_num, files) if n is not None]
        gaps[label] = [n for n in range(1, max(nums) + 1) if n not in nums] if nums else []

    for spec in args.move_pages:
        m = re.fullmatch(r"([^:]+):(\d+)-(\d+)=(.+)", spec)
        if not m: parser.error(f"Invalid --move-pages: {spec}")
        src, a, b, dest = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
        if src not in chapters or dest not in chapters: parser.error(f"--move-pages {spec}: chapter not found")
        moved = [f for f in chapters[src] if page_num(f) is not None and a <= page_num(f) <= b]
        if len(moved) != b - a + 1: parser.error(f"--move-pages {spec}: pages missing in chapter {src}")
        chapters[src] = [f for f in chapters[src] if f not in moved]
        chapters[dest] += moved
        print(f"mutat {src}/{a:03d}-{b:03d} -> sfarsitul capitolului {dest}")

    order = sorted(chapters, key=natkey)
    total_mb = 0.0
    if not args.group_size and not ranges:
        for label in order:
            out_path = os.path.join(OUT, f"{PREFIX}-ch{label}.epub")
            n = build(label, [(label, chapters[label])], out_path, label)
            mb = os.path.getsize(out_path) / 1024 / 1024
            total_mb += mb
            warn = f"   !! lipsesc paginile sursa {gaps[label]}" if gaps[label] else ""
            print(f"ch {label:<6}{len(chapters[label]):>3} src -> {n:>3} pagini epub   {mb:6.1f} MB{warn}")
    else:
        groups = {}
        if ranges:
            for g, (a, b) in enumerate(ranges, 1):
                labels = [l for l in order if a <= int(float(l)) <= b]
                if labels: groups[g] = (a, b, labels)
        else:
            for label in order:
                g = (int(float(label)) - 1) // args.group_size + 1
                groups.setdefault(g, ((g - 1) * args.group_size + 1, g * args.group_size, []))[2].append(label)
        for g, (first, last, labels) in sorted(groups.items()):
            if args.groups and g not in args.groups: continue
            last = min(last, max(int(float(l)) for l in labels))
            out_path = os.path.join(OUT, f"{PREFIX}-ch{first:03d}-{last:03d}.epub")
            n = build(f"{first}-{last}", [(l, chapters[l]) for l in labels], out_path, g)
            mb = os.path.getsize(out_path) / 1024 / 1024
            total_mb += mb
            src = sum(len(chapters[l]) for l in labels)
            print(f"grup {g:<3} ch {first}-{last}: {len(labels)} capitole, {src} src -> {n} pagini epub   {mb:6.1f} MB")
            for l in labels:
                if gaps[l]: print(f"   !! ch {l}: lipsesc paginile sursa {gaps[l]}")

    print(f"\ntotal {total_mb:.1f} MB in {OUT}")


if __name__ == "__main__":
    main()
