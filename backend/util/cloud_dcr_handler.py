

class CaseHandler:

    def __init__(self):
        #TODO: Define the azure search index and blob storage for cases as json files (same blob storage as document handler but different search index)
        pass

    def load_case_to_index(self, case):
        # TODO: Load case to blob and into search index and run indexer
        pass

    def batch_load_all_cases(self, cases: list = []):
        for case in cases:
            self.load_case_to_index(case)