import React from "react";

export default function ListPagination({ page, totalPages, total, pageSize, onPageChange }) {
  if (total <= pageSize) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="pm-pagination">
      <span className="pm-pagination__meta">
        {from}–{to} of {total}
      </span>
      <div className="pm-pagination__controls">
        <button
          type="button"
          className="pm-btn pm-btn-ghost"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className="pm-pagination__page">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          className="pm-btn pm-btn-ghost"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
