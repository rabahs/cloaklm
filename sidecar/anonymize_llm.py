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

    def anonymize(self, text: str) -> str:
        """Detect and replace all PII using GLiNER."""
        if not isinstance(text, str) or not text.strip():
            return text

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
