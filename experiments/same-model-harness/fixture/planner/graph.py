"""The road network: depots joined by two-way roads with a length in kilometres."""


class RoadNetwork:
    def __init__(self):
        self._roads = {}

    def add_road(self, a, b, km):
        if km <= 0:
            raise ValueError("a road has a positive length")
        self._roads.setdefault(a, {})[b] = km
        self._roads.setdefault(b, {})[a] = km

    def neighbours(self, depot):
        return dict(self._roads.get(depot, {}))

    def length(self, a, b):
        return self._roads[a][b]

    def depots(self):
        return sorted(self._roads)
