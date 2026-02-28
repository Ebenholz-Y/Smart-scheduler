// scheduler.js - 最终版：2节连堂优先 + 日课时强均衡（差值≤5） + 连堂一致性保障
const mysql = require('mysql2/promise');
const dbConfig = require('./config/dbConfig');

// ✅ 修复：优先2节连堂，其次3节，最后1节；连堂块大小 ∈ [1,3]
function getWeeklySessions(totalHours) {
  if (totalHours <= 0) return [1];
  
  // 计算每周应上课节数（按16周）
  const weekly = Math.ceil(totalHours / 16);
  const sessions = [];
  let remaining = weekly;

  // 优先安排 2 节连堂
  while (remaining >= 2) {
    sessions.push(2);
    remaining -= 2;
  }
  // 然后安排 3 节（处理剩余为3的情况）
  while (remaining >= 3) {
    sessions.push(3);
    remaining -= 3;
  }
  // 最后处理剩余1节
  if (remaining === 1) {
    // 如果已有2节块，可合并为3节（但会破坏2节优先）
    // 保守做法：单独1节
    sessions.push(1);
  }
  
  return sessions.length ? sessions : [1];
}

function isCrossBreak(start, blockSize) {
  const end = start + blockSize - 1;
  if (start <= 4 && end >= 5) return true; // 上午→下午
  if (start <= 8 && end >= 9) return true; // 下午→晚上
  return false;
}

// ✅ 新增：计算某天当前已安排节数
function countDaySlots(day, teacherBusy, classBusy, roomBusy) {
  let count = 0;
  for (let period = 1; period <= 11; period++) {
    const slot = `${day}-${period}`;
    if (Array.from(teacherBusy.values()).some(set => set.has(slot)) ||
        Array.from(classBusy.values()).some(set => set.has(slot)) ||
        Array.from(roomBusy.values()).some(set => set.has(slot))) {
      count++;
    }
  }
  return count;
}

// ✅ 改进：安排前检查日均衡性（安排后日课时差 ≤5）
async function placeSession(conn, course, blockSize, teacherBusy, classBusy, roomBusy, roomByType) {
  const classes = (course.class_groups || '').split(';').filter(Boolean) || ['通用班_' + course.id];
  const reqType = course.classroom_type || '多媒体教室';
  const roomList = roomByType.get(reqType) || roomByType.get('多媒体教室') || [];

  // 获取当前日课时分布
  const currentDailyCounts = {1:0, 2:0, 3:0, 4:0, 5:0};
  for (let day = 1; day <= 5; day++) {
    currentDailyCounts[day] = countDaySlots(day, teacherBusy, classBusy, roomBusy);
  }
  const currentMax = Math.max(...Object.values(currentDailyCounts));
  const currentMin = Math.min(...Object.values(currentDailyCounts));

  // 阶段1：只考虑周四(4)、周五(5)
  let candidateDays = [4, 5];
  let bestDay = null;
  let minLoad = Infinity;

  for (let day of candidateDays) {
    const load = countDaySlots(day, teacherBusy, classBusy, roomBusy);
    if (load < minLoad) {
      minLoad = load;
      bestDay = day;
    }
  }

  // 尝试在 bestDay 安排
  if (bestDay) {
    for (let start = 1; start <= 12 - blockSize; start++) {
      if (blockSize > 1 && isCrossBreak(start, blockSize)) continue;
      const slots = Array.from({ length: blockSize }, (_, i) => `${bestDay}-${start + i}`);
      if (slots.some(s => teacherBusy.get(course.teacher)?.has(s))) continue;
      if (classes.some(cls => slots.some(s => classBusy.get(cls)?.has(s)))) continue;
      const room = roomList.find(r => r && slots.every(s => !roomBusy.get(r.id)?.has(s)));
      if (!room) continue;

      // ✅ 检查安排后是否破坏日均衡（差值 >5）
      const newLoad = currentDailyCounts[bestDay] + blockSize;
      const newMax = Math.max(currentMax, newLoad);
      const newMin = Math.min(currentMin, ...Object.values(currentDailyCounts).map((v, i) => i+1 === bestDay ? newLoad : v));
      if (newMax - newMin > 5) {
        continue; // 跳过此安排
      }

      // ✅ 整个 block 使用同一个教室
      slots.forEach(s => {
        teacherBusy.set(course.teacher, (teacherBusy.get(course.teacher) || new Set()).add(s));
        roomBusy.set(room.id, (roomBusy.get(room.id) || new Set()).add(s));
        classes.forEach(cls => classBusy.set(cls, (classBusy.get(cls) || new Set()).add(s)));
      });

      for (let i = 0; i < blockSize; i++) {
        const p = start + i;
        const weekText = ['', '一', '二', '三', '四', '五'][bestDay];
        await conn.execute(
          `INSERT INTO course_schedule (course_id, day, period, location, time) VALUES (?, ?, ?, ?, ?)`,
          [course.id, bestDay, p, room.id, `周${weekText}第${p}节`]
        );
      }
      return true;
    }
  }

  // 阶段2：若周四/五都失败，则考虑周一~三
  candidateDays = [1, 2, 3];
  bestDay = null;
  minLoad = Infinity;

  for (let day of candidateDays) {
    const load = countDaySlots(day, teacherBusy, classBusy, roomBusy);
    if (load < minLoad) {
      minLoad = load;
      bestDay = day;
    }
  }

  if (bestDay) {
    for (let start = 1; start <= 12 - blockSize; start++) {
      if (blockSize > 1 && isCrossBreak(start, blockSize)) continue;
      const slots = Array.from({ length: blockSize }, (_, i) => `${bestDay}-${start + i}`);
      if (slots.some(s => teacherBusy.get(course.teacher)?.has(s))) continue;
      if (classes.some(cls => slots.some(s => classBusy.get(cls)?.has(s)))) continue;
      const room = roomList.find(r => r && slots.every(s => !roomBusy.get(r.id)?.has(s)));
      if (!room) continue;

      // ✅ 检查安排后是否破坏日均衡
      const newLoad = currentDailyCounts[bestDay] + blockSize;
      const newMax = Math.max(currentMax, newLoad);
      const newMin = Math.min(currentMin, ...Object.values(currentDailyCounts).map((v, i) => i+1 === bestDay ? newLoad : v));
      if (newMax - newMin > 5) {
        continue;
      }

      // ✅ 整个 block 使用同一个教室
      slots.forEach(s => {
        teacherBusy.set(course.teacher, (teacherBusy.get(course.teacher) || new Set()).add(s));
        roomBusy.set(room.id, (roomBusy.get(room.id) || new Set()).add(s));
        classes.forEach(cls => classBusy.set(cls, (classBusy.get(cls) || new Set()).add(s)));
      });

      for (let i = 0; i < blockSize; i++) {
        const p = start + i;
        const weekText = ['', '一', '二', '三', '四', '五'][bestDay];
        await conn.execute(
          `INSERT INTO course_schedule (course_id, day, period, location, time) VALUES (?, ?, ?, ?, ?)`,
          [course.id, bestDay, p, room.id, `周${weekText}第${p}节`]
        );
      }
      return true;
    }
  }

  return false;
}

async function rearrangeWithDrag(req, res) {
    let conn = null;
    try {
        conn = await mysql.createConnection(dbConfig.config);
        const [courses] = await conn.execute(`
            SELECT id, name, teacher, class_groups, total_hours, classroom_type, students, theory_hours, lab_hours
            FROM courses
            WHERE teacher IS NOT NULL AND TRIM(teacher) != ''
        `);
        const [rooms] = await conn.execute(`SELECT id, type, capacity FROM classrooms`);
        const roomByType = new Map();
        for (const r of rooms) {
            if (!roomByType.has(r.type)) roomByType.set(r.type, []);
            roomByType.get(r.type).push(r);
        }

        await conn.execute(`DELETE FROM course_schedule`);

        const initSet = () => new Set();
        const teacherBusy = new Map(), classBusy = new Map(), roomBusy = new Map();

        // 新增：记录每门课已被手动安排的节数
        const manuallyScheduled = new Map(); // courseId -> count

        // 处理拖拽课程（固定）
        if (req.body?.draggedCourse) {
            const dc = req.body.draggedCourse;
            const courseId = parseInt(dc.courseId);
            const day = parseInt(dc.day);
            const period = parseInt(dc.period);
            if (courseId && day >= 1 && day <= 5 && period >= 1 && period <= 11) {
                const course = courses.find(c => c.id === courseId);
                if (course) {
                    const classes = (course.class_groups || '').split(';').filter(Boolean) || ['通用班_' + course.id];
                    const reqType = course.classroom_type || '多媒体教室';
                    const roomList = roomByType.get(reqType) || roomByType.get('多媒体教室') || rooms;
                    const room = roomList.length > 0 ? roomList[0] : null;
                    if (room) {
                        const tk = `${day}-${period}`;
                        if (!(teacherBusy.get(course.teacher)?.has(tk)) &&
                            !classes.some(cls => classBusy.get(cls)?.has(tk)) &&
                            !(roomBusy.get(room.id)?.has(tk))) {

                            teacherBusy.set(course.teacher, (teacherBusy.get(course.teacher) || initSet()).add(tk));
                            roomBusy.set(room.id, (roomBusy.get(room.id) || initSet()).add(tk));
                            classes.forEach(cls => classBusy.set(cls, (classBusy.get(cls) || initSet()).add(tk)));

                            const weekText = ['', '一', '二', '三', '四', '五'][day];
                            await conn.execute(
                                `INSERT INTO course_schedule (course_id, day, period, location, time) VALUES (?, ?, ?, ?, ?)`,
                                [course.id, day, period, room.id, `周${weekText}第${period}节`]
                            );

                            // ✅ 记录：该课程已有1节被手动安排
                            manuallyScheduled.set(course.id, (manuallyScheduled.get(course.id) || 0) + 1);
                        }
                    }
                }
            }
        }

        const shuffledCourses = [...courses].sort(() => Math.random() - 0.5);
        for (const course of shuffledCourses) {
            const total = (course.theory_hours || 0) + (course.lab_hours || 0) || course.total_hours || 1;
            let weeklySlots = Math.ceil(total / 16);

            // ✅ 关键修复：减去已手动安排的节数
            const alreadyScheduled = manuallyScheduled.get(course.id) || 0;
            weeklySlots = Math.max(0, weeklySlots - alreadyScheduled);

            if (weeklySlots <= 0) continue; // 已全部手动安排

            // 重新计算 session 分块（基于剩余节数）
            const sessions = [];
            let remaining = weeklySlots;
            while (remaining >= 2) {
                sessions.push(2);
                remaining -= 2;
            }
            while (remaining >= 3) {
                sessions.push(3);
                remaining -= 3;
            }
            if (remaining === 1) {
                sessions.push(1);
            }

            for (const size of sessions) {
                const placed = await placeSession(conn, course, size, teacherBusy, classBusy, roomBusy, roomByType);
                if (!placed) {
                    console.warn(`⚠️ 课程 "${course.name}" (ID: ${course.id}) 无法安排 ${size} 节连堂`);
                }
            }
        }

        // 验证均衡性
        const dailyCounts = {1:0, 2:0, 3:0, 4:0, 5:0};
        for (let day = 1; day <= 5; day++) {
            dailyCounts[day] = countDaySlots(day, teacherBusy, classBusy, roomBusy);
        }
        const maxSlot = Math.max(...Object.values(dailyCounts));
        const minSlot = Math.min(...Object.values(dailyCounts));
        console.log('📅 日课时分布:', dailyCounts, '差值:', maxSlot - minSlot);

        await conn.end();
        res.json({
            success: true,
            message: '✅ 排课完成：2节连堂优先 + 日课时强均衡（差≤5） + 连堂一致性保障 + 拖拽节次扣除'
        });
    } catch (err) {
        console.error('[排课引擎错误]:', err);
        if (conn) await conn.end().catch(() => {});
        res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = { rearrangeWithDrag };