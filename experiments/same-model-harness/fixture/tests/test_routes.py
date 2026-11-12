import unittest

from planner.routes import route_km, shortest_route
from tests.helpers import sample_network


class RoutesTest(unittest.TestCase):
    def test_takes_the_shorter_way_round(self):
        self.assertEqual(shortest_route(sample_network(), "North", "South"), ["North", "Mill", "Harbour", "South"])

    def test_route_length(self):
        net = sample_network()
        self.assertEqual(route_km(net, ["North", "Mill", "Harbour"]), 10)

    def test_unknown_depot(self):
        with self.assertRaises(LookupError):
            shortest_route(sample_network(), "North", "Nowhere")


if __name__ == "__main__":
    unittest.main()
