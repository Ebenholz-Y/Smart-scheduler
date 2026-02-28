// updateDB_fixed.js - 修复版数据库更新脚本（包含列名匹配和字符集修复功能）
const mysql = require('mysql2/promise');
const dbConfig = require('./config/dbConfig').config;  // 注意这里使用 .config

/**
 * 修复MySQL字符集排序规则冲突
 * @param {Object} connection - MySQL连接对象
 */
async function fixCollationIssues(connection) {
    console.log('\n=== 修复MySQL字符集排序规则冲突 ===');
    
    try {
        // 1. 检查当前数据库的字符集
        console.log('1. 检查当前字符集配置...');
        const [dbInfo] = await connection.query(`
            SELECT 
                DEFAULT_CHARACTER_SET_NAME,
                DEFAULT_COLLATION_NAME 
            FROM INFORMATION_SCHEMA.SCHEMATA 
            WHERE SCHEMA_NAME = ?
        `, [dbConfig.database]);
        
        console.log(`   当前数据库字符集: ${dbInfo[0].DEFAULT_CHARACTER_SET_NAME}`);
        console.log(`   当前数据库排序规则: ${dbInfo[0].DEFAULT_COLLATION_NAME}\n`);
        
        // 2. 检查每个表的字符集
        console.log('2. 检查表的字符集...');
        const [tables] = await connection.query(`
            SELECT 
                TABLE_NAME,
                TABLE_COLLATION
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ?
            ORDER BY TABLE_NAME
        `, [dbConfig.database]);
        
        console.log('   表排序规则:');
        const tableCollations = {};
        tables.forEach(table => {
            tableCollations[table.TABLE_NAME] = table.TABLE_COLLATION;
            console.log(`   - ${table.TABLE_NAME}: ${table.TABLE_COLLATION}`);
        });
        
        // 3. 检查是否有不一致的排序规则
        const targetCollation = 'utf8mb4_0900_ai_ci'; // MySQL 8.0默认排序规则
        const inconsistentTables = tables.filter(table => 
            table.TABLE_COLLATION !== targetCollation && 
            table.TABLE_COLLATION !== null
        );
        
        if (inconsistentTables.length > 0) {
            console.log(`\n3. 检测到 ${inconsistentTables.length} 个表使用不一致的排序规则:`);
            inconsistentTables.forEach(table => {
                console.log(`   - ${table.TABLE_NAME}: ${table.TABLE_COLLATION} -> ${targetCollation}`);
            });
            
            console.log('\n   开始统一排序规则...');
            
            for (const table of inconsistentTables) {
                console.log(`   - 修改 ${table.TABLE_NAME} 表...`);
                try {
                    await connection.query(`
                        ALTER TABLE \`${table.TABLE_NAME}\` 
                        CONVERT TO CHARACTER SET utf8mb4 COLLATE ${targetCollation}
                    `);
                    console.log(`     ✅ ${table.TABLE_NAME} 修改成功`);
                    
                    // 更新表的字符集后，还需要修改表中的text/varchar列
                    const [columns] = await connection.query(`
                        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
                        FROM INFORMATION_SCHEMA.COLUMNS
                        WHERE TABLE_SCHEMA = ? 
                        AND TABLE_NAME = ?
                        AND CHARACTER_SET_NAME IS NOT NULL
                    `, [dbConfig.database, table.TABLE_NAME]);
                    
                    for (const column of columns) {
                        if (column.COLLATION_NAME !== targetCollation) {
                            await connection.query(`
                                ALTER TABLE \`${table.TABLE_NAME}\`
                                MODIFY \`${column.COLUMN_NAME}\` ${column.DATA_TYPE}
                                CHARACTER SET utf8mb4 COLLATE ${targetCollation}
                            `);
                        }
                    }
                    
                } catch (error) {
                    console.log(`     ⚠️  ${table.TABLE_NAME} 修改失败: ${error.message}`);
                    
                    // 如果修改整个表失败，尝试只修改列
                    if (error.code === 'ER_TOO_BIG_ROWSIZE') {
                        console.log(`     ℹ️  表 ${table.TABLE_NAME} 行大小可能太大，跳过...`);
                    }
                }
            }
            
            console.log('\n✅ 排序规则统一完成！');
            
        } else {
            console.log('\n✅ 所有表已使用一致的排序规则 (utf8mb4_0900_ai_ci)');
        }
        
        // 4. 检查列级别的排序规则
        console.log('\n4. 检查列级别的排序规则一致性...');
        const [columns] = await connection.query(`
            SELECT 
                TABLE_NAME,
                COLUMN_NAME,
                CHARACTER_SET_NAME,
                COLLATION_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ?
            AND CHARACTER_SET_NAME IS NOT NULL
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        `, [dbConfig.database]);
        
        let inconsistentColumns = 0;
        for (const column of columns) {
            if (column.COLLATION_NAME !== targetCollation) {
                if (inconsistentColumns === 0) {
                    console.log('   发现不一致的列排序规则:');
                }
                console.log(`   - ${column.TABLE_NAME}.${column.COLUMN_NAME}: ${column.COLLATION_NAME}`);
                inconsistentColumns++;
            }
        }
        
        if (inconsistentColumns === 0) {
            console.log('   ✅ 所有列已使用一致的排序规则');
        }
        
        // 5. 提供数据库连接配置建议
        console.log('\n5. 数据库连接配置建议:');
        console.log('   在server.js或其他应用中，请确保连接配置包含:');
        console.log(`
        charset: 'utf8mb4',
        collation: 'utf8mb4_0900_ai_ci',
        `);
        
        return {
            success: true,
            inconsistentTables: inconsistentTables.length,
            inconsistentColumns: inconsistentColumns
        };
        
    } catch (error) {
        console.error('\n❌ 字符集修复失败:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 获取表中所有列名
 * @param {Object} connection - MySQL连接对象
 * @param {string} tableName - 表名
 * @param {string} database - 数据库名
 * @returns {Array<string>} 列名数组
 */
async function getTableColumns(connection, tableName, database = null) {
    try {
        if (!database) {
            const [rows] = await connection.query('SELECT DATABASE() as db');
            database = rows[0].db;
        }
        
        const [columns] = await connection.query(`
            SELECT COLUMN_NAME 
            FROM information_schema.COLUMNS 
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
        `, [database, tableName]);
        
        return columns.map(col => col.COLUMN_NAME);
    } catch (error) {
        console.error(`获取表 ${tableName} 的列名失败:`, error.message);
        return [];
    }
}

/**
 * 查找匹配的列名
 * @param {Array<string>} columns - 列名数组
 * @param {Array<string>} patterns - 匹配模式数组
 * @returns {Object} 匹配结果
 */
function findMatchingColumns(columns, patterns) {
    const matches = {};
    
    for (const pattern of patterns) {
        // 精确匹配
        if (columns.includes(pattern)) {
            matches[pattern] = pattern;
            continue;
        }
        
        // 不区分大小写的匹配
        const lowerPattern = pattern.toLowerCase();
        for (const column of columns) {
            if (column.toLowerCase() === lowerPattern) {
                matches[pattern] = column;
                break;
            }
        }
        
        // 如果还没找到，尝试模糊匹配
        if (!matches[pattern]) {
            const fuzzyMatches = columns.filter(column => 
                column.toLowerCase().includes(lowerPattern) || 
                lowerPattern.includes(column.toLowerCase())
            );
            
            if (fuzzyMatches.length === 1) {
                matches[pattern] = fuzzyMatches[0];
            } else if (fuzzyMatches.length > 1) {
                // 多个模糊匹配，记录所有可能
                matches[pattern] = fuzzyMatches;
            }
        }
    }
    
    return matches;
}

/**
 * 智能查询函数 - 自动匹配列名
 * @param {Object} connection - MySQL连接对象
 * @param {string} tableName - 表名
 * @param {Object} queryConfig - 查询配置
 * @param {Array<string>} queryConfig.columns - 需要查询的列
 * @param {Object} queryConfig.where - 查询条件
 * @param {number} queryConfig.limit - 限制结果数量
 * @returns {Array} 查询结果
 */
async function smartQuery(connection, tableName, queryConfig = {}) {
    try {
        // 获取表的实际列名
        const actualColumns = await getTableColumns(connection, tableName);
        if (actualColumns.length === 0) {
            throw new Error(`无法获取表 ${tableName} 的列信息`);
        }
        
        // 构建SELECT部分
        let selectClause = '*';
        if (queryConfig.columns && queryConfig.columns.length > 0) {
            // 匹配用户请求的列名
            const columnMatches = findMatchingColumns(actualColumns, queryConfig.columns);
            const selectedColumns = [];
            
            for (const requestedColumn of queryConfig.columns) {
                const match = columnMatches[requestedColumn];
                if (Array.isArray(match)) {
                    // 多个匹配，使用第一个
                    selectedColumns.push(`\`${match[0]}\` as \`${requestedColumn}\``);
                    console.log(`警告: 列名"${requestedColumn}"有多个匹配: ${match.join(', ')}，使用第一个: ${match[0]}`);
                } else if (match) {
                    if (match !== requestedColumn) {
                        selectedColumns.push(`\`${match}\` as \`${requestedColumn}\``);
                    } else {
                        selectedColumns.push(`\`${match}\``);
                    }
                } else {
                    throw new Error(`未找到列名"${requestedColumn}"的匹配项`);
                }
            }
            
            selectClause = selectedColumns.join(', ');
        }
        
        // 构建WHERE部分
        let whereClause = '';
        const whereValues = [];
        
        if (queryConfig.where && Object.keys(queryConfig.where).length > 0) {
            const whereMatches = findMatchingColumns(actualColumns, Object.keys(queryConfig.where));
            const whereConditions = [];
            
            for (const [key, value] of Object.entries(queryConfig.where)) {
                const matchedColumn = whereMatches[key];
                if (matchedColumn && !Array.isArray(matchedColumn)) {
                    whereConditions.push(`\`${matchedColumn}\` = ?`);
                    whereValues.push(value);
                } else if (Array.isArray(matchedColumn)) {
                    // 多个匹配，使用第一个
                    whereConditions.push(`\`${matchedColumn[0]}\` = ?`);
                    whereValues.push(value);
                    console.log(`警告: WHERE条件列名"${key}"有多个匹配: ${matchedColumn.join(', ')}，使用第一个: ${matchedColumn[0]}`);
                }
            }
            
            if (whereConditions.length > 0) {
                whereClause = 'WHERE ' + whereConditions.join(' AND ');
            }
        }
        
        // 构建LIMIT部分
        const limitClause = queryConfig.limit ? `LIMIT ${queryConfig.limit}` : '';
        
        // 执行查询
        const sql = `SELECT ${selectClause} FROM \`${tableName}\` ${whereClause} ${limitClause}`.trim();
        const [rows] = await connection.query(sql, whereValues);
        
        return rows;
    } catch (error) {
        console.error(`智能查询失败:`, error.message);
        throw error;
    }
}

/**
 * 测试列名匹配功能
 * @param {Object} connection - MySQL连接对象
 */
async function testColumnMatching(connection) {
    console.log('\n=== 测试列名匹配功能 ===');
    
    try {
        // 测试1: 查询courses表的所有列
        console.log('\n1. 获取courses表的所有列名:');
        const coursesColumns = await getTableColumns(connection, 'courses');
        console.log('   Courses表列名:', coursesColumns.join(', '));
        
        // 测试2: 使用智能查询函数
        console.log('\n2. 测试智能查询函数:');
        
        // 测试不同大小写和变体
        const testQueries = [
            {
                name: '查询课程名称和教师',
                config: {
                    columns: ['name', 'teacher', 'location'],
                    limit: 3
                }
            },
            {
                name: '查询特定课程',
                config: {
                    columns: ['NAME', 'TEACHER'],  // 大写
                    where: { name: '高等数学' },
                    limit: 5
                }
            },
            {
                name: '尝试不存在的列名',
                config: {
                    columns: ['course_name', 'instructor'],  // 常见变体
                    limit: 2
                }
            }
        ];
        
        for (const test of testQueries) {
            console.log(`\n   ${test.name}:`);
            try {
                const results = await smartQuery(connection, 'courses', test.config);
                console.log(`   成功获取 ${results.length} 条记录`);
                if (results.length > 0) {
                    console.log('   第一条记录:', JSON.stringify(results[0], null, 2).replace(/\n/g, '\n      '));
                }
            } catch (error) {
                console.log(`   错误: ${error.message}`);
            }
        }
        
        // 测试3: 测试classrooms表
        console.log('\n3. 测试classrooms表查询:');
        try {
            const classroomColumns = await getTableColumns(connection, 'classrooms');
            console.log('   Classrooms表列名:', classroomColumns.join(', '));
            
            const rooms = await smartQuery(connection, 'classrooms', {
                columns: ['id', 'type', 'capacity'],
                where: { type: '多媒体教室' },
                limit: 3
            });
            console.log(`   找到 ${rooms.length} 个多媒体教室`);
        } catch (error) {
            console.log(`   错误: ${error.message}`);
        }
        
    } catch (error) {
        console.error('测试失败:', error.message);
    }
}

async function updateDatabase() {
    console.log('=== 开始更新数据库表结构 ===\n');
    
    // 连接信息
    console.log(`连接数据库: ${dbConfig.database}@${dbConfig.host}:${dbConfig.port}`);
    console.log(`用户名: ${dbConfig.user}\n`);
    
    let connection;
    
    try {
        // 创建连接（显式传递配置）
        connection = await mysql.createConnection({
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            password: dbConfig.password,
            database: dbConfig.database,
            charset: 'utf8mb4',  // 添加字符集配置
            connectTimeout: 5000
        });
        
        console.log('✅ 数据库连接成功\n');
        
        // 第一步：修复字符集排序规则冲突
        await fixCollationIssues(connection);
        
        // 1. 检查classrooms表是否有type字段
        console.log('\n1. 检查classrooms表结构...');
        const [classroomFields] = await connection.query('DESCRIBE classrooms');
        const hasTypeField = classroomFields.some(field => field.Field === 'type');
        
        if (!hasTypeField) {
            console.log('   添加type字段到classrooms表...');
            try {
                await connection.query(`
                    ALTER TABLE classrooms 
                    ADD COLUMN type VARCHAR(50) DEFAULT '多媒体教室'
                `);
                console.log('   ✅ 添加type字段成功');
            } catch (error) {
                console.log('   ❌ 添加type字段失败:', error.message);
            }
        } else {
            console.log('   ℹ️  type字段已存在');
        }
        
        // 2. 根据教室ID更新type字段
        console.log('\n2. 根据教室ID更新type字段...');
        try {
            // 先检查是否有type字段
            const [typeExists] = await connection.query(
                "SELECT COUNT(*) as count FROM information_schema.COLUMNS WHERE TABLE_NAME = 'classrooms' AND COLUMN_NAME = 'type' AND TABLE_SCHEMA = ?",
                [dbConfig.database]
            );
            
            if (typeExists[0].count > 0) {
                await connection.query(`
                    UPDATE classrooms 
                    SET type = CASE 
                        WHEN id LIKE 'A%' THEN '多媒体教室'
                        WHEN id LIKE 'B%' THEN '计算机机房'
                        ELSE '多媒体教室'
                    END
                `);
                console.log('   ✅ 更新教室类型成功');
                
                // 显示更新结果
                const [updatedClassrooms] = await connection.query('SELECT id, type FROM classrooms');
                console.log('   教室类型更新结果:');
                updatedClassrooms.forEach(room => {
                    console.log(`     ${room.id}: ${room.type}`);
                });
            } else {
                console.log('   ℹ️  type字段不存在，跳过更新');
            }
        } catch (error) {
            console.log('   ❌ 更新教室类型失败:', error.message);
        }
        
        // 3. 检查courses表字段并添加缺失字段
        console.log('\n3. 检查并更新courses表字段...');
        const [courseFields] = await connection.query('DESCRIBE courses');
        const courseFieldNames = courseFields.map(field => field.Field);
        
        const columnsToAdd = [
            {name: 'classroom_type', type: 'VARCHAR(50)'},
            {name: 'period_type', type: 'VARCHAR(20)'},
            {name: 'theory_hours', type: 'INT DEFAULT 0'},
            {name: 'lab_hours', type: 'INT DEFAULT 0'},
            {name: 'total_hours', type: 'INT DEFAULT 0'},
            {name: 'class_groups', type: 'TEXT'}
        ];
        
        for (const column of columnsToAdd) {
            if (!courseFieldNames.includes(column.name)) {
                console.log(`   添加 ${column.name} 字段...`);
                try {
                    await connection.query(`ALTER TABLE courses ADD COLUMN ${column.name} ${column.type}`);
                    console.log(`   ✅ 添加 ${column.name} 成功`);
                } catch (error) {
                    console.log(`   ❌ 添加 ${column.name} 失败:`, error.message);
                }
            } else {
                console.log(`   ℹ️  ${column.name} 字段已存在`);
            }
        }
        
        // 4. 检查location字段类型（可能需要修改）
        console.log('\n4. 检查location字段类型...');
        const locationField = courseFields.find(field => field.Field === 'location');
        if (locationField && locationField.Type === 'varchar(10)') {
            console.log('   ℹ️  location字段当前为varchar(10)，可能需要修改为INT以匹配classrooms.id');
            console.log('   注意：如果location存储的是教室ID字符串，需要转换数据类型');
        }
        
        // 5. 为classrooms表添加更多类型的教室
        console.log('\n5. 检查教室类型是否齐全...');
        const [classroomTypes] = await connection.query(`
            SELECT DISTINCT type FROM classrooms WHERE type IS NOT NULL
        `);
        
        if (classroomTypes.length === 0) {
            console.log('   教室类型为空，设置默认类型...');
            const [classrooms] = await connection.query('SELECT id FROM classrooms');
            for (const room of classrooms) {
                const type = room.id.startsWith('A') ? '多媒体教室' : 
                            room.id.startsWith('B') ? '计算机机房' : '多媒体教室';
                await connection.query('UPDATE classrooms SET type = ? WHERE id = ?', [type, room.id]);
            }
            console.log('   ✅ 设置默认教室类型完成');
        }
        
        // 检查是否缺少某些类型的教室
        const existingTypes = classroomTypes.map(t => t.type);
        const neededTypes = ['多媒体教室', '计算机机房', '公用资源', '网络教室'];
        
        console.log('   当前教室类型:', existingTypes.length > 0 ? existingTypes.join(', ') : '无');
        
        // 6. 添加缺失的教室类型
        const missingTypes = neededTypes.filter(type => !existingTypes.includes(type));
        if (missingTypes.length > 0) {
            console.log(`\n6. 添加缺失的教室类型: ${missingTypes.join(', ')}`);
            
            if (missingTypes.includes('公用资源')) {
                try {
                    await connection.query(
                        "INSERT INTO classrooms (id, type, capacity, available_time_slots) VALUES ('C301', '公用资源', 200, '[1,2,3,4,5,6,7,8,9,10]')"
                    );
                    console.log('   ✅ 添加公用资源教室 C301');
                } catch (error) {
                    if (error.code === 'ER_DUP_ENTRY') {
                        console.log('   ℹ️  公用资源教室已存在');
                    } else {
                        console.log('   ❌ 添加公用资源教室失败:', error.message);
                    }
                }
            }
            
            if (missingTypes.includes('网络教室')) {
                try {
                    await connection.query(
                        "INSERT INTO classrooms (id, type, capacity, available_time_slots) VALUES ('D401', '网络教室', 80, '[1,2,3,4,5,6,7,8,9,10]')"
                    );
                    console.log('   ✅ 添加网络教室 D401');
                } catch (error) {
                    if (error.code === 'ER_DUP_ENTRY') {
                        console.log('   ℹ️  网络教室已存在');
                    } else {
                        console.log('   ❌ 添加网络教室失败:', error.message);
                    }
                }
            }
        }
        
        // 7. 显示当前所有教室
        console.log('\n7. 当前所有教室列表:');
        const [allClassrooms] = await connection.query(`
            SELECT id, type, capacity 
            FROM classrooms 
            ORDER BY type, id
        `);
        
        allClassrooms.forEach(room => {
            console.log(`   ${room.id}: ${room.type || '未设置'} (容量: ${room.capacity}人)`);
        });
        
        // 8. 检查courses表数据
        console.log('\n8. 检查courses表数据...');
        const [courseCount] = await connection.query('SELECT COUNT(*) as count FROM courses');
        console.log(`   当前有 ${courseCount[0].count} 门课程`);
        
        if (courseCount[0].count > 0) {
            console.log('   示例课程:');
            const [sampleCourses] = await connection.query(`
                SELECT name, teacher, location 
                FROM courses 
                LIMIT 3
            `);
            sampleCourses.forEach(course => {
                console.log(`   - ${course.name} (${course.teacher}) - 教室: ${course.location}`);
            });
        }
        
        // 9. 测试列名匹配功能
        await testColumnMatching(connection);
        
        console.log('\n🎉 数据库表结构更新和字符集修复完成！');
        
        // 10. 提供最终建议
        console.log('\n🔧 最终建议:');
        console.log('   1. 在server.js中更新连接池配置，添加charset和collation:');
        console.log(`
        const pool = mysql.createPool({
            // ...其他配置
            charset: 'utf8mb4',
            collation: 'utf8mb4_0900_ai_ci',
            // ...其他配置
        });
        `);
        
        console.log('   2. 重新启动server.js服务');
        
    } catch (error) {
        console.error('\n❌ 更新失败:', error.message);
        
        // 友好错误提示
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('🔒 权限错误: 用户名或密码不正确');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('🚫 连接被拒绝: MySQL服务可能未启动');
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            console.error('📂 数据库不存在');
            console.error(`   请在MySQL中创建数据库: ${dbConfig.database}`);
        } else if (error.code === 'ER_CANT_AGGREGATE_2COLLATIONS') {
            console.error('🔤 字符集排序规则冲突:');
            console.error('   请确保所有表和列使用相同的排序规则 (推荐: utf8mb4_0900_ai_ci)');
        }
        
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 数据库连接已关闭');
        }
    }
}

// 如果是直接运行此脚本，则执行
if (require.main === module) {
    updateDatabase().catch(error => {
        console.error('脚本执行失败:', error.message);
        process.exit(1);
    });
} else {
    // 如果是被其他模块引用，导出函数
    module.exports = {
        updateDatabase,
        fixCollationIssues,  // 导出字符集修复函数
        getTableColumns,
        findMatchingColumns,
        smartQuery
    };
}