import multer from 'multer';
import sharp from 'sharp';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const imageDirectory = resolve(process.env.MEDIA_DIR || fileURLToPath(new URL('./uploads', import.meta.url)));

export const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 5, fieldSize: 32 * 1024 },
}).single('image');

export async function saveImage(file) {
    if (!file) return null;
    let buffer;
    try {
        const image = sharp(file.buffer, { limitInputPixels: 16000000, animated: false });
        const metadata = await image.metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format) || metadata.pages > 1) {
            throw new Error('Unsupported image');
        }
        // Re-encode to strip metadata and avoid serving the original uploaded bytes.
        buffer = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 }).toBuffer();
    } catch {
        const error = new Error('JPEG・PNG・WebPの画像を選択してください（最大3MB・1600万画素）。');
        error.status = 400;
        throw error;
    }
    await mkdir(imageDirectory, { recursive: true });
    const name = randomBytes(16).toString('hex') + '.webp';
    await writeFile(resolve(imageDirectory, name), buffer, { flag: 'wx' });
    return name;
}

export async function removeImage(name) {
    if (name) await unlink(resolve(imageDirectory, name));
}
