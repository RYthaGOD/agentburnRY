// Treasury wallet for service payments
export const TREASURY_WALLET_ADDRESS = "jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38";

// Solana incinerator - official burn address
export const SOLANA_INCINERATOR_ADDRESS = "1nc1nerator11111111111111111111111111111111";

// Whitelisted wallet addresses with free platform access (no payment required)
export const WHITELISTED_WALLETS = [
  "4D5a61DsihdeEV2SbfkpYsZemTrrczxAwyBfR47xF5uS",  // Owner wallet
  "jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38",  // Treasury wallet
];

export const PRICING = {
  STARTER: {
    name: "Starter",
    priceSOL: 0.2,
    features: [
      "Up to 5 buyback projects",
      "Daily buyback schedules",
      "Basic transaction monitoring",
      "Email support",
      "Burns via Solana incinerator",
    ],
  },
  PRO: {
    name: "Pro",
    priceSOL: 0.4,
    features: [
      "Unlimited buyback projects",
      "Hourly & custom schedules",
      "Advanced analytics dashboard",
      "Priority support",
      "Burns via Solana incinerator",
      "Custom burn strategies",
    ],
  },
} as const;
