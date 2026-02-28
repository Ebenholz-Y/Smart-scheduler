// fixDatabase.js - 修复数据库结构
const mysql = require('mysql2/promise');
const dbConfig = require('./config/dbConfig');

async function fixDatabase() {
    console.log('=== 修复数据库结构 ===\n');
    
    const connection = await mysql.createConnection(dbConfig);
    
    try {
        console.log('✅ 数据库连接成功\n');
        
        // 1. 检查classrooms表是否有type字段
        console.log('1. 检查classrooms表结构...');
        const [fields] = await connection.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'classrooms' 
            AND TABLE_SCHEMA = ?
        `, [dbConfig.database]);
        
        const hasTypeField = fields.some(f => f.COLUMN_NAME === 'type');
        
        if (!hasTypeField) {
            console.log('   添加type字段...');
            await connection.query(`
                ALTER TABLE classrooms 
                ADD COLUMN type VARCHAR(50)
            `);
            
            // 设置教室类型
            await connection.query(`
                UPDATE classrooms 
                SET type = CASE 
                    WHEN id LIKE 'A%' THEN '多媒体教室'
                    WHEN id LIKE 'B%' THEN '计算机机房'
                    ELSE '多媒体教室'
                END
            `);
            console.log('   ✅ 添加并设置type字段完成');
        } else {
            console.log('   ℹ️ type字段已存在');
        }
        
        // 2. 检查courses表的字段
        console.log('\n2. 检查courses表字段...');
        const [courseFields] = await connection.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'courses' 
            AND TABLE_SCHEMA = ?
        `, [dbConfig.database]);
        
        const courseFieldNames = courseFields.map(f => f.COLUMN_NAME);
        
        const columnsToAdd = [
            {name: 'classroom_type', sql: 'VARCHAR(50)'},
            {name: 'period_type', sql: 'VARCHAR(20)'},
            {name: 'theory_hours', sql: 'INT DEFAULT 0'},
            {name: 'lab_hours', sql: 'INT DEFAULT 0'},
            {name: 'total_hours', sql: 'INT DEFAULT 0'},
            {name: 'class_groups', sql: 'TEXT'}
        ];
        
        for (const column of columnsToAdd) {
            if (!courseFieldNames.includes(column.name)) {
                console.log(`   添加 ${column.name} 字段...`);
                await connection.query(`ALTER TABLE courses ADD COLUMN ${column.name} ${column.sql}`);
                console.log(`   ✅ ${column.name} 字段添加成功`);
            }
        }
        
        // 3. 添加缺失的教室
        console.log('\n3. 添加缺失的教室类型...');
        
        const neededRooms = [
            {id: 'C301', type: '公用资源', capacity: 200},
            {id: 'D401', type: '网络教室', capacity: 80}
        ];
        
        for (const room of neededRooms) {
            try {
                await connection.query(
                    'INSERT IGNORE INTO classrooms (id, type, capacity) VALUES (?, ?, ?)',
                    [room.id, room.type, room.capacity]
                );
                console.log(`   ✅ 检查/添加教室 ${room.id} (${room.type})`);
            } catch (error) {
                if (error.code === 'ER_DUP_ENTRY') {
                    console.log(`   ℹ️  教室 ${room.id} 已存在`);
                } else {
                    console.log(`   ❌ 添加教室 ${room.id} 失败: ${error.message}`);
                }
            }
        }
        
        // 4. 验证修复结果
        console.log('\n4. 验证修复结果...');
        
        // 检查classrooms表
        const [classroomResult] = await connection.query('DESCRIBE classrooms');
        console.log('   classrooms表字段:');
        classroomResult.forEach(field => {
            console.log(`     ${field.Field}: ${field.Type}`);
        });
        
        // 检查courses表
        const [courseResult] = await connection.query('DESCRIBE courses');
        console.log('   courses表字段:');
        courseResult.forEach(field => {
            console.log(`     ${field.Field}: ${field.Type}`);
        });
        
        // 显示教室
        const [rooms] = await connection.query('SELECT id, type, capacity FROM classrooms');
        console.log('\n   当前教室列表:');
        rooms.forEach(room => {
            console.log(`     ${room.id}: ${room.type || '无类型'} (${room.capacity}人)`);
        });
        
        console.log('\n🎉 数据库修复完成！');
        console.log('现在可以运行 node importExcelDataV2.js 导入数据');
        
    } catch (error) {
        console.error('❌ 修复失败:', error.message);
    } finally {
        await connection.end();
    }
}

fixDatabase();