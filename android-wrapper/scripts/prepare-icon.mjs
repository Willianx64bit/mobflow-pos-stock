import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(process.cwd(), '..');
const source = path.join(root, 'public', 'mobflow-icon.svg');
const output = path.join(process.cwd(), 'resources', 'icon.png');
const svg = await fs.readFile(source);
await sharp(svg, { density: 384 }).resize(1024, 1024, { fit: 'contain' }).png().toFile(output);
console.log('MobFlow MF icon prepared:', output);
