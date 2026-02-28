// create_course_schedule_table.js - 仅创建course_schedule表
const mysql = require('mysql2/promise');
const dbConfig = require('./config/dbConfig').config;

async function createCourseScheduleTable() {
    console.log('=== 创建course_schedule表 ===\n');
    
    let connection;
    try {
        // 1. 连接数据库
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ 数据库连接成功');
        
        // 2. 检查course_schedule表是否已存在
        console.log('\n🔍 检查course_schedule表...');
        const [existingTables] = await connection.query(`
            SELECT TABLE_NAME 
            FROM information_schema.tables 
            WHERE table_schema = ? AND table_name = 'course_schedule'
        `, [dbConfig.database]);
        
        if (existingTables.length > 0) {
            console.log('✅ course_schedule表已存在');
            
            // 显示表结构
            const [tableInfo] = await connection.query('DESCRIBE course_schedule');
            console.log('\n📋 表结构:');
            tableInfo.forEach(column => {
                console.log(`   ${column.Field} (${column.Type})`);
            });
            
            // 检查外键
            const [foreignKeys] = await connection.query(`
                SELECT 
                    CONSTRAINT_NAME,
                    COLUMN_NAME,
                    REFERENCED_TABLE_NAME,
                    REFERENCED_COLUMN_NAME
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = ? 
                    AND TABLE_NAME = 'course_schedule'
                    AND REFERENCED_TABLE_NAME IS NOT NULL
            `, [dbConfig.database]);
            
            if (foreignKeys.length > 0) {
                console.log('\n🔗 外键约束:');
                foreignKeys.forEach(fk => {
                    console.log(`   ${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`);
                });
            }
            
            return;
        }
        
        // 3. 检查依赖表是否存在
        console.log('\n🔍 检查依赖表...');
        
        const [coursesExist] = await connection.query(`
            SELECT TABLE_NAME 
            FROM information_schema.tables 
            WHERE table_schema = ? AND table_name = 'courses'
        `, [dbConfig.database]);
        
        const [classroomsExist] = await connection.query(`
            SELECT TABLE_NAME 
            FROM information_schema.tables 
            WHERE table_schema = ? AND table_name = 'classrooms'
        `, [dbConfig.database]);
        
        if (coursesExist.length === 0) {
            console.error('❌ courses表不存在，请先创建courses表');
            console.log('   可以运行 importExcelDataV2.js 创建courses表');
            return;
        }
        
        if (classroomsExist.length === 0) {
            console.error('❌ classrooms表不存在，请先创建classrooms表');
            console.log('   可以运行 importExcelDataV2.js 创建classrooms表');
            return;
        }
        
        console.log('✅ 依赖表存在');
        
        // 4. 创建course_schedule表
        console.log('\n🛠️  创建course_schedule表...');
        await connection.query(`
            CREATE TABLE course_schedule (
                id INT AUTO_INCREMENT PRIMARY KEY,
                course_id INT NOT NULL,
                day TINYINT NOT NULL COMMENT '星期一=1, 星期二=2, 星期三=3, 星期四=4, 星期五=5',
                period TINYINT NOT NULL COMMENT '第几节课（1-11节）',
                location VARCHAR(10) NOT NULL COMMENT '教室编号',
                time VARCHAR(50) COMMENT '具体时间描述（如：08:00-08:45）',
                
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY (location) REFERENCES classrooms(id) ON DELETE RESTRICT,
                
                INDEX idx_course (course_id),
                INDEX idx_location (location),
                UNIQUE KEY unique_slot (location, day, period)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        `);
        
        console.log('✅ course_schedule表创建成功');
        
        // 5. 验证表结构
        console.log('\n🔍 验证表结构...');
        const [tableStructure] = await connection.query('DESCRIBE course_schedule');
        console.log('📋 表结构详情:');
        tableStructure.forEach(column => {
            console.log(`   ${column.Field}: ${column.Type} ${column.Null === 'NO' ? 'NOT NULL' : ''} ${column.Key || ''}`);
        });
        
        // 6. 验证外键
        console.log('\n🔗 验证外键约束...');
        const [constraints] = await connection.query(`
            SELECT 
                CONSTRAINT_NAME,
                TABLE_NAME,
                COLUMN_NAME,
                REFERENCED_TABLE_NAME,
                REFERENCED_COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = ? 
                AND TABLE_NAME = 'course_schedule'
        `, [dbConfig.database]);
        
        console.log('   外键约束:');
        constraints.forEach(constraint => {
            if (constraint.REFERENCED_TABLE_NAME) {
                console.log(`   ${constraint.COLUMN_NAME} -> ${constraint.REFERENCED_TABLE_NAME}.${constraint.REFERENCED_COLUMN_NAME}`);
            }
        });
        
        // 7. 验证唯一约束
        console.log('\n🔒 验证唯一约束...');
        const [uniqueConstraints] = await connection.query(`
            SELECT 
                INDEX_NAME,
                COLUMN_NAME,
                NON_UNIQUE
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = ? 
                AND TABLE_NAME = 'course_schedule'
                AND INDEX_NAME != 'PRIMARY'
            ORDER BY INDEX_NAME, SEQ_IN_INDEX
        `, [dbConfig.database]);
        
        console.log('   索引和约束:');
        uniqueConstraints.forEach(index => {
            console.log(`   ${index.INDEX_NAME}: ${index.COLUMN_NAME} (${index.NON_UNIQUE === 0 ? '唯一' : '非唯一'})`);
        });
        
        console.log('\n🎉 course_schedule表创建完成！');
        console.log('\n📋 表功能说明:');
        console.log('   1. 支持一门课程多时间段排课（一周多天上课）');
        console.log('   2. 防止教室时间冲突（unique_slot约束）');
        console.log('   3. 外键约束确保数据完整性');
        console.log('   4. 为查询优化设置了索引');
        console.log('\n💡 使用建议:');
        console.log('   1. 排课算法结果应写入此表');
        console.log('   2. 查询课程时间表时，JOIN此表获取排课信息');
        console.log('   3. 更新server.js中的相关查询以使用此表');
        
    } catch (error) {
        console.error('\n❌ 创建course_schedule表失败:', error.message);
        
        if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_CANNOT_ADD_FOREIGN') {
            console.error('   外键约束失败，请确保courses和classrooms表已存在且有数据');
        }
        
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 数据库连接已关闭');
        }
    }
}

// 运行主函数
if (require.main === module) {
    createCourseScheduleTable().catch(error => {
        console.error('脚本执行失败:', error.message);
        process.exit(1);
    });
}

module.exports = { createCourseScheduleTable };