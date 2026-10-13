"""Validate the structure and images of an EPUB produced by this project."""
import argparse
import io
import json
import posixpath
import zipfile
from xml.etree import ElementTree as ET
from PIL import Image


def validate(filename):
    with zipfile.ZipFile(filename) as archive:
        entries = archive.infolist()
        if not entries or entries[0].filename != "mimetype" or entries[0].compress_type != zipfile.ZIP_STORED:
            raise ValueError("mimetype must be the first, uncompressed entry")
        if archive.read("mimetype") != b"application/epub+zip":
            raise ValueError("Incorrect EPUB mimetype")
        names = set(archive.namelist())
        if len(names) != len(entries) or archive.testzip() is not None:
            raise ValueError("Duplicate archive entries or invalid CRC")
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        rootfile = container.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile")
        if rootfile is None:
            raise ValueError("Missing package rootfile")
        package_path = rootfile.attrib["full-path"]
        package = ET.fromstring(archive.read(package_path))
        namespace = {"opf": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/"}
        base = posixpath.dirname(package_path)
        manifest = {}
        images = []
        for item in package.findall("opf:manifest/opf:item", namespace):
            target = posixpath.normpath(posixpath.join(base, item.attrib["href"]))
            if target not in names:
                raise ValueError("Missing resource: " + target)
            manifest[item.attrib["id"]] = target
            if item.attrib["media-type"].startswith("image/"):
                images.append(target)
            if item.attrib["media-type"] == "application/xhtml+xml":
                page = ET.fromstring(archive.read(target))
                for element in page.iter():
                    href = element.get("{http://www.w3.org/1999/xlink}href") or element.get("src")
                    if href and posixpath.normpath(posixpath.join(posixpath.dirname(target), href)) not in names:
                        raise ValueError("Missing image referenced by " + target)
        pages = package.findall("opf:spine/opf:itemref", namespace)
        if not pages or any(page.attrib["idref"] not in manifest for page in pages):
            raise ValueError("Missing or invalid spine")
        if not images:
            raise ValueError("Missing images")
        for image in images:
            with Image.open(io.BytesIO(archive.read(image))) as bitmap:
                bitmap.verify()
        title = package.find("opf:metadata/dc:title", namespace)
        return {"file": str(filename), "title": title.text if title is not None else None,
                "pages": len(pages), "images": len(images), "archive_valid": True,
                "xml_valid": True, "references_valid": True, "images_valid": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("epub")
    arguments = parser.parse_args()
    print(json.dumps(validate(arguments.epub), indent=2, ensure_ascii=False))
