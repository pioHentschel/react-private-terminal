import React, { useEffect, useRef } from 'react';

// Draws the analyser's frequency data as bars. Renders flat/silent if the
// stream is cross-origin without CORS headers — the browser zeroes out
// analyser data for tainted media even though playback keeps working.
function RadioVisualizer({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext('2d');
    if (!canvas || !ctx2d || !analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    let frameId: number;

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      frameId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);

      const { width, height } = canvas;
      ctx2d.clearRect(0, 0, width, height);

      const barWidth = width / data.length;
      for (let i = 0; i < data.length; i++) {
        const barHeight = (data[i] / 255) * height;
        ctx2d.fillStyle = 'rgba(56, 255, 110, 0.85)';
        ctx2d.fillRect(i * barWidth, height - barHeight, barWidth - 1, barHeight);
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };
  }, [analyser]);

  return <canvas ref={canvasRef} className="radio-visualizer" />;
}

export { RadioVisualizer };
