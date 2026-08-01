"""Build the fully local XML/JSON DCR graph search index."""

import argparse

from util.localdcrgraphsearch import get_local_dcr_graph_search


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Discard the current JSON index and embed every DCR graph again.",
    )
    arguments = parser.parse_args()
    search = get_local_dcr_graph_search()
    search.ensure_index(rebuild=arguments.rebuild)
    print(f"Local DCR graph index ready at {search.index_path}")


if __name__ == "__main__":
    main()
