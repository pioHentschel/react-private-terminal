import React from 'react';

// Stand-in for tabs whose content isn't decided yet (STAT / MAP).
function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="pipboy-placeholder">
      <div className="pipboy-placeholder__label">{label}</div>
      <div className="pipboy-placeholder__status">NO DATA</div>
    </div>
  );
}

export { PlaceholderTab };
