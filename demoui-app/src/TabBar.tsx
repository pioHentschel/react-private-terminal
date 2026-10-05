import React from 'react';

const PIPBOY_TABS = ['STAT', 'INV', 'DATA', 'MAP', 'RADIO'] as const;
type PipBoyTab = typeof PIPBOY_TABS[number];

type TabBarProps = {
  active: PipBoyTab;
  onSelect: (tab: PipBoyTab) => void;
};

function TabBar({ active, onSelect }: TabBarProps) {
  return (
    <div className="pipboy-tabs" role="tablist" aria-label="Pip-Boy sections">
      {PIPBOY_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === active}
          className={`pipboy-tab ${tab === active ? 'pipboy-tab--active' : ''}`}
          onClick={() => onSelect(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export { TabBar, PIPBOY_TABS };
export type { PipBoyTab };
