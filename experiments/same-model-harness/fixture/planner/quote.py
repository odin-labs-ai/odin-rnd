"""A delivery quote: the shortest route and its price."""

from planner.cost import route_cost
from planner.routes import shortest_route


def quote(network, start, end, per_km=1.5, stop_fee=4.0):
    route = shortest_route(network, start, end)
    return {"route": route, "price": route_cost(network, route, per_km, stop_fee)}
