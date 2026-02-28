// updateDB_fixed.js - 修复版数据库更新脚本
const mysql = require('mysql2/promise');
const dbConfig = require('./config/dbConfig');

async function updateDatabase() {
    console.log('=== 开始更新数据库表结构 ===\n');
    
    const connection = await mysql.createConnection(dbConfig);
    
    try {
        console.log('✅ 数据库连接成功\n');
        
        // 1. 检查classrooms表是否有type字段
        console.log('1. 检查classrooms表结构...');
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
        
        console.log('\n🎉 数据库表结构更新完成！');
        console.log('\n下一步:');
        console.log('1. 如果有现有课程数据需要清理，可以运行: DELETE FROM courses;');
        console.log('2. 运行 node importExcelDataV2.js 导入Excel数据');
        
    } catch (error) {
        console.error('❌ 更新失败:', error.message);
        console.error('详细错误:', error);
    } finally {
        await connection.end();
        console.log('\n数据库连接已关闭');
    }
}

updateDatabase();