// setupDB.js - 使用 mysql2，避免 USE 命令
const mysql = require('mysql2/promise');
const dbConfig = require('./config/dbConfig');

async function setup() {
    const conn = await mysql.createConnection({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        port: dbConfig.port
    });

    try {
        // 1. 创建数据库（如果不存在）
        await conn.execute(`
            CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` 
            CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `);

        console.log('✅ 数据库已创建或已存在');

        // 2. 直接在表名前加数据库名（不使用 USE）
        const dbName = dbConfig.database;

        // 3. 创建 courses 表
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS \`${dbName}\`.courses (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                students INT NOT NULL,
                teacher VARCHAR(50) NOT NULL,
                location VARCHAR(20)
            )
        `);

        // 4. 创建 classrooms 表
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS \`${dbName}\`.classrooms (
                id VARCHAR(20) PRIMARY KEY,
                capacity INT NOT NULL
            )
        `);

        console.log('✅ 表结构已创建！');
    } catch (err) {
        console.error('❌ 初始化失败:', err.message);
        throw err;
    } finally {
        await conn.end();
    }
}

setup().catch(process.exit);