"""Tests for the anonymizer's whitelist and plausibility filters (no model needed).

Run: python -m unittest sidecar/test_anonymize_llm.py
"""
import unittest

from anonymize_llm import is_plausible, is_whitelisted


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
