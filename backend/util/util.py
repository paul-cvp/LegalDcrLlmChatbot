
from pm4py.objects.dcr.exporter import exporter as dcr_exporter
from pm4py.objects.dcr.importer import importer as dcr_importer

from pm4py.objects.dcr.ocdcr.obj import DcrActivity


def prioritize_user_activities(activities, dcr_graph, trace):
    """Return enabled user activities ordered from highest to lowest priority."""
    from collections import Counter
    from math import isfinite
    from pm4py.objects.dcr.ocdcr.obj import RelationType

    execution_count = Counter(execution.activityID for execution in trace)

    condition_sources = set()
    urgent_condition_sources = set()

    for relation in dcr_graph.relations:
        if relation.relationType != RelationType.C:
            continue

        source = relation.source
        condition_sources.add(source)

        if (
            getattr(relation.target, "pending", False)
            and getattr(source, "executed", None) is None
        ):
            urgent_condition_sources.add(source)

    def user_priority(activity):
        try:
            priority = float(activity.priority)
            return priority if isfinite(priority) else 0.0
        except (TypeError, ValueError):
            return 0.0

    # Lexicographic ordering guarantees that an earlier criterion always
    # dominates every criterion following it.
    return sorted(
        activities,
        key=lambda activity: (
            -user_priority(activity),                 # Higher explicit priority
            activity.executed is not None,            # Unexecuted before executed
            -(activity in urgent_condition_sources),  # Needed by pending target
            -bool(activity.pending),                  # Pending before non-pending
            -(activity in condition_sources),         # Condition source first
            execution_count[activity.ID],             # Less frequent first
            activity.ID,                              # Deterministic tie-breaker
        ),
    )

def export_xml(graph) -> str:
    # The exporter returns bytes directly; it never writes a file.
    return dcr_exporter.serialize(
        graph, variant=dcr_exporter.DCR_JS_PORTAL
    ).decode('utf-8')


def import_xml(xml: str):
    return dcr_importer.deserialize(
        xml, variant=dcr_importer.DCR_JS_PORTAL
    )


def marking(graph) -> dict:
    return {
        element.ID: {
            'included': element.included,
            'pending': element.pending,
            'executed': element.executed is not None,
            'data': element.data,
        }
        for element in sorted(graph.elements, key=lambda item: item.ID)
        if isinstance(element, DcrActivity)
    }


def marking_difference(before: dict, after: dict) -> list[dict]:
    changes = []
    for activity_id in sorted(before.keys() | after.keys()):
        old, new = before.get(activity_id), after.get(activity_id)
        if old != new:
            changes.append({'activity': activity_id, 'before': old, 'after': new})
    return changes