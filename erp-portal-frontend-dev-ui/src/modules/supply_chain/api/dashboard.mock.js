/** Dashboard mock — filter options + summary JSON for offline / partial API fallback. */

import mockSummary from "./dashboard.summary.mock.json";

export const MOCK_SUMMARY = mockSummary;

export const MOCK_FILTER_OPTIONS = {
  warehouses: [
    { value: "", label: "All warehouses" },
    { value: "RM-WH01", label: "RM-WH01 — Pune" },
    { value: "RM-WH02", label: "RM-WH02 — Ahmedabad" },
    { value: "FG-WH01", label: "FG-WH01 — Pune" },
  ],
  suppliers: [
    { value: "", label: "All suppliers" },
    { value: "VEN001", label: "VEN001 — ABC Metals" },
    { value: "VEN002", label: "VEN002 — Steel Corp" },
  ],
  itemTypes: [
    { value: "", label: "All types" },
    { value: "RM", label: "Raw Material" },
    { value: "FG", label: "Finished Good" },
  ],
};
