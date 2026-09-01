import React from 'react';

function RadioTab() {
  return (
    <div className="radio-layout">
      <div className="radio-layout__left">
        <button type="button" className="radio-panel__btn">Liste</button>
      </div>

      <div className="radio-layout__top-right" />

      <div className="radio-layout__bottom-right">
        <button type="button" className="radio-panel__btn">Bestätigen</button>
        <button type="button" className="radio-panel__btn">Stopp</button>
      </div>
    </div>
  );
}

export { RadioTab };
