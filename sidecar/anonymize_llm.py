#!/usr/bin/env python3
"""
CloakLM — PII Anonymization via GLiNER (AI-powered)
Uses a small, local zero-shot NER model to detect and redact PII.
No Ollama, no cloud, no GPU required. ~300MB model, cached after first run.

Used by server.py as a library (GLiNERAnonymizer class).
Can also be run standalone from the command line.

Usage (standalone):
  python anonymize_llm.py --input ~/docs/w2.md
  python anonymize_llm.py --input ~/docs/w2.md --output ~/safe/
"""

import re
import json
import argparse
import unicodedata
from pathlib import Path
from datetime import datetime
from rich.console import Console
from rich.table import Table

console = Console()

# ---------------------------------------------------------------------------
# Tax form terms that should NEVER be redacted
# ---------------------------------------------------------------------------
TAX_FORM_WHITELIST = {
    "w-2", "w2", "w-4", "w4", "1099-nec", "1099-b", "1099-int", "1099-div",
    "1099-r", "1099-misc", "1099-k", "1099-g", "1099-s", "1099-sa", "1098",
    "1098-t", "1098-e", "form 1040", "1040", "1040-sr",
    "schedule a", "schedule b", "schedule c", "schedule d", "schedule e",
    "schedule f", "schedule se", "schedule 1", "schedule 2", "schedule 3",
    "schedule k-1", "k-1", "form 8949", "form 8829", "form 4562", "form 2441",
    "internal revenue service", "irs", "department of the treasury",
    "social security administration", "ssa", "united states", "u.s.",
    "federal", "state", "medicare", "social security",
    "wages", "tips", "other compensation", "federal income tax withheld",
    "social security wages", "social security tax withheld",
    "medicare wages and tips", "medicare tax withheld",
    "adjusted gross income", "agi", "taxable income", "total tax",
    "standard deduction", "itemized deductions", "filing status",
    "gross income", "net income", "earned income", "unearned income",
    "capital gains", "capital losses", "ordinary dividends",
    "qualified dividends", "interest income", "rental income",
    "business income", "self-employment tax", "estimated tax payments",
    "withholding", "refund", "amount owed", "tax liability",
    "dependent", "exemption", "credit", "deduction",
    "cost basis", "proceeds", "gain", "loss", "short-term", "long-term",
    "wash sale", "depreciation", "amortization",
    "employer identification number", "ein",
    "social security number", "ssn",
    "employee", "employer", "recipient", "payer",
    "control number", "void", "corrected",
    "wage and tax statement", "copy", "year",
    "box 1", "box 2", "box 3", "box 4", "box 5", "box 6", "box 7",
    "box 8", "box 9", "box 10", "box 11", "box 12", "box 13", "box 14",
    "line 1", "line 2", "line 3", "line 4", "line 5", "line 6", "line 7",
    "line 8", "line 9", "line 10", "line 11", "line 12", "line 13",
    "line 14", "line 15", "line 16", "line 17", "line 18", "line 19",
    "line 20", "line 21", "line 22", "line 23", "line 24", "line 25",
}


def is_whitelisted(text: str) -> bool:
    cleaned = text.lower().strip().rstrip(".,;:")
    if cleaned in TAX_FORM_WHITELIST:
        return True
    for term in TAX_FORM_WHITELIST:
        if cleaned.startswith(term) and len(cleaned) - len(term) < 5:
            return True
    return False


# GLiNER entity labels → our placeholder categories
LABEL_MAP = {
    "person": "PERSON",
    "full name": "PERSON",
    "first name": "PERSON",
    "last name": "PERSON",
    "middle name": "PERSON",
    "company": "ORG",
    "organization": "ORG",
    "employer": "ORG",
    "address": "ADDRESS",
    "street address": "ADDRESS",
    "city": "CITY_STATE",
    "state": "CITY_STATE",
    "zip code": "ZIP",
    "social security number": "SSN_REDACTED",
    "ssn": "SSN_REDACTED",
    "ein": "EIN",
    "employer identification number": "EIN",
    "phone number": "PHONE",
    "phone": "PHONE",
    "email": "EMAIL",
    "email address": "EMAIL",
    "account number": "ACCOUNT",
    "bank account": "ACCOUNT",
    "routing number": "ACCOUNT",
}

SINGLE_PLACEHOLDER_CATEGORIES = {"SSN_REDACTED"}

# The labels we ask GLiNER to detect
DETECTION_LABELS = [
    "person",
    "first name",
    "last name",
    "company",
    "organization",
    "street address",
    "city",
    "state",
    "zip code",
    "social security number",
    "employer identification number",
    "phone number",
    "email address",
    "account number",
]


class GLiNERAnonymizer:
    """
    GLiNER-powered PII anonymizer. Uses a zero-shot NER model
    that runs locally on CPU. ~300MB, no Ollama, no cloud.
    """

    def __init__(self, model_name: str = "knowledgator/gliner-pii-small-v1.0",
                 threshold: float = 0.3):
        from gliner import GLiNER

        console.print(f"[dim]Loading GLiNER model: {model_name}[/dim]")
        console.print("[dim](First run downloads ~300MB — cached after that)[/dim]")
        self.model = GLiNER.from_pretrained(model_name)
        self.threshold = threshold

        self.redaction_map = {}
        self.counters = {}
        self.stats = {"total_redactions": 0, "by_category": {}}

    def _get_placeholder(self, real_value: str, category: str) -> str:
        key = f"{category}::{real_value.lower().strip()}"
        if key not in self.redaction_map:
            if category in SINGLE_PLACEHOLDER_CATEGORIES:
                placeholder = f"[{category}]"
            else:
                self.counters[category] = self.counters.get(category, 0) + 1
                placeholder = f"[{category}_{self.counters[category]}]"
            self.redaction_map[key] = {
                "real_value": real_value,
                "placeholder": placeholder,
                "category": category,
            }
            self.stats["total_redactions"] += 1
            self.stats["by_category"][category] = (
                self.stats["by_category"].get(category, 0) + 1
            )
        return self.redaction_map[key]["placeholder"]

    def _process_chunk(self, text: str) -> str:
        """Run GLiNER on a chunk of text and replace entities."""
        if not text.strip():
            return text

        entities = self.model.predict_entities(
            text,
            DETECTION_LABELS,
            threshold=self.threshold,
        )

        # Sort by position (end to start) so replacements don't shift offsets
        entities = sorted(entities, key=lambda e: e["start"], reverse=True)

        for entity in entities:
            entity_text = entity["text"]

            # Skip whitelisted terms
            if is_whitelisted(entity_text):
                continue

            # Map label to our category
            label = entity["label"].lower()
            category = LABEL_MAP.get(label, "PERSON")

            placeholder = self._get_placeholder(entity_text, category)
            text = text[:entity["start"]] + placeholder + text[entity["end"]:]

        return text

    @staticmethod
    def _sanitize_unicode(text: str) -> str:
        """Strip invisible Unicode characters that break regex and search.

        PDF extractors (Docling/OCR) often inject zero-width spaces, soft
        hyphens, RTL marks, and other invisible chars that:
          - break regex patterns (email/SSN/phone won't match)
          - break browser Ctrl+F search (user can't find the PII)
          - but LLM tokenizers normalize them away and "read" the PII

        This is the #1 cause of PII that "leaks" to the LLM but can't be
        found in the Review Panel.
        """
        # Normalize to NFC (compose accented characters)
        text = unicodedata.normalize("NFC", text)
        # Strip zero-width and invisible formatting characters
        _INVISIBLE = re.compile(
            "["
            "\u200b"  # zero-width space
            "\u200c"  # zero-width non-joiner
            "\u200d"  # zero-width joiner
            "\u200e"  # left-to-right mark
            "\u200f"  # right-to-left mark
            "\u00ad"  # soft hyphen
            "\u2060"  # word joiner
            "\u2061"  # function application
            "\u2062"  # invisible times
            "\u2063"  # invisible separator
            "\u2064"  # invisible plus
            "\ufeff"  # BOM / zero-width no-break space
            "\ufff9"  # interlinear annotation anchor
            "\ufffa"  # interlinear annotation separator
            "\ufffb"  # interlinear annotation terminator
            "\u034f"  # combining grapheme joiner
            "\u061c"  # Arabic letter mark
            "\u115f"  # Hangul Choseong Filler
            "\u1160"  # Hangul Jungseong Filler
            "\u17b4"  # Khmer vowel inherent Aq
            "\u17b5"  # Khmer vowel inherent Aa
            "\u180e"  # Mongolian vowel separator
            "]"
        )
        text = _INVISIBLE.sub("", text)
        # Normalize whitespace: replace non-breaking spaces, thin spaces, etc.
        text = re.sub(r"[\u00a0\u2000-\u200a\u202f\u205f\u3000]", " ", text)
        return text

    def anonymize(self, text: str) -> str:
        """Detect and replace all PII using GLiNER."""
        if not isinstance(text, str) or not text.strip():
            return text

        # CRITICAL: Sanitize invisible Unicode BEFORE any detection.
        # Without this, PII hidden behind zero-width chars evades both
        # GLiNER and regex, but LLMs still read it.
        text = self._sanitize_unicode(text)

        # GLiNER has a max token limit. Process in chunks (by line groups)
        # to handle longer documents while preserving context.
        lines = text.split("\n")
        chunk_size = 20  # lines per chunk
        processed_lines = []

        for i in range(0, len(lines), chunk_size):
            chunk = "\n".join(lines[i:i + chunk_size])
            processed = self._process_chunk(chunk)
            processed_lines.append(processed)

        text = "\n".join(processed_lines)

        # --- Supplemental regex pass for structured patterns GLiNER may miss ---
        # SSNs (123-45-6789)
        def _ssn(m):
            if is_whitelisted(m.group()):
                return m.group()
            return self._get_placeholder(m.group(), "SSN_REDACTED")
        text = re.sub(r'\b\d{3}[-\s]\d{2}[-\s]\d{4}\b', _ssn, text)

        # EINs (12-3456789)
        def _ein(m):
            return self._get_placeholder(m.group(), "EIN")
        text = re.sub(r'\b\d{2}-\d{7}\b', _ein, text)

        # Emails
        def _email(m):
            return self._get_placeholder(m.group(), "EMAIL")
        text = re.sub(
            r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
            _email, text)

        # Phone numbers
        def _phone(m):
            return self._get_placeholder(m.group(), "PHONE")
        text = re.sub(
            r'\b(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b',
            _phone, text)

        # Account numbers (XXXX-1234, ***1234)
        def _acct(m):
            return self._get_placeholder(m.group(), "ACCOUNT")
        text = re.sub(r'\b[Xx]{3,}[-\s]?\d{4}\b', _acct, text)
        text = re.sub(r'\*{3,}\d{4}\b', _acct, text)

        # Street addresses (123 Main Street, 4567 Oak Dr., etc.)
        _STREET_SUFFIXES = (
            r"Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Drive|Dr\.?|"
            r"Road|Rd\.?|Lane|Ln\.?|Court|Ct\.?|Place|Pl\.?|Way|"
            r"Circle|Cir\.?|Trail|Trl\.?|Terrace|Ter\.?|Parkway|Pkwy\.?"
        )
        _ADDR_PATTERN = re.compile(
            rf'\b\d{{1,6}}\s+(?:[A-Z][a-zA-Z]*\.?\s+){{1,4}}(?:{_STREET_SUFFIXES})\b\.?',
            re.IGNORECASE
        )
        def _addr(m):
            if is_whitelisted(m.group()):
                return m.group()
            return self._get_placeholder(m.group(), "ADDRESS")
        text = _ADDR_PATTERN.sub(_addr, text)

        # City, State ZIP (e.g. "Springfield, IL 62704", "New York, NY 10001")
        _CITY_STATE_ZIP = re.compile(
            r'\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b'
        )
        def _csz(m):
            if is_whitelisted(m.group()):
                return m.group()
            # Redact each part separately for granular mapping
            city_state = self._get_placeholder(f"{m.group(1)}, {m.group(2)}", "CITY_STATE")
            zip_code = self._get_placeholder(m.group(3), "ZIP")
            return f"{city_state} {zip_code}"
        text = _CITY_STATE_ZIP.sub(_csz, text)

        # --- PARTIALLY-REDACTED EMAIL CLEANUP ---
        # GLiNER often detects the name part of an email as PERSON,
        # producing "[PERSON_4]@knl-cpa.com". The domain leaks the company.
        # Catch these and redact the entire email.
        def _partial_email(m):
            return self._get_placeholder(m.group(), "EMAIL")
        # [PLACEHOLDER]@domain.com  or  text[PLACEHOLDER]@domain.com
        text = re.sub(
            r'\S*\[[A-Z_]+\d*\]@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
            _partial_email, text)
        # user@[PLACEHOLDER].com  (less common but possible)
        text = re.sub(
            r'\b[A-Za-z0-9._%+-]+@\[[A-Z_]+\d*\]\.[A-Za-z]{2,}\b',
            _partial_email, text)

        # --- FINAL GLOBAL REDACTION PASS ---
        # Ensure any PII caught anywhere is redacted EVERYWHERE else,
        # protecting against chunking misses.
        text = self._global_redact_pass(text)

        return text

    def _global_redact_pass(self, text: str) -> str:
        """Final recursive sweep to ensure consistency and fragment protection."""
        if not self.redaction_map:
            return text

        # 1. Expand the list to include fragments (Recursive Redaction)
        # If "John Doe" is PII, then "John" and "Doe" must also be PII.
        all_tokens = []
        for entry in self.redaction_map.values():
            real_val = entry["real_value"]
            placeholder = entry["placeholder"]
            all_tokens.append((real_val, placeholder))
            
            # Add fragments for multi-word PII (names, orgs, AND addresses)
            parts = real_val.split()
            if len(parts) > 1:
                category = entry.get("category", "").lower()
                if "person" in category or "organization" in category or "org" in category:
                    for part in parts:
                        if len(part) > 2:  # Ignore initials/short words
                            all_tokens.append((part, placeholder))
                elif "address" in category:
                    # For addresses, redact the street name portion (not just the number)
                    # e.g. "2037 Rosswood Drive" → also redact "Rosswood Drive", "Rosswood"
                    non_numeric = [p for p in parts if not p.isdigit() and len(p) > 2]
                    if non_numeric:
                        # Add the full street name (without house number)
                        street_name = " ".join(non_numeric)
                        all_tokens.append((street_name, placeholder))
                        # Add each significant word (skip common suffixes)
                        _COMMON_SUFFIXES = {"street", "st", "avenue", "ave", "boulevard",
                            "blvd", "drive", "dr", "road", "rd", "lane", "ln",
                            "court", "ct", "place", "pl", "way", "circle", "cir",
                            "trail", "trl", "terrace", "ter", "parkway", "pkwy"}
                        for part in non_numeric:
                            cleaned = part.rstrip(".,").lower()
                            if cleaned not in _COMMON_SUFFIXES and len(part) > 2:
                                all_tokens.append((part, placeholder))

        # 2. Sort by length (longest values first) to prevent partial replacements
        all_tokens = sorted(
            all_tokens, 
            key=lambda x: len(x[0]), 
            reverse=True
        )

        # 3. Perform the sweep
        for real_val, placeholder in all_tokens:
            if len(real_val) < 2: continue
            pattern = re.compile(re.escape(real_val), re.IGNORECASE)
            text = pattern.sub(placeholder, text)

        return text


def print_redaction_summary(anonymizer: GLiNERAnonymizer):
    """Print what was redacted (never shows actual PII on screen)."""
    if not anonymizer.redaction_map:
        console.print("[yellow]No PII detected.[/yellow]")
        return

    summary_table = Table(title="Redaction Summary", show_header=True)
    summary_table.add_column("Category", style="cyan")
    summary_table.add_column("Count", justify="right", style="yellow")
    for category, count in sorted(anonymizer.stats["by_category"].items()):
        summary_table.add_row(category, str(count))
    console.print(summary_table)

    detail_table = Table(title="Placeholders Used", show_header=True)
    detail_table.add_column("Category", style="cyan")
    detail_table.add_column("Placeholder", style="green")
    for entry in anonymizer.redaction_map.values():
        detail_table.add_row(entry["category"], entry["placeholder"])
    console.print(detail_table)


def main():
    parser = argparse.ArgumentParser(
        description="CloakLM — PII redaction via GLiNER AI model (100%% local, no cloud)"
    )
    parser.add_argument("--input", "-i", required=True,
                        help="Path to a .md file")
    parser.add_argument("--output", "-o", default=None,
                        help="Output directory (default: same folder as input)")
    parser.add_argument("--threshold", "-t", type=float, default=0.3,
                        help="Detection confidence threshold (0.0-1.0, lower = more aggressive, default: 0.3)")
    parser.add_argument("--model", "-m", default="knowledgator/gliner-pii-small-v1.0",
                        help="GLiNER model name (default: knowledgator/gliner-pii-small-v1.0)")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output).expanduser().resolve() if args.output else input_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        console.print(f"[red]Error: {input_path} not found.[/red]")
        return

    if input_path.suffix.lower() != ".md":
        console.print(f"[red]Error: Expected a .md file, got {input_path.suffix}[/red]")
        return

    markdown = input_path.read_text(encoding="utf-8")

    console.print("\n[bold]CloakLM — PII Anonymization (GLiNER AI)[/bold]")
    console.print("[dim]100% local. No cloud. ~300MB model on CPU.[/dim]")
    console.print(f"[dim]Input: {input_path}[/dim]")
    console.print(f"[dim]Model: {args.model}[/dim]")
    console.print(f"[dim]Threshold: {args.threshold}[/dim]")
    console.print("[yellow]⚠  The redaction map is stored locally and NEVER sent anywhere.[/yellow]\n")

    anonymizer = GLiNERAnonymizer(model_name=args.model, threshold=args.threshold)
    anonymized = anonymizer.anonymize(markdown)

    out_stem = input_path.stem + "_a"

    anon_md_path = output_dir / f"{out_stem}.md"
    anon_md_path.write_text(anonymized, encoding="utf-8")

    map_file = output_dir / f"{out_stem}_redaction_map.json"
    with open(map_file, "w", encoding="utf-8") as f:
        json.dump({
            "WARNING": "KEEP LOCAL ONLY — maps placeholders back to real PII.",
            "source_file": str(input_path),
            "created_at": datetime.now().isoformat(),
            "model": args.model,
            "threshold": args.threshold,
            "method": "gliner",
            "total_redactions": anonymizer.stats["total_redactions"],
            "entries": anonymizer.redaction_map,
        }, f, indent=2, ensure_ascii=False)

    console.print()
    print_redaction_summary(anonymizer)

    console.print(f"\n[bold green]✅ Anonymization complete![/bold green]")
    console.print(f"   Redactions: {anonymizer.stats['total_redactions']}")
    console.print(f"   Anonymized: {anon_md_path}")
    console.print(f"   [red]Redaction map (LOCAL ONLY): {map_file}[/red]")
    console.print(f"\n[bold yellow]⚠ REVIEW before sending to any LLM:[/bold yellow]")
    console.print(f"   cat {anon_md_path}")


if __name__ == "__main__":
    main()
