import React, { useEffect, useRef, useState } from 'react';

interface SplashScreenProps {
  onFinish?: () => void;
  appName?: string;
  tagline?: string;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onFinish,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isExiting, setIsExiting] = useState(false);

  // Trigger completion sequence
  const handleComplete = () => {
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => {
      if (onFinish) onFinish();
    }, 400);
  };

  useEffect(() => {
    // Check for prefers-reduced-motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) {
      const timer = setTimeout(() => {
        handleComplete();
      }, 1000);
      return () => clearTimeout(timer);
    }

    // Hard fallback timeout (in case video stalls or fails to trigger onEnded)
    const fallbackTimer = setTimeout(() => {
      handleComplete();
    }, 12000);

    // Play video
    if (videoRef.current) {
      videoRef.current.play().catch(() => {
        // Autoplay may be restricted in some strict environments, fallback will handle exit
      });
    }

    return () => {
      clearTimeout(fallbackTimer);
    };
  }, []);

  return (
    <div
      onClick={handleComplete}
      className={`fixed inset-0 w-screen h-screen z-[9999] flex items-center justify-center overflow-hidden select-none bg-black cursor-pointer transition-opacity duration-500 ease-out ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      title="Click anywhere to skip"
    >
      <video
        ref={videoRef}
        src="/loading-animation.mp4"
        autoPlay
        playsInline
        muted
        preload="auto"
        onEnded={handleComplete}
        onError={() => handleComplete()}
        className="w-full h-full object-contain md:object-cover bg-black"
      />

      {/* Subtle Skip Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleComplete();
        }}
        className="absolute top-5 right-5 z-10 px-3.5 py-1.5 rounded-full bg-black/40 hover:bg-black/70 text-white/80 hover:text-white text-xs font-medium tracking-wide backdrop-blur-md border border-white/10 transition-all cursor-pointer"
      >
        Skip ✕
      </button>
    </div>
  );
};
