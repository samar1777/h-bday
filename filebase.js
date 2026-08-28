import { 
    S3Client, 
    ListObjectsV2Command, 
    GetObjectCommand, 
    PutObjectCommand, 
    DeleteObjectCommand 
} from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

let lastUploadedBundleHash = '';

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
const BUNDLE_KEY = 'session/session_bundle.json';
const DATA_PREFIX = 'data/';
const IMAGES_PREFIX = 'images/';

let lastQuotaWarningTime = 0;
function logS3QuotaWarning(errMessage) {
    const now = Date.now();
    // Throttle quota warnings to once every 60 seconds
    if (now - lastQuotaWarningTime > 60000) {
        lastQuotaWarningTime = now;
        console.warn(`[Filebase] ⚠️ Cloud sync paused: ${errMessage}. Operating safely using local session storage.`);
    }
}

/**
 * Downloads all session auth files from Filebase S3 into the local session directory.
 * Supports both modern single-bundle session and legacy multi-file sessions.
 */
export async function downloadSessionFromS3(localDir) {
    try {
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }

        console.log(`[Filebase] Checking for existing session in bucket '${FILEBASE_BUCKET}'...`);

        // 1. Try loading modern consolidated session bundle first
        try {
            const getBundleCmd = new GetObjectCommand({
                Bucket: FILEBASE_BUCKET,
                Key: BUNDLE_KEY,
            });
            const response = await s3Client.send(getBundleCmd);
            const bodyStr = await response.Body.transformToString();
            const bundle = JSON.parse(bodyStr);

            let restoredCount = 0;
            for (const [filename, fileData] of Object.entries(bundle)) {
                const targetPath = path.join(localDir, filename);
                fs.writeFileSync(targetPath, fileData, 'utf8');
                restoredCount++;
            }

            console.log(`[Filebase] ✓ Restored ${restoredCount} session file(s) from cloud session bundle.`);
            return restoredCount > 0;
        } catch (bundleErr) {
            if (bundleErr.message?.includes('Free-tier quota exceeded')) {
                logS3QuotaWarning(bundleErr.message);
                return false;
            }
            // If bundle is not found, continue to legacy check below
        }

        // 2. Legacy fallback: check for loose files (pre-key-*.json, creds.json, etc.)
        const listCommand = new ListObjectsV2Command({
            Bucket: FILEBASE_BUCKET,
            Prefix: SESSION_PREFIX,
        });

        const listResult = await s3Client.send(listCommand);
        if (!listResult.Contents || listResult.Contents.length === 0) {
            console.log('[Filebase] No saved session found in Filebase S3. Ready for new pairing.');
            return false;
        }

        let downloadedCount = 0;
        for (const item of listResult.Contents) {
            if (!item.Key || item.Key.endsWith('/') || item.Key === BUNDLE_KEY) continue;
            
            try {
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
            } catch (err) {
                console.warn(`[Filebase] ⚠️ Skipping file ${item.Key}:`, err.message);
            }
        }

        if (downloadedCount > 0) {
            console.log(`[Filebase] ✓ Restored ${downloadedCount} session file(s) from legacy S3 storage.`);
            // Automatically upgrade to consolidated single-file bundle
            await uploadAllSessionFilesToS3(localDir);
            return true;
        }

        return false;
    } catch (error) {
        if (error.message?.includes('Free-tier quota exceeded')) {
            logS3QuotaWarning(error.message);
        } else {
            console.error('[Filebase] ⚠️ Error downloading session from S3:', error.message);
        }
        return false;
    }
}

/**
 * Uploads a single session file to Filebase S3 (Legacy helper, redirects to bundle upload).
 */
export async function uploadSessionFileToS3(localDir, filename) {
    // Redirect to consolidated bundle upload for efficiency
    await uploadAllSessionFilesToS3(localDir);
}

/**
 * Uploads all session auth files from local session dir to Filebase S3 as a SINGLE consolidated bundle.
 * This stores the entire WhatsApp session in just 1 S3 file instead of hundreds of loose files.
 */
export async function uploadAllSessionFilesToS3(localDir) {
    try {
        if (!fs.existsSync(localDir)) return;

        const files = fs.readdirSync(localDir).filter(f => !f.startsWith('.'));
        if (files.length === 0) return;

        const bundle = {};
        for (const file of files) {
            const filePath = path.join(localDir, file);
            if (fs.statSync(filePath).isFile()) {
                bundle[file] = fs.readFileSync(filePath, 'utf8');
            }
        }

        const bundlePayload = JSON.stringify(bundle);
        const currentHash = crypto.createHash('md5').update(bundlePayload).digest('hex');

        // If nothing changed in auth keys, skip upload to preserve 100% of Class A operations
        if (currentHash === lastUploadedBundleHash) {
            return;
        }

        const putCommand = new PutObjectCommand({
            Bucket: FILEBASE_BUCKET,
            Key: BUNDLE_KEY,
            Body: bundlePayload,
            ContentType: 'application/json',
        });

        await s3Client.send(putCommand);
        lastUploadedBundleHash = currentHash;
        console.log(`[Filebase] ✓ Session bundle synchronized to S3 (1 bundle containing ${files.length} auth keys, ${(bundlePayload.length / 1024).toFixed(1)} KB).`);
    } catch (error) {
        if (error.message?.includes('Free-tier quota exceeded')) {
            logS3QuotaWarning(error.message);
        } else {
            console.error('[Filebase] ⚠️ Error syncing session bundle to S3:', error.message);
        }
    }
}

/**
 * Deletes all session files from Filebase S3 (used for logging out/resetting).
 */
export async function deleteSessionFromS3() {
    try {
        // 1. Delete session bundle
        try {
            await s3Client.send(new DeleteObjectCommand({
                Bucket: FILEBASE_BUCKET,
                Key: BUNDLE_KEY,
            }));
        } catch {}

        // 2. Delete any legacy loose files
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
            }
        } catch {}

        console.log('[Filebase] ✓ Cleared session from Filebase S3.');
    } catch (error) {
        if (error.message?.includes('Free-tier quota exceeded')) {
            logS3QuotaWarning(error.message);
        } else {
            console.error('[Filebase] ⚠️ Error clearing session from S3:', error.message);
        }
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
        if (error.message?.includes('Free-tier quota exceeded')) {
            logS3QuotaWarning(error.message);
        } else {
            console.error(`[Filebase] ⚠️ Failed to save ${keyName} to S3:`, error.message);
        }
        return false;
    }
}

/**
 * Uploads a photo to Filebase S3 under the 'images/' prefix.
 */
export async function uploadImageToS3(filename, buffer, contentType = 'image/jpeg') {
    try {
        const s3Key = `${IMAGES_PREFIX}${filename}`;
        const putCommand = new PutObjectCommand({
            Bucket: FILEBASE_BUCKET,
            Key: s3Key,
            Body: buffer,
            ContentType: contentType,
        });
        await s3Client.send(putCommand);
        console.log(`[Filebase] ✓ Photo '${filename}' uploaded to Filebase S3.`);
        return true;
    } catch (error) {
        if (error.message?.includes('Free-tier quota exceeded')) {
            logS3QuotaWarning(error.message);
        } else {
            console.error(`[Filebase] ⚠️ Failed to upload image '${filename}' to S3:`, error.message);
        }
        return false;
    }
}

/**
 * Downloads all images stored in Filebase S3 into the local uploads directory.
 */
export async function downloadAllImagesFromS3(localUploadsDir) {
    try {
        if (!fs.existsSync(localUploadsDir)) {
            fs.mkdirSync(localUploadsDir, { recursive: true });
        }

        const listCommand = new ListObjectsV2Command({
            Bucket: FILEBASE_BUCKET,
            Prefix: IMAGES_PREFIX,
        });

        const listResult = await s3Client.send(listCommand);
        if (!listResult.Contents || listResult.Contents.length === 0) {
            return 0;
        }

        let downloaded = 0;
        for (const item of listResult.Contents) {
            if (!item.Key || item.Key.endsWith('/')) continue;
            try {
                const filename = item.Key.replace(IMAGES_PREFIX, '');
                const localPath = path.join(localUploadsDir, filename);

                // If already present locally and non-empty, skip
                if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
                    continue;
                }

                const getCommand = new GetObjectCommand({
                    Bucket: FILEBASE_BUCKET,
                    Key: item.Key,
                });

                const response = await s3Client.send(getCommand);
                const bodyBytes = await response.Body.transformToByteArray();
                fs.writeFileSync(localPath, Buffer.from(bodyBytes));
                downloaded++;
            } catch (err) {
                console.warn(`[Filebase] ⚠️ Failed to download image ${item.Key}:`, err.message);
            }
        }

        if (downloaded > 0) {
            console.log(`[Filebase] ✓ Restored ${downloaded} photo(s) from Filebase S3.`);
        }
        return downloaded;
    } catch (error) {
        if (error.message?.includes('Free-tier quota exceeded')) {
            logS3QuotaWarning(error.message);
        } else {
            console.error('[Filebase] ⚠️ Error syncing images from S3:', error.message);
        }
        return 0;
    }
}

/**
 * Deletes an image from Filebase S3.
 */
export async function deleteImageFromS3(filename) {
    try {
        const s3Key = `${IMAGES_PREFIX}${filename}`;
        await s3Client.send(new DeleteObjectCommand({
            Bucket: FILEBASE_BUCKET,
            Key: s3Key,
        }));
        console.log(`[Filebase] ✓ Deleted image '${filename}' from Filebase S3.`);
        return true;
    } catch (error) {
        if (error.message?.includes('Free-tier quota exceeded')) {
            logS3QuotaWarning(error.message);
        } else {
            console.error(`[Filebase] ⚠️ Error deleting image '${filename}' from S3:`, error.message);
        }
        return false;
    }
}

