"""Release packaging tests; no browser, network or credentials."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('packaging_script', Path(__file__).resolve().parents[1] / 'scripts/package.py')
packaging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packaging)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sentence-package-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        manifest = json.dumps({'name': 'Fixture', 'version': '1.5.3'})
        (self.root / 'package.json').write_text(manifest)
        for folder in ('extension', 'dist'):
            (self.root / folder).mkdir()
            (self.root / folder / 'manifest.json').write_text(manifest)
        (self.root / 'dist/BUILD.txt').write_text('Fixture build')

    def test_exact_reproducible_archive(self):
        archive = packaging.package_extension(self.root)
        first = archive.read_bytes()
        with zipfile.ZipFile(archive) as z:
            self.assertEqual(set(z.namelist()), {'manifest.json', 'BUILD.txt'})
            self.assertIsNone(z.testzip())
        self.assertTrue((self.root / 'sentence-extension.zip.sha256').is_file())
        packaging.package_extension(self.root)
        self.assertEqual(first, archive.read_bytes())

    def test_stale_file_rejected(self):
        (self.root / 'dist/old-key.txt').write_text('fixture')
        with self.assertRaisesRegex(ValueError, 'file list'):
            packaging.package_extension(self.root)

    def test_changed_source_rejected(self):
        (self.root / 'extension/manifest.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'differs from source'):
            packaging.package_extension(self.root)

    def test_mismatched_version_rejected(self):
        (self.root / 'package.json').write_text('{"version":"0.0.0"}')
        with self.assertRaisesRegex(ValueError, 'versions must match'):
            packaging.package_extension(self.root)


if __name__ == '__main__':
    unittest.main()
