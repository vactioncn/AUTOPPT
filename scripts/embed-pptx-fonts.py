"""Embed explicit, editable static TTF faces into an isolated PPTX copy.

Requires fonttools (see requirements-pptx-fonts.txt). Does not discover system
fonts, install fonts, subset glyphs, call models, or access project storage.
Font parts follow Microsoft's EOT and PresentationML font-part formats.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET
import zipfile

from fontTools.ttLib import TTFont

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
for prefix, namespace in NS.items():
    ET.register_namespace(prefix, namespace)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inspect_font(data):
    font = TTFont(io.BytesIO(data))
    if "fvar" in font or "glyf" not in font:
        raise ValueError("This prototype requires static TrueType outlines")
    rights = font["OS/2"].fsType
    # Fail closed for restricted, preview-only and bitmap-only permissions.
    if rights & 0x200 or (rights & 0xE) not in (0, 8):
        raise ValueError("Font does not permit editable outline embedding")
    return font


def make_eot(data):
    font = inspect_font(data)
    os2 = font["OS/2"]
    header = bytearray(80)
    struct.pack_into("<III", header, 4, len(data), 0x00020001, 0)
    panose = os2.panose
    header[16:26] = bytes(getattr(panose, key) for key in (
        "bFamilyType", "bSerifStyle", "bWeight", "bProportion", "bContrast",
        "bStrokeVariation", "bArmStyle", "bLetterForm", "bMidline", "bXHeight",
    ))
    header[26] = 1  # DEFAULT_CHARSET; Unicode cmap carries the actual coverage.
    header[27] = int(bool(os2.fsSelection & 1))
    struct.pack_into("<IHH", header, 28, os2.usWeightClass, os2.fsType, 0x504C)
    struct.pack_into("<4I", header, 36, *(getattr(os2, f"ulUnicodeRange{i}") for i in range(1, 5)))
    struct.pack_into("<2I", header, 52, *(getattr(os2, f"ulCodePageRange{i}", 0) for i in (1, 2)))
    struct.pack_into("<I", header, 60, font["head"].checkSumAdjustment)
    strings = []
    for name_id in (1, 2, 5, 4):
        value = font["name"].getDebugName(name_id)
        if not value:
            raise ValueError(f"Missing font name {name_id}")
        encoded = value.encode("utf-16le")
        strings.append(struct.pack("<HH", 0, len(encoded)) + encoded)
    strings.append(struct.pack("<HH", 0, 0))  # Empty root string for OFL fonts.
    result = bytes(header) + b"".join(strings) + data
    result = struct.pack("<I", len(result)) + result[4:]
    return result


def read_eot(data):
    if len(data) < 100 or struct.unpack_from("<I", data, 0)[0] != len(data):
        raise ValueError("Invalid EOT size")
    if struct.unpack_from("<I", data, 8)[0] != 0x20001 or struct.unpack_from("<H", data, 34)[0] != 0x504C:
        raise ValueError("Unexpected EOT version or magic")
    if struct.unpack_from("<I", data, 12)[0] != 0:
        raise ValueError("Expected whole, uncompressed, non-subset font")
    offset = 80
    names = []
    for _ in range(5):
        padding, size = struct.unpack_from("<HH", data, offset)
        if padding or size % 2 or offset + 4 + size > len(data):
            raise ValueError("Invalid EOT string")
        offset += 4
        names.append(data[offset:offset + size].decode("utf-16le"))
        offset += size
    font_data = data[offset:]
    if len(font_data) != struct.unpack_from("<I", data, 4)[0]:
        raise ValueError("Truncated EOT font data")
    font = inspect_font(font_data)
    if font["name"].getDebugName(1) != names[0] or font["OS/2"].fsType != struct.unpack_from("<H", data, 32)[0]:
        raise ValueError("EOT metadata differs from its font")
    return names, font_data


def xml_bytes(root):
    # OPC parts use their package namespace as the default, as Office writes it.
    for namespace in (CT, REL):
        if root.tag.startswith("{" + namespace + "}"):
            ET.register_namespace("", namespace)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def embed(input_path, manifest_path, output_path):
    input_path, manifest_path, output_path = map(Path, (input_path, manifest_path, output_path))
    if input_path.resolve() == output_path.resolve() or output_path.exists():
        raise ValueError("Use a new output file; originals are never overwritten")
    source = input_path.read_bytes()
    config = json.loads(manifest_path.read_text())
    faces = {}
    for spec in config["fonts"]:
        slot = spec["slot"]
        if slot not in ("regular", "bold", "italic", "boldItalic"):
            raise ValueError("Unknown font face slot")
        data = (manifest_path.parent / spec["file"]).read_bytes()
        font = inspect_font(data)
        family = font["name"].getDebugName(1)
        if family != spec["family"] or digest(data) != spec["sha256"]:
            raise ValueError("Font identity or fingerprint differs from manifest")
        is_bold, is_italic = bool(font["OS/2"].fsSelection & 32), bool(font["OS/2"].fsSelection & 1)
        expected_slot = ("boldItalic" if is_bold and is_italic else "bold" if is_bold else "italic" if is_italic else "regular")
        if slot != expected_slot:
            raise ValueError("Font face style does not match its slot")
        license_text = (manifest_path.parent / spec["licenseFile"]).read_text()
        if "SIL OPEN FONT LICENSE" not in license_text:
            raise ValueError("This experiment only redistributes reviewed OFL fonts")
        if (family, slot) in faces:
            raise ValueError("Duplicate font face")
        faces[family, slot] = {"data": data, "cmap": font.getBestCmap(), "license": license_text,
                               "glyphs": len(font.getGlyphOrder()), "rights": font["OS/2"].fsType}
    with zipfile.ZipFile(io.BytesIO(source)) as z:
        if len(z.namelist()) != len(set(z.namelist())):
            raise ValueError("Duplicate ZIP entries")
        parts = {name: z.read(name) for name in z.namelist() if not name.endswith("/")}
    used = set()
    text_count = 0
    slide_names = sorted(name for name in parts if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
    for name in slide_names:
        slide = ET.fromstring(parts[name])
        if slide.findall(".//a:fld", NS):
            raise ValueError("Dynamic fields are outside this explicit-text experiment")
        for run in slide.findall(".//a:r", NS):
            text = run.find("a:t", NS)
            if text is None or not text.text:
                continue
            props = run.find("a:rPr", NS)
            latin = props.find("a:latin", NS) if props is not None else None
            if latin is None:
                raise ValueError("All visible text runs need explicit fonts in this experiment")
            family = latin.get("typeface")
            bold, italic = props.get("b") in ("1", "true"), props.get("i") in ("1", "true")
            slot = "boldItalic" if bold and italic else "bold" if bold else "italic" if italic else "regular"
            key = family, slot
            if key not in faces:
                raise ValueError(f"Missing embedded face: {key}")
            for script in ("ea", "cs"):
                script_font = props.find(f"a:{script}", NS)
                if script_font is not None and script_font.get("typeface") != family:
                    raise ValueError("Mixed script fonts require separate coverage checks")
            missing = sorted({c for c in text.text if not c.isspace() and ord(c) not in faces[key]["cmap"]})
            if missing:
                raise ValueError(f"Font lacks slide characters: {''.join(missing)}")
            used.add(key)
            text_count += 1
    if not used or set(faces) != used:
        raise ValueError("Embed exactly the font faces used by visible slide text")
    pres = ET.fromstring(parts["ppt/presentation.xml"])
    if pres.find("p:embeddedFontLst", NS) is not None:
        raise ValueError("Input already has embedded fonts; do not overwrite them")
    rels = ET.fromstring(parts["ppt/_rels/presentation.xml.rels"])
    types = ET.fromstring(parts["[Content_Types].xml"])
    ids = {r.get("Id") for r in rels}
    def relationship(kind, target):
        i = 1
        while f"rIdEmbeddedFont{i}" in ids:
            i += 1
        rid = f"rIdEmbeddedFont{i}"
        ids.add(rid)
        ET.SubElement(rels, f"{{{REL}}}Relationship", Id=rid, Type=f"{NS['r']}/{kind}", Target=target)
        return rid
    font_list = ET.Element(f"{{{NS['p']}}}embeddedFontLst")
    report = []
    licenses = ET.Element("fontLicenses", xmlns="urn:jianghao:embedded-fonts:v1")
    for family in dict.fromkeys(key[0] for key in faces):
        entry = ET.SubElement(font_list, f"{{{NS['p']}}}embeddedFont")
        ET.SubElement(entry, f"{{{NS['p']}}}font", typeface=family)
        for slot in ("regular", "bold", "italic", "boldItalic"):
            face = faces.get((family, slot))
            if face is None:
                continue
            name = f"ppt/fonts/jianghao-{len(report)+1}.fntdata"
            if name in parts:
                raise ValueError("Font part already exists")
            eot = make_eot(face["data"])
            _, decoded = read_eot(eot)
            if decoded != face["data"]:
                raise ValueError("Embedding changed font bytes")
            parts[name] = eot
            rid = relationship("font", name.removeprefix("ppt/"))
            ET.SubElement(entry, f"{{{NS['p']}}}{slot}", {f"{{{NS['r']}}}id": rid})
            report.append({"family": family, "slot": slot, "part": name, "characters": len(face["cmap"]),
                           "glyphs": face["glyphs"], "fsType": face["rights"], "ttfSha256": digest(decoded), "fullFileBytes": len(decoded)})
        ET.SubElement(licenses, "font", family=family).text = next(v["license"] for k, v in faces.items() if k[0] == family)
    later = {"custShowLst", "photoAlbum", "custDataLst", "kinsoku", "defaultTextStyle", "modifyVerifier", "extLst"}
    index = next((i for i, child in enumerate(pres) if child.tag.split("}")[-1] in later), len(pres))
    pres.insert(index, font_list)
    pres.set("embedTrueTypeFonts", "1")
    pres.set("saveSubsetFonts", "0")
    font_types = [t for t in types if t.get("Extension") == "fntdata"]
    if any(t.get("ContentType") != "application/x-fontdata" for t in font_types):
        raise ValueError("Conflicting font content type")
    if not font_types:
        ET.SubElement(types, f"{{{CT}}}Default", Extension="fntdata", ContentType="application/x-fontdata")
    license_part = "ppt/customXml/jianghao-font-licenses.xml"
    if license_part in parts:
        raise ValueError("License part already exists")
    relationship("customXml", license_part.removeprefix("ppt/"))
    parts[license_part] = xml_bytes(licenses)
    parts["ppt/presentation.xml"] = xml_bytes(pres)
    parts["ppt/_rels/presentation.xml.rels"] = xml_bytes(rels)
    parts["[Content_Types].xml"] = xml_bytes(types)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("xb") as f:
        f.write(output.getvalue())
    if input_path.read_bytes() != source:
        raise ValueError("Source changed during embedding")
    return {"inputSha256": digest(source), "outputSha256": digest(output.getvalue()), "slides": len(slide_names),
            "editableTextRuns": text_count, "faces": report, "saveSubsetFonts": False, "sourceUnchanged": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("manifest")
    parser.add_argument("output")
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    report_path = Path(args.report)
    if report_path.exists() or report_path.resolve() in {
        Path(p).resolve() for p in (args.input, args.manifest, args.output)
    }:
        parser.error("Use a new, separate report file")
    result = embed(args.input, args.manifest, args.output)
    with report_path.open("x") as report_file:
        report_file.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))
