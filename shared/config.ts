// Treasury wallet for service payments
export const TREASURY_WALLET_ADDRESS = "jawKuQ3xtcYoAuqE9jyG2H35sv2pWJSzsyjoNpsxG38";

// Solana incinerator - official burn address
export const SOLANA_INCINERATOR_ADDRESS = "1nc1nerator11111111111111111111111111111111";

export const PRICING = {
  STARTER: {
    name: "Starter",
    priceSOL: 0.2,
    priceUSDC: 0.2,
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
    priceSOL: 0.2,
    priceUSDC: 0.2,
    features: [
      "Unlimited buyback projects",
      "Hourly & custom schedules",
      "Advanced analytics dashboard",
      "Priority support",
      "Burns via Solana incinerator",
      "Custom burn strategies",
    ],
  },
  ENTERPRISE: {
    name: "Enterprise",
    priceSOL: 0.2,
    priceUSDC: 0.2,
    features: [
      "Everything in Pro",
      "Dedicated account manager",
      "Custom integration support",
      "SLA guarantees",
      "White-label options",
      "Burns via Solana incinerator",
    ],
  },
} as const;
