"""Build the fully local multi-format case search index."""

import argparse

from util.localcasesearch import get_local_case_search


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Discard the current JSON case index and embed every case again.",
    )
    arguments = parser.parse_args()
    search = get_local_case_search()
    search.ensure_index(rebuild=arguments.rebuild)
    print(f"Local case index ready at {search.index_path}")


if __name__ == "__main__":
    main()
