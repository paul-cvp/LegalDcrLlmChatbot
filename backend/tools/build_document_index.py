"""Build the fully local PDF search index."""

import argparse

from util.localdocumentsearch import get_local_document_search


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Discard the current JSON index and embed every PDF again.",
    )
    arguments = parser.parse_args()
    search = get_local_document_search()
    search.ensure_index(rebuild=arguments.rebuild)
    print(f"Local document index ready at {search.index_path}")


if __name__ == "__main__":
    main()
