// server.js - 排课系统后端服务主文件（与完整dbConfig.js兼容版）
const express = require('express');
const dbConfig = require('./config/dbConfig'); // 使用您现有的454行版本
const app = express();
const port = 3000;

// 使用dbConfig导出的pool（已包含字符集配置）
const pool = dbConfig.pool;

// 启动时测试数据库连接
async function testConnection() {
  console.log('🔍 检查数据库连接...\n');
  try {
    const connection = await pool.getConnection(); // 测试连接
    const [versionResult] = await connection.query('SELECT VERSION() as version');
    console.log(`✅ MySQL版本: ${versionResult[0].version}`);
    // 检查数据库
    const [dbResult] = await connection.query('SELECT DATABASE() as db');
    console.log(`✅ 当前数据库: ${dbResult[0].db || '未选择'}`);
    // 检查表结构
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`✅ 找到 ${tables.length} 张表`);
    // 检查是否有course_schedule表
    const tableNames = tables.map(t => Object.values(t)[0]);
    if (!tableNames.includes('course_schedule')) {
      console.warn('⚠️ 未找到course_schedule表，请运行导入脚本创建');
    }
    connection.release(); // 将连接释放回池中
    console.log('\n✅ 数据库连接池创建成功！');
    return true;
  } catch (err) {
    console.error('❌ 数据库连接失败:', err.message);
    console.error('\n💡 请检查以下问题:');
    console.error('1. MySQL服务是否运行 (net start mysql)');
    console.error('2. config/dbConfig.js 中的配置是否正确');
    console.error('3. 数据库是否存在');
    console.error('4. 用户名和密码是否正确\n');
    return false;
  }
}

const auth = require('./auth'); // 👈 新增导入

// 中间件设置
app.use(express.json()); // 解析JSON格式的请求体
app.use(express.static('.')); // 将当前目录作为静态资源根目录

// 设置CORS，允许前端跨域访问
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ===== 新增：认证中间件（从查询参数或会话解析用户）=====
function authMiddleware(req, res, next) {
  // 从查询参数获取 user（用于 timetable.html?user=...）
  let userParam = req.query.user || null;
  
  // 如果没有，则尝试从 body（登录时）
  if (!userParam && req.body && req.body.username) {
    const { username, password } = req.body;
    if (password === '123456') {
      let role, classGroup, teacherName;
      if (username.startsWith('S_')) {
        role = 'student';
        classGroup = username.slice(2);
      } else if (username.startsWith('T_')) {
        role = 'teacher';
        teacherName = username.slice(2);
      } else if (username === 'A_admin') {
        role = 'admin';
      } else {
        return res.status(400).json({ error: '无效账号格式' });
      }
      req.user = { username, role, classGroup, teacherName };
      return next();
    }
  }

  // 从 user 参数解析（格式如 A_admin, T_张三, S_班级）
  if (userParam) {
    let role, classGroup, teacherName, username = userParam;
    if (username.startsWith('S_')) {
      role = 'student';
      classGroup = username.slice(2);
    } else if (username.startsWith('T_')) {
      role = 'teacher';
      teacherName = username.slice(2);
    } else if (username === 'A_admin') {
      role = 'admin';
    } else {
      return res.status(400).json({ error: '无效账号格式' });
    }
    req.user = { username, role, classGroup, teacherName };
    return next();
  }

  // 未认证
  return res.status(401).json({ error: '未提供有效用户信息' });
}

// ===== 新增：认证相关路由 =====
app.post('/api/auth/login', auth.login);

// 关键修复：为 /api/auth/courses 添加 authMiddleware
app.get('/api/auth/courses', authMiddleware, (req, res) => {
  // 将 req.user 传递给 auth.getCoursesByRole
  req.user = req.user; // 确保存在
  auth.getCoursesByRole(req, res);
});

// -------------------- 核心API路由开始 --------------------

// 1. 健康检查接口
app.get('/api/status', async (req, res) => {
  try {
    const [version] = await pool.query('SELECT VERSION() as version');
    const [courseCount] = await pool.query('SELECT COUNT(*) as count FROM courses');
    const [classroomCount] = await pool.query('SELECT COUNT(*) as count FROM classrooms');
    const [scheduleCount] = await pool.query('SELECT COUNT(*) as count FROM course_schedule');
    res.json({
      message: '排课系统后端服务运行正常！',
      timestamp: new Date().toISOString(),
      database: {
        version: version[0].version,
        name: dbConfig.config.database,
        host: `${dbConfig.config.host}:${dbConfig.config.port}`,
        user: dbConfig.config.user
      },
      statistics: {
        courses: courseCount[0].count,
        classrooms: classroomCount[0].count,
        course_schedule: scheduleCount[0].count
      },
      api_endpoints: [
        'GET /api/status',
        'GET /api/classrooms',
        'GET /api/courses (旧接口)',
        'GET /api/courses-with-schedule (推荐)',
        'GET /api/courses/:id',
        'GET /api/courses/:id/schedule',
        'GET /api/teachers/:teacher_id/timetable',
        'POST /api/upload/classrooms',
        'POST /api/upload/courses',
        'POST /api/schedule/run',
        'GET /api/schedule',
        'POST /api/schedule/import',
        'GET /api/classrooms/:id/schedule',
        'GET /api/debug/db-test',
        'GET /api/debug/tables',
        'POST /api/auth/login',
        'GET /api/auth/courses' // 👈 新增到列表
      ]
    });
  } catch (error) {
    res.status(500).json({ error: '数据库连接失败', message: error.message });
  }
});

// 2. 获取所有教室信息
app.get('/api/classrooms', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM classrooms ORDER BY id');
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('获取教室数据失败:', err);
    res.status(500).json({ success: false, error: '获取教室数据失败', details: err.message });
  }
});

// 3. 获取所有课程信息（关联教室容量）- 旧接口（向后兼容）
app.get('/api/courses', async (req, res) => {
  try {
    const sql = `
      SELECT c.*, r.capacity as room_capacity
      FROM courses c
      LEFT JOIN classrooms r ON c.location = r.id
      ORDER BY c.id
    `;
    const [rows] = await pool.query(sql);
    res.json({
      success: true,
      count: rows.length,
      data: rows,
      note: '这是旧接口，推荐使用 /api/courses-with-schedule'
    });
  } catch (err) {
    console.error('获取课程数据失败:', err);
    res.status(500).json({ success: false, error: '获取课程数据失败', details: err.message });
  }
});

// 4. 获取所有课程信息（包含排课信息）- 新接口（推荐）
app.get('/api/courses-with-schedule', async (req, res) => {
  try {
    const sql = `
      SELECT c.*, cs.id as schedule_id, cs.day, cs.period, cs.location as schedule_location, cs.time,
             cr.capacity, cr.type as room_type, cr.room_location
      FROM courses c
      LEFT JOIN course_schedule cs ON c.id = cs.course_id
      LEFT JOIN classrooms cr ON cs.location = cr.id
      ORDER BY c.id, cs.day, cs.period
    `;
    const [rows] = await pool.query(sql);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('获取课程数据失败:', err);
    res.status(500).json({ success: false, error: '获取课程数据失败', details: err.message });
  }
});

// 5. 按ID获取单个课程详情
app.get('/api/courses/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    if (rows.length > 0) {
      res.json({ success: true, data: rows[0] });
    } else {
      res.status(404).json({ success: false, error: '未找到该课程' });
    }
  } catch (err) {
    console.error('查询课程详情失败:', err);
    res.status(500).json({ success: false, error: '查询课程详情失败', details: err.message });
  }
});

// 6. 获取课程排课详情
app.get('/api/courses/:id/schedule', async (req, res) => {
  try {
    const sql = `
      SELECT cs.*, cr.capacity, cr.type as room_type, cr.room_location
      FROM course_schedule cs
      LEFT JOIN classrooms cr ON cs.location = cr.id
      WHERE cs.course_id = ?
      ORDER BY cs.day, cs.period
    `;
    const [rows] = await pool.query(sql, [req.params.id]);
    // 获取课程基本信息
    const [courseInfo] = await pool.query('SELECT * FROM courses WHERE id = ?', [req.params.id]);
    res.json({
      success: true,
      course: courseInfo[0] || null,
      schedule_count: rows.length,
      schedule: rows
    });
  } catch (err) {
    console.error('获取课程排课详情失败:', err);
    res.status(500).json({ success: false, error: '获取课程排课详情失败', details: err.message });
  }
});

// 7. 教师课表查询接口
app.get('/api/teachers/:teacher_id/timetable', async (req, res) => {
  const teacherId = req.params.teacher_id;
  if (!teacherId || teacherId.trim() === '') {
    return res.status(400).json({ success: false, error: '教师工号不能为空' });
  }
  try {
    // 首先获取教师基本信息
    const [teacherCourses] = await pool.query(
      'SELECT * FROM courses WHERE teacher_id = ? ORDER BY id',
      [teacherId]
    );
    if (teacherCourses.length === 0) {
      return res.json({
        success: true,
        teacher_id: teacherId,
        message: '该教师暂无课程安排',
        timetable: []
      });
    }
    // 获取教师的排课信息
    const teacherCourseIds = teacherCourses.map(course => course.id);
    const placeholders = teacherCourseIds.map(() => '?').join(',');
    const sql = `
      SELECT cs.*, c.name as course_name, c.classroom_type,
             cr.type as room_type, cr.capacity, cr.room_location
      FROM course_schedule cs
      JOIN courses c ON cs.course_id = c.id
      LEFT JOIN classrooms cr ON cs.location = cr.id
      WHERE cs.course_id IN (${placeholders})
      ORDER BY cs.day, cs.period
    `;
    const [timetable] = await pool.query(sql, teacherCourseIds);
    res.json({
      success: true,
      teacher_id: teacherId,
      teacher_name: teacherCourses[0].teacher,
      course_count: teacherCourses.length,
      timetable_count: timetable.length,
      courses: teacherCourses,
      timetable: timetable
    });
  } catch (err) {
    console.error(`查询教师 ${teacherId} 课表失败:`, err);
    res.status(500).json({ success: false, error: '服务器内部错误，查询课表失败', details: err.message });
  }
});

// 8. 上传教室
app.post('/api/upload/classrooms', async (req, res) => {
  const classrooms = req.body;
  if (!Array.isArray(classrooms)) {
    return res.status(400).json({ success: false, error: '请求体应为教室数组' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const room of classrooms) {
      await connection.query(
        `INSERT INTO classrooms (id, type, room_location, capacity, available_time_slots)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         type = VALUES(type),
         room_location = VALUES(room_location),
         capacity = VALUES(capacity),
         available_time_slots = VALUES(available_time_slots)`,
        [room.id, room.type || '普通教室', room.location_description, room.capacity, room.available_time_slots || '[1,2,3,4,5,6,7,8,9,10]']
      );
    }
    await connection.commit();
    res.json({ success: true, message: `成功上传/更新 ${classrooms.length} 间教室` });
  } catch (err) {
    await connection.rollback();
    console.error('上传教室失败:', err);
    res.status(500).json({ success: false, error: '上传教室失败', details: err.message });
  } finally {
    connection.release();
  }
});

// 9. 上传课程
app.post('/api/upload/courses', async (req, res) => {
  const courses = req.body;
  if (!Array.isArray(courses)) {
    return res.status(400).json({ success: false, error: '请求体应为课程数组' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const course of courses) {
      // 检查教室是否存在（如果提供了location）
      if (course.location) {
        const [roomExists] = await connection.query(
          'SELECT id FROM classrooms WHERE id = ?',
          [course.location]
        );
        if (roomExists.length === 0) {
          throw new Error(`教室 ${course.location} 不存在，请先上传该教室`);
        }
      }
      await connection.query(
        `INSERT INTO courses (name, students, teacher, teacher_id, hours, credits, location, classroom_type, period_type, theory_hours, lab_hours, total_hours, class_groups)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         students = VALUES(students),
         teacher = VALUES(teacher),
         teacher_id = VALUES(teacher_id),
         hours = VALUES(hours),
         credits = VALUES(credits),
         location = VALUES(location),
         classroom_type = VALUES(classroom_type),
         period_type = VALUES(period_type),
         theory_hours = VALUES(theory_hours),
         lab_hours = VALUES(lab_hours),
         total_hours = VALUES(total_hours),
         class_groups = VALUES(class_groups)`,
        [
          course.name,
          course.students,
          course.teacher,
          course.teacher_id,
          course.hours || 3,
          course.credits || 2,
          course.location,
          course.classroom_type || '多媒体教室',
          course.period_type || '理论',
          course.theory_hours || 0,
          course.lab_hours || 0,
          (course.theory_hours || 0) + (course.lab_hours || 0),
          course.class_groups || ''
        ]
      );
    }
    await connection.commit();
    res.json({ success: true, message: `成功上传 ${courses.length} 门课程` });
  } catch (err) {
    await connection.rollback();
    console.error('上传课程失败:', err);
    res.status(500).json({ success: false, error: '上传课程失败', details: err.message });
  } finally {
    connection.release();
  }
});

// 10. 开始排课（支持新表结构）
// 10. 开始排课（支持新表结构）- 仅限管理员
const { rearrangeWithDrag } = require('./scheduler');

// ✅ 新增：管理员权限校验中间件
function adminOnlyMiddleware(req, res, next) {
    // 从查询参数获取 user（用于 timetable.html?user=...）
    let userParam = req.query.user || null;
    // 如果没有，则尝试从 body（拖拽时可能携带）
    if (!userParam && req.body?.draggedCourse) {
        // 拖拽请求通常来自管理员界面，但仍需验证
        // 这里我们要求必须通过 query 或 body 显式传 user
        userParam = req.body.user || null;
    }

    let role = null, username = null;

    if (userParam) {
        username = userParam;
        if (username === 'A_admin') {
            role = 'admin';
        } else if (username.startsWith('T_')) {
            role = 'teacher';
        } else if (username.startsWith('S_')) {
            role = 'student';
        }
    }

    if (role !== 'admin') {
        return res.status(403).json({
            success: false,
            error: '权限不足：仅管理员可执行自动排课'
        });
    }

    // 可选：将用户信息挂载到 req（scheduler 可能用到）
    req.user = { username, role };
    next();
}

app.post('/api/schedule/run', adminOnlyMiddleware, async (req, res) => {
    try {
        // 调用 scheduler.js 的智能排课算法
        await rearrangeWithDrag(req, res);
    } catch (err) {
        console.error('排课执行失败:', err);
        res.status(500).json({ success: false, error: '排课执行失败', details: err.message });
    }
});

// 11. 获取所有排课信息
app.get('/api/schedule', async (req, res) => {
  try {
    const sql = `
      SELECT cs.*, c.name as course_name, c.teacher, c.students, c.classroom_type,
             cr.type as room_type, cr.capacity, cr.room_location
      FROM course_schedule cs
      JOIN courses c ON cs.course_id = c.id
      LEFT JOIN classrooms cr ON cs.location = cr.id
      ORDER BY cs.day, cs.period, cs.location
    `;
    const [rows] = await pool.query(sql);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('获取排课信息失败:', err);
    res.status(500).json({ success: false, error: '获取排课信息失败', details: err.message });
  }
});

// 12. 导入排课结果（供算法同学使用）
app.post('/api/schedule/import', async (req, res) => {
  const scheduleData = req.body;
  if (!Array.isArray(scheduleData)) {
    return res.status(400).json({ success: false, error: '请求体应为排课数据数组' });
  }
  if (scheduleData.length === 0) {
    return res.status(400).json({ success: false, error: '排课数据不能为空' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // 清空现有的排课数据
    await connection.query('DELETE FROM course_schedule');
    let successCount = 0;
    const errors = [];
    for (let i = 0; i < scheduleData.length; i++) {
      const item = scheduleData[i];
      try {
        // 验证必要字段
        if (!item.course_id || !item.day || !item.period || !item.location) {
          errors.push(`第${i+1}条数据缺少必要字段`);
          continue;
        }
        // 检查课程是否存在
        const [courseExists] = await connection.query(
          'SELECT id FROM courses WHERE id = ?',
          [item.course_id]
        );
        if (courseExists.length === 0) {
          errors.push(`第${i+1}条数据: 课程ID ${item.course_id} 不存在`);
          continue;
        }
        // 检查教室是否存在
        const [classroomExists] = await connection.query(
          'SELECT id FROM classrooms WHERE id = ?',
          [item.location]
        );
        if (classroomExists.length === 0) {
          errors.push(`第${i+1}条数据: 教室 ${item.location} 不存在`);
          continue;
        }
        // 检查时间冲突（唯一约束会处理，但这里先检查给出友好提示）
        const [conflict] = await connection.query(`
          SELECT course_id FROM course_schedule
          WHERE location = ? AND day = ? AND period = ?
        `, [item.location, item.day, item.period]);
        if (conflict.length > 0) {
          errors.push(`第${i+1}条数据: 教室 ${item.location} 在周${item.day}第${item.period}节已被占用`);
          continue;
        }
        // 插入数据
        await connection.query(
          `INSERT INTO course_schedule (course_id, day, period, location, time)
           VALUES (?, ?, ?, ?, ?)`,
          [
            item.course_id,
            item.day,
            item.period,
            item.location,
            item.time || generateTimeString(item.day, item.period)
          ]
        );
        successCount++;
      } catch (error) {
        errors.push(`第${i+1}条数据: ${error.message}`);
      }
    }
    await connection.commit();
    res.json({
      success: true,
      message: `成功导入 ${successCount} 条排课记录`,
      errors: errors.length > 0 ? errors : undefined,
      stats: {
        total: scheduleData.length,
        success: successCount,
        failed: errors.length
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('导入排课数据失败:', err);
    res.status(500).json({ success: false, error: '导入排课数据失败', details: err.message });
  } finally {
    connection.release();
  }
});

// 13. 按教室查询排课
app.get('/api/classrooms/:id/schedule', async (req, res) => {
  const classroomId = req.params.id;
  try {
    // 检查教室是否存在
    const [classroomExists] = await pool.query(
      'SELECT id FROM classrooms WHERE id = ?',
      [classroomId]
    );
    if (classroomExists.length === 0) {
      return res.status(404).json({ success: false, error: `教室 ${classroomId} 不存在` });
    }
    const sql = `
      SELECT cs.*, c.name as course_name, c.teacher, c.students, c.classroom_type,
             cr.type as room_type, cr.capacity, cr.room_location
      FROM course_schedule cs
      JOIN courses c ON cs.course_id = c.id
      LEFT JOIN classrooms cr ON cs.location = cr.id
      WHERE cs.location = ?
      ORDER BY cs.day, cs.period
    `;
    const [schedule] = await pool.query(sql, [classroomId]);
    const [classroomInfo] = await pool.query('SELECT * FROM classrooms WHERE id = ?', [classroomId]);
    res.json({
      success: true,
      classroom: classroomInfo[0],
      schedule_count: schedule.length,
      schedule: schedule
    });
  } catch (err) {
    console.error('查询教室排课失败:', err);
    res.status(500).json({ success: false, error: '查询教室排课失败', details: err.message });
  }
});

// 14. 数据库连接测试接口（调试用）
app.get('/api/debug/db-test', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [version] = await connection.query('SELECT VERSION() as version');
    const [tables] = await connection.query('SHOW TABLES');
    const tableDetails = [];
    for (const table of tables) {
      const tableName = Object.values(table)[0];
      const [count] = await connection.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      tableDetails.push({ table: tableName, count: count[0].count });
    }
    connection.release();
    res.json({
      success: true,
      database: dbConfig.config.database,
      version: version[0].version,
      tables: tableDetails,
      config: {
        host: dbConfig.config.host,
        port: dbConfig.config.port,
        user: dbConfig.config.user,
        database: dbConfig.config.database
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, code: error.code });
  }
});

// 15. 检查表结构
app.get('/api/debug/tables', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    // 获取所有表
    const [tables] = await connection.query('SHOW TABLES');
    const tableInfo = [];
    for (const table of tables) {
      const tableName = Object.values(table)[0];
      const [fields] = await connection.query(`DESCRIBE ${tableName}`);
      const [count] = await connection.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      tableInfo.push({
        table: tableName,
        fields: fields.map(f => ({
          name: f.Field,
          type: f.Type,
          nullable: f.Null === 'YES',
          key: f.Key,
          default: f.Default
        })),
        row_count: count[0].count
      });
    }
    connection.release();
    res.json({ success: true, tables: tableInfo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 辅助函数：根据星期和节次生成时间字符串
function generateTimeString(day, period) {
  const days = ['周一', '周二', '周三', '周四', '周五'];
  const timeSlots = [
    '08:00-08:45', '08:55-09:40', '10:00-10:45', '10:55-11:40',
    '14:00-14:45', '14:55-15:40', '16:00-16:45', '16:55-17:40',
    '19:00-19:45', '19:55-20:40', '20:50-21:35'
  ];
  const dayStr = days[day - 1] || `周${day}`;
  const timeStr = timeSlots[period - 1] || `${period}节`;
  return `${dayStr} ${timeStr}`;
}

// 错误处理中间件
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: `接口 ${req.method} ${req.originalUrl} 不存在`,
    available_endpoints: [
      'GET /api/status - 服务状态',
      'GET /api/classrooms - 获取所有教室',
      'GET /api/courses - 获取所有课程（旧接口）',
      'GET /api/courses-with-schedule - 获取课程及排课（推荐）',
      'GET /api/courses/:id - 获取课程详情',
      'GET /api/courses/:id/schedule - 获取课程排课详情',
      'GET /api/teachers/:id/timetable - 获取教师课表',
      'POST /api/upload/classrooms - 上传教室',
      'POST /api/upload/courses - 上传课程',
      'POST /api/schedule/run - 开始排课',
      'GET /api/schedule - 获取所有排课',
      'POST /api/schedule/import - 导入排课结果（供算法使用）',
      'GET /api/classrooms/:id/schedule - 获取教室排课',
      'GET /api/debug/db-test - 数据库测试',
      'GET /api/debug/tables - 查看表结构',
      'POST /api/auth/login - 用户登录',
      'GET /api/auth/courses - 获取当前用户课表' // 👈 新增
    ]
  });
});

// 全局错误处理（兜底）
app.use((err, req, res, next) => {
  console.error('服务器内部错误:', err.stack);
  res.status(500).json({ success: false, error: '服务器内部错误，请查看日志' });
});

// 启动服务器
async function startServer() {
  console.log('🚀 正在启动排课系统后端服务...\n');
  // 测试数据库连接
  const dbReady = await testConnection();
  if (!dbReady) {
    console.error('\n❌ 数据库未就绪，服务器启动失败');
    console.error('💡 请解决数据库问题后重新启动');
    process.exit(1);
  }
  app.listen(port, () => {
    console.log(`\n✅ 排课系统后端服务已启动！`);
    console.log(`  本地地址: http://localhost:${port}`);
    console.log(`  接口文档: http://localhost:${port}/api/status\n`);
    console.log('📋 主要接口:');
    console.log(`  GET http://localhost:${port}/api/status`);
    console.log(`  GET http://localhost:${port}/api/classrooms`);
    console.log(`  GET http://localhost:${port}/api/courses-with-schedule (推荐)`);
    console.log(`  POST http://localhost:${port}/api/schedule/run`);
    console.log(`  GET http://localhost:${port}/api/debug/db-test\n`);
    console.log('💡 新功能说明:');
    console.log(' - 支持course_schedule表（解决课程多时间段问题）');
    console.log(' - 支持一门课程一周多天上课');
    console.log(' - 提供课程排课详情接口');
    console.log(' - 提供导入排课结果接口（供算法使用）');
    console.log(' - ✅ 新增认证路由 /api/auth/courses\n');
    console.log('💡 提示:');
    console.log(' - 确保只有一个MySQL实例运行');
    console.log(' - 团队使用相同的dbConfig.js配置');
    console.log(' - 定期备份数据\n');
  });
}

// 捕获未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});

// 捕获未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n🛑 正在关闭服务器...');
  if (pool) {
    await pool.end();
    console.log('✅ 数据库连接池已关闭');
  }
  process.exit(0);
});

// 启动服务器
startServer().catch(error => {
  console.error('服务器启动失败:', error);
  process.exit(1);
});

// 导出app用于测试
module.exports = app;