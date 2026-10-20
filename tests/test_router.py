from core.router import route_query


def test_router_rejects_out_of_scope():
    assert route_query("write a poem") == "unsupported"
    assert route_query("") == "unsupported"


def test_router_routes_simple_definition():
    assert route_query("define SQL") == "simple"


def test_router_routes_complex():
    assert route_query("Analyze my skills and create a plan") == "complex"
    assert route_query("Which skills does my team need to upskill?") == "complex"
