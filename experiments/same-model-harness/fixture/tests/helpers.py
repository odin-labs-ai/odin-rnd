from planner.graph import RoadNetwork


def sample_network():
    net = RoadNetwork()
    net.add_road("North", "Mill", 4)
    net.add_road("Mill", "Harbour", 6)
    net.add_road("North", "Harbour", 12)
    net.add_road("Harbour", "South", 3)
    return net
