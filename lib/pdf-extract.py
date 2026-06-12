#!/usr/bin/env python3
"""
Extract PDF to markdown using pymupdf4llm.
Usage: python pdf-extract.py <input_pdf_path> <output_md_path>
"""

import sys
import json
from pathlib import Path

try:
    import pymupdf4llm
except ImportError:
    print(json.dumps({"error": "pymupdf4llm not installed. Run: pip install pymupdf4llm"}), file=sys.stderr)
    sys.exit(1)


def extract_pdf(pdf_path: str) -> str:
    """Extract PDF to markdown."""
    try:
        md_text = pymupdf4llm.to_markdown(pdf_path)
        return md_text
    except Exception as e:
        raise RuntimeError(f"PDF extraction failed: {str(e)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python pdf-extract.py <pdf_path>"}), file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]

    if not Path(pdf_path).exists():
        print(json.dumps({"error": f"File not found: {pdf_path}"}), file=sys.stderr)
        sys.exit(1)

    try:
        markdown = extract_pdf(pdf_path)
        print(json.dumps({"markdown": markdown}))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
