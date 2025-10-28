// AI-powered trading analysis service for PumpFun tokens
// Supports both Groq (free, Llama 3) and xAI Grok (paid)

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

/**
 * 🔄 4-TEAM ROTATION SYSTEM (3 models per team, 6-hour shifts)
 * Reduces API costs by 75% while maintaining 24/7 coverage with hivemind consensus
 * Auto-replaces failing models with healthy backups
 */
interface TeamConfig {
  name: string;
  providers: string[];
  votingWeights: Record<string, number>; // Provider-specific voting weights
  startHour: number; // UTC hour when team becomes active (0-23)
  endHour: number; // UTC hour when team becomes inactive (0-23)
}

const AI_TEAMS: TeamConfig[] = [
  {
    name: "Team A (Night Shift)",
    providers: ["DeepSeek", "OpenAI", "Cerebras"],
    votingWeights: { "DeepSeek": 1.2, "OpenAI": 1.3, "Cerebras": 1.0 },
    startHour: 0, // Midnight UTC
    endHour: 6,
  },
  {
    name: "Team B (Morning Shift)",
    providers: ["DeepSeek #2", "OpenAI #2", "Google Gemini"],
    votingWeights: { "DeepSeek #2": 1.2, "OpenAI #2": 1.3, "Google Gemini": 1.0 },
    startHour: 6,
    endHour: 12,
  },
  {
    name: "Team C (Afternoon Shift)",
    providers: ["Anthropic Claude", "Together AI", "Groq"],
    votingWeights: { "Anthropic Claude": 1.2, "Together AI": 1.1, "Groq": 1.0 },
    startHour: 12,
    endHour: 18,
  },
  {
    name: "Team D (Evening Shift)",
    providers: ["OpenRouter", "ChatAnywhere", "xAI Grok"],
    votingWeights: { "OpenRouter": 1.1, "ChatAnywhere": 1.0, "xAI Grok": 1.0 },
    startHour: 18,
    endHour: 24,
  },
];

/**
 * Get currently active team based on UTC hour
 */
function getActiveTeam(): TeamConfig {
  const utcHour = new Date().getUTCHours();
  
  for (const team of AI_TEAMS) {
    if (utcHour >= team.startHour && utcHour < team.endHour) {
      return team;
    }
  }
  
  // Fallback to Team A (should never happen)
  return AI_TEAMS[0];
}

/**
 * Get voting weight for a provider based on active team
 */
function getProviderVotingWeight(provider: string): number {
  const activeTeam = getActiveTeam();
  return activeTeam.votingWeights[provider] || 1.0; // Default 1.0x if not specified
}

/**
 * Get all providers from all teams (for backup/replacement pool)
 */
function getAllTeamProviders(): string[] {
  const allProviders = new Set<string>();
  for (const team of AI_TEAMS) {
    team.providers.forEach(p => allProviders.add(p));
  }
  return Array.from(allProviders);
}

/**
 * Auto-replace failing team member with healthiest backup from inactive teams
 * Returns replacement provider name or null if no healthy backup available
 */
function findHealthyReplacement(failedProvider: string): string | null {
  const activeTeam = getActiveTeam();
  const activeProviders = new Set(activeTeam.providers);
  const allProviders = getAllTeamProviders();
  
  // Get inactive providers (not in current team)
  const inactiveProviders = allProviders.filter(p => !activeProviders.has(p) && p !== failedProvider);
  
  // Find healthiest inactive provider (lowest failure count, not disabled)
  let bestReplacement: string | null = null;
  let bestHealth = -1;
  
  for (const provider of inactiveProviders) {
    if (!isModelAvailable(provider)) continue; // Skip if disabled by circuit breaker
    
    const health = getModelHealthScore(provider);
    if (health > bestHealth) {
      bestHealth = health;
      bestReplacement = provider;
    }
  }
  
  if (bestReplacement) {
    console.log(`[Team Rotation] 🔄 Auto-replacing failed model ${failedProvider} with healthy backup ${bestReplacement} (health: ${bestHealth})`);
  }
  
  return bestReplacement;
}

/**
 * Circuit Breaker for AI Models - Tracks failures and temporarily disables failing models
 * OPTIMIZATION: Prevents wasted API calls to consistently failing models
 */
interface ModelHealth {
  provider: string;
  failures: number;
  lastFailure: number;
  disabled: boolean;
  disabledUntil?: number;
}

const modelHealthTracker = new Map<string, ModelHealth>();
const CIRCUIT_BREAKER_THRESHOLD = 3; // Disable after 3 consecutive failures
const CIRCUIT_BREAKER_COOLDOWN = 5 * 60 * 1000; // Re-enable after 5 minutes

/**
 * Universal Rate Limiter for All AI Providers
 * Prevents 429 errors with per-provider request queuing and rate limiting
 */
interface RateLimiter {
  lastRequestTime: number;
  minDelayMs: number;
  queue: Promise<void>;
  requestCount: number;
  resetTime: number;
}

const rateLimiters = new Map<string, RateLimiter>();

/**
 * Initialize rate limiter for a provider with appropriate delays
 */
function getRateLimiter(provider: string): RateLimiter {
  if (!rateLimiters.has(provider)) {
    // Provider-specific rate limits (conservative to avoid 429 errors)
    let minDelay = 1000; // Default 1 second
    
    switch (provider) {
      case "Cerebras":
        minDelay = 3000; // 3 seconds (very strict for Cerebras)
        break;
      case "Google Gemini":
        minDelay = 2000; // 2 seconds (generous free tier but can hit limits)
        break;
      case "ChatAnywhere":
        minDelay = 5000; // 5 seconds (200 requests/day limit = ~12 requests/hour)
        break;
      case "Groq":
        minDelay = 1500; // 1.5 seconds (generous limits)
        break;
      case "Together AI":
        minDelay = 1500; // 1.5 seconds
        break;
      case "OpenRouter":
        minDelay = 1000; // 1 second
        break;
      case "DeepSeek":
      case "DeepSeek #2":
        minDelay = 2000; // 2 seconds
        break;
      case "OpenAI":
      case "OpenAI #2":
        minDelay = 1000; // 1 second (paid tier)
        break;
      case "xAI Grok":
        minDelay = 2000; // 2 seconds (expensive, use sparingly)
        break;
      case "Anthropic Claude":
        minDelay = 1000; // 1 second (paid tier, high quality)
        break;
    }
    
    rateLimiters.set(provider, {
      lastRequestTime: 0,
      minDelayMs: minDelay,
      queue: Promise.resolve(),
      requestCount: 0,
      resetTime: Date.now() + 60000, // Reset counter every minute
    });
  }
  
  return rateLimiters.get(provider)!;
}

/**
 * Acquire rate limit lock for any provider - ensures rate limits are respected
 * Returns a promise that resolves when it's safe to make a request
 */
async function acquireRateLimitLock(provider: string): Promise<void> {
  const limiter = getRateLimiter(provider);
  
  // Chain onto the existing queue
  const currentQueue = limiter.queue;
  
  // Create a new promise for the next waiter
  let releaseNext: () => void;
  limiter.queue = new Promise(resolve => {
    releaseNext = resolve;
  });
  
  // Wait for our turn
  await currentQueue;
  
  // Reset request count if minute has passed
  const now = Date.now();
  if (now > limiter.resetTime) {
    limiter.requestCount = 0;
    limiter.resetTime = now + 60000;
  }
  
  // Calculate wait time based on last request
  const timeSinceLastRequest = now - limiter.lastRequestTime;
  const waitTime = Math.max(0, limiter.minDelayMs - timeSinceLastRequest);
  
  if (waitTime > 0) {
    console.log(`[Rate Limiter] ${provider}: Waiting ${waitTime}ms to respect rate limits`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  // Record this request
  limiter.lastRequestTime = Date.now();
  limiter.requestCount++;
  
  // Release the next waiter
  releaseNext!();
}

/**
 * Exponential backoff retry logic for rate limit errors (429)
 * Retries up to 3 times with increasing delays: 2s, 4s, 8s
 */
async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  provider: string,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if this is a rate limit error (429)
      const isRateLimit = error?.status === 429 || 
                         error?.message?.includes('429') ||
                         error?.message?.includes('rate limit') ||
                         error?.message?.includes('Too many requests');
      
      if (!isRateLimit || attempt === maxRetries - 1) {
        // Not a rate limit error, or last attempt - throw immediately
        throw error;
      }
      
      // Exponential backoff: 2s, 4s, 8s
      const backoffDelay = Math.pow(2, attempt + 1) * 1000;
      console.warn(`[Retry] ${provider} rate limited (429). Attempt ${attempt + 1}/${maxRetries}. Retrying in ${backoffDelay}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
  }
  
  // Should never reach here, but TypeScript requires it
  throw lastError || new Error(`${provider} failed after ${maxRetries} retries`);
}

/**
 * Track AI model failure and implement circuit breaker
 * Handles different error types appropriately:
 * - 402/401 (no credits): Disable for 30 minutes
 * - 429 (rate limit): Don't count as failure, handled by retry logic
 * - Other errors: Count toward circuit breaker threshold
 */
function trackModelFailure(provider: string, error?: Error | string): void {
  const errorMsg = error instanceof Error ? error.message : String(error || '');
  
  // Check if this is a rate limit error (429) - don't circuit break on rate limits
  const isRateLimit = errorMsg.includes('429') || 
                     errorMsg.includes('rate limit') ||
                     errorMsg.includes('Too many requests');
  
  if (isRateLimit) {
    // Rate limit errors are handled by exponential backoff retry logic
    // Don't count them as failures for circuit breaker
    console.log(`[Circuit Breaker] ${provider} rate limited (429) - handled by retry logic, not circuit breaking`);
    return;
  }
  
  const health = modelHealthTracker.get(provider) || {
    provider,
    failures: 0,
    lastFailure: 0,
    disabled: false,
  };

  health.failures++;
  health.lastFailure = Date.now();

  // Check if this is a permanent failure (insufficient credits/balance)
  const isPermanentFailure = errorMsg.includes('402') || 
                            errorMsg.includes('Insufficient') || 
                            errorMsg.includes('insufficient') ||
                            errorMsg.includes('401') ||
                            errorMsg.includes('Unauthorized');

  if (isPermanentFailure) {
    // Immediately circuit-break on credential/balance errors
    health.disabled = true;
    health.disabledUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN * 6; // 30 minutes for permanent errors
    health.failures = CIRCUIT_BREAKER_THRESHOLD; // Mark as fully failed
    console.warn(`[Circuit Breaker] 🚫 ${provider} IMMEDIATELY disabled (insufficient credits/balance). Will retry in 30 minutes.`);
  } else if (health.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    health.disabled = true;
    health.disabledUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN;
    console.warn(`[Circuit Breaker] ⚠️ ${provider} temporarily disabled after ${health.failures} failures. Will retry in 5 minutes.`);
  }

  modelHealthTracker.set(provider, health);
}

/**
 * Track successful AI model response and reset failure count
 */
function trackModelSuccess(provider: string): void {
  const health = modelHealthTracker.get(provider);
  if (health) {
    health.failures = 0;
    health.disabled = false;
    health.disabledUntil = undefined;
    modelHealthTracker.set(provider, health);
  }
}

/**
 * Check if model is available (not disabled by circuit breaker)
 */
function isModelAvailable(provider: string): boolean {
  const health = modelHealthTracker.get(provider);
  if (!health || !health.disabled) return true;
  
  // Check if cooldown period has expired
  if (health.disabledUntil && Date.now() > health.disabledUntil) {
    health.disabled = false;
    health.failures = 0;
    health.disabledUntil = undefined;
    modelHealthTracker.set(provider, health);
    console.log(`[Circuit Breaker] ✅ ${provider} re-enabled after cooldown`);
    return true;
  }
  
  return false;
}

/**
 * Get health score for a model (0-100, higher = healthier)
 * Used to prioritize working models over recently failed ones
 */
function getModelHealthScore(provider: string): number {
  const health = modelHealthTracker.get(provider);
  if (!health) return 100; // Never used = assume healthy
  if (health.disabled) return 0; // Circuit broken = unusable
  
  // Penalize based on recent failures (even if not circuit broken)
  // 0 failures = 100, 1 failure = 80, 2 failures = 60
  const failurePenalty = health.failures * 20;
  return Math.max(0, 100 - failurePenalty);
}

/**
 * Intelligent OpenAI usage context for cost optimization
 * DeepSeek (5M free tokens) is now the primary model, OpenAI used only when critical
 */
export interface OpenAIUsageContext {
  isPeakHours?: boolean; // Use OpenAI during market hours (9am-5pm UTC)
  isHighConfidence?: boolean; // Potential swing trade (85%+ confidence expected)
  needsTieBreaker?: boolean; // Free models showed disagreement (now DeepSeek handles this)
  forceInclude?: boolean; // Always include OpenAI regardless of context
  forceExclude?: boolean; // Never include OpenAI (e.g., quick monitoring)
  maxModels?: number; // OPTIMIZATION: Limit number of models to use (for quick scans)
}

/**
 * Determine if we should include OpenAI based on smart usage strategy
 * DeepSeek now handles most analysis, OpenAI only for critical high-value opportunities
 */
function shouldIncludeOpenAI(context: OpenAIUsageContext = {}): boolean {
  // Force decisions override everything
  if (context.forceExclude) return false;
  if (context.forceInclude) return true;

  // OPTIMIZED: Use OpenAI only for high-confidence opportunities (85%+ expected)
  // DeepSeek V3's superior reasoning now handles:
  //   - Tie-breaking between free models
  //   - General analysis during non-peak hours
  //   - Position monitoring (DeepSeek-only for efficiency)
  // OpenAI reserved for potential swing trades worth the extra cost
  return !!context.isHighConfidence;
}

/**
 * Check if current time is peak trading hours (9am-5pm UTC)
 */
function isPeakTradingHours(): boolean {
  const now = new Date();
  const hour = now.getUTCHours();
  return hour >= 9 && hour < 17; // 9am-5pm UTC
}

/**
 * Get all available AI clients for hive mind consensus
 * 🔄 TEAM ROTATION SYSTEM: Returns only active team's 3 models (6-hour shifts)
 * Auto-replaces failing team members with healthy backups from inactive teams
 * @param context Optional context to determine smart OpenAI usage and model limits
 */
function getAllAIClients(context: OpenAIUsageContext = {}): Array<{ client: OpenAI; model: string; provider: string; priority: number; votingWeight: number }> {
  const clients = [];
  const includeOpenAI = shouldIncludeOpenAI(context);
  
  // Get active team based on current UTC hour (0-6, 6-12, 12-18, 18-24)
  const activeTeam = getActiveTeam();
  const activeProviders = new Set(activeTeam.providers);
  
  // Track replacements for failed team members
  const replacements = new Map<string, string>();
  
  // Check if any active team members are down and need replacement
  for (const provider of activeTeam.providers) {
    if (!isModelAvailable(provider)) {
      const replacement = findHealthyReplacement(provider);
      if (replacement) {
        replacements.set(provider, replacement);
        activeProviders.delete(provider);
        activeProviders.add(replacement);
      }
    }
  }
  
  console.log(`[Team Rotation] 🔄 Active: ${activeTeam.name} (${activeTeam.startHour}-${activeTeam.endHour} UTC)`);
  console.log(`[Team Rotation] 👥 Team members: ${Array.from(activeProviders).join(", ")}`);
  if (replacements.size > 0) {
    console.log(`[Team Rotation] 🔄 Replacements: ${Array.from(replacements.entries()).map(([failed, backup]) => `${failed}→${backup}`).join(", ")}`);
  }

  // PRIORITY SYSTEM: Higher priority = more reliable/cheaper
  // Priority 1: Free, reliable models (use first)
  // Priority 2: Free, less reliable models
  // Priority 3: Paid models (OpenAI - use when needed)
  // Priority 4: Most expensive models (xAI Grok - use as last resort only)

  // Cerebras (fast, free, Llama 4) - Priority 2 (less reliable, rate limited)
  // NOTE: Rate limiting handled at execution level, not selection level
  if (activeProviders.has("Cerebras") && process.env.CEREBRAS_API_KEY && isModelAvailable("Cerebras")) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.cerebras.ai/v1",
        apiKey: process.env.CEREBRAS_API_KEY,
      }),
      model: "llama-3.3-70b",
      provider: "Cerebras",
      priority: 2,
      votingWeight: getProviderVotingWeight("Cerebras"),
    });
  }

  // Google Gemini 2.5 Flash (1M tokens/min free, highest volume) - Priority 2 (rate limits)
  if (activeProviders.has("Google Gemini") && process.env.GOOGLE_AI_KEY && isModelAvailable("Google Gemini")) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        apiKey: process.env.GOOGLE_AI_KEY,
      }),
      model: "gemini-2.0-flash-exp",
      provider: "Google Gemini",
      priority: 2,
      votingWeight: getProviderVotingWeight("Google Gemini"),
    });
  }

  // DeepSeek V3 Primary (5M free tokens, PRIMARY MODEL) - Priority 1 (most reliable free)
  if (activeProviders.has("DeepSeek") && process.env.DEEPSEEK_API_KEY && isModelAvailable("DeepSeek")) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.deepseek.com",
        apiKey: process.env.DEEPSEEK_API_KEY,
      }),
      model: "deepseek-chat",
      provider: "DeepSeek",
      priority: 1,
      votingWeight: getProviderVotingWeight("DeepSeek"),
    });
  }

  // DeepSeek V3 Backup (5M free tokens) - Priority 1 (most reliable free)
  if (activeProviders.has("DeepSeek #2") && process.env.DEEPSEEK_API_KEY_2 && isModelAvailable("DeepSeek #2")) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.deepseek.com",
        apiKey: process.env.DEEPSEEK_API_KEY_2,
      }),
      model: "deepseek-chat",
      provider: "DeepSeek #2",
      priority: 1,
      votingWeight: getProviderVotingWeight("DeepSeek #2"),
    });
  }

  // ChatAnywhere GPT-4o-mini (200 req/day free) - Priority 2 (daily limits)
  if (activeProviders.has("ChatAnywhere") && process.env.CHATANYWHERE_API_KEY && isModelAvailable("ChatAnywhere")) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.chatanywhere.tech/v1",
        apiKey: process.env.CHATANYWHERE_API_KEY,
      }),
      model: "gpt-4o-mini",
      provider: "ChatAnywhere",
      priority: 2,
      votingWeight: getProviderVotingWeight("ChatAnywhere"),
    });
  }

  // Together AI (200+ models, generous free tier) - Priority 1 (very reliable)
  if (activeProviders.has("Together AI") && process.env.TOGETHER_API_KEY && isModelAvailable("Together AI")) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.together.xyz/v1",
        apiKey: process.env.TOGETHER_API_KEY,
      }),
      model: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      provider: "Together AI",
      priority: 1,
      votingWeight: getProviderVotingWeight("Together AI"),
    });
  }

  // OpenRouter (300+ models, free tier) - Priority 1 (very reliable)
  if (activeProviders.has("OpenRouter") && process.env.OPENROUTER_API_KEY && isModelAvailable("OpenRouter")) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      }),
      model: "meta-llama/llama-3.3-70b-instruct",
      provider: "OpenRouter",
      priority: 1,
      votingWeight: getProviderVotingWeight("OpenRouter"),
    });
  }

  // Groq (completely free with generous limits) - Priority 1 (very reliable)
  if (activeProviders.has("Groq") && process.env.GROQ_API_KEY && isModelAvailable("Groq")) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }),
      model: "llama-3.3-70b-versatile",
      provider: "Groq",
      priority: 1,
      votingWeight: getProviderVotingWeight("Groq"),
    });
  }

  // OpenAI Primary (GPT-4o-mini, high quality, PAID) - Priority 3 (use sparingly)
  if (activeProviders.has("OpenAI") && includeOpenAI && process.env.OPENAI_API_KEY && isModelAvailable("OpenAI")) {
    clients.push({
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      }),
      model: "gpt-4o-mini",
      provider: "OpenAI",
      priority: 3,
      votingWeight: getProviderVotingWeight("OpenAI"),
    });
  }
  
  // OpenAI Backup (GPT-4o-mini, PAID) - Priority 3 (use sparingly)
  if (activeProviders.has("OpenAI #2") && includeOpenAI && process.env.OPENAI_API_KEY_2 && isModelAvailable("OpenAI #2")) {
    clients.push({
      client: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY_2,
      }),
      model: "gpt-4o-mini",
      provider: "OpenAI #2",
      priority: 3,
      votingWeight: getProviderVotingWeight("OpenAI #2"),
    });
  }
  
  // Anthropic Claude Sonnet 4 (PAID, highest quality reasoning) - Priority 3 (premium tier)
  // Note: Anthropic doesn't use OpenAI-compatible API, handled separately in analyzeSingleModel
  if (activeProviders.has("Anthropic Claude") && includeOpenAI && process.env.ANTHROPIC_API_KEY && isModelAvailable("Anthropic Claude")) {
    clients.push({
      client: new OpenAI({ apiKey: "anthropic-placeholder" }), // Placeholder, actual client created in analyzeSingleModel
      model: "claude-sonnet-4-20250514",
      provider: "Anthropic Claude",
      priority: 3,
      votingWeight: getProviderVotingWeight("Anthropic Claude"),
    });
  }
  
  // Fallback to xAI Grok (MOST EXPENSIVE - PAID) - Priority 4 (use as LAST RESORT only)
  if (activeProviders.has("xAI Grok") && process.env.XAI_API_KEY && isModelAvailable("xAI Grok")) {
    clients.push({
      client: new OpenAI({
        baseURL: "https://api.x.ai/v1",
        apiKey: process.env.XAI_API_KEY,
      }),
      model: "grok-4-fast-reasoning",
      provider: "xAI Grok",
      priority: 4, // LOWEST PRIORITY - most expensive, only use when all others fail
      votingWeight: getProviderVotingWeight("xAI Grok"),
    });
  }

  // INTELLIGENT SORTING: Combine priority and health score for optimal selection
  // Priority 1 (free/reliable) > Priority 2 (rate limited) > Priority 3 (paid) > Priority 4 (most expensive)
  // Within same priority, prefer healthier models (fewer recent failures)
  clients.sort((a, b) => {
    // First, sort by priority (1 is highest priority)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    
    // If same priority, sort by health score (100 = healthiest)
    const healthA = getModelHealthScore(a.provider);
    const healthB = getModelHealthScore(b.provider);
    return healthB - healthA; // Higher health first
  });
  
  // INTELLIGENT MODEL SELECTION: Ensure we get requested number of WORKING models
  // Filter out models with health below 70 (models with 2+ recent failures)
  const MINIMUM_HEALTH_THRESHOLD = 70;
  
  if (context.maxModels && context.maxModels > 0) {
    const availableModels = clients.filter(c => {
      const isAvailable = isModelAvailable(c.provider);
      const health = getModelHealthScore(c.provider);
      const meetsThreshold = health >= MINIMUM_HEALTH_THRESHOLD;
      
      if (isAvailable && !meetsThreshold) {
        console.log(`[AI Optimization] ⏭️ Skipping ${c.provider} (health: ${health}, below threshold of ${MINIMUM_HEALTH_THRESHOLD})`);
      }
      
      return isAvailable && meetsThreshold;
    });
    const requestedCount = context.maxModels;
    
    if (availableModels.length < requestedCount) {
      console.warn(`[AI Optimization] ⚠️ Requested ${requestedCount} models but only ${availableModels.length} available (some circuit-broken or degraded)`);
      console.log(`[AI Optimization] Using all ${availableModels.length} available healthy models: ${availableModels.map(c => c.provider).join(", ")}`);
      return availableModels;
    }
    
    const selected = availableModels.slice(0, requestedCount);
    const healthScores = selected.map(c => `${c.provider}(health:${getModelHealthScore(c.provider)})`);
    console.log(`[AI Optimization] Selected ${requestedCount} highest-priority healthy models: ${healthScores.join(", ")}`);
    return selected;
  }

  // For non-maxModels requests, still filter by health threshold
  const healthyModels = clients.filter(c => {
    const health = getModelHealthScore(c.provider);
    return health >= MINIMUM_HEALTH_THRESHOLD;
  });
  
  if (healthyModels.length < clients.length) {
    const skipped = clients.filter(c => getModelHealthScore(c.provider) < MINIMUM_HEALTH_THRESHOLD);
    console.log(`[AI Optimization] ⏭️ Skipped ${skipped.length} degraded models: ${skipped.map(c => `${c.provider}(health:${getModelHealthScore(c.provider)})`).join(", ")}`);
  }

  return healthyModels;
}

/**
 * Initialize AI client - Single provider fallback (used for position monitoring)
 */
export function getAIClient(): { client: OpenAI; model: string; provider: string } {
  const clients = getAllAIClients();
  
  if (clients.length === 0) {
    throw new Error("No AI API key configured. Set CEREBRAS_API_KEY, GOOGLE_AI_KEY, DEEPSEEK_API_KEY, CHATANYWHERE_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, OPENAI_API_KEY_2, or XAI_API_KEY");
  }

  // Return first available
  return clients[0];
}

// Check if any AI provider is configured
export function isGrokConfigured(): boolean {
  return !!(
    process.env.CEREBRAS_API_KEY || 
    process.env.GOOGLE_AI_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.CHATANYWHERE_API_KEY ||
    process.env.TOGETHER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY_2 ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.XAI_API_KEY
  );
}

/**
 * Hive mind consensus: Query multiple AI models and combine their decisions
 * @param context Optional context for smart OpenAI usage optimization
 */
export async function analyzeTokenWithHiveMind(
  tokenData: TokenMarketData,
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number,
  minAgreement: number = 0.5, // Require 50% agreement
  context: OpenAIUsageContext = {}
): Promise<{
  analysis: TradingAnalysis;
  votes: Array<{ provider: string; analysis: TradingAnalysis; success: boolean; error?: string }>;
  consensus: string;
}> {
  // Auto-detect peak hours if not specified
  if (context.isPeakHours === undefined) {
    context.isPeakHours = isPeakTradingHours();
  }

  // FORCE FULL HIVEMIND: Always use all 7 models (including premium OpenAI) for every decision
  const clients = getAllAIClients({ ...context, forceInclude: true });
  
  if (clients.length === 0) {
    throw new Error("No AI providers configured for hive mind");
  }

  const providers = clients.map(c => c.provider).join(", ");
  
  // FULL HIVEMIND: All 7 models used for every decision
  console.log(`[Hive Mind] 🧠 FULL HIVEMIND: All ${clients.length} AI models running in parallel for maximum accuracy`);
  console.log(`[Hive Mind] 📊 Providers: ${providers}`);
  
  // Query all models in parallel with circuit breaker tracking
  const votes = await Promise.all(
    clients.map(async ({ client, model, provider, votingWeight }) => {
      try {
        const analysis = await analyzeSingleModel(
          client,
          model,
          provider,
          tokenData,
          userRiskTolerance,
          budgetPerTrade
        );
        // Track success to reset failure count
        trackModelSuccess(provider);
        return { provider, analysis, success: true, votingWeight };
      } catch (error) {
        // Track failure for circuit breaker (pass error for smart detection)
        trackModelFailure(provider, error instanceof Error ? error : new Error(String(error)));
        console.error(`[Hive Mind] ${provider} failed:`, error instanceof Error ? error.message : String(error));
        return {
          provider,
          analysis: {
            action: "hold" as const,
            confidence: 0,
            reasoning: `${provider} analysis failed`,
            potentialUpsidePercent: 0,
            riskLevel: "high" as const,
            keyFactors: ["Provider error"],
          },
          success: false,
          votingWeight,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  // Filter successful votes (all 7 models already attempted in parallel)
  const successfulVotes = votes.filter(v => v.success);
  const failedVotes = votes.filter(v => !v.success);
  
  if (failedVotes.length > 0) {
    console.warn(`[Hive Mind] ⚠️ ${failedVotes.length}/${votes.length} model(s) failed: ${failedVotes.map(v => v.provider).join(", ")}`);
  }
  
  // If all models failed
  if (successfulVotes.length === 0) {
    throw new Error(`All ${votes.length} AI providers failed to analyze token`);
  }

  console.log(`[Hive Mind] ${successfulVotes.length}/${votes.length} models responded successfully`);

  // Calculate weighted consensus with improved tie-breaking
  const buyVotes = successfulVotes.filter(v => v.analysis.action === "buy");
  const sellVotes = successfulVotes.filter(v => v.analysis.action === "sell");
  const holdVotes = successfulVotes.filter(v => v.analysis.action === "hold");

  // Weight by confidence AND voting weight (confidence * votingWeight for each model)
  // OpenAI (1.3x), DeepSeek/Claude (1.2x), Together/OpenRouter (1.1x), others (1.0x)
  const buyWeight = buyVotes.reduce((sum, v) => sum + (v.analysis.confidence * v.votingWeight), 0);
  const sellWeight = sellVotes.reduce((sum, v) => sum + (v.analysis.confidence * v.votingWeight), 0);
  const holdWeight = holdVotes.reduce((sum, v) => sum + (v.analysis.confidence * v.votingWeight), 0);
  
  console.log(`[Hive Mind] 📊 Weighted voting: BUY=${buyWeight.toFixed(2)}, SELL=${sellWeight.toFixed(2)}, HOLD=${holdWeight.toFixed(2)}`);

  const totalWeight = buyWeight + sellWeight + holdWeight;
  
  // Calculate average confidence for each action (for smarter consensus)
  const buyAvgConfidence = buyVotes.length > 0 ? buyWeight / buyVotes.length : 0;
  const sellAvgConfidence = sellVotes.length > 0 ? sellWeight / sellVotes.length : 0;
  const holdAvgConfidence = holdVotes.length > 0 ? holdWeight / holdVotes.length : 0;
  
  // Determine consensus action using WEIGHTED voting (not just count)
  // This prioritizes high-confidence votes over low-confidence ones
  let consensusAction: "buy" | "sell" | "hold" = "hold";
  let consensusConfidence = 0;
  let consensusDescription = "";

  // Winner is determined by total weight (confidence * vote count)
  const maxWeight = Math.max(buyWeight, sellWeight, holdWeight);
  
  if (buyWeight === maxWeight && buyWeight > 0) {
    const agreementPercent = buyVotes.length / successfulVotes.length;
    // Use average confidence of BUY votes (not diluted by other votes)
    consensusAction = "buy";
    consensusConfidence = buyAvgConfidence;
    consensusDescription = `${buyVotes.length}/${successfulVotes.length} models recommend BUY (${(agreementPercent * 100).toFixed(0)}% agreement, ${(buyAvgConfidence * 100).toFixed(0)}% avg confidence)`;
  } else if (sellWeight === maxWeight && sellWeight > 0) {
    const agreementPercent = sellVotes.length / successfulVotes.length;
    consensusAction = "sell";
    consensusConfidence = sellAvgConfidence;
    consensusDescription = `${sellVotes.length}/${successfulVotes.length} models recommend SELL (${(agreementPercent * 100).toFixed(0)}% agreement, ${(sellAvgConfidence * 100).toFixed(0)}% avg confidence)`;
  } else {
    // HOLD wins or tie between actions
    consensusAction = "hold";
    // For HOLD, use average confidence if we have HOLD votes, otherwise use overall average
    consensusConfidence = holdVotes.length > 0 ? holdAvgConfidence : (totalWeight / successfulVotes.length);
    
    if (buyWeight === sellWeight && buyWeight === holdWeight && buyWeight > 0) {
      // Perfect 3-way tie - use highest individual confidence vote as tiebreaker
      const highestVote = successfulVotes.reduce((max, v) => v.analysis.confidence > max.analysis.confidence ? v : max);
      consensusAction = highestVote.analysis.action;
      consensusConfidence = highestVote.analysis.confidence;
      consensusDescription = `3-way tie - using highest confidence vote (${highestVote.provider}: ${consensusAction.toUpperCase()} ${(consensusConfidence * 100).toFixed(0)}%)`;
    } else if (buyWeight === holdWeight || sellWeight === holdWeight) {
      // 2-way tie - use average of tied actions
      consensusDescription = `Tie (${holdVotes.length}/${successfulVotes.length} HOLD) - average confidence ${(consensusConfidence * 100).toFixed(0)}%`;
    } else {
      consensusDescription = `${holdVotes.length}/${successfulVotes.length} models recommend HOLD (${(holdAvgConfidence * 100).toFixed(0)}% avg confidence)`;
    }
  }

  // Aggregate metrics
  const avgConfidence = successfulVotes.reduce((sum, v) => sum + v.analysis.confidence, 0) / successfulVotes.length;
  const avgUpside = successfulVotes.reduce((sum, v) => sum + v.analysis.potentialUpsidePercent, 0) / successfulVotes.length;
  
  // Collect all key factors (safely handle missing keyFactors)
  const allFactors = new Set<string>();
  successfulVotes.forEach(v => {
    if (v.analysis.keyFactors && Array.isArray(v.analysis.keyFactors)) {
      v.analysis.keyFactors.forEach(f => allFactors.add(f));
    }
  });

  // Determine risk level (use most conservative)
  const riskLevels = successfulVotes.map(v => v.analysis.riskLevel);
  const consensusRisk: "low" | "medium" | "high" = riskLevels.includes("high") ? "high" : 
                                                     riskLevels.includes("medium") ? "medium" : "low";

  const consensusAnalysis: TradingAnalysis = {
    action: consensusAction,
    confidence: consensusConfidence,
    reasoning: `${consensusDescription}. Avg confidence: ${(avgConfidence * 100).toFixed(1)}%. Models: ${votes.map(v => v.provider).join(", ")}`,
    potentialUpsidePercent: avgUpside,
    riskLevel: consensusRisk,
    suggestedBuyAmountSOL: consensusAction === "buy" ? budgetPerTrade : undefined,
    keyFactors: Array.from(allFactors),
  };

  console.log(`[Hive Mind] Consensus: ${consensusAction.toUpperCase()} (confidence: ${(consensusConfidence * 100).toFixed(1)}%)`);
  console.log(`[Hive Mind] ${consensusDescription}`);

  return {
    analysis: consensusAnalysis,
    votes,
    consensus: consensusDescription,
  };
}

/**
 * Analyze token with Anthropic Claude (uses different API than OpenAI)
 */
async function analyzeSingleModelAnthropic(
  model: string,
  provider: string,
  tokenData: TokenMarketData,
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number
): Promise<TradingAnalysis> {
  // Create Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  
  // Calculate additional metrics for deeper analysis
  const safeMarketCap = Math.max(tokenData.marketCapUSD, 0.01);
  const safeVolume = Math.max(tokenData.volumeUSD24h, 0);
  const safeLiquidity = Math.max(tokenData.liquidityUSD || 0, 0);
  
  const volumeToMarketCapRatio = safeVolume / safeMarketCap;
  const liquidityToMarketCapRatio = safeLiquidity / safeMarketCap;
  const priceVolatility = Math.abs(tokenData.priceChange24h || 0);
  const hasRecentMomentum = (tokenData.priceChange1h || 0) > 0 && (tokenData.priceChange24h || 0) > 0;
  
  // Enhanced technical indicators
  const priceChange1h = tokenData.priceChange1h || 0;
  const priceChange24h = tokenData.priceChange24h || 0;
  const priceChange5m = tokenData.priceChange5m || 0;
  
  // Momentum indicators
  const isStrongUptrend = priceChange5m > 0 && priceChange1h > 0 && priceChange24h > 0;
  const isWeakening = priceChange5m < 0 && priceChange1h > 0;
  const isAccelerating = Math.abs(priceChange5m) > Math.abs(priceChange1h / 12);
  
  // Volume analysis
  const volumeTrend = tokenData.volumeChange24h || 0;
  const isVolumeIncreasing = volumeTrend > 10;
  const isHighVolumeBreakout = volumeToMarketCapRatio > 0.2 && isVolumeIncreasing;
  
  // Buy/Sell pressure
  const buyPressure = tokenData.buyPressurePercent || 50;
  const sellPressure = 100 - buyPressure;
  const buyerDominance = buyPressure > 60 ? 'STRONG BUYER CONTROL' : buyPressure > 55 ? 'MODERATE BUYER EDGE' : buyPressure < 40 ? 'SELLER PRESSURE' : 'BALANCED';
  
  // Liquidity depth analysis
  const liquidityDepth = safeLiquidity / safeMarketCap;
  const isLiquidityAdequate = liquidityDepth > 0.1;
  const liquidityRisk = liquidityDepth < 0.05 ? 'HIGH RISK (thin liquidity)' : liquidityDepth < 0.1 ? 'MODERATE' : 'LOW RISK (deep liquidity)';
  
  // Pattern recognition
  const is24hBreakout = priceChange24h > 15 && isVolumeIncreasing;
  const isConsolidation = Math.abs(priceChange1h) < 3 && priceChange24h > -5;
  const isPullback = priceChange1h < -5 && priceChange24h > 10;
  const isReversal = priceChange5m > 5 && priceChange1h < -10;
  const isPumpDumping = priceChange1h > 30 && priceChange5m < -10;
  
  const prompt = `You are a CONSERVATIVE cryptocurrency trading analyst specializing in HIGH-QUALITY token selection for Solana. Your goal is to identify tokens with strong fundamentals and sustainable growth potential through COMPREHENSIVE, IN-DEPTH ANALYSIS.

**COMPREHENSIVE TOKEN DATA:**

**Basic Information:**
- Name: ${tokenData.name} (${tokenData.symbol})
- Mint Address: ${tokenData.mint}
- Current Price: $${tokenData.priceUSD.toFixed(6)} (${tokenData.priceSOL.toFixed(9)} SOL)
${tokenData.description ? `- Description: ${tokenData.description}` : ''}

**Market Metrics:**
- Market Cap: $${tokenData.marketCapUSD.toLocaleString()}
- 24h Trading Volume: $${tokenData.volumeUSD24h.toLocaleString()}
- Volume/Market Cap Ratio: ${(volumeToMarketCapRatio * 100).toFixed(2)}% (${volumeToMarketCapRatio > 0.15 ? 'HIGH activity' : volumeToMarketCapRatio > 0.05 ? 'MODERATE activity' : 'LOW activity'})
- Liquidity: $${(tokenData.liquidityUSD || 0).toLocaleString()}
- Liquidity/Market Cap Ratio: ${(liquidityToMarketCapRatio * 100).toFixed(2)}% (${liquidityToMarketCapRatio > 0.1 ? 'STRONG' : liquidityToMarketCapRatio > 0.05 ? 'ADEQUATE' : 'WEAK'})

**Price Action Analysis:**
- 5m Price Change: ${priceChange5m > 0 ? '+' : ''}${priceChange5m.toFixed(2)}% ${isAccelerating ? '⚡ ACCELERATING' : ''}
- 1h Price Change: ${priceChange1h > 0 ? '+' : ''}${priceChange1h.toFixed(2)}% ${isWeakening ? '⚠️ WEAKENING' : ''}
- 24h Price Change: ${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(2)}%
- Momentum Status: ${isStrongUptrend ? '🚀 STRONG UPTREND (all timeframes positive)' : hasRecentMomentum ? 'POSITIVE momentum' : 'NEUTRAL or NEGATIVE'}
- Price Volatility (24h): ${priceVolatility.toFixed(2)}% (${priceVolatility > 30 ? 'HIGH risk' : priceVolatility > 15 ? 'MODERATE risk' : 'LOW risk'})

**Volume & Liquidity Analysis:**
- Volume Trend (24h): ${volumeTrend > 0 ? '+' : ''}${volumeTrend.toFixed(1)}% ${isVolumeIncreasing ? '📈 INCREASING' : ''}
- Volume/Market Cap: ${(volumeToMarketCapRatio * 100).toFixed(2)}% ${isHighVolumeBreakout ? '🔥 HIGH VOLUME BREAKOUT' : ''}
- Liquidity Depth: ${(liquidityDepth * 100).toFixed(2)}% (${liquidityRisk})
- Liquidity/Market Cap: ${(liquidityToMarketCapRatio * 100).toFixed(2)}% (${isLiquidityAdequate ? 'ADEQUATE for safe trading' : '⚠️ THIN - slippage risk'})

**Buy/Sell Pressure (Order Flow):**
- Buy Pressure: ${buyPressure.toFixed(1)}% vs Sell: ${sellPressure.toFixed(1)}%
- Order Flow Analysis: ${buyerDominance}
${buyPressure > 65 ? '✅ Strong buying momentum - buyers in control' : buyPressure < 35 ? '❌ Heavy selling pressure - avoid' : '➖ Neutral order flow'}

**Pattern Recognition Signals:**
${is24hBreakout ? '🚀 **24H BREAKOUT PATTERN** - Price +15% with rising volume (bullish continuation)' : ''}
${isConsolidation ? '📊 **CONSOLIDATION PATTERN** - Sideways price action (potential breakout setup)' : ''}
${isPullback ? '💎 **HEALTHY PULLBACK** - Short-term dip in strong uptrend (buying opportunity)' : ''}
${isReversal ? '🔄 **POTENTIAL REVERSAL** - Recent 5m strength after 1h weakness (bottom forming?)' : ''}
${isPumpDumping ? '⚠️ **PUMP & DUMP WARNING** - Rapid rise followed by sharp drop (HIGH RISK)' : ''}
${!is24hBreakout && !isConsolidation && !isPullback && !isReversal && !isPumpDumping ? '➖ No clear pattern identified' : ''}

**Holder & Distribution:**
${tokenData.holderCount ? `- Holder Count: ${tokenData.holderCount.toLocaleString()} (${tokenData.holderCount > 1000 ? 'GOOD distribution' : tokenData.holderCount > 500 ? 'MODERATE distribution' : 'CONCENTRATED holdings - RISK'})` : '- Holder Count: Not available'}

**REQUIRED IN-DEPTH ANALYSIS FRAMEWORK:**

Perform a COMPREHENSIVE evaluation across ALL of these critical dimensions:

1. **FUNDAMENTAL QUALITY ASSESSMENT (40% weight)**
   - Token utility and use case strength
   - Project legitimacy and transparency
   - Development activity and roadmap
   - Community engagement and organic growth
   - Token distribution and concentration risks
   - Liquidity depth and sustainability

2. **TECHNICAL PRICE ACTION & PATTERN ANALYSIS (30% weight)**
   - **Momentum Analysis:** 5m, 1h, 24h price trends and acceleration
   - **Volume Patterns:** Volume trending, breakouts, and volume-price correlation
   - **Chart Patterns:** Breakouts, consolidations, pullbacks, reversals, pump-dumps
   - **Order Flow:** Buy/sell pressure balance and buyer/seller dominance
   - **Support/Resistance:** Key price levels and breakout/breakdown zones
   - **Volatility Analysis:** Price stability and risk assessment
   - **Predictable Patterns:** Identify repeatable setups (e.g., volume breakouts, consolidation breakouts, pullback entries)
   - **Pattern Probability:** Assess likelihood of pattern completion based on historical behavior

3. **MARKET CONDITIONS & TIMING (20% weight)**
   - Market cap position relative to similar tokens
   - Volume/liquidity adequacy for safe entry/exit
   - Current market cycle stage (early, mid, late)
   - Competitive positioning in sector
   - Potential catalysts or upcoming events

4. **RISK EVALUATION (15% weight)**
   - Rug pull indicators (liquidity locks, dev wallets)
   - Holder concentration (whale manipulation risk)
   - Smart contract security (if verifiable)
   - Historical pump-and-dump patterns
   - Exit liquidity availability

**PATTERN-DRIVEN TRADING STRATEGY:**
Leverage PREDICTABLE PATTERNS for high-probability trades:

**Pattern Priority (Trade These Setups):**
1. **Volume Breakout + Consolidation Break:** Price consolidating (flat 1h) then breaks out with 20%+ volume increase
2. **Healthy Pullback in Uptrend:** 24h up 15-30%, 1h down 5-10% (buying the dip), strong buy pressure returns
3. **Reversal with Volume:** After 1h decline, 5m shows strong reversal (+5%) with increasing volume
4. **Strong Uptrend Continuation:** All timeframes (5m, 1h, 24h) positive + volume increasing + buyer dominance >60%

**Avoid These Patterns (High Risk):**
- Pump & Dump: Rapid >30% gain in 1h followed by sharp 5m reversal
- Fading Volume: Price rising but volume declining (weak continuation)
- Seller Dominance: Buy pressure <40% despite price stability
- Thin Liquidity Spikes: Price volatility >30% with liquidity <5% of market cap

**Use ALL Technical Indicators:**
- Combine 3+ timeframes (5m, 1h, 24h) for trend confirmation
- Volume MUST confirm price action (rising price needs rising volume)
- Buy/sell pressure validates momentum direction
- Liquidity depth determines position sizing safety
- Pattern recognition identifies predictable entry/exit points

**Conservative Entry Rules:**
- ONLY recommend BUY at 65%+ confidence when pattern + fundamentals align
- Require 2+ bullish indicators (momentum + volume + order flow)
- Pattern must be clear and historically profitable (breakout, pullback, reversal)
- Always check for counter-signals (pump-dump, fading volume, seller pressure)

**DECISION CRITERIA:**
For BUY recommendation (requires 70%+ confidence):
- Strong fundamentals (utility, team, community)
- Positive technical momentum (rising volume, bullish price action)
- Adequate liquidity (>$8k minimum, preferably >$15k)
- Healthy holder distribution (>500 holders preferred)
- Volume/market cap ratio >5% (indicates active interest)
- Clear upside catalyst or growth narrative
- Low rug pull risk indicators

For HOLD/SELL recommendation:
- Any red flags in fundamentals or technical analysis
- Insufficient liquidity or extreme volatility
- Concentration risks or whale manipulation signs
- Overextended price (already pumped significantly)
- Weakening volume or momentum deterioration

**OUTPUT FORMAT:**
Provide your DETAILED analysis in JSON with these exact fields:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0.0-1.0 (ONLY use 0.70+ for BUY recommendations),
  "reasoning": "comprehensive multi-paragraph analysis covering all 4 dimensions above with specific data points and conclusions",
  "potentialUpsidePercent": number (realistic estimate based on technical analysis and comparable tokens),
  "riskLevel": "low" | "medium" | "high" (based on thorough risk evaluation),
  "suggestedBuyAmountSOL": number (optional, if action is buy),
  "stopLossPercent": number (optional, suggested stop loss level),
  "takeProfitPercent": number (optional, suggested take profit level),
  "keyFactors": ["specific factor 1", "specific factor 2", ...] (list 5-8 specific factors that influenced your decision)
}

Be thorough, analytical, and CONSERVATIVE. Quality analysis over quick decisions.`;

  // Call Anthropic API with exponential backoff
  const response = await retryWithExponentialBackoff(
    async () => {
      return await anthropic.messages.create({
        model: model,
        max_tokens: 2000,
        system: "You are an EXPERT cryptocurrency trading analyst specializing in PATTERN-DRIVEN, HIGH-PROBABILITY trades on Solana. You excel at identifying PREDICTABLE TRADING PATTERNS (breakouts, pullbacks, reversals, consolidations) and combining them with comprehensive technical indicators (momentum, volume, buy/sell pressure, liquidity depth). You analyze ALL available indicators across multiple timeframes (5m, 1h, 24h) to find high-confidence setups. You're data-driven, systematic, and pattern-focused - looking for repeatable setups with strong technical confirmation. Always respond with valid JSON containing detailed pattern and indicator analysis.",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
      });
    },
    provider,
    3
  );

  const analysisText = response.content[0].type === 'text' ? response.content[0].text : '';
  if (!analysisText) {
    throw new Error(`No response from ${provider}`);
  }

  // Strip markdown code blocks if present (Claude sometimes wraps JSON in ```json...```)
  const cleanedText = analysisText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();

  const analysis = JSON.parse(cleanedText) as TradingAnalysis;

  // Validate and enforce constraints
  if (analysis.action === "buy") {
    if (!analysis.suggestedBuyAmountSOL || analysis.suggestedBuyAmountSOL > budgetPerTrade) {
      analysis.suggestedBuyAmountSOL = budgetPerTrade;
    }

    if (analysis.confidence < 0.4) {
      analysis.action = "hold";
      analysis.reasoning += " [Confidence below 40% threshold]";
    }
  }

  return analysis;
}

/**
 * Analyze token with single AI model
 */
async function analyzeSingleModel(
  client: OpenAI,
  model: string,
  provider: string,
  tokenData: TokenMarketData,
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number
): Promise<TradingAnalysis> {
  // Universal rate limiting: Acquire lock for ALL providers to prevent 429 errors
  await acquireRateLimitLock(provider);
  
  // Handle Anthropic Claude separately (doesn't use OpenAI API)
  if (provider === "Anthropic Claude") {
    return await analyzeSingleModelAnthropic(
      model,
      provider,
      tokenData,
      userRiskTolerance,
      budgetPerTrade
    );
  }
  
  // Calculate additional metrics for deeper analysis
  // Add safeguards for zero/near-zero values to prevent Infinity/NaN
  const safeMarketCap = Math.max(tokenData.marketCapUSD, 0.01);
  const safeVolume = Math.max(tokenData.volumeUSD24h, 0);
  const safeLiquidity = Math.max(tokenData.liquidityUSD || 0, 0);
  
  const volumeToMarketCapRatio = safeVolume / safeMarketCap;
  const liquidityToMarketCapRatio = safeLiquidity / safeMarketCap;
  const priceVolatility = Math.abs(tokenData.priceChange24h || 0);
  const hasRecentMomentum = (tokenData.priceChange1h || 0) > 0 && (tokenData.priceChange24h || 0) > 0;
  
  // Enhanced technical indicators
  const priceChange1h = tokenData.priceChange1h || 0;
  const priceChange24h = tokenData.priceChange24h || 0;
  const priceChange5m = tokenData.priceChange5m || 0;
  
  // Momentum indicators
  const isStrongUptrend = priceChange5m > 0 && priceChange1h > 0 && priceChange24h > 0;
  const isWeakening = priceChange5m < 0 && priceChange1h > 0; // Recent reversal
  const isAccelerating = Math.abs(priceChange5m) > Math.abs(priceChange1h / 12); // 5min move > hourly average
  
  // Volume analysis
  const volumeTrend = tokenData.volumeChange24h || 0; // Volume increasing/decreasing
  const isVolumeIncreasing = volumeTrend > 10; // Volume up 10%+
  const isHighVolumeBreakout = volumeToMarketCapRatio > 0.2 && isVolumeIncreasing;
  
  // Buy/Sell pressure (from DexScreener data)
  const buyPressure = tokenData.buyPressurePercent || 50;
  const sellPressure = 100 - buyPressure;
  const buyerDominance = buyPressure > 60 ? 'STRONG BUYER CONTROL' : buyPressure > 55 ? 'MODERATE BUYER EDGE' : buyPressure < 40 ? 'SELLER PRESSURE' : 'BALANCED';
  
  // Liquidity depth analysis
  const liquidityDepth = safeLiquidity / safeMarketCap;
  const isLiquidityAdequate = liquidityDepth > 0.1; // 10%+ liquidity/mcap
  const liquidityRisk = liquidityDepth < 0.05 ? 'HIGH RISK (thin liquidity)' : liquidityDepth < 0.1 ? 'MODERATE' : 'LOW RISK (deep liquidity)';
  
  // Pattern recognition indicators
  const is24hBreakout = priceChange24h > 15 && isVolumeIncreasing;
  const isConsolidation = Math.abs(priceChange1h) < 3 && priceChange24h > -5; // Sideways movement
  const isPullback = priceChange1h < -5 && priceChange24h > 10; // Healthy pullback in uptrend
  const isReversal = priceChange5m > 5 && priceChange1h < -10; // Potential bottom reversal
  const isPumpDumping = priceChange1h > 30 && priceChange5m < -10; // Pump and dump pattern
  
  const prompt = `You are a CONSERVATIVE cryptocurrency trading analyst specializing in HIGH-QUALITY token selection for Solana. Your goal is to identify tokens with strong fundamentals and sustainable growth potential through COMPREHENSIVE, IN-DEPTH ANALYSIS.

**COMPREHENSIVE TOKEN DATA:**

**Basic Information:**
- Name: ${tokenData.name} (${tokenData.symbol})
- Mint Address: ${tokenData.mint}
- Current Price: $${tokenData.priceUSD.toFixed(6)} (${tokenData.priceSOL.toFixed(9)} SOL)
${tokenData.description ? `- Description: ${tokenData.description}` : ''}

**Market Metrics:**
- Market Cap: $${tokenData.marketCapUSD.toLocaleString()}
- 24h Trading Volume: $${tokenData.volumeUSD24h.toLocaleString()}
- Volume/Market Cap Ratio: ${(volumeToMarketCapRatio * 100).toFixed(2)}% (${volumeToMarketCapRatio > 0.15 ? 'HIGH activity' : volumeToMarketCapRatio > 0.05 ? 'MODERATE activity' : 'LOW activity'})
- Liquidity: $${(tokenData.liquidityUSD || 0).toLocaleString()}
- Liquidity/Market Cap Ratio: ${(liquidityToMarketCapRatio * 100).toFixed(2)}% (${liquidityToMarketCapRatio > 0.1 ? 'STRONG' : liquidityToMarketCapRatio > 0.05 ? 'ADEQUATE' : 'WEAK'})

**Price Action Analysis:**
- 5m Price Change: ${priceChange5m > 0 ? '+' : ''}${priceChange5m.toFixed(2)}% ${isAccelerating ? '⚡ ACCELERATING' : ''}
- 1h Price Change: ${priceChange1h > 0 ? '+' : ''}${priceChange1h.toFixed(2)}% ${isWeakening ? '⚠️ WEAKENING' : ''}
- 24h Price Change: ${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(2)}%
- Momentum Status: ${isStrongUptrend ? '🚀 STRONG UPTREND (all timeframes positive)' : hasRecentMomentum ? 'POSITIVE momentum' : 'NEUTRAL or NEGATIVE'}
- Price Volatility (24h): ${priceVolatility.toFixed(2)}% (${priceVolatility > 30 ? 'HIGH risk' : priceVolatility > 15 ? 'MODERATE risk' : 'LOW risk'})

**Volume & Liquidity Analysis:**
- Volume Trend (24h): ${volumeTrend > 0 ? '+' : ''}${volumeTrend.toFixed(1)}% ${isVolumeIncreasing ? '📈 INCREASING' : ''}
- Volume/Market Cap: ${(volumeToMarketCapRatio * 100).toFixed(2)}% ${isHighVolumeBreakout ? '🔥 HIGH VOLUME BREAKOUT' : ''}
- Liquidity Depth: ${(liquidityDepth * 100).toFixed(2)}% (${liquidityRisk})
- Liquidity/Market Cap: ${(liquidityToMarketCapRatio * 100).toFixed(2)}% (${isLiquidityAdequate ? 'ADEQUATE for safe trading' : '⚠️ THIN - slippage risk'})

**Buy/Sell Pressure (Order Flow):**
- Buy Pressure: ${buyPressure.toFixed(1)}% vs Sell: ${sellPressure.toFixed(1)}%
- Order Flow Analysis: ${buyerDominance}
${buyPressure > 65 ? '✅ Strong buying momentum - buyers in control' : buyPressure < 35 ? '❌ Heavy selling pressure - avoid' : '➖ Neutral order flow'}

**Pattern Recognition Signals:**
${is24hBreakout ? '🚀 **24H BREAKOUT PATTERN** - Price +15% with rising volume (bullish continuation)' : ''}
${isConsolidation ? '📊 **CONSOLIDATION PATTERN** - Sideways price action (potential breakout setup)' : ''}
${isPullback ? '💎 **HEALTHY PULLBACK** - Short-term dip in strong uptrend (buying opportunity)' : ''}
${isReversal ? '🔄 **POTENTIAL REVERSAL** - Recent 5m strength after 1h weakness (bottom forming?)' : ''}
${isPumpDumping ? '⚠️ **PUMP & DUMP WARNING** - Rapid rise followed by sharp drop (HIGH RISK)' : ''}
${!is24hBreakout && !isConsolidation && !isPullback && !isReversal && !isPumpDumping ? '➖ No clear pattern identified' : ''}

**Holder & Distribution:**
${tokenData.holderCount ? `- Holder Count: ${tokenData.holderCount.toLocaleString()} (${tokenData.holderCount > 1000 ? 'GOOD distribution' : tokenData.holderCount > 500 ? 'MODERATE distribution' : 'CONCENTRATED holdings - RISK'})` : '- Holder Count: Not available'}

**REQUIRED IN-DEPTH ANALYSIS FRAMEWORK:**

Perform a COMPREHENSIVE evaluation across ALL of these critical dimensions:

1. **FUNDAMENTAL QUALITY ASSESSMENT (40% weight)**
   - Token utility and use case strength
   - Project legitimacy and transparency
   - Development activity and roadmap
   - Community engagement and organic growth
   - Token distribution and concentration risks
   - Liquidity depth and sustainability

2. **TECHNICAL PRICE ACTION & PATTERN ANALYSIS (30% weight)**
   - **Momentum Analysis:** 5m, 1h, 24h price trends and acceleration
   - **Volume Patterns:** Volume trending, breakouts, and volume-price correlation
   - **Chart Patterns:** Breakouts, consolidations, pullbacks, reversals, pump-dumps
   - **Order Flow:** Buy/sell pressure balance and buyer/seller dominance
   - **Support/Resistance:** Key price levels and breakout/breakdown zones
   - **Volatility Analysis:** Price stability and risk assessment
   - **Predictable Patterns:** Identify repeatable setups (e.g., volume breakouts, consolidation breakouts, pullback entries)
   - **Pattern Probability:** Assess likelihood of pattern completion based on historical behavior

3. **MARKET CONDITIONS & TIMING (20% weight)**
   - Market cap position relative to similar tokens
   - Volume/liquidity adequacy for safe entry/exit
   - Current market cycle stage (early, mid, late)
   - Competitive positioning in sector
   - Potential catalysts or upcoming events

4. **RISK EVALUATION (15% weight)**
   - Rug pull indicators (liquidity locks, dev wallets)
   - Holder concentration (whale manipulation risk)
   - Smart contract security (if verifiable)
   - Historical pump-and-dump patterns
   - Exit liquidity availability

**PATTERN-DRIVEN TRADING STRATEGY:**
Leverage PREDICTABLE PATTERNS for high-probability trades:

**Pattern Priority (Trade These Setups):**
1. **Volume Breakout + Consolidation Break:** Price consolidating (flat 1h) then breaks out with 20%+ volume increase
2. **Healthy Pullback in Uptrend:** 24h up 15-30%, 1h down 5-10% (buying the dip), strong buy pressure returns
3. **Reversal with Volume:** After 1h decline, 5m shows strong reversal (+5%) with increasing volume
4. **Strong Uptrend Continuation:** All timeframes (5m, 1h, 24h) positive + volume increasing + buyer dominance >60%

**Avoid These Patterns (High Risk):**
- Pump & Dump: Rapid >30% gain in 1h followed by sharp 5m reversal
- Fading Volume: Price rising but volume declining (weak continuation)
- Seller Dominance: Buy pressure <40% despite price stability
- Thin Liquidity Spikes: Price volatility >30% with liquidity <5% of market cap

**Use ALL Technical Indicators:**
- Combine 3+ timeframes (5m, 1h, 24h) for trend confirmation
- Volume MUST confirm price action (rising price needs rising volume)
- Buy/sell pressure validates momentum direction
- Liquidity depth determines position sizing safety
- Pattern recognition identifies predictable entry/exit points

**Conservative Entry Rules:**
- ONLY recommend BUY at 65%+ confidence when pattern + fundamentals align
- Require 2+ bullish indicators (momentum + volume + order flow)
- Pattern must be clear and historically profitable (breakout, pullback, reversal)
- Always check for counter-signals (pump-dump, fading volume, seller pressure)

**DECISION CRITERIA:**
For BUY recommendation (requires 70%+ confidence):
- Strong fundamentals (utility, team, community)
- Positive technical momentum (rising volume, bullish price action)
- Adequate liquidity (>$8k minimum, preferably >$15k)
- Healthy holder distribution (>500 holders preferred)
- Volume/market cap ratio >5% (indicates active interest)
- Clear upside catalyst or growth narrative
- Low rug pull risk indicators

For HOLD/SELL recommendation:
- Any red flags in fundamentals or technical analysis
- Insufficient liquidity or extreme volatility
- Concentration risks or whale manipulation signs
- Overextended price (already pumped significantly)
- Weakening volume or momentum deterioration

**OUTPUT FORMAT:**
Provide your DETAILED analysis in JSON with these exact fields:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0.0-1.0 (ONLY use 0.70+ for BUY recommendations),
  "reasoning": "comprehensive multi-paragraph analysis covering all 4 dimensions above with specific data points and conclusions",
  "potentialUpsidePercent": number (realistic estimate based on technical analysis and comparable tokens),
  "riskLevel": "low" | "medium" | "high" (based on thorough risk evaluation),
  "suggestedBuyAmountSOL": number (optional, if action is buy),
  "stopLossPercent": number (optional, suggested stop loss level),
  "takeProfitPercent": number (optional, suggested take profit level),
  "keyFactors": ["specific factor 1", "specific factor 2", ...] (list 5-8 specific factors that influenced your decision)
}

Be thorough, analytical, and CONSERVATIVE. Quality analysis over quick decisions.`;

  // Wrap API call with exponential backoff retry logic for rate limit errors (429)
  const response = await retryWithExponentialBackoff(
    async () => {
      return await client.chat.completions.create({
        model: model,
        messages: [
          {
            role: "system",
            content: "You are an EXPERT cryptocurrency trading analyst specializing in PATTERN-DRIVEN, HIGH-PROBABILITY trades on Solana. You excel at identifying PREDICTABLE TRADING PATTERNS (breakouts, pullbacks, reversals, consolidations) and combining them with comprehensive technical indicators (momentum, volume, buy/sell pressure, liquidity depth). You analyze ALL available indicators across multiple timeframes (5m, 1h, 24h) to find high-confidence setups. You're data-driven, systematic, and pattern-focused - looking for repeatable setups with strong technical confirmation. Always respond with valid JSON containing detailed pattern and indicator analysis.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3, // Lower temperature for more consistent, analytical responses
        max_tokens: 2000, // Increased for more detailed analysis
      });
    },
    provider,
    3 // Max 3 retries with exponential backoff (2s, 4s, 8s)
  );

  const analysisText = response.choices[0].message.content;
  if (!analysisText) {
    throw new Error(`No response from ${provider}`);
  }

  const analysis = JSON.parse(analysisText) as TradingAnalysis;

  // Validate and enforce constraints
  if (analysis.action === "buy") {
    // Adjust suggested amount
    if (!analysis.suggestedBuyAmountSOL || analysis.suggestedBuyAmountSOL > budgetPerTrade) {
      analysis.suggestedBuyAmountSOL = budgetPerTrade;
    }

    // Require minimum confidence (lowered for aggressive trading with 6-model consensus)
    if (analysis.confidence < 0.4) {
      analysis.action = "hold";
      analysis.reasoning += " [Confidence below 40% threshold]";
    }
  }

  return analysis;
}

export interface TokenMarketData {
  mint: string;
  name: string;
  symbol: string;
  priceUSD: number;
  priceSOL: number;
  volumeUSD24h: number;
  marketCapUSD: number;
  holderCount?: number;
  priceChange24h?: number;
  priceChange1h?: number;
  priceChange5m?: number; // 5-minute price change for micro-momentum tracking
  volumeChange24h?: number; // 24-hour volume change percentage
  buyPressurePercent?: number; // Buy pressure percentage (buys / total transactions)
  liquidityUSD?: number;
  createdAt?: Date;
  description?: string;
}

export interface TradingAnalysis {
  action: "buy" | "sell" | "hold";
  confidence: number; // 0-1
  reasoning: string;
  potentialUpsidePercent: number;
  riskLevel: "low" | "medium" | "high";
  suggestedBuyAmountSOL?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  keyFactors: string[];
}

/**
 * Analyze a token using Grok AI
 */
export async function analyzeTokenWithGrok(
  tokenData: TokenMarketData,
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number
): Promise<TradingAnalysis> {
  try {
    const { client, model, provider } = getAIClient();
    console.log(`[AI Analysis] Using ${provider} - Model: ${model}`);
    
    // Build comprehensive prompt for AI analysis
    const prompt = `You are a professional cryptocurrency trading analyst specializing in Solana PumpFun tokens. Analyze the following token and provide a trading recommendation.

**Token Data:**
- Name: ${tokenData.name} (${tokenData.symbol})
- Mint Address: ${tokenData.mint}
- Current Price: $${tokenData.priceUSD.toFixed(6)} (${tokenData.priceSOL.toFixed(9)} SOL)
- 24h Volume: $${tokenData.volumeUSD24h.toLocaleString()}
- Market Cap: $${tokenData.marketCapUSD.toLocaleString()}
${tokenData.holderCount ? `- Holder Count: ${tokenData.holderCount.toLocaleString()}` : ''}
${tokenData.priceChange24h ? `- 24h Price Change: ${tokenData.priceChange24h > 0 ? '+' : ''}${tokenData.priceChange24h.toFixed(2)}%` : ''}
${tokenData.priceChange1h ? `- 1h Price Change: ${tokenData.priceChange1h > 0 ? '+' : ''}${tokenData.priceChange1h.toFixed(2)}%` : ''}
${tokenData.liquidityUSD ? `- Liquidity: $${tokenData.liquidityUSD.toLocaleString()}` : ''}
${tokenData.description ? `- Description: ${tokenData.description}` : ''}

**Trading Parameters:**
- Risk Tolerance: ${userRiskTolerance}
- Max Budget Per Trade: ${budgetPerTrade} SOL
- Trading Platform: PumpFun (Solana)

**Analysis Requirements:**
1. Evaluate volume, market cap, and price momentum
2. Assess liquidity and holder distribution
3. Identify potential red flags (rug pull indicators, low liquidity, suspicious volume)
4. Estimate potential upside and downside
5. Consider market conditions and token age

Provide your analysis in JSON format with these exact fields:
{
  "action": "buy" | "sell" | "hold",
  "confidence": 0.0-1.0,
  "reasoning": "detailed explanation",
  "potentialUpsidePercent": number,
  "riskLevel": "low" | "medium" | "high",
  "suggestedBuyAmountSOL": number (optional, if action is buy),
  "stopLossPercent": number (optional),
  "takeProfitPercent": number (optional),
  "keyFactors": ["factor1", "factor2", ...]
}`;

    console.log(`[Grok AI] Analyzing token ${tokenData.symbol}...`);

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content:
            "You are a professional cryptocurrency trading analyst. Analyze tokens objectively and provide actionable trading recommendations with risk assessments. Always respond with valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1000,
    });

    const analysisText = response.choices[0].message.content;
    if (!analysisText) {
      throw new Error("No response from Grok API");
    }

    const analysis = JSON.parse(analysisText) as TradingAnalysis;

    // Validate and enforce constraints based on risk tolerance
    if (analysis.action === "buy") {
      // CRITICAL: Enforce minimum 1.5X (150%) return requirement
      if (analysis.potentialUpsidePercent < 150) {
        console.log(`[AI Analysis] Rejecting ${tokenData.symbol}: ${analysis.potentialUpsidePercent}% upside < 150% minimum`);
        return {
          action: "hold",
          confidence: 0,
          reasoning: `Rejected: Only ${analysis.potentialUpsidePercent.toFixed(1)}% potential upside. Minimum 150% (1.5X) required for risk management.`,
          potentialUpsidePercent: analysis.potentialUpsidePercent,
          riskLevel: "high",
          keyFactors: ["Below minimum 1.5X return threshold"],
        };
      }

      // Adjust suggested amount based on risk tolerance
      if (!analysis.suggestedBuyAmountSOL || analysis.suggestedBuyAmountSOL > budgetPerTrade) {
        analysis.suggestedBuyAmountSOL = budgetPerTrade;
      }

      // Conservative limits for low risk tolerance
      if (userRiskTolerance === "low") {
        analysis.suggestedBuyAmountSOL = Math.min(
          analysis.suggestedBuyAmountSOL,
          budgetPerTrade * 0.5
        );
        if (analysis.confidence < 0.7) {
          analysis.action = "hold";
          analysis.reasoning += " [Confidence too low for low-risk profile]";
        }
      }

      // Require minimum confidence
      if (analysis.confidence < 0.5) {
        analysis.action = "hold";
        analysis.reasoning += " [Confidence below 50% threshold]";
      }
    }

    console.log(`[Grok AI] Analysis complete: ${analysis.action} (confidence: ${(analysis.confidence * 100).toFixed(1)}%)`);

    return analysis;
  } catch (error) {
    console.error(`[Grok AI] Analysis failed:`, error);

    // Return conservative hold recommendation on error
    return {
      action: "hold",
      confidence: 0,
      reasoning: `Analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      potentialUpsidePercent: 0,
      riskLevel: "high",
      keyFactors: ["Analysis error - defaulting to hold"],
    };
  }
}

/**
 * Batch analyze multiple tokens and rank them by potential
 */
export async function analyzeTokenBatch(
  tokens: TokenMarketData[],
  userRiskTolerance: "low" | "medium" | "high",
  budgetPerTrade: number
): Promise<Array<{ token: TokenMarketData; analysis: TradingAnalysis }>> {
  console.log(`[Grok AI] Batch analyzing ${tokens.length} tokens...`);

  const results = await Promise.all(
    tokens.map(async (token) => ({
      token,
      analysis: await analyzeTokenWithGrok(token, userRiskTolerance, budgetPerTrade),
    }))
  );

  // Sort by confidence * potentialUpside (best opportunities first)
  results.sort((a, b) => {
    const scoreA = a.analysis.confidence * a.analysis.potentialUpsidePercent;
    const scoreB = b.analysis.confidence * b.analysis.potentialUpsidePercent;
    return scoreB - scoreA;
  });

  console.log(
    `[Grok AI] Batch analysis complete: ${results.filter((r) => r.analysis.action === "buy").length} buy signals`
  );

  return results;
}

/**
 * Validate analysis result
 */
export function validateAnalysis(analysis: TradingAnalysis): boolean {
  if (!["buy", "sell", "hold"].includes(analysis.action)) return false;
  if (analysis.confidence < 0 || analysis.confidence > 1) return false;
  if (!analysis.reasoning || analysis.reasoning.length < 10) return false;
  if (!["low", "medium", "high"].includes(analysis.riskLevel)) return false;
  return true;
}
