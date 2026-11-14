import mysql from 'mysql2/promise';

export const db = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'student_voice',
    user: process.env.DB_USER || 'sv_app',
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    connectionLimit: 5,
});
