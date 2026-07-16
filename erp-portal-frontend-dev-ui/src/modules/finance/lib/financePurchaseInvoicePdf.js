import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { buildPurchasePdfSummaryRows, purchaseTaxLabel, RCM_SUMMARY_NOTE } from "./financeRcmTax.js";

const GST_LABELS = {
  cgst: "CGST",
  sgst: "SGST",
  igst: "IGST",
  cess: "Cess",
  other: "Other tax",
};

const pdfFmt = (n) =>
  `Rs. ${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

function sanitizeFilename(name) {
  return String(name || "purchase-invoice").replace(/[^\w.-]+/g, "_");
}

function pageWidth(doc) {
  return doc.internal.pageSize.getWidth();
}

function drawPartyBox(doc, x, y, width, height, title, lines) {
  doc.setDrawColor(180, 190, 200);
  doc.setLineWidth(0.6);
  doc.rect(x, y, width, height);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(title, x + 10, y + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(doc.splitTextToSize(lines.filter(Boolean).join("\n"), width - 20), x + 10, y + 30);
}

function pdfAmount(n) {
  return pdfFmt(n).replace(/^Rs\. /, "");
}

function buildTaxRows(taxes, gstSummary, isRcm = false) {
  if (taxes?.length) {
    return taxes.map((tax) => {
      let label = purchaseTaxLabel(tax, isRcm);
      if (tax.rate) label += ` @ ${tax.rate}%`;
      return [label, pdfFmt(tax.tax_amount)];
    });
  }
  return Object.entries(GST_LABELS)
    .filter(([key]) => gstSummary[key] > 0)
    .map(([key, label]) => [label, pdfFmt(gstSummary[key])]);
}

const TABLE_THEME = {
  theme: "grid",
  styles: {
    fontSize: 9,
    cellPadding: 5,
    lineColor: [180, 190, 200],
    lineWidth: 0.4,
    textColor: [30, 41, 59],
    overflow: "linebreak",
  },
  headStyles: {
    fillColor: [30, 41, 59],
    textColor: [255, 255, 255],
    fontStyle: "bold",
    halign: "center",
  },
  alternateRowStyles: { fillColor: [248, 250, 252] },
};

export function downloadPurchaseInvoicePdf(invoice) {
  if (!invoice?.name) return;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 36;
  const width = pageWidth(doc) - margin * 2;
  let y = 44;

  const company = invoice.company || {};
  const supplier = invoice.supplier_details || {};
  const items = invoice.items || [];
  const taxes = invoice.taxes || [];
  const gstSummary = invoice.gst_summary || {};
  const isRcm = Boolean(invoice.is_rcm);

  doc.setDrawColor(120, 130, 145);
  doc.setLineWidth(1);
  doc.rect(margin - 8, 28, width + 16, doc.internal.pageSize.getHeight() - 56);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 41, 59);
  doc.text("PURCHASE INVOICE", margin, y);
  doc.setFontSize(11);
  doc.text(invoice.name, margin, y + 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Date: ${invoice.posting_date || "—"}`, pageWidth(doc) - margin, y, { align: "right" });
  doc.text(`Due: ${invoice.due_date || "—"}`, pageWidth(doc) - margin, y + 14, { align: "right" });
  if (invoice.bill_no) {
    doc.text(`Supplier bill: ${invoice.bill_no}`, pageWidth(doc) - margin, y + 28, { align: "right" });
    y += 14;
  }
  y += 46;

  const partyWidth = (width - 12) / 2;
  const partyHeight = 78;
  const leftLines = [
    supplier.supplier_name || invoice.supplier_name || invoice.supplier || "—",
    supplier.gstin ? `GSTIN: ${supplier.gstin}` : "",
    supplier.address || "",
  ];
  const rightLines = [
    company.company_name || company.name || "—",
    company.gstin ? `GSTIN: ${company.gstin}` : "",
    company.address || "",
  ];
  drawPartyBox(doc, margin, y, partyWidth, partyHeight, "Bill from (Supplier)", leftLines);
  drawPartyBox(doc, margin + partyWidth + 12, y, partyWidth, partyHeight, "Bill to (Company)", rightLines);
  y += partyHeight + 16;

  const refs = [];
  if (invoice.purchase_order) refs.push(`Purchase Order: ${invoice.purchase_order}`);
  if (invoice.taxes_and_charges) refs.push(`Tax Template: ${invoice.taxes_and_charges}`);
  if (isRcm) refs.push("Reverse Charge (RCM): GST not included in supplier payable");
  if (invoice.apply_tds && invoice.tax_withholding_category) {
    refs.push(`TDS: ${invoice.tax_withholding_category}`);
  }
  if (refs.length) {
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(doc.splitTextToSize(refs.join("   |   "), width), margin, y);
    y += doc.splitTextToSize(refs.join("   |   "), width).length * 10 + 8;
  }

  if (items.length) {
    autoTable(doc, {
      ...TABLE_THEME,
      startY: y,
      head: [["#", "Description", "HSN/SAC", "Qty", "Rate (Rs.)", "Amount (Rs.)"]],
      body: items.map((row, idx) => [
        String(idx + 1),
        row.item_name || row.item_code || "",
        row.hsn_code || "—",
        String(row.qty ?? ""),
        pdfFmt(row.rate).replace(/^Rs\. /, ""),
        pdfFmt(row.amount).replace(/^Rs\. /, ""),
      ]),
      margin: { left: margin, right: margin },
      tableWidth: width,
      columnStyles: {
        0: { cellWidth: 28, halign: "center" },
        1: { cellWidth: width - 28 - 68 - 42 - 82 - 82 },
        2: { cellWidth: 68, halign: "center" },
        3: { cellWidth: 42, halign: "right" },
        4: { cellWidth: 82, halign: "right" },
        5: { cellWidth: 82, halign: "right", fontStyle: "bold" },
      },
    });
    y = doc.lastAutoTable.finalY + 14;
  } else {
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text(`Invoice amount: ${pdfFmt(invoice.grand_total)}`, margin, y);
    y += 22;
  }

  const taxRows = buildTaxRows(taxes, gstSummary, isRcm);
  if (taxRows.length) {
    autoTable(doc, {
      ...TABLE_THEME,
      startY: y,
      head: [[isRcm ? "RCM GST / Tax" : "GST / Tax", "Amount (Rs.)"]],
      body: taxRows.map(([label, amount]) => [label, amount.replace(/^Rs\. /, "")]),
      margin: { left: margin, right: margin },
      tableWidth: width * 0.62,
      columnStyles: {
        0: { cellWidth: width * 0.62 - 100 },
        1: { cellWidth: 100, halign: "right", fontStyle: "bold" },
      },
    });
    y = doc.lastAutoTable.finalY + 14;
  }

  const totalsWidth = 230;
  const totalsLeft = pageWidth(doc) - margin - totalsWidth;
  const summaryRows = buildPurchasePdfSummaryRows(invoice);
  const totals = summaryRows.map(([label, amount]) => [label, pdfAmount(amount)]);

  autoTable(doc, {
    ...TABLE_THEME,
    startY: y,
    head: [["Summary", "Amount (Rs.)"]],
    body: totals,
    margin: { left: totalsLeft, right: margin },
    tableWidth: totalsWidth,
    columnStyles: {
      0: { cellWidth: 120, fontStyle: "bold", textColor: [71, 85, 105] },
      1: { cellWidth: 110, halign: "right", fontStyle: "bold" },
    },
    didParseCell(data) {
      if (data.section === "body" && data.row.index === totals.length - 1) {
        data.cell.styles.fillColor = [236, 253, 245];
        data.cell.styles.textColor = [22, 101, 52];
      }
    },
  });

  if (isRcm) {
    const noteY = doc.lastAutoTable.finalY + 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const noteLines = doc.splitTextToSize(RCM_SUMMARY_NOTE, totalsWidth);
    doc.text(noteLines, totalsLeft, noteY);
  }

  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    "This is a computer-generated purchase invoice.",
    pageWidth(doc) / 2,
    doc.internal.pageSize.getHeight() - 24,
    { align: "center" }
  );

  doc.save(`${sanitizeFilename(invoice.name)}.pdf`);
}
