import {
  Boxes,
  ChartNoAxesCombined,
  Compass,
  RefreshCw,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { BrandGlyphKind } from "../lib/brand-system";
import { cn } from "../lib/utils";

interface BrandGlyphProps {
  kind: BrandGlyphKind;
  className?: string;
  size?: number;
  label?: string;
}

const glyphs = {
  structure: Boxes,
  guidance: Compass,
  analytics: ChartNoAxesCombined,
  community: UsersRound,
  evolution: RefreshCw,
} as const;

const glyphColors: Record<BrandGlyphKind, string> = {
  structure: "text-brand-slate",
  guidance: "text-brand-slate",
  analytics: "text-brand-slate",
  community: "text-brand-slate",
  evolution: "text-brand-path",
};

const accentColors: Record<BrandGlyphKind, string> = {
  structure: "text-brand-path",
  guidance: "text-brand-ember",
  analytics: "text-brand-ember",
  community: "text-brand-ember",
  evolution: "text-brand-ember",
};

export function BrandGlyph({
  kind,
  className,
  size = 22,
  label,
}: BrandGlyphProps) {
  const Glyph = glyphs[kind];
  const accentSize = Math.max(7, Math.round(size * 0.38));

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Glyph size={size} strokeWidth={1.9} className={glyphColors[kind]} />
      <Sparkles
        size={accentSize}
        strokeWidth={2.4}
        className={cn(
          "absolute -right-[8%] -top-[8%] fill-current",
          accentColors[kind],
        )}
      />
    </span>
  );
}
