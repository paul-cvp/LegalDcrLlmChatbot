

class DocumentHandler:

    def __init__(self):
        #TODO: Define the azure search index and blob storage only for pdf documents (documents related to laws)
        pass

    def load_document_to_index(self, document):
        #TODO: Step 1: Extract text from pdf document
        # TODO: Step 2: Load document to blob and into search index and run indexer
        pass

    def batch_load_all_documents(self, documents: list = []):
        for document in documents:
            self.load_document_to_index(document)