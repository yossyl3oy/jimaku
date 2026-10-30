// The popup's unlock button opens the unlock page with this hash, and the page then starts the passkey prompt by
// itself, so unlocking takes one click. The page stays blank and closes with the prompt, unless it fails for a reason
// other than cancelling. The page drops the hash at once, so a reload, or the tab restored after a browser restart,
// shows its own button instead of prompting unasked.
export const START_HASH = '#start';
