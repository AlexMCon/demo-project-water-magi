import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from decimal import Decimal
from PIL import Image

SPEC=importlib.util.spec_from_file_location('audit_images',Path(__file__).parents[1]/'audit_images.py')
AUDIT=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)

class AuditImagesTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def image(self,chapter,page,color='white'):
        folder=self.root/str(chapter);folder.mkdir(exist_ok=True)
        path=folder/f'{page:03d}.png';Image.new('RGB',(8,12),color).save(path);return path
    def test_api_detects_trailing_pages_and_entire_missing_chapter(self):
        self.image('10',1)
        report=AUDIT.audit(self.root,first=Decimal(10),last=Decimal(11),expected={'10':{'total':3},'11':{'total':2}})
        self.assertEqual(report['summary']['missing_pages'],{'10':[2,3],'11':[1,2]})
        self.assertEqual(report['summary']['missing_chapters'],['11'])
        self.assertFalse(report['summary']['complete_against_api'])
    def test_observed_range_detects_absent_whole_chapter_without_flags(self):
        self.image('182',1,'red');self.image('184',1,'blue')
        report=AUDIT.audit(self.root)
        self.assertEqual(report['summary']['missing_chapters'],['183'])
        self.assertFalse(report['summary']['local_checks_passed'])

    def test_cross_chapter_duplicates_do_not_hide_internal_duplicates(self):
        self.image('10',1);self.image('10',2);self.image('11',1)
        report=AUDIT.audit(self.root)
        self.assertEqual(report['summary']['intra_duplicates'],[['10/001.png','10/002.png']])
        self.assertEqual(len(report['summary']['cross_chapter_duplicates']),1)
        self.assertEqual(len(report['summary']['uniform_pages']),3)
        self.assertFalse(report['summary']['tail_coverage_confirmed'])
    def test_full_decode_dimension_comparison_and_invalid_file(self):
        self.image('10.1',1,'red')
        file=self.image('10.1',2,'blue');file.write_bytes(b'not an image')
        report=AUDIT.audit(self.root,expected={'10.1':{'total':2,'dimensions':[{'width':8,'height':13},{'width':8,'height':12}]}})
        self.assertEqual(len(report['summary']['errors']),1)
        self.assertEqual(len(report['chapters']['10.1']['dimension_mismatches']),1)
        self.assertFalse(report['summary']['complete_against_api'])
    def test_complete_expected_report_and_conflicting_editions(self):
        self.image('10',1)
        report_file=self.root/'expected.json'
        report_file.write_text(json.dumps({'complete':True,'chapters':[{'number':'10','id':50,'expectedPages':1,'pageDimensions':[{'width':8,'height':12}]}]}))
        expected,warnings=AUDIT.expected_chapters([report_file])
        report=AUDIT.audit(self.root,expected=expected)
        self.assertTrue(report['summary']['complete_against_api']);self.assertEqual(warnings,[])
        second=self.root/'other.json';second.write_text(json.dumps({'chapters':{'10':{'chapterId':99,'expectedPages':1}}}))
        with self.assertRaisesRegex(ValueError,'Conflicting'):
            AUDIT.expected_chapters([report_file,second])

if __name__=='__main__':unittest.main()
