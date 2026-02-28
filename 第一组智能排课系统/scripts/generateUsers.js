// scripts/generateUsers.js
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const dbConfig = require('../config/dbConfig');

async function generateUsers() {
  const connection = await mysql.createConnection(dbConfig);
  console.log('=== 开始生成用户账号 ===');

  try {
    // 1. 清空旧用户（可选）
    await connection.execute('DELETE FROM users WHERE id != "A_admin"');
    console.log('✅ 已清空非管理员用户');

    // 2. 插入管理员（固定）
    const adminPassword = await bcrypt.hash('123456', 10);
    await connection.execute(
      `INSERT INTO users (id, name, password, role) VALUES (?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE password = VALUES(password)`,
      ['A_admin', '系统管理员', adminPassword, 'admin']
    );
    console.log('✅ 管理员账号: A_admin / 123456');

    // 3. 从 courses 表提取所有老师
    const [teachers] = await connection.execute(
      'SELECT DISTINCT teacher FROM courses WHERE teacher IS NOT NULL'
    );
    for (let i = 0; i < teachers.length; i++) {
      const name = teachers[i].teacher.trim();
      if (!name) continue;
      const id = `T_${name}`; // 如 T_X, T_张三
      const hashed = await bcrypt.hash('123456', 10);
      await connection.execute(
        `INSERT INTO users (id, name, password, role) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE password = VALUES(password)`,
        [id, name, hashed, 'teacher']
      );
    }
    console.log(`✅ 已生成 ${teachers.length} 位教师账号，格式: T_姓名`);

    // 4. 从 courses 表提取所有班级
    const [courses] = await connection.execute('SELECT class_groups FROM courses');
    const classSet = new Set();
    for (const row of courses) {
      if (row.class_groups) {
        const classes = row.class_groups.split(';').map(c => c.trim()).filter(c => c);
        classes.forEach(cls => classSet.add(cls));
      }
    }

    for (const className of classSet) {
      const id = `S_${className}`; // 如 S_23物联网工程1班
      const hashed = await bcrypt.hash('123456', 10);
      await connection.execute(
        `INSERT INTO users (id, name, password, role) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE password = VALUES(password)`,
        [id, className, hashed, 'student']
      );
    }
    console.log(`✅ 已生成 ${classSet.size} 个班级账号，格式: S_班级名`);

    console.log('\n🎉 所有账号已生成！初始密码均为: 123456');
  } catch (err) {
    console.error('❌ 生成失败:', err.message);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  generateUsers();
}