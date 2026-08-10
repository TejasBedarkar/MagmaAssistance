"""Guards for user approval of web-enriched ERP creates."""

from unittest.mock import patch

from ERP_Unified import tools


EMPTY_META = {"fields": []}


def test_web_enriched_create_requires_review_before_insert():
    tools._PENDING_CREATES.clear()
    tools._PENDING_WEB_REVIEWS.clear()
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=EMPTY_META), patch(
        "ERP_Unified.tools.erp_client.create_doc", return_value={"name": "LEAD-0001"}
    ) as create_doc:
        review = tools._run_create(
            "Lead", {"company_name": "Example Ltd"}, False, "review-flow", web_enriched=True
        )

    assert review.startswith("REVIEW_REQUIRED:")
    assert "company_name: Example Ltd" in review
    assert tools.pending_web_review_doctype("review-flow") == "Lead"
    create_doc.assert_not_called()


def test_approved_web_review_creates_the_saved_record():
    tools._PENDING_CREATES.clear()
    tools._PENDING_WEB_REVIEWS.clear()
    with patch("ERP_Unified.tools.erp_client.get_meta", return_value=EMPTY_META), patch(
        "ERP_Unified.tools.erp_client.create_doc", return_value={"name": "LEAD-0002"}
    ) as create_doc:
        tools._run_create(
            "Lead", {"company_name": "Example Ltd"}, False, "approve-flow", web_enriched=True
        )
        created = tools._run_create("Lead", {}, False, "approve-flow", approved=True)

    assert "LEAD-0002" in created
    create_doc.assert_called_once_with("Lead", {"company_name": "Example Ltd"})
