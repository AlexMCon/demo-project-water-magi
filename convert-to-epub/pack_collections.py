"""Pack consecutive, whole chapters into fixed-layout EPUBs below a decimal MB limit.

Uses convert_to_epub.py's existing image preparation and EPUB writer. Originals
are read only; prepared JPEGs are cached so measuring/repacking never reencodes.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_FLOOR
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import zipfile
from xml.etree import ElementTree as ET

import convert_to_epub as converter
from PIL import Image

CONVERTER_HASH = hashlib.sha256(Path(converter.__file__).read_bytes()).hexdigest()
SETTINGS = {"width": 1236, "height": 1648, "quality": 85, "grayscale": True,
            "rtl": True, "split_spreads": True, "converter_sha256": CONVERTER_HASH}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_write(path, data):
    path = Path(path)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=path.name + ".", delete=False) as f:
        temp = Path(f.name)
        f.write(data)
    try:
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def discover(source, start=None, stop=None):
    chapters = []
    seen = set()
    for folder in source.iterdir():
        if not folder.is_dir():
            continue
        label = re.sub(r"^(?:chapter|ch)[-_ ]", "", folder.name, flags=re.I)
        if not re.fullmatch(r"\d+(?:\.\d+)?", label):
            continue
        value = Decimal(label)
        if (start is not None and value < start) or (stop is not None and value > stop):
            continue
        if value in seen:
            raise ValueError(f"Duplicate chapter number: {label}")
        seen.add(value)
        files = [p for p in folder.iterdir() if p.suffix.lower() in converter.IMAGE_EXTENSIONS]
        if not files:
            raise ValueError(f"Empty chapter: {folder}")
        if any(not p.stem.isdigit() or int(p.stem) < 1 for p in files):
            raise ValueError(f"Non-numeric or zero page filename in {folder}")
        files.sort(key=lambda p: int(p.stem))
        nums = [int(p.stem) for p in files]
        if len(nums) != len(set(nums)):
            raise ValueError(f"Duplicate page number in {folder}")
        gaps = sorted(set(range(1, max(nums) + 1)) - set(nums))
        if gaps:
            raise ValueError(f"Chapter {label}: missing pages {gaps}")
        chapters.append({"label": label, "value": value, "files": files})
    chapters.sort(key=lambda c: c["value"])
    if not chapters:
        raise ValueError("No chapter images found in the selected range")
    first = int((start if start is not None else chapters[0]["value"]).to_integral_value(rounding=ROUND_CEILING))
    last = int((stop if stop is not None else chapters[-1]["value"]).to_integral_value(rounding=ROUND_FLOOR))
    missing = [n for n in range(first, last + 1) if Decimal(n) not in seen]
    if missing:
        raise ValueError(f"Missing whole chapters: {missing}")
    return chapters


def expected_chapters(filename):
    if not filename:
        return None
    report = json.loads(Path(filename).read_text(encoding="utf-8"))
    entries = report.get("chapters", report)
    if isinstance(entries, list):
        return {str(Decimal(str(c["number"]))): c for c in entries}
    if isinstance(entries, dict):
        return {str(Decimal(str(k))): v for k, v in entries.items()}
    raise ValueError("Unsupported audit report; expected chapters keyed by number or a list")


def check_expected(chapters, expected, start=None, stop=None):
    if expected is None:
        return
    present = {chapter["value"] for chapter in chapters}
    lower = start if start is not None else chapters[0]["value"]
    upper = stop if stop is not None else chapters[-1]["value"]
    missing = [key for key in expected if lower <= Decimal(key) <= upper and Decimal(key) not in present]
    if missing:
        raise ValueError(f"Chapters covered by the API audit are missing locally: {missing}")
    for chapter in chapters:
        entry = expected.get(str(chapter["value"]))
        if not isinstance(entry, dict):
            raise ValueError(f"Chapter {chapter['label']} is not covered by the audit report")
        count = entry.get("expectedPages", entry.get("total"))
        if not isinstance(count, int) or count < 1:
            raise ValueError(f"Audit report has no valid page total for {chapter['label']}")
        if len(chapter["files"]) != count:
            raise ValueError(f"Chapter {chapter['label']}: local {len(chapter['files'])}, API expected {count}")


def prepare_file(source, cache, settings=SETTINGS):
    before = source.stat()
    raw = source.read_bytes()
    source_hash = digest(raw)
    key = digest((source_hash + json.dumps(settings, sort_keys=True)).encode())
    metadata_path = cache / (key + ".json")
    if metadata_path.exists():
        try:
            result = json.loads(metadata_path.read_text())
            if (result["source_sha256"] == source_hash and result["settings"] == settings and result["pages"] and
                    all((cache / p["cache_name"]).is_file() and
                        digest((cache / p["cache_name"]).read_bytes()) == p["sha256"] for p in result["pages"])):
                # Decode cache hits too, so corruption cannot enter a ready EPUB.
                for p in result["pages"]:
                    with Image.open(cache / p["cache_name"]) as image:
                        image.load()
                        if image.size != (p["width"], p["height"]):
                            raise ValueError("Invalid cached image dimensions")
                return {**result, "source": str(source.resolve())}
        except (OSError, ValueError, KeyError):
            pass
    with Image.open(source) as image:
        image.load()
        width, height = image.size
    pages = []
    for index, image in enumerate(converter.page_images(source)):
        data = converter.jpeg_bytes(image)
        name = f"{key}-{index}.jpg"
        atomic_write(cache / name, data)
        pages.append({"cache_name": name, "bytes": len(data), "sha256": digest(data),
                      "width": image.width, "height": image.height,
                      "part": ("right" if index == 0 else "left") if width > height else "whole"})
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError(f"Source changed during conversion: {source}")
    result = {"source_sha256": source_hash, "source_width": width, "source_height": height,
              "settings": settings, "pages": pages}
    atomic_write(metadata_path, json.dumps(result, indent=2).encode())
    return {**result, "source": str(source.resolve())}


def build_cached(chapters, destination, cache, series, index):
    lookup = {p["source"]: p for ch in chapters for p in ch["prepared"]}
    old_page_images, old_jpeg = converter.page_images, converter.jpeg_bytes
    converter.SERIES = series
    converter.LANGUAGE = "en"
    converter.RTL = True
    def page_images(filename):
        for p in lookup[filename]["pages"]:
            yield SimpleNamespace(width=p["width"], height=p["height"], cache_file=cache / p["cache_name"])
    try:
        converter.page_images = page_images
        converter.jpeg_bytes = lambda image: image.cache_file.read_bytes()
        labels = [ch["label"] for ch in chapters]
        book = labels[0] if len(labels) == 1 else labels[0] + "-" + labels[-1]
        return converter.build(book, [(ch["label"], [p["source"] for p in ch["prepared"]]) for ch in chapters], destination, index)
    finally:
        converter.page_images, converter.jpeg_bytes = old_page_images, old_jpeg


def verify_order(filename, chapters, cache):
    pages = [(ch["label"], image, p) for ch in chapters for image in ch["prepared"] for p in image["pages"]]
    namespace = {"opf": "http://www.idpf.org/2007/opf", "x": "http://www.w3.org/1999/xhtml"}
    with zipfile.ZipFile(filename) as archive:
        package = ET.fromstring(archive.read("OEBPS/content.opf"))
        spine = package.find("opf:spine", namespace)
        if spine.get("page-progression-direction") != "rtl":
            raise ValueError("Incorrect reading direction")
        refs = [x.get("idref") for x in spine]
        if refs != [f"pg{i:04d}" for i in range(1, len(pages) + 1)]:
            raise ValueError("EPUB spine order mismatch")
        nav = ET.fromstring(archive.read("OEBPS/nav.xhtml"))
        actual = [(a.text, a.get("href")) for a in nav.findall(".//x:nav/x:ol/x:li/x:a", namespace)]
        expected, offset = [], 1
        for ch in chapters:
            label = "Ch. " + ch["label"] if len(chapters) > 1 else f"{converter.SERIES} - Ch. {ch['label']}"
            expected.append((label, f"{offset:04d}.xhtml"))
            offset += sum(len(image["pages"]) for image in ch["prepared"])
        if actual != expected:
            raise ValueError("EPUB chapter TOC order mismatch")
        for index, (label, source, page) in enumerate(pages, 1):
            if digest(archive.read(f"OEBPS/img/{index:04d}.jpg")) != page["sha256"]:
                raise ValueError(f"Image/order mismatch at EPUB page {index}")
    return [{"epub_page": index, "chapter": label, "source": source["source"],
             "source_sha256": source["source_sha256"], "part": page["part"],
             "jpeg_sha256": page["sha256"]} for index, (label, source, page) in enumerate(pages, 1)]


def validator():
    path = Path(__file__).resolve().parent.parent / "automation" / "validate_epub.py"
    spec = importlib.util.spec_from_file_location("wm_validate_epub", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.validate


def pack(chapters, output, cache, series, max_bytes, validate):
    prefix = re.sub(r"[^A-Za-z0-9._-]+", "-", series).strip("-") or "book"
    report, position, number = [], 0, 1
    with tempfile.TemporaryDirectory(prefix="wm-collections-", dir=output) as temporary:
        scratch = Path(temporary)
        while position < len(chapters):
            # Stored JPEG bytes are an exact lower bound, so skip impossible candidates.
            stop, image_bytes = position, 0
            while stop < len(chapters):
                added = sum(page["bytes"] for im in chapters[stop]["prepared"] for page in im["pages"])
                if image_bytes + added > max_bytes:
                    break
                image_bytes += added
                stop += 1
            if stop == position:
                raise ValueError(f"Whole chapter {chapters[position]['label']} alone exceeds the size limit")
            while True:
                group = chapters[position:stop]
                candidate = scratch / "candidate.epub"
                page_count = build_cached(group, candidate, cache, series, number)
                if candidate.stat().st_size <= max_bytes:
                    break
                stop -= 1
                if stop == position:
                    raise ValueError(f"Whole chapter {chapters[position]['label']} exceeds the limit including EPUB overhead")
            label = group[0]["label"] + "-" + group[-1]["label"]
            destination = output / f"{prefix}-ch{label}.epub"
            if destination.exists():
                raise ValueError(f"Destination already exists; choose an empty output folder: {destination}")
            validation = validate(candidate)
            trace = verify_order(candidate, group, cache)
            candidate.replace(destination)
            info = {"file": str(destination.resolve()), "chapters": [c["label"] for c in group],
                    "bytes": destination.stat().st_size, "pages": page_count,
                    "source_images": sum(len(c["prepared"]) for c in group),
                    "validation": {**validation, "file": str(destination.resolve())}, "page_order": trace}
            report.append(info)
            print(f"Ready {destination.name}: {info['bytes'] / 1_000_000:.3f} MB, {page_count} pages, chapters {label}", flush=True)
            position, number = stop, number + 1
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("series")
    parser.add_argument("--max-mb", type=Decimal, default=Decimal("200"), help="Strict decimal MB limit; 200 = 200,000,000 bytes")
    parser.add_argument("--cache", type=Path, default=Path("output/collection-cache"))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--from", dest="start", type=Decimal)
    parser.add_argument("--to", dest="stop", type=Decimal)
    parser.add_argument("--audit-report", type=Path, help="Optional saved live/Nori audit with expectedPages per chapter")
    args = parser.parse_args(argv)
    try:
        if not args.max_mb.is_finite() or args.max_mb <= 0 or not 1 <= args.workers <= 32:
            raise ValueError("Positive finite size and 1–32 workers required")
        if any(v is not None and (not v.is_finite() or v < 0) for v in (args.start, args.stop)):
            raise ValueError("Chapter bounds must be finite, nonnegative numbers")
        if args.start is not None and args.stop is not None and args.start > args.stop:
            raise ValueError("Chapter range is reversed")
        chapters = discover(args.source, args.start, args.stop)
        check_expected(chapters, expected_chapters(args.audit_report), args.start, args.stop)
        args.cache.mkdir(parents=True, exist_ok=True)
        args.output.mkdir(parents=True, exist_ok=True)
        prepared = {}
        sources = [p for ch in chapters for p in ch["files"]]
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            jobs = {pool.submit(prepare_file, p, args.cache): p for p in sources}
            for count, future in enumerate(as_completed(jobs), 1):
                source = jobs[future]
                prepared[str(source.resolve())] = future.result()
                if count % 100 == 0:
                    print(f"Prepared {count}/{len(sources)} source images", flush=True)
        for ch in chapters:
            ch["prepared"] = [prepared[str(p.resolve())] for p in ch["files"]]
            hashes = [image["source_sha256"] for image in ch["prepared"]]
            if len(hashes) != len(set(hashes)):
                raise ValueError(f"Duplicate source images within chapter {ch['label']}")
        books = pack(chapters, args.output, args.cache, args.series, int(args.max_mb * 1_000_000), validator())
        report = {"source": str(args.source.resolve()), "series": args.series, "max_bytes": int(args.max_mb * 1_000_000),
                  "settings": SETTINGS, "audit_report": str(args.audit_report.resolve()) if args.audit_report else None,
                  "completeness": "API page totals checked" if args.audit_report else "Local gaps only; trailing losses require an API audit", "collections": books}
        atomic_write(args.output / "collections-report.json", json.dumps(report, indent=2, ensure_ascii=False).encode())
        print(f"Finished: {len(books)} collections, {len(sources)} source images. Report: {args.output / 'collections-report.json'}", flush=True)
    except (ValueError, OSError, InvalidOperation) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
