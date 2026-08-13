import { tipsSheetWithProgress, resetTipsSeen } from "../tips.js";

/**
 * The whole list, for when someone asks what this can do rather than waiting
 * to be told one batch at a time. Needs no API call and no token — it's about
 * the tool, not the account.
 */
export async function tipsCommand({ reset = false } = {}) {
  if (reset) {
    await resetTipsSeen();
    console.log("Tips reset — they'll surface again, one per batch.\n");
  }
  console.log(await tipsSheetWithProgress());
}
