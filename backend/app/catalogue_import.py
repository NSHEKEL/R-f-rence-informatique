import csv
import io
import posixpath
import re
import xml.etree.ElementTree as ET
from zipfile import BadZipFile, ZipFile


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _xml(raw):
    if len(raw) > 16 * 1024 * 1024 or b"<!doctype" in raw.lower() or b"<!entity" in raw.lower():
        raise ValueError("Document XML trop volumineux ou déclaration non autorisée")
    return ET.fromstring(raw)


def _cells(row, xlsx=False, shared=None):
    values = []
    for cell in row:
        if _local(cell.tag) not in ("c", "Cell"):
            continue
        index = len(values)
        if xlsx:
            letters = re.match(r"[A-Za-z]+", cell.get("r", ""))
            if letters:
                index = 0
                for letter in letters[0].upper():
                    index = index * 26 + ord(letter) - 64
                index -= 1
            kind = cell.get("t", "")
            value = next((node.text or "" for node in cell if _local(node.tag) == "v"), "")
            if kind == "s":
                value = shared[int(value)] if value else ""
            elif kind == "inlineStr":
                value = "".join(node.text or "" for node in cell.iter() if _local(node.tag) == "t")
        else:
            declared = next((value for key, value in cell.attrib.items() if _local(key) == "Index"), None)
            if declared is not None:
                index = int(declared) - 1
            value = next(("".join(node.itertext()) for node in cell if _local(node.tag) == "Data"), "")
        if not 0 <= index < 1024:
            raise ValueError("La feuille dépasse 1024 colonnes")
        while len(values) <= index:
            values.append("")
        values[index] = value
    return values


def _xlsx(raw):
    with ZipFile(io.BytesIO(raw)) as book:
        members = book.infolist()
        if len(members) > 2000 or sum(member.file_size for member in members) > 64 * 1024 * 1024:
            raise ValueError("Classeur trop volumineux")
        workbook = _xml(book.read("xl/workbook.xml"))
        sheet = next(node for node in workbook.iter() if _local(node.tag) == "sheet")
        relation_id = next(value for key, value in sheet.attrib.items() if _local(key) == "id")
        relations = _xml(book.read("xl/_rels/workbook.xml.rels"))
        relation = next(node for node in relations if node.get("Id") == relation_id)
        if relation.get("TargetMode") == "External":
            raise ValueError("Feuille externe non prise en charge")
        target = relation.get("Target", "")
        path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target))
        if not path.startswith("xl/"):
            raise ValueError("Chemin de feuille invalide")
        shared = []
        if "xl/sharedStrings.xml" in book.namelist():
            strings = _xml(book.read("xl/sharedStrings.xml"))
            shared = ["".join(node.text or "" for node in item.iter() if _local(node.tag) == "t") for item in strings if _local(item.tag) == "si"]
        root = _xml(book.read(path))
        return [_cells(row, xlsx=True, shared=shared) for row in root.iter() if _local(row.tag) == "row"]


def read_catalogue(raw: bytes, filename: str):
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError("Fichier trop volumineux (20 Mo maximum)")
    if raw.startswith(b"\xd0\xcf\x11\xe0"):
        raise ValueError("Ancien fichier .xls binaire : enregistrez en .xlsx ou .csv")
    try:
        if raw.startswith(b"PK") or filename.lower().endswith(".xlsx"):
            matrix = _xlsx(raw)
        elif raw.lstrip(b"\xef\xbb\xbf \r\n\t").startswith(b"<") or filename.lower().endswith(".xls"):
            root = _xml(raw)
            sheet = next(node for node in root.iter() if _local(node.tag) == "Worksheet")
            matrix = [_cells(row) for row in sheet.iter() if _local(row.tag) == "Row"]
        else:
            try:
                text = raw.decode("utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("latin-1")
            try:
                dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
            except csv.Error:
                dialect = csv.excel
            reader = csv.reader(io.StringIO(text), dialect=dialect)
            matrix = list(reader)
        if len(matrix) > 100_001:
            raise ValueError("La feuille dépasse 100 000 articles")
        while matrix and not any(value.strip() for value in matrix[0]):
            matrix.pop(0)
        if not matrix:
            raise ValueError("Fichier vide ou illisible")
        headers = matrix[0]
        return headers, [dict(zip(headers, row)) for row in matrix[1:]]
    except (BadZipFile, KeyError, StopIteration, ET.ParseError, IndexError, RuntimeError) as exc:
        raise ValueError("Classeur illisible : enregistrez en .xlsx ou .csv") from exc
