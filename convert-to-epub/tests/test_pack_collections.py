"""Integration checks for ordering, exact limits and missing-source refusal."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from decimal import Decimal
from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import pack_collections as pack


class PackingTests(unittest.TestCase):
    def test_numeric_fractional_order_and_source_gap_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            for name in ('10', '9.1', '9'):
                folder = source / name
                folder.mkdir()
                Image.new('L', (10, 20), 127).save(folder / '001.png')
            self.assertEqual([c['label'] for c in pack.discover(source)], ['9', '9.1', '10'])
            Image.new('L', (10, 20), 0).save(source / '9' / '003.png')
            with self.assertRaisesRegex(ValueError, 'missing pages'):
                pack.discover(source)

    def test_fractional_only_interval_does_not_require_excluded_integer(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            for name in ('21.3', '21.1', '21.2'):
                folder = source / name
                folder.mkdir()
                Image.new('L', (10, 20), 127).save(folder / '001.png')
            self.assertEqual([c['label'] for c in pack.discover(source, Decimal('21.1'), Decimal('21.3'))],
                             ['21.1', '21.2', '21.3'])

    def test_api_report_rejects_missing_final_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp)
            folder = source / '1'
            folder.mkdir()
            Image.new('L', (10, 20), 127).save(folder / '001.png')
            chapters = pack.discover(source)
            with self.assertRaisesRegex(ValueError, 'API expected 2'):
                pack.check_expected(chapters, {'1': {'expectedPages': 2}})

    def test_api_report_rejects_missing_fractional_chapter(self):
        chapters = [{"label": "1", "value": Decimal("1"), "files": ["001.png"]},
                    {"label": "2", "value": Decimal("2"), "files": ["001.png"]}]
        with self.assertRaisesRegex(ValueError, 'missing locally'):
            pack.check_expected(chapters, {"1": {"expectedPages": 1},
                                          "1.5": {"expectedPages": 1},
                                          "2": {"expectedPages": 1}})

    def test_api_report_rejects_missing_fractional_at_explicit_upper_boundary(self):
        chapters = [{"label": "21.1", "value": Decimal("21.1"), "files": ["001.png"]},
                    {"label": "21.2", "value": Decimal("21.2"), "files": ["001.png"]}]
        expected = {"21.1": {"expectedPages": 1}, "21.2": {"expectedPages": 1},
                    "21.3": {"expectedPages": 1}}
        with self.assertRaisesRegex(ValueError, 'missing locally'):
            pack.check_expected(chapters, expected, Decimal('21.1'), Decimal('21.3'))

    def test_spread_right_first_cache_and_actual_epub_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = root / 'cache'
            cache.mkdir()
            # White left half, black right half; independently observable ordering.
            spread = Image.new('L', (120, 80), 255)
            spread.paste(0, (60, 0, 120, 80))
            source = root / '001.png'
            spread.save(source)
            result = pack.prepare_file(source, cache)
            self.assertEqual([p['part'] for p in result['pages']], ['right', 'left'])
            means = []
            for page in result['pages']:
                with Image.open(cache / page['cache_name']) as image:
                    means.append(ImageStat.Stat(image).mean[0])
            self.assertLess(means[0], 2)
            self.assertGreater(means[1], 253)
            cached = pack.prepare_file(source, cache)
            self.assertEqual(cached, result)
            chapters = [{'label': '1', 'prepared': [result]}]
            target = root / 'spread.epub'
            pack.build_cached(chapters, target, cache, 'Test', 1)
            checked = pack.validator()(target)
            self.assertEqual(checked['pages'], 2)
            trace = pack.verify_order(target, chapters, cache)
            self.assertEqual([page['part'] for page in trace], ['right', 'left'])

    def test_decimal_size_cap_keeps_whole_chapters(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, output, cache = root / 'source', root / 'output', root / 'cache'
            source.mkdir()
            for chapter in ('1', '2'):
                folder = source / chapter
                folder.mkdir()
                for n in (1, 2):
                    # High entropy content keeps the size boundary meaningful.
                    image = Image.effect_noise((256, 384), 80)
                    image.save(folder / f'{n:03}.png')
            pack.main([str(source), str(output), 'Test', '--cache', str(cache), '--max-mb', '0.15'])
            report = json.loads((output / 'collections-report.json').read_text())
            self.assertEqual(report['max_bytes'], 150000)
            self.assertEqual([b['chapters'] for b in report['collections']], [['1'], ['2']])
            self.assertTrue(all(Path(b['file']).stat().st_size <= 150000 for b in report['collections']))
            self.assertEqual(sum(b['source_images'] for b in report['collections']), 4)


if __name__ == '__main__':
    unittest.main()
