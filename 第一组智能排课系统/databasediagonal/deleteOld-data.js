// delete_old_classrooms.js - 删除旧测试教室
const mysql = require('mysql2/promise');
const dbConfig = require('./config/dbConfig');

async function deleteOldClassrooms() {
    console.log('=== 删除旧测试教室 ===\n');
    
    const connection = await mysql.createConnection(dbConfig.config);
    
    try {
        console.log('✅ 数据库连接成功\n');
        
        const oldClassrooms = ['A101', 'A102', 'B201', 'B202', 'C301', 'C302', 'D401'];
        
        // 1. 检查是否有课程使用这些教室
        console.log('1. 检查教室使用情况...');
        const [usedCount] = await connection.query(
            'SELECT COUNT(*) as count FROM courses WHERE location IN (?)',
            [oldClassrooms]
        );
        
        if (usedCount[0].count > 0) {
            console.log(`   ⚠️  有 ${usedCount[0].count} 门课程使用这些教室`);
            
            // 查看具体哪些课程
            const [courses] = await connection.query(`
                SELECT c.id, c.name, c.location, cl.type, cl.capacity
                FROM courses c
                JOIN classrooms cl ON c.location = cl.id
                WHERE c.location IN (?)
                LIMIT 5
            `, [oldClassrooms]);
            
            console.log('   示例课程:');
            courses.forEach(course => {
                console.log(`     ${course.name} - 使用教室 ${course.location} (${course.type}, ${course.capacity}人)`);
            });
            
            console.log('\n   将自动为这些课程分配新教室...');
            
            // 为这些课程分配新教室（同类型）
            for (const classroomId of oldClassrooms) {
                // 获取该教室的类型
                const [classroomInfo] = await connection.query(
                    'SELECT type FROM classrooms WHERE id = ?',
                    [classroomId]
                );
                
                if (classroomInfo.length > 0) {
                    const classroomType = classroomInfo[0].type;
                    
                    // 找到同类型的另一个教室（不在删除列表中）
                    const [alternativeRooms] = await connection.query(`
                        SELECT id 
                        FROM classrooms 
                        WHERE type = ? 
                        AND id NOT IN (?)
                        LIMIT 1
                    `, [classroomType, oldClassrooms]);
                    
                    if (alternativeRooms.length > 0) {
                        const newRoomId = alternativeRooms[0].id;
                        
                        // 更新课程
                        const [updateResult] = await connection.query(
                            'UPDATE courses SET location = ? WHERE location = ?',
                            [newRoomId, classroomId]
                        );
                        
                        if (updateResult.affectedRows > 0) {
                            console.log(`     将教室 ${classroomId} 的 ${updateResult.affectedRows} 门课程迁移到 ${newRoomId}`);
                        }
                    } else {
                        console.log(`     ⚠️  找不到 ${classroomType} 类型的替代教室，将课程location设为NULL`);
                        await connection.query(
                            'UPDATE courses SET location = NULL WHERE location = ?',
                            [classroomId]
                        );
                    }
                }
            }
        } else {
            console.log('   ✅ 没有课程使用这些教室，可以直接删除');
        }
        
        // 2. 删除旧教室
        console.log('\n2. 删除旧教室...');
        const [deleteResult] = await connection.query(
            'DELETE FROM classrooms WHERE id IN (?)',
            [oldClassrooms]
        );
        
        console.log(`   ✅ 删除了 ${deleteResult.affectedRows} 间旧教室`);
        
        // 3. 验证删除结果
        console.log('\n3. 验证删除结果...');
        
        // 检查这些教室是否还存在
        const [remaining] = await connection.query(
            'SELECT COUNT(*) as count FROM classrooms WHERE id IN (?)',
            [oldClassrooms]
        );
        
        if (remaining[0].count === 0) {
            console.log('   ✅ 所有旧教室已成功删除');
        } else {
            console.log(`   ❌ 仍有 ${remaining[0].count} 间旧教室未删除`);
        }
        
        // 显示当前教室数量
        const [totalClassrooms] = await connection.query('SELECT COUNT(*) as count FROM classrooms');
        console.log(`   当前教室总数: ${totalClassrooms[0].count}`);
        
        // 按类型统计
        const [byType] = await connection.query(`
            SELECT type, COUNT(*) as count 
            FROM classrooms 
            GROUP BY type 
            ORDER BY type
        `);
        
        console.log('   教室类型分布:');
        byType.forEach(row => {
            console.log(`     ${row.type}: ${row.count} 间`);
        });
        
        console.log('\n🎉 旧教室删除完成！');
        
    } catch (error) {
        console.error('❌ 删除失败:', error.message);
    } finally {
        await connection.end();
        console.log('\n数据库连接已关闭');
    }
}

deleteOldClassrooms();