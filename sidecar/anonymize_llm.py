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


# W-2 box 12 codes (IRS). None of the two-letter codes collide with US state abbreviations.
BOX_12_CODES = {
    "a", "b", "c", "d", "e", "f", "g", "h", "j", "k", "l", "m", "n", "p", "q",
    "r", "s", "t", "v", "w", "y", "z", "aa", "bb", "dd", "ee", "ff", "gg", "hh", "ii",
}

# Leading box/line labels on tax forms: "15 State", "12a Code D", "Box 17"
_BOX_PREFIX = re.compile(r'^(?:box\s+|line\s+)?\d{1,2}[a-d]?\s+')


def is_whitelisted(text: str) -> bool:
    cleaned = text.lower().strip().rstrip(".,;:")
    if cleaned in TAX_FORM_WHITELIST:
        return True
    # Box-labeled terms ("15 State", "12a Code D") match exactly only, never by
    # the prefix rule below, so "10 Federal St" is still treated as an address.
    unboxed = _BOX_PREFIX.sub("", cleaned)
    if unboxed in TAX_FORM_WHITELIST:
        return True
    if unboxed.startswith("code ") and unboxed[5:].strip() in BOX_12_CODES:
        return True
    for term in TAX_FORM_WHITELIST:
        if cleaned.startswith(term) and len(cleaned) - len(term) < 5:
            return True
    return False


def is_plausible(text: str, category: str) -> bool:
    """Reject GLiNER guesses whose shape can't be that kind of PII
    (e.g. the box 12 code "D" labeled as a zip code)."""
    # Letters and digits in any script: "[^A-Za-z0-9]" threw away every
    # Chinese, Cyrillic, Arabic, Greek or Korean name GLiNER found.
    alnum = [c for c in text if c.isalnum()]
    if len(alnum) < 2:
        return False
    if category == "ZIP":
        return re.search(r'\d{5}', text) is not None
    return True


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

GLINER_MODEL = "knowledgator/gliner-pii-small-v1.0"
GLINER_REVISION = "d21aad5b4a7ec82b3d0970fd1ac74a12c087d85e"

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

    def __init__(self, model_name: str = None, threshold: float = 0.3):
        from gliner import GLiNER

        model_name = model_name or GLINER_MODEL
        console.print(f"[dim]Loading GLiNER model: {model_name}[/dim]")
        console.print("[dim](First run downloads ~300MB — cached after that)[/dim]")
        # Pinned to a known commit: an unpinned "main" would pull whatever the model
        # repository holds today, and GLiNER loads it with trust_remote_code.
        self.model = GLiNER.from_pretrained(model_name, revision=GLINER_REVISION if model_name == GLINER_MODEL else None)
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

            # Skip guesses whose shape can't match the category
            if not is_plausible(entity_text, category):
                continue

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
        return sanitize_unicode(text)

    def anonymize(self, text: str) -> str:
        """Detect and replace all PII using GLiNER."""
        if not isinstance(text, str) or not text.strip():
            return text

        # CRITICAL: Sanitize invisible Unicode BEFORE any detection.
        # Without this, PII hidden behind zero-width chars evades both
        # GLiNER and regex, but LLMs still read it.
        text = self._sanitize_unicode(text)

        # A document that already contains "[PERSON_1]" would collide with our
        # placeholders, and rehydration would then put a real value there.
        text = neutralize_placeholders(text)

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
        text = re.sub(NOT_AFTER_DIGIT + r'\d{3}[-\s]\d{2}[-\s]\d{4}' + NOT_BEFORE_DIGIT, _ssn, text)

        # EINs (12-3456789)
        def _ein(m):
            return self._get_placeholder(m.group(), "EIN")
        text = re.sub(NOT_AFTER_DIGIT + r'\d{2}-\d{7}' + NOT_BEFORE_DIGIT, _ein, text)

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
            NOT_AFTER_DIGIT + r'(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}' + NOT_BEFORE_DIGIT,
            _phone, text)

        # Account numbers (XXXX-1234, ***1234)
        def _acct(m):
            return self._get_placeholder(m.group(), "ACCOUNT")
        text = re.sub(r'\b[Xx]{3,}[-\s]?\d{4}' + NOT_BEFORE_DIGIT, _acct, text)
        text = re.sub(r'\*{3,}\d{4}' + NOT_BEFORE_DIGIT, _acct, text)

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

        # --- NAME PARTS NEXT TO A DETECTED NAME ---
        # GLiNER sometimes catches only half a name ("Jordan [PERSON_1]"); a
        # capitalized word right next to a person placeholder is almost always
        # another part of the same name.
        text = self._redact_adjacent_name_parts(text)

        # --- FINAL GLOBAL REDACTION PASS ---
        # Ensure any PII caught anywhere is redacted EVERYWHERE else,
        # protecting against chunking misses.
        text = self._global_redact_pass(text)

        return text

    def _redact_adjacent_name_parts(self, text: str) -> str:
        def keep(word: str) -> bool:
            return word.lower() in NAME_NEIGHBOUR_WORDS or is_whitelisted(word)

        def before(m):
            word = m.group(1)
            return m.group(0) if keep(word) else self._get_placeholder(word, "PERSON") + m.group(2)

        def after(m):
            word = m.group(3)
            return m.group(0) if keep(word) else m.group(1) + m.group(2) + self._get_placeholder(word, "PERSON")

        for _ in range(3):  # "Mary Ann Jordan [PERSON_1]" takes a few rounds
            updated = _NAME_BEFORE_PERSON.sub(before, text)
            updated = _NAME_AFTER_PERSON.sub(after, updated)
            if updated == text:
                break
            text = updated
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
            text = value_pattern(real_val).sub(placeholder, text)

        return text


# Number patterns check for neighbouring digits rather than word boundaries:
# "\b" missed "SSN123-45-6789" because "N1" is not a word boundary.
NOT_AFTER_DIGIT = r"(?<!\d)"
NOT_BEFORE_DIGIT = r"(?!\d)"

_SHORT_ASCII = re.compile(r"[A-Za-z0-9]{1,3}")


def value_pattern(value: str) -> "re.Pattern[str]":
    """How a known PII value is found elsewhere in the text.

    Short ASCII values ("CA", "Bay") must stand alone, so a detected "CA" no
    longer turns "Canadian" into "[LOCATION_1]nadian". Everything longer is
    matched anywhere, so "John123", "johnsmith" in a URL, and names in
    Chinese or Japanese text without spaces are still caught. Over-redacting
    "Johnson" is the safe failure.
    """
    escaped = re.escape(value)
    if _SHORT_ASCII.fullmatch(value.strip()):
        return re.compile(r"(?<![^\W_])" + escaped + r"(?![^\W_])", re.IGNORECASE)
    return re.compile(escaped, re.IGNORECASE)


# Characters that render as nothing (or as a blank) but that language models
# still read: zero-width and bidi controls, Unicode "tag" characters (used to
# smuggle hidden ASCII), variation selectors, and Hangul fillers.
_INVISIBLE_EXTRA = re.compile(
    "[͏ᅟᅠ឴឵᠎ㅤﾠ︀-️"
    "\U000e0000-\U000e007f\U000e0100-\U000e01ef]"
)

# Cyrillic and Greek letters that look like Latin ones. Folded only inside
# words that mix them with Latin letters ("Jоhn" with a Cyrillic "о"), so real
# Cyrillic or Greek words are left alone.
_CONFUSABLES = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i",
    "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h", "ӏ": "l", "А": "A", "В": "B", "Е": "E",
    "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X",
    "У": "Y", "І": "I", "Ј": "J", "Ѕ": "S", "α": "a", "ο": "o", "ν": "v", "ρ": "p",
    "ι": "i", "κ": "k", "τ": "t", "υ": "u", "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z",
    "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T",
    "Υ": "Y", "Χ": "X",
})
_WORD = re.compile(r"[^\W\d_]+")


def _fold_mixed_script(match: "re.Match[str]") -> str:
    word = match.group()
    has_latin = any("a" <= c.lower() <= "z" for c in word)
    has_other = any(("Ͱ" <= c <= "Ͽ") or ("Ѐ" <= c <= "ӿ") or ("Ԁ" <= c <= "ԯ") for c in word)
    return word.translate(_CONFUSABLES) if has_latin and has_other else word


def sanitize_unicode(text: str) -> str:
    """Make what the detector sees match what a language model reads.

    PDF extractors inject zero-width spaces, soft hyphens and direction marks;
    crafted documents can add tag characters or lookalike letters. Each of these
    lets PII (or hidden instructions) slip past regexes and the Review panel
    while the AI still reads it.
    """
    # NFKC folds fullwidth letters and ligatures: "Ｊｏｈｎ" -> "John", "ﬀ" -> "ff".
    text = unicodedata.normalize("NFKC", text)
    # Every format character (Cf): zero-width, bidi, soft hyphen, BOM, tags...
    text = "".join(c for c in text if unicodedata.category(c) != "Cf")
    text = _INVISIBLE_EXTRA.sub("", text)
    text = re.sub(r"[  -   　]", " ", text)
    return _WORD.sub(_fold_mixed_script, text)


# Also the forms Docling's Markdown export produces: "[PERSON\_1]", "[PERSON \_ 1]".
_PLACEHOLDER_LIKE = re.compile(r"\[\s*([A-Z]{2,}(?:\s*\\?_\s*[A-Z0-9]+)*)\s*\]")


def neutralize_placeholders(text: str) -> str:
    """Turn bracket tokens already in a document ("[PERSON_1]") into "(PERSON_1)"
    so they can't be mistaken for, or rehydrated as, real redactions."""
    return _PLACEHOLDER_LIKE.sub(lambda m: "(" + re.sub(r"[\s\\]", "", m.group(1)) + ")", text)


_NAME_PART = r"[A-Z][A-Za-z'\u2019-]+"
_NAME_BEFORE_PERSON = re.compile(rf"(?<![\w\[(])({_NAME_PART})([ \t]+\[PERSON_\d+\])")
_NAME_AFTER_PERSON = re.compile(rf"(\[PERSON_\d+\])([ \t]+)({_NAME_PART})(?![\w\]])")

# Capitalized words that sit next to names without being part of them.
NAME_NEIGHBOUR_WORDS = {
    "the", "and", "or", "of", "for", "to", "from", "in", "on", "at", "by", "with", "dear", "hi", "hello",
    "mr", "mrs", "ms", "miss", "dr", "prof", "jr", "sr", "ii", "iii", "iv", "esq", "md", "phd", "cpa",
    "name", "employee", "employer", "client", "patient", "student", "taxpayer", "spouse", "recipient",
    "payer", "borrower", "signed", "signature", "date", "address", "phone", "email", "ssn", "inc", "llc",
    "corp", "co", "ltd", "is", "was", "has", "had", "will", "can", "did", "does", "said", "says",
    "ref", "re", "no", "id", "tel", "fax", "cell", "mobile", "dob", "attn", "cc", "note", "notes", "account",
}


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
