import { useCallback, useRef, useState } from 'react';
import { Upload, Image as ImageIcon } from '@/icons/mfgIcons.js';
import FilePreviewCard from '@/components/FilePreviewCard';
import {
  buildFilePreviewMeta,
  revokeFilePreview,
} from '@/utils/filePreview';

const MAX_FILES = 3;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';

function applyFilesChange(onChange, updater) {
  if (typeof onChange !== 'function') return;
  onChange(updater);
}

/**
 * Drag-drop multi-file zone — WhatsApp-style rich previews (max 3).
 */
export default function FileDropZone({
  files = [],
  onChange,
  typeOptions = ['Delivery Receipt', 'Signature Photo', 'Goods Photo'],
  compact = false,
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const queuePreview = useCallback((items) => {
    items.forEach((item) => {
      buildFilePreviewMeta(item.file)
        .then(({ preview, pageCount, kind }) => {
          applyFilesChange(onChange, (prev) => prev.map((f) => (
            f.id === item.id
              ? {
                ...f,
                preview: preview || f.preview,
                pageCount,
                previewKind: kind,
                previewLoading: false,
              }
              : f
          )));
        })
        .catch(() => {
          applyFilesChange(onChange, (prev) => prev.map((f) => (
            f.id === item.id ? { ...f, previewLoading: false } : f
          )));
        });
    });
  }, [onChange]);

  const addFiles = useCallback((incoming) => {
    const list = Array.from(incoming || []);
    if (!list.length) return;

    const room = MAX_FILES - files.length;
    if (room <= 0) return;

    const newItems = list.slice(0, room).map((file, idx) => ({
      id: `${Date.now()}-${idx}-${file.name}`,
      file,
      preview: null,
      pageCount: 1,
      previewLoading: true,
      attachment_type: typeOptions[files.length + idx] || 'Other',
    }));

    applyFilesChange(onChange, (prev) => [...prev, ...newItems]);
    queuePreview(newItems);
  }, [files.length, onChange, queuePreview, typeOptions]);

  const removeFile = (id) => {
    const target = files.find((f) => f.id === id);
    if (target?.preview) revokeFilePreview(target.preview);
    applyFilesChange(onChange, (prev) => prev.filter((f) => f.id !== id));
  };

  const updateType = (id, attachment_type) => {
    applyFilesChange(onChange, (prev) => prev.map((f) => (
      f.id === id ? { ...f, attachment_type } : f
    )));
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <div className="mfg-file-drop">
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`mfg-file-drop__zone${dragOver ? ' is-dragover' : ''}${compact ? ' mfg-file-drop__zone--compact' : ''}`}
      >
        <Upload className="mfg-file-drop__icon" size={compact ? 28 : 32} aria-hidden />
        <div className="mfg-file-drop__copy">
          <p className="mfg-file-drop__title">Drag & drop files here</p>
          <p className="mfg-file-drop__hint">
            or click to browse · max {MAX_FILES} files (PDF / image)
          </p>
          {!compact && (
            <p className="mfg-file-drop__subhint">
              Receipt + signature photo + goods photo
            </p>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          className="mfg-file-drop__input"
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="mfg-file-drop__previews">
          {files.map((item) => (
            <FilePreviewCard
              key={item.id}
              item={item}
              typeOptions={typeOptions}
              onRemove={() => removeFile(item.id)}
              onTypeChange={(value) => updateType(item.id, value)}
            />
          ))}
        </div>
      )}

      {files.length > 0 && files.length < MAX_FILES && (
        <p className="mfg-file-drop__more">
          <ImageIcon size={12} aria-hidden />
          {MAX_FILES - files.length} more file(s) can be added
        </p>
      )}
    </div>
  );
}
