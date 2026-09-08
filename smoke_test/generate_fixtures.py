#!/usr/bin/env python3
"""
Regenerates the fixture files under test/test_cases/. These are checked
into the repo already -- you only need this if you want to change them.

Requires: reportlab, Pillow (not needed to just RUN the smoke suite,
only to regenerate fixtures).
"""

import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "test", "test_cases")


def make_pdf():
    from reportlab.pdfgen import canvas

    path = os.path.join(OUT_DIR, "sample.pdf")
    c = canvas.Canvas(path)
    c.drawString(100, 750, "Smoke Test PDF")
    c.drawString(100, 730, "Fixture used by test_file_reading.py")
    c.drawString(100, 710, "If you can read this via /api/upload-document, extraction works.")
    c.save()
    print(f"wrote {path}")


def make_po_image():
    from PIL import Image, ImageDraw

    path = os.path.join(OUT_DIR, "sample_po.png")
    img = Image.new("RGB", (900, 500), "white")
    d = ImageDraw.Draw(img)
    d.text((30, 30), "PURCHASE ORDER", fill="black")
    d.text((30, 80), "Supplier: Acme Steel Co.", fill="black")
    d.text((30, 110), "PO No: PO-SMOKE-0001", fill="black")
    d.text((30, 160), "Item: Steel Rod      Qty: 10   Rate: 100.00", fill="black")
    d.text((30, 190), "Item: Copper Wire    Qty: 25   Rate: 50.00", fill="black")
    d.text((30, 240), "This is a synthetic fixture for OCR smoke testing.", fill="black")
    img.save(path)
    print(f"wrote {path}")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    make_pdf()
    make_po_image()
