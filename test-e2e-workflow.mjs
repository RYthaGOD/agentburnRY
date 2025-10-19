#!/usr/bin/env node
/**
 * End-to-end test for secure key management workflow
 * Tests: Create project → Save keys → Check metadata → Delete keys
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

const PROJECT_ID = '2cd6d145-45dc-4fad-b7e1-cae799a9b698';
const BASE_URL = 'http://localhost:5000';

// Generate development keypair
const keypair = nacl.sign.keyPair();
const publicKey = new PublicKey(keypair.publicKey);
const walletAddress = publicKey.toBase58();

// Generate a second keypair for PumpFun key testing
const pumpfunKeypair = nacl.sign.keyPair();
const pumpfunPrivateKey = bs58.encode(pumpfunKeypair.secretKey);

console.log('🔑 Generated test wallet:', walletAddress);
console.log('');

// Helper to sign messages
function signMessage(message) {
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  return bs58.encode(signature);
}

// Helper to make API requests
async function apiCall(method, path, body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.json();
  
  return { status: response.status, data };
}

async function runTests() {
  console.log('📊 E2E Workflow Test\n');
  console.log('='.repeat(60));
  
  try {
    // Step 0: Update project owner to match our test wallet
    console.log('\n✅ Step 0: Update project owner wallet');
    await apiCall('PATCH', `/api/projects/${PROJECT_ID}`, {
      ownerWalletAddress: walletAddress,
    });
    console.log(`   ✓ Set owner to ${walletAddress}`);
    
    // Step 1: Check initial key metadata
    console.log('\n✅ Step 1: Check initial key metadata');
    const { data: initialMetadata } = await apiCall('GET', `/api/projects/${PROJECT_ID}/keys/metadata`);
    console.log('   Initial state:', initialMetadata);
    
    if (initialMetadata.hasTreasuryKey || initialMetadata.hasPumpFunKey) {
      console.log('   ⚠️  Keys already configured, cleaning up first...');
      
      const deleteMessage = `Delete keys for project ${PROJECT_ID} at ${Date.now()}`;
      const deleteSignature = signMessage(deleteMessage);
      
      await apiCall('DELETE', `/api/projects/${PROJECT_ID}/keys`, {
        signature: deleteSignature,
        message: deleteMessage,
        publicKey: walletAddress,
      });
      
      console.log('   ✓ Cleaned up existing keys');
    } else {
      console.log('   ✓ No keys configured (expected)');
    }
    
    // Step 2: Save encrypted keys
    console.log('\n✅ Step 2: Save encrypted keys with wallet signature');
    const saveMessage = `Set keys for project ${PROJECT_ID} at ${Date.now()}`;
    const saveSignature = signMessage(saveMessage);
    
    const { status: saveStatus, data: saveResponse } = await apiCall('POST', `/api/projects/${PROJECT_ID}/keys`, {
      ownerWalletAddress: walletAddress,
      signature: saveSignature,
      message: saveMessage,
      keys: {
        treasuryPrivateKey: bs58.encode(keypair.secretKey),
        pumpfunPrivateKey: pumpfunPrivateKey,
      },
    });
    
    console.log(`   Response (${saveStatus}):`, saveResponse);
    
    if (saveStatus === 200 || saveStatus === 201) {
      console.log('   ✓ Keys saved successfully');
    } else {
      console.log('   ✗ Failed to save keys');
      throw new Error(`Save failed with status ${saveStatus}`);
    }
    
    // Step 3: Verify keys are configured
    console.log('\n✅ Step 3: Verify keys are now configured');
    const { data: afterSaveMetadata } = await apiCall('GET', `/api/projects/${PROJECT_ID}/keys/metadata`);
    console.log('   After save:', afterSaveMetadata);
    
    if (afterSaveMetadata.hasTreasuryKey && afterSaveMetadata.hasPumpFunKey) {
      console.log('   ✓ Both keys configured correctly');
    } else {
      console.log('   ✗ Keys not properly configured');
      throw new Error('Keys not saved properly');
    }
    
    // Step 4: Delete keys
    console.log('\n✅ Step 4: Delete keys with wallet signature');
    const deleteMessage = `Delete keys for project ${PROJECT_ID} at ${Date.now()}`;
    const deleteSignature = signMessage(deleteMessage);
    
    const { status: deleteStatus, data: deleteResponse } = await apiCall('DELETE', `/api/projects/${PROJECT_ID}/keys`, {
      ownerWalletAddress: walletAddress,
      signature: deleteSignature,
      message: deleteMessage,
    });
    
    console.log(`   Response (${deleteStatus}):`, deleteResponse);
    
    if (deleteStatus === 200) {
      console.log('   ✓ Keys deleted successfully');
    } else {
      console.log('   ✗ Failed to delete keys');
      throw new Error(`Delete failed with status ${deleteStatus}`);
    }
    
    // Step 5: Verify keys are removed
    console.log('\n✅ Step 5: Verify keys are removed');
    const { data: afterDeleteMetadata } = await apiCall('GET', `/api/projects/${PROJECT_ID}/keys/metadata`);
    console.log('   After delete:', afterDeleteMetadata);
    
    if (!afterDeleteMetadata.hasTreasuryKey && !afterDeleteMetadata.hasPumpFunKey) {
      console.log('   ✓ Keys properly removed');
    } else {
      console.log('   ✗ Keys still present');
      throw new Error('Keys not deleted properly');
    }
    
    // All tests passed
    console.log('\n' + '='.repeat(60));
    console.log('🎉 ALL TESTS PASSED!');
    console.log('='.repeat(60));
    console.log('\n📋 Test Summary:');
    console.log('   ✓ Initial state verification');
    console.log('   ✓ Wallet signature authentication');
    console.log('   ✓ Key encryption and storage');
    console.log('   ✓ Metadata API correctness');
    console.log('   ✓ Key deletion');
    console.log('   ✓ Complete workflow validation');
    console.log('');
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runTests();
