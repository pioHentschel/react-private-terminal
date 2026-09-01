import React, { useRef, useState } from 'react';

type Station = { name: string; url: string };

const STATIONS: Station[] = [
  { name: 'RPR.1', url: 'https://stream.rpr1.de/webradio/aac-64' },
  { name: 'Fallout 4 Diamond City Radio', url: 'http://fallout.fm:8000/falloutfm6.ogg' },
  { name: 'Country Antenne', url: 'https://s6-webradio.antenne.de/country-antenne/stream/aacp' },
  { name: 'Antenne Bayern', url: 'https://s8-webradio.antenne.de/antenne/stream/aacp' },
  { name: 'Rock Antenne Hamburg', url: 'https://s6-webradio.rockantenne.hamburg/rockantenne-hamburg/stream/aacp' },
];

const NO_STATION = '#';

function RadioTab() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string>(NO_STATION);

  const handleConfirm = () => {
    const audio = audioRef.current;
    if (!audio || selectedUrl === NO_STATION) return;
    audio.src = selectedUrl;
    audio.load();
    audio.play().catch(() => {});
  };

  const handleStop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.src = NO_STATION;
    audio.load();
  };

  return (
    <div className="radio-layout">
      <div className="radio-layout__left">
        {STATIONS.map((station) => (
          <button
            key={station.url}
            type="button"
            className={`radio-panel__btn ${selectedUrl === station.url ? 'radio-panel__btn--selected' : ''}`}
            onClick={() => setSelectedUrl(station.url)}
          >
            {station.name}
          </button>
        ))}
      </div>

      <div className="radio-layout__top-right" />

      <div className="radio-layout__bottom-right">
        <button type="button" className="radio-panel__btn" onClick={handleConfirm}>Bestätigen</button>
        <button type="button" className="radio-panel__btn" onClick={handleStop}>Stopp</button>
      </div>

      <audio ref={audioRef} style={{ display: 'none' }} />
    </div>
  );
}

export { RadioTab };
