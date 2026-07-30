

class CaseHandler:

    def __init__(self):
        #TODO: Define the azure search index and blob storage for dcr graph xml or json files (same blob storage as document handler but different search index)
        pass

    def load_dcr_to_index(self, case):
        # TODO: Load dcr to blob and into search index and run indexer
        pass

    def batch_load_all_dcrs(self, dcrs: list = []):
        for dcr in dcrs:
            self.load_dcr_to_index(dcr)