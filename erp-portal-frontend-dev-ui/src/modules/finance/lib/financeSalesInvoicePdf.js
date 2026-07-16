import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const GST_LABELS = {
  cgst: "CGST",
  sgst: "SGST",
  igst: "IGST",
  cess: "Cess",
  other: "Other tax",
};

/** PDF-safe currency — Helvetica cannot render the ₹ glyph. */
const pdfFmt = (n) =>
  `Rs. ${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

function sanitizeFilename(name) {
  return String(name || "invoice").replace(/[^\w.-]+/g, "_");
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

function gstBucketAmount(gstSummary, taxes, type) {
  const fromSummary = Number(gstSummary?.[type] || 0);
  if (fromSummary > 0) return fromSummary;
  return taxes
    .filter((t) => String(t.gst_type || "").toLowerCase() === type)
    .reduce((sum, t) => sum + Number(t.tax_amount || 0), 0);
}

function pdfAmount(n) {
  return pdfFmt(n).replace(/^Rs\. /, "");
}

function buildTaxRows(taxes, gstSummary) {
  if (taxes?.length) {
    return taxes.map((tax) => [
      `${tax.description || tax.account_head || "Tax"}${
        tax.gst_type ? ` (${String(tax.gst_type).toUpperCase()})` : ""
      }${tax.rate ? ` @ ${tax.rate}%` : ""}`,
      pdfFmt(tax.tax_amount),
    ]);
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

export function downloadSalesInvoicePdf(invoice) {
  if (!invoice?.name) return;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 36;
  const width = pageWidth(doc) - margin * 2;
  let y = 44;

  const billing = invoice.billing || {};
  const company = billing.company || invoice.company || {};
  const customer = invoice.customer_details || {};
  const items = invoice.items || billing.items || [];
  const taxes = invoice.taxes || billing.taxes || [];
  const gstSummary = invoice.gst_summary || billing.gst_summary || {};

  doc.setDrawColor(120, 130, 145);
  doc.setLineWidth(1);
  doc.rect(margin - 8, 28, width + 16, doc.internal.pageSize.getHeight() - 56);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 41, 59);
  doc.text("TAX INVOICE", margin, y);
  doc.setFontSize(11);
  doc.text(invoice.name, margin, y + 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const paymentTerms = invoice.payment_terms || invoice.customer_details?.payment_terms || "—";
  doc.text(`Date: ${invoice.posting_date || "—"}`, pageWidth(doc) - margin, y, { align: "right" });
  doc.text(`Due: ${invoice.due_date || "—"}`, pageWidth(doc) - margin, y + 14, { align: "right" });
  doc.text(`Payment terms: ${paymentTerms}`, pageWidth(doc) - margin, y + 28, { align: "right" });
  y += 46;

  const partyWidth = (width - 12) / 2;
  const partyHeight = 78;
  const leftLines = [
    company.company_name || company.name || "—",
    company.gstin ? `GSTIN: ${company.gstin}` : "",
    company.address || "",
  ];
  const rightLines = [
    customer.customer_name || invoice.customer || "—",
    customer.gstin ? `GSTIN: ${customer.gstin}` : "",
    customer.address || "",
  ];
  drawPartyBox(doc, margin, y, partyWidth, partyHeight, "Bill from", leftLines);
  drawPartyBox(doc, margin + partyWidth + 12, y, partyWidth, partyHeight, "Bill to", rightLines);
  y += partyHeight + 16;

  const refs = [];
  if (invoice.sales_order) refs.push(`Sales Order: ${invoice.sales_order}`);
  if (invoice.delivery_note) refs.push(`Delivery Note: ${invoice.delivery_note}`);
  if (invoice.taxes_and_charges) refs.push(`Tax Template: ${invoice.taxes_and_charges}`);
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

  const taxRows = buildTaxRows(taxes, gstSummary);
  if (taxRows.length) {
    autoTable(doc, {
      ...TABLE_THEME,
      startY: y,
      head: [["GST / Tax", "Amount (Rs.)"]],
      body: taxRows.map(([label, amount]) => [label, amount.replace(/^Rs\. /, "")]),
      margin: { left: margin, right: margin },
      tableWidth: width * 0.62,
      columnStyles: {
        0: { cellWidth: (width * 0.62) - 100 },
        1: { cellWidth: 100, halign: "right", fontStyle: "bold" },
      },
    });
    y = doc.lastAutoTable.finalY + 14;
  }

  const totalsWidth = 230;
  const totalsLeft = pageWidth(doc) - margin - totalsWidth;
  const itemsSubtotal = items.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalTaxes =
    invoice.total_taxes_and_charges ??
    billing.total_taxes ??
    taxes.reduce((sum, t) => sum + Number(t.tax_amount || 0), 0);
  const grandTotalVal = invoice.grand_total ?? billing.grand_total;
  let subtotal = invoice.net_total ?? billing.net_total;
  if (!subtotal && itemsSubtotal) subtotal = itemsSubtotal;
  if (!subtotal && grandTotalVal && totalTaxes) subtotal = Math.max(grandTotalVal - totalTaxes, 0);
  const cgstAmount = gstBucketAmount(gstSummary, taxes, "cgst");
  const sgstAmount = gstBucketAmount(gstSummary, taxes, "sgst");
  const totals = [
    ["Subtotal", pdfAmount(subtotal)],
    ["CGST", pdfAmount(cgstAmount)],
    ["SGST", pdfAmount(sgstAmount)],
    ["Grand total", pdfAmount(grandTotalVal)],
  ];

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
      if (data.section === "body" && data.row.index === 3) {
        data.cell.styles.fillColor = [236, 253, 245];
        data.cell.styles.textColor = [22, 101, 52];
      }
    },
  });

  if (invoice.remarks) {
    const remarkY = doc.lastAutoTable.finalY + 18;
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Remarks: ${invoice.remarks}`, margin, remarkY, { maxWidth: width });
  }

  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(
    "This is a computer-generated tax invoice.",
    pageWidth(doc) / 2,
    doc.internal.pageSize.getHeight() - 24,
    { align: "center" }
  );

  doc.save(`${sanitizeFilename(invoice.name)}.pdf`);
}
