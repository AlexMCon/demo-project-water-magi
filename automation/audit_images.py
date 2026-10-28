"""Audit chapter image folders without changing them; optionally compare an API report.

Only API totals can detect missing pages at the end. Uniform/duplicate images
are findings to inspect, not proof that the source itself is wrong.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path
import re
from PIL import Image

EXTENSIONS = {'.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.bmp'}


def chapter_number(label):
    label = re.sub(r'^(?:chapter|ch)[-_ ]', '', label, flags=re.IGNORECASE)
    if not re.fullmatch(r'\d+(?:\.\d+)?', label):
        raise ValueError(f'Invalid chapter label: {label}')
    value = Decimal(label)
    return format(value.normalize(), 'f')


def expected_chapters(filenames):
    """Accept live audits, Nori 47 reports and the older Aristocrat batch report."""
    chapters, warnings = {}, []
    for filename in filenames:
        document = json.loads(Path(filename).read_text(encoding='utf-8'))
        batches = document.get('batches', [document])
        for batch in batches:
            if not batch.get('complete', False):
                warnings.append(f'API report is partial: {filename}')
            records = batch.get('chapters', {})
            iterator = records.items() if isinstance(records, dict) else ((None, value) for value in records)
            for key, value in iterator:
                cap = chapter_number(str(value.get('number', key)))
                total = value.get('expectedPages', value.get('total'))
                if isinstance(total, bool) or not isinstance(total, int) or not 1 <= total <= 10000:
                    raise ValueError(f'Invalid expected total for chapter {cap}')
                dimensions = value.get('pageDimensions')
                if dimensions is not None and (len(dimensions) != total or any(
                        not isinstance(d.get('width'), int) or not isinstance(d.get('height'), int)
                        or d['width'] < 1 or d['height'] < 1 for d in dimensions)):
                    raise ValueError(f'Invalid expected dimensions for chapter {cap}')
                entry = {'total': total, 'dimensions': dimensions, 'source': value.get('group', value.get('sourceName')),
                         'chapterId': value.get('id', value.get('chapterId'))}
                previous = chapters.get(cap)
                if previous and (previous['total'] != total or (
                        previous['chapterId'] and entry['chapterId'] and previous['chapterId'] != entry['chapterId'])):
                    raise ValueError(f'Conflicting API editions/totals for chapter {cap}')
                chapters[cap] = entry
    return chapters, warnings


def image_record(filename):
    before = filename.stat()
    data = filename.read_bytes()
    result = {'name': filename.name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    with Image.open(io.BytesIO(data)) as image:
        result.update(width=image.width, height=image.height, format=image.format)
        # Decode every frame rather than merely reading image headers.
        for index in range(getattr(image, 'n_frames', 1)):
            image.seek(index)
            image.load()
        image.seek(0)
        extrema = image.convert('RGB').getextrema()
        if all(low == high for low, high in extrema):
            result['uniform_rgb'] = [low for low, high in extrema]
        if 'A' in image.getbands() and image.getchannel('A').getextrema()[1] == 0:
            result['fully_transparent'] = True
    after = filename.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError('Image changed during verification')
    return result


def audit(root, *, first=None, last=None, expected=None, workers=4):
    root = Path(root).resolve()
    expected = expected or {}
    if not root.is_dir():
        raise ValueError(f'Source directory does not exist: {root}')
    def selected(cap):
        value = Decimal(cap)
        return (first is None or value >= first) and (last is None or value <= last)
    folders = {}
    for folder in root.iterdir():
        if not folder.is_dir():
            continue
        try:
            cap = chapter_number(folder.name)
        except ValueError:
            continue
        if selected(cap):
            if cap in folders:
                raise ValueError(f'Two folders identify chapter {cap}')
            folders[cap] = folder
    wanted = {cap for cap in expected if selected(cap)} | set(folders)
    if wanted:
        low = first if first is not None else min(map(Decimal, wanted))
        high = last if last is not None else max(map(Decimal, wanted))
        wanted |= {str(n) for n in range(int(low.to_integral_value(rounding='ROUND_CEILING')), int(high) + 1)}
    if not wanted:
        raise ValueError('No numeric chapter folders or matching expected chapters')
    chapters, pending, hashes, errors = {}, {}, defaultdict(list), []
    snapshots = {}
    for cap in sorted(wanted, key=Decimal):
        folder = folders.get(cap)
        files = sorted((p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS),
                       key=lambda p: (0, int(p.stem)) if p.stem.isdigit() else (1, p.name)) if folder else []
        snapshots[cap] = [p.name for p in files]
        numbers = [int(p.stem) for p in files if p.stem.isdigit()]
        total = expected[cap]['total'] if cap in expected else max(numbers, default=0)
        chapters[cap] = {
            'folder': str(folder) if folder else None, 'count': len(files),
            'expectedPages': expected[cap]['total'] if cap in expected else None,
            'missing_chapter': folder is None or not files,
            'gaps': [n for n in range(1, total + 1) if n not in numbers],
            'duplicate_numbers': [n for n, count in Counter(numbers).items() if count > 1],
            'unexpected_files': [p.name for p in files if not p.stem.isdigit() or int(p.stem) < 1
                                 or (cap in expected and int(p.stem) > total)],
            'dimension_mismatches': [], 'files': [],
        }
        for filename in files:
            pending[filename] = cap
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(image_record, filename): filename for filename in pending}
        for future in as_completed(futures):
            filename = futures[future]
            cap = pending[filename]
            try:
                record = future.result()
                chapters[cap]['files'].append(record)
                hashes[record['sha256']].append(f'{cap}/{filename.name}')
                dimensions = expected.get(cap, {}).get('dimensions')
                n = int(filename.stem) if filename.stem.isdigit() else 0
                if dimensions and 1 <= n <= len(dimensions):
                    wanted_dimensions = dimensions[n-1]
                    if (record['width'], record['height']) != (wanted_dimensions['width'], wanted_dimensions['height']):
                        chapters[cap]['dimension_mismatches'].append({'name': filename.name, 'expected': wanted_dimensions,
                                                                     'actual': [record['width'], record['height']]})
            except Exception as error:
                errors.append({'file': str(filename), 'error': str(error)})
    changed = []
    for cap, chapter in chapters.items():
        chapter['files'].sort(key=lambda f: (0, int(Path(f['name']).stem)) if Path(f['name']).stem.isdigit() else (1, f['name']))
        folder = folders.get(cap)
        current = sorted(p.name for p in folder.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS) if folder else []
        if current != sorted(snapshots[cap]):
            changed.append(cap)
    intra = []
    for duplicates in hashes.values():
        duplicates.sort()
        by_chapter = defaultdict(list)
        for name in duplicates:
            by_chapter[name.split('/')[0]].append(name)
        intra.extend(values for values in by_chapter.values() if len(values) > 1)
    missing = {cap: value['gaps'] for cap, value in chapters.items() if value['gaps']}
    unverified = [cap for cap in chapters if cap not in expected]
    failures = bool(errors or changed or missing or intra or any(
        ch['missing_chapter'] or ch['duplicate_numbers'] or ch['unexpected_files'] or ch['dimension_mismatches']
        for ch in chapters.values()))
    summary = {
        'root': str(root), 'chapters': len(chapters), 'images': len(pending),
        'bytes': sum(f['bytes'] for ch in chapters.values() for f in ch['files']),
        'missing_pages': missing, 'missing_chapters': [cap for cap, ch in chapters.items() if ch['missing_chapter']],
        'errors': errors, 'changed_chapters': changed, 'intra_duplicates': intra,
        'cross_chapter_duplicates': [values for values in hashes.values() if len({n.split('/')[0] for n in values}) > 1],
        'uniform_pages': [{'chapter': cap, 'name': f['name'], 'rgb': f.get('uniform_rgb'),
                           'transparent': f.get('fully_transparent', False)}
                          for cap, ch in chapters.items() for f in ch['files']
                          if 'uniform_rgb' in f or f.get('fully_transparent')],
        'api_unverified_chapters': unverified,
        'tail_coverage_confirmed': not unverified,
        'local_checks_passed': not failures,
        'complete_against_api': not failures and not unverified,
    }
    return {'summary': summary, 'chapters': chapters}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--output', default='output/image-audit')
    parser.add_argument('--from', dest='first', type=Decimal)
    parser.add_argument('--to', dest='last', type=Decimal)
    parser.add_argument('--expected', action='append', default=[], metavar='API_JSON')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args(argv)
    if args.workers < 1 or args.workers > 32:
        parser.error('--workers must be between 1 and 32')
    if any(v is not None and (not v.is_finite() or v < 0) for v in [args.first, args.last]):
        parser.error('Chapter range must be finite and nonnegative')
    if args.first is not None and args.last is not None and args.first > args.last:
        parser.error('--from cannot exceed --to')
    try:
        expected, warnings = expected_chapters(args.expected)
        report = audit(args.source, first=args.first, last=args.last, expected=expected, workers=args.workers)
        report['summary']['warnings'] = warnings
        output = Path(args.output)
        output.mkdir(parents=True, exist_ok=True)
        (output/'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        (output/'missing-pages.txt').write_text('\n'.join(
            f'{cap}: '+(', '.join(map(str, ch['gaps'])) if not ch['missing_chapter'] else '*')
            for cap, ch in report['chapters'].items() if ch['gaps'] or ch['missing_chapter'])+'\n', encoding='utf-8')
        print(json.dumps(report['summary'], indent=2, ensure_ascii=False))
        return 0 if report['summary']['local_checks_passed'] and (not args.expected or report['summary']['complete_against_api']) else 1
    except (ValueError, OSError, InvalidOperation) as error:
        parser.error(str(error))


if __name__ == '__main__':
    raise SystemExit(main())
