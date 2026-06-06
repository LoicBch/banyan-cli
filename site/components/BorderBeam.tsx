/**
 * Magic UI-style BorderBeam — a tiny lit dot that orbits the element's
 * border. Pure CSS via offset-path on an SVG rect; no JS animation.
 *
 * Used around the terminal demo to draw the eye without being distracting.
 */
import { cn } from "@/lib/utils";

interface BorderBeamProps {
  className?: string;
  /** Animation duration in seconds. */
  duration?: number;
  /** Beam length in px. */
  size?: number;
  /** Phase offset for syncing two beams on opposite sides. */
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
}

export function BorderBeam({
  className,
  duration = 8,
  size = 200,
  delay = 0,
  colorFrom = "#34d399",
  colorTo = "#10b981",
}: BorderBeamProps): React.JSX.Element {
  return (
    <div
      style={{
        ["--duration" as string]: duration,
        ["--beam-size" as string]: `${size}px`,
        ["--delay" as string]: `-${delay}s`,
        ["--color-from" as string]: colorFrom,
        ["--color-to" as string]: colorTo,
      } as React.CSSProperties}
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] [border:1px_solid_transparent]",
        "![mask-clip:padding-box,border-box] ![mask-composite:intersect]",
        "[mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]",
        "after:absolute after:aspect-square after:w-[var(--beam-size)]",
        "after:animate-border-beam after:[animation-delay:var(--delay)]",
        "after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)]",
        "after:[offset-anchor:90%_50%]",
        "after:[offset-path:rect(0_auto_auto_0_round_var(--beam-size))]",
        className,
      )}
    />
  );
}
