let pdfjsModule = null;
let workerReady = false;

function isImageFile(file) {
  if (file?.type?.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(file?.name || '');
}

function isPdfFile(file) {
  if (file?.type === 'application/pdf') return true;
  return /\.pdf$/i.test(file?.name || '');
}

async function getPdfjs() {
  if (!pdfjsModule) {
    pdfjsModule = await import('pdfjs-dist');
    if (!workerReady) {
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjsModule.GlobalWorkerOptions.workerSrc = workerUrl;
      workerReady = true;
    }
  }
  return pdfjsModule;
}

async function renderPdfPage(doc, pageNumber, maxWidth = 360) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = maxWidth / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.88);
}

/**
 * Rich preview metadata (WhatsApp-style: page count + hi-res thumbnail).
 * @returns {Promise<{ preview: string|null, pageCount: number, kind: 'pdf'|'image'|'other' }>}
 */
export async function buildFilePreviewMeta(file) {
  if (!file) {
    return { preview: null, pageCount: 0, kind: 'other' };
  }

  if (isImageFile(file)) {
    return {
      preview: URL.createObjectURL(file),
      pageCount: 1,
      kind: 'image',
    };
  }

  if (isPdfFile(file)) {
    const pdfjs = await getPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    const preview = await renderPdfPage(doc, 1);
    return {
      preview,
      pageCount: doc.numPages || 1,
      kind: 'pdf',
    };
  }

  return { preview: null, pageCount: 0, kind: 'other' };
}

/** @deprecated use buildFilePreviewMeta */
export async function buildFilePreview(file) {
  const meta = await buildFilePreviewMeta(file);
  return meta.preview;
}

export function revokeFilePreview(url) {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

export function fileTypeLabel(file) {
  if (!file) return '';
  if (isPdfFile(file)) return 'PDF';
  if (isImageFile(file)) return 'Image';
  const ext = (file.name || '').split('.').pop();
  return ext ? ext.toUpperCase() : 'File';
}

export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileMetaSubtitle(file, pageCount = 1) {
  const type = fileTypeLabel(file);
  const size = file.size ? formatFileSize(file.size) : '';
  const pages = pageCount > 1 ? `${pageCount} pages` : '1 page';
  return [pages, type, size].filter(Boolean).join(' · ');
}
