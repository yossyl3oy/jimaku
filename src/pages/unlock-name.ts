// The unlock method's name on this computer, for the extension's pages: Windows Hello, Touch ID, or "passkey" in the
// browser's language.

import { unlockMethodName } from '../core/unlock-name.ts';
import { t } from '../shared/i18n.ts';

type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

export const unlockName = () => {
  const nav = navigator as NavigatorWithUAData;
  return unlockMethodName(nav.userAgentData?.platform || nav.platform) ?? t('passkey');
};
