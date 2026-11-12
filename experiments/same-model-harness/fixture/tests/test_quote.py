import unittest

from planner.quote import quote
from tests.helpers import sample_network


class QuoteTest(unittest.TestCase):
    def test_quote_names_the_route(self):
        self.assertEqual(quote(sample_network(), "North", "South")["route"], ["North", "Mill", "Harbour", "South"])


if __name__ == "__main__":
    unittest.main()
