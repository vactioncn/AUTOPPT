"""Focused font/package checks; uses a tiny generated font, no user projects."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

spec = importlib.util.spec_from_file_location(
    "embed_fonts", Path(__file__).resolve().parents[1] / "scripts/embed-pptx-fonts.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def font_bytes(rights=0):
    builder = FontBuilder(1000, isTTF=True)
    names = [".notdef", "A", "spring"]
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({65: "A", ord("春"): "spring"})
    glyphs = {}
    for name in names:
        pen = TTGlyphPen(None)
        pen.moveTo((0, 0))
        pen.lineTo((300, 0))
        pen.lineTo((150, 700))
        pen.closePath()
        glyphs[name] = pen.glyph()
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (600, 0) for name in names})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": "Test Font", "styleName": "Regular",
                            "uniqueFontIdentifier": "TestFont-1", "fullName": "Test Font Regular",
                            "psName": "TestFont-Regular", "version": "Version 1.0"})
    builder.setupOS2(fsType=rights, fsSelection=64)
    builder.setupPost()
    builder.setupMaxp()
    data = io.BytesIO()
    builder.save(data)
    return data.getvalue()


class EmbeddedFontTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        data = font_bytes()
        (self.root / "font.ttf").write_bytes(data)
        (self.root / "OFL.txt").write_text("SIL OPEN FONT LICENSE Version 1.1 - test fixture")
        self.manifest = self.root / "fonts.json"
        self.manifest.write_text(json.dumps({"fonts": [{"family": "Test Font", "slot": "regular",
            "file": "font.ttf", "licenseFile": "OFL.txt", "sha256": module.digest(data)}]}))
        self.source = self.root / "source.pptx"
        self.output = self.root / "embedded.pptx"
        self.parts = {
            "[Content_Types].xml": f'<Types xmlns="{module.CT}"><Default Extension="xml" ContentType="application/xml"/></Types>'.encode(),
            "ppt/presentation.xml": f'<p:presentation xmlns:p="{module.NS["p"]}"><p:defaultTextStyle/></p:presentation>'.encode(),
            "ppt/_rels/presentation.xml.rels": f'<Relationships xmlns="{module.REL}"/>'.encode(),
            "ppt/slides/slide1.xml": f'<p:sld xmlns:p="{module.NS["p"]}" xmlns:a="{module.NS["a"]}"><a:r><a:rPr><a:latin typeface="Test Font"/><a:ea typeface="Test Font"/></a:rPr><a:t>A</a:t></a:r></p:sld>'.encode(),
            "ppt/media/image.png": b"untouched-background-bytes",
        }
        self.write_source()

    def write_source(self):
        with zipfile.ZipFile(self.source, "w") as z:
            for name, data in self.parts.items():
                z.writestr(name, data)

    def test_full_font_round_trip_and_original_parts_preserved(self):
        original = self.source.read_bytes()
        result = module.embed(self.source, self.manifest, self.output)
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual(result["editableTextRuns"], 1)
        with zipfile.ZipFile(self.output) as z:
            for name in ("ppt/slides/slide1.xml", "ppt/media/image.png"):
                self.assertEqual(z.read(name), self.parts[name])
            _, data = module.read_eot(z.read("ppt/fonts/jianghao-1.fntdata"))
            self.assertEqual(data, (self.root / "font.ttf").read_bytes())
            # A character absent from the slide must survive embedding for later editing.
            self.assertIn(ord("春"), module.inspect_font(data).getBestCmap())
            pres = ET.fromstring(z.read("ppt/presentation.xml"))
            self.assertEqual(pres.get("saveSubsetFonts"), "0")
            self.assertEqual(pres[-2].tag, f'{{{module.NS["p"]}}}embeddedFontLst')
            self.assertIn(b'<Types xmlns=', z.read("[Content_Types].xml"))
            self.assertIn(b'SIL OPEN FONT LICENSE', z.read("ppt/customXml/jianghao-font-licenses.xml"))

    def test_embedding_permissions(self):
        for rights in (2, 4, 0x200, 6):
            with self.subTest(rights=rights), self.assertRaisesRegex(ValueError, "editable"):
                module.make_eot(font_bytes(rights))
        for rights in (0, 8, 0x100, 0x108):
            data = font_bytes(rights)
            self.assertEqual(module.read_eot(module.make_eot(data))[1], data)

    def test_never_overwrites_source_or_existing_output(self):
        with self.assertRaisesRegex(ValueError, "never overwritten"):
            module.embed(self.source, self.manifest, self.source)
        self.output.write_bytes(b"existing output")
        with self.assertRaises(ValueError):
            module.embed(self.source, self.manifest, self.output)
        self.assertEqual(self.output.read_bytes(), b"existing output")

    def test_missing_characters_fail_before_output(self):
        name = "ppt/slides/slide1.xml"
        self.parts[name] = self.parts[name].replace(b">A<", ">缺<".encode())
        self.write_source()
        with self.assertRaisesRegex(ValueError, "lacks slide characters"):
            module.embed(self.source, self.manifest, self.output)
        self.assertFalse(self.output.exists())

    def test_face_identity_and_style_must_match(self):
        original = json.loads(self.manifest.read_text())
        for field, value in (("sha256", "wrong"), ("family", "Wrong"), ("slot", "bold")):
            config = json.loads(json.dumps(original))
            config["fonts"][0][field] = value
            self.manifest.write_text(json.dumps(config))
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.embed(self.source, self.manifest, self.output)
        self.assertFalse(self.output.exists())

    def test_existing_embedded_fonts_not_replaced(self):
        module.embed(self.source, self.manifest, self.output)
        with self.assertRaisesRegex(ValueError, "already has embedded"):
            module.embed(self.output, self.manifest, self.root / "another.pptx")

    def test_invalid_eot_and_dynamic_fields_rejected(self):
        data = module.make_eot(font_bytes())
        with self.assertRaises(ValueError):
            module.read_eot(data[:-1])
        name = "ppt/slides/slide1.xml"
        self.parts[name] = self.parts[name].replace(b'</p:sld>', b'<a:fld/></p:sld>')
        self.write_source()
        with self.assertRaisesRegex(ValueError, "Dynamic fields"):
            module.embed(self.source, self.manifest, self.output)


if __name__ == "__main__":
    unittest.main()
