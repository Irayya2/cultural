import React, { useEffect, useState, useRef } from 'react';
import './DevelopedByIru.css';

const AVATAR_URL = '/image.png';

export default function DevelopedByIru({ hideBadge = false }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isShrinking, setIsShrinking] = useState(false);
  const [showBadge, setShowBadge] = useState(true);
  const [imgError, setImgError] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [statusMessage, setStatusMessage] = useState('');
  const [showPhotoModal, setShowPhotoModal] = useState(false);

  const canvasRef = useRef(null);
  const animFrameIdRef = useRef(null);
  const playTimerRef = useRef([]);

  const clearTimers = () => {
    playTimerRef.current.forEach((t) => clearTimeout(t));
    playTimerRef.current = [];
  };

  const runParticleAnimation = (particleColorOverride) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const particleCount = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 50;
    const centerX = width / 2;
    const centerY = height / 2 - 40;

    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.max(width, height) * (0.5 + Math.random() * 0.5);
      const defaultColor = Math.random() > 0.3 ? '#ffd700' : '#00f2fe';
      particles.push({
        x: centerX + Math.cos(angle) * distance,
        y: centerY + Math.sin(angle) * distance,
        targetX: centerX,
        targetY: centerY,
        size: Math.random() * 3 + 1.5,
        color: particleColorOverride || defaultColor,
        alpha: Math.random() * 0.7 + 0.3,
        speed: Math.random() * 0.04 + 0.02,
        progress: 0,
      });
    }

    let startTime = performance.now();
    const animate = (currentTime) => {
      const elapsed = (currentTime - startTime) / 1000;
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p) => {
        p.progress = Math.min(1, p.progress + p.speed);
        const ease = p.progress < 0.5
          ? 4 * p.progress * p.progress * p.progress
          : 1 - Math.pow(-2 * p.progress + 2, 3) / 2;

        const currentX = p.x + (p.targetX - p.x) * ease;
        const currentY = p.y + (p.targetY - p.y) * ease;

        ctx.save();
        ctx.globalAlpha = p.alpha * (1 - ease * 0.4);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(currentX, currentY, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      if (elapsed < 2.8) {
        animFrameIdRef.current = requestAnimationFrame(animate);
      }
    };

    animFrameIdRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  };

  const triggerIntro = (message = '', duration = 3300, particleColor = null) => {
    clearTimers();
    setStatusMessage(message);
    setIsShrinking(false);
    setIsPlaying(true);

    let cleanupParticles;
    const timer1 = setTimeout(() => {
      cleanupParticles = runParticleAnimation(particleColor);
    }, 50);

    const timer2 = setTimeout(() => {
      setIsShrinking(true);
    }, Math.max(1000, duration - 500));

    const timer3 = setTimeout(() => {
      setIsPlaying(false);
      setIsShrinking(false);
      setShowBadge(true);
      if (cleanupParticles) cleanupParticles();
    }, duration);

    playTimerRef.current = [timer1, timer2, timer3];
  };

  useEffect(() => {
    triggerIntro();

    const handleOffline = () => {
      setIsOffline(true);
      triggerIntro('NETWORK DISCONNECTED', 4500, '#ff4757');
    };

    const handleOnline = () => {
      setIsOffline(false);
      triggerIntro('RECONNECTED TO NETWORK', 3300, '#2ed573');
    };

    const handleCustomTrigger = (e) => {
      const msg = e.detail?.message || '';
      triggerIntro(msg);
    };

    const handleOpenPhoto = () => {
      setShowPhotoModal(true);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    window.addEventListener('iru-trigger-intro', handleCustomTrigger);
    window.addEventListener('iru-open-photo', handleOpenPhoto);

    return () => {
      clearTimers();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('iru-trigger-intro', handleCustomTrigger);
      window.removeEventListener('iru-open-photo', handleOpenPhoto);
    };
  }, []);

  return (
    <>
      {/* Fullscreen Credit Intro Overlay */}
      {isPlaying && (
        <div
          id="credit-overlay"
          className={`irucredit-overlay irucredit-active ${isShrinking ? 'irucredit-shrinking' : ''}`}
        >
          <canvas ref={canvasRef} className="irucredit-canvas" />

          <div className="irucredit-content">
            <div
              className="irucredit-avatar-wrapper"
              onClick={(e) => {
                e.stopPropagation();
                setShowPhotoModal(true);
              }}
              title="Click to view full photo"
              style={{ cursor: 'pointer' }}
            >
              <div className={`irucredit-avatar-ring ${isOffline ? 'irucredit-offline-ring' : ''}`} />
              <div className="irucredit-avatar-box">
                {!imgError ? (
                  <img
                    src={AVATAR_URL}
                    alt="Iru Profile"
                    className="irucredit-avatar-img"
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <div className="irucredit-avatar-fallback">I</div>
                )}
              </div>
            </div>

            <div className={`irucredit-subtitle ${isOffline ? 'irucredit-offline-text' : ''}`}>
              {statusMessage || (isOffline ? 'NETWORK DISCONNECTED' : 'DEVELOPED BY')}
            </div>

            {/* Hand-drawn Gold Signature SVG Line */}
            <svg
              className="irucredit-signature-svg"
              viewBox="0 0 200 30"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="irucredit-gold-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={isOffline ? '#ff4757' : '#ffd700'} />
                  <stop offset="50%" stopColor={isOffline ? '#ff6b81' : '#fff3a8'} />
                  <stop offset="100%" stopColor={isOffline ? '#ff4757' : '#00f2fe'} />
                </linearGradient>
              </defs>
              <path
                className="irucredit-signature-path"
                d="M10,20 Q40,5 80,22 T150,12 T190,20"
              />
            </svg>

            <div className={`irucredit-title ${isOffline ? 'irucredit-offline-title' : ''}`}>iru</div>
          </div>
        </div>
      )}

      {/* Persistent Bottom-Right Badge */}
      {showBadge && !hideBadge && (
        <div
          id="credit-badge"
          className={`irucredit-badge ${isOffline ? 'irucredit-badge-offline' : ''}`}
          onClick={() => triggerIntro()}
          title={isOffline ? 'Network Offline - Click to check connection' : 'Developed by iru (Click to replay intro)'}
        >
          <div
            className="irucredit-badge-avatar"
            onClick={(e) => {
              e.stopPropagation();
              setShowPhotoModal(true);
            }}
            title="Click to view full photo"
          >
            {!imgError ? (
              <img
                src={AVATAR_URL}
                alt="Iru"
                className="irucredit-badge-img"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="irucredit-badge-fallback">I</div>
            )}
          </div>
          <div className="irucredit-badge-text">
            {isOffline ? (
              <span className="irucredit-badge-offline-lbl">⚡ Offline</span>
            ) : (
              <>
                Developed by <span className="irucredit-badge-name">iru</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Full-Resolution Developer Photo Lightbox Modal */}
      {showPhotoModal && (
        <div
          className="irucredit-modal-overlay"
          onClick={() => setShowPhotoModal(false)}
        >
          <div
            className="irucredit-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="irucredit-modal-close"
              onClick={() => setShowPhotoModal(false)}
              title="Close"
            >
              ✕
            </button>
            <div className="irucredit-modal-img-wrap">
              <img
                src={AVATAR_URL}
                alt="Full Developer Profile"
                className="irucredit-modal-img"
              />
            </div>
            <div className="irucredit-modal-footer">
              <span className="irucredit-modal-author">Developed by iru</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
