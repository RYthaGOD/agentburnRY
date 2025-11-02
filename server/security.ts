// Comprehensive security middleware for BurnBot platform
// User data protection is our #1 priority

import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { storage } from "./storage";

/**
 * Security headers middleware using Helmet
 * Protects against common web vulnerabilities
 */
export function securityHeaders() {
  return helmet({
    // HTTP Strict Transport Security - Forces HTTPS
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    // Prevents clickjacking attacks
    frameguard: {
      action: "deny",
    },
    // Prevents MIME type sniffing
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Required for Vite in dev
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "https:"],
        fontSrc: ["'self'", "data:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    // Prevents DNS prefetching
    dnsPrefetchControl: { allow: false },
    // Hides X-Powered-By header
    hidePoweredBy: true,
    // Prevents IE from executing downloads in site's context
    ieNoOpen: true,
    // Prevents browsers from MIME-sniffing
    noSniff: true,
    // Disables client-side caching
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Prevents XSS attacks
    xssFilter: true,
  });
}

/**
 * Helper function to extract client IP address
 * Handles both direct connections and proxied requests
 */
function getClientIp(req: Request): string {
  // When behind a proxy (production), trust X-Forwarded-For
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    // X-Forwarded-For can be a comma-separated list, take the first IP
    const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(',');
    return ips[0].trim();
  }
  
  // Fallback to req.ip (direct connection or when not behind proxy)
  return req.ip || 'unknown';
}

/**
 * Global rate limiter - Protects against DDoS and brute force attacks
 * 500 requests per 15 minutes per IP (supports real-time polling at 5s intervals)
 */
export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per windowMs (~33 req/min, enough for real-time features)
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Use custom key generator to properly handle proxied requests
  keyGenerator: (req) => getClientIp(req),
  // Skip rate limiting for whitelisted IPs (optional)
  skip: (req) => {
    // Add your whitelisted IPs here if needed
    const whitelist: string[] = [];
    const clientIp = getClientIp(req);
    return whitelist.includes(clientIp);
  },
});

/**
 * Strict rate limiter for sensitive operations
 * 10 requests per 15 minutes per IP
 */
export const strictRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    error: "Too many attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
});

/**
 * Authentication rate limiter for manual operations requiring signatures
 * 20 requests per hour per IP
 */
export const authRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: {
    error: "Too many authentication attempts, please try again in an hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
});

/**
 * Middleware to verify project ownership
 * Ensures users can only access their own projects
 */
export async function verifyProjectOwnership(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const projectId = req.params.id || req.params.projectId;
    const ownerWalletAddress = req.query.wallet || req.body.ownerWalletAddress;

    if (!projectId) {
      return res.status(400).json({ message: "Project ID required" });
    }

    if (!ownerWalletAddress) {
      return res.status(401).json({ message: "Wallet address required for authorization" });
    }

    // Get project from database
    const project = await storage.getProject(projectId);
    
    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Verify ownership
    if (project.ownerWalletAddress !== ownerWalletAddress) {
      return res.status(403).json({ 
        message: "Unauthorized: You do not own this project" 
      });
    }

    // Attach project to request for use in route handler
    (req as any).project = project;
    next();
  } catch (error: any) {
    console.error("Project ownership verification error:", error);
    res.status(500).json({ message: "Authorization check failed" });
  }
}

/**
 * Middleware to sanitize user input
 * Prevents XSS and SQL injection attacks
 */
export function sanitizeInput(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Remove any potential script tags from string inputs
  const sanitize = (obj: any): any => {
    if (typeof obj === "string") {
      // Remove script tags and potential XSS vectors
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/on\w+\s*=/gi, "")
        .trim();
    }
    
    if (typeof obj === "object" && obj !== null) {
      const sanitized: any = Array.isArray(obj) ? [] : {};
      for (const key in obj) {
        sanitized[key] = sanitize(obj[key]);
      }
      return sanitized;
    }
    
    return obj;
  };

  req.body = sanitize(req.body);
  req.query = sanitize(req.query);
  req.params = sanitize(req.params);
  
  next();
}

/**
 * Middleware to prevent request body size attacks
 * Limits request size to 1MB
 */
export const requestSizeLimit = "1mb";

/**
 * CORS configuration
 * Only allows requests from same origin in production
 */
export function corsPolicy() {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const isProd = process.env.NODE_ENV === "production";
    
    if (isProd) {
      // In production, only allow specific origins
      const frontendUrl = process.env.FRONTEND_URL;
      const allowedOrigins: string[] = [];
      
      // Add FRONTEND_URL if set (exact match required)
      if (frontendUrl && frontendUrl.length > 0) {
        allowedOrigins.push(frontendUrl);
      }
      
      // Add Replit deployment domains (pattern matching)
      const replitAppPattern = /^https:\/\/[a-z0-9-]+\.repl(it\.app|it\.dev)$/i;
      
      let corsAllowed = false;
      
      if (origin) {
        // Exact match against allowed origins
        if (allowedOrigins.includes(origin)) {
          corsAllowed = true;
        }
        // Pattern match for Replit domains
        else if (replitAppPattern.test(origin)) {
          corsAllowed = true;
        }
      }
      
      if (corsAllowed && origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
      } else {
        // Reject CORS for unauthorized origins
        res.setHeader("Access-Control-Allow-Origin", "null");
      }
    } else {
      // In development, allow all origins
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours
    
    // Handle preflight
    if (req.method === "OPTIONS") {
      return res.status(204).send();
    }
    
    next();
  };
}

/**
 * Security audit logger
 * Logs sensitive operations for security monitoring
 */
export function auditLog(operation: string, details: Record<string, any>) {
  const timestamp = new Date().toISOString();
  const sanitizedDetails = { ...details };
  
  // Never log sensitive data
  delete sanitizedDetails.privateKey;
  delete sanitizedDetails.signature;
  delete sanitizedDetails.password;
  
  console.log(`[SECURITY AUDIT] ${timestamp} - ${operation}:`, sanitizedDetails);
}

/**
 * Validates wallet address format
 * Prevents malformed wallet addresses
 */
export function isValidSolanaAddress(address: string): boolean {
  // Solana addresses are base58 encoded, 32-44 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Validates transaction signature format
 */
export function isValidSignature(signature: string): boolean {
  // Solana signatures are base58 encoded, typically 87-88 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
  return base58Regex.test(signature);
}

/**
 * Middleware to validate request contains valid Solana addresses
 */
export function validateSolanaAddresses(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const addressFields = [
    "ownerWalletAddress",
    "treasuryWalletAddress",
    "tokenMintAddress",
    "pumpfunCreatorWallet",
    "fromAddress",
    "toAddress",
  ];

  for (const field of addressFields) {
    const address = req.body[field] || req.query[field];
    if (address && !isValidSolanaAddress(address as string)) {
      return res.status(400).json({
        message: `Invalid Solana address format for ${field}`,
      });
    }
  }

  next();
}

/**
 * Wallet signature authentication middleware
 * Verifies wallet ownership via cryptographic signature
 * Prevents replay attacks and expired messages
 */
export async function requireWalletAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { ownerWalletAddress, signature, message } = req.body;
    
    if (!ownerWalletAddress || !signature || !message) {
      return res.status(401).json({ 
        message: "Authentication required: ownerWalletAddress, signature, and message are required" 
      });
    }

    // Validate address format
    if (!isValidSolanaAddress(ownerWalletAddress)) {
      return res.status(400).json({ 
        message: "Invalid wallet address format" 
      });
    }

    // Verify wallet signature
    const { verifyWalletSignature } = await import("./solana-sdk");
    const isValidSignature = await verifyWalletSignature(
      ownerWalletAddress,
      message,
      signature
    );

    if (!isValidSignature) {
      return res.status(403).json({ 
        message: "Invalid signature: Could not verify wallet ownership" 
      });
    }

    // Extract timestamp from message (format: "action at {timestamp}")
    const timestampMatch = message.match(/at (\d+)$/);
    if (!timestampMatch) {
      return res.status(400).json({ 
        message: "Invalid message format: timestamp required" 
      });
    }

    const messageTimestamp = parseInt(timestampMatch[1], 10);
    const now = Date.now();
    const fiveMinutesInMs = 5 * 60 * 1000;
    
    if (now - messageTimestamp > fiveMinutesInMs) {
      return res.status(400).json({ 
        message: "Message expired: Please sign a new message" 
      });
    }

    // Create a hash of the signature for replay attack prevention
    const { createHash } = await import("crypto");
    const signatureHash = createHash("sha256").update(signature).digest("hex");

    // Check if this signature has already been used
    const isUsed = await storage.isSignatureUsed(signatureHash);
    if (isUsed) {
      return res.status(400).json({ 
        message: "Signature already used: Please sign a new message to prevent replay attacks" 
      });
    }

    // Mark signature as used
    await storage.recordUsedSignature({ signatureHash });

    // Attach verified wallet address to request for use in route handler
    (req as any).authenticatedWallet = ownerWalletAddress;
    
    auditLog("wallet_authenticated", {
      walletAddress: ownerWalletAddress,
      ip: getClientIp(req),
    });
    
    next();
  } catch (error: any) {
    console.error("Wallet authentication error:", error);
    res.status(500).json({ message: "Authentication failed" });
  }
}

/**
 * Environment variable security check
 * Ensures critical security variables are set
 */
export function checkSecurityEnvVars(): void {
  const criticalVars = ["DATABASE_URL"];
  const recommendedVars = ["ENCRYPTION_MASTER_KEY", "SESSION_SECRET"];

  // Check critical vars (block startup if missing)
  const missingCritical = criticalVars.filter(v => !process.env[v]);
  if (missingCritical.length > 0 && process.env.NODE_ENV === "production") {
    console.error("❌ CRITICAL: Missing required environment variables:");
    missingCritical.forEach(v => console.error(`   - ${v}`));
    console.error("\nCannot start without these variables.");
    process.exit(1);
  }

  // Check recommended vars (warn but don't block)
  const missingRecommended = recommendedVars.filter(v => !process.env[v]);
  if (missingRecommended.length > 0) {
    console.warn("\n⚠️  Optional security variables not configured (app will continue):");
    missingRecommended.forEach(v => console.warn(`   - ${v}`));
    console.warn("\n→ Application starting normally - these are optional");
    console.warn("→ Encryption and session features may have reduced security");
    console.warn("→ To enable full security, add these environment variables:");
    console.warn("   ENCRYPTION_MASTER_KEY: openssl rand -hex 32");
    console.warn("   SESSION_SECRET: openssl rand -base64 32\n");
  }
  
  // Verify ENCRYPTION_MASTER_KEY strength if present
  const masterKey = process.env.ENCRYPTION_MASTER_KEY;
  if (masterKey && masterKey.length < 64) {
    console.warn("\n⚠️  ENCRYPTION_MASTER_KEY is too short (app will continue)");
    console.warn(`   Current length: ${masterKey.length} characters`);
    console.warn(`   Recommended: 64+ characters`);
    console.warn(`   Generate with: openssl rand -hex 32\n`);
  }
  
  if (missingRecommended.length === 0 && (!masterKey || masterKey.length >= 64)) {
    console.log("✅ All security environment variables properly configured");
  }
}
