import '../styles/SuggestionChips.css'

export default function SuggestionChips({ suggestions, onSelect }) {
  return (
    <div className="suggestion-chips">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className="suggestion-chip"
          onClick={() => onSelect(suggestion)}
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}
