"use client";

import { KeyboardEvent, PointerEvent, useRef, useState } from "react";

type CompassDialProps = {
  headingDegrees: number;
  onHeadingChange: (degrees: number) => void;
  disabled?: boolean;
};

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export default function CompassDial({
  headingDegrees,
  onHeadingChange,
  disabled = false,
}: CompassDialProps) {
  const dialRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function updateHeadingFromPointer(clientX: number, clientY: number): void {
    if (!dialRef.current || disabled) {
      return;
    }

    const rect = dialRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;

    // Prevent jumpy angle changes when pointer is too close to the center pivot.
    const distanceFromCenter = Math.hypot(dx, dy);
    if (distanceFromCenter < 16) {
      return;
    }

    // Angle from "north" (top) increasing clockwise.
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    onHeadingChange(normalizeDegrees(angle));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (disabled) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    updateHeadingFromPointer(event.clientX, event.clientY);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!isDragging || disabled) {
      return;
    }

    updateHeadingFromPointer(event.clientX, event.clientY);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onHeadingChange(normalizeDegrees(headingDegrees - 5));
    }

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onHeadingChange(normalizeDegrees(headingDegrees + 5));
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={dialRef}
        role="slider"
        aria-label="Direction heading"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(headingDegrees)}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative h-44 w-44 touch-none select-none rounded-full border border-emerald-300/40 bg-slate-900/90 shadow-[0_0_40px_rgba(16,185,129,0.2)]"
      >
        <span className="absolute left-1/2 top-2 -translate-x-1/2 text-xs font-semibold text-emerald-200">N</span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-emerald-200">E</span>
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs font-semibold text-emerald-200">S</span>
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-emerald-200">W</span>

        <div className="absolute left-1/2 top-1/2 h-0.5 w-[74%] -translate-x-1/2 -translate-y-1/2 bg-slate-700" />
        <div className="absolute left-1/2 top-1/2 h-[74%] w-0.5 -translate-x-1/2 -translate-y-1/2 bg-slate-700" />

        <svg
          viewBox="0 0 176 176"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          <g transform={`rotate(${headingDegrees} 88 88)`}>
            <line x1="88" y1="88" x2="88" y2="30" stroke="#34d399" strokeWidth="5" strokeLinecap="round" />
            <polygon points="88,18 81,33 95,33" fill="#34d399" />
          </g>
        </svg>
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-200" />
      </div>
      <p className="text-xs text-slate-300">Drag the needle to set direction</p>
    </div>
  );
}
