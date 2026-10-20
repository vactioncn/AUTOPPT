"""Build an offline runtime font pack from the reviewed static-font manifest.

No system fonts or workspace records are read or changed. Run with the same
fonttools environment as embed-pptx-fonts.py; the output directory must be new.
"""
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("embed_fonts", Path(__file__).with_name("embed-pptx-fonts.py"))
fonts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fonts)


def prepare(manifest, output):
    manifest, output = Path(manifest).resolve(), Path(output).resolve()
    entries = []
    payloads = {}
    seen = set()
    for source in json.loads(manifest.read_text())["fonts"]:
        data = (manifest.parent / source["file"]).read_bytes()
        font = fonts.inspect_font(data)
        family, slot = source["family"], source["slot"]
        actual_slot = "bold" if font["OS/2"].fsSelection & 32 else "regular"
        if font["OS/2"].fsSelection & 1 or slot != actual_slot:
            raise ValueError("Only verified regular and bold faces are supported")
        if font["name"].getDebugName(1) != family or fonts.digest(data) != source["sha256"]:
            raise ValueError("Font identity differs from manifest")
        if (family, slot) in seen:
            raise ValueError("Duplicate face")
        seen.add((family, slot))
        license_text = (manifest.parent / source["licenseFile"]).read_text()
        if "SIL OPEN FONT LICENSE" not in license_text:
            raise ValueError("Only reviewed OFL fonts are redistributed")
        eot = fonts.make_eot(data)
        if fonts.read_eot(eot)[1] != data:
            raise ValueError("EOT roundtrip mismatch")
        file = f"font-{len(entries) + 1}.fntdata"
        payloads[file] = eot
        entries.append(dict(family=family, slot=slot, weight=font["OS/2"].usWeightClass,
                            file=file, sha256=fonts.digest(eot), characters=sorted(font.getBestCmap()), license=license_text))
    output.mkdir(parents=True, exist_ok=False)
    for file, data in payloads.items():
        (output / file).write_bytes(data)
    (output / "manifest.json").write_text(json.dumps(dict(version=1, fonts=entries), ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest")
    parser.add_argument("output")
    args = parser.parse_args()
    prepare(args.manifest, args.output)
