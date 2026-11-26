"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { ServiceImageView, type FallbackPhoto, type ViewPhoto } from "@/components/ServiceImageView";

const AUTO_ADVANCE_MS = 5000;
const controlClass = "grid h-11 w-11 place-items-center rounded-full border border-white/30 bg-ink/80 text-white shadow-sm transition-colors hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function ServicePhotoCarousel({
  photos,
  fallback,
  serviceName,
  priority = false,
}: {
  photos: readonly ViewPhoto[];
  fallback: FallbackPhoto;
  serviceName: string;
  priority?: boolean;
}) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const count = photos.length;
  const activeIndex = index % count;
  const rotating = playing && visible && !hovered;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPlaying(!preference.matches);
    function stopForReducedMotion(event: MediaQueryListEvent) {
      if (event.matches) setPlaying(false);
    }
    preference.addEventListener("change", stopForReducedMotion);
    return () => preference.removeEventListener("change", stopForReducedMotion);
  }, []);

  useEffect(() => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.intersectionRatio >= 0.25);
    }, { threshold: 0.25 });
    observer.observe(carousel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % count), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [rotating, index, count]);

  function step(direction: number) {
    setIndex((current) => (current % count + direction + count) % count);
  }

  return (
    <div
      ref={carouselRef}
      role="group"
      aria-roledescription="carrossel"
      aria-label={`Fotos de ${serviceName}`}
      className="relative aspect-[3/2] overflow-hidden bg-ink"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (event.target.matches(":focus-visible")) setPlaying(false);
      }}
    >
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
        <span aria-hidden="true" className="rounded-full bg-ink/80 px-2.5 py-1 text-xs font-semibold tabular-nums text-white">
          {activeIndex + 1} / {count}
        </span>
        <button
          type="button"
          aria-label={playing ? "Pausar rotação das fotos" : "Reproduzir fotos automaticamente"}
          onClick={() => setPlaying((current) => !current)}
          className={controlClass}
        >
          {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
        </button>
      </div>
      <ServiceImageView
        photo={photos[activeIndex]}
        fallback={fallback}
        sizes="(min-width: 768px) 40vw, 100vw"
        priority={priority && index === 0}
        className="h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2 justify-between">
        <button type="button" aria-label="Foto anterior" onClick={() => step(-1)} className={`pointer-events-auto ${controlClass}`}>
          <ChevronRightIcon className="h-5 w-5 rotate-180" />
        </button>
        <button type="button" aria-label="Próxima foto" onClick={() => step(1)} className={`pointer-events-auto ${controlClass}`}>
          <ChevronRightIcon className="h-5 w-5" />
        </button>
      </div>
      <span className="sr-only" aria-live={rotating ? "off" : "polite"} aria-atomic="true">
        Foto {activeIndex + 1} de {count}
      </span>
    </div>
  );
}
