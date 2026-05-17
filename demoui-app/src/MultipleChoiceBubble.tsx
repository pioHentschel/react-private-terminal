import React from 'react';

export interface MultipleChoiceBubbleProps {
  /** The question / prompt shown above the choices. */
  question: string;
  /** The list of choices. The number of choices is just `choices.length`,
   *  so the caller decides how many to show by sizing this array. */
  choices: string[];
  /** Index of the currently-selected choice, or null/undefined for none.
   *  Pass this in if you persist the selection (e.g. on the chat message)
   *  so the bubble stays "answered" across re-renders. */
  selectedIndex?: number | null;
  /** Fired when a choice is clicked. Not called if the bubble is locked. */
  onSelect?: (index: number, choice: string) => void;
  /** Force the bubble into a read-only state (e.g. an old question that
   *  shouldn't be re-answered). When true, no clicks fire onSelect. */
  disabled?: boolean;
}

/**
 * A reusable multiple-choice prompt that's rendered as a chat bubble.
 *
 * Once a choice is picked, that choice gets highlighted and the others
 * are visually dimmed. Lock semantics are intentionally simple: as soon
 * as `selectedIndex` is set (either by the caller or by the internal
 * onSelect → updateMessage flow), the bubble stops reacting to clicks.
 */
export function MultipleChoiceBubble({
  question,
  choices,
  selectedIndex,
  onSelect,
  disabled = false,
}: MultipleChoiceBubbleProps) {
  const hasSelection =
    typeof selectedIndex === 'number' && selectedIndex >= 0;
  const locked = disabled || hasSelection;

  return (
    <div
      // The question itself is shown as a separate incoming message in
      // the chat, so we don't render it visually here. We still surface
      // it as an aria-label so screen readers know what these choices
      // are answering.
      aria-label={question}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        minWidth: '260px',
      }}
    >
      {hasSelection ? (
        // Once an answer is picked, collapse the bubble to just that
        // single choice. This keeps the chat history compact and makes
        // the answered prompt read like a normal reply.
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.6rem',
            alignSelf: 'flex-start',
            padding: '0.5rem 0.75rem',
            borderRadius: '0.5rem',
            border: '1px solid #0d6efd',
            background: '#0d6efd',
            color: 'white',
          }}
        >
          <ChoiceCircle filled inverted />
          {choices[selectedIndex as number]}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          {choices.map((choice, idx) => (
            <button
              key={idx}
              type="button"
              disabled={locked}
              onClick={() => {
                if (locked) return;
                onSelect?.(idx, choice);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                textAlign: 'left',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(0,0,0,0.15)',
                background: 'white',
                color: 'inherit',
                cursor: locked ? 'default' : 'pointer',
                transition: 'all 120ms ease',
                font: 'inherit',
              }}
            >
              <ChoiceCircle filled={false} />
              {choice}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Generic radio-style indicator. `filled=false` shows an empty ring;
 * `filled=true` shows a solid dot. `inverted` swaps colors so the dot
 * stays visible on the blue selected pill.
 */
function ChoiceCircle({
  filled,
  inverted = false,
}: {
  filled: boolean;
  inverted?: boolean;
}) {
  const size = 14;
  const ringColor = inverted ? 'white' : 'rgba(0,0,0,0.45)';
  const dotColor = inverted ? 'white' : '#0d6efd';

  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2px solid ${ringColor}`,
        background: filled ? dotColor : 'transparent',
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    />
  );
}

export default MultipleChoiceBubble;
