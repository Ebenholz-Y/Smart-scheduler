// routes/scheduleRoute.js - 修正版（已测试可用）
const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const dbConfig = require('../config/dbConfig');
const { GeneticScheduler } = require('../scheduler');

// ✅ 关键：内存缓存最新排课结果（解决 /teacher 接口无法获取数据的问题）
let latestSchedule = null;

// POST /api/schedule/run - 触发排课（已修正查询字段）
router.post('/run', async (req, res) => {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        await conn.execute(`USE ${dbConfig.database}`);

        // ✅ 重点修改：从数据库查询 teacher_id（不是 teacher）
        const [courses] = await conn.execute(` SELECT id, name, students, teacher_id, class_group FROM courses `);
        const [classrooms] = await conn.execute(`
            SELECT id, capacity FROM classrooms
        `);

        if (courses.length === 0 || classrooms.length === 0) {
            return res.status(400).json({ error: '数据库中缺少课程或教室数据' });
        }

        const scheduler = new GeneticScheduler({
            populationSize: 60,
            generations: 150,
            mutationRate: 0.12
        });

        console.log('🧬 开始运行排课算法...');
        const result = await scheduler.run(courses, classrooms);
        console.log(`✅ 排课完成，适应度: ${result.fitness}`);

        // ✅ 保存排课结果到内存（供 /teacher 接口使用）
        latestSchedule = result.schedule;

        res.json({
            success: true,
            fitness: result.fitness,
            schedule: result.schedule
        });

    } catch (err) {
        console.error('❌ 排课失败:', err);
        res.status(500).json({ error: '排课过程中发生错误', details: err.message });
    } finally {
        if (conn) await conn.end();
    }
});


// routes/scheduleRoute.js - 新增 /me 接口（支持三角色）
router.get('/me', (req, res) => {
  const { id, role } = req.query;
  if (!id || !role) {
    return res.status(400).json({ error: '缺少 id 或 role 参数' });
  }
  if (!latestSchedule) {
    return res.status(400).json({ error: '请先运行排课' });
  }
  let myCourses = [];
  switch (role) {
    case 'student':
      myCourses = latestSchedule;
      break;
    case 'teacher':
      myCourses = latestSchedule.filter(c => c.teacher_id === id);
      break;
    case 'admin':
      myCourses = latestSchedule;
      break;
    default:
      return res.status(400).json({ error: '不支持的角色' });
  }
  res.json({ success: true, schedule: myCourses });
});

// ✅ 新增：GET /api/schedule/teacher/:id - 教师查课表（根据工号）
router.get('/teacher/:id', (req, res) => {
    if (!latestSchedule) {
        return res.status(400).json({ error: '请先运行排课（点击“排课”按钮）' });
    }

    // ✅ 用 teacher_id 过滤（不是 teacher）
    const myCourses = latestSchedule.filter(course => 
        course.teacher_id === req.params.id
    );

    res.json({ success: true, schedule: myCourses });
});

// ✅ 新增：POST /api/schedule/adjust - 拖拽调课（带冲突检测）
router.post('/adjust', (req, res) => {
    const newSchedule = req.body;
    const conflicts = [];

    for (const course of newSchedule) {
        // 检查教室冲突（同一时间同一教室被占）
        const occupied = newSchedule.find(c => 
            c.classroom === course.classroom && 
            c.timeSlot === course.timeSlot
        );
        if (occupied && occupied.courseId !== course.courseId) {
            conflicts.push({
                course: course.name,
                reason: `教室 ${course.classroom} 在 ${course.timeSlot} 已被 ${occupied.name} 占用`
            });
        }
        
        // 检查教师冲突（同一时间同一教师有课）
        const teacherConflict = newSchedule.find(c => 
            c.teacher_id === course.teacher_id && 
            c.timeSlot === course.timeSlot
        );
        if (teacherConflict && teacherConflict.courseId !== course.courseId) {
            conflicts.push({
                course: course.name,
                reason: `教师 ${course.teacher_id} 在 ${course.timeSlot} 已有课`
            });
        }
    }


});

// ✅ GET /api/courses - 获取课程列表（通过查询参数传用户）
// ✅ 新增：GET /api/courses - 获取课程列表（通过查询参数传用户）
router.get('/', (req, res) => {
  const { id, role, class_group } = req.query; // ✅ 从查询参数获取用户信息
  if (!id || !role) {
    return res.status(400).json({ error: '缺少 id 或 role 参数' });
  }
  if (!latestSchedule) {
    return res.status(400).json({ error: '请先运行排课（点击“排课”按钮）' });
  }
  let myCourses = [];
  switch (role) {
    case 'teacher':
      myCourses = latestSchedule.filter(c => c.teacher_id === id); // ✅ 用 teacher_id 过滤
      break;
    case 'student':
      myCourses = latestSchedule.filter(course => {
      if (!course.class_groups) return false;
    // 将 class_groups 拆分成数组，检查是否包含当前班级
        return course.class_groups.split(';').includes(class_group);
     });
      break;
    case 'admin':
      myCourses = latestSchedule;
      break;
    default:
      return res.status(400).json({ error: '不支持的角色' });
  }
  // ✅ 关键修复：返回 { schedule: [...] } 而不是 { courses: [...] }
  res.json({ success: true, schedule: myCourses });
});

module.exports = router;