import { ACCOUNT_HELP } from "./account";
import { HOME_HELP } from "./home";
import { OPERATING_HELP } from "./operating";
import type { HelpTopic } from "./types";

export { HELP_AREAS, HELP_PATH, helpHref } from "./types";
export type { HelpArea, HelpTopic } from "./types";

/** Every answer in the portal. The help page groups them by `area`. */
export const HELP: readonly HelpTopic[] = [
  ...HOME_HELP,
  ...OPERATING_HELP,
  ...ACCOUNT_HELP,
];
