"""Shortest routes between depots (Dijkstra over the road network)."""

import heapq


def shortest_route(network, start, end):
    """The list of depots on the shortest route from start to end, both included."""
    queue = [(0, start, [start])]
    seen = set()
    while queue:
        km, depot, path = heapq.heappop(queue)
        if depot == end:
            return path
        if depot in seen:
            continue
        seen.add(depot)
        for nxt, length in network.neighbours(depot).items():
            if nxt not in seen:
                heapq.heappush(queue, (km + length, nxt, path + [nxt]))
    raise LookupError(f"no route from {start} to {end}")


def route_km(network, route):
    return sum(network.length(a, b) for a, b in zip(route, route[1:]))
