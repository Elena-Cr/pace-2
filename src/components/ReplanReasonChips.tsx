import { useState } from 'react';
import { ReplanReason, REPLAN_REASON_LABEL } from '@/lib/pace';

type Props = {
  selected?: ReplanReason | null;
  onSelect: (reason: ReplanReason) => void;
  // When the user selects "Custom reason" and types text, this fires with
  // the free-text value. Consumers should persist it as replanning_reason_text
  // if the column exists, or append it to the task notes as a fallback.
  customSelected?: boolean;
  customText?: string;
  onSelectCustom?: () => void;
  onCustomTextChange?: (text: string) => void;
};

// Single source of truth for replan-reason chip rows.
// Used by Replan.tsx and Calendar.tsx so both surfaces stay in sync
// with REPLAN_REASON_LABEL.
export default function ReplanReasonChips({
  selected,
  onSelect,
  customSelected = false,
  customText = '',
  onSelectCustom,
  onCustomTextChange,
}: Props) {
  const [localCustom, setLocalCustom] = useState(customText);
  const text = onCustomTextChange ? customText : localCustom;
  const setText = (v: string) => {
    if (onCustomTextChange) onCustomTextChange(v);
    else setLocalCustom(v);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap">
        {(Object.keys(REPLAN_REASON_LABEL) as ReplanReason[]).map(r => (
          <button
            key={r}
            type="button"
            onClick={() => onSelect(r)}
            className={selected === r && !customSelected ? 'pace-chip-filled' : 'pace-chip'}
          >
            {REPLAN_REASON_LABEL[r]}
          </button>
        ))}
        {onSelectCustom && (
          <button
            type="button"
            onClick={onSelectCustom}
            className={customSelected ? 'pace-chip-filled' : 'pace-chip'}
          >
            Custom reason
          </button>
        )}
      </div>
      {customSelected && onSelectCustom && (
        <input
          type="text"
          className="pace-field"
          placeholder="What changed?"
          value={text}
          onChange={e => setText(e.target.value)}
          autoFocus
        />
      )}
    </div>
  );
}
