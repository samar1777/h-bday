import { 
    S3Client, 
    ListObjectsV2Command, 
    GetObjectCommand, 
    PutObjectCommand, 
    DeleteObjectCommand 
} from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const FILEBASE_ENDPOINT = process.env.FILEBASE_ENDPOINT || 'https://s3.filebase.io';
const FILEBASE_KEY = process.env.FILEBASE_KEY || '932005A6899C53076C06';
const FILEBASE_SECRET = process.env.FILEBASE_SECRET || 'D8qzIFd65tWLVn8F9M8gXWMqQYrjtUc4ff80FOsh';
const FILEBASE_BUCKET = process.env.FILEBASE_BUCKET || 'sessiontoken';
const FILEBASE_REGION = process.env.FILEBASE_REGION || 'us-east-1';

export const s3Client = new S3Client({
    endpoint: FILEBASE_ENDPOINT,
    region: FILEBASE_REGION,
    credentials: {
        accessKeyId: FILEBASE_KEY,
        secretAccessKey: FILEBASE_SECRET,
    },
    forcePathStyle: true,
});

const SESSION_PREFIX = 'session/';
const DATA_PREFIX = 'data/';

/**
 * Downloads all session auth files from Filebase S3 into the local session directory.
 */
export async function downloadSessionFromS3(localDir) {
    try {
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }

        console.log(`[Filebase] Checking for existing session in bucket '${FILEBASE_BUCKET}'...`);
        const listCommand = new ListObjectsV2Command({
            Bucket: FILEBASE_BUCKET,
            Prefix: SESSION_PREFIX,
        });

        const listResult = await s3Client.send(listCommand);
        if (!listResult.Contents || listResult.Contents.length === 0) {
            console.log('[Filebase] No saved session found in Filebase. Ready for new pairing.');
            return false;
        }

        let downloadedCount = 0;
        for (const item of listResult.Contents) {
            if (!item.Key || item.Key.endsWith('/')) continue;
            
            const relativeName = item.Key.replace(SESSION_PREFIX, '');
            const localFilePath = path.join(localDir, relativeName);

            const getCommand = new GetObjectCommand({
                Bucket: FILEBASE_BUCKET,
                Key: item.Key,
            });

            const response = await s3Client.send(getCommand);
            const bodyBytes = await response.Body.transformToByteArray();
            
            fs.writeFileSync(localFilePath, Buffer.from(bodyBytes));
            downloadedCount++;
        }

        console.log(`[Filebase] ✓ Restored ${downloadedCount} session file(s) from Filebase S3.`);
        return downloadedCount > 0;
    } catch (error) {
        console.error('[Filebase] ⚠️ Error downloading session from S3:', error.message);
        return false;
    }
}

/**
 * Uploads a single session file to Filebase S3.
 */
export async function uploadSessionFileToS3(localDir, filename) {
    try {
        const localFilePath = path.join(localDir, filename);
        if (!fs.existsSync(localFilePath)) return;

        const content = fs.readFileSync(localFilePath);
        const s3Key = `${SESSION_PREFIX}${filename}`;

        const putCommand = new PutObjectCommand({
            Bucket: FILEBASE_BUCKET,
            Key: s3Key,
            Body: content,
            ContentType: 'application/json',
        });

        await s3Client.send(putCommand);
    } catch (error) {
        console.error(`[Filebase] ⚠️ Failed to upload ${filename}:`, error.message);
    }
}

/**
 * Uploads all session auth files from local session dir to Filebase S3.
 */
export async function uploadAllSessionFilesToS3(localDir) {
    try {
        if (!fs.existsSync(localDir)) return;

        const files = fs.readdirSync(localDir);
        for (const file of files) {
            const filePath = path.join(localDir, file);
            if (fs.statSync(filePath).isFile()) {
                await uploadSessionFileToS3(localDir, file);
            }
        }
        console.log(`[Filebase] ✓ Session synchronized to Filebase S3 (${files.length} files).`);
    } catch (error) {
        console.error('[Filebase] ⚠️ Error syncing session to S3:', error.message);
    }
}

/**
 * Deletes all session files from Filebase S3 (used for logging out/resetting).
 */
export async function deleteSessionFromS3() {
    try {
        const listCommand = new ListObjectsV2Command({
            Bucket: FILEBASE_BUCKET,
            Prefix: SESSION_PREFIX,
        });
        const listResult = await s3Client.send(listCommand);
        if (listResult.Contents && listResult.Contents.length > 0) {
            for (const item of listResult.Contents) {
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: FILEBASE_BUCKET,
                    Key: item.Key,
                }));
            }
            console.log('[Filebase] ✓ Cleared session from Filebase S3.');
        }
    } catch (error) {
        console.error('[Filebase] ⚠️ Error clearing session from S3:', error.message);
    }
}

/**
 * Loads JSON data (like birthdays or config) from Filebase S3, falling back to local file.
 */
export async function loadJsonFromS3(keyName, localFallbackPath, defaultData = []) {
    const s3Key = `${DATA_PREFIX}${keyName}`;
    try {
        const command = new GetObjectCommand({
            Bucket: FILEBASE_BUCKET,
            Key: s3Key,
        });
        const response = await s3Client.send(command);
        const str = await response.Body.transformToString();
        const data = JSON.parse(str);
        // Also cache locally
        fs.writeFileSync(localFallbackPath, JSON.stringify(data, null, 2));
        return data;
    } catch (error) {
        // If not in S3, try local file
        if (fs.existsSync(localFallbackPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(localFallbackPath, 'utf8'));
                // Upload to S3 so it is persisted
                await saveJsonToS3(keyName, data);
                return data;
            } catch {
                return defaultData;
            }
        }
        return defaultData;
    }
}

/**
 * Saves JSON data to both Filebase S3 and local file.
 */
export async function saveJsonToS3(keyName, data, localFallbackPath = null) {
    const s3Key = `${DATA_PREFIX}${keyName}`;
    try {
        const jsonStr = JSON.stringify(data, null, 2);
        if (localFallbackPath) {
            fs.writeFileSync(localFallbackPath, jsonStr);
        }
        const putCommand = new PutObjectCommand({
            Bucket: FILEBASE_BUCKET,
            Key: s3Key,
            Body: jsonStr,
            ContentType: 'application/json',
        });
        await s3Client.send(putCommand);
        return true;
    } catch (error) {
        console.error(`[Filebase] ⚠️ Failed to save ${keyName} to S3:`, error.message);
        return false;
    }
}
