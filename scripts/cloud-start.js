import { db } from '../database.js';
import { migrateDatabase } from '../migrations.js';

// Keep first-time/local setup compatible. Production can explicitly disable this.
if (process.env.DB_AUTO_MIGRATE !== 'false') {
    await migrateDatabase(db, { username: process.env.INITIAL_STAFF_USERNAME || '', password: process.env.INITIAL_STAFF_PASSWORD || '' });
}
const { app } = await import('../server.js');
app.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log('Student Voice is online.'));
