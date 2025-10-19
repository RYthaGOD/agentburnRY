import { encrypt, decrypt, generateFingerprint, validatePrivateKey } from "./crypto";
import { storage } from "./storage";
import type { SetProjectKeys } from "@shared/schema";

// In-memory cache for decrypted keys (expires after 5 minutes)
interface CachedKey {
  key: string;
  expiresAt: number;
}

const keyCache = new Map<string, CachedKey>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Stores encrypted private keys for a project
 * @param projectId - The project ID
 * @param keys - The plaintext private keys to encrypt and store
 */
export async function storeProjectKeys(projectId: string, keys: SetProjectKeys): Promise<void> {
  // Validate keys before storing
  if (!validatePrivateKey(keys.treasuryPrivateKey)) {
    const keyLength = keys.treasuryPrivateKey.length;
    const firstChars = keys.treasuryPrivateKey.substring(0, 3);
    const lastChars = keys.treasuryPrivateKey.substring(keys.treasuryPrivateKey.length - 3);
    console.error(`Treasury key validation failed - Length: ${keyLength}, Format: ${firstChars}...${lastChars}`);
    throw new Error(`Invalid treasury private key format (length: ${keyLength}, expected 32-128 characters in base58)`);
  }
  
  if (keys.pumpfunPrivateKey && !validatePrivateKey(keys.pumpfunPrivateKey)) {
    throw new Error("Invalid PumpFun private key format");
  }

  // Encrypt treasury key
  const treasuryEncrypted = encrypt(keys.treasuryPrivateKey);
  const treasuryFingerprint = generateFingerprint(keys.treasuryPrivateKey);

  let pumpfunCiphertext = null;
  let pumpfunIv = null;
  let pumpfunAuthTag = null;
  let pumpfunFingerprint = null;

  // Encrypt PumpFun key if provided
  if (keys.pumpfunPrivateKey) {
    const pumpfunEncrypted = encrypt(keys.pumpfunPrivateKey);
    pumpfunCiphertext = pumpfunEncrypted.ciphertext;
    pumpfunIv = pumpfunEncrypted.iv;
    pumpfunAuthTag = pumpfunEncrypted.authTag;
    pumpfunFingerprint = generateFingerprint(keys.pumpfunPrivateKey);
  }

  // Store encrypted keys in database
  await storage.setProjectSecrets({
    projectId,
    treasuryKeyCiphertext: treasuryEncrypted.ciphertext,
    treasuryKeyIv: treasuryEncrypted.iv,
    treasuryKeyAuthTag: treasuryEncrypted.authTag,
    treasuryKeyFingerprint: treasuryFingerprint,
    pumpfunKeyCiphertext: pumpfunCiphertext,
    pumpfunKeyIv: pumpfunIv,
    pumpfunKeyAuthTag: pumpfunAuthTag,
    pumpfunKeyFingerprint: pumpfunFingerprint,
  });

  // Clear cache for this project
  clearProjectCache(projectId);
}

/**
 * Retrieves and decrypts the treasury private key for a project
 * Uses in-memory cache to minimize decryption operations
 */
export async function getTreasuryKey(projectId: string): Promise<string | null> {
  const cacheKey = `treasury_${projectId}`;
  
  // Check cache first
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  // Retrieve from database
  const secrets = await storage.getProjectSecrets(projectId);
  if (!secrets || !secrets.treasuryKeyCiphertext || !secrets.treasuryKeyIv || !secrets.treasuryKeyAuthTag) {
    return null;
  }

  try {
    // Decrypt the key
    const decryptedKey = decrypt(
      secrets.treasuryKeyCiphertext,
      secrets.treasuryKeyIv,
      secrets.treasuryKeyAuthTag
    );

    // Cache for future use
    keyCache.set(cacheKey, {
      key: decryptedKey,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return decryptedKey;
  } catch (error) {
    console.error(`Failed to decrypt treasury key for project ${projectId}:`, error);
    return null;
  }
}

/**
 * Retrieves and decrypts the PumpFun creator private key for a project
 * Uses in-memory cache to minimize decryption operations
 */
export async function getPumpFunKey(projectId: string): Promise<string | null> {
  const cacheKey = `pumpfun_${projectId}`;
  
  // Check cache first
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.key;
  }

  // Retrieve from database
  const secrets = await storage.getProjectSecrets(projectId);
  if (!secrets || !secrets.pumpfunKeyCiphertext || !secrets.pumpfunKeyIv || !secrets.pumpfunKeyAuthTag) {
    return null;
  }

  try {
    // Decrypt the key
    const decryptedKey = decrypt(
      secrets.pumpfunKeyCiphertext,
      secrets.pumpfunKeyIv,
      secrets.pumpfunKeyAuthTag
    );

    // Cache for future use
    keyCache.set(cacheKey, {
      key: decryptedKey,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return decryptedKey;
  } catch (error) {
    console.error(`Failed to decrypt PumpFun key for project ${projectId}:`, error);
    return null;
  }
}

/**
 * Returns metadata about stored keys (never returns the actual keys)
 */
export async function getKeyMetadata(projectId: string): Promise<{
  hasTreasuryKey: boolean;
  hasPumpFunKey: boolean;
  lastRotated: Date | null;
}> {
  const secrets = await storage.getProjectSecrets(projectId);
  
  return {
    hasTreasuryKey: !!(secrets?.treasuryKeyCiphertext),
    hasPumpFunKey: !!(secrets?.pumpfunKeyCiphertext),
    lastRotated: secrets?.lastRotatedAt || null,
  };
}

/**
 * Deletes all stored keys for a project
 */
export async function deleteProjectKeys(projectId: string): Promise<boolean> {
  clearProjectCache(projectId);
  return await storage.deleteProjectSecrets(projectId);
}

/**
 * Clears cached keys for a project
 */
function clearProjectCache(projectId: string): void {
  keyCache.delete(`treasury_${projectId}`);
  keyCache.delete(`pumpfun_${projectId}`);
}

/**
 * Periodic cleanup of expired cache entries
 */
setInterval(() => {
  const now = Date.now();
  const entries = Array.from(keyCache.entries());
  for (const [key, value] of entries) {
    if (value.expiresAt <= now) {
      keyCache.delete(key);
    }
  }
}, 60 * 1000); // Run every minute
