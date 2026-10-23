import { importEmojiDirectory } from '../server/emoji-db.js';

const result = await importEmojiDirectory();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
