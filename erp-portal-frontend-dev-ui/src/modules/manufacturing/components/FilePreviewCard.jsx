import { Loader2, X } from '@/icons/mfgIcons.js';
import { fileMetaSubtitle } from '@/utils/filePreview';

function PdfBadge() {
  return (
    <div className="mfg-file-preview__badge mfg-file-preview__badge--pdf" aria-hidden>
      <span>PDF</span>
    </div>
  );
}

function ImageBadge() {
  return (
    <div className="mfg-file-preview__badge mfg-file-preview__badge--img" aria-hidden>
      <span>IMG</span>
    </div>
  );
}

/** Compact card — fits 3 per row in POD upload. */
export default function FilePreviewCard({
  item,
  onRemove,
  typeOptions,
  onTypeChange,
}) {
  const { file, preview, previewLoading, pageCount = 1, attachment_type: attachmentType } = item;
  const isPdf = file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');

  return (
    <div className="mfg-file-preview">
      <div className="mfg-file-preview__thumb">
        {previewLoading && (
          <div className="mfg-file-preview__loading">
            <Loader2 size={20} className="mfg-spin" aria-hidden />
            <span>Loading…</span>
          </div>
        )}
        {!previewLoading && preview && (
          <img
            src={preview}
            alt={file.name}
            className="mfg-file-preview__image"
          />
        )}
        {!previewLoading && !preview && (
          <div className="mfg-file-preview__empty">No preview</div>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="mfg-file-preview__remove"
          title="Remove"
        >
          <X size={12} />
        </button>
      </div>

      <div className="mfg-file-preview__meta">
        {isPdf ? <PdfBadge /> : <ImageBadge />}
        <div className="mfg-file-preview__info">
          <p className="mfg-file-preview__name" title={file.name}>
            {file.name}
          </p>
          <p className="mfg-file-preview__sub">
            {fileMetaSubtitle(file, pageCount)}
          </p>
        </div>
      </div>

      <div className="mfg-file-preview__type">
        <select
          className="pm-input mfg-file-preview__select"
          value={attachmentType}
          onChange={(e) => onTypeChange(e.target.value)}
          title="Document type"
        >
          {typeOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
          <option value="Other">Other</option>
        </select>
      </div>
    </div>
  );
}
