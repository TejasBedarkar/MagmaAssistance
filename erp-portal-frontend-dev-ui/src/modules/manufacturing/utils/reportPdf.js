import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * PDF report generation — produces real, text-based (vector) documents with
 * selectable text and formatted tables (not screenshots).
 *
 * A "report model" looks like:
 *   {
 *     title: string,
 *     subtitle?: string,
 *     kpis?: [{ label, value }],
 *     tables?: [{ title, head: string[], body: Array<Array>, empty?: string }],
 *   }
 */

const MARGIN_X = 40;
const BAND_HEIGHT = 64;

function createDoc() {
  return new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
}

function generatedStamp() {
  return new Date().toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function drawBand(doc, title, subtitle) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(45, 55, 72);
  doc.rect(0, 0, pageWidth, BAND_HEIGHT, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(title || 'Report', MARGIN_X, 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 210, 220);
  doc.text('Manufacturing Operations', pageWidth - MARGIN_X, 24, { align: 'right' });
  doc.text(`Generated: ${generatedStamp()}`, pageWidth - MARGIN_X, 40, { align: 'right' });

  if (subtitle) {
    doc.setTextColor(210, 218, 226);
    doc.setFontSize(10);
    doc.text(String(subtitle), MARGIN_X, 48);
  }
}

function renderKpis(doc, kpis, startY) {
  if (!kpis || !kpis.length) return startY;
  autoTable(doc, {
    startY,
    head: [['Metric', 'Value']],
    body: kpis.map((k) => [k.label, String(k.value ?? '—')]),
    theme: 'grid',
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [71, 85, 105], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 200, textColor: [71, 85, 105] },
      1: { fontStyle: 'bold' },
    },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });
  return doc.lastAutoTable.finalY + 22;
}

function renderTables(doc, tables, startY) {
  let cursorY = startY;
  (tables || []).forEach((table) => {
    if (cursorY > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      cursorY = 56;
    }
    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(table.title, MARGIN_X, cursorY);
    cursorY += 8;

    if (!table.body || table.body.length === 0) {
      autoTable(doc, {
        startY: cursorY,
        body: [[table.empty || 'No data']],
        theme: 'plain',
        margin: { left: MARGIN_X, right: MARGIN_X },
        styles: { fontSize: 9, textColor: [148, 163, 184], fontStyle: 'italic' },
      });
    } else {
      autoTable(doc, {
        startY: cursorY,
        head: [table.head],
        body: table.body,
        theme: 'striped',
        margin: { left: MARGIN_X, right: MARGIN_X },
        styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 250] },
      });
    }
    cursorY = doc.lastAutoTable.finalY + 22;
  });
  return cursorY;
}

function renderModelSection(doc, model, startY) {
  let y = startY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59);
  doc.text(model.title || 'Report', MARGIN_X, y);
  y += 6;
  if (model.subtitle) {
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(String(model.subtitle), MARGIN_X, y);
  }
  y += 16;
  y = renderKpis(doc, model.kpis, y);
  y = renderTables(doc, model.tables, y);
  return y;
}

function addPageNumbers(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN_X, pageHeight - 20, {
      align: 'right',
    });
  }
}

function sanitize(name) {
  return String(name || 'report').replace(/[^\w.-]+/g, '_');
}

/** Single-report PDF download. */
export function generateReportPdf(model, filename = 'report') {
  const doc = createDoc();
  drawBand(doc, model.title, model.subtitle);
  let y = 86;
  y = renderKpis(doc, model.kpis, y);
  renderTables(doc, model.tables, y);
  addPageNumbers(doc);
  doc.save(`${sanitize(filename)}.pdf`);
}

/**
 * Combined PDF download — multiple report models in one document, each
 * starting on its own page. Used for role-based "Download All" exports.
 */
export function generateCombinedReportPdf(
  models,
  filename = 'reports',
  documentTitle = 'Operations Report',
) {
  const list = (models || []).filter(Boolean);
  const doc = createDoc();
  const count = list.length;
  drawBand(doc, documentTitle, `${count} report${count === 1 ? '' : 's'} · role-based export`);

  let y = 86;
  list.forEach((model, idx) => {
    if (idx > 0) {
      doc.addPage();
      y = 48;
    }
    y = renderModelSection(doc, model, y);
  });

  addPageNumbers(doc);
  doc.save(`${sanitize(filename)}.pdf`);
}
