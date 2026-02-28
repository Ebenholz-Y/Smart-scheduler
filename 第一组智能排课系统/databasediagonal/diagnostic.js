// diagnostic.js
const { execSync } = require('child_process');
const mysql = require('mysql2/promise');

console.log('=== MySQL连接诊断 ===\n');

// 1. 检查进程
console.log('1. 检查MySQL进程...');
try {
  const procOutput = execSync('tasklist /svc | findstr mysqld', { encoding: 'utf8' });
  console.log(procOutput);
} catch (e) {
  console.log('❌ 未找到mysqld进程');
}

// 2. 检查端口
console.log('\n2. 检查端口3306...');
try {
  const portOutput = execSync('netstat -ano | findstr :3306', { encoding: 'utf8' });
  console.log(portOutput);
} catch (e) {
  console.log('❌ 3306端口未监听');
}

// 3. 测试连接
console.log('\n3. 测试数据库连接...');
const config = {
  host: 'localhost',
  user: 'scheduler',
  password: 'secure_password',
  database: 'course_schedule',
  port: 3306,
  connectTimeout: 5000
};

async function testConnection() {
  try {
    const connection = await mysql.createConnection(config);
    console.log('✅ 连接成功！');
    
    const [version] = await connection.execute('SELECT VERSION() AS version');
    console.log('✅ MySQL版本:', version[0].version);
    
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('✅ 表数量:', tables.length);
    
    await connection.end();
  } catch (error) {
    console.log('❌ 连接失败:', error.message);
    console.log('错误代码:', error.code);
    console.log('错误号:', error.errno);
  }
}

testConnection();