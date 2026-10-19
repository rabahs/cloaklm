"""Tests for the anonymizer's whitelist and plausibility filters (no model needed).

Run: python -m unittest sidecar/test_anonymize_llm.py
"""
import unittest

from anonymize_llm import (
    GLiNERAnonymizer, is_plausible, is_whitelisted, neutralize_placeholders, sanitize_unicode, value_pattern,
)


class WhitelistTest(unittest.TestCase):
    def test_box_12_codes_are_kept(self):
        for text in ["Code D", "code dd", "12a Code D", "Code W", "Code AA"]:
            self.assertTrue(is_whitelisted(text), text)

    def test_box_labeled_form_terms_are_kept(self):
        for text in ["15 State", "17 State", "Box 2 Federal income tax withheld"]:
            self.assertTrue(is_whitelisted(text), text)

    def test_numbered_addresses_are_not_whitelisted(self):
        # Box-prefix stripping must not let real addresses through the prefix rule
        for text in ["10 Federal St", "17 State Street", "12 Medicare Ave"]:
            self.assertFalse(is_whitelisted(text), text)

    def test_unknown_codes_are_not_whitelisted(self):
        self.assertFalse(is_whitelisted("Code XYZ"))


class PlausibilityTest(unittest.TestCase):
    def test_zip_requires_five_digits(self):
        self.assertFalse(is_plausible("D", "ZIP"))
        self.assertFalse(is_plausible("OR", "ZIP"))
        self.assertTrue(is_plausible("97005", "ZIP"))
        self.assertTrue(is_plausible("97005-1234", "ZIP"))
        self.assertTrue(is_plausible("0123456-7", "ZIP"))

    def test_single_characters_are_never_pii(self):
        for category in ["PERSON", "ORG", "CITY_STATE", "ZIP"]:
            self.assertFalse(is_plausible("D", category), category)
            self.assertFalse(is_plausible("J.", category), category)

    def test_real_values_pass(self):
        self.assertTrue(is_plausible("Jordan", "PERSON"))
        self.assertTrue(is_plausible("Al", "PERSON"))
        self.assertTrue(is_plausible("Brightwater Logistics Inc.", "ORG"))


if __name__ == "__main__":
    unittest.main()


class ValuePatternTest(unittest.TestCase):
    def sub(self, value, text):
        return value_pattern(value).sub("[X]", text)

    def test_short_values_must_stand_alone(self):
        self.assertEqual(self.sub("CA", "Canadian, based in CA."), "Canadian, based in [X].")
        self.assertEqual(self.sub("Bay", "eBay and the Bay Area"), "eBay and the [X] Area")
        self.assertEqual(self.sub("Rab", "Rab_Shihab"), "[X]_Shihab")

    def test_longer_values_match_anywhere(self):
        self.assertEqual(self.sub("John", "John123 logged in"), "[X]123 logged in")
        self.assertEqual(self.sub("smith", "linkedin.com/in/johnsmith"), "linkedin.com/in/john[X]")
        self.assertEqual(self.sub("123-45-6789", "SSN123-45-6789"), "SSN[X]")
        self.assertEqual(self.sub("Whitaker", "WHITAKER"), "[X]")

    def test_cjk_names_without_spaces(self):
        self.assertEqual(self.sub("张伟", "我是张伟先生"), "我是[X]先生")
        self.assertEqual(self.sub("山田太郎", "山田太郎様へ"), "[X]様へ")


class PlausibilityAnyScriptTest(unittest.TestCase):
    def test_non_latin_names_are_kept(self):
        for name in ["张伟", "山田太郎", "Иван Петров", "رباح شهاب", "Γιάννης Παπαδόπουλος", "김민수"]:
            self.assertTrue(is_plausible(name, "PERSON"), name)

    def test_single_characters_still_rejected(self):
        self.assertFalse(is_plausible("D", "ZIP"))
        self.assertFalse(is_plausible("-", "PERSON"))


class SanitizeUnicodeTest(unittest.TestCase):
    def test_strips_invisible_and_smuggling_characters(self):
        hidden = "Jo​hn‮ ⁦Doe⁩ \U000e0041\U000e0042 x️ㅤ"
        self.assertEqual(sanitize_unicode(hidden), "John Doe  x")

    def test_folds_fullwidth_and_ligatures(self):
        self.assertEqual(sanitize_unicode("Ｊｏｈｎ Jeﬀrey Griﬃn"), "John Jeffrey Griffin")

    def test_folds_lookalikes_only_in_mixed_script_words(self):
        self.assertEqual(sanitize_unicode("Jоhn"), "John")  # Cyrillic о inside a Latin word
        self.assertEqual(sanitize_unicode("Иван Петров"), "Иван Петров")  # real Cyrillic untouched


class PlaceholderNeutralizingTest(unittest.TestCase):
    def test_existing_placeholders_become_parentheses(self):
        self.assertEqual(neutralize_placeholders("Pay [PERSON_1] now [SSN]"), "Pay (PERSON_1) now (SSN)")
        self.assertEqual(neutralize_placeholders("Pay [PERSON\\_1] and [PERSON \\_ 2]"), "Pay (PERSON_1) and (PERSON_2)")

    def test_checkboxes_are_left_alone(self):
        self.assertEqual(neutralize_placeholders("[X] Married [ ] Single"), "[X] Married [ ] Single")


def fake_anonymizer(entities=()):
    """A GLiNERAnonymizer whose model returns the given entities (no download)."""
    anonymizer = GLiNERAnonymizer.__new__(GLiNERAnonymizer)
    anonymizer.threshold = 0.3
    anonymizer.redaction_map, anonymizer.counters = {}, {}
    anonymizer.stats = {"total_redactions": 0, "by_category": {}}

    class Model:
        def predict_entities(self, text, labels, threshold=0.3):
            found = []
            for value, label in entities:
                start = text.find(value)
                while start != -1:
                    found.append({"text": value, "label": label, "start": start, "end": start + len(value), "score": 0.9})
                    start = text.find(value, start + 1)
            return found

    anonymizer.model = Model()
    return anonymizer


class AnonymizeEndToEndTest(unittest.TestCase):
    def test_numbers_glued_to_letters_are_redacted(self):
        out = fake_anonymizer().anonymize("Ref SSN123-45-6789, Tel555-123-4567, EIN12-3456789")
        self.assertNotIn("6789", out)
        self.assertNotIn("4567", out)
        self.assertNotIn("3456789", out)

    def test_non_latin_name_is_redacted(self):
        out = fake_anonymizer([("张伟", "person")]).anonymize("客户: 张伟\n我是张伟先生")
        self.assertNotIn("张伟", out)

    def test_short_location_does_not_split_words(self):
        out = fake_anonymizer([("CA", "state")]).anonymize("Canadian citizen living in CA")
        self.assertIn("Canadian", out)
        self.assertNotIn(" CA", out)

    def test_fake_placeholder_in_document_cannot_collide(self):
        out = fake_anonymizer([("Jane Roe", "person")]).anonymize("Pay [PERSON_1] now.\nJane Roe signed.")
        self.assertIn("(PERSON_1)", out)
        self.assertEqual(out.count("[PERSON_1]"), 1)

    def test_hidden_characters_do_not_hide_pii(self):
        out = fake_anonymizer().anonymize("SSN: 123​-45-6789")
        self.assertNotIn("6789", out)


class AdjacentNamePartsTest(unittest.TestCase):
    def test_missed_first_name_next_to_detected_last_name(self):
        out = fake_anonymizer([("Whitaker", "last name")]).anonymize("Employee's name: Jordan Whitaker\nWages: $84,250")
        self.assertNotIn("Jordan", out)
        self.assertNotIn("Whitaker", out)
        self.assertIn("Employee's name:", out)

    def test_missed_last_name_and_middle_names(self):
        out = fake_anonymizer([("Mary", "first name")]).anonymize("Signed by Mary Ann Jordan on 3/1")
        for part in ("Mary", "Ann", "Jordan"):
            self.assertNotIn(part, out)
        self.assertIn("Signed by", out)

    def test_titles_and_labels_are_left(self):
        out = fake_anonymizer([("Jordan Whitaker", "person")]).anonymize("Dear Mr. Jordan Whitaker, Employee Jordan Whitaker Inc\nJordan Whitaker Ref 12")
        self.assertIn("Dear Mr.", out)
        self.assertIn("Employee", out)
        self.assertIn("Inc", out)
        self.assertIn("Ref 12", out)


class GlobalRedactPassTest(unittest.TestCase):
    def test_short_location_does_not_split_words(self):
        anonymizer = GLiNERAnonymizer.__new__(GLiNERAnonymizer)  # no model needed
        anonymizer.redaction_map = {
            "location::ca": {"real_value": "CA", "placeholder": "[LOCATION_1]", "category": "location"},
        }
        self.assertEqual(
            anonymizer._global_redact_pass("Canadian citizen living in CA"),
            "Canadian citizen living in [LOCATION_1]",
        )
