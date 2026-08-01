from pm4py.objects.dcr.ocdcr.obj import DcrActivity, DcrGraph
from util.util import prioritize_user_activities


def test_explicit_activity_priority_orders_enabled_activities_first():
    low = DcrActivity("low", priority=-1)
    default = DcrActivity("default")
    high = DcrActivity("high", priority=2.5)
    graph = DcrGraph("priorities", elements={low, default, high})

    ordered = prioritize_user_activities({default, high, low}, graph, [])

    assert ordered == [high, default, low]
