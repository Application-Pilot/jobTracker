/**
 * crypto.ts — KMS helpers for Gmail refresh tokens.
 *
 * We use direct KMS Encrypt/Decrypt because refresh tokens are tiny
 * (well below KMS's 4 KiB plaintext limit). The userId is supplied as
 * encryption context, so decrypt must use the same userId and CloudTrail
 * records which user's token was accessed.
 */
import {
  DecryptCommand,
  EncryptCommand,
  KMSClient,
} from '@aws-sdk/client-kms';

let kmsClient: KMSClient | null = null;

function getKmsClient(): KMSClient {
  if (kmsClient) return kmsClient;
  kmsClient = new KMSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  return kmsClient;
}

function getTokenKeyArn(): string {
  const keyArn = process.env.TOKEN_KMS_KEY_ARN;
  if (!keyArn) {
    throw new Error('TOKEN_KMS_KEY_ARN env var is not set');
  }
  return keyArn;
}

export async function encryptRefreshToken(
  refreshToken: string,
  userId: string,
): Promise<string> {
  const result = await getKmsClient().send(
    new EncryptCommand({
      KeyId: getTokenKeyArn(),
      Plaintext: Buffer.from(refreshToken, 'utf8'),
      EncryptionContext: { userId },
    }),
  );

  if (!result.CiphertextBlob) {
    throw new Error('KMS Encrypt returned no ciphertext');
  }

  return Buffer.from(result.CiphertextBlob).toString('base64');
}

export async function decryptRefreshToken(
  encryptedRefreshToken: string,
  userId: string,
): Promise<string> {
  const result = await getKmsClient().send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedRefreshToken, 'base64'),
      KeyId: getTokenKeyArn(),
      EncryptionContext: { userId },
    }),
  );

  if (!result.Plaintext) {
    throw new Error('KMS Decrypt returned no plaintext');
  }

  return Buffer.from(result.Plaintext).toString('utf8');
}
