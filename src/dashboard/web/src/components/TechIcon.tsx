/**
 * Renders a tech-stack icon. Uses real brand glyphs (Simple Icons paths
 * inlined as SVGs) so the wizard cards look like actual stacks, not just
 * generic shapes. Falls back to a lucide icon for unknown / compose.
 *
 * Single source of truth: every place that wants to surface a repo's
 * stack — sidebar, stack picker, config card — goes through this.
 */
import * as React from "react";
import { Container, Folder, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

interface TechIconProps {
  tech?: string;
  type?: "git" | "compose";
  className?: string;
  /** Use the brand color instead of inheriting currentColor. Off by
   *  default (icons follow the surrounding text color); on for the
   *  wizard's selected card so the brand stays vivid. */
  branded?: boolean;
}

export function TechIcon({ tech, type, className, branded = false }: TechIconProps): React.JSX.Element {
  if (type === "compose") {
    return <Container className={cn("size-3.5 shrink-0", className)} />;
  }

  const brand = BRAND_ICONS[tech ?? ""];
  if (brand) {
    return (
      <svg
        role="img"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        fill={branded ? brand.color : "currentColor"}
        className={cn("size-3.5 shrink-0", className)}
        aria-label={brand.label}
      >
        <title>{brand.label}</title>
        <path d={brand.path} />
      </svg>
    );
  }

  if (tech === "custom") {
    return <Wrench className={cn("size-3.5 shrink-0", className)} />;
  }
  return <Folder className={cn("size-3.5 shrink-0", className)} />;
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

interface BrandIcon {
  label: string;
  color: string;
  path: string;
}

// Brand glyphs from https://simpleicons.org (CC0). Paths are 24×24 viewBox.
const BRAND_ICONS: Record<string, BrandIcon> = {
  node: {
    label: "Node.js",
    color: "#5FA04E",
    path: "M11.998,24c-0.321,0-0.641-0.084-0.922-0.247l-2.936-1.737c-0.438-0.245-0.224-0.332-0.08-0.383 c0.585-0.203,0.703-0.25,1.328-0.604c0.065-0.037,0.151-0.023,0.218,0.017l2.256,1.339c0.082,0.045,0.197,0.045,0.272,0l8.795-5.076 c0.082-0.047,0.134-0.141,0.134-0.238V6.921c0-0.099-0.053-0.192-0.137-0.242l-8.791-5.072c-0.081-0.047-0.189-0.047-0.271,0 L2.075,6.68C1.99,6.729,1.936,6.825,1.936,6.921v10.15c0,0.097,0.054,0.189,0.139,0.235l2.409,1.392 c1.307,0.654,2.108-0.116,2.108-0.89V7.787c0-0.142,0.114-0.253,0.256-0.253h1.115c0.139,0,0.255,0.112,0.255,0.253v10.021 c0,1.745-0.95,2.745-2.604,2.745c-0.508,0-0.909,0-2.026-0.551L0.28,18.675c-0.57-0.329-0.922-0.945-0.922-1.604V6.921 c0-0.659,0.353-1.275,0.922-1.603l8.795-5.082c0.557-0.315,1.296-0.315,1.848,0l8.794,5.082c0.57,0.329,0.924,0.944,0.924,1.603 v10.15c0,0.659-0.354,1.273-0.924,1.604l-8.794,5.078C12.643,23.916,12.324,24,11.998,24z M19.099,13.993 c0-1.9-1.284-2.406-3.987-2.763c-2.731-0.361-3.009-0.548-3.009-1.187c0-0.528,0.235-1.233,2.258-1.233 c1.807,0,2.473,0.389,2.747,1.607c0.024,0.115,0.129,0.199,0.247,0.199h1.141c0.071,0,0.138-0.031,0.186-0.081 c0.048-0.054,0.074-0.123,0.067-0.196c-0.177-2.098-1.571-3.076-4.388-3.076c-2.508,0-4.004,1.058-4.004,2.833 c0,1.925,1.488,2.457,3.895,2.695c2.88,0.282,3.103,0.703,3.103,1.269c0,0.983-0.789,1.402-2.642,1.402 c-2.327,0-2.839-0.584-3.011-1.742c-0.02-0.124-0.126-0.215-0.253-0.215h-1.137c-0.141,0-0.254,0.112-0.254,0.253 c0,1.482,0.806,3.248,4.655,3.248C17.501,17.007,19.099,15.91,19.099,13.993z",
  },
  "spring-boot": {
    label: "Spring Boot",
    color: "#6DB33F",
    path: "M21.854 1.416a10.682 10.682 0 0 1-1.211 2.12A11.998 11.998 0 1 0 3.842 20.953l.444.395a11.967 11.967 0 0 0 7.785 2.872c6.295 0 11.588-4.85 11.969-11.145.295-3.04-.586-6.93-2.186-9.66zM5.51 20.602a1.05 1.05 0 0 1-1.483.111c-.428-.395-.46-1.06-.111-1.488a1.05 1.05 0 0 1 1.482-.111c.46.396.508 1.06.111 1.488zm16.247-3.626c-2.92 3.896-9.152 2.578-13.143 2.768 0 0-.713.046-1.426.158 0 0 .27-.111.618-.238 2.81-.982 4.15-1.172 5.864-2.06 3.246-1.647 6.451-5.275 7.116-9.025-1.235 3.626-4.99 6.738-8.41 8.012-2.35.866-6.595 1.71-6.595 1.71l-.174-.094c-2.872-1.394-2.967-7.624 2.27-9.628 2.286-.871 4.482-.396 6.96-.998 2.65-.633 5.708-2.642 6.96-5.254 1.395 4.165 3.064 10.713-.046 14.65z",
  },
  android: {
    label: "Android",
    color: "#34A853",
    path: "M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993.0001.5511-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4483.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1521-.5676.416.416 0 00-.5676.1521l-2.0223 3.503C15.5902 8.2439 13.8533 7.8508 12 7.8508s-3.5902.3931-5.1367 1.0729L4.841 5.4207a.4161.4161 0 00-.5677-.1521.4157.4157 0 00-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.761h24c-.3435-4.1021-2.6892-7.5743-6.1185-9.4396",
  },
  django: {
    label: "Django",
    color: "#0C4B33",
    path: "M11.146 0h3.924v18.166c-2.013.382-3.491.535-5.096.535-4.791 0-7.288-2.166-7.288-6.32 0-4.002 2.65-6.601 6.753-6.601.637 0 1.121.05 1.707.203zm0 9.143a3.894 3.894 0 00-1.325-.204c-1.988 0-3.134 1.223-3.134 3.365 0 2.09 1.096 3.236 3.109 3.236.433 0 .79-.025 1.35-.102zM21.314 6.06v9.098c0 3.134-.229 4.638-.917 5.937-.637 1.249-1.478 2.039-3.211 2.905l-3.644-1.733c1.733-.815 2.574-1.529 3.109-2.625.561-1.121.739-2.421.739-5.835V6.06zM17.39.025h3.924v4.026H17.39z",
  },
};
