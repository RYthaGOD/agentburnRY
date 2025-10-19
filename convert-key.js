// Convert private key array to base58
import bs58 from 'bs58';

// If you have a private key as array like: [123, 45, 67, ...]
// Replace the array below with your actual key array
const keyArray = [123, 45, 67, /* ... your key bytes ... */];

// Convert to base58
const base58Key = bs58.encode(Buffer.from(keyArray));

console.log('Base58 Private Key:');
console.log(base58Key);
console.log('\nLength:', base58Key.length);
console.log('Valid base58:', /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(base58Key));
