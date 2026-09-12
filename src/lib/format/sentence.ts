/**
 * An API refusal, as a sentence a screen can print.
 *
 * yuvoy-api writes its messages to be shown — "you already have five
 * photographs — remove one first" — and starts them in lower case, because
 * the same strings go into its logs. A screen's sentences start with a capital
 * and end with a stop. The words are left exactly as the API chose them.
 */
import { dedash } from "./dedash";

export function sentence(text: string): string {
  const trimmed = dedash(text).trim();
  if (!trimmed) return "";
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
