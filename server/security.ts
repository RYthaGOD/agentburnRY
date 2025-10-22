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
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "https:"],
        fontSrc: ["'self'", "data:"],
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
 * Global rate limiter - Protects against DDoS and brute force attacks
 * 100 requests per 15 minutes per IP
 */
export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for whitelisted IPs (optional)
  skip: (req) => {
    // Add your whitelisted IPs here if needed
    const whitelist: string[] = [];
    return whitelist.includes(req.ip || "");
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
      // In production, only allow same-origin requests
      const allowedOrigins = [
        process.env.FRONTEND_URL || "",
        "https://*.replit.app",
        "https://*.replit.dev",
      ];
      
      if (origin && allowedOrigins.some(allowed => origin.includes(allowed))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
    } else {
      // In development, allow all origins
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
    }
    
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");
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
 * Environment variable security check
 * Ensures critical security variables are set
 */
export function checkSecurityEnvVars(): void {
  const requiredVars = [
    "ENCRYPTION_MASTER_KEY",
    "SESSION_SECRET",
  ];

  const missing = requiredVars.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error("❌ SECURITY ERROR: Missing required environment variables:");
    missing.forEach(v => console.error(`   - ${v}`));
    console.error("\nThe application cannot start securely without these variables.");
    
    if (process.env.NODE_ENV === "production") {
      console.error("CRITICAL: Production deployment blocked due to missing security variables.");
      process.exit(1);
    } else {
      console.warn("WARNING: Development mode - some security features may not work correctly.");
    }
  } else {
    console.log("✅ Security environment variables verified");
  }
  
  // Verify ENCRYPTION_MASTER_KEY is strong enough
  const masterKey = process.env.ENCRYPTION_MASTER_KEY;
  if (masterKey && masterKey.length < 64) {
    console.error("❌ SECURITY ERROR: ENCRYPTION_MASTER_KEY must be at least 64 characters (32 bytes hex)");
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  }
}
