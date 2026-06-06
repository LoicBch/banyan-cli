import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's standard className helper: merge clsx + tailwind-merge so
 *  later classes can override earlier ones (e.g. `cn("p-2", props.className)`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
