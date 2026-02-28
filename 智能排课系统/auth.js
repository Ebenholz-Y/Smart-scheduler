// auth.js - 修复数据库连接方式（使用连接池）
const { pool: dbPool } = require('./config/dbConfig');

exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (password !== '123456') return res.status(401).json({ error: '密码错误' });
  let role, classGroup, teacherName;
  if (username.startsWith('S_')) {
    role = 'student'; classGroup = username.slice(2);
  } else if (username.startsWith('T_')) {
    role = 'teacher'; teacherName = username.slice(2);
  } else if (username === 'A_admin') {
    role = 'admin';
  } else {
    return res.status(400).json({ error: '无效账号格式' });
  }
  res.json({ success: true, user: { username, role, classGroup, teacherName } });
};

exports.getCoursesByRole = async (req, res) => {
  const { role, classGroup, teacherName } = req.user;
  try {
    let sql, params;
    if (role === 'student') {
      sql = `
        SELECT c.*, cs.day, cs.period, cs.location, cs.time, r.capacity AS room_capacity, r.type AS classroom_type, r.room_location
        FROM courses c
        LEFT JOIN course_schedule cs ON c.id = cs.course_id
        LEFT JOIN classrooms r ON cs.location = r.id
        WHERE c.class_groups LIKE ?
        ORDER BY cs.day, cs.period
      `;
      params = [`%${classGroup}%`];
    } else if (role === 'teacher') {
      sql = `
        SELECT c.*, cs.day, cs.period, cs.location, cs.time, r.capacity AS room_capacity, r.type AS classroom_type, r.room_location
        FROM courses c
        LEFT JOIN course_schedule cs ON c.id = cs.course_id
        LEFT JOIN classrooms r ON cs.location = r.id
        WHERE c.teacher = ?
        ORDER BY cs.day, cs.period
      `;
      params = [teacherName];
    } else {
      sql = `
        SELECT c.*, cs.day, cs.period, cs.location, cs.time, r.capacity AS room_capacity, r.type AS classroom_type, r.room_location
        FROM courses c
        LEFT JOIN course_schedule cs ON c.id = cs.course_id
        LEFT JOIN classrooms r ON cs.location = r.id
        ORDER BY cs.day, cs.period
      `;
      params = [];
    }

    // ✅ 正确：使用连接池
    const [rows] = await dbPool.execute(sql, params);

    const result = rows.map(row => ({
      course: {
        id: row.id,
        name: row.name,
        students: row.students || 0,
        teacher: row.teacher || '未知',
        teacher_id: row.teacher_id || null,
        hours: row.hours || 0,
        credits: row.credits || 0,
        theory_hours: row.theory_hours || 0,
        lab_hours: row.lab_hours || 0,
        total_hours: row.total_hours || 0,
        class_groups: row.class_groups || '',
        period_type: row.period_type || '理论'
      },
      classroom: {
        id: row.location || '未知',
        name: row.location || '未知教室', // 注意：这里应显示教室名，但数据库没存名字，只能用 id
        capacity: row.room_capacity || 0,
        type: row.classroom_type || '普通教室',
        room_location: row.room_location || '未知楼'
      },
      time: row.time || '',
      day: row.day == null ? null : Number(row.day),
      period: row.period == null ? null : Number(row.period)
    }));

    res.json(result);
  } catch (err) {
    console.error('查询错误:', err);
    res.status(500).json({ error: err.message });
  }
};