"""The price of driving a route: a rate per kilometre plus a fee for every stop."""

from planner.routes import route_km


def route_cost(network, route, per_km, stop_fee):
    """Price of a route. The departure depot is not a stop; every depot after it is."""
    stops = len(route)
    return round(route_km(network, route) * per_km + stops * stop_fee, 2)
