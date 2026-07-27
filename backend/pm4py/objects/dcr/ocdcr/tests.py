import unittest

import obj
from semantics import DcrSemantics as sem
    
class TestStandardDcr(unittest.TestCase):
    graph = None

    def setUp(self):
        act1 = obj.DcrActivity("act1")
        act2 = obj.DcrActivity("act2", computation=[("act3", "data"), "+", 1])
        act3 = obj.DcrActivity("act3", takesInput=True)
        act4 = obj.DcrActivity("act4")
        act5 = obj.DcrActivity("act5", takesInput=True)
        act6 = obj.DcrActivity("act6")
        act7 = obj.DcrActivity("act7", pending=True)
        act8 = obj.DcrActivity("act8", included=False)

        nest1 = obj.DcrNesting("nest1", {act1, act3})
        nest2 = obj.DcrNesting("nest2", {act8})
        subP2 = obj.DcrSubprocess("subP2", {nest2})
        subP1 = obj.DcrSubprocess("subP1", {act1, act2, subP2})
        subG1 = obj.DcrSubgraph("subG1", {act4, act5})

        relations = {
            obj.DcrEffect(obj.RelationType.R, act1,act2),
            obj.DcrConstraint(obj.RelationType.C, act3, act2),
            obj.DcrEffect(obj.RelationType.I, act3, subP1),
            obj.DcrEffect(obj.RelationType.E, act1, subP1),
            obj.DcrSpawn(act2, subG1, guard=[("source", "data"), ">", 2]),
            obj.DcrEffect(obj.RelationType.R, act5, act4),
            obj.DcrConstraint(obj.RelationType.M, act4, act5, forAll=True),
            obj.DcrSetValue(act2, act1, [("source", "data"), "*", 2.5]),
            obj.DcrEffect(obj.RelationType.N, act3, act6),
            obj.DcrEffect(obj.RelationType.E, subP1, nest1),
            obj.DcrEffect(obj.RelationType.I, act5, act3),
            obj.DcrEffect(obj.RelationType.R, act1, act6),
            obj.DcrEffect(obj.RelationType.N, nest1, act4),
            obj.DcrEffect(obj.RelationType.I, act6, nest1),
            obj.DcrConstraint(obj.RelationType.C, act7, act5, guard=[("target", "data")]),
            obj.DcrEffect(obj.RelationType.I, act1, subP2),
            obj.DcrEffect(obj.RelationType.I, act6, act8),
            obj.DcrEffect(obj.RelationType.E, act6, subP2),
            obj.DcrEffect(obj.RelationType.R, act6, act8),
            obj.DcrConstraint(obj.RelationType.M, act7, subP2),
            obj.DcrEffect(obj.RelationType.R, act8, subP1)
        }

        self.graph = obj.DcrGraph("testGraph", elements={act1, act2, act3, act4, act5, act6, act7, act8, nest1, nest2, subP1, subP2, subG1}, relations=relations)
    
    def test_execute_activity(self):
        # Activity is not executed:
        self.assertIsNone(self.graph.getElementFromID("act1").executed)
        # Execution of activity:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # Activity is now executed:
        self.assertIsNotNone(self.graph.getElementFromID("act1").executed)

    def test_included(self):                                                ### add test for attempting to execute excluded activity
        # Activity is effectively excluded if personally not included:
        self.assertFalse(self.graph.getElementFromID("act8").effectiveIncluded)
        # Include act8 and exclude subP2:
        sem.executeActivity(obj.DcrExecution("act6"), self.graph)
        # Activity is effectively excluded if a parent subprocess is excluded -- even with a layer of nesting in between:
        self.assertFalse(self.graph.getElementFromID("act8").effectiveIncluded)
        # Include subP2 and exclude subP1:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # Activity is effectively excluded if a parent subprocess of a parent subprocess is excluded:
        self.assertFalse(self.graph.getElementFromID("act8").effectiveIncluded)
        # Include subP1:
        sem.executeActivity(obj.DcrExecution("act3"), self.graph)
        # Activity is effectively included if it and all its parents are included:
        self.assertTrue(self.graph.getElementFromID("act8").effectiveIncluded)
    
    def test_pending(self):
        # Make act8 pending and included:
        sem.executeActivity(obj.DcrExecution("act6"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act3"), self.graph)
        # Activity is pending if it itself is pending:
        self.assertTrue(self.graph.getElementFromID("act8").pending)
        self.assertTrue(self.graph.getElementFromID("act8").effectivePending)
        # Nesting is effectivePending if any of its children are pending:
        self.assertTrue(self.graph.getElementFromID("nest2").effectivePending)
        # Subprocess is pending only if it itself is pending, independently of having children pending:
        self.assertFalse(self.graph.getElementFromID("subP2").pending)
        self.assertTrue(self.graph.getElementFromID("subP2").childrenPending)
        self.assertFalse(self.graph.getElementFromID("subP2").effectivePending)

    def test_effect_include(self):
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # Subprocess is excluded:
        self.assertFalse(self.graph.getElementFromID("subP1").included)
        # Execution of include relation:
        sem.executeActivity(obj.DcrExecution("act3"), self.graph)
        # Subprocess is now included:
        self.assertTrue(self.graph.getElementFromID("subP1").included)

    def test_effect_exclude(self):
        # Subprocess is included:
        self.assertTrue(self.graph.getElementFromID("subP1").included)
        # Execution of exclude relation:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # Subprocess is now excluded:
        self.assertFalse(self.graph.getElementFromID("subP1").included)

    def test_effect_response(self):
        # Activity is not pending:
        self.assertFalse(self.graph.getElementFromID("act2").pending)
        # Execution of response relation:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # Activity is now pending:
        self.assertTrue(self.graph.getElementFromID("act2").pending)

    def test_effect_noresponse(self):
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # Activity is pending:
        self.assertTrue(self.graph.getElementFromID("act6").pending)
        # Execution of noresponse relation:
        sem.executeActivity(obj.DcrExecution("act3"), self.graph)
        # Activity is no longer pending:
        self.assertFalse(self.graph.getElementFromID("act6").pending)

    def test_effect_setvalue(self):
        # Activity has no data:
        self.assertIsNone(self.graph.getElementFromID("act1").data)
        # Execution of setvalue relation:
        sem.executeActivity(obj.DcrExecution("act3", 1), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Activity now has data equal to source of relation:
        self.assertEqual(self.graph.getElementFromID("act1").data, 5)

    def test_effect_spawn(self):
        # SpawnContainers initially contain only the template activities:
        self.assertEqual(len(self.graph.getElementFromID("act4Container").children), 1)
        self.assertIn(self.graph.getElementFromID("act4"), self.graph.getElementFromID("act4Container").children)
        self.assertEqual(len(self.graph.getElementFromID("act5Container").children), 1)
        self.assertIn(self.graph.getElementFromID("act5"), self.graph.getElementFromID("act5Container").children)
        # The spawned activities do not exist before execution:
        self.assertIsNone(self.graph.getElementFromID("act4Spawn1"))
        self.assertIsNone(self.graph.getElementFromID("act5Spawn1"))
        # Execution:
        sem.executeActivity(obj.DcrExecution("act3", 2), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Spawncontainers now also contain the spawned activities:
        self.assertEqual(len(self.graph.getElementFromID("act4Container").children), 2)
        self.assertIn(self.graph.getElementFromID("act4Spawn1"), self.graph.getElementFromID("act4Container").children)
        self.assertEqual(len(self.graph.getElementFromID("act5Container").children), 2)
        self.assertIn(self.graph.getElementFromID("act5Spawn1"), self.graph.getElementFromID("act5Container").children)
        # Spawned activities have the same number of relations as the templates:
        self.assertEqual(len(sem.getRelations(self.graph.getElementFromID("act4"), self.graph)), len(sem.getRelations(self.graph.getElementFromID("act4Spawn1"), self.graph)))
        self.assertEqual(len(sem.getRelations(self.graph.getElementFromID("act5"), self.graph)), len(sem.getRelations(self.graph.getElementFromID("act5Spawn1"), self.graph)))
        

    def test_constraint_condition(self):                  ### add test for unexecuted but excluded condition and executed and included condition. also test several conditions and mix of condition and milestone?
        # Condition source is included and unexecuted:
        self.assertTrue(self.graph.getElementFromID("act3").effectiveIncluded)
        self.assertIsNone(self.graph.getElementFromID("act3").executed)
        # Execution fails due to constraint:
        with self.assertRaisesRegex(Exception, "Activity with ID .* is not enabled and cannot be executed"):
            sem.executeActivity(obj.DcrExecution("act2"), self.graph)

    def test_constraint_milestone(self):                    ### same as above
        sem.executeActivity(obj.DcrExecution("act3", 2), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act5Spawn1"), self.graph)
        # Milestone source is pending and included:
        self.assertTrue(self.graph.getElementFromID("act4Spawn1").effectivePending)
        # Execution fails due to constraint:
        with self.assertRaisesRegex(Exception, "Activity with ID .* is not enabled and cannot be executed"):
            sem.executeActivity(obj.DcrExecution("act5Spawn1"), self.graph)

    def test_relation_from_nesting(self):
        sem.executeActivity(obj.DcrExecution("act3", 2), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act5Spawn1"), self.graph)
        # Target activity is pending:
        self.assertTrue(self.graph.getElementFromID("act4Spawn1").pending)
        # Execution of noresponse relation from inside a nesting:
        sem.executeActivity(obj.DcrExecution("act3"), self.graph)
        # Target activity is no longer pending:
        self.assertFalse(self.graph.getElementFromID("act4Spawn1").pending)
    
    def test_relation_to_nesting(self):
        # Activities in nesting are included:
        self.assertTrue(self.graph.getElementFromID("act1").included)
        self.assertTrue(self.graph.getElementFromID("act3").included)
        # Execution of exclude relation on nesting:
        sem.executeActivity(obj.DcrExecution("act3", 1), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Activities are now excluded:
        self.assertFalse(self.graph.getElementFromID("act1").included)
        self.assertFalse(self.graph.getElementFromID("act3").included)
    
    def test_subprocess_execution(self):        ### add test for executed activity but still childrenpending
        # Subprocess is unexecuted:
        self.assertIsNone(self.graph.getElementFromID("subP1").executed)
        # Execution of act3 and act2:
        sem.executeActivity(obj.DcrExecution("act3", 1), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Subprocess has now been executed:
        self.assertIsNotNone(self.graph.getElementFromID("subP1").executed)

    def test_child_constrained_by_subParents_constraints(self):
        # Make act8 and all parents included:
        sem.executeActivity(obj.DcrExecution("act6"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act3"), self.graph)
        # Execution of act8 fails due to milestone constraint on subP2:
        with self.assertRaisesRegex(Exception, "Activity with ID .* is not enabled and cannot be executed"):
            sem.executeActivity(obj.DcrExecution("act8"), self.graph)
        # Make act7 not pending to remove constraint:
        sem.executeActivity(obj.DcrExecution("act7"), self.graph)
        # Act8 is now enabled:
        sem.executeActivity(obj.DcrExecution("act8"), self.graph)
        self.assertIsNotNone(self.graph.getElementFromID("act8").executed)
    
    def test_input(self):
        # Activity has no data:
        self.assertIsNone(self.graph.getElementFromID("act3").data)
        # Execution with input:
        sem.executeActivity(obj.DcrExecution("act3", 1), self.graph)
        # Activity has taken input as data:
        self.assertEqual(self.graph.getElementFromID("act3").data, 1)
    
    def test_computation(self):
        # act2 has no data:
        self.assertIsNone(self.graph.getElementFromID("act2").data)
        # Execution of act3 with input:
        sem.executeActivity(obj.DcrExecution("act3", 1), self.graph)
        # Execution of act2 with computation:
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Activity has taken input as data:
        self.assertEqual(self.graph.getElementFromID("act2").data, 2)
    
    def test_effect_with_guard(self):
        # Spawned activities do not yet exist:
        self.assertIsNone(self.graph.getElementFromID("act4Spawn1"))
        self.assertIsNone(self.graph.getElementFromID("act5Spawn1"))
        # Execution with data too low to pass guard:
        sem.executeActivity(obj.DcrExecution("act3", 0), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Spawned activities still not instantiated:
        self.assertIsNone(self.graph.getElementFromID("act4Spawn1"))
        self.assertIsNone(self.graph.getElementFromID("act5Spawn1"))
        # Execution with data high enough to pass guard:
        sem.executeActivity(obj.DcrExecution("act6"), self.graph)
        sem.executeActivity(obj.DcrExecution("act3", 2), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Activities have now been spawned:
        self.assertIsNotNone(self.graph.getElementFromID("act4Spawn1"))
        self.assertIsNotNone(self.graph.getElementFromID("act5Spawn1"))
    
    def test_constraint_with_guard(self):
        sem.executeActivity(obj.DcrExecution("act3", 2), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Execution before added data does not pass guard and condition is ignored:
        sem.executeActivity(obj.DcrExecution("act5Spawn1", True), self.graph)
        # Activity was executed:
        self.assertIsNotNone(self.graph.getElementFromID("act5Spawn1").executed)
        # Data is now set as True:
        self.assertTrue(self.graph.getElementFromID("act5Spawn1").data)
        # Execution once data=True does not pass guard and execution is denied:
        with self.assertRaisesRegex(Exception, "Activity with ID .* is not enabled and cannot be executed"):
            sem.executeActivity(obj.DcrExecution("act5Spawn1", True), self.graph)
            
    def test_graph_accepting(self):
        # Graph is initially not accepting:
        self.assertFalse(self.graph.isAccepting())
        # Execute pending activity:
        sem.executeActivity(obj.DcrExecution("act7"), self.graph)
        # Graph is now accepting:
        self.assertTrue(self.graph.isAccepting())
        # Make act2 pending:
        sem.executeActivity(obj.DcrExecution("act6"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act3"), self.graph)
        # Graph is still accepting since subprocess parent of act2 is not pending:
        self.assertTrue(self.graph.isAccepting())
        # Make subP1 also pending:
        sem.executeActivity(obj.DcrExecution("act8"), self.graph)
        # Graph is no longer accepting:
        self.assertFalse(self.graph.isAccepting())


class TestRelationCardinalityAndGuards(unittest.TestCase):
    graph = None

    def setUp(self):
        act1 = obj.DcrActivity("act1")
        act2 = obj.DcrActivity("act2")
        act3 = obj.DcrActivity("act3", takesInput=True)
        act4 = obj.DcrActivity("act4", takesInput=True)
        act5 = obj.DcrActivity("act5", takesInput=True)
        act6 = obj.DcrActivity("act6", takesInput=True)
        act7 = obj.DcrActivity("act7")
        act8 = obj.DcrActivity("act8", takesInput=True)

        subG1 = obj.DcrSubgraph("subG1", {act3, act4})
        subG2 = obj.DcrSubgraph("subG2", {act8})
        subG3 = obj.DcrSubgraph("subG3", {act5, act6, act7, subG2})

        relations = {
            obj.DcrSpawn(act1, subG1),
            obj.DcrSpawn(act1, subG3),
            obj.DcrEffect(obj.RelationType.R, act2, act3, guard=[("target", "data")]),
            obj.DcrEffect(obj.RelationType.R, act3, act2, guard=[("source", "data")]),
            obj.DcrEffect(obj.RelationType.R, act3, act4, forAll=True, guard=[("target", "data"), "and", ("source", "data")]),
            obj.DcrEffect(obj.RelationType.R, act3, act5, guard=[("target", "data"), "and", ("source", "data")]),
            obj.DcrEffect(obj.RelationType.R, act4, act2, guard=[("source", "data")]),
            obj.DcrEffect(obj.RelationType.R, act5, act8, guard=[("target", "data"), "and", ("source", "data")]),
            obj.DcrEffect(obj.RelationType.R, act6, act8, forAll=True, guard=[("target", "data"), "and", ("source", "data")]),
            obj.DcrSpawn(act7, subG2),
            obj.DcrEffect(obj.RelationType.R, act8, act5, guard=[("target", "data"), "and", ("source", "data")]),
            obj.DcrEffect(obj.RelationType.R, act8, act6, forAll=True, guard=[("target", "data"), "and", ("source", "data")])
        }

        self.graph = obj.DcrGraph("testGraph", elements={act1, act2, act3, act4, act5, act6, act7, act8, subG1, subG2, subG3}, relations=relations)
    
    def test_outsideSub_o2m_insideSub(self):
        # Spawn 2 versions of act3:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # Neither is pending:
        self.assertFalse(self.graph.getElementFromID("act3Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act3Spawn2").pending)
        # Execute response effect on all acts3 with data=True:
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Still not pending as neither had data:
        self.assertFalse(self.graph.getElementFromID("act3Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act3Spawn2").pending)
        # Setting act3Spawn1.data to True and executing again:
        sem.executeActivity(obj.DcrExecution("act3Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # act3Spawn1 is now pending, act3spawn2 still did not pass the guard:
        self.assertTrue(self.graph.getElementFromID("act3Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act3Spawn2").pending)
        # setting both to not pending with 1.data=False and 2.data=True and executing again:
        sem.executeActivity(obj.DcrExecution("act3Spawn1", False), self.graph)
        sem.executeActivity(obj.DcrExecution("act3Spawn2", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # act3Spawn1 is now unaffected while act3Spawn2 passes the guard and is pending:
        self.assertFalse(self.graph.getElementFromID("act3Spawn1").pending)
        self.assertTrue(self.graph.getElementFromID("act3Spawn2").pending)
        # Both not pending and both with data=True:
        sem.executeActivity(obj.DcrExecution("act3Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act3Spawn2", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act2"), self.graph)
        # Both are affected:
        self.assertTrue(self.graph.getElementFromID("act3Spawn1").pending)
        self.assertTrue(self.graph.getElementFromID("act3Spawn2").pending)
    
    def test_insideSub_m2o_outsideSub(self):
        # Spawn 2 versions of act3:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # Execute response effect from act3 with data=False:
        sem.executeActivity(obj.DcrExecution("act3Spawn1", False), self.graph)
        # act2 was not affected:
        self.assertFalse(self.graph.getElementFromID("act2").pending)
        # Execute from other act3 with data=True:
        sem.executeActivity(obj.DcrExecution("act3Spawn2", True), self.graph)
        # act2 was affected:
        self.assertTrue(self.graph.getElementFromID("act2").pending)
    
    def test_sub1_m2m_sub1(self):
        # Spawn 2 versions of act3 and act4:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # No acts4 are pending:
        self.assertFalse(self.graph.getElementFromID("act4Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act4Spawn2").pending)
        # Response relation has guard requiring True data from both source and target
        # Execute from act3 with data=True:
        sem.executeActivity(obj.DcrExecution("act3Spawn1", True), self.graph)
        # Neither act4 is affected, as both have no data:
        self.assertFalse(self.graph.getElementFromID("act4Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act4Spawn2").pending)
        # Setting ac4Spawn2.data=True:
        sem.executeActivity(obj.DcrExecution("act4Spawn2", True), self.graph)
        # Execute response effect from act3 with data=False:
        sem.executeActivity(obj.DcrExecution("act3Spawn2", False), self.graph)
        # Still no result as source had data=False:
        self.assertFalse(self.graph.getElementFromID("act4Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act4Spawn2").pending)
        # Executing with source.data=True:
        sem.executeActivity(obj.DcrExecution("act3Spawn1"), self.graph)
        # Only act4 with data=True was affected, despite source and target being in different spawns:
        self.assertFalse(self.graph.getElementFromID("act4Spawn1").pending)
        self.assertTrue(self.graph.getElementFromID("act4Spawn2").pending)
    
    def test_sub1_m2m_sub2(self):
        # Spawn 2 versions of act3 and act5:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        # No acts5 are pending:
        self.assertFalse(self.graph.getElementFromID("act5Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act5Spawn2").pending)
        # Response relation has guard requiring True data from both source and target
        # Execute from act3 with data=True:
        sem.executeActivity(obj.DcrExecution("act3Spawn1", True), self.graph)
        # Neither act5 is affected, as both have no data:
        self.assertFalse(self.graph.getElementFromID("act5Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act5Spawn2").pending)
        # Setting ac5Spawn1.data=True:
        sem.executeActivity(obj.DcrExecution("act5Spawn1", True), self.graph)
        # Execute response effect from act3 with data=False:
        sem.executeActivity(obj.DcrExecution("act3Spawn2", False), self.graph)
        # Still no result as source had data=False:
        self.assertFalse(self.graph.getElementFromID("act5Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act5Spawn2").pending)
        # Executing with source.data=True:
        sem.executeActivity(obj.DcrExecution("act3Spawn1"), self.graph)
        # Only act5 with data=True was affected:
        self.assertTrue(self.graph.getElementFromID("act5Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act5Spawn2").pending)
    

#### FOR ALL OUTER-INNER: ALSO TEST CONSTRAINTS ###

    def test_subOuter_o2m_subInner(self):
        # Spawn 2 versions of act5 and subG2 and, for each of the latter, spawn 2 versions of act8 for a total of 4:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn2"), self.graph)
        # No acts8 are pending:
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)
        # Execute response effect on all acts8 with data=True which are spawned from the same instance as the act5:
        sem.executeActivity(obj.DcrExecution("act5Spawn1", True), self.graph)
        # Still not pending as none had data:
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)
        # Setting act8Spawn1Spawn1.data and act8Spawn2Spawn1.data to True and executing again:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn2Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act5Spawn1"), self.graph)
        # act8Spawn1Spawn1 is now pending but act8Spawn1Spawn2 did not pass the guard. act8Spawn2Spawn1 had positive data but was in other spawn tree:
        self.assertTrue(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)
        # Setting all to not pending with both acts8 in Spawn1 having data=True:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn2", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act5Spawn1"), self.graph)
        # Both are affected, but acts8 in Spawn2 still are not, keeping this a one2many relation:
        self.assertTrue(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertTrue(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)
        # Resetting pendings and executing with source failing guard also results in no effect:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act5Spawn1", False), self.graph)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)

    def test_subInner_m2o_subOuter(self):
        # Spawn 2 versions of act5 and subG2 and, for each of the latter, spawn 2 versions of act8 for a total of 4:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act5Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act5Spawn2", True), self.graph)
        # Neither act5 is pending:
        self.assertFalse(self.graph.getElementFromID("act5Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act5Spawn2").pending)
        # Execute response effect from act8 in Spawn1 with data=False:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn1", False), self.graph)
        # acts5 were not affected:
        self.assertFalse(self.graph.getElementFromID("act5Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act5Spawn2").pending)
        # Execute from other act8 in Spawn1 with data=True:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn2", True), self.graph)
        # act5Spawn1 was affected but act5Spawn2 was not, as this is a one2many relation in Spawn1:
        self.assertTrue(self.graph.getElementFromID("act5Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act5Spawn2").pending)
        # Resetting pending and executing with target failing guard also results in no effect:
        sem.executeActivity(obj.DcrExecution("act5Spawn1", False), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn1", True), self.graph)
        self.assertFalse(self.graph.getElementFromID("act5Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act5Spawn2").pending)

    
    def test_subOuter_m2m_subInner(self):
        # Spawn 2 versions of act6 and subG2 and, for each of the latter, spawn 2 versions of act8 for a total of 4:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act5Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act5Spawn2", True), self.graph)
        # No acts8 are pending:
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)
        # Execute response effect on all acts8 with data=True:
        sem.executeActivity(obj.DcrExecution("act6Spawn1", True), self.graph)
        # Still not pending as none had data:
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)
        # Setting act8Spawn1Spawn1.data and act8Spawn2Spawn1.data to True and executing again:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn2Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act6Spawn1"), self.graph)
        # Both are now pending but not the two others, which did not pass the guard:
        self.assertTrue(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertTrue(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)
        # Setting all to not pending with both acts8 in Spawn1 having data=True:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn2", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn2Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act6Spawn1"), self.graph)
        # Both acts8 in Spawn1 are affected, but still only the one with data=True in Spawn2:
        self.assertTrue(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertTrue(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertTrue(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)
        # Resetting pendings and executing with source failing guard also results in no effect:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn2Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act6Spawn1", False), self.graph)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn1Spawn2").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act8Spawn2Spawn2").pending)

    def test_subInner_m2m_subOuter(self):
        # Spawn 2 versions of act6 and subG2 and, for each of the latter, spawn 2 versions of act8 for a total of 4:
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn1"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act7Spawn2"), self.graph)
        sem.executeActivity(obj.DcrExecution("act6Spawn1", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act6Spawn2", True), self.graph)
        # Neither act6 is pending:
        self.assertFalse(self.graph.getElementFromID("act6Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act6Spawn2").pending)
        # Execute response effect from act8 in Spawn1 with data=False:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn1", False), self.graph)
        # acts6 were not affected:
        self.assertFalse(self.graph.getElementFromID("act6Spawn1").pending)
        self.assertFalse(self.graph.getElementFromID("act6Spawn2").pending)
        # Execute from other act8 in Spawn1 with data=True:
        sem.executeActivity(obj.DcrExecution("act8Spawn1Spawn2", True), self.graph)
        # Both acts6 were affected across spawns:
        self.assertTrue(self.graph.getElementFromID("act6Spawn1").pending)
        self.assertTrue(self.graph.getElementFromID("act6Spawn2").pending)
        # Resetting pending and executing with one target failing guard affects only the target with data=True:
        sem.executeActivity(obj.DcrExecution("act6Spawn1", False), self.graph)
        sem.executeActivity(obj.DcrExecution("act6Spawn2", True), self.graph)
        sem.executeActivity(obj.DcrExecution("act8Spawn2Spawn1", True), self.graph)
        self.assertFalse(self.graph.getElementFromID("act6Spawn1").pending)
        self.assertTrue(self.graph.getElementFromID("act6Spawn2").pending)


if __name__ == "__main__":
    unittest.main(verbosity=2)