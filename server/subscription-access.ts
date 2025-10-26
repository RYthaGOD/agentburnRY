// Subscription and free trades access control for AI Trading Bot
// Everyone gets 20 free trades, then pays 0.15 SOL for 2 weeks unlimited access

const FREE_TRADES_LIMIT = 20;

/**
 * Wallets with UNLIMITED FREE ACCESS to AI Trading Bot
 * These wallets bypass all subscription and free trade limits
 */
const UNLIMITED_ACCESS_WALLETS = [
  "924yATAEdnrYmncJMX2je7dpiEfVRqCSPmQ2NK3QfoXA", // Primary unlimited access wallet
];

/**
 * Check if a wallet has unlimited free access (whitelisted)
 */
export function hasUnlimitedAccess(walletAddress: string): boolean {
  return UNLIMITED_ACCESS_WALLETS.includes(walletAddress);
}

/**
 * Check if a user has access to the AI Trading Bot
 * Returns true if:
 * 1. Wallet is whitelisted for unlimited access, OR
 * 2. User has free trades remaining (< 20 trades), OR
 * 3. User has an active, non-expired subscription
 */
export function hasAIBotAccess(
  config: {
    freeTradesUsed: number;
    subscriptionActive: boolean;
    subscriptionExpiresAt: Date | null;
  },
  walletAddress?: string
): boolean {
  // First check if wallet has unlimited access (whitelisted)
  if (walletAddress && hasUnlimitedAccess(walletAddress)) {
    return true;
  }

  // Check if user has free trades remaining
  const hasFreeTradesRemaining = config.freeTradesUsed < FREE_TRADES_LIMIT;
  
  if (hasFreeTradesRemaining) {
    return true;
  }
  
  // Check if user has an active subscription that hasn't expired
  if (config.subscriptionActive && config.subscriptionExpiresAt) {
    const now = new Date();
    const isNotExpired = now < config.subscriptionExpiresAt;
    return isNotExpired;
  }
  
  return false;
}

/**
 * Get the number of free trades remaining for a user
 */
export function getFreeTradesRemaining(freeTradesUsed: number): number {
  return Math.max(0, FREE_TRADES_LIMIT - freeTradesUsed);
}

/**
 * Get a user-friendly access status message
 */
export function getAccessStatusMessage(
  config: {
    freeTradesUsed: number;
    subscriptionActive: boolean;
    subscriptionExpiresAt: Date | null;
  },
  walletAddress?: string
): {
  hasAccess: boolean;
  message: string;
  freeTradesRemaining: number;
} {
  // Check for unlimited access first
  if (walletAddress && hasUnlimitedAccess(walletAddress)) {
    return {
      hasAccess: true,
      message: "Unlimited access (whitelisted)",
      freeTradesRemaining: 999999, // Effectively unlimited
    };
  }

  const freeTradesRemaining = getFreeTradesRemaining(config.freeTradesUsed);
  const hasAccess = hasAIBotAccess(config, walletAddress);
  
  if (freeTradesRemaining > 0) {
    return {
      hasAccess: true,
      message: `${freeTradesRemaining} free trades remaining`,
      freeTradesRemaining,
    };
  }
  
  if (config.subscriptionActive && config.subscriptionExpiresAt) {
    const now = new Date();
    const isNotExpired = now < config.subscriptionExpiresAt;
    
    if (isNotExpired) {
      const daysRemaining = Math.ceil(
        (config.subscriptionExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      return {
        hasAccess: true,
        message: `Subscription active (${daysRemaining} days remaining)`,
        freeTradesRemaining: 0,
      };
    } else {
      return {
        hasAccess: false,
        message: "Subscription expired. Please renew for 0.15 SOL to continue trading.",
        freeTradesRemaining: 0,
      };
    }
  }
  
  return {
    hasAccess: false,
    message: "Free trades used. Pay 0.15 SOL for 2 weeks unlimited access.",
    freeTradesRemaining: 0,
  };
}
