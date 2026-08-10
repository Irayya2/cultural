import { useState, useEffect } from 'react';

const BACKGROUND_IMAGES = ['/1.png', '/2.png', '/3.png', '/4.png'];

export default function BackgroundSlider() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % BACKGROUND_IMAGES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-slider-container" aria-hidden="true">
      {BACKGROUND_IMAGES.map((img, i) => (
        <div
          key={img}
          className={`bg-slider-slide ${i === index ? 'active' : ''}`}
          style={{ backgroundImage: `url('${img}')` }}
        />
      ))}
      <div className="bg-slider-overlay" />
    </div>
  );
}
