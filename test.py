# test.py

from web.company_resolver import resolve_company


def print_candidates(result):

    print("\n" + "=" * 70)

    print("COMPANY DISCOVERY")

    print("=" * 70)

    print(result.question)

    print("\nPossible companies:\n")

    for candidate in result.candidates:

        print(
            f"[{candidate['id']}] "
            f"{candidate['name']}"
        )

        print(
            f"    Website: "
            f"{candidate['website']}"
        )

        if candidate.get("snippet"):

            print(
                f"    Details: "
                f"{candidate['snippet'][:200]}"
            )

        print()


def print_result(result):

    print("\n" + "=" * 70)

    print(
        f"STATUS     : {result.status}"
    )

    print(
        f"CONFIDENCE : {result.confidence}"
    )

    print("=" * 70)

    if result.company_name:

        print(
            f"Company    : "
            f"{result.company_name}"
        )

    if result.website:

        print(
            f"Website    : "
            f"{result.website}"
        )

    if result.email:

        print(
            f"Email      : "
            f"{result.email}"
        )

    if result.phone:

        print(
            f"Phone      : "
            f"{result.phone}"
        )

    if result.address:

        print(
            f"Address    : "
            f"{result.address}"
        )

    if result.linkedin:

        print(
            f"LinkedIn   : "
            f"{result.linkedin}"
        )

    print()


def main():

    company = input(
        "Enter company name: "
    ).strip()

    if not company:

        print(
            "Company name is required."
        )

        return

    # ================================================================
    # STAGE 1
    # ================================================================

    print(
        "\nSearching for possible companies..."
    )

    result = resolve_company(
        company
    )

    if result.status != "clarification_required":

        print_result(
            result
        )

        return

    print_candidates(
        result
    )

    # ================================================================
    # USER CLARIFICATION
    # ================================================================

    choice = input(
        "Select candidate number, "
        "or enter a detail such as city/country: "
    ).strip()

    if not choice:

        return

    selected_website = None

    search_hint = None

    # ---------------------------------------------------------------
    # Candidate number
    # ---------------------------------------------------------------

    if choice.isdigit():

        number = int(choice)

        selected = None

        for candidate in result.candidates:

            if candidate["id"] == number:

                selected = candidate

                break

        if not selected:

            print(
                "Invalid candidate number."
            )

            return

        selected_website = selected[
            "website"
        ]

        print(
            f"\nSelected: "
            f"{selected['name']}"
        )

        print(
            f"Website: "
            f"{selected_website}"
        )

    # ---------------------------------------------------------------
    # User provided additional information
    # ---------------------------------------------------------------

    else:

        search_hint = choice

        print(
            f"\nSearching using additional "
            f"information: {search_hint}"
        )

    # ================================================================
    # STAGE 2
    # ================================================================

    print(
        "\nNow verifying the selected company..."
    )

    result = resolve_company(
        company,
        selected_website=selected_website,
        search_hint=search_hint,
    )

    print_result(
        result
    )


if __name__ == "__main__":

    main()