import React, { useEffect, useState } from 'react';

import { TerminalTab } from './App';
import { PlaceholderTab } from './PlaceholderTab';
import { RadioTab } from './RadioTab';
import { PIPBOY_TABS, PipBoyTab, TabBar } from './TabBar';

const CRT_STORAGE_KEY = 'pipboy:crt-enabled';

// Top-level Pip-Boy frame: tab navigation + the screen-wide CRT toggle,
// both of which persist across whichever tab is active.
function PipBoyShell() {
  const [activeTab, setActiveTab] = useState<PipBoyTab>('TERMINAL');

  // CRT screen effect (scanlines/flicker) — off by default for accessibility,
  // persisted across reloads once a user picks a setting.
  const [crtEnabled, setCrtEnabled] = useState<boolean>(() => {
    return window.localStorage.getItem(CRT_STORAGE_KEY) === 'true';
  });

  const toggleCrt = () => {
    setCrtEnabled((prev) => {
      const next = !prev;
      window.localStorage.setItem(CRT_STORAGE_KEY, String(next));
      return next;
    });
  };

  // Classic Pip-Boy shoulder-button feel: cycle tabs with the arrow keys,
  // but stay out of the way while the user is typing in the terminal.
  useEffect(() => {
    const handleKeyDown = (evt: KeyboardEvent) => {
      const target = evt.target as HTMLElement | null;
      if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight') return;

      const currentIndex = PIPBOY_TABS.indexOf(activeTab);
      const delta = evt.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (currentIndex + delta + PIPBOY_TABS.length) % PIPBOY_TABS.length;
      setActiveTab(PIPBOY_TABS[nextIndex]);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab]);

  return (
    <div className="pipboy-shell">
      <div className="pipboy-topbar">
        <TabBar active={activeTab} onSelect={setActiveTab} />

        <button
          type="button"
          className={`crt-toggle ${crtEnabled ? 'crt-toggle--on' : ''}`}
          onClick={toggleCrt}
          aria-pressed={crtEnabled}
          title="Toggle CRT screen effect (scanlines/flicker)"
        >
          <span className="crt-toggle__label">CRT</span>
          <span className="crt-toggle__switch" />
        </button>
      </div>

      <div className={`crt-overlay ${crtEnabled ? 'crt-overlay--active' : ''}`} aria-hidden="true" />

      <div className="pipboy-content">
        {activeTab === 'TERMINAL' ? <TerminalTab />
          : activeTab === 'RADIO' ? <RadioTab />
          : <PlaceholderTab label={activeTab} />}
      </div>
    </div>
  );
}

export { PipBoyShell };
