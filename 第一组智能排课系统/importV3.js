// importExcelDataV2.js - 修正版（适配无 location 字段的 courses 表）
const xlsx = require('xlsx');
const mysql = require('mysql2/promise');
const dbConfig = require('./config/dbConfig').config;
const fs = require('fs');

// 数据库环境检查（保持不变）
async function checkDatabaseEnvironment() {
  console.log('🔍 检查数据库环境...\n');
  let connection;
  try {
    connection = await mysql.createConnection({ 
      host: dbConfig.host, 
      port: dbConfig.port, 
      user: dbConfig.user, 
      password: dbConfig.password, 
      connectTimeout: 5000 
    });
    
    const [versionResult] = await connection.query('SELECT VERSION() as version');
    console.log(`✅ MySQL版本: ${versionResult[0].version}`);
    
    const [dbResult] = await connection.query('SELECT DATABASE() as db');
    const currentDb = dbResult[0].db;
    if (currentDb === null) {
      console.log(`⚠️ 未选择数据库，尝试选择: ${dbConfig.database}`);
      await connection.query(`USE ${dbConfig.database}`);
      console.log(`✅ 已选择数据库: ${dbConfig.database}`);
    } else {
      console.log(`✅ 当前数据库: ${currentDb}`);
    }
    
    const [tables] = await connection.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ?`,
      [dbConfig.database]
    );
    const requiredTables = ['classrooms', 'courses'];
    const existingTables = tables.map(t => t.table_name);
    const missingTables = requiredTables.filter(t => !existingTables.includes(t));
    
    if (missingTables.length > 0) {
      console.warn(`⚠️ 缺少必要表: ${missingTables.join(', ')}`);
    } else {
      console.log(`✅ 表结构完整`);
    }
    return true;
  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message);
    return false;
  } finally {
    if (connection) await connection.end();
  }
}

// 创建 classrooms 表（保持不变）
async function createClassroomsTableIfNotExists(connection) {
  // ... [此处省略，与原文件相同] ...
  // 注意：原文件中的 classroomsData 定义保留
}

// 创建 course_schedule 表（保持不变）
async function createCourseScheduleTableIfNotExists(connection) {
  // ... [此处省略，与原文件相同] ...
}

async function importExcelData() {
  console.log('=== Excel数据导入（修正版：不插入 location 到 courses） ===\n');
  
  const dbOk = await checkDatabaseEnvironment();
  if (!dbOk) return;
  
  const excelFile = '25-26（1）课程情况.xlsx';
  if (!fs.existsSync(excelFile)) {
    console.error(`❌ Excel文件不存在: ${excelFile}`);
    return;
  }
  console.log(`✅ 找到Excel文件: ${excelFile}`);
  
  let connection;
  try {
    connection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database
    });
    console.log('✅ 数据库连接成功\n');
    
    // 创建表（如果不存在）
    await createClassroomsTableIfNotExists(connection);
    await createCourseScheduleTableIfNotExists(connection);
    
    // 创建 courses 表（如果不存在）
    const [courseTables] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_name = 'courses'`,
      [dbConfig.database]
    );
    if (courseTables.length === 0) {
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
          block_size TINYINT NOT NULL DEFAULT 2,
          theory_hours INT DEFAULT 0,
          lab_hours INT DEFAULT 0,
          total_hours INT DEFAULT 0,
          class_groups TEXT
        )
      `);
      console.log('✅ courses表创建成功');
    }
    
    // 读取Excel
    const workbook = xlsx.readFile(excelFile);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = xlsx.utils.sheet_to_json(worksheet);
    console.log(` 读取到 ${rawData.length} 行数据\n`);
    
    // 清空旧数据（可选）
    const [oldCount] = await connection.query('SELECT COUNT(*) as count FROM courses');
    if (oldCount[0].count > 0) {
      console.log(`⚠️ 当前已有 ${oldCount[0].count} 门课程，将清空...`);
      await connection.query('DELETE FROM courses');
    }
    
    // 处理课程数据
    const processedCourses = [];
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      try {
        if (!row['课程名称'] || !row['教师名称']) continue;
        
        const courseName = row['课程名称'].toString().trim();
        const teacher = row['教师名称'].toString().trim();
        const classroomType = row['场地类别']?.toString().trim() || '多媒体教室';
        const periodType = row['学时类型']?.toString().trim() || '理论';
        const classGroups = row['教学班组成']?.toString().trim() || '';
        const theoryHours = parseInt(row['课程理论总学时']) || 0;
        const labHours = parseInt(row['课程实验总学时']) || 0;
        const totalHours = parseInt(row['课程总学时']) || (theoryHours + labHours);
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
        console.warn(`跳过第${i+1}行: ${error.message}`);
      }
    }
    
    // 导入课程（关键修改：不再分配 location！）
    console.log(`\n开始导入 ${processedCourses.length} 门课程...`);
    for (const course of processedCourses) {
      await connection.query(
        `INSERT INTO courses (
          name, students, teacher, hours, credits, 
          classroom_type, period_type, theory_hours, 
          lab_hours, total_hours, class_groups
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    }
    
    console.log('\n✅ 课程数据导入完成！');
    console.log('💡 注意：教室分配将在排课阶段进行（通过 /api/schedule/run）');
    
  } catch (error) {
    console.error('❌ 导入失败:', error.message);
  } finally {
    if (connection) await connection.end();
    console.log('\n🔌 数据库连接已关闭');
  }
}

if (require.main === module) {
  importExcelData().catch(console.error);
} else {
  module.exports = importExcelData;
}