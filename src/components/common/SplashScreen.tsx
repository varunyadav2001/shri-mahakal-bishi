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
    }, 10500);

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
      className={`fixed inset-0 w-screen h-screen z-[9999] flex items-center justify-center overflow-hidden select-none bg-[#07080b] cursor-pointer transition-opacity duration-500 ease-out ${
        isExiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      title="Click anywhere to skip"
    >
      <video
        ref={videoRef}
        src="/loading-animation.mp4"
        poster="/loading-poster.jpg"
        autoPlay
        playsInline
        muted
        onEnded={handleComplete}
        onError={() => handleComplete()}
        className="w-full h-full object-contain md:object-cover bg-[#07080b]"
      />
    </div>
  );
};
