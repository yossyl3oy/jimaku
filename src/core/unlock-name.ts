// The name of the check that opens a saved sign-in (the passkey's user verification), by OS, so the screens name only
// the one this computer uses. platform is navigator.userAgentData.platform ('Windows', 'macOS', ...) or, where that is
// missing, navigator.platform ('Win32', 'MacIntel', ...). null elsewhere: the screens then say "passkey" in their language.
export const unlockMethodName = (platform = ''): string | null => {
  if (/^win/i.test(platform)) return 'Windows Hello';
  if (/^mac/i.test(platform)) return 'Touch ID';
  return null;
};
