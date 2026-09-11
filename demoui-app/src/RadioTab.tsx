import React, { useEffect, useRef, useState } from 'react';

import { RadioVisualizer } from './RadioVisualizer';

type Station = { name: string; url: string; mimeType: string };

const STATIONS: Station[] = [
  { name: 'RPR.1', url: 'https://stream.rpr1.de/webradio/aac-64', mimeType: 'audio/aac' },
  { name: 'Fallout 4 Diamond City Radio', url: 'http://fallout.fm:8000/falloutfm6.ogg', mimeType: 'audio/ogg; codecs="vorbis"' },
  { name: 'Country Antenne', url: 'https://s6-webradio.antenne.de/country-antenne/stream/aacp', mimeType: 'audio/aac' },
  { name: 'Antenne Bayern', url: 'https://s8-webradio.antenne.de/antenne/stream/aacp', mimeType: 'audio/aac' },
  { name: 'Rock Antenne Hamburg', url: 'https://s6-webradio.rockantenne.hamburg/rockantenne-hamburg/stream/aacp', mimeType: 'audio/aac' },
];

// Safari/WebKit cannot decode Ogg Vorbis at all — feature-detect instead of
// sniffing the user agent, so this only greys out what's actually unplayable.
function unsupportedStationUrls(): Set<string> {
  const probe = document.createElement('audio');
  return new Set(STATIONS.filter((s) => probe.canPlayType(s.mimeType) === '').map((s) => s.url));
}

const NO_STATION = '#';

function RadioTab() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [selectedUrl, setSelectedUrl] = useState<string>(NO_STATION);
  const [unsupportedUrls] = useState<Set<string>>(unsupportedStationUrls);

  // Tap the <audio> element's output via the Web Audio API. Requires
  // crossOrigin="anonymous" on the element; streams without CORS headers
  // will still play, but the analyser will read as silence.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleAudioError = () => {
      console.error('[RadioTab] audio error', {
        code: audio.error?.code,
        message: audio.error?.message,
        src: audio.currentSrc,
      });
    };
    audio.addEventListener('error', handleAudioError);

    try {
      const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextCtor();
      const node = ctx.createAnalyser();
      node.fftSize = 128;

      const source = ctx.createMediaElementSource(audio);
      source.connect(node);
      node.connect(ctx.destination);

      audioCtxRef.current = ctx;
      setAnalyser(node);

      // Debug hook: inspect from Safari's Web Inspector console via
      // `__radioDebug.ctx.state` / `__radioDebug.audio.error`.
      (window as unknown as { __radioDebug?: unknown }).__radioDebug = { ctx, analyser: node, source, audio };

      return () => {
        ctx.close();
        audio.removeEventListener('error', handleAudioError);
      };
    } catch (err) {
      console.error('[RadioTab] failed to set up Web Audio graph (createMediaElementSource/connect)', err);
      return () => {
        audio.removeEventListener('error', handleAudioError);
      };
    }
  }, []);

  const handleConfirm = () => {
    const audio = audioRef.current;
    if (!audio || selectedUrl === NO_STATION) return;
    audioCtxRef.current?.resume().catch((err) => console.error('[RadioTab] AudioContext.resume() failed', err));
    audio.src = selectedUrl;
    audio.load();
    audio.play().catch((err) => console.error('[RadioTab] audio.play() failed', err));
  };

  const handleStop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    // Clear the source properly instead of assigning "#" — that resolves to
    // the page's own URL and made Safari report a spurious MEDIA_ERR_SRC_NOT_SUPPORTED.
    audio.removeAttribute('src');
    audio.load();
  };

  return (
    <div className="radio-layout">
      <div className="radio-layout__left">
        {STATIONS.map((station) => {
          const isUnsupported = unsupportedUrls.has(station.url);
          return (
            <div key={station.url} className="radio-station">
              <button
                type="button"
                disabled={isUnsupported}
                className={`radio-panel__btn ${selectedUrl === station.url ? 'radio-panel__btn--selected' : ''} ${isUnsupported ? 'radio-panel__btn--disabled' : ''}`}
                onClick={() => setSelectedUrl(station.url)}
              >
                {station.name}
              </button>
              {isUnsupported && (
                <div className="radio-station__note">nicht verfügbar in Safari</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="radio-layout__top-right">
        <RadioVisualizer analyser={analyser} />
      </div>

      <div className="radio-layout__bottom-right">
        <button type="button" className="radio-panel__btn" onClick={handleConfirm}>Bestätigen</button>
        <button type="button" className="radio-panel__btn" onClick={handleStop}>Stopp</button>
      </div>

      <audio ref={audioRef} crossOrigin="anonymous" style={{ display: 'none' }} />
    </div>
  );
}

export { RadioTab };
