"use client";

type FlapDisplayProps = {
  className?: string;
  chars?: string;
  length: number;
  timing?: number;
  hinge?: boolean;
  value: string;
};

export const Presets = {
  ALPHANUM: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
} as const;

export function FlapDisplay({ className, length, hinge = true, value }: FlapDisplayProps) {
  const safeLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 1;
  const padded = value.padEnd(safeLength, " ").slice(0, safeLength);
  const chars = padded.split("");

  return (
    <div className={`inline-flex items-stretch ${className ?? ""}`.trim()}>
      {chars.map((char, index) => (
        <span key={`${index}-${char}`} className="relative inline-flex items-center justify-center" data-kind="digit">
          {char}
          {hinge ? <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2" data-kind="hinge" /> : null}
        </span>
      ))}
    </div>
  );
}
