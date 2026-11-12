import unittest

from planner.cost import route_cost
from tests.helpers import sample_network


class CostTest(unittest.TestCase):
    def test_departure_is_not_a_stop(self):
        # 10 km at 1.5 plus two stops (Mill, Harbour) at 4.0
        self.assertEqual(route_cost(sample_network(), ["North", "Mill", "Harbour"], 1.5, 4.0), 23.0)

    def test_single_leg(self):
        self.assertEqual(route_cost(sample_network(), ["Harbour", "South"], 2.0, 1.0), 7.0)


if __name__ == "__main__":
    unittest.main()
