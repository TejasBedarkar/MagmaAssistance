import ListFilters from "../../../common/components/ListFilters.jsx";

/**
 * Finance list toolbar — wraps shared ListFilters (search + status).
 * Extra filters (dates, accounts) stay as sibling fields in FinancePageHeader.
 */
export default function FinanceListFilters(props) {
  return (
    <div className="finance-list-filters">
      <ListFilters {...props} />
    </div>
  );
}
