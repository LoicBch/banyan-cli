/**
 * Maps a banyan tech profile id (from src/dashboard/techProfiles.ts) to a
 * lucide icon. Falls back to a neutral folder when the stack is unknown
 * or the repo is `type: compose`.
 *
 * Used in the sidebar repo rows and (eventually) the Config tab.
 */
import * as React from "react";
import {
  Terminal,
  Coffee,
  Smartphone,
  Layers,
  Container,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TechIconProps {
  tech?: string;
  type?: "git" | "compose";
  className?: string;
}

export function TechIcon({ tech, type, className }: TechIconProps): React.JSX.Element {
  const Icon = pickIcon(tech, type);
  return <Icon className={cn("size-3.5 shrink-0", className)} />;
}

function pickIcon(
  tech: string | undefined,
  type: "git" | "compose" | undefined,
): React.ComponentType<{ className?: string }> {
  if (type === "compose") return Container;
  switch (tech) {
    case "node":
      return Terminal;
    case "spring-boot":
      return Coffee;
    case "android":
      return Smartphone;
    case "django":
      return Layers;
    default:
      return Folder;
  }
}

/** Display label for a tech id. */
export function techLabel(tech: string | undefined, type?: "git" | "compose"): string {
  if (type === "compose") return "compose";
  switch (tech) {
    case "node":
      return "node";
    case "spring-boot":
      return "spring";
    case "android":
      return "android";
    case "django":
      return "django";
    case "custom":
      return "custom";
    default:
      return "";
  }
}
