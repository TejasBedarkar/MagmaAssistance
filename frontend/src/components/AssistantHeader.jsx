import '../styles/AssistantHeader.css'

export default function AssistantHeader({ isFolderConnected, onChooseFolder, onClear, onClose }) {
  return (
    <header className="assistant-header">
      <div className="assistant-header__icon" aria-hidden="true">
        <ErpGlyph />
      </div>
      <div className="assistant-header__titles">
        <h1>ERP Voice Assistant</h1>
        <p>Ask about inventory, orders, invoices &amp; more</p>
      </div>
      <div className="assistant-header__actions">
        <button
          className={`icon-btn ${isFolderConnected ? 'icon-btn--active' : ''}`}
          title={isFolderConnected ? 'Chat folder connected' : 'Choose folder to save chats'}
          type="button"
          onClick={onChooseFolder}
        >
          <FolderGlyph />
        </button>
        <button className="icon-btn" title="Clear conversation" type="button" onClick={onClear}>
          <TrashGlyph />
        </button>
        <button className="icon-btn" title="Close" type="button" onClick={onClose}>
          <CloseGlyph />
        </button>
      </div>
    </header>
  )
}

function ErpGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="10" width="4" height="10" rx="1" fill="currentColor" />
      <rect x="10" y="5" width="4" height="15" rx="1" fill="currentColor" />
      <rect x="17" y="13" width="4" height="7" rx="1" fill="currentColor" />
    </svg>
  )
}

function FolderGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  )
}

function TrashGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}
