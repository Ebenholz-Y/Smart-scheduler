// importExcelDataV2.js - 改进版数据导入脚本（安全版）- 支持新表结构
const xlsx = require('xlsx');
const mysql = require('mysql2/promise');
const dbConfig = require('./config/dbConfig').config;
const fs = require('fs');

// 数据库环境检查
async function checkDatabaseEnvironment() {
    console.log('🔍 检查数据库环境...\n');
    
    let connection;
    try {
        // 尝试连接数据库
        connection = await mysql.createConnection({
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            password: dbConfig.password,
            connectTimeout: 5000
        });
        
        // 1. 检查数据库版本
        const [versionResult] = await connection.query('SELECT VERSION() as version');
        console.log(`✅ MySQL版本: ${versionResult[0].version}`);
        
        // 2. 检查数据库是否存在
        const [dbResult] = await connection.query('SELECT DATABASE() as db');
        const currentDb = dbResult[0].db;
        
        if (currentDb === null) {
            console.log(`⚠️  未选择数据库，尝试选择: ${dbConfig.database}`);
            try {
                await connection.query(`USE ${dbConfig.database}`);
                console.log(`✅ 已选择数据库: ${dbConfig.database}`);
            } catch (e) {
                console.error(`❌ 数据库不存在: ${dbConfig.database}`);
                console.error(`   请在MySQL中创建数据库: CREATE DATABASE ${dbConfig.database};`);
                return false;
            }
        } else {
            console.log(`✅ 当前数据库: ${currentDb}`);
        }
        
        // 3. 检查必要表是否存在
        const [tables] = await connection.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = ?
        `, [dbConfig.database]);
        
        const requiredTables = ['classrooms', 'courses'];
        const existingTables = tables.map(t => t.table_name);
        
        console.log(`✅ 当前数据库中有 ${existingTables.length} 张表`);
        
        const missingTables = requiredTables.filter(t => !existingTables.includes(t));
        
        if (missingTables.length > 0) {
            console.warn(`⚠️  缺少必要表: ${missingTables.join(', ')}`);
            console.log('可以继续执行，脚本会尝试创建缺失的表');
        } else {
            console.log(`✅ 表结构完整 (${existingTables.length} 张表)`);
        }
        
        return true;
        
    } catch (error) {
        console.error('❌ 数据库连接失败:');
        console.error(`   错误: ${error.message}`);
        
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('\n🔒 权限错误: 请检查用户名和密码是否正确');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('\n🚫 连接被拒绝: 请确保MySQL服务已启动 (net start mysql)');
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            console.error('\n📂 数据库不存在:');
            console.error(`   请在MySQL中创建数据库: ${dbConfig.database}`);
        }
        
        return false;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// 创建course_schedule表（如果不存在）
async function createCourseScheduleTableIfNotExists(connection) {
    console.log('📋 检查course_schedule表...');
    
    try {
        // 检查course_schedule表是否存在
        const [tables] = await connection.query(`
            SELECT TABLE_NAME 
            FROM information_schema.tables 
            WHERE table_schema = ? AND table_name = 'course_schedule'
        `, [dbConfig.database]);
        
        if (tables.length > 0) {
            console.log('✅ course_schedule表已存在，跳过创建步骤');
            
            // 检查表中是否有数据
            const [rowCount] = await connection.query('SELECT COUNT(*) as count FROM course_schedule');
            console.log(`   📊 表中已有 ${rowCount[0].count} 条排课记录`);
            
            return false; // 表已存在，无需创建
        }
        
        console.log('🛠️  course_schedule表不存在，开始创建...');
        
        // 创建course_schedule表（按照队长建议的结构）
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
        console.log('   📝 表结构说明：');
        console.log('      - course_id: 课程ID，关联courses表');
        console.log('      - day: 星期几（1-5）');
        console.log('      - period: 第几节课（1-11）');
        console.log('      - location: 教室编号，关联classrooms表');
        console.log('      - unique_slot: 唯一约束，防止教室时间冲突');
        
        return true; // 表已创建
        
    } catch (error) {
        console.error('❌ 创建course_schedule表失败:', error.message);
        
        // 如果外键约束失败，可能是因为courses或classrooms表不存在，继续执行其他表创建
        if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_CANNOT_ADD_FOREIGN') {
            console.log('   ℹ️  外键约束失败，将继续执行其他操作，请确保courses和classrooms表已存在');
        }
        
        throw error;
    }
}

// 创建classrooms表（如果不存在） - 保持不变
async function createClassroomsTableIfNotExists(connection) {
    console.log('📋 检查classrooms表...');
    
    try {
        // 检查classrooms表是否存在
        const [tables] = await connection.query(`
            SELECT TABLE_NAME 
            FROM information_schema.tables 
            WHERE table_schema = ? AND table_name = 'classrooms'
        `, [dbConfig.database]);
        
        if (tables.length > 0) {
            console.log('✅ classrooms表已存在，跳过创建步骤');
            
            // 检查表中是否有数据
            const [rowCount] = await connection.query('SELECT COUNT(*) as count FROM classrooms');
            console.log(`   📊 表中已有 ${rowCount[0].count} 条教室数据`);
            
            return false; // 表已存在，无需创建
        }
        
        console.log('🛠️  classrooms表不存在，开始创建...');
        
        // 创建classrooms表（保持现有结构）
        await connection.query(`
            CREATE TABLE classrooms (
                id VARCHAR(10) PRIMARY KEY,
                capacity INT,
                available_time_slots TEXT,
                type VARCHAR(50) DEFAULT '多媒体教室',
                room_location VARCHAR(100)
            )
        `);
        console.log('✅ classrooms表创建成功');
        
        // 插入64间真实教室数据
        console.log('📥 插入64间教室数据...');
        
        const classroomsData = [
            // 北教楼 - 多媒体大教室
            { id: 'N-101', capacity: 150, type: '多媒体大教室', room_location: '北教1楼101阶梯教室' },
            { id: 'N-102', capacity: 150, type: '多媒体大教室', room_location: '北教1楼102阶梯教室' },
            
            // 北教楼 - 计算机机房
            { id: 'N-201', capacity: 80, type: '计算机机房', room_location: '北教2楼201机房' },
            { id: 'N-202', capacity: 80, type: '计算机机房', room_location: '北教2楼202机房' },
            
            // 北教3楼 - 多媒体教室
            { id: 'N-301', capacity: 90, type: '多媒体教室', room_location: '北教3楼301室' },
            { id: 'N-302', capacity: 90, type: '多媒体教室', room_location: '北教3楼302室' },
            { id: 'N-303', capacity: 90, type: '多媒体教室', room_location: '北教3楼303室' },
            { id: 'N-304', capacity: 90, type: '多媒体教室', room_location: '北教3楼304室' },
            { id: 'N-305', capacity: 90, type: '多媒体教室', room_location: '北教3楼305室' },
            { id: 'N-306', capacity: 90, type: '多媒体教室', room_location: '北教3楼306室' },
            { id: 'N-307', capacity: 90, type: '多媒体教室', room_location: '北教3楼307室' },
            { id: 'N-308', capacity: 90, type: '多媒体教室', room_location: '北教3楼308室' },
            { id: 'N-309', capacity: 90, type: '多媒体教室', room_location: '北教3楼309室' },
            
            // 北教4楼 - 多媒体教室
            { id: 'N-401', capacity: 90, type: '多媒体教室', room_location: '北教4楼401室' },
            { id: 'N-402', capacity: 90, type: '多媒体教室', room_location: '北教4楼402室' },
            { id: 'N-403', capacity: 90, type: '多媒体教室', room_location: '北教4楼403室' },
            { id: 'N-404', capacity: 90, type: '多媒体教室', room_location: '北教4楼404室' },
            { id: 'N-405', capacity: 90, type: '多媒体教室', room_location: '北教4楼405室' },
            { id: 'N-406', capacity: 90, type: '多媒体教室', room_location: '北教4楼406室' },
            { id: 'N-407', capacity: 90, type: '多媒体教室', room_location: '北教4楼407室' },
            { id: 'N-408', capacity: 90, type: '多媒体教室', room_location: '北教4楼408室' },
            { id: 'N-409', capacity: 90, type: '多媒体教室', room_location: '北教4楼409室' },
            
            // 北教5楼 - 多媒体教室
            { id: 'N-501', capacity: 90, type: '多媒体教室', room_location: '北教5楼501室' },
            { id: 'N-502', capacity: 90, type: '多媒体教室', room_location: '北教5楼502室' },
            { id: 'N-503', capacity: 90, type: '多媒体教室', room_location: '北教5楼503室' },
            { id: 'N-504', capacity: 90, type: '多媒体教室', room_location: '北教5楼504室' },
            { id: 'N-505', capacity: 90, type: '多媒体教室', room_location: '北教5楼505室' },
            { id: 'N-506', capacity: 90, type: '多媒体教室', room_location: '北教5楼506室' },
            { id: 'N-507', capacity: 90, type: '多媒体教室', room_location: '北教5楼507室' },
            { id: 'N-508', capacity: 90, type: '多媒体教室', room_location: '北教5楼508室' },
            { id: 'N-509', capacity: 90, type: '多媒体教室', room_location: '北教5楼509室' },
            
            // 特殊教室
            { id: 'ONLINE', capacity: null, type: '网络教室', room_location: '教师自行安排在线教学' },
            { id: 'PUBLIC', capacity: null, type: '公用资源', room_location: '外出学习/实践基地' },
            
            // 南教楼 - 多媒体大教室
            { id: 'S-101', capacity: 150, type: '多媒体大教室', room_location: '南教1楼101阶梯教室' },
            { id: 'S-102', capacity: 150, type: '多媒体大教室', room_location: '南教1楼102阶梯教室' },
            
            // 南教楼 - 计算机机房
            { id: 'S-201', capacity: 80, type: '计算机机房', room_location: '南教2楼201机房' },
            { id: 'S-202', capacity: 80, type: '计算机机房', room_location: '南教2楼202机房' },
            
            // 南教3楼 - 多媒体教室
            { id: 'S-301', capacity: 90, type: '多媒体教室', room_location: '南教3楼301室' },
            { id: 'S-302', capacity: 90, type: '多媒体教室', room_location: '南教3楼302室' },
            { id: 'S-303', capacity: 90, type: '多媒体教室', room_location: '南教3楼303室' },
            { id: 'S-304', capacity: 90, type: '多媒体教室', room_location: '南教3楼304室' },
            { id: 'S-305', capacity: 90, type: '多媒体教室', room_location: '南教3楼305室' },
            { id: 'S-306', capacity: 90, type: '多媒体教室', room_location: '南教3楼306室' },
            { id: 'S-307', capacity: 90, type: '多媒体教室', room_location: '南教3楼307室' },
            { id: 'S-308', capacity: 90, type: '多媒体教室', room_location: '南教3楼308室' },
            { id: 'S-309', capacity: 90, type: '多媒体教室', room_location: '南教3楼309室' },
            
            // 南教4楼 - 多媒体教室
            { id: 'S-401', capacity: 90, type: '多媒体教室', room_location: '南教4楼401室' },
            { id: 'S-402', capacity: 90, type: '多媒体教室', room_location: '南教4楼402室' },
            { id: 'S-403', capacity: 90, type: '多媒体教室', room_location: '南教4楼403室' },
            { id: 'S-404', capacity: 90, type: '多媒体教室', room_location: '南教4楼404室' },
            { id: 'S-405', capacity: 90, type: '多媒体教室', room_location: '南教4楼405室' },
            { id: 'S-406', capacity: 90, type: '多媒体教室', room_location: '南教4楼406室' },
            { id: 'S-407', capacity: 90, type: '多媒体教室', room_location: '南教4楼407室' },
            { id: 'S-408', capacity: 90, type: '多媒体教室', room_location: '南教4楼408室' },
            { id: 'S-409', capacity: 90, type: '多媒体教室', room_location: '南教4楼409室' },
            
            // 南教5楼 - 多媒体教室
            { id: 'S-501', capacity: 90, type: '多媒体教室', room_location: '南教5楼501室' },
            { id: 'S-502', capacity: 90, type: '多媒体教室', room_location: '南教5楼502室' },
            { id: 'S-503', capacity: 90, type: '多媒体教室', room_location: '南教5楼503室' },
            { id: 'S-504', capacity: 90, type: '多媒体教室', room_location: '南教5楼504室' },
            { id: 'S-505', capacity: 90, type: '多媒体教室', room_location: '南教5楼505室' },
            { id: 'S-506', capacity: 90, type: '多媒体教室', room_location: '南教5楼506室' },
            { id: 'S-507', capacity: 90, type: '多媒体教室', room_location: '南教5楼507室' },
            { id: 'S-508', capacity: 90, type: '多媒体教室', room_location: '南教5楼508室' },
            { id: 'S-509', capacity: 90, type: '多媒体教室', room_location: '南教5楼509室' }
        ];
        
        // 批量插入教室数据
        for (const room of classroomsData) {
            await connection.query(
                `INSERT INTO classrooms (id, capacity, available_time_slots, type, room_location) 
                 VALUES (?, ?, ?, ?, ?)`,
                [room.id, room.capacity, null, room.type, room.room_location]
            );
        }
        
        console.log(`✅ 成功插入 ${classroomsData.length} 间教室数据`);
        
        // 统计教室类型
        const [typeStats] = await connection.query(`
            SELECT type, COUNT(*) as count 
            FROM classrooms 
            GROUP BY type 
            ORDER BY count DESC
        `);
        
        console.log('📊 教室类型分布:');
        typeStats.forEach(stat => {
            console.log(`   ${stat.type}: ${stat.count}间`);
        });
        
        return true; // 表已创建
        
    } catch (error) {
        console.error('❌ 创建classrooms表失败:', error.message);
        throw error;
    }
}

async function importExcelData() {
    console.log('=== Excel数据导入（支持新表结构） ===\n');
    
    // 检查数据库环境
    const dbOk = await checkDatabaseEnvironment();
    if (!dbOk) {
        console.log('\n❌ 数据库环境异常，脚本终止');
        return;
    }
    
    console.log('📁 检查Excel文件...');
    const excelFile = '25-26（1）课程情况.xlsx';
    
    if (!fs.existsSync(excelFile)) {
        console.error(`❌ Excel文件不存在: ${excelFile}`);
        console.log('请将Excel文件放在项目根目录下');
        return;
    }
    
    console.log(`✅ 找到Excel文件: ${excelFile}`);
    
    let connection;
    try {
        // 创建连接（显式传递配置）
        connection = await mysql.createConnection({
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            password: dbConfig.password,
            database: dbConfig.database
        });
        
        console.log('✅ 数据库连接成功\n');
        
        // 🔴 新增：创建classrooms表（如果不存在）
        await createClassroomsTableIfNotExists(connection);
        
        // 🔴 新增：创建course_schedule表（如果不存在）
        await createCourseScheduleTableIfNotExists(connection);
        
        // 检查courses表是否存在
        const [courseTables] = await connection.query(`
            SELECT TABLE_NAME 
            FROM information_schema.tables 
            WHERE table_schema = ? AND table_name = 'courses'
        `, [dbConfig.database]);
        
        if (courseTables.length === 0) {
            console.log('⚠️  courses表不存在，将创建...');
            
            // 创建courses表（保持现有结构）
            await connection.query(`
                CREATE TABLE courses (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    name VARCHAR(100) NOT NULL,
                    students INT NOT NULL,
                    teacher VARCHAR(50) NOT NULL,
                    teacher_id VARCHAR(20),
                    hours INT NOT NULL,
                    credits INT NOT NULL,
                    classroom_type VARCHAR(50),
                    period_type VARCHAR(20),
                    theory_hours INT,
                    lab_hours INT,
                    total_hours INT,
                    class_groups TEXT
                )
            `);
            console.log('✅ courses表创建成功');
        } else {
            console.log('✅ courses表已存在');
            
            // 检查courses表是否有day和period字段（旧结构）
            const [fields] = await connection.query('DESCRIBE courses');
            const fieldNames = fields.map(f => f.Field);
            
            if (fieldNames.includes('day') || fieldNames.includes('period')) {
                console.log('⚠️  发现旧结构字段(day/period)，建议迁移到course_schedule表');
                console.log('   可以运行专门的迁移脚本或手动处理');
            }
        }
        
        // 1. 读取Excel数据
        console.log('\n1. 读取Excel数据...');
        const workbook = xlsx.readFile(excelFile);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawData = xlsx.utils.sheet_to_json(worksheet);
        
        console.log(`   读取到 ${rawData.length} 行数据\n`);
        
        // 2. 获取教室映射关系（按类型和容量排序）
        console.log('2. 获取教室映射关系...');
        const [classrooms] = await connection.query(`
            SELECT id, type, capacity 
            FROM classrooms 
            WHERE type IS NOT NULL 
            ORDER BY type, capacity DESC
        `);
        
        // 按类型分组教室，并创建负载均衡指针
        const classroomByType = {};
        const classroomUsage = {};    // 记录每个教室的使用次数
        
        classrooms.forEach(room => {
            if (!classroomByType[room.type]) {
                classroomByType[room.type] = [];
            }
            classroomByType[room.type].push(room);
            classroomUsage[room.id] = 0; // 初始化使用次数为0
        });
        
        console.log('   可用教室类型:');
        Object.keys(classroomByType).forEach(type => {
            console.log(`     ${type}: ${classroomByType[type].length} 间教室`);
        });
        
        // 3. 询问是否清空现有课程数据
        console.log('\n3. 检查现有课程数据...');
        const [oldCount] = await connection.query('SELECT COUNT(*) as count FROM courses');
        
        if (oldCount[0].count > 0) {
            console.warn(`   ⚠️  当前已有 ${oldCount[0].count} 门课程`);
            console.log('   导入新数据将覆盖现有课程数据。');
            
            // 确认是否继续
            const readline = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            await new Promise((resolve) => {
                readline.question('   是否继续导入？(y/N): ', (answer) => {
                    readline.close();
                    if (answer.toLowerCase() !== 'y') {
                        console.log('❌ 用户取消导入');
                        process.exit(0);
                    }
                    resolve();
                });
            });
            
            console.log('   清空旧数据...');
            await connection.query('DELETE FROM courses');
            console.log('   ✅ 已清空旧数据');
            
            // 注意：不清空course_schedule表，因为排课数据是独立的
            const [scheduleCount] = await connection.query('SELECT COUNT(*) as count FROM course_schedule');
            if (scheduleCount[0].count > 0) {
                console.log(`   ℹ️  course_schedule表有 ${scheduleCount[0].count} 条排课记录，保持不动`);
            }
        } else {
            console.log('   ✅ 当前无课程数据，可以直接导入');
        }
        
        // 4. 按学生人数排序课程，优先处理人数多的课程
        console.log('\n4. 处理课程数据（按学生人数排序）...');
        
        const processedCourses = [];
        const skippedRows = [];
        
        for (let i = 0; i < rawData.length; i++) {
            const row = rawData[i];
            
            try {
                if (!row['课程名称'] || !row['教师名称']) {
                    skippedRows.push(`第${i+1}行: 缺少课程名称或教师名称`);
                    continue;
                }
                
                const courseName = row['课程名称'].toString().trim();
                const teacher = row['教师名称'].toString().trim();
                const classroomType = row['场地类别'] ? 
                    row['场地类别'].toString().trim() : '多媒体教室';
                const periodType = row['学时类型'] ? 
                    row['学时类型'].toString().trim() : '理论';
                const classGroups = row['教学班组成'] ? 
                    row['教学班组成'].toString().trim() : '';
                
                const theoryHours = parseInt(row['课程理论总学时']) || 0;
                const labHours = parseInt(row['课程实验总学时']) || 0;
                const totalHours = parseInt(row['课程总学时']) || theoryHours + labHours;
                
                const weeklyHours = totalHours > 0 ? Math.ceil(totalHours / 16) : 2;
                
                const classList = classGroups.split(';').filter(c => c.trim() !== '');
                const estimatedStudents = classList.length > 0 ? classList.length * 30 : 50;
                
                processedCourses.push({
                    name: courseName,
                    teacher: teacher,
                    classroom_type: classroomType,
                    period_type: periodType,
                    theory_hours: theoryHours,
                    lab_hours: labHours,
                    total_hours: totalHours,
                    class_groups: classGroups,
                    students: estimatedStudents,
                    hours: weeklyHours,
                    credits: Math.ceil(totalHours / 16) || 2
                });
                
            } catch (error) {
                skippedRows.push(`第${i+1}行: ${error.message}`);
            }
        }
        
        console.log(`   成功解析 ${processedCourses.length} 门课程`);
        
        // 按学生人数降序排序
        processedCourses.sort((a, b) => b.students - a.students);
        
        // 5. 导入课程数据（使用负载均衡分配教室）
        console.log('\n5. 开始导入课程数据...');
        
        let importedCount = 0;
        const warnings = [];
        
        for (const course of processedCourses) {
            try {
                const requiredType = course.classroom_type;
                const requiredStudents = course.students;
                
                let location = null;
                
                if (!classroomByType[requiredType] || classroomByType[requiredType].length === 0) {
                    warnings.push(`课程 "${course.name}" 需要的教室类型 "${requiredType}" 不存在，使用默认教室`);
                    
                    // 尝试找到相近类型的教室
                    const availableTypes = Object.keys(classroomByType);
                    let fallbackType = null;
                    
                    if (requiredType.includes('多媒体')) {
                        fallbackType = availableTypes.find(t => t.includes('多媒体'));
                    } else if (requiredType.includes('机房') || requiredType.includes('计算机')) {
                        fallbackType = availableTypes.find(t => t.includes('计算机') || t.includes('机房'));
                    } else if (requiredType.includes('网络')) {
                        fallbackType = availableTypes.find(t => t.includes('网络'));
                    }
                    
                    if (fallbackType && classroomByType[fallbackType]) {
                        location = classroomByType[fallbackType][0].id;
                    } else if (classrooms.length > 0) {
                        location = classrooms[0].id;
                    }
                } else {
                    const availableRooms = classroomByType[requiredType];
                    
                    // 1. 先尝试找容量足够的教室中，使用次数最少的
                    let suitableRooms = availableRooms.filter(
                        room => room.capacity && room.capacity >= requiredStudents
                    );
                    
                    if (suitableRooms.length > 0) {
                        suitableRooms.sort((a, b) => classroomUsage[a.id] - classroomUsage[b.id]);
                        location = suitableRooms[0].id;
                    } else {
                        // 2. 如果没有容量足够的教室，选择容量最大的教室
                        availableRooms.sort((a, b) => {
                            if (!a.capacity) return 1;
                            if (!b.capacity) return -1;
                            return b.capacity - a.capacity;
                        });
                        
                        const bestRoom = availableRooms[0];
                        location = bestRoom.id;
                        
                        if (bestRoom.capacity) {
                            warnings.push(`课程 "${course.name}" 需要${requiredStudents}人座位，但${requiredType}最大容量为${bestRoom.capacity}人`);
                        } else {
                            warnings.push(`课程 "${course.name}" 需要${requiredStudents}人座位，但${requiredType}教室未设置容量`);
                        }
                    }
                    
                    if (location) {
                        classroomUsage[location] = (classroomUsage[location] || 0) + 1;
                    }
                }
                
                // 插入课程数据
                await connection.query(
                    `INSERT INTO courses 
                    (name, students, teacher, hours, credits, 
                     classroom_type, period_type, theory_hours, lab_hours,
                     total_hours, class_groups) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        course.name,
                        course.students,
                        course.teacher,
                        course.hours,
                        course.credits,
                        course.classroom_type,
                        course.period_type,
                        course.theory_hours,
                        course.lab_hours,
                        course.total_hours,
                        course.class_groups
                    ]
                );
                
                importedCount++;
                
                if (importedCount % 20 === 0) {
                    console.log(`   已导入 ${importedCount} 门课程...`);
                }
                
            } catch (error) {
                warnings.push(`导入课程 "${course.name}" 失败: ${error.message}`);
            }
        }
        
        // 6. 显示导入结果
        console.log('\n6. 导入完成！');
        console.log(`   成功导入: ${importedCount} 门课程`);
        console.log(`   跳过/失败: ${skippedRows.length} 行`);
        
        if (warnings.length > 0) {
            console.log(`   警告信息 (前10个):`);
            warnings.slice(0, 10).forEach(warning => {
                console.log(`     ${warning}`);
            });
            if (warnings.length > 10) {
                console.log(`    ... 还有 ${warnings.length - 10} 条警告`);
            }
        }
        
        // 7. 统计导入结果
        console.log('\n7. 导入数据统计:');
        
        const [totalCourses] = await connection.query('SELECT COUNT(*) as count FROM courses');
        console.log(`   数据库课程总数: ${totalCourses[0].count}`);
        
        const [classroomStats] = await connection.query(`
            SELECT 
                c.location,
                cl.type,
                cl.capacity,
                COUNT(c.id) as course_count,
                AVG(c.students) as avg_students
            FROM courses c
            LEFT JOIN classrooms cl ON c.location = cl.id
            WHERE c.location IS NOT NULL
            GROUP BY c.location, cl.type, cl.capacity
            ORDER BY cl.type, course_count DESC
        `);
        
        console.log('   教室使用情况:');
        const usageByType = {};
        classroomStats.forEach(stat => {
            const type = stat.type || '未知';
            if (!usageByType[type]) usageByType[type] = [];
            usageByType[type].push(`${stat.location}: ${stat.course_count}门课`);
        });
        
        Object.keys(usageByType).forEach(type => {
            console.log(`     ${type}:`);
            usageByType[type].slice(0, 5).forEach(info => {
                console.log(`       ${info}`);
            });
            if (usageByType[type].length > 5) {
                console.log(`        ... 还有 ${usageByType[type].length - 5} 间教室`);
            }
        });
        
        // 8. 检查数据库整体状态
        console.log('\n8. 数据库状态检查:');
        
        const [tableStatus] = await connection.query(`
            SELECT 
                (SELECT COUNT(*) FROM courses) as courses_count,
                (SELECT COUNT(*) FROM classrooms) as classrooms_count,
                (SELECT COUNT(*) FROM course_schedule) as schedule_count
        `);
        
        console.log(`   courses表: ${tableStatus[0].courses_count} 条记录`);
        console.log(`   classrooms表: ${tableStatus[0].classrooms_count} 条记录`);
        console.log(`   course_schedule表: ${tableStatus[0].schedule_count} 条记录`);
        
        // 检查users表（仅作验证，不操作）
        const [userTables] = await connection.query(`
            SELECT TABLE_NAME 
            FROM information_schema.tables 
            WHERE table_schema = ? AND table_name = 'users'
        `, [dbConfig.database]);
        
        if (userTables.length > 0) {
            console.log('🔒 users表保持完好，管理员权限不受影响');
        } else {
            console.log('ℹ️  users表不存在（如需要用户功能可单独创建）');
        }
        
        console.log('\n🎉 Excel数据导入完成！');
        console.log('\n📋 后续步骤:');
        console.log('1. 排课算法可以开始运行，结果将写入course_schedule表');
        console.log('2. 如果需要更新server.js以支持新表结构，请参考队长建议');
        console.log('3. course_schedule表已创建，支持一门课程多时间段排课');
        
    } catch (error) {
        console.error('❌ 导入过程出错:', error.message);
        
        if (error.code === 'ER_NO_SUCH_TABLE') {
            console.error('表不存在，请先创建表结构');
        }
        
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 数据库连接已关闭');
        }
    }
}

// 如果是直接运行
if (require.main === module) {
    importExcelData().catch(error => {
        console.error('脚本执行失败:', error.message);
        process.exit(1);
    });
} else {
    module.exports = importExcelData;
}