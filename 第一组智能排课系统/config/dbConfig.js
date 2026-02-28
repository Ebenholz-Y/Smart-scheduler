// dbConfig.js - 数据库配置文件（已修复字符集冲突）
const mysql = require('mysql2/promise');

// 数据库配置对象
const config = {
    host: 'localhost',
    port: 3306,
    user: 'scheduler',
    password: 'secure_password',  // 请根据实际情况修改
    database: 'course_schedule',
    timezone: '+08:00',  // 北京时间
    dateStrings: true,   // 日期以字符串形式返回
    supportBigNumbers: true,
    bigNumberStrings: true
};

// 创建连接池（统一字符集和排序规则）
const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    
    // 字符集配置 - 解决排序规则冲突
    charset: 'utf8mb4',
    collation: 'utf8mb4_0900_ai_ci',
    
    // 连接池配置
    waitForConnections: true,
    connectionLimit: 20,
    maxIdle: 10,              // 最大空闲连接数
    idleTimeout: 60000,       // 空闲连接超时时间（毫秒）
    queueLimit: 0,
    
    // 连接优化
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    connectTimeout: 10000,    // 连接超时时间（毫秒）
    acquireTimeout: 10000,    // 获取连接超时时间
    
    // 数据类型处理
    decimalNumbers: true,     // 返回decimal类型为数字而非字符串
    timezone: config.timezone,
    dateStrings: config.dateStrings,
    supportBigNumbers: config.supportBigNumbers,
    bigNumberStrings: config.bigNumberStrings,
    
    // 调试选项
    debug: false,             // 设为true可查看SQL查询日志
    trace: true,              // 跟踪连接池活动
    multipleStatements: false // 是否允许多条SQL语句
});

// 数据库连接测试函数
async function testConnection() {
    let connection;
    try {
        connection = await pool.getConnection();
        
        const [version] = await connection.query('SELECT VERSION() as version');
        const [db] = await connection.query('SELECT DATABASE() as db');
        const [charset] = await connection.query('SHOW VARIABLES LIKE "character_set_connection"');
        const [collation] = await connection.query('SHOW VARIABLES LIKE "collation_connection"');
        
        console.log('✅ 数据库连接测试:');
        console.log(`   数据库: ${db[0].db}`);
        console.log(`   版本: ${version[0].version}`);
        console.log(`   连接字符集: ${charset[0].Value}`);
        console.log(`   连接排序规则: ${collation[0].Value}`);
        
        return {
            success: true,
            database: db[0].db,
            version: version[0].version,
            charset: charset[0].Value,
            collation: collation[0].Value
        };
    } catch (error) {
        console.error('❌ 数据库连接失败:', error.message);
        return {
            success: false,
            error: error.message,
            code: error.code
        };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

// 获取数据库和表的字符集信息
async function getCharsetInfo() {
    let connection;
    try {
        connection = await pool.getConnection();
        
        // 1. 获取数据库字符集
        const [dbCharset] = await connection.query(`
            SELECT 
                DEFAULT_CHARACTER_SET_NAME,
                DEFAULT_COLLATION_NAME 
            FROM INFORMATION_SCHEMA.SCHEMATA 
            WHERE SCHEMA_NAME = ?
        `, [config.database]);
        
        // 2. 获取所有表的字符集
        const [tables] = await connection.query(`
            SELECT 
                TABLE_NAME,
                TABLE_COLLATION
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ?
            ORDER BY TABLE_NAME
        `, [config.database]);
        
        // 3. 获取所有列的字符集信息
        const [columns] = await connection.query(`
            SELECT 
                TABLE_NAME,
                COLUMN_NAME,
                CHARACTER_SET_NAME,
                COLLATION_NAME,
                DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ?
            AND CHARACTER_SET_NAME IS NOT NULL
            AND COLLATION_NAME IS NOT NULL
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        `, [config.database]);
        
        // 分析字符集一致性
        const targetCollation = 'utf8mb4_0900_ai_ci';
        const inconsistentTables = tables.filter(table => 
            table.TABLE_COLLATION !== targetCollation
        );
        
        const inconsistentColumns = columns.filter(column => 
            column.COLLATION_NAME !== targetCollation
        );
        
        return {
            success: true,
            database: {
                character_set: dbCharset[0]?.DEFAULT_CHARACTER_SET_NAME,
                collation: dbCharset[0]?.DEFAULT_COLLATION_NAME
            },
            tables: tables,
            columns: columns,
            consistency: {
                target_collation: targetCollation,
                inconsistent_tables_count: inconsistentTables.length,
                inconsistent_columns_count: inconsistentColumns.length,
                is_consistent: inconsistentTables.length === 0 && inconsistentColumns.length === 0
            },
            connection_config: {
                charset: 'utf8mb4',
                collation: 'utf8mb4_0900_ai_ci'
            }
        };
    } catch (error) {
        console.error('获取字符集信息失败:', error.message);
        return {
            success: false,
            error: error.message
        };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

// 修复数据库字符集
async function fixCollationIssues() {
    let connection;
    try {
        connection = await pool.getConnection();
        
        console.log('开始修复数据库字符集...');
        
        // 1. 修改数据库默认字符集
        await connection.query(`
            ALTER DATABASE \`${config.database}\` 
            CHARACTER SET utf8mb4 
            COLLATE utf8mb4_0900_ai_ci
        `);
        console.log('✅ 数据库字符集已修改为 utf8mb4_0900_ai_ci');
        
        // 2. 获取所有表
        const [tables] = await connection.query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = ?
        `, [config.database]);
        
        // 3. 修改每个表的字符集
        const tableResults = [];
        for (const table of tables) {
            const tableName = table.TABLE_NAME;
            try {
                await connection.query(`
                    ALTER TABLE \`${tableName}\` 
                    CONVERT TO CHARACTER SET utf8mb4 
                    COLLATE utf8mb4_0900_ai_ci
                `);
                tableResults.push({
                    table: tableName,
                    success: true,
                    message: '修改成功'
                });
                console.log(`   ✅ 表 ${tableName} 字符集已修改`);
            } catch (error) {
                tableResults.push({
                    table: tableName,
                    success: false,
                    message: error.message
                });
                console.log(`   ⚠️  表 ${tableName} 修改失败: ${error.message}`);
            }
        }
        
        // 4. 修改所有列的字符集（对于不支持表级修改的情况）
        const [columns] = await connection.query(`
            SELECT 
                TABLE_NAME,
                COLUMN_NAME,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH,
                IS_NULLABLE,
                COLUMN_DEFAULT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ?
            AND DATA_TYPE IN ('varchar', 'char', 'text', 'tinytext', 'mediumtext', 'longtext')
        `, [config.database]);
        
        const columnResults = [];
        for (const column of columns) {
            try {
                // 构建ALTER语句
                const dataType = column.DATA_TYPE === 'varchar' || column.DATA_TYPE === 'char' 
                    ? `${column.DATA_TYPE}(${column.CHARACTER_MAXIMUM_LENGTH})`
                    : column.DATA_TYPE;
                    
                const nullable = column.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
                const defaultValue = column.COLUMN_DEFAULT !== null 
                    ? `DEFAULT '${column.COLUMN_DEFAULT}'`
                    : '';
                
                await connection.query(`
                    ALTER TABLE \`${column.TABLE_NAME}\`
                    MODIFY \`${column.COLUMN_NAME}\` ${dataType}
                    CHARACTER SET utf8mb4 
                    COLLATE utf8mb4_0900_ai_ci
                    ${nullable} ${defaultValue}
                `);
                
                columnResults.push({
                    table: column.TABLE_NAME,
                    column: column.COLUMN_NAME,
                    success: true,
                    message: '修改成功'
                });
            } catch (error) {
                columnResults.push({
                    table: column.TABLE_NAME,
                    column: column.COLUMN_NAME,
                    success: false,
                    message: error.message
                });
            }
        }
        
        return {
            success: true,
            message: '字符集修复完成',
            tables_modified: tableResults.length,
            tables_success: tableResults.filter(r => r.success).length,
            columns_modified: columnResults.length,
            columns_success: columnResults.filter(r => r.success).length,
            details: {
                tables: tableResults,
                columns: columnResults
            }
        };
    } catch (error) {
        console.error('修复字符集失败:', error.message);
        return {
            success: false,
            error: error.message,
            code: error.code
        };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

// 重置连接池（重新创建以应用新配置）
function resetPool() {
    pool.end(() => {
        console.log('旧的连接池已关闭');
        // 重新创建连接池 - 实际上pool变量是常量，这里需要重新赋值
        // 注意：这个函数需要在外部调用时注意变量作用域
        // 暂时不实现自动重置，而是建议重启应用
    });
}

// 获取当前配置
function getConfig() {
    return {
        ...config,
        charset: 'utf8mb4',
        collation: 'utf8mb4_0900_ai_ci',
        pool_settings: {
            connectionLimit: pool.config.connectionLimit,
            queueLimit: pool.config.queueLimit,
            waitForConnections: pool.config.waitForConnections
        }
    };
}

// 验证数据库结构
async function validateSchema() {
    let connection;
    try {
        connection = await pool.getConnection();
        
        const requiredTables = ['courses', 'classrooms', 'course_schedule'];
        const [tables] = await connection.query('SHOW TABLES');
        const existingTables = tables.map(t => Object.values(t)[0]);
        
        const missingTables = requiredTables.filter(table => !existingTables.includes(table));
        const extraTables = existingTables.filter(table => !requiredTables.includes(table));
        
        // 检查表结构
        const tableSchemas = {};
        for (const tableName of requiredTables) {
            if (existingTables.includes(tableName)) {
                const [fields] = await connection.query(`DESCRIBE ${tableName}`);
                tableSchemas[tableName] = {
                    exists: true,
                    fields: fields.map(f => ({
                        name: f.Field,
                        type: f.Type,
                        nullable: f.Null === 'YES',
                        key: f.Key
                    }))
                };
            }
        }
        
        return {
            success: true,
            database: config.database,
            required_tables: requiredTables,
            existing_tables: existingTables,
            missing_tables: missingTables,
            extra_tables: extraTables,
            is_complete: missingTables.length === 0,
            table_schemas: tableSchemas
        };
    } catch (error) {
        console.error('验证数据库结构失败:', error.message);
        return {
            success: false,
            error: error.message
        };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

// 导出模块
module.exports = {
    config: config,                    // 原始配置
    pool: pool,                        // 连接池（已修复字符集）
    testConnection: testConnection,    // 测试连接函数
    getCharsetInfo: getCharsetInfo,    // 获取字符集信息
    fixCollationIssues: fixCollationIssues, // 修复字符集函数
    getConfig: getConfig,              // 获取当前配置
    validateSchema: validateSchema,    // 验证数据库结构
    // 导出一个创建新连接的函数（使用统一字符集）
    createConnection: async () => {
        return await mysql.createConnection({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            charset: 'utf8mb4',
            collation: 'utf8mb4_0900_ai_ci'
        });
    }
};

// 如果直接运行此文件，则执行测试
if (require.main === module) {
    (async () => {
        console.log('=== 测试数据库连接和字符集 ===\n');
        
        // 测试连接
        const connectionTest = await testConnection();
        if (!connectionTest.success) {
            console.error('❌ 数据库连接失败，请检查配置');
            process.exit(1);
        }
        
        console.log('\n=== 检查字符集一致性 ===');
        const charsetInfo = await getCharsetInfo();
        if (charsetInfo.success) {
            console.log(`数据库字符集: ${charsetInfo.database.character_set}`);
            console.log(`数据库排序规则: ${charsetInfo.database.collation}`);
            console.log(`是否一致: ${charsetInfo.consistency.is_consistent ? '✅ 是' : '❌ 否'}`);
            
            if (!charsetInfo.consistency.is_consistent) {
                console.log(`\n⚠️  发现 ${charsetInfo.consistency.inconsistent_tables_count} 个表字符集不一致`);
                console.log(`⚠️  发现 ${charsetInfo.consistency.inconsistent_columns_count} 个列字符集不一致`);
                
                const readline = require('readline').createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                readline.question('\n是否自动修复字符集？(y/n): ', async (answer) => {
                    if (answer.toLowerCase() === 'y') {
                        console.log('\n开始修复字符集...');
                        const fixResult = await fixCollationIssues();
                        if (fixResult.success) {
                            console.log('✅ 字符集修复完成！');
                        } else {
                            console.log('❌ 修复失败:', fixResult.error);
                        }
                    } else {
                        console.log('已跳过修复');
                    }
                    
                    readline.close();
                    process.exit(0);
                });
            } else {
                console.log('\n✅ 字符集配置正确，无需修复');
                process.exit(0);
            }
        } else {
            console.log('❌ 获取字符集信息失败:', charsetInfo.error);
            process.exit(1);
        }
    })().catch(console.error);
}